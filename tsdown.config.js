import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/gtfs-to-chart.ts'],
  outDir: 'dist',
  clean: true,
  platform: 'node',
  target: 'node22.18',
  format: 'esm',
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  nodeProtocol: true,
  failOnWarn: 'ci-only',
  suppressWarnings: [
    'TypeScript Go is experimental. Some options will be unavailable.',
  ],
});
