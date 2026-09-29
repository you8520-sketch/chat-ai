# GLM-5.2 RP A/B — scorer map

No quality scores, gates, or verdicts are written here.
Start at this file, then open the linked paths.

Run HEAD: `02915fca67c594a93b520353487e3541c38301d6`
Model: `glm-5.2`
Endpoint: `https://api.cheaperinference.com/v1/chat/completions`
Retry / continuation / recovery: `0`

Same tree also exists under `/opt/cursor/artifacts/glm-52-rp-ab/`.

## A. Transport / capability

- `docs/audits/glm-52-rp-ab/01-transport-probe.json`

## B. A/B assembled exact diff

- `docs/audits/glm-52-rp-ab/02-assembled-diff-audit.json`
- payloads: `docs/audits/glm-52-rp-ab/assembled/`

## C. 8-call metrics

- `docs/audits/glm-52-rp-ab/03-call-metrics.json`
- per-call JSON: `docs/audits/glm-52-rp-ab/calls/`

## D. A/B raw outputs

- `docs/audits/glm-52-rp-ab/raw/S1-A.txt`
- `docs/audits/glm-52-rp-ab/raw/S1-B.txt`
- `docs/audits/glm-52-rp-ab/raw/S2-A.txt`
- `docs/audits/glm-52-rp-ab/raw/S2-B.txt`
- `docs/audits/glm-52-rp-ab/raw/S3-A.txt`
- `docs/audits/glm-52-rp-ab/raw/S3-B.txt`
- `docs/audits/glm-52-rp-ab/raw/S4-A.txt`
- `docs/audits/glm-52-rp-ab/raw/S4-B.txt`

## E. Blind human review

Open X/Y first. Do not open the key until scoring is done.

- rubric: `docs/audits/glm-52-rp-ab/blind/REVIEW_RUBRIC.md`
- `docs/audits/glm-52-rp-ab/blind/S1-X.txt`
- `docs/audits/glm-52-rp-ab/blind/S1-Y.txt`
- `docs/audits/glm-52-rp-ab/blind/S2-X.txt`
- `docs/audits/glm-52-rp-ab/blind/S2-Y.txt`
- `docs/audits/glm-52-rp-ab/blind/S3-X.txt`
- `docs/audits/glm-52-rp-ab/blind/S3-Y.txt`
- `docs/audits/glm-52-rp-ab/blind/S4-X.txt`
- `docs/audits/glm-52-rp-ab/blind/S4-Y.txt`
- key after scoring: `docs/audits/glm-52-rp-ab/blind/BLIND_KEY.json`

## F / G / I

Not written. `COMMON_PROMPT_SIGNAL`, Gemini 3.7 comparison, and candidate verdict are left for the scorer.

## H. Actual cost

- usage.cost / catalog snapshot: `docs/audits/glm-52-rp-ab/03-call-metrics.json`
- live catalog + UI snapshot: `docs/audits/glm-52-rp-ab/01-transport-probe.json`

## J. HEAD SHA

- run SHA: `02915fca67c594a93b520353487e3541c38301d6`
- also in `docs/audits/glm-52-rp-ab/00-meta.json`

## Full file list

- `docs/audits/glm-52-rp-ab/DATA_INDEX.md`
