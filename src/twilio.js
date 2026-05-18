import { createHmac, timingSafeEqual } from "node:crypto";

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim();
/** E.g. whatsapp:+14155238886 (sandbox) or whatsapp:+1… for your approved sender */
const whatsappFromEnv = process.env.TWILIO_WHATSAPP_FROM?.trim();

export function twilioConfigured() {
  if (!accountSid || !authToken) {
    return false;
  }
  // SMS needs TWILIO_PHONE_NUMBER; WhatsApp can use TWILIO_WHATSAPP_FROM only, or phone + implied prefix
  return Boolean(fromNumber || whatsappFromEnv);
}

function outboundFromForRecipient(to) {
  const dest = to.trim();
  const isWhatsApp = dest.toLowerCase().startsWith("whatsapp:");

  if (!isWhatsApp) {
    if (!fromNumber) {
      throw new Error("TWILIO_PHONE_NUMBER is required for SMS replies");
    }
    return fromNumber;
  }

  if (whatsappFromEnv) {
    return whatsappFromEnv;
  }

  if (fromNumber) {
    const f = fromNumber.trim();
    if (f.toLowerCase().startsWith("whatsapp:")) {
      return f;
    }
    return `whatsapp:${f}`;
  }

  throw new Error(
    "Set TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886) or TWILIO_PHONE_NUMBER for WhatsApp replies",
  );
}

export function parseTwilioForm(bodyString) {
  const params = new URLSearchParams(bodyString);
  const out = {};
  for (const [k, v] of params) {
    out[k] = v;
  }
  return out;
}

export function buildTwilioSignaturePayload(fullUrl, postParams) {
  let data = fullUrl;
  for (const key of Object.keys(postParams).sort()) {
    data += key + (postParams[key] ?? "");
  }
  return data;
}

export function verifyTwilioSignature(fullUrl, postParams, signatureHeader, token) {
  if (!token || !signatureHeader) {
    return false;
  }

  const payload = buildTwilioSignaturePayload(fullUrl, postParams);
  const expected = createHmac("sha1", token).update(payload, "utf8").digest("base64");

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signatureHeader, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyTwilioWebhookRequest(fullUrl, postParams, signatureHeader) {
  return verifyTwilioSignature(fullUrl, postParams, signatureHeader, authToken);
}

/** Normalize whatsapp:+15551234567 and +15551234567 for OWNER_SMS checks */
export function canonicalTwilioAddress(addr) {
  const t = (addr ?? "").trim();
  const lower = t.toLowerCase();
  if (lower.startsWith("whatsapp:")) {
    return t.slice("whatsapp:".length).trim();
  }
  return t;
}

export function twilioWebhookUrl(request, pathname) {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (base) {
    return `${base}${pathname}`;
  }

  const protoHeader = request.headers["x-forwarded-proto"];
  const proto =
    protoHeader?.split(",")[0]?.trim().toLowerCase() ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const host = request.headers.host || "localhost";
  return `${proto}://${host}${pathname}`;
}

export async function sendTwilioSms(to, text) {
  if (!twilioConfigured()) {
    throw new Error(
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required, plus TWILIO_PHONE_NUMBER (SMS) and/or TWILIO_WHATSAPP_FROM (WhatsApp)",
    );
  }

  const from = outboundFromForRecipient(to);

  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: text.slice(0, 1600),
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Twilio send failed: ${response.status} ${errBody}`);
  }

  return response.json();
}
