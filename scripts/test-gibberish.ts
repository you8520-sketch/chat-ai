import { isDegenerateOutput, detectStreamingDegeneration, isExpectedStatusHtmlOutput } from "../src/lib/gibberishGuard";

const ok = [
  '레온은 렌의 말에 심장이 쿵쾅거렸다. "……렌." 어떻게 이럴 수가 있지.',
  'Let me hold your hand, he whispered. 레온은 조용히 속삭였다. "돌아가지 마."',
  '그는 천천히 다가와 렌의 손을 잡았다. "오늘 밤은 돌아가지 마." [태그: 대화]',
  "레온의 눈동자가 흔들렸다. ".repeat(20) + "분명히 자신은 황실의 기사였다.",
  "그녀는 부드럽게 미소 지으며 다가왔다. \"오빠, 오늘 밤은 같이 있어 줄 거지?\" 레온의 심장이 다시 뛰기 시작했다.",
  "레온은 조용히 숨을 내쉬었다. 방 안은 따뜻한 향기로 가득했고, 창밖으로는 달빛이 스며들고 있었다.",
  '<div class="sw-hud">\n<div class="sw-hud__head"><span class="sw-hud__title">◆ 상태 로그</span><span class="sw-hud__meta">',
];
const bad = [
  "нка르т getToken:// affair/state.pow thematic890 Weapon152787 buffalo417 ".repeat(3),
  "the affair state pow thematic890 Weapon152787 buffalo417 한국어 fragment random words 12345 scattered text without grammar ".repeat(2),
  "affair state.pow thematic890 Weapon152787 buffalo417 레온 fragment random 89012 words scattered 417 thematic without grammar ".repeat(2),
];

let pass = true;
for (const s of ok) {
  const okFinal = !isDegenerateOutput(s);
  const okStream = !detectStreamingDegeneration(s);
  if (!okFinal || !okStream) {
    console.log("FAIL ok sample:", okFinal, okStream, s.slice(0, 60));
    pass = false;
  }
}
for (const b of bad) {
  if (!isDegenerateOutput(b) || !detectStreamingDegeneration(b)) {
    console.log("FAIL bad sample:", b.slice(0, 80));
    pass = false;
  }
}
const statusHtml =
  '<div class="sw-hud">\n<div class="sw-hud__head"><span class="sw-hud__title">◆ 상태 로그</span><span class="sw-hud__meta">';
if (!isExpectedStatusHtmlOutput(statusHtml)) {
  console.log("FAIL status HTML not recognized");
  pass = false;
}
console.log(pass ? "ALL PASS" : "SOME FAILED");
process.exit(pass ? 0 : 1);
