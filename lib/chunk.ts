import type { CrawledPage, TextChunk } from "./types";

export type ChunkOptions = {
  targetWords: number;
  overlapWords: number;
  minChunkWords: number;
};

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetWords: 850,
  overlapWords: 120,
  minChunkWords: 80
};

function words(text: string): string[] {
  return text.split(/\s+/).map((word) => word.trim()).filter(Boolean);
}

export function chunkPage(page: CrawledPage, pageIndex: number, options: Partial<ChunkOptions> = {}): TextChunk[] {
  const config = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const allWords = words(page.text);

  if (allWords.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < allWords.length) {
    const end = Math.min(start + config.targetWords, allWords.length);
    const slice = allWords.slice(start, end);

    if (slice.length >= config.minChunkWords || chunks.length === 0) {
      chunks.push({
        id: `page-${pageIndex}-chunk-${chunkIndex}`,
        url: page.url,
        title: page.title,
        text: slice.join(" "),
        chunkIndex
      });
      chunkIndex += 1;
    }

    if (end === allWords.length) {
      break;
    }

    start = Math.max(end - config.overlapWords, start + 1);
  }

  return chunks;
}

export function chunkPages(pages: CrawledPage[], options: Partial<ChunkOptions> = {}): TextChunk[] {
  return pages.flatMap((page, pageIndex) => chunkPage(page, pageIndex, options));
}
