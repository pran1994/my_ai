import { createLLMResponse, buildSystemPrompt } from "../llm.js";
import { fetchRssHeadlines, formatHeadlinesForPrompt } from "../rss.js";
import { fetchRedditPosts, formatRedditForPrompt } from "../reddit.js";

const briefingSystemExtra = `
You summarize finance headlines and Reddit discussion for WhatsApp.
- Use bullet points, max 8 bullets total.
- Separate "News (RSS)" and "Reddit" sections when both are provided.
- Prioritize topics that match the user's stored memory and interests.
- This is not financial advice. Mention sources briefly.
- Keep the full reply under 3200 characters.
`.trim();

export async function summarizeFinanceNews(memoryText) {
  const { items, errors } = await fetchRssHeadlines();
  const headlines = formatHeadlinesForPrompt(items);
  const errorNote = errors.length ? `\nFetch issues: ${errors.join("; ")}` : "";

  const systemPrompt = `${buildSystemPrompt(memoryText)}\n\n${briefingSystemExtra}`;
  const userPrompt = `Summarize these finance RSS headlines for me:\n\n${headlines}${errorNote}`;

  return createLLMResponse(systemPrompt, userPrompt, []);
}

export async function summarizeRedditFinance(memoryText) {
  const { posts, errors } = await fetchRedditPosts();
  const discussion = formatRedditForPrompt(posts);
  const errorNote = errors.length ? `\nFetch issues: ${errors.join("; ")}` : "";

  const systemPrompt = `${buildSystemPrompt(memoryText)}\n\n${briefingSystemExtra}`;
  const userPrompt = `Summarize what finance Reddit is discussing:\n\n${discussion}${errorNote}`;

  return createLLMResponse(systemPrompt, userPrompt, []);
}

export async function summarizeFullBriefing(memoryText) {
  const [{ items, errors: rssErrors }, { posts, errors: redditErrors }] =
    await Promise.all([fetchRssHeadlines(), fetchRedditPosts()]);

  const headlines = formatHeadlinesForPrompt(items);
  const discussion = formatRedditForPrompt(posts);
  const issues = [...rssErrors, ...redditErrors];
  const errorNote = issues.length ? `\nFetch issues: ${issues.join("; ")}` : "";

  const systemPrompt = `${buildSystemPrompt(memoryText)}\n\n${briefingSystemExtra}`;
  const userPrompt = `Create a combined finance briefing.

## RSS headlines
${headlines}

## Reddit
${discussion}
${errorNote}`;

  return createLLMResponse(systemPrompt, userPrompt, []);
}

export function financeSkillHelp() {
  return `Finance skills:
- finance news — RSS headlines (ECB, Fed, BBC Business)
- reddit finance — hot posts from finance subreddits
- briefing — RSS + Reddit + your memory

Personalize with: remember I care about rates and tech stocks`;
}
