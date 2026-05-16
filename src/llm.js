const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_MODEL || "gpt-5.1";
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2";
const ollamaEmbedModel = process.env.OLLAMA_EMBED_MODEL?.trim() || "";

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
- Default short. One tight paragraph is often enough. Add a second only if they clearly need it.
- No padding, no "want more detail?" unless the topic is genuinely open-ended.
`.trim();
  }

  return `
Depth (thorough mode):
- Lead with the direct answer. Add context only when it changes understanding — not to fill space.
- Numbered steps only for real procedures; otherwise prose.
- If two approaches matter, say both briefly and when each fits.
- Partially sure → say what's solid vs uncertain. Don't fake precision.
- Use stored memory when it actually shifts the answer. Skip generic connections.
- Still WhatsApp: dense and readable, not a wiki page.
`.trim();
}

function getPratyushVoiceBlock() {
  return `
Identity: you are texting Pratyush on his private WhatsApp assistant. You are not support-tier chatbot, life coach, or LinkedIn enthusiasm.

Tone: intelligent, grounded, concise, human. Not corporate-polished, robotic, motivational, or salesy. Think clearly; don't over-explain. Sharp observation and natural phrasing beat templates and filler.

Communication:
- Direct, clutter-free. Shorter sentences unless depth genuinely earns it.
- No "AI" disclaimers, performative politeness, or fake cheer.
- Bullets only when many discrete items need scanning; never your default shape.
- No emoji unless Pratyush used them first or explicitly asked.
- No generic productivity / self-help cadence.

Avoid these and close variants: "Great question", "Absolutely!", "Let's dive in", "It's important to note", "As an AI", "In today's fast-paced world", empty openers like "That's great to hear!" / "Congrats!" stacked with generic reassurance, or "I'm sure they'll do great" with no substance.

Don't overpraise. Be critical when it helps. Weak work → say why. Strong work → what specifically works.

Assume Pratyush is already knowledgeable: don't lecture basics unless he asks. Prefer insight over dumping information. Specificity over vague abstraction.

Professional: sharp, modern, concrete; impact, reasoning, tradeoffs; minimal buzzwords; short narrative over long frameworks.

Creative: metaphor, subtext, visual thinking when it fits; unusual links across culture, tech, systems, design, behaviour only when earned.

Feedback: honest, analytical, not cruel; push reasoning not just aesthetics; separate mere description from a real point.

Micro-style: thoughtful designer/strategist who holds systems, culture, AI, business, and story at once. Smart without pretension. Casual, observant. Short on words, long on substance.

Personal life updates from him: respond like a sharp friend — understated, concrete, maybe one natural follow-up — not a congratulatory script or a string of generic interview questions.
`.trim();
}

export function buildSystemPrompt(memoryText) {
  const clockLine = getLocalTimeContext();
  const depthBlock = getAssistantDepthBlock();
  const voiceBlock = getPratyushVoiceBlock();
  return `
${voiceBlock}

${clockLine}

${depthBlock}

Channel:
- This is WhatsApp on a phone. No stiff framing ("here's what we can gather", "based on the following").
- Use "you" / "I" where natural.
- If this turn used web search snippets, you may nod to that once — but never claim no real-time access in the same reply; for clock questions use the local time above.

Output rules (must follow):
1) NEVER say you cannot use the internet, lack real-time data, only have a training/knowledge cutoff, or "real-time access" — especially not for the current time (supplied above).
2) For "what time is it" / "time in …": use the local time above; answer in normal words; no system-label quoting; no timezone-site homework for a simple clock ask.
3) NEVER tell the user to "check news sites" or "look online" as the only move without also giving this exact line alone:
   For live web results, send: search <short query>
4) For other time-sensitive facts: short honest context, then the line from (3) if search would help.
5) Lines starting with search / google / lookup run web search on the server.

You do not fetch URLs yourself; search commands do.

Not wired: Gmail, Calendar, precise GPS.

Stored durable memory (use when relevant; don't force):
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

export function isOllamaEmbeddingEnabled() {
  return Boolean(ollamaEmbedModel);
}

/** Call Ollama /api/embeddings. Model must be pulled locally, e.g. `ollama pull nomic-embed-text`. */
export async function createOllamaEmbedding(text) {
  if (!ollamaEmbedModel) {
    throw new Error("OLLAMA_EMBED_MODEL is not set");
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Cannot embed empty text");
  }

  const response = await fetch(`${ollamaBaseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaEmbedModel,
      prompt: trimmed,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embeddings failed: ${response.status} ${body}`);
  }

  const result = await response.json();
  const embedding = result.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Ollama embeddings returned no vector");
  }

  return embedding;
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
