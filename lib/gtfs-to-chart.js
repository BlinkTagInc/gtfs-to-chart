import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

import { createGtfs, importFeeds } from './gtfs.js';
import sanitize from 'sanitize-filename';
import Timer from 'timer-machine';

import { prepDirectory } from './file-utils.js';
import { log, logWarning, progressBar } from './log-utils.js';
import {
  setDefaultConfig,
  generateChartHTML,
  generateOverviewHTML,
} from './utils.js';
import { formatRouteName } from './formatters.js';

/*
 * Generate HTML charts from GTFS
 */
const gtfsToChart = async (initialConfig) => {
  const config = setDefaultConfig(initialConfig);
  config.log = log(config);
  config.logWarning = logWarning(config);

  const gtfs = createGtfs(config);
  try {
    if (!config.skipImport) {
      await importFeeds(gtfs);
    }
    const results = [];
    for (const agency of config.agencies) {
      const sourceId = agency.sourceId;
      const agencyConfig = { ...config };
      const timer = new Timer();
      const exportPath = path.join(process.cwd(), 'charts', sanitize(sourceId));
      const outputStats = {
        charts: 0,
      };

      timer.start();

      await prepDirectory(exportPath);

      const routes = await gtfs.schedule.routes
        .where({ source_id: sourceId })
        .all();
      const bar = progressBar(
        `${sourceId}: Generating charts [:bar] :current/:total`,
        { total: routes.length },
        config,
      );

      // Make directory if it doesn't exist
      await mkdir(exportPath, { recursive: true });
      agencyConfig.assetPath = '../';

      /* eslint-disable no-await-in-loop */
      for (const route of routes) {
        outputStats.charts += 1;

        try {
          const html = await generateChartHTML(
            gtfs,
            sourceId,
            agencyConfig,
            route.route_id,
          );
          const htmlPath = path.join(
            exportPath,
            'charts',
            sanitize(`${formatRouteName(route)}.html`),
          );
          await writeFile(htmlPath, html);
        } catch (error) {
          config.logWarning(error.message);
        }

        bar.tick();
      }
      /* eslint-enable no-await-in-loop */

      // Generate route summary index.html
      agencyConfig.assetPath = '';
      const html = await generateOverviewHTML(
        gtfs,
        sourceId,
        agencyConfig,
        routes,
      );
      await writeFile(path.join(exportPath, 'index.html'), html);

      timer.stop();

      // Print stats
      config.log(`${sourceId}: charts created at ${exportPath}`);

      const seconds = Math.round(timer.time() / 1000);
      config.log(`${sourceId}: chart generation required ${seconds} seconds`);
      results.push(undefined);
    }
    return results;
  } finally {
    await gtfs.close();
  }
};

export default gtfsToChart;
