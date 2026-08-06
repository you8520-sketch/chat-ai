# Production model bake-off — representative selection

Source: live `SELECTED_AI_OPTIONS` / `USER_SELECTABLE_AI_OPTIONS` and archive inventory
`docs/audits/35-cross-model-inventory/` (PROMPT families F3/F5).

## Muse unavailable

Muse Spark is **not live selectable**. `resolveSelectedAI` remaps
`muse` / `muse-spark` / `meta/muse-spark-1.1` → `deepseek-v4-pro`.
Calling Muse would not exercise a Muse prompt stack.

Slot B therefore uses the next picker-visible premium with a distinct provider/adapter:
`claude-opus-5` (F5 common terminal + Anthropic path).

## Selected arms

| Slot | Model id | Family | Role |
| --- | --- | --- | --- |
| A | `gpt-5.6-terra` | F3 Terra terminal length owner | Current best-quality Korean long-RP production arm |
| B | `claude-opus-5` | F5 common terminal (Anthropic) | Muse substitute — distinct premium provider |
| C | `gemini-3.1-pro-preview` | F5 common terminal (Google) | Other provider premium |

DeepSeek V4 Pro: **reference only** (no new calls). Prior production baseline raws remain under
`/opt/cursor/artifacts/deepseek-common-root-audit/02-ds-pro-real-production/`.

## Selection priority applied

1. Production-enabled / picker-visible
2. Korean RP quality purpose
3. Provider/prompt adapter different from DeepSeek
4. Within production advanced tier (no retired remaps)
