/**
 * BREAK THE LIMIT — original battle-trailer score, revision 2.
 * 160 BPM, 64 bars, 96 seconds. D minor with Phrygian flat-second tension.
 * All instruments and notes are original synthesis; no recordings or borrowed themes.
 * node promo/scripts/generateSoundtrack.mjs [--out=path.wav] [--sample-rate=48000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const out = path.resolve(args.out || path.join(here, '../generated/soundtrack.wav'));
const SR = Number(args['sample-rate'] || 44100);
if (!/\.wav$/i.test(out)) throw new Error('The output path must end in .wav');
if (!Number.isInteger(SR) || SR < 22050 || SR > 96000) throw new Error('Sample rate must be between 22050 and 96000');
const DURATION = 96;
const BPM = 160;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const TAU = Math.PI * 2;
const N = Math.round(SR * DURATION);
const left = new Float32Array(N);
const right = new Float32Array(N);
const echoLeft = new Float32Array(N);
const echoRight = new Float32Array(N);
const roomLeft = new Float32Array(N);
const roomRight = new Float32Array(N);
const events = {};
let seed = 0x19b04e3f;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const unit = v => Math.max(0, Math.min(1, v));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const mod = (v, period) => ((v % period) + period) % period;

function voice(start, duration, render, { gain = 1, pan = 0, echo = 0, room = 0, kind = 'other' } = {}) {
  if (start < 0 || start >= DURATION) return;
  events[kind] = (events[kind] || 0) + 1;
  const from = Math.round(start * SR);
  const count = Math.min(N - from, Math.ceil(duration * SR));
  const gl = Math.cos((pan + 1) * Math.PI / 4) * gain;
  const gr = Math.sin((pan + 1) * Math.PI / 4) * gain;
  for (let i = 0; i < count; i++) {
    const sample = render(i / SR, i);
    const j = from + i;
    left[j] += sample * gl;
    right[j] += sample * gr;
    if (echo) { echoLeft[j] += sample * gl * echo; echoRight[j] += sample * gr * echo; }
    if (room) { roomLeft[j] += sample * gl * room; roomRight[j] += sample * gr * room; }
  }
}

// Harmonic-limited oscillators avoid aliasing in the fast, high-register parts.
function saw(phase) {
  return Math.sin(phase) * .62 + Math.sin(phase * 2) * .23 + Math.sin(phase * 3) * .13
    + Math.sin(phase * 4) * .08 + Math.sin(phase * 5) * .04 + Math.sin(phase * 6) * .025;
}

function kick(at, power = 1) {
  voice(at, .34, t => {
    const phase = TAU * (49 * t + 4.5 * (1 - Math.exp(-t * 39)));
    const body = Math.tanh(Math.sin(phase) * 1.55) * Math.exp(-t * 13);
    const punch = Math.sin(TAU * 145 * t) * Math.exp(-t * 68) * .29;
    const click = (random() * 2 - 1) * Math.exp(-t * 330) * .21;
    return (body + punch + click) * unit(t / .0011);
  }, { gain: .78 * power, kind: 'kick' });
}

function snare(at, power = 1, pan = 0) {
  let prev = 0;
  voice(at, .26, t => {
    const n = random() * 2 - 1;
    const bright = n - prev * .6;
    prev = n;
    const shell = Math.sin(TAU * 181 * t) * .5 + Math.sin(TAU * 329 * t) * .22;
    return (bright * Math.exp(-t * 24) * .72 + shell * Math.exp(-t * 29)) * unit(t / .0009);
  }, { gain: .35 * power, pan, room: .25, kind: 'snare' });
  if (power > .75) {
    voice(at + .011, .09, t => (random() * 2 - 1) * Math.exp(-t * 46) * unit(t / .001),
      { gain: .045 * power, pan: -.6, room: .22, kind: 'snareCrack' });
    voice(at + .019, .09, t => (random() * 2 - 1) * Math.exp(-t * 49) * unit(t / .001),
      { gain: .045 * power, pan: .6, room: .22, kind: 'snareCrack' });
  }
}

function hat(at, power = 1, open = false, pan = 0) {
  let prev = 0;
  voice(at, open ? .15 : .047, t => {
    const n = random() * 2 - 1;
    const high = n - prev;
    prev = n;
    const ring = Math.sin(TAU * 5827 * t) * Math.sin(TAU * 7649 * t);
    return (high * .8 + ring * .2) * Math.exp(-t * (open ? 25 : 92)) * unit(t / .0008);
  }, { gain: .039 * power, pan, kind: 'hat' });
}

function cymbal(at, power = 1, ride = false) {
  let low = 0;
  voice(at, ride ? .35 : 1.6, t => {
    const n = random() * 2 - 1;
    low += .18 * (n - low);
    const metal = Math.sin(TAU * 3271 * t) * Math.sin(TAU * 4549 * t) * .22;
    return ((n - low) * .8 + metal) * Math.exp(-t * (ride ? 15 : 4.2)) * unit(t / .002);
  }, { gain: (ride ? .07 : .12) * power, pan: ride ? .42 : -.3, room: .37, kind: ride ? 'ride' : 'crash' });
}

function tom(at, midi = 43, power = 1, pan = 0) {
  const f = hz(midi);
  voice(at, .55, t => {
    const phase = TAU * (f * t + 1.35 * (1 - Math.exp(-t * 26)));
    const body = Math.sin(phase) * .78 + Math.sin(phase * 1.54) * .22;
    return (body * Math.exp(-t * 10.5) + (random() * 2 - 1) * Math.exp(-t * 75) * .15) * unit(t / .001);
  }, { gain: .31 * power, pan, room: .3, kind: 'tom' });
}

function metalHit(at, power = 1) {
  voice(at, 1.1, t => {
    const clang = Math.sin(TAU * 191 * t) + Math.sin(TAU * 331 * t) * .5
      + Math.sin(TAU * 577 * t) * .35 + Math.sin(TAU * 1069 * t) * .16;
    const attack = (random() * 2 - 1) * Math.exp(-t * 85) * .6;
    return (Math.tanh(clang * 1.3) * Math.exp(-t * 5.7) + attack) * unit(t / .001);
  }, { gain: .21 * power, room: .58, pan: .18, kind: 'metalHit' });
  tom(at, 31, power * .8, -.12);
}

function rise(at, duration, power = 1) {
  let low = 0;
  voice(at, duration, t => {
    const p = t / duration;
    const n = random() * 2 - 1;
    low += (.015 + p * .28) * (n - low);
    const phase = TAU * (75 * t + 480 * t * t / duration);
    const alarm = saw(phase) * (.13 + .08 * Math.sin(TAU * (5 * t + 6 * t * t / duration)));
    return ((n - low) * .8 + alarm) * p ** 1.8 * unit((duration - t) / .025);
  }, { gain: .14 * power, room: .12, pan: -.1, kind: 'riser' });
}

function bass(at, midi, duration, power = 1) {
  const f = hz(midi);
  voice(at, duration + .045, t => {
    const phase = TAU * f * t;
    const sub = Math.sin(phase) * .52;
    const teeth = Math.tanh((Math.sin(phase * 2) + .47 * Math.sin(phase * 4) + .2 * Math.sin(phase * 6)) * 2.3) * .42;
    const env = unit(t / .003) * (t <= duration ? 1 : Math.exp(-(t - duration) * 95));
    const duck = .58 + .42 * unit(mod(at + t, BEAT) / .045);
    return (sub + teeth) * env * duck;
  }, { gain: .29 * power, kind: 'distortedBass' });
}

function powerChord(at, root, duration, power = 1) {
  for (const side of [-1, 1]) {
    const f = hz(root) * (side < 0 ? .9981 : 1.0017);
    voice(at + (side > 0 ? .0025 : 0), duration + .04, t => {
      const phase = TAU * f * t;
      const chord = saw(phase) * .7 + saw(phase * 1.4983) * .5 + saw(phase * 2) * .35;
      const distorted = Math.tanh(chord * 3.4);
      const env = unit(t / .0018) * (t <= duration ? Math.exp(-t * 3.8) : Math.exp(-duration * 3.8 - (t - duration) * 120));
      return distorted * env;
    }, { gain: .125 * power, pan: side * .72, room: .035, kind: 'powerChord' });
  }
}

function strings(at, midi, duration = .078, power = 1, pan = 0) {
  const f = hz(midi);
  voice(at, duration + .07, t => {
    const phase = TAU * f * t;
    const unison = saw(phase) * .57 + saw(phase * 1.004 + .1) * .24 + saw(phase * .996 - .1) * .19;
    const scrape = (random() * 2 - 1) * Math.exp(-t * 135) * .11;
    const env = unit(t / .004) * (t <= duration ? .72 + .28 * Math.exp(-t * 23) : .72 * Math.exp(-(t - duration) * 60));
    return (unison + scrape) * env;
  }, { gain: .106 * power, pan, room: .08, kind: 'stringOstinato' });
}

function brass(at, notes, duration, power = 1) {
  notes.forEach((midi, index) => {
    const f = hz(midi);
    voice(at, duration + .15, t => {
      const phase = TAU * f * t;
      const tone = Math.tanh((saw(phase) + saw(phase * .997) * .37) * 1.35);
      const env = unit(t / .019) * (t <= duration ? .65 + .35 * Math.exp(-t * 7) : .65 * Math.exp(-(t - duration) * 24));
      return tone * env;
    }, { gain: .104 * power, pan: (index - (notes.length - 1) / 2) * .26, room: .17, kind: 'brass' });
  });
}

function lead(at, midi, duration, power = 1, octave = false) {
  const f = hz(midi);
  voice(at, duration + .08, t => {
    const vibrato = Math.sin(TAU * 6.2 * t) * .004 * unit((t - .12) * 8);
    const phase = TAU * f * t + vibrato * f;
    const square = Math.sin(phase) * .59 + Math.sin(phase * 3) * .22 + Math.sin(phase * 5) * .11;
    const edge = saw(phase * 1.002) * .3;
    const env = unit(t / .005) * (t <= duration ? .85 + .15 * Math.exp(-t * 20) : .85 * Math.exp(-(t - duration) * 52));
    return Math.tanh((square + edge) * 1.28) * env;
  }, { gain: .19 * power, pan: .04, echo: .16, room: .13, kind: 'battleLead' });
  if (octave) strings(at, midi - 12, Math.min(duration, .2), .45 * power, -.28);
}

// Four harmonic regions preserve D as the tonal center and use Eb as a challenge motif.
const ROOTS = {
  main: [38, 38, 39, 36, 38, 34, 36, 38],
  rivals: [38, 39, 38, 36, 34, 36, 39, 38],
  tactical: [38, 38, 36, 39, 38, 34, 39, 38],
  climax: [38, 39, 38, 36, 34, 39, 38, 38],
};
const theme = [
  [[0, 74, .30], [1, 74, .11], [1.5, 77, .14], [2, 75, .17], [2.75, 74, .32]],
  [[0, 69, .16], [.75, 74, .16], [1.5, 77, .31], [2.5, 79, .17], [3.25, 81, .23]],
  [[0, 84, .27], [1, 81, .16], [1.75, 79, .17], [2.5, 77, .17], [3.25, 75, .21]],
  [[0, 74, .25], [1, 69, .14], [1.75, 72, .18], [2.5, 75, .14], [3, 74, .30]],
];

for (let bar = 0; bar < 64; bar++) {
  const at = bar * BAR;
  const intro = at < 7.5;
  const rivals = at >= 24 && at < 37.5;
  const tactical = at >= 37.5 && at < 49.5;
  const showcase = at >= 49.5 && at < 79.5;
  const climax = at >= 79.5 && at < 90;
  const ending = at >= 90;
  const pattern = climax ? ROOTS.climax : rivals ? ROOTS.rivals : tactical ? ROOTS.tactical : ROOTS.main;
  const root = pattern[bar % pattern.length];
  const power = intro ? .84 : tactical ? .88 : climax ? 1.18 : showcase ? 1.08 : .98;

  if (bar === 63) {
    // Last downbeat at 94.5 seconds: a heavy resolved D power chord and minor-third lead.
    kick(at, 1);
    metalHit(at, 1.05);
    cymbal(at, .95);
    powerChord(at, 38, .9, 1.25);
    bass(at, 26, .98, 1.05);
    brass(at, [50, 57, 62], .95, .86);
    lead(at, 74, .94, .68);
    continue;
  }

  // Tight syncopated sixteenth-note power chords; all palm-muted envelopes.
  const riff = tactical ? [0, 2, 3, 6, 8, 10, 11, 14] : [0, 2, 3, 5, 6, 8, 10, 11, 14, 15];
  for (const step of riff) {
    const note = step === 14 && bar % 2 === 1 ? 39 : root;
    const accented = step % 4 === 0;
    const duration = (step === 6 || step === 14 ? .112 : .065);
    powerChord(at + step * BEAT / 4, note, duration, power * (accented ? 1 : .77));
    bass(at + step * BEAT / 4, note - 12, duration, power * (accented ? 1 : .77));
  }

  // The urgent orchestral line begins immediately; harmony never opens into soft pads.
  const ostinato = root === 39
    ? [62, 69, 75, 69, 62, 69, 77, 75, 62, 69, 75, 69, 77, 75, 69, 65]
    : root === 34 ? [62, 65, 70, 65, 62, 65, 74, 70, 62, 65, 70, 65, 74, 70, 65, 62]
      : root === 36 ? [60, 67, 72, 67, 60, 67, 75, 72, 60, 67, 72, 67, 75, 72, 67, 63]
        : [62, 69, 74, 69, 62, 69, 77, 74, 62, 69, 74, 69, 77, 75, 74, 69];
  for (let step = 0; step < 16; step++) {
    if (intro && bar < 2 && step % 2 === 1) continue;
    strings(at + step * BEAT / 4, ostinato[step], .060,
      power * (tactical ? .72 : .87) * (step % 4 === 0 ? 1.17 : .85), step % 2 ? .4 : -.4);
    if (climax && step % 2 === 0) strings(at + step * BEAT / 4, ostinato[step] + 12, .066, .32, step % 4 ? -.6 : .6);
  }

  // Rock backbeat, double-kick pickups and rolling orchestral low drums.
  const kicks = tactical ? [0, 1.75, 2, 3.5] : climax ? [0, .5, .75, 1.75, 2, 2.5, 3.25, 3.5] : [0, .75, 1.75, 2, 2.75, 3.5];
  kicks.forEach((beat, i) => kick(at + beat * BEAT, power * (i % 3 === 0 ? 1 : .8)));
  snare(at + BEAT, power);
  snare(at + BEAT * 3, power * .97);
  const hatSteps = climax || showcase && bar % 4 === 3 ? 16 : 8;
  for (let step = 0; step < hatSteps; step++) {
    hat(at + step * BAR / hatSteps, power * (step % 2 ? .54 : .88), step === hatSteps - 2, step % 2 ? .32 : -.32);
  }
  if (bar % 2 === 0) tom(at + BEAT * 2.5, 38, power * .65, -.38);
  if (climax || showcase && bar >= 45) {
    for (let beat = 0; beat < 4; beat++) cymbal(at + BEAT * beat, .52, true);
  }

  // Brass answers the lead with short minor/power stabs, never sustained lounge chords.
  if (bar % 4 === 0 || intro && bar === 1) {
    brass(at, [root + 12, root + 19, root + 24], intro ? .25 : .18, .72 * power);
    brass(at + 2.5 * BEAT, [50, 57, root === 39 ? 63 : 62], .14, .52 * power);
  }
  // Original four-bar competitive theme, introduced early and returned in the battle drop.
  if (bar >= 5 && bar < 16 || bar >= 18 && bar < 25 || bar >= 33 && bar < 53 || climax || ending) {
    const phrase = theme[(bar - 5 + 64) % 4];
    phrase.forEach(([beat, midi, duration]) => {
      const shift = rivals && bar % 4 === 0 && midi === 74 ? 1 : 0;
      lead(at + beat * BEAT, midi + shift, duration, power * (climax ? .93 : ending ? .79 : .76), showcase || climax);
    });
  }
  if (intro) {
    lead(at + .05, bar % 2 ? 75 : 74, .16, .66);
    lead(at + .56, 69, .15, .48);
    if (bar >= 3) lead(at + 1.03, 74 + (bar === 4 ? 1 : 0), .20, .7);
  }
  if (tactical) {
    // Lower, clipped challenge motif maintains urgency under the inventory cut.
    [0, 1.5, 2.5, 3.25].forEach((beat, i) => lead(at + beat * BEAT, [62, 65, 63, 62][i], .10, .55));
  }
  if (bar % 4 === 3) {
    [0, .125, .25].forEach((offset, i) => tom(at + 1.05 + offset, [48, 43, 38][i], .72 * power, -.4 + i * .4));
  }
}

const sections = [
  { at: 0, until: 8, label: 'Immediate battle hook' },
  { at: 8, until: 24, label: 'Build your roster' },
  { at: 24, until: 38, label: 'Face the rivals' },
  { at: 38, until: 50, label: 'Tactical preparation' },
  { at: 50, until: 80, label: 'Gimmick battle drop' },
  { at: 80, until: 90, label: 'Final battle climax' },
  { at: 90, until: 96, label: 'Victory and title' },
];
metalHit(.01, .85);
cymbal(.01, .85);
for (const time of [8, 24, 38, 50, 58, 66, 74, 80, 90]) {
  metalHit(time, time === 50 || time === 80 ? 1.18 : .7);
  cymbal(time, time === 50 || time === 80 ? 1.2 : .75);
  kick(time, time === 50 || time === 80 ? 1.2 : .7);
}
for (const [time, duration] of [[8, 1.5], [24, 1.5], [38, 1.5], [50, 3], [66, 1.5], [80, 3], [90, 1.5]]) {
  rise(time - duration, duration, time === 50 || time === 80 ? 1.1 : .75);
  const count = time === 50 || time === 80 ? 12 : 6;
  for (let hit = 0; hit < count; hit++) {
    snare(time - .78 + hit * .055, .20 + hit * .024, hit % 2 ? -.13 : .13);
  }
}

// Short eighth-note echoes keep the original theme readable at this faster tempo.
for (const [seconds, gain, cross] of [[BEAT / 2, .45, true], [BEAT, .2, false], [BEAT * 1.5, .08, true]]) {
  const offset = Math.round(seconds * SR);
  for (let i = offset; i < N; i++) {
    left[i] += (cross ? echoRight[i - offset] : echoLeft[i - offset]) * gain;
    right[i] += (cross ? echoLeft[i - offset] : echoRight[i - offset]) * gain;
  }
}
for (const [seconds, feedback, gain, cross] of [[.037, .48, .21, false], [.051, .52, .15, true], [.073, .55, .12, false]]) {
  const offset = Math.round(seconds * SR);
  const ringL = new Float32Array(offset);
  const ringR = new Float32Array(offset);
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < N; i++) {
    const j = i % offset;
    lpL += .4 * (ringL[j] - lpL);
    lpR += .4 * (ringR[j] - lpR);
    ringL[j] = roomLeft[i] + (cross ? lpR : lpL) * feedback;
    ringR[j] = roomRight[i] + (cross ? lpL : lpR) * feedback;
    left[i] += lpL * gain;
    right[i] += lpR * gain;
  }
}

// Two deliberate, very short suspense breaks make the following full drops hit harder.
function suspense(t, from, to) {
  if (t < from || t >= to) return 1;
  const down = 1 - unit((t - from) / .028);
  return .045 + .955 * down;
}
let peak = 0;
let dcL = 0;
let dcR = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = unit(t / .006) * (t > 95.17 ? Math.cos(unit((t - 95.17) / .83) * Math.PI / 2) ** 1.4 : 1);
  const drop = suspense(t, 49.68, 50) * suspense(t, 79.68, 80);
  dcL += .0001 * (left[i] - dcL);
  dcR += .0001 * (right[i] - dcR);
  left[i] = Math.tanh((left[i] - dcL) * 1.34) / 1.34 * fade * drop;
  right[i] = Math.tanh((right[i] - dcR) * 1.34) / 1.34 * fade * drop;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
const gain = 10 ** (-1.5 / 20) / peak;
const buffer = Buffer.alloc(44 + N * 4);
buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
buffer.writeUInt32LE(SR, 24); buffer.writeUInt32LE(SR * 4, 28); buffer.writeUInt16LE(4, 32);
buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(N * 4, 40);
let sumSquares = 0;
let clippedFrames = 0;
const sectionEnergy = sections.map(() => ({ sum: 0, frames: 0 }));
for (let i = 0; i < N; i++) {
  const l = left[i] * gain;
  const r = right[i] * gain;
  const energy = l * l + r * r;
  sumSquares += energy;
  if (Math.abs(l) >= 1 || Math.abs(r) >= 1) clippedFrames++;
  const segment = sections.findIndex(s => i / SR >= s.at && i / SR < s.until);
  if (segment >= 0) { sectionEnergy[segment].sum += energy; sectionEnergy[segment].frames++; }
  // Dither ends with exact silence, preventing a residual last-sample click.
  const ditherL = i < N - 128 ? random() - random() : 0;
  const ditherR = i < N - 128 ? random() - random() : 0;
  buffer.writeInt16LE(clamp(Math.round(l * 32767 + ditherL), -32768, 32767), 44 + i * 4);
  buffer.writeInt16LE(clamp(Math.round(r * 32767 + ditherR), -32768, 32767), 46 + i * 4);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buffer);
const report = {
  title: 'Break the Limit', revision: 2,
  description: 'Urgent battle trailer: 160 BPM distorted power riffs, sixteenth-note strings, martial drums, competitive lead, hard drops.',
  durationSeconds: DURATION, bpm: BPM, bars: 64, meter: '4/4', key: 'D minor / Phrygian flat-second tension',
  sampleRate: SR, channels: 2, bitDepth: 16, peakDbfs: -1.5,
  rmsDbfs: Number((20 * Math.log10(Math.sqrt(sumSquares / (N * 2)))).toFixed(2)), clippedFrames,
  sections: sections.map((section, i) => ({ ...section, rmsDbfs: Number((20 * Math.log10(Math.sqrt(sectionEnergy[i].sum / (sectionEnergy[i].frames * 2)))).toFixed(2)) })),
  suspenseBreaks: [[49.68, 50], [79.68, 80]], finalCadenceAt: 94.5,
  events,
  provenance: 'Original arrangement, melodies, riffs, drums and synthesizers. No third-party samples, recordings or Pokemon themes.',
  file: out,
};
fs.writeFileSync(out.replace(/\.wav$/i, '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
