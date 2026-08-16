import crypto from "node:crypto";

export class TicketStore {
  constructor({ ttlMs }) {
    this.ttlMs = ttlMs;
    this.tickets = new Map();
  }

  issue({ profileId, subject, requestId = "" }) {
    this.prune();
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const record = Object.freeze({
      token,
      profileId,
      subject,
      requestId: String(requestId || ""),
      issuedAt: now,
      expiresAt: now + this.ttlMs
    });
    this.tickets.set(token, record);
    return record;
  }

  consume(token) {
    this.prune();
    const record = this.tickets.get(token);
    if (!record) return null;
    this.tickets.delete(token);
    return record.expiresAt > Date.now() ? record : null;
  }

  prune() {
    const now = Date.now();
    for (const [token, record] of this.tickets) {
      if (record.expiresAt <= now) this.tickets.delete(token);
    }
  }
}
