# 📘 Project Explanation — Chat With a Website (RAG)

> **One-line summary:** Give it a URL → it crawls pages → converts content to AI vectors → lets you ask questions and get grounded answers with source links.

---

## Table of Contents
1. [What is RAG?](#1-what-is-rag)
2. [Tech Stack](#2-tech-stack)
3. [Folder Structure](#3-folder-structure)
4. [Overall Flow Diagram](#4-overall-flow-diagram)
5. [File-by-File Explanation](#5-file-by-file-explanation)
6. [Step-by-Step Workflow](#6-step-by-step-workflow)
7. [Key Concepts](#7-key-concepts)

---

## 1. What is RAG?

**RAG = Retrieval-Augmented Generation**

| Step | What it does |
|------|-------------|
| **Retrieval** | Finds the most relevant text chunks from crawled pages using vector similarity |
| **Generation** | Passes those chunks to Gemini AI to write a grounded, source-cited answer |

Why not just ask Gemini directly? A general AI doesn't know your specific website. RAG forces it to answer *only* from what was crawled.

---

## 2. Tech Stack

| Technology | Role |
|-----------|------|
| **Next.js 14** | Full-stack framework — UI + API routes |
| **React 18** | UI components and state management |
| **TypeScript** | Type-safe code across the entire project |
| **Tailwind CSS** | Utility-first styling with dark theme overrides |
| **OpenAI SDK** | Used to call Gemini (via its OpenAI-compatible API) |
| **Gemini API** | Provides embeddings and chat completions |
| **Cheerio** | Server-side HTML parser — extracts clean text |
| **robots-parser** | Reads and respects `robots.txt` crawling rules |
| **tsx** | Runs TypeScript files directly (used for eval script) |

---

## 3. Folder Structure

```
Take-Home-Assignment/
├── app/
│   ├── api/
│   │   ├── crawl/route.ts     ← POST /api/crawl  — crawls & indexes a site
│   │   └── chat/route.ts      ← POST /api/chat   — answers a question
│   ├── layout.tsx             ← Root HTML shell + metadata
│   ├── page.tsx               ← Main chat UI (client component)
│   └── globals.css            ← Dark theme design system
│
├── lib/
│   ├── types.ts               ← All TypeScript type definitions
│   ├── openai.ts              ← Gemini/OpenAI client setup
│   ├── robots.ts              ← Fetches & parses robots.txt
│   ├── extract.ts             ← HTML → clean text + links
│   ├── crawler.ts             ← BFS web crawler
│   ├── chunk.ts               ← Splits text into overlapping chunks
│   ├── embeddings.ts          ← Text → number vectors (via Gemini)
│   ├── vector-store.ts        ← In-memory store + cosine similarity search
│   └── rag.ts                 ← Full RAG pipeline (retrieve + generate)
│
├── eval/
│   ├── examples.json          ← Test questions with expected source hints
│   └── run.ts                 ← Offline eval script (npm run eval)
│
├── types/
│   └── robots-parser.d.ts     ← Manual TypeScript types for robots-parser
│
├── .env.local                 ← Secret API keys (never in git)
├── .env.local.example         ← Template of required env variables
├── package.json               ← Dependencies + scripts
├── next.config.mjs            ← Next.js config
└── tsconfig.json              ← TypeScript compiler config
```

---

## 4. Overall Flow Diagram

```
╔══════════════════════════════════════════════════════════════╗
║                  ── PHASE 1: CRAWL ──                       ║
╚══════════════════════════════════════════════════════════════╝

USER BROWSER  (app/page.tsx)
──────────────────────────────────────────────────────────────
  User types URL into <input type="url"> field
  Clicks "Crawl Site" button
    → handleCrawl() fires
    → State resets: crawlResult=null, messages=[], errors=null
    → isCrawling = true  →  button changes to "Crawling..."
    → button disabled while waiting
             │
             │  POST /api/crawl
             │  Body:   { url: "https://docs.example.com" }
             │  Header: Content-Type: application/json
             ▼
──────────────────────────────────────────────────────────────
SERVER  app/api/crawl/route.ts
──────────────────────────────────────────────────────────────

  [A] INPUT VALIDATION
      body.url?.trim()  →  if empty → 400 "URL is required."
      maxPages: clampNumber(body.maxPages, default=10, min=1, max=50)
      maxDepth: clampNumber(body.maxDepth, default=2,  min=0, max=4)
             │
             │  calls crawlSite(url, { maxPages, maxDepth })
             ▼

  [B] lib/robots.ts  →  loadRobotsPolicy()
      Fetches  https://docs.example.com/robots.txt  (8s timeout)
      ┌─ 404 response  →  no robots.txt exists → allow everything
      ├─ fetch error   →  network/timeout      → allow everything
      └─ 200 response  →  parse with robots-parser:
           isAllowed(url, userAgent) → true / false / undefined
           getCrawlDelay(userAgent)  → e.g. 2 seconds → 2000 ms
      Returns: { isAllowed(), crawlDelayMs, warnings[] }
             │
             ▼

  [C] lib/crawler.ts  →  crawlSite()  [BFS loop]

      normalizeUrl(inputUrl):
        • Resolve relative URLs against base
        • Reject non-http(s) protocols (mailto:, tel:) → null
        • Lowercase hostname
        • Remove #fragment
        • Remove default ports  (:80 for http, :443 for https)
        • Strip tracking params: utm_source, utm_medium,
          utm_campaign, utm_term, utm_content, utm_id, fbclid, gclid
        • Sort remaining query params alphabetically

      effectiveDelayMs = Math.max(700ms, robots.crawlDelayMs ?? 0)

      Initial state:
        queue   = [{ url: rootUrl, depth: 0 }]   ← BFS queue
        visited = new Set()   ← tracks already-fetched URLs
        queued  = new Set()   ← tracks enqueued URLs (no duplicates)
        requestedPages = 0

      ┌─────────────────────────────────────────────────────┐
      │  LOOP: while queue.length > 0                       │
      │          AND requestedPages < maxPages (10)         │
      │                                                     │
      │  current = queue.shift()   ← FIFO = BFS order      │
      │                                                     │
      │  SKIP (continue) if any:                           │
      │    • current is undefined                          │
      │    • depth > maxDepth (2)                          │
      │    • url already in visited set                    │
      │    • hostname !== root hostname  (external site)   │
      │    • robots.isAllowed(url) === false               │
      │        → warnings[]: "Skipped by robots.txt: /url" │
      │                                                     │
      │  Mark url as visited                               │
      │  requestedPages += 1                               │
      │                                                     │
      │  POLITE DELAY:                                      │
      │    elapsed = Date.now() - lastRequestAt            │
      │    if lastRequestAt > 0 AND elapsed < delayMs:     │
      │      await sleep(delayMs - elapsed)                │
      │                                                     │
      │  FETCH (fetchWithTimeout, 12 000 ms):              │
      │    Headers: User-Agent: ChatWithWebsiteRAG/1.0     │
      │             Accept: text/html,...                  │
      │    redirect: "follow"                              │
      │                                                     │
      │    fetch error  → errors[]: "Failed to fetch /url" │
      │    non-2xx HTTP → warnings[]: "Skipped HTTP 404"   │
      │    redirect outside domain → warnings[]            │
      │    non-HTML content-type   → warnings[]            │
      │                                                     │
      │  EXTRACT  ↓  lib/extract.ts  extractPage(html)     │
      │  ┌───────────────────────────────────────────────┐ │
      │  │ cheerio.load(html)                            │ │
      │  │ Collect <a href> links BEFORE any removal     │ │
      │  │ title = <title> || <h1> || "Untitled page"    │ │
      │  │                                               │ │
      │  │ REMOVE elements:                              │ │
      │  │   script, style, noscript, svg, iframe        │ │
      │  │   canvas, template, nav, footer, form         │ │
      │  │   button, input, select, textarea, aside      │ │
      │  │   [role=navigation], [role=banner]            │ │
      │  │   [role=contentinfo], [aria-hidden=true]      │ │
      │  │   elements whose id/class/aria-label matches: │ │
      │  │   cookie|consent|gdpr|newsletter|subscribe    │ │
      │  │   popup|modal|advert|ad-|promo|social-share   │ │
      │  │                                               │ │
      │  │ FIND CONTENT (try in order, keep longest):    │ │
      │  │   main → article → [role=main] → #content    │ │
      │  │   → .content → .post → .page → body          │ │
      │  │                                               │ │
      │  │ STRUCTURED TEXT from content element:        │ │
      │  │   find h1-h6, p, li, blockquote, td, th      │ │
      │  │   filter lines > 20 chars → join with \n     │ │
      │  │                                               │ │
      │  │ Returns: { title, text, links[] }             │ │
      │  └───────────────────────────────────────────────┘ │
      │                                                     │
      │  wordCount(text) >= 80 words?                      │
      │    YES → pages.push({ url, title, text, depth })  │
      │    NO  → warnings[]: "Skipped low-text page"      │
      │                                                     │
      │  IF depth < maxDepth:                              │
      │    for each href in extracted.links:               │
      │      nextUrl = normalizeUrl(href, currentUrl)      │
      │      skip if: null, already queued, already visited│
      │      skip if: different hostname                   │
      │      else: queued.add(nextUrl)                     │
      │             queue.push({ url: nextUrl, depth+1 }) │
      └─────────────────────────────────────────────────────┘

      Returns: { rootUrl, pages[], errors[], warnings[] }
             │
             ▼

  [D] lib/chunk.ts  →  chunkPages(pages)
      For EACH CrawledPage:
        allWords = page.text.split(whitespace)  ← word array
        Sliding window of 850 words:
          chunk 0: words[0    .. 849  ]  id: "page-0-chunk-0"
          chunk 1: words[730  .. 1579 ]  id: "page-0-chunk-1"  ← 120-word overlap
          chunk 2: words[1460 .. 2309 ]  id: "page-0-chunk-2"  ← 120-word overlap
          next start = max(end - 120, start + 1)  ← never go backward
        Discard trailing chunk if < 80 words (unless it is the only chunk)
        Each chunk: { id, url, title, text, chunkIndex }

      flatMap over all pages → single TextChunk[] array
      If chunks.length === 0 → return 422 error to browser
             │
             ▼

  [E] lib/embeddings.ts  →  embedTexts(allChunkTexts)
      Batches of 64 texts per API call (rate limit protection):

        Batch 0 (chunks 0-63):
          client.embeddings.create({
            model: GEMINI_EMBEDDING_MODEL,
            input: batch,
            encoding_format: "float"
          })
          sort response.data by .index → preserve original order
          push each .embedding (number[]) into results
        await sleep(2000ms)   ← wait between batches
        Batch 1 (chunks 64-127) ... repeat

      Returns: number[][]  — one vector per chunk
        e.g. chunk text → [-0.021, 0.047, 0.003, ... 768 numbers]
             │
             ▼

  [F] Build SiteIndex  (back in crawl/route.ts)
      indexedChunks = chunks.map((chunk, i) => ({
        ...chunk,                 ← id, url, title, text, chunkIndex
        embedding: embeddings[i]  ← the number[] vector
      }))

      siteId = "docs.example.com-" + Date.now()
      siteIndex = {
        siteId,
        rootUrl:   "https://docs.example.com",
        hostname:  "docs.example.com",
        indexedAt: "2024-06-19T06:00:00.000Z",
        chunks:    indexedChunks   ← ALL chunks + embeddings
      }

      vectorStore.save(siteIndex)
        → stored in globalThis.__chatWithWebsiteStore
        → Map<siteId, SiteIndex>
        → latestSiteId = siteId
        → survives Next.js hot-reloads (globalThis persists)
             │
             │  HTTP 200 JSON:
             │  {
             │    siteId,
             │    rootUrl,
             │    pagesCrawled: crawl.pages.length,
             │    chunksCreated: chunks.length,
             │    errors:   [ "Failed to fetch /broken" ],
             │    warnings: [ "Skipped by robots.txt: /admin",
             │                "Skipped low-text page: /login" ],
             │    siteIndex: { siteId, rootUrl, hostname,
             │                 indexedAt, chunks: [...] }
             │  }
             ▼
──────────────────────────────────────────────────────────────
USER BROWSER  (app/page.tsx  handleCrawl  receives response)
──────────────────────────────────────────────────────────────
  if (!response.ok) → setCrawlError(data.error) → red banner shown

  setSiteIndex(data.siteIndex)  ← full index stored in React state
  setCrawlResult(data)          ← summary stats stored
  isCrawling = false            ← button resets to "Crawl site"

  UI renders:
    ┌────────────────────────────────────────────────────┐
    │  StatusCard  "Pages crawled"  → pagesCrawled       │
    │  StatusCard  "Chunks created" → chunksCreated      │
    │  StatusCard  "Indexed site"   → rootUrl hostname   │
    │                                                    │
    │  IF warnings[] or errors[] not empty:              │
    │    <details> amber collapsible:                    │
    │    "Crawl warnings and errors" (click to expand)   │
    │    lists every skipped/failed URL and reason       │
    │                                                    │
    │  Chat section now visible (was null before)        │
    │    "Ask questions" heading appears                 │
    │    Empty state: "Try asking about pricing..."      │
    └────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════╗
║                  ── PHASE 2: CHAT ──                        ║
╚══════════════════════════════════════════════════════════════╝

USER BROWSER  (app/page.tsx)
──────────────────────────────────────────────────────────────
  User types: "What are the pricing plans?"
  Clicks "Ask" button
    → handleAsk() fires
    → trimmedQuestion = question.trim()
    → guard: if empty OR crawlResult is null → return early
    → setChatError(null)
    → setQuestion("")            ← input cleared immediately
    → messages.push({ role: "user", content: trimmedQuestion })
    → isAnswering = true          → button shows "Answering..."
    → "Searching excerpts..." text appears in chat box
             │
             │  POST /api/chat
             │  Body: {
             │    question:  "What are the pricing plans?",
             │    siteIndex: { siteId, rootUrl, hostname,
             │                 indexedAt, chunks: [...] }
             │  }
             │  (full siteIndex sent from browser React state)
             ▼
──────────────────────────────────────────────────────────────
SERVER  app/api/chat/route.ts
──────────────────────────────────────────────────────────────

  [G] INPUT VALIDATION
      question?.trim()  → if empty → 400 "Question is required."
      body.siteIndex    → if missing → 400 "Crawl a website first."
             │
             │  calls answerQuestion(question, siteIndex)
             ▼

  [H] lib/rag.ts  →  answerQuestion()

    H-1  EMBED THE QUESTION
         embedQuery("What are the pricing plans?")
           → embedTexts([question])   ← single-item array
           → one Gemini embeddings API call
           → returns queryEmbedding: number[]  (768 dimensions)
             e.g. [0.012, -0.034, 0.091, ... 768 values]

    H-2  VECTOR SEARCH  (lib/vector-store.ts  searchIndex)
         For EACH IndexedChunk in siteIndex.chunks:
           score = cosineSimilarity(queryEmbedding, chunk.embedding)

           cosineSimilarity formula:
             dot  = sum(a[i] * b[i])      ← element-wise multiply
             |a|  = sqrt(sum(a[i]²))
             |b|  = sqrt(sum(b[i]²))
             score = dot / (|a| × |b|)
             range: 0.0 (completely unrelated) → 1.0 (identical)

         Sort all { chunk, score } pairs by score DESC
         Take top 5  →  RetrievalMatch[]

    H-3  BUILD CONTEXT  (rag.ts  buildContext)
         Format top 5 chunks as a text block:

           SOURCE 1
           URL: https://docs.example.com/pricing
           Title: Pricing | Example Docs
           Chunk: 0
           Similarity: 0.8921
           Excerpt:
           [~850 words of raw text from that chunk]

           ---

           SOURCE 2
           URL: https://docs.example.com/faq
           Title: FAQ | Example Docs
           Chunk: 1
           Similarity: 0.7643
           Excerpt:
           [~850 words of raw text]

           ---  ...and so on for all 5 sources

    H-4  CALL GEMINI CHAT API
         client.chat.completions.create({
           model: GEMINI_API_KEY_MODEL,
           temperature: 0,   ← deterministic, no creativity
           messages: [
             {
               role: "system",
               content:
                 "Answer only from the provided website excerpts.\n"
                 "Do not use outside knowledge.\n"
                 "If the answer is missing, say so clearly.\n"
                 "Cite sources using the provided source URLs.\n"
                 "Keep the answer concise and useful."
             },
             {
               role: "user",
               content:
                 "Question: What are the pricing plans?\n"
                 "\n"
                 "Website excerpts:\n"
                 + [the 5 SOURCE blocks from H-3]
             }
           ]
         })

         answer = completion.choices[0]?.message?.content?.trim()
                  || "I could not find that information."

    H-5  CHECK FOR "NOT FOUND" RESPONSE
         Lowercase the answer, scan for any of these phrases:
           "not contain"   "does not contain"   "do not contain"
           "not found"     "cannot find"        "could not find"
           "no information" "not mention"
           "not available" "not provided"
           "i'm sorry"     "i am sorry"         "sorry, but"

         If matched → isNotFound = true

    H-6  BUILD SOURCES  (rag.ts  uniqueSources)
         Deduplicate top-5 chunks by URL:
           Multiple chunks from same page → one Source entry
         If isNotFound → sources = []  (suppress misleading links)
         If found      → sources = [{ url, title }, ...]

         Returns: { answer: string, sources: Source[] }
             │
             │  HTTP 200 JSON:
             │  {
             │    answer:  "The pricing plans are...",
             │    sources: [
             │      { url: "https://.../pricing",
             │        title: "Pricing | Example" },
             │      { url: "https://.../faq",
             │        title: "FAQ | Example" }
             │    ]
             │  }
             │
             │  On API error → translate known codes:
             │    503 → "AI service temporarily unavailable"
             │    429 → "Rate-limited, wait a few seconds"
             │    401/403 → "Check API key in .env.local"
             ▼
──────────────────────────────────────────────────────────────
USER BROWSER  (app/page.tsx  handleAsk  receives response)
──────────────────────────────────────────────────────────────
  if (!response.ok) → setChatError(data.error) → red banner

  messages.push({
    role:    "assistant",
    content: data.answer,
    sources: data.sources
  })
  isAnswering = false  ← button resets to "Ask"

  MessageBubble renders for each message:
    USER message  (align right, indigo gradient background):
      "What are the pricing plans?"

    ASSISTANT message  (align left, white card, shadow):
      [answer text — whitespace-pre-wrap preserves line breaks]
      ─────────────────────────────────
      SOURCES
      • Pricing | Example   ← <a target="_blank" rel="noreferrer">
      • FAQ | Example       ← <a target="_blank" rel="noreferrer">
      (only shown if sources[] is not empty)
──────────────────────────────────────────────────────────────
```

---

## 5. File-by-File Explanation

---

### `.env.local.example`
Template for secret environment variables. Copy to `.env.local` and fill in real values.

```bash
GEMINI_API_KEY=AIzaSy...          # Your Google Gemini API key
GEMINI_API_KEY_MODEL=gemini-2.5-flash  # Chat model name
GEMINI_EMBEDDING_MODEL=text-embedding-004  # Embedding model name
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
# ↑ Points the OpenAI SDK at Gemini's OpenAI-compatible endpoint
```

---

### `types/robots-parser.d.ts`
Manual TypeScript type declaration for the `robots-parser` package (which has no built-in types).

```ts
declare module "robots-parser" {
  export interface RobotsParser {
    isAllowed(url: string, userAgent?: string): boolean | undefined;
    getCrawlDelay(userAgent?: string): number | undefined;
  }
  export default function robotsParser(url: string, contents: string): RobotsParser;
}
```

---

### `lib/types.ts`
**Central type definitions** — the "contract" all files agree on.

```ts
// How the crawler should behave
type CrawlConfig = { maxPages, maxDepth, requestDelayMs, fetchTimeoutMs, minPageWords, userAgent }

// One successfully crawled page
type CrawledPage = { url, title, text, depth }

// Results of a full crawl session
type CrawlOutput = { rootUrl, pages: CrawledPage[], errors, warnings }

// A text slice of a page (~850 words)
type TextChunk = { id, url, title, text, chunkIndex }

// TextChunk + its AI vector representation
type IndexedChunk = TextChunk & { embedding: number[] }

// The entire indexed website saved in memory
type SiteIndex = { siteId, rootUrl, hostname, indexedAt, chunks: IndexedChunk[] }

// One search result from the vector store
type RetrievalMatch = { chunk: IndexedChunk, score: number }

// A source link shown to the user
type Source = { url, title }

// API response shapes
type CrawlApiResponse = { siteId, rootUrl, pagesCrawled, chunksCreated, errors, warnings, siteIndex }
type ChatApiResponse  = { answer: string, sources: Source[] }
```

---

### `lib/openai.ts`
Creates the AI client. Uses the OpenAI SDK but points it at Google Gemini's OpenAI-compatible API.

```ts
export function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: requireEnv("GEMINI_API_KEY"),   // Your Gemini key
    baseURL: process.env.OPENAI_BASE_URL    // Gemini's OpenAI-compatible endpoint
  });
}
export function getChatModel()      { return requireEnv("GEMINI_API_KEY_MODEL"); }
export function getEmbeddingModel() { return requireEnv("GEMINI_EMBEDDING_MODEL"); }
// requireEnv() throws a clear error if a variable is missing from .env.local
```

---

### `lib/robots.ts`
Fetches `robots.txt` and returns a policy object the crawler uses to check permissions.

```ts
export async function loadRobotsPolicy(origin, userAgent): Promise<RobotsPolicy> {
  // 1. Fetch https://origin/robots.txt (8s timeout)
  // 2. If 404 → allow everything (no robots.txt = no restrictions)
  // 3. If other error → allow everything + add warning
  // 4. If success → parse with robots-parser:
  return {
    isAllowed: (url) => parser.isAllowed(url, userAgent) !== false,
    // "!== false" means: undefined (not mentioned) counts as allowed
    crawlDelayMs: crawlDelaySeconds * 1000,  // Convert seconds → ms
    warnings
  };
}
```

---

### `lib/extract.ts`
Parses raw HTML into clean, readable text and a list of links.

```ts
export function extractPage(html: string): ExtractedPage {
  const $ = cheerio.load(html);           // Parse HTML like browser DOM

  const links = $("a[href]")              // Collect all hyperlinks first
    .map((_, a) => $(a).attr("href")).get().filter(Boolean);

  const title = $("title").first().text() || $("h1").first().text() || "Untitled page";

  // Remove noise: scripts, styles, navs, footers, cookie banners, ads...
  $("script,style,noscript,svg,iframe,nav,footer,form,button,aside").remove();
  $("[role='navigation'],[role='banner'],[aria-hidden='true']").remove();
  // Also removes elements whose id/class contains: cookie, gdpr, popup, modal, ad-...

  // Try content selectors in order of preference
  const candidates = ["main","article","[role='main']","#content",".content","body"];
  let bestText = "";
  for (const sel of candidates) {
    $(sel).each((_, el) => {
      const text = getStructuredText($, el); // Extracts h1-h6, p, li, td, th
      if (text.length > bestText.length) bestText = text;  // Keep longest
    });
  }

  return { title, text: cleanWhitespace(bestText), links };
}
```

---

### `lib/crawler.ts`
**BFS web crawler** — visits pages level by level, staying on the same domain, respecting robots.txt and polite delays.

```ts
export const DEFAULT_CRAWL_CONFIG = {
  maxPages: 10,         // Visit at most 10 pages
  maxDepth: 2,          // Follow links up to 2 levels deep
  requestDelayMs: 700,  // Wait 700ms between requests
  fetchTimeoutMs: 12_000, // Give up on slow pages after 12s
  minPageWords: 80,     // Skip pages with fewer than 80 words
  userAgent: "ChatWithWebsiteRAG/1.0 ..."
};

export async function crawlSite(inputUrl, overrides): Promise<CrawlOutput> {
  const config = { ...DEFAULT_CRAWL_CONFIG, ...overrides };
  const rootUrl = normalizeUrl(inputUrl);   // Clean & validate URL
  const robots  = await loadRobotsPolicy(origin, config.userAgent);

  const queue   = [{ url: rootUrl, depth: 0 }];  // BFS queue
  const visited = new Set();   // Prevents revisiting URLs
  const queued  = new Set();   // Prevents adding duplicates to queue

  while (queue.length > 0 && requestedPages < config.maxPages) {
    const { url, depth } = queue.shift();  // Take next URL (BFS = FIFO)

    // Skip if: visited, wrong domain, disallowed by robots.txt, too deep
    if (visited.has(url) || !sameHostname(url) || !robots.isAllowed(url)) continue;
    visited.add(url);

    await sleep(politeDelay);              // Wait between requests
    const response = await fetchWithTimeout(url, 12_000);
    if (!response.ok || !isHTML(response)) continue;

    const { title, text, links } = extractPage(await response.text());
    if (wordCount(text) >= config.minPageWords) pages.push({ url, title, text, depth });

    if (depth < config.maxDepth) {
      // Add discovered same-domain links to queue
      for (const href of links) {
        const next = normalizeUrl(href, url);  // Resolve relative URLs
        if (next && sameHostname(next) && !queued.has(next)) {
          queued.add(next);
          queue.push({ url: next, depth: depth + 1 });
        }
      }
    }
  }
  return { rootUrl, pages, errors, warnings };
}

// normalizeUrl() standardises URLs:
//   - Lowercases hostname
//   - Removes #fragments, default ports, trailing slashes
//   - Strips tracking params (utm_*, fbclid, gclid)
//   - Sorts remaining query params (so ?a=1&b=2 == ?b=2&a=1)
```

---

### `lib/chunk.ts`
Splits long page text into overlapping chunks so the AI can index and retrieve pieces precisely.

```ts
export const DEFAULT_CHUNK_OPTIONS = {
  targetWords:  850,  // Each chunk is ~850 words
  overlapWords: 120,  // Last 120 words of chunk N appear at start of chunk N+1
  minChunkWords: 80   // Discard tiny trailing chunks
};

export function chunkPage(page, pageIndex, options): TextChunk[] {
  const allWords = page.text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start = 0, chunkIndex = 0;

  while (start < allWords.length) {
    const end   = Math.min(start + config.targetWords, allWords.length);
    const slice = allWords.slice(start, end);  // Get current chunk words

    if (slice.length >= config.minChunkWords || chunks.length === 0) {
      chunks.push({
        id: `page-${pageIndex}-chunk-${chunkIndex}`,
        url: page.url, title: page.title,
        text: slice.join(" "), chunkIndex
      });
      chunkIndex++;
    }

    if (end === allWords.length) break;  // Done with this page

    // Overlap: next chunk starts 120 words before end of current chunk
    start = Math.max(end - config.overlapWords, start + 1);
  }
  return chunks;
}

// chunkPages() just flatMaps chunkPage() over all pages
```

**Why overlap?** A concept spanning the boundary of two chunks would be missing from both. Overlap ensures boundary content is fully captured in at least one chunk.

---

### `lib/embeddings.ts`
Converts text into **vectors** — arrays of numbers representing semantic meaning.

```ts
const EMBEDDING_BATCH_SIZE = 64;  // Send 64 texts per API call

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += 64) {
    if (i > 0) await sleep(2000);   // 2s delay between batches (Gemini rate limit)

    const batch = texts.slice(i, i + 64);
    const response = await client.embeddings.create({ model, input: batch, encoding_format: "float" });

    // Sort by index to preserve original order, then extract the number arrays
    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    embeddings.push(...sorted.map(item => item.embedding));
  }
  return embeddings;
}

export async function embedQuery(question: string): Promise<number[]> {
  const [embedding] = await embedTexts([question]);
  return embedding;  // Returns a single vector for the question
}
```

---

### `lib/vector-store.ts`
**In-memory store** for all indexed sites. Also implements cosine similarity search.

```ts
// Attached to globalThis so it survives Next.js hot-reloads in dev mode
const globalForStore = globalThis as { __chatWithWebsiteStore?: StoreState };

export const vectorStore = {
  save(index: SiteIndex) { state.indexes.set(index.siteId, index); },
  get(siteId?)           { return state.indexes.get(siteId ?? state.latestSiteId); },
  clear()                { state.indexes.clear(); }
};

// Cosine similarity formula: dot(a,b) / (|a| × |b|)
// Result: 0 = unrelated, 1 = identical meaning
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return (normA && normB) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

// Score every chunk, sort by score, return top K
export function searchIndex(index: SiteIndex, queryEmbedding: number[], topK = 5): RetrievalMatch[] {
  return index.chunks
    .map(chunk => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
```

---

### `lib/rag.ts`
**Orchestrates the full RAG pipeline** — from question → relevant chunks → AI answer.

```ts
export async function answerQuestion(question, siteIndex): Promise<ChatApiResponse> {
  // STEP 1 — Embed the question
  const queryEmbedding = await embedQuery(question);

  // STEP 2 — Retrieve top 5 most similar chunks
  const matches = searchIndex(siteIndex, queryEmbedding, 5);
  if (matches.length === 0) return { answer: "Could not find that information.", sources: [] };

  // STEP 3 — Build context block for the prompt
  const context = matches.map((m, i) =>
    `SOURCE ${i+1}\nURL: ${m.chunk.url}\nTitle: ${m.chunk.title}\nExcerpt:\n${m.chunk.text}`
  ).join("\n\n---\n\n");

  // STEP 4 — Call Gemini chat API
  const completion = await client.chat.completions.create({
    model, temperature: 0,  // temperature:0 = deterministic/factual
    messages: [
      { role: "system", content:
        "Answer only from the provided website excerpts.\n" +
        "Do not use outside knowledge.\n" +
        "If the answer is missing, say so clearly.\n" +
        "Cite sources using the provided URLs." },
      { role: "user", content: `Question: ${question}\n\nWebsite excerpts:\n${context}` }
    ]
  });

  const answer = completion.choices[0]?.message?.content?.trim() || "Could not find information.";

  // STEP 5 — Suppress sources if answer is "not found"
  const NOT_FOUND = ["not contain","not found","cannot find","no information","not mention","i'm sorry"];
  const isNotFound = NOT_FOUND.some(p => answer.toLowerCase().includes(p));

  return { answer, sources: isNotFound ? [] : uniqueSources(matches) };
  // uniqueSources() deduplicates: multiple chunks from same page → one source link
}
```

---

### `app/api/crawl/route.ts`
**POST /api/crawl** — the server endpoint that runs the full crawl-chunk-embed-save pipeline.

```ts
export const runtime = "nodejs";      // Use Node.js (not Edge) — required for robots-parser
export const dynamic = "force-dynamic"; // Never cache this route

export async function POST(request: NextRequest) {
  const { url, maxPages, maxDepth } = await request.json();

  // Validate & sanitize inputs (clampNumber ensures safe integer in [min, max])
  const crawl   = await crawlSite(url, { maxPages: clamp(maxPages, 10, 1, 50), maxDepth: clamp(maxDepth, 2, 0, 4) });
  const chunks  = chunkPages(crawl.pages);   // Split pages into chunks
  if (chunks.length === 0) return error422("No useful text found");

  const embeddings = await embedTexts(chunks.map(c => c.text));  // Vectorize all chunks
  const indexedChunks = chunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));

  const siteIndex: SiteIndex = {
    siteId: `${hostname}-${Date.now()}`,  // Unique ID
    rootUrl, hostname,
    indexedAt: new Date().toISOString(),
    chunks: indexedChunks
  };

  vectorStore.save(siteIndex);  // Store in server memory

  return NextResponse.json({ siteId, rootUrl, pagesCrawled, chunksCreated, errors, warnings, siteIndex });
  // Error handling translates 503/429/401 codes into friendly user messages
}
```

---

### `app/api/chat/route.ts`
**POST /api/chat** — receives the question + site index from the browser and returns an AI answer.

```ts
export async function POST(request: NextRequest) {
  const { question, siteIndex } = await request.json();

  // Validate: question must not be empty, siteIndex must exist
  if (!question) return error400("Question is required.");
  if (!siteIndex) return error400("No crawled site index. Crawl a website first.");

  // Run the RAG pipeline — siteIndex is sent from browser (avoids server-side lookup)
  const result = await answerQuestion(question, siteIndex as SiteIndex);
  return NextResponse.json(result);  // { answer, sources[] }

  // Error handling translates 503/429/401 into friendly messages
}
```

---

### `app/layout.tsx`
Root HTML shell. Wraps every page. Sets browser tab title and meta description.

```tsx
export const metadata = {
  title: "Chat with a Website",
  description: "Crawl a website and ask grounded questions with source links."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>   {/* children = whatever page is active */}
    </html>
  );
}
// globals.css is imported here → applied to all pages
```

---
---

### `app/page.tsx`
**Main UI** — the entire chat interface. A single client component managing all state.

```tsx
"use client";  // Required: this component uses hooks and event handlers

export default function HomePage() {
  // ── State ─────────────────────────────────────────────────────
  const [url, setUrl]             = useState("");            // URL input
  const [crawlResult, setCrawlResult] = useState(null);     // Crawl summary stats
  const [siteIndex, setSiteIndex]   = useState(null);       // Full index (for chat)
  const [crawlError, setCrawlError] = useState(null);       // Error to display
  const [isCrawling, setIsCrawling] = useState(false);      // Loading state
  const [question, setQuestion]   = useState("");           // Chat input
  const [messages, setMessages]   = useState([]);           // Chat history
  const [isAnswering, setIsAnswering] = useState(false);    // Loading state
  const [chatError, setChatError]   = useState(null);       // Error to display

  // ── Crawl Handler ─────────────────────────────────────────────
  async function handleCrawl(event) {
    event.preventDefault();  // Prevent page reload
    setIsCrawling(true); setCrawlResult(null); setMessages([]);

    const response = await fetch("/api/crawl", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    setSiteIndex(data.siteIndex);  // Store full index for chat requests
    setCrawlResult(data);          // Store summary to show stats
    setIsCrawling(false);
  }

  // ── Chat Handler ──────────────────────────────────────────────
  async function handleAsk(event) {
    event.preventDefault();
    setMessages(curr => [...curr, { role: "user", content: question }]);
    setQuestion(""); setIsAnswering(true);

    const response = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, siteIndex })  // Send full index back to server
    });
    const data = await response.json();

    setMessages(curr => [...curr, { role: "assistant", content: data.answer, sources: data.sources }]);
    setIsAnswering(false);
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <main>
      {/* Section 1: Header card */}
      {/* Section 2: Crawl form + stats cards + warnings collapsible */}
      {/* Section 3: Chat messages + ask form  (shown only after crawl) */}
    </main>
  );
}

// StatusCard: shows a label + big value (e.g. "Pages crawled: 10")
function StatusCard({ label, value }) { /* ... */ }

// MessageBubble: user messages align right (indigo), assistant align left (white card)
// Assistant bubbles show source links below the answer text
function MessageBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={isUser ? "bg-slate-950 text-white" : "bg-white text-slate-900 shadow-sm"}>
        <div className="whitespace-pre-wrap">{message.content}</div>
        {/* Sources: only for assistant messages with sources[] */}
        {!isUser && message.sources?.map(src =>
          <a href={src.url} target="_blank">{src.title || src.url}</a>
        )}
      </div>
    </div>
  );
}
```

---

### `eval/examples.json`
Test data for the offline evaluation script.

```json
[
  {
    "siteUrl": "https://example.com",
    "questions": [
      {
        "question": "What is this website used for?",
        "expectedSourceHint": "example.com"  // Source URL must contain this string
      }
    ]
  }
]
```

---

### `eval/run.ts`
Runs the RAG pipeline from the **command line** (`npm run eval`) — no browser needed. Used for testing.

```ts
async function indexSite(siteUrl): Promise<SiteIndex> {
  // Same pipeline as /api/crawl: crawl → chunk → embed → return index
  const crawl   = await crawlSite(siteUrl, { maxPages: 10, maxDepth: 1 });
  const chunks  = chunkPages(crawl.pages);
  const embeddings = await embedTexts(chunks.map(c => c.text));
  return { siteId: `eval-${hostname}-${Date.now()}`, ..., chunks: indexedChunks };
}

async function main() {
  for (const example of examples) {
    const index = await indexSite(example.siteUrl);  // Crawl & index

    for (const { question, expectedSourceHint } of example.questions) {
      const result = await answerQuestion(question, index);  // RAG answer

      console.log("Question:", question);
      console.log("Answer:", result.answer);
      console.log("Sources:", result.sources.map(s => s.url).join(", "));

      // Check if any source URL contains the expected hint
      if (expectedSourceHint) {
        const matched = result.sources.some(s => s.url.includes(expectedSourceHint));
        console.log("Expected source matched:", matched ? "yes" : "no");
      }
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
```

---

## 6. Step-by-Step Workflow

### Phase 1 — Crawl (User clicks "Crawl Site")

```
1.  User types URL → page.tsx sends POST /api/crawl
2.  crawl/route.ts receives request, validates URL
3.  robots.ts fetches robots.txt → builds permission policy
4.  crawler.ts starts BFS loop:
      a. Dequeue next URL
      b. Check: not visited, same domain, robots allowed
      c. Sleep polite delay (≥700ms)
      d. Fetch page (12s timeout)
      e. extract.ts: remove boilerplate → get clean text + links
      f. If ≥80 words → save as CrawledPage
      g. Enqueue discovered links (if depth < maxDepth)
      h. Stop when queue empty or 10 pages visited
5.  chunk.ts splits all pages into ~850-word chunks (120-word overlap)
6.  embeddings.ts sends chunks to Gemini → each gets a number[] vector
7.  vector-store.ts saves SiteIndex (all chunks + vectors) in memory
8.  Return { siteId, pagesCrawled, chunksCreated, siteIndex } to browser
9.  page.tsx shows stats cards + reveals chat section
```

### Phase 2 — Chat (User asks a question)

```
1.  User types question → page.tsx sends POST /api/chat { question, siteIndex }
2.  chat/route.ts validates inputs
3.  rag.ts → embedQuery(question) → question becomes a vector
4.  vector-store.ts → cosineSimilarity(questionVec, each chunk) → top 5 chunks
5.  rag.ts → format top 5 as SOURCE blocks with URL, title, excerpt
6.  Gemini chat API called with:
      system: "Answer only from the provided excerpts, cite sources"
      user:   "Question: ... \n Website excerpts: [5 chunks]"
7.  Gemini returns grounded answer
8.  If answer says "not found" → suppress source links
9.  Return { answer, sources[] } to browser
10. page.tsx adds assistant bubble with answer + clickable source links
```

---

## 7. Key Concepts

| Concept | Simple Explanation |
|---------|-------------------|
| **Embedding** | Text converted to numbers. Similar meaning → similar numbers. "AI pricing" and "cost of AI" are close in vector space. |
| **Cosine Similarity** | Measures the angle between two vectors. Angle ≈ 0° → score ≈ 1 (same meaning). Angle ≈ 90° → score ≈ 0 (unrelated). |
| **BFS Crawl** | Visit all pages at depth 1 before depth 2. Like exploring a building floor by floor. |
| **Chunking** | Split long pages into ~850-word pieces so the AI can index and retrieve precise sections. |
| **Overlap** | The last 120 words of chunk N are also the first 120 words of chunk N+1. Prevents content being "cut in half" at a boundary. |
| **globalThis store** | Next.js hot-reload resets module variables. Storing the index on `globalThis` makes it survive reloads. |
| **SiteIndex in body** | The browser sends the full index back with each chat request. Simpler than a server-side session — no lookup needed. |
| **temperature: 0** | Makes the AI deterministic and factual — no creative guessing, just information from the provided excerpts. |

---

*Built with Next.js 14 · React 18 · TypeScript · Gemini AI · Cheerio*
