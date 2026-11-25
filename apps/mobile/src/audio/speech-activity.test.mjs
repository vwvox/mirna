import assert from "node:assert/strict";
import test from "node:test";

import { SpeechActivity } from "./speech-activity.ts";

const RATE = 16_000;
const BUFFER_SAMPLES = 1_600; // 100 ms, like the recorder's buffers

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gaussian(next) {
  const u = Math.max(next(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

const dbfs = (db) => 32_768 * 10 ** (db / 20);

function whiteNoise(seconds, db, seed = 1) {
  const next = random(seed);
  const amplitude = dbfs(db);
  return Float64Array.from({ length: Math.round(seconds * RATE) }, () =>
    gaussian(next) * amplitude,
  );
}

/** Brown (1/f²) noise, like wind on a microphone. */
function brownNoise(seconds, db, seed = 2) {
  const next = random(seed);
  const out = new Float64Array(Math.round(seconds * RATE));
  let value = 0;
  let power = 0;
  for (let index = 0; index < out.length; index += 1) {
    value = value * 0.999 + gaussian(next);
    out[index] = value;
    power += value * value;
  }
  const scale = dbfs(db) / Math.sqrt(power / out.length);
  return out.map((sample) => sample * scale);
}

/** Bursts of band-limited noise at irregular times: a phone rubbing in a pocket. */
function rubbing(seconds, db, seed = 3) {
  const next = random(seed);
  const out = new Float64Array(Math.round(seconds * RATE));
  const amplitude = dbfs(db);
  let at = 0;
  let previous = 0;
  while (at < out.length) {
    const length = Math.round((0.1 + next() * 0.3) * RATE);
    for (let offset = 0; offset < length && at + offset < out.length; offset += 1) {
      const envelope = Math.sin((Math.PI * offset) / length) ** 2;
      const white = gaussian(next);
      const band = white - previous; // tilt it up, like cloth on a mic
      previous = white;
      out[at + offset] = band * amplitude * envelope;
    }
    at += length + Math.round((0.05 + next() * 0.4) * RATE);
  }
  return out;
}

/** Footsteps: a low thump and a click about twice a second. */
function footsteps(seconds, db, seed = 4) {
  const next = random(seed);
  const out = new Float64Array(Math.round(seconds * RATE));
  const amplitude = dbfs(db);
  for (let step = 0.2; step < seconds; step += 0.52 + (next() - 0.5) * 0.02) {
    const start = Math.round(step * RATE);
    const thumpHz = 70 + next() * 80;
    for (let offset = 0; offset < 0.08 * RATE; offset += 1) {
      const t = offset / RATE;
      const thump = Math.sin(2 * Math.PI * thumpHz * t) * Math.exp(-t / 0.02);
      const click = offset < 0.004 * RATE ? gaussian(next) * 0.6 : 0;
      if (start + offset < out.length) out[start + offset] += (thump + click) * amplitude;
    }
  }
  return out;
}

/** Wind that swells and fades every second or two. */
function gustyWind(seconds, db, seed = 5) {
  const wind = brownNoise(seconds, db, seed);
  return wind.map((sample, index) => {
    const t = index / RATE;
    const swell = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.6 * t + Math.sin(2 * Math.PI * 0.17 * t));
    return sample * swell;
  });
}

/** A steady harmonic hum, like a fridge or an engine. */
function hum(seconds, db) {
  const amplitude = dbfs(db);
  return Float64Array.from({ length: Math.round(seconds * RATE) }, (_, index) => {
    const t = index / RATE;
    let value = 0;
    for (let harmonic = 1; harmonic <= 12; harmonic += 1) {
      value += Math.sin(2 * Math.PI * 100 * harmonic * t) / harmonic;
    }
    return value * amplitude * 0.5;
  });
}

/** A beep every second, the same every time. */
function beeps(seconds, db) {
  const amplitude = dbfs(db);
  return Float64Array.from({ length: Math.round(seconds * RATE) }, (_, index) => {
    const t = index / RATE;
    const phase = t % 1;
    if (phase > 0.15) return 0;
    const envelope = Math.sin((Math.PI * phase) / 0.15) ** 2;
    return Math.sin(2 * Math.PI * 880 * t) * amplitude * envelope;
  });
}

/**
 * Speech-like sound: voiced syllables with a wandering pitch and formant-ish
 * harmonics, grouped into phrases with pauses between them.
 */
function speech(seconds, db, seed = 6, basePitch = 130) {
  const next = random(seed);
  const out = new Float64Array(Math.round(seconds * RATE));
  const amplitude = dbfs(db);
  let at = Math.round(0.3 * RATE);
  while (at < out.length) {
    const syllablesInPhrase = 3 + Math.floor(next() * 6);
    for (let syllable = 0; syllable < syllablesInPhrase && at < out.length; syllable += 1) {
      const length = Math.round((0.12 + next() * 0.14) * RATE);
      const pitch = basePitch * (0.85 + next() * 0.4);
      const formant1 = 400 + next() * 500;
      const formant2 = 1_100 + next() * 1_200;
      const loudness = 0.5 + next() * 0.5;
      const glide = (next() - 0.5) * 0.12;
      let phase = 0;
      for (let offset = 0; offset < length && at + offset < out.length; offset += 1) {
        const progress = offset / length;
        const envelope = Math.sin(Math.PI * progress) ** 1.5;
        // A gentle glide over the syllable, with a little jitter.
        const f0 =
          pitch * (1 + glide * (progress - 0.5)) * (1 + 0.01 * (next() - 0.5));
        phase += (2 * Math.PI * f0) / RATE;
        let value = 0;
        for (let harmonic = 1; harmonic * f0 < 3_600; harmonic += 1) {
          const frequency = harmonic * f0;
          const weight =
            1 / (1 + ((frequency - formant1) / 150) ** 2) +
            0.5 / (1 + ((frequency - formant2) / 200) ** 2) +
            0.05;
          value += weight * Math.sin(harmonic * phase);
        }
        out[at + offset] = value * amplitude * envelope * loudness * 0.4;
      }
      at += length + Math.round((0.04 + next() * 0.12) * RATE);
    }
    at += Math.round((0.3 + next() * 0.5) * RATE);
  }
  return out;
}

function mix(...signals) {
  const length = Math.min(...signals.map((signal) => signal.length));
  return Float64Array.from({ length }, (_, index) =>
    signals.reduce((sum, signal) => sum + signal[index], 0),
  );
}

function toInt16(signal) {
  return Int16Array.from(signal, (sample) =>
    Math.max(-32_768, Math.min(32_767, Math.round(sample))),
  );
}

/** Seconds (by buffer) in which speech was heard. */
function speechBuffers(signal, detector = new SpeechActivity()) {
  const pcm = toInt16(signal);
  const heard = [];
  for (let start = 0; start + BUFFER_SAMPLES <= pcm.length; start += BUFFER_SAMPLES) {
    if (detector.push(pcm.subarray(start, start + BUFFER_SAMPLES), RATE, 1)) {
      heard.push(start / RATE);
    }
  }
  return heard;
}

test("hears speech-like syllables in a quiet room", () => {
  const heard = speechBuffers(mix(speech(20, -28), whiteNoise(20, -62)));
  assert.ok(heard.length >= 8, `heard speech in ${heard.length} buffers`);
  assert.ok(heard[0] < 3, `first heard at ${heard[0]} s`);
});

test("hears a higher voice too", () => {
  const heard = speechBuffers(mix(speech(20, -30, 11, 210), whiteNoise(20, -60)));
  assert.ok(heard.length >= 8, `heard speech in ${heard.length} buffers`);
});

test("hears speech over steady background noise", () => {
  const heard = speechBuffers(mix(speech(30, -30, 7), whiteNoise(30, -46, 8)));
  assert.ok(heard.length >= 5, `heard speech in ${heard.length} buffers`);
});

test("hears speech over wind", () => {
  const heard = speechBuffers(mix(speech(30, -30, 9), brownNoise(30, -32, 10)));
  assert.ok(heard.length >= 5, `heard speech in ${heard.length} buffers`);
});

test("hears quiet, distant speech", () => {
  const heard = speechBuffers(mix(speech(30, -48, 12), whiteNoise(30, -66, 13)));
  assert.ok(heard.length >= 5, `heard speech in ${heard.length} buffers`);
});

test("hears speech while walking", () => {
  const heard = speechBuffers(
    mix(speech(30, -30, 14), footsteps(30, -22, 15), whiteNoise(30, -60, 16)),
  );
  assert.ok(heard.length >= 5, `heard speech in ${heard.length} buffers`);
});

test("hears speech at 48 kHz in stereo", () => {
  const mono = mix(speech(20, -28, 17), whiteNoise(20, -62, 18));
  // Upsample by repeating samples: crude, but keeps the pitch and envelope.
  const stereo = new Int16Array(mono.length * 3 * 2);
  const source = toInt16(mono);
  for (let index = 0; index < source.length * 3; index += 1) {
    const sample = source[Math.floor(index / 3)];
    stereo[index * 2] = sample;
    stereo[index * 2 + 1] = sample;
  }
  const detector = new SpeechActivity();
  let heard = 0;
  const chunk = 4_800 * 2;
  for (let start = 0; start + chunk <= stereo.length; start += chunk) {
    if (detector.push(stereo.subarray(start, start + chunk), 48_000, 2)) heard += 1;
  }
  assert.ok(heard >= 8, `heard speech in ${heard} buffers`);
});

for (const [name, signal] of [
  ["digital silence", new Float64Array(60 * RATE)],
  ["a quiet room", whiteNoise(60, -62)],
  ["loud steady noise", whiteNoise(60, -20)],
  ["noise that starts suddenly", mix(whiteNoise(60, -65), Float64Array.from({ length: 60 * RATE }, (_, index) => (index > 10 * RATE ? 1 : 0) * gaussian(random(index)) * dbfs(-25)))],
  ["wind", brownNoise(60, -20)],
  ["gusty wind", gustyWind(60, -18)],
  ["a phone rubbing in a pocket", rubbing(60, -24)],
  ["footsteps", mix(footsteps(60, -16), whiteNoise(60, -60))],
  ["footsteps in the wind", mix(footsteps(60, -18), gustyWind(60, -24, 21))],
  ["a steady hum", mix(hum(60, -30), whiteNoise(60, -60))],
]) {
  test(`does not take ${name} for speech`, () => {
    assert.deepEqual(speechBuffers(signal), []);
  });
}

test("stops taking regular beeps for speech once they keep time", () => {
  const heard = speechBuffers(mix(beeps(60, -24), whiteNoise(60, -60)));
  assert.ok(
    heard.every((second) => second < 10),
    `still heard at ${heard.join(", ")} s`,
  );
});

test("hears speech again after a long quiet stretch", () => {
  const detector = new SpeechActivity();
  assert.deepEqual(speechBuffers(mix(brownNoise(120, -30, 30), whiteNoise(120, -55, 31)), detector), []);
  const heard = speechBuffers(mix(speech(20, -30, 32), whiteNoise(20, -55, 33)), detector);
  assert.ok(heard.length >= 5, `heard speech in ${heard.length} buffers`);
});

test("accepts buffers that don't line up with its frames", () => {
  const pcm = toInt16(mix(speech(20, -28, 40), whiteNoise(20, -62, 41)));
  const detector = new SpeechActivity();
  const next = random(42);
  let heard = 0;
  for (let start = 0; start < pcm.length; ) {
    const length = 200 + Math.floor(next() * 3_000);
    if (detector.push(pcm.subarray(start, start + length), RATE, 1)) heard += 1;
    start += length;
  }
  assert.ok(heard >= 5, `heard speech in ${heard} chunks`);
});
