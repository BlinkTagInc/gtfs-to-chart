#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createConsoleReporter } from 'gtfs';
import { generateCharts } from '../generate.ts';
import { resolvePath } from '../config/config.ts';
import { version } from '../output/render.ts';
import { serve } from '../server/serve.ts';
import type { ChartConfig } from '../types.ts';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      'skip-import': { type: 'boolean' },
      'service-date': { type: 'string' },
      output: { type: 'string' },
      overwrite: { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      port: { type: 'string' },
    },
  });
  const command = positionals[0] ?? 'generate';
  if (positionals.length > 1 || !['generate', 'serve'].includes(command)) {
    throw new Error('Unknown command; run gtfs-to-chart --help');
  }
  if (values.version) {
    console.log(version);
  } else if (values.help) {
    console.log(
      `GTFS-to-Chart ${version}\n\nUsage: gtfs-to-chart [generate|serve] [options]\n\nCommands:\n  generate  Import GTFS and generate HTML charts (default)\n  serve     Preview existing output at http://127.0.0.1:3000\n\nOptions:\n  -c, --config <path>        JSON configuration (default: config.json)\n      --service-date <date> Service date as YYYYMMDD\n      --output <directory>  Output directory (default: charts)\n      --overwrite           Replace previously generated output\n      --skip-import         Reuse an existing database\n  -q, --quiet               Suppress informational output\n      --port <number>       Preview port (default: 3000)\n  -h, --help                Show help\n  -v, --version             Show version`,
    );
  } else if (command === 'serve') {
    if (
      values['skip-import'] ||
      values['service-date'] ||
      values.overwrite ||
      values.config
    ) {
      throw new Error('serve accepts --output, --port, and --quiet only');
    }
    const port = Number(values.port ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('port must be an integer between 0 and 65535');
    }
    const server = await serve(resolvePath(values.output ?? 'charts'), port);
    const address = server.address();
    if (!values.quiet && address && typeof address !== 'string') {
      console.error(`Preview: http://127.0.0.1:${address.port}`);
    }
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        server.close();
      });
    }
  } else {
    if (values.port !== undefined) {
      throw new Error('--port is only supported by serve');
    }
    const filename = resolvePath(values.config ?? 'config.json');
    let config: ChartConfig;
    try {
      config = JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
      throw new Error(
        `Cannot load JSON configuration ${filename}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await generateCharts(
      {
        ...config,
        charts: {
          ...config.charts,
          ...(values['service-date'] === undefined
            ? {}
            : { serviceDate: Number(values['service-date']) }),
        },
        output: {
          ...config.output,
          ...(values.output === undefined ? {} : { directory: values.output }),
          ...(values.overwrite ? { overwrite: true } : {}),
        },
        reporting: {
          ...config.reporting,
          ...(values.quiet ? { level: 'error' } : {}),
          reporter: createConsoleReporter(),
        },
      },
      { import: !values['skip-import'] },
    );
  }
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
