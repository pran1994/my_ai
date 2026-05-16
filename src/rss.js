const defaultFeeds = [
  { name: "ECB press", url: "https://www.ecb.europa.eu/rss/press.html" },
  {
    name: "Fed press",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
  },
  {
    name: "BBC Business",
    url: "https://feeds.bbci.co.uk/news/business/rss.xml",
  },
];

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function pickTag(block, tag) {
  const match = block.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? decodeXml(match[1]) : "";
}

function parseRssItems(xml, sourceName, limit) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const block of blocks.slice(0, limit)) {
    const title = pickTag(block, "title");
    if (!title) {
      continue;
    }

    items.push({
      source: sourceName,
      title,
      link: pickTag(block, "link"),
      summary: pickTag(block, "description").slice(0, 400),
      published: pickTag(block, "pubDate"),
    });
  }

  return items;
}

function parseAtomEntries(xml, sourceName, limit) {
  const items = [];
  const blocks = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  for (const block of blocks.slice(0, limit)) {
    const title = pickTag(block, "title");
    if (!title) {
      continue;
    }

    const linkMatch = block.match(/<link[^>]+href="([^"]+)"/i);
    items.push({
      source: sourceName,
      title,
      link: linkMatch?.[1] || pickTag(block, "link"),
      summary: pickTag(block, "summary") || pickTag(block, "content"),
      published: pickTag(block, "updated") || pickTag(block, "published"),
    });
  }

  return items.slice(0, limit);
}

function configuredFeeds() {
  const raw = process.env.FINANCE_RSS_FEEDS?.trim();
  if (!raw) {
    return defaultFeeds;
  }

  return raw.split(",").map((entry) => {
    const [name, url] = entry.split("|").map((part) => part.trim());
    return { name: name || "Feed", url };
  });
}

export async function fetchRssHeadlines({ perFeedLimit = 5 } = {}) {
  const feeds = configuredFeeds();
  const allItems = [];
  const errors = [];

  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        headers: { "User-Agent": "personal-whatsapp-assistant/0.1" },
      });

      if (!response.ok) {
        errors.push(`${feed.name}: HTTP ${response.status}`);
        continue;
      }

      const xml = await response.text();
      const items = xml.includes("<entry")
        ? parseAtomEntries(xml, feed.name, perFeedLimit)
        : parseRssItems(xml, feed.name, perFeedLimit);

      allItems.push(...items);
    } catch (error) {
      errors.push(`${feed.name}: ${error.message}`);
    }
  }

  return { items: allItems, errors };
}

export function formatHeadlinesForPrompt(items) {
  if (!items.length) {
    return "No RSS headlines were fetched.";
  }

  return items
    .map((item, index) => {
      const parts = [
        `${index + 1}. [${item.source}] ${item.title}`,
        item.published ? `   Date: ${item.published}` : "",
        item.summary ? `   Snippet: ${item.summary.slice(0, 200)}` : "",
        item.link ? `   Link: ${item.link}` : "",
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n\n");
}
