# G11-C3B LIVE BLOCKED

```text
message_hash_parity: PASS
LIVE_CALL_READY: false
new LLM calls: 0
```

## Blocker

`CHEAPER_INFERENCE_API_KEY` is empty in this cloud agent environment.

- `.env.local` line present but length 0
- Injected secrets: `OPENROUTER_API_KEY` only
- `OPENROUTER_API_KEY` is **not** used as a CI substitute

## Ready path

1. Add `CHEAPER_INFERENCE_API_KEY` to Cursor Cloud Agent Secrets for environment `chat-ai`, **or** write it to `/tmp/ci_key` / `.env.local` (do not paste into chat).
2. Re-run:

```bash
PHASE=live FIXTURES=B,D,F DRAWS=2 node --conditions=react-server --import tsx \
  scripts/rp-quality-g11c3b-route-alias-bundle.ts
```

Frozen B/D/F message hashes already match sealed C3A Arm A snapshots.
