# 03 Semantic Owner Matrix

Measured on NORMAL assemble (Opus / Gemini / DeepSeek / Terra), same fixture.

| SEMANTIC OWNER | Opus sections | Gemini sections | DeepSeek sections | Terra sections | overlap note |
| --- | --- | --- | --- | --- | --- |
| USER AGENCY | no-godmodding(409) | no-godmodding(409) | no-godmodding(409) | no-godmodding(409) | Common collaborative owner + CURRENT USER wrapper; Opus adds Arm E; DeepSeek may add future-instruction boundary |
| LENGTH | user-tail Arm E (1134) | user-tail common length sentence | user-tail common length (+ optional DS adapters if active) | user-tail Terra terminal | Length lives mainly on user-turn terminal, not system cacheRules |
| SCENE STOP | Arm E reaction-point stop + common agency | common agency | common agency + DS boundary if active | common agency + Terra terminal | semantic duplicate risk on Opus |
| SCENE PROGRESSION | — | — | — | — | Check inventory for scene-directive presence |
| PROSE STYLE | openrouter-korean-prose-top(738), prose-style-xml-bundle(1709) | openrouter-korean-prose-top(738), prose-style-xml-bundle(1709) | openrouter-korean-prose-top(738), prose-style-xml-bundle(1709) | openrouter-korean-prose-top(738), prose-style-xml-bundle(1709) | Shared house style; literaryEnhanced currently no text effect |
| DIALOGUE FORMAT | rule-output-layout-recency(670) | rule-output-layout-recency(670) | rule-output-layout-recency(670) | rule-output-layout-recency(670) | Layout rules often appear in prose bundle + layout recency |
| PARAGRAPH FORMAT | rule-output-layout-recency(670) | rule-output-layout-recency(670) | rule-output-layout-recency(670) | rule-output-layout-recency(670) | Duplicate candidate if WEBNOVEL OUTPUT + SEMANTIC PARAGRAPHING + terminal line all repeat blank-line rules |
| LANGUAGE | openrouter-korean-prose-top(738), rule-output-layout-recency(670) | openrouter-korean-prose-top(738), rule-output-layout-recency(670) | openrouter-korean-prose-top(738), rule-output-layout-recency(670) | openrouter-korean-prose-top(738), rule-output-layout-recency(670) | Top Korean prose policy typically cacheRules |
| CANON PRIORITY | character-core-identity(492), identity-and-rules(292) | character-core-identity(492), identity-and-rules(292) | character-core-identity(492), identity-and-rules(292) | character-core-identity(492), identity-and-rules(292) | Character canon = CONTENT tokens, not instruction bloat |
| KNOWLEDGE BOUNDARY | — | — | — | — | May be embedded inside identity/rules |
| USER INPUT PARSING | — | — | — | — | System parsing block + formatUserMessageForPrompt on user turn |
| INPUT ECHO | CURRENT USER wrapper (interactive) | CURRENT USER wrapper (interactive) | CURRENT USER wrapper (interactive) | CURRENT USER wrapper (interactive) | If outbound has no raw duplicate, Gemini echo = MODEL_COMPLIANCE_ECHO |

## Agency instruction token estimate (NORMAL)

| Model | system AGENCY bucket | user-turn terminal agency-ish | notes |
|---|---|---|---|
| Opus | 409 | Arm E 1134 (includes length+agency) | Highest model-specific agency surface |
| Gemini | 409 | common length tail only | Least model-specific agency |
| DeepSeek | 409 | common length + optional future boundary | Check MODEL_SPECIFIC bucket |
| Terra | 409 | Terra terminal (length-first) | Agency mostly common owner |
