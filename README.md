<p align="center"><img src="./app/assets/images/logo.png" width="150px" height="150px" alt="Silo"></p>

<h1 align="center">Silo Launcher</h1>

<p align="center">Electron-based modded Minecraft launcher for the Silo server. It automatically installs and synchronizes Java, Forge, mods and optional content from a self-hosted backend: the player just logs in and clicks Play.</p>

## Project status

Forked from [Ventrys Launcher][ventrys-launcher], itself built on top of [HeliosLauncher][helios] (dscalzi): the UI, Microsoft authentication and the launcher's own self-update mechanism come from there and work as-is. Everything related to content distribution (mods/Java/Forge, originally driven by a hand-generated `distribution.json`) is handled by a separate Python backend, [`silo-sync`][silo-sync].

**Why not Nebula**: HeliosLauncher + [Nebula][nebula] is a more mature and generally more robust solution than this project. The actual problem was the distribution pipeline itself - regenerating `distribution.json` with Nebula on every modpack change, re-uploading it by hand, and managing optional mods through a nested module tree. `silo-sync` replaces that entire pipeline with a synced directory (SFTP) and a backend that scans and serves its own content.

**Looking for a turnkey launcher solution instead?** [launch-it.app](https://launch-it.app/) is a maintained, professional product. This repository is not.

## Current scope and roadmap

- One launcher build targets **one `silo-sync` backend** (`SYNC_URL` in `app/assets/js/launcherConfig.js`).
- **Other mod loaders** (Fabric, NeoForge, ...): planned. The current Forge-specific behavior is really just "fetch a client setup (installer/Java) from the backend and execute it locally" - there's no Forge-specific logic hardcoded elsewhere in the sync/launch pipeline.

## What the launcher does

- **Microsoft account authentication** (OAuth 2.0) - multi-account support, credentials never stored or sent anywhere but Microsoft.
- **Automatic Java, Forge, mod and config sync** from `silo-sync` on every launch - nothing to install or choose manually.
- **Optional addons**: mods/shaders the server makes available but doesn't enforce, toggled per-player from Settings.
- **Orphan file cleanup**: a file removed server-side is removed client-side on the next launch (scoped to explicitly-managed folders only - never touches saves/screenshots/logs).
- **Bulletins** (news) served by `silo-sync`: each `## ` heading of the admin news page is one bulletin.
- **Animated low-poly 3D background** (WebGL, PS1 style): one room per menu, paused while the game runs, can be turned off in Settings.
- **Self-updating launcher** (`electron-updater`, GitHub releases of this repo).
- RAM / JVM options, an outage banner when Minecraft services are down, and a built-in debug console (Settings > Avancé).

Removed relative to upstream HeliosLauncher: `distribution.json`/Nebula, multi-server selection, RSS news feed, Discord Rich Presence, Mojang (Yggdrasil) account login (deprecated by Mojang), Java auto-detection/download via Adoptium.

## Architecture

```
player <-> Silo Launcher (this repo) <-> silo-sync (Python backend, separate repo)
```

The launcher itself holds no content logic: it queries `silo-sync` (`/config.json`) for what to install/sync, downloads it, installs Forge via the real official installer (headless), and launches the game. See [`silo-sync`][silo-sync] for backend details (forced/download/ignore/optional rules, admin panel, file browser).

## Configuration and branding

Everything project-specific lives in these files - nothing else in the codebase hardcodes a server, URL or brand name:

| What | Where |
| --- | --- |
| Backend URL, GitHub repo, game data folder name | `app/assets/js/launcherConfig.js` |
| Window title, home/login texts (fallback title, tagline, Pacte line), YouTube/Discord links (empty = hidden) | `app/assets/lang/_custom.toml` |
| Colors, fonts, window metrics | `app/assets/css/silo/tokens.css` (styles: `app/assets/css/silo/app.css`) |
| 3D background (rooms, scene per menu) | `app/assets/js/silo/` (copied as-is from `docs/silo-handoff/engine/`) |
| In-app logo | `app/assets/images/logo.png` / `logo.ico` |
| Installer / app icons | `build/icon.png` (512x512) / `build/icon.ico` |
| App name, package name (also the installer file prefix), version | `package.json` (`productName`, `name`, `version`) |
| Installer identity, release repo for auto-updates | `electron-builder.yml` (`appId`, `productName`, `publish`), `dev-app-update.yml` |
| Microsoft login (Azure app client ID) | `app/assets/js/ipcconstants.js`, see `docs/MicrosoftAuth.md` |

`GITHUB_REPO` in `launcherConfig.js` and the `publish` block of `electron-builder.yml` must point to the same repository.

The server name and description shown on the home screen come from `silo-sync` (`server_meta`), the bulletins from its admin news page. The visual direction and UI rules are in [`docs/silo-handoff/CLAUDE_CODE_BRIEF.md`](docs/silo-handoff/CLAUDE_CODE_BRIEF.md) (reference: `demo.html`).

## Development

**Requirements**: [Node.js][nodejs] v22

```console
git clone https://github.com/Silo-RP/launcher-client.git
cd launcher-client
npm install
npm start
```

**Build installers**

```console
npm run dist        # current platform
npm run dist:win
npm run dist:mac
npm run dist:linux
```

**Debug console**: `Ctrl+Shift+I`, or the dedicated button on the main screen (next to Settings).

## Contributing

If you're an actual developer and interested in helping maintain this, reach out on Discord: **thehecateii**.

## Attribution

Based on [HeliosLauncher][helios] by Daniel Scalzi (dscalzi), MIT licensed - see `LICENSE.txt`.

[helios]: https://github.com/dscalzi/HeliosLauncher 'HeliosLauncher'
[nebula]: https://github.com/dscalzi/Nebula 'dscalzi/Nebula'
[ventrys-launcher]: https://github.com/TheHecateII/Ventrys-Launcher 'Ventrys Launcher'
[silo-sync]: https://github.com/Silo-RP/launcher-backend 'silo-sync'
[nodejs]: https://nodejs.org/en/ 'Node.js'
