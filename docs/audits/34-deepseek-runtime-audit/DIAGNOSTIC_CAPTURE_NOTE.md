# Diagnostic capture follow-up

PR #243 harness captures lacked:

- `first_chunk_at` / `inter_chunk_max_gap_ms` / `chunk_count`
- upstream `providerRequestId` / region / generation id (often absent from client `usage` after stripping)

This PR extends `scripts/deepseek-common-root-audit.ts` to persist `turnN-transport.json` and richer `api.*` transport fields on future runs.

Still typically unavailable from the browser-facing `done.usage` path:

- provider region
- raw upstream generation id (unless present as `providerRequestId`)

Do **not** echo these ids into general user responses or production logs beyond existing requestId handling.
