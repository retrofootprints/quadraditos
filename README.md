# Swatch Pixelator

Turn any photo into a paint-by-grid pattern that uses **only the inks, paints, markers or pencils you own**. Colours are never mixed.

A static, offline-capable web app (TypeScript + Preact + Vite). No backend, no analytics, no runtime network requests. Everything runs on the device. Built first for Safari on iPhone. The full requirements are in [SPEC.md](SPEC.md).

**Live app:** https://retrofootprints.github.io/quadraditos/

## What it does

- **Palettes**: photograph or scan a sheet of painted swatches. Blobs are detected automatically (tap to add, fix, split, merge or delete), sampled from their eroded cores, and saved as a preset. Keep several presets (per paper or medium), reorder them, edit codes, flag the paper colour, and back up or restore them as JSON.
- **Studio**: pick or take a photo, crop it, "Fit to palette", adjust it, pick a grid size, and every cell is matched to the nearest enabled palette colour (ΔE2000 in CIELAB, averaged in linear light). Optional dithering, simplify and minimum-patch cleanup. Export a colour grid, a paint-by-code sheet or a plain pixel image as PNG, and share it to Photos.

## Install on an iPhone

1. Open the live app URL in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Open it once while online. After that it works in airplane mode.

Installing matters: Safari can clear the site data of ordinary web pages after about 7 days without a visit. The installed app keeps your palettes. Use **Palettes → Export** now and then for a backup anyway.

To save an export: **Studio → Export → Render PNG → Save / share → Save Image**.

## Local development

Requires Node 20+.

```sh
npm install
npm run dev        # http://localhost:5173/quadraditos/
npm test           # unit tests for everything in src/core
npm run typecheck
npm run build      # type-checks, then builds to dist/
npm run preview    # serve the production build (service worker included)
npm run icons      # regenerate the PNG icons in public/
```

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`: install, test, build, deploy to GitHub Pages. Vite's `base` is set from the repository name (`/quadraditos/`); override with the `BASE_PATH` environment variable if the repo is renamed. In the repository settings, **Pages → Source** must be **GitHub Actions**.

## Layout

```
src/
  config.ts        every default threshold, radius and slider range
  core/            pure, DOM-free, unit-tested algorithms
                   color, adjust, pixelate, match, dither, cleanup, pipeline,
                   detect, regionGrow, sample, crop, exportLayout, exportRender, palette
  worker/          Web Worker (decode, detect, pixelate, match, export) + job-id protocol
  storage/         IndexedDB (idb), JSON backup, signals store
  ui/palettes/     preset list, palette editor, swatch extractor, re-sampler
  ui/studio/       loader, crop, adjustments, grid, views, export
tests/             Vitest, synthetic fixtures (generated sheets with known blob colours)
```

## Tuning

All numbers from the spec are starting points and live in [`src/config.ts`](src/config.ts). Matching is behind one distance function (`makeDistance` in `src/core/color.ts`), so new metrics are a one-place change.

**Hidden debug panel:** tap the version number (bottom right) five times. It shows the last detection mask (grey = foreground, green = eroded core), timings and the config in force.

### Where this differs from the spec, and why

- **Adjustments run on the cell grid, not the 2048 px image.** Brightness, contrast, warmth, hue, saturation and levels are point operations in Lab, applied to each cell's averaged colour. That keeps slider changes well inside the 100 ms budget. The *Adjusted* view still applies them per pixel to the preview. *Detail* (unsharp mask) is a local filter and does run on the working image, cached until it changes.
- **Value priority** is a lightness *weight*: kL = 1 / priority, so higher values keep light and dark more faithfully.
- **Crop** moves a fixed-aspect window with a drag and a zoom slider rather than free-form corner handles.
- **Extra detection guards:** a region is rejected if less than 60% of it is real foreground before hole-filling, or if its sampled colour matches the paper. This stops bold lettering whose counters fill in from becoming a "swatch".

### Not yet verified

Timing targets (100 ms slider response, 300 ms detection) and the Home Screen / airplane-mode behaviour could not be measured on a physical iPhone 15 Pro from the development machine. Detection takes about 270 ms on a 1024 px sheet in Node on a desktop CPU, and the app was exercised end to end in desktop Chrome. Real-sheet fixtures (one scan, one phone photo) are still wanted for tuning.
