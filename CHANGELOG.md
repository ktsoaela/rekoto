# Changelog

All notable changes to **Rekoto** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- [ ] Signed Windows installer
- [ ] In-app update checks for local builds
- [ ] More studio background presets

## [1.0.1] - 2026-11-14

### Fixed

- Release CI uploads `Rekoto-Setup.exe` and browser extension zips to GitHub Releases (`--publish never` + `gh release upload`)

### Changed

- Product page Quick start links download the Windows installer and Chrome/Edge/Firefox extension packs

## [1.0.0] - 2026-11-14

### Added

- Local screen, window, and camera recording to MP4 on Windows
- Rounded camera bubble with drag and four sizes; bubble hidden from capture and drawn into the video
- Studio backgrounds (gradient, solid colour, or custom image) with optional logo and caption
- Clean desktop mode: wallpaper swap, hide icons, minimize other apps, optional taskbar hide, restore after stop or crash
- Browser privacy extensions for Chrome, Edge, and Firefox (mask, crop, toolbar controls) via native messaging
- Floating recording controls and shortcuts (`Alt+Shift+S` / `P` / `C`)
- Library with thumbnails, search, in-app player, rename, show in folder, and Recycle Bin delete
- Configurable save folder (default `Videos\Rekoto`)
- Windows NSIS installer via `npm run dist`
