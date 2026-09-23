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
  R_CHARS: 2123
  A_CHARS: 1625
  GE_2700: 0
  GE_3200: 0
ARM_B:
  R_CHARS: 1816
  A_CHARS: 1666
  GE_2700: 0
  GE_3200: 0
ARM_C:
  R_CHARS: 2331
  A_CHARS: 2333
  GE_2700: 0
  GE_3200: 0
PROVIDER_CALLS: 6
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

## Six provider calls (objective only)

All six HTTP 200. All `finish_reason=stop`. All `REASONING_TOKENS=0` (thinking disabled). All `OUTPUT_TRUNCATED=false`. No arm reached 2700. Latencies 34–52s, not 295s. `PROVIDER_COST` null in usage. No 5xx. No seventh call.

| KEY | VISIBLE | IN | OUT | REASON | LATENCY_MS | RAW_SHA256 |
|---|---:|---:|---:|---|---:|---|
| R_A | 2123 | 13482 | 1911 | 0 | 43532 | 6382e7e8ae2aabb79406e066e1e4e723f8886b6424de54b96929f2641566d3af |
| R_B | 1816 | 13673 | 1635 | 0 | 34311 | 0a7464190b861994e97a0e8dc7f0b9418bedb206512fe30a198fafd4fe0a7244 |
| R_C | 2331 | 13614 | 2098 | 0 | 43856 | 738d66a02a6cb7d78b986bf0739e1e69671e52a04f9f34623890510dc078b480 |
| A_A | 1625 | 25023 | 1463 | 0 | 39027 | 9459b0c583c8c04050c3312eb5ede8ebd7b8cbbc2a0a696d87415b84269cc021 |
| A_B | 1666 | 25214 | 1500 | 0 | 37393 | 783cea3ff5dc1181888df7a825fa38ad55180f43dd297f4d6303d50185f7467a |
| A_C | 2333 | 25155 | 2100 | 0 | 52330 | 5b69636d69d7c968c7842fa813c0e6114465e9e6e4d876c453fcd35afd3f6a51 |

Within fixture R, `HISTORY_SHA` and `CURRENT_USER_SHA` are identical across A/B/C. Within fixture A, the same. `SYSTEM_SHA` differs only by the intended length-arm delta.

Deterministic flags (regex, not prose scores): no refusal / meta / system leak / exact sentence dup / new canon / new NPC / unrelated event. `NEW_USER_DIALOGUE_AUTHORED` regex-true on R_A, R_B, A_A, A_B, A_C; false on R_C. `NEW_USER_INTENTIONAL_ACTION_AUTHORED` regex-true on A_B only. Human must review RAW. Do not treat these flags as a winner.

This run `REASONING_TOKENS=0` vs H5 C stored `apiReasoningOutputTokens=6979`. Freeze the conflict. Do not classify H5 C latency from it.
