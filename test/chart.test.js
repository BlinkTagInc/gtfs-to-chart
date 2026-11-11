import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, cp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import express from 'express';
import gtfsToChart from '../index.js';
import { createGtfs, gtfsOptions, importFeeds } from '../lib/gtfs.js';
import {
  getDataforChart,
  setDefaultConfig,
  generateChartHTML,
} from '../lib/utils.js';
import { createRouter } from '../app/routes.js';

const feed = fileURLToPath(new URL('./fixtures/feed', import.meta.url));
const configFor = (extra = {}) =>
  setDefaultConfig({
    agencies: [{ sourceId: 'fixture', path: feed }],
    chartDate: '20261110',
    verbose: false,
    ...extra,
  });

test('in-memory charts expand frequencies, calculate stop distances and honor service dates', async () => {
  const config = configFor();
  const gtfs = createGtfs(config);
  try {
    assert.equal((await importFeeds(gtfs)).success, true);
    const data = await getDataforChart(gtfs, 'fixture', config, 'r');
    assert.deepEqual(
      data.trips.map((trip) => trip.trip_id),
      ['back', 'out_08:00:00', 'out_08:30:00'],
    );
    assert.deepEqual(
      [...new Set(data.stations.map((station) => station.direction_id))].sort(),
      [0, 1],
    );
    assert.ok(
      data.stations.every((station) => Number.isFinite(station.distance)),
    );
    assert.ok(
      Math.max(...data.stations.map((station) => station.distance)) > 1,
    );
    const html = await generateChartHTML(gtfs, 'fixture', config, 'r');
    assert.ok(html.includes('const chartData = '));
    await assert.rejects(
      getDataforChart(
        gtfs,
        'fixture',
        { ...config, chartDate: '20261111' },
        'r',
      ),
      /No trips found/,
    );
    const special = await getDataforChart(
      gtfs,
      'fixture',
      { ...config, chartDate: '20261114' },
      'r',
    );
    assert.deepEqual(
      special.trips.map((trip) => trip.trip_id),
      ['special'],
    );
  } finally {
    await gtfs.close();
  }
  assert.equal(gtfs.isClosed, true);
});

test('overlapping IDs stay isolated after import, close, reopen and Express reads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chart-sources-'));
  const second = path.join(root, 'second');
  await cp(feed, second, { recursive: true });
  const stops = await readFile(path.join(second, 'stops.txt'), 'utf8');
  await writeFile(
    path.join(second, 'stops.txt'),
    stops
      .replaceAll('First', 'Other First')
      .replaceAll('37.01', '37.03')
      .replaceAll('37.02', '37.06'),
  );
  const config = configFor({
    database: { path: path.join(root, 'gtfs.sqlite') },
    agencies: [
      { sourceId: 'fixture', path: feed },
      { sourceId: 'second', path: second },
    ],
  });
  const imported = createGtfs(config);
  try {
    await importFeeds(imported);
  } finally {
    await imported.close();
  }
  const reopened = createGtfs({ ...config, skipImport: true });
  let server;
  try {
    const first = await getDataforChart(reopened, 'fixture', config, 'r');
    const other = await getDataforChart(reopened, 'second', config, 'r');
    assert.equal(
      first.stations.find((stop) => stop.stop_id === 's1').name,
      'First',
    );
    assert.ok(Math.max(...first.stations.map((stop) => stop.distance)) < 2);
    assert.equal(
      other.stations.find((stop) => stop.stop_id === 's1').name,
      'Other First',
    );
    assert.ok(Math.max(...other.stations.map((stop) => stop.distance)) > 4);
    const app = express();
    app.use(createRouter(reopened, config));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const overview = await (await fetch(`${base}/?sourceId=second`)).text();
    assert.ok(overview.includes('/charts/r?sourceId=second'));
    const html = await (await fetch(`${base}/charts/r?sourceId=second`)).text();
    assert.ok(html.includes('Other First'));
    assert.ok(
      !(
        await (await fetch(`${base}/charts/r?sourceId=fixture`)).text()
      ).includes('Other First'),
    );
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await reopened.close();
  }
});

test('CLI generates charts and reuses its persistent database', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chart-cli-'));
  const config = configFor({
    database: { path: path.join(root, 'gtfs.sqlite') },
  });
  const configPath = path.join(root, 'settings.json');
  await writeFile(configPath, JSON.stringify(config));
  const bin = fileURLToPath(
    new URL('../bin/gtfs-to-chart.js', import.meta.url),
  );
  let importedChart;
  for (const extra of [[], ['--skipImport']]) {
    const result = spawnSync(
      process.execPath,
      [bin, '--configPath', configPath, ...extra],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const html = await readFile(
      path.join(root, 'charts/fixture/charts/10.html'),
      'utf8',
    );
    const chart = JSON.parse(
      html.match(/const chartData = (.*?);<\/script>/s)[1],
    );
    assert.equal(chart.trips.length, 3);
    if (importedChart) {
      assert.deepEqual(chart, importedChart);
    } else {
      importedChart = chart;
    }
    assert.deepEqual(
      (await readdir(path.join(root, 'charts/fixture'))).sort(),
      ['charts', 'css', 'index.html', 'js'],
    );
  }
});

test('configuration requires unique source IDs and persistent storage for skipImport', () => {
  const options = gtfsOptions(configFor());
  assert.equal(options.chartDate, undefined);
  assert.equal(options.sources[0].sourceId, 'fixture');
  for (const agency of [
    {},
    { sourceId: '' },
    { sourceId: '   ' },
    { sourceId: 123 },
  ]) {
    assert.throws(
      () => gtfsOptions(configFor({ agencies: [agency] })),
      /requires a nonempty sourceId string/,
    );
  }
  assert.throws(
    () =>
      gtfsOptions(
        configFor({ agencies: [{ sourceId: 'a/b' }, { sourceId: 'ab' }] }),
      ),
    /unique/,
  );
  assert.throws(
    () =>
      gtfsOptions(
        configFor({
          agencies: [{}],
          skipImport: true,
          database: { path: '/tmp/existing.sqlite' },
        }),
      ),
    /requires a nonempty sourceId string/,
  );
  assert.throws(
    () => gtfsOptions(configFor({ skipImport: true })),
    /persistent/,
  );
  assert.throws(
    () =>
      gtfsOptions(
        configFor({ agencies: [{ sourceId: 'a' }, { sourceId: 'a' }] }),
      ),
    /unique/,
  );
});

test('failed import releases the owned database for a later import', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chart-failure-'));
  const config = configFor({
    database: { path: path.join(root, 'failed.sqlite') },
    agencies: [{ sourceId: 'fixture', path: path.join(root, 'missing.zip') }],
  });
  await assert.rejects(gtfsToChart(config));
  const gtfs = createGtfs(configFor({ database: config.database }));
  try {
    await importFeeds(gtfs);
    assert.equal(
      (await getDataforChart(gtfs, 'fixture', config, 'r')).trips.length,
      3,
    );
  } finally {
    await gtfs.close();
  }
});

test('stored distances and missing timepoint values keep their chart semantics', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chart-fields-'));
  await cp(feed, root, { recursive: true });
  await writeFile(
    path.join(root, 'stop_times.txt'),
    [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled,timepoint',
      'special,10:00:00,10:00:00,s1,1,0,',
      'special,,,s2,2,5,',
      'special,10:20:00,10:20:00,s3,3,10,',
    ].join('\n') + '\n',
  );
  // A calendar_dates-only feed must work as well.
  const { unlink } = await import('node:fs/promises');
  await unlink(path.join(root, 'calendar.txt'));
  const config = configFor({
    agencies: [{ sourceId: 'fixture', path: root }],
    chartDate: '20261114',
  });
  const gtfs = createGtfs(config);
  try {
    await importFeeds(gtfs);
    const data = await getDataforChart(gtfs, 'fixture', config, 'r');
    assert.deepEqual(
      data.stations.map((station) => station.distance),
      [0, 10],
    );
    assert.deepEqual(
      data.stations.map((station) => station.stop_id),
      ['s1', 's3'],
    );
    assert.equal(data.trips[0].stoptimes[0].timepoint, null);
  } finally {
    await gtfs.close();
  }
});

test('an unsuccessful import result rejects before rendering', async () => {
  await assert.rejects(
    importFeeds({
      import: async () => ({ success: false, errors: ['fixture failure'] }),
    }),
    /fixture failure/,
  );
});
