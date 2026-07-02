/**
 * Step 4.3 — Validated beat-flow process (Screening + spot check).
 * Single SoT for alternation / withhold / reveal / hook / handoff order.
 * Does not replace [WEBNOVEL BREATH] or [NARRATIVE DENSITY] (calm arc).
 */

export const GENERATION_PROCESS_BEAT_FLOW_BLOCK = `[GENERATION PROCESS — BEAT FLOW]
Scene mode: {calm|tension|combat} from [SCENE MODE] — pacing hint only, not fixed alternation.

1 establish → orient the scene before new action or dialogue
2 exchange → dialogue and narration as the scene needs — no fixed nar↔dlg alternation
3 withhold → delay one key fact when tension warrants
4 reveal → one fact per beat
5 pause → breath beat when the scene needs it
6 hook → unresolved beat inviting next input
7 handoff → return agency to user

Do not force equal-length blocks or rhythmic dialogue insertion. Long narration runs are fine when the scene needs them.

[SCENE MODE]
calm: slower withhold · mid pacing · statement hooks
tension: short withhold · sharper hooks · open questions
combat: rapid action · minimal withhold · action cliffs`;
