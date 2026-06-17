import OpenAI from "openai";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Add it to .env.local before running the app.`);
  }
  return value;
}

export function getOpenAIClient(): OpenAI {
  return new OpenAI({
    // apiKey: requireEnv("OPENAI_API_KEY"),
    apiKey: requireEnv("GEMINI_API_KEY"),
    baseURL: process.env.OPENAI_BASE_URL || undefined
  });
}

export function getChatModel(): string {
  // return requireEnv("OPENAI_MODEL");
  return requireEnv("GEMINI_API_KEY_MODEL");
}

export function getEmbeddingModel(): string {
  return requireEnv("OPENAI_EMBEDDING_MODEL");
}
