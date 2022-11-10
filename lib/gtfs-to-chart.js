import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

import { clone, omit } from 'lodash-es';
import { openDb, importGtfs, getRoutes } from 'gtfs';
import sanitize from 'sanitize-filename';
import Timer from 'timer-machine';

import { prepDirectory } from './file-utils.js';
import { log, logWarning, progressBar } from './log-utils.js';
import { setDefaultConfig, generateChartHTML, generateOverviewHTML } from './utils.js';
import { formatRouteName } from './formatters.js';

/*
 * Generate HTML charts from GTFS
 */
const gtfsToChart = async initialConfig => {
  const config = setDefaultConfig(initialConfig);
  config.log = log(config);
  config.logWarning = logWarning(config);

  await openDb(config);

  if (!config.agencies || config.agencies.length === 0) {
    throw new Error('No agencies defined in `config.json`');
  }

  return Promise.all(config.agencies.map(async agency => {
    const timer = new Timer();
    const agencyKey = agency.agency_key;
    const exportPath = path.join(process.cwd(), 'charts', sanitize(agencyKey));
    const outputStats = {
      charts: 0
    };

    timer.start();

    const agencyConfig = clone(omit(config, 'agencies'));
    agencyConfig.agencies = [agency];

    if (!config.skipImport) {
      // Import GTFS
      await importGtfs(agencyConfig);
    }

    await prepDirectory(exportPath);

    const routes = await getRoutes();
    const bar = progressBar(`${agencyKey}: Generating charts [:bar] :current/:total`, { total: routes.length }, config);

    // Make directory if it doesn't exist
    await mkdir(exportPath, { recursive: true });
    config.assetPath = '../';

    /* eslint-disable no-await-in-loop */
    for (const route of routes) {
      outputStats.charts += 1;

      try {
        const html = await generateChartHTML(config, route.route_id);
        const htmlPath = path.join(exportPath, 'charts', sanitize(`${formatRouteName(route)}.html`));
        await writeFile(htmlPath, html);
      } catch (error) {
        config.logWarning(error.message);
      }

      bar.tick();
    }
    /* eslint-enable no-await-in-loop */

    // Generate route summary index.html
    config.assetPath = '';
    const html = await generateOverviewHTML(config, routes);
    await writeFile(path.join(exportPath, 'index.html'), html);

    timer.stop();

    // Print stats
    config.log(`${agencyKey}: charts created at ${exportPath}`);

    const seconds = Math.round(timer.time() / 1000);
    config.log(`${agencyKey}: chart generation required ${seconds} seconds`);
  }));
};

export default gtfsToChart;
