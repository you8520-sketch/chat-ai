# TURN OWNERSHIP TRACK T1

```
DEEPSEEK0813_TURN_OWNERSHIP_T1_CAPTURE_COMPLETE:
BASE_HEAD:
f77ed3eb25caafe3b5d391252dae5b801aa55c05
BRANCH_HEAD:
d8c14910bfeaabbb4ad6952dd3a7c8d0edfa75fc
PRIMARY_FIXTURE_PROVEN:
false
TARGET:
deepseek-v4-pro-0813
TRUE_OFF:
thinking.disabled + reasoning_effort.none
BASELINE_CALLS:
0
CHALLENGER_CALLS:
0
ANTI_PASSIVITY_CALLS:
0
TOTAL_NEW_CALLS:
0
REASONING_EVENTS:
n/a
REASONING_CHARS:
n/a
TRUE_OFF_PARITY:
n/a
RAW_SHA_COMPLETE:
n/a
BLIND_REVIEW_PACKET:
none — no primary samples
REVEAL_MAP:
none
QUALITY_SCORING_BY_CURSOR:
false
SOURCE_MIRROR:
false
COMPLETION:
false
ORIGIN_POINTER:
false
PRODUCTION_CHANGED:
false
MAIN_MERGED:
false
RAILWAY_DEPLOYED:
false
```

## Gate

Primary live A/B requires the exact Experiment A production-equivalent fixture that produced RUN1 SOFT_FAIL / RUN2 HARD_FAIL / RUN3 PASS, with proven character, persona, Speech Lock, world/canon, history, source assistant RAW, and a matching current user.

That provenance is incomplete. `PRIMARY_LIVE_CALLS=0`. No synthetic scene was substituted. Anti-passivity S1R calls were not run.

## Experiment A fixture honesty

| Field | Status | Evidence |
| --- | --- | --- |
| source assistant RAW | proven | Committed Gemini 3.7 Flash `docs/audits/gemini-37-flash-word-count-owner-e/S3-A-raw.txt` SHA256 `f8924f36b15d821459407f82cc5771b153c86e690540e373af81245ea9243639` |
| matching current user | mismatched | S3-A is an Aegis lobby / bag-strap guide beat. Experiment A current user was the Aion-era adult-entry line (`이대로 있어도 돼?` / waist wrap). That is not the next human turn after S3-A. |
| history | mismatched | Prior user `*가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든.` matches S3-A, then the current user jumps to a different scene. |
| character | stub | Experiment A assembly used `[Identity]\\n조태형` only. |
| persona | stub | Nickname `렌` only. |
| Speech Lock | missing | Not supplied. |
| world/canon | missing | Not supplied. |

Frozen Opus last-assistant RAW and frozen Gemini 3.1 relationship RAW were already missing on the Experiment A VM. Those gaps were not filled.

Do not reconstruct the missing cards or invent a matching adult next-user.

## Frozen Experiment A quality (not re-scored)

```
RUN1 = SOFT_FAIL
RUN2 = HARD_FAIL
RUN3 = PASS
USER_CONSENT_OR_INTENT_INVENTION = 2/3
OVER_PROGRESSION = 1/3
```

Those labels belong to Completion V1, which stays REJECT. Completion V1 was not restored. Completion V2 was not created.

## Candidate (not production-enabled)

Exact T1 wording is frozen in `src/lib/deepseekAdultHandoffTurnOwnership.ts`.

Production default: `applyTurnOwnership=false`.  
Chat route does not import this owner.  
No Source Mirror, Completion, Origin pointer, fingerprint, or model-specific adapter.

## Capture infrastructure

Preserved from the multi-turn drift branch:

- `src/lib/deepseekAdultHandoffFixtureCapture.ts`
- `src/lib/deepseekAdultHandoffMultiTurnInventory.ts`

Ordinary user chat RAW is not persisted.

## Not done

- No DeepSeek 0813 calls
- No blind packet (no samples)
- No S1R anti-passivity calls
- No production TRUE-OFF merge
- No routing change
- No native DeepSeek change
- No main merge
- No Railway deploy

## Next

After ChatGPT review, restore a real Experiment A-equivalent fixture with matching current user and full character/persona/Speech Lock/world provenance before any Turn Ownership live A/B.

STOP. Wait for ChatGPT manual review.
