import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

for (const directory of ['lib', 'app', 'bin', 'scripts', 'test']) {
  for (const file of readdirSync(directory).filter((name) =>
    name.endsWith('.js'),
  )) {
    const result = spawnSync(
      process.execPath,
      ['--check', `${directory}/${file}`],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}
