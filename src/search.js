const braveKey = process.env.BRAVE_API_KEY?.trim();
const resultCount = Math.min(
  Math.max(Number(process.env.BRAVE_SEARCH_COUNT || 8), 1),
  20,
);

/**
 * Web search via Brave Search API (https://brave.com/search/api/).
 */
export async function braveWebSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    return { error: "Empty search query." };
  }

  if (!braveKey) {
    return {
      error:
        "BRAVE_API_KEY is not set. Create a key at https://brave.com/search/api/",
    };
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("count", String(resultCount));
  const country = process.env.BRAVE_SEARCH_COUNTRY?.trim();
  if (country) {
    url.searchParams.set("country", country);
  }

  const response = await fetch(url, {
    headers: {
      "X-Subscription-Token": braveKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      error: `Brave Search HTTP ${response.status}: ${body.slice(0, 500)}`,
    };
  }

  const data = await response.json();
  const results = (data.web?.results || []).map((entry) => ({
    title: entry.title || "",
    url: entry.url || "",
    description:
      entry.description ||
      (typeof entry.extra_snippets?.[0] === "string"
        ? entry.extra_snippets[0]
        : ""),
  }));

  return { results, query: trimmed };
}

export function formatSearchResultsForPrompt(results) {
  return results
    .map(
      (r, index) =>
        `${index + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.description}`,
    )
    .join("\n\n");
}
