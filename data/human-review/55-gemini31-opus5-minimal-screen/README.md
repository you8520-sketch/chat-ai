# Audit 55 — Gemini 3.1 Pro vs Claude Opus 5 minimal RP screen

Base: `cursor/standard-collaborative-lineup-6a91` (PR #250). Does **not** modify PR #250 / #251.

## Models (Cheaper Inference)

- `gemini-3.1-pro-preview`
- `claude-opus-5`

Availability checked via CI `/v1/models` before live calls.

## Prompt

Standard collaborative baseline only:

```text
SceneDirective = 0
collaborative owner = 1
legacy novel owner = 0
terminal length owner = 1
```

## Outputs

4 per model (relationship T1→T2 + action T1→T2) = 8 total.  
retry = 0 / continuation = 0 / recovery = 0.

## Blind packs

- Relationship: DeepSeek / Gemini 3.1 / Opus 5
- Action: Terra / Gemini 3.1 / Opus 5

## Status

```text
human review: NOT_RUN — waiting for ChatGPT
production DB apply: NO
public picker exposure: NO
pricing change: NO
auto merge: NO
auto deploy: NO
```
