# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/). The report, matrix, model
and suggestions formats have their own `schemaVersion`, which changes only
when a file written by an older version can no longer be read.

## [Unreleased]

Nothing has been published to npm yet. The first preview will be
`0.1.0-alpha.1` on the `next` tag.

### Added

- Models with finite parameter domains and constraints built from `eq`,
  `not`, `and`, `or` and `implies`, validated with a JSON Pointer for every
  problem. Duplicate JSON keys are rejected.
- Matrices of existing test cases, rejected rather than trimmed when a row
  is incomplete, has unknown parameters or breaks a constraint.
- Exact pairwise and three-way coverage over globally valid interactions,
  with per-group counts, every missing interaction, and a coverage profile
  from single values up to the model strength.
- Deterministic greedy recommendations to supplement a matrix, with a case
  budget, a work budget and stop reasons; from declared coverage or from
  what a test run observed or passed, including `rerun-existing` advice.
- Versioned static and runtime reports whose counts are recomputed when
  read back, so edited reports are rejected.
- Command line: `analyze`, `check`, `suggest` and `report`, with documented
  exit codes, atomic writes that never replace inputs, and offline HTML
  pages.
- Vitest integration: `createMatrixSuite` from `nwise-kit/vitest` and
  `NwiseKitReporter` from `nwise-kit/reporter`, measuring observed and
  passed coverage per run with retries, skips, filters and crashes handled.
  Supports Vitest 5.1.
- JSON Schemas for models, matrices, reports and suggestions.
