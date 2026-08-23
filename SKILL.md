---
name: buzzlens
description: Research real user feedback about a company, product, or feature from YouTube, Reddit, Twitter/X, or any community website (forum, review site, blog comments), then write a grounded analysis (sentiment split, what people like/dislike, feature requests with user counts, real quotes) and save it to a local dashboard. Use when the user asks to research, analyze, or find out what people think of / are saying about / complaining about a product, company, or feature — e.g. "what do people think of X", "research feedback on X", "analyze reviews for X", "find complaints about X", "what are users asking for in X", "check the comments on this forum thread/review page".
---

# BuzzLens Research

This skill collects **real** user feedback and saves it locally. It does not generate the analysis
itself — that's you: read the data it collects and write the insight, the same way you would with any
other data handed to you. There is no LLM API call to make and nothing to configure for that.

This skill is fully self-contained — everything it needs lives in this same folder.

## Phase 0: One-time setup

If `node_modules/` doesn't exist yet in this skill's folder, install its dependencies first:

```
npm install
```

(This installs a few small packages — `exceljs`, `express`, `open`, `dotenv`, `chalk`, `cheerio` — used for
saving datasets, running the local dashboard, reading credentials, and parsing community-site HTML. Nothing else.)

## Phase 1: Ask, then collect

Before running anything, ask the user (skip a question only if they've already answered it in chat):

1. **What's the research topic?** — required, and must be an actual research topic (a company, product, or
   feature) — not a person, and not left blank. If what they give isn't one, ask again rather than guessing.
2. **Which sources?** — give exactly three options: **YouTube**, **Reddit**, or **both**.
3. **How should it proceed, based on those sources?** — YouTube and Reddit are both API-backed and need a
   credential in `.env`. Ask whether to proceed via the API (check/collect the credential — see "If a
   source is skipped" below) or go another way instead — e.g. pointing at specific community URLs (the
   `community` source) if they'd rather not set up API access.

Once you have the topic, sources, and (if relevant) URLs or credential decisions, run:

```
node scripts/search.js --topic "<topic>" --sources youtube,reddit --time 7days
```

- `--topic` — the company, product, or feature to research (required). Not a person.
- `--sources` — comma-separated: `youtube`, `reddit`, `twitter`, `community` (required) — from what the user chose above.
- `--time` — `24hours` | `7days` | `30days` | `custom` (default `7days`). For `custom`, also pass `--start YYYY-MM-DD --end YYYY-MM-DD`. Not used by `community` (it fetches the exact page(s) given, not a time-windowed search).
- `--keywords` — optional comma-separated related keywords to narrow the search.

If the user names a specific forum, review site, blog, or any other page with comments, use `community`
instead of (or alongside) the platform sources:

```
node scripts/search.js --topic "<topic>" --sources community --community-urls "https://forum.example.com/thread/1,https://reviews.example.com/product-x"
```

`--community-urls` is required when `community` is selected (comma-separated, one or more full `http(s)://`
URLs — the exact pages to scrape, not a search). It auto-detects common comment/review markup; if a
particular site isn't picked up, the output says "0 comments auto-detected" for that URL (not an error —
report it as such, don't treat it as a failure) and you can retry with manual selectors:

```
node scripts/search.js --topic "<topic>" --sources community --community-urls "<url>" \
  --comment-selector "<CSS selector for each comment's container>" \
  --text-selector "<CSS selector for the comment text, within the container>" \
  --author-selector "<CSS selector for the author, within the container>"
```

(Inspect the page's HTML structure to find good selectors if you need to — e.g. via a browser dev-tools
view or by fetching the page yourself first.) Comments with no resolvable author are printed as `Anonymous
#1`, `Anonymous #2`, etc. — each number is a distinct commenter, never a shared placeholder, so the
distinct-user counts below stay meaningful. This collector only reads static, server-rendered HTML — pages
that render comments purely via JavaScript (some embedded widgets) won't be visible to it.

Before recollecting, check `node scripts/list.js` — if the topic was already researched recently, reuse
that dataset id instead of running `search.js` again.

The command prints, directly to your terminal output: total/sentiment counts, per-source counts, theme
clusters for what people like / dislike / are asking for (each with how many **distinct users** said it,
not just a comment count), and real top quotes per source. This output is fully grounded — every number
and quote traces back to an actual collected item. **Never invent statistics or quotes beyond what's
printed.** For more than what's printed, the full dataset is in the Excel file at the path reported
(`data/datasets/<slug>_<timestamp>.xlsx`).

**YouTube and Reddit work without any credential** — both fall back to public, no-key collection (YouTube by
reading public search/watch pages, Reddit via its public JSON endpoints) when no API key is configured. This
fallback is lower-fidelity than the API path (YouTube: fewer comments per video, no reply threads,
approximate dates; Reddit: can be blocked outright on some networks). Whenever a source ran through this
fallback, the output says so inline next to that source's line — **carry that disclaimer into your Phase 2
analysis** (a line like "collected without a YouTube API key, so counts here are a lower bound" is enough)
rather than presenting the fallback data as equivalent to a full API collection.

**If a source is skipped or fails outright**, the output says exactly why (a missing key for Twitter, a
network block for Reddit, or for `community`, zero comments auto-detected) and, for API-backed sources,
where to add the missing credential — `.env` in this skill's own folder. If the user gives you a key in
chat, add it to `.env` yourself (create it from `.env.example` if missing) and re-run. Never fabricate data
for a skipped or failed source.

## Phase 2: Analyze

Using the printed data, write an analysis covering:
- Overall sentiment, grounded in the reported split
- What people like — cite real quotes from the positive clusters
- What people don't like / pain points — cite real quotes from the negative clusters
- Recommendations / feature requests, noting how many distinct users asked for each
- Notable differences between sources, if any
- What the data doesn't have enough evidence for — say so rather than guessing

Present this directly in your response to the user. No required format — write it the way you'd naturally
explain findings.

## Phase 3: Save

```
node scripts/save-summary.js <datasetId> --text "<your analysis>"
```

`<datasetId>` is printed in Phase 1's output (e.g. `ds_abc123`). For long analyses, write to a temp file
and use `--file <path>` instead of `--text`.

## Phase 4: Offer the dashboard (optional)

```
node scripts/dashboard.js <datasetId>
```

Opens a local visual dashboard — sentiment split, the same clusters/quotes, your saved analysis, and a
basic Q&A box (local keyword matching against the dataset, not you — don't rely on it for anything you can
just answer directly). Add `--static` to write a single shareable HTML file instead of starting a live
server. Only offer this if useful — it's not required to complete the research.

## What NOT to do

- Don't call any LLM API for this — you are the LLM. Nothing to configure.
- Don't substitute made-up comments or stats if collection fails or returns little data — report what
  happened and, if useful, suggest different keywords or a longer time period and re-run.
- Don't assume any other project or tool needs to be present — this skill's `scripts/` and `lib/` are
  everything it needs.
- Only point `--community-urls` at sites the user has permission to collect from — this collector doesn't
  check `robots.txt`, so use judgment rather than scraping indiscriminately.

## What this skill does not (yet) do

Comparing two collected topics against each other, or against a description of your own product, isn't
built into this skill's scripts. If asked for that, say so rather than approximating it — collecting each
topic separately with `search.js` and comparing the two printed summaries yourself is a reasonable
manual substitute in the meantime.
