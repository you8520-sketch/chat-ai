import type Database from "better-sqlite3";
import { sanitizePrimaryModelContextSource } from "@/lib/flashOwnedOutputFirewall";
import { getDb } from "@/lib/db";
import { splitPersonaSecretItems, type PersonaSecretItem } from "@/lib/personaSecretItems";
import { sanitizeRuntimePromptSource } from "@/lib/runtimePromptContaminationGuard";

export type PersonaSecretRevealSource =
  | "USER_AUTHORED_DISCLOSURE"
  | "EXPLICIT_SYSTEM_TRIGGER"
  | "MANUAL_REVEAL";

export type ChatPersonaSecretRevealRow = {
  id: number;
  chat_id: number;
  persona_id: number;
  secret_key: string;
  revealed_fact_text: string;
  revealed_at_turn: number;
  source: PersonaSecretRevealSource;
  created_at: string;
};

export function ensureChatPersonaSecretRevealsSchema(db: Database.Database = getDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_persona_secret_reveals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      persona_id INTEGER NOT NULL,
      secret_key TEXT NOT NULL,
      revealed_fact_text TEXT NOT NULL,
      revealed_at_turn INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(chat_id, persona_id, secret_key)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_persona_secret_reveals_chat
      ON chat_persona_secret_reveals(chat_id, persona_id);
  `);
}

export function listChatPersonaSecretReveals(
  chatId: number,
  personaId: number,
  db: Database.Database = getDb()
): ChatPersonaSecretRevealRow[] {
  ensureChatPersonaSecretRevealsSchema(db);
  return db
    .prepare(
      `SELECT id, chat_id, persona_id, secret_key, revealed_fact_text, revealed_at_turn, source, created_at
       FROM chat_persona_secret_reveals
       WHERE chat_id=? AND persona_id=?
       ORDER BY revealed_at_turn ASC, id ASC`
    )
    .all(chatId, personaId) as ChatPersonaSecretRevealRow[];
}

export function insertChatPersonaSecretReveal(
  opts: {
    chatId: number;
    personaId: number;
    secretKey: string;
    revealedFactText: string;
    revealedAtTurn: number;
    source: PersonaSecretRevealSource;
  },
  db: Database.Database = getDb()
): boolean {
  ensureChatPersonaSecretRevealsSchema(db);
  const text = sanitizeRevealedFactForPrompt(opts.revealedFactText);
  if (!text) return false;
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO chat_persona_secret_reveals
       (chat_id, persona_id, secret_key, revealed_fact_text, revealed_at_turn, source)
       VALUES (?,?,?,?,?,?)`
    )
    .run(
      opts.chatId,
      opts.personaId,
      opts.secretKey,
      text,
      opts.revealedAtTurn,
      opts.source
    );
  return info.changes > 0;
}

/** Canonical trusted fact text — never raw user chat message. */
export function buildCanonicalRevealedFactText(item: PersonaSecretItem): string {
  return sanitizeRevealedFactForPrompt(item.normalizedText);
}

export function sanitizeRevealedFactForPrompt(text: string): string {
  const raw = text?.trim() ?? "";
  if (!raw) return "";
  return sanitizeRuntimePromptSource(sanitizePrimaryModelContextSource(raw)).trim();
}

/** Intersect stored reveals with current secret_description keys (persona retcon semantics). */
export function filterVisiblePersonaSecretReveals(
  reveals: ChatPersonaSecretRevealRow[],
  secretDescription: string
): ChatPersonaSecretRevealRow[] {
  const currentKeys = new Set(
    splitPersonaSecretItems(secretDescription).map((item) => item.secretKey)
  );
  if (currentKeys.size === 0) return [];
  return reveals.filter((row) => currentKeys.has(row.secret_key));
}

export function buildRevealedPersonaFactsBlock(reveals: ChatPersonaSecretRevealRow[]): string | null {
  const lines = reveals
    .map((r) => sanitizeRevealedFactForPrompt(r.revealed_fact_text))
    .filter(Boolean)
    .map((text) => `- ${text}`);
  if (lines.length === 0) return null;
  return `[REVEALED PERSONA FACTS — KNOWN IN THIS CHAT]
These facts were disclosed in this chat's story. [A] may treat them as in-scene knowledge.
Do not treat unrevealed persona secrets as known.

${lines.join("\n")}`;
}

export function buildRevealedPersonaFactsBlockForPersona(
  reveals: ChatPersonaSecretRevealRow[],
  secretDescription: string
): string | null {
  return buildRevealedPersonaFactsBlock(
    filterVisiblePersonaSecretReveals(reveals, secretDescription)
  );
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

const GENERIC_INFORMATIVE_STOPWORDS = new Set([
  "나는",
  "내가",
  "저는",
  "제가",
  "나",
  "내",
  "저",
  "제",
  "사실",
  "진짜",
  "솔직히",
  "고백",
  "말하자면",
  "밝히",
  "정체",
  "있다",
  "없다",
  "수",
  "것",
  "등",
  "이",
  "가",
  "은",
  "는",
  "을",
  "를",
  "의",
  "에",
  "와",
  "과",
  "도",
  "로",
  "다",
  "야",
  "이야",
  "이다",
  "입니다",
  "있다",
  "있어",
  "있음",
]);

const TOPIC_ONLY_TERMS = new Set(["역사", "이야기", "설", "설화", "전설", "소문", "관심", "후회"]);

/** ONE secret paragraph = ONE atomic reveal unit; split multi-claim items deterministically. */
export function extractSecretClaimSegments(secretText: string): string[] {
  let segments = [secretText.trim()].filter(Boolean);
  const splitters = [
    /[，,;；]/,
    /\s+(?:이며|이고|하고|또는|또|및|그리고|뿐\s*아니라|동시에)\s+/,
    /\s+(?:\S+고)\s+(?=\S)/,
  ];
  for (const splitter of splitters) {
    segments = segments.flatMap((seg) =>
      seg
        .split(splitter)
        .map((p) => p.trim())
        .filter((p) => p.length >= 3)
    );
  }
  return segments.length > 0 ? segments : [secretText.trim()];
}

export function extractDistinctiveInformativeTerms(secretText: string): string[] {
  let normalized = normalizeForMatch(secretText);
  for (const stop of GENERIC_INFORMATIVE_STOPWORDS) {
    normalized = normalized.replace(new RegExp(stop, "g"), " ");
  }
  const terms = (normalized.match(/[가-힣]{2,}/g) ?? []).filter(
    (term) => !GENERIC_INFORMATIVE_STOPWORDS.has(term) && !TOPIC_ONLY_TERMS.has(term)
  );
  return [...new Set(terms)];
}

type EssentialPredicate = {
  id: string;
  secretPattern: RegExp;
  userPattern: RegExp;
};

const ESSENTIAL_PREDICATES: EssentialPredicate[] = [
  {
    id: "heir",
    secretPattern: /후계자/,
    userPattern: /후계자(?:이?(?:다|야|이)?|)/,
  },
  {
    id: "daughter",
    secretPattern: /(?:범인(?:의)?\s*)?딸(?:이)?(?:다|야|이)?|딸이다/,
    userPattern: /(?:범인(?:의)?\s*)?딸(?:이?(?:다|야|이)?|)/,
  },
  {
    id: "time_rewind",
    secretPattern: /시간(?:을)?\s*되돌릴\s*수\s*있/,
    userPattern: /시간(?:을)?\s*되돌릴\s*수/,
  },
];

function essentialPredicatesSatisfied(secretText: string, userMessage: string): boolean {
  const msg = normalizeForMatch(userMessage);
  for (const pred of ESSENTIAL_PREDICATES) {
    if (!pred.secretPattern.test(secretText)) continue;
    if (!pred.userPattern.test(msg)) return false;
  }
  return true;
}

function isTopicOnlyOverlap(secretText: string, userMessage: string): boolean {
  const msg = normalizeForMatch(userMessage);
  if (!/(?:역사|이야기|설|설화|전설|소문|관심|후회|들었)/.test(msg)) return false;
  if (/후계자|딸(?:이)?(?:다|야)|되돌릴\s*수/.test(msg)) return false;
  const terms = extractDistinctiveInformativeTerms(secretText);
  return terms.length > 0 && terms.every((term) => msg.includes(term));
}

function informativeSecretDisclosureOverlap(secretText: string, userMessage: string): boolean {
  const msg = normalizeForMatch(userMessage);
  const terms = extractDistinctiveInformativeTerms(secretText);
  if (terms.length === 0) return false;
  if (isTopicOnlyOverlap(secretText, userMessage)) return false;
  if (!essentialPredicatesSatisfied(secretText, userMessage)) return false;

  let matched = 0;
  for (const term of terms) {
    if (msg.includes(term)) matched++;
  }
  const coverage = matched / terms.length;
  return matched >= 1 && coverage >= 0.75;
}

function isQuestionLike(text: string): boolean {
  const t = text.trim();
  if (/[?？]\s*$/.test(t)) return true;
  if (/^(?:혹시|설마|무슨|왜|어떻게|누가|언제|어디)\s*/.test(t) && /[?？]/.test(t)) return true;
  if (/(?:일까|일까요|할까|할까요|인가요|인가|니\?|나\?|까\?)\s*$/.test(t)) return true;
  if (/(?:알아|알고\s*있|모르|궁금|생각해|같아)/.test(t) && /[?？]/.test(t)) return true;
  if (/(?:라고\s*생각|일\s*거\s*같|같다고\s*봐|처럼\s*보여)\s*[?？]/.test(t)) return true;
  return false;
}

function isHypothetical(text: string): boolean {
  return /(?:라면|라고\s*생각|일\s*거\s*같|인\s*척|웃기|농담|가정|만약|혹시\s*내가|라고\s*해봐|처럼\s*말|장난|놀리|픽션|소설\s*속|RP\s*속|연기)/.test(
    text
  );
}

function isNegatedDisclosure(text: string): boolean {
  return /(?:아니(?:야|다|에요|야|냐|니)?|아닌|아닙|절대\s*아|모른|알\s*수\s*없|거짓|농담|놀리|장난|해명|틀렸|거짓말|농담이|장난이)/.test(
    text
  );
}

function isThirdPartyOrQuotedDisclosure(text: string): boolean {
  return /(?:그(?:는|가|녀|들|분)|(?:카일|캐릭터|그\s*사람|상대)(?:는|가)|(?:라고|이라고)\s*(?:말|했다|해|들)|(?:전해|듣|들었|말하길|라더라|전했다)|인용|대사\s*[:：]|「|"|'|')/.test(
    text
  );
}

function isFictionalInRoleStatement(text: string): boolean {
  return /(?:소설|설정|RP|롤|역할|캐릭터|연기|놀이|세계관|if\s|가정|픽션|대본|시나리오)\s*(?:속|에서|이라면|처럼)|(?:라고\s*치면|인\s*척|흉내)/.test(
    text
  );
}

function hasSelfDisclosureCue(text: string): boolean {
  return /(?:사실|솔직히|고백|말(?:하)?(?:자면|할)|밝히|들(?:켰|키)|내\s*정체|나(?:는|가)|저(?:는|가)|내가|진짜(?:로)?)/.test(
    text
  );
}

/** Multi-claim secret items require every claim segment to overlap — no partial unlock. */
function isAtomicRevealUnitFullyDisclosed(secretText: string, userMessage: string): boolean {
  const segments = extractSecretClaimSegments(secretText);
  if (segments.length <= 1) {
    return informativeSecretDisclosureOverlap(secretText, userMessage);
  }
  return segments.every((segment) => informativeSecretDisclosureOverlap(segment, userMessage));
}

export type PersonaSecretRevealCandidate = {
  item: PersonaSecretItem;
  revealedFactText: string;
};

/** Conservative USER-only detector — false negative preferred over false positive. */
export function detectUserAuthoredPersonaSecretReveals(
  userMessage: string,
  secretItems: PersonaSecretItem[]
): PersonaSecretRevealCandidate[] {
  const msg = userMessage.trim();
  if (!msg || secretItems.length === 0) return [];
  if (
    isQuestionLike(msg) ||
    isHypothetical(msg) ||
    isNegatedDisclosure(msg) ||
    isThirdPartyOrQuotedDisclosure(msg) ||
    isFictionalInRoleStatement(msg)
  ) {
    return [];
  }
  if (!hasSelfDisclosureCue(msg)) return [];

  const out: PersonaSecretRevealCandidate[] = [];
  for (const item of secretItems) {
    if (!isAtomicRevealUnitFullyDisclosed(item.normalizedText, msg)) continue;
    out.push({
      item,
      revealedFactText: buildCanonicalRevealedFactText(item),
    });
  }
  return out;
}

export function persistPersonaSecretRevealCandidates(opts: {
  chatId: number;
  personaId: number;
  revealedAtTurn: number;
  candidates: PersonaSecretRevealCandidate[];
  source?: PersonaSecretRevealSource;
  db?: Database.Database;
}): PersonaSecretRevealCandidate[] {
  const db = opts.db ?? getDb();
  const source = opts.source ?? "USER_AUTHORED_DISCLOSURE";
  for (const c of opts.candidates) {
    insertChatPersonaSecretReveal(
      {
        chatId: opts.chatId,
        personaId: opts.personaId,
        secretKey: c.item.secretKey,
        revealedFactText: c.revealedFactText,
        revealedAtTurn: opts.revealedAtTurn,
        source,
      },
      db
    );
  }
  return opts.candidates;
}

export function persistUserAuthoredPersonaSecretReveals(opts: {
  chatId: number;
  personaId: number;
  revealedAtTurn: number;
  userMessage: string;
  secretDescription: string;
  db?: Database.Database;
}): PersonaSecretRevealCandidate[] {
  const items = splitPersonaSecretItems(opts.secretDescription);
  const candidates = detectUserAuthoredPersonaSecretReveals(opts.userMessage, items);
  persistPersonaSecretRevealCandidates({
    chatId: opts.chatId,
    personaId: opts.personaId,
    revealedAtTurn: opts.revealedAtTurn,
    candidates,
    db: opts.db,
  });
  return candidates;
}

/** Assistant text must never create reveals — explicit guard for callers. */
export function detectAssistantPersonaSecretReveals(
  _assistantMessage: string,
  _secretItems: PersonaSecretItem[]
): PersonaSecretRevealCandidate[] {
  return [];
}
