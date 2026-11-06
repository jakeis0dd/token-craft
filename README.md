# Token Craft v0.3.3

Token Craft is an Owlbear Rodeo extension built with Vite, TypeScript, React, and the Owlbear Rodeo SDK. Import an image or select an existing image, drag to reposition, zoom with the wheel, select circle or square, choose a border color and thickness, and set 1×1–4×4 grid size.

Repository: [jakeis0dd/token-craft](https://github.com/jakeis0dd/token-craft).

## Run locally
Install Node.js, open this folder in VS Code, and run:
```bash
npm install
npm run dev
```
Install `http://localhost:5173/token-craft/manifest.json` as a custom extension in Owlbear Rodeo. Keep Vite running during local use. The standalone preview is at `http://localhost:5173/token-craft/`.

## Production build and GitHub Pages
```bash
npm run build
npm run preview
```
The build runs TypeScript checking and writes the production files to `dist/`. Open `http://localhost:4173/token-craft/` to preview the build locally.

Vite uses `/token-craft/` as its base path in development and production. The manifest's icon and popover paths use the same prefix, and the header logo uses Vite's base URL. These paths target the following URLs after `dist/` is published to GitHub Pages:

- Extension: `https://jakeis0dd.github.io/token-craft/`
- Install manifest: `https://jakeis0dd.github.io/token-craft/manifest.json`
- Toolbar icon: `https://jakeis0dd.github.io/token-craft/toolbar-icon.svg`
- Header logo: `https://jakeis0dd.github.io/token-craft/logo.png`

Building and previewing do not deploy the extension. Publishing the contents of `dist/` requires a separate deployment step.

## Library and scene workflow
1. Crop a token and click **Save to Library**. The upload is submitted with the `CHARACTER` asset type.
2. When the upload promise completes, **Add to Scene** is enabled.
3. Click **Add to Scene** and select the saved image in Owlbear Rodeo's image picker. The selected image is placed on the active scene.

Changing the token settings or image disables scene placement until saved again. Uploading does not yield a reusable asset URL, so selecting the saved token remains necessary. Folder selection and exact picker behavior depend on Owlbear Rodeo.

### v0.3.3 — Grid alignment correction

Save to Library previously left `grid.offset` at the SDK default `(0, 0)`, and Add to Scene explicitly used the same corner origin. Both now set the origin to the image center: `(256, 256)` for the exported 512×512 PNG. Owlbear uses this offset for snapping and rotation; see the [official image builder example](https://docs.owlbear.rodeo/extensions/reference/builders/image/) and [alignment explanation](https://blog.owlbear.rodeo/effortless-map-alignment/).

DPI remains `512 / gridSize`, so the image still spans exactly 1×1, 2×2, 3×3, or 4×4 cells. Add to Scene converts the screen center into scene coordinates, then uses the SDK's [snapPosition](https://docs.owlbear.rodeo/extensions/apis/scene/grid/#snapposition) with full snapping. On square grids, 1×1 and 3×3 centers snap to cell centers; 2×2 and 4×4 centers snap to intersections, keeping all footprint edges on grid lines. Other grid types use the SDK's corner and center snap targets. Crop, zoom, border, artwork, PNG output, and asset type are unchanged.

Validation: `npm run build` passes. A one-off regression harness exercised the actual save/scene handlers and installed SDK builders with mocked Owlbear APIs: all 36 combinations of four token sizes, three scene DPIs (70/150/300), and three pan/zoom configurations passed. It checked matching library/scene origins and DPI, grid-aligned footprint edges, and preserved image content settings. The rendering and PNG export functions are unchanged from the prior revision.

Live-room testing of this correction has not been performed. Recommended follow-up: save fresh circle and square tokens at each size; test both dragging from Characters and Add to Scene; move and rotate them; verify their footprints and condition-marker alignment on a square grid, including after panning/zooming. Existing library assets and scene items are not migrated; re-save tokens to get the corrected library origin.

## Branding
- `public/toolbar-icon.svg`: white-on-transparent toolbar icon.
- `public/logo.png`: full-color extension logo.

## Status
Version 0.3.3 includes the grid-alignment correction described above. Version 0.3.2 was previously verified by the developer inside Owlbear Rodeo, including image import and selection, drag positioning, wheel zoom, circle and square cropping, border controls, 1×1–4×4 sizing, Save to Library, and Add to Scene. The v0.3.3 correction still needs a live-room check.


## v0.3.1
Branding-only update: toolbar icon traced from approved white silhouette reference; gold logo centered and transparent outside emblem. No functional code changes.


v0.3.2: Toolbar icon refined from approved reference with thinner ring and inset silhouette. No application logic changed.
