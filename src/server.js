import { createServer } from "node:http";
import { URL } from "node:url";
import { handleAssistantMessage } from "./agent.js";
import { hasProcessedMessage, markMessageProcessed } from "./dedup.js";
import {
  extractIncomingMessages,
  sendWhatsAppText,
  verifyMetaSignature,
} from "./whatsapp.js";
import {
  canonicalTwilioAddress,
  parseTwilioForm,
  sendTwilioSms,
  twilioConfigured,
  twilioWebhookUrl,
  verifyTwilioWebhookRequest,
} from "./twilio.js";

const port = Number(process.env.PORT || 3000);
// Render routes public HTTP only to 0.0.0.0. RENDER=true is set on all Render services.
const onRender = process.env.RENDER === "true";
const host =
  process.env.HOST ||
  (process.env.NODE_ENV === "production" || onRender ? "0.0.0.0" : "127.0.0.1");
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
const ownerWhatsAppId = process.env.OWNER_WHATSAPP_ID;
const ownerSms = process.env.OWNER_SMS?.trim();
const inFlightMessageIds = new Set();

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function handleWebhookVerification(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const mode = url.searchParams.get("hub.mode");
  const modeOk = (mode ?? "").toLowerCase() === "subscribe";
  const token = url.searchParams.get("hub.verify_token")?.trim();
  const challenge = url.searchParams.get("hub.challenge");

  const ok = modeOk && token && verifyToken && token === verifyToken;

  console.log(
    JSON.stringify({
      event: "webhook_verify_attempt",
      ok,
      hub_mode: mode ?? null,
      has_hub_verify_token: Boolean(token),
      has_hub_challenge: Boolean(challenge),
      server_has_verify_token: Boolean(verifyToken),
      ua: request.headers["user-agent"] ?? null,
    }),
  );

  if (process.env.WEBHOOK_DEBUG === "1" && !ok) {
    console.log(
      JSON.stringify({
        event: "webhook_verify_debug",
        server_token_len: verifyToken?.length ?? 0,
        query_token_len: token?.length ?? 0,
        first_codepoint_match:
          verifyToken && token
            ? verifyToken.codePointAt(0) === token.codePointAt(0)
            : null,
      }),
    );
  }

  if (ok) {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(challenge ?? "");
    return;
  }

  console.warn(
    JSON.stringify({
      event: "webhook_verify_failed",
      reason: !verifyToken
        ? "WHATSAPP_VERIFY_TOKEN is not set on the server"
        : !modeOk
          ? "hub.mode is not subscribe"
          : !token
            ? "hub.verify_token missing in query"
            : "hub.verify_token does not match WHATSAPP_VERIFY_TOKEN",
    }),
  );
  response.writeHead(403, { "Content-Type": "text/plain" });
  response.end("Forbidden");
}

async function handleIncomingWebhook(request, response) {
  const rawBody = await readRequestBody(request);
  const signature = request.headers["x-hub-signature-256"];

  if (!verifyMetaSignature(rawBody, signature)) {
    response.writeHead(401, { "Content-Type": "text/plain" });
    response.end("Invalid signature");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    console.error("Webhook body was not valid JSON", error);
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("EVENT_RECEIVED");
    return;
  }

  const messages = extractIncomingMessages(payload);

  if (messages.length === 0) {
    console.log(
      JSON.stringify({
        event: "webhook_received",
        object: payload.object,
        note: "no text messages in payload (status update or unsubscribed field?)",
      }),
    );
  }

  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("EVENT_RECEIVED");

  for (const message of messages) {
    if (!message.text.trim()) {
      continue;
    }

    if (
      inFlightMessageIds.has(message.id) ||
      (await hasProcessedMessage(message.id))
    ) {
      console.log(`Skipping duplicate webhook for message ${message.id}`);
      continue;
    }

    inFlightMessageIds.add(message.id);
    console.log(
      JSON.stringify({
        event: "incoming_message",
        from: message.from,
        text: message.text,
      }),
    );

    if (ownerWhatsAppId && message.from !== ownerWhatsAppId) {
      console.warn(`Ignoring message from non-owner sender: ${message.from}`);
      continue;
    }

    try {
      const reply = await handleAssistantMessage(message.text);
      await sendWhatsAppText(message.from, reply);
      await markMessageProcessed(message.id);
    } catch (error) {
      console.error(error);
      try {
        await sendWhatsAppText(
          message.from,
          "I hit an internal error while responding.",
        );
        await markMessageProcessed(message.id);
      } catch (sendError) {
        console.error(sendError);
      }
    } finally {
      inFlightMessageIds.delete(message.id);
    }
  }
}

async function handleTwilioSmsWebhook(request, response) {
  if (!twilioConfigured()) {
    sendJson(response, 404, { error: "Twilio is not configured" });
    return;
  }

  const rawBody = await readRequestBody(request);
  const bodyText = rawBody.toString("utf8");
  const params = parseTwilioForm(bodyText);
  const smsPath = "/sms";
  const fullUrl = twilioWebhookUrl(request, smsPath);
  const signature = request.headers["x-twilio-signature"];

  if (!verifyTwilioWebhookRequest(fullUrl, params, signature)) {
    console.warn(
      JSON.stringify({
        event: "twilio_webhook_verify_failed",
        hint: "URL must match Messaging webhook in Twilio (set PUBLIC_BASE_URL if behind a proxy).",
      }),
    );
    response.writeHead(403, { "Content-Type": "text/plain" });
    response.end("Forbidden");
    return;
  }

  const from = params.From?.trim();
  const text = params.Body?.trim() || "";
  const messageId = params.MessageSid || "";

  if (!from || !text || !messageId) {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("");
    return;
  }

  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("");

  const dedupId = `twilio:${messageId}`;

  if (
    inFlightMessageIds.has(dedupId) ||
    (await hasProcessedMessage(dedupId))
  ) {
    return;
  }

  inFlightMessageIds.add(dedupId);

  console.log(
    JSON.stringify({
      event: "incoming_twilio",
      channel: from.toLowerCase().startsWith("whatsapp:") ? "whatsapp" : "sms",
      from,
      textLength: text.length,
    }),
  );

  if (
    ownerSms &&
    canonicalTwilioAddress(from) !== canonicalTwilioAddress(ownerSms)
  ) {
    console.warn(`Ignoring Twilio message from non-owner sender: ${from}`);
    inFlightMessageIds.delete(dedupId);
    return;
  }

  try {
    const reply = await handleAssistantMessage(text);
    await sendTwilioSms(from, reply);
    await markMessageProcessed(dedupId);
  } catch (error) {
    console.error(error);
    try {
      await sendTwilioSms(
        from,
        "I hit an internal error while responding.",
      );
      await markMessageProcessed(dedupId);
    } catch (sendError) {
      console.error(sendError);
    }
  } finally {
    inFlightMessageIds.delete(dedupId);
  }
}

function webhookPathname(url) {
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const path = webhookPathname(url);

    if (request.method === "GET" && path === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && path === "/webhook") {
      await handleWebhookVerification(request, response);
      return;
    }

    if (request.method === "POST" && path === "/webhook") {
      await handleIncomingWebhook(request, response);
      return;
    }

    if (request.method === "POST" && path === "/sms") {
      await handleTwilioSmsWebhook(request, response);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

function logStartupConfig() {
  const llmProvider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  const required = [
    ["WHATSAPP_VERIFY_TOKEN", verifyToken],
    ["WHATSAPP_ACCESS_TOKEN", process.env.WHATSAPP_ACCESS_TOKEN],
    ["WHATSAPP_PHONE_NUMBER_ID", process.env.WHATSAPP_PHONE_NUMBER_ID],
  ];

  if (llmProvider === "anthropic") {
    required.push(["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY]);
  } else if (llmProvider === "openai") {
    required.push(["OPENAI_API_KEY", process.env.OPENAI_API_KEY]);
  } else if (llmProvider === "ollama") {
    console.log(
      `Ollama: ${process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"} model ${process.env.OLLAMA_MODEL || "llama3.2"}`,
    );
  }

  if (process.env.OLLAMA_EMBED_MODEL?.trim()) {
    console.log(
      `Memory embeddings: ${process.env.OLLAMA_EMBED_MODEL} @ ${process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"}`,
    );
    if (llmProvider !== "ollama") {
      console.warn(
        "OLLAMA_EMBED_MODEL is set: keep Ollama running for /api/embeddings even when using a cloud chat provider.",
      );
    }
  }

  console.log(`LLM provider: ${llmProvider}`);

  for (const [name, value] of required) {
    if (!value) {
      console.warn(`${name} is not set.`);
    }
  }

  if (llmProvider === "ollama") {
    console.warn(
      "Ensure Ollama is running (ollama serve or the Ollama app) before sending WhatsApp messages.",
    );
  }

  if (!process.env.META_APP_SECRET) {
    console.warn(
      "META_APP_SECRET is not set; webhook signature verification is disabled.",
    );
  }

  if (!ownerWhatsAppId) {
    console.warn(
      "OWNER_WHATSAPP_ID is not set; all senders can use the assistant until you lock it down.",
    );
  }

  if (twilioConfigured()) {
    console.log(
      "Twilio Messaging: POST /sms — SMS and/or WhatsApp (same webhook URL in Twilio Console).",
    );
  } else if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    if (
      !process.env.TWILIO_PHONE_NUMBER?.trim() &&
      !process.env.TWILIO_WHATSAPP_FROM?.trim()
    ) {
      console.warn(
        "Twilio: set TWILIO_PHONE_NUMBER (SMS) and/or TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886).",
      );
    }
  } else if (
    process.env.TWILIO_ACCOUNT_SID ||
    process.env.TWILIO_AUTH_TOKEN ||
    process.env.TWILIO_PHONE_NUMBER ||
    process.env.TWILIO_WHATSAPP_FROM
  ) {
    console.warn(
      "Twilio env is incomplete; need TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.",
    );
  }

  if (!ownerSms && twilioConfigured()) {
    console.warn(
      "OWNER_SMS is not set; any sender who reaches your Twilio SMS/WhatsApp number can use the assistant.",
    );
  }
}

logStartupConfig();

server.listen(port, host, () => {
  console.log(`WhatsApp assistant listening on http://${host}:${port}`);
  console.log(`Webhook URL path: /webhook`);
  console.log(`Twilio Messaging webhook path: /sms (SMS + WhatsApp)`);
});
