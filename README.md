# Personal WhatsApp Assistant

This is a minimal WhatsApp-based personal assistant using the official Meta WhatsApp Cloud API and the OpenAI Responses API.

## What It Does

- Receives WhatsApp messages through a Meta webhook.
- Replies through the WhatsApp Cloud API.
- Uses OpenAI for assistant responses.
- Stores simple durable memory in `data/memory.json`.
- Restricts access to one WhatsApp sender when `OWNER_WHATSAPP_ID` is set.

## Why Meta Cloud API

For a personal assistant, the direct Meta Cloud API path avoids adding Twilio as another provider. It still means WhatsApp/Meta and your backend process the messages, so do not treat this as a fully private local-only system.

## Setup

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Fill in:

```bash
OPENAI_API_KEY=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
```

3. Start the server:

```bash
npm run dev
```

4. Expose your local server with an HTTPS tunnel such as ngrok or Cloudflare Tunnel:

```bash
ngrok http 3000
```

5. In Meta Developer settings, configure the webhook callback URL:

```text
https://your-public-url/webhook
```

Use the same `WHATSAPP_VERIFY_TOKEN` from `.env`.

6. Send a WhatsApp message to the test/business number. The server will log the sender ID. Put that value into:

```bash
OWNER_WHATSAPP_ID=
```

Then restart the server.

## Memory Commands

Send these through WhatsApp:

```text
remember I prefer quiet restaurants
what do you remember about me?
forget memory-id
```

The assistant also receives your stored memory as context for normal messages.

## Next Integrations

The next useful additions are:

- Google OAuth
- Gmail summaries
- Google Calendar daily briefings
- proactive scheduled WhatsApp messages
- encrypted database storage instead of JSON
