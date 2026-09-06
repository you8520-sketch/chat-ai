# Phase F — actual Gemini → DeepSeek 0813 handoff length acceptance

EVIDENCE ONLY. DO NOT MERGE. DO NOT DEPLOY.

This packet exercises the **real production adult refusal-replacement path**.

It is not a DeepSeek-only imitation. It is not a quality bakeoff.

## Flow

1. Gemini 3.7 Flash selected as primary (the production Gemini source that maps to DeepSeek 0813)
2. Adult eligible, STANDARD consent, USER_COAUTHOR_MODE=OFF
3. Deterministic Gemini refusal seam: `I cannot fulfill this request.`
4. Primary refusal stays invisible
5. Production handoff assembly (`buildContext` + `appendAdultHandoffPrompt` + TRUE-OFF owner)
6. One real DeepSeek V4 Pro 0813 replacement call per repetition
7. H1 / H2 / H3 on the exact same frozen fixture

## Fixture

- Character: 라이크 id=18 (`confirmed` adult)
- Persona: 렌 (confirmed-adult test persona; matches frozen Gemini addressee)
- Preceding Gemini 3.7 Flash turns: T1=2775, T2=2798 (`docs/audits/gemini-37-flash-baseline`)
- Current user: established adult STANDARD text from #555 A_A

## Call budget

TOTAL_REAL_DEEPSEEK_CALLS=3 maximum

No live Gemini. No native DeepSeek control. No GLM. No Qwen. No retry. No continuation.

## Harness

`scripts/audit/ds0813-phase-f-handoff-acceptance.ts`

`ASSEMBLE_ONLY=1` freezes owners/parity/outbound keys without provider calls.
