import type { IndexedChunk, RetrievalMatch, SiteIndex } from "./types";

type StoreState = {
  indexes: Map<string, SiteIndex>;
  latestSiteId?: string;
};

const globalForStore = globalThis as unknown as { __chatWithWebsiteStore?: StoreState };

function getState(): StoreState {
  if (!globalForStore.__chatWithWebsiteStore) {
    globalForStore.__chatWithWebsiteStore = { indexes: new Map<string, SiteIndex>() };
  }

  return globalForStore.__chatWithWebsiteStore;
}

export const vectorStore = {
  save(index: SiteIndex): void {
    const state = getState();
    state.indexes.set(index.siteId, index);
    state.latestSiteId = index.siteId;
  },

  get(siteId?: string): SiteIndex | undefined {
    const state = getState();
    const resolvedSiteId = siteId ?? state.latestSiteId;
    return resolvedSiteId ? state.indexes.get(resolvedSiteId) : undefined;
  },

  clear(): void {
    const state = getState();
    state.indexes.clear();
    state.latestSiteId = undefined;
  }
};

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function searchIndex(index: SiteIndex, queryEmbedding: number[], topK = 5): RetrievalMatch[] {
  return index.chunks
    .map((chunk: IndexedChunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
