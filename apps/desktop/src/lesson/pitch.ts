/**
 * Pitch tracking for tone practice: an autocorrelation estimate per frame, sampled
 * from a live audio graph so neither the teacher's clip nor the student's recording
 * has to be decoded whole.
 */

const MIN_HZ = 70;
const MAX_HZ = 500;
const SILENCE_RMS = 0.01;
const FRAME_MS = 30;

export function estimatePitch(
  samples: Float32Array,
  sampleRate: number,
): number | null {
  let rms = 0;
  for (const sample of samples) rms += sample * sample;
  rms = Math.sqrt(rms / samples.length);
  if (rms < SILENCE_RMS) return null;

  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), samples.length - 1);
  let bestLag = -1;
  let best = 0;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i]! * samples[i]!;
  if (energy === 0) return null;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < samples.length; i++) {
      sum += samples[i]! * samples[i + lag]!;
    }
    const normalized = sum / energy;
    if (normalized > best) {
      best = normalized;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || best < 0.3) return null;
  return sampleRate / bestLag;
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

export type MicRecording = {
  stop: () => Array<number | null>;
};

/** Starts listening to the microphone; throws when the webview may not use it. */
export async function startMicPitch(): Promise<MicRecording> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("unavailable");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const context = audioContext();
  const source = context.createMediaStreamSource(stream);
  const sampler = sampleFrom(context, source);
  return {
    stop: () => {
      const frames = sampler.stop();
      for (const track of stream.getTracks()) track.stop();
      return frames;
    },
  };
}
