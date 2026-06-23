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
      if (mapped.startsWith(lastCleanSent)) {
        const delta = cleaned.slice(mapped.length);
        return { delta, clean: cleaned, replace: null };
      }
      return { delta: "", clean: cleaned, replace: cleaned, replaceInstant: true };
    }
    return { delta: "", clean: cleaned, replace: cleaned, replaceInstant: true };
  }

  if (cc.startsWith(ls) && ls.length >= 40) {
    const delta = cleaned.slice(lastStripped.length);
    return { delta, clean: cleaned, replace: null };
  }

  if (lc.includes(cc) && cc.length >= 40) {
    return { delta: "", clean: cleaned, replace: null };
  }

  if (lc.length > 80 && cc.length > 80) {
    const tailLen = Math.min(120, cc.length, lc.length);
    if (lc.slice(-tailLen) === cc.slice(-tailLen)) {
      return { delta: "", clean: cleaned, replace: cleaned, replaceInstant: true };
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

  return { delta: "", clean: cleaned, replace: cleaned, replaceInstant: true };
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
