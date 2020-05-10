const path = require('path');

const _ = require('lodash');
const fs = require('fs-extra');
const gtfs = require('gtfs');
const sanitize = require('sanitize-filename');
const Timer = require('timer-machine');

const fileUtils = require('./file-utils');
const logUtils = require('./log-utils');
const utils = require('./utils');
const formatters = require('./formatters');

/*
 * Generate HTML diagrams from GTFS.
 */
module.exports = initialConfig => {
  const config = utils.setDefaultConfig(initialConfig);
  config.log = logUtils.log(config);
  config.logWarning = logUtils.logWarning(config);

  if (!config.agencies || config.agencies.length === 0) {
    throw new Error('No agencies defined in `config.json`');
  }

  return Promise.all(config.agencies.map(async agency => {
    const timer = new Timer();
    const agencyKey = agency.agency_key;
    const exportPath = path.join(process.cwd(), 'diagrams', sanitize(agencyKey));
    const outputStats = {
      diagrams: 0
    };

    timer.start();

    if (!config.skipImport) {
      // Import GTFS
      const agencyConfig = _.clone(_.omit(config, 'agencies'));
      agencyConfig.agencies = [agency];

      await gtfs.import(agencyConfig);
    }

    await fileUtils.prepDirectory(exportPath);

    const routes = await gtfs.getRoutes({ agency_key: agencyKey }, undefined, { lean: true });
    const bar = logUtils.progressBar(`${agencyKey}: Generating diagrams [:bar] :current/:total`, { total: routes.length }, config);

    // Make directory if it doesn't exist
    await fs.ensureDir(exportPath);
    config.assetPath = '../';

    /* eslint-disable no-await-in-loop */
    for (const route of routes) {
      outputStats.diagrams += 1;

      try {
        const diagramHTML = await utils.generateDiagramHTML(route.route_id, agencyKey, config.diagramDate, config);
        const htmlPath = path.join(exportPath, sanitize(`${formatters.formatRouteName(route)}.html`));
        await fs.writeFile(htmlPath, diagramHTML);
      } catch (error) {
        config.logWarning(error.message);
      }

      bar.tick();
    }
    /* eslint-enable no-await-in-loop */

    // Generate route summary index.html
    config.assetPath = '';
    const html = await utils.generateOverviewHTML(agencyKey, routes, config);
    await fs.writeFile(path.join(exportPath, 'index.html'), html);

    timer.stop();

    // Print stats
    config.log(`${agencyKey}: diagrams created at ${exportPath}`);

    const seconds = Math.round(timer.time() / 1000);
    config.log(`${agencyKey}: diagram generation required ${seconds} seconds`);
  }));
};
