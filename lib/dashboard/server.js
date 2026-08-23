const net = require('net');
const express = require('express');
const open = require('open');
const logger = require('../utils/logger');
const { DEFAULT_DASHBOARD_PORT } = require('../config/constants');
const { getCredential } = require('../config/env');
const { renderTemplate } = require('./render');
const { createAskHandler } = require('./routes/ask');

function findOpenPort(startPort, attempts = 10) {
  return new Promise((resolve, reject) => {
    function tryPort(port, left) {
      const tester = net.createServer();
      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && left > 0) {
          tester.close(() => tryPort(port + 1, left - 1));
        } else {
          reject(err);
        }
      });
      tester.once('listening', () => tester.close(() => resolve(port)));
      tester.listen(port, '127.0.0.1');
    }
    tryPort(startPort, attempts);
  });
}

/**
 * Starts the local dashboard: serves the live report and a same-origin
 * /api/ask endpoint for follow-up Q&A grounded in the datasets already
 * loaded in memory (no recollection). Bound to 127.0.0.1 only. This is a
 * deliberately blocking terminal state of the CLI run — it keeps the
 * process alive so /api/ask keeps working, and exits cleanly on Ctrl+C.
 */
async function startDashboard({ report, datasets }, templateId = 'default') {
  const app = express();
  app.use(express.json());

  app.get('/', (req, res) => {
    res.send(renderTemplate(templateId, { report, datasets }, { interactive: true }));
  });

  app.post('/api/ask', createAskHandler({ datasets }));

  const desiredPort = Number(getCredential('DASHBOARD_PORT')) || DEFAULT_DASHBOARD_PORT;
  const port = await findOpenPort(desiredPort);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', async () => {
      const url = `http://127.0.0.1:${port}`;
      logger.success(`\nDashboard running at ${url}`);
      logger.step('Press Ctrl+C to stop.\n');
      try {
        await open(url);
      } catch (e) {
        logger.warn(`Could not auto-open a browser (${e.message}) — open ${url} manually.`);
      }
    });

    server.on('error', reject);

    process.on('SIGINT', () => {
      logger.step('\nStopping dashboard...');
      server.close(() => {
        resolve();
        process.exit(0);
      });
    });
  });
}

module.exports = { startDashboard };
