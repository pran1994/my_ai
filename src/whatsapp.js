import { createHmac, timingSafeEqual } from "node:crypto";

const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION || "v24.0";
const appSecret = process.env.META_APP_SECRET;

export function verifyMetaSignature(rawBody, signatureHeader) {
  if (!appSecret) {
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length);

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function extractIncomingMessages(payload) {
  const entries = payload.entry || [];
  const messages = [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value;
      for (const message of value?.messages || []) {
        if (message.type !== "text") {
          continue;
        }

        messages.push({
          id: message.id,
          from: message.from,
          text: message.text?.body || "",
          timestamp: message.timestamp,
        });
      }
    }
  }

  return messages;
}

export async function sendWhatsAppText(to, text) {
  if (!accessToken || !phoneNumberId) {
    throw new Error(
      "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required",
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: text.slice(0, 4000),
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp send failed: ${response.status} ${body}`);
  }

  return response.json();
}
