import { Gtfs, createConsoleReporter } from 'gtfs';
import sanitize from 'sanitize-filename';

// Keep application settings out of node-GTFS's strictly validated options.
export function gtfsOptions(config) {
  if (!config.agencies?.length) {
    throw new Error('No agencies defined in `config.json`');
  }
  for (const key of ['ignoreErrors', 'db', 'gtfsRealtimeExpirationSeconds']) {
    if (config[key] !== undefined) {
      throw new Error(`Unsupported legacy GTFS option: ${key}`);
    }
  }
  const sourceIds = new Set();
  const directories = new Set();
  const sources = config.agencies.map((agency) => {
    const sourceId = agency.sourceId;
    if (typeof sourceId !== 'string' || sourceId.trim() === '') {
      throw new Error(
        'Each feed requires a nonempty sourceId string; rename agency_key to sourceId',
      );
    }
    const directory = sanitize(sourceId);
    if (
      !sourceId ||
      !directory ||
      sourceIds.has(sourceId) ||
      directories.has(directory)
    ) {
      throw new Error(
        'Each feed needs a unique sourceId and nonempty, unique sanitized output directory',
      );
    }
    sourceIds.add(sourceId);
    directories.add(directory);
    for (const key of [
      'prefix',
      'realtimeAlerts',
      'realtimeTripUpdates',
      'realtimeVehiclePositions',
    ]) {
      if (agency[key] !== undefined) {
        throw new Error(`Unsupported legacy GTFS option: agencies[].${key}`);
      }
    }
    if (config.skipImport) {
      return { sourceId };
    }
    if (agency.path && agency.url) {
      throw new Error('Specify either path or url for each feed, not both');
    }
    const csv = {};
    const csvNames = {
      skip_empty_lines: 'skipEmptyLines',
      relax_quotes: 'relaxQuotes',
    };
    for (const [key, value] of Object.entries(config.csvOptions ?? {})) {
      const name = csvNames[key] ?? key;
      if (
        ![
          'encoding',
          'delimiter',
          'quote',
          'escape',
          'trim',
          'skipEmptyLines',
          'relaxQuotes',
        ].includes(name)
      ) {
        throw new Error(`Unsupported csvOptions.${key}`);
      }
      csv[name] = value;
    }
    const defaultAgencyId = agency.agencyId ?? agency.fillEmptyAgencyId;
    if (defaultAgencyId !== undefined && typeof defaultAgencyId !== 'string') {
      throw new Error('agencyId/fillEmptyAgencyId must be a string in v5');
    }
    return {
      sourceId,
      schedule: {
        ...(agency.path
          ? { path: agency.path }
          : {
              url: agency.url,
              ...(agency.headers ? { requestHeaders: agency.headers } : {}),
              ...(config.downloadTimeout !== undefined
                ? { timeoutMs: config.downloadTimeout }
                : {}),
            }),
        ...(defaultAgencyId !== undefined ? { defaultAgencyId } : {}),
        ...(agency.exclude
          ? {
              excludeFiles: agency.exclude.map((name) =>
                name.includes('.') ? name : `${name}.txt`,
              ),
            }
          : {}),
        import: {
          csv,
          validation: {
            onDuplicateKey: config.ignoreDuplicates ? 'keep-first' : 'reject',
          },
        },
      },
    };
  });
  // Never reuse a v4 path implicitly. Explicit database.path is the v5 override.
  const legacyPath = config.sqlitePath;
  const database = config.database ?? {
    path:
      !legacyPath || legacyPath === ':memory:'
        ? ':memory:'
        : `${legacyPath}.v5.sqlite`,
  };
  if (config.skipImport && (!database.path || database.path === ':memory:')) {
    throw new Error('skipImport requires a persistent v5 database.path');
  }
  const level = config.logLevel === 'warning' ? 'warn' : config.logLevel;
  const reporting = {
    level: level ?? (config.verbose === false ? 'silent' : 'info'),
    reporter: config.logFunction
      ? (event) => config.logFunction(event.message, event.level)
      : createConsoleReporter(),
  };
  return { database, sources, extensions: [], reporting };
}

export function createGtfs(config) {
  return new Gtfs(gtfsOptions(config));
}

export async function importFeeds(gtfs) {
  const result = await gtfs.import();
  if (!result.success) {
    throw new Error(`GTFS import failed: ${JSON.stringify(result.errors)}`);
  }
  return result;
}
