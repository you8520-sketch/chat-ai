# 03_HYGIENE_COMPRESSION_DESIGN

**Status:** DESIGN ONLY — no production code changes in STEP C1.  
**C3 live:** NOT_RUN

## Goal

Collapse duplicated private-output hygiene owners into one compact leak-prevention block without losing unique speech-register constraints.

## Current duplication (observed)

1. `[PRIVATE OUTPUT HYGIENE]` already forbids exposing speech-rule names / meta in body.
2. `[SPEECH METADATA — INVISIBLE INSTRUCTIONS]` repeats: do not narrate register/tone/honorific labels in narration.

Unique meaning that **must** survive compression:

```text
한 캐릭터는 한 턴 안에서 register를 섞지 않는다.
```

## Future compact hygiene owner (target semantics)

Single primary owner covering:

- internal metadata never narrated
- status / memory / trigger keys never narrated
- snake_case / JSON / section headers never narrated
- speech/register metadata affects dialogue only; never explain labels in narration
- one character does not mix register within the turn
- no stage-direction / meta prose

## Adversarial fixture requirement

C3 must **not** be approved on literary A/B alone. Synthetic contamination fixtures must include tokens such as:

```text
speech_style
register_by_context
source_turn
extracted_facts
fire_once
event_effect
D-DAY
_TOUCH_
LONG_TERM_MEMORY
LOREBOOK
JSON
snake_case
prompt section names
```

Measure both:

| surface | target |
|---|---|
| PROVIDER_RAW leak rate | 0 |
| FINAL / visible leak rate | 0 |

Post-output sanitizer removing a raw leak is **not** a pass.

## Token target (quality > number)

Rough ambition: ~200–350 estimated tokens from hygiene owners, only if adversarial leak tests stay at 0.

## Cache class note

Confirm at implementation time whether hygiene lives in cacheRules vs dynamic. Prefer not to move owners across cache boundaries during compression unless measured.

## Future A/B rules (when authorized)

1. Offline owner matrix + adversarial static gates before live.
2. Keep agency / layout / prose / terminals byte-identical.
3. Human review + adversarial leak authority.
4. ACCEPT ≠ auto-merge.
