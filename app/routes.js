const _ = require('lodash');
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

const router = new express.Router();

/*
 * Show all agencies
 */
router.get('/', async (request, response, next) => {
  try {
    const agencies = await gtfs.getAgencies();
    const sortedAgencies = _.sortBy(agencies, 'agency_name');
    return response.render('agencies', { agencies: sortedAgencies });
  } catch (error) {
    next(error);
  }
});

/*
 * Show all routes for an agency
 */
router.get('/diagrams/:agencyKey', async (request, response, next) => {
  const { agencyKey } = request.params;

  if (!agencyKey) {
    return next(new Error('No agencyKey provided'));
  }

  try {
    const routes = await gtfs.getRoutes({ agency_key: agencyKey }, undefined, { lean: true });
    const html = await utils.generateOverviewHTML(agencyKey, routes, config);
    response.send(html);
  } catch (error) {
    next(error);
  }
});

/*
 * Show a specific diagram
 */
router.get('/diagrams/:agencyKey/:routeId', async (request, response) => {
  const { agencyKey, routeId } = request.params;

  try {
    const date = '20200505';
    const diagramHtml = await utils.generateDiagramHTML(routeId, agencyKey, date, config);
    response.send(diagramHtml);
  } catch (error) {
    return response.render('error', { error });
  }
});

module.exports = router;
