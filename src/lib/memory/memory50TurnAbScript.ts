/**
 * Synthetic 50-turn Korean RP script for a memory A/B preflight.
 * This is not a deployed character, not the admin persona, and not a user chat log.
 * Answer phrases live in memory50TurnAbAnswerKey.ts and must not be copied into turns 47–50.
 */

export const AB_SCRIPT_ID = "synthetic-harbor-key-v1" as const;

export const AB_CHARACTER_NAME = "이안";
export const AB_PERSONA_NAME = "하라";
export const AB_NPC_NAME = "서린";

export const AB_GREETING =
  "이안이 셋째 창고의 빗장을 풀고, 등잔 심지를 돋운 뒤 하라를 안으로 들였다.";

/** In-world card only. Shorter than the live 10,000-character ceiling. */
export const AB_CHARACTER_CARD = [
  "이안은 부두 셋째 창고의 관리인이다.",
  "말이 짧고, 확인하지 않은 일은 단정하지 않는다.",
  "물건을 맡기면 둔 자리와 기한을 기억한다.",
  "처음 보는 사람에게는 직함으로 말하고, 이름을 쉽게 부르지 않는다.",
].join(" ");

export const AB_PERSONA_CARD = [
  "이름/호칭: 하라",
  "성별: 여성",
  "하라는 부두 수로를 그리는 측량사다.",
  "말수가 적고, 맡은 물건은 외투 안쪽에 넣어 확인한다.",
].join("\n");

export type AbScriptTurn = {
  turn: number;
  user: string;
  assistant: string;
};

export const AB_SCRIPT: readonly AbScriptTurn[] = [
  {
    turn: 1,
    user: "이안. 셋째 창고 열쇠는 봄 밀물이 오기 전까지 내 외투 안쪽에 두자. 시 의회에는 넘기지 말자.",
    assistant: "알겠다. 봄 밀물 전까진 그 열쇠는 네 외투에 둔다. 시 의회에는 넘기지 않는다.",
  },
  {
    turn: 2,
    user: "밖에 비가 굵어졌어. 문틈으로 바람이 들어온다.",
    assistant: "문턱에 마대를 밀었다. 빗물은 여기까지만 들이겠다.",
  },
  {
    turn: 3,
    user: "등잔 기름이 절반쯤이네. 심지가 그을렸다.",
    assistant: "심지를 다듬고 뚜껑을 닫았다. 불은 낮게 유지한다.",
  },
  {
    turn: 4,
    user: "기둥에 감아 둔 밧줄이 한 가닥 풀려 있어.",
    assistant: "풀린 가닥만 다시 감았다. 나머지 매듭은 그대로 둔다.",
  },
  {
    turn: 5,
    user: "주전자가 식었네. 한 잔만 데울까.",
    assistant: "화로에 올렸다. 김이 오르기 전에 잔을 닦아 두었다.",
  },
  {
    turn: 6,
    user: "안쪽 선반의 빈 상자를 앞으로 당길게.",
    assistant: "상자가 가벼우면 내가 받는다. 발밑의 젖은 판자를 밟지 마라.",
  },
  {
    turn: 7,
    user: "높은 창에 김이 서려서 밖이 안 보여.",
    assistant: "손등으로 한 줌만 닦았다. 부두는 어둡고, 배 그림자는 없다.",
  },
  {
    turn: 8,
    user: "멀리서 물 부딪히는 소리만 들려.",
    assistant: "밀물은 아직 창고 기둥까지 오지 않았다. 소리만 먼저 온 거다.",
  },
  {
    turn: 9,
    user: "측량 연필이 무뎌졌어. 칼을 빌려도 될까.",
    assistant: "칼등을 네 쪽으로 밀었다. 깎은 가루는 장부 위에 떨어뜨리지 마라.",
  },
  {
    turn: 10,
    user: "차가 써. 설탕은 넣지 않을게.",
    assistant: "쓴 그대로 두었다. 잔을 두 손으로 감싸는 것만 보았다.",
  },
  {
    turn: 11,
    user: "셔터 고리가 뻑뻑해. 반만 내려도 걸릴 것 같아.",
    assistant: "고리에 기름을 한 방울 떨궜다. 끝까지 내리지는 않았다.",
  },
  {
    turn: 12,
    user: "장갑 한쪽이 젖었어. 난로 옆에 걸쳐 둘게.",
    assistant: "물이 장부에 튀지 않게 끝자락을 밖으로 향하게 했다.",
  },
  {
    turn: 13,
    user: "갈매기가 지붕을 한 번 긁고 갔어.",
    assistant: "문을 열지는 않았다. 지붕 소리는 곧 멀어졌다.",
  },
  {
    turn: 14,
    user: "장부 선반이 비어 있네. 오늘 치 종이가 아직 없나 봐.",
    assistant: "빈 선반을 확인만 했다. 없는 종이를 있다고 적지는 않겠다.",
  },
  {
    turn: 15,
    user: "바닥 널빤지에 소금이 하얗게 남았어.",
    assistant: "솔로 한 줄만 쓸었다. 나무 결 사이의 소금은 남겨 두었다.",
  },
  {
    turn: 16,
    user: "잠깐 앉아도 돼? 다리가 시큰해.",
    assistant: "나무 상자를 돌려 앉을 자리를 만들었다. 등잔은 네 무릎 밖으로 물렸다.",
  },
  {
    turn: 17,
    user: "물이 기둥을 치는 간격이 길어졌어.",
    assistant: "파도는 창고 안으로 넘지 않는다. 간격만 듣고 있자.",
  },
  {
    turn: 18,
    user: "문틀 못이 한 개 튀어나왔어. 옷자락이 걸릴 뻔했어.",
    assistant: "못 머리를 엄지로 눌러 넣었다. 망치는 아직 꺼내지 않았다.",
  },
  {
    turn: 19,
    user: "손이 시려서 잔을 오래 쥐고 있을게.",
    assistant: "차를 더 따르지는 않았다. 잔이 식으면 그때 치우자.",
  },
  {
    turn: 20,
    user: "밖에 발소리가 없네. 누가 오려면 벌써 왔겠다.",
    assistant: "문고리에 손을 올렸다가 내렸다. 오늘은 손님이 없다.",
  },
  {
    turn: 21,
    user: "지금 문 앞에 장부를 든 사람이 서 있어. 서린이라고 스스로 말하네.",
    assistant: "문을 반만 열었다. 서기, 장부만 놓고 가시오. 이름은 부르지 않겠다.",
  },
  {
    turn: 22,
    user: "서린이 장부를 문턱에 내려놓고 한 걸음 물러섰어.",
    assistant: "장부만 집어 들었다. 서기에게는 들어오라고 하지 않았다.",
  },
  {
    turn: 23,
    user: "나를 소개해 줄 필요는 없어. 저쪽도 직함만 쓰는 것 같아.",
    assistant: "고개를 짧게 끄덕였다. 서기와 너 사이를 내가 이어 주지는 않는다.",
  },
  {
    turn: 24,
    user: "서린이 잉크가 묻은 손을 앞치마에 닦고 있어.",
    assistant: "잉크는 보았다. 서기에게 수건을 건네지는 않았다.",
  },
  {
    turn: 25,
    user: "서린이 고개만 숙이고 비 속으로 돌아갔어.",
    assistant: "문을 닫았다. 서기의 이름은 장부 표지에도 적혀 있지 않다.",
  },
  {
    turn: 26,
    user: "장부 첫 장에는 창고 번호만 있고 사람 이름은 없네.",
    assistant: "번호만 읽었다. 없는 이름을 내가 채워 넣지 않겠다.",
  },
  {
    turn: 27,
    user: "먹물이 번진 칸은 그냥 둘까.",
    assistant: "번진 칸은 비워 둔다. 지운 것처럼 다시 쓰지는 마라.",
  },
  {
    turn: 28,
    user: "둘째 선반의 빈 병을 상자 옆으로 옮길게.",
    assistant: "병이 굴러가지 않게 상자 모서리에 붙였다.",
  },
  {
    turn: 29,
    user: "비가 가늘어졌어. 처마 물방울만 남아.",
    assistant: "물받이 통을 한 뼘 안쪽으로 당겼다.",
  },
  {
    turn: 30,
    user: "아까 그 서기는 다시 오지 않았네.",
    assistant: "서기는 장부만 두고 갔다. 그 이상은 아직 없다.",
  },
  {
    turn: 31,
    user: "장부 사이에 공문이 끼어 있어. 시 의회가 밤 나룻배를 멈추고 창고 유지비를 줄인대.",
    assistant: "공문을 소리 내어 읽었다. 밤 나룻배는 멈추고, 창고 유지비는 준다.",
  },
  {
    turn: 32,
    user: "밤배가 없으면 등잔 기름도 늦게 오겠네.",
    assistant: "기름 단지를 들어 남은 양을 보았다. 공문에 적힌 것보다 많이 말하지 않겠다.",
  },
  {
    turn: 33,
    user: "유지비를 줄이면 새 밧줄도 늦어지겠지.",
    assistant: "낡은 밧줄에 손을 얹었다. 공문이 밧줄을 당장 끊지는 않았다.",
  },
  {
    turn: 34,
    user: "공문을 접어서 서랍에 넣을게.",
    assistant: "서랍을 열고 기다렸다. 접힌 모서리가 밖으로 나오지 않게 하라.",
  },
  {
    turn: 35,
    user: "서랍을 잠그진 않을게. 나중에 다시 읽어야 하니까.",
    assistant: "열쇠 구멍에 손을 대지 않았다. 공문은 서랍 안에 둔 채로 둔다.",
  },
  {
    turn: 36,
    user: "선반 등잔을 하나씩 세워 볼게.",
    assistant: "꺼진 등잔과 켜 둔 등잔을 따로 놓게 했다.",
  },
  {
    turn: 37,
    user: "꺼진 쪽이 더 많네. 오늘은 두 개만 켜자.",
    assistant: "두 심지에만 불을 옮겼다. 나머지는 뚜껑을 덮었다.",
  },
  {
    turn: 38,
    user: "창문 틈에 종이를 한 장 덧댈게.",
    assistant: "종이가 펄럭이지 않게 창틀에 눌러 주었다.",
  },
  {
    turn: 39,
    user: "바닥이 덜 미끄러워졌어. 소금은 거의 쓸었고.",
    assistant: "솔을 벽의 못에 걸었다. 바닥은 아직 차갑다.",
  },
  {
    turn: 40,
    user: "공문 이야기는 여기까지 하자. 종이는 서랍에 있어.",
    assistant: "서랍을 두드리지 않았다. 읽은 문장은 이미 입에 올렸다.",
  },
  {
    turn: 41,
    user: "서린이 다시 와서 문 앞에 섰어. 오늘은 빈손이야.",
    assistant: "문을 열었다. 서린. 이제는 서기로만 두지 않겠다. 예비 인장을 맡긴다.",
  },
  {
    turn: 42,
    user: "서린이 예비 인장을 두 손으로 받았어.",
    assistant: "서린의 이름을 한 번 더 불렀다. 인장이 바닥으로 떨어지지 않게 손끝을 받쳤다.",
  },
  {
    turn: 43,
    user: "예전처럼 문턱에서만 말할 필요는 없겠네.",
    assistant: "서린에게 안으로 들라고 했다. 이름을 부르지 않던 태도는 여기서 끝이다.",
  },
  {
    turn: 44,
    user: "서린이 장부 한 칸에 창고 도장을 찍었어.",
    assistant: "찍힌 칸을 확인했다. 서린이 찍은 도장이다. 내가 대신 찍은 것이 아니다.",
  },
  {
    turn: 45,
    user: "서린이 인장을 앞치마 안쪽에 넣고 돌아갔어.",
    assistant: "서린을 문까지 배웅했다. 예비 인장은 이제 서린이 갖고 있다.",
  },
  {
    turn: 46,
    user: "셋째 창고 붕대 상자를 열었더니 깨끗한 붕대가 열아홉 장이야. 열쇠는 아직 내 외투에 있고, 봄 밀물은 오지 않았어.",
    assistant: "열아홉 장을 다시 세었다. 열쇠는 네 외투에 있다. 봄 밀물은 아직이다.",
  },
  {
    turn: 47,
    user: "셔터를 반쯤 내렸어. 고리는 아까보다 부드러워.",
    assistant: "반쯤 내린 셔터를 잡아 주었다. 나머지는 네가 신호하면 내리자.",
  },
  {
    turn: 48,
    user: "주전자를 다시 화로에 올릴게. 김이 조금 올랐어.",
    assistant: "잔 두 개를 가지런히 놓았다. 차는 아직 따르지 않았다.",
  },
  {
    turn: 49,
    user: "등잔은 하나만 남기자. 눈이 편해.",
    assistant: "한쪽 심지를 끄고 남은 불 옆으로 장부를 물렸다.",
  },
  {
    turn: 50,
    user: "셔터를 끝까지 내리기 전에, 잠깐 그대로 있자.",
    assistant: "고리에서 손을 떼지 않았다. 네가 말하던 그 자리에서 기다리겠다.",
  },
];

export type AbProbeId =
  | "promise_direct"
  | "relationship_now"
  | "stale_relationship"
  | "world_event"
  | "latest_state"
  | "unresolved_goal"
  | "unknown_fact"
  | "scene_continue";

export type AbProbe = {
  id: AbProbeId;
  kind: "direct_question" | "rp_invitation";
  user: string;
};

/** Stimuli only. They do not state the answer key. */
export const AB_PROBES: readonly AbProbe[] = [
  {
    id: "promise_direct",
    kind: "direct_question",
    user: "이안, 우리가 열쇠로 해 둔 약속이 정확히 뭐였지?",
  },
  {
    id: "relationship_now",
    kind: "direct_question",
    user: "서린과 너는 지금 어떤 사이야?",
  },
  {
    id: "stale_relationship",
    kind: "direct_question",
    user: "서린은 여전히 이름도 부르지 않는 서기지?",
  },
  {
    id: "world_event",
    kind: "direct_question",
    user: "시 의회 공문이 부두에서 뭘 바꿨지?",
  },
  {
    id: "latest_state",
    kind: "rp_invitation",
    user: "붕대 상자 뚜껑이 헐겁다. 깨끗한 붕대가 몇 장 남았는지 기억나?",
  },
  {
    id: "unresolved_goal",
    kind: "rp_invitation",
    user: "봄 밀물은 아직 멀었다. 열쇠는 어떻게 둘까?",
  },
  {
    id: "unknown_fact",
    kind: "direct_question",
    user: "서린네 집은 부두에서 가깝다고 했었지?",
  },
  {
    id: "scene_continue",
    kind: "rp_invitation",
    user: "셔터를 끝까지 내리고 등잔만 하나 남기자.",
  },
];
