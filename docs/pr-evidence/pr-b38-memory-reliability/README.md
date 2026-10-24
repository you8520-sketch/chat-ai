# B38 — episode admission and narrative `draft`

Base: `70194d359f3b03a435702af267dfb1540077cc8f` (includes the requested B37 merge `d3f964fb`).
Implementation: `994a8f71ac9103e81d276ef856e218961176a36c`.

## BEFORE / PROBLEM

| Item | Status | First confirmed failure |
| --- | --- | --- |
| A: T80 | `ROOT_CAUSE_FIXED` for source admission | OOC router: `rp_scene_reset`; record filter: eligible; scope classifier: `plain_ooc`. A generic settings keyword overrode the already identified RP scene. T80 disappeared from both the summary input and episodic eligibility. |
| B: T99 | `ROOT_CAUSE_FIXED` | The original source triggers the bare `draft` marker at character 8,952 (70.8% of the response). `trimTrailingVisibleSelfCritique` returns `UNSAFE_TO_TRIM`; the first stream-end gate throws `MetaLeakageAbortError` before finalize/save. |
| C: T14 | `ROOT_CAUSE_UNCONFIRMED` for the reported model overclaim | The supplied source can be verified as a character claim through new local storage, retrieval, and context assembly. The original B37 Gemini answer, memory state, and wire are unavailable. No equivalent model overclaim was reproduced. |

The user supplied 24 external USER/assistant source messages: T14–16, T76–81, T98–100. These are **external RP source**, not HAV saved messages or B37 model outputs. All original text and complete new local wires/results remain outside Git. Public tests use unrelated synthetic festival/administrative scenes.

## AFTER

`classifyMemoryTurnScope` now honors the existing `rp_scene_reset` classification before applying plain OOC adjustment keywords. Explicit noncanon, branch control, and preference rules retain their earlier precedence. Summary and episodic consumers already share this owner; no second classifier was added.

Source interpretation matters: T80 requests a new episode in the existing world; T81 explicitly retains it as a past memory while returning to the prior scene. The source does not explicitly declare noncanon. This repair admits that source as a new RP episode. It does **not** promote stored noncanon records or establish legal marriage from a proposal. Explicitly noncanon scenes still stay outside main/Episodic injection.

`draft` alone is removed from both the trim anchor list and chunk corroboration regex. Existing explicit output-planning/self-review signals and the separate RP meta detector remain. There is no replacement word ban or output-length change.

## REMOVED

- Two bare-word `draft` matches.
- B37 runner's T99 source-word substitution, its error retry, and its now-unused failed-row deletion helper. Their only reader was that workaround; they have no production caller or stored-data contract. The historical B37 results document remains a record of the old run. The 100-turn runner was **not run** for B38.

## PRESERVED

RAW 4 turns; five-turn summaries; Medium; manual Global boundaries; independent Episodic; Relationship Durable Ledger; explicit branch/noncanon separation; source authority; regeneration ownership; adult/security policy; models, routing, billing, and output policy. No schema, production-data write, automatic historical backfill, merge, or deploy.

B37 HTML prose preservation and transcript export remain covered by their existing tests.

## PROOF

New isolated fixtures run against base production code and the implementation. No network is allowed in deterministic fixtures.

| Source fixture | Base | Implementation |
| --- | --- | --- |
| T80 scope | `plain_ooc` | `main_rp` |
| T80 admitted to actual rolling-summary prompt | no | yes |
| T80 episodic eligibility | false | true |
| Proposal in composed/stored summary, Global rebuild, and Medium projection | absent | present |
| T99 trim result | `UNSAFE_TO_TRIM` | `CLEAN` |
| T99 actual `POST /api/chat`, provider response stubbed from original source | failed assistant, no `done`, one provider request | completed assistant, one provider request |
| T99 final SSE `finalContent` = saved DB content | no completed response | yes; both original `draft` occurrences remain |
| T14 proposed claim + verified original quote | stored/retrieved as `CHARACTER_CLAIM` | same |
| T14 final assembled evidence label | character statement / unconfirmed claim | same |

T99 raw source: 12,645 characters. Saved final text: 12,632 characters; the difference is exactly 13 whitespace deletions in existing processing, with no non-whitespace loss. The output was not shortened to evade the gate.

The T80 summarizer is a **controlled stub**, conditioned on which original source turns reach it. Its composed/stored text proves admission, persistence, and projection, not stochastic LLM summarization or real recall quality. The T14 extractor candidate is also controlled; the source quote and source-role verification are real. Source turn numbers are retained in these bounded fixtures; omitted history was not regenerated. Rebuilt recall and ordinary-scene contexts were inspected, but no successful live model answer is available.

C owner audit: persistence verifies the quote and writes server-owned evidence authority; `resolveEpisodicPromptFactText` injects the verified quote with its origin label rather than upgrading the extractor's gloss. `contextBuilder` includes one full `HISTORICAL_TRUTH_POLICY_BLOCK`; an applicable current-user recency reference precedes the terminal length instruction. The new T14 context retains its unconfirmed-claim label. Original B37 five-turn/Global/Medium versions and the model-adapted historical wire cannot be audited without those artifacts. This evidence does not justify changing storage, adding a second historical policy, or claiming that the original model mistake was fixed.

Public regressions cover ordinary military/administrative `draft`, quoted and mixed-language dialogue, short and long prose, explicit English self-review, streaming chunks splitting `draft`, send/regen/continue histories, episodic persistence/recall/regeneration, explicit noncanon exclusion, OOC controls, manual memory projection, source evidence, historical truth, HTML preservation, and export.

Validation results are recorded in `validation.json`. The existing C5 trim test depends on the absent, untracked `data/luna-user-tail-length-c5-cache.json`; it fails with the same `ENOENT` on base and implementation. The new self-review fixture passes without that cache. The full canonical suite was invoked but stopped after unrelated billing/UI/config/fixture failures. It did not complete; there are no final full-suite counts and no full-suite pass claim. Observed failure titles are recorded separately and were not repaired in B38.

## Live comparison / cost

Only a two-answer Gemini 3.8 Flash comparison was planned. Catalog prices were checked: input $0.825/M tokens, output $4.125/M tokens. The experiment reserved a conservative byte-count input bound and 16,384 output tokens per request; total reservation had to stay below $0.45, using ₩2,000/USD as a budget ceiling. This was a local experiment envelope, not a product output cap. No 100-turn paid replay or long-run generation was attempted.

The first attempt failed DNS before reaching the provider. Using the environment's inherited proxy, the next attempt returned **HTTP 401 `User not found`**. The comparison stopped; no live generation completed, no token usage/cost was returned, and no second comparison answer was requested. Estimated new inference cost: **₩0**; account billing was not independently queried. Deterministic provider stubs report zero tokens/cost. No RP quality score is assigned.

## REGRESSION RISKS / FOLLOW-UP

- T80 admission is repaired; whether a live summarizer retains every important beat and Gemini answers correctly still needs a successful, bounded comparison. Existing missing summaries require the existing regeneration workflow; B38 does not mutate old records automatically.
- Explicit noncanon recall remains unavailable through the ordinary Global/Medium/Episodic reader. A selective, labelled recall path is separate follow-up; globally injecting or promoting those records would violate the existing separation. No such behavior is claimed as fixed.
- A standalone `draft` without any planning/self-review signal can no longer trigger this gate. Real self-review still needs contextual evidence. Other broad markers were not expanded or refactored.
- T14 attribution survives this new deterministic pipeline. Original B37 summary/Global/Medium/wire/model evidence is still needed to locate the historical overclaim. No speculative prompt or storage change.
- Replaying the long T99 source in 137-character chunks showed transient append duplication in the helper-only event replay. The actual route's terminal `finalContent` matches persisted text. No stream reconciliation rewrite was added; investigate transient presentation separately.
- No T150/300/500/1,000 memory claim. Original character/persona cards were not supplied; the route fixture uses a temporary character, not a fidelity comparison.

One Draft PR; GPT review required. Do not merge or deploy.
