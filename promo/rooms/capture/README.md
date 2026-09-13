# Battle rooms gameplay capture

Run from the repository root:

```powershell
node promo/rooms/capture/capture.mjs
```

This opens an isolated Vite server on loopback port 5289 and records the shipped BattleRoomsScreen and BattleScreen. The API is the actual rankedHttp/rankedService/battleRoomService and ranked battle engine, backed by a fresh memory store. Four local filming identities authenticate against that server. No production accounts, saves, databases, or matchmaking services are used. The renderer entry uses a clean game header without test controls.

The seven 1920 × 1080, 30 fps MP4 clips and their full WebM source recordings are written to `promo/rooms/generated/footage/`. Each clip has more than 0.5 seconds of clean footage beyond its editorial duration. Green source markers identify trim points and are excluded from the MP4 clips.

All teams contain six catalog-derived, server-canonicalized Pokémon with legal loadouts. The capture runs a four-person league and a genuine three-person tournament with a bye. Both battle formats execute a real damaging turn, including Dynamax in doubles and Mega Evolution in singles. Genuine API forfeits settle other fixtures for filming setup; the manifest records them explicitly. HP, results, brackets, and standings are never injected or fabricated.

The capture checks every visible HTML image and SVG sprite at the start and end of each shot. It permits public static sprite CDNs, blocks unrelated external traffic, and records the audit. Observation hooks read UI/battle state without changing game behavior.

`manifest.json` records source Git SHA, per-file SHA-256 hashes, API results, before/after battle states, and clip timings. `sourceGameWorkingTreeChanged` covers game files under `src/` and `server/`; `sourceCaptureWorkingTreeChanged` separately covers the filming entry. The combined legacy `sourceWorkingTreeChanged` may therefore be true while the actual game source is clean. File hashes are checked again after filming to detect source changes during capture.
