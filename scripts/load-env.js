import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadEnvFile(envPath = resolve(".env")) {
  let raw;

  try {
    raw = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }

  return true;
}
