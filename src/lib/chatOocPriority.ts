/**
 * 채팅 입력 OOC vs 유저노트 우선순위
 * - rp_unrelated: HTML/UI/메타 등 실제 RP를 작성하지 않는 별도 요청
 * - rp_continuing: 현재 RP를 이어서 연출
 * - rp_scene_reset: 기존 장면 종료 후 같은 캐릭터/세계관으로 새 에피소드 시작
 * - rp_hard_stop: RP 자체를 중단하고 새 RP도 시작하지 않음
 * `OOC` 마커 자체는 stop이 아니다.
 */

import { extractOocSnippets } from "@/lib/userImpersonationPolicy";
import { userRequestsHtmlOutput } from "@/lib/htmlVisualCardPolicy";
import { DISPLAY_INPUT_ONLY, RP_STOP_OR_FLASH_ONLY } from "@/lib/oocHtmlTurnPatterns";

export type ChatOocIntent =
  | "none"
  | "rp_continuing"
  | "rp_scene_reset"
  | "rp_unrelated"
  | "rp_hard_stop";

/** 이계·메타·SNS mock 등 현재 RP와 이어지지 않는 연출 */
const RP_UNRELATED_ALT_SCENE =
  /다른\s*세계|이\s*세계|패러렐|parallel\s*(?:world|universe)|what[\s-]*if|if\s*라인|현실\s*(?:세계|에서)|메타\s*세계|외전\s*세계|alternate\s*(?:universe|world|timeline)|다른\s*우주|parody\s*universe|elsewhere|익명\s*메(?:시지|일)|메시지\s*함|네임드\s*계정|트위터|twitter|sns\s*ui|카톡\s*ui|dm\s*ui|mockup|목업/i;

/** 서사 이어쓰기 금지 — HTML/UI 전용과 함께 쓰일 때 unrelated */
const RP_UNRELATED_NO_NARRATION =
  /서사\s*(?:중단|금지|하지|생략|멈|停止)|이어\s*(?:쓰|서술|진행)\s*(?:하지|마|않)|새\s*(?:rp|서사|장면)\s*(?:금지|하지|않)|no\s*(?:new\s*)?(?:rp|narration)|stop\s*(?:rp|narration)/i;

/** HTML/표시만 — RP 본문 없이 연출 */
const RP_UNRELATED_HTML_DISPLAY =
  /(?:html|코드).{0,40}(?:띄|보|출|표|구현|서술|연출|작성)|(?:띄|보|출|표|구현|서술).{0,40}(?:html|ui|화면|디자인)/i;

/** 현재 RP 장면을 이어가라는 OOC 힌트 */
const RP_CONTINUING_HINT =
  /계속\s*(?:rp|서사|진행|이어)|현재\s*(?:장면|상황|rp|서사)\s*(?:에서|유지|이어|계속)|다음\s*(?:장면|턴|비트)|호감|관계\s*(?:변화|발전)|속도\s*조절|intensity|더\s*적극|분위기\s*유지|이\s*장면|장난스럽/i;

/** 기존 장면 종료 + 새 에피소드/장면 시작 */
const RP_SCENE_RESET =
  /(?:기존|이전|현재)?\s*(?:RP|rp|알피|장면|에피소드)\s*(?:종료|끝|닫|중단).{0,80}(?:새로운?|새)\s*(?:에피소드|장면|RP|rp|알피)|새로운?\s*에피소드\s*시작|새\s*(?:에피소드|장면|RP|rp)\s*시작|새로운?\s*(?:성인\s*)?에피소드|new\s+(?:adult\s+)?(?:episode|scene|rp)\b/i;

/** 진짜 RP 중단 — 새 에피소드 시작이 없을 때만 hard stop */
const RP_HARD_STOP =
  /(?:여기서\s*)?(?:RP|rp|알피|장면|롤플레(?:이|잉))\s*(?:끝|종료|중단)|더\s*이상\s*(?:장면\s*)?진행하지\s*마|stop\s+(?:the\s+)?(?:scene|rp)|end\s+(?:the\s+)?(?:scene|rp)|그만\s*하자|여기서\s*멈춰/i;

export function messageHasOocMarkers(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (extractOocSnippets(t).length > 0) return true;
  return /\bOOC\b/i.test(t);
}

/** OOC 마커 이후의 실제 지시 본문. 마커 자체는 버린다. */
export function extractOocRoutingText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const blockMatch = trimmed.match(
    /^\s*(?:[\(\[【*_#\/]*)\s*OOC\s*[:\：]?\s*([\s\S]+)$/i
  );
  if (blockMatch?.[1]) {
    return blockMatch[1].replace(/^[\)\]】*_]+/, "").trim();
  }
  const snippets = extractOocSnippets(trimmed);
  if (snippets.length > 0) return snippets.join("\n").trim();
  if (/\bOOC\b/i.test(trimmed)) {
    return trimmed.replace(/\bOOC\b\s*[:\：]?\s*/i, "").trim();
  }
  return trimmed;
}

function snippetIsRpUnrelated(snippet: string): boolean {
  const s = snippet.trim();
  if (!s) return false;
  if (DISPLAY_INPUT_ONLY.test(s)) return true;
  if (RP_STOP_OR_FLASH_ONLY.test(s) && (userRequestsHtmlOutput(s) || RP_UNRELATED_HTML_DISPLAY.test(s))) {
    return true;
  }
  if (RP_UNRELATED_NO_NARRATION.test(s) && (userRequestsHtmlOutput(s) || RP_UNRELATED_HTML_DISPLAY.test(s))) {
    return true;
  }
  if (RP_UNRELATED_ALT_SCENE.test(s)) return true;
  if (userRequestsHtmlOutput(s) && RP_UNRELATED_HTML_DISPLAY.test(s)) return true;
  if (userRequestsHtmlOutput(s) && !RP_CONTINUING_HINT.test(s) && !RP_SCENE_RESET.test(s)) {
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

export function detectOocHardStop(text: string): boolean {
  const routing = extractOocRoutingText(text);
  if (RP_SCENE_RESET.test(routing) || RP_SCENE_RESET.test(text)) return false;
  if (snippetIsRpUnrelated(routing) || snippetIsRpUnrelated(text)) return false;
  return RP_HARD_STOP.test(routing) || RP_HARD_STOP.test(text);
}

export function detectOocSceneReset(text: string): boolean {
  const routing = extractOocRoutingText(text);
  return RP_SCENE_RESET.test(routing) || RP_SCENE_RESET.test(text);
}

/** 채팅 OOC 의도 분류 */
export function classifyChatOocIntent(userMessage: string): ChatOocIntent {
  const trimmed = userMessage.trim();
  if (!messageHasOocMarkers(trimmed)) return "none";

  const routing = extractOocRoutingText(trimmed);
  const snippets = extractOocSnippets(trimmed);
  const scanParts = snippets.length > 0 ? [...snippets, routing] : [routing, trimmed];

  if (scanParts.some((part) => detectOocSceneReset(part))) return "rp_scene_reset";

  let unrelated = false;
  let continuing = false;
  for (const part of scanParts) {
    if (snippetIsRpUnrelated(part)) unrelated = true;
    if (snippetIsRpContinuing(part)) continuing = true;
  }

  if (unrelated && !continuing) return "rp_unrelated";
  if (unrelated && continuing) {
    if (
      DISPLAY_INPUT_ONLY.test(trimmed) ||
      RP_STOP_OR_FLASH_ONLY.test(trimmed) ||
      RP_UNRELATED_NO_NARRATION.test(trimmed)
    ) {
      return "rp_unrelated";
    }
    return "rp_continuing";
  }

  if (scanParts.some((part) => detectOocHardStop(part))) return "rp_hard_stop";
  if (continuing) return "rp_continuing";
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

export function isChatOocSceneReset(userMessage: string): boolean {
  return classifyChatOocIntent(userMessage) === "rp_scene_reset";
}

export function isChatOocHardStop(userMessage: string): boolean {
  return classifyChatOocIntent(userMessage) === "rp_hard_stop";
}

/** 유저노트 standing 상태창·추가 HTML 억제 — 채팅 OOC만 실행 */
export function chatOocSuppressesUserNoteExtras(userMessage: string): boolean {
  const intent = classifyChatOocIntent(userMessage);
  return intent === "rp_unrelated" || intent === "rp_hard_stop";
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

export function buildChatOocSceneResetUserPrompt(userMessage: string): string {
  const directive = extractOocRoutingText(userMessage);
  return `[SYSTEM: CHAT OOC — NEW RP SCENE]
The previous physical scene is closed.
Start a new RP scene from the user's OOC directive below.
Preserve:
- character canon
- character voice / Speech Lock
- applicable world rules
- established relationship/memory unless the OOC explicitly resets them
Do not preserve:
- previous physical positions
- unfinished physical actions
- previous contact direction
- previous scene location unless restated
The user's OOC may explicitly establish actions performed by the user persona.
Those explicitly authored setup actions may be realized exactly as specified.
Do not invent additional user:
- dialogue
- consent/refusal
- decisions
- emotions
- intentions
- multi-step actions
beyond what the OOC explicitly established.
Any user-persona action explicitly stated in the OOC is user-authorized scene setup and may be realized exactly once.
Do not add new user dialogue, decisions, emotions, consent/refusal, or unprovided action chains.

[User OOC scene directive]
${directive}`;
}
