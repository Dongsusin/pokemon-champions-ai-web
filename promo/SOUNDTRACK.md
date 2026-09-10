# Trailer soundtrack

`Choose Your Moment` is an original instrumental composed for the 96-second game advertisement. It uses no third-party samples, existing recordings, or Pokemon themes. Every drum, bass note, pad, melodic note, and transition is synthesized by the checked-in JavaScript generator.

```powershell
node promo/scripts/generateSoundtrack.mjs
```

The generator writes `promo/generated/soundtrack.wav` and an adjacent JSON report. The WAV is stereo 16-bit PCM at 44,100 Hz, exactly 96 seconds. An optional `--out=path.wav` argument changes the output; `--sample-rate=48000` renders directly at video-friendly 48 kHz. The score has a fixed random seed, so repeated runs with the same sample rate produce the same PCM audio.

The arrangement uses 120 BPM, 48 bars in 4/4, and D minor with major-seventh and added-ninth voicings. The main pulse combines electronic kick, layered snare/clap, hats, bass, FM plucks, stereo pads, chord stabs, and a short original lead motif. A dotted-eighth echo and small diffusion reverb create space. The mix leaves space for actual battle effects.

| Time | Section | Musical direction |
| --- | --- | --- |
| 0–8 s | Opening | Sparse signal, arpeggio, building pulse |
| 8–24 s | Pokemon roster | Full groove, first melodic entrance |
| 24–38 s | AI rivals | Harmonic tension and lead response |
| 38–50 s | Items and team building | Lighter arrangement and lower plucks |
| 50–80 s | Gimmicks | Stronger rhythm, rising density, transition accents |
| 80–90 s | Battle climax | Densest drums and strongest melodic layer |
| 90–96 s | Closing title | Final cadence, resolved chord at 94 s, complete fade |

The generated track is normalized to −1.5 dBFS sample peak after gentle saturation and DC removal. The 44.1 kHz output measures approximately −15.98 dBFS RMS, with no clipped frames. RMS is a waveform measurement, **not** an integrated LUFS measurement. The final video mix should be checked after adding gameplay audio and any final loudness normalization.
