# Token Cropper v0.3.0

Owlbear Rodeo token cropper. Upload an image, drag to reposition, zoom with the wheel, select circle or square, choose a solid border color, and set 1×1–4×4 grid size.

## Run locally
Install Node.js, open this folder in VS Code, and run:
```bash
npm install
npm run dev
```
Install `http://localhost:5173/manifest.json` as a custom extension in Owlbear Rodeo. Keep Vite running during local use.

## Library and scene workflow
1. Crop a token and click **Save to Library**. The upload is submitted with the `CHARACTER` asset type.
2. When the upload promise completes, **Add to Scene** is enabled.
3. Click **Add to Scene** and select the saved image in Owlbear Rodeo's image picker. The selected image is placed on the active scene.

Changing the token settings or image disables scene placement until saved again. Uploading does not yield a reusable asset URL, so selecting the saved token remains necessary. Folder selection and exact picker behavior depend on Owlbear Rodeo.

## Branding
- `public/toolbar-icon.svg`: white-on-transparent toolbar icon.
- `public/logo.png`: full-color extension logo.

## Status
Scene placement is unverified and should be tested inside Owlbear Rodeo before release. Library saving and grid sizing should also be checked in a live room.


## v0.3.1
Branding-only update: toolbar icon traced from approved white silhouette reference; gold logo centered and transparent outside emblem. No functional code changes.


v0.3.2: Toolbar icon refined from approved reference with thinner ring and inset silhouette. No application logic changed.
