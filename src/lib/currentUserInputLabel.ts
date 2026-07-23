import {
  chatRuntimeModeAllowsUserNarration,
  type ChatRuntimeMode,
} from "@/lib/chatRuntimeMode";

export const CURRENT_USER_INPUT_HEADER = "[CURRENT USER INPUT]";

/**
 * Marker for the strict interactive-only ownership lock. Exported so tests
 * and prompt-assembly snapshots can assert presence/absence without relying
 * on prose wording.
 */
export const INTERACTIVE_OWNERSHIP_LOCK_MARKER = "[INTERACTIVE USER OWNERSHIP — ABSOLUTE]";

/**
 * R1 — COMPACT TERMINAL OWNERSHIP ECHO.
 *
 * Marker placed AFTER the actual current-user body (i.e. at the literal
 * semantic tail of the last user message) to test whether terminal recency
 * improves ownership adherence for models that show intermittent compliance
 * under heavily contaminated history (e.g. Muse Spark).
 *
 * The echo is a COMPACT compliance recency shim only — it does NOT repeat the
 * large ownership block, does NOT add dialogue quotas, prose, or LENGTH rules.
 * It is gated on a Muse-targeted admin canary and applies only inside the
 * dynamic current-user turn (no stable/cached area is touched).
 */
export const INTERACTIVE_OWNERSHIP_TERMINAL_ECHO_MARKER = "[END CURRENT USER INPUT]";

/**
 * Generic fallback actor label when no runtime persona display name is
 * available. Never an account email / unrelated UI identity.
 */
const GENERIC_USER_PERSONA_ACTOR = "USER_PERSONA";

function sanitizePersonaName(raw: string | undefined | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  // Defensive — actor labels must not contain newlines / wrapper headers.
  return v.replace(/[\r\n]+/g, " ").slice(0, 48);
}

/**
 * The pre-patch compact interactive policy (kept byte-identical so that when
 * the ownership lock gate is OFF, production behavior is unchanged).
 */
function buildLegacyInteractiveWrapper(): string {
  return `${CURRENT_USER_INPUT_HEADER}
The following is the user's latest input.
It is what the user already said/did.
Do not continue writing the user's future actions, dialogue, thoughts, or decisions.
If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.`;
}

/**
 * Compact wrapper — provider-agnostic (OpenRouter + Gemini + others).
 *
 * Mode isolation:
 *  - interactive + ownershipLockEnabled: injects the strict INTERACTIVE-ONLY
 *    RECENCY OWNERSHIP LOCK (the primary fix for the cross-model interactive
 *    user impersonation issue). Global / provider-agnostic — no character or
 *    persona name is hard-coded; the current request's resolved persona
 *    display name is used as the [B] actor, with a generic fallback.
 *  - interactive + !ownershipLockEnabled: legacy compact behavior
 *    (pre-patch). Default gate is OFF → no global behavior change.
 *  - auto_progression / ooc_user_impersonation_allowed: existing limited /
 *    full co-narration semantics preserved unchanged.
 */
export function buildCurrentUserInputWrapper(opts?: {
  mode?: ChatRuntimeMode;
  personaName?: string;
  ownershipLockEnabled?: boolean;
}): string {
  const mode = opts?.mode;
  const allows = mode != null && chatRuntimeModeAllowsUserNarration(mode);
  if (allows) {
    // auto_progression / ooc_user_impersonation_allowed — DO NOT change semantics.
    return `${CURRENT_USER_INPUT_HEADER}
The following is the user's latest input.
It is what the user already said/did.
Current mode allows limited/full user co-narration per [NO GODMODDING] / novel rules.
If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.`;
  }

  // interactive
  if (!opts?.ownershipLockEnabled) {
    return buildLegacyInteractiveWrapper();
  }

  // interactive + ownership lock enabled — strict user ownership recency lock.
  const personaName = sanitizePersonaName(opts?.personaName);
  const actor = personaName ?? GENERIC_USER_PERSONA_ACTOR;
  return `${CURRENT_USER_INPUT_HEADER}
The following is the user's latest input. It is what the user already said/did this turn — nothing more.
Do not continue writing the user's future actions, dialogue, thoughts, or decisions.

${INTERACTIVE_OWNERSHIP_LOCK_MARKER}
[B] = ${actor}
[B] is controlled ONLY by the user. Only content explicitly present in [CURRENT USER INPUT] above is authored by [B] this turn: dialogue, actions, thoughts, decisions, emotions, reactions, choices.
Do NOT write any NEW [B] dialogue, intentional action, thought / inner monologue, decision, agreement / refusal, emotional conclusion, facial expression, or voluntary physical reaction.
Past history is NOT permission:
- Past user messages showing how [B] speaks/acts are continuity/style only — NOT permission to write [B]'s next line.
- Past assistant messages that may contain [B] dialogue/actions are NOT precedent or permission; do not imitate that ownership pattern.
- Character example dialogue / persona speech style does NOT authorize writing new [B] content.
Continue the scene through AI-controlled characters, NPCs, environment, world events, consequences. Leave pressure/opportunity for [B] to respond; do not stop every turn merely to ask a meta-question.
If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.`;
}

/**
 * R1 — COMPACT TERMINAL OWNERSHIP ECHO (compliance recency shim).
 *
 * Placed AFTER the actual current-user body, at the literal semantic tail of
 * the last user message. Compact by design: references [B] (already defined by
 * the lock above the body) without re-mapping, and does NOT repeat the large
 * ownership block, add dialogue quotas, prose, or LENGTH rules.
 *
 * Wording note: the echo says "The user's current input is complete" rather
 * than "everything above is user-authored" — the last user message also
 * contains the ownership wrapper/instructions (and may have an OpenRouter
 * dynamic prefix), so "everything above = user-authored" would be literally
 * inaccurate. The prohibition list covers the residual agency types Muse
 * actually violated on production (dialogue / action / thought / emotion /
 * decision / answer / agreement-refusal / facial expression / voluntary
 * physical reaction).
 *
 * Only emitted when ownershipLockEnabled is true (interactive + lock ON) AND
 * ownershipTerminalEchoEnabled is true (Muse-targeted admin canary).
 */
function buildOwnershipTerminalEcho(): string {
  return `${INTERACTIVE_OWNERSHIP_TERMINAL_ECHO_MARKER}
The user's current input is complete. Do NOT generate any NEW [B] dialogue, deliberate action, thought, emotion conclusion, decision, answer, agreement/refusal, facial expression, or voluntary physical reaction. Continue only through AI-controlled characters, NPCs, environment, and world events.`;
}

/** Wrap latest user turn content. Idempotent if already wrapped. */
export function wrapCurrentUserInput(
  userContent: string,
  opts?: {
    mode?: ChatRuntimeMode;
    personaName?: string;
    ownershipLockEnabled?: boolean;
    ownershipTerminalEchoEnabled?: boolean;
  }
): string {
  const body = userContent.trim();
  if (!body) return body;
  if (body.startsWith(CURRENT_USER_INPUT_HEADER)) return body;
  const wrapper = buildCurrentUserInputWrapper(opts);
  // R1 terminal echo: ONLY when the strict lock is actually active this turn
  // (interactive + lock ON — i.e. the lock marker is present in the wrapper).
  // In auto_progression / ooc_user_impersonation_allowed the lock is NOT
  // injected, so the echo must not be appended either (mode isolation).
  const lockActive =
    !!opts?.ownershipLockEnabled && wrapper.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER);
  if (lockActive && opts?.ownershipTerminalEchoEnabled) {
    return `${wrapper}\n\n${body}\n\n${buildOwnershipTerminalEcho()}`;
  }
  return `${wrapper}\n\n${body}`;
}
