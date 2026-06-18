# Chat with a Website — Crawl + RAG

You give it a URL. It crawls the site, pulls out the readable text, builds a searchable index using embeddings, and lets you ask questions about what it found. Answers come with links back to the source pages so you can verify them yourself.

The interesting part isn't the chat box — it's the pipeline underneath: scoped crawling, polite fetching, boilerplate stripping, chunking, vector search, and making sure the model only says things it can actually back up.

## Tech stack

- **Frontend:** Next.js App Router + React + TypeScript
- **Backend:** Next.js API routes on Node.js
- **Styling:** Tailwind CSS
- **HTML parsing:** Cheerio
- **robots.txt:** robots-parser
- **LLM + Embeddings:** OpenAI SDK pointed at Google's Gemini via their OpenAI-compatible endpoint
- **Vector store:** In-memory cosine similarity (no database needed)

## Requirements Met

This project implements all core requirements from the assignment prompt:
- **Scoped crawling:** Crawls strictly within the same hostname, enforcing max page (10) and depth (2) limits so it doesn't wander the internet.
- **Polite fetching:** Respects `robots.txt` rules and enforces a 700ms crawl delay between requests to avoid hammering the site.
- **Searchable index:** Extracts text, chunks it, embeds it, and stores it in a fast in-memory vector store for cosine-similarity search.
- **Chat interface:** A clean UI to ask questions and get answers grounded only in the retrieved excerpts.
- **Source citations:** Every answer includes direct links back to the exact pages the information was pulled from.
- **Anti-hallucination:** If the site doesn't contain the answer, the model explicitly says so, and misleading source links are suppressed.

In addition, it completes two of the stretch goals:
- **Boilerplate stripping:** Uses Cheerio to remove navs, footers, asides, and cookie banners before text extraction so the index isn't polluted.
- **Basic eval:** Includes a CLI eval script (`npm run eval`) with question/expected-source pairs to sanity-check retrieval quality.

The two stretch goals didnt get completed are: 
- **Streaming responses for a responsive feel.** - The responses are not streamed. They are sent in a single chunk.
- **Handling JavaScript-rendered pages.** - The crawler doesnt handle JavaScript-rendered pages. 


## Getting started

```bash
npm install
```

Open `.env.local` and fill in your values:  

```bash
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_API_KEY_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
```

Get a Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The free tier works fine for testing, though you may hit rate limits on sites with a lot of pages.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and you're good to go.

## Environment variables

| Variable | What it does |
| --- | --- |
| `GEMINI_API_KEY` | Your Gemini API key |
| `GEMINI_API_KEY_MODEL` | The chat model — `gemini-2.5-flash` is a good default |
| `GEMINI_EMBEDDING_MODEL` | Embedding model — use `gemini-embedding-001` |
| `OPENAI_BASE_URL` | Routes the OpenAI SDK to Gemini's endpoint |

## How to use it

1. Paste a website URL into the input field
2. Hit **Crawl site** and wait — it'll show you how many pages it found and how many chunks were indexed
3. Once that's done, ask questions in the chat box
4. Each answer includes links to the pages it pulled the information from

## How the crawler works

I kept the crawler deliberately simple. It starts at the URL you give it, does a BFS traversal, and stays strictly within the same hostname. It won't follow links to external sites.

A few things it handles:
- URL normalization — strips tracking params, lowercases hostnames, removes hash fragments, deduplicates trailing slashes so the same page doesn't get crawled twice
- Fetches and respects `robots.txt` before making any requests
- Uses a polite 700ms delay between requests, or whatever the site's crawl-delay says if that's higher
- Identifies itself with a custom user agent: `ChatWithWebsiteRAG/1.0`
- Skips non-HTML responses (PDFs, images, etc.)
- Hard limits: 10 pages max, depth 2 — enough to get a real picture of a site without hammering it

The fetch step is HTML-only. Sites that rely heavily on JavaScript to render their content won't work well — the crawler will get the skeleton HTML, not the rendered page.

## How extraction works

Once a page is fetched, Cheerio strips out the noise before any text gets stored. That means removing `<script>`, `<style>`, `<nav>`, `<footer>`, `<aside>`, iframes, forms, and anything that looks like a cookie banner, consent popup, newsletter signup, or ad based on common class/id/aria patterns.

After that, it looks for the main content area by checking candidates in order — `<main>`, `<article>`, `[role="main"]`, common content containers — and picks whichever has the most text. This is best-effort; it works well on most sites but won't be perfect on everything.

## How chunking works

Text gets split into word-based chunks rather than token-based ones. Word counting is simpler, easier to reason about, and transparent to anyone reading the code.

The defaults:
- **Target size:** 850 words per chunk
- **Overlap:** 120 words between adjacent chunks (so context doesn't get cut at a boundary)
- **Minimum:** 80 words — tiny fragments get dropped

Each chunk carries its source URL, page title, and chunk index so retrieval results can always be traced back to the original page.

## How retrieval works

**At crawl time:**
1. Each chunk gets embedded using `GEMINI_EMBEDDING_MODEL`
2. All chunks + their vectors are stored in memory as a `SiteIndex`

**At question time:**
1. The question gets embedded with the same model
2. Cosine similarity is computed between the question and every chunk
3. Top 5 matches are selected
4. Those excerpts get passed to the chat model with a strict system prompt
5. The source pages are deduplicated and shown under the answer

## How grounding works

The system prompt is explicit: answer only from the provided excerpts, don't use outside knowledge, and say clearly when the answer isn't there. Temperature is set to 0.

If the model says it can't find something, the source links are suppressed — there's no point showing "Sources" when the answer is "I don't know." The sources shown under an answer are always the chunks that were actually retrieved, never anything else.

This doesn't guarantee perfection. Prompts can fail. But keeping the context narrow and temperature low makes hallucinations much less likely, and showing sources lets users verify things themselves.


## Why in-memory vector storage?

For a take-home project scoped to one site at a time, a persistent database adds complexity without much benefit. In-memory storage means:

- Zero setup — just run the app
- The retrieval code is easy to read and explain
- It's fast for the page counts involved

The obvious downside is that the index disappears when the server restarts. In a real product you'd move this to something like pgvector, Qdrant, or LanceDB. I mention that in the future improvements section.

## Running the eval

There's a small eval script that crawls a site, indexes it, asks a set of questions, and prints the answers alongside source URLs. It's not a proper benchmark — just a sanity check to make sure retrieval is working as expected.

```bash
npm run eval
```

Edit `eval/examples.json` to point it at whatever site and questions you want to test.

## Known limitations

**JavaScript-rendered sites:** The crawler uses plain HTTP fetching, so sites that render their content with React, Vue, or similar frameworks will only return the shell HTML. Playwright would fix this but adds significant complexity and doesn't work on Vercel without workarounds.

**In-memory index:** Restarting the server loses the index. On serverless deployments like Vercel, different function instances don't share memory, so the index built by one request might not be available for the next.

**One site at a time:** The UI is built around a single active crawl. There's no multi-site management or user isolation.

**Chunking is approximate:** Word-based splitting doesn't account for how the model actually tokenizes text. It's good enough in practice but not precise.

**Rate limits on the free tier:** The embedding step makes multiple API calls during a crawl. Free-tier Gemini keys have low per-minute limits, so large sites may hit 429 errors. Waiting a minute and retrying usually works.

**No streaming:** Answers wait for the full LLM response before appearing. On slow models or long answers this means a few seconds of loading. Streaming is on the improvement list.

## What I'd do with more time

1. Streaming responses — answers should stream in token by token rather than waiting for the full response
2. Persistent vector storage — pgvector if you're already on Postgres, or Qdrant/LanceDB as a standalone option
3. Playwright fallback for JavaScript-heavy sites
4. Sitemap discovery — crawling `/sitemap.xml` would give much better coverage without needing to follow every link
5. Reranking — a second-pass reranker after the initial vector search would improve precision on tricky queries
6. Better eval — right now it's basically a smoke test; proper recall measurement would need a ground-truth dataset
7. Source highlighting — showing the exact passage that drove an answer, not just the page URL
8. Background crawl jobs — for bigger sites, the crawl should run in the background with progress updates rather than blocking the request
