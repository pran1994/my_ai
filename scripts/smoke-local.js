import { createHmac } from "node:crypto";
import { loadEnvFile } from "./load-env.js";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const appSecret = process.env.META_APP_SECRET;

function signBody(rawBody) {
  if (!appSecret) {
    return {};
  }

  const digest = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return { "x-hub-signature-256": `sha256=${digest}` };
}

async function expectStatus(label, response, expected) {
  const body = await response.text();

  if (response.status !== expected) {
    throw new Error(
      `${label} expected HTTP ${expected}, got ${response.status}: ${body}`,
    );
  }

  return body;
}

async function main() {
  await loadEnvFile();

  if (!verifyToken) {
    throw new Error("WHATSAPP_VERIFY_TOKEN is required for smoke tests");
  }

  console.log(`Smoke testing ${baseUrl}\n`);

  const health = await fetch(`${baseUrl}/health`);
  await expectStatus("GET /health", health, 200);
  console.log("OK  GET /health");

  const challenge = "cursor-smoke-challenge";
  const verifyUrl = new URL("/webhook", baseUrl);
  verifyUrl.searchParams.set("hub.mode", "subscribe");
  verifyUrl.searchParams.set("hub.verify_token", verifyToken);
  verifyUrl.searchParams.set("hub.challenge", challenge);

  const verify = await fetch(verifyUrl);
  const verifyBody = await expectStatus("GET /webhook", verify, 200);

  if (verifyBody !== challenge) {
    throw new Error(
      `GET /webhook challenge mismatch: expected "${challenge}", got "${verifyBody}"`,
    );
  }

  console.log("OK  GET /webhook verification");

  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || "0",
              },
              contacts: [
                {
                  profile: { name: "Smoke Test" },
                  wa_id: "10000000000",
                },
              ],
              messages: [
                {
                  from: process.env.OWNER_WHATSAPP_ID || "10000000000",
                  id: `wamid.smoke.${Date.now()}`,
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  type: "text",
                  text: { body: "smoke test ping" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const rawBody = JSON.stringify(payload);
  const webhook = await fetch(`${baseUrl}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...signBody(rawBody),
    },
    body: rawBody,
  });

  const webhookBody = await expectStatus("POST /webhook", webhook, 200);

  if (webhookBody !== "EVENT_RECEIVED") {
    throw new Error(`POST /webhook unexpected body: ${webhookBody}`);
  }

  console.log("OK  POST /webhook (signed payload accepted)");
  console.log(
    "\nIf the server is running with real tokens, check logs for incoming_message and a WhatsApp reply.",
  );
  console.log(
    "For Meta end-to-end, expose this server with HTTPS and register the public /webhook URL.",
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
