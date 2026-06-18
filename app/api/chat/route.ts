import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { question?: string; siteIndex?: unknown };
    const question = body.question?.trim();

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    if (!body.siteIndex) {
      return NextResponse.json({ error: "No crawled site index found. Crawl a website before asking questions." }, { status: 400 });
    }

    const result = await answerQuestion(question, body.siteIndex as import("@/lib/types").SiteIndex);
    return NextResponse.json(result);
  } catch (error) {
    console.error("❌ Chat API Error:", error);
    const raw = error instanceof Error ? error.message : String(error);

    // Gemini (and OpenAI) SDKs surface HTTP errors as plain messages like "503 status code (no body)".
    // Translate known status codes into friendly messages before sending them to the UI.
    let message = raw;
    if (raw.includes("503")) {
      message = "The AI service is temporarily unavailable (503). Please wait a moment and try again.";
    } else if (raw.includes("429")) {
      message = "Too many requests — the AI service is rate-limiting us (429). Please wait a few seconds and try again.";
    } else if (raw.includes("401") || raw.includes("403")) {
      message = "Authentication failed. Please check that your API key is correct in .env.local.";
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
