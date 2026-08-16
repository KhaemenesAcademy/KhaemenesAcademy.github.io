import { requestStosTicket } from "backend/stos-broker.web";

// Wix HTML Component element ID: #stosFrame
$w.onReady(() => {
  const frame = $w("#stosFrame");

  frame.onMessage(async (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;

    if (message.type === "stos:ready") {
      console.log(`STOS iframe ready · v${message.version || "unknown"}`);
      return;
    }

    if (message.type !== "stos:ticket-request") return;

    const requestId = String(message.requestId || "");
    const profileId = String(message.profileId || "");

    try {
      const result = await requestStosTicket(profileId, requestId);
      frame.postMessage({
        type: "stos:ticket",
        ...result,
      });
    } catch (error) {
      frame.postMessage({
        type: "stos:ticket",
        requestId,
        profileId,
        error: "Ticket request denied",
      });
      console.error("STOS ticket request failed", error);
    }
  });
});
