/** OOC + HTML Flash-only 턴 판별 — htmlVisualCardPolicy ↔ htmlDisplayOnlyTurn 공유 */

export const DISPLAY_INPUT_ONLY =
  /입력(?:한|하)?\s*내용\s*만|보낸\s*내용\s*만|내용\s*만\s*(?:띄|표|출|보)|입력\s*만\s*(?:띄|표|출|보)|그\s*대로\s*(?:띄|표|출|보)|(?:이|해당)\s*내용\s*(?:만\s*)?(?:띄|표|출|보)/i;

export const RP_STOP_OR_FLASH_ONLY =
  /rp\s*중지|rp\s*stop|서사\s*중지|rp\s*(?:없|금지|하지|생략|쓰지|중단)|no\s*rp|stop\s*rp|플래시\s*만|flash\s*only|메인\s*모델\s*(?:금지|쓰지|없)|롤플(?:레이|레잉)?(?:\s*ing)?\s*(?:중단|중지|일시\s*중단|정지|halt|pause|stop)|role\s*play(?:ing)?\s*(?:pause|stop|halt)|(?:대화|서사|롤플(?:레이|레잉)?)?\s*잠시\s*중지/i;
