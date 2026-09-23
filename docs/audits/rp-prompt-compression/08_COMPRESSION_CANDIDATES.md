# 08 Compression Candidates

## Goal (not a hard target)

```text
COMMON FIXED INSTRUCTION TOKENS — 25~40% reduction candidate
Exclude: character canon, world canon, persona facts, episodic, LTM, triggers, active lorebook
```

Approx common fixed-ish instruction surface on Opus NORMAL (buckets PROSE+AGENCY+LAYOUT+LANGUAGE+COMMON_FIXED+RUNTIME): **3526 tokens**.

Stretch if that surface is 3k–4k: aim toward ~2.0k–2.8k **only if** quality/agency preserved.

## Priority list

### P0
- Exact duplicate rules across prose + layout + terminal
- Semantic duplicate agency owners (common collaborative + Arm E B-prohibitions + CURRENT USER wrapper)
- Deprecated owners accidentally injected
- Same prohibition repeated at terminal

### P1
- Long explanations → short same-meaning sentences
- Unnecessary production examples
- English+Korean duplicate explanation pairs

### P2
- Over-specific prose micromanagement that flattens Opus voice
- Model-specific historical workarounds no longer needed

### P3 (out of scope)
- Canon / memory content

## Exact / semantic duplicates observed

See section inventory + owner matrix. Primary compression opportunities:

1. **Agency triple-stack on Opus** (common owner + wrapper + Arm E)
2. **Layout blank-line / dialogue-paragraph rules** repeated across WEBNOVEL OUTPUT FORMAT / SEMANTIC PARAGRAPHING / terminal layout line
3. **Rhythm short-burst rules** stated twice in close proximity

## Cache-structure constraint

Do **not** move static/cacheable instruction into dynamic to “look smaller” — that raises cost.
Preserve `cacheRules` / `cacheCharacter` / `dynamic` split.
