const gtfs = require('gtfs');
const express = require('express');

const utils = require('../lib/utils');

const selectedConfig = require('../config');

const config = utils.setDefaultConfig(selectedConfig);
// Override noHead config option so full HTML pages are generated
config.noHead = false;
config.assetPath = '/';
config.log = console.log;
config.logWarning = console.warn;
config.logError = console.error;
config.isLocal = true;

const router = new express.Router();

gtfs.openDb(config);

/*
 * Show all routes
 */
router.get('/', async (request, response, next) => {
  try {
    const routes = await gtfs.getRoutes();
    const html = await utils.generateOverviewHTML(config, routes);
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
    const html = await utils.generateChartHTML(config, routeId);
    response.send(html);
  } catch (error) {
    return response.render('error', { error });
  }
});

module.exports = router;
