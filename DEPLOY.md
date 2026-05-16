# Deploy the WhatsApp assistant (production)

Goal: **stable `https://…/webhook`** so Meta never talks through ngrok. The app must listen on **`HOST=0.0.0.0`** and use whatever **`PORT`** the platform assigns (or `3000` behind a reverse proxy on a VPS).

## Before you deploy

1. **LLM**
   - **PaaS (plain Node on Render / Railway / Fly):** often **no Ollama** in one process — use **`LLM_PROVIDER=openai`** or **`anthropic`**.
   - **Render + Ollama:** use **`Dockerfile.render-ollama`** (see Option A below) with enough **RAM** and a **persistent disk** for models.
   - **Your own VPS:** install **Ollama** and keep **`LLM_PROVIDER=ollama`** and **`OLLAMA_BASE_URL=http://127.0.0.1:11434`**.

2. **Embeddings:** `OLLAMA_EMBED_MODEL` needs a running Ollama. On PaaS without Ollama, **leave it unset** (memory still works without semantic retrieval).

3. **Disk:** `data/memory.json` and dedup file should live on a **persistent volume/disk** or you lose memory on every redeploy (platform-dependent).

4. **WhatsApp:** use a **long-lived or system user** token in production. Set **`META_APP_SECRET`** and **`OWNER_WHATSAPP_ID`**.

---

## Option A — Render

1. Push this repo to GitHub (no `.env` in git).
2. In Render: **New → Web Service**, connect the repo.
3. **Build:** `npm install` (or set Render’s build command to that; avoid `yarn` unless you commit a `yarn.lock`)  
   **Start:** `npm start` — uses **`node src/server.js`** and reads **environment variables from Render’s dashboard** (no `.env` file on the server).
4. **Environment:** add every variable from `.env.example` (values from your real `.env`). Set:
   - `HOST=0.0.0.0`
   - `NODE_VERSION=22` (or match `engines` in `package.json`)
5. Render assigns **`PORT`** automatically — do not hard-code a conflicting `PORT` in the dashboard unless you know what you’re doing.
6. After deploy, copy the **HTTPS URL** (e.g. `https://your-service.onrender.com`).
7. In **Meta → WhatsApp → Configuration**, set webhook to:

   `https://your-service.onrender.com/webhook`

   Use the same **`WHATSAPP_VERIFY_TOKEN`** you put in Render.

8. **Free tier may spin down** → missed webhooks / delays. For a real bot, use a **paid** instance or a VPS.

Optional: `render.yaml` in this repo is a starting point; you can still create the service from the dashboard only.

### Render + Ollama on the same service (Docker)

Use this when you want **`LLM_PROVIDER=ollama`** (and optional **`OLLAMA_EMBED_MODEL`**) on Render instead of OpenAI/Anthropic.

**Reality check:** `llama3.2` needs **roughly 2GB+ RAM** for the weights; smaller Render instances will **OOM**. Prefer **at least ~4GB** for headroom. **Free / cheap tiers are unlikely to work** for local inference.

1. In Render: **New → Web Service → Build and deploy from Dockerfile** (or use Blueprint `render.yaml`, which points at `Dockerfile.render-ollama`).
2. **Dockerfile path:** `Dockerfile.render-ollama`
3. **Environment variables** (same WhatsApp/Meta keys as local). Important:
   - `HOST=0.0.0.0`
   - `LLM_PROVIDER=ollama`
   - `OLLAMA_BASE_URL=http://127.0.0.1:11434`
   - **First deploy only (slow):** `OLLAMA_PULL_MODELS=llama3.2,nomic-embed-text` (add embed model only if you set `OLLAMA_EMBED_MODEL`).
4. **Persistent disk** (strongly recommended): mount e.g. `/data` and set:
   - `OLLAMA_MODELS=/data/ollama` (Ollama’s model cache — avoids re-download on every redeploy)
   - `MEMORY_FILE=/data/memory.json`
   - `DEDUP_FILE=/data/dedup-processed.json` (or similar path under `/data`)
5. **Health check:** `/health` — the container starts Ollama before Node; the first boot can exceed default timeouts while **`ollama pull`** runs. If Render kills the deploy, temporarily **remove `OLLAMA_PULL_MODELS`**, deploy, shell in and pull once, or **increase instance size** and retry.

The entrypoint script is `scripts/docker-entrypoint-ollama.sh`: it runs **`ollama serve`**, waits for the API, optionally pulls models, then starts **`node src/server.js`**.

---

## Option B — Fly.io (Docker)

1. Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/), run `fly launch` in the repo (uses `Dockerfile`).
2. Set secrets: `fly secrets set WHATSAPP_ACCESS_TOKEN=…` (repeat for all sensitive vars).
3. Set `HOST=0.0.0.0` in `fly.toml` env or secrets; Fly sets `PORT` internally for HTTP services — check Fly docs for the correct internal port mapping (map **internal 3000** to public HTTPS).
4. Attach a **volume** for `/app/data` if you want durable `memory.json`.
5. Point Meta webhook to `https://your-app.fly.dev/webhook`.

---

## Option C — Small VPS + Caddy (full HTTPS)

1. Ubuntu VM, DNS **A record** `bot.example.com` → server IP.
2. Install Node 22+, clone repo, `npm install`.
3. Create `/etc/yourapp.env` with all variables (not world-readable). Include:

   ```
   HOST=0.0.0.0
   PORT=3000
   ```

4. Run with PM2:

   ```bash
   pm2 start "node src/server.js" --name wa --cwd /path/to/repo
   pm2 save && pm2 startup
   ```

   (Load env via systemd `EnvironmentFile=` or `pm2 ecosystem` — same values as `.env`.)

5. Install **Caddy**, reverse proxy **HTTPS** → `127.0.0.1:3000`:

   ```caddy
   bot.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```

6. Meta webhook: `https://bot.example.com/webhook`.

7. Optional: install **Ollama** on the same VPS for local LLM + embeddings.

---

## Verify

- Open `https://your-host/health` → should return `{"ok":true}`.
- Send yourself a WhatsApp message → server logs should show `incoming_message`.

---

## Local vs cloud start

| Command | When |
|--------|------|
| `npm run start:local` | Laptop: loads `.env` via `--env-file=.env` |
| `npm start` | Default / Render / Docker: env vars from the host (`process.env`), **not** from a `.env` file |
