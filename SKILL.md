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

**Before asking anything about credentials, check what's already configured:**

```
node scripts/credentials.js
```

This prints every credential BuzzLens knows about (masked) and whether it's set in `.env` — it never asks
the user to retype something they've already saved there. Run this first, then only ask the user about
credentials that come back `(not set)` and are relevant to the sources they want. If everything a source
needs is already `✔`, don't ask about it at all — just proceed. `.env` (copy `.env.example` to start one)
is the one local, gitignored file every API key lives in; it's never sent anywhere except each key's own
official API.

**Ask the user exactly one question up front — the research topic — and nothing else:**

> What do you want to research?

Keep it a plain, open question. Don't suggest example topics, don't guess one for them, and don't turn it
into a multiple-choice pick. It's required, and must be an actual research topic (a company, product, or
feature) — not a person, and not left blank. If what they give isn't one, ask again (still just the topic,
not a menu of options) rather than guessing.

Skip asking it at all if they've already stated a topic in chat. Everything below this point is handled
with sensible defaults or by reading the user's own wording — **do not turn any of it into an upfront
question**:

- **Sources** default to `youtube,reddit` (see `--sources` below) unless the user's own request already
  names something else — they said "check Twitter", they pasted a forum/review URL (→ `community`), or they
  said "just YouTube"/"just Reddit". Both defaults work with no credential via their public fallback, so
  there's nothing to block on.
- **Credentials**: already checked above via `scripts/credentials.js`. If something relevant is missing,
  don't stop to ask — just collect via the fallback (its inline disclaimer covers the trade-off) and, once
  results are back, mention in passing that adding e.g. `YOUTUBE_API_KEY` would improve fidelity/citations.
  Only ask for a credential proactively if the user brings it up, or if a source can't run at all without
  one (Twitter/X — see "If a source is skipped" below).
- **Specific YouTube videos or tweets**: don't ask whether the user has any. If they mention or paste video
  links or tweet links — now or later — collect those alongside the topic search rather than instead of it
  (see "YouTube: adding specific videos to the topic search" and "Twitter/X: topic search, replies, and
  specific tweets" below); up to **20** per run for each, pasted directly or via `youtube-videos.txt` /
  `tweets.txt`.
- **Analysis focus** (`--analysis-topic`): only set it if the user's own phrasing already implies a
  narrower angle within a broader ask (e.g. "search Siri AI but I really care about on-screen awareness").
  Don't ask for one.
- **Time window**: stays the documented default (`30days`) — mention it once, in the result, never as an
  upfront question.

Once you have the topic (and anything else the user's own message already specified), run:

```
node scripts/search.js --topic "<topic>"
```

- `--topic` — the company, product, or feature to research (required). Not a person.
- `--sources` — comma-separated: `youtube`, `reddit`, `twitter`, `community`. Optional — defaults to
  `youtube,reddit` when omitted, per the guidance above.
- `--analysis-topic` — optional, a narrower angle within `--topic` to focus the analysis on (e.g.
  `--topic "Siri AI" --analysis-topic "on-screen awareness"`). Collection is unaffected — this only carries
  through to the dataset and dashboard so Phase 2/3 knows what to focus on (see Phase 2 below).
- `--time` — `24hours` | `7days` | `15days` | `30days` | `custom` (**default `30days`**). Don't ask the user
  about this upfront — just tell them, once, that you're searching **the last 30 days** by default (the
  command's own output says this too, so you don't need to repeat it every run). If they want a narrower
  window, mention `--time 7days` or `--time 15days` are available and re-run with whichever they pick. For
  `custom`, also pass `--start YYYY-MM-DD --end YYYY-MM-DD`. Not used by `community` (it fetches the exact
  page(s) given, not a time-windowed search).
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

### YouTube: adding specific videos to the topic search

If the user already has particular YouTube videos in mind, they don't have to choose between that and the
topic search — both run **together** in the same call, via `--video-urls` or `--video-file` (never both in
the same run):

```
node scripts/search.js --topic "<topic>" --sources youtube --video-urls "https://youtu.be/abc123XYZ89,https://www.youtube.com/watch?v=def456UVW01"
node scripts/search.js --topic "<topic>" --sources youtube --video-file youtube-videos.txt
```

- `--video-urls` — comma-separated, pasted directly by the user in chat. Accepts full watch/`youtu.be`/
  shorts URLs or bare 11-character video IDs, any mix. **Up to 20 videos per run.**
- `--video-file` — path to a local text file, one video URL or ID per line (`#`-prefixed and blank lines
  ignored). `youtube-videos.example.txt` in this skill's folder is the template — if the user wants to keep
  a reusable list, have them (or you, on their instruction) copy it to `youtube-videos.txt` and edit it;
  that file is gitignored, same as `.env`, so it never leaves their machine.
- Either flag requires `--sources` to include `youtube`. The topic search still runs as normal — these
  flags add the named videos **on top of** the search results, they don't replace them.
- If more than 20 unique videos are given, only the first 20 are used and `search.js` says so in its
  output — mention that truncation to the user rather than letting it pass silently.
- **Deduplication**: if a listed video also turns up in the topic search results, it's fetched once, not
  twice — `search.js`'s output says so when it happens (e.g. "1 listed video(s) were already found by the
  topic search — collected once, not twice"), so you know the overlap was handled rather than silently
  dropped or double-counted.
- The `--time` window still applies to the topic-searched videos as normal, but not to the explicitly
  listed ones — comments from a listed video are collected regardless of date (mirrors how
  `--community-urls` behaves: an exact target list, not a time-windowed search). Reddit/other sources in the
  same run are unaffected either way.
- An unrecognized entry (not a valid YouTube URL/ID) fails the whole command with exactly which entry(ies)
  were bad, so the user can fix the list rather than silently skipping it.

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
approximate dates, **and no way to cite a specific comment — only the video, see "Citing comments
precisely" below**; Reddit: can be blocked outright on some networks). Whenever a source ran through this
fallback, the output says so inline next to that source's line — **carry that disclaimer into your Phase 2
analysis** (a line like "collected without a YouTube API key, so counts here are a lower bound" is enough)
rather than presenting the fallback data as equivalent to a full API collection.

**If a source is skipped or fails outright**, the output says exactly why (a missing key for Twitter, a
network block for Reddit, or for `community`, zero comments auto-detected) and, for API-backed sources,
where to add the missing credential — `.env` in this skill's own folder. If the user gives you a key in
chat, add it to `.env` yourself (create it from `.env.example` if missing) and re-run. Never fabricate data
for a skipped or failed source.

### Citing comments precisely

Every collected item's `link` field is meant to point at the specific comment, not just the page it's on —
that's what the dashboard's "cite this comment" links promise, and it's a real principle of this skill:
**a citation that only proves "this is the right video/thread" and not "this is the right comment" isn't a
real citation.**

- **Reddit, Twitter/X, and community** always give a genuine per-item link (a Reddit permalink, a tweet
  URL, or the community collector's best-effort in-page anchor) — no extra setup needed.
- **YouTube via the API** (`YOUTUBE_API_KEY` set) gives a true per-comment deep-link
  (`?v=<video>&lc=<commentId>`) for every comment, top-level or reply.
- **YouTube without a key** (the public-page fallback) cannot produce this — YouTube's public pages don't
  expose a stable per-comment id the fallback can use. Every link from that path is a video-level link
  only. The dashboard already labels this honestly ("watch video" vs. "cite this comment") rather than
  overclaiming — don't undo that in your own written analysis either; if you quote a fallback-collected
  comment, say the link goes to the video, not the comment.

If the user cares about precise citations for YouTube, that's a reason to mention the API path (add
`YOUTUBE_API_KEY`) once results are back, not something to work around after the fact.

### Twitter/X: topic search, replies, and specific tweets

`twitter` is a normal `--sources` value like any other — pick it alone (`--sources twitter`) for a
Twitter/X-only run, or combine it with YouTube or any other source in the same call
(`--sources youtube,twitter`) for one run that covers both. It needs `TWITTER_BEARER_TOKEN` in `.env`
(a paid X API tier — see "If a source is skipped" below); without it, `twitter` is skipped with a clear
reason, never faked.

```
node scripts/search.js --topic "<topic>" --sources twitter
node scripts/search.js --topic "<topic>" --sources youtube,twitter
```

- The topic search collects matching tweets **and** the replies underneath them ("comments under the
  posts") for a bounded number of the most-engaged tweets each run — both land in the same dataset as
  ordinary items (a reply's `contentTitle` says "Reply to a tweet by @user" so it's identifiable in the
  data, and it still carries its own genuine per-tweet link).
- **Specific tweets**: same idea as YouTube's specific videos — add them on top of the topic search with
  `--tweet-urls` or `--tweet-file` (never both in the same run), **up to 20 tweets per run**:

  ```
  node scripts/search.js --topic "<topic>" --sources twitter --tweet-urls "https://x.com/user/status/1234567890123456789"
  node scripts/search.js --topic "<topic>" --sources twitter --tweet-file tweets.txt
  ```

  `--tweet-urls` accepts full `twitter.com`/`x.com` status URLs or bare numeric tweet IDs, any mix.
  `--tweet-file` is a local text file, one tweet URL or ID per line (`#`-prefixed and blank lines
  ignored) — `tweets.example.txt` in this skill's folder is the template; copy it to `tweets.txt` for a
  reusable list (gitignored, same as `.env`/`youtube-videos.txt`). Either flag requires `--sources` to
  include `twitter`. If a listed tweet also turns up in the topic search, it's collected once, not twice —
  `search.js`'s output says so when it happens, same as the YouTube video-list dedup.
- Twitter/X's recent-search window (~7 days) still applies as documented below — this governs both the
  topic search and the reply-fetching, though not the explicit tweet lookup itself (an exact target list).

### Combined multi-source analysis, and viewing it separately

When a run collects from more than one source (e.g. `--sources youtube,twitter`), everything downstream —
the printed summary, the saved dataset, and your Phase 2 analysis — covers **all** of it together: read
every item regardless of source when writing the insights JSON, and let topics/pain points/requests draw
on both YouTube comments and Twitter posts/replies where the evidence supports it. Don't write two separate
analyses or silently favor one source.

The dashboard still lets the user view sources separately without a second collection run: whenever a
dataset has more than one source, it shows a filter bar ("All sources" / "YouTube" / "Twitter/X" / …) that
narrows every section — topics, pain points, loves, requests, recommendations, and the overview stats — down
to just that source's evidence, computed from each item's real `source` field. You don't need to do
anything for this to work; it's automatic once the dataset has more than one source. This is also why the
saved `.insights.json` file itself demarcates the mix: every entry gets a `sourceBreakdown` field (e.g.
`{"youtube": 5, "twitter": 2}`), and `overview.sourceBreakdown` covers the whole dataset — computed and
attached automatically when you run `save-summary.js`, from the real items, never something you need to
author yourself in the Phase 2 JSON.

## Phase 2: Analyze

Read every item printed in Phase 1 (and, if you need more than what's printed, the full dataset in the
reported Excel file) and write a **PM-focused insights JSON** — this is what drives the dashboard's 6
sections in Phase 3/4. Read the actual comment text yourself; don't just reuse the generic `theme` labels
from collection (`Design`, `Performance`, `General`, etc.) — those are a fast local heuristic for filtering,
not real product topics. Name topics the way a PM would (e.g. `Camera`, `Battery`, `Charging`), based on
what people actually wrote about.

**If an `--analysis-topic` was set** (printed in Phase 1's output as "Analysis focus"), every section —
`overview`, `topTopics`, `painPoints`, `loves`, `requests`, `recommendations` — should center on comments
relevant to that specific angle, not the full breadth of what was collected under the broader search topic.
If only a handful of items are directly on-topic, say so plainly (e.g. in `overview.topDiscussedTopic` or by
keeping a section short) rather than padding it out with tangentially related comments — a small, honest
insights set beats a padded one.

Build one JSON object with this shape and save it to a temp file:

```jsonc
{
  "overview": {
    "topDiscussedTopic": "Camera",                                    // required, short
    "biggestPainPoint": "Battery drains quickly while using the camera",  // required, specific — not just "Battery"
    "mostRequestedImprovement": "Faster charging speed"               // required, specific
  },
  "topTopics": [
    // The main product features/topics people discuss. "positive"/"negative" are item counts within this topic.
    { "topic": "Camera", "mentions": 42, "positive": 30, "negative": 12, "itemIds": ["yt_abc123", "..."] }
  ],
  "painPoints": [
    // Specific problems, not vague categories — "Battery drains quickly while using the camera",
    // not just "Battery". mentions = distinct users who raised it.
    { "description": "Battery drains quickly while using the camera", "mentions": 18, "representativeItemId": "yt_abc123", "itemIds": ["yt_abc123", "..."] }
  ],
  "loves": [
    // Strongest positive themes — what should be preserved.
    { "description": "Camera quality is a major step up from the previous model", "mentions": 25, "representativeItemId": "yt_xyz789", "itemIds": ["..."] }
  ],
  "requests": [
    // Improvements/features users are explicitly asking for.
    { "request": "Add a dedicated pro camera mode", "relatedTopic": "Camera", "mentions": 9, "representativeItemId": "yt_qqq111", "itemIds": ["..."] }
  ],
  "recommendations": [
    // 3-5 of these. Evidence-backed, not assumptions — ground every "insight" in what's actually in itemIds.
    {
      "signal": "Multiple users report battery drain specifically while filming 4K video",
      "insight": "The camera's power draw during video capture may exceed what the battery/thermal system was tuned for",
      "action": "Investigate power profile during 4K recording; consider a battery-saver prompt during long video capture",
      "itemIds": ["yt_abc123", "yt_def456"]
    }
  ]
}
```

Rules, enforced on save (Phase 3 will reject the file and tell you exactly what's wrong if you violate these):
- Every entry in `topTopics`, `painPoints`, `loves`, `requests`, and `recommendations` **must** include a
  non-empty `itemIds` array of real item `id`s from this dataset (the `ID` column in the Excel file / the
  `id` field in the printed items) — this is what makes every card on the dashboard traceable back to an
  actual comment. Never invent an id or reuse one from a different dataset.
- `representativeItemId`, where present, must also be a real id from this dataset.
- All three `overview` fields are required, non-empty strings.
- Don't fabricate a `recommendations` entry's `insight`/`action` beyond what the cited comments support —
  say "not enough evidence" in the underlying section instead of stretching a conclusion.
- Don't add a `sourceBreakdown` field yourself — Phase 3 computes and attaches it automatically (per entry
  and on `overview`) from each `itemIds` entry's real `source`, so it can't drift from the actual data.

## Phase 3: Save

```
node scripts/save-summary.js <datasetId> --insights <path-to-insights.json>
```

`<datasetId>` is printed in Phase 1's output (e.g. `ds_abc123`). Write the JSON from Phase 2 to a temp file
first, then pass its path with `--insights`. If it fails validation, the error names exactly which
`itemIds`/fields are the problem — fix the file and re-run, don't drop the offending evidence and guess.

Optionally, also save a free-text narrative alongside it (not shown on the dashboard, just a plain-text
copy next to the dataset for your own reference) with `--text "..."` or `--file <path>` — either can be
combined with `--insights` in the same call.

## Phase 4: Open the dashboard

As soon as the summary is saved, open the dashboard automatically — don't ask first, and don't treat this
as optional:

```
node scripts/dashboard.js <datasetId>
```

This starts a local server and opens a PM-focused dashboard in the browser with 6 sections: Overview,
Top Topics/Features, Top Pain Points, What Users Love, User Requests/Suggestions, and PM Recommendations —
each card links to the real supporting comments (video title, date, likes, and a direct source link) via a
"View comments"/"View evidence" action. When the dataset mixes more than one source, a filter bar at the top
lets the user switch between "All sources" and each individual source (see "Combined multi-source analysis"
above) — no extra step needed from you for this to appear. This is where the user reads the full analysis,
not the chat. If Phase 3's insights weren't saved yet, the dashboard still renders using local heuristics
only, with a banner saying so — always complete Phase 2/3 first so the dashboard shows your actual reading
of the comments, not just theme buckets. This command blocks the terminal on purpose (it keeps the server
up) — run it in the background rather than waiting on it.

In the chat response itself, give only a brief stats summary — total items, sentiment split, per-source
counts, that kind of thing (no quotes, no theme write-up) — then note that the dashboard has opened with
the full analysis. If the environment can't open a browser (e.g. headless/remote), fall back to `--static`
and share the generated file path instead.

## What NOT to do

- Don't call any LLM API for this — you are the LLM. Nothing to configure.
- Don't substitute made-up comments or stats if collection fails or returns little data — report what
  happened and, if useful, suggest different keywords or a longer time period and re-run.
- Don't present a video-level link as if it cites a specific comment — see "Citing comments precisely"
  above. If precise citation matters and the dataset was collected via YouTube's no-key fallback, say so
  and offer to re-collect with `YOUTUBE_API_KEY` rather than letting the gap go unnoticed.
- Don't assume any other project or tool needs to be present — this skill's `scripts/` and `lib/` are
  everything it needs.
- Only point `--community-urls` at sites the user has permission to collect from — this collector doesn't
  check `robots.txt`, so use judgment rather than scraping indiscriminately.

## What this skill does not (yet) do

Comparing two collected topics against each other, or against a description of your own product, isn't
built into this skill's scripts. If asked for that, say so rather than approximating it — collecting each
topic separately with `search.js` and comparing the two printed summaries yourself is a reasonable
manual substitute in the meantime.
