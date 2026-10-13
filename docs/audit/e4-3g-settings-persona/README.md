# E4-3G settings / persona evidence

Same fixture (`/tmp/e43g-data`, isolated SQLite, stubbed save endpoints where noted) for all three builds.

- BEFORE: main `59fb6ddcef30966588281220509a593d8ef6ff94` (port 3701)
- A: `7b21b5a24c9d57e12f24183bcc62c1655472f391` (port 3702)
- B: `df722db90d8e0e37db24dad1364de7876ff327e7` (port 3703)

`compare/NN-*.webp` is BEFORE | A | B left to right. `raw/{before,a,b}/{settings,persona}` are the individual captures with `data.json` measurements.
`raw/*/persona-secretoff` are captured with `PERSONA_SECRET_BOUNDARY_ENABLED=0`.
Provider POSTs: 0 in every run. No production data; fixture secret marker never appears in any public `/api/personas` response.
