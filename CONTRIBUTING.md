# Contributing to Rekoto

Thanks for contributing. This project is maintained by [Khotso Tsoaela](https://github.com/ktsoaela) (`@ktsoaela`).

## Ways to help

- Report bugs and propose features via GitHub Issues
- Improve docs (`README.md`, `docs/`, `CHANGELOG.md`)
- Submit pull requests for fixes and enhancements

## Development setup

1. Fork and clone the repository.
2. Use **Windows 10** (2004+) and **Node.js 20+**.
3. Install and run:

   ```bash
   npm install
   npm run icons
   npm run build:ext
   npm run dev
   ```

4. Typecheck before opening a PR:

   ```bash
   npm run typecheck
   ```

## Branch and PR guidelines

- Keep PRs focused; one concern per PR when practical.
- Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes.
- Do not commit secrets, local recordings, or scratch files (`.tmp-*`).
- Brand name in UI and docs is **Rekoto** — never Loom, Capora, or loom_clone.

## Code style

- Match existing patterns in `src/main/`, `src/renderer/`, and `extensions/`.
- Prefer clear, minimal changes over drive-by refactors.
- After editing `extensions/shared`, run `npm run build:ext`.

## CI

Pull requests run [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- `npm ci`
- `npm run typecheck`
- `npm run build:ext`
- `npm run build`
