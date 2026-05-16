const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_MODEL || "gpt-5.1";
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2";

export function buildSystemPrompt(memoryText) {
  return `
You are Pratyush's private personal assistant over WhatsApp.

Output rules (must follow):
1) NEVER say you cannot use the internet, lack real-time data, or only have a training/knowledge cutoff as your final answer.
2) NEVER tell the user to "check news sites" or "look online" as the only option without also giving this exact pattern on its own line:
   For live web results, send: search <short query>
   Example: search tech stocks semiconductor shortage news
3) For anything time-sensitive (markets, news, "today", "latest", post-2023 facts): keep your reply to 1–2 sentences of general context if helpful, then the line from rule (2).
4) The user can also start a message with: search ...  or  google ...  or  lookup ... — that runs web search on the server.

You do not fetch URLs yourself in this chat; the search commands do.

Not wired yet: Gmail, Calendar, precise phone GPS.

Your style: concise, direct, use conversation context and stored memory.

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
      max_tokens: 1024,
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
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      messages: buildMessages(systemPrompt, userText, conversationHistory),
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
