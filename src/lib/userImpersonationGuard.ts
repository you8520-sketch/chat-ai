import {
  isInteractiveChatRuntimeMode,
  type ChatRuntimeMode,
} from "@/lib/chatRuntimeMode";

export type UserImpersonationSeverity = "none" | "low" | "medium" | "high";

export type UserImpersonationDetection = {
  detected: boolean;
  severity: UserImpersonationSeverity;
  reason: string | null;
  matchedPhrase: string | null;
};

export type UserImpersonationGuardLog = {
  mode: ChatRuntimeMode;
  detected: boolean;
  severity: UserImpersonationSeverity;
  reason: string | null;
  matchedPhrase: string | null;
  autoRepairEnabled: boolean;
  repairAttempted: boolean;
};

const SAFE_REFERENCE_RE =
  /대답을\s*기다리|침묵이\s*이어|방금의\s*말\s*이후|네가\s*남긴\s*말|상대의\s*반응을\s*기다리|유저의\s*말을\s*듣|입력을\s*기다리|답을\s*기다리/;

/** Deliberate [B]/user actor patterns — interactive mode only */
const DELIBERATE_ACTOR_RES: Array<{ re: RegExp; severity: UserImpersonationSeverity; reason: string }> = [
  {
    re: /\[B\]\s*(?:는|은|이|가)\s*(?:말했|대답했|되물었|중얼거렸|속삭였|물었|외쳤)/,
    severity: "high",
    reason: "user_dialogue_narration",
  },
  {
    re: /\[B\]\s*(?:는|은|이|가)\s*(?:생각했|결심했|마음을?\s*먹었|동의했|거절했|믿기로\s*했)/,
    severity: "high",
    reason: "user_thought_or_decision",
  },
  {
    re: /\[B\]\s*(?:는|은|이|가)\s*(?:고개를\s*끄덕|손을\s*뻗|입을\s*열|몸을\s*돌|어깨를\s*움츠|그를\s*안|그녀를\s*안|앞으로\s*나갔|자리를\s*떴)/,
    severity: "medium",
    reason: "user_deliberate_action",
  },
  {
    re: /\{\{user\}\}\s*(?:는|은|이|가)\s*(?:말했|대답했|생각했|결심했|고개를\s*끄덕|손을\s*뻗|입을\s*열)/i,
    severity: "high",
    reason: "user_token_actor",
  },
];

const QUOTED_USER_ALIAS_DIALOGUE =
  /^.{0,24}(?:는|은|이|가)\s*[\u201c\u201d"「『].{1,120}[\u201c\u201d"」』]/m;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function severityRank(s: UserImpersonationSeverity): number {
  switch (s) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

/** Feature flag — OFF by default. Extra API repair must never run unless explicitly enabled. */
export function isUserImpersonationAutoRepairEnabled(): boolean {
  const raw = process.env.USER_IMPERSONATION_AUTO_REPAIR?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Detect likely interactive-mode user impersonation.
 * Soft references to waiting / silence / prior user words are allowed.
 */
export function detectInteractiveUserImpersonation(
  text: string,
  opts?: {
    mode?: ChatRuntimeMode;
    userAliases?: string[];
  }
): UserImpersonationDetection {
  const mode = opts?.mode ?? "interactive";
  if (!isInteractiveChatRuntimeMode(mode)) {
    return { detected: false, severity: "none", reason: null, matchedPhrase: null };
  }

  const prose = text.trim();
  if (!prose) {
    return { detected: false, severity: "none", reason: null, matchedPhrase: null };
  }

  let best: UserImpersonationDetection = {
    detected: false,
    severity: "none",
    reason: null,
    matchedPhrase: null,
  };

  const consider = (hit: UserImpersonationDetection) => {
    if (!hit.detected) return;
    // Soft-allow if the matched span itself is only a waiting/silence cue.
    if (hit.matchedPhrase && SAFE_REFERENCE_RE.test(hit.matchedPhrase)) return;
    if (severityRank(hit.severity) > severityRank(best.severity)) best = hit;
  };

  for (const { re, severity, reason } of DELIBERATE_ACTOR_RES) {
    const m = prose.match(re);
    if (m?.[0]) {
      consider({
        detected: true,
        severity,
        reason,
        matchedPhrase: m[0].slice(0, 80),
      });
    }
  }

  const aliases = (opts?.userAliases ?? [])
    .map((a) => a.trim())
    .filter((a) => a.length >= 2 && a.length <= 24);
  for (const alias of aliases) {
    const actorRe = new RegExp(
      `${escapeRegExp(alias)}\\s*(?:는|은|이|가)\\s*(?:말했|대답했|생각했|결심했|고개를\\s*끄덕|손을\\s*뻗|입을\\s*열|동의했|거절했)`,
      "g"
    );
    const m = actorRe.exec(prose);
    if (m?.[0]) {
      consider({
        detected: true,
        severity: "high",
        reason: "user_alias_actor",
        matchedPhrase: m[0].slice(0, 80),
      });
    }

    const dialogueLineRe = new RegExp(
      `^[^\\n]{0,40}${escapeRegExp(alias)}\\s*(?:는|은|이|가)\\s*[\\u201c\\u201d"「『]`,
      "m"
    );
    const dm = prose.match(dialogueLineRe);
    if (dm?.[0] && QUOTED_USER_ALIAS_DIALOGUE.test(dm[0])) {
      consider({
        detected: true,
        severity: "high",
        reason: "user_alias_quoted_dialogue",
        matchedPhrase: dm[0].slice(0, 80),
      });
    }
  }

  // Bare [B] quoted dialogue / "유저:" style lines
  const bQuote = prose.match(/\[B\]\s*[:：]\s*[「『"\u201c]/);
  if (bQuote?.[0]) {
    consider({
      detected: true,
      severity: "high",
      reason: "b_colon_dialogue",
      matchedPhrase: bQuote[0],
    });
  }
  const userColon = prose.match(/(?:^|\n)\s*(?:유저|USER|\{\{user\}\})\s*[:：]\s*\S/i);
  if (userColon?.[0]) {
    const snippet = userColon[0].trim().slice(0, 80);
    if (!SAFE_REFERENCE_RE.test(snippet)) {
      consider({
        detected: true,
        severity: "medium",
        reason: "user_label_line",
        matchedPhrase: snippet,
      });
    }
  }

  return best;
}

/** Optional repair — stubbed OFF. Never calls an API when flag is false. */
export async function maybeRepairUserImpersonation(opts: {
  mode: ChatRuntimeMode;
  text: string;
  userAliases?: string[];
  currentUserInput?: string;
}): Promise<{ text: string; repairAttempted: boolean; detection: UserImpersonationDetection }> {
  const detection = detectInteractiveUserImpersonation(opts.text, {
    mode: opts.mode,
    userAliases: opts.userAliases,
  });
  const autoRepairEnabled = isUserImpersonationAutoRepairEnabled();

  if (!detection.detected || !autoRepairEnabled || !isInteractiveChatRuntimeMode(opts.mode)) {
    return { text: opts.text, repairAttempted: false, detection };
  }

  // Flag is ON but cheap repair path is not implemented yet — never invent a full regen.
  // Callers must treat repairAttempted=false as "no extra API".
  return { text: opts.text, repairAttempted: false, detection };
}

export function logUserImpersonationGuard(payload: UserImpersonationGuardLog): void {
  if (process.env.NODE_ENV === "production" && !payload.detected) return;
  console.log("[UserImpersonationGuard]", {
    mode: payload.mode,
    detected: payload.detected,
    severity: payload.severity,
    reason: payload.reason,
    matchedPhrase: payload.matchedPhrase,
    autoRepairEnabled: payload.autoRepairEnabled,
    repairAttempted: payload.repairAttempted,
  });
}
