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

## Keep the user informed, minimally

The user is watching a chat, not a terminal — the raw output of `search.js`/`save-summary.js`/`dashboard.js`
isn't the user experience, your own messages are. Post a short status line immediately when you start
collecting, and another when each phase finishes — never relay raw script output (item ids, API error text,
theme-cluster dumps, quote lists) into the chat; that data is for you to read, not to paste.

- The moment you start Phase 1 (before the collection command even finishes): a one-line "Researching
  [topic]..." — so the user sees something is happening right away, not after a wait.
- When Phase 1 finishes: one short line with just the headline numbers, e.g. "Collected 376 comments from
  YouTube and Twitter/X." Not the sentiment split, not the theme clusters, not per-source error detail —
  mention a skipped source only in one short clause if it means meaningfully less data than expected.
- During Phase 2, if it's taking a while: at most one short update ("Still reading through the comments...")
  — never a running commentary of what you're finding as you go.
- After Phase 3 saves: "Analysis complete — opening the dashboard now." The dashboard opens on its own (see
  Phase 4) — you don't need to tell the user to run anything themselves.

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

**Ask the user one open question up front, plus one short choice about analysis depth (see below) —
nothing else:**

> What product, feature, or topic do you want to understand?

Keep it plain and conversational — not a form. Don't suggest example topics, don't guess one for them, and
don't split it into a topic prompt followed by a separate goal prompt. In the same breath, the user is free
to also say what they specifically want to find out — a question, a hunch, a comparison — but never require
it and never ask for it separately. Read whatever comes back as a whole to decide the mode:

- **Explore mode** (the default): the reply is just a topic — a company, product, or feature (e.g. "Dyson
  V15 vacuum"), nothing more specific attached. Run the standard, full-breadth analysis in Phase 2 —
  sentiment, top positive/negative themes, most-discussed features, requests, emerging issues, all grounded
  in evidence.
- **Targeted mode**: the reply also carries a specific question, goal, or angle within that topic (e.g.
  "Dyson V15 vacuum — I want to understand whether the suction power holds up over time and how it compares
  to the V12"). Split it yourself into the subject (`--topic`) and the goal (`--analysis-topic`, see below) —
  never ask the user to separate the two themselves. Targeted mode still produces a brief standard buzz
  overview alongside insights prioritized toward the stated goal, and calls out any other significant
  finding the data turns up even when it's outside the goal — see Phase 2 for exactly how the two blend.

Either way, the topic itself is required, and must be an actual research topic (a company, product, or
feature) — not a person, and not left blank. If what they give isn't one, ask again (still the same open
question, not a menu of options) rather than guessing.

**Then ask one more thing — how thorough the analysis itself (Phase 2) should be — with an explicit
warning about the tradeoff, not a silent default:**

> Two ways I can analyze this once it's collected:
> 1. **Thorough (default)** — I read every single comment myself and write the insights directly. More
>    accurate, but slower on a large dataset.
> 2. **Fast** — I still read the comments to find real topics/pain points/etc., but the mention counts are
>    computed by an exhaustive keyword match over the full dataset instead of me tallying them by hand.
>    Noticeably faster, at the cost of the counts being a keyword match rather than my own judgment call on
>    every borderline case.
>
> Thorough unless you'd rather I go fast — which would you prefer?

This is a real, distinct choice — not something to fold into the topic question or infer from wording. If
the user doesn't answer or says something like "whatever's fine," default to **thorough**, don't ask twice.
Whichever is chosen carries through to Phase 2/3 as the JSON's top-level `analysisMode` field (`"thorough"`
if omitted — see Phase 2 for the schema difference between the two).

Skip the topic question if they've already stated a topic (with or without a goal) in chat, and skip the
analysis-depth question if they've already said something like "quick"/"fast is fine"/"take your time, be
thorough" — otherwise ask it. Everything below this point is handled with sensible defaults or by reading
the user's own wording — **do not turn any of it
into an upfront question**:

- **Sources** default to `youtube,twitter` (see `--sources` below) unless the user's own request already
  names something else — they said "check Reddit", they pasted a forum/review URL (→ `community`), or they
  said "just YouTube"/"just Twitter". YouTube works with no credential via its public fallback; Twitter/X has
  no such fallback and requires `TWITTER_BEARER_TOKEN` (a paid X API tier) — since it's now a default source,
  proactively mention this to the user if `scripts/credentials.js` shows it missing, rather than silently
  letting a default run collect YouTube only.
- **Credentials**: already checked above via `scripts/credentials.js`. If something relevant is missing,
  don't stop to ask — just collect via the fallback (its inline disclaimer covers the trade-off) and, once
  results are back, mention in passing that adding e.g. `YOUTUBE_API_KEY` would improve fidelity/citations.
  Only ask for a credential proactively if the user brings it up, or if a source can't run at all without
  one (Twitter/X, including as a default source now — see "If a source is skipped" below).
- **Specific YouTube videos or tweets**: don't ask whether the user has any. If they mention or paste video
  links or tweet links — now or later — collect those alongside the topic search rather than instead of it
  (see "YouTube: adding specific videos to the topic search" and "Twitter/X: topic search, replies, and
  specific tweets" below); up to **20** per run for each, pasted directly or via `youtube-videos.txt` /
  `tweets.txt`.
- **Analysis focus / mode** (`--analysis-topic`): set it whenever the user's reply carries a goal alongside
  the topic — see Explore vs. Targeted mode above. Never ask for one separately; extract it from their own
  wording, or leave it unset for a topic-only reply (Explore mode, the default).
- **Time window**: stays the documented default (`12months`) — mention it once, in the result, never as an
  upfront question.

Once you have the topic (and anything else the user's own message already specified), run:

```
node scripts/search.js --topic "<topic>"
```

- `--topic` — the company, product, or feature to research (required). Not a person.
- `--sources` — comma-separated: `youtube`, `reddit`, `twitter`, `community`. Optional — defaults to
  `youtube,twitter` when omitted, per the guidance above.
- `--analysis-topic` — optional, a narrower angle/goal within `--topic` to focus the analysis on (e.g.
  `--topic "Siri AI" --analysis-topic "on-screen awareness"`). Setting it is what puts Phase 2 into Targeted
  mode instead of Explore mode. Collection is unaffected — this only carries through to the dataset and
  dashboard so Phase 2/3 knows what to focus on (see Phase 2 below).
- `--time` — `24hours` | `7days` | `15days` | `30days` | `12months` | `custom` (**default `12months`**). Don't
  ask the user about this upfront — just tell them, once, that you're searching **the last 12 months** by
  default (the command's own output says this too, so you don't need to repeat it every run). If they want a
  narrower window, mention `--time 7days`, `--time 15days`, or `--time 30days` are available and re-run with
  whichever they pick. For `custom`, also pass `--start YYYY-MM-DD --end YYYY-MM-DD`. Not used by `community`
  (it fetches the exact page(s) given, not a time-windowed search).
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
reported Excel file) and write a **PM-focused insights JSON** — this is what drives the dashboard's executive
summary and 6 numbered sections in Phase 3/4. In both modes, read the actual comment text yourself; don't just reuse the generic
`theme` labels from collection (`Design`, `Performance`, `General`, etc.) — those are a fast local heuristic
for filtering, not real product topics. Name topics the way a PM would (e.g. `Camera`, `Battery`,
`Charging`), based on what people actually wrote about.

The analysis must be grounded in **every single collected item**, not a sample. Which of the two modes the
user picked in Phase 1 (default **thorough**) changes how you arrive at `mentions` (and, for `topTopics`,
`positive`/`negative`) — see the schema below — but either way you still read every item to find the real
topics/pain points/loves/requests in the first place; the mode only changes how the counts get computed.

**Explore mode** (no `--analysis-topic` set): write the standard full-breadth analysis — every section draws
on the full dataset, no narrowing.

**Targeted mode** (`--analysis-topic` was set, printed in Phase 1's output as "Analysis focus"):
- `overview` stays a brief snapshot of the **whole** dataset — the same three fields as Explore mode
  (`topDiscussedTopic`, `biggestPainPoint`, `mostRequestedImprovement`), not narrowed to the goal. This is
  what gives Targeted mode its "brief standard buzz overview" even while the rest of the report leans into
  the goal.
- `executiveSummary`, `topTopics`, `painPoints`, `loves`, `requests`, and `recommendations` should **lead
  with** entries relevant to the stated goal (e.g. battery life, and any explicit comparison to a prior
  version named in the goal) — put those first and give them the most detail.
- After the goal-relevant entries, still include other significant findings from the data even when they're
  outside the goal — don't drop a major pain point or a strongly-requested feature just because it's
  off-topic. If something surprising or unexpected turns up (a theme the user didn't ask about but that's
  clearly significant by mention count or sentiment strength), include it and flag it as such in its
  `description`/`insight` text (e.g. "Unexpected: ...") so it reads as a bonus finding, not as evidence for
  the stated goal.
- If only a handful of items are directly on-topic for the goal itself, say so plainly rather than padding —
  a small, honest goal-focused set of entries beats a stretched one. This doesn't apply to the rest of the
  report, which still draws on the full dataset as usual.

Build one JSON object with this shape and save it to a temp file. This is the **thorough** mode shape (the
default — omit `analysisMode` entirely, or set it to `"thorough"` explicitly):

```jsonc
{
  "executiveSummary": [
    // 3-6 of these. The handful of findings a PM or leader most needs to walk away with, shown at the
    // very top of the dashboard, above Overview. Each one is a specific, evidence-backed statement, not
    // a category label — "Suction complaints cluster around the first 3 months of ownership", not "Suction".
    // mentions = distinct users who raised it, from your own read.
    { "finding": "22 distinct commenters report motor/board failures within 1-3 years", "mentions": 22, "itemIds": ["yt_abc123", "..."] }
  ],
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

**Fast mode** (only if the user chose it in Phase 1): add `"analysisMode": "fast"` at the top level, and on
every `executiveSummary`/`topTopics`/`painPoints`/`loves`/`requests` entry, replace `mentions` (and, for
`topTopics`, `positive`/`negative`) with `matchTerms` instead — 2-6 keywords/short phrases that would
reliably match comments about this specific entry (case-insensitive substring match against every collected
item's text, not just the ones you cited as evidence):

```jsonc
{ "topic": "Camera", "matchTerms": ["camera", "photo", "lens"], "itemIds": ["yt_abc123", "..."] }
```

Phase 3 then runs an exhaustive keyword match over the whole dataset to compute the real `mentions` (and
`positive`/`negative`) from those terms — don't write `mentions`/`positive`/`negative` yourself in fast mode,
Phase 3 will reject the file if you do. Pick terms specific enough to avoid false matches (`"battery drain"`,
not just `"battery"` if the topic is really about drain specifically) but complete enough to catch real
variations (`"stopped working"`, `"stops working"`, `"won't turn on"` for the same underlying complaint).
`recommendations` never uses `matchTerms` in either mode — it has no mentions stat.

Rules, enforced on save (Phase 3 will reject the file and tell you exactly what's wrong if you violate these):
- Every entry in `executiveSummary`, `topTopics`, `painPoints`, `loves`, `requests`, and `recommendations`
  **must** include a non-empty `itemIds` array of real item `id`s from this dataset (the `ID` column in the
  Excel file / the `id` field in the printed items) — this is what makes every card on the dashboard
  traceable back to an actual comment. Never invent an id or reuse one from a different dataset.
- `representativeItemId`, where present, must also be a real id from this dataset.
- In **thorough** mode (default): every entry in `executiveSummary`, `topTopics`, `painPoints`, `loves`, and
  `requests` **must** include a `mentions` number (and `topTopics` must also include `positive`/`negative`).
- In **fast** mode (`analysisMode: "fast"`): every entry in those same sections **must** include a non-empty
  `matchTerms` array instead, and must NOT include `mentions` (or, for `topTopics`, `positive`/`negative`).
- All three `overview` fields are required, non-empty strings.
- Don't fabricate a `recommendations` entry's `insight`/`action` beyond what the cited comments support —
  say "not enough evidence" in the underlying section instead of stretching a conclusion.
- Don't add a `sourceBreakdown` field yourself — Phase 3 computes and attaches it automatically (per entry
  and on `overview`) from each entry's real matches (in fast mode) or `itemIds` (in thorough mode, and
  always for `recommendations`), so it can't drift from the actual data.

## Phase 3: Save (this also opens the dashboard — Phase 4 is automatic)

```
node scripts/save-summary.js <datasetId> --insights <path-to-insights.json>
```

`<datasetId>` is printed in Phase 1's output (e.g. `ds_abc123`). Write the JSON from Phase 2 to a temp file
first, then pass its path with `--insights`. If it fails validation, the error names exactly which
`itemIds`/fields are the problem — fix the file and re-run, don't drop the offending evidence and guess.

Optionally, also save a free-text narrative alongside it (not shown on the dashboard, just a plain-text
copy next to the dataset for your own reference) with `--text "..."` or `--file <path>` — either can be
combined with `--insights` in the same call.

**On success, this command itself opens the dashboard** — no separate Phase 4 command needed, and nothing
for you to remember. It spawns `dashboard.js` in the background and exits immediately, so your own command
returns right away; the dashboard server comes up and opens a browser tab on its own a moment later. In the
chat, just say something like "Analysis complete — opening the dashboard now" once this command succeeds —
don't restate the stats you already gave after Phase 1, and don't tell the user to run anything themselves.

## Phase 4: The dashboard (opened automatically by Phase 3 — read this for what it contains)

The dashboard is a local server showing a PM-focused view: an Executive Summary of the top findings, then 6
numbered sections — Overview, Top Topics/Features, Top Pain Points, What Users Love, User
Requests/Suggestions, and PM Recommendations — each card linking to the real supporting comments (video
title, date, likes, and a direct source link) via a "View comments"/"View evidence" action. When the dataset
mixes more than one source, a filter bar at the top lets the user switch between "All sources" and each
individual source (see "Combined multi-source analysis" above) — no extra step needed from you for this to
appear. This is where the user reads the full analysis, not the chat.

You only need to run `node scripts/dashboard.js <datasetId>` yourself in two cases:
- **The environment can't open a browser** (headless/remote) — use `node scripts/dashboard.js <datasetId>
  --static` instead and share the generated file path. Phase 3's auto-launch still tries the normal way
  first and falls back to telling you the manual command if it can't; you don't need to guess in advance.
- **You want to reopen an existing dataset's dashboard later**, without re-saving anything.

If Phase 3's insights weren't saved yet, the dashboard still renders using local heuristics only, with a
banner saying so — always complete Phase 2/3 first so the dashboard shows your actual reading of the
comments, not just theme buckets.

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
