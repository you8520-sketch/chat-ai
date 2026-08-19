# User authoring production 3-way smoke P3 — REVIEW PACKET

Deployment gate failed. No model calls were made.

QUALITY_SCORING_BY_CURSOR = false

---

## Production deployed SHA

Expected main after PR #501:

`213d92e03fb1aa84565e3c95df64e8d10306e3a8`

Live `GET https://chat-ai-production-3e84.up.railway.app/api/health` (2026-08-19T00:08:34Z and again 00:11:25Z):

```json
{
  "ok": true,
  "service": "playai",
  "skipAdultVerification": true,
  "demoEnv": false,
  "webPushConfigured": true,
  "gitCommit": "b06037d",
  "gitBranch": "main",
  "buildBanner": "slide-v1"
}
```

`b06037d` is `b06037dd5c572bd02abec311f4148f57d9362551` (PR #496 TRUE-OFF), the parent of #501. It does not contain current-turn OOC delegation.

`GET /health` → 200 `{"status":"ok"}`.

Vercel: IGNORE_BY_USER.

---

## Railway

Existing production service only: `chat-ai` (`5e36bd2b-5557-4765-949f-5569a8a79628`), environment `production`, volume `/data` unchanged. No env vars changed.

Live SUCCESS deployment still serving traffic:

- id: `907a5401-a848-47d1-b6e1-a369106131f7`
- commit: `b06037dd5c572bd02abec311f4148f57d9362551`

#501 merge commit `213d92e` is on `origin/main`. GitHub-triggered Railway deploys of that SHA stayed `QUEUED` with `Deployment queued due to upstream GitHub issues` (Vercel pending/failure on the commit status). Archive `/up` of the same tree hit `Repository snapshot operation timed out`, then a later `/up` (`3321ea50-25bf-4fab-aa55-0037034217a0`) remained `INITIALIZING` with no `commitHash` through 00:11:25Z.

Production was not swapped to `213d92e`.

---

## Fixture provenance

Not used. Gate stopped before Flood persona / character load.

---

## Case A — MANUAL DEFAULT

Not run. `MODEL_CALLS=0`.

- current user RAW: n/a
- output RAW: n/a
- runtime mode: n/a
- owner: n/a
- visible chars: n/a

---

## Case B — MANUAL + CURRENT-TURN OOC

Not run. `MODEL_CALLS=0`.

- current user RAW: n/a
- output RAW: n/a
- runtime mode: n/a
- owner: n/a
- scope: dialogue_and_actions (planned only)
- next-turn persistence: not exercised (no DB/session field exists on #501 source; live code is pre-#501)

---

## Case C — AUTO PROGRESSION

Not run. `MODEL_CALLS=0`.

- Auto command / effective input: n/a
- output RAW: n/a
- runtime mode: n/a
- owner: n/a
- visible chars: n/a

---

## Telemetry

| Case | VISIBLE_CHARS | VISIBLE_CHARS_NO_WS | OUTPUT_TOKENS | LATENCY_MS | REASONING_EVENTS | REASONING_CHARS |
| --- | --- | --- | --- | --- | --- | --- |
| A | n/a | n/a | n/a | n/a | 0 | 0 |
| B | n/a | n/a | n/a | n/a | 0 | 0 |
| C | n/a | n/a | n/a | n/a | 0 | 0 |

SOURCE_LAST_ASSISTANT_VISIBLE_CHARS: n/a  
HANDOFF_LENGTH_RATIO: n/a  
TARGET_PROVIDER / TARGET_MODEL: n/a (no route exercised)  
TRUE_OFF: not probed (no DeepSeek call)

---

## Locks

```text
T2_ENABLED = false
T3_CREATED = false
RETRY = 0
CONTINUATION = 0
RECOVERY = 0
TOTAL_NEW_CALLS = 0
PRODUCTION_CHANGED_DURING_TEST = false
```

---

## Stop

Do not judge prose. Do not start 3-way behavioral QA or long-horizon testing until `/api/health` reports `213d92e` (or the full `213d92e03fb1aa84565e3c95df64e8d10306e3a8`).
