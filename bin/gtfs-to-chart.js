#!/usr/bin/env node

import path from 'node:path';
import { readFile } from 'node:fs/promises';

import yargs from 'yargs';
/* eslint-disable-next-line node/file-extension-in-import */
import { hideBin } from 'yargs/helpers';

import { formatError } from '../lib/log-utils.js';
import gtfsToChart from '../index.js';

const { argv } = yargs(hideBin(process.argv))
  .usage('Usage: $0 --config ./config.json')
  .help()
  .option('c', {
    alias: 'configPath',
    describe: 'Path to config file',
    default: './config.json',
    type: 'string'
  })
  .option('s', {
    alias: 'skipImport',
    describe: 'Don’t import GTFS file.',
    type: 'boolean'
  })
  .default('skipImport', undefined)
  .option('t', {
    alias: 'showOnlyTimepoint',
    describe: 'Show only stops with a `timepoint` value in `stops.txt`',
    type: 'boolean'
  })
  .default('showOnlyTimepoint', undefined);

function handleError(error) {
  const text = error || 'Unknown Error';
  process.stdout.write(`\n${formatError(text)}\n`);
  throw error;
}

const getConfig = async () => {
  const data = await readFile(path.resolve(argv.configPath), 'utf8').catch(() => {
    throw new Error(`Cannot find configuration file at \`${argv.configPath}\`. Use config-sample.json as a starting point, pass --configPath option`);
  });

  try {
    const config = JSON.parse(data);

    if (argv.skipImport === true) {
      config.skipImport = argv.skipImport;
    }

    if (argv.showOnlyTimepoint === true) {
      config.showOnlyTimepoint = argv.showOnlyTimepoint;
    }

    return config;
  } catch (error) {
    console.error(`Problem parsing configuration file at \`${argv.configPath}\``);
    handleError(error);
  }
};

getConfig()
  .then(async config => {
    await gtfsToChart(config);

    process.exit();
  })
  .catch(handleError);
