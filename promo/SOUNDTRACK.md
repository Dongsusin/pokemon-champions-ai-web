# Trailer soundtrack

The **132-second (2:12)** edit uses the same battle music as the live web game: **“Face The Champion!” by Spring Spring**. The existing local file is `public/assets/audio/battle/battle-theme.ogg`, referenced by `src/battleAudio.js`. The edit retains the complete Pokédex, trainer and item montages and four walls of nine recaptured gimmick battles, and adds competition and achievement sequences. It ends with `pokemon-champions-area-web.co.kr`. Final output measurements belong to the newly generated `output/validation.json`, not this edit specification.

## Source and attribution

- Title: **Face The Champion!**
- Creator: **Spring Spring**
- Original source: [OpenGameArt — Face The Champion!](https://opengameart.org/content/face-the-champion)
- Selected license: [Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/)
- Existing local source: Ogg Vorbis, 44,100 Hz, stereo, approximately 359.31 seconds.
- Local source SHA-256: `5f9e9bbea3a3ce9023e13c148808787264365e673e99cbd7fc2addccc71f6540`

The creator's source page offers CC BY 3.0. The trailer uses that license and credits the title, creator, source, license, and edits. The project is an unofficial fan game; the music credit does not imply the creator endorses it.

The preview page and `output/champions-arena-promo-credits.txt` carry the distribution credit and unofficial fan-game notice. Removing small production captions from the video does not remove this attribution. Include the text file's credit in the video description or alongside the MP4 when sharing it.

> Music: “Face The Champion!” by Spring Spring. Licensed under CC BY 3.0. Source: https://opengameart.org/content/face-the-champion — License: https://creativecommons.org/licenses/by/3.0/ . Edited for this trailer: first 132 seconds excerpted, fades, resampling, loudness adjustment, and ducking/mixing with game effects.

## Edit and mix

The soundtrack preparation script reads the repository's existing music file without downloading another recording. It derives the duration from `timeline.json`, extracts **0–132 seconds**, applies a **0.25-second fade-in** and a **1.75-second fade-out** at the end, and writes **48,000 Hz stereo PCM**. The music is normalized in two passes toward **−18 LUFS integrated** before effects are mixed.

Gameplay effects and Pokemon cries remain from the captured Web Audio output. The capture entry point sets game music to zero so the continuous soundtrack is not layered over another audible battle track. During final mixing, gameplay effects trigger music ducking, and the complete mix targets **−16 LUFS integrated**. The resulting output is measured separately; actual loudness and true peak are recorded in `output/validation.json` and `generated/final-audio-analysis.txt`.

Each of the 13 incoming scene transitions lasts **0.4 seconds**. Visual transitions vary by the incoming `timeline.json` entry; effects use continuous audio crossfades at the same boundaries. Outgoing handles preserve the full 132-second timeline. The double-battle picture and effects both use the same 2.4-second source offset, and gimmick walls use only their central hero clip's effects rather than layering nine battle tracks.

Run from the repository root:

```powershell
node promo/scripts/prepareWebSoundtrack.mjs
node promo/scripts/renderTrailer.mjs
node promo/scripts/validateTrailer.mjs
```

The preparation step writes `promo/generated/soundtrack.wav` and `promo/generated/soundtrack.json`. Regenerate the picture edit after changes to footage, timing or transitions. Only when `promo/generated/picture-lock.mp4` matches the current visual edit may you replace just the final audio mix:

```powershell
node promo/scripts/prepareWebSoundtrack.mjs
node promo/scripts/renderTrailer.mjs --audio-only
node promo/scripts/validateTrailer.mjs
```

## Archived original instrumental

The earlier original battle score and its deterministic synthesis generator remain available for reference, but that score is **not used in the current video**. Generate it under a separate name to preserve the active soundtrack:

```powershell
node promo/scripts/generateSoundtrack.mjs --out=promo/generated/original-soundtrack.wav
```

The archived generator uses no third-party music recordings or sound fonts. Its original arrangement and measurements do not describe the current web-game soundtrack or the new final mix.
