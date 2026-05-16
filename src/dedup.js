import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const dedupPath = resolve(process.env.DEDUP_FILE || "./data/processed-message-ids.json");
const maxAgeMs = Number(process.env.DEDUP_MAX_AGE_MS || 48 * 60 * 60 * 1000);
const maxEntries = Number(process.env.DEDUP_MAX_ENTRIES || 500);

async function loadEntries() {
  await mkdir(dirname(dedupPath), { recursive: true });

  try {
    const raw = await readFile(dedupPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function prune(entries, now) {
  return entries
    .filter((entry) => now - entry.at < maxAgeMs)
    .slice(0, maxEntries);
}

export async function markMessageProcessed(messageId) {
  const now = Date.now();
  const entries = prune(await loadEntries(), now);
  entries.unshift({ id: messageId, at: now });
  await writeFile(dedupPath, JSON.stringify(entries, null, 2), "utf8");
}

export async function hasProcessedMessage(messageId) {
  const now = Date.now();
  const entries = prune(await loadEntries(), now);
  return entries.some((entry) => entry.id === messageId);
}
