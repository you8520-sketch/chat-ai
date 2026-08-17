# TRPG GM Thinking ON vs TRUE OFF benchmark

Isolated harness. Does **not** change production GM runtime, campaign rows, HP, inventory, billing, creator rewards, or memory.

Provider contract (DeepSeek V4 Pro 0813):

- **ON:** `thinking: { type: "enabled" }`
- **TRUE OFF:** `thinking: { type: "disabled" }` **and** `reasoning_effort: "none"`
- `thinking.disabled` alone is **MISCONFIGURED_DISABLED** (reasoning still runs). Do not treat those rows as OFF.

Default live run is the 3 complex pairs (6 calls). Bench streams only to record TTFT; production GM stays `stream=false`.

```bash
node --conditions=react-server --import tsx --test src/lib/trpg/thinkingBench.test.ts
npx tsx --conditions=react-server scripts/trpg-gm-thinking-bench.ts --dry-run
npx tsx --conditions=react-server scripts/trpg-gm-thinking-bench.ts
```
