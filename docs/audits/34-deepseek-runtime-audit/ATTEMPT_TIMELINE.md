# Attempt timeline — PR #243 confirmation (10 attempts)

Source: `33-dense-internal-confirm`. Prompt change: **NONE**.

Timing note: harness did not record per-chunk timestamps. `request_duration_ms` = client-observed latency; `last_chunk_at` ≈ provider-raw file mtime (UTC).

| id | when (end≈) | chat | turn | repl | chars | finish | provider | latency_s | role | trunc class |
|---|---|---|---|---|---|---|---|---|---|---|
| A01 | 2026-08-05T14:14:40.186607+00:00 | 646 | 1 | 0 | 1610 | 'stop' | cheaperinference | 47.901 | valid_screen | — |
| A02 | 2026-08-05T14:15:46.058784+00:00 | 646 | 2 | 0 | 2802 | 'stop' | cheaperinference | 65.69 | valid_screen | — |
| A03 | 2026-08-05T14:17:25.803046+00:00 | 647 | 1 | 0 | 3333 | 'stop' | cheaperinference | 96.564 | valid_screen | — |
| A04 | 2026-08-05T14:19:26.603359+00:00 | 647 | 2 | 0 | 6017 | 'stop' | cheaperinference | 120.619 | valid_screen | — |
| A05 | 2026-08-05T14:20:57.263590+00:00 | 648 | 1 | 0 | 3189 | 'stop' | cheaperinference | 87.416 | valid_then_chat_replaced | — |
| A06 | 2026-08-05T14:21:45.767712+00:00 | 648 | 2 | 0 | 1347 | None | cheaperinference | 48.325 | truncation | UPSTREAM_PROVIDER_STREAM_TRUNCATED |
| A07 | 2026-08-05T14:24:24.480109+00:00 | 649 | 1 | 1 | 2728 | 'stop' | cheaperinference | 120.3 | replaced_chat_turn1 | — |
| A08 | 2026-08-05T14:24:39.176146+00:00 | 649 | 2 | 1 | 99 | None | None | 14.496 | truncation | UPSTREAM_PROVIDER_STREAM_TRUNCATED |
| A09 | 2026-08-05T14:26:18.488391+00:00 | 650 | 1 | 2 | 3420 | 'stop' | cheaperinference | 79.446 | valid_replacement | — |
| A10 | 2026-08-05T14:27:33.932576+00:00 | 650 | 2 | 2 | 2585 | 'stop' | cheaperinference | 75.269 | valid_replacement | — |

## Sequence

1. **Original screen (A01–A06)** — chats 646–648, started ~2026-08-05T14:13:52Z
2. **A06 truncation** ends chat 648 Turn2 → runtime excluded
3. **Replacement round 1 (A07–A08)** — chat 649; A08 truncates at 99 chars → excluded
4. **Replacement round 2 (A09–A10)** — chat 650; both stop → enters valid n=6 as confirm run3

Valid screen set (quality gates): A01, A02, A03, A04, A09, A10.
Failed retained (not deleted): A06, A08 (+ A05/A07 turn1s of failed chats kept under `runtime_excluded/`).
