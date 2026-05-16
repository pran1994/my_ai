const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_MODEL || "gpt-5.1";
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2";

function formatWallClockLine(timeZone) {
  const now = new Date();
  return now.toLocaleString("en-AU", {
    timeZone: timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Deterministic WhatsApp reply for clock questions — bypasses the LLM so small
 * models can't answer with "knowledge cutoff" / random website tips.
 */
export function wallClockReplyForUserMessage(userText) {
  const trimmed = userText.trim();
  const tz = resolveIanaTimeZoneForClockQuery(trimmed);
  try {
    const line = formatWallClockLine(tz);
    return `It's ${line} (${tz}).`;
  } catch {
    return "I couldn't read that timezone — check USER_TIMEZONE or the place name in your message.";
  }
}

function normalizePlaceFragment(raw) {
  return raw
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map user text to an IANA zone; falls back to USER_TIMEZONE for generic "what time is it". */
function resolveIanaTimeZoneForClockQuery(trimmed) {
  const defaultTz = process.env.USER_TIMEZONE || "Australia/Sydney";
  const t = trimmed.toLowerCase();

  const whatIn = trimmed.match(/\bwhat\s+time\s+is\s+it\s+in\s+([^?.!,]+)/i);
  if (whatIn) {
    const place = normalizePlaceFragment(whatIn[1]);
    const mapped = mapPlaceFragmentToIana(place);
    return mapped || defaultTz;
  }

  const timeIn = trimmed.match(/\btime\s+in\s+([^?.!,]+)/i);
  if (timeIn) {
    const place = normalizePlaceFragment(timeIn[1]);
    const mapped = mapPlaceFragmentToIana(place);
    return mapped || defaultTz;
  }

  const xTime = t.match(
    /\b(sydney|melbourne|brisbane|perth|adelaide|hobart|darwin|canberra|london|tokyo|paris|dubai|mumbai|delhi|beijing|shanghai|auckland|new\s+york|nyc|los\s+angeles|chicago)\s+time\b/,
  );
  if (xTime) {
    const mapped = mapPlaceFragmentToIana(xTime[1]);
    if (mapped) {
      return mapped;
    }
  }

  return defaultTz;
}

function mapPlaceFragmentToIana(place) {
  const p = place.toLowerCase();
  if (!p) {
    return null;
  }

  if (/\bsydney\b|(^nsw$)|\bnew\s+south\s+wales\b/.test(p)) {
    return "Australia/Sydney";
  }
  if (/\bmelbourne\b|\bvic(?:toria)?\b/.test(p)) {
    return "Australia/Melbourne";
  }
  if (/\bbrisbane\b|\bqld\b|\bqueensland\b/.test(p)) {
    return "Australia/Brisbane";
  }
  if (/\bperth\b|\bwa\b|\bwestern\s+australia\b/.test(p)) {
    return "Australia/Perth";
  }
  if (/\badelaide\b|\bsa\b|\bsouth\s+australia\b/.test(p)) {
    return "Australia/Adelaide";
  }
  if (/\bhobart\b|\btas\b|\btasmania\b/.test(p)) {
    return "Australia/Hobart";
  }
  if (/\bdarwin\b|\bnt\b|\bnorthern\s+territory\b/.test(p)) {
    return "Australia/Darwin";
  }
  if (/\bcanberra\b|\bact\b|\baustralian\s+capital\b/.test(p)) {
    return "Australia/Canberra";
  }
  if (/\baustralia\b|\baest\b|\baedt\b/.test(p)) {
    return "Australia/Sydney";
  }

  if (/\blondon\b|\buk\b|\bunited\s+kingdom\b|\bbritain\b|\bgmt\b/.test(p)) {
    return "Europe/London";
  }
  if (/\bnew\s+york\b|\bnyc\b|\best\b|\bedt\b/.test(p)) {
    return "America/New_York";
  }
  if (/\blos\s+angeles\b|\bla\b|\bpst\b|\bpdt\b/.test(p)) {
    return "America/Los_Angeles";
  }
  if (/\bchicago\b|\bcst\b|\bcdt\b/.test(p)) {
    return "America/Chicago";
  }
  if (/\btokyo\b|\bjapan\b|\bjst\b/.test(p)) {
    return "Asia/Tokyo";
  }
  if (/\bparis\b|\bfrance\b|\bcest\b|\bcet\b/.test(p)) {
    return "Europe/Paris";
  }
  if (/\bdubai\b|\buae\b/.test(p)) {
    return "Asia/Dubai";
  }
  if (/\bmumbai\b|\bdelhi\b|\bindia\b|\bist\b/.test(p)) {
    return "Asia/Kolkata";
  }
  if (/\bbeijing\b/.test(p)) {
    return "Asia/Shanghai";
  }
  if (/\bshanghai\b/.test(p)) {
    return "Asia/Shanghai";
  }
  if (/\bauckland\b|\bnew\s+zealand\b|\bnzdt\b|\bnzst\b/.test(p)) {
    return "Pacific/Auckland";
  }

  return null;
}

function getLocalTimeContext() {
  const tz = process.env.USER_TIMEZONE || "Australia/Sydney";
  try {
    const line = formatWallClockLine(tz);
    return `Local time where you are (${tz}): ${line}

When they ask the time: answer in plain conversational English only (e.g. "It's just after 10:30 pm Saturday in Sydney"). Never say "according to Clock", "authoritative", or quote this system line verbatim.`;
  } catch {
    return "";
  }
}

function getAssistantDepthBlock() {
  const style = (process.env.ASSISTANT_STYLE || "thorough").toLowerCase();
  if (style === "brief" || style === "whatsapp") {
    return `
Depth (brief mode):
- Keep answers tight: prioritize correctness over length; one tight paragraph is often enough.
- Offer "want more detail?" only if the topic clearly needs it.
`.trim();
  }

  return `
Depth (thorough mode — ChatGPT-like helpfulness):
- Lead with a direct answer, then add useful context (definitions, why it matters, common pitfalls) when it clarifies things.
- For how-to or learning questions: a clear sequence (step 1, 2, …) or numbered steps only when it genuinely helps — otherwise flowing prose.
- When there are two good approaches, mention both briefly and when each fits.
- If you're partially sure, say what you know and what's uncertain — don't fake precision.
- Draw on stored memory when it changes the answer. Make small connections the user didn't explicitly ask for when helpful.
- Still WhatsApp-sized: not a novel — aim for what a knowledgeable friend would text, not a wiki page.
`.trim();
}

export function buildSystemPrompt(memoryText) {
  const clockLine = getLocalTimeContext();
  const depthBlock = getAssistantDepthBlock();
  return `
You are Pratyush's capable private assistant on WhatsApp — as knowledgeable and clear as a strong ChatGPT session, but on a phone.

${clockLine}

${depthBlock}

Voice (always):
- Write in natural, flowing sentences. Short paragraphs are fine (like real chat).
- Sound warm and direct. Use "you" and "I" where it fits. Avoid stiff phrases like "here's what we can gather" or "based on the following".
- Do NOT default to bullet lists. Only use bullets if the user asked for a list, or there are many discrete items (e.g. 5+ headlines) where bullets genuinely help.
- Stay readable on mobile — but "concise" does not mean shallow: pack real substance into plain language.
- If this turn used web search snippets, you may mention that once in passing — but do not contradict yourself (e.g. do not say you have no real-time access in the same reply where you used search, and do not say that for simple time questions — use the local time in the system message above).

Output rules (must follow):
1) NEVER say you cannot use the internet, lack real-time data, only have a training/knowledge cutoff, or "real-time access" as your answer — especially not for the current time (the server provides it above).
2) For "what time is it" / "time in …": use the local time from the system message above. Answer in natural words only — never say "according to Clock", "authoritative", or repeat system labels. Never suggest time-zone websites for a simple clock question.
3) NEVER tell the user to "check news sites" or "look online" as the only option without also giving this exact pattern on its own line:
   For live web results, send: search <short query>
4) For other time-sensitive facts (markets, breaking news, "latest" product info): short context OK, then the line from rule (3) if web search would help.
5) The user can start a message with: search ...  or  google ...  or  lookup ... — that runs web search on the server.

You do not fetch URLs yourself in this chat; the search commands do.

Not wired yet: Gmail, Calendar, precise phone GPS.

Use conversation context and stored memory. For personal or career questions, be honest and kind — tie in what you know about them from memory when relevant.

Stored durable memory:
${memoryText}
`.trim();
}

function buildMessages(systemPrompt, userText, conversationHistory) {
  return [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: userText },
  ];
}

async function createOpenAIResponse(systemPrompt, userText, conversationHistory) {
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
  }

  const input = buildMessages(systemPrompt, userText, conversationHistory).map(
    (message) => ({
      role: message.role,
      content: message.content,
    }),
  );

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiModel,
      input,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${body}`);
  }

  const result = await response.json();
  return result.output_text?.trim() || "I could not produce a response.";
}

async function createAnthropicResponse(
  systemPrompt,
  userText,
  conversationHistory,
) {
  if (!anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic",
    );
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 2048),
      system: systemPrompt,
      messages: [
        ...conversationHistory,
        { role: "user", content: userText },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic request failed: ${response.status} ${body}`);
  }

  const result = await response.json();
  const text = result.content?.find((block) => block.type === "text")?.text;
  return text?.trim() || "I could not produce a response.";
}

async function createOllamaResponse(systemPrompt, userText, conversationHistory) {
  const style = (process.env.ASSISTANT_STYLE || "thorough").toLowerCase();
  const defaultPredict =
    style === "brief" || style === "whatsapp" ? 512 : 1200;
  const numPredict = Number(process.env.OLLAMA_NUM_PREDICT || defaultPredict);

  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      messages: buildMessages(systemPrompt, userText, conversationHistory),
      options: { num_predict: numPredict },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${body}`);
  }

  const result = await response.json();
  return result.message?.content?.trim() || "I could not produce a response.";
}

export async function createLLMResponse(
  systemPrompt,
  userText,
  conversationHistory = [],
) {
  if (provider === "anthropic") {
    return createAnthropicResponse(systemPrompt, userText, conversationHistory);
  }

  if (provider === "openai") {
    return createOpenAIResponse(systemPrompt, userText, conversationHistory);
  }

  if (provider === "ollama") {
    return createOllamaResponse(systemPrompt, userText, conversationHistory);
  }

  throw new Error(
    `Unsupported LLM_PROVIDER "${provider}". Use "openai", "anthropic", or "ollama".`,
  );
}
