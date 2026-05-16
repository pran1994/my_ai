import { createLLMResponse, buildSystemPrompt } from "../llm.js";
import { braveWebSearch, formatSearchResultsForPrompt } from "../search.js";

const searchSystemExtra = `
You answer using ONLY the web search snippets provided below.
- If snippets are thin or contradictory, say so.
- Be concise for WhatsApp; short bullets are fine.
- Say clearly that this is from search snippets (not firsthand verification).
- Cite sources with domain or short title when useful.
- Keep the full reply under 3200 characters.
- This is not financial, legal, or medical advice.
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
