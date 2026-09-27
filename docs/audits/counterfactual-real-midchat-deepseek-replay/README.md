# Counterfactual real mid-chat DeepSeek replay

Source frozen evidence: PR #620 / `real-production-mid-chat-style-handoff-benchmark`.

Counterfactual: qualifying pre-visible primary refusal assumed; **no** refusal text in history; **no** T3 Gemini in DeepSeek input.

Re-run: `npx tsx docs/audits/counterfactual-real-midchat-deepseek-replay/scripts/run-counterfactual-replay.ts`

Note: `CREATOR_OPENING_PRESENT=false` on final DeepSeek wire is expected — production DeepSeek opening remap peels synthetic opening from message history (greeting absorbed into system-side context); T1/T2 persisted exemplars remain byte-identical on wire.
