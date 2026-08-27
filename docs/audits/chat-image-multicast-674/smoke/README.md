# GPT Image cast smoke artifacts

Synthetic refs and exact prompts were generated locally with Sharp (512×512 bust SVGs).

**Blocked:** `OPENAI_API_KEY` was not configured in the Cloud Agent environment, so real `/v1/images/edits` calls were not executed. See `GPT-IMAGE-SMOKE-BLOCKED.json`.

Run when a key is available:

```bash
node --conditions=react-server --import tsx scripts/run-cast-gpt-image-smoke.ts
```

Expected: exactly 2 provider calls (G1 LD trio illustration, G2 3-cut comic).
