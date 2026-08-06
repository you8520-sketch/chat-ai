# Audit 46 — Human blind verdict (ChatGPT)

ChatGPT read relationship and action packets before the hidden model map.

## Blind relationship rankings

```text
REL-R1T1: C > B > A
REL-R1T2: C > A > B
REL-R2T1: A > B > C
REL-R2T2: B > C > A
```

Hidden map:

```text
REL-R1T1: C=deepseek B=terra A=luna
REL-R1T2: C=deepseek A=terra B=luna
REL-R2T1: A=terra B=deepseek C=luna
REL-R2T2: B=terra C=deepseek A=luna
```

```text
deepseek: first ×2, second ×2
terra: first ×2, second ×2
luna: third ×4
```

## Blind action rankings

```text
ACT-T1: A > B > C
ACT-T2: A > C > B
```

Hidden map:

```text
ACT-T1: A=terra B=luna C=deepseek
ACT-T2: A=terra C=luna B=deepseek
```

```text
terra: first ×2
luna: second ×2
deepseek: third ×2
```

## Overall human verdict

```text
TERRA_OVERALL_QUALITY_WINNER
DEEPSEEK_RELATIONSHIP_VALUE_WINNER
LUNA_STANDARD_RELATIONSHIP_FAIL
```

Approximate quality bands:

```text
terra: 82–85
deepseek: 72–76 overall / 78–82 relationship
luna: 65–70
```

## Product lineup

```text
PUBLIC: deepseek-v4-pro, gpt-5.6-terra
REMOVE FROM PUBLIC PICKER: gpt-5.6-luna
```

No automatic per-scene model handoff. No production pricing change in this audit PR.
PR #249 closes without merge after this verdict is recorded.
