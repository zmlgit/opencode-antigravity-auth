/**
 * Remote Antigravity version fetcher.
 *
 * Version resolution strategy:
 *   1. Auto-updater API (plain text with semver)
 *   2. Homebrew cask API (formulae.brew.sh)
 *   3. Changelog page scrape (first 5000 chars)
 *   4. Hardcoded fallback in constants.ts
 *
 * Called once at plugin startup to ensure headers use the latest
 * supported version, avoiding "version no longer supported" errors.
 *
 * @see https://github.com/lbjlaq/Antigravity-Manager (src-tauri/src/constants.rs)
 */

import { getAntigravityVersion, setAntigravityVersion } from "../constants";
import { createLogger } from "./logger";

const VERSION_URL = "https://antigravity-auto-updater-974169037036.us-central1.run.app";
const HOMEBREW_CASK_URL = "https://formulae.brew.sh/api/cask/antigravity.json";
const CHANGELOG_URL = "https://antigravity.google/changelog";
const FETCH_TIMEOUT_MS = 5000;
const CHANGELOG_SCAN_CHARS = 5000;
const VERSION_REGEX = /\d+\.\d+\.\d+/;

type VersionSource = "api" | "homebrew" | "changelog" | "fallback";

function parseVersion(text: string): string | null {
  const match = text.match(VERSION_REGEX);
  return match ? match[0] : null;
}

async function tryFetchVersion(url: string, maxChars?: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    let text = await response.text();
    if (maxChars) text = text.slice(0, maxChars);
    return parseVersion(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryFetchHomebrewVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(HOMEBREW_CASK_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    const raw = data?.version as string | undefined;
    if (!raw) return null;
    return parseVersion(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the latest Antigravity version and update the global constant.
 * Safe to call before logger is initialized (will silently skip logging).
 */
export async function initAntigravityVersion(): Promise<void> {
  const log = createLogger("version");
  const fallback = getAntigravityVersion();
  let version: string | null;
  let source: VersionSource;

  // 1. Try auto-updater API
  version = await tryFetchVersion(VERSION_URL);
  if (version) {
    source = "api";
  } else {
    // 2. Try Homebrew cask API
    version = await tryFetchHomebrewVersion();
    if (version) {
      source = "homebrew";
    } else {
      // 3. Try changelog page scrape
      version = await tryFetchVersion(CHANGELOG_URL, CHANGELOG_SCAN_CHARS);
      if (version) {
        source = "changelog";
      } else {
        // 4. Fall back to hardcoded
        source = "fallback";
        setAntigravityVersion(fallback);
        log.info("version-fetch-failed", { fallback });
        return;
      }
    }
  }

  if (version !== fallback) {
    log.info("version-updated", { version, source, previous: fallback });
  } else {
    log.debug("version-unchanged", { version, source });
  }
  setAntigravityVersion(version);
}
