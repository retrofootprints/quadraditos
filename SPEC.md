# Swatch Pixelator – App Spec

Oct 16, 2026 · @Nuno

## Overview

Swatch Pixelator is a static, offline-capable web app. It turns any photo into a paint-by-grid pattern that uses only the inks, paints, markers or pencils the user owns. Colours are never mixed. It is a personal tool, built first for Safari on an iPhone 15 Pro.

The app has two areas:

- **Palettes**: digitise a sheet of painted swatches into a saved colour preset. A user can keep several presets, such as one per paper or medium.
- **Studio**: take or pick a photo, adjust it, pixelate it to a chosen grid size, and match every cell to the closest colour in the active preset. Then export a grid image to paint from.

**Goals**

- No backend. All processing runs on the device, and the app deploys to GitHub Pages.
- Works offline once added to the Home Screen.
- Multiple saved palette presets, with backup and restore.
- Live preview while sliders move.
- Matching quality can be tuned later without rewriting the pipeline.

**Non-goals**

- Suggesting colour mixes.
- Accounts, sync or cloud storage.
- Support for older or low-end phones. Desktop browsers should work for development, but the UI is designed for mobile first.
- Reading handwritten swatch labels (OCR).

## Platform and tech stack

The stack is a TypeScript PWA built with Vite and deployed to GitHub Pages, with canvas processing in a Web Worker.

| Concern | Choice | Notes |
| --- | --- | --- |
| Target browser | iOS Safari 17+, installed to the Home Screen | Desktop Chrome and Safari work for development |
| Hosting | GitHub Pages | Deploy with a GitHub Actions workflow on every push to `main`. Set Vite's `base` to the repository name |
| Language and build | TypeScript (strict) + Vite |  |
| UI | Preact + `@preact/signals` | Small bundle. Plain CSS with custom properties, no CSS framework |
| PWA | `vite-plugin-pwa` (Workbox) | Generates the manifest and a service worker that precaches the app shell |
| Colour maths | `culori` | sRGB ↔ linear ↔ CIELAB conversions and ΔE2000 |
| Storage | IndexedDB through `idb` | Palettes, swatch-sheet images and settings |
| Image processing | Canvas 2D, typed arrays, `OffscreenCanvas` in a Web Worker | No OpenCV, no ML models |
| Tests | Vitest | Unit tests for every pure algorithm in `src/core` |

The app makes no network calls at runtime and loads nothing from a CDN. Fonts and icons are bundled. There is no analytics.

## App structure

&#91;embedded content: app structure · 2 tabs, 10 steps\]

Palettes and Studio are the two tabs of a bottom tab bar. The only link between them is the active preset, which can be chosen in either tab and is remembered across sessions.

## Data model and storage

Everything is stored in IndexedDB on the device. JSON export is the backup.

```ts
interface PaletteColor {
  id: string;                       // uuid
  name: string;                     // "Indigo – Daniel Smith", editable
  code: string;                     // short label printed on the grid: "A", "B", …
  hex: string;                      // sRGB, "#3a4b7c"
  lab: [number, number, number];    // CIELAB (D65), cached for matching
  enabled: boolean;                 // included in matching
  isPaper?: boolean;                // the unpainted substrate
  sample?: {                        // where it came from, for re-sampling
    cx: number; cy: number;         // tap or blob centre, in sheet-image pixels
    areaPx: number;
    spread: number;                 // std. dev. of ΔE inside the sample
    mode: 'median' | 'masstone' | 'tint';
  };
}

interface Palette {
  id: string;
  name: string;                     // "Kraft paper – gouache"
  substrate?: string;               // paper or card description
  notes?: string;
  colors: PaletteColor[];           // user-defined order
  sheetImageId?: string;            // stored swatch-sheet image
  createdAt: number;
  updatedAt: number;
}

interface Settings {
  activePaletteId?: string;
  studio: StudioSettings;           // last-used grid, adjustment and export values
}
```

IndexedDB stores:

- `palettes`: one `Palette` per preset.
- `images`: the swatch sheet as a JPEG blob, downscaled to 2048 px on the long side, so a palette can be re-opened and edited later.
- `settings`: a single `Settings` record.

Storage rules:

- Call `navigator.storage.persist()` the first time a palette is saved.
- Safari can clear site data after about 7 days without use unless the app is installed to the Home Screen. Show a one-time hint to install it.
- Export one palette, or all of them, as a `.json` file. Embedding the sheet image as base64 is optional. Import merges by `id` and asks before overwriting.

## Palette manager (presets)

The Palettes tab lists every saved preset and lets the user create, edit and pick the active one.

**Preset list**

- Each row shows the name, a strip of colour chips, the colour count and the last-updated date.
- Row actions: open, set as active, duplicate, rename, export JSON, and delete (with a confirmation).
- "New palette" offers two routes: *From swatch sheet*, which opens the extractor, or *Empty*, for manual colours.
- "Import" accepts a `.json` export.
- The active preset is marked, saved in `Settings`, and also selectable from the Studio.

**Palette editor**

- A list of colours, each showing a chip, the editable name, the code, an enabled toggle and a drag handle for reordering.
- Add a colour manually with a hex field or the native colour picker.
- Edit a colour: rename it, change its code, re-sample it from the sheet, or type a hex value.
- Codes are assigned automatically as A, B, C … in list order. The paper colour gets `·`. The user can override any code, and duplicate codes are rejected.
- Warn when two colours are closer than ΔE2000 3, because the matcher will treat them as near-duplicates.

**Paper as a colour**

- One optional colour per palette can be flagged `isPaper`. It is created when the user calibrates the paper in the extractor, or added by hand.
- When enabled, paper is matched like any other colour, and its cells mean "leave unpainted". This matters for coloured paper, kraft paper and cardboard.
- A Studio toggle includes or excludes paper without changing the preset.

## Swatch extractor

The extractor auto-detects the blobs as soon as the sheet loads. The user then corrects the result by tapping: add, fix or delete. Both modes ship in the first version.

The expected input is a scan or photo of one sheet with a blob of each ink, paint, marker or pencil on the target paper. Handwritten labels next to the blobs are allowed.

**1. Load the sheet**

- Load through the same file input as the Studio. Decode with `createImageBitmap`, respect EXIF orientation, and downscale to 2048 px on the long side.
- Detection runs on a 1024 px copy. All coordinates map back to the 2048 px image.
- The view supports pinch-zoom and pan.

**2. Calibrate the paper**

- Auto: estimate the paper colour as the most common colour in a coarse Lab histogram of the image's outer 10% border.
- Manual: "Tap bare paper" re-samples it from a 15 px radius around the tap.
- The result is `paperLab`. It is used for foreground detection and as the optional paper colour.
- White-balance toggle, default **off**. When on, scale the linear-RGB channels so the paper reads neutral. The UI explains when to use it: white paper photographed under warm or cool light. Leave it off for scans and for coloured paper.

**3. Auto-detect**

1. Convert the 1024 px copy to Lab and apply a 5×5 box blur to soften paper texture and granulation.
2. Foreground mask: mark pixels whose ΔE2000 from `paperLab` is above `fgThreshold` (default 12, slider 4–30).
3. Morphological open (radius 2) to remove specks, then close (radius 3) to fill gaps inside blobs.
4. Find connected components (8-connected, union-find).
5. Discard components that:
   - are smaller than `minArea` (default 0.15% of the image area), or
   - vanish after erosion with radius `coreRadius` (default 4 px). This removes handwriting, pencil lines and thin borders.
6. Optional split: if a component's colour spread is high, run k-means with k=2 in Lab. Split it when both clusters hold at least 25% of the pixels and their centroids are more than ΔE 10 apart. This handles blobs that touch. Default on.
7. Sample each remaining component (see Sampling below).

Detection on a 1024 px sheet should finish in under 300 ms on an iPhone 15 Pro.

**4. Tap to add or fix**

- Tap inside an existing blob to select it.
- Tap anywhere else to region-grow from that point on the blurred Lab image:
  - Include a 4-connected neighbour when its ΔE to the region's running mean is below `growTolerance` (default 8, slider 2–25) **and** it is foreground.
  - Stop at 25% of the image area and warn the user.
- New regions go through the same erosion and sampling as auto-detected ones.

**5. Overlay and editing UI**

- Each blob shows its outline in a contrasting colour, plus a numbered badge with a colour chip.
- Selecting a blob opens a bottom sheet with the chip, hex, name field, sampling mode, a tolerance slider (re-grows the region live), Split, Merge-with and Delete.
- Toolbar: Re-detect (keeps manual blobs), Tap-paper, Undo/Redo, and Save.
- Flag blobs whose sample spread is high, for example uneven or granulating paint, with a small warning icon.

**Sampling**

- Use only the eroded core of the region, never the edges.
- Compute the per-channel Lab median. Keep the 60% of pixels closest to the median by ΔE, and average them in Lab. Record the standard deviation as `spread`.
- Sampling mode per swatch:
  - **Median** (default): a typical value.
  - **Masstone**: the darkest 25% of pixels by L\*, for full-strength paint in a graded wash.
  - **Tint**: the lightest 25% of pixels, for a diluted wash.

**6. Save**

- "Save as new palette" asks for a name and substrate. "Add to existing" appends to a chosen preset.
- Colours start as "Swatch 1 … n" in reading order (top-to-bottom rows, then left-to-right). The user renames them in the palette editor.
- "Include paper as a colour" checkbox, default on.
- The sheet image is stored so the palette can be re-opened and re-sampled later.

## Studio: loading and adjusting the photo

The Studio applies an automatic adjustment as soon as a photo loads. Sliders let the user refine it, with the matched result updating live.

**Loading**

- "Choose photo": `<input type="file" accept="image/*">`. iOS offers Photo Library, Take Photo and Files from this one input.
- "Camera": a second input with `capture="environment"` that opens the rear camera directly.
- Decode with `createImageBitmap` and respect EXIF orientation. Safari decodes HEIC natively.
- Downscale to a working image of 2048 px on the long side, and a 1024 px preview. Close the full-size bitmap immediately.

**Crop**

- Optional crop step with aspect presets: Original, 1:1, 4:5, 3:4, 2:3, A-series (1:√2), and Custom.
- Custom takes physical dimensions, such as a 30 × 40 cm canvas. The grid size can then follow from the physical size (see Pixelation).

**Auto adjust ("Fit to palette")** runs on load and from an Auto button:

1. Levels: map the photo's 0.5th and 99.5th percentile of L\* to the palette's darkest and lightest L\*. The paper is usually the lightest. This squeezes the photo into the range the paints can actually reach, which improves matching more than any other step.
2. Contrast: a gentle S-curve if the photo's L\* histogram is narrow.
3. Saturation: scale chroma so the photo's 95th-percentile chroma roughly matches the palette's highest chroma.

Auto only sets slider values, so the user sees and can override everything it did. Reset returns to auto.

**Sliders**, in two groups:

| Slider | Range | Default | Effect |
| --- | --- | --- | --- |
| Brightness | −100 to 100 | 0 | Shifts L\* |
| Contrast | −100 to 100 | 0 | S-curve on L\* around the midpoint |
| Saturation | −100 to 100 | 0 | Scales chroma (LCh) |
| Hue | −180° to 180° | 0° | Rotates hue (LCh) |
| Warmth | −100 to 100 | 0 | Shifts b\* (yellow–blue) and slightly a\* |
| Black point (advanced) | 0 to 50 | auto | Levels: L\* input low |
| White point (advanced) | 50 to 100 | auto | Levels: L\* input high |
| Midtones (advanced) | 0.5 to 2.0 | 1.0 | Gamma on L\* |
| Detail (advanced) | 0 to 100 | 0 | Unsharp mask on the working image before pixelating; helps small features survive |

- Double-tap a slider to reset it.
- Press and hold the image to see the original.
- All adjustments are point operations in Lab or LCh, applied in a fixed order: levels, midtones, brightness, contrast, warmth, hue, saturation. Detail is the exception: it is a local filter, applied first.

**Views** (segmented control above the image): Original · Adjusted · Pixelated (true averaged colours) · Matched (palette colours). Matched is the default after the first load.

## Pixelation and colour matching

Each grid cell is averaged in linear light and then matched to the nearest enabled palette colour by ΔE2000 in CIELAB.

**Grid size**

- Main slider: columns, from 8 to 200 (default 48). Rows follow from the aspect ratio, and cells are square.
- Show the result next to the slider, for example "48 × 64 = 3,072 cells".
- Optional physical mode: enter the canvas width in cm and the cell size in mm, and the column count is computed.

**Pipeline**, run in the worker on every change:

1. Apply the adjustments to the 2048 px working image.
2. Average each cell's source pixels in **linear RGB** (sRGB gamma removed), so edges between light and dark areas average correctly. The cell's pixel range uses fractional bounds, so no pixels are dropped.
3. Cell sampling mode (advanced):
   - **Average** (default).
   - **Median**: crisper edges.
   - **Dominant**: the most common colour after a coarse 4-bit-per-channel quantise. Gives the crispest, most posterised result.
4. Convert each cell to Lab and match it to the nearest enabled palette colour.
5. Apply dithering, if on, and then cleanup (next section).

**Colour space decisions**

- Canvases use the default sRGB colour space. iPhone photos are Display P3 and are converted to sRGB by the canvas, clipping a few very saturated colours. Swatch sheets and photos go through the same path, so matching stays consistent.
- Matching uses CIELAB (D65), computed with `culori`.

**Distance and tuning**

- Default metric: ΔE2000.
- **Value priority** slider (advanced, 0.5 to 2.0, default 1.0) sets the lightness weight kL. Higher values make the match keep light and dark more faithfully than hue, which often reads better in a painting.
- Alternative metrics in an advanced menu: ΔE76 (plain Lab distance) and ΔE2000. Keep the metric behind one function so more can be added during tuning.
- Cache matches in a lookup table keyed by RGB quantised to 6 bits per channel (262,144 entries, filled lazily). Rebuild the table when the palette or metric changes.

**Palette controls in the Studio**

- A horizontal row of chips for the active palette. Tap a chip to toggle that colour for this image only; the preset is not changed.
- A paper toggle.
- A palette switcher.

**Statistics**: show cell count and percentage per colour, sorted by count. Tap a colour to highlight its cells in the preview.

## Dithering and cleanup

Dithering is off by default because scattered single cells are tedious to paint. Cleanup exists to make the grid easier to paint.

**Dithering** (toggle plus mode)

- **Off** (default).
- **Floyd–Steinberg**: error diffusion in Lab with serpentine scanning.
- **Ordered**: a 4×4 Bayer matrix. It gives a regular pattern that is easier to paint than error diffusion.
- **Strength** slider, 0–100% (default 50%), scales the diffused error or the Bayer offset.

**Cleanup**, applied after matching and dithering:

- **Simplify** (0–3 passes, default 0): a majority filter. A cell that matches fewer than two of its 8 neighbours takes the most common neighbour colour; ties go to the colour nearest in ΔE.
- **Minimum patch size** (1–10 cells, default 1): find 4-connected same-colour patches smaller than the minimum and recolour each with the adjacent patch colour nearest in ΔE.

Both run on the small cell grid, so they are effectively instant.

## Export

The main output is a PNG grid that the user can save to Photos through the iOS share sheet and paint from.

**Layouts**

- **Colour grid**: cells filled with palette colours.
- **Paint-by-code**: white cells with the colour code in each, for printing or tracing.
- **Plain pixel image**: the matched image with no lines or labels.

**Options**

- Thin grid lines, on by default.
- A heavier line every 5 or 10 cells for counting (Off, 5 or 10; default 10).
- Row and column numbers along the edges.
- Cell codes printed in black or white, whichever contrasts better with the cell. Off by default for the colour grid. Hidden automatically when cells are smaller than 14 px.
- Legend strip below the grid: chip, code, name and cell count for each colour used. The footer shows palette name, grid size and date.

**Sizing**: choose the cell size in pixels so the longest side is at most 4096 px. A cell is never smaller than 12 px; if both limits cannot be met, warn the user.

**Saving**

- Render to a canvas, then `toBlob('image/png')`.
- If `navigator.canShare({ files })` is true, call `navigator.share` with the PNG. On iOS this offers *Save Image*.
- Otherwise fall back to an `<a download>` link.
- Optional: export the grid as CSV (row, column, code) for use elsewhere.

## Performance and iOS constraints

The working image is capped at 2048 px and all processing runs off the main thread. That is enough for live updates on an iPhone 15 Pro.

**Memory and canvas**

- No canvas may exceed 4096 × 4096 px (iOS Safari limits canvas area).
- Call `ImageBitmap.close()` on bitmaps that are replaced. Free unused canvases by setting their width and height to 0.
- Keep at most one working image and one preview per area in memory.

**Threading and responsiveness**

- One Web Worker does decoding, adjustment, detection, pixelation, matching and export rendering, using `OffscreenCanvas`. Send `ArrayBuffer`s as transferables.
- Each request carries a job id. The worker drops jobs that a newer job has superseded, and the UI ignores stale results.
- Coalesce slider input with `requestAnimationFrame`, so there is at most one job per frame.
- Targets on an iPhone 15 Pro: under 100 ms from a slider change to the updated matched preview at 100 columns, and under 300 ms for auto-detect.

**Touch UI**

- Mobile first. A bottom tab bar holds Palettes and Studio. Controls live in a bottom sheet so the image stays visible.
- Image canvases use `touch-action: none` with custom pinch-zoom and pan. Controls use `touch-action: manipulation` to stop double-tap zoom.
- Respect safe-area insets. Touch targets are at least 44 px.
- Support dark mode.

**Offline and storage**

- The service worker precaches the app shell. The app must work in airplane mode after the first visit.
- Show a one-time prompt to add the app to the Home Screen, which protects saved palettes from Safari's eviction.

**Colour accuracy**

The main limit on accuracy is how the swatch sheet is digitised, not the code. Show a short tip in the extractor: a flatbed scan is best. Otherwise use even daylight, no flash, and a photo taken straight on.

## Milestones and acceptance criteria

Build in six milestones. Each one is usable on the phone before the next starts, and all six together make the first version.

1. **Skeleton and palettes**: Vite + TypeScript + Preact, PWA, GitHub Actions deploy, bottom tabs, IndexedDB, palette create/read/update/delete with manual hex colours, JSON import and export.
   - *Done when*: the app installs to the Home Screen, opens in airplane mode, and palettes survive a reload and an app restart.
2. **Studio core**: load or take a photo, downscale, grid slider, linear-light averaging, ΔE2000 matching against the active palette, Matched view, colour statistics.
   - *Done when*: a 12 MP photo at 100 columns re-renders in under 100 ms after a slider change on an iPhone 15 Pro.
3. **Swatch extractor**: paper calibration, auto-detect, overlay, tap-to-add region grow, edit, split and delete, trimmed-mean sampling with modes, save to a palette.
   - *Done when*: on a scanned sheet of 12 separated blobs on white paper with handwritten labels, auto-detect finds all 12 with no false positives at default settings. Any missed blob can be added with one tap.
4. **Adjustments**: Fit-to-palette auto, sliders, before/after, crop with aspect and physical-size presets.
5. **Export**: colour grid, paint-by-code and plain layouts, grid lines, codes, legend, share to Photos.
   - *Done when*: the exported PNG opens in Photos and its legend counts match the on-screen statistics.
6. **Tuning**: dithering, Simplify, minimum patch size, value priority, cell sampling modes and the alternative metric.

All algorithms in `src/core` have unit tests, using synthetic fixtures. For example, a generated sheet with known blob colours must be recovered to within ΔE 2.

## Notes for the implementer

Keep the algorithms pure, tested and tunable. Expect the owner to adjust matching behaviour after real use.

**Suggested layout**

```text
src/
  core/            pure functions, no DOM: color.ts, adjust.ts, detect.ts,
                   regionGrow.ts, sample.ts, pixelate.ts, match.ts,
                   dither.ts, cleanup.ts, exportLayout.ts
  worker/          worker entry; message protocol with job ids
  storage/         IndexedDB access, JSON import/export
  ui/palettes/     preset list, palette editor, swatch extractor
  ui/studio/       loader, crop, adjustments, grid, views, export
  config.ts        every default threshold and slider range in one object
```

**Guidelines**

- Every number in this spec (thresholds, radii, slider ranges, defaults) is a starting point. Put them all in `config.ts` and nowhere else.
- Add a hidden debug panel, opened by tapping the version number five times. It shows detection masks, component outlines, timings and the current config values.
- Ask the owner for one real swatch-sheet scan and one swatch-sheet phone photo to use as fixtures, alongside the synthetic ones.
- Do not add a backend, analytics, or any runtime network request.
- Write a short `README.md` covering local development, deployment, and how to install the app on an iPhone.
