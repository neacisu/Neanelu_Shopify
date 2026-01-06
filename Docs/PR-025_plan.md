# PR-025 (F4.5 Queue UI) – Implementation Plan

## Scope (F4.5.1–F4.5.8)

Queue Monitor UI at `/app/queues` for:

- Queue overview + realtime refresh
- Charts (throughput + outcomes)
- Jobs list (filters/search/pagination/bulk actions)
- Workers status
- Job detail view (large payload safe)
- Realtime updates (SSE)

## Source of truth

This PR plan is the acceptance criteria for PR-025.

It is aligned to the higher-level tasks in `Plan_de_implementare.md` (F4.5.1–F4.5.8) but is written in an implementable, testable form for this repository.

## Gaps to reach “100% complete” (as of now)

These items are required to claim PR-025 is complete end-to-end:

- Destructive actions require confirmation
  - Single-job delete must require an explicit confirmation step.
  - Bulk delete must require an explicit confirmation step with the selected count.

- Metrics UI must include status distribution
  - In addition to the existing line charts, add a status distribution chart (Waiting/Active/Delayed/Failed/Completed) for the selected queue.
  - The distribution should come from the current queue snapshot (the same data used for the overview table), not from the time-series metrics endpoint.

- Workers UX must be stable without manual refresh
  - When the Workers tab is active, auto-refresh workers at a small interval (5s) and also refresh on `worker.*` SSE events.
  - Worker status labels should be human friendly (“Online”/“Offline”).

- Job detail view must cover debugging basics safely
  - Add a simple “Timeline” section derived from job timestamps/attempts.
  - Keep payload rendering safe for huge JSON (truncate + copy).
  - If logs are not available from backend, show an explicit “No logs available” placeholder (do not silently omit).

## Current State (as implemented on `pr/F4.5-queue-ui`)

### Backend (`apps/backend-worker`)

- Admin endpoints under `/api/queues/*`:

  - `GET /api/queues`
  - `GET /api/queues/:name/metrics`
  - `GET /api/queues/:name/jobs` (+ `payloadPreview`, `status`)
  - `GET /api/queues/:name/jobs/:id`
  - Job actions: retry/promote/delete + batch actions
  - Workers: `GET /api/queues/workers`
  - Realtime: `GET /api/queues/stream` (SSE)
- SSE emits:
  - `queues.snapshot`
  - `job.started`, `job.completed`, `job.failed`
  - `worker.online`, `worker.offline`

### Frontend (`apps/web-admin`)

- Queue stream hook: `app/hooks/use-queue-stream.ts` (fetch-based SSE + backoff)
- Deps installed:
  - `recharts` (charts)
  - `react-window` (virtualization)
- Route implementation:
  - `app/routes/queues.tsx` now implements tabs (Overview/Jobs/Workers) wired to backend.

### Routing consistency

- `/api` prefix is forwarded as-is (dev proxy + Traefik config updated earlier), so the UI can call `/api/queues/*` directly.

## Work Plan

### 1) UI Structure (F4.5.1/F4.5.2/F4.5.3)

- Build `/app/queues` page with:
  - Queue selector
  - Tabs: Overview / Jobs / Workers
  - Summary table of all queues

### 2) Charts (F4.5.1)

- Use `GET /api/queues/:name/metrics` to render:
  - Throughput line chart
  - Completed/Failed delta chart

- Also render a status distribution chart for the selected queue using the current queue snapshot counts:
  - Waiting / Active / Delayed / Failed / Completed

### 3) Jobs Table + Actions (F4.5.2/F4.5.6)

- Use `GET /api/queues/:name/jobs` for server-side paging and filtering.
- Provide bulk actions with `POST /api/queues/jobs/batch` (max 100).
- Virtualize long lists with `react-window`.

- Destructive actions must require confirmation:
  - Single delete confirmation (“This action is irreversible”)
  - Bulk delete confirmation (“Delete X jobs? This action is irreversible”)

### 4) Workers (F4.5.7)

- Use `GET /api/queues/workers` to render a grid of worker cards.
- Refresh on demand + via `worker.*` events.
- When Workers tab is active, also auto-refresh every 5 seconds.

### 5) Job Detail Modal (F4.5.8)

- Use `GET /api/queues/:name/jobs/:id`.
- Render payload safely (truncate to avoid huge JSON rendering), provide copy actions.

- Add a Timeline section:
  - Created/Processed/Finished timestamps (when available)
  - Attempts made / max attempts (when available)

- Logs:
  - If backend does not provide logs, show “No logs available”.

### 6) Realtime (F4.5.5)

- Subscribe to `/api/queues/stream` via `useQueueStream`.
- Apply updates:
  - `queues.snapshot` updates the overview table
  - `job.*` triggers a debounced jobs refresh when viewing Jobs tab
  - `worker.*` triggers a workers refresh when viewing Workers tab

### 7) Validation

- Run `pnpm -w run ci`.
- Manual dev check:
  - Start stack and open `/app/queues`
  - Verify live badge and SSE reconnect behavior
  - Verify job actions and batch limits
  - Verify delete confirmation flows
  - Verify status distribution chart updates when selecting a queue
  - Verify Workers tab auto-refresh (5s) while active
  - Verify Job detail timeline renders and payload copy works

## Definition of Done (100% completion)

- `pnpm -w run ci` is green.
- Unit/UI tests cover:
  - Delete confirmation gating (single + bulk)
  - Status distribution chart renders for selected queue
  - Workers tab auto-refresh behavior (interval) while active
  - Job detail timeline section renders for a job
- Manual check in dev:
  - No console errors in `/app/queues`.
  - SSE reconnect works (toggle backend container / refresh network).

## Notes / Constraints

- React Router is configured with basename `/app`, so routes should be written without hardcoding `/app`.
- SSE is consumed via `fetch` streaming (not `EventSource`) to support `Authorization` headers when needed.
