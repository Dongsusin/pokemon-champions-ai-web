# Fixed 16:9 game viewport

The top-level document fits the entire game inside the available screen, using
letterboxing instead of cropping. The game runs in a same-origin iframe with a
960×540 compact viewport or a 1600×900 desktop viewport. Both use a 16:9 ratio.
The existing mobile and desktop compositions remain inside those viewports.

`src/main.jsx` mounts the host or loads `src/gameEntry.jsx`, depending on the
iframe's `data-game-frame` marker. The host must not initialize authentication,
resource loading, or React a second time. The original URL, query and hash are
preserved, and resizing updates the same iframe without reloading game state.

This uses a separate browser viewport rather than transforming `#root`: existing
`vh`/`vw` rules, media queries, body portals, native dialogs, animation canvases
and pointer coordinates all remain relative to the same game document.

- `fixedGameViewport.js` computes a contain scale using the visual viewport and
  safe-area insets on touch devices. Desktop uses the containing stage's actual
  dimensions and ignores visual-viewport offsets. A ResizeObserver refits the
  frame when the stage changes. Browser pinch zoom is not counteracted.
- The host displays the portrait rotation guide on touch devices. Rotation is
  manual; returning to landscape preserves the current game.
- `mobileViewport.js` follows the host's intended compact/desktop composition.
- `InstallAppButton.jsx` reads install events and standalone state from the host.
- `resource-worker.js` precaches the bounded graph of lazy hashed JS/CSS chunks,
  so the child app still opens offline. It does not preload the media catalog.
- `gameFrameContent.css` uses the actual desktop header height for the lobby's
  remaining space instead of an assumed 84px header.

## Local verification

```powershell
npm run build
npm run validate:fixed-game-viewport
$env:VIEWPORT_BROWSER = 'webkit'
npm run validate:fixed-game-viewport
Remove-Item Env:VIEWPORT_BROWSER
npm run validate:installable-app
```

The UI check uses real application screens with isolated fixture data and blocks
external account/API requests. It covers seven viewport sizes, touch hit testing,
settings and detail portals, menu navigation, battle controls and rotation. Safe
insets and software-keyboard viewport reduction are simulated. It does not claim
physical-device keyboard or Google sign-in verification.

The fixed viewport was promoted to `main` after deployment was requested.
Automatic Vercel deployments for `codex/fixed-aspect-frame` and the separate
boss-raid development branch remain disabled in `vercel.json`.
