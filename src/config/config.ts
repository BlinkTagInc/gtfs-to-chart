import path from 'node:path';
import { homedir } from 'node:os';
import type { ChartConfig } from '../types.ts';

function keys(value: unknown, allowed: string[], name: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `Unknown option ${name}.${key}; see the v3 configuration in README.md`,
      );
    }
  }
}

export function resolvePath(value: string): string {
  return path.resolve(
    value === '~'
      ? homedir()
      : value.startsWith('~/')
        ? path.join(homedir(), value.slice(2))
        : value,
  );
}

export function resolveConfig(config: ChartConfig) {
  keys(
    config,
    [
      'database',
      'sources',
      'extensions',
      'realtime',
      'reporting',
      'charts',
      'output',
    ],
    'config',
  );
  if (config.database === undefined) {
    throw new Error(
      'database is required; set database.path to a SQLite filename or ":memory:"',
    );
  }
  keys(config.database, ['path', 'client', 'durability'], 'database');
  if (
    config.database.path !== undefined &&
    (typeof config.database.path !== 'string' || !config.database.path.trim())
  ) {
    throw new Error('database.path must be a nonempty string');
  }
  keys(
    config.charts ?? {},
    ['serviceDate', 'routeIds', 'timepointsOnly'],
    'charts',
  );
  keys(
    config.output ?? {},
    ['directory', 'overwrite', 'templateDirectory', 'pretty'],
    'output',
  );
  if (!Array.isArray(config.sources) || config.sources.length === 0) {
    throw new Error('sources must be a nonempty array');
  }
  const today = new Date();
  const serviceDate =
    config.charts?.serviceDate ??
    Number(
      `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`,
    );
  const dateText = String(serviceDate);
  const parsed = new Date(
    `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}T00:00:00Z`,
  );
  if (
    !Number.isInteger(serviceDate) ||
    !/^\d{8}$/.test(dateText) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10).replaceAll('-', '') !== dateText
  ) {
    throw new Error('charts.serviceDate must be a valid YYYYMMDD integer');
  }
  for (const [name, value] of Object.entries({
    'charts.timepointsOnly': config.charts?.timepointsOnly,
    'output.overwrite': config.output?.overwrite,
    'output.pretty': config.output?.pretty,
  })) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new Error(`${name} must be a boolean`);
    }
  }
  for (const [name, value] of Object.entries({
    directory: config.output?.directory,
    templateDirectory: config.output?.templateDirectory,
  })) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.trim() === '')
    ) {
      throw new Error(`output.${name} must be a nonempty string`);
    }
  }
  if (
    config.charts?.routeIds !== undefined &&
    (!Array.isArray(config.charts.routeIds) ||
      config.charts.routeIds.some((id) => typeof id !== 'string' || !id))
  ) {
    throw new Error('charts.routeIds must be an array of nonempty strings');
  }
  for (const [index, source] of config.sources.entries()) {
    keys(source, ['sourceId', 'schedule', 'realtime'], `sources[${index}]`);
    if (source.schedule !== undefined) {
      if (
        source.schedule === null ||
        typeof source.schedule !== 'object' ||
        Array.isArray(source.schedule)
      ) {
        throw new Error(`sources[${index}].schedule must be an object`);
      }
      if (
        'path' in source.schedule &&
        (typeof source.schedule.path !== 'string' ||
          !source.schedule.path.trim())
      ) {
        throw new Error(
          `sources[${index}].schedule.path must be a nonempty string`,
        );
      }
    }
  }
  const sources = config.sources.map((source) => ({
    ...source,
    sourceId: source.sourceId ?? (config.sources.length === 1 ? 'default' : ''),
  }));
  const ids = new Set<string>();
  for (const source of sources) {
    if (
      typeof source.sourceId !== 'string' ||
      !source.sourceId.trim() ||
      ids.has(source.sourceId)
    ) {
      throw new Error(
        'sources require unique nonempty sourceId strings (optional for a single source)',
      );
    }
    ids.add(source.sourceId);
  }
  const { charts: _charts, output: _output, ...gtfs } = config;
  return {
    gtfs: { ...gtfs, sources },
    charts: {
      serviceDate,
      routeIds: config.charts?.routeIds,
      timepointsOnly: config.charts?.timepointsOnly ?? true,
    },
    output: {
      directory: resolvePath(config.output?.directory ?? 'charts'),
      overwrite: config.output?.overwrite ?? false,
      templateDirectory: config.output?.templateDirectory
        ? resolvePath(config.output.templateDirectory)
        : undefined,
      pretty: config.output?.pretty ?? false,
    },
  };
}

export type ResolvedConfig = ReturnType<typeof resolveConfig>;
