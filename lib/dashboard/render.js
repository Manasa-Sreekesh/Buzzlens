// Only one template exists today. renderTemplate is the seam that keeps
// adding a second, selectable template a small addition later rather than a
// rewrite — nothing else in the dashboard module needs to change.
const templates = {
  default: require('./templates/default'),
};

function renderTemplate(templateId, payload, opts) {
  const template = templates[templateId];
  if (!template) throw new Error(`Unknown dashboard template: "${templateId}"`);
  return template.render(payload, opts);
}

module.exports = { renderTemplate };
