# Battle audio

BattleScreen dispatches sound when each structured battle timeline phase starts. Move descriptions and translated display names do not select sound recipes. All 847 current moves have a sound profile; 84 moves have authored recipes, and the rest combine a type motif with an attack archetype and a deterministic pitch/rhythm signature.

## Sound assets and events

`public/assets/audio/battle/retro/` contains 29 original, generated effects: one motif for each of the 19 supported types (including Stellar), plus ball throw, ball open, recall, faint, healing, stat increase/decrease, ailment, barrier and miss sounds. These combine with the existing local samples and the existing Pokémon cries. See `ASSET_CREDITS.md` and `public/assets/audio/battle/CREDITS.md` for provenance.

- Attack launch and impact use different layers. Effectiveness, critical hits and multihit metadata affect the impact sound.
- Switching out plays the recall effect. Switching in plays the ball throw/open effects followed by that Pokémon's cry. An already fainted Pokémon does not play a recall effect.
- Fainting uses a slower cry and descending effect. Entrance and faint sounds briefly lower the music level.
- Opening encounters include all active Pokémon, including double/triple battles.
- Healing, charging, barriers, failed attacks and residual damage receive appropriate sound cues. Zero-damage upkeep does not play a hurt sound.

## Playback behavior

Disabling attack animations retains attack/impact/result sounds. Fast animation modes compress sound timing and limit samples to the current phase. Duplicate phase IDs do not replay; cues without an ID still work.

The controller resumes Web Audio on pointer, keyboard or touch input. Every sound source and deferred cry callback belongs to a playback generation. Advancing to another phase stops obsolete effects; mute and teardown also stop UI sounds, warning timers, pending intro music and stale cry callbacks. A controller can be reused after React StrictMode cleanup without accepting old fetch/decode results.

Move and lifecycle effects are local assets. Pokémon cries retain their existing PokeAPI source. If a cry is not ready within 120 ms, a synthesized cry plays at the entrance/faint timing; a late download is cached for a later cue without playing over the next action. Failed sample loads retain synthesized move effects. Existing master/music/UI/effects/cries volume settings continue to apply.

## Reproduction and validation

```powershell
npm run generate:battle-sounds
npm run validate:battle-audio
npm run build
```

The generator has no external dependencies and writes deterministic, faded, peak-normalized 22,050 Hz mono PCM WAVs. The 29 files total approximately 528 KiB.

`validate:battle-audio` checks all move profiles, actual cue metadata equivalence, translation independence, special/fallback moves and asset references. Its Web Audio harness then checks all 847 moves with and without loaded samples, source timing, lifecycle sounds, mute/teardown, asynchronous cry cancellation, multi-Pokémon introductions and audio unlocking. It also validates audio headers, duration, amplitude and tail silence. Browser checks should additionally confirm actual AudioContext output after a user gesture.

API references: [Web Audio autoplay and user gestures](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), [stopping scheduled sound sources](https://developer.mozilla.org/en-US/docs/Web/API/AudioScheduledSourceNode/stop).
