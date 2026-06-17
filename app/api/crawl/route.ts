import { NextRequest, NextResponse } from "next/server";
import { chunkPages } from "@/lib/chunk";
import { crawlSite, DEFAULT_CRAWL_CONFIG } from "@/lib/crawler";
import { embedTexts } from "@/lib/embeddings";
import type { IndexedChunk, SiteIndex } from "@/lib/types";
import { vectorStore } from "@/lib/vector-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { url?: string; maxPages?: number; maxDepth?: number };
    const url = body.url?.trim();

    if (!url) {
      return NextResponse.json({ error: "URL is required." }, { status: 400 });
    }

    const crawl = await crawlSite(url, {
      maxPages: clampNumber(body.maxPages, DEFAULT_CRAWL_CONFIG.maxPages, 1, 50),
      maxDepth: clampNumber(body.maxDepth, DEFAULT_CRAWL_CONFIG.maxDepth, 0, 4)
    });

    const chunks = chunkPages(crawl.pages);
    if (chunks.length === 0) {
      return NextResponse.json(
        {
          error: "Crawl completed, but no useful text chunks were found.",
          warnings: crawl.warnings,
          errors: crawl.errors
        },
        { status: 422 }
      );
    }

    const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
    const indexedChunks: IndexedChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index]
    }));

    const root = new URL(crawl.rootUrl);
    const siteId = `${root.hostname}-${Date.now()}`;
    const siteIndex: SiteIndex = {
      siteId,
      rootUrl: crawl.rootUrl,
      hostname: root.hostname,
      indexedAt: new Date().toISOString(),
      chunks: indexedChunks
    };

    vectorStore.save(siteIndex);

    return NextResponse.json({
      siteId,
      rootUrl: crawl.rootUrl,
      pagesCrawled: crawl.pages.length,
      chunksCreated: chunks.length,
      errors: crawl.errors,
      warnings: crawl.warnings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected crawl error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
