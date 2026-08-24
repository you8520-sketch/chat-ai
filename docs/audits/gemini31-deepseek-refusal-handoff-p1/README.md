# Gemini 3.1 → DeepSeek V4 Pro 0813 refusal-only handoff — Phase 1 RAW freeze

Evidence only. No production code, prompt, adapter, length-owner, or routing changes.

- Primary: `gemini-3.1-pro-preview` (Cheaper Inference)
- Refusal replacement: `deepseek-v4-pro-0813`
- Character: production 라이크 `id=18`
- Persona: 렌 (adult S-class guide)

Live freeze is in `INDEX.json`, `PATHS.md`, `raw/`, `requests/`, and `meta/`.

RP provider call counts: A=1 Gemini, B=1 Gemini + 1 DeepSeek 0813, C=1 Gemini.

Human/ChatGPT review: A/B2/C routing PASS. Production handoff acceptance NOT YET APPROVED.

- Issue 1 diagnosis (no production change): `ISSUE1-B3-PATH-DIAGNOSIS.md`
