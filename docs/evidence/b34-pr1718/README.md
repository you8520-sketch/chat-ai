# B34 PR #1718 quality evidence bundle

| File | Purpose |
|------|---------|
| [REPORT.md](./REPORT.md) | Human tables: quote, fact_text, parse/persist stage, stored |
| [live-runs-detailed.jsonl](./live-runs-detailed.jsonl) | Full Luna `providerText` + per-fact audit (5 OLD + 5 NEW) |
| [execution-conditions.json](./execution-conditions.json) | Model, fixture, DB isolation, credentials |
| [cost-summary.json](./cost-summary.json) | USD/KRW for this capture |
| [prior-summary-only.jsonl](./prior-summary-only.jsonl) | Earlier PR run without provider JSON (recovery) |
| [duplicate-call-defense.md](./duplicate-call-defense.md) | Single-replica vs multi-process duplicate-call notes |

Regenerate: `node --conditions=react-server --import tsx scripts/b34-pr1718-quality-evidence.ts` then `python3 scripts/b34-pr1718-generate-report.py`.
