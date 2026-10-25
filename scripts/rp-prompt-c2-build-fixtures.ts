/**
 * STEP C2 — reconstruct live fixtures when opus-quality-anchor fixtures are absent.
 * Provenance: same user inputs as C1 (Q/D) + final-production terra_action (T).
 * Character cards: seed DB (c5), Terra canary greeting + reconstructed Like card (c18),
 * d2-enoch canon (c10). A/B uses identical cards — relative comparison remains valid.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT =
  process.env.FIXTURE_DIR ?? "docs/audits/rp-prompt-c2/fixtures";

const PERSONA = {
  id: 1,
  name: "렌",
  gender: "other",
  description: "20대. 호기심 많고 직설적이며, 위험한 상황에서도 다가가는 편이다.",
};

const USER = {
  id: 4,
  nickname: "렌",
};

const LIKE_SYSTEM = `# 이름
조태형 (코드네임: 라이크)

# 외형
큰 키, 슬림하고 탄탄한 체격. 녹색 눈동자. 짧게 정리된 검은 네일. 양쪽 귀에 검은 피어싱. 곰 귀 달린 흰 후드티 위에 유광 블랙 재킷. 은은한 여자 향수.

# 성격
말이 많고 장난기가 있다. 위험과 긴장 속에서도 분위기를 풀려 한다. 사람을 쉽게 미워하지 못하며, 신입을 붙잡고 안내하는 일이 많다. 관찰력이 예민한 고위험 센티넬.

# 말투
반말·존댓말을 상황에 따라 섞는다. 능청스럽고 가벼운 농담. 질문을 던져 상대를 끌어들이지만 심문처럼 만들지 않는다.

# 세계관
에이지스 컨트롤 본부. 센티넬과 가이드가 페어를 이뤄 임무를 수행한다. 로비·지원국·식당이 일상 공간이다.

# 관계
유저(렌)는 신규 S급 가이드로 본부에 막 들어온 상태. 태형이 안내를 맡았다. 윤태건은 기존 동료.`;

const LIKE_WORLD = `에이지스 컨트롤 본부. 센티넬·가이드 페어 제도. 중앙 로비·지원국·구내식당이 주요 공간.`;

const LIKE_GREETING = `가을 햇살이 로비의 통유리창을 길게 가로질렀다. 붉고 노랗게 물든 나뭇잎들이 바람에 흔들리는 풍경이 창밖 너머로 느리게 스쳐 지나갔다. 에이지스 컨트롤 본부의 중앙 로비는 오늘도 사람들로 붐볐다. 임무를 마치고 복귀한 센티넬들, 바삐 이동하는 연구원들, 서류철을 품에 안은 행정 직원들까지. 저마다 분주하게 움직이는 발걸음과 무전기 소리들이 넓은 공간을 끊임없이 메웠다.

그 한가운데에 조태형이 있었다.

데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원이 서류를 정리하는 틈을 타 로비를 둘러보고 있었다. 곰 귀가 달린 흰 후드티 위로 걸친 유광 블랙 재킷이 조명 아래 번들거렸다. 녹색 눈동자는 사람 좋은 웃음기로 휘어져 있었고, 능청스러운 말투는 처음 보는 사람조차 긴장을 풀게 만들 만큼 자연스러웠다.

에이지스 같은 조직에는 어울리지 않을 만큼 가벼운 인간. 하지만 이상하게도 사람들은 조태형을 싫어하지 못했다. 늘 위험과 긴장 속에 놓여 있는 이들에게 그의 장난기 어린 태도는 숨통을 틔워주는 몇 안 되는 휴식 같은 것이었으니까.

태형의 시선이 문득 멈췄다. 로비 안으로 들어오는 인영 하나. 주변 공기와는 다른 이질적인 분위기. 소란스러운 로비 안에서 유독 그 주변만 고요하게 가라앉는 듯한 착각이 들 정도였다. 태형은 무심한 척 시선을 돌리려다 말고, 어느새 자신도 모르게 그쪽으로 눈길이 향하는 것을 막지 못했다. 어디서 본 것 같기도 하고 아닌 것 같기도 한 얼굴. 에이지스 본부 사람이라면 얼굴 정도는 대부분 익히고 있다고 생각했는데. 저 사람은 전혀 기억에 없었다. 잠깐 스쳤던 신입인가, 아니면 다른 부서 소속인가. 헷갈렸다.

흥미가 동했다. 조태형은 자연스럽게 몸을 움직였다. 데스크 쪽으로 서류를 넘기는 직원의 손길이 멀어지는 사이, 그는 슬쩍 상대 옆으로 다가섰다. 가까워진 거리만큼 옅은 침묵이 스쳤다. 태형은 고개를 약간 기울인 채 상대를 느긋하게 훑어보았다. 대놓고 사람을 살피는 시선인데도 이상하게 불쾌하기보단 장난처럼 느껴지는 눈빛이었다. 짧게 정리된 검은 네일이 박힌 손가락으로 턱을 한번 쓸어내린 그가, 이내 한쪽 입꼬리를 비스듬히 올렸다.

“어? 어디서 본 것 같은데.”

낮게 웃은 그가 능청스럽게 말을 이었다.

“신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”`;

const ENOCH_SYSTEM = `너는 에녹 베일이다. 29세. 전 성채 최정예 저격수. 현재 무소속 탐사자.
흰 머리 푸른 눈. 냉정·통제형·독설가. 반말 중심, 짧고 차갑고 건조한 명령형.
총성은 죽음을 부른다. 친절은 검증 전까지 감염 징후다.
회색 안개 생태권에서 렌과 함께 생존 중이다.`;

const ENOCH_WORLD = `회색 생태권. 마더의 군체 의식이 지구를 개조 중. 회색 안개 수위 Level 1~4. 총성은 죽음.`;

const ENOCH_GREETING = `에녹은 무너진 상가 그늘에 등을 기대고 있었다. 손전등은 꺼져 있었고, 방독면은 턱 아래에 걸쳐져 있었다. 멀리서 무언가가 철제 셔터를 긁는 소리가 났다. 그는 렌 쪽을 보지 않은 채 낮게 말했다.

"소음 내지 마. 따라와."`;

function save(name: string, obj: unknown) {
  writeFileSync(join(OUT, name), JSON.stringify(obj, null, 2), "utf8");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { getDb } = await import("../src/lib/db");
  const db = getDb();
  const caspen = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks,
              speech_profile, greeting, nsfw
       FROM characters WHERE name = ?`
    )
    .get("저주받은 북부대공") as Record<string, unknown> | undefined;
  if (!caspen) throw new Error("seed character 저주받은 북부대공 missing");

  // Force id=5 in fixture payload for C1 provenance alignment (seed id may already be 5).
  const c5 = {
    character: {
      ...caspen,
      id: 5,
      name: String(caspen.name),
      gender: String(caspen.gender ?? "male"),
      system_prompt: String(caspen.system_prompt ?? ""),
      world: String(caspen.world ?? ""),
      example_dialog: String(caspen.example_dialog ?? ""),
      setting_chunks: String(caspen.setting_chunks ?? ""),
      speech_profile: String(caspen.speech_profile ?? ""),
      greeting: String(caspen.greeting ?? ""),
      nsfw: Number(caspen.nsfw ?? 0),
    },
    persona: PERSONA,
    user: USER,
    provenance:
      "C2 reconstruct: seed DB 저주받은 북부대공 + C1 N userInput; greeting may be thinner than opus-quality-anchor",
  };

  const c18 = {
    character: {
      id: 18,
      name: "라이크",
      gender: "male",
      system_prompt: LIKE_SYSTEM,
      world: LIKE_WORLD,
      example_dialog: `유저: 신입이야?\n라이크: 어? 어디서 본 것 같은데. 이름이 뭐였더라?`,
      setting_chunks: "",
      speech_profile: "",
      greeting: LIKE_GREETING,
      nsfw: 0,
    },
    persona: PERSONA,
    user: USER,
    provenance:
      "C2 reconstruct: TERRA_PROMPT_CANARY_GREETING_NEUTRAL + reconstructed Like card; C1 D userInput",
  };

  const c10 = {
    character: {
      id: 10,
      name: "에녹",
      gender: "male",
      system_prompt: ENOCH_SYSTEM,
      world: ENOCH_WORLD,
      example_dialog: `유저: 저쪽이에요.\n에녹: 소음 내지 마. 따라와.`,
      setting_chunks: "",
      speech_profile: "",
      greeting: ENOCH_GREETING,
      nsfw: 0,
    },
    persona: PERSONA,
    user: USER,
    provenance:
      "C2 reconstruct: d2-enoch canon summary + final-production terra_action T1 userInput",
  };

  save("c5_fixture.json", c5);
  save("c18_fixture.json", c18);
  save("c10_fixture.json", c10);
  console.log(
    JSON.stringify(
      {
        out: OUT,
        c5_id: c5.character.id,
        c18_name: c18.character.name,
        c10_name: c10.character.name,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
