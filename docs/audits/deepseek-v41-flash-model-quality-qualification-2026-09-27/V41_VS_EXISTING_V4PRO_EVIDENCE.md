# V4.1 Flash vs existing generalized-Layered V4 Pro (#1131 context)

No new V4 Pro provider calls. Baseline text from archived **Layered (L) arm** DeepSeek V4 Pro captures on the same PR620 capsule (pre-generalization fix audit branch).

## Baseline pointers (V4 Pro, same capsule, LAYERED wire)

| Snapshot | Baseline raw (n=2 on branch) |
| --- | --- |
| A — domestic / food | `docs/audits/canon-layered-architecture-audit-2026-09-27/raw/SNAPSHOT_A/deepseek-v4-pro-0813/L/r1.txt` (commit `origin/cursor/canon-layered-architecture-audit-cea0`) |
| A | `.../L/r2.txt` |
| B — close contact | `.../SNAPSHOT_B/deepseek-v4-pro-0813/L/r1.txt` |
| B | `.../L/r2.txt` |

PR #1131 body references `live-generalized-layered/` under `canon-selector-core-bugfix-2026-09-27`; that tree was not on the merged PR file list. The L-arm paths above are the same capsule + layered canon assembly used in that audit series.

## Input parity (intended delta = model only)

V4.1 packet: `INPUT_PARITY.json` (system/history/current-user hashes, CORE ids, ACTIVE ids empty for both snapshots on current selector).

## Qualitative comparison (not length-scored)

| Axis | V4 Pro L baseline (excerpt) | V4.1 Flash (this packet) |
| --- | --- | --- |
| Natural Korean / dialogue | Speakable banter; 「누나가 두고 갔나」 is unnatural event leap | No sister-call; stronger colloquial lines (「야, 그건 내 대사인데」) but some translation-like lines (「네 얼굴이 참 바쁘더라고」) |
| Hallucinated facts | **Hard:** stocked fridge → sister dropped food | **Hard:** empty fridge (A/r3); mystery dated pouch (A/r2). No sister phone/yesterday event |
| Character voice | Playful 라이크/태형 consistent | Comparable teasing; occasional ability/ rank exposition (A/r1, B/r3) |
| Psychology | Show + explain loops in Pro samples | B/r1–r2 stay closer to scene-bound beats; B/r3 more physiology + rank label |
| Canon recital | Sister + fridge stock detail | S-grade label, ability trigger narration |
| Scene progression | Food choice moves | A/r3 stalls on empty-fridge gag; B samples honor kiss / eye-contact beat |

## V4.1 raw outputs (this run, n=3 each)

- `raw/SNAPSHOT_A/deepseek-v4.1-flash/r1.txt`
- `raw/SNAPSHOT_A/deepseek-v4.1-flash/r2.txt`
- `raw/SNAPSHOT_A/deepseek-v4.1-flash/r3.txt`
- `raw/SNAPSHOT_B/deepseek-v4.1-flash/r1.txt`
- `raw/SNAPSHOT_B/deepseek-v4.1-flash/r2.txt`
- `raw/SNAPSHOT_B/deepseek-v4.1-flash/r3.txt`

## Per-sample classification (factual categories only)

See `CLASSIFICATION.json`. Cursor does not recommend registry/picker changes.
