import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import pty from "node-pty";
import { Client as SshClient } from "ssh2";

function dimension(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function safeTextEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function standardSshFingerprint(rawHostKey) {
  const digest = crypto.createHash("sha256").update(rawHostKey).digest("base64").replace(/=+$/g, "");
  return `SHA256:${digest}`;
}

export function openProfileSession({ profile, config, onData, onExit, onError }) {
  const cols = dimension(profile.cols, 120, 20, 300);
  const rows = dimension(profile.rows, 36, 5, 120);

  if (profile.type === "ssh") {
    return openSsh({ profile, config, cols, rows, onData, onExit, onError });
  }
  if (profile.type === "local-pty") {
    return openLocalPty({ profile, cols, rows, onData, onExit, onError });
  }
  if (profile.type === "podman-test") {
    return openPodmanTest({ profile, cols, rows, onData, onExit, onError });
  }
  throw new Error(`Unsupported profile type: ${profile.type}`);
}

function openSsh({ profile, config, cols, rows, onData, onExit, onError }) {
  if (!profile.host || !profile.username || !profile.privateKeyPath) {
    throw new Error(`SSH profile ${profile.id} is incomplete`);
  }

  const privateKey = fs.readFileSync(profile.privateKeyPath);
  const passphrase = profile.privateKeyPassphraseEnv
    ? process.env[profile.privateKeyPassphraseEnv]
    : undefined;

  const pinned = String(profile.hostFingerprintSha256 || "").trim();
  if (!pinned && !config.allowUnpinnedSsh) {
    throw new Error(`SSH profile ${profile.id} has no pinned host fingerprint`);
  }

  const conn = new SshClient();
  let stream = null;
  let closed = false;

  conn.on("ready", () => {
    conn.shell({ term: "xterm-256color", cols, rows }, (err, shellStream) => {
      if (err) {
        onError(err);
        conn.end();
        return;
      }

      stream = shellStream;
      stream.on("data", chunk => onData(chunk.toString("utf8")));
      stream.stderr?.on("data", chunk => onData(chunk.toString("utf8")));
      stream.on("close", () => {
        if (!closed) {
          closed = true;
          onExit({ code: null, signal: "ssh-shell-closed" });
        }
        conn.end();
      });

      if (profile.remoteCommand) stream.write(`${profile.remoteCommand}\n`);
    });
  });

  conn.on("error", onError);
  conn.on("close", () => {
    if (!closed) {
      closed = true;
      onExit({ code: null, signal: "ssh-connection-closed" });
    }
  });

  conn.connect({
    host: profile.host,
    port: Number(profile.port || 22),
    username: profile.username,
    privateKey,
    ...(passphrase ? { passphrase } : {}),
    readyTimeout: 15000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
    hostVerifier(rawKey) {
      if (!pinned) return config.allowUnpinnedSsh;
      return safeTextEqual(standardSshFingerprint(rawKey), pinned);
    }
  });

  return {
    write(data) {
      if (!stream) throw new Error("SSH shell is not ready");
      stream.write(data);
    },
    resize(nextCols, nextRows) {
      if (stream?.setWindow) {
        stream.setWindow(
          dimension(nextRows, rows, 5, 120),
          dimension(nextCols, cols, 20, 300),
          0,
          0
        );
      }
    },
    close() {
      try { stream?.end(); } catch {}
      try { conn.end(); } catch {}
    }
  };
}

function openLocalPty({ profile, cols, rows, onData, onExit, onError }) {
  const command = String(profile.command || "").trim();
  if (!command) throw new Error(`local-pty profile ${profile.id} requires a fixed command`);

  let child;
  try {
    child = pty.spawn(command, Array.isArray(profile.args) ? profile.args.map(String) : [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: profile.cwd ? String(profile.cwd) : os.homedir(),
      env: { ...process.env, TERM: "xterm-256color" }
    });
  } catch (error) {
    onError(error);
    throw error;
  }

  child.onData(onData);
  child.onExit(({ exitCode, signal }) => onExit({ code: exitCode, signal }));

  return {
    write(data) { child.write(data); },
    resize(c, r) { child.resize(dimension(c, cols, 20, 300), dimension(r, rows, 5, 120)); },
    close() { try { child.kill(); } catch {} }
  };
}

function openPodmanTest({ profile, cols, rows, onData, onExit, onError }) {
  const image = String(profile.image || "").trim();
  if (!image) throw new Error("TEST profile requires an approved image");

  const limits = profile.limits || {};
  const containerName = `stos-test-${crypto.randomBytes(8).toString("hex")}`;
  const shell = String(profile.shell || "/bin/sh");

  const args = [
    "run", "--rm", "-it",
    "--pull", "never",
    "--name", containerName,
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", String(Number(limits.pids || 256)),
    "--memory", String(limits.memory || "512m"),
    "--cpus", String(limits.cpus || "1"),
    "--tmpfs", `/tmp:rw,nosuid,noexec,size=${limits.tmpfsTmp || "128m"}`,
    "--tmpfs", `/home/stos:rw,nosuid,size=${limits.tmpfsHome || "256m"}`,
    "--hostname", "stos-test",
    "--env", "HOME=/home/stos",
    "--env", "TERM=xterm-256color",
    image,
    shell
  ];

  let child;
  try {
    child = pty.spawn("podman", args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: os.homedir(),
      env: { ...process.env, TERM: "xterm-256color" }
    });
  } catch (error) {
    onError(error);
    throw error;
  }

  child.onData(onData);
  child.onExit(({ exitCode, signal }) => onExit({ code: exitCode, signal }));

  return {
    write(data) { child.write(data); },
    resize(c, r) { child.resize(dimension(c, cols, 20, 300), dimension(r, rows, 5, 120)); },
    close() { try { child.kill(); } catch {} }
  };
}
