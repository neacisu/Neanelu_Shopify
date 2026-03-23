# Sonar Manual Inventory Worker

This worker is the persistence and orchestration layer for manual Sonar per-file scanning of `.ts` and `.tsx` files.

It is designed for the workflow where Sonar analysis is triggered one file at a time, while results must survive IDE refreshes and closed editors.

## What it does

- Discovers all eligible `.ts` and `.tsx` files under `apps`, `packages`, `scripts`, `tests`, plus `oauth-callback-server.ts`
- Stores a persistent JSON inventory in `temp/sonar-manual-inventory.json`
- Uses per-file leases to avoid double-processing or losing progress
- Tracks attempts, status, issue payloads, file fingerprint, and a bounded audit history
- Tracks a fingerprint of the local analyzer/configuration and invalidates stale local findings when that fingerprint changes
- Exports aggregated findings to `temp/sonar-manual-findings.json`
- Provides a companion runner that can automate `claim -> analyze -> capture -> complete` when given an analyzer command that writes issue JSON per file
- Provides a persistent per-file analyzer for TypeScript diagnostics, ESLint findings, and secret-pattern findings
- Supports importing persistent findings from normalized JSON, VS Code diagnostics JSON, SARIF, and Sonar external issues JSON
- Publishes a JSON Schema for exports in `scripts/sonar/findings.schema.json`
- Publishes unified findings back into VS Code Problems through `.vscode/tasks.json`

## What it does not do

It does not call the VS Code Sonar extension by itself. The Sonar analysis trigger still happens externally, one file at a time.

The worker is responsible for queueing, checkpointing, retry, and JSON persistence.

## Lifecycle

1. Initialize the inventory.
2. Claim the next file.
3. Run Sonar analysis for that file.
4. Capture diagnostics and normalize them as JSON.
5. Complete, fail, or skip the file.
6. Export findings whenever needed.

## Commands

```bash
pnpm sonar:inventory:init
pnpm sonar:inventory:refresh
pnpm sonar:inventory:claim -- --worker worker-a
pnpm sonar:inventory:release -- --worker worker-a --file apps/example.ts --token <lease-token>
pnpm sonar:inventory:complete -- --worker worker-a --file apps/example.ts --token <lease-token> --issues-file temp/issues.json
pnpm sonar:inventory:fail -- --worker worker-a --file apps/example.ts --token <lease-token> --error "analysis failed"
pnpm sonar:inventory:skip -- --worker worker-a --file apps/example.ts --token <lease-token> --detail "not applicable"
pnpm sonar:inventory:retry-stale
pnpm sonar:inventory:summary
pnpm sonar:inventory:record -- --file apps/example.ts --issues-file temp/issues.json
pnpm sonar:inventory:import -- --input temp/findings.sarif --format sarif --source sonar
pnpm sonar:inventory:export
pnpm sonar:inventory:doctor
pnpm sonar:analyzer -- --file apps/backend-worker/src/main.ts --issues temp/issues.json
pnpm sonar:publish-problems
pnpm sonar:rescan-watch
pnpm sonar:runner:run -- --worker runner-a --max-files 10 --analyzer-command "node scripts/sonar/my-analyzer.js --file {file} --issues {issuesFile}"
pnpm sonar:runner:run-one -- --worker runner-a --analyzer-command "node scripts/sonar/my-analyzer.js --file {file} --issues {issuesFile}"
```

## Companion runner

The companion runner lives in `scripts/sonar/manual-inventory-runner.ts`.

It claims work from the inventory, executes an analyzer command, reads JSON issues for the current file, then completes, skips, or fails the file in inventory.

Supported placeholders inside `--analyzer-command`:

- `{file}` absolute file path
- `{relativeFile}` workspace-relative file path
- `{issuesFile}` writable JSON output path
- `{workspaceRoot}` workspace root
- `{inventoryFile}` absolute path to inventory JSON

Example:

```bash
pnpm sonar:runner:run -- \
  --worker runner-a \
  --max-files 25 \
  --analyzer-command "node scripts/sonar/my-analyzer.js --file {file} --issues {issuesFile}"
```

If no analyzer command is provided, the runner marks the file as skipped. This is intentional so the queue logic remains deterministic.

## Persistent analyzer

The built-in persistent analyzer lives in `scripts/sonar/persistent-findings-analyzer.ts`.

It produces normalized JSON findings per file from these persistent local engines:

- TypeScript compiler diagnostics through `tsconfig.eslint.json`
- ESLint using the workspace flat config
- secret-pattern scanning for hardcoded credential indicators

Example:

```bash
pnpm sonar:analyzer -- \
  --file apps/backend-worker/src/auth/__tests__/integration.test.ts \
  --issues temp/issues.json
```

## Incremental rescan watcher

The incremental watcher lives in `scripts/sonar/incremental-rescan-watch.mjs`.

It polls the inventory-discovered files for modification time changes, reruns the persistent analyzer only for touched files, records the new findings back into the inventory with `record-findings`, and then regenerates `temp/sonar-manual-findings.json`.

On startup it also fingerprints the local analyzer inputs (`persistent-findings-analyzer.ts`, ESLint config, workspace TypeScript configs, and markdownlint config). If that fingerprint differs from the one stored in inventory, the watcher invalidates stale local findings, exports a clean findings file immediately, and enqueues all inventory files for reanalysis.

Because the Problems publisher also runs in watch mode, resolved findings disappear automatically from VS Code Problems after save and reanalysis.

Run it through the background task `diagnostics:watch-sonar-incremental-rescan`, or manually:

```bash
pnpm sonar:rescan-watch
```

## Persistent import

Use the inventory import command when you already have a persistent Sonar-like source available.

Supported formats:

- `normalized`
- `vscode-diagnostics`
- `sarif`
- `sonar-external-issues`

Example imports:

```bash
pnpm sonar:inventory:import -- \
  --input temp/sonar-results.sarif \
  --format sarif \
  --source sonar
```

```bash
pnpm sonar:inventory:import -- \
  --input temp/sonar-external-issues.json \
  --format sonar-external-issues \
  --source sonar
```

Each import merges into the single inventory JSON and replaces prior findings from the same source.

## Problems publisher

Run `diagnostics:publish-sonar-manual-findings` from VS Code Tasks, or execute `pnpm sonar:publish-problems`.

The publisher reads `temp/sonar-manual-findings.json` and replays each finding in GCC-style output so that VS Code's Problems panel can ingest it through the `$gcc` problem matcher.

This is how the persistent JSON becomes visible again inside Problems.

For live cleanup after file saves, run `diagnostics:watch-sonar-manual-findings` together with `diagnostics:watch-sonar-incremental-rescan`.

For long full-inventory runs, you can also run `pnpm sonar:export-progress-watch`. That watcher monitors `temp/sonar-manual-inventory.json` and regenerates `temp/sonar-manual-findings.json` whenever the analyzed/failed/issue totals advance, so the Problems panel updates incrementally instead of waiting for the end of a 1K+ file scan.

## Export schema

The final export produced by `pnpm sonar:inventory:export` follows `scripts/sonar/findings.schema.json`.

That schema is intended for:

- BI ingestion
- dashboard pipelines
- CI artifacts
- downstream reporting and analytics

## Inventory model

Each file entry contains:

- Stable `id`
- Relative `path`
- `status`: `pending`, `in_progress`, `analyzed`, `skipped`, `failed`
- `attempts`
- `lease` with `workerId`, `token`, `claimedAt`, `expiresAt`
- `issues` array
- `error`
- `fingerprint` using file size and modification timestamp
- bounded `history`

## Recommended operating pattern

Claim:

```bash
pnpm -s sonar:inventory:claim -- --worker manual-01
```

Complete with captured issues:

```bash
pnpm -s sonar:inventory:complete -- \
  --worker manual-01 \
  --file apps/web-admin/app/example.tsx \
  --token <lease-token> \
  --issues-file temp/issues.json
```

Export final findings:

```bash
pnpm sonar:inventory:export
```

## Failure recovery

- If a worker crashes, run `pnpm sonar:inventory:retry-stale`
- If files changed on disk, run `pnpm sonar:inventory:refresh`
- If inventory integrity is in doubt, run `pnpm sonar:inventory:doctor`
