# Muse Spark 1.2 Generic — single-fixture regression capture

This folder is **not** a multi-character generalization audit.

The only complete production-equivalent frozen fixture is the 라이크/렌 adult pair. Extra recovered RAWs still lack a next-user turn and/or character bundle. Fake fixtures and new source generation are forbidden.

```
GENERALIZATION_PROVEN = false
```

That stays false even if Generic looks close to V1 on this one pair.

The only question in this capture:

> 라이크 전용 스타일 힌트를 제거한 Generic Muse Mirror가 source output 자체만 읽고도 기존 Muse V1에 근접한 handoff 품질을 유지하는가?

ChatGPT later marks either:

- `SINGLE_FIXTURE_GENERIC_REGRESSION_PASS`
- `SINGLE_FIXTURE_GENERIC_REGRESSION_FAIL`

Cursor does not declare that. Cursor does not score the literary axes.

## What was called

| Kind | Count |
|---|---|
| Frozen Opus source reuse | SHA `f49f3f9d…ed5cf818` — no new source call |
| Frozen Gemini 3.1 source reuse | SHA `e9c618f9…123ba64e` — no new source call |
| Muse Spark 1.2 Generic, Opus source | n=3 |
| Muse Spark 1.2 Generic, Gemini 3.1 source | n=3 |
| Muse V1 | 0 (frozen Positive RAW reference only) |
| Qwen / DeepSeek / GLM / retry / continuation / recovery / fallback | 0 |

Live default routing is unchanged: Opus → Qwen, Gemini 3.1 → Qwen. Muse Generic is candidate/audit only. Main is not merged. Railway is not deployed.

## Prompt / wire

Production candidate block, exact, unmodified:

`[MUSE SOURCE CONTINUITY — STYLE MIRROR]`

in `src/lib/adultHandoffSourceRouting.ts` (`MUSE_SOURCE_CONTINUITY_STYLE_MIRROR`).

Placement: current-user recency, exactly once, before the existing terminal user-tail owner. System = 0. Like-specific V1 headers = 0. Qwen adapters = 0.

Like-specific V1 phrases must not appear in the Generic adapter (production/audit Generic request occurrences = 0):

- 미세한 환경음과 거리감
- 얇은 농담
- 능글맞음
- 어색하게 비치는 진심
- 장난스러운 반응

Those strings may still exist in frozen V1 artifacts and in character-canon sheets. That is allowed. They must not be re-injected as a Muse style hint.

Transport: Cheaper Inference, `muse-spark-1.2`, temperature `0.7`. Final body must keep `reasoning`, `include_reasoning`, `reasoning_effort`, and `thinking` **ABSENT**.

V1 Positive RAWs are a fixture-specific quality ceiling reference only. They are not wired into the production resolver.

## ChatGPT manual review gate

Cursor does not PASS/FAIL this capture.

Generic should not show a material average-total regression versus V1 on this same fixture. Especially, these three should be at V1 level or better:

- `SOURCE_STYLE_FIDELITY`
- `CHARACTER_IDENTITY`
- `LATE_SCENE_CHARACTER_VOICE`

Generic should also have:

- `CHARACTER_PERSONALITY_INVENTION` = 0
- `USER_SEMANTIC_DIALOGUE_INVENTION` = 0
- `REFUSAL` / `FADE` = 0
- progression stall not higher than V1

Read the blind packets first. Open `REVEAL_MAP.json` only after scoring.

## Artifacts

- `OPUS_GENERIC_1_RAW.txt` … `_3_RAW.txt`
- `GEMINI31_GENERIC_1_RAW.txt` … `_3_RAW.txt`
- `BLIND_OPUS_GENERIC_VS_V1.md`
- `BLIND_GEMINI31_GENERIC_VS_V1.md`
- `BLIND_RUNTIME.json`
- `REVEAL_MAP.json`
- `MANIFEST.json`
- `v1-frozen/` — existing Muse Positive RAW, SHA-checked, not re-called
