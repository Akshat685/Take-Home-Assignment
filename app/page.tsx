"use client";

import { FormEvent, useState } from "react";
import type { ChatApiResponse, CrawlApiResponse, Source } from "@/lib/types";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [crawlResult, setCrawlResult] = useState<CrawlApiResponse | null>(null);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [isCrawling, setIsCrawling] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isAnswering, setIsAnswering] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  async function handleCrawl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCrawlError(null);
    setChatError(null);
    setCrawlResult(null);
    setMessages([]);
    setIsCrawling(true);

    try {
      const response = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to crawl site.");
      }

      setCrawlResult(data as CrawlApiResponse);
    } catch (error) {
      setCrawlError(error instanceof Error ? error.message : "Failed to crawl site.");
    } finally {
      setIsCrawling(false);
    }
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !crawlResult) {
      return;
    }

    setChatError(null);
    setQuestion("");
    setMessages((current) => [...current, { role: "user", content: trimmedQuestion }]);
    setIsAnswering(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion, siteId: crawlResult.siteId })
      });
      const data = (await response.json()) as ChatApiResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to answer question.");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources
        }
      ]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to answer question.");
    } finally {
      setIsAnswering(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Crawl + RAG</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">Chat with a Website</h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Enter a website URL, crawl up to 5 pages within the same hostname, index the readable content, and ask
            grounded questions with source links.
          </p>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={handleCrawl} className="flex flex-col gap-4 md:flex-row">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              type="url"
              required
              placeholder="https://example.com"
              className="min-h-12 flex-1 rounded-2xl border border-slate-300 px-4 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-200"
            />
            <button
              type="submit"
              disabled={isCrawling}
              className="min-h-12 rounded-2xl bg-slate-950 px-6 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCrawling ? "Crawling..." : "Crawl site"}
            </button>
          </form>

          <p className="mt-3 text-sm text-slate-500">Defaults: max pages 10, max depth 2, polite delay between requests.</p>

          {crawlError ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{crawlError}</div>
          ) : null}

          {crawlResult ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <StatusCard label="Pages crawled" value={crawlResult.pagesCrawled.toString()} />
              <StatusCard label="Chunks created" value={crawlResult.chunksCreated.toString()} />
              <StatusCard label="Indexed site" value={new URL(crawlResult.rootUrl).hostname} />
            </div>
          ) : null}

          {crawlResult && (crawlResult.warnings.length > 0 || crawlResult.errors.length > 0) ? (
            <details className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <summary className="cursor-pointer font-semibold">Crawl warnings and errors</summary>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                {[...crawlResult.warnings, ...crawlResult.errors].map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        {crawlResult ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">Ask questions</h2>
                <p className="mt-1 text-sm text-slate-500">Answers are constrained to the retrieved website excerpts.</p>
              </div>
            </div>

            <div className="mt-6 flex min-h-80 max-h-[500px] flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
              {messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-center text-slate-500">
                  Try asking what the site says about pricing, features, policies, docs, or contact information.
                </div>
              ) : (
                messages.map((message, index) => <MessageBubble key={index} message={message} />)
              )}
              {isAnswering ? <div className="text-sm text-slate-500">Searching excerpts and drafting a grounded answer...</div> : null}
            </div>

            {chatError ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{chatError}</div>
            ) : null}

            <form onSubmit={handleAsk} className="mt-4 flex flex-col gap-3 md:flex-row">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask a question about the crawled site..."
                className="min-h-12 flex-1 rounded-2xl border border-slate-300 px-4 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-200"
              />
              <button
                type="submit"
                disabled={isAnswering || !question.trim()}
                className="min-h-12 rounded-2xl bg-slate-950 px-6 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAnswering ? "Answering..." : "Ask"}
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 truncate text-2xl font-bold">{value}</div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-3xl rounded-2xl p-4 ${isUser ? "bg-slate-950 text-white" : "bg-white text-slate-900 shadow-sm"}`}>
        <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
        {!isUser && message.sources && message.sources.length > 0 ? (
          <div className="mt-4 border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</div>
            <ul className="mt-2 space-y-1 text-sm">
              {message.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2">
                    {source.title || source.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
