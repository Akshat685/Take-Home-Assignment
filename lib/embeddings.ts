import { getEmbeddingModel, getOpenAIClient } from "./openai";

const EMBEDDING_BATCH_SIZE = 64;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const client = getOpenAIClient();
  const model = getEmbeddingModel();
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    if (i > 0) {
      // Sleep for 2 seconds between batches to avoid hitting Gemini's free tier rate limit
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const response = await client.embeddings.create({
      model,
      input: batch,
      encoding_format: "float"
    });

    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    embeddings.push(...sorted.map((item) => item.embedding));
  }

  return embeddings;
}

export async function embedQuery(question: string): Promise<number[]> {
  const [embedding] = await embedTexts([question]);
  return embedding;
}
