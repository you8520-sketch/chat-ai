# Section 14 — return block

EVIDENCE ONLY. DO NOT MERGE. DO NOT DEPLOY.
NO PROSE QUALITY SCORE. NO PROMPT TUNING. HUMAN RAW REVIEW REQUIRED.

```
BASE_MAIN_SHA: 98f8111a6e81ad9551c3c9c5777032e40f7b4b3d
CURRENT_DS_LENGTH_OWNER_COUNT: 1
CURRENT_DS_LENGTH_OWNER_ROLE: USER_TAIL_LENGTH_OWNER_SENTENCE (current-user-turn terminal length owner)
CURRENT_DS_LENGTH_OWNER_TERMINAL_POSITION: absolute end of current user turn (after layout recency line)
CURRENT_DS_LENGTH_ARM: A
PROMPT_TOKEN_INVENTORY: data/ds0813-length-h5-reliability-audit/PROMPT_TOKEN_INVENTORY.json
DUPLICATE_LENGTH_OWNERS: ARM A false; ARM B/C true (intended adapter add-on, not a second USER_TAIL copy)
DUPLICATE_AGENCY_OWNERS: true (system no-godmodding + current-user collaborative-control paragraph)
DUPLICATE_STYLE_OWNERS: true (system prose-style-xml-bundle + DeepSeek style-only user-turn reminder)
HISTORICAL_DS_LENGTH_OWNER_EFFECT_PROVEN: true
ARM_A:
  R_CHARS: pending_provider
  A_CHARS: pending_provider
  GE_2700: pending_provider
  GE_3200: pending_provider
ARM_B:
  R_CHARS: pending_provider
  A_CHARS: pending_provider
  GE_2700: pending_provider
  GE_3200: pending_provider
ARM_C:
  R_CHARS: pending_provider
  A_CHARS: pending_provider
  GE_2700: pending_provider
  GE_3200: pending_provider
PROVIDER_CALLS: 0 (pre-call revision; 6 max)
RETRIES: 0
CONTINUATION_CALLS: 0
H5_C_295S_CLASSIFICATION: UNKNOWN
H5_C_TIMELINE: sampler HTTP 295489 ms only; see H5_C_295S_TIMELINE.md
MISSING_TIMESTAMPS: request_received, prompt_assembly_*, provider_fetch_start, provider_headers_received, provider_first_delta, provider_last_delta, provider_finish, postprocess_*, db_finalize, SSE_done, usage.latencyMs
STALE_GENERATING_RECOVERY_HELPER_EXISTS: true
STALE_GENERATING_PRODUCTION_CALLERS: src/app/chat/[id]/page.tsx SSR only
CHAT_739_RECOVERY_ROOT_CAUSE: helper not invoked; API/pagination paths skip it; H5 never SSR-loaded /chat/739 after instance replacement
SOURCE_PRODUCTION_BEHAVIOR_CHANGED: false
QUALITY_SCORE_ASSIGNED: false
HUMAN_RAW_REVIEW_REQUIRED: true
```

## Fixture completeness

- Fixture A 라이크 id=18: full production character row from prior readonly dump (`/tmp/like18.json`). `usedEnglish=true`. Local estimate ~25025 tokens; H5 C stored `assembledInputTokens=27071` / provider `input=10753`.
- Fixture R 플러드 id=17: **row incomplete**. `system_prompt` is the production 900-char head of 3505. World copied from id=18 because `world_len` equal and first 500 chars match (`WORLD_BYTE_IDENTITY_PROVEN=false`). Greeting is production message 3794 (580 chars, match). `CHARACTER_17_ROW_COMPLETE=false`. Railway readonly exec was unauthorized in this VM.

A/B/C within each fixture still differ only by the DeepSeek length-arm system delta. History and current-user SHAs are identical inside each fixture.

## Arms (existing wording only)

- A = production / OFF (`resolveDeepSeekLengthAdapterSection` → null)
- B = existing scene-unit completion + existing anti-filler safety
- C = existing strong early-stop sentence + existing anti-filler safety

Common `USER_TAIL` not modified. B+C not stacked. No Gemini. No GLM. No retry. No continuation. thinking disabled in outbound body.
