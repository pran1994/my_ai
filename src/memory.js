import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createLLMResponse, createOllamaEmbedding, isOllamaEmbeddingEnabled } from "./llm.js";
import { isProbablyClockQuestion } from "./search-intent.js";

const memoryPath = resolve(process.env.MEMORY_FILE || "./data/memory.json");
const conversationLimit = Number(process.env.CONVERSATION_HISTORY_LIMIT || 10);
const maxHistoryChars = Number(process.env.CONVERSATION_MAX_CHARS || 600);
const autoLearnEnabled = process.env.AUTO_LEARN_FACTS !== "false";
const memoryRetrievalTopK = Number(process.env.MEMORY_RETRIEVAL_TOP_K || 12);
const memoryRetrievalMinFacts = Number(process.env.MEMORY_RETRIEVAL_MIN_FACTS || 8);

async function ensureMemoryFile() {
  await mkdir(dirname(memoryPath), { recursive: true });

  try {
    await readFile(memoryPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    await writeFile(
      memoryPath,
      JSON.stringify({ facts: [], conversations: [] }, null, 2),
      "utf8",
    );
  }
}

function truncate(text, max = maxHistoryChars) {
  const value = text.trim();
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 3)}...`;
}

export async function loadMemory() {
  await ensureMemoryFile();
  const raw = await readFile(memoryPath, "utf8");
  return JSON.parse(raw);
}

export async function saveMemory(memory) {
  await ensureMemoryFile();
  await writeFile(memoryPath, JSON.stringify(memory, null, 2), "utf8");
}

export async function addMemoryFact(text, source = "manual") {
  const memory = await loadMemory();
  const fact = {
    id: randomUUID(),
    text: text.trim(),
    source,
    createdAt: new Date().toISOString(),
  };

  if (isOllamaEmbeddingEnabled() && fact.text) {
    try {
      fact.embedding = await createOllamaEmbedding(fact.text);
      fact.embeddedWithModel = process.env.OLLAMA_EMBED_MODEL.trim();
    } catch (error) {
      console.error("addMemoryFact embedding:", error.message);
    }
  }

  memory.facts.unshift(fact);
  await saveMemory(memory);
  return fact;
}

export async function removeMemoryFact(id) {
  const memory = await loadMemory();
  const before = memory.facts.length;
  memory.facts = memory.facts.filter((fact) => fact.id !== id);
  await saveMemory(memory);
  return memory.facts.length !== before;
}

export async function rememberConversation(userText, assistantText) {
  const memory = await loadMemory();
  memory.conversations.unshift({
    id: randomUUID(),
    userText,
    assistantText,
    createdAt: new Date().toISOString(),
  });
  memory.conversations = memory.conversations.slice(0, 30);
  await saveMemory(memory);
}

export function formatMemoryForPrompt(memory) {
  if (!memory.facts.length) {
    return "No durable personal memory has been stored yet.";
  }

  return memory.facts
    .slice(0, 50)
    .map((fact) => `- (${fact.id}) ${fact.text}`)
    .join("\n");
}

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) {
    return -1;
  }

  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) {
    return 0;
  }

  return dot / denom;
}

function factNeedsEmbedding(fact) {
  if (!isOllamaEmbeddingEnabled()) {
    return false;
  }

  const model = process.env.OLLAMA_EMBED_MODEL.trim();
  if (!Array.isArray(fact.embedding) || fact.embedding.length === 0) {
    return true;
  }

  return fact.embeddedWithModel !== model;
}

async function ensureFactEmbeddings(memory) {
  if (!isOllamaEmbeddingEnabled()) {
    return;
  }

  const model = process.env.OLLAMA_EMBED_MODEL.trim();
  const needs = memory.facts.filter(factNeedsEmbedding);
  if (needs.length === 0) {
    return;
  }

  for (const fact of needs) {
    try {
      fact.embedding = await createOllamaEmbedding(fact.text);
      fact.embeddedWithModel = model;
    } catch (error) {
      console.error(`Embedding fact ${fact.id}:`, error.message);
      delete fact.embedding;
      delete fact.embeddedWithModel;
    }
  }

  await saveMemory(memory);
}

/**
 * Memory block for LLM prompts — uses cosine similarity when OLLAMA_EMBED_MODEL is set
 * and there are more than MEMORY_RETRIEVAL_MIN_FACTS stored facts.
 */
export async function formatMemoryForChat(memory, userQuery) {
  if (!memory.facts.length) {
    return "No durable personal memory has been stored yet.";
  }

  if (!isOllamaEmbeddingEnabled()) {
    return formatMemoryForPrompt(memory);
  }

  await ensureFactEmbeddings(memory);

  if (memory.facts.length <= memoryRetrievalMinFacts) {
    return formatMemoryForPrompt(memory);
  }

  let queryVec;
  try {
    queryVec = await createOllamaEmbedding(userQuery);
  } catch (error) {
    console.error("Query embedding failed:", error.message);
    return formatMemoryForPrompt(memory);
  }

  const scored = memory.facts
    .map((fact) => ({
      fact,
      score:
        Array.isArray(fact.embedding) && fact.embedding.length > 0
          ? cosineSimilarity(queryVec, fact.embedding)
          : -1,
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, memoryRetrievalTopK).map((s) => s.fact);
  const header =
    `(Retrieved ${top.length} facts most relevant to this message; you have ${memory.facts.length} total.)`;
  const lines = top.map((fact) => `- (${fact.id}) ${fact.text}`).join("\n");
  return `${header}\n${lines}`;
}

export function buildConversationMessages(memory, limit = conversationLimit) {
  const turns = memory.conversations.slice(0, limit).reverse();
  const messages = [];

  for (const turn of turns) {
    messages.push({
      role: "user",
      content: truncate(turn.userText),
    });
    messages.push({
      role: "assistant",
      content: truncate(turn.assistantText),
    });
  }

  return messages;
}

function isDuplicateFact(text, existingFacts) {
  const normalized = text.toLowerCase().trim();
  if (!normalized) {
    return true;
  }

  return existingFacts.some((fact) => {
    const existing = fact.text.toLowerCase().trim();
    return (
      existing === normalized ||
      existing.includes(normalized) ||
      normalized.includes(existing)
    );
  });
}

function parseFactsJson(raw) {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function autoLearnFacts(userText, assistantText) {
  if (!autoLearnEnabled) {
    return [];
  }

  if (isProbablyClockQuestion(userText.trim())) {
    return [];
  }

  const memory = await loadMemory();
  const existing = memory.facts.map((fact) => fact.text).join("\n") || "(none)";

  const systemPrompt = `
You extract durable facts about the user for long-term memory.
Rules:
- Return ONLY a JSON array of strings (example: ["User prefers concise replies"])
- Max 3 items; return [] if nothing worth keeping
- Save stable preferences, identity, goals, interests — not one-off questions or small talk
- Return [] for pure time/timezone questions, corrections, or meta lines like "time was corrected" — those are not memory
- Do not duplicate existing facts
- No markdown, no explanation
`.trim();

  const userPrompt = `Existing facts:
${existing}

Latest exchange:
User: ${userText}
Assistant: ${assistantText}

New facts JSON array:`;

  let raw;
  try {
    raw = await createLLMResponse(systemPrompt, userPrompt, []);
  } catch (error) {
    console.error("autoLearnFacts failed:", error.message);
    return [];
  }

  const candidates = parseFactsJson(raw);

  for (const text of candidates) {
    if (isDuplicateFact(text, memory.facts)) {
      continue;
    }

    await addMemoryFact(text, "auto");
    console.log(`Auto-learned fact: ${text}`);
  }
}
