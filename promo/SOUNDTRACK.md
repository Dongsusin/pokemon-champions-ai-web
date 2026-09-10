# Trailer soundtrack

`Break the Limit` is an original, aggressive battle instrumental composed for the 96-second game advertisement. This second score replaces the earlier, calmer `Choose Your Moment` arrangement. It uses no third-party samples, existing recordings, or Pokemon themes. Every drum, bass note, riff, melodic note, and transition is synthesized by the checked-in JavaScript generator.

```powershell
node promo/scripts/generateSoundtrack.mjs
```

The generator writes `promo/generated/soundtrack.wav` and an adjacent JSON report. The WAV is stereo 16-bit PCM at 44,100 Hz, exactly 96 seconds. An optional `--out=path.wav` argument changes the output; `--sample-rate=48000` renders directly at video-friendly 48 kHz. The score has a fixed random seed, so repeated runs with the same sample rate produce the same PCM audio.

The arrangement uses **160 BPM, 64 bars in 4/4**, and a D minor tonal center with the Phrygian E-flat creating a recurring challenge motif. Short, syncopated, distorted power chords and bass drive the rhythm. Sixteenth-note staccato string/synth patterns, a repeating four-bar competitive lead theme, clipped brass stabs, double-kick pickups, snare cracks, tom fills, ride cymbals, and metallic impacts provide the battle character. The previous sustained pads, major-seventh/add-nine harmony, and gentle FM plucks have been removed. Eighth-note lead echoes and a short room keep the faster articulation clear.

| Time | Section | Musical direction |
| --- | --- | --- |
| 0–8 s | Opening | Immediate metallic hit, urgent low riff and string pulse |
| 8–24 s | Pokemon roster | Full four-bar battle theme over syncopated power chords |
| 24–38 s | AI rivals | Strong flat-second tension and altered lead responses |
| 38–50 s | Items and team building | Tighter, lower-register tactical riff; drum build |
| 50–80 s | Gimmicks | Full battle drop, returning lead and increasingly dense percussion |
| 80–90 s | Battle climax | Double-kick pickups, doubled upper strings, ride and strongest lead |
| 90–96 s | Closing title | Heavy final cadence at 94.5 s, complete endpoint fade |

Brief 0.32-second suspense breaks at **49.68–50 s** and **79.68–80 s** create room before the largest impacts. The song remains active from its opening; these breaks are deliberate dramatic punctuation. At 160 BPM, not all visual section boundaries fall on bar starts, so additional impacts are placed at the exact editorial timestamps.

The generated track is normalized to **−1.5 dBFS sample peak** after bus saturation and DC removal. The 44.1 kHz output measures **−14.81 dBFS RMS**, with **0 clipped frames**. FFmpeg loudness analysis measures the unmodified source at **−13.70 LUFS integrated**, **−1.47 dBTP true peak**, and **4.10 LU loudness range**. These are the music-source values; the final video must be measured separately after gameplay effects, ducking, and final loudness normalization. The final fade reaches exact digital silence.
