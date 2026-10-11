import Module from "module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { callBackgroundMemory } from "@/lib/ai";

const OUT = "/opt/cursor/artifacts/gate4";
const CAP_USD = 0.12;
type S = { id: string; kind: "normal" | "adversarial"; spec: string };
const BASE = "배경: 판타지 변방 마을. 등장: 라이크(AI 캐릭터, 말수 적은 남성 검사), 렌(유저, 남성 용병), 서린(마을 여관 주인, NPC). 렌과 라이크는 얼마 전(이번 이야기 시작 전 며칠)부터 함께 다니기 시작했다는 것 외에 공유한 과거는 없다.";
const S: S[] = [
  ["N01_insult_emotion", "렌이 훈련 중 라이크에게 '솔직히 너 좀 아마추어 같아.'라고 말한다. 라이크는 입술을 깨물며 시선을 피하고 '…아직 부족하긴 하지.'라고 답한다. 이후 라이크는 말없이 혼자 검을 휘두르고, 렌이 다가가 어색한 침묵 끝에 물을 건넨다."],
  ["N02_reconcile_sequence", "전날 밤 다툰 뒤 아침이 밝는다. 렌이 먼저 사과하고, 라이크는 한참 뒤에야 받아들인다. 이후 둘은 함께 아침을 먹고 길을 나선다. 시간 흐름(그 뒤, 이후, 그동안, 아까)이 서술에 자연스럽게 섞인다."],
  ["N03_npc_arrival", "여관 주인 서린이 라이크와 렌을 찾아와 마을 의뢰서를 전달한다. 서린은 두 사람을 오늘 처음 본다. 라이크가 의뢰 내용을 읽고 렌에게 의견을 묻는다."],
  ["N04_char_backstory", "밤에 모닥불 앞에서 라이크가 어릴 때 스승에게 검을 배우다 스승을 잃은 이야기를 처음으로 털어놓는다. 렌은 놀라며 조용히 듣고 위로한다."],
  ["N05_user_relationship", "렌이 라이크에게 '우리 오늘부터 연인하자.'라고 말한다. 라이크는 놀라 한참 말이 없다가 손을 맞잡고 '…나쁘지 않아.'라고 답한다."],
  ["N06_user_ooc_shared_past", "첫 유저 메시지는 'OOC: 렌과 라이크는 3년 전 같은 용병단에서 함께 일한 사이다. 이후 서로 소식이 끊겼다가 오늘 재회한다.' 로 시작한다. 이후 둘이 오랜만에 재회하는 장면이 이어진다."],
  ["N07_user_family", "렌이 자기 누나 이야기를 한다: 누나가 지난달 마을에 다녀갔고 지금은 북쪽 항구에 산다고. 라이크는 관심을 보이며 누나는 어떤 사람이냐고 묻는다."],
  ["N08_char_attributed_claim", "라이크가 '서린이 그러는데 네 누나가 이 마을에서 널 찾았대.'라고 전달한다. 렌은 금시초문이라 의아해한다. 서린이 직접 말한 내용으로만 다루고 사실 여부는 확정되지 않는다."],
  ["N09_injury_care", "렌이 짐승에게 팔을 다친다. 라이크가 침착하게 상처를 씻고 붕대를 감으며 평소와 달리 많은 말을 한다. 이후 렌이 고맙다고 말한다."],
  ["N10_promise_real", "라이크가 '내일 새벽에 마을 북문에서 기다리겠다.'고 약속하고 렌이 받아들인다. 이후 다음 날 새벽 렌이 도착하니 라이크가 이미 기다리고 있다."],
  ["N11_jealousy", "서린이 렌에게 유난히 친절하게 대한다. 라이크는 말없이 굳은 표정으로 지켜보다가 나중에 렌에게 퉁명스럽게 군다. 렌이 이유를 묻는다."],
  ["N12_callback_in_window", "첫 턴에서 라이크가 '검은 마음이 흔들리면 부러진다.'고 말한다. 몇 턴 뒤 렌이 아까 그 말이 무슨 뜻이었냐고 묻고 라이크가 대답한다."],
  ["N13_journey_sequence", "둘이 시장에 들러 물건을 사고 돌아오는 길의 이야기. 도착 이후, 그때, 돌아오는 동안 같은 시간 흐름 표현이 서술에 많이 들어간다."],
  ["N14_night_watch", "밤샘 경계 중 렌이 졸자 라이크가 담요를 덮어 준다. 새벽에 렌이 깨어 어색해하고 라이크는 모른 척한다."],
  ["N15_gift", "렌이 라이크에게 낡은 검집을 선물한다. 라이크는 당황하다가 이후 조용히 검집에 검을 꽂아 본다."],
  ["N16_duel", "마을 청년과 라이크가 대련한다. 렌은 지켜본다. 라이크가 이기지만 상대를 비웃지 않고 손을 내민다."],
  ["N17_cancel_promise", "렌이 앞서 한 약속(검을 갈아 주겠다)을 취소하고 직접 갈겠다고 말한다. 라이크는 아쉬운 듯 어깨를 으쓱한다."],
  ["N18_hug", "라이크가 불안해하는 렌을 어색하게 안아 준다. 렌이 그 품에서 숨을 고른다."],
  ["N19_exact_quote", "라이크가 짧지만 인상적인 대사를 남긴다: '네가 돌아올 곳은 내가 지킨다.' 렌은 그 말에 가슴이 먹먹해진다."],
  ["N20_secret_reveal", "라이크가 자신이 용병단에서 쫓겨난 이유(동료를 지키지 못한 책임)를 고백한다. 렌은 충격을 받지만 곁에 있겠다고 한다."],
  ["N21_user_friend_mention", "렌이 예전 용병단 친구 도윤에 대해 이야기한다. 도윤이 지금 남쪽에 있고 곧 편지가 올 거라고. 라이크는 그 친구를 만나 보고 싶다고 말한다."],
  ["N22_banter", "라이크와 렌이 길에서 가벼운 농담을 주고받는다. 라이크가 드물게 웃는다. 이후 둘 다 말없이 걷는다."],
  ["A01_fake_acquaintance", "라이크(assistant)가 서술과 대사에서 '렌, 우린 오래전부터 알던 사이잖아.'라고 단정하는 식으로 말한다. 유저(렌)는 그런 공유 과거를 말한 적이 없고 갸웃하며 반응한다."],
  ["A02_fake_sister_friend", "라이크(assistant)가 '네 누나는 예전부터 나와 친구였어.'라고 단정한다. 유저는 누나 이야기를 한 적이 없고 놀란다."],
  ["A03_fake_promise", "라이크(assistant)가 '내가 평생 지키겠다고 약속했잖아.'라고 단정한다. 유저는 그런 약속을 한 적이 없고 놀란다."],
  ["A04_fake_childhood_npc", "서린(NPC)이 '너, 어릴 때 우리 집 앞에서 본 적 있어.'라고 렌에게 단정한다. 유저는 그런 적이 없다고 반응한다."],
  ["A05_fake_old_friends_npc", "서린(NPC)이 '렌과 라이크는 오래 알고 지낸 친구 사이지요.'라고 서술한다. 유저는 어리둥절해한다."],
  ["A06_speaker_confusion", "렌이 먼저 라이크에게 '네 검술은 아직 어설퍼.'라고 말한다. 이어 라이크가 렌의 말을 곱씹으며 '네가 어설프다고 했지.'라고 되뇌지만 한 턴은 라이크가 '내가 어설프다고 했었나' 하고 혼동하는 모습을 보인다."],
].map(([id, spec]) => ({ id, kind: (id as string).startsWith("A") ? "adversarial" : "normal", spec: spec as string })) as S[];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const outPath = `${OUT}/sources.json`;
  const done: Record<string, unknown> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
  let spent = Number(process.env.SPENT0 ?? 0);
  const ledger: unknown[] = [];
  for (const s of S) {
    if (done[s.id]) continue;
    if (spent > CAP_USD) { console.log("CAP_REACHED", spent); break; }
    const sys = "너는 한국어 롤플레이 대화 샘플 작성자다. 요청한 5턴 대화를 만든다. 반드시 JSON 배열만 출력한다. 형식: [{\"user\":\"...\",\"assistant\":\"...\"} x5]. user는 유저(렌)의 1~2문장 입력. assistant는 라이크 캐릭터 응답으로 소설체 서술(행동·표정·내면 묘사)과 따옴표 대사를 섞어 350~700자. 설명이나 코드펜스 금지.";
    const user = `${BASE}\n\n장면 지시: ${s.spec}\n\n위 지시에 맞는 5턴 대화를 작성하라. 지시에 없는 새로운 과거 공유 사건·약속·친분은 만들지 마라(단, 지시에서 명시한 경우 제외).`;
    const r = await callBackgroundMemory(sys, [{ role: "user", content: user }], undefined, "background-memory-extract", { maxTokens: 6000 });
    const u = r.usage as unknown as { cheaperInferenceBilledCostUsd?: number; inputTokens?: number; outputTokens?: number };
    spent += u.cheaperInferenceBilledCostUsd ?? 0;
    let parsed: unknown = null;
    try { parsed = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); } catch { parsed = null; }
    ledger.push({ id: s.id, usd: u.cheaperInferenceBilledCostUsd ?? null, in: u.inputTokens, out: u.outputTokens });
    if (Array.isArray(parsed) && parsed.length === 5) done[s.id] = { kind: s.kind, spec: s.spec, turns: parsed };
    else console.log("PARSE_FAIL", s.id, r.text.slice(0, 120));
    writeFileSync(outPath, JSON.stringify(done, null, 2));
    console.log(s.id, u.cheaperInferenceBilledCostUsd, u.inputTokens, u.outputTokens, "spent", spent.toFixed(5));
  }
  writeFileSync(`${OUT}/gen-ledger-${Date.now()}.json`, JSON.stringify({ spent, ledger }, null, 2));
}
void main();
