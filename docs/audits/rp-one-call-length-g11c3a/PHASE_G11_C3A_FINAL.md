PHASE_G11_C3A_FINAL:
historical reference:
PR: #255
base: cursor/standard-collaborative-lineup-6a91 (PR #250); tip 3af5ec5
route: CheaperInference via application /api/chat → https://api.cheaperinference.com/v1/chat/completions
model: gemini-3.1-pro-preview (requested=resolved)
provider: cheaperinference / Google (catalog)
fixtures: character 18 × persona 61; relationship+action T1→T2
avg visible chars: 4495.75; finish_reason=stop; reasoning_effort=low; retry/cont/recovery=0

current reference:
PR: #300 (C1 Arm A assembly baseline)
base: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
route: OpenRouter assemblePrimaryRpRequest (G11 harness; not /api/chat)
model: google/gemini-3.1-pro-preview
provider: OpenRouter → Google / Google AI Studio (C1 observed)
fixtures: G11 B/D/F
mean visible chars (C1 live): 2178

REQUEST DIFF:
model: DIFFERENT (CI bare vs OR google/ slug)
route: DIFFERENT (CheaperInference /api/chat vs OpenRouter harness)
reasoning: DIFFERENT wire (reasoning_effort=low vs reasoning:{effort:low}+include_reasoning:false); effort label SAME
temperature: SAME 0.95
top_p: SAME omitted
max output: SAME omitted → OUTPUT_TOKEN_CAP_NOT_CAUSE
stop: SAME omitted → no accidental stop delta
message structure: SAME class; fixture content DIFFERENT
system size: UNKNOWN hist exact vs current ~6.5–6.7k chars
history size: UNKNOWN hist exact vs current ~550 chars (fixture)
user tail: USER_TAIL BYTE_IDENTICAL; absolute terminal; no D3 budget

OWNER DIFF:
owner: COLLABORATIVE_INTERACTIVE
historical: present
current: present
text/hash changed: NO (BYTE_IDENTICAL)
position changed: NO (system)
semantic pressure: agency + co-narration (shared)

owner: CURRENT_USER_INPUT wrapper
historical: present (module identical; legacy path)
current: present (legacy; lock OFF for harness userId)
text/hash changed: NO
position changed: NO (user head)
semantic pressure: handoff (“future actions/dialogue/thoughts/decisions”) — shared, not new

owner: IMMERSIVE_PROSE
historical: present
current: present
text/hash changed: NO (BYTE_IDENTICAL)
position changed: NO
semantic pressure: compression + expansion mixed — shared

owner: SCENE_FLOW
historical: present
current: present
text/hash changed: NO (BYTE_IDENTICAL)
position changed: NO
semantic pressure: anti-summarize expansion — shared

owner: USER_TAIL_LENGTH_OWNER_SENTENCE
historical: present
current: present
text/hash changed: NO (BYTE_IDENTICAL)
position changed: NO (absolute terminal)
semantic pressure: expansion 3200–4200 — shared; placement SEMANTICALLY same class

owner: SCENE_PACING / D3 dialogue budget / L1 / P1
historical: 0 / 0 / 0 / 0
current Arm A: 0 / 0 / 0 / 0
text/hash changed: N/A
position changed: N/A

PRESSURE SUMMARY:
handoff: raw=2 weight=MODERATE (shared with hist owners)
closure: raw=3 weight=HIGH (shared)
compression: raw=4 weight=MODERATE (shared IMMERSIVE text)
expansion: raw=5 weight=HIGH (shared length+prose owners)

TOP HYPOTHESES:
1. H1 REQUEST_ROUTE_DELTA
evidence: FOR — CI vs OR, model slug, provider class differ with code+artifact proof; owner constants BYTE_IDENTICAL so route remains largest concrete request delta. AGAINST — no isolated route A/B on same fixtures; C1 provider already confounded Google vs Google AI Studio within OR.
confidence: MEDIUM (delta HIGH; causality MEDIUM)

2. H7 FIXTURE_DOMAIN_EFFECT
evidence: FOR — char18/persona61 rel+action ≠ B/D/F; hist input_tokens≈17.5–21.8k vs current full input ≈7.7k chars; 4496 vs 2178 cannot be prompt regression. AGAINST — does not alone explain short OR Gemini on B/D/F vs length target.
confidence: HIGH (as confound)

3. H3 OWNERSHIP_HANDOFF_PRESSURE (+ H4 compression as co-mechanism)
evidence: FOR — current prompt contains handoff+compression clauses; C1 shorts finish_reason=stop. AGAINST — same clauses BYTE_IDENTICAL in #255 long outputs; not a new strengthened delta.
confidence: MEDIUM as absolute mechanism; LOW as hist→current delta

fixture confound: YES
provider/route confound: YES

classification: NO_SINGLE_ROOT_CAUSE_FOUND

recommended C3B sole variable:
provider_route_only —
identical G11 B/D/F + Arm A prompt assembly;
Arm OR = google/gemini-3.1-pro-preview via OpenRouter;
Arm CI = gemini-3.1-pro-preview via CheaperInference adaptation;
ONE primary LLM call per draw; no retry/continuation/recovery/repair;
do not change owners/budgets/Scene Pacing.

production wire: NOT_RUN
merge: NOT_RUN
LLM calls: 0
STOP.
