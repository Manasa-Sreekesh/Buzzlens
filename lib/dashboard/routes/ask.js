const local = require('../../analysis/localAnalysis');

// Handles POST /api/ask against the in-memory dataset loaded for this
// dashboard session. Always answers via local keyword/theme matching —
// there is no LLM call in this package (the agent that collected the data
// already wrote the saved analysis, if any). Never falls back to inventing
// an answer when the data doesn't support one.
function createAskHandler({ datasets }) {
  const allItems = datasets.flatMap((d) => d.items);

  return async function askHandler(req, res) {
    const question = (req.body && req.body.question ? String(req.body.question) : '').trim();
    if (!question) return res.status(400).json({ error: 'Question is required.' });

    try {
      const result = local.answerQuestion(question, allItems);
      res.json({ ...result, usedLLM: false, provider: 'heuristic' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
}

module.exports = { createAskHandler };
