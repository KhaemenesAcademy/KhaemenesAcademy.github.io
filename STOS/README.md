# Sovereign Terminal OS — Public Interface

This directory is the **public, credential-free frontend** for Sovereign Terminal OS (STOS).

It may contain only static browser-interface files.

## Public-safe contents

- `index.html` — STOS browser interface
- `.nojekyll` — tells GitHub Pages to serve the static files directly
- `assets/xterm.js` — pinned xterm.js browser loader
- `assets/xterm.css` — pinned xterm.js stylesheet loader

## Do not place private infrastructure here

Never publish any of the following in this public repository:

- `.env`
- gateway broker secrets
- SSH keys or passwords
- `profiles.json`
- gateway `src/`
- host/bootstrap scripts
- Wix backend broker source
- deployment credentials
- Cloudflare Tunnel credentials
- private topology or operational runbooks
- logs, runtime state, backups, or snapshots

The public STOS interface contains **no terminal authority**. Remote terminal access is granted only through the separate authenticated broker and private Sovereign Terminal Gateway.

## xterm.js

The two files under `assets/` are pinned loader files for xterm.js 6.0.0. They load the versioned upstream browser distribution. They contain no STOS credentials or gateway configuration.

For the final hardened deployment, these loaders can be replaced byte-for-byte with the self-hosted xterm.js 6.0.0 distribution files without changing the STOS directory structure.

© Jennifer Kay Pearl / Verve N Veda
