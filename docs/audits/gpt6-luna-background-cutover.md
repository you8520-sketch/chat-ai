# GPT-6 Luna background cutover audit

Date: 2026-09-25

## Scope

Background-only model cutover from CheaperInference `gpt-5.6-luna` to `gpt-6-luna`.

Main RP, asset vision, appearance compiler, and existing fallback models are intentionally unchanged.

## Evidence

- CheaperInference deployment UI shows `gpt-6-luna` available at the displayed 30%-off rate:
  - input: $0.07 / 1M
  - output: $0.35 / 1M
- OpenAI documents `gpt-6-luna` support for Chat Completions, structured outputs, and reasoning effort `none`.
- Railway production defines `BACKGROUND_MEMORY_MODEL`; value is OAuth-redacted, so runtime code also migrates the historical `gpt-5.6-luna` background alias to the current owner.

## Owner map

| Responsibility | Canonical owner after cutover |
| --- | --- |
| Current background text primary | `BACKGROUND_OPENROUTER_MODEL` in `src/lib/ai.ts` |
| Background model constants / provider classification | `src/lib/chatModels.ts` |
| CI per-model reasoning wire policy | `src/lib/cheaperInferenceConfig.ts` |
| Prompt translation primary | `DEFAULT_TRANSLATION_PRIMARY_MODEL` |
| Chat-image scene brief primary | `CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL` |
| TRPG reply-suggestion primary | `TRPG_REPLY_SUGGESTION_MODEL` |
| Creative OOC HTML primary | `BACKGROUND_CREATIVE_HTML_MODEL` |
| Cost-rate fallback | `src/lib/openRouterModelPricing.ts`; live CI catalog overlays when available |
| Historical GPT-5.6 Luna receipt recognition | `src/lib/chatModels.ts` historical model constant + display label |

## Before

Current background defaults and a Railway override could resolve to `gpt-5.6-luna`. The CI adapter had a Luna-specific reasoning policy keyed only to GPT-5.6 Luna.

## After

- Current background text defaults resolve to `gpt-6-luna`.
- Historical `gpt-5.6-luna` used as a background runtime override resolves to `gpt-6-luna`.
- Historical receipts retain the original GPT-5.6 model id and label.
- GPT-6 Luna is classified as CheaperInference and remains unavailable as a Main RP selection.
- GPT-5.6 and GPT-6 Luna share one Luna-family reasoning policy with `reasoning_effort=none`.
- No provider fallback, physical-call budget, DB schema, or Main RP registry is changed.

## Pricing owner

The static fallback for GPT-6 Luna uses the current displayed CI input/output values ($0.07/$0.35 per 1M). Cache fallback uses upstream GPT-6 Luna ratios only when the live CheaperInference model catalog is unavailable. Live CI catalog pricing remains authoritative when refreshed.

## Regression gates

The canonical post-turn Luna workflow now also runs:

- background owner routing
- CI background transport
- Main RP public-removal boundary
- CI pricing fallback/live overlay
- prompt translation
- chat-image scene brief
- TRPG reply suggestions
- auxiliary provider provenance

Provider HTTP remains zero in ordinary CI. The existing explicit schema provider probe remains opt-in.
