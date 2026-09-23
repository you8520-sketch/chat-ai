# Qwen3.8-Max RP A/B data index

Quality scoring, gates, and candidate verdicts are intentionally omitted.
Use the files below. Do not treat this extract as a PASS/FAIL.

HEAD SHA: `11d15bb451a3c9cd8ed122fcb8fe1c67cb288c8c`
model: `qwen-3-8-max`
endpoint: `https://api.cheaperinference.com/v1/chat/completions`

## Left for scorer

- F. QWEN_COMMON_PROMPT_SIGNAL
- G. QWEN38 verdict
- H. GLM vs Qwen (only if scorer marks DIRECT_COMPARE_CANDIDATE; GLM side = first-experiment COMMON_PROSE_OUTPUT, not the failed stability adapter)
- K. final candidate

## Repo paths

- `docs/audits/qwen-38-max-rp-ab/00-meta.json`
- `docs/audits/qwen-38-max-rp-ab/01-transport-probe.json`
- `docs/audits/qwen-38-max-rp-ab/02-assembled-diff-audit.json`
- `docs/audits/qwen-38-max-rp-ab/03-call-metrics.json`
- `docs/audits/qwen-38-max-rp-ab/DATA_INDEX.json`
- `docs/audits/qwen-38-max-rp-ab/DATA_INDEX.md`
- `docs/audits/qwen-38-max-rp-ab/SCORER_MAP.md`
- `docs/audits/qwen-38-max-rp-ab/assembled/S1-A-last-user.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S1-A-request.json`
- `docs/audits/qwen-38-max-rp-ab/assembled/S1-A-system.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S1-B-last-user.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S1-B-request.json`
- `docs/audits/qwen-38-max-rp-ab/assembled/S1-B-system.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S2-A-last-user.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S2-A-request.json`
- `docs/audits/qwen-38-max-rp-ab/assembled/S2-A-system.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S2-B-last-user.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S2-B-request.json`
- `docs/audits/qwen-38-max-rp-ab/assembled/S2-B-system.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S3-A-last-user.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S3-A-request.json`
- `docs/audits/qwen-38-max-rp-ab/assembled/S3-A-system.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S3-B-last-user.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S3-B-request.json`
- `docs/audits/qwen-38-max-rp-ab/assembled/S3-B-system.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S4-A-last-user.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S4-A-request.json`
- `docs/audits/qwen-38-max-rp-ab/assembled/S4-A-system.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S4-B-last-user.txt`
- `docs/audits/qwen-38-max-rp-ab/assembled/S4-B-request.json`
- `docs/audits/qwen-38-max-rp-ab/assembled/S4-B-system.txt`
- `docs/audits/qwen-38-max-rp-ab/blind/BLIND_KEY.json`
- `docs/audits/qwen-38-max-rp-ab/blind/REVIEW_RUBRIC.md`
- `docs/audits/qwen-38-max-rp-ab/blind/S1-X.txt`
- `docs/audits/qwen-38-max-rp-ab/blind/S1-Y.txt`
- `docs/audits/qwen-38-max-rp-ab/blind/S2-X.txt`
- `docs/audits/qwen-38-max-rp-ab/blind/S2-Y.txt`
- `docs/audits/qwen-38-max-rp-ab/blind/S3-X.txt`
- `docs/audits/qwen-38-max-rp-ab/blind/S3-Y.txt`
- `docs/audits/qwen-38-max-rp-ab/blind/S4-X.txt`
- `docs/audits/qwen-38-max-rp-ab/blind/S4-Y.txt`
- `docs/audits/qwen-38-max-rp-ab/calls/S1-A.json`
- `docs/audits/qwen-38-max-rp-ab/calls/S1-B.json`
- `docs/audits/qwen-38-max-rp-ab/calls/S2-A.json`
- `docs/audits/qwen-38-max-rp-ab/calls/S2-B.json`
- `docs/audits/qwen-38-max-rp-ab/calls/S3-A.json`
- `docs/audits/qwen-38-max-rp-ab/calls/S3-B.json`
- `docs/audits/qwen-38-max-rp-ab/calls/S4-A.json`
- `docs/audits/qwen-38-max-rp-ab/calls/S4-B.json`
- `docs/audits/qwen-38-max-rp-ab/catalog-qwen-38-max.json`
- `docs/audits/qwen-38-max-rp-ab/raw/S1-A.reasoning.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S1-A.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S1-B.reasoning.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S1-B.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S2-A.reasoning.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S2-A.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S2-B.reasoning.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S2-B.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S3-A.reasoning.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S3-A.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S3-B.reasoning.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S3-B.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S4-A.reasoning.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S4-A.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S4-B.reasoning.txt`
- `docs/audits/qwen-38-max-rp-ab/raw/S4-B.txt`

## Artifact paths

- `/opt/cursor/artifacts/qwen-38-max-rp-ab/00-meta.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/01-transport-probe.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/02-assembled-diff-audit.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/03-call-metrics.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/DATA_INDEX.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/DATA_INDEX.md`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/SCORER_MAP.md`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S1-A-last-user.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S1-A-request.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S1-A-system.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S1-B-last-user.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S1-B-request.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S1-B-system.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S2-A-last-user.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S2-A-request.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S2-A-system.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S2-B-last-user.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S2-B-request.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S2-B-system.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S3-A-last-user.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S3-A-request.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S3-A-system.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S3-B-last-user.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S3-B-request.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S3-B-system.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S4-A-last-user.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S4-A-request.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S4-A-system.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S4-B-last-user.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S4-B-request.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/assembled/S4-B-system.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/BLIND_KEY.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/REVIEW_RUBRIC.md`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/S1-X.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/S1-Y.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/S2-X.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/S2-Y.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/S3-X.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/S3-Y.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/S4-X.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/blind/S4-Y.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/calls/S1-A.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/calls/S1-B.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/calls/S2-A.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/calls/S2-B.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/calls/S3-A.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/calls/S3-B.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/calls/S4-A.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/calls/S4-B.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/catalog-qwen-38-max.json`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S1-A.reasoning.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S1-A.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S1-B.reasoning.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S1-B.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S2-A.reasoning.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S2-A.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S2-B.reasoning.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S2-B.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S3-A.reasoning.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S3-A.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S3-B.reasoning.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S3-B.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S4-A.reasoning.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S4-A.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S4-B.reasoning.txt`
- `/opt/cursor/artifacts/qwen-38-max-rp-ab/raw/S4-B.txt`

## Extra

```json
{
  "phase": "rp",
  "completedAt": "2026-08-17T04:14:39.986Z",
  "model": "qwen-3-8-max"
}
```
