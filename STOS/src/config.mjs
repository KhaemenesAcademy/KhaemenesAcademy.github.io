import fs from "node:fs";
import path from "node:path";

function env(name, fallback = "") {
  return process.env[name] === undefined ? fallback : process.env[name];
}
function intEnv(name, fallback, min, max) {
  const value = Number.parseInt(env(name, String(fallback)), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}
function boolEnv(name, fallback = false) {
  const raw = env(name, fallback ? "true" : "false").trim().toLowerCase();
  return ["1", "true", "yes"].includes(raw);
}
function requiredUrl(name, protocols) {
  const raw = env(name).trim();
  if (!raw) throw new Error(`${name} is required`);
  const value = new URL(raw);
  if (!protocols.includes(value.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  return value;
}

export function loadConfig() {
  const brokerSecret = env("STOS_BROKER_SHARED_SECRET").trim();
  if (brokerSecret.length < 48) {
    throw new Error("STOS_BROKER_SHARED_SECRET must be at least 48 characters");
  }

  const uiUrl = requiredUrl("STOS_UI_ORIGIN", ["https:"]);
  const publicWssUrl = requiredUrl("STOS_PUBLIC_WSS_URL", ["wss:"]).toString();
  const frameAncestors = env("STOS_FRAME_ANCESTORS").trim();
  if (!frameAncestors) throw new Error("STOS_FRAME_ANCESTORS is required");

  const profilesFile = path.resolve(env("STOS_PROFILES_FILE", "./config/profiles.json"));
  if (!fs.existsSync(profilesFile)) throw new Error(`Profile file not found: ${profilesFile}`);

  const parsed = JSON.parse(fs.readFileSync(profilesFile, "utf8"));
  if (!Array.isArray(parsed?.profiles)) throw new Error("profiles file must contain a profiles array");

  const profiles = new Map();
  for (const profile of parsed.profiles) {
    if (!profile?.id || typeof profile.id !== "string") throw new Error("Every profile needs an id");
    if (profiles.has(profile.id)) throw new Error(`Duplicate profile id: ${profile.id}`);
    if (!["ssh", "local-pty", "podman-test"].includes(profile.type)) {
      throw new Error(`Unsupported profile type: ${profile.id}`);
    }
    profiles.set(profile.id, Object.freeze({ ...profile }));
  }

  return Object.freeze({
    host: env("HOST", "127.0.0.1"),
    port: intEnv("PORT", 8787, 1, 65535),
    brokerSecret,
    uiOrigin: uiUrl.origin,
    publicWssUrl,
    frameAncestors,
    ticketTtlMs: intEnv("STOS_TICKET_TTL_SECONDS", 45, 10, 120) * 1000,
    maxActiveSessions: intEnv("STOS_MAX_ACTIVE_SESSIONS", 16, 1, 100),
    maxSessionsPerSubject: intEnv("STOS_MAX_SESSIONS_PER_SUBJECT", 10, 1, 50),
    maxInputBytes: intEnv("STOS_MAX_INPUT_BYTES", 8192, 128, 65536),
    maxMessageBytes: intEnv("STOS_MAX_MESSAGE_BYTES", 16384, 1024, 262144),
    allowUnpinnedSsh: boolEnv("STOS_ALLOW_UNPINNED_SSH", false),
    profiles
  });
}
