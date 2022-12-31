import { readFileSync } from 'node:fs';

import { openDb, getRoutes } from 'gtfs';
import express from 'express';

import { setDefaultConfig, generateOverviewHTML, generateChartHTML } from '../lib/utils.js';

const selectedConfig = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
const config = setDefaultConfig(selectedConfig);
// Override noHead config option so full HTML pages are generated
config.noHead = false;
config.assetPath = '/';
config.log = console.log;
config.logWarning = console.warn;
config.logError = console.error;
config.isLocal = true;

const router = new express.Router();

openDb(config);

/*
 * Show all routes
 */
router.get('/', async (request, response, next) => {
  try {
    const routes = getRoutes();
    const html = await generateOverviewHTML(config, routes);
    response.send(html);
  } catch (error) {
    next(error);
  }
});

/*
 * Show a specific chart
 */
router.get('/charts/:routeId', async (request, response) => {
  const { routeId } = request.params;

  try {
    const html = await generateChartHTML(config, routeId);
    response.send(html);
  } catch (error) {
    return response.render('error', { error });
  }
});

export default router;
