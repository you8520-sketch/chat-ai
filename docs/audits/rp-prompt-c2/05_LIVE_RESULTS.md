# 05_LIVE_RESULTS

## Stage 1 cheap — COMPLETE (12/12)

Transport: OpenRouter (`google/gemini-3.1-pro-preview`, `deepseek/deepseek-v4-pro`).

| Model | Q A/B | D A/B | T A/B | Hard fails | Human A/B/tie |
|-------|-------|-------|-------|------------|---------------|
| Gemini | ok/ok | ok/ok | ok/ok | 0 | B / B / B |
| DeepSeek | ok/ok | ok/ok | ok/ok | 0 | A / A / A |

- Density collapse: **NO**
- Agency severe A/B: **0 / 0**
- Echo / metadata regression: **NO**
- Transport reissues: **0**
- Quality retries / continuation / recovery: **0**

Machine rows: `05_LIVE_RESULTS_cheap.json`, `RUNTIME_cheap.json`  
Raw outputs: `/opt/cursor/artifacts/rp-prompt-c2-prose-ab/live/`

## Cheap gate

```text
Gemini hard fail = 0
DeepSeek hard fail = 0
B wins + ties (3) >= A wins (3)
quiet density collapse = NO
→ PASS
```

## Stage 2 premium — NOT_RUN

```text
Opus = NOT_RUN
Terra = NOT_RUN
reason = CHEAPER_INFERENCE_API_KEY empty
```

See `05_LIVE_RESULTS_premium.json`.
