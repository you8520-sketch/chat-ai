# B1_D2_FINAL_HARDENING

implementation base: PR #279 (`cursor/rp-numeric-state-variant-switch-b1d2-96c2`)  
implementation tip: `a29e86dd7e0ec2b9bc4d0327f94927792c46632d`  
docs tip: `ca58bbdbf89f07998d3130ceaca57bd627ad9b1d`

## Design (unchanged)

```
LAST_GENERATED != CANONICAL
ACTIVE_SELECTED == CANONICAL
NEW_CANONICAL_SELECTION_EVENT = YES
OLD_EVENT_POINTER_REWIND = NO
REDUCER_RERUN = NO
BEGIN IMMEDIATE = YES
LLM ON VARIANT SELECT = 0
```

## Changes

### P0 — LTM atomic canonical suppression
- `reconcileMemoryAfterVariantSwitchCore(db, …)` is transaction-free.
- Called inside `executeAtomicNumericVariantSwitch` BEGIN IMMEDIATE with message/numeric/status/episodic/trigger mutations.
- Covering summary batch invalidated; `summarized_turn_count` rewound to contiguous boundary.
- Nested transactions avoided (no `reconcileSummarizedTurnCountFromTable` from core).

### P0 — Transaction-local variants
- Atomic core re-reads `messages` row inside BEGIN IMMEDIATE.
- `normalizeMessageVariants()` on txn-local row; preloaded route variants ignored.

### P0 — Numeric pre-txn same-active shortcut
- Route early-return only for nonnumeric path.
- Numeric path always enters atomic; txn-local `IDEMPOTENT_NOOP` when already active.

### P1 — HTTP == DB canonical
- Atomic result returns `canonicalVariants` / `activeVariant` / selected fields.
- Route serializes those for the response (raw snapshot `"80"` cannot leak).

### P1 — Concurrent B/C
- Policy: **last successfully serialized explicit selection wins** (SQLite serialized order).
- Documented + unit-tested via deterministic B then C.

### P2 — Selection provenance
- Selection event `policy_version` / `definition_hash` copied from source extractor event.

## Test matrix

| Gate | Result |
|------|--------|
| P0 LTM atomic canonical suppression | PASS |
| forced LTM failure | FULL_WORLDLINE_ROLLBACK_PASS |
| LTM prior batch preservation | PASS |
| LTM summarized count rewind | PASS |
| LTM re-summary eligibility | PASS |
| transaction-local variants | PASS |
| regen-vs-select lost update | PASS |
| numeric pre-txn same-active shortcut | REMOVED/BYPASSED |
| HTTP canonical response | PASS |
| raw snapshot 80 / canonical 38 | DB=38 HTTP=38 |
| concurrent B/C | PASS (last-wins) |
| selection provenance source policy/hash | PASS |
| existing D→B / reselection / select→normal/regen/delete | PASS |
| frontier / historical / forced rollbacks / nonnumeric | PASS |

## Validation

- `git diff --check`: PASS
- `npm run lint` / `npm run typecheck:app`: PASS
- `node --conditions=react-server --import tsx --test src/lib/rpNumericStateVariantSwitch.test.ts`: 27/27 PASS
- route canary (`scripts/rp-numeric-variant-switch-route-canary.ts`): PASS — see `ROUTE_VARIANT_CANARY.json`
- prompt / model adapter / billing diff: 0
- variant-select LLM calls: 0
- point mutations: 0

## Final report

```
B1_D2_FINAL_HARDENING:

implementation base:
PR head: ca58bbdbf89f07998d3130ceaca57bd627ad9b1d
implementation tip: a29e86dd7e0ec2b9bc4d0327f94927792c46632d

P0 LTM atomic canonical suppression: PASS
forced LTM failure: FULL_WORLDLINE_ROLLBACK_PASS
LTM prior batch preservation: PASS
LTM summarized count rewind: PASS
LTM re-summary eligibility: PASS
transaction-local variants: PASS
regen-vs-select lost update: PASS
numeric pre-txn same-active shortcut: REMOVED/BYPASSED
HTTP canonical response: PASS
raw snapshot 80 / canonical 38:
  DB=38
  HTTP=38
concurrent B/C: PASS (last serialized wins)
selection provenance:
  source policy/hash preserved: PASS
existing D→B: PASS
reselection: PASS
select→normal: PASS
select→regen: PASS
select→delete: PASS
frontier: PASS
historical: PASS
forced existing rollbacks: PASS
nonnumeric regression: PASS
tests: 27/27 PASS
lint: PASS
typecheck: PASS
git diff --check: PASS
prompt diff: 0
model adapter diff: 0
billing diff: 0
variant-select LLM calls: 0
point mutations: 0
final: B1_D2_FINAL_HARDENING_PASS
merge: NOT_RUN
```
