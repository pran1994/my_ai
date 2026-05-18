import { loadEnvFile } from "./load-env.js";
import { resolve } from "node:path";

const placeholders = new Set([
  "",
  "replace-with-meta-access-token",
  "replace-with-phone-number-id",
  "replace-with-openai-api-key",
  "replace-with-anthropic-api-key",
  "replace-with-brave-api-key",
  "choose-a-long-random-string",
]);

function status(name, value, { required = true } = {}) {
  const missing = !value || placeholders.has(value);

  if (missing) {
    return required
      ? { name, ok: false, detail: "missing or placeholder" }
      : { name, ok: true, detail: "optional, not set" };
  }

  return { name, ok: true, detail: "set" };
}

async function checkOllama() {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.2";

  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        detail: `Ollama ${response.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = await response.json();
    const names = (data.models || []).map((entry) => entry.name);
    const hasModel = names.some(
      (name) => name === model || name.startsWith(`${model}:`),
    );

    if (!hasModel) {
      return {
        ok: false,
        detail: `running, but model "${model}" not found. Run: ollama pull ${model}`,
      };
    }

    return { ok: true, detail: `running with model ${model}` };
  } catch (error) {
    return {
      ok: false,
      detail: `not reachable at ${baseUrl} (start Ollama app or run: ollama serve)`,
    };
  }
}

async function checkWhatsAppToken() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION || "v24.0";

  if (!accessToken || !phoneNumberId || placeholders.has(accessToken)) {
    return { ok: false, detail: "skipped (token or phone number id missing)" };
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    let hint = "";
    try {
      const err = JSON.parse(body)?.error;
      if (err?.code === 190) {
        hint =
          " → Meta rejected WHATSAPP_ACCESS_TOKEN (Graph API user/page token). This is NOT WHATSAPP_VERIFY_TOKEN. Generate a new access token (WhatsApp → API setup, or Business settings → System users) and replace WHATSAPP_ACCESS_TOKEN in .env and on Render.";
      }
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      detail: `Graph API ${response.status}: ${body.slice(0, 300)}${hint}`,
    };
  }

  const data = await response.json();
  return {
    ok: true,
    detail: `verified (${data.display_phone_number || data.verified_name || "phone number reachable"})`,
  };
}

async function main() {
  const loaded = await loadEnvFile(resolve(".env"), { override: true });

  if (!loaded) {
    console.error("No .env file found. Run: cp .env.example .env");
    process.exit(1);
  }

  console.log(
    "Env: project .env overrides any exported vars with the same name (see scripts/load-env.js).\n",
  );

  const llmProvider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  const llmChecks =
    llmProvider === "anthropic"
      ? [
          status("LLM_PROVIDER", llmProvider),
          status("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY),
        ]
      : llmProvider === "ollama"
        ? [
            status("LLM_PROVIDER", llmProvider),
            status("OLLAMA_MODEL", process.env.OLLAMA_MODEL || "llama3.2", {
              required: false,
            }),
          ]
        : [
            status("LLM_PROVIDER", llmProvider, { required: false }),
            status("OPENAI_API_KEY", process.env.OPENAI_API_KEY),
          ];

  const checks = [
    status("WHATSAPP_VERIFY_TOKEN", process.env.WHATSAPP_VERIFY_TOKEN),
    status("WHATSAPP_ACCESS_TOKEN", process.env.WHATSAPP_ACCESS_TOKEN),
    status("WHATSAPP_PHONE_NUMBER_ID", process.env.WHATSAPP_PHONE_NUMBER_ID),
    ...llmChecks,
    status("META_APP_SECRET", process.env.META_APP_SECRET, { required: false }),
    status("OWNER_WHATSAPP_ID", process.env.OWNER_WHATSAPP_ID, {
      required: false,
    }),
    status("BRAVE_API_KEY", process.env.BRAVE_API_KEY, {
      required: false,
    }),
  ];

  console.log(`LLM provider: ${llmProvider}\n`);
  console.log("Environment\n-----------");
  for (const check of checks) {
    console.log(`${check.ok ? "OK" : "FAIL"}  ${check.name}: ${check.detail}`);
  }

  console.log("\nWhatsApp Cloud API\n------------------");
  console.log(
    "(This call uses WHATSAPP_ACCESS_TOKEN only. Changing WHATSAPP_VERIFY_TOKEN does not affect the line below.)\n",
  );
  const tokenCheck = await checkWhatsAppToken();
  console.log(
    `${tokenCheck.ok ? "OK" : "FAIL"}  access token + phone number id: ${tokenCheck.detail}`,
  );

  let ollamaCheck = { ok: true };
  if (llmProvider === "ollama") {
    console.log("\nOllama\n------");
    ollamaCheck = await checkOllama();
    console.log(
      `${ollamaCheck.ok ? "OK" : "FAIL"}  ${ollamaCheck.detail}`,
    );
  }

  const port = process.env.PORT || "3000";
  console.log("\nNext steps\n----------");
  console.log(`1. Start server: node --env-file=.env src/server.js`);
  console.log(`2. Tunnel HTTPS to port ${port} (ngrok http ${port})`);
  console.log(
    `3. Meta webhook callback: https://<your-tunnel-host>/webhook`,
  );
  console.log(
    `4. Verify token must match WHATSAPP_VERIFY_TOKEN exactly`,
  );
  console.log(`5. Subscribe to the messages field`);
  console.log(
    `6. Local smoke test: node --env-file=.env scripts/smoke-local.js`,
  );
  console.log(
    `7. Send a WhatsApp message, copy logged "from" into OWNER_WHATSAPP_ID, restart`,
  );

  const failed =
    checks.some((check) => !check.ok) ||
    !tokenCheck.ok ||
    (llmProvider === "ollama" && !ollamaCheck.ok);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
