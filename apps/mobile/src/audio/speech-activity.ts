// A small speech check over the recorder's 16-bit PCM, to tell a forgotten
// recording (wind, footsteps, traffic, a phone rubbing in a pocket) from one
// where people are talking. It is not a trained voice detector. It looks for
// what speech has and steady or random noise lacks: syllable-like bursts that
// rise and fall by several decibels, a few times a second, each long enough
// to be a vowel, voiced (periodic at a pitch between 80 and 400 Hz), above an
// adaptive noise floor, and not as regular as a machine or footsteps.
//
// No React Native imports, so node's test runner can run it.

const SUBFRAME_MS = 20;
const ANALYSIS_RATE_HZ = 8_000;
const RING_SIZE = 8_192; // about 1 s at the analysis rate
const RING_MASK = RING_SIZE - 1;
const ENVELOPE_SIZE = 256; // about 5 s of sub-frames
const ENVELOPE_MASK = ENVELOPE_SIZE - 1;

// Loudness is measured over the band that carries speech. Voicing is judged
// on its low part, after pre-emphasis flattens wind and handling rumble (most
// of their energy is low, and narrow-band rumble would look periodic).
const HIGH_PASS_HZ = 250;
const LOW_PASS_HZ = 3_400;
const PRE_EMPHASIS = 0.95;
const VOICING_LOW_PASS_HZ = 1_000;

const SILENCE_DBFS = -100;
/** Quieter than this is never speech, however quiet the room. */
const MIN_LEVEL_DBFS = -65;
/** A syllable's peak stands at least this far over the noise floor. */
const OVER_FLOOR_DB = 6;
/** ... and this far over the dips on either side of it. */
const PROMINENCE_DB = 5;
/** Width of a syllable's peak, measured this far below it. */
const WIDTH_DB = 4;
const MIN_WIDTH_SUBFRAMES = 3; // 60 ms: a click or a footstep is shorter
const MAX_WIDTH_SUBFRAMES = 20; // 400 ms: a gust or a passing car is longer
// The floor falls to a quiet moment fast and rises slowly, so it follows
// steady noise but not speech, which keeps dipping between words.
const FLOOR_FALL = 0.25;
const FLOOR_RISE_DB_PER_SECOND = 1.5;

const PITCH_MIN_HZ = 80;
const PITCH_MAX_HZ = 400;
const VOICING_WINDOW_MS = 40;
const MIN_VOICING = 0.5;

/** Speech is this many syllables within the window below. */
const MIN_SYLLABLES = 3;
const SYLLABLE_WINDOW_MS = 4_000;
// Footsteps, beeps and machines keep time; people don't.
const RHYTHM_WINDOW_MS = 10_000;
const RHYTHM_MIN_INTERVALS = 5;
const RHYTHM_MAX_VARIATION = 0.1;

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function biquad(kind: "high" | "low", cutoffHz: number, sampleRate: number) {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const edge = kind === "high" ? (1 + cos) / 2 : (1 - cos) / 2;
  const middle = kind === "high" ? -(1 + cos) : 1 - cos;
  return {
    b0: edge / a0,
    b1: middle / a0,
    b2: edge / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  } satisfies Biquad;
}

export class SpeechActivity {
  private sampleRate = 0;
  private channels = 0;
  private highPass: Biquad = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  private lowPass: Biquad = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  private voicingLowPass: Biquad = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  private previousHigh = 0;
  private hz1 = 0;
  private hz2 = 0;
  private lz1 = 0;
  private lz2 = 0;
  private vz1 = 0;
  private vz2 = 0;

  private subframeSamples = 320;
  private subframeSum = 0;
  private subframeCount = 0;
  private decimation = 2;
  private analysisRate = ANALYSIS_RATE_HZ;
  private decimationSum = 0;
  private decimationCount = 0;
  private readonly ring = new Float32Array(RING_SIZE);
  private ringPosition = 0;
  private scratch = new Float32Array(0);

  private readonly envelope = new Float32Array(ENVELOPE_SIZE);
  private readonly envelopeEnd = new Float64Array(ENVELOPE_SIZE);
  private subframeIndex = 0;
  private floorDb = SILENCE_DBFS;
  private floorReady = false;

  private rising = false;
  private peakDb = SILENCE_DBFS;
  private peakIndex = 0;
  private peakFloorDb = SILENCE_DBFS;
  private dipDb = Number.POSITIVE_INFINITY;

  private syllables: number[] = [];
  private speechInChunk = false;

  /** The adaptive noise floor, in dBFS of the speech band. */
  get noiseFloorDb(): number {
    return this.floorDb;
  }

  /**
   * Feeds the next PCM (interleaved when stereo). Returns true when speech
   * was heard in it.
   */
  push(pcm: Int16Array, sampleRate: number, channels: number): boolean {
    if (sampleRate !== this.sampleRate || channels !== this.channels) {
      this.configure(sampleRate, channels);
    }
    this.speechInChunk = false;
    const { highPass: hp, lowPass: lp, voicingLowPass: vp } = this;
    const frames = Math.floor(pcm.length / channels);
    const subframeSamples = this.subframeSamples;
    const decimation = this.decimation;
    let previousHigh = this.previousHigh;
    let hz1 = this.hz1;
    let hz2 = this.hz2;
    let lz1 = this.lz1;
    let lz2 = this.lz2;
    let vz1 = this.vz1;
    let vz2 = this.vz2;
    let subframeSum = this.subframeSum;
    let subframeCount = this.subframeCount;
    let decimationSum = this.decimationSum;
    let decimationCount = this.decimationCount;

    for (let frame = 0; frame < frames; frame += 1) {
      let input: number;
      if (channels === 1) {
        input = pcm[frame] ?? 0;
      } else {
        input = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          input += pcm[frame * channels + channel] ?? 0;
        }
        input /= channels;
      }
      const high = hp.b0 * input + hz1;
      hz1 = hp.b1 * input - hp.a1 * high + hz2;
      hz2 = hp.b2 * input - hp.a2 * high;
      const band = lp.b0 * high + lz1;
      lz1 = lp.b1 * high - lp.a1 * band + lz2;
      lz2 = lp.b2 * high - lp.a2 * band;
      const emphasized = high - PRE_EMPHASIS * previousHigh;
      previousHigh = high;
      const voiced = vp.b0 * emphasized + vz1;
      vz1 = vp.b1 * emphasized - vp.a1 * voiced + vz2;
      vz2 = vp.b2 * emphasized - vp.a2 * voiced;

      subframeSum += band * band;
      subframeCount += 1;
      decimationSum += voiced;
      decimationCount += 1;
      if (decimationCount === decimation) {
        this.ring[this.ringPosition & RING_MASK] = decimationSum / decimation;
        this.ringPosition += 1;
        decimationSum = 0;
        decimationCount = 0;
      }
      if (subframeCount === subframeSamples) {
        this.endSubframe(subframeSum / subframeCount);
        subframeSum = 0;
        subframeCount = 0;
      }
    }

    this.previousHigh = previousHigh;
    this.hz1 = hz1;
    this.hz2 = hz2;
    this.lz1 = lz1;
    this.lz2 = lz2;
    this.vz1 = vz1;
    this.vz2 = vz2;
    this.subframeSum = subframeSum;
    this.subframeCount = subframeCount;
    this.decimationSum = decimationSum;
    this.decimationCount = decimationCount;
    return this.speechInChunk;
  }

  private configure(sampleRate: number, channels: number) {
    this.sampleRate = sampleRate;
    this.channels = Math.max(1, channels);
    this.highPass = biquad("high", HIGH_PASS_HZ, sampleRate);
    this.lowPass = biquad(
      "low",
      Math.min(LOW_PASS_HZ, sampleRate * 0.42),
      sampleRate,
    );
    this.voicingLowPass = biquad(
      "low",
      Math.min(VOICING_LOW_PASS_HZ, sampleRate * 0.42),
      sampleRate,
    );
    this.previousHigh = 0;
    this.hz1 = this.hz2 = this.lz1 = this.lz2 = this.vz1 = this.vz2 = 0;
    this.subframeSamples = Math.max(1, Math.round((sampleRate * SUBFRAME_MS) / 1000));
    this.subframeSum = 0;
    this.subframeCount = 0;
    this.decimation = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE_HZ));
    this.analysisRate = sampleRate / this.decimation;
    this.decimationSum = 0;
    this.decimationCount = 0;
    this.ringPosition = 0;
    this.subframeIndex = 0;
    this.floorReady = false;
    this.rising = false;
    this.dipDb = Number.POSITIVE_INFINITY;
    this.syllables = [];
  }

  private endSubframe(meanSquare: number) {
    const db = Math.max(
      SILENCE_DBFS,
      10 * Math.log10(meanSquare / (32_768 * 32_768) + 1e-12),
    );
    const index = this.subframeIndex;
    this.subframeIndex += 1;
    this.envelope[index & ENVELOPE_MASK] = db;
    this.envelopeEnd[index & ENVELOPE_MASK] = this.ringPosition;

    const floor = this.floorReady ? this.floorDb : db;
    if (!this.floorReady) {
      this.floorDb = db;
      this.floorReady = true;
    } else if (db < this.floorDb) {
      this.floorDb += (db - this.floorDb) * FLOOR_FALL;
    } else {
      this.floorDb += Math.min(
        db - this.floorDb,
        (FLOOR_RISE_DB_PER_SECOND * SUBFRAME_MS) / 1000,
      );
    }

    // Peaks and dips with hysteresis: every peak found stands at least
    // PROMINENCE_DB over the dips on both sides.
    if (this.rising) {
      if (db > this.peakDb) {
        this.peakDb = db;
        this.peakIndex = index;
        this.peakFloorDb = floor;
      } else if (db <= this.peakDb - PROMINENCE_DB) {
        this.considerSyllable(this.peakIndex, this.peakDb, this.peakFloorDb);
        this.rising = false;
        this.dipDb = db;
      }
    } else if (db < this.dipDb) {
      this.dipDb = db;
    } else if (db >= this.dipDb + PROMINENCE_DB) {
      this.rising = true;
      this.peakDb = db;
      this.peakIndex = index;
      this.peakFloorDb = floor;
    }
  }

  private considerSyllable(index: number, peakDb: number, floorDb: number) {
    if (peakDb < MIN_LEVEL_DBFS || peakDb < floorDb + OVER_FLOOR_DB) return;
    const width = this.peakWidth(index, peakDb);
    if (width < MIN_WIDTH_SUBFRAMES || width > MAX_WIDTH_SUBFRAMES) return;
    if (this.voicing(this.envelopeEnd[index & ENVELOPE_MASK] ?? 0) < MIN_VOICING) {
      return;
    }

    const rhythmSubframes = RHYTHM_WINDOW_MS / SUBFRAME_MS;
    this.syllables = this.syllables.filter((at) => index - at <= rhythmSubframes);
    this.syllables.push(index);
    const windowSubframes = SYLLABLE_WINDOW_MS / SUBFRAME_MS;
    const recent = this.syllables.filter((at) => index - at <= windowSubframes);
    if (recent.length >= MIN_SYLLABLES && !this.isRhythmic()) {
      this.speechInChunk = true;
    }
  }

  private peakWidth(index: number, peakDb: number): number {
    const threshold = peakDb - WIDTH_DB;
    const oldest = Math.max(0, this.subframeIndex - ENVELOPE_SIZE);
    let width = 1;
    for (let at = index - 1; at >= oldest; at -= 1) {
      if ((this.envelope[at & ENVELOPE_MASK] ?? SILENCE_DBFS) < threshold) break;
      width += 1;
    }
    for (let at = index + 1; at < this.subframeIndex; at += 1) {
      if ((this.envelope[at & ENVELOPE_MASK] ?? SILENCE_DBFS) < threshold) break;
      width += 1;
    }
    return width;
  }

  /** Best normalized autocorrelation at a pitch lag, ending at `end`. */
  private voicing(end: number): number {
    const rate = this.analysisRate;
    const lagMin = Math.max(2, Math.floor(rate / PITCH_MAX_HZ));
    const lagMax = Math.ceil(rate / PITCH_MIN_HZ);
    const window = Math.round((rate * VOICING_WINDOW_MS) / 1000);
    const length = window + lagMax + 1;
    const start = end - length;
    if (start < 0 || this.ringPosition - start > RING_SIZE) return 0;
    if (this.scratch.length < length) this.scratch = new Float32Array(length);
    const samples = this.scratch;
    for (let offset = 0; offset < length; offset += 1) {
      samples[offset] = this.ring[(start + offset) & RING_MASK] ?? 0;
    }

    let head = 0;
    for (let offset = 0; offset < window; offset += 1) {
      head += (samples[offset] ?? 0) ** 2;
    }
    if (head <= 0) return 0;
    let tail = 0;
    for (let offset = lagMin; offset < lagMin + window; offset += 1) {
      tail += (samples[offset] ?? 0) ** 2;
    }

    let best = 0;
    for (let lag = lagMin; lag <= lagMax; lag += 1) {
      let product = 0;
      for (let offset = 0; offset < window; offset += 1) {
        product += (samples[offset] ?? 0) * (samples[offset + lag] ?? 0);
      }
      if (tail > 0) best = Math.max(best, product / Math.sqrt(head * tail));
      tail +=
        (samples[lag + window] ?? 0) ** 2 - (samples[lag] ?? 0) ** 2;
    }
    return best;
  }

  private isRhythmic(): boolean {
    const count = this.syllables.length;
    if (count < RHYTHM_MIN_INTERVALS + 1) return false;
    const intervals: number[] = [];
    for (let at = 1; at < count; at += 1) {
      intervals.push((this.syllables[at] ?? 0) - (this.syllables[at - 1] ?? 0));
    }
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    if (mean <= 0) return true;
    const variance =
      intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      intervals.length;
    return Math.sqrt(variance) / mean < RHYTHM_MAX_VARIATION;
  }
}
