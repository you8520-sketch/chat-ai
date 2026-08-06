# Audit 42 — Final status (pre-human)

```text
offline verdict: DS_LENGTH_X_SCENE_2X2_OFFLINE_PASS
ARM C attempts/valid: 9 / 4
ARM D attempts/valid: 8 / 4
transport exclusions: C=3 · D=3 (finish_metadata_missing / empty / 502)
replacement calls: C=1 · D=1
A average/min/max: 2882 / 2139 / 3267
B average/min/max: 3285 / 2538 / 4620
C average/min/max: 2609 / 2168 / 2893
D average/min/max: 3604 / 3080 / 4389
blind packet: docs/audits/42-deepseek-length-scene-2x2/BLIND_2X2.md
hidden map: docs/audits/42-deepseek-length-scene-2x2/_HIDDEN_ARM_MAP.json
human review: NOT_RUN — waiting for ChatGPT
production DB apply: NO
general rollout: NO
auto merge: NO
auto deploy: NO
canary enabled after test: NO
```

## Safety restore

```text
RP_DIAGNOSTIC_CANARY_ENABLED = false
resolution = null
production branch = main
startCommand = npm run start
health = ok
```

## Notes

- A/B frozen from audit 41 (not regenerated).
- Detector left unmodified before C/D; fixtures for A/B human hard fails deferred until after 2×2 human annotation.
- No PASS / improved / root cause / best arm / production candidate claimed.
- PR #247 remains draft / unmerged / not a production candidate.
