import {
  addMemoryFact,
  autoLearnFacts,
  buildConversationMessages,
  formatMemoryForChat,
  formatMemoryForPrompt,
  loadMemory,
  rememberConversation,
  removeMemoryFact,
} from "./memory.js";
import {
  buildSystemPrompt,
  createLLMResponse,
  wallClockReplyForUserMessage,
} from "./llm.js";
import {
  summarizeFinanceNews,
  summarizeRedditFinance,
  summarizeFullBriefing,
  financeSkillHelp,
} from "./skills/finance-briefing.js";
import { summarizeWebSearch, searchSkillHelp } from "./skills/search-web.js";
import {
  autoWebSearchEnabled,
  isProbablyClockQuestion,
  messageShouldUseWebSearch,
} from "./search-intent.js";

async function chatWithMemory(memory, memoryText, userText) {
  const history = buildConversationMessages(memory);
  const reply = await createLLMResponse(
    buildSystemPrompt(memoryText),
    userText,
    history,
  );
  await rememberConversation(userText, reply);
  void autoLearnFacts(userText, reply).catch((error) => {
    console.error("autoLearnFacts (background):", error.message);
  });
  return reply;
}

export async function handleAssistantMessage(userText) {
  const trimmed = userText.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("remember ")) {
    const text = trimmed.slice("remember ".length).trim();
    if (!text) {
      return "Send: remember <the thing I should remember>";
    }

    const fact = await addMemoryFact(text);
    return `Remembered. ID: ${fact.id}`;
  }

  if (
    lower === "what do you remember about me?" ||
    lower === "what do you remember?" ||
    lower === "memory"
  ) {
    const memory = await loadMemory();
    return formatMemoryForPrompt(memory);
  }

  if (lower.startsWith("forget ")) {
    const id = trimmed.slice("forget ".length).trim();
    if (!id) {
      return "Send: forget <memory-id>";
    }

    const removed = await removeMemoryFact(id);
    return removed ? "Forgot that memory." : "I could not find that memory ID.";
  }

  const memory = await loadMemory();

  if (isProbablyClockQuestion(trimmed)) {
    const reply = wallClockReplyForUserMessage(trimmed);
    await rememberConversation(trimmed, reply);
    return reply;
  }

  if (lower === "skills" || lower === "help finance") {
    return `${financeSkillHelp()}\n\n${searchSkillHelp()}`;
  }

  const memoryText = await formatMemoryForChat(memory, trimmed);

  if (
    lower === "finance news" ||
    lower === "news" ||
    lower === "ft news"
  ) {
    const reply = await summarizeFinanceNews(memoryText);
    await rememberConversation(trimmed, reply);
    return reply;
  }

  if (lower === "reddit finance" || lower === "reddit" || lower === "reddit news") {
    const reply = await summarizeRedditFinance(memoryText);
    await rememberConversation(trimmed, reply);
    return reply;
  }

  if (lower === "briefing" || lower === "finance briefing") {
    const reply = await summarizeFullBriefing(memoryText);
    await rememberConversation(trimmed, reply);
    return reply;
  }

  if (
    lower.startsWith("search ") ||
    lower.startsWith("google ") ||
    lower.startsWith("lookup ")
  ) {
    const prefix = lower.startsWith("google ")
      ? "google "
      : lower.startsWith("lookup ")
        ? "lookup "
        : "search ";
    const query = trimmed.slice(prefix.length).trim();
    if (!query) {
      return "Send: search <your question>\n(examples: search ThaiThae Lidcombe reviews)";
    }

    const reply = await summarizeWebSearch(memoryText, query);
    await rememberConversation(trimmed, reply);
    return reply;
  }

  if (autoWebSearchEnabled() && messageShouldUseWebSearch(trimmed)) {
    const reply = await summarizeWebSearch(memoryText, trimmed);
    await rememberConversation(trimmed, reply);
    return reply;
  }

  return chatWithMemory(memory, memoryText, trimmed);
}
