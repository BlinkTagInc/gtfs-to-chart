import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtemp,
  readFile,
  cp,
  writeFile,
  readdir,
  rm,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Gtfs } from 'gtfs';
import { generateCharts } from '../dist/index.js';
import { getChartData } from '../src/chart/data.ts';
import { resolveConfig } from '../src/config/config.ts';
import { parseTime, formatTime } from '../src/chart/time.ts';
import { fileId } from '../src/output/render.ts';

const feed = fileURLToPath(new URL('./fixtures/feed', import.meta.url));
const bin = fileURLToPath(
  new URL('../dist/bin/gtfs-to-chart.js', import.meta.url),
);
const configFor = (extra = {}) => ({
  database: { path: ':memory:' },
  sources: [{ sourceId: 'fixture', schedule: { path: feed } }],
  charts: { serviceDate: 20261110 },
  ...extra,
});
async function temp(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'chart-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function withFeed(config, callback) {
  const resolved = resolveConfig(config);
  const gtfs = new Gtfs(resolved.gtfs);
  try {
    const result = await gtfs.import();
    assert.equal(result.success, true, JSON.stringify(result.errors));
    return await callback(gtfs, resolved.charts);
  } finally {
    await gtfs.close();
  }
}

test('service dates, frequencies, distances, and direction isolation', async () => {
  await withFeed(configFor(), async (gtfs, charts) => {
    const data = await getChartData(gtfs, 'fixture', charts, 'r');
    assert.deepEqual(
      data.trips.map((trip) => trip.trip_id),
      ['back', 'out_08:00:00', 'out_08:30:00'],
    );
    assert.ok(
      data.stations.every((station) => Number.isFinite(station.distance)),
    );
    const firstStops = data.stations.filter(
      (station) => station.stop_id === 's1',
    );
    assert.ok(
      Math.abs(firstStops[0].distance - firstStops[1].distance) < 0.001,
    );
    assert.ok(data.notes.some((note) => note.includes('straight line')));
    assert.equal(
      await getChartData(
        gtfs,
        'fixture',
        { ...charts, serviceDate: 20261111 },
        'r',
      ),
      null,
    );
    const special = await getChartData(
      gtfs,
      'fixture',
      { ...charts, serviceDate: 20261114 },
      'r',
    );
    assert.deepEqual(
      special.trips.map((trip) => trip.trip_id),
      ['special'],
    );
  });
});

test('frequency expansion preserves overnight hours and first-stop dwell', async (t) => {
  const root = await temp(t);
  await cp(feed, root, { recursive: true });
  await writeFile(
    path.join(root, 'frequencies.txt'),
    'trip_id,start_time,end_time,headway_secs\nout,23:50:00,25:00:00,1800\n',
  );
  const times = await readFile(path.join(root, 'stop_times.txt'), 'utf8');
  await writeFile(
    path.join(root, 'stop_times.txt'),
    times.replace('out,08:00:00,08:00:00', 'out,07:59:00,08:00:00'),
  );
  await withFeed(
    configFor({ sources: [{ sourceId: 'fixture', schedule: { path: root } }] }),
    async (gtfs, charts) => {
      const data = await getChartData(gtfs, 'fixture', charts, 'r');
      const trip = data.trips.find((trip) => trip.trip_id === 'out_24:50:00');
      assert.equal(trip.stoptimes[0].arrival_time, '24:49:00');
      assert.equal(trip.stoptimes[0].departure_time, '24:50:00');
      assert.equal(trip.stoptimes[2].arrival_time, '25:10:00');
    },
  );
  assert.equal(formatTime(parseTime('49:12:03')), '49:12:03');
  assert.throws(() => parseTime('24:99:00'), /Invalid/);
});

test('timepointsOnly works and a calendar_dates-only feed uses stored distances', async (t) => {
  const root = await temp(t);
  await cp(feed, root, { recursive: true });
  await unlink(path.join(root, 'calendar.txt'));
  await writeFile(
    path.join(root, 'stop_times.txt'),
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled,timepoint\nspecial,10:00:00,10:00:00,s1,1,0,\nspecial,10:10:00,10:10:00,s2,2,5,0\nspecial,10:20:00,10:20:00,s3,3,10,\n',
  );
  await withFeed(
    configFor({
      sources: [{ sourceId: 'fixture', schedule: { path: root } }],
      charts: { serviceDate: 20261114 },
    }),
    async (gtfs, charts) => {
      const data = await getChartData(gtfs, 'fixture', charts, 'r');
      assert.deepEqual(
        data.stations.map((station) => station.distance),
        [0, 10],
      );
      assert.equal(data.notes.length, 0);
      const all = await getChartData(
        gtfs,
        'fixture',
        { ...charts, timepointsOnly: false },
        'r',
      );
      assert.deepEqual(
        all.stations.map((station) => station.distance),
        [0, 5, 10],
      );
    },
  );
});

test('multi-source generation isolates overlapping IDs and returns real results', async (t) => {
  const root = await temp(t);
  const second = path.join(root, 'second');
  await cp(feed, second, { recursive: true });
  await writeFile(
    path.join(second, 'stops.txt'),
    (await readFile(path.join(second, 'stops.txt'), 'utf8')).replaceAll(
      'First',
      'Other First',
    ),
  );
  const result = await generateCharts(
    configFor({
      sources: [
        { sourceId: 'one', schedule: { path: feed } },
        { sourceId: 'two', schedule: { path: second } },
      ],
      output: { directory: path.join(root, 'output') },
    }),
  );
  assert.equal(result.success, true);
  assert.deepEqual(
    result.sources.map((source) => source.charts),
    [1, 1],
  );
  const html = await Promise.all(
    result.sources.map((source) =>
      readFile(
        path.join(source.directory, 'routes', `${fileId('r')}.html`),
        'utf8',
      ),
    ),
  );
  assert.equal(html[0].includes('Other First'), false);
  assert.equal(html[1].includes('Other First'), true);
  assert.ok(html[0].includes('../../js/chart.js'));
});

test('CLI imports, reuses persistent storage, rejects old flags, and stays quiet', async (t) => {
  const root = await temp(t);
  const config = configFor({
    database: { path: path.join(root, 'gtfs.sqlite') },
    output: { directory: path.join(root, 'output') },
  });
  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, JSON.stringify(config));
  for (const extra of [[], ['--skip-import', '--overwrite']]) {
    const result = spawnSync(
      process.execPath,
      [bin, '--config', configPath, '--quiet', ...extra],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
  const invalid = spawnSync(
    process.execPath,
    [bin, '--configPath', configPath],
    { encoding: 'utf8' },
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown option/);
  assert.equal(invalid.stdout, '');
  const help = spawnSync(process.execPath, [bin, '--help'], {
    encoding: 'utf8',
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--service-date/);
});

test('invalid configuration fails early and default source identity matches v5', () => {
  assert.equal(
    resolveConfig(configFor({ sources: [{ schedule: { path: feed } }] })).gtfs
      .sources[0].sourceId,
    'default',
  );
  for (const extra of [
    { agencies: [] },
    { charts: { serviceDate: '20261110' } },
    { charts: { serviceDate: 20260230 } },
    { charts: { unknown: true } },
    { output: { overwrite: 'true' } },
    { sources: [{}, {}] },
  ]) {
    assert.throws(() => resolveConfig(configFor(extra)));
  }
  assert.notEqual(fileId('r/a'), fileId('ra'));
  assert.notEqual(fileId('A').toLowerCase(), fileId('a').toLowerCase());
});

test('output overwrite is explicit and failed regeneration preserves previous output', async (t) => {
  const root = await temp(t);
  const directory = path.join(root, 'output');
  const config = configFor({ output: { directory } });
  await generateCharts(config);
  const before = await readFile(path.join(directory, 'index.html'), 'utf8');
  await assert.rejects(generateCharts(config), /already exists/);
  await assert.rejects(
    generateCharts({
      ...config,
      charts: { serviceDate: 20261110, routeIds: ['missing'] },
      output: { directory, overwrite: true },
    }),
    /Unknown route/,
  );
  assert.equal(
    await readFile(path.join(directory, 'index.html'), 'utf8'),
    before,
  );
  assert.deepEqual((await readdir(root)).sort(), ['output']);
  await assert.rejects(
    generateCharts(configFor({ output: { directory: root, overwrite: true } })),
    /not generated/,
  );
  const result = await generateCharts({
    ...config,
    charts: { serviceDate: 20261111 },
    output: { directory, overwrite: true },
  });
  assert.equal(result.sources[0].charts, 0);
  assert.deepEqual(result.sources[0].skippedRouteIds, ['r']);
  const overview = await readFile(
    path.join(result.sources[0].directory, 'index.html'),
    'utf8',
  );
  assert.equal(overview.includes('routes/'), false);
});

test('route names cannot collide and embedded feed text cannot close script elements', async (t) => {
  const root = await temp(t);
  const input = path.join(root, 'feed');
  await cp(feed, input, { recursive: true });
  const payload = '</script><script>alert(1)</script>';
  await writeFile(
    path.join(input, 'stops.txt'),
    (await readFile(path.join(input, 'stops.txt'), 'utf8')).replace(
      'First',
      payload,
    ),
  );
  await writeFile(
    path.join(input, 'routes.txt'),
    (await readFile(path.join(input, 'routes.txt'), 'utf8')) +
      'second,a,10,Same Name,3\n',
  );
  await writeFile(
    path.join(input, 'trips.txt'),
    (await readFile(path.join(input, 'trips.txt'), 'utf8')).replace(
      'r,weekday,back',
      'second,weekday,back',
    ),
  );
  const result = await generateCharts(
    configFor({
      sources: [{ sourceId: 'fixture', schedule: { path: input } }],
      output: { directory: path.join(root, 'output') },
    }),
  );
  const files = await readdir(path.join(result.sources[0].directory, 'routes'));
  assert.equal(files.length, 2);
  const html = await readFile(
    path.join(result.sources[0].directory, 'routes', files[0]),
    'utf8',
  );
  assert.equal(html.includes(payload), false);
  assert.ok(html.includes('\\u003c/script>'));
});

test('failed import closes database and generation reports structured events only when requested', async (t) => {
  const root = await temp(t);
  const database = { path: path.join(root, 'gtfs.sqlite') };
  const output = { directory: path.join(root, 'output') };
  await assert.rejects(
    generateCharts(
      configFor({
        database,
        output,
        sources: [{ schedule: { path: path.join(root, 'missing.zip') } }],
      }),
    ),
  );
  const events = [];
  const config = configFor({
    database,
    output,
    reporting: { reporter: (event) => events.push(event) },
  });
  await generateCharts(config);
  assert.ok(
    events.some(
      (event) =>
        event.type === 'status' && event.message.includes('Charts written'),
    ),
  );
  events.length = 0;
  await generateCharts(
    {
      ...config,
      output: { ...output, overwrite: true },
      reporting: { level: 'silent', reporter: (event) => events.push(event) },
    },
    { import: false },
  );
  assert.equal(events.length, 0);
});

test('generation protects input storage and rejects default in-memory reuse', async (t) => {
  const root = await temp(t);
  const directory = path.join(root, 'output');
  await assert.rejects(
    generateCharts(
      configFor({
        database: { path: path.join(directory, 'gtfs.sqlite') },
        output: { directory },
      }),
    ),
    /must not contain the database/,
  );
  await assert.rejects(
    generateCharts(configFor({ database: {}, output: { directory } }), {
      import: false,
    }),
    /persistent database/,
  );
  assert.deepEqual(await readdir(root), []);
});

test('zero shape distances stay finite in both directions', async (t) => {
  const root = await temp(t);
  await cp(feed, root, { recursive: true });
  const lines = (await readFile(path.join(root, 'stop_times.txt'), 'utf8'))
    .trim()
    .split('\n');
  await writeFile(
    path.join(root, 'stop_times.txt'),
    `${lines.map((line, index) => `${line},${index === 0 ? 'shape_dist_traveled' : '0'}`).join('\n')}\n`,
  );
  await withFeed(
    configFor({ sources: [{ sourceId: 'fixture', schedule: { path: root } }] }),
    async (gtfs, charts) => {
      const data = await getChartData(gtfs, 'fixture', charts, 'r');
      assert.ok(data.stations.every((station) => station.distance === 0));
    },
  );
});

test('missing and malformed database settings report configuration errors before path checks', async (t) => {
  const root = await temp(t);
  const { database: _database, ...config } = configFor({
    output: { directory: path.join(root, 'output') },
  });
  for (const options of [{}, { import: false }]) {
    await assert.rejects(
      generateCharts(config, options),
      /database is required; set database.path/,
    );
  }
  for (const database of [null, 'gtfs.sqlite', [], { path: 123 }]) {
    await assert.rejects(
      generateCharts({ ...config, database }),
      /database.*must be/,
    );
  }
  const filename = path.join(root, 'config.json');
  await writeFile(filename, JSON.stringify(config));
  const result = spawnSync(process.execPath, [bin, '--config', filename], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /database is required; set database.path/);
  assert.doesNotMatch(result.stderr, /Cannot use 'in' operator/);
  assert.equal(result.stdout, '');
});

test('malformed source settings fail before output path inspection', async () => {
  for (const source of [
    null,
    { url: 'https://example.com/gtfs.zip' },
    { schedule: 'feed.zip' },
    { schedule: { path: 123 } },
  ]) {
    await assert.rejects(
      generateCharts(configFor({ sources: [source] })),
      /sources\[0\]/,
    );
  }
});
