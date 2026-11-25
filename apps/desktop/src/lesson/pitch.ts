/**
 * Pitch tracking for tone practice: an autocorrelation estimate per frame, sampled
 * from a live audio graph so neither the teacher's clip nor the student's recording
 * has to be decoded whole.
 */

const MIN_HZ = 70;
const MAX_HZ = 500;
const SILENCE_RMS = 0.01;
const FRAME_MS = 30;
const YIN_THRESHOLD = 0.15;

/**
 * The pitch of one frame by YIN: the lag where the frame best repeats itself,
 * taking the first clear dip rather than the deepest one so a voice isn't read
 * an octave low.
 */
export function estimatePitch(
  samples: Float32Array,
  sampleRate: number,
): number | null {
  let rms = 0;
  for (const sample of samples) rms += sample * sample;
  rms = Math.sqrt(rms / samples.length);
  if (rms < SILENCE_RMS) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(
    Math.floor(sampleRate / MIN_HZ),
    Math.floor(samples.length / 2),
  );
  if (maxLag <= minLag) return null;
  const width = samples.length - maxLag;
  const normalized = new Float32Array(maxLag + 1);
  normalized[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < width; i++) {
      const delta = samples[i]! - samples[i + lag]!;
      sum += delta * delta;
    }
    running += sum;
    normalized[lag] = running === 0 ? 1 : (sum * lag) / running;
  }

  let lag = -1;
  for (let candidate = minLag; candidate <= maxLag; candidate++) {
    if (normalized[candidate]! < YIN_THRESHOLD) {
      while (
        candidate + 1 <= maxLag &&
        normalized[candidate + 1]! < normalized[candidate]!
      ) {
        candidate++;
      }
      lag = candidate;
      break;
    }
  }
  if (lag === -1) return null;

  // Between samples: fit a parabola through the dip and its neighbours.
  const before = normalized[lag - 1] ?? normalized[lag]!;
  const after = normalized[lag + 1] ?? normalized[lag]!;
  const bend = before + after - 2 * normalized[lag]!;
  const shift = bend > 0 ? (before - after) / (2 * bend) : 0;
  return sampleRate / (lag + shift);
}

/**
 * Cleans a run of pitch frames: pulls octave slips back to the voice's own
 * range, drops voiced blips too short to be a syllable and smooths the rest.
 */
export function smoothPitch(hz: Array<number | null>): Array<number | null> {
  const voiced = hz
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (voiced.length === 0) return hz.map(() => null);
  const median = voiced[Math.floor(voiced.length / 2)]!;
  const fixed = hz.map((value) => {
    if (value === null) return null;
    if (value > median * 1.8) return value / 2;
    if (value < median * 0.55) return value * 2;
    return value;
  });

  // Voiced stretches shorter than three frames are clicks or breath.
  const kept = [...fixed];
  let runStart = -1;
  for (let i = 0; i <= kept.length; i++) {
    const voicedHere = i < kept.length && kept[i] !== null;
    if (voicedHere && runStart === -1) runStart = i;
    if (!voicedHere && runStart !== -1) {
      if (i - runStart < 3) kept.fill(null, runStart, i);
      runStart = -1;
    }
  }

  return kept.map((value, index) => {
    if (value === null) return null;
    const window = kept
      .slice(Math.max(0, index - 2), index + 3)
      .filter((item): item is number => item !== null)
      .sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)]!;
  });
}

/** Pitch in semitones around the speaker's own median, so voices of any range compare. */
export function toRelativeContour(
  hz: Array<number | null>,
): Array<number | null> {
  const voiced = hz
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (voiced.length === 0) return hz.map(() => null);
  const median = voiced[Math.floor(voiced.length / 2)]!;
  return hz.map((value) =>
    value === null ? null : 12 * Math.log2(value / median),
  );
}

/** Drops leading and trailing silence so two contours line up at the voice. */
export function trimSilence(values: Array<number | null>) {
  const first = values.findIndex((value) => value !== null);
  if (first === -1) return [];
  let last = values.length - 1;
  while (last > first && values[last] === null) last--;
  return values.slice(first, last + 1);
}

export type PitchSampler = {
  /** The frames so far, for stopping on its own after the voice ends. */
  frames: () => ReadonlyArray<number | null>;
  stop: () => Array<number | null>;
};

function sampleFrom(context: AudioContext, source: AudioNode): PitchSampler {
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  const frames: Array<number | null> = [];
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    frames.push(estimatePitch(buffer, context.sampleRate));
  }, FRAME_MS);
  return {
    frames: () => frames,
    stop: () => {
      window.clearInterval(timer);
      source.disconnect(analyser);
      return frames;
    },
  };
}

let sharedContext: AudioContext | null = null;
function audioContext() {
  sharedContext ??= new AudioContext();
  if (sharedContext.state === "suspended") void sharedContext.resume();
  return sharedContext;
}

/** Plays a stretch of an audio file and returns its pitch frames. */
export async function samplePlayedClip(
  url: string,
  startMs: number,
  endMs: number,
): Promise<Array<number | null>> {
  const context = audioContext();
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.src = url;
  await new Promise<void>((resolve, reject) => {
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(new Error("audio")), {
      once: true,
    });
  });
  const source = context.createMediaElementSource(audio);
  source.connect(context.destination);
  audio.currentTime = startMs / 1000;
  const sampler = sampleFrom(context, source);
  await audio.play();
  await new Promise((resolve) =>
    window.setTimeout(resolve, Math.max(300, endMs - startMs)),
  );
  audio.pause();
  const frames = sampler.stop();
  source.disconnect();
  return frames;
}

export type MicRecording = PitchSampler;

/** Starts listening to the microphone; throws when the webview may not use it. */
export async function startMicPitch(): Promise<MicRecording> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("unavailable");
  }
  // Echo cancelling and noise suppression bend the pitch, so they stay off.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const context = audioContext();
  const source = context.createMediaStreamSource(stream);
  const sampler = sampleFrom(context, source);
  return {
    frames: sampler.frames,
    stop: () => {
      const frames = sampler.stop();
      for (const track of stream.getTracks()) track.stop();
      return frames;
    },
  };
}
