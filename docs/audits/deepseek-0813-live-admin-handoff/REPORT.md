# LIVE ADMIN PRODUCTION-EQUIVALENT QUALIFICATION

```
LIVE_ADMIN_HANDOFF_FIXTURE_CAPTURE:
STOPPED_BEFORE_LIVE_CHAT
ADMIN_PARITY_PROVEN:
false
CHARACTER:
null
PERSONA:
null
SOURCE_MODEL:
gemini-3.7-flash
FIXTURE_ID:
null
PRODUCTION_EQUIVALENT:
false
CHARACTER_PROVEN:
false
PERSONA_PROVEN:
false
SPEECH_LOCK_PROVEN:
false
WORLD_CANON_PROVEN:
false
SYSTEM_PROVEN:
false
HISTORY_PROVEN:
false
SOURCE_ASSISTANT_PROVEN:
false
CURRENT_USER_PROVEN:
false
ROUTING_PROVEN:
false
TRANSPORT_PROVEN:
false
DEEPSEEK_CALLS:
0
TURN_OWNERSHIP_TESTED:
false
MULTITURN_CHAIN_LENGTH:
0
MODEL_CALLS_GENERATING_USER_TURNS:
0
SOURCE_MIRROR:
false
COMPLETION:
false
ORIGIN_POINTER:
false
PRODUCTION_CHANGED:
false
MAIN_MERGED:
false
RAILWAY_DEPLOYED:
false
```

## Historical restoration

Stopped. This track does not restore Experiment A, missing Opus RAW, missing Gemini 3.1 RAW, or S3-A plus an unrelated adult-entry user. No synthetic fill.

## Admin parity — STOP

Prompt loaders share the ordinary production code path:

- `buildContext` / `contextBuilder` has no admin branch
- Character chunks, persona, Speech Lock, world/canon, and memory/history assembly are the same functions

Admin privileges still create a **different routing path**. Per the gate, live fixture capture and DeepSeek calls stop here.

| Special path | Effect |
| --- | --- |
| `getSessionUser()` | Admins are forced to `is_adult=1`, which changes `userAdultVerified` and adult-handoff eligibility versus an ordinary unverified user. |
| Adult handoff canary | `chat/route.ts` sets `adultRoutingConfig.enabled = generalEnabled \|\| adminCanaryAccess`. Default `ADULT_SCENE_HANDOFF_GENERAL_ENABLED=false`, so an allowlisted admin chat can receive adult handoff while ordinary chats cannot. |
| Canary GLM override | Canary access rewrites `adultModelPolicyConfig` to force GLM hard-failure fallback on. |
| `shouldFallbackToGlm()` | Still reads `isAdmin` when `ADULT_SCENE_MODEL_POLICY_ADMIN_ONLY` is true. |

Deployed production env flags were not readable from this VM. The special paths exist in the current service code, so `ADMIN_PARITY_PROVEN` cannot be true.

## What was not done

- No login to the deployed homepage
- No invented RP user turns
- No local-DB copy of 플러드 / 이혁 / 로코 treated as production records
- No DeepSeek 0813 calls
- No Turn Ownership A/B
- No multi-turn chain
- No Railway deploy
- No production TRUE-OFF merge
- Chat route does not import the new capture module

## Capture infrastructure (unwired)

`src/lib/adminHandoffAuditCapture.ts` is ADMIN/AUDIT-only, default OFF, metadata/SHA only, and refuses ordinary user chats. It is not wired into `src/app/api/chat/route.ts`, so generation behavior is unchanged.

Existing audit helpers remain:

- `src/lib/deepseekAdultHandoffFixtureCapture.ts`
- `src/lib/deepseekAdultHandoffMultiTurnInventory.ts`
- `src/lib/deepseekAdultHandoffTurnOwnership.ts` (still production-off)

## Next, after ChatGPT review

1. Decide whether production adult handoff should be generally enabled so admin and ordinary chats share one routing path.
2. Only then capture an approved admin audit chat on the deployed homepage, with the human tester typing the user lines.
3. Freeze that fixture before any Turn Ownership A/B.

STOP. Wait for ChatGPT.
