import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44_100;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "public", "assets", "audio");
const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const envelope = (time, duration, attack = .01, release = .12) => {
  const fadeIn = clamp(time / Math.max(.001, attack), 0, 1);
  const fadeOut = clamp((duration - time) / Math.max(.001, release), 0, 1);
  return Math.sin(Math.min(fadeIn, fadeOut) * Math.PI / 2) ** 2;
};
const hash = (text) => [...text].reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16_777_619) >>> 0, 2_166_136_261);
const randomSource = (seed) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4_294_967_296;
  };
};
const makeBuffer = (duration) => new Float64Array(Math.ceil(duration * SAMPLE_RATE));

function addTone(buffer, {
  start = 0, duration, frequency, endFrequency = frequency, gain,
  attack = .008, release = .12, phase = 0, harmonics = [1],
}) {
  const first = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const count = Math.min(buffer.length - first, Math.ceil(duration * SAMPLE_RATE));
  let angle = phase;
  for (let index = 0; index < count; index += 1) {
    const time = index / SAMPLE_RATE;
    const progress = time / duration;
    const currentFrequency = frequency * ((endFrequency / frequency) ** progress);
    angle += TAU * currentFrequency / SAMPLE_RATE;
    let sample = 0;
    harmonics.forEach((weight, harmonicIndex) => {
      sample += Math.sin(angle * (harmonicIndex + 1)) * weight;
    });
    buffer[first + index] += sample * gain * envelope(time, duration, attack, release);
  }
}

function addFilteredNoise(buffer, {
  seed, start = 0, duration, gain, attack = .002, release = .08,
  lowpass = 1_800, highpass = 0,
}) {
  const random = randomSource(seed);
  const first = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const count = Math.min(buffer.length - first, Math.ceil(duration * SAMPLE_RATE));
  const lowAlpha = 1 - Math.exp(-TAU * lowpass / SAMPLE_RATE);
  const highAlpha = highpass > 0 ? Math.exp(-TAU * highpass / SAMPLE_RATE) : 0;
  let low = 0;
  let high = 0;
  let previousLow = 0;
  for (let index = 0; index < count; index += 1) {
    const time = index / SAMPLE_RATE;
    const noise = random() * 2 - 1;
    low += lowAlpha * (noise - low);
    high = highAlpha * (high + low - previousLow);
    previousLow = low;
    buffer[first + index] += (highpass > 0 ? high : low) * gain * envelope(time, duration, attack, release);
  }
}

function addThump(buffer, { start = 0, duration = .16, frequency = 115, gain = .2 }) {
  addTone(buffer, {
    start, duration, frequency, endFrequency: frequency * .48, gain,
    attack: .002, release: duration * .82, harmonics: [1, .16, .04],
  });
}

function addChime(buffer, { start = 0, frequency, gain = .12, duration = .3 }) {
  addTone(buffer, {
    start, duration, frequency, gain, attack: .006, release: duration * .9,
    harmonics: [1, .18, .04],
  });
  addTone(buffer, {
    start: start + .006, duration: duration * .78, frequency: frequency * 2.01,
    gain: gain * .16, attack: .004, release: duration * .72, harmonics: [1],
  });
}

function finish(buffer, targetPeak) {
  const dc = buffer.reduce((sum, value) => sum + value, 0) / Math.max(1, buffer.length);
  const highpassAlpha = Math.exp(-TAU * 20 / SAMPLE_RATE);
  let high = 0;
  let previous = 0;
  let peak = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const shaped = Math.tanh((buffer[index] - dc) * 1.08);
    high = highpassAlpha * (high + shaped - previous);
    previous = shaped;
    buffer[index] = high;
    peak = Math.max(peak, Math.abs(buffer[index]));
  }
  const scale = peak > 0 ? targetPeak / peak : 0;
  const edgeSamples = Math.min(Math.floor(.008 * SAMPLE_RATE), Math.floor(buffer.length / 2));
  for (let index = 0; index < buffer.length; index += 1) {
    const edge = Math.min(1, index / Math.max(1, edgeSamples), (buffer.length - index - 1) / Math.max(1, edgeSamples));
    buffer[index] *= scale * Math.max(0, edge);
  }
  return buffer;
}

function wavBytes(samples) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28);
  bytes.writeUInt16LE(bytesPerSample, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    bytes.writeInt16LE(Math.round(clamp(samples[index], -1, 1) * 32_767), 44 + index * 2);
  }
  return bytes;
}

const recipes = {
  "ui-purchase": { duration: .28, peak: .34, render(buffer) {
    addChime(buffer, { frequency: 523.25, gain: .15, duration: .22 });
    addChime(buffer, { start: .055, frequency: 659.25, gain: .105, duration: .2 });
  } },
  "ui-refresh": { duration: .3, peak: .29, render(buffer, seed) {
    addFilteredNoise(buffer, { seed, start: .01, duration: .2, gain: .12, attack: .025, release: .1, lowpass: 2_300, highpass: 520 });
    addTone(buffer, { start: .025, duration: .2, frequency: 330, endFrequency: 440, gain: .07, attack: .02, release: .1, harmonics: [1, .08] });
  } },
  "ui-deploy": { duration: .25, peak: .34, render(buffer, seed) {
    addThump(buffer, { frequency: 132, gain: .19 });
    addFilteredNoise(buffer, { seed, duration: .1, gain: .14, lowpass: 900, release: .075 });
    addTone(buffer, { start: .022, duration: .17, frequency: 264, endFrequency: 236, gain: .045, release: .14, harmonics: [1] });
  } },
  "ui-sell": { duration: .32, peak: .31, render(buffer) {
    addChime(buffer, { frequency: 587.33, gain: .12, duration: .24 });
    addChime(buffer, { start: .065, frequency: 392, gain: .085, duration: .22 });
  } },
  "ui-wave-start": { duration: .62, peak: .38, render(buffer, seed) {
    addThump(buffer, { duration: .3, frequency: 92, gain: .19 });
    addFilteredNoise(buffer, { seed, start: .025, duration: .32, gain: .095, attack: .04, release: .2, lowpass: 1_100 });
    addChime(buffer, { start: .11, frequency: 220, gain: .095, duration: .42 });
    addChime(buffer, { start: .23, frequency: 329.63, gain: .075, duration: .34 });
  } },
  "ui-merge": { duration: .55, peak: .35, render(buffer) {
    [392, 523.25, 659.25].forEach((frequency, index) => addChime(buffer, { start: index * .07, frequency, gain: .105 - index * .012, duration: .36 }));
  } },
  "ui-level-up": { duration: .72, peak: .36, render(buffer) {
    [261.63, 329.63, 392, 523.25].forEach((frequency, index) => addChime(buffer, { start: index * .085, frequency, gain: .09, duration: .4 }));
  } },
  "ui-freeze": { duration: .34, peak: .27, render(buffer, seed) {
    addFilteredNoise(buffer, { seed, start: .02, duration: .22, gain: .065, attack: .035, release: .16, lowpass: 3_200, highpass: 1_100 });
    addChime(buffer, { frequency: 493.88, gain: .075, duration: .28 });
    addChime(buffer, { start: .035, frequency: 739.99, gain: .045, duration: .24 });
  } },
  "combat-attack": { duration: .14, peak: .23, render(buffer, seed) {
    addThump(buffer, { duration: .09, frequency: 145, gain: .12 });
    addFilteredNoise(buffer, { seed, duration: .07, gain: .1, lowpass: 1_350, highpass: 180, release: .06 });
  } },
  "combat-cast": { duration: .38, peak: .27, render(buffer, seed) {
    addFilteredNoise(buffer, { seed, duration: .27, gain: .055, attack: .06, release: .14, lowpass: 3_100, highpass: 750 });
    addTone(buffer, { duration: .3, frequency: 392, endFrequency: 587.33, gain: .085, attack: .04, release: .15, harmonics: [1, .11] });
    addChime(buffer, { start: .105, frequency: 783.99, gain: .04, duration: .22 });
  } },
  "combat-block": { duration: .2, peak: .31, render(buffer, seed) {
    addThump(buffer, { duration: .15, frequency: 104, gain: .17 });
    addFilteredNoise(buffer, { seed, duration: .12, gain: .13, lowpass: 720, release: .1 });
  } },
  "combat-leak": { duration: .7, peak: .37, render(buffer, seed) {
    addThump(buffer, { duration: .42, frequency: 82, gain: .2 });
    addFilteredNoise(buffer, { seed, duration: .38, gain: .08, attack: .03, release: .28, lowpass: 750 });
    addTone(buffer, { start: .08, duration: .46, frequency: 220, endFrequency: 110, gain: .09, attack: .025, release: .28, harmonics: [1, .1] });
  } },
  "history-event": { duration: .76, peak: .31, render(buffer, seed) {
    addFilteredNoise(buffer, { seed, duration: .44, gain: .055, attack: .08, release: .25, lowpass: 1_650, highpass: 420 });
    [261.63, 392, 523.25].forEach((frequency, index) => addChime(buffer, { start: .08 + index * .1, frequency, gain: .075, duration: .42 }));
  } },
  "history-ideology": { duration: .78, peak: .32, render(buffer) {
    [329.63, 415.3, 493.88].forEach((frequency, index) => addChime(buffer, { start: index * .09, frequency, gain: .08, duration: .5 }));
    addTone(buffer, { start: .24, duration: .42, frequency: 164.81, gain: .04, attack: .08, release: .3, harmonics: [1] });
  } },
  "boss-arrival": { duration: 1, peak: .4, render(buffer, seed) {
    addFilteredNoise(buffer, { seed, duration: .7, gain: .13, attack: .025, release: .46, lowpass: 430 });
    addThump(buffer, { duration: .62, frequency: 67, gain: .22 });
    addTone(buffer, { start: .12, duration: .7, frequency: 98, endFrequency: 73.42, gain: .095, attack: .07, release: .42, harmonics: [1, .12] });
  } },
  "boss-phase": { duration: .66, peak: .36, render(buffer, seed) {
    addFilteredNoise(buffer, { seed, duration: .42, gain: .1, attack: .02, release: .3, lowpass: 630 });
    addTone(buffer, { duration: .5, frequency: 146.83, endFrequency: 92.5, gain: .14, attack: .018, release: .34, harmonics: [1, .15] });
  } },
  "result-wave-clear": { duration: .72, peak: .32, render(buffer) {
    [329.63, 415.3, 493.88].forEach((frequency, index) => addChime(buffer, { start: index * .085, frequency, gain: .075, duration: .42 }));
  } },
  "result-victory": { duration: 1.35, peak: .38, render(buffer) {
    [261.63, 329.63, 392, 523.25, 659.25].forEach((frequency, index) => addChime(buffer, { start: index * .105, frequency, gain: .09 - index * .006, duration: .65 }));
    addTone(buffer, { start: .42, duration: .75, frequency: 130.81, gain: .045, attack: .1, release: .55, harmonics: [1] });
  } },
  "result-defeat": { duration: 1.15, peak: .32, render(buffer, seed) {
    addFilteredNoise(buffer, { seed, duration: .55, gain: .045, attack: .08, release: .36, lowpass: 620 });
    [220, 174.61, 130.81].forEach((frequency, index) => addTone(buffer, { start: index * .13, duration: .62, frequency, endFrequency: frequency * .94, gain: .075 - index * .01, attack: .035, release: .46, harmonics: [1, .09] }));
  } },
};

mkdirSync(OUTPUT, { recursive: true });
const report = [];
for (const [name, recipe] of Object.entries(recipes)) {
  const buffer = makeBuffer(recipe.duration);
  recipe.render(buffer, hash(name));
  finish(buffer, recipe.peak);
  writeFileSync(resolve(OUTPUT, `${name}.wav`), wavBytes(buffer));
  let peak = 0;
  let energy = 0;
  let dc = 0;
  let low = 0;
  let highEnergy = 0;
  const lowAlpha = 1 - Math.exp(-TAU * 4_000 / SAMPLE_RATE);
  for (const value of buffer) {
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
    dc += value;
    low += lowAlpha * (value - low);
    highEnergy += (value - low) ** 2;
  }
  const rms = Math.sqrt(energy / buffer.length);
  const highRatio = energy > 0 ? highEnergy / energy : 0;
  const dcOffset = dc / buffer.length;
  if (peak > .401 || rms > .14 || highRatio > .24 || Math.abs(dcOffset) > .002) {
    throw new Error(`${name} failed comfort gate: peak=${peak}, rms=${rms}, highRatio=${highRatio}, dc=${dcOffset}`);
  }
  report.push(`${name}.wav\t${recipe.duration.toFixed(2)}s\tpeak ${peak.toFixed(3)}\trms ${rms.toFixed(3)}\thigh ${highRatio.toFixed(3)}\tdc ${dcOffset.toFixed(6)}`);
}
writeFileSync(resolve(OUTPUT, "TECHNICAL_REPORT.txt"), `${report.join("\n")}\n`, "utf8");
process.stdout.write(`${report.join("\n")}\n`);
