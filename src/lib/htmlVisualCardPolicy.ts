import { extractOocSnippets } from "@/lib/userImpersonationPolicy";
import { extractFocusZoneNote, parseUserNoteCombined } from "@/lib/userNoteStatusWindow";
import { RP_STOP_OR_FLASH_ONLY } from "@/lib/oocHtmlTurnPatterns";
import {
  resolveStatusWindowPlacementFromSources,
  type StatusWindowPlacementSources,
} from "@/lib/statusWindowPlacement";

export const HTML_VISUAL_CARD_DENY =
  /HTML\s*(?:출력|연출|카드)?\s*금지|visual\s*card\s*(?:off|disable)|HTML\s*카드\s*끄/i;

/** HTML 출력 연출 의도 — 띄워/출력/표기 등 */
const HTML_OUTPUT_INTENT =
  /(?:띄워|출력|표기|표시|보여|연출|렌더|표현|작성|만들|그려)/i;

/** 줄글·마크다운(pipe-table) 출력 형식 지시 */
const PLAIN_MARKDOWN_FORMAT =
  /(?:줄글|plain[\s-]*text|마크다운|markdown|pipe[\s-]*table|표\s*형식)/i;

function snippetRequestsPlainOrMarkdownOutput(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (userRequestsHtmlOutput(t)) return false;

  if (/HTML\s*(?:없이|금지|사용\s*(?:하지|않)|미사용)|without\s*HTML|no\s*HTML/i.test(t)) {
    return /(?:출력|표기|표시|보여|띄워|상태창|status)/i.test(t);
  }

  const formatHint = PLAIN_MARKDOWN_FORMAT.test(t) || /^\s*\|.+\|\s*$/m.test(t);
  const outputIntent = HTML_OUTPUT_INTENT.test(t);
  if (formatHint && outputIntent) return true;

  // 상태창 + 출력 의도, HTML 없음 → 서버 줄글/마크다운(StatusMeta Flash)
  if (/상태창|status\s*window/i.test(t) && outputIntent && !/HTML/i.test(t)) return true;

  return false;
}

/** 유저노트·페르소나·채팅 — HTML 없이 줄글/마크다운 출력 지시 */
export function userRequestsPlainOrMarkdownOutput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const snippet of extractOocSnippets(trimmed)) {
    if (snippetRequestsPlainOrMarkdownOutput(snippet)) return true;
  }
  return snippetRequestsPlainOrMarkdownOutput(trimmed);
}

export function sourcesHavePlainOrMarkdownOutputRequest(sources: {
  userNote?: string;
  userPersona?: string;
  userMessage?: string;
}): boolean {
  for (const raw of [sources.userNote, sources.userPersona, sources.userMessage]) {
    if (raw?.trim() && userRequestsPlainOrMarkdownOutput(raw)) return true;
  }
  return false;
}

/**
 * 사용자 텍스트에 HTML 출력 요청이 있는지.
 * - `HTML`/`html` 키워드 + 출력 의도, 또는 ```html 펜스
 * - "맛집 TOP5 카드로 보여줘"처럼 HTML 언급 없는 UI 요청은 false
 * - "HTML을 사용해서 맛집 TOP5를 띄워줘"처럼 HTML + 연출 동사는 true
 */
export function userRequestsHtmlOutput(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/```html/i.test(t)) return true;
  if (/HTML\s*(?:OUTPUT|VISUAL\s*CARD)|\[SYSTEM:\s*HTML/i.test(t)) return true;
  if (!/HTML/i.test(t)) return false;

  // "HTML 없이 출력", "without HTML", technical mentions — NOT an HTML output request
  if (
    /HTML\s*(?:없이|금지|사용\s*(?:하지|않)|미사용)|without\s*HTML|no\s*HTML|HTML\s*(?:injection|inject|forbid|forbidden|disabled)/i.test(
      t
    )
  ) {
    return false;
  }

  if (/HTML(?:을?\s*(?:사용|써)|로|카드(?:으로|로)?|\s*(?:출력|연출))/i.test(t)) return true;
  // HTML(옵션…) / HTML…로 꾸며 — OOC 스타일
  if (/HTML\s*[\(（]/i.test(t)) return true;
  if (/HTML[\s\S]{0,80}(?:꾸며|렌더|표현|서술|작성|출력|연출)/i.test(t)) return true;
  if (HTML_OUTPUT_INTENT.test(t)) return true;
  return false;
}

/** 유저노트·페르소나·채팅 입력 중 HTML 출력 지시가 있는지 */
export function sourcesHaveExplicitHtmlOutputRequest(sources: {
  userNote?: string;
  userPersona?: string;
  userMessage?: string;
}): boolean {
  for (const raw of [sources.userNote, sources.userPersona, sources.userMessage]) {
    const t = raw?.trim() ?? "";
    if (t && userRequestsHtmlOutput(t)) return true;
  }
  return false;
}

/** 기본 HTML 카드·경고창 가로 상한 */
export const HTML_VISUAL_CARD_MAX_WIDTH_PX = 550;
/** 메신저 템플릿 가로 상한 */
export const HTML_MESSENGER_MAX_WIDTH_PX = 400;

/** 범용 카드 템플릿 — 모델은 구조 복사 후 내용·포인트 컬러만 변경 */
export const HTML_VISUAL_CARD_REFERENCE_TEMPLATE = `<div style="max-width: ${HTML_VISUAL_CARD_MAX_WIDTH_PX}px; margin: 15px auto; padding: 20px; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #eaeaea; font-family: sans-serif; color: #333333; line-height: 1.5; word-break: keep-all;">

  <!-- 1. 카테고리 뱃지 -->
  <div style="font-size: 12px; font-weight: bold; color: #888888; text-align: center; margin-bottom: 8px;">
    [ 카테고리 입력 (예: SYSTEM ALERT, 맛집 가이드) ]
  </div>

  <!-- 2. 메인 타이틀 -->
  <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #111111; text-align: center; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">
    📌 메인 타이틀 입력
  </h3>

  <!-- 3. 본문 박스 (필요한 만큼 반복) -->
  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 12px; margin-bottom: 10px; border-left: 4px solid #4a90e2;">
    <p style="margin: 0 0 5px 0; font-weight: bold; font-size: 15px; color: #222;">
      ▶ 소제목 또는 항목명
    </p>
    <p style="margin: 0; font-size: 14px; color: #555;">
      상세 내용, 설명, 또는 이유를 간결하게 작성.
    </p>
  </div>

  <!-- 4. 추가 항목이 있다면 위 본문 박스(div) 구조를 그대로 복사하여 반복 -->

  <!-- 5. 하단 꼬리말 (선택) -->
  <div style="font-size: 12px; color: #999999; text-align: right; margin-top: 15px;">
    ※ 추가 참고 사항이나 짧은 코멘트
  </div>

</div>`;

/** 스마트폰 메신저(카톡·DM 등) — 말풍선 flex 구조 고정 */
export const HTML_MESSENGER_REFERENCE_TEMPLATE = `<div style="max-width: ${HTML_MESSENGER_MAX_WIDTH_PX}px; margin: 15px auto; background-color: #b2c7d9; border-radius: 16px; box-shadow: 0 5px 15px rgba(0,0,0,0.15); font-family: sans-serif; overflow: hidden; border: 1px solid #9bb4c9;">
  <!-- 상단바 -->
  <div style="background-color: #ffffff; padding: 12px; text-align: center; font-weight: bold; font-size: 15px; border-bottom: 1px solid #ddd; color: #333;">
    📱 [ 상대방 이름 또는 그룹명 ]
  </div>
  <!-- 채팅 영역 -->
  <div style="padding: 15px; display: flex; flex-direction: column; gap: 10px;">

    <!-- 시스템 메시지 (날짜 등) -->
    <div style="text-align: center; font-size: 11px; color: #666; margin-bottom: 5px;">
      [ 현재 날짜 또는 시간 ]
    </div>

    <!-- 상대방 말풍선 (왼쪽) -->
    <div style="display: flex; flex-direction: column; align-items: flex-start;">
      <div style="font-size: 11px; color: #444; margin-bottom: 3px; margin-left: 5px;">[ 상대방 이름 ]</div>
      <div style="background-color: #ffffff; color: #333; padding: 8px 12px; border-radius: 14px; border-top-left-radius: 4px; font-size: 14px; max-width: 80%; box-shadow: 0 1px 2px rgba(0,0,0,0.05); line-height: 1.4; word-break: keep-all;">
        [ 상대방의 텍스트 메시지 내용 ]
      </div>
    </div>

    <!-- 내 말풍선 (오른쪽) -->
    <div style="display: flex; flex-direction: column; align-items: flex-end;">
      <div style="background-color: #ffeb33; color: #333; padding: 8px 12px; border-radius: 14px; border-top-right-radius: 4px; font-size: 14px; max-width: 80%; box-shadow: 0 1px 2px rgba(0,0,0,0.05); line-height: 1.4; word-break: keep-all;">
        [ 주인공의 텍스트 메시지 내용 ]
      </div>
    </div>

    <!-- 대화가 길면 말풍선(div) 구조를 필요한 만큼 반복해서 추가 -->
  </div>
</div>`;

/** 시스템 경고창 — 레이아웃 고정, 항목 문구는 경고 종류에 맞게 치환 */
export const HTML_ALERT_REFERENCE_TEMPLATE = `<div style="max-width: ${HTML_VISUAL_CARD_MAX_WIDTH_PX}px; margin: 15px auto; border: 2px solid #e53935; border-radius: 8px; background-color: #fffcfc; box-shadow: 0 4px 15px rgba(229, 57, 53, 0.2); font-family: sans-serif; overflow: hidden; word-break: keep-all;">
  <div style="background-color: #e53935; color: white; padding: 10px; text-align: center; font-weight: bold; font-size: 16px; letter-spacing: 1px;">
    🚨 [ 어떤 경고인지 경고하는 내용의 제목 ]
  </div>
  <div style="padding: 15px;">
    <h3 style="margin: 0 0 10px 0; color: #d32f2f; font-size: 18px; text-align: center;">[ 경고창의 지시 내용 ]</h3>
    <div style="background-color: #fbe9e7; padding: 10px; border-radius: 6px; border-left: 4px solid #d32f2f; font-size: 14px; color: #333; line-height: 1.6;">
      <p style="margin: 0 0 5px 0;"><strong>▶ 위협 등급:</strong> [ 대응해야할 상대명 ]</p>
      <p style="margin: 0 0 5px 0;"><strong>▶ 발생 위치:</strong> [ 현재 서사 상의 위치 ]</p>
      <p style="margin: 0;"><strong>▶ 권장 대응:</strong> [ 상황에 맞는 대응책 ]</p>
    </div>
  </div>
</div>`;

/** standing 상태창 — 유저노트 필드별 박스 (HP/RPG 바 없음) */
const DEFAULT_STATUS_WINDOW_FIELD_PLACEHOLDERS = [
  "필드 라벨 예시 1",
  "필드 라벨 예시 2",
];

function escapeHtmlTemplateText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusWindowFieldBox(label: string, content: string): string {
  const safeLabel = escapeHtmlTemplateText(stripEmojisAndDecorators(label) || label);
  const safeContent = escapeHtmlTemplateText(content);
  return `<section style="margin:0 0 10px;padding:12px 14px;border-radius:10px;background:linear-gradient(180deg,#f8f9fb 0%,#fff 100%);border:1px solid #e8eaed;box-shadow:0 1px 2px rgba(0,0,0,.04)"><h4 style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.01em;color:#5f6368">${safeLabel}</h4><p style="margin:0;font-size:14px;line-height:1.55;color:#202124">${safeContent}</p></section>`;
}

function decodeHtmlTemplateEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeStatusFieldLabelKey(label: string): string {
  return stripEmojisAndDecorators(label).replace(/\s+/g, " ").trim().toLowerCase();
}

export function isPlaceholderStatusFieldContent(content: string): boolean {
  const t = content.trim();
  if (!t || t === "—" || t === "-") return true;
  return /^(?:\(장면에 맞게|필드 라벨|\{이 필드|참고하세요)/i.test(t);
}

/** Flash·fallback HTML에서 필드 라벨·내용 추출 */
export function extractStatusFieldPairsFromHtml(html: string): { label: string; content: string }[] {
  const inner = html
    .replace(/^```html\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const pairs: { label: string; content: string }[] = [];
  const seen = new Set<string>();
  const pushPair = (label: string, content: string) => {
    const l = label.trim();
    const c = content.trim();
    if (!l || l === "상태창" || !c) return;
    const key = normalizeStatusFieldLabelKey(l);
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ label: l, content: c });
  };

  const labelContentRes = [
    /<p[^>]*(?:font-weight:\s*(?:700|bold)|font-weight:700)[^>]*>([\s\S]*?)<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/gi,
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>\s*<p[^>]*>([\s\S]*?)<\/p>/gi,
    /<strong[^>]*>([\s\S]*?)<\/strong>\s*<p[^>]*>([\s\S]*?)<\/p>/gi,
  ];
  for (const re of labelContentRes) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
      pushPair(
        decodeHtmlTemplateEntities(m[1]!.replace(/<[^>]+>/g, "").trim()),
        decodeHtmlTemplateEntities(m[2]!.replace(/<[^>]+>/g, "").trim())
      );
    }
  }
  return pairs;
}

const FORBIDDEN_UNDECLARED_STAT_LABELS =
  /(?:^|\s)(?:HP|MP|SAN|호감도|가이딩|유동\s*스탯)(?:\s|:|$)/i;

function innerHtmlContainsAllStatusLabels(inner: string, orderedLabels: string[]): boolean {
  const plain = decodeHtmlTemplateEntities(inner.replace(/<[^>]+>/g, " "));
  return orderedLabels.every((label) => {
    const stripped = stripEmojisAndDecorators(label);
    return plain.includes(stripped) || plain.includes(label.trim());
  });
}

function innerHtmlHasUndeclaredStatFields(inner: string, orderedLabels: string[]): boolean {
  const plain = decodeHtmlTemplateEntities(inner.replace(/<[^>]+>/g, " "));
  if (!FORBIDDEN_UNDECLARED_STAT_LABELS.test(plain)) return false;
  return !orderedLabels.some((l) => FORBIDDEN_UNDECLARED_STAT_LABELS.test(l));
}

/** Flash 커스텀 레이아웃 유지 가능 — 라벨·내용 충족, undeclared stat 없음 */
export function canPreserveFlashStatusWindowLayout(
  htmlBlock: string,
  orderedLabels: string[]
): boolean {
  if (orderedLabels.length === 0) return false;
  const inner = unwrapHtmlVisualCardInner(htmlBlock);
  if (!inner || isGenericHtmlStatusWindowInner(inner)) return false;
  if (!innerHtmlContainsAllStatusLabels(inner, orderedLabels)) return false;
  if (innerHtmlHasUndeclaredStatFields(inner, orderedLabels)) return false;
  const pairs = extractStatusFieldPairsFromHtml(htmlBlock);
  if (pairs.length === 0) return false;
  return orderedLabels.every((label, index) => {
    const content = resolveStatusFieldContent(label, pairs, index);
    return content !== "—" && !isPlaceholderStatusFieldContent(content);
  });
}

function unwrapHtmlVisualCardInner(htmlBlock: string): string {
  let inner = htmlBlock.trim();
  for (let i = 0; i < 4 && /^```html/i.test(inner); i++) {
    inner = inner.replace(/^```html\s*/i, "").trim();
    inner = inner.replace(/```[\s\S]*$/, "").trim();
  }
  return inner.replace(/```\s*$/, "").trim();
}

function resolveStatusFieldContent(
  label: string,
  pairs: { label: string; content: string }[],
  index: number
): string {
  const key = normalizeStatusFieldLabelKey(label);

  const exact = pairs.find((p) => normalizeStatusFieldLabelKey(p.label) === key);
  if (exact && !isPlaceholderStatusFieldContent(exact.content)) return exact.content;

  const fuzzy = pairs.find((p) => {
    const pk = normalizeStatusFieldLabelKey(p.label);
    return pk.includes(key) || key.includes(pk);
  });
  if (fuzzy && !isPlaceholderStatusFieldContent(fuzzy.content)) return fuzzy.content;

  const byIndex = pairs[index];
  if (byIndex && !isPlaceholderStatusFieldContent(byIndex.content)) return byIndex.content;

  return "—";
}

/** Flash HTML → 유저노트 필드 라벨·순서 강제 (HP 등 임의 필드 제거) */
export function enforceHtmlStatusWindowFieldLabels(
  htmlBlock: string,
  orderedLabels: string[]
): string | null {
  if (orderedLabels.length === 0) return null;

  if (canPreserveFlashStatusWindowLayout(htmlBlock, orderedLabels)) {
    const inner = polishHtmlVisualCardInner(unwrapHtmlVisualCardInner(htmlBlock));
    return `\`\`\`html\n${inner}\n\`\`\``;
  }

  const pairs = extractStatusFieldPairsFromHtml(htmlBlock);
  const fields = orderedLabels.map((label, index) => ({
    label,
    content: resolveStatusFieldContent(label, pairs, index),
  }));

  const hasRealContent = fields.some(
    (f) => f.content !== "—" && !isPlaceholderStatusFieldContent(f.content)
  );
  if (!hasRealContent && pairs.length === 0) return null;

  const inner = buildHtmlStatusWindowCardFromFields(fields).trim();
  return `\`\`\`html\n${inner}\n\`\`\``;
}

/** 상태창 카드 — 필드별 실제 내용 */
export function buildHtmlStatusWindowCardFromFields(
  fields: { label: string; content: string }[]
): string {
  const rows =
    fields.length > 0
      ? fields
      : DEFAULT_STATUS_WINDOW_FIELD_PLACEHOLDERS.map((label) => ({ label, content: "—" }));

  const boxes = rows.map(({ label, content }) => statusWindowFieldBox(label, content)).join("");
  return `<div style="max-width:${HTML_VISUAL_CARD_MAX_WIDTH_PX}px;margin:14px auto;padding:14px 16px;border-radius:14px;background:#fff;border:1px solid #e8eaed;box-shadow:0 2px 8px rgba(0,0,0,.06);font-family:system-ui,-apple-system,sans-serif;color:#202124;line-height:1.5;word-break:keep-all">${boxes}</div>`;
}

/** 상태창 카드 본문 — 필드 라벨당 박스 1개 (compact 단일행 스타일) */
export function buildHtmlStatusWindowCardInnerHtml(
  statusFieldLabels: string[],
  contentPlaceholder: string
): string {
  const fields =
    statusFieldLabels.length > 0 ? statusFieldLabels : DEFAULT_STATUS_WINDOW_FIELD_PLACEHOLDERS;

  return buildHtmlStatusWindowCardFromFields(
    fields.map((label) => ({ label, content: contentPlaceholder }))
  );
}

/** Flash·정책용 REFERENCE — 유저노트 필드 목록 기준 */
export function buildHtmlStatusWindowReferenceTemplate(statusFieldLabels: string[] = []): string {
  return buildHtmlStatusWindowCardInnerHtml(
    statusFieldLabels,
    "{이 필드 라벨에 맞는 장면 내용 — 한글·영문·숫자·구두점만}"
  );
}

const STATUS_WINDOW_BANNER_LABEL =
  /^(?:상태창|状态창|状態창|status\s*window)$/i;

function htmlElementPlainText(fragment: string): string {
  return stripEmojisAndDecorators(
    decodeHtmlTemplateEntities(fragment.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
  );
}

/** Flash·REFERENCE 습관 — 카드 상단 "상태창" 단독 배너 제거 (필드 라벨·OOC UI 제목은 유지) */
export function stripHtmlStatusWindowTitleBanner(inner: string): string {
  let t = inner.trim();
  if (!t) return t;

  const stripIfBanner = (full: string, body: string): string =>
    STATUS_WINDOW_BANNER_LABEL.test(htmlElementPlainText(body)) ? "" : full;

  for (const tag of ["header", "h1", "h2", "h3", "h4", "h5", "h6", "p"] as const) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    t = t.replace(re, (full, body: string) => stripIfBanner(full, body));
  }

  // div/span — 자식 태그 없이 텍스트만 "상태창"인 경우
  for (const tag of ["div", "span"] as const) {
    const re = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "gi");
    t = t.replace(re, (full, body: string) => stripIfBanner(full, body));
  }

  return t.replace(/^(?:\s|<br\s*\/?>)+/i, "").trim();
}

/** inner HTML — 배너 제거 등 Flash 후처리 */
export function polishHtmlVisualCardInner(inner: string): string {
  return stripHtmlStatusWindowTitleBanner(inner.trim());
}

/** 서버 fallback·Flash가 복사한 **구형** 상태창 템플릿 — OOC·구템플릿 거부 */
export function isGenericHtmlStatusWindowInner(inner: string): boolean {
  const t = polishHtmlVisualCardInner(inner);
  if (!t) return false;
  if (/>\s*상태창\s*</.test(t) || /text-align:center[^>]*>\s*상태창\s*</i.test(t)) return true;
  if (/\(장면에 맞게\s*RP\s*본문을 참고하세요\)/.test(t)) return true;
  if (/\{이 필드 라벨에 맞는/.test(t)) return true;
  if (/border-left:3px solid #4a90e2/i.test(t)) return true;
  const defaultTriple =
    /현재\s*상황/.test(t) && /속마음/.test(t) && /다음\s*행동/.test(t);
  if (defaultTriple) {
    if (isPlaceholderOnlyStatusWindowInner(t)) return true;
    if (
      !/<section\b/i.test(t) &&
      /font-weight:700[^>]*>[\s\S]*속마음/i.test(t)
    ) {
      return true;
    }
    const plain = decodeHtmlTemplateEntities(t.replace(/<[^>]+>/g, " "));
    if (plain.length < 220 && !/익명|메시지\s*함|twitter|inbox|질문/i.test(plain)) {
      return true;
    }
  }
  return false;
}

/** 서버 fallback 기본 RP 3필드 — 현재 상황/속마음/다음 행동 */
export function isDefaultRpStatusWindowFieldSetInner(inner: string): boolean {
  const t = polishHtmlVisualCardInner(inner);
  if (!t) return false;
  const plain = decodeHtmlTemplateEntities(t.replace(/<[^>]+>/g, " "));
  return /현재\s*상황/.test(plain) && /속마음/.test(plain) && /다음\s*행동/.test(plain);
}

/** 필드 내용이 전부 —·placeholder뿐인지 */
export function isPlaceholderOnlyStatusWindowInner(inner: string): boolean {
  const t = polishHtmlVisualCardInner(inner);
  if (!t) return true;
  const pairs = extractStatusFieldPairsFromHtml(`\`\`\`html\n${t}\n\`\`\``);
  if (pairs.length > 0) {
    return pairs.every((p) => isPlaceholderStatusFieldContent(p.content));
  }
  return (t.match(/>\s*—\s*</g) ?? []).length >= 2;
}

/** OOC Flash HTML — 저장·반환 금지 (기본 상태창·placeholder) */
export function oocFlashHtmlMustBeRejected(inner: string): boolean {
  const t = polishHtmlVisualCardInner(inner);
  if (!t) return true;
  if (isGenericHtmlStatusWindowInner(t)) return true;
  if (isDefaultRpStatusWindowFieldSetInner(t)) return true;
  return false;
}

/** HTML inner — 태그 제외 표시 텍스트 */
export function visiblePlainFromHtmlInner(inner: string): string {
  return decodeHtmlTemplateEntities(
    polishHtmlVisualCardInner(inner)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** OOC "질문과 답변 각 N개 이상" 등 — 최소 Q/A 개수 */
export function parseOocMinQaCount(userMessage: string): number | null {
  const t = userMessage.trim();
  if (!t) return null;
  const pairMatch = t.match(/질문(?:과|와)?\s*답변[\s\S]{0,60}?각(?:각)?\s*(\d+)\s*개\s*이상/i);
  if (pairMatch) return Math.max(1, parseInt(pairMatch[1]!, 10));
  const eachMatch = t.match(/각(?:각)?\s*(\d+)\s*개\s*이상[\s\S]{0,50}?(?:질문|답변)/i);
  if (eachMatch) return Math.max(1, parseInt(eachMatch[1]!, 10));
  return null;
}

export function oocRequestsAnonymousInbox(userMessage: string): boolean {
  return /익명\s*메(?:시지|일)|메시지\s*함|anonymous\s*(?:message|inbox)|twitter|트위터|네임드\s*계정/i.test(
    userMessage
  );
}

/** OOC 커스텀 HTML — 프로필/헤더만 있고 본문(Q&A·메시지)이 빈 경우 거부 */
export function isOocCreativeHtmlRichEnough(inner: string, userMessage = ""): boolean {
  const plain = visiblePlainFromHtmlInner(inner);
  if (plain.length < 240) return false;

  const minQa = parseOocMinQaCount(userMessage);
  const inbox = oocRequestsAnonymousInbox(userMessage);
  const requiredPairs = minQa ?? (inbox ? 5 : 0);

  if (requiredPairs <= 0) {
    return plain.length >= 320;
  }

  if (plain.length < requiredPairs * 70) return false;

  const listItems = (inner.match(/<li\b/gi) ?? []).length;
  const sections = (inner.match(/<(?:section|article)\b/gi) ?? []).length;
  const messageDivs = (
    inner.match(/<div[^>]*class="[^"]*(?:msg|message|mail|post|card|thread|qa|item)/gi) ?? []
  ).length;
  const structuralBlocks = listItems + sections + messageDivs;
  const qaMarkers = (plain.match(/(?:^|[\s,.])(?:Q\d+|A\d+|질문\s*\d|답변\s*\d|익명\s*\d)/gi) ?? [])
    .length;

  if (structuralBlocks >= requiredPairs) return true;
  if (qaMarkers >= requiredPairs * 2) return true;
  if (plain.length >= requiredPairs * 120) return true;

  return false;
}

/** OOC Flash HTML — div 균형·180자 미만이어도 저장 가능한 최소 품질 */
export function isPreservableOocHtmlInner(inner: string, userMessage = ""): boolean {
  const t = polishHtmlVisualCardInner(inner);
  if (!t || t.length < 100) return false;
  if (oocFlashHtmlMustBeRejected(t)) return false;
  if (userMessage.trim() && !isOocCreativeHtmlRichEnough(t, userMessage)) return false;
  return /<(?:div|section|main|article|ul|ol|table|p|h[1-6]|blockquote)\b/i.test(t);
}

/** OOC `[외형 · 키워드 · …]` 괄호 항목 — 추구미 등 카테고리 카드 */
export function parseOocBracketCategories(userMessage: string): string[] {
  const m = userMessage.trim().match(/\[([^\]]{3,240})\]/);
  if (!m) return [];
  return m[1]!
    .split(/[·•|／/]/)
    .map((s) => s.replace(/\([^)]*\)/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 48);
}

export function oocRequestsCategoryCard(userMessage: string): boolean {
  if (parseOocBracketCategories(userMessage).length >= 2) return true;
  return /추구미|카테고리(?:별|\s*항목)|항목(?:은|이)\s*\[/i.test(userMessage);
}

function escapeRegExpFragment(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function htmlToPlainWithBreaks(html: string): string {
  return polishHtmlVisualCardInner(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** OOC HTML — 카테고리별 margin-bottom·분리 블록이 있는지 */
export function oocHtmlHasAdequateSectionSpacing(
  inner: string,
  categories: string[] = []
): boolean {
  const t = polishHtmlVisualCardInner(inner);
  if (!t) return false;
  const spacedBlocks = (t.match(/margin(?:-bottom)?:\s*(?:0\s+0\s+)?(?:1[0-9]|[2-9]\d)/gi) ?? []).length;
  const sections = (t.match(/<(?:section|article)\b/gi) ?? []).length;
  const separatedBlocks = (t.match(/<\/(?:section|div)>\s*<(?:section|div)\b/gi) ?? []).length;
  const minBlocks = categories.length >= 2 ? Math.min(3, categories.length) : 2;
  if (spacedBlocks >= minBlocks || sections >= minBlocks) return true;
  if (categories.length >= 2 && separatedBlocks >= categories.length - 1) return true;
  if (categories.length === 0 && separatedBlocks >= 2) return true;
  return false;
}

function buildOocCategorySectionHtml(label: string, body: string): string {
  const safeLabel = escapeHtmlTemplateText(stripEmojisAndDecorators(label) || label);
  const lines = body
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const listItems =
    lines.length > 1
      ? lines
      : body
          .split(/[,，、]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 2);
  const bodyHtml =
    listItems.length > 1
      ? listItems
          .map(
            (item) =>
              `<p style="margin:0 0 6px;font-size:13px;line-height:1.55;color:#374151">${escapeHtmlTemplateText(item)}</p>`
          )
          .join("")
      : `<p style="margin:0;font-size:13px;line-height:1.6;color:#374151">${escapeHtmlTemplateText(body)}</p>`;
  return `<section style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:linear-gradient(180deg,#f8f9fb 0%,#fff 100%);border:1px solid #e8eaed;box-shadow:0 1px 2px rgba(0,0,0,.04)"><h4 style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.02em;color:#4338ca">${safeLabel}</h4>${bodyHtml}</section>`;
}

/** OOC 카테고리 카드(추구미 등) — Flash REFERENCE·서버 fallback 공용 껍데기 */
export function buildOocCategoryCardReferenceTemplate(
  categories: string[],
  options?: { title?: string | null; contentPlaceholder?: string }
): string {
  const cats = categories.map((c) => c.replace(/\([^)]*\)/g, "").trim()).filter(Boolean);
  if (cats.length === 0) return "";
  const placeholder =
    options?.contentPlaceholder ?? "（이 항목 — 캐릭터·장면 맥락에 맞는 내용）";
  const sections = cats.map((label) => buildOocCategorySectionHtml(label, placeholder)).join("");
  const title = options?.title?.trim();
  const titleBlock = title
    ? `<h3 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#1e1b4b;text-align:center;letter-spacing:-.02em">${escapeHtmlTemplateText(title)}</h3>`
    : "";
  return `<div style="max-width:480px;margin:16px auto;padding:16px 18px;border-radius:16px;background:#fff;border:1px solid #eceef3;box-shadow:0 4px 14px rgba(15,23,42,.06);font-family:system-ui,-apple-system,sans-serif;color:#202124;line-height:1.5;word-break:keep-all">${titleBlock}${sections}</div>`;
}

export function parseOocCardTitle(userMessage: string): string | null {
  const t = userMessage.trim();
  if (!t) return null;
  if (/추구미/.test(t)) return "추구미";
  const topic = t.match(/(?:알아본다|조사(?:한다|해)|정리(?:한다|해))[.\s]*(?:.*?)([가-힣A-Za-z]{2,12})/);
  if (topic?.[1] && !/대화|항목|내용|html/i.test(topic[1])) return topic[1];
  return null;
}

function findCategoryLabelIndex(plain: string, displayLabel: string): number {
  const base = displayLabel.replace(/\([^)]*\)/g, "").trim();
  const variants = [...new Set([base, base.replace(/\s/g, "")].filter(Boolean))];
  for (const v of variants) {
    const patterns = [
      new RegExp(`(?:^|[\\n\\s,，])${escapeRegExpFragment(v)}(?:\\([^)]*\\))?\\s*[:：]`, "i"),
      new RegExp(`(?:^|[\\n\\s])【\\s*${escapeRegExpFragment(v)}\\s*】`, "i"),
      new RegExp(`(?:^|[\\n\\s])\\d+\\.\\s*${escapeRegExpFragment(v)}`, "i"),
      new RegExp(`(?:^|[\\s:：·▸▪■])${escapeRegExpFragment(v)}(?:\\([^)]*\\))?\\s*[:：·]?`, "i"),
    ];
    for (const re of patterns) {
      const idx = plain.search(re);
      if (idx >= 0) return idx;
    }
  }
  return -1;
}

function restructureOocHtmlByCategories(
  html: string,
  categories: string[],
  userMessage = ""
): string | null {
  const plain = htmlToPlainWithBreaks(html);
  const positions: { displayLabel: string; index: number }[] = [];

  for (const cat of categories) {
    const displayLabel = cat.replace(/\([^)]*\)/g, "").trim();
    const idx = findCategoryLabelIndex(plain, displayLabel);
    if (idx >= 0) positions.push({ displayLabel, index: idx });
  }

  if (positions.length < 2) return null;
  positions.sort((a, b) => a.index - b.index);

  const sections: { label: string; body: string }[] = [];
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    const nextIdx = positions[i + 1]?.index ?? plain.length;
    let chunk = plain.slice(pos.index, nextIdx);
    chunk = chunk
      .replace(
        new RegExp(
          `^${escapeRegExpFragment(pos.displayLabel)}(?:\\([^)]*\\))?\\s*[:：·]?`,
          "i"
        ),
        ""
      )
      .trim();
    if (chunk) sections.push({ label: pos.displayLabel, body: chunk });
  }

  const conclusionMatch = plain.match(/최종\s*결론\s*[:：]?\s*([\s\S]+)$/i);
  if (conclusionMatch?.[1]?.trim() && !sections.some((s) => /결론/.test(s.label))) {
    sections.push({ label: "최종 결론", body: conclusionMatch[1].trim() });
  }

  if (sections.length < 2) return null;

  const title = parseOocCardTitle(userMessage);
  const sectionHtml = sections.map((s) => buildOocCategorySectionHtml(s.label, s.body)).join("");
  const titleBlock = title
    ? `<h3 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#1e1b4b;text-align:center;letter-spacing:-.02em">${escapeHtmlTemplateText(title)}</h3>`
    : "";
  return `<div style="max-width:480px;margin:16px auto;padding:16px 18px;border-radius:16px;background:#fff;border:1px solid #eceef3;box-shadow:0 4px 14px rgba(15,23,42,.06);font-family:system-ui,-apple-system,sans-serif;color:#202124;line-height:1.5;word-break:keep-all">${titleBlock}${sectionHtml}</div>`;
}

function injectGenericBlockSpacing(html: string): string {
  const t = polishHtmlVisualCardInner(html);
  if (/<\/(?:section|div)>\s*<(?:section|div)\b/i.test(t)) return t;
  const plain = htmlToPlainWithBreaks(t);
  if (plain.length < 80) return t;
  const paragraphs = plain.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 10);
  if (paragraphs.length < 2) return t;
  const inner = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#374151">${escapeHtmlTemplateText(p)}</p>`
    )
    .join("");
  return `<div style="max-width:480px;margin:16px auto;padding:16px 18px;border-radius:16px;background:#fff;border:1px solid #eceef3;box-shadow:0 4px 14px rgba(15,23,42,.06);font-family:system-ui,-apple-system,sans-serif">${inner}</div>`;
}

/** OOC Flash HTML — run-on 블록을 카테고리별 분리·margin-bottom 래퍼로 재구성 */
export function ensureOocHtmlSectionSpacing(inner: string, userMessage: string): string {
  const t = polishHtmlVisualCardInner(inner.trim());
  if (!t) return t;
  const categories = parseOocBracketCategories(userMessage);
  if (oocHtmlHasAdequateSectionSpacing(t, categories)) return t;

  if (categories.length >= 2) {
    const rebuilt = restructureOocHtmlByCategories(t, categories, userMessage);
    if (rebuilt) return rebuilt;
  }

  return injectGenericBlockSpacing(t);
}

/** @deprecated buildHtmlStatusWindowReferenceTemplate() — lorebook·레거시 호환 */
export const HTML_STATUS_WINDOW_REFERENCE_TEMPLATE = buildHtmlStatusWindowReferenceTemplate();

/** 이모지·기호 제거 — HTML 필드 값에는 글자·숫자·구두점만 */
export function stripEmojisAndDecorators(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, "")
    .replace(/^[▶📌※\s|]+|[\s|]+$/g, "")
    .trim();
}

const EMOJI_IN_LINE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

const STATUS_FIELD_NOTE_CONTEXT =
  /상태창|状态창|状態창|status\s*window|스탯\s*창|스텟\s*창/i;

/** HTML standing이 상태창(필드 UI)용인지 — 메신저·카드 단독 HTML과 구분 */
function sourceRequestsHtmlStatusWindow(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || hasHtmlVisualCardDeny(trimmed)) return false;
  for (const snippet of extractOocSnippets(trimmed)) {
    if (userRequestsHtmlOutput(snippet) && STATUS_FIELD_NOTE_CONTEXT.test(snippet)) return true;
  }
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (userRequestsHtmlOutput(t) && STATUS_FIELD_NOTE_CONTEXT.test(t)) return true;
  }
  return false;
}

/** 상태창·HTML standing 유저노트 — 이모지 없는 필드 줄도 추출 허용 */
function noteHasStatusFieldContext(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (textRequestsHtmlVisualCardStanding(trimmed)) return true;
  if (!STATUS_FIELD_NOTE_CONTEXT.test(trimmed)) return false;
  return /(?:표기|표시|출력|보여|HTML|하단|매\s*턴|every\s*turn)/i.test(trimmed);
}

function isSkippedStatusFieldSourceLine(trimmed: string): boolean {
  if (/^\|.+\|$/.test(trimmed)) return true;
  if (/^:?-+:?(\|:?-+:?)+$/.test(trimmed.replace(/\s/g, ""))) return true;
  if (/^\|?[:\-| ]+\|?[:\-| ]*$/.test(trimmed.replace(/\s/g, ""))) return true;
  if (/^:?-+:?(\|:?-+:?)*$/.test(trimmed.replace(/\s/g, ""))) return true;
  if (userRequestsHtmlOutput(trimmed)) return true;
  if (/상태창/.test(trimmed) && /(?:표기|표시|출력|HTML)/.test(trimmed)) return true;
  return false;
}

/** 이모지 없는 줄 — 설정형 필드 라벨 vs 세계관 서술 구분 */
function looksLikePlainStatusFieldLabel(trimmed: string): boolean {
  const label = stripEmojisAndDecorators(trimmed);
  if (!label || label.length < 2 || label.length > 120) return false;
  if (/^(?:ooc|OOC|\(|\/\/|\[\[)/i.test(label)) return false;
  if (/\.\s*$/.test(label)) {
    const fieldHint =
      /한\s*줄|요약|짧게|낙서|카오모지|\(\s*[^)]{2,}\)|\d\s*,\s*\d/.test(label);
    if (!fieldHint) return false;
  }
  if (label.length > 80 && /[.!?…]/.test(label)) return false;
  return true;
}

const PIPE_ROW_RE = /^\s*\|.+\|\s*$/;
const PIPE_ROW_LOOSE_RE = /^\s*\|[^|\n]+(\|[^|\n]*)+\|?\s*$/;
const PIPE_SEPARATOR_RE = /^:?-+:?(\|:?-+:?)+$/;

function extractPipeTableLinesForStatusFields(text: string): string | null {
  const lines = text.split("\n");
  let best: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length > best.length) best = [...run];
    run = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (PIPE_ROW_RE.test(trimmed) || PIPE_ROW_LOOSE_RE.test(trimmed)) {
      run.push(line.trimEnd());
    } else if (trimmed) {
      flush();
    }
  }
  flush();

  return best.length >= 2 ? best.join("\n") : null;
}

function isPipeSeparatorCell(cell: string): boolean {
  const compact = cell.replace(/\s/g, "");
  if (!compact) return true;
  if (/^:?-{2,}:?$/.test(compact)) return true;
  return PIPE_SEPARATOR_RE.test(compact);
}

function isStatusTemplatePlaceholderCell(cell: string): boolean {
  const t = cell.trim();
  if (!t) return true;
  const core = stripEmojisAndDecorators(t);
  if (!core) return true;
  if (/^상태창$/i.test(core)) return true;
  if (/^\d{1,2}(?::\d{2})?$/.test(core)) return true;
  if (/^:?-{2,}:?$/.test(core.replace(/\s/g, ""))) return true;
  return false;
}

/** pipe-table 상태창 템플릿 행 → HTML Flash 필드 라벨 */
export function extractHtmlStatusFieldLabelsFromPipeTable(text: string): string[] {
  const table = extractPipeTableLinesForStatusFields(text);
  if (!table) return [];

  const labels: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const label = stripEmojisAndDecorators(raw);
    if (!label || label.length < 2) return;
    const key = normalizeStatusFieldLabelKey(label);
    if (seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };

  for (const line of table.split("\n")) {
    const trimmed = line.trim();
    if (!PIPE_ROW_RE.test(trimmed) && !PIPE_ROW_LOOSE_RE.test(trimmed)) continue;

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);

    if (cells.length === 0) continue;
    if (cells.every(isPipeSeparatorCell)) continue;

    const fieldCells = cells.filter(
      (cell) => !isPipeSeparatorCell(cell) && !isStatusTemplatePlaceholderCell(cell)
    );
    if (fieldCells.length === 0) continue;

    for (const cell of fieldCells) {
      add(cell);
    }
  }

  return labels;
}

function mergeStatusFieldLabels(...groups: string[][]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group) {
      const label = stripEmojisAndDecorators(raw);
      if (!label) continue;
      const key = normalizeStatusFieldLabelKey(label);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(label);
    }
  }
  return merged;
}

/** 유저노트 상태창/필드 힌트 줄 → HTML 출력용 텍스트·숫자 라벨만 */
export function extractHtmlStatusFieldLabels(
  text: string,
  opts?: { allowPlainTextFields?: boolean }
): string[] {
  const fromPipe = extractHtmlStatusFieldLabelsFromPipeTable(text);
  const labels: string[] = [];
  const seen = new Set<string>();
  const allowPlainTextFields =
    opts?.allowPlainTextFields === true || noteHasStatusFieldContext(text);

  const add = (raw: string) => {
    if (isPipeSeparatorCell(raw) || isStatusTemplatePlaceholderCell(raw)) return;
    const label = stripEmojisAndDecorators(raw);
    if (!label) return;
    const key = normalizeStatusFieldLabelKey(label);
    if (key === "상태창" || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || isSkippedStatusFieldSourceLine(trimmed)) continue;

    const hasEmoji = EMOJI_IN_LINE.test(trimmed);
    if (!hasEmoji && (!allowPlainTextFields || !looksLikePlainStatusFieldLabel(trimmed))) continue;

    const parts = trimmed.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) add(part);
    } else {
      add(trimmed);
    }
  }

  return mergeStatusFieldLabels(fromPipe, labels);
}

/** 메인 RP 모델용 — HTML·상태 UI는 백그라운드·서버 전담 */
export const HTML_OUTPUT_OWNERSHIP_BLOCK = `[HTML OUTPUT OWNERSHIP]

The primary RP model outputs Korean RP prose only.

HTML, status windows, JSON, widgets, memory extraction, translation and UI generation are handled by background server processes.

Never generate:
- HTML
- JSON
- pipe tables
- status panels
- <<<STATUS_VALUES>>>

Only generate RP prose.`;

/** @deprecated HTML_OUTPUT_OWNERSHIP_BLOCK */
export const HTML_FLASH_SERVER_ONLY_BLOCK = HTML_OUTPUT_OWNERSHIP_BLOCK;

export type HtmlVisualCardPolicyBlockOpts = {
  standing?: boolean;
  statusFieldLabels?: string[];
};

export function buildHtmlVisualCardPolicyBlock(opts: HtmlVisualCardPolicyBlockOpts = {}): string {
  const standing = opts.standing === true;
  const statusFields = opts.statusFieldLabels ?? [];

  const standingSection = standing
    ? `
Standing (유저노트·페르소나·캐릭터 설정):
- **매 assistant reply마다** 본문(RP) 하단에 \`\`\`html 블록을 반드시 출력한다.
- 유저 채팅 메시지에 HTML 키워드가 없어도 매 턴 출력한다.
- RP 본문 작성 후 HTML 블록을 이어 붙인다. HTML 뒤 설명문 금지.
- RP가 목표 분량보다 짧거나 조기 STOP이어도 **HTML 블록은 생략 금지** — RP 직후 반드시 출력.
- **전체(RP+HTML) 저장 상한 5,000자** — HTML 블록은 반드시 포함. RP가 길면 RP를 줄여도 HTML은 출력.`
    : `
Turn trigger (채팅 메시지 1회):
- 이번 턴에만 \`\`\`html 블록을 출력한다.
- **위치**: 유저가 하단·맨 아래·bottom·본문 하단을 지정하지 않으면 RP **앞(상단)**에 \`\`\`html을 둔다.
- 하단 지정 시 RP **뒤(하단)**에 \`\`\`html을 둔다.`;

  const doodleFieldIdx = statusFields.findIndex((f) => /낙서|카오모지|이모지/.test(f));
  const statusWindowTemplate = buildHtmlStatusWindowReferenceTemplate(statusFields);
  const statusSection =
    statusFields.length > 0
      ? `
[HTML 상태창 필드 — 유저노트 승격]
- **상태창 템플릿** 사용 — 아래 REFERENCE와 동일한 **필드 박스** 구조·inline CSS.
- **출력 필드는 아래 목록만** — 목록에 없는 라벨·HP·MP·SAN·호감도·가이딩·유동스탯·{{char}} 헤더·RPG compact bar **절대 금지**.
- 필드 1개 = 박스 1개. **라벨은 목록 문자열 그대로** 표기하고, 내용만 이번 장면·RP에 맞게 작성.
- 유저노트에 없는 스탯·수치·감정 슬롯을 AI가 임의 추가하지 마라.
${doodleFieldIdx >= 0 ? `- ${doodleFieldIdx + 1}번(낙서) 항목의 **내용**에만 카오모지·이모지 1줄 허용.` : "- HTML 본문에 이모지·장식 기호 금지 — 한글·영문·숫자·구두점만."}
필드 목록(순서·개수·라벨 고정 — 이 목록만 출력):
${statusFields.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
      : standing
        ? `
[HTML 상태창 — standing]
- **상태창 템플릿** 사용 — 유저노트에서 추출된 필드가 없으면 REFERENCE 예시 박스 구조만 참고.
- HP·RPG 바·임의 스탯 슬롯 금지 — 유저노트에 필드 줄을 추가하면 그 라벨만 출력.`
        : "";

  return `[SYSTEM: HTML OUTPUT MODE] 서사 내 특수 UI — HTML 연출 규칙

발동 조건:
- **"HTML을 사용해서 X를 띄워/출력/표기"** 형태로 명시한 경우 (유저노트·페르소나·캐릭터·채팅)
- 또는 \`\`\`html 코드블럭 요청
- HTML 없이 "카드로 보여줘", "카톡 내역", "경고창"만 있는 요청은 발동하지 않는다
${standingSection}
${statusSection}

발동 시: 요청 X에 맞는 **아래 템플릿 1개**를 골라 X 내용으로 채워 \`\`\`html 블록을 출력한다.
${standing || statusFields.length > 0 ? "- standing·상태창 요청 → **상태창 템플릿** 우선." : ""}

템플릿 선택 (X 내용 기준):
1. **상태창 템플릿** — 유저노트 필드 목록(standing·상태창) — 필드 박스만
2. **메신저 템플릿** — 카톡·DM·문자·통화 내역 등
3. **경고창 템플릿** — 시스템 경고·위협 알림·경고창
4. **범용 카드 템플릿** — 리스트·프로필·문서·맛집 TOP5 등

출력 규칙:
1. HTML은 반드시 \`\`\`html 코드블럭 안에서만 출력한다.
2. 절대 새 디자인 창작 금지 — REFERENCE TEMPLATE 구조·inline CSS 복사.
3. 모바일 세로 화면 기준 안정적 width.
4. 이모지·장식 기호는 HTML에 넣지 않는다 — **한글·영문·숫자·구두점만**.
5. **대비 필수:** 본문 글자 #111~#333, 배경 #fff/#f8f9fa — REFERENCE 색 그대로. 비슷한 밝기의 글자색·배경색 조합 금지.

Note: Server-rendered pipe-table status windows are NOT your job.

[상태창 템플릿 (REFERENCE TEMPLATE)]
\`\`\`html
${statusWindowTemplate}
\`\`\`

[범용 카드 템플릿 (REFERENCE TEMPLATE)]
\`\`\`html
${HTML_VISUAL_CARD_REFERENCE_TEMPLATE}
\`\`\`

[메신저 템플릿 (REFERENCE TEMPLATE)]
\`\`\`html
${HTML_MESSENGER_REFERENCE_TEMPLATE}
\`\`\`

[경고창 템플릿 (REFERENCE TEMPLATE)]
\`\`\`html
${HTML_ALERT_REFERENCE_TEMPLATE}
\`\`\``;
}

export type HtmlVisualCardPolicy = {
  enabled: boolean;
  /** 매 턴 허용 (note/persona/creator) vs 이번 턴만 (chat message) */
  standing: boolean;
  statusFieldLabels: string[];
  policyBlock: string;
};

export type HtmlFlashPlacement = "top" | "bottom";

/** Flash HTML 배치 — 유저노트·설정·채팅의 상·하단 지정 따름 (standing 기본=하단, 턴 트리거 기본=상단) */
export function resolveHtmlFlashPlacement(
  policy: HtmlVisualCardPolicy,
  sources: StatusWindowPlacementSources
): HtmlFlashPlacement {
  const defaultPlacement: HtmlFlashPlacement = policy.standing ? "bottom" : "top";
  return resolveStatusWindowPlacementFromSources(sources, defaultPlacement);
}

function collectHtmlStatusFieldLabels(sources: {
  userNote?: string;
  userPersona?: string;
  characterSetting?: string;
}): string[] {
  const noteText = sources.userNote?.trim() ?? "";
  const personaText = sources.userPersona?.trim() ?? "";
  const characterText = sources.characterSetting?.trim() ?? "";
  const noteLabels = noteText ? extractHtmlStatusFieldLabels(noteText) : [];
  const personaLabels = personaText ? extractHtmlStatusFieldLabels(personaText) : [];
  const characterLabels = characterText ? extractHtmlStatusFieldLabels(characterText) : [];
  return mergeStatusFieldLabels(noteLabels, personaLabels, characterLabels);
}

function hasHtmlVisualCardDeny(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (HTML_VISUAL_CARD_DENY.test(trimmed)) return true;
  for (const snippet of extractOocSnippets(trimmed)) {
    if (HTML_VISUAL_CARD_DENY.test(snippet)) return true;
  }
  return false;
}

function snippetRequestsHtmlVisualCard(snippet: string): boolean {
  const s = snippet.trim();
  if (!s || HTML_VISUAL_CARD_DENY.test(s)) return false;
  return userRequestsHtmlOutput(s);
}

/** note/persona에 HTML Visual Card standing 요청이 있는지 (내부·테스트용) */
export function textRequestsHtmlVisualCardStanding(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || hasHtmlVisualCardDeny(trimmed)) return false;

  for (const snippet of extractOocSnippets(trimmed)) {
    if (snippetRequestsHtmlVisualCard(snippet)) return true;
  }

  return userRequestsHtmlOutput(trimmed);
}

/** 채팅 메시지 1회성 HTML 카드 요청 */
export function userMessageRequestsHtmlVisualCard(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || hasHtmlVisualCardDeny(trimmed)) return false;
  if (snippetRequestsHtmlVisualCard(trimmed) || textRequestsHtmlVisualCardStanding(trimmed)) {
    return true;
  }
  // *[OOC: …]* 등 extractOocSnippets 밖의 HTML+RP중단 지시
  if (userRequestsHtmlOutput(trimmed) && RP_STOP_OR_FLASH_ONLY.test(trimmed)) return true;
  return false;
}

const HTML_CARD_DIRECTIVE_LINE =
  /\[SYSTEM:\s*HTML(?:\s*(?:OUTPUT|VISUAL\s*CARD|SMARTPHONE\s*MESSENGER|SYSTEM\s*ALERT))?\s*MODE\]|HTML\s*(?:OUTPUT|VISUAL\s*CARD)\s*MODE|(?:범용\s*카드|메신저|경고창)\s*템플릿|REFERENCE\s*TEMPLATE/i;

function isHtmlCardPromotedLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (HTML_CARD_DIRECTIVE_LINE.test(trimmed)) return true;
  for (const snippet of extractOocSnippets(trimmed)) {
    if (snippetRequestsHtmlVisualCard(snippet)) return true;
  }
  if (textRequestsHtmlVisualCardStanding(trimmed) && userRequestsHtmlOutput(trimmed)) return true;
  return false;
}

function isPromotedHtmlStatusFieldLine(line: string, fieldLabels: string[]): boolean {
  if (fieldLabels.length === 0) return false;
  const trimmed = line.trim();
  if (!trimmed || /^\|.+\|$/.test(trimmed)) return false;

  const parts = trimmed.split("|").map((p) => stripEmojisAndDecorators(p)).filter(Boolean);
  if (parts.length === 0) return false;
  const allowed = new Set(fieldLabels.map((l) => normalizeStatusFieldLabelKey(l)));
  return parts.every((p) => allowed.has(normalizeStatusFieldLabelKey(p)));
}

/** policy 승격된 HTML 카드 지시 — identity/note 중복 제거 */
export function stripPromotedHtmlVisualCardContent(
  text: string,
  fieldLabels: string[] = []
): string {
  const withoutFences = text.replace(/```html\s*[\s\S]*?```/gi, "");
  const kept = withoutFences
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (isHtmlCardPromotedLine(trimmed)) return false;
      if (isPromotedHtmlStatusFieldLine(trimmed, fieldLabels)) return false;
      return true;
    });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function stripRedundantHtmlVisualCardFromSource(
  text: string | null | undefined,
  policy: HtmlVisualCardPolicy
): string {
  const raw = text?.trim() ?? "";
  if (!raw || !policy.enabled) return raw;
  return stripPromotedHtmlVisualCardContent(raw, policy.statusFieldLabels);
}

export function resolveHtmlVisualCardPolicyFromSources(sources: {
  userNote?: string;
  userPersona?: string;
  characterSetting?: string;
  userMessage?: string;
  /** pipe-table 마크다운 상태창 ON — HTML 이모지 상태창 필드만 비활성 (메신저·턴 HTML 유지) */
  markdownStatusWindowActive?: boolean;
  /** 위젯 ON — HTML 상태창은 위젯 전담 (메신저·턴 HTML은 유지) */
  statusWidgetActive?: boolean;
}): HtmlVisualCardPolicy {
  const noteText = sources.userNote?.trim() ?? "";
  const personaText = sources.userPersona?.trim() ?? "";
  const characterText = sources.characterSetting?.trim() ?? "";
  const messageText = sources.userMessage?.trim() ?? "";

  const combined = [noteText, personaText, characterText, messageText].join("\n");
  if (hasHtmlVisualCardDeny(combined)) {
    return { enabled: false, standing: false, statusFieldLabels: [], policyBlock: "" };
  }

  const noteBody = parseUserNoteCombined(noteText).body;
  const noteFocus = extractFocusZoneNote(noteText);

  const notePersonaStanding = sources.statusWidgetActive
    ? false
    : textRequestsHtmlVisualCardStanding(noteFocus) ||
      textRequestsHtmlVisualCardStanding(noteBody) ||
      textRequestsHtmlVisualCardStanding(personaText);

  const characterStanding = sources.statusWidgetActive
    ? false
    : textRequestsHtmlVisualCardStanding(characterText);

  const userHtmlStatusStanding = sources.statusWidgetActive
    ? false
    : sourceRequestsHtmlStatusWindow(noteFocus) ||
      sourceRequestsHtmlStatusWindow(noteBody) ||
      sourceRequestsHtmlStatusWindow(personaText);
  const characterHtmlStatusStanding = sources.statusWidgetActive
    ? false
    : sourceRequestsHtmlStatusWindow(characterText);
  // plain 매턴 상태창(유저노트) ON이면 캐릭터 설정 HTML 상태창 필드는 StatusMetaCard 경로 유지
  const htmlStatusStanding =
    userHtmlStatusStanding ||
    (characterHtmlStatusStanding && sources.markdownStatusWindowActive !== true);

  const userSourcesHtmlExplicit =
    textRequestsHtmlVisualCardStanding(noteFocus) ||
    textRequestsHtmlVisualCardStanding(noteBody) ||
    textRequestsHtmlVisualCardStanding(personaText) ||
    (userRequestsHtmlOutput(messageText) && userMessageRequestsHtmlVisualCard(messageText));

  const plainMarkdownActive =
    sources.markdownStatusWindowActive === true ||
    sourcesHavePlainOrMarkdownOutputRequest({
      userNote: noteText,
      userPersona: personaText,
      userMessage: messageText,
    });

  // 줄글/마크다운 지시 — 캐릭터 HTML standing은 Flash HTML 비활성(유저 HTML 명시 시만 허용)
  const effectiveCharacterStanding =
    characterStanding && !(plainMarkdownActive && !userSourcesHtmlExplicit);

  const standing = notePersonaStanding || effectiveCharacterStanding;

  const turnTrigger = userMessageRequestsHtmlVisualCard(messageText);
  const enabled = standing || turnTrigger;

  if (!enabled) {
    return { enabled: false, standing: false, statusFieldLabels: [], policyBlock: "" };
  }

  // 줄글/마크다운만 요청 — HTML Flash 전면 OFF (StatusMeta Flash만)
  if (plainMarkdownActive && !userSourcesHtmlExplicit && !turnTrigger) {
    return { enabled: false, standing: false, statusFieldLabels: [], policyBlock: "" };
  }

  let statusFieldLabels = htmlStatusStanding
    ? collectHtmlStatusFieldLabels({
        userNote: noteText,
        userPersona: personaText,
        characterSetting: characterText,
      })
    : [];

  if (
    sources.markdownStatusWindowActive === true &&
    statusFieldLabels.length > 0 &&
    !userHtmlStatusStanding
  ) {
    statusFieldLabels = [];
  }

  return {
    enabled: true,
    standing,
    statusFieldLabels,
    policyBlock: buildHtmlVisualCardPolicyBlock({ standing, statusFieldLabels }),
  };
}

/** 채팅 OOC rp_unrelated — 유저노트 standing·상태창 필드 무시, 채팅 OOC Flash만 */
export function applyChatOocExclusiveHtmlPolicy(
  policy: HtmlVisualCardPolicy
): HtmlVisualCardPolicy {
  return {
    enabled: true,
    standing: false,
    statusFieldLabels: [],
    policyBlock: "",
  };
}

/** HTML Flash 상태창(이모지 필드)이 pipe-table 마크다운 상태창을 대체하는지 */
export function htmlPolicyReplacesMarkdownStatus(policy: HtmlVisualCardPolicy): boolean {
  return policy.enabled && policy.standing && policy.statusFieldLabels.length > 0;
}
