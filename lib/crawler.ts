import { extractPage } from "./extract";
import { loadRobotsPolicy } from "./robots";
import type { CrawlConfig, CrawlOutput, CrawledPage } from "./types";

export const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxPages: 10,
  maxDepth: 2,
  requestDelayMs: 700,
  fetchTimeoutMs: 12_000,
  minPageWords: 80,
  userAgent: "ChatWithWebsiteRAG/1.0 (+https://local.dev; respectful take-home crawler)"
};

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid"
];

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }

    url.pathname = url.pathname.replace(/\/+/g, "/");
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }
    url.searchParams.sort();

    return url.toString();
  } catch {
    return null;
  }
}

function sameHostname(candidateUrl: string, hostname: string): boolean {
  try {
    return new URL(candidateUrl).hostname === hostname;
  } catch {
    return false;
  }
}

export async function crawlSite(inputUrl: string, overrides: Partial<CrawlConfig> = {}): Promise<CrawlOutput> {
  const config = { ...DEFAULT_CRAWL_CONFIG, ...overrides };
  const rootUrl = normalizeUrl(inputUrl);

  if (!rootUrl) {
    throw new Error("Please enter a valid http(s) URL.");
  }

  const root = new URL(rootUrl);
  const hostname = root.hostname;
  const robots = await loadRobotsPolicy(root.origin, config.userAgent);
  const warnings = [...robots.warnings];
  const errors: string[] = [];
  const pages: CrawledPage[] = [];
  const visited = new Set<string>();
  const queued = new Set<string>([rootUrl]);
  const queue: Array<{ url: string; depth: number }> = [{ url: rootUrl, depth: 0 }];

  const effectiveDelayMs = Math.max(config.requestDelayMs, robots.crawlDelayMs ?? 0);
  let lastRequestAt = 0;
  let requestedPages = 0;

  while (queue.length > 0 && requestedPages < config.maxPages) {
    const current = queue.shift();
    if (!current || current.depth > config.maxDepth || visited.has(current.url)) {
      continue;
    }

    visited.add(current.url);

    if (!sameHostname(current.url, hostname)) {
      continue;
    }

    if (!robots.isAllowed(current.url)) {
      warnings.push(`Skipped by robots.txt: ${current.url}`);
      continue;
    }

    requestedPages += 1;

    const sinceLastRequest = Date.now() - lastRequestAt;
    if (lastRequestAt > 0 && sinceLastRequest < effectiveDelayMs) {
      await sleep(effectiveDelayMs - sinceLastRequest);
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        current.url,
        {
          headers: {
            "User-Agent": config.userAgent,
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
          },
          redirect: "follow"
        },
        config.fetchTimeoutMs
      );
      lastRequestAt = Date.now();
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      errors.push(`Failed to fetch ${current.url}: ${message}`);
      continue;
    }

    const finalUrl = normalizeUrl(response.url || current.url);
    if (!response.ok) {
      warnings.push(`Skipped ${current.url}: HTTP ${response.status}`);
      continue;
    }

    if (!finalUrl || !sameHostname(finalUrl, hostname)) {
      warnings.push(`Skipped redirected out-of-scope URL from ${current.url}`);
      continue;
    }

    visited.add(finalUrl);

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      warnings.push(`Skipped non-HTML page: ${finalUrl}`);
      continue;
    }

    const html = await response.text();
    const extracted = extractPage(html);

    if (wordCount(extracted.text) >= config.minPageWords) {
      pages.push({
        url: finalUrl,
        title: extracted.title,
        text: extracted.text,
        depth: current.depth
      });
    } else {
      warnings.push(`Skipped low-text page: ${finalUrl}`);
    }

    if (current.depth >= config.maxDepth) {
      continue;
    }

    for (const href of extracted.links) {
      const nextUrl = normalizeUrl(href, finalUrl);
      if (!nextUrl || queued.has(nextUrl) || visited.has(nextUrl)) {
        continue;
      }

      if (!sameHostname(nextUrl, hostname)) {
        continue;
      }

      queued.add(nextUrl);
      queue.push({ url: nextUrl, depth: current.depth + 1 });
    }
  }

  return { rootUrl, pages, errors, warnings };
}
