# DeepSeek historical length instruction provenance

DEEPSEEK_LENGTH_PROMPT_PROVEN: true
DEEPSEEK_LENGTH_PROMPT_NOT_PROVABLE: false
HISTORICAL_LENGTH_ALREADY_PRESENT: false

## Provenance

- file: `src/lib/deepseekPromptStructure.ts`
- commit/ref introduced: `53efcab01ab86c9b1485b9e10c1c9e46a400f939`
- commit/ref removed from production injection: `64d6c47ce761eba46dc88ec2158a9cfbdd18be0a`
- artifact: `src/lib/deepseekPromptStructure.ts`
- exact_text_sha256: `d959d89100021506be6c1fcc1efe4182722c2a2a1e855c18b640a55113262183`
- placement: current user-turn prefix, immediately after DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY (historical prependDeepSeekBottomReminder)
- historical_model: DeepSeek V4 Pro (xml-mode user-turn reminder)
- historical_purpose: DeepSeek-only single-call length stabilization so recent short assistant replies are not imitated as the desired length

## exact_text

```
[DEEPSEEK LENGTH — SINGLE CALL]
Complete the requested narrative depth in this single response. Obey TARGET_LENGTH / MINIMUM_FLOOR independently of the length of recent messages; never imitate a short prior assistant reply as the desired response length.
```

No new wording. Common USER_TAIL length owner is a different Korean sentence and is already present; it is not duplicated.
