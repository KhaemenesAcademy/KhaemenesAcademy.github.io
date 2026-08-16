import { Permissions, webMethod } from "wix-web-module";
import { fetch } from "wix-fetch";
import { secrets } from "wix-secrets-backend.v2";
import { elevate } from "wix-auth";

const elevatedGetSecretValue = elevate(secrets.getSecretValue);

// Public URL only. Replace with the deployed gateway URL.
const GATEWAY_TICKET_URL = "https://terminal.example.com/v1/tickets";
const BROKER_SECRET_NAME = "STOS_BROKER_SHARED_SECRET";

const ALLOWED_PROFILES = new Set([
  "terminal-1",
  "terminal-2",
  "terminal-3",
  "terminal-4",
  "terminal-5",
  "terminal-6",
  "terminal-7",
  "test",
]);

function extractSecretValue(result) {
  if (typeof result === "string") return result;
  if (typeof result?.value === "string") return result.value;
  if (typeof result?.secret?.value === "string") return result.secret.value;
  throw new Error("Wix Secrets Manager returned no secret value");
}

export const requestStosTicket = webMethod(
  Permissions.Admin,
  async (profileId, requestId) => {
    const profile = String(profileId || "").trim().toLowerCase();
    if (!ALLOWED_PROFILES.has(profile)) {
      throw new Error("Terminal profile is not allowed");
    }

    const secretResult = await elevatedGetSecretValue(BROKER_SECRET_NAME);
    const brokerSecret = extractSecretValue(secretResult);

    const response = await fetch(GATEWAY_TICKET_URL, {
      method: "post",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${brokerSecret}`,
      },
      body: JSON.stringify({
        profileId: profile,
        requestId: String(requestId || ""),
        subject: "wix-admin",
      }),
    });

    if (!response.ok) {
      throw new Error(`Gateway ticket request failed (${response.status})`);
    }

    const ticket = await response.json();

    // Only a short-lived one-use browser ticket leaves the Wix backend.
    return {
      ticket: ticket.ticket,
      expiresAt: ticket.expiresAt,
      wsUrl: ticket.wsUrl,
      profileId: ticket.profileId,
      requestId: ticket.requestId,
    };
  },
);
