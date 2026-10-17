import Module from "module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { it } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { isRollingSummaryGroundedInDialogue } from "./memory-summary-integrity";
import { hasUnsupportedObjectiveUserLinkedFact, sourcesFromUserText, resolvePersonaName } from "./memory-source-authority";
import { looksLikeHardPriorSharedUserRelationship } from "@/lib/sharedHistoryEvidence";
import { formatSelectedPersonaIdentityForBackground } from "@/lib/userPersonas";

const CHAR = "라이크";
type T = [string, string];
type C = { id: string; fab: boolean; turns: T[]; summary: string };
const d = (turns: T[]) => turns.map(([u, a], i) => `[${i + 1}턴]\n유저: ${u}\n${CHAR}: ${a}`).join("\n\n");

const CASES: C[] = [
  { id: "N1_이후_감정해석", fab: false, turns: [["솔직히 너 좀 아마추어 같아.", "라이크는 입술을 깨물며 시선을 피했다. \"…그래, 아직 부족하긴 하지.\""]],
    summary: "렌이 아마추어 같다고 하자 라이크는 입술을 깨물며 시선을 피함. 이후 검술에 대한 자존심이 흔들렸을 가능성이 있음." },
  { id: "N2_이후_화해", fab: false, turns: [["미안해, 내가 심했어.", "라이크는 굳은 표정을 풀고 렌의 손을 잡았다."]],
    summary: "렌이 심했다며 사과함. 이후 라이크는 굳은 표정을 풀고 렌의 손을 잡음." },
  { id: "N3_그때_순차", fab: false, turns: [["마을에 도착했어. 검을 건넬게.", "라이크는 렌이 건넨 검을 받아 들었다."]],
    summary: "렌이 마을에 도착해 라이크에게 검을 건넴. 그때 라이크는 말없이 검을 받아 듦." },
  { id: "N4_어제_유저진술", fab: false, turns: [["어제 숲에서 늑대를 봤어.", "라이크는 경계를 강화하겠다고 말했다."]],
    summary: "렌이 어제 숲에서 늑대를 봤다고 알림. 라이크는 경계를 강화하기로 함." },
  { id: "N5_그동안_순차", fab: false, turns: [["약속 어겨서 미안해.", "라이크는 말없이 걸었고 렌은 그 곁을 따라가며 사과를 거듭했다."]],
    summary: "렌이 약속을 어겨 미안하다고 함. 라이크는 말없이 걸었고 그동안 렌은 곁을 따르며 사과를 거듭함." },
  { id: "N6_NPC_이후", fab: false, turns: [["문 쪽을 바라본다.", "서린이 문을 열고 들어와 라이크에게 목례했다."]],
    summary: "렌이 문 쪽을 바라봄. 이후 서린이 문을 열고 들어와 라이크에게 목례함." },
  { id: "N7_아까_윈도우내", fab: false, turns: [["아까 말한 지도를 펼칠게.", "라이크는 길을 확인했다."], ["여기가 북쪽이야.", "라이크는 고개를 끄덕였다."]],
    summary: "렌이 아까 말한 지도를 펼쳐 북쪽을 가리킴. 라이크는 길을 확인하고 고개를 끄덕임." },
  { id: "N8_캐릭터과거", fab: false, turns: [["검은 어디서 배웠어?", "라이크는 어릴 때 스승에게 검을 배웠다고 털어놓았다."]],
    summary: "라이크는 어릴 때 스승에게 검을 배웠다고 렌에게 털어놓음. 이후 렌은 그를 위로함." },
  { id: "N9_유저관계선언", fab: false, turns: [["좋아, 오늘부터 연인하자.", "라이크는 놀라 한참 말이 없다가 손을 맞잡았다."]],
    summary: "렌이 오늘부터 연인이 되자고 제안함. 이후 라이크는 놀라 말이 없다가 손을 맞잡음." },
  { id: "N10_OOC설정_공유과거", fab: false, turns: [["OOC: 렌과 라이크는 예전에 같은 길드에서 함께 일한 사이입니다.", "라이크는 오랜만이라는 듯 렌을 바라보았다."]],
    summary: "렌과 라이크는 예전에 같은 길드에서 함께 일한 사이라는 설정으로 재회함. 라이크는 오랜만이라는 듯 렌을 바라봄." },
  { id: "N11_전에_유저진술", fab: false, turns: [["전에 준 반지 돌려줘.", "라이크는 주머니에서 반지를 꺼내 건넸다."]],
    summary: "렌이 전에 준 반지를 돌려 달라고 함. 라이크는 반지를 꺼내 건넴." },
  { id: "N12_귀속주장", fab: false, turns: [["시장에 다녀왔어.", "라이크는 고개를 끄덕였다. \"누나가 시장에서 널 알아봤대. 예전부터 알던 사이라더라.\""]],
    summary: "렌이 시장에 다녀왔다고 함. 라이크는 누나가 시장에서 렌을 알아봤다고 말함." },
  { id: "N13_이후_감정_그후", fab: false, turns: [["내일 같이 가자.", "라이크는 조금 웃었다."]],
    summary: "렌이 내일 함께 가자고 하자 라이크는 조금 웃음. 이후 그의 경계심이 누그러진 듯 보임." },
  { id: "F1_가짜평생약속", fab: true, turns: [["솔직히 너 좀 아마추어 같아.", "라이크는 입술을 깨물었다."]],
    summary: "라이크는 렌에게 평생 지키겠다고 약속함. 렌이 아마추어 같다고 하자 라이크는 입술을 깨묾." },
  { id: "F2_누나친분_예전부터", fab: true, turns: [["시장에 다녀왔어.", "라이크는 고개를 끄덕였다. \"누나가 시장에서 널 알아봤대.\""]],
    summary: "렌은 라이크의 누나와 예전부터 알던 사이였고 시장에서 서로 알아봄." },
  { id: "F2c_누나친분_오래전부터", fab: true, turns: [["시장에 다녀왔어.", "라이크는 고개를 끄덕였다. \"누나가 시장에서 널 알아봤대.\""]],
    summary: "렌은 라이크의 누나와 오래전부터 알고 지낸 친구 사이임. 누나는 렌을 시장에서 반갑게 맞음." },
  { id: "F2d_누나친분_어제", fab: true, turns: [["시장에 다녀왔어.", "라이크는 고개를 끄덕였다. \"누나가 시장에서 널 알아봤대.\""]],
    summary: "렌은 어제 라이크의 누나와 시장에서 만나 함께 장을 봄." },
  { id: "F2e_누나친분_이후", fab: true, turns: [["시장에 다녀왔어.", "라이크는 고개를 끄덕였다. \"누나가 시장에서 널 알아봤대.\""]],
    summary: "렌이 시장에 다녀옴. 이후 렌은 라이크의 누나와 가까운 사이로 지냄." },
  { id: "F2f_누나친분_표지없음", fab: true, turns: [["시장에 다녀왔어.", "라이크는 고개를 끄덕였다. \"누나가 시장에서 널 알아봤대.\""]],
    summary: "렌은 라이크의 누나와 친구 사이임. 누나는 시장에서 렌을 반갑게 맞음." },
  { id: "F4_커피키스", fab: true, turns: [["커피를 마셨어.", "라이크는 말없이 커피를 저었다."]],
    summary: "렌과 라이크는 커피를 마시다 입을 맞췄고 둘의 사이는 한층 가까워짐." },
];

const results: unknown[] = [];
it("contract probe", () => {
  const persons: Record<string, string | null> = {
    bare_route_today: "렌",
    labelled_background_identity: formatSelectedPersonaIdentityForBackground("렌", "male"),
  };
  for (const [pname, persona] of Object.entries(persons)) {
    for (const c of CASES) {
      const dialogue = d(c.turns);
      const users = c.turns.map((t) => t[0]).join("\n");
      const personaName = resolvePersonaName(persona);
      const stage1 = hasUnsupportedObjectiveUserLinkedFact(c.summary, { sources: sourcesFromUserText(users), personaName, charName: CHAR });
      const full = isRollingSummaryGroundedInDialogue(c.summary, dialogue, persona, CHAR);
      results.push({ persona: pname, id: c.id, fabricated: c.fab, personaName, stage1Rejects: stage1, accepted: full, stage2OnlyRejects: !stage1 && !full });
    }
  }
  // Hypothetical narrowing (NOT in src): family participant / hard relationship cue only, 음슴체-aware attribution.
  const FAMILY = /누나|언니|오빠|동생|엄마|아빠|어머니|아버지|부모|친구|(?<![가-힣])형(?![가-힣])/u;
  const ATTR = /(?:말했|말함|밝혔|밝힘|전했|전함|주장했|주장함|언급했|언급함|설명했|설명함)/u;
  for (const c of CASES) {
    const clauses = c.summary.split(/(?<=[.!?。！？])\s+|,\s+/u).filter(Boolean);
    const flagged = clauses.some((cl) => (FAMILY.test(cl) || looksLikeHardPriorSharedUserRelationship(cl)) && /렌/.test(cl + c.summary) && !ATTR.test(cl));
    const userCovers = flagged && c.turns.some((t) => FAMILY.test(t[0]) || looksLikeHardPriorSharedUserRelationship(t[0]));
    results.push({ persona: "HYPOTHETICAL_narrowed_family_or_hard_only", id: c.id, fabricated: c.fab, accepted: !(flagged && !userCovers) });
  }
  mkdirSync(process.env.AB_OUT ?? "/tmp/cp", { recursive: true });
  writeFileSync(`${process.env.AB_OUT ?? "/tmp/cp"}/contract-probe-before.json`, JSON.stringify(results, null, 2));
});
