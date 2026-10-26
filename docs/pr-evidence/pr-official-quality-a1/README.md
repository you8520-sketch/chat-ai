# A1 — PR #1734 GPT review supplement

Base main: `ba14f3d76441a13b1fa92c501abe2c66ca039209`. Reviewed initial PR HEAD: `2e76acbbc7f10a4f26e217514e63dbf3323d8646`. This supplements the same Draft PR. Final HEAD is recorded in the PR body. No paid provider call, new character generation, production mutation, image/lorebook change, merge or deployment.

## BEFORE

The canonical path is `author.ts` / `authorPrompts.ts` / `bible.ts`: Part1 → Voice → Bonds → assembly → existing compile / QA / Text Lock candidate. The manual pilot owns workflow retries and accounting in `official-supply-pilot-author.ts`.

Initial A1 fixed missing causal handoff and authored public-copy loss. It sent complete selected facts as JSON, all appearance fields plus shared-world context to Voice, and that same public context to targeted revisions even though their public manuscript generation was disabled. Its file writer recomputed and embedded full `canonReview.sources` and `.compiled` on eight candidate-write paths.

## PROBLEM / ROOT CAUSE

- The recap repeated JSON field names and escaping around complete prose. Voice/user and Bonds/user repeated system-owned rules. Three generation calls are stateless: Voice and Bonds both need causal facts, so omitting them from one merely because the other received them would lose context.
- Targeted revision always built public-writing context. Speech/tags correction does not write a public manuscript or opening scene; greeting correction already receives the current greeting and actual entry.
- No runtime reader consumes stored `canonReview`. The existing read-only review owner recomputes it from source and compile. Embedding it is an unnecessary second copy and makes appearance/asset-plan writes do unrelated work.
- Public-manuscript failure is before Bonds and before a complete bible exists. The existing outer retry consequently restarts Part1. The existing targeted revision repairs only greeting/short pitch/speech/tags after assembly; it does not provide a pre-Bonds partial-result reuse owner.

## AFTER / CANONICAL OWNERS

- `author.ts` keeps **all selected complete core strings** but serializes them with compact Korean labels. Exact duplicate values within the same labeled group are emitted once; separate independent facts and their causal roles are retained. No sentence clipping, 1200-char cap, semantic summarizer or summary store is introduced.
- Normal Voice and Bonds retain the same core facts: identity/status/authority, behavior, contradiction, desires/values/taboos, every selected event→choice→residue, ability scope/limit/cost, current incident and entry. Both tasks explicitly depend on this common information. They remain separate stateless calls.
- Normal Voice selects public identifying looks through the existing `publicAppearanceFacts` owner: hair, eyes, skin, build, distinguishing features, plus full default outfit and height. Its source-preserving mode keeps every clause of selected fields; the old display/fallback mode is unchanged. Face-shape, hair-length, musculature and other unselected visual refinements are not duplicated into this prose request. The original full appearance source is unchanged. Full shared-world context remains intact: it supplies the public background, faction and capability constraints that the personal recap does not contain.
- All existing targeted revisions omit public context. Greeting and short-pitch revisions keep entry; speech/tags revisions omit only that opening-only field. Their common causal source remains intact. Existing public manuscripts, Part1, selfDrive, NPCs and unselected fields are preserved.
- Seven prompt positions consolidate duplicate system/user instructions. Output skeletons still express required fields, adult/SFW branching and optional empty arrays. Common relationship/agency, Market Fit, originality and NPC/secret rules remain with their existing owners.
- `characterReview.ts` remains the sole derived-evidence owner and appends fresh evidence to the existing read-only review report. It now also reviews a pre-image narrative source without requiring an Appearance Lock. Existing reports with a lock keep their prior body byte-for-byte.
- The existing file writer drops an old embedded `canonReview` on the next ordinary save; it does not compute a new one, eagerly migrate files or create a review store.

## REMOVED / WRITER-READER-DATA IMPACT

- **1 canonical JSON field:** `canonReview`, containing **2 duplicated subtrees** (`sources`, `compiled`). Its type declaration and the writer's evidence import/computation/injection are removed.
- **1 unconditional revision public-context construction**, covering all targeted revision fields. Opening-only entry is additionally omitted for speech/tags.
- **7 prompt duplication positions** consolidated: Voice user relation meta-rule, repeated user-gender instruction, Voice output/NPC boilerplate, overlapping Bonds relation summary, repeated relationship-outcome rule, cast auto-fill boilerplate, Bonds output/adult boilerplate.
- **8 existing write call sites** remain ordinary candidate writes; **0** of them recompute review evidence. There is no stored-evidence consumer to preserve. `characterReview.ts` ignores an old embedded packet and recomputes from canonical source. No committed character source contains this field, and no production data was investigated or changed. Previously written local candidates lose only the obsolete field when next normally saved.
- Legacy public-copy fallback is **KEEP**, with its existing readers and old output unchanged. The short pitch is **KEEP** for bible QA, Market Fit review and existing short-pitch correction; it is not the displayed page body.

## PRESERVED

The initial A1 public manuscript fix remains: the same Voice call directly authors detailedDescription/creatorComment, existing public-text validation runs before Bonds, assembly preserves them, and the existing compiler/form-save path stores/displays them. Public prose is not a second RP canon source. RP uses the existing setting/speech→public_canon→chunks→contextBuilder route.

Normal generation is still 3 calls. Provider/model/prices/maxTokens, physical accounting, outer retry, targeted revision, optional NPC repair and opt-in six-call budget are unchanged. Canon uncertainty remains `REQUIRES_GPT_REVIEW`, `semanticVerdict: null`. Current Market Fit/relationship policy, player agency, normal/legacy fixtures, greeting/tagline/speech, Text Locks and approved #50/#51 source, images and lorebooks remain unchanged.

## PROOF — INPUT ESTIMATES

Identical four existing public fixtures, mock completions, revision fields and reasons at all three versions. The final transport system/user texts are recorded in full. Live transport uses `json_object` rather than sending the schema as an extra prompt. These are the repository UTF-16 character heuristic, **not actual provider tokens/cost**. Component estimates overlap and round separately; they are not additive budgets.

| Item (four-fixture range) | main | Initial PR #1734 | Optimized |
| --- | ---: | ---: | ---: |
| Part1 | 3,779–3,935 | 3,779–3,935 | 3,779–3,935 |
| Voice | 3,312–3,437 | 6,518–7,009 | 5,640–6,063 |
| Bonds | 3,323–3,468 | 5,161–5,533 | 4,649–5,021 |
| Three-call total | 10,414–10,820 | 15,495–16,461 | 14,105–15,019 |
| Optional greeting correction | 4,146–4,475 | 7,151–7,544 | 5,636–5,810 |
| Optional speech correction | 3,375–3,499 | 6,134–6,624 | 4,478–4,743 |
| Optional tags correction | 3,451–3,571 | 6,208–6,696 | 4,552–4,819 |
| Optional short-pitch correction | 3,611–3,762 | 6,379–6,887 | 4,875–5,190 |
| Normal generation calls | 3 | 3 | 3 |
| Complete selected causal handoff | Missing | Preserved | Preserved |

| Fixture | main total | Initial PR total | Optimized total | Reduction vs initial |
| --- | ---: | ---: | ---: | ---: |
| relation-start-free | 10,414 | 16,016 | 14,657 | 1,359 / 8.49% |
| relation-start-relationship-bound | 10,769 | 16,332 | 14,861 | 1,471 / 9.01% |
| relation-start-role-bound | 10,602 | 15,495 | 14,105 | 1,390 / 8.97% |
| relation-start-role-bound-field | 10,820 | 16,461 | 15,019 | 1,442 / 8.76% |

Optional revisions drop **21.0–29.2%** relative to initial A1. Normal input remains **3,503–4,243 estimated tokens above main**: main omitted causal history/limits/values/entry and did not request the public manuscripts. Full field-level costs and retained/omitted-field purposes are documented; a larger reduction is not obtained by silently cutting those facts.

Evidence:

- [Stage/component sizes for all four fixtures](review-input-metrics.json): system, user, recap, publicContext, world and appearance contribution, plus all four revision targets.
- [main requests](review-main-requests.json), [initial PR requests](review-initial-requests.json), [optimized requests](review-optimized-requests.json): complete final inputs at all three versions.
- [Field preservation](review-fact-preservation.json): **124 complete selected source values × Voice/Bonds = 248 successful presence checks**, exact source values/hashes, selected appearance and full world context. Presence is not literary approval or proof that a claim is true.
- `input-before.json`, `input-after.json`, `input-metrics.json` are retained **initial A1 historical receipts**, superseded by the `review-*` comparison above. Canon review JSON packets are explicit review outputs, not canonical character storage.

## PROOF — FAILURE / RETRY / COST AUDIT

Actual audited owners: `generateOfficialCharacterBible` public validation → `generateOneCharacter` → `runWorkflowStep`. The existing workflow defaults to `--attempts=3`. Failed attempts save the cost report, pass error feedback to the next character attempt, wait with the existing delay, then quarantine after exhaustion. No recovery owner caches the successful Part1 of a pre-Bonds failure.

| Free deterministic scenario | Simulated provider order / count | Existing accounting |
| --- | --- | --- |
| Valid character | P→V→B / 3 | 3 completed calls |
| Missing intro or HTML intro, then success | P→V→P→V→B / 5 | All 5 completions billed in mock report, including rejected Voice |
| Malformed Voice JSON, then success | P→V→P→V→B / 5 | The malformed completed response remains billed |
| Voice transport error without usage, then success | P→V(error)→P→V→B / 5 | 1 failed provider attempt; its cost remains null, not proof of a free failed call |
| Voice truncation, then success | P→V(length)→P→V→B / 5 | Typed truncation carries usage/cost into failed-attempt accounting |
| Public manuscript invalid in all 3 attempts | P→V→P→V→P→V / 6 | No Bonds; 2 workflow retries; all completed responses accounted |

The six-call cap is shared across attempts **only when `npcRelationRepair` is enabled**; it is not a default global six-call limit. The tests use the existing cap/accounting wrappers and a local mock of the audited outer retry, **not an executed live pilot CLI or a new product retry controller**. Synthetic `$0.01` completions test ledger arithmetic; actual provider calls and actual spend are **0**. Unknown usage is explicitly null. The existing failure/refusal behavior is preserved.

Public validation before Bonds remains intentional. Current targeted revision is after full assembly and cannot reuse an absent bible. Moving this failure to the later repair loop requires public-manuscript repair mapping and a changed failure boundary; retaining partial Part1 requires a recovery/reuse path. Under the ticket's **STOP for call-structure changes**, neither is implemented. Part1 re-call risk remains disclosed for GPT review; there is no speculative guard or claim that it was fixed.

The unchanged Voice output cap is 8000. New prose still targets detailed intro 600–1000 chars and comment 150–250 chars. The existing largest target-size fixture is approximately 4625 estimated tokens. This is not a guarantee for a real model: the storage maximum and verbose output can still truncate. Existing typed length failure/accounting remains tested; no cap, model or price is changed.

## PROOF — REGRESSION AND VALIDATION

- Exact reviewed HEAD with the final 10 review checks: **7 pass / 3 fail**. Failures: redundant inputs, revision public context, and read-only pre-image review. After optimization these checks pass, including long complete clauses, causal facts, unchanged public manuscripts and billing/refusal behavior.
- Related 11-file regular regression, lint, app typecheck, isolated build and full-typecheck baseline comparison are recorded in [validation.json](validation.json). Full typecheck is not green: main/current have 2339 existing diagnostics with no new file/code/source-line/column anchors. TypeScript can reorder/truncate type displays, so counts alone are not used to classify new errors.
- Existing save/read/chunks/final RP, normal characters, shared world, zero truncation, Text Lock continuity, legacy fallback, independent reporting principle and unresolved-canon checks remain covered. Read-only review recomputes even if an obsolete embedded packet is supplied; no appearance lock is needed for narrative review.
- Existing `isolatedTestDatabase`, regular provider-key stripping, and `TMPDIR=/var/tmp` are reused. No shared DB test-infrastructure change or experiment runner is introduced.

Commands (same regular-suite execution contract):

```sh
TMPDIR=/var/tmp node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test \
  src/lib/officialSupply/author.test.ts \
  src/lib/officialSupply/officialSupply.authorQualityHandoff.test.ts \
  src/lib/officialSupply/officialSupply.voiceBudget.test.ts \
  src/lib/officialSupply/officialSupply.correction.test.ts \
  src/lib/officialSupply/officialSupply.authorBudget.test.ts \
  src/lib/officialSupply/officialSupply.publicQuality.test.ts \
  src/lib/officialSupply/officialSupply.relationStart.test.ts \
  src/lib/officialSupply/officialSupply.promptStandard.test.ts \
  src/lib/officialSupply/officialSupply.marketFit.test.ts \
  src/lib/officialSupply/officialSupply.worldIntroCanon.test.ts \
  src/lib/officialSupply/officialSupply.relationshipLorebook.test.ts
npm run lint
npm run typecheck:app
npm run typecheck
# isolated DATA_DIR; paid-provider/remote-DB variables blank; synthetic >=32-char SESSION_SECRET
npm run build
```

## REGRESSION RISKS / REMAINING

No measured provider saving or newly generated literary-quality result is claimed. Korean labels and JSON keys can tokenize differently; the heuristic ratios are not a guarantee of actual token or cost savings. Normal input is still above main for the documented retained facts; selected field lengths have no arbitrary hard cap. A real model may interpret the compact labels differently; future approved generation measurement and GPT source review remain necessary.

GPT must assess original prose, claim provenance, uncertainty, selfDrive grounding/uniqueness, field consistency, Korean style, market appeal, supported choices and agency. The public-pilot candidate evidence is not the private approved r2 or production DB. The approved-source loader is not changed or substituted.

Retry recovery/public-copy repair, paid generation/token/cost measurement, RP scoring, image/style work, automatic registration/release and other genres remain separate follow-ups. **Update only Draft #1734, request GPT re-review, then STOP. No merge, deployment or production writes.**
