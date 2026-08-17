# TRPG GM Thinking ON/OFF benchmark

Isolated harness. Does **not** change production GM runtime, campaign rows, HP, inventory, billing, creator rewards, or memory.

Base: PR D initiative branch, so fixtures include `[RESOLUTION ORDER]` where multiple actors act.

```bash
node --conditions=react-server --import tsx --test src/lib/trpg/thinkingBench.test.ts
npx tsx --conditions=react-server scripts/trpg-gm-thinking-bench.ts --dry-run
npx tsx --conditions=react-server scripts/trpg-gm-thinking-bench.ts
```

12 live calls only (6 cases × ON/OFF). Same system/user/model/max_tokens/temperature/timeout. The only difference is `thinking: { type: "enabled" | "disabled" }`. No retry, fallback, continuation, or `reasoning_effort`.
