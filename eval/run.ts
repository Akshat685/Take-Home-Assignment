import examples from "./examples.json";
import { chunkPages } from "../lib/chunk";
import { crawlSite, DEFAULT_CRAWL_CONFIG } from "../lib/crawler";
import { embedTexts } from "../lib/embeddings";
import { answerQuestion } from "../lib/rag";
import type { IndexedChunk, SiteIndex } from "../lib/types";
import { vectorStore } from "../lib/vector-store";

type EvalExample = {
  siteUrl: string;
  questions: Array<{ question: string; expectedSourceHint?: string }>;
};

async function indexSite(siteUrl: string): Promise<SiteIndex> {
  const crawl = await crawlSite(siteUrl, {
    maxPages: Math.min(DEFAULT_CRAWL_CONFIG.maxPages, 10),
    maxDepth: Math.min(DEFAULT_CRAWL_CONFIG.maxDepth, 1)
  });

  const chunks = chunkPages(crawl.pages);
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
  const indexedChunks: IndexedChunk[] = chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] }));
  const root = new URL(crawl.rootUrl);

  const siteIndex: SiteIndex = {
    siteId: `eval-${root.hostname}-${Date.now()}`,
    rootUrl: crawl.rootUrl,
    hostname: root.hostname,
    indexedAt: new Date().toISOString(),
    chunks: indexedChunks
  };

  vectorStore.save(siteIndex);
  return siteIndex;
}

async function main() {
  const evals = examples as EvalExample[];

  for (const example of evals) {
    console.log(`\nIndexing ${example.siteUrl}`);
    const index = await indexSite(example.siteUrl);
    console.log(`Indexed ${index.chunks.length} chunks`);

    for (const item of example.questions) {
      const result = await answerQuestion(item.question, index.siteId);
      const sourceUrls = result.sources.map((source) => source.url);
      const matchedExpectedSource = item.expectedSourceHint
        ? sourceUrls.some((url) => url.includes(item.expectedSourceHint!))
        : undefined;

      console.log("\nQuestion:", item.question);
      console.log("Answer:", result.answer);
      console.log("Sources:", sourceUrls.join(", ") || "none");
      if (typeof matchedExpectedSource === "boolean") {
        console.log("Expected source hint matched:", matchedExpectedSource ? "yes" : "no");
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
