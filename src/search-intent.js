/**
 * Decide when to auto-run Brave web search (no "search" prefix).
 *
 * WEB_SEARCH_CHAT_MODE:
 * - easy (default) — restaurants/reviews/factual questions + time-sensitive phrases
 * - conservative — only time-sensitive / "latest" style (older behavior)
 * - explicit — never auto (only messages starting with search / google / lookup)
 *
 * Still requires BRAVE_API_KEY and AUTO_WEB_SEARCH !== "false".
 */

function conservativeSignals(trimmed) {
  return (
    /\b(latest|real[\s-]*time|live\s+(news|data|updates?)|up-?to-?date|breaking)\b/i.test(
      trimmed,
    ) ||
    /\b(today'?s?|right\s+now|as\s+of\s+today|this\s+week|currently)\b/i.test(
      trimmed,
    ) ||
    /\b(20(2[4-9]|[3-9][0-9]))\b/.test(trimmed) ||
    /\b(browse|search)\s+(the\s+)?internet\b/i.test(trimmed) ||
    /\b(internet\s+access|training\s+cutoff|cannot\s+browse)\b/i.test(
      trimmed,
    ) ||
    /\b(stock\s+prices?|market\s+news|semiconductor\s+shortage)\b/i.test(
      trimmed,
    )
  );
}

function easyExtraSignals(trimmed) {
  if (/\b(restaurant|cafe|coffee\s+shop|eatery|diner|takeaway|menu|dishes?|brunch|breakfast|lunch|dinner|supper)\b/i.test(trimmed)) {
    return true;
  }

  if (
    /\b(reviews?|recommended|highly\s+rated|worth\s+(a\s+)?(visit|try)|popular\s+(item|dish|dishes)|best\s+(thing|dish|order|food)\s+to|rating)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  if (
    /\b(going\s+to|eating\s+at|heading\s+to|trying\s+out|reservation\s+(at|for))\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  if (
    /\b(look\s*up|find\s+(out\s+)?(info|information)|tell\s+me\s+about|what\s+do\s+you\s+know\s+about|google\s+this)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  // Capitalised place-ish tokens (e.g. ThaiThae Lidcombe) often mean a specific venue
  if (/\b[A-Z][a-z]{2,}[A-Za-z]*\b.*\b(Lidcombe|Parramatta|Sydney|Melbourne|CBD)\b/.test(trimmed)) {
    return true;
  }

  // Plain factual questions (likely to need the web)
  if (
    trimmed.includes("?") &&
    trimmed.length >= 20 &&
    /^(what|who|where|when|which|why|how|is|are|does|do|can|could|would|should)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  return false;
}

function isProbablyChitChat(trimmed) {
  if (/^how\s+(are|r)\s+you\b/i.test(trimmed)) {
    return true;
  }

  if (
    /^(hi|hey|hello|hiya|yo|sup|wassup|thanks|thank you|thx|cheers|ok\.?|okay|kk|lol|haha|bye|good\s*(night|morning|evening)|nm|nvm)\b/i.test(
      trimmed,
    ) &&
    trimmed.length < 40
  ) {
    return true;
  }

  return false;
}

/** Wall clock is answered on the server (see wallClockReplyForUserMessage) */
export function isProbablyClockQuestion(trimmed) {
  const t = trimmed.toLowerCase();
  return (
    /\bwhat\s+time\s+is\s+it\b/.test(t) ||
    /\bwhat('?s| is)\s+(the\s+)?time\b/.test(t) ||
    /\bcurrent\s+time\b/.test(t) ||
    /\btime\s+in\s+/.test(t) ||
    /\bwhat\s+hour\b/.test(t) ||
    /\btell\s+me\s+(the\s+)?time\b/.test(t) ||
    /\bdo\s+you\s+know\s+(what\s+)?the\s+time\b/.test(t) ||
    /\bgot\s+(the\s+)?time\b/.test(t) ||
    /^time\s*\?/i.test(trimmed) ||
    /\b(have|know)\s+(you\s+got\s+)?the\s+time\b/.test(t)
  );
}

export function braveSearchConfigured() {
  return Boolean(process.env.BRAVE_API_KEY?.trim());
}

export function autoWebSearchEnabled() {
  if (!braveSearchConfigured()) {
    return false;
  }
  return process.env.AUTO_WEB_SEARCH !== "false";
}

export function messageShouldUseWebSearch(text) {
  const mode = (process.env.WEB_SEARCH_CHAT_MODE || "easy").toLowerCase();

  if (mode === "explicit") {
    return false;
  }

  const trimmed = text.trim();
  if (trimmed.length < 12 || isProbablyChitChat(trimmed)) {
    return false;
  }

  if (isProbablyClockQuestion(trimmed)) {
    return false;
  }

  if (mode === "conservative") {
    return conservativeSignals(trimmed);
  }

  return conservativeSignals(trimmed) || easyExtraSignals(trimmed);
}
