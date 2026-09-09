// Builds the "download all raw data" JSON payload — every collected item,
// across every dataset in view, plus enough run metadata to make the file
// self-explanatory once downloaded on its own, away from the dashboard.
// This is the same underlying data as the saved .xlsx, just as JSON.
function buildRawDataPayload(datasets) {
  return {
    generatedAt: new Date().toISOString(),
    totalItems: datasets.reduce((sum, d) => sum + d.items.length, 0),
    datasets: datasets.map((d) => ({
      id: d.manifestEntry.id,
      topic: d.manifestEntry.topic,
      analysisTopic: d.manifestEntry.analysisTopic || null,
      timePeriod: d.manifestEntry.timePeriod,
      sourcesSucceeded: d.manifestEntry.sourcesSucceeded,
      itemCount: d.items.length,
    })),
    items: datasets.flatMap((d) => d.items),
  };
}

module.exports = { buildRawDataPayload };
