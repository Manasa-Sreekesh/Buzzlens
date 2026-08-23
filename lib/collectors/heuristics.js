// Lightweight, fast, local sentiment/theme tagging applied to every item at
// collection time. This is a provisional signal for quick filtering in the
// dataset/dashboard table — the analysis layer (src/analysis) does the real,
// grounded interpretation on top of the raw text.

const POSITIVE_WORDS = [
  'love', 'great', 'amazing', 'excellent', 'awesome', 'fantastic', 'good', 'best',
  'perfect', 'wonderful', 'helpful', 'easy', 'enjoy', 'happy', 'recommend',
  'impressive', 'useful', 'nice', 'solid', 'smooth', 'brilliant', 'favorite',
];

const NEGATIVE_WORDS = [
  'hate', 'terrible', 'awful', 'bad', 'worst', 'horrible', 'disappoint', 'frustrat',
  'annoying', 'broken', 'useless', 'waste', 'poor', 'difficult', 'expensive',
  'problem', 'issue', 'bug', 'crash', 'fail', 'garbage', 'trash', 'slow', 'laggy',
];

const THEME_PATTERNS = [
  [/price|cost|expensive|cheap|worth|money|afford|subscription|pricing/, 'Pricing / Value'],
  [/support|service|help|response|customer|staff/, 'Customer Support'],
  [/design|ui|interface|look|visual|layout|appearance/, 'Design'],
  [/performance|fast|slow|speed|lag|loading|quick/, 'Performance'],
  [/feature|function|update|version|release|new|add/, 'Features'],
  [/easy|simple|complicated|difficult|intuitive|confusing|learn/, 'Ease of Use'],
  [/crash|bug|error|reliable|broken|fix|issue|problem/, 'Reliability'],
  [/privacy|data|security|safe|track/, 'Privacy'],
  [/compare|vs |alternative|switch|better|competitor/, 'Comparison'],
  [/doc|guide|tutorial|manual/, 'Documentation'],
];

function sentiment(text) {
  const t = (text || '').toLowerCase();
  let score = 0;
  for (const w of POSITIVE_WORDS) if (t.includes(w)) score++;
  for (const w of NEGATIVE_WORDS) if (t.includes(w)) score--;
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

function theme(text) {
  const t = (text || '').toLowerCase();
  for (const [pattern, label] of THEME_PATTERNS) {
    if (pattern.test(t)) return label;
  }
  return 'General';
}

module.exports = { sentiment, theme };
