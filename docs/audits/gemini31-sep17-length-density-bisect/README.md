# Gemini 3.1 Pro — Sep-17 length/density 2×2 bisect

Investigation only. Production owners unchanged until live evidence.

## Exact refs

| Field | Value |
|---|---|
| GPT-confirmed main | `45d79ca86fc7083fb4f590671a88d666ba6cc2c5` |
| Branch HEAD (investigation start) | same as above |
| origin/main at start | `70e5c0bfee59ffaf5…` (11 commits ahead; official-supply only — length/density owners unchanged) |
| Historical delta | `bbb8cad1` (2026-09-17) + compact `00455a22` |

## Owner map (live Main RP)

| Concern | Owner | Live? |
|---|---|---|
| Numeric visible target (3,200) | `USER_TAIL_LENGTH_OWNER_SENTENCE` | YES (user-turn absolute tail) |
| USER_TAIL length owner | `src/lib/responseLength.ts` | YES |
| NARRATIVE_DENSITY | `src/lib/sceneExpansionPolicy.ts` | **NO** — `buildLengthInstruction()` returns `""` |
| COMMON PROSE | `advancedProseNsfwGuidelines.ts` | YES |
| Current-turn / user agency | `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` | YES |
| NO GODMODDING | same collaborative block on standard path | YES |
| Gemini 3.1 agency supplement | `gemini31UserAgencyAdapter.ts` | YES (3.1 only) |
| Scene pacing | Arm V `[SCENE PACING]` | YES |
| Dialogue | COMMON PROSE + layout + optional dialogue budget | YES |

### Duplicate ownership verdict

`[B]의 새 직접 대사·중요 선택·중대 행동을 분량 채우기용으로 만들지 않는다` inside USER_TAIL is **DUPLICATE OWNERSHIP** of the canonical agency contract:

> `[B]의 새로운 직접 대사, 중요한 선택·동의·거절, 관계·목표·소속·정체성을 바꾸는 결정은 대신 확정하지 않는다.` (`noGodmodding.ts`)

Density twin (`[B]… length filler가 아니다`) is also agency-echo, but **not live-injected**.

## Offline prompt hashes (`quiet_intimacy`)

| Arm | USER_TAIL | DENSITY | Prompt hash (12) |
|---|---|---|---|
| A | current | absent | `727818ba4321` |
| B | old | absent | `40decc71f91c` |
| C | current | absent | `727818ba4321` (=A) |
| D | old | absent | `40decc71f91c` (=B) |

Wire params verified: `temperature=0.95`, `reasoning_effort=low`, `max_tokens` omitted.

**Implication:** On current production topology, arms C and D cannot isolate Sep-17 density text — density is not in the provider-bound prompt. Live 2×2 still runs all four arms for protocol completeness; density dimension is a no-op.

## Harness

```bash
BISECT_RUNS=5 BISECT_FIXTURES=quiet_intimacy \
  node --conditions=react-server --import tsx scripts/gemini31-sep17-length-density-bisect.ts
```

Requires `CHEAPER_INFERENCE_BENCHMARK_API_KEY`. Exactly one CI fetch per sample (no retry/continuation/recovery).
