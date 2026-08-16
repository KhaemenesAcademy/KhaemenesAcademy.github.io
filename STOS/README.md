# Sovereign Terminal Gateway v1

Private server-side gateway for Sovereign Terminal OS (STOS).

## Architecture

```text
Wix private Admin page
        │
        │ sandboxed HTML Component
        ▼
STOS v4 UI
(served by terminal gateway)
        │
        │ postMessage: request profile ticket
        ▼
Wix page code
        │
        │ Admin-only .web.js web method
        ▼
Wix backend broker
        │
        │ HTTPS + backend-only shared secret
        ▼
Sovereign Terminal Gateway
        │
        ├── random one-use ticket
        └── WSS terminal session
              │
              ├── terminal-1 … terminal-7
              │      fixed SSH profile → persistent tmux session
              │
              └── TEST
                     disposable rootless Podman sandbox
```

## Where each piece lives

### Wix

Wix holds:

- the private/admin page;
- the HTML Component that embeds STOS;
- page code that relays ticket requests;
- an Admin-only backend web method;
- one broker secret stored in Wix Secrets Manager.

Wix does **not** hold SSH private keys or production host credentials.

### Private GitHub repository

The private gateway repository contains:

- gateway source code;
- STOS public UI source;
- example configuration;
- Wix integration source;
- deployment configuration.

The real `.env`, real `profiles.json`, SSH keys, logs, and runtime state are ignored by Git.

### Gateway host

A real always-on computer/server runs this repository.

GitHub stores the code; it does not execute a persistent WebSocket/PTY gateway by itself.

## Terminal 1–7

Each production terminal maps to a fixed server-side profile.

The included profile template uses SSH plus a fixed `tmux` command:

```text
tmux new-session -A -s stos-1
```

through:

```text
tmux new-session -A -s stos-7
```

This means a shell can remain alive when the browser disconnects and can be reattached later.

### Your seven terminals that are already open

An existing macOS Terminal window cannot generally be adopted into a new remote terminal after the fact unless its shell is already running inside a multiplexer such as `tmux`, `screen`, or `zellij`.

For durable STOS operation, the seven long-running terminal workloads should be moved into named tmux sessions. After that, STOS can reconnect to them rather than creating disposable SSH shells.

## TEST

TEST is intentionally a different security domain.

The supplied TEST profile starts a rootless Podman container with:

- no network;
- read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges`;
- PID limit;
- memory limit;
- CPU limit;
- temporary in-memory home;
- temporary `/tmp`;
- no host volume mounts;
- `--pull never`, so it cannot silently fetch an unapproved image during session launch.

Closing TEST kills the PTY and `--rm` removes the container.

For stronger reproducibility, pin the TEST image by digest after you choose it.

## Browser security model

The STOS iframe contains no:

- SSH private keys;
- SSH passwords;
- gateway broker secret;
- infrastructure master key;
- permanent admin token.

The browser receives only a random ticket that:

- expires quickly;
- maps to exactly one server-side profile;
- can be consumed only once;
- is delivered to the gateway in the WebSocket subprotocol header rather than a URL query parameter.

## SSH host verification

Production SSH profiles fail closed unless a host key is pinned.

Use the standard OpenSSH SHA-256 fingerprint format:

```text
SHA256:...
```

Do not disable host verification merely to get the first connection working.

## Install

### 1. Host prerequisites

Install:

- Node.js 20+
- compiler/build prerequisites for `node-pty`
- `tmux` on production SSH targets
- rootless Podman on the gateway host for TEST

Then:

```bash
npm install
npm run check
```

The package uses xterm.js for actual browser terminal emulation.

## 2. Private configuration

```bash
cp .env.example .env
cp config/profiles.example.json config/profiles.json
```

Both real files are ignored by Git.

Generate a long random broker secret. Put the **same value** in:

1. gateway `.env` as `STOS_BROKER_SHARED_SECRET`;
2. Wix Secrets Manager under `STOS_BROKER_SHARED_SECRET`.

Never put this secret in:

- STOS HTML;
- Wix page code;
- GitHub;
- screenshots;
- browser localStorage;
- URLs.

## 3. Configure production profiles

Edit the private `config/profiles.json` on the gateway deployment.

For each of Terminal 1–7 set:

- fixed hostname/IP;
- SSH port;
- SSH username;
- gateway-local key path;
- pinned SSH host-key fingerprint;
- fixed tmux session command.

The browser can select only `terminal-1` through `terminal-7`; it cannot modify those fields.

## 4. Configure TEST

Run Podman as the same unprivileged account that runs the gateway.

Pre-pull and approve the TEST image. Do not expose:

- Docker/Podman socket;
- SSH keys;
- production home directories;
- production source trees;
- host network.

## 5. TLS / WSS

The Node process is designed to bind to loopback:

```text
127.0.0.1:8787
```

Put a TLS reverse proxy in front of it.

Example public endpoints:

```text
https://terminal.example.com/ui/stos.html
wss://terminal.example.com/v1/terminal
```

A Caddy example is included.

## 6. Wix integration

Wix supports a sandboxed HTML Component/iframe and two-way messaging between the page and the iframe. Use that as the display boundary.

### HTML Component

Set its external URL to:

```text
https://terminal.example.com/ui/stos.html?parentOrigin=https%3A%2F%2Fwww.example.com
```

Replace both domains.

The `parentOrigin` value is public. It lets STOS use an exact `postMessage()` target instead of `"*"`.

Set the HTML Component element ID to:

```text
#stosFrame
```

### Backend

Create:

```text
backend/stos-broker.web.js
```

from `wix/stos-broker.web.js`.

The web method is restricted to `Permissions.Admin`.

Replace:

```text
https://terminal.example.com/v1/tickets
```

with your deployed gateway ticket URL.

Add the broker secret to Wix Secrets Manager.

### Page code

Use:

```text
wix/STOS_ADMIN_PAGE_CODE.js
```

on the private/admin Wix page.

The iframe asks the page for a profile ticket. The page calls the Wix backend. The Wix backend authenticates to the gateway. Only the resulting one-use ticket returns to the iframe.

## Using STOS

In Terminal 1:

```text
connect
```

automatically requests:

```text
terminal-1
```

Terminal 7 maps to:

```text
terminal-7
```

TEST maps only to:

```text
test
```

You can also explicitly request:

```text
connect terminal-4
```

The browser contains an additional allowlist, and the gateway independently validates the profile.

Use the **Disconnect** control in STOS to close the remote connection and return to the local Mini Cloud shell.

## Production validation

Before connecting real servers:

- [ ] repository is private;
- [ ] `.env` is untracked;
- [ ] `config/profiles.json` is untracked;
- [ ] gateway runs as a non-root account;
- [ ] TLS certificate is valid;
- [ ] `STOS_UI_ORIGIN` exactly matches the public iframe origin;
- [ ] `STOS_FRAME_ANCESTORS` contains only your Wix page/site origins;
- [ ] Wix broker web method is Admin-only;
- [ ] broker secret exists only in Wix Secrets Manager and gateway environment;
- [ ] SSH keys are readable only by the gateway account;
- [ ] every SSH profile has the expected pinned host-key fingerprint;
- [ ] Terminal 1–7 connect to fixed tmux sessions;
- [ ] TEST runs rootless;
- [ ] TEST has no network and no host mounts;
- [ ] a standalone STOS URL cannot obtain a ticket;
- [ ] expired tickets fail;
- [ ] reused tickets fail;
- [ ] wrong WebSocket Origin fails;
- [ ] TEST cannot request a production profile;
- [ ] production terminals cannot request TEST.

© Jennifer Kay Pearl / Verve N Veda
