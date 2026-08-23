const fs = require('fs');
const path = require('path');
const { REPORTS_DIR, ROOT_DIR } = require('../config/constants');
const { renderTemplate } = require('./render');
const { slugify } = require('../utils/slug');
const { fmtCompactTimestamp } = require('../utils/format');

/**
 * Renders a non-interactive, fully self-contained HTML report (Q&A form
 * disabled — a static file has nowhere to send an LLM key securely).
 * @returns {Promise<string>} path to the written file, relative to the project root.
 */
async function generateStaticReport({ report, datasets }, templateId = 'default') {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const topicSlug = slugify(datasets[0].manifestEntry.topic);
  const filename = `${topicSlug}_${fmtCompactTimestamp()}.html`;
  const filepath = path.join(REPORTS_DIR, filename);

  const html = renderTemplate(templateId, { report, datasets }, { interactive: false });
  fs.writeFileSync(filepath, html);

  return path.relative(ROOT_DIR, filepath);
}

module.exports = { generateStaticReport };
