import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig } from "./config.mjs";
import { TicketStore } from "./tickets.mjs";
import { openProfileSession } from "./sessions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const tickets = new TicketStore({ ttlMs: config.ticketTtlMs });

const activeSessions = new Map();
const subjectCounts = new Map();

const UI_FILE = path.resolve(__dirname, "../public/stos.html");
const XTERM_JS = path.resolve(__dirname, "../node_modules/@xterm/xterm/lib/xterm.js");
const XTERM_CSS = path.resolve(__dirname, "../node_modules/@xterm/xterm/css/xterm.css");

function baseHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));

  res.writeHead(status, {
    ...baseHeaders(),
    "Content-Length": payload.length,
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, body) {
  send(res, status, body, { "Content-Type": "application/json; charset=utf-8" });
}

function serveFile(res, filepath, contentType, extra = {}) {
  if (!fs.existsSync(filepath)) {
    return sendJson(res, 503, { error: "asset_unavailable" });
  }
  send(res, 200, fs.readFileSync(filepath), {
    "Content-Type": contentType,
    ...extra,
  });
}

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("invalid json"), { statusCode: 400 }));
      }
    });

    req.on("error", reject);
  });
}

function bearer(req) {
  const value = String(req.headers.authorization || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function cleanSubject(value) {
  const s = String(value || "").trim();
  return /^[A-Za-z0-9_.:@-]{1,128}$/.test(s) ? s : "";
}

function cleanRequestId(value) {
  const s = String(value || "").trim();
  return /^[A-Za-z0-9_.:-]{0,128}$/.test(s) ? s : "";
}

function subjectCount(subject) {
  return subjectCounts.get(subject) || 0;
}

function incrementSubject(subject) {
  subjectCounts.set(subject, subjectCount(subject) + 1);
}

function decrementSubject(subject) {
  const next = Math.max(0, subjectCount(subject) - 1);
  if (next === 0) subjectCounts.delete(subject);
  else subjectCounts.set(subject, next);
}

function parseTicketProtocol(header) {
  const protocols = String(header || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  if (!protocols.includes("stos.v1")) return "";
  const item = protocols.find(value => value.startsWith("ticket."));
  return item ? item.slice("ticket.".length) : "";
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, service: "stos-gateway" });
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/ui/" || url.pathname === "/ui/stos.html")
    ) {
      const html = fs.readFileSync(UI_FILE, "utf8");
      return send(res, 200, html, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          `default-src 'self'; ` +
          `style-src 'self' 'unsafe-inline'; ` +
          `script-src 'self' 'unsafe-inline'; ` +
          `img-src 'self' data:; ` +
          `connect-src 'self' ${config.publicWssUrl}; ` +
          `object-src 'none'; base-uri 'none'; form-action 'none'; ` +
          `frame-ancestors ${config.frameAncestors}`,
      });
    }

    if (req.method === "GET" && url.pathname === "/assets/xterm.js") {
      return serveFile(res, XTERM_JS, "text/javascript; charset=utf-8", {
        "Cache-Control": "public, max-age=86400",
      });
    }

    if (req.method === "GET" && url.pathname === "/assets/xterm.css") {
      return serveFile(res, XTERM_CSS, "text/css; charset=utf-8", {
        "Cache-Control": "public, max-age=86400",
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/tickets") {
      if (!safeEqual(bearer(req), config.brokerSecret)) {
        return sendJson(res, 401, { error: "unauthorized" });
      }

      const body = await readJson(req);
      const profileId = String(body.profileId || "").trim();
      const subject = cleanSubject(body.subject);
      const requestId = cleanRequestId(body.requestId);

      const profile = config.profiles.get(profileId);
      if (!profile || profile.enabled === false) {
        return sendJson(res, 404, { error: "profile_unavailable" });
      }
      if (!subject) {
        return sendJson(res, 400, { error: "invalid_subject" });
      }
      if (subjectCount(subject) >= config.maxSessionsPerSubject) {
        return sendJson(res, 429, { error: "subject_session_limit" });
      }
      if (activeSessions.size >= config.maxActiveSessions) {
        return sendJson(res, 503, { error: "gateway_session_capacity" });
      }

      const ticket = tickets.issue({ profileId, subject, requestId });

      return sendJson(res, 201, {
        ticket: ticket.token,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        wsUrl: config.publicWssUrl,
        profileId,
        requestId,
      });
    }

    return sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    console.error("http_error", error?.message || error);
    if (!res.headersSent) {
      return sendJson(res, error?.statusCode || 500, { error: "request_failed" });
    }
    res.end();
  }
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: config.maxMessageBytes,
  handleProtocols(protocols) {
    return protocols.has("stos.v1") ? "stos.v1" : false;
  },
});

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/v1/terminal") return socket.destroy();

    const origin = String(req.headers.origin || "");
    if (origin !== config.uiOrigin) return socket.destroy();

    const token = parseTicketProtocol(req.headers["sec-websocket-protocol"]);
    if (!token) return socket.destroy();

    const ticket = tickets.consume(token);
    if (!ticket) return socket.destroy();

    if (activeSessions.size >= config.maxActiveSessions) return socket.destroy();
    if (subjectCount(ticket.subject) >= config.maxSessionsPerSubject) return socket.destroy();

    req.stosTicket = ticket;
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req);
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  const ticket = req.stosTicket;
  const profile = config.profiles.get(ticket.profileId);
  const sessionId = crypto.randomUUID();

  let backend = null;
  let finished = false;

  incrementSubject(ticket.subject);
  activeSessions.set(sessionId, {
    id: sessionId,
    subject: ticket.subject,
    profileId: ticket.profileId,
    openedAt: Date.now(),
  });

  function sendMessage(message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function finish(reason = "closed") {
    if (finished) return;
    finished = true;

    try { backend?.close(); } catch {}
    activeSessions.delete(sessionId);
    decrementSubject(ticket.subject);

    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, String(reason).slice(0, 100));
      }
    } catch {}
  }

  try {
    backend = openProfileSession({
      profile,
      config,
      onData(data) {
        sendMessage({ type: "output", data });
      },
      onExit(info) {
        sendMessage({ type: "exit", ...info });
        finish("backend-exit");
      },
      onError(error) {
        console.error(
          "session_backend_error",
          sessionId,
          ticket.profileId,
          error?.message || error,
        );
        sendMessage({ type: "error", message: "Terminal backend error" });
      },
    });

    sendMessage({
      type: "ready",
      sessionId,
      profileId: ticket.profileId,
      label: profile.label || ticket.profileId,
      mode: profile.type === "podman-test" ? "disposable-test" : profile.type,
    });
  } catch (error) {
    console.error(
      "session_open_error",
      sessionId,
      ticket.profileId,
      error?.message || error,
    );
    sendMessage({ type: "error", message: "Unable to open terminal profile" });
    return finish("open-failed");
  }

  ws.on("message", raw => {
    try {
      const message = JSON.parse(raw.toString("utf8"));

      if (message?.type === "input") {
        const data = String(message.data || "");
        if (Buffer.byteLength(data) > config.maxInputBytes) {
          return sendMessage({ type: "error", message: "Input too large" });
        }
        backend.write(data);
        return;
      }

      if (message?.type === "resize") {
        backend.resize(Number(message.cols), Number(message.rows));
        return;
      }

      if (message?.type === "ping") {
        return sendMessage({ type: "pong", at: Date.now() });
      }

      if (message?.type === "close") {
        return finish("client-close");
      }
    } catch {
      sendMessage({ type: "error", message: "Invalid client message" });
    }
  });

  ws.on("close", () => finish("websocket-close"));
  ws.on("error", () => finish("websocket-error"));
});

const pruneTimer = setInterval(() => tickets.prune(), 15000);
pruneTimer.unref();

server.listen(config.port, config.host, () => {
  console.log(`STOS Gateway listening on http://${config.host}:${config.port}`);
});
