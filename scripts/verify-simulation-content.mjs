/** Fresh-DB round-trip for the text-first simulation creator. */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const dataDir = path.resolve("tmp-verify-simulation-content");
if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "simulation-content-integration-test-secret";

const source = async (file) => import(pathToFileURL(path.resolve(file)).href);
const { getDb } = await source("src/lib/db.ts");
const { createCharacterFromForm, updateCharacterFromForm } = await source(
  "src/lib/characterFormSave.ts"
);

const db = getDb();
const userId = Number(
  db
    .prepare("INSERT INTO users (email, nickname, pw_hash, is_adult) VALUES (?,?,?,1)")
    .run("simulation@example.test", "simulation-maker", "x").lastInsertRowid,
);
const user = { id: userId, nickname: "simulation-maker", is_adult: 1 };
const guestId = Number(
  db
    .prepare("INSERT INTO users (email, nickname, pw_hash, is_adult) VALUES (?,?,?,1)")
    .run("guest@example.test", "guest-maker", "x").lastInsertRowid,
);
const sharedCharacterId = Number(
  db
    .prepare(
      `INSERT INTO characters
        (name, tagline, creator_id, creator_name, system_prompt, world, example_dialog,
         visibility, moderation_status, content_kind, simulation_reuse_allowed)
       VALUES (?,?,?,?,?,?,?,?,?,'character',1)`,
    )
    .run(
      "공유 캐릭터",
      "허용된 외부 인물",
      guestId,
      "guest-maker",
      "침착한 구조대원이며 짧은 존댓말을 사용한다.",
      "같은 격리구역에서 구조 임무를 수행한다.",
      "구조대원: 움직이지 마십시오.",
      "public",
      "approved",
    ).lastInsertRowid,
);
const cast = Array.from(
  { length: 8 },
  (_, index) =>
    `[인물 ${index + 1}]\n역할: 격리구역 생존자\n성격: 서로 다른 판단 기준을 지닌다.\n말투: 인물 ${index + 1}만의 어휘와 문장 길이를 유지한다.\n목표: 현재 위험에서 살아남는다.\n비밀: 다른 인물에게 아직 밝히지 않은 과거가 있다.`,
).join("\n\n");
const body = {
  content_kind: "simulation",
  name: "텍스트 중심 시뮬레이션",
  tagline: "여러 인물이 독립적으로 움직이는 테스트",
  description: "공개 소개",
  world: "폐쇄된 격리구역이며 인물들은 제한된 자원으로 생존해야 한다. ".repeat(30),
  simulation_cast: cast,
  simulation_rules: "모든 인물은 자신이 직접 얻은 정보만 사용한다.",
  simulation_import_ids: [sharedCharacterId],
  system_prompt: cast,
  greeting: "경보가 멎자 여덟 사람은 서로를 바라보았다.",
  genres: ["시뮬레이션"],
  tags: "다인,생존",
  gender: "other",
  visibility: "private",
  assets: [
    {
      url: "https://example.test/simulation.webp",
      tag: "대표 이미지",
      public: true,
      chat: true,
      viewerBlur: false,
    },
  ],
};

const created = await createCharacterFromForm(user, body);
if (!created.ok) throw new Error(`create failed: ${created.error}`);
const row = db
  .prepare(
    "SELECT content_kind, simulation_cast, simulation_rules, system_prompt FROM characters WHERE id=?",
  )
  .get(created.id);
if (row.content_kind !== "simulation") throw new Error("content_kind was not stored");
if (!row.simulation_cast.includes("[인물 8]")) throw new Error("free-form cast was truncated");
if (!row.system_prompt.includes("[SIMULATION CAST — CREATOR CANON]")) {
  throw new Error("runtime cast owner was not compiled");
}
if (!row.system_prompt.includes("[IMPORTED CHARACTER — 공유 캐릭터")) {
  throw new Error("permitted external character was not imported server-side");
}

db.prepare("UPDATE characters SET simulation_reuse_allowed=0 WHERE id=?").run(sharedCharacterId);
const revoked = await updateCharacterFromForm(user, created.id, body);
if (revoked.ok || revoked.status !== 403) {
  throw new Error("revoked external-character permission was not enforced");
}
db.prepare("UPDATE characters SET simulation_reuse_allowed=1 WHERE id=?").run(sharedCharacterId);

const updated = await updateCharacterFromForm(user, created.id, {
  ...body,
  simulation_rules: "인물의 비밀과 지식 경계를 엄격히 분리한다.",
});
if (!updated.ok) throw new Error(`update failed: ${updated.error}`);
const updatedRow = db
  .prepare("SELECT simulation_rules, system_prompt FROM characters WHERE id=?")
  .get(created.id);
if (!updatedRow.system_prompt.includes("지식 경계를 엄격히 분리")) {
  throw new Error("updated rules were not compiled");
}

console.log("OK: text-first simulation create/update/runtime-prompt round-trip");
