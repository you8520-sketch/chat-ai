# Persona Secret Compiler v1 → v2 Existing Data Compatibility Audit

**PR:** #677  
**Verdict:** `V1_COMPATIBILITY_GAP_FIXED` (migration script + tests; production apply NOT executed)

## 1. v1 stored data shape (code/schema evidence)

### Compiler version storage

| Location | Column | Notes |
|---|---|---|
| `persona_secret_compilation_runs` | `compiler_version INTEGER` | One row per successful/failed compile; keyed by `(persona_id, source_hash, compiler_version, status)` |

Source text is **not** duplicated in compiler tables. Canonical owner source lives in:

| Location | Column |
|---|---|
| `user_personas` | `secret_description TEXT` |

Recompile path: `compileAndApplyPersonaSecrets({ personaId, source: secret_description, force: true })`.

### v1 rule storage (`PERSONA_SECRET_COMPILER_VERSION = 1`)

From `personaSecretCompilerDeterministic.ts` at compiler v1 (git parent of Phase B):

| Rule method | `dormant` in compile output | DB `enabled` (`upsertDiscoveryRulesStable`) | `conditions_json.dormant` |
|---|---|---|---|
| `DIRECT_DISCLOSURE` | `false` | **1** | `false` |
| `VISUAL_DISCOVERY` | **`true`** | **0** | **`true`** |
| `INVESTIGATION_DISCOVERY` | **`true`** | **0** | **`true`** |

Formula: `enabled = rule.dormant ? 0 : 1` (`personaSecretCompilerApply.ts`).

### v2 rule storage (`PERSONA_SECRET_COMPILER_VERSION = 2`, current)

| Rule method | `dormant` | DB `enabled` |
|---|---|---|
| `DIRECT_DISCLOSURE` | `false` | 1 |
| `VISUAL_DISCOVERY` | **`false`** | **1** |
| `INVESTIGATION_DISCOVERY` | **`false`** | **1** |

### Runtime eligibility change (Phase B / PR #677)

| Version | VISUAL/INVESTIGATION SQL filter |
|---|---|
| v1 runtime | `WHERE ... method='VISUAL_DISCOVERY'` — **included dormant `enabled=0` rows** |
| v2 runtime (current) | `AND r.enabled=1` — **dormant v1 rows excluded** |

**Impact:** Existing v1-compiled personas keep VISUAL/INVESTIGATION rules at `enabled=0`. Under v2 runtime eligibility, S2/S3 discovery returns **0** until rules are recompiled to v2.

## 2. Regression simulation result

Fixture: `"렌의 목덜미에 실험체 017 표식이 있다."` compiled, then downgraded to v1 storage (`enabled=0`, `dormant:true`).

| Stage | VISUAL eligible rules | `runVisualDiscoveryForTurn` |
|---|---|---|
| v1 rows + v2 runtime (pre-migration) | 0 | matchCount=0 |
| After `migratePersonaSecretCompilerV2` | ≥1 | matchCount≥1 |

Same pattern confirmed for INVESTIGATION (`"렌은 거액의 빚이 있다."`).

**Classification:** `OLD_V1_RULES_BECOME_INACTIVE_AFTER_V2_RUNTIME` — **merge blocker without migration**.

## 3. Automatic upgrade paths (production code survey)

| Trigger | Recompiles to v2? | Notes |
|---|---|---|
| App startup | **No** | — |
| Schema migration | **No** | — |
| Persona load / editor load | **No** | Read-only |
| Chat start / chat turn | **No** | Uses existing rules |
| Background job | **No** | — |
| Deploy migration | **No** | — |
| **Persona save** (`savePersonaWithSecretCompilation`) | **Conditional** | Recompiles when `sourceChanged` **OR** no v2 success cache for current `source_hash` |

**Judgment:** Partial lazy upgrade on owner save exists, but users who never save again retain dead S2/S3. **Not sufficient** as sole fix (per audit policy B rejected).

## 4. Resolution implemented (A plan)

| Artifact | Purpose |
|---|---|
| `src/lib/personaSecretCompilerV2Migration.ts` | Candidate detection + idempotent recompile |
| `scripts/migrate-persona-secret-compiler-v2.ts` | Admin CLI; **dry-run default**, `--execute` writes |

Migration behavior:

- Recompile `user_personas.secret_description` with compiler v2 (`force: true`)
- Enables current valid VISUAL/INVESTIGATION rules (`enabled=1`)
- Disables stale removed rules (`enabled=0`, preserved rows)
- **Does NOT touch:** `chat_character_secret_knowledge`, `persona_secret_evidence_events`, `chat_persona_secret_reveals`, `fact_snapshot`

## 5. Idempotency

Second migration run: persona skipped (`not_a_candidate` — v2 success cache exists); persona/compiler tables unchanged.

## 6. Zero-user-impact invariants (tested)

Migration before/after unchanged:

- `chat_character_secret_knowledge` row count + `fact_snapshot` + `knowledge_state`
- `persona_secret_evidence_events` row count
- `chat_persona_secret_reveals` row count

## 7. Production apply

**NOT executed in this PR.** Recommended:

```bash
# backup data/app.db first
node --import tsx scripts/migrate-persona-secret-compiler-v2.ts          # dry-run
node --import tsx scripts/migrate-persona-secret-compiler-v2.ts --execute
```

No app-start DB mutation.

## 8. Tests

`src/lib/personaSecretCompilerV2Migration.test.ts` — 5 scenarios (VISUAL, INVESTIGATION, stale rule, idempotency, knowledge/evidence delta 0).

## 9. Final verdict

**`V1_COMPATIBILITY_GAP_FIXED`**

- Gap confirmed: v1 dormant rules + v2 `enabled=1` eligibility = dead S2/S3
- Migration + tests implemented
- Production DB not modified
- P0 single-authority fixes preserved
