/**
 * Original 96 second game-trailer score, composed and synthesized for this promo.
 * No samples, third-party recordings, or existing Pokemon melodies are used.
 * Run: node promo/scripts/generateSoundtrack.mjs
 * Optional: --out=absolute/or/relative/path.wav --sample-rate=44100
 * The 48-bar arrangement is 120 BPM in D minor. All generated audio is deterministic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const out = path.resolve(args.out || path.join(here, '../generated/soundtrack.wav'));
const SR = Number(args['sample-rate'] || 44100);
if (!/\.wav$/i.test(out)) throw new Error('The output path must end in .wav');
if (!Number.isInteger(SR) || SR < 22050 || SR > 96000) throw new Error('Sample rate must be an integer between 22050 and 96000');
const DURATION = 96;
const BEAT = 0.5;
const BAR = BEAT * 4;
const TAU = Math.PI * 2;
const N = Math.ceil(SR * DURATION);
const left = new Float32Array(N);
const right = new Float32Array(N);
const delayLeft = new Float32Array(N);
const delayRight = new Float32Array(N);
const roomLeft = new Float32Array(N);
const roomRight = new Float32Array(N);
let seed = 0x2c37a190;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const ease = v => Math.max(0, Math.min(1, v));
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const mod = (a, b) => ((a % b) + b) % b;

function voice(start, duration, render, { gain = 1, pan = 0, delay = 0, room = 0 } = {}) {
  const from = Math.max(0, Math.round(start * SR));
  const count = Math.min(N - from, Math.ceil(duration * SR));
  const gl = Math.cos((pan + 1) * Math.PI / 4) * gain;
  const gr = Math.sin((pan + 1) * Math.PI / 4) * gain;
  for (let i = 0; i < count; i++) {
    const value = render(i / SR, i);
    const idx = from + i;
    left[idx] += value * gl;
    right[idx] += value * gr;
    if (delay) { delayLeft[idx] += value * gl * delay; delayRight[idx] += value * gr * delay; }
    if (room) { roomLeft[idx] += value * gl * room; roomRight[idx] += value * gr * room; }
  }
}

function kick(t, intensity = 1) {
  voice(t, .6, time => {
    const phase = TAU * (47 * time + 5.2 * (1 - Math.exp(-time * 28)));
    const body = Math.sin(phase) * Math.exp(-time * 9.2);
    const tap = (random() * 2 - 1) * Math.exp(-time * 200) * .22;
    return (body + tap) * (1 - Math.exp(-time * 1700));
  }, { gain: .68 * intensity });
}

function snare(t, intensity = 1, pan = .05) {
  let last = 0;
  voice(t, .35, time => {
    const noise = random() * 2 - 1;
    const high = noise - last * .64;
    last = noise;
    return (high * Math.exp(-time * 18) * .57 + Math.sin(TAU * 183 * time) * Math.exp(-time * 25) * .38)
      * (1 - Math.exp(-time * 1100));
  }, { gain: .31 * intensity, pan, room: .24 });
  // A quiet, separated pair gives the main backbeat a hand-clap width.
  if (intensity > .7) {
    for (const [offset, side] of [[.011, -.35], [.023, .35]]) {
      voice(t + offset, .1, time => (random() * 2 - 1) * Math.exp(-time * 47),
        { gain: .034 * intensity, pan: side, room: .3 });
    }
  }
}

function hat(t, open = false, intensity = 1, pan = -.25) {
  let last = 0;
  voice(t, open ? .25 : .065, time => {
    const noise = random() * 2 - 1;
    const high = noise - last;
    last = noise;
    const metal = Math.sin(TAU * 7610 * time) * Math.sin(TAU * 5931 * time);
    return (high * .7 + metal * .3) * Math.exp(-time * (open ? 15 : 75)) * ease(time * 1500);
  }, { gain: (open ? .047 : .043) * intensity, pan, room: .08 });
}

function crash(t, intensity = 1) {
  let low = 0;
  voice(t, 2.3, time => {
    const noise = random() * 2 - 1;
    low = low * .8 + noise * .2;
    return (noise - low) * Math.exp(-time * 2.8) * ease(time * 150);
  }, { gain: .085 * intensity, pan: -.18, room: .65 });
}

function tom(t, midi, intensity = 1, pan = 0) {
  const frequency = hz(midi);
  voice(t, .5, time => Math.sin(TAU * (frequency * time + .32 * (1 - Math.exp(-time * 28))))
    * Math.exp(-time * 10) * ease(time * 2000), { gain: .21 * intensity, pan, room: .2 });
}

function riser(t, duration, intensity = 1) {
  let low = 0;
  voice(t, duration, time => {
    const p = time / duration;
    const noise = random() * 2 - 1;
    low += (.02 + p * .35) * (noise - low);
    const whistle = Math.sin(TAU * (100 * time + 370 * time * time / duration));
    return ((noise - low) * .7 + whistle * .13) * p ** 2 * ease((duration - time) * 40);
  }, { gain: .09 * intensity, pan: .12, room: .3 });
}

function bass(t, midi, duration, intensity = 1, bright = 1) {
  const f = hz(midi);
  voice(t, duration + .09, time => {
    const env = ease(time / .007) * (time < duration ? 1 : Math.exp(-(time - duration) * 55));
    const decay = .72 + .28 * Math.exp(-time * 9);
    const cutoff = Math.exp(-time * 5);
    const fundamental = Math.sin(TAU * f * time);
    const grit = .28 * Math.sin(TAU * f * 2 * time) + .12 * Math.sin(TAU * f * 3 * time)
      + .09 * Math.sin(TAU * f * 4 * time) * cutoff;
    // Downbeat kick has space without compressor pumping in the melody.
    const duck = .65 + .35 * ease(mod(t + time, BEAT) / .12);
    return (fundamental * .85 + grit * bright) * env * decay * duck;
  }, { gain: .29 * intensity });
}

function pluck(t, midi, duration = .37, intensity = 1, pan = 0) {
  const f = hz(midi);
  voice(t, duration + .3, time => {
    const pm = Math.sin(TAU * f * 2 * time) * 1.45 * Math.exp(-time * 12);
    const tone = Math.sin(TAU * f * time + pm) * .65
      + Math.sin(TAU * f * 2 * time) * .14 * Math.exp(-time * 8)
      + Math.sin(TAU * f * .998 * time) * .21;
    return tone * ease(time / .003) * Math.exp(-time * (duration < .3 ? 10 : 6))
      * ease((duration + .3 - time) * 20);
  }, { gain: .105 * intensity, pan, delay: .42, room: .2 });
}

function pad(t, chord, duration, intensity = 1) {
  chord.forEach((midi, index) => {
    const f = hz(midi);
    const pan = (index / (chord.length - 1) - .5) * 1.15;
    voice(t, duration + .6, time => {
      const env = ease(time / .28) * (time < duration - .12 ? 1 : Math.exp(-(time - duration + .12) * 5.5));
      const flutter = .9 + .1 * Math.sin(TAU * .43 * time + index);
      const wave = Math.sin(TAU * f * time) * .5 + Math.sin(TAU * f * .997 * time + .2) * .22
        + Math.sin(TAU * f * 1.003 * time - .2) * .22 + Math.sin(TAU * f * 2 * time) * .1;
      const duck = .83 + .17 * ease(mod(t + time, BEAT) / .17);
      return wave * env * flutter * duck;
    }, { gain: .08 * intensity, pan, room: .38 });
  });
}

function chordStab(t, chord, intensity = 1) {
  chord.forEach((midi, index) => {
    const f = hz(midi);
    voice(t, .65, time => {
      const tone = Math.sin(TAU * f * time) + .31 * Math.sin(TAU * f * 2 * time)
        + .13 * Math.sin(TAU * f * 3 * time);
      return tone * ease(time / .008) * Math.exp(-time * 8);
    }, { gain: .068 * intensity, pan: (index - 1.5) * .25, delay: .17, room: .25 });
  });
}

function lead(t, midi, duration, intensity = 1, pan = .08) {
  const f = hz(midi);
  voice(t, duration + .24, time => {
    const vibrato = .0024 * Math.sin(TAU * 5.1 * time) * ease((time - .16) * 7);
    const phase = TAU * f * time + vibrato * f;
    const wave = Math.sin(phase) * .6 + Math.sin(phase * 2) * .21 + Math.sin(phase * 3) * .13
      + Math.sin(phase * 4) * .06;
    const env = ease(time / .013) * (time < duration ? 1 : Math.exp(-(time - duration) * 18));
    return wave * env * (.75 + .25 * Math.exp(-time * 7));
  }, { gain: .10 * intensity, pan, delay: .42, room: .22 });
}

const harmony = {
  Dm: { root: 38, chord: [62, 65, 69, 76], arp: [74, 77, 81, 84] },
  Bb: { root: 34, chord: [62, 65, 69, 70], arp: [74, 77, 81, 82] },
  F: { root: 41, chord: [60, 65, 67, 69], arp: [72, 77, 79, 81] },
  C: { root: 36, chord: [60, 64, 67, 74], arp: [72, 76, 79, 86] },
  Gm: { root: 43, chord: [62, 65, 67, 70], arp: [74, 77, 79, 82] },
  A: { root: 33, chord: [61, 64, 67, 69], arp: [73, 76, 79, 81] },
};
const chords = [
  'Dm', 'Bb', 'F', 'C',
  'Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'C',
  'Dm', 'Gm', 'Bb', 'A', 'Dm', 'Bb', 'C',
  'Dm', 'Bb', 'F', 'C', 'Gm', 'A',
  'Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'C', 'Gm', 'Bb', 'A',
  'Dm', 'C', 'Bb', 'A', 'Dm',
  'Bb', 'C', 'Dm',
];
const sections = [
  { at: 0, label: 'Opening signal', bars: [0, 4] },
  { at: 8, label: 'Pokemon roster', bars: [4, 12] },
  { at: 24, label: 'AI rivals', bars: [12, 19] },
  { at: 38, label: 'Items and team craft', bars: [19, 25] },
  { at: 50, label: 'Gimmick showcase', bars: [25, 40] },
  { at: 80, label: 'Battle climax', bars: [40, 45] },
  { at: 90, label: 'Title / invitation', bars: [45, 48] },
];

for (let bar = 0; bar < chords.length; bar++) {
  const time = bar * BAR;
  const h = harmony[chords[bar]];
  const opening = bar < 4;
  const items = bar >= 19 && bar < 25;
  const gimmicks = bar >= 25 && bar < 40;
  const climax = bar >= 40 && bar < 45;
  const ending = bar >= 45;
  const power = opening ? .45 + bar * .12 : items ? .72 : climax ? 1.1 : gimmicks ? 1 : .87;

  pad(time, h.chord, BAR, opening ? .85 : items ? .65 : .82);
  if (bar === 47) {
    // Resolved final D minor, with room for the closing URL and logo.
    chordStab(time, [50, 57, 62, 65, 69], 1.05);
    bass(time, 38, 1.1, .9, .3);
    kick(time, .65);
    lead(time, 74, 1.25, .65);
    crash(time, .55);
    continue;
  }

  const arpPattern = items ? [0, 2, 1, 3, 2, 1, 0, 2] : [0, 2, 1, 3, 0, 1, 2, 1];
  const arpSteps = opening && bar < 2 ? 4 : 8;
  for (let step = 0; step < arpSteps; step++) {
    const at = time + step * (BAR / arpSteps);
    const note = h.arp[arpPattern[step]] - (items ? 12 : 0);
    pluck(at, note, .26, opening ? .8 : items ? .92 : .64,
      (step % 2 ? 1 : -1) * (.18 + step % 3 * .13));
    if (gimmicks && bar >= 33 && step % 2 === 1) {
      pluck(at + BEAT / 4, h.arp[mod(step + 2, 4)], .2, .28, -.35);
    }
  }

  if (opening) {
    bass(time, h.root, 1.5, .65, .4);
    kick(time, .62);
    if (bar >= 2) {
      kick(time + 1, .6);
      snare(time + 1.5, .5);
      for (let step = 0; step < 8; step++) hat(time + step * .25, false, .45, step % 2 ? .3 : -.3);
    }
    continue;
  }

  const bassPattern = items
    ? [[0, 0, .32], [1.5, 12, .19], [2, 0, .31], [3.5, 7, .18]]
    : [[0, 0, .29], [.75, 0, .15], [1.5, 12, .17], [2, 0, .26], [2.75, 0, .16], [3.5, 7, .18]];
  bassPattern.forEach(([beat, interval, duration]) => bass(time + beat * BEAT, h.root + interval, duration, power, .85));

  kick(time, power);
  kick(time + (items ? 1.25 : 1), power * .88);
  if (!items && !ending && bar % 2 === 1) kick(time + 1.75, power * .63);
  if (climax) kick(time + .75, .65);
  snare(time + .5, power);
  snare(time + 1.5, power * .97);
  const hatSteps = climax ? 16 : 8;
  for (let step = 0; step < hatSteps; step++) {
    const offset = step * BAR / hatSteps + (step % 2 ? .006 : 0);
    hat(time + offset, !items && step % 4 === 3 && step < hatSteps - 1,
      power * (step % 2 ? .65 : .9), step % 2 ? .3 : -.3);
  }

  if (!items && (bar < 12 || gimmicks || climax || ending)) {
    chordStab(time + .75, h.chord, power * .62);
    chordStab(time + 1.75, h.chord, power * .48);
  }

  // A two-bar call and response, with section-specific register and endings.
  // Short original motif: scale-degree 5, 7, 6, 3 / 2, 3, 1, 5; no sampled melody.
  if ((bar >= 8 && bar < 19) || (bar >= 29 && bar < 45)) {
    const phrase = bar % 2 === 0
      ? [[0, 0, .43], [1.5, 2, .19], [2, 1, .4], [3.25, 3, .27]]
      : [[.25, 2, .26], [1, 1, .29], [2, 0, .57], [3.5, 2, .14]];
    const line = [h.chord[2] + 12, h.chord[1] + 12, h.chord[3], h.chord[0] + 12];
    phrase.forEach(([beat, index, duration]) => lead(time + beat * BEAT, line[index], duration,
      climax ? .95 : .75, bar % 2 ? -.1 : .1));
  }
  if (ending) {
    lead(time + .1, h.chord[0] + 12, .65, .67);
    lead(time + 1, h.chord[2], .65, .54);
  }
}

// Section starts have a clean cymbal accent; preceding bars build with tasteful fills.
for (const marker of sections.slice(1)) {
  crash(marker.at, marker.at === 50 || marker.at === 80 ? 1 : .7);
  riser(marker.at - (marker.at === 50 ? 4 : 2), marker.at === 50 ? 4 : 2, marker.at === 50 ? 1.2 : .75);
  const fillAt = marker.at - .5;
  tom(fillAt, 55, .75, -.35);
  tom(fillAt + .125, 52, .7, -.05);
  tom(fillAt + .25, 48, .8, .25);
  snare(fillAt + .375, .5, .1);
}
// Mid-showcase pickups punctuate the succession of mechanics without burying gameplay SFX.
for (const time of [58, 66, 74, 84]) crash(time, .43);
for (let hit = 0; hit < 8; hit++) snare(49 + hit * .125, .22 + hit * .035, hit % 2 ? -.1 : .1);

// Stereo dotted-eighth ping-pong echo, four successively quieter taps.
for (const [seconds, gain, cross] of [[.375, .5, true], [.75, .28, false], [1.125, .16, true], [1.5, .09, false]]) {
  const offset = Math.round(seconds * SR);
  for (let i = offset; i < N; i++) {
    left[i] += (cross ? delayRight[i - offset] : delayLeft[i - offset]) * gain;
    right[i] += (cross ? delayLeft[i - offset] : delayRight[i - offset]) * gain;
  }
}

// Small diffusion room. Unequal delays keep the score wide but mono compatible.
for (const [seconds, feedback, gain, cross] of [[.041, .57, .2, false], [.059, .61, .16, true], [.079, .65, .13, false]]) {
  const offset = Math.round(seconds * SR);
  const ringL = new Float32Array(offset);
  const ringR = new Float32Array(offset);
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < N; i++) {
    const slot = i % offset;
    lpL += .35 * (ringL[slot] - lpL);
    lpR += .35 * (ringR[slot] - lpR);
    ringL[slot] = roomLeft[i] + (cross ? lpR : lpL) * feedback;
    ringR[slot] = roomRight[i] + (cross ? lpL : lpR) * feedback;
    left[i] += lpL * gain;
    right[i] += lpR * gain;
  }
}

// Gentle bus saturation, DC removal, equal-power endpoint fade, then peak normalization.
let peak = 0;
let dcL = 0;
let dcR = 0;
for (let i = 0; i < N; i++) {
  const time = i / SR;
  const fade = Math.min(1, time / .018) * (time > 95.05 ? Math.cos(ease((time - 95.05) / .95) * Math.PI / 2) ** 1.35 : 1);
  dcL += .0001 * (left[i] - dcL);
  dcR += .0001 * (right[i] - dcR);
  left[i] = Math.tanh((left[i] - dcL) * 1.28) / 1.28 * fade;
  right[i] = Math.tanh((right[i] - dcR) * 1.28) / 1.28 * fade;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
const targetPeak = 10 ** (-1.5 / 20);
const normalization = targetPeak / peak;
const buffer = Buffer.alloc(44 + N * 4);
buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
buffer.writeUInt32LE(SR, 24); buffer.writeUInt32LE(SR * 4, 28); buffer.writeUInt16LE(4, 32);
buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(N * 4, 40);
let sumSquares = 0;
for (let i = 0; i < N; i++) {
  const l = left[i] * normalization;
  const r = right[i] * normalization;
  sumSquares += l * l + r * r;
  // Quiet triangular dither avoids quantization artifacts in the final tail.
  buffer.writeInt16LE(clamp(Math.round(l * 32767 + random() - random()), -32768, 32767), 44 + i * 4);
  buffer.writeInt16LE(clamp(Math.round(r * 32767 + random() - random()), -32768, 32767), 46 + i * 4);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buffer);
const report = {
  title: 'Choose Your Moment', composer: 'Original synthesis for this game promo',
  durationSeconds: DURATION, bpm: 120, meter: '4/4', key: 'D minor', bars: 48,
  sampleRate: SR, channels: 2, bitDepth: 16, peakDbfs: -1.5,
  rmsDbfs: Number((20 * Math.log10(Math.sqrt(sumSquares / (N * 2)))).toFixed(2)),
  sections, provenance: 'Original notes, arrangement, drums, and synthesizers. No samples or copied melodies.',
  file: out,
};
fs.writeFileSync(out.replace(/\.wav$/i, '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
