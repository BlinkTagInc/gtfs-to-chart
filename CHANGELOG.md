# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Prepare v3 around node-GTFS v5 configuration, structured reporting, and a named `generateCharts` API with typed results.
- Group chart settings under `charts` and file output settings under `output`; reject legacy options.
- Replace the live Express app with the `serve` command for generated output.
- Build TypeScript from `src` into published ESM and declarations in `dist`; move templates and assets into dedicated directories and rename the license to `LICENSE.txt`.
- Replace automatic destructive exports with staged output and explicit overwrite of generated directories.
- Remove legacy utility, logging, CLI, and server dependencies.

### Fixed

- Preserve service-day hours above 24 and first-stop dwell when expanding frequencies.
- Match browser station positions by direction as well as stop ID.
- Avoid collisions between route filenames and source directories.
- Escape feed data embedded in HTML script elements.
- Honor timepoint filtering, report fallback distances, and avoid division by zero for colocated stops.
- Exclude routes without service from indexes and reject generation failures instead of reporting false success.

## [2.2.0] - 2026-11-10

### Updated

- Upgraded to node-gtfs v5
- Dependency updates

## [2.1.1] - 2026-01-21

### Updated

- Dependency updates

### Changed

- Update demo app logging

## [2.1.0] - 2025-06-06

### Added

- Support for frequencies.txt

## [2.0.12] - 2025-02-25

### Updated

- Dependency updates

## [2.0.11] - 2024-12-05

### Updated

- Dependency updates

## [2.0.10] - 2024-11-18

### Updated

- Dependency updates

## [2.0.9] - 2024-10-22

### Updated

- Dependency updates

## [2.0.8] - 2024-07-23

### Updated

- Dependency updates

## [2.0.7] - 2023-07-18

### Changed

- Use lint-staged instead of pretty-quick

### Updated

- Dependency updates

## [2.0.6] - 2023-05-04

### Updated

- Dependency updates

## [2.0.5] - 2022-12-31

### Updated

- Update to node-gtfs v4
- Dependency updates
- Add Husky

## [2.0.4] - 2022-11-09

### Updated

- Dependency updates

### Fixed

- Fixed charts path in generated charts HTML

## [2.0.3] - 2022-06-25

### Updated

- Dependency updates

### Fixed

- Fixed charts path in generated index.html

## [2.0.2] - 2022-06-25

### Updated

- Dependency updates
- Readme udpates

## [2.0.1] - 2021-08-17

### Updated

- Dependency updates

### Fixed

- Fixes for no shape_dist_traveled

## [2.0.0] - 2021-05-14

### Breaking Changes

- Converted to ES6 Module
