# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

SenseType Client is a cross-platform **Electron desktop application** (React 19 + Vite 5 + TypeScript) for AI-powered voice input. It supports macOS and Windows only. The backend API at `platform.senseaudio.cn` is external and not part of this repository.

### Platform constraint (critical)

`vite.config.js` explicitly throws on any platform other than `darwin` or `win32`. This means `pnpm dev:mac`, `pnpm build`, and all pack commands **will not work on Linux**. This is by design — the Electron main process entry points only exist for macOS (`src/main/mac/`) and Windows (`src/main/win/`).

Additionally, there is a case-sensitivity issue: `src/assets/icons/notes-Info.svg` (capital I) is imported as `notes-info.svg` (lowercase) in several files. This works on macOS/Windows (case-insensitive FS) but breaks on Linux.

### What works on Linux (Cloud Agent)

| Command | Status | Notes |
|---------|--------|-------|
| `pnpm install --no-frozen-lockfile` | Works | No lockfile in repo; must use `--no-frozen-lockfile` |
| `pnpm lint` | Works | 4 pre-existing errors (unescaped JSX entities), 954 warnings |
| `pnpm format:check` | Works | 36 files have pre-existing formatting issues |
| `npx tsc --noEmit` | Works | 3 pre-existing type errors |
| `pnpm dev:mac` / `pnpm build` | Fails | Platform check throws on Linux |

### Key dev commands (for macOS/Windows)

- **Dev server (macOS):** `pnpm dev:mac` — starts Vite on `http://0.0.0.0:8888`
- **Dev server (Windows):** `pnpm dev` — same but with `chcp 65001` for UTF-8 console
- **Lint:** `pnpm lint` / `pnpm lint:fix`
- **Format:** `pnpm format:check` / `pnpm format`
- **Build:** `pnpm build`
- **Native addon rebuild:** `pnpm run rebuild-native` (requires Python 3 + C++ toolchain)

### No test suite

This project has no automated test framework or test files. Validation is limited to lint, format, and type checking.

### Package manager

Uses `pnpm@9.12.0` (declared in `packageManager` field). The `pnpm-lock.yaml` is gitignored and not committed. Always use `--no-frozen-lockfile` when installing.
