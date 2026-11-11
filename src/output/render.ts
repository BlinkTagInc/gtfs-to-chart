import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderFile } from 'pug';
import type { Gtfs, Routes } from 'gtfs';
import type { ChartData } from '../types.ts';
import type { ResolvedConfig } from '../config/config.ts';

// Works from source, bundled chunks, and the CLI entry inside dist/bin.
function packageRoot(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error('Cannot locate gtfs-to-chart package assets');
    }
    directory = parent;
  }
  return directory;
}
export const root = packageRoot();
export const version: string = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
).version;

/** Safe, stable names, including IDs that differ only by case or punctuation. */
export function fileId(id: string): string {
  const label = id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'id';
  return `${label}-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
}

export function renderChart(
  route: Routes,
  data: ChartData,
  config: ResolvedConfig,
): string {
  return renderFile(
    path.join(
      config.output.templateDirectory ?? path.join(root, 'templates'),
      'chart-page.pug',
    ),
    {
      title: route.route_short_name || route.route_long_name || route.route_id,
      route,
      chartData: data,
      serializedData: JSON.stringify(data)
        .replaceAll('<', '\\u003c')
        .replaceAll('\u2028', '\\u2028')
        .replaceAll('\u2029', '\\u2029'),
      serviceDate: String(config.charts.serviceDate),
      assetPath: '../../',
      version,
      pretty: config.output.pretty,
    },
  );
}

export async function renderOverview(
  gtfs: Gtfs,
  sourceId: string,
  routes: Routes[],
  config: ResolvedConfig,
): Promise<string> {
  const agencies = await gtfs.schedule.agency
    .where({ source_id: sourceId })
    .all();
  return renderFile(
    path.join(
      config.output.templateDirectory ?? path.join(root, 'templates'),
      'overview-page.pug',
    ),
    {
      title: `${sourceId} Routes`,
      agency: {
        agency_name:
          agencies.map((agency) => agency.agency_name).join(' / ') || sourceId,
      },
      routes: [...routes]
        .sort((a, b) =>
          (a.route_short_name ?? a.route_id).localeCompare(
            b.route_short_name ?? b.route_id,
            undefined,
            { numeric: true },
          ),
        )
        .map((route) => ({
          ...route,
          relativePath: `routes/${fileId(route.route_id)}.html`,
        })),
      assetPath: '../',
      version,
      pretty: config.output.pretty,
    },
  );
}
