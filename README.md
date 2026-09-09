# BuzzLens

A coding-agent skill for real user-generated-content (UGC) and user feedback research. It is packaged as a self-contained
folder, and the core `SKILL.md` can be read by Claude Code or any other coding agent with filesystem and
shell access.

## What This Does

**BuzzLens** helps you find out what people actually think of a company, product, or feature — grounded in
real comments, not guesses. It collects real YouTube, Reddit, and Twitter/X data, plus comments from any
community website (forum, review site, blog) you point it at, saves everything locally, and hands it back
to the agent to read and write the analysis.

### Key Features

- **Real Data Only** — every quote and count traces back to an actual collected comment. Nothing is
  invented, and a source that fails or is skipped is reported as such, never faked.
- **Multi-Source** — YouTube, Reddit, Twitter/X, and any community site (forum, review page, blog comments)
  via a static-HTML scraper with auto-detected markup.
- **Zero LLM Config** — the agent running the skill *is* the analyst. There's no LLM API call inside this
  package and nothing to set up for that part.
- **Grounded Clustering** — local, deterministic sentiment and theme clustering (like/dislike/feature-request)
  with distinct-user counts, not just comment counts.
- **PM-Focused Local Dashboard** — an executive summary of top findings followed by a 6-section dashboard
  (overview, top topics, pain points, what users love, user requests, and evidence-backed PM
  recommendations) built from the agent's own reading of the comments, every card traceable back to a real
  comment. Viewable as a live local server or exported to a single static HTML file.
- **Fully Self-Contained** — no dependency on anything outside this folder. Clone it and use it — nowhere
  else to look. The agent installs its own small dependency set automatically the first time it runs.

## Installation

### A. Already have Claude Code open in the project? (fastest)

Run this from your project root — in your regular terminal, or pasted straight into the Claude Code
prompt with a `!` prefix to run it right there:

```bash
git clone https://github.com/Manasa-Sreekesh/Buzzlens.git .claude/skills/buzzlens
```

That's it — Claude Code picks it up automatically. Ask it to research a topic, or invoke `/buzzlens`.

### B. As a Project Skill, from anywhere (available only in one project)

```bash
git clone https://github.com/Manasa-Sreekesh/Buzzlens.git <your-project>/.claude/skills/buzzlens
```

### C. As a Personal Skill (available in every project you open with Claude Code)

```bash
git clone https://github.com/Manasa-Sreekesh/Buzzlens.git ~/.claude/skills/buzzlens
```

Either way, Claude Code auto-discovers it — no further setup. Open Claude Code anywhere and ask it to
research a topic (or invoke it explicitly with `/buzzlens`); it reads `SKILL.md` and takes it from there.

Credentials, saved datasets, and reports all live inside this same folder (`.env`, `data/`, `reports/`) —
wherever you install it is where its data stays.

`.claude/` is a dot-directory, hidden by default in Finder/Explorer, so the skill's own files (and the
datasets it collects) can be easy to lose track of after install. The first `npm install` creates a
symlink — `buzzlens/` right next to `.claude/` at whichever level `.claude/skills/buzzlens` sits — pointing
back at the real install. It's the same files, not a copy, so it's always current with zero extra syncing:
open `buzzlens/` in Finder/Explorer and you're looking straight into `.claude/skills/buzzlens`, datasets and
all. The real, working install (and the one Claude Code reads) stays at `.claude/skills/buzzlens`; the
symlink is just a visible door into it, so deleting or moving the symlink itself doesn't affect the skill.

### Other Coding Agents

Agents such as Codex, Kimi Code, OpenCode, Gemini CLI, or other local coding assistants with filesystem and
shell access can use the same skill — point the agent at this folder and ask it to follow `SKILL.md`. It
only needs `SKILL.md`, `scripts/`, and `lib/`; nothing else in this repo is required for the skill to run.

## Getting Started

1. **Install it** — see Installation above.

2. **Add at least one API key.** Copy `.env.example` to `.env` and fill in what you have. YouTube and Reddit
   work with no key at all (lower-fidelity public fallback); Twitter/X — one of the two default sources —
   has no such fallback, so without a key a default run collects YouTube only. Full per-source instructions
   are in Credentials below.

3. **Ask a real question**, in plain language:

   ```text
   "What do people think of Galaxy AI?"
   "Research feedback on Notion's new AI features"
   "Check the comments on this forum thread: <url>"
   ```

4. **What happens next, automatically:**
   - The agent asks one more quick thing — how thorough the analysis should be (default: thorough, see
     "Analysis depth" below) — then collects real comments/posts from the sources you named, or the
     default, YouTube + Twitter/X.
   - It reads what it collected and writes the analysis itself — sentiment, what people like/dislike,
     feature requests, real quotes — no LLM to configure; the agent running the skill *is* the analyst.
   - It saves that analysis, attached to the dataset.

5. **Get your report.** The dashboard opens automatically in your browser the moment the analysis is saved —
   nothing else to run. From there you can also download the entire raw collected dataset as JSON, and
   reopen the same dashboard later with `node scripts/dashboard.js <datasetId>` (see Commands below).

## Requirements

- Node.js **18 or later** (uses the built-in `fetch`)
- A coding agent with filesystem access and the ability to run shell commands
- Your own API credentials for whichever sources you want to use — see below. None are required to install.

## Credentials

Every source needs *your own* credentials — get them from the official provider. Note that **Twitter/X is
one of the two default sources** (see Commands below), but unlike the others it has no fallback that works
without a credential — without a token, a default run collects YouTube only, and `search.js` reports the
skip clearly rather than silently under-delivering:

| Source | Required? | Get it from |
|---|---|---|
| YouTube | No (falls back to public pages), but **required for precise comment citations** — see below | [console.cloud.google.com](https://console.cloud.google.com) → enable "YouTube Data API v3" → Credentials → Create API Key |
| Reddit | No (uses public read-only endpoints by default) | Optional, for higher rate limits: [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) → create a "script" app |
| Twitter / X | Yes, to collect tweets | [developer.twitter.com](https://developer.twitter.com/en/portal/dashboard). **Recent-search requires a paid X API tier** — the free tier doesn't include search. If your token doesn't have access, `search.js` reports that clearly and skips Twitter/X rather than faking data. |
| Community site | No — just the URL(s) you want scraped | Nothing to sign up for. Pass `--community-urls` with one or more page URLs (a forum thread, review page, blog post with comments, etc.). |

Copy `.env.example` to `.env` and fill in what you have, or just start using it — `search.js` reports
exactly what's missing and where to add it, the moment a source needs it. `.env` is gitignored and never
committed; keys are only ever sent to their own official API.

Check what's already saved there any time with:

```bash
node scripts/credentials.js
```

This prints every credential BuzzLens knows about, masked, and whether it's set — the agent runs this
first in Phase 1 too, so it only asks you for keys that are actually missing instead of asking blind.

## Commands

```bash
node scripts/search.js --topic "Galaxy AI"                                        # defaults to --sources youtube,twitter and the last 12 months
node scripts/search.js --topic "Galaxy AI" --sources youtube,twitter --time 7days  # or --time 15days/30days
node scripts/search.js --topic "Siri AI" --sources youtube --analysis-topic "on-screen awareness"  # search broad, analyze narrow
node scripts/search.js --topic "Product X" --sources community --community-urls "https://forum.example.com/thread/1,https://reviews.example.com/product-x"
node scripts/search.js --topic "Product X" --sources youtube --video-urls "https://youtu.be/abc123XYZ89"  # adds this video to the topic search, doesn't replace it
node scripts/search.js --topic "Product X" --sources youtube --video-file youtube-videos.txt
node scripts/search.js --topic "Product X" --sources youtube,twitter                                     # combined multi-source run, one dataset
node scripts/search.js --topic "Product X" --sources twitter --tweet-urls "https://x.com/someuser/status/1234567890123456789"
node scripts/save-summary.js <datasetId> --insights <path-to-insights.json>  # drives the PM dashboard, opens it automatically
node scripts/save-summary.js <datasetId> --text "..."      # optional plain-text copy, not shown on the dashboard
node scripts/save-summary.js <datasetId> --insights <path> --no-open  # skip auto-opening the dashboard
node scripts/dashboard.js <datasetId>                        # reopen a dataset's dashboard later, or --static for a single HTML file
node scripts/list.js                                         # see saved datasets
node scripts/credentials.js                                  # see which API keys are already set in .env
```

`search.js` never recollects a topic you already have — reuse a saved dataset's id with
`dashboard.js`/`save-summary.js`, or check `list.js` first. `save-summary.js` opens the dashboard for you the
moment it saves successfully; `dashboard.js` on its own is only for reopening it later or exporting a static
file.

### Time window

`--time` defaults to **the last 12 months** — every run prints this in its header so it's always clear what
window was searched. Pass `--time 24hours`, `--time 7days`, `--time 15days`, or `--time 30days` for a
narrower window, or `--time custom --start YYYY-MM-DD --end YYYY-MM-DD` for an exact range. This applies to
every time-windowed source (YouTube topic search, Reddit, Twitter/X); `community` and an explicit YouTube
`--video-urls`/`--video-file` list always fetch their exact targets regardless of `--time`. Twitter/X's
recent-search API only covers roughly the last 7 days regardless of what's requested — a platform limitation
`search.js` reports rather than silently under-delivering.

### YouTube video and comment defaults

With `YOUTUBE_API_KEY` set, `search.js` searches for videos published within the `--time` window (12 months
by default) and keeps the top **20** by relevance. For each video, it collects up to **300 top-level
comments** — roughly 200 relevance-ranked plus 100 most-recent, deduped where they overlap, so the set
balances prominent opinions with newer feedback rather than only surfacing top comments. If a video has
fewer than 300 comments, all of them are collected. Every collected top-level comment's full reply thread is
also fetched, not just its first few replies, so sub-discussions aren't cut short.

Without `YOUTUBE_API_KEY`, collection falls back to reading public YouTube pages directly — that path is
inherently smaller (top 5 videos, ~1 page of top-level comments each, no reply threads) and unaffected by
the numbers above.

### Explore mode vs. Targeted mode

Just tell the agent what you want to understand — a topic, or a topic plus what you specifically want to
know — in one conversational message. No separate prompts, nothing to fill in as a form:

- **Explore mode** (default) — you give just a topic (e.g. "Dyson V15 vacuum"). The agent runs the standard,
  full-breadth analysis: sentiment, top positive/negative themes, most-discussed features, requests,
  emerging issues, all grounded in evidence.
- **Targeted mode** — you also say what you specifically want to know (e.g. "Dyson V15 vacuum — I want to
  understand whether the suction power holds up over time and how it compares to the V12"). The agent
  splits that into a broad `--topic` (more data collected) and a narrower `--analysis-topic` goal, then
  prioritizes insights relevant to that goal while still giving you a brief standard buzz overview and
  calling out any other significant, unexpected finding in the data — not just what you asked about.

Under the hood this is still one flag:

```bash
node scripts/search.js --topic "Siri AI" --sources youtube --analysis-topic "on-screen awareness"
```

Collection is unaffected — `--topic` still drives what gets searched/collected; `--analysis-topic` only
changes how Phase 2/3 writes the analysis. It's carried on the saved dataset and shown on the dashboard (e.g.
"On-screen Awareness, searched under 'Siri AI'"). In Targeted mode, the `overview` section still reflects the
whole dataset (not just the goal), while `topTopics`/`painPoints`/`loves`/`requests`/`recommendations` lead
with goal-relevant entries and still surface other significant findings — saying so honestly if only a few
items are directly on-topic for the goal itself, rather than padding that part out with unrelated comments.
Omit `--analysis-topic` (or just give a bare topic in chat) and you get Explore mode, as before.

### Analysis depth: thorough vs. fast

A separate choice from Explore/Targeted mode above — that one controls *what* the analysis focuses on; this
one controls *how* the agent arrives at each card's "mentions" count once collection is done. The agent asks
this once, up front, alongside the topic question:

- **Thorough** (default) — the agent reads every single collected comment itself and writes each entry's
  mention count directly, from its own judgment. More accurate on ambiguous/borderline cases, but slower on
  a large dataset since every comment goes through the agent's own reasoning.
- **Fast** (opt-in) — the agent still reads the comments to find real topics/pain points/etc., but instead
  of tallying mentions by hand, it supplies a handful of keyword terms per entry; those terms are then
  matched exhaustively across every collected item by a deterministic local pass (not the agent, not an
  LLM), producing a real, reproducible count in milliseconds regardless of dataset size — at the cost of
  being a keyword match rather than the agent's own read of every edge case.

This is recorded as `analysisMode` (`"thorough"` or `"fast"`) in the saved `.insights.json` file. Say
"quick"/"fast is fine" or "take your time, be thorough" in your own request to skip the question and set the
mode directly.

### Community site source

`community` is different from the other three: instead of searching a platform by topic, it fetches the
specific page(s) you name and extracts the comments on them. It auto-detects common comment/review markup
patterns (schema.org microdata, WordPress-style comments, generic `.comment`/`.review` classes, forum post
markup, and a few others). If auto-detection finds nothing on a particular site, `search.js` reports "0
comments auto-detected" (not an error, not fake data) — you can then supply your own CSS selectors for
that site:

```bash
node scripts/search.js --topic "Product X" --sources community \
  --community-urls "https://weird-site.example.com/thread/1" \
  --comment-selector ".weird-thing" --text-selector ".say" --author-selector ".who"
```

`--comment-selector` targets each comment's container; `--text-selector`/`--author-selector`/`--date-selector`
are optional and resolve within that container. Comments with no resolvable author are labeled `Anonymous
#1`, `Anonymous #2`, etc. (unique per item — never a single shared label, so distinct-commenter counts stay
meaningful) rather than guessing an identity.

### Adding specific YouTube videos to the topic search

If you already know which YouTube videos you want checked, you don't have to choose between that and the
topic search — both run together. Add up to **20 videos** on top of the search with `--video-urls`
(comma-separated, typed inline) or `--video-file` (a local text file, one video URL or ID per line) — use
one or the other, not both, in the same run:

```bash
node scripts/search.js --topic "Product X" --sources youtube --video-urls "https://youtu.be/abc123XYZ89,def456UVW01"
node scripts/search.js --topic "Product X" --sources youtube --video-file youtube-videos.txt
```

Copy `youtube-videos.example.txt` to `youtube-videos.txt` to keep a reusable list — accepted formats
(watch URLs, `youtu.be` links, Shorts links, or bare 11-character video IDs) are documented in that file.
`youtube-videos.txt` is gitignored, same as `.env`. If a listed video also shows up in the topic search
results, it's collected once, not twice — `search.js` reports when that dedup happens. The `--time` window
still applies to the topic-searched videos, but not to the explicitly listed ones (an exact target list,
not a time-windowed search) — same idea as `--community-urls`.

### Twitter/X: topic search, replies, and specific tweets

`twitter` works like any other `--sources` value — use it alone for a Twitter/X-only run, or combine it
with YouTube (or anything else) in one call:

```bash
node scripts/search.js --topic "Product X" --sources twitter
node scripts/search.js --topic "Product X" --sources youtube,twitter
```

The topic search collects matching tweets **and** the replies underneath them, for a bounded number of the
most-engaged tweets each run, so "buzz" on a topic includes the surrounding conversation, not just top-level
posts. Add specific tweets on top of the search the same way YouTube videos work — up to **20 tweets** —
with `--tweet-urls` or `--tweet-file` (never both in the same run):

```bash
node scripts/search.js --topic "Product X" --sources twitter --tweet-urls "https://x.com/someuser/status/1234567890123456789"
node scripts/search.js --topic "Product X" --sources twitter --tweet-file tweets.txt
```

Copy `tweets.example.txt` to `tweets.txt` for a reusable list — accepted formats (twitter.com/x.com status
URLs, or bare numeric tweet IDs) are documented in that file. `tweets.txt` is gitignored, same as `.env`.
Same dedup behavior as YouTube: a listed tweet already found by the topic search is collected once, not
twice, and `search.js` reports it.

### Combined multi-source analysis

Collecting from more than one source in a single run (e.g. `youtube,twitter`) produces one dataset covering
both — the printed summary, the saved Excel file, and the AI agent's written analysis all treat it as one
combined picture rather than two separate reports. The dashboard still lets you view it split apart:
whenever a dataset mixes sources, a filter bar appears ("All sources" / "YouTube" / "Twitter/X" / …) that
narrows every section down to just that source's evidence. The saved `.insights.json` file mirrors this —
every entry carries a `sourceBreakdown` (e.g. `{"youtube": 5, "twitter": 2}`), computed automatically from
the real data when you save it, so the file itself demarcates what came from where.

## Architecture

This skill follows a simple **collect → analyze → save** flow — `SKILL.md` is the workflow map the agent
reads first, and each phase hands off to one script:

| Phase | Script | Purpose |
|---|---|---|
| 0. Setup | *(automatic)* | The agent installs the small local dependency set on first run — nothing you configure |
| 1. Collect | `scripts/search.js` | Fetches real comments/posts from the chosen sources, clusters and prints them |
| 2. Analyze | *(the agent itself)* | Reads the printed data and writes a grounded, id-referenced PM insights JSON — no script, no LLM call |
| 3. Save | `scripts/save-summary.js` | Validates every id in the insights JSON against the real dataset, attaches it, then opens the dashboard automatically |
| 4. Dashboard | `scripts/dashboard.js` | Opened automatically by step 3 — run directly only to reopen it later or export one static HTML file |
| — | `scripts/list.js` | Lists previously saved datasets, so topics aren't recollected needlessly |
| — | `scripts/credentials.js` | Shows which API keys are already set in `.env` (masked), checked before Phase 1 asks about them |

```
SKILL.md              the skill definition Claude Code reads
scripts/               entry points: search.js, save-summary.js, list.js, dashboard.js, credentials.js
lib/
  collectors/           youtube.js, reddit.js, twitter.js, community.js — real data only, never mock on failure
  storage/               Excel + manifest read/write
  analysis/               local, deterministic clustering/stats (localAnalysis.js), the PM dashboard builder
                           (pmDashboard.js, with a heuristic fallback when no agent insights are saved yet),
                           and the report builder
  insightsFile.js        reads/validates/writes the agent's saved PM insights JSON (id-checked against the dataset)
  summaryFile.js          reads/writes an optional plain-text narrative copy (not shown on the dashboard)
  dashboard/               local server + static generator + HTML template
  credentials.js          non-interactive credential checking
  config/, utils/          paths, env loading, small helpers
```

Every collector implements the same interface (`{ id, label, requiredCredentials, collect(query, creds) }`),
so adding a new source doesn't require touching anything else.

## Where your data lives

```
data/
  manifest.json          # index of every saved dataset
  datasets/
    <topic>_<timestamp>.xlsx          # one file per research run
    <topic>_<timestamp>.insights.json # the agent's saved PM insights, drives the dashboard, once written
    <topic>_<timestamp>.summary.md    # optional plain-text narrative copy, if saved with --text/--file
reports/
  <topic>_<timestamp>.html     # static dashboard exports
```

`data/`, `reports/`, `.env`, `youtube-videos.txt`, and `tweets.txt` are all gitignored.

## Philosophy

This skill was born from the belief that:

1. **The agent is the analyst.** A skill's job is to hand over real, grounded data — not to pretend it can
   replace the reasoning the agent (and you) actually do.
2. **Fabricated data is worse than no data.** A skipped source or an empty result gets reported honestly,
   never papered over with an invented quote or statistic.
3. **Local-first, no lock-in.** Datasets, summaries, and reports are plain files (`.xlsx`, `.md`, `.html`)
   in this folder — nothing lives in a service you don't control.
4. **Dependencies are debt.** A handful of small, boring packages (`exceljs`, `express`, `open`, `dotenv`,
   `chalk`, `cheerio`) — nothing exotic, nothing that goes stale.

## Known limitations

- Twitter/X recent-search requires a paid X API tier — a platform limitation, not something this skill can work around.
- Twitter/X reply collection ("comments under the posts") is bounded to a limited number of the most-engaged tweets per run, since each tweet's replies cost a separate API call — not every tweet collected gets its replies fetched.
- YouTube comments collected without `YOUTUBE_API_KEY` can only be cited at the video level, not the specific comment — YouTube's public pages don't expose a stable per-comment id. The dashboard labels these links "watch video" rather than falsely claiming a comment-level citation. Add the key to get real per-comment citation links (`?v=<video>&lc=<commentId>`).
- Reddit's default (no-credential) access is subject to stricter, unauthenticated rate limits; add `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` in `.env` for higher limits.
- The community-site collector only parses static, server-rendered HTML — it does not run JavaScript. Comments that only appear after client-side rendering (some Disqus/Discourse embeds, for example) won't be visible to it; that page will report 0 comments rather than something incorrect.
- Comment auto-detection is a best-effort heuristic across arbitrary site markup — it won't fit every site. Use the `--comment-selector`/`--text-selector`/`--author-selector`/`--date-selector` overrides for sites it misses.
- This skill does not check `robots.txt` before fetching a community page. Only point it at sites you have permission to collect from.
- Sentiment/theme tags applied at collection time are a fast local heuristic (keyword/regex-based), meant for filtering and clustering — not a substitute for actually reading the data.
- Fast analysis mode's mention counts come from a keyword match (`matchTerms`) over the full dataset, not the agent individually judging every borderline comment — accurate and reproducible, but a term list can over- or under-match relative to what a full read would catch. Use thorough mode (the default) if that matters for your use case.
- Person-focused research (feedback about an individual rather than a company/product/feature) isn't a supported use case.
- Comparing two topics, or a topic against your own product, isn't built into these scripts yet.

## License

MIT
