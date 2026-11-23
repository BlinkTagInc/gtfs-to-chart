import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../..', import.meta.url));

test('packed package includes runtime assets, types, license, and a working CLI/API', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'chart-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pack = spawnSync(
    'npm',
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      root,
      '--cache',
      path.join(root, 'cache'),
    ],
    { cwd: project, encoding: 'utf8' },
  );
  assert.equal(pack.status, 0, pack.stderr);
  const packed = JSON.parse(pack.stdout);
  const metadata = Array.isArray(packed) ? packed[0] : packed['gtfs-to-chart'];
  const names = metadata.files.map((file) => file.path);
  for (const expected of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/bin/gtfs-to-chart.js',
    'assets/js/chart.js',
    'assets/css/chart.css',
    'templates/chart-page.pug',
    'templates/overview-page.pug',
    'LICENSE.txt',
    'config-sample.json',
  ]) {
    assert.ok(names.includes(expected), `Missing ${expected}`);
  }
  assert.ok(!names.some((name) => /^(src|test|lib|app)\//.test(name)));
  assert.ok(!names.includes('config.json'));
  await writeFile(path.join(root, 'package.json'), '{"private":true}');
  const install = spawnSync(
    'npm',
    [
      'install',
      '--engine-strict',
      '--no-audit',
      '--no-fund',
      metadata.filename,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(install.status, 0, install.stderr);
  const config = {
    database: { path: ':memory:' },
    sources: [{ schedule: { path: path.join(project, 'test/fixtures/feed') } }],
    charts: { serviceDate: 20261110 },
    output: { directory: path.join(root, 'output') },
  };
  await writeFile(
    path.join(root, 'run.mjs'),
    `import { generateCharts } from 'gtfs-to-chart';\nconst result = await generateCharts(${JSON.stringify(config)});\nconsole.log(JSON.stringify(result));\n`,
  );
  const run = spawnSync(process.execPath, ['run.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.sources[0].charts, 1);
  const routes = await readdir(
    path.join(result.sources[0].directory, 'routes'),
  );
  const html = await readFile(
    path.join(result.sources[0].directory, 'routes', routes[0]),
    'utf8',
  );
  assert.ok(html.includes('const chartData = '));
  assert.ok(html.includes('../../css/chart.css'));
  const cli = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/.bin/gtfs-to-chart'), '--version'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), metadata.version);
  const output = path.join(root, 'cli-output');
  await writeFile(path.join(root, 'config.json'), JSON.stringify(config));
  const generate = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/.bin/gtfs-to-chart'),
      '--output',
      output,
      '--quiet',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(generate.status, 0, generate.stderr);
  assert.ok(await readFile(path.join(output, 'index.html'), 'utf8'));
});
