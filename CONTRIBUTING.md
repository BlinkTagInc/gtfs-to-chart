# Contributing

Use Node.js 22.18+, 24, or 26 and the pnpm version in `package.json`.

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

Use `pnpm build-watch` while developing. TypeScript lives in `src/`; `dist/` is generated. Pug templates live in `templates/`, and browser JavaScript and CSS live in `assets/`. All JavaScript and TypeScript control-flow bodies require braces.

Tests use a small local GTFS fixture and temporary output directories. When reporting a feed-specific problem, include a public link to the GTFS ZIP, the service date, and the affected route IDs.

Before releasing, also run:

```sh
CI=true FORCE_COLOR=1 pnpm test
pnpm test:release
pnpm exec publint
```

`test:release` packs the package and generates charts using only its published files. CI runs on Node.js 22, 24, and 26. Local checks do not replace reviewing that matrix.

Releases use release-it on `main`, including changelog updates, validation, npm publication, and a GitHub release. Commit the intended changes before invoking release-it. For subsequent beta releases:

```sh
pnpm exec release-it --preRelease=beta --npm.tag=beta
```

To promote the current beta major version to stable:

```sh
pnpm exec release-it --npm.tag=latest
```
