import robotsParser from "robots-parser";

export type RobotsPolicy = {
  isAllowed: (url: string) => boolean;
  crawlDelayMs?: number;
  warnings: string[];
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadRobotsPolicy(origin: string, userAgent: string): Promise<RobotsPolicy> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const warnings: string[] = [];

  try {
    const response = await fetchWithTimeout(
      robotsUrl,
      {
        headers: { "User-Agent": userAgent, Accept: "text/plain,*/*" },
        redirect: "follow"
      },
      8_000
    );

    if (response.status === 404) {
      warnings.push("No robots.txt found; proceeding with polite defaults.");
      return { isAllowed: () => true, warnings };
    }

    if (!response.ok) {
      warnings.push(`Could not read robots.txt (${response.status}); proceeding with polite defaults.`);
      return { isAllowed: () => true, warnings };
    }

    const text = await response.text();
    const parser = robotsParser(robotsUrl, text);
    const crawlDelaySeconds = parser.getCrawlDelay(userAgent);

    return {
      isAllowed: (url: string) => parser.isAllowed(url, userAgent) !== false,
      crawlDelayMs: crawlDelaySeconds ? Math.ceil(crawlDelaySeconds * 1000) : undefined,
      warnings
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    warnings.push(`Could not fetch robots.txt (${message}); proceeding with polite defaults.`);
    return { isAllowed: () => true, warnings };
  }
}
