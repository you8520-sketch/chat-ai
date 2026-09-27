# Snapshot B wire delta (DeepSeek vs Gemini 3.7)

- DeepSeek system SHA: `9553f557fe831a13e80853bdba8a14895573c6ff87de274e8b9d4fe8e640ddee`
- Gemini system SHA: `50fa7c8abd812e7d4002d4d930283fe39fc7ab6298bad3684f8f9e3cdc67124e`
- DeepSeek last-user SHA: `887628102cabaee2…`
- Gemini last-user SHA: `0bf8b07ee0d9f409…`
- Same capsule history + T2 user; cross-model SHA mismatch expected (adapters).

## DeepSeek-only Snapshot B signals

- `shortHistoryLengthExtraActive`: true
- `openingPeelAppliedOnB`: true
- T1 assistant persisted length: 3473 chars

## PR #1124 reproduction

All three DeepSeek B live samples share **identical** `promptHash` → same provider-bound system prompt per rep.
