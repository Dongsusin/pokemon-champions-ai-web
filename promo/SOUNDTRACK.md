# Trailer soundtrack

`Break the Limit` is an original, aggressive battle instrumental composed for the 84-second game advertisement. Revision 3 keeps the established battle instruments and melody while fitting the shorter edit, including its opening banner and trainer-image montage. It uses no third-party samples, existing recordings, or Pokemon themes. Every drum, bass note, riff, melodic note, and transition is synthesized by the checked-in JavaScript generator.

```powershell
node promo/scripts/generateSoundtrack.mjs
```

The generator writes `promo/generated/soundtrack.wav` and an adjacent JSON report. The WAV is stereo 16-bit PCM at 44,100 Hz, exactly 84 seconds. An optional `--out=path.wav` argument changes the output; `--sample-rate=48000` renders directly at video-friendly 48 kHz. The score has a fixed random seed, so repeated runs with the same sample rate produce the same PCM audio.

The arrangement uses **160 BPM, 56 bars in 4/4**, and a D minor tonal center with the Phrygian E-flat creating a recurring challenge motif. Short, syncopated, distorted power chords and bass drive the rhythm. Sixteenth-note staccato string/synth patterns, a repeating four-bar competitive lead theme, clipped brass stabs, double-kick pickups, snare cracks, tom fills, ride cymbals, and metallic impacts provide the battle character. Eighth-note lead echoes and a short room keep the faster articulation clear.

| Time | Section | Musical direction |
| --- | --- | --- |
| 0–6 s | Opening banner | Immediate metallic hit, urgent low riff and string pulse |
| 6–14 s | Pokemon roster | Full four-bar battle theme over syncopated power chords |
| 14–28 s | AI trainer images | Strong flat-second tension and altered lead responses |
| 28–42 s | Items and team building | Tighter, lower-register tactical riff; drum build |
| 42–68 s | Gimmicks | Full battle drop, returning lead and increasingly dense percussion |
| 68–78 s | Battle climax | Double-kick pickups, doubled upper strings, ride and strongest lead |
| 78–84 s | Closing title | Heavy final cadence at 82.5 s, complete endpoint fade |

A brief 0.32-second suspense break at **41.68–42 s** creates room before the gimmick drop, which lands on an exact bar boundary. The later climax begins on the 67.5-second downbeat and continues across the 68-second double-battle cut; there is no forced silence at that off-grid visual edit. Additional impacts are placed at the editorial timestamps while the instrumental phrases stay on the 160 BPM grid.

The generated track is normalized to **−1.5 dBFS sample peak** after bus saturation and DC removal. The 44.1 kHz output measures **−15.00 dBFS RMS**, with **0 clipped frames**. FFmpeg loudness analysis measures the unmodified source at **−13.87 LUFS integrated**, **−1.48 dBTP true peak**, and **4.60 LU loudness range**. These are the music-source values; the final video must be measured separately after gameplay effects, ducking, and final loudness normalization. The final fade reaches exact digital silence.
