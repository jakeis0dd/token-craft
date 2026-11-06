# Token Craft v0.3.2

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

## Branding
- `public/toolbar-icon.svg`: white-on-transparent toolbar icon.
- `public/logo.png`: full-color extension logo.

## Status
Version 0.3.2 has been verified by the developer inside Owlbear Rodeo, including image import and selection, drag positioning, wheel zoom, circle and square cropping, border controls, 1×1–4×4 sizing, Save to Library, and Add to Scene. The renamed GitHub Pages build still needs a live-room check after deployment.


## v0.3.1
Branding-only update: toolbar icon traced from approved white silhouette reference; gold logo centered and transparent outside emblem. No functional code changes.


v0.3.2: Toolbar icon refined from approved reference with thinner ring and inset silhouette. No application logic changed.
