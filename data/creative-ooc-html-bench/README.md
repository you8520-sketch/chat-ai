# Creative OOC HTML bench artifacts

Human review only — **no winner or quality scores computed by Cursor**.

- Models: `gpt-5.6-luna` vs `deepseek-v4-pro-0813` (CheaperInference direct)
- Calls: exactly 10 (5 Creative OOC HTML cases × 2 models, interleaved)
- Production prompts: `buildHtmlFlashSystemPrompt` + `buildHtmlVisualCardFlashUserBlock` with `oocCreativeBrief` / `chatOocExclusive`

Each case folder contains `*.raw.txt` (model output) and `*.html` (browser-openable render).

See `manifest.json` for call metadata. No secrets included.
