# B10-2 wire-only sentence swap (hypothesis B)

Applied only on variant **B** at POST time. **Not** committed to `historicalTruthPolicy.ts`. Variant **A** uses production assembly unchanged.

## OLD (condition A — live owner on `origin/main`)

```
유저의 독립적인 과거 빈칸은 장면을 해치지 않는 범위에서 가볍게 추정할 수 있다.
```

Source: `HISTORICAL_TRUTH_POLICY_BLOCK` in `src/lib/historicalTruthPolicy.ts`.

## NEW (condition B — not executed this run)

```
유저가 과거의 구체적인 세부를 물을 때 독립 근거가 확인되지 않으면 이를 사실로 확정하지 않고 열린 상태로 둔다. 현재 장면의 새로운 전개와 추측은 자연스럽게 이어갈 수 있다.
```

## Unchanged

The non-denial rule remains on both sides: retrieval miss does **not** prove an event never happened.

Dry gate (`dry-gate/validation.json`): `diffVerified: true`, `oldSentenceCount: 1`, A/B request SHA-256 differ only by this substitution (53-byte delta on wire JSON).
