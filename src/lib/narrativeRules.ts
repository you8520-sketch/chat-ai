import { STREAM_SAVE_MIN_RETENTION } from "@/lib/streamFirstSaveConstants";
import { rawPrefixForCollapsedCompare } from "@/lib/streamReveal";

/** 이 턴 수 미만이면 초반 관계 제한을 강하게 적용 */
export const EARLY_RELATIONSHIP_TURN_LIMIT = 15;

const MODEL_XML_LEAK_TAGS = ["LONG_TERM_MEMORY", "PERSONA", "WORLD_LORE"] as const;

/** DeepSeek·프롬프트 XML 태그 누출 제거 (완성·미완성·빈 태그) */
export function stripModelXmlLeakage(text: string): string {
  let out = text;
  for (const tag of MODEL_XML_LEAK_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\s*>[\\s\\S]*?</${tag}\\s*>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "gi"), "");
  }
  out = out.replace(/<\/?System\s*Reminder\b[^>]*>/gi, "");
  out = out.replace(/<\/?(?:LONG_TERM_MEMORY|PERSONA|WORLD_LORE)\b[^>]*>/gi, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** 내부 지시 태그 누출 제거 — [말투…], [speech style], [curse …], [SPEECH PROFILE…] 등 (감정 [태그: …]·상태창은 유지) */
export function stripInternalTagLeakage(text: string): string {
  return stripModelXmlLeakage(
    text
      .replace(/\[[^\]\n]{0,40}(?:말투|speech\s*style|speech\s*profile|curse|CORE ROLEPLAY|SPEECH LOCK|내부 지침)[^\]\n]{0,40}\]/gi, "")
      .replace(/(?:^|\n)[^\n\[\]]{0,30}말투\]/g, "")
  );
}

/** RP 메타 체크리스트·상태 확인 문장 (본문 서두 누출 — 키워드 단독 매칭 금지) */
const RP_META_PREAMBLE_LINE =
  /(?:역할\s*몰입|성인\s*콘텐츠\s*허용|성인\s*모드\s*(?:활성|ON|켜)|캐릭터성[·•]\s*관계\s*흐름|관계\s*흐름\s*유지(?:하며)?(?:\s*진행)?|본문에\s+.+\s*역할\s*몰입|(?:허용|확인)\s*됨|몰입\s*중)/i;

/** 본문 첫 줄 앞에 붙은 메타 조각 — "캐릭터성·관계기 속에서 …" 등 */
const RP_META_INLINE_PREFIXES: RegExp[] = [
  /^(?:\ufeff)?\s*(?:역할\s*몰입(?:\s*중)?(?:[,.\s]*(?:성인\s*콘텐츠\s*허용(?:\s*확인)?(?:\s*됨)?)?)?)/i,
  /^(?:\ufeff)?\s*성인\s*콘텐츠\s*허용(?:\s*확인)?(?:\s*됨)?[\s,·•.]*/i,
  /^(?:\ufeff)?\s*캐릭터성[·•]\s*관계(?:\s*흐름(?:\s*유지(?:하며)?(?:\s*진행)?)?)?[\s,·•]*/i,
  /^(?:\ufeff)?\s*관계\s*흐름\s*유지(?:하며)?(?:\s*진행)?[\s,·•.]*/i,
  /^(?:\ufeff)?\s*(?:---|──+|══+)[\s]*/i,
  /** "관계" + "흐름" 붙다 깨진 "관계기 속에서" */
  /^(?:\ufeff)?\s*기(?=\s+속(?:에서|일|해))/,
];

/** 스트리밍 중 아직 메타 조각만 왔을 때 UI에 보내지 않음 */
const RP_META_PARTIAL_PREFIX =
  /^(?:캐릭터성(?:[·•]\s*관계(?:\s*흐름(?:\s*유지)?)?)?|역할(?:\s*몰입(?:\s*중)?)?|성인(?:\s*콘텐츠(?:\s*허용)?)?|관계(?:\s*흐름)?)$/i;

/** 캐릭터명 뒤에 붙은 메타 한 줄 — "OO 역할 몰입 중, …" */
const RP_META_CHARNAME_PREFIX =
  /^.{0,48}?(?:역할\s*몰입|성인\s*콘텐츠\s*허용|성인\s*모드)/i;

function stripInlineMetaPrefixFromText(text: string): string {
  let out = text;
  for (let pass = 0; pass < 8; pass++) {
    const lines = out.split("\n");
    const first = lines[0] ?? "";
    let stripped = first;
    for (const re of RP_META_INLINE_PREFIXES) {
      const next = stripped.replace(re, "");
      if (next !== stripped) stripped = next.trimStart();
    }
    if (stripped === first) break;
    lines[0] = stripped;
    out = lines.join("\n");
  }
  return out.trimStart();
}

function stripMetaFromFirstLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || !RP_META_CHARNAME_PREFIX.test(trimmed)) return null;
  const sep = trimmed.search(/\n|---|\*\*\*|#{2,}/);
  if (sep > 0) return trimmed.slice(sep).replace(/^[\s─—\-_=]+/, "").trim();
  if (RP_META_PREAMBLE_LINE.test(trimmed) && trimmed.length <= 160) return "";
  const inline = stripInlineMetaPrefixFromText(trimmed);
  return inline !== trimmed ? inline : null;
}

function isIncompleteMetaStreamPrefix(text: string): boolean {
  const head = text.split("\n")[0]?.trimEnd() ?? "";
  if (!head || head.includes("\n")) return false;
  if (head.length > 48) return false;
  return RP_META_PARTIAL_PREFIX.test(head);
}

/** 본문 어디에든 끼어드는 메타 한 줄·조각 */
function isRpMetaOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 180) return false;
  if (/[""「][^""」\n]{0,200}[""」]/.test(t)) return false;
  if (/^[─—\-_=]{2,}\s*$/.test(t)) return true;
  if (/^캐릭터성\s*[·•]?\s*관계/i.test(t)) return true;
  if (RP_META_PREAMBLE_LINE.test(t)) return true;
  if (t.length <= 100 && /^(?:캐릭터성|관계\s*흐름|역할\s*몰입|성인\s*콘텐츠)/i.test(t)) return true;
  return false;
}

/** 문단·줄 중간에 삽입된 메타 구문 (본문 전체) */
const RP_META_INLINE_ANYWHERE: RegExp[] = [
  /\n?\s*캐릭터성\s*[·•]?\s*관계(?:\s*흐름)?(?:\s*유지(?:하며)?(?:\s*진행)?)?\s*[.…,·•\-—]*\s*(?=\n|$)/gi,
  /\n?\s*역할\s*몰입(?:\s*중)?(?:[,.\s]*(?:성인\s*콘텐츠\s*허용(?:\s*확인)?(?:\s*됨)?)?)?\s*[.…,]?\s*(?=\n|$)/gi,
  /\n?\s*성인\s*콘텐츠\s*허용(?:\s*확인)?(?:\s*됨)?\s*[.…,]?\s*(?=\n|$)/gi,
  /\n?\s*관계\s*흐름\s*유지(?:하며)?(?:\s*진행)?\s*[.…,·•]?\s*(?=\n|$)/gi,
];

function stripLeadingMetaLines(text: string): string {
  const lines = text.split("\n");
  let start = 0;

  while (start < lines.length && start < 8) {
    const line = lines[start]!.trim();
    if (!line) {
      start++;
      continue;
    }
    if (isRpMetaOnlyLine(line)) {
      start++;
      continue;
    }
    break;
  }

  return lines.slice(start).join("\n").replace(/^\s*[─—\-_=]{2,}\s*\n+/, "").trimStart();
}

/** 서두·중간·줄 사이 AI 메타 체크리스트 전부 제거 */
export function stripRpMetaLeakage(text: string): string {
  if (!text.trim()) return text;

  let out = text.split("\n").filter((line) => !isRpMetaOnlyLine(line)).join("\n");

  for (const re of RP_META_INLINE_ANYWHERE) {
    out = out.replace(re, "\n");
  }

  out = stripLeadingMetaLines(out);
  out = stripInlineMetaPrefixFromText(out);

  const firstLine = out.split("\n")[0] ?? "";
  const firstLineFix = stripMetaFromFirstLine(firstLine);
  if (firstLineFix !== null) {
    const rest = out.split("\n").slice(1).join("\n");
    out = firstLineFix ? (rest ? `${firstLineFix}\n${rest}` : firstLineFix) : rest;
  }

  return out.replace(/\n{3,}/g, "\n\n").trimStart();
}

/** @deprecated stripRpMetaLeakage 와 동일 */
export function stripRpMetaPreamble(text: string): string {
  return stripRpMetaLeakage(text);
}

/** reasoning·장면 분석 계획 문장 (본문·대사 따옴표 안 누출) */
const SCENE_ANALYSIS_MARKERS: RegExp[] = [
  /생리적\s*단서/i,
  /직전(?:의)?\s*본문(?:과)?\s*흐름(?:을)?\s*유지/i,
  /자연스럽게\s*이어(?:가|서)/i,
  /대사는\s*없지만\s*상황(?:은|이)/i,
  /유저(?:의)?\s*심장\s*박동/i,
];

function sceneAnalysisMarkerHits(text: string): number {
  return SCENE_ANALYSIS_MARKERS.filter((re) => re.test(text)).length;
}

function isSceneAnalysisLeakLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 420) return false;
  if (!/캐릭터(?:가|는)|생리적\s*단서|직전(?:의)?\s*본문|대사는\s*없지만/i.test(t)) {
    return false;
  }
  return sceneAnalysisMarkerHits(t) >= 1;
}

/** 모델 내부 장면 분석·연속 지시 누출 제거 */
export function stripSceneAnalysisLeakage(text: string): string {
  if (!text.trim()) return text;

  let out = text
    .split("\n")
    .filter((line) => !isSceneAnalysisLeakLine(line))
    .join("\n");

  out = out.replace(
    /[""「]\s*캐릭터(?:가|는)[^""」\n]{15,320}(?:직전(?:의)?\s*본문[^""」\n]{0,140})?[.""」]/gi,
    ""
  );
  out = out.replace(
    /(?:^|\n)\s*캐릭터(?:가|는)\s+[^\n]{15,320}(?:직전(?:의)?\s*본문[^\n]{0,140})?(?:\.|\s*$)/gi,
    "\n"
  );

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function collapseStreamDeltaText(text: string): string {
  return text.replace(/[\r\n\u00a0]+/g, " ").replace(/\s+/g, " ").trim();
}

/** 스트리밍·저장 공통 — RP 메타 + 장면 분석 누출 제거 */
function stripStreamVisibleMeta(text: string): string {
  return stripSceneAnalysisLeakage(stripRpMetaLeakage(text));
}

/** 스트리밍 — 메타 제거 후 델타 또는 replace (중간 삽입 시 교정) */
export function streamDeltaAfterRpMetaStrip(
  accumulated: string,
  lastCleanSent: string
): { delta: string; clean: string; replace: string | null; replaceInstant?: boolean } {
  if (isIncompleteMetaStreamPrefix(accumulated)) {
    return { delta: "", clean: lastCleanSent, replace: null };
  }
  const cleaned = stripStreamVisibleMeta(accumulated);
  if (!lastCleanSent || cleaned.startsWith(lastCleanSent)) {
    return {
      delta: cleaned.slice(lastCleanSent.length),
      clean: cleaned,
      replace: null,
    };
  }

  const lastStripped = stripStreamVisibleMeta(lastCleanSent);
  if (lastStripped !== lastCleanSent && cleaned.startsWith(lastStripped)) {
    return {
      delta: cleaned.slice(lastStripped.length),
      clean: cleaned,
      replace: null,
    };
  }

  const lc = collapseStreamDeltaText(lastCleanSent);
  const cc = collapseStreamDeltaText(cleaned);
  const ls = collapseStreamDeltaText(lastStripped);

  if (cc.startsWith(lc)) {
    if (cleaned.startsWith(lastCleanSent)) {
      const delta = cleaned.slice(lastCleanSent.length);
      return { delta, clean: cleaned, replace: null };
    }
    const mapped = rawPrefixForCollapsedCompare(cleaned, lc);
    if (mapped.length >= lastCleanSent.length * STREAM_SAVE_MIN_RETENTION) {
      // Collapse-equivalent prefix — append tail only (avoid mid-stream full snap/retype).
      const delta = cleaned.slice(mapped.length);
      return { delta, clean: cleaned, replace: null };
    }
    // Collapsed extends but raw map failed — hold last; finalContent will sync once.
    return { delta: "", clean: lastCleanSent, replace: null };
  }

  if (cc.startsWith(ls) && ls.length >= 40) {
    const delta = cleaned.slice(lastStripped.length);
    return { delta, clean: cleaned, replace: null };
  }

  if (lc.includes(cc) && cc.length >= 40) {
    return { delta: "", clean: cleaned, replace: null };
  }

  // Shared collapsed tail after leading strip — treat as meta/scene cleanup, not full restart.
  if (lc.length > 80 && cc.length > 80) {
    const tailLen = Math.min(120, cc.length, lc.length);
    if (lc.slice(-tailLen) === cc.slice(-tailLen)) {
      if (cleaned.length >= lastCleanSent.length * STREAM_SAVE_MIN_RETENTION) {
        return { delta: "", clean: cleaned, replace: cleaned, replaceInstant: true };
      }
      return { delta: "", clean: lastCleanSent, replace: null };
    }
  }

  const lcpChars = [...lastCleanSent];
  const tc = [...cleaned];
  let lcp = 0;
  while (lcp < lcpChars.length && lcp < tc.length && lcpChars[lcp] === tc[lcp]) lcp++;
  if (
    lcp >= Math.floor(lastCleanSent.length * 0.85) &&
    cleaned.length >= lastCleanSent.length * STREAM_SAVE_MIN_RETENTION
  ) {
    return { delta: "", clean: cleaned, replace: cleaned, replaceInstant: true };
  }

  if (cc.startsWith(lc) && cleaned.length >= lastCleanSent.length * STREAM_SAVE_MIN_RETENTION) {
    return {
      delta: cleaned.slice(lastCleanSent.length),
      clean: cleaned,
      replace: null,
    };
  }

  // Hard divergence — one instant snap (client must not retype from char 0).
  return { delta: "", clean: cleaned, replace: cleaned, replaceInstant: true };
}

export type RpMetaLeakageResult = {
  status: "PASS" | "FAILURE";
  leakStartIndex: number | null;
  matchedMarkers: string[];
  matchedLines: string[];
  highConfidenceMarkerCount: number;
  metaLineCount: number;
  tailOnly: boolean;
};

/** One-time user tail for leak full-regeneration — not persisted in prompt templates. */
export const RP_META_LEAK_RECOVERY_USER_TAIL =
  "직전 생성에는 장면 밖의 내부 작업 메모가 섞였다.\n같은 장면을 처음부터 다시 작성하고,\n한국어 RP 본문 외의 지시·계획·길이 계산·출력 점검 문장은 쓰지 않는다.";

type RpMetaMarkerDef = { id: string; re: RegExp; strong?: boolean };

const RP_META_HC_MARKERS: RpMetaMarkerDef[] = [
  { id: "need_length", re: /\bNeed length\b/i },
  { id: "need_final", re: /\bNeed final\b/i },
  { id: "need_output", re: /\bNeed output\b/i },
  { id: "developer_says", re: /\bdeveloper says\b/i, strong: true },
  { id: "system_says", re: /\bsystem says\b/i },
  { id: "system_prompt", re: /\bsystem prompt\b/i, strong: true },
  { id: "need_final_response", re: /\bNeed final response\b/i, strong: true },
  { id: "final_response", re: /\bfinal response\b/i },
  { id: "lets_answer", re: /\bLet's answer\b/i },
  { id: "we_need", re: /\bWe need\b/i },
  { id: "i_should", re: /\bI should\b/i },
  { id: "target_chars", re: /\btarget chars\b/i },
  { id: "character_count", re: /\bcharacter count\b/i },
  { id: "token_count", re: /\btoken count\b/i },
  { id: "no_markdown", re: /\bno markdown\b/i },
  { id: "assistant_response", re: /\bassistant response\b/i },
  { id: "user_requested", re: /\buser requested\b/i },
  { id: "policy_says", re: /\bpolicy says\b/i },
  { id: "ko_char_check", re: /글자\s*수를\s*확인/ },
  { id: "ko_final_response", re: /최종\s*응답/ },
  { id: "ko_system_directive", re: /시스템\s*지시/ },
  { id: "ko_dev_directive", re: /개발자\s*지시/ },
  { id: "ko_output_only", re: /출력만\s*해야/ },
  { id: "ko_prompt_follow", re: /프롬프트에\s*따르면/ },
];

const RP_META_STRONG_IDS = new Set(["developer_says", "system_prompt", "need_final_response"]);

const RP_META_SELF_EVAL_RE =
  /\b(?:character|token)\s*count\b|\btarget\s*(?:chars|length|maybe)\b|\bno\s*markdown\b|(?:글자|문자|토큰)\s*수[^.\n]{0,24}(?:확인|맞|부족|충분|계산)|(?:지시|instruction)[^.\n]{0,32}(?:준수|follow|comply)|최종\s*(?:답변|응답)[^.\n]{0,24}(?:확인|점검)/i;

function rpMetaHangulCount(text: string): number {
  return (text.match(/[가-힣]/g) ?? []).length;
}

function isRpMetaEnglishReviewLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (rpMetaHangulCount(t) > t.length * 0.35) return false;
  return (
    RP_META_HC_MARKERS.some((m) => m.re.test(t)) ||
    RP_META_SELF_EVAL_RE.test(t) ||
    /\b(?:Need|Let's|Wait|However|Good\.|Done\.)\b/.test(t)
  );
}

function isRpMetaOutOfSceneSelfReviewLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^[「『""]/.test(t) && !RP_META_HC_MARKERS.some((m) => m.re.test(t))) return false;
  if (
    /[「『""][^""」\n]{0,200}[""」]/.test(t) &&
    !/\b(?:Need|Let's|developer|system prompt|We need|I should)\b/i.test(t)
  ) {
    return false;
  }
  return (
    RP_META_HC_MARKERS.some((m) => m.re.test(t)) ||
    RP_META_SELF_EVAL_RE.test(t)
  );
}

type RpMetaMarkerHit = {
  lineIndex: number;
  markerId: string;
  strong: boolean;
  line: string;
  charIndex: number;
};

function findRpMetaMarkerHits(text: string): RpMetaMarkerHit[] {
  const lines = text.split("\n");
  const hits: RpMetaMarkerHit[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const marker of RP_META_HC_MARKERS) {
      const match = marker.re.exec(line);
      if (match) {
        hits.push({
          lineIndex: i,
          markerId: marker.id,
          strong: Boolean(marker.strong || RP_META_STRONG_IDS.has(marker.id)),
          line: line.trim(),
          charIndex: offset + (match.index ?? 0),
        });
      }
    }
    offset += line.length + 1;
  }
  return hits;
}

function rpMetaMarkersWithinSixLines(hits: RpMetaMarkerHit[]): boolean {
  const indices = [...new Set(hits.map((h) => h.lineIndex))].sort((a, b) => a - b);
  if (indices.length < 2) return false;
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      if (indices[j]! - indices[i]! <= 5) return true;
    }
  }
  return false;
}

function rpMetaEnglishSelfReviewTailAfterKorean(text: string): number | null {
  const lines = text.split("\n");
  let lastKoLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (rpMetaHangulCount(t) >= 12 && !isRpMetaEnglishReviewLine(t)) lastKoLine = i;
  }
  if (lastKoLine < 0 || lastKoLine >= lines.length - 2) return null;

  let consecutive = 0;
  let startOffset = 0;
  for (let i = 0; i <= lastKoLine; i++) startOffset += lines[i]!.length + 1;

  for (let i = lastKoLine + 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t) continue;
    if (isRpMetaEnglishReviewLine(t)) {
      consecutive++;
      if (consecutive >= 2) return startOffset;
    } else if (rpMetaHangulCount(t) >= 8) {
      break;
    } else {
      startOffset += lines[i]!.length + 1;
    }
  }
  return null;
}

export type TrailingSelfCritiqueTrimResult = {
  status: "CLEAN" | "TRIMMED" | "UNSAFE_TO_TRIM";
  text: string;
  rawVisibleChars: number;
  trimmedVisibleChars: number;
  trimStartIndex: number | null;
  matchedMarkers: string[];
};

/** Narrow trailing self-critique markers — RP body suffix only (not mid-scene English dialogue). */
const TRAILING_SELF_CRITIQUE_MARKERS: { id: string; re: RegExp }[] = [
  { id: "need_output_only", re: /\bNeed output only\b/i },
  { id: "ensure_3200", re: /\bEnsure\s*3200\s*[-~–]\s*4200\b/i },
  { id: "just_final_must", re: /\bJust final must continue\b/i },
  { id: "final_must", re: /\bfinal must\b/i },
  { id: "we_can_provide", re: /\bWe can provide\b/i },
  { id: "must_not", re: /\bMust not\b/i },
  { id: "current_approx", re: /\bcurrent\s*~?\s*\d{3,5}\b/i },
  { id: "lets_output", re: /\bLet's output\b/i },
  { id: "draft", re: /\bdraft\b/i },
  { id: "remove_dot", re: /\bRemove\./ },
  { id: "foreign_prohibited", re: /\bforeign prohibited\b/i },
  { id: "diesmal", re: /\bdiesmal\??/i },
  { id: "need_avoid", re: /\bNeed avoid\b/i },
  { id: "observation_okay", re: /\bobservation okay\b/i },
  { id: "korean_chars_meta", re: /\bKorean chars\b/i },
  { id: "polished_longer", re: /\bpolished longer\b/i },
];

function countVisibleCharsForTrim(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function isInsideDialogueQuotes(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const opens = (before.match(/[\u201C\u201D\u300C\u300E"']/g) ?? []).length;
  // Odd count of quote chars → likely inside an open quote (heuristic).
  return opens % 2 === 1;
}

function looksLikeKoreanRpEnding(text: string): boolean {
  const t = text.trimEnd();
  if (!t) return false;
  if (/[가-힣]/.test(t.slice(-24)) && /[.!?。…」』"”]$/.test(t)) return true;
  if (/[가-힣](?:다|요|죠|까|네|군|구나)\s*[.!?。…]?\s*$/.test(t)) return true;
  return /[가-힣]/.test(t.slice(-12));
}

function isSelfCritiqueChunk(chunk: string): boolean {
  const t = chunk.trim();
  if (!t) return true;
  const hangul = (t.match(/[가-힣]/g) ?? []).length;
  if (hangul > t.length * 0.35) return false;
  return (
    TRAILING_SELF_CRITIQUE_MARKERS.some((m) => m.re.test(t)) ||
    /\b(?:Need|Ensure|Let's|Must|We can|Remove|draft|final must|okay\.|chars)\b/i.test(t)
  );
}

/**
 * Trim a trailing model self-critique suffix after completed Korean RP.
 * Does not remove mid-body English proper nouns / in-dialogue English.
 * Unsafe / interleaved meta → UNSAFE_TO_TRIM (no mutation).
 */
export function trimTrailingVisibleSelfCritique(text: string): TrailingSelfCritiqueTrimResult {
  const raw = text ?? "";
  const rawVisibleChars = countVisibleCharsForTrim(raw);
  if (!raw.trim()) {
    return {
      status: "CLEAN",
      text: raw,
      rawVisibleChars,
      trimmedVisibleChars: rawVisibleChars,
      trimStartIndex: null,
      matchedMarkers: [],
    };
  }

  let earliest = -1;
  const matchedMarkers: string[] = [];
  for (const marker of TRAILING_SELF_CRITIQUE_MARKERS) {
    const m = marker.re.exec(raw);
    if (!m || m.index == null) continue;
    // Prefer the earliest marker in the trailing 40% of the text.
    if (m.index < Math.floor(raw.length * 0.55)) continue;
    if (isInsideDialogueQuotes(raw, m.index)) continue;
    matchedMarkers.push(marker.id);
    if (earliest < 0 || m.index < earliest) earliest = m.index;
  }

  if (earliest < 0) {
    return {
      status: "CLEAN",
      text: raw,
      rawVisibleChars,
      trimmedVisibleChars: rawVisibleChars,
      trimStartIndex: null,
      matchedMarkers: [],
    };
  }

  const suffix = raw.slice(earliest);
  // Allow short Hangul fragments inside English meta (quoted names); reject real RP residue.
  const suffixHangul = (suffix.match(/[가-힣]/g) ?? []).length;
  const hasKoreanRpResidue =
    suffixHangul >= 40 ||
    /[가-힣][^.\n]{8,}(?:다|요|죠|까)\s*[.!?。…]/.test(suffix);
  if (!isSelfCritiqueChunk(suffix) || hasKoreanRpResidue) {
    return {
      status: "UNSAFE_TO_TRIM",
      text: raw,
      rawVisibleChars,
      trimmedVisibleChars: rawVisibleChars,
      trimStartIndex: earliest,
      matchedMarkers: [...new Set(matchedMarkers)],
    };
  }

  // Cut at paragraph boundary before the paragraph containing meta start,
  // unless meta continues after a completed Korean sentence on the same paragraph —
  // then keep the Korean sentence and drop from the meta token.
  const before = raw.slice(0, earliest);
  const paraBreak = Math.max(before.lastIndexOf("\n\n"), before.lastIndexOf("\r\n\r\n"));
  const paraStart = paraBreak >= 0 ? paraBreak + (before.includes("\r\n\r\n") ? 4 : 2) : 0;
  const paraPrefix = before.slice(paraStart).trim();

  let cutAt = paraBreak >= 0 ? paraBreak : -1;
  if (paraPrefix && looksLikeKoreanRpEnding(paraPrefix) && !isSelfCritiqueChunk(paraPrefix)) {
    // Same-paragraph Korean ending then meta — keep Korean prefix of that paragraph.
    cutAt = earliest;
  } else if (paraBreak < 0) {
    return {
      status: "UNSAFE_TO_TRIM",
      text: raw,
      rawVisibleChars,
      trimmedVisibleChars: rawVisibleChars,
      trimStartIndex: earliest,
      matchedMarkers: [...new Set(matchedMarkers)],
    };
  }

  let trimmed = raw.slice(0, cutAt).trimEnd();
  // If cut was at meta index mid-paragraph, also trim dangling spaces after Korean period.
  if (cutAt === earliest) {
    trimmed = before.replace(/\s+$/u, "").trimEnd();
  }

  const trimmedVisibleChars = countVisibleCharsForTrim(trimmed);
  if (trimmedVisibleChars < 2700 || !looksLikeKoreanRpEnding(trimmed)) {
    return {
      status: "UNSAFE_TO_TRIM",
      text: raw,
      rawVisibleChars,
      trimmedVisibleChars: rawVisibleChars,
      trimStartIndex: earliest,
      matchedMarkers: [...new Set(matchedMarkers)],
    };
  }

  // Entire suffix after cut must be critique-only.
  const removed = raw.slice(trimmed.length).trim();
  const removedHangul = (removed.match(/[가-힣]/g) ?? []).length;
  const removedHasRp =
    removedHangul >= 40 ||
    /[가-힣][^.\n]{8,}(?:다|요|죠|까)\s*[.!?。…]/.test(removed);
  if (!removed || !isSelfCritiqueChunk(removed) || removedHasRp) {
    return {
      status: "UNSAFE_TO_TRIM",
      text: raw,
      rawVisibleChars,
      trimmedVisibleChars: rawVisibleChars,
      trimStartIndex: earliest,
      matchedMarkers: [...new Set(matchedMarkers)],
    };
  }

  return {
    status: "TRIMMED",
    text: trimmed,
    rawVisibleChars,
    trimmedVisibleChars,
    trimStartIndex: trimmed.length,
    matchedMarkers: [...new Set(matchedMarkers)],
  };
}

/** Hard detector for provider meta / self-review leakage in visible RP prose. Does not mutate text. */
export function detectRpMetaLeakage(text: string): RpMetaLeakageResult {
  if (!text.trim()) {
    return {
      status: "PASS",
      leakStartIndex: null,
      matchedMarkers: [],
      matchedLines: [],
      highConfidenceMarkerCount: 0,
      metaLineCount: 0,
      tailOnly: false,
    };
  }

  const hits = findRpMetaMarkerHits(text);
  const matchedMarkers = [...new Set(hits.map((h) => h.markerId))];
  const matchedLines = [...new Set(hits.map((h) => h.line))].slice(0, 12);
  const metaLineCount = matchedLines.length;
  const highConfidenceMarkerCount = matchedMarkers.length;

  const lines = text.split("\n");
  const selfEvalLine = lines.find(
    (line) => RP_META_SELF_EVAL_RE.test(line.trim()) && isRpMetaOutOfSceneSelfReviewLine(line)
  );

  let failure = false;
  let leakStartIndex: number | null =
    hits.length > 0 ? Math.min(...hits.map((h) => h.charIndex)) : null;

  if (hits.length >= 2 && rpMetaMarkersWithinSixLines(hits)) {
    failure = true;
  }

  if (!failure) {
    for (const hit of hits) {
      if (hit.strong && isRpMetaOutOfSceneSelfReviewLine(hit.line)) {
        failure = true;
        leakStartIndex = hit.charIndex;
        break;
      }
    }
  }

  if (!failure) {
    const tailStart = rpMetaEnglishSelfReviewTailAfterKorean(text);
    if (tailStart != null) {
      failure = true;
      leakStartIndex = tailStart;
    }
  }

  if (!failure && selfEvalLine) {
    failure = true;
    leakStartIndex = text.indexOf(selfEvalLine.trim());
  }

  const tailOnly =
    failure && leakStartIndex != null && leakStartIndex >= Math.floor(text.length * 0.65);

  return {
    status: failure ? "FAILURE" : "PASS",
    leakStartIndex: failure ? leakStartIndex : null,
    matchedMarkers,
    matchedLines,
    highConfidenceMarkerCount,
    metaLineCount,
    tailOnly,
  };
}

/** Part 1: … / 파트 2: … 등 메타 장면 라벨만 제거 — 본문은 유지 */
export function stripNarrativePartLabels(text: string): string {
  const stripLinePrefix = (line: string) =>
    line
      .replace(/^\s*(?:Part|PART)\s*\d+(?:\s*\([^)]*\))?\s*:\s*/i, "")
      .replace(/^\s*파트\s*\d+(?:\s*\([^)]*\))?\s*:\s*/, "");

  return text
    .split("\n")
    .map(stripLinePrefix)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
