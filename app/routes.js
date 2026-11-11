import express from 'express';
import { generateOverviewHTML, generateChartHTML } from '../lib/utils.js';

// The server owns the instance; requests only borrow it.
export function createRouter(gtfs, config) {
  const router = new express.Router();
  const sourceIds = config.agencies.map((agency) => agency.sourceId);
  const sourceFor = (request) => {
    const sourceId = request.query.sourceId ?? sourceIds[0];
    if (!sourceIds.includes(sourceId)) {
      throw new Error('Invalid sourceId provided');
    }
    return sourceId;
  };

  router.get('/', async (request, response, next) => {
    try {
      const sourceId = sourceFor(request);
      const routes = await gtfs.schedule.routes
        .where({ source_id: sourceId })
        .all();
      const html = await generateOverviewHTML(
        gtfs,
        sourceId,
        { ...config, isLocal: true },
        routes,
      );
      response.send(html);
    } catch (error) {
      next(error);
    }
  });

  router.get('/charts/:routeId', async (request, response) => {
    try {
      const html = await generateChartHTML(
        gtfs,
        sourceFor(request),
        config,
        request.params.routeId,
      );
      response.send(html);
    } catch (error) {
      response.render('error', { error });
    }
  });
  return router;
}
