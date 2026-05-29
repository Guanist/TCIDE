# File Tree Icons & HTML File Display Fix
**Date**: 2026-05-28 06:30 GMT+8

## Root Cause Analysis

### Issue 1: Only "app" folder had folder icon
The `FOLDER_ICONS` map maps specific folders to emoji (e.g., `'app': '📁'`). Unmatched folders fall through to `<img src="/icons/file/folder.png">` which uses an **absolute path** (`/icons/...`). 
- In Electron's `file://` protocol, `/icons/file/folder.png` resolves to `file:///icons/file/folder.png` → `C:\icons\file\folder.png` — **file doesn't exist**
- Only emoji-based icons render correctly in Electron
- Fix: Default folder icon changed to 📁 emoji, and expanded FOLDER_ICONS map

### Issue 2: py/files had no icons in file tree
Same root cause: `py` IS in the `pngMap` (`py: 'file-py.png'`), but the img tag uses an absolute path that doesn't resolve in Electron.
- Fix: Changed `<img src="/icons/file/...">` to `<img src="icons/file/...">` (relative path)
- Added `pyx`, `ipynb`, `shtml`, `styl` to pngMap

### Issue 3: HTML files not showing in file list
Same root cause: Without working icons, HTML files were indistinguishable from other files in the tree. The `readDir()` function doesn't filter HTML files — they were being returned but their icons were broken.

## Changes Made

### `src/renderer/main.ts`
1. **Line 383**: Default folder → `📁` emoji instead of `<img src="/icons/file/folder.png">`
2. **Line 450**: pngMap img path → `icons/file/${pngMap[ext]}` (relative, no leading `/`)
3. **Line 537**: Default file img path → `icons/file/file-default.png` (relative)
4. **FOLDER_ICONS expanded**: Added `core`, `agent`, `compat`, `indexer`, `model`, `config`, `renderer`, `main`, `components`, `styles`, `types`, `hooks`, `release`, `resources`, `task-artifacts`
5. **pngMap expanded**: Added `pyx`, `ipynb` → file-py.png; `shtml` → file-html.png; `styl` → file-css.png

### `src/renderer/index.html`
Changed 5 instances of `src="/icons/..."` to `src="icons/..."` (relative):

### `dist/renderer/index.html`  
Applied same path fixes for the built output.

### Built JS bundle verified
`dist/renderer/assets/index-Z8m79H8B.js` confirms:
- `icons/file/...` paths (relative, no leading `/`) ✅
- Default folder icon is 📁 emoji ✅
- Expanded FOLDER_ICONS entries present ✅

## Key Insight
**Electron `file://` protocol treats absolute paths (`/icons/...`) as filesystem-root-relative**, not relative to the HTML file. All icon and asset references must use relative paths or proper Electron protocol handlers. The Vite `base: './'` setting only affects bundled JS/CSS assets, not manual `src` attributes in the HTML template or JS-generated HTML.

## Build Verification
- Vite build: ✅ Clean (1062 modules)
- Chunk size warning: Expected (Monaco editor ~3.9MB)
