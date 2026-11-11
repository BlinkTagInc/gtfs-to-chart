import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFile,
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { serve } from '../src/server/serve.ts';

test('browser times and station lookup preserve service day and direction', async () => {
  const script = await readFile(
    new URL('../assets/js/chart.js', import.meta.url),
    'utf8',
  );
  const context = vm.createContext({});
  vm.runInContext(script.replace('renderChart(chartData);', ''), context);
  assert.equal(
    Number(context.parseTime('25:00:00')) -
      Number(context.parseTime('23:00:00')),
    7200000,
  );
  const stops = context.getStopsFromStopTimes(
    [{ stop_id: 's', arrival_time: '25:00:00', departure_time: '25:01:00' }],
    [
      { stop_id: 's', direction_id: 0, distance: 0 },
      { stop_id: 's', direction_id: 1, distance: 20 },
    ],
    1,
  );
  assert.equal(stops[0].station.distance, 20);
  assert.equal(stops.length, 2);
});

test('preview serves assets, redirects directories, and denies outside symlinks', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'chart-server-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'public');
  await mkdir(path.join(directory, 'source'), { recursive: true });
  await writeFile(
    path.join(directory, 'source/index.html'),
    '<h1>Fixture</h1>',
  );
  await writeFile(path.join(directory, 'chart.js'), 'const fixture = true;');
  await writeFile(path.join(root, 'private.txt'), 'private');
  await symlink(
    path.join(root, 'private.txt'),
    path.join(directory, 'outside.txt'),
  );
  const server = await serve(directory, 0);
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const redirect = await fetch(`${base}/source`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/source/');
  assert.equal(
    await (await fetch(`${base}/source/`)).text(),
    '<h1>Fixture</h1>',
  );
  assert.match(
    (await fetch(`${base}/chart.js`)).headers.get('content-type'),
    /javascript/,
  );
  assert.equal((await fetch(`${base}/outside.txt`)).status, 403);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
});
