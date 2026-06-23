/**
 * 채팅 입력 OOC vs 유저노트 우선순위
 * - rp_unrelated: RP 중단·별도 UI·이계/메타 등 — 유저노트 상태창/HTML 무시, 채팅 OOC만
 * - rp_continuing: 진행 중 RP에 대한 OOC — 채팅 OOC 우선 + 유저노트 반영
 */

import { extractOocSnippets } from "@/lib/userImpersonationPolicy";
import { userRequestsHtmlOutput } from "@/lib/htmlVisualCardPolicy";
import { DISPLAY_INPUT_ONLY, RP_STOP_OR_FLASH_ONLY } from "@/lib/oocHtmlTurnPatterns";

export type ChatOocIntent = "none" | "rp_unrelated" | "rp_continuing";

/** 이계·메타·SNS mock 등 현재 RP와 이어지지 않는 연출 */
const RP_UNRELATED_ALT_SCENE =
  /다른\s*세계|이\s*세계|패러렐|parallel\s*(?:world|universe)|what[\s-]*if|if\s*라인|현실\s*(?:세계|에서)|메타\s*세계|외전\s*세계|alternate\s*(?:universe|world|timeline)|다른\s*우주|parody\s*universe|elsewhere|익명\s*메(?:시지|일)|메시지\s*함|네임드\s*계정|트위터|twitter|sns\s*ui|카톡\s*ui|dm\s*ui|mockup|목업/i;

/** 서사 이어쓰기 금지 */
const RP_UNRELATED_NO_NARRATION =
  /서사\s*(?:중단|금지|하지|생략|멈|停止)|이어\s*(?:쓰|서술|진행)\s*(?:하지|마|않)|새\s*(?:rp|서사|장면)\s*(?:금지|하지|않)|no\s*(?:new\s*)?(?:rp|narration)|stop\s*(?:rp|narration)/i;

/** HTML/표시만 — RP 본문 없이 연출 */
const RP_UNRELATED_HTML_DISPLAY =
  /(?:html|코드).{0,40}(?:띄|보|출|표|구현|서술|연출|작성)|(?:띄|보|출|표|구현|서술).{0,40}(?:html|ui|화면|디자인)/i;

/** 현재 RP 장면을 이어가라는 OOC 힌트 */
const RP_CONTINUING_HINT =
  /계속\s*(?:rp|서사|진행|이어)|현재\s*(?:장면|상황|rp|서사)\s*(?:에서|유지|이어)|다음\s*(?:장면|턴|비트)|호감|관계\s*(?:변화|발전)|속도\s*조절|intensity|더\s*적극|분위기\s*유지|이\s*장면/i;

function messageHasOocMarkers(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (extractOocSnippets(t).length > 0) return true;
  return /\bOOC\b/i.test(t);
}

function snippetIsRpUnrelated(snippet: string): boolean {
  const s = snippet.trim();
  if (!s) return false;
  if (DISPLAY_INPUT_ONLY.test(s)) return true;
  if (RP_STOP_OR_FLASH_ONLY.test(s)) return true;
  if (RP_UNRELATED_NO_NARRATION.test(s)) return true;
  if (RP_UNRELATED_ALT_SCENE.test(s)) return true;
  if (userRequestsHtmlOutput(s) && RP_UNRELATED_HTML_DISPLAY.test(s)) return true;
  if (userRequestsHtmlOutput(s) && !RP_CONTINUING_HINT.test(s)) {
    return /(?:띄|보|출|표|구현|서술|연출|작성|꾸며)/i.test(s);
  }
  return false;
}

function snippetIsRpContinuing(snippet: string): boolean {
  const s = snippet.trim();
  if (!s) return false;
  if (snippetIsRpUnrelated(s)) return false;
  return RP_CONTINUING_HINT.test(s);
}

/** 채팅 OOC 의도 분류 */
export function classifyChatOocIntent(userMessage: string): ChatOocIntent {
  const trimmed = userMessage.trim();
  if (!messageHasOocMarkers(trimmed)) return "none";

  const snippets = extractOocSnippets(trimmed);
  const scanParts = snippets.length > 0 ? snippets : [trimmed];

  let unrelated = false;
  let continuing = false;
  for (const part of scanParts) {
    if (snippetIsRpUnrelated(part)) unrelated = true;
    if (snippetIsRpContinuing(part)) continuing = true;
  }
  if (snippets.length === 0) {
    if (snippetIsRpUnrelated(trimmed)) unrelated = true;
    if (snippetIsRpContinuing(trimmed)) continuing = true;
  }

  if (unrelated && !continuing) return "rp_unrelated";
  if (continuing && !unrelated) return "rp_continuing";
  if (unrelated && continuing) {
    // RP 중단·입력만·HTML-only 가 명시되면 unrelated 우선
    if (
      DISPLAY_INPUT_ONLY.test(trimmed) ||
      RP_STOP_OR_FLASH_ONLY.test(trimmed) ||
      RP_UNRELATED_NO_NARRATION.test(trimmed)
    ) {
      return "rp_unrelated";
    }
    return "rp_continuing";
  }
  // OOC 있으나 분류 애매 — HTML/중단 키워드 있으면 unrelated
  if (userRequestsHtmlOutput(trimmed) && RP_STOP_OR_FLASH_ONLY.test(trimmed)) {
    return "rp_unrelated";
  }
  return "rp_continuing";
}

export function isChatOocRpUnrelated(userMessage: string): boolean {
  return classifyChatOocIntent(userMessage) === "rp_unrelated";
}

export function isChatOocRpContinuing(userMessage: string): boolean {
  return classifyChatOocIntent(userMessage) === "rp_continuing";
}

/** 유저노트 standing 상태창·추가 HTML 억제 — 채팅 OOC만 실행 */
export function chatOocSuppressesUserNoteExtras(userMessage: string): boolean {
  return isChatOocRpUnrelated(userMessage);
}

/** 진행 중 RP용 — 채팅 OOC 우선 + 유저노트 유지 */
export function buildChatOocRpContinuingUserPrompt(userMessage: string): string {
  const msg = userMessage.trim();
  return `[SYSTEM: CHAT OOC — guides this turn's RP; user note status/world rules still apply]
- The OOC inside the user message below takes priority for immediate scene intent.
- Continue the current RP arc per OOC unless OOC says otherwise.
- User note standing status window and world rules remain in effect alongside OOC.

[User message — OOC inside is mandatory]
${msg}`;
}
