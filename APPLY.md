# STOS Hardened Public Deployment v2

Target repository:

`KhaemenesAcademy/KhaemenesAcademy.github.io`

## Apply order

Upload these files preserving their paths:

- `STOS/index.html` — replace the current file
- `STOS/pages/build.mjs`
- `STOS/pages/package.json`
- `STOS/pages/package-lock.json`
- `.github/workflows/deploy-stos-pages.yml`

Keep the existing root `.nojekyll`.

Then in **Settings → Pages**, choose **GitHub Actions** as the deployment source if it is not already selected.

Run **Deploy hardened STOS to GitHub Pages** once from the Actions tab, or let the push to `main` trigger it.

The intended live URL stays:

`https://khaemenesacademy.github.io/STOS/`

## Security changes

- Trusted Wix parent pinned to `https://vervneveda.wixsite.com`
- Dynamic `?parentOrigin=` trust removed
- `document.referrer` trust removed
- STOS project-site asset paths corrected to `./assets/...`
- Production xterm assets copied from exact `@xterm/xterm` 6.0.0 package
- Runtime UNPKG dependency removed from the deployed Pages artifact
- Published artifact restricted to:
  - `.nojekyll`
  - `STOS/index.html`
  - `STOS/assets/xterm.js`
  - `STOS/assets/xterm.css`

No gateway source, Wix backend code, profiles, SSH material, secrets, host scripts, or private configuration are published.
