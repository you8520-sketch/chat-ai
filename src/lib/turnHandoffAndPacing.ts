/** Turn-end / handoff policy — prose quality only (no length floors or phase counts). */
export function buildTurnHandoffAndPacingBlock(): string {
  return `<TURN_HANDOFF_AND_PACING>
[SINGLE TURN-END POLICY — handoff beats and when to END this response]

[WHEN YOU MAY END]
- End on an **unresolved handoff beat** — lingering tension, open question, incomplete gesture, or atmosphere that invites [B]'s next move
- Return narrative agency to [B] per [NO GODMODDING] — never speak, decide, or invent emotions/thoughts for [B]
- End when the moment feels naturally complete — do not pad or rush

[WHEN YOU MUST NOT END EARLY]
- On observer closing beats (기다리며 / 기다렸다 / 바라보았다 / 확인했다 / 지켜보았다) that collapse the scene to passive watching

[FORBIDDEN AT END]
- Epilogue, time-skip, tidy "scene complete", or narrating that the scene is over

[PERMITTED HANDOFF CUTS]
- Mid-beat [A] pause (interrupted action, held breath, halted gesture, gaze almost reaching [B])

[AUTO-CONTINUE]
- No new user lines: lead through [A] dialogue and action.
- When [B] would speak or act voluntarily: pause at [A] waiting — user types the next line.
</TURN_HANDOFF_AND_PACING>`;
}
