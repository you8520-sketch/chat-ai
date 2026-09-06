# PROMPT_COMPRESSION_AUDIT — Final Report

```text
PROMPT_COMPRESSION_AUDIT:

Opus:
  system_total: 5858
  common_fixed (INSTRUCTION+MIXED buckets): 4469
  character_canon (CONTENT character-core): 492
  persona/user CONTENT buckets: 1378 (includes persona refs; see inventory)
  dynamic_memory: 49
  model_specific (system tracked): ~0
  terminal_owner (user-turn Arm E): 1134
  current_user turn total: 1530
  history: 101
  TOTAL_INPUT: 7489

Gemini:
  system_total: 5858
  common_fixed (INSTRUCTION+MIXED): 4469
  character_canon: 492
  dynamic_memory: 49
  model_specific (system tracked): ~0
  terminal_owner: common length tail only (no Arm E)
  current_user turn total: 500
  history: 101
  TOTAL_INPUT: 6460

DeepSeek:
  system_total: 6064
  common_fixed (INSTRUCTION+MIXED): 4526
  character_canon: 492
  dynamic_memory: 49
  model_specific delta vs Opus/Gemini system: +206 (contamination/structure path)
  terminal_owner: common length + DS user extras (user turn 835)
  current_user turn total: 835
  history: 101
  TOTAL_INPUT: 7001

Terra (normalization control):
  system_total: 5858
  common_fixed: 4469
  character_canon: 492
  dynamic_memory: 49
  model_specific: Terra terminal on user turn (user 548)
  TOTAL_INPUT: 6507

REGEN OVERHEAD (same fixture, COMPACT_SUMMARY default):
  regenerate mode: COMPACT_SUMMARY
  REGENERATE_FULL_REJECTED_DRAFT: unset/false
  system delta all models: +872
  (rejected-draft summary ≤320 tok budget; full directive block ≈872)

largest fixed-token sections (NORMAL Opus/Gemini/Terra):
  1. prose-style-xml-bundle ≈ 1709
  2. runtime-prompt-contamination-guard ≈ 799
  3. openrouter-korean-prose-top ≈ 738
  4. rule-output-layout-recency ≈ 670
  5. no-godmodding (agency) ≈ 409

exact duplicates:
  layout blank-line / dialogue-paragraph rules across prose bundle + layout recency (+ terminal layout line)

semantic duplicates:
  Opus agency: COLLABORATIVE_INTERACTIVE_OWNER + CURRENT USER wrapper + Arm E B-prohibitions
  rhythm short-burst / translationese adjacency in prose

Opus Arm E:
  total tokens: 1134
  unique semantic clauses: 4 (length, expand via A/NPC, future-instruction boundary, meaningful-change stop)
  overlapping clauses: 6 (common and/or wrapper)
  compactable: YES (design only)
  estimated reduction: ~35–55% of Arm E (≈400–620 tokens) if parity preserved

common prose:
  keep: narration register floor, immersive experience coupling, sensation 1–2ch, canon-justified 특별취급 exception wording
  merge: short-burst + translationese short-sentence rules
  possible drop: over-specific pause micromanagement (P2 only)
  literaryEnhanced: LITERARY_ENHANCED_CURRENTLY_NO_EFFECT = true

layout duplication: YES (P0/P1 candidate)
agency duplication: YES on Opus (P0)
length duplication: length mainly on user terminal; Arm E also owns length band

Gemini `(갸웃)`:
  raw literal present in outbound prompt: YES
  locations: formatUserMessageForPrompt → wrapCurrentUserInput → current user turn
  parser output: merged action "(갸웃)나는 렌이라고…" (strip failed)
  likely cause: NARRATIVE_CLOSING_RE false-positive on "라고" + mergeAdjacentParts

Gemini user dialogue echo:
  prompt duplicate beyond single CURRENT USER block: NO
  likely model compliance issue: YES (for re-performing completed user dialogue)
  note: parenthesis leak is prompt-side; dialogue re-acting can still be model compliance

estimated safe fixed-instruction reduction:
  tokens: ~1100–1800 (25–40% of ≈4469 fixed-instructionish)
  percent: 25–40%
  excludes: character canon / persona facts / memory content

main production changes:
  NONE

API calls:
  0

recommended Phase 2 A/B:
  1) Opus Arm E compact vs frozen Arm E (agency fail-closed)
  2) layout dedupe
  3) prose MERGE candidates only
```

## NORMAL footprint table

```text
                      Terra   DeepSeek   Gemini   Opus
------------------------------------------------------
common fixed-ish      4469    4526       4469     4469
model-specific sys    ~0      +206       ~0       ~0
character canon       492     492        492      492
persona/user content  (in 1378 CONTENT bucket)
dynamic memory        49      49         49       49
layout (section)      670     670        670      670
agency (section)      409     409        409      409
length/terminal       ~48*    ~335*      ~0*      1134 Arm E
total system          5858    6064       5858     5858
current user          548     835        500      1530
history               101     101        101      101
TOTAL INPUT           6507    7001       6460     7489
```

\* Terminal length shares the user-turn budget with CURRENT USER wrapper; Opus Arm E dominates Opus user-turn growth.

## Field-measurement normalization

```text
Do NOT compare:
  DeepSeek first-turn NORMAL ≈ 6k
  vs Terra/Gemini/Opus REGEN ≈ 4.3k–6.8k
as model structure.

REGEN adds ≈ +872 system tokens (compact) uniformly in this fixture.
FULL rejected draft is opt-in only (REGENERATE_FULL_REJECTED_DRAFT).
```
