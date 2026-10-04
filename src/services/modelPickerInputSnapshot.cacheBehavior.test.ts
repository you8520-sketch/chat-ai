import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { User } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { resolveMainRpNextTurnPickerEstimates } from "@/services/mainRpNextTurnEstimate";
import {
  invalidateModelPickerInputSnapshot,
  modelPickerAssembledSnapshotRebuildCount,
  resetModelPickerAssembledSnapshotRebuildCount,
  resolveModelPickerAssembledInputSnapshots,
} from "@/services/modelPickerInputSnapshot";

const USER_ID = 781001;
const CHAR_ID = 781002;
const CHAT_ID = 781003;

const USER: User = {
  id: USER_ID,
  email: "cache@test.local",
  nickname: "여행자",
  is_adult: 1,
  nsfw_on: 0,
  points: 5000,
  sub_until: null,
  google_id: null,
  pref: null,
  sub_plan: null,
  sub_auto_renew: 0,
  notice_last_read_id: 0,
};

function seedRoom() {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash, is_adult, points) VALUES (?,?,?,?,?,?)`
  ).run(USER_ID, USER.email, USER.nickname, "x", 1, 5000);
  db.prepare(
    `INSERT INTO characters (id, name, description, system_prompt, world, greeting)
     VALUES (?,?,?,?,?,?)`
  ).run(CHAR_ID, "솔", "등대지기", "너는 솔이다.", "항구", "등대가 깜빡인다.");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, user_note, adult_handoff_enabled)
     VALUES (?,?,?,'safe','CACHE_NOTE',0)`
  ).run(CHAT_ID, USER_ID, CHAR_ID);
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT_ID,
    "assistant",
    "등대가 깜빡인다.",
    "greeting"
  );
}

describe("model picker snapshot cache behavior", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    invalidateModelPickerInputSnapshot(CHAT_ID);
    resetModelPickerAssembledSnapshotRebuildCount();
    seedRoom();
  });

  it("A SSR_FIRST_LOAD then same-room client request adds 0 rebuilds", async () => {
    const ssr = await resolveMainRpNextTurnPickerEstimates({
      chatId: CHAT_ID,
      user: USER,
    });
    assert.ok(ssr);
    const afterSsr = modelPickerAssembledSnapshotRebuildCount();
    assert.equal(afterSsr, 1);
    const client = await resolveModelPickerAssembledInputSnapshots({
      chatId: CHAT_ID,
      user: USER,
    });
    assert.ok(client);
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), afterSsr);
  });

  it("B REPEATED_UNCHANGED endpoint calls do not rebuild after first compute", async () => {
    await resolveMainRpNextTurnPickerEstimates({ chatId: CHAT_ID, user: USER });
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), 1);
    await resolveMainRpNextTurnPickerEstimates({ chatId: CHAT_ID, user: USER });
    await resolveMainRpNextTurnPickerEstimates({ chatId: CHAT_ID, user: USER });
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), 1);
  });

  it("C FINGERPRINT_CHANGE rebuilds exactly once then hits cache", async () => {
    await resolveModelPickerAssembledInputSnapshots({ chatId: CHAT_ID, user: USER });
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), 1);
    getDb()
      .prepare("UPDATE chats SET model_route_state_json=? WHERE id=?")
      .run(JSON.stringify({ activeConsentMode: "cnc_opt_in" }), CHAT_ID);
    getDb()
      .prepare("UPDATE characters SET adult_consent_modes_json=? WHERE id=?")
      .run(JSON.stringify(["standard", "cnc_opt_in"]), CHAR_ID);
    await resolveModelPickerAssembledInputSnapshots({ chatId: CHAT_ID, user: USER });
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), 2);
    await resolveModelPickerAssembledInputSnapshots({ chatId: CHAT_ID, user: USER });
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), 2);
  });

  it("D EXPLICIT_INVALIDATION rebuilds exactly once then hits cache", async () => {
    await resolveModelPickerAssembledInputSnapshots({ chatId: CHAT_ID, user: USER });
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), 1);
    invalidateModelPickerInputSnapshot(CHAT_ID);
    await resolveModelPickerAssembledInputSnapshots({ chatId: CHAT_ID, user: USER });
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), 2);
    await resolveModelPickerAssembledInputSnapshots({ chatId: CHAT_ID, user: USER });
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), 2);
  });

  it("E FOCUS equivalent repeated request does not rebuild when source is unchanged", async () => {
    await resolveMainRpNextTurnPickerEstimates({ chatId: CHAT_ID, user: USER });
    const afterSsr = modelPickerAssembledSnapshotRebuildCount();
    await resolveMainRpNextTurnPickerEstimates({ chatId: CHAT_ID, user: USER });
    await resolveModelPickerAssembledInputSnapshots({ chatId: CHAT_ID, user: USER });
    assert.equal(modelPickerAssembledSnapshotRebuildCount(), afterSsr);
  });

  it("client and API sources no longer carry a refresh bypass", () => {
    const client = fs.readFileSync(
      path.join(process.cwd(), "src/app/chat/[id]/ChatClient.tsx"),
      "utf8"
    );
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/chat/[id]/page.tsx"), "utf8");
    const api = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/chat/next-turn-estimates/route.ts"),
      "utf8"
    );
    assert.doesNotMatch(client, /refresh:\s*true/);
    assert.doesNotMatch(client, /JSON\.stringify\(\{ chatId: roomId, refresh \}\)/);
    assert.doesNotMatch(page, /refresh:\s*false/);
    assert.doesNotMatch(api, /body\.refresh/);
  });
});
