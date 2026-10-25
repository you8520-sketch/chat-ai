# MULTI-TURN VANILLA TRUE-OFF DRIFT TRACK

```
TRACK:
MULTI-TURN VANILLA TRUE-OFF DRIFT
FIXTURE_AVAILABLE:
false
LIVE_CALLS:
0
MODEL_CALLS:
0
REASON:
complete_real_multiturn_chain_unavailable
PREFERRED_SOURCE:
gemini-3.7-flash
TARGET:
deepseek-v4-pro-0813
TRUE_OFF_CONFIG:
thinking={type:"disabled"} + reasoning_effort="none"
SOURCE_MIRROR:
0
COMPLETION:
0
CURRENT_STAGE_BOUNDARY:
0
FINGERPRINT:
0
MODEL_SPECIFIC_STYLE_ADAPTER:
0
ORIGIN_POINTER:
0
TURN_OWNERSHIP:
0
QUALITY_SCORING_BY_CURSOR:
false
PRODUCTION_CHANGED:
false
MAIN_MERGED:
false
RAILWAY_DEPLOYED:
false
SOURCE_MIRROR_PRODUCTION:
false
```

## What this audit did

Next action only: measure natural Vanilla TRUE-OFF drift across three DeepSeek adult-handoff turns.

No complete real production-equivalent chain could be restored. Per the program gate, this branch adds capture infrastructure only and stops. No DeepSeek 0813 calls were made.

## Required frozen chain

A live Vanilla run needs all of the following, with no synthetic fills:

1. Last visible canonical non-DeepSeek assistant RAW (prefer Gemini 3.7 Flash)
2. Three matching human user continuations that actually follow that origin / each prior handoff turn
3. Three DeepSeek 0813 assistant turns in one continuous handoff session

or, equivalently, items 1–2 so the three DeepSeek turns can be generated later without inventing users.

## What exists on this repo

| Candidate | Why it is not enough |
| --- | --- |
| `docs/audits/gemini-37-flash-baseline/` | Gemini T1 RAW + matching T2 user `같이 갈래? *두리번*`. T2 RAW is Gemini, not DeepSeek. No human user after a DeepSeek handoff turn 1 or turn 2. |
| `docs/audits/gemini-37-flash-pricing/` | Gemini-only growing history. Do not relabel as a DeepSeek handoff chain. |
| `docs/audits/final-production-deepseek-boundary-resmoke/` | User selected DeepSeek. Native turn. Adult handoff = false. |

Style Track S1 / S1R (other branches) are single DeepSeek continuation turns after the Gemini T1 RAW. They are not a three-turn handoff chain, and there is no matching human reply to those specific DeepSeek outputs.

## Missing pieces for the preferred Gemini37 path

- `origin_canonical_non_deepseek_assistant` is present as a file (`t1-raw.txt`) but is not wired into a frozen three-turn handoff session
- `turn1_matching_human_user` = `같이 갈래? *두리번*` only
- `turn2_matching_human_user` = missing
- `turn3_matching_human_user` = missing
- `turn1/2/3_deepseek_assistant_raw` = missing

Inventing the missing user turns is forbidden. Gemini pricing users after T2 reply to Gemini T2, not to a DeepSeek handoff turn, so they are not matching continuations.

## Capture infrastructure added

DEV/AUDIT-only utility: `src/lib/deepseekAdultHandoffFixtureCapture.ts`

Stores metadata only by default:

- sourceModel / targetModel
- characterSha, personaSha, speechLockSha, worldSha, systemSha, historySha
- originAssistantMessageId / originAssistantRawSha
- currentUserSha / fullPromptSha
- TRUE-OFF transport config
- runtime metadata (stream reasoning events/chars, TTFT, latency, tokens, cost, visible chars)

Policy:

- ordinary user chats are not persisted
- RAW bodies require an explicit approved internal audit workflow
- origin is the last visible canonical non-DeepSeek assistant and is not overwritten by later DeepSeek turns
- QA style telemetry may be calculated and must never enter the prompt

Inventory gate: `src/lib/deepseekAdultHandoffMultiTurnInventory.ts`

Runner (no model calls): `scripts/deepseek-0813-multiturn-vanilla-drift-inventory.ts`

## Explicitly not done

- No production TRUE-OFF merge (P1 later; native DeepSeek transport unchanged)
- No Turn Ownership A/B
- No Origin pointer
- No Source Mirror / Completion / fingerprint / source-specific style adapter
- No Railway deploy
- No ChatGPT scoring packet (no DeepSeek turns to score)

## Next

After ChatGPT review, restore or newly capture a real Gemini37 (or other approved source) chain with three matching human users before any Vanilla TRUE-OFF live calls.

STOP.
