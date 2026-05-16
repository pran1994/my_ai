import { createLLMResponse, buildSystemPrompt } from "../llm.js";
import { braveWebSearch, formatSearchResultsForPrompt } from "../search.js";

const searchSystemExtra = `
Web search turn: you only have the snippets below — no private knowledge of Pratyush's career beyond stored memory.

Time-only asks: use local time from system instructions; no timezone-site referrals.

Answer in the same voice as the main instructions: grounded, concise, human — not upbeat-assistant, not report-speak ("key takeaways", "it is important to note"). Do not open with hollow congratulations or stacked generic questions.

Short paragraphs. Bullets only if they asked or many separate facts need scanning. If snippets are thin or generic vs his situation, say so plainly and tie to memory only when real.

One coherent stance: don't both claim "no real-time access" and cite search. No emoji unless he used them. Under 3200 characters. Not legal/financial/medical advice.
`.trim();

export async function summarizeWebSearch(memoryText, query) {
  const data = await braveWebSearch(query);

  if (data.error) {
    return `${data.error}\n\nBrave Search API: https://brave.com/search/api/ (free tier with monthly query allowance).`;
  }

  const { results } = data;
  if (!results?.length) {
    return "Search returned no web results. Try different keywords.";
  }

  const systemPrompt = `${buildSystemPrompt(memoryText)}\n\n${searchSystemExtra}`;
  const userPrompt = `User query: ${data.query}\n\n--- Search snippets ---\n${formatSearchResultsForPrompt(results)}`;

  return createLLMResponse(systemPrompt, userPrompt, []);
}

export function searchSkillHelp() {
  return `Web search (Brave — set BRAVE_API_KEY):
- With WEB_SEARCH_CHAT_MODE=easy (default): many normal questions auto-search (restaurants, reviews, "what/who/where…?", latest news phrasing).
- search <query> / google <query> / lookup <query> — always forces web search.
- conservative / explicit modes: see .env.example

Get a key: https://brave.com/search/api/`;
}
