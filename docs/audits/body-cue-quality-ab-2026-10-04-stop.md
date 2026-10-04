# #1354 body-cue quality A/B — STOP before paid calls (2026-10-04)

Cursor does not score prose quality. GPT owns
`QUALITY_IMPROVED_EVIDENCED` / `NO_CLEAR_QUALITY_GAIN` / `REGRESSION` /
`INCONCLUSIVE`. No production routing, price, customer billing, or prompt
owner was changed. #1288 / #1296 / #1299 were not edited or merged.

Approval followed: Issue #1354 comment `5978376490` (2026-10-04 USER
APPROVAL) plus the later operator pin that production is main merge
`5cc5d101f74b044bd61de5c7e1355a3e67ec4906`.

## BEFORE

Live `COMMON_PROSE_BLOCK` still enumerates body channels:

`감정과 관계는 표정·시선·호흡·습관·접촉·거리·행동·선택으로 드러내고`

That clause sits in the cached character block. The already-merged #1294
forward-motion sentence stays on the same line.

Canonical Main RP picker on `5cc5d101`:

- first / recommended / `DEFAULT_SELECTED_AI` = `deepseek-v4.1-flash`
- provider `cheaperinference`
- `MAIN_RP_USER_SELECTABLE_OPTIONS` still has exactly six active models

Merged #1377 audit tooling is an ancestor of this SHA
(`10a976555a662461ced7f5d79e512190f39fbc0b`). Offline harness owners:

- `src/lib/mainRpFinalWireAudit.ts` — candidate clause swap only
- `scripts/lib/mainRpBodyCuePreflight.ts` — scene assembly + evidence union

## PROBLEM

Draft #1288 (`73908e134ef28e47be8a50e6c8ebad3bcb4c6c60`) replaces the
enumeration with:

`감정과 관계는 현재 장면에 필요한 단서를 골라 드러내고`

Static / assembled-request proof is not behavioral proof. The approved
4-call DeepSeek A/B was meant to give GPT raw outputs. That A/B did not
start.

## AFTER

Exact intended request delta on current main, using the existing #1377
harness (no #1288 merge; production prose file untouched):

| Field | Baseline | Candidate |
| --- | --- | --- |
| cue | body-channel enumeration (count 1) | scene-clue sentence (count 1) |
| rules sha256 | `c5a136410ad87c7f65215e80d92b2ce70bc6ca3f5d6a369fe4636b335c3a3bfc` | same |
| dynamic sha256 | `87067de90334499093dafbec3fb42dccce922512e82cdfc318af1d118f9d1e16` | same |
| character sha256 | `dd4c7fb92826452e52c6a8ab8aab2ea51b116607f74aeac8364b74e64fb9a68e` | `770785ac699056c3b85cbc637f9aa7c8405156c01eccf3b172208c7014dcd75b` |
| system flat sha256 | `60f49a89e2aa1168bc4cce430a92db6acd97de5239795070773e032fe23d572a` | `92f0a2dfed2fdf7ac1dfb042d124c091b398c5c326392b876f95253ffc4ba3ea` |
| cache marks | `true,true,false` | `true,true,false` |
| flat / character delta | — | −8 characters |

Both review scenes (`quiet_window_safe`, `relationship_turn_safe`):
`soleAllowedDiff=true`. Prompt character totals 20,502 / 20,515. Shared
system flats; user-turn hashes differ by scene only.

`git diff origin/main 73908e13 -- src/lib/advancedProseNsfwGuidelines.ts`
is that one clause. The #1288 branch itself is stale versus current main
in many unrelated files; this run did not apply that branch.

These hashes are the **historical 2026-08-25 pinned dump**
(`evidence.source=HISTORICAL_PINNED`, input character id 10). They match
the 2026-10-03 preflight packet. They are **not** the later in-container
id-18 assemblies (20,355 / 20,368 at deploy `b8db091d`).

## PRESERVED

- model id `deepseek-v4.1-flash`
- SAFE / NORMAL authoring, `rp_continuing` → `current_turn_ooc_delegated`
- cache shape `cached,cached,uncached`
- #1294 forward-motion sentence present once on both arms
- production `COMMON_PROSE_BLOCK` unchanged
- production routing / price / customer billing unchanged
- no new benchmark framework

## LIVE ROW HASH CHECK — NOT RECONFIRMED

Recorded #1354 / #1377 proof (`LIVE_DEPLOYED_ROW_PROOF`, deploy
`2f5cb0b416ce214dfeb109f50622c0a45d61f62a`):

- character id **18** 라이크 (id 10 is not 라이크)
- unique admin 렌 persona public sha256
  `9ef42c7f92091ca158a53c4321b06dab4e687d3a882210c4a576e87029703a36`
- greeting sha256
  `29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58`
- system_prompt sha256
  `44c293ce3e6aaa7ab885ad93c93342a0e4d1ed803a2c7e22119f42991ee44d6b`
- `personaMatchesHistoricalDump=false`
- `characterCoreDumpMatchesLiveRow=false`
- `liveAssembledRequest=UNVERIFIED`

This VM could not re-read production `/data/app.db`:

- local `data/app.db` has no 라이크 row and no 렌 persona
- `RAILWAY_TOKEN` GraphQL → 403
- Railway CLI absent; SSH key material is a placeholder
- prompt-owner files are unchanged from `b8db091d` to `5cc5d101`, which
  does **not** prove live character/persona rows are unchanged

Paid A/B stays blocked until a current authorized read-only row hash
check matches `LIVE_DEPLOYED_ROW_PROOF` without printing source text.

## CREDENTIAL / PRICE PREFLIGHT — STOP

Experiment-only inference credential: **absent**. CheaperInference docs
create keys from the dashboard (`Limit access` by model / concurrency /
spend / expiry). Creating a new key would require production account
permission. Approval: STOP rather than weaken controls.

Same-credential read-only probe of the only inference-named env key
`CHEAPER_INFERENCE_API_KEY` (no key value logged):

- `GET https://api.cheaperinference.com/v1/models` → **401**
  `invalid_api_key`
- `GET .../v1/models/supply?model=deepseek-v4.1-flash&min_discount_percent=50`
  → **401** `invalid_api_key`

That matches the earlier post-rotation finding: this env key cannot
preflight its own catalog. The benchmark/reporting key was **not** used
as inference-price evidence.

Gates that therefore fail before Call 1:

- no safe experiment inference credential
- no same-key catalog proof that `deepseek-v4.1-flash` is ≤ $0.075 / $0.30
- no same-key `min_discount_percent=50` `candidate_count>=1`
- live id-18 / admin 렌 source hashes not re-read

## PAID ATTEMPTS

| Order | Scene | Arm | Result |
| --- | --- | --- | --- |
| 1 | — | — | **not sent** |
| 2 | — | — | **not sent** |
| 3 | — | — | **not sent** |
| 4 | — | — | **not sent** |

Total paid attempts: **0**. Auto retry stayed off. Provider fallback
stayed off. Call 1 circuit breaker was not reached; calls 2–4 were not
started.

## PROVIDER EVIDENCE

None. No chat-completions POST. No provider request id. No settled
usage/cost.

## TOTAL COST

**$0.00** provider. 0 billed attempts.

## OUTPUTS

No A/B blinded raw outputs. GPT has nothing new to score.

## PROOF

- main / production pin: `5cc5d101f74b044bd61de5c7e1355a3e67ec4906`
- #1377 merge ancestor: `10a976555a662461ced7f5d79e512190f39fbc0b`
- #1288 Draft HEAD: `73908e134ef28e47be8a50e6c8ebad3bcb4c6c60`
- #1296 / #1299 remain open Drafts
- harness tests on this SHA:
  `scripts/lib/mainRpBodyCuePreflight.test.ts`,
  `src/lib/mainRpFinalWireAudit.test.ts`,
  `src/lib/mainRpModelRegistry.test.ts` — 33/33 pass
- hash packet:
  `docs/audits/body-cue-quality-ab-2026-10-04-request-delta.json`
- preflight (no secrets):
  `docs/audits/body-cue-quality-ab-2026-10-04-preflight.json`

## STOP

Do not merge #1288. Do not run the 4-call A/B from this environment.
Resume only after:

1. an experiment-only CheaperInference key already exists (or is created
   by the account owner without this agent changing production
   credentials), restricted to `deepseek-v4.1-flash`, concurrency 1, and
   a small spend/expiry limit; and
2. the **same** key returns catalog + supply that meet the approved
   ceilings; and
3. a current authorized read-only production row check matches
   `LIVE_DEPLOYED_ROW_PROOF` (hashes only).
