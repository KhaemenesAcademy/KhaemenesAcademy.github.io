import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'STOS', 'index.html');
const BUILD_ROOT = path.join(ROOT, '.pages-dist');
const OUT_DIR = path.join(BUILD_ROOT, 'STOS');
const ASSET_DIR = path.join(OUT_DIR, 'assets');
const XTERM_ROOT = path.join(ROOT, 'STOS', 'pages', 'node_modules', '@xterm', 'xterm');
const TRUSTED_PARENT_ORIGIN = 'https://vervneveda.wixsite.com';

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

let html = await fs.readFile(SOURCE, 'utf8');

const gatewayPattern = /const STOS_GATEWAY = \{\n  parentOrigin: \(\(\) => \{[\s\S]*?\n  \}\)\(\),\n  pending: new Map\(\),\n  sockets: new Map\(\)\n\};/g;
const dynamicMatches = html.match(gatewayPattern) || [];

if (dynamicMatches.length > 1) {
  throw new Error(`Found ${dynamicMatches.length} dynamic STOS_GATEWAY blocks; refusing to publish.`);
}

if (dynamicMatches.length === 1) {
  html = html.replace(
    gatewayPattern,
    `const STOS_GATEWAY = {\n  // Production trust boundary: only the live Verve N Veda Wix origin may broker tickets.\n  parentOrigin: "${TRUSTED_PARENT_ORIGIN}",\n  pending: new Map(),\n  sockets: new Map()\n};`
  );
}

if (html.includes('get("parentOrigin")') || html.includes('document.referrer')) {
  throw new Error('Dynamic parent-origin discovery is present; refusing to publish.');
}
if (!html.includes(`parentOrigin: "${TRUSTED_PARENT_ORIGIN}"`)) {
  throw new Error('Pinned Wix parent origin is missing; refusing to publish.');
}

const rootCss = '<link rel="stylesheet" href="/assets/xterm.css">';
const relCss = '<link rel="stylesheet" href="./assets/xterm.css">';
const rootJs = '<script src="/assets/xterm.js"></script>';
const relJs = '<script src="./assets/xterm.js"></script>';

if (count(html, rootCss) === 1) html = html.replace(rootCss, relCss);
if (count(html, rootJs) === 1) html = html.replace(rootJs, relJs);

if (count(html, relCss) !== 1 || count(html, relJs) !== 1) {
  throw new Error('STOS xterm asset references are not the expected relative paths.');
}

const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
if (!html.includes('<meta name="robots"')) {
  if (count(html, viewport) !== 1) {
    throw new Error('Viewport marker changed; refusing metadata injection.');
  }
  html = html.replace(
    viewport,
    `${viewport}\n<meta name="robots" content="noindex,nofollow,noarchive">\n<meta name="referrer" content="no-referrer">`
  );
}

await fs.rm(BUILD_ROOT, { recursive: true, force: true });
await fs.mkdir(ASSET_DIR, { recursive: true });
await fs.writeFile(path.join(BUILD_ROOT, '.nojekyll'), '');
await fs.writeFile(path.join(OUT_DIR, 'index.html'), html, 'utf8');

await fs.copyFile(path.join(XTERM_ROOT, 'lib', 'xterm.js'), path.join(ASSET_DIR, 'xterm.js'));
await fs.copyFile(path.join(XTERM_ROOT, 'css', 'xterm.css'), path.join(ASSET_DIR, 'xterm.css'));

const [jsStat, cssStat] = await Promise.all([
  fs.stat(path.join(ASSET_DIR, 'xterm.js')),
  fs.stat(path.join(ASSET_DIR, 'xterm.css'))
]);

if (jsStat.size < 100_000) throw new Error(`xterm.js unexpectedly small: ${jsStat.size}`);
if (cssStat.size < 5_000) throw new Error(`xterm.css unexpectedly small: ${cssStat.size}`);

console.log(`STOS Pages build ready: ${OUT_DIR}`);
console.log(`Trusted parent: ${TRUSTED_PARENT_ORIGIN}`);
console.log(`Self-hosted xterm.js: ${jsStat.size} bytes`);
console.log(`Self-hosted xterm.css: ${cssStat.size} bytes`);
