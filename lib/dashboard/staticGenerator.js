const fs = require('fs');
const path = require('path');
const { REPORTS_DIR, ROOT_DIR } = require('../config/constants');
const { renderTemplate } = require('./render');
const { buildRawDataPayload } = require('./rawData');
const { slugify } = require('../utils/slug');
const { fmtCompactTimestamp } = require('../utils/format');

/**
 * Renders a non-interactive, fully self-contained HTML report (Q&A form
 * disabled — a static file has nowhere to send an LLM key securely), plus a
 * sibling .data.json file with every raw collected item — there's no server
 * here to serve /api/raw-data.json from, so the download button links to
 * this file directly by its (same-directory) relative name instead.
 * @returns {Promise<string>} path to the written .html file, relative to the project root.
 */
async function generateStaticReport({ report, datasets }, templateId = 'default') {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const topicSlug = slugify(datasets[0].manifestEntry.topic);
  const stamp = fmtCompactTimestamp();
  const filename = `${topicSlug}_${stamp}.html`;
  const dataFilename = `${topicSlug}_${stamp}.data.json`;
  const filepath = path.join(REPORTS_DIR, filename);
  const dataFilepath = path.join(REPORTS_DIR, dataFilename);

  fs.writeFileSync(dataFilepath, JSON.stringify(buildRawDataPayload(datasets), null, 2));

  const html = renderTemplate(templateId, { report, datasets }, { interactive: false, rawDataFilename: dataFilename });
  fs.writeFileSync(filepath, html);

  return path.relative(ROOT_DIR, filepath);
}

module.exports = { generateStaticReport };
