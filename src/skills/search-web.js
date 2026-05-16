import { createLLMResponse, buildSystemPrompt } from "../llm.js";
import { braveWebSearch, formatSearchResultsForPrompt } from "../search.js";

const searchSystemExtra = `
You are replying on WhatsApp to someone you know. You ONLY have the web search snippets below — no firsthand knowledge of their career.

If the user's question is only about the current time in a timezone: use the local time given in the system instructions above and answer in normal words — do NOT send them to timezone websites.

Otherwise write like a normal conversation:
- 1–3 short paragraphs of flowing prose. No bullet lists unless they asked for a list or there are many separate facts worth scanning.
- Start with something human (e.g. acknowledging the question). Weave advice naturally; avoid report-speak ("key takeaways", "it is important to note").
- If snippets are generic job-market advice and thin on their specific profile, say so gently and tie in what matters for them (memory above) if there is any. Don't invent facts about companies or their CV.
- Do not say you have "no real-time access" and also say you skimmed search — pick one coherent story. Do not end with "check this website" lists unless snippets require citing a specific official source.
- Keep under 3200 characters. Not legal/financial/medical advice.
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
