# BuzzLens

Wooohooo - A coding-agent skill for real user-generated-content (UGC) research. It is packaged as a self-contained
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
- **Local Dashboard** — sentiment split, clusters, quotes, and the agent's saved analysis, viewable as a live
  local server or exported to a single static HTML file.
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

### Other Coding Agents

Agents such as Codex, Kimi Code, OpenCode, Gemini CLI, or other local coding assistants with filesystem and
shell access can use the same skill — point the agent at this folder and ask it to follow `SKILL.md`. It
only needs `SKILL.md`, `scripts/`, and `lib/`; nothing else in this repo is required for the skill to run.

## Usage

```text
"What do people think of Galaxy AI?"
"Research feedback on Notion's new AI features"
"Check the comments on this forum thread: <url>"
```

The skill will:

1. Collect real comments/posts from the sources you name (or the sensible default, YouTube + Reddit)
2. Print grounded sentiment counts, theme clusters, and real top quotes back to the agent
3. The agent reads that data and writes the analysis directly in the conversation — sentiment split,
   what people like/dislike, feature requests with user counts, real quotes
4. Save that analysis so it's attached to the dataset
5. Optionally open a local dashboard to browse it visually

## Requirements

- Node.js **18 or later** (uses the built-in `fetch`)
- A coding agent with filesystem access and the ability to run shell commands
- Your own API credentials for whichever sources you want to use — see below. None are required to install.

## Credentials

Every source needs *your own* credentials — get them from the official provider:

| Source | Required? | Get it from |
|---|---|---|
| YouTube | Yes, to collect YouTube comments | [console.cloud.google.com](https://console.cloud.google.com) → enable "YouTube Data API v3" → Credentials → Create API Key |
| Reddit | No (uses public read-only endpoints by default) | Optional, for higher rate limits: [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) → create a "script" app |
| Twitter / X | Yes, to collect tweets | [developer.twitter.com](https://developer.twitter.com/en/portal/dashboard). **Recent-search requires a paid X API tier** — the free tier doesn't include search. If your token doesn't have access, `search.js` reports that clearly and skips Twitter/X rather than faking data. |
| Community site | No — just the URL(s) you want scraped | Nothing to sign up for. Pass `--community-urls` with one or more page URLs (a forum thread, review page, blog post with comments, etc.). |

Copy `.env.example` to `.env` and fill in what you have, or just start using it — `search.js` reports
exactly what's missing and where to add it, the moment a source needs it. `.env` is gitignored and never
committed; keys are only ever sent to their own official API.

## Commands

```bash
node scripts/search.js --topic "Galaxy AI" --sources youtube,reddit --time 7days
node scripts/search.js --topic "Product X" --sources community --community-urls "https://forum.example.com/thread/1,https://reviews.example.com/product-x"
node scripts/save-summary.js <datasetId> --text "..."      # or --file <path>
node scripts/dashboard.js <datasetId>                        # or --static for a single HTML file
node scripts/list.js                                         # see saved datasets
```

`search.js` never recollects a topic you already have — reuse a saved dataset's id with
`dashboard.js`/`save-summary.js`, or check `list.js` first.

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

## Architecture

This skill follows a simple **collect → analyze → save** flow — `SKILL.md` is the workflow map the agent
reads first, and each phase hands off to one script:

| Phase | Script | Purpose |
|---|---|---|
| 0. Setup | *(automatic)* | The agent installs the small local dependency set on first run — nothing you configure |
| 1. Collect | `scripts/search.js` | Fetches real comments/posts from the chosen sources, clusters and prints them |
| 2. Analyze | *(the agent itself)* | Reads the printed data and writes the grounded analysis — no script, no LLM call |
| 3. Save | `scripts/save-summary.js` | Attaches the agent's written analysis to the saved dataset |
| 4. Dashboard (optional) | `scripts/dashboard.js` | Opens a local visual dashboard, or exports one static HTML file |
| — | `scripts/list.js` | Lists previously saved datasets, so topics aren't recollected needlessly |

```
SKILL.md              the skill definition Claude Code reads
scripts/               entry points: search.js, save-summary.js, list.js, dashboard.js
lib/
  collectors/           youtube.js, reddit.js, twitter.js, community.js — real data only, never mock on failure
  storage/               Excel + manifest read/write
  analysis/               local, deterministic clustering/stats (localAnalysis.js) + report builder
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
    <topic>_<timestamp>.xlsx        # one file per research run
    <topic>_<timestamp>.summary.md  # the saved analysis, once one has been written
reports/
  <topic>_<timestamp>.html     # static dashboard exports
```

`data/`, `reports/`, and `.env` are all gitignored.

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
- Reddit's default (no-credential) access is subject to stricter, unauthenticated rate limits; add `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` in `.env` for higher limits.
- The community-site collector only parses static, server-rendered HTML — it does not run JavaScript. Comments that only appear after client-side rendering (some Disqus/Discourse embeds, for example) won't be visible to it; that page will report 0 comments rather than something incorrect.
- Comment auto-detection is a best-effort heuristic across arbitrary site markup — it won't fit every site. Use the `--comment-selector`/`--text-selector`/`--author-selector`/`--date-selector` overrides for sites it misses.
- This skill does not check `robots.txt` before fetching a community page. Only point it at sites you have permission to collect from.
- Sentiment/theme tags applied at collection time are a fast local heuristic (keyword/regex-based), meant for filtering and clustering — not a substitute for actually reading the data.
- Person-focused research (feedback about an individual rather than a company/product/feature) isn't a supported use case.
- Comparing two topics, or a topic against your own product, isn't built into these scripts yet.

## License

MIT
