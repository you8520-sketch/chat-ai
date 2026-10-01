/**
 * Current withdrawal requests store no identity-document path.
 * Uses one temporary user and a synthetic resident-number string.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { getDb } from "./db";
import { requestCreatorWithdrawal } from "./creatorPoints";
import { encryptSensitive } from "./fieldEncryption";

const TAG = `wdoc_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
const SYNTHETIC_RESIDENT = "0000000000000";

function createUser(): { id: number; email: string } {
  const db = getDb();
  const email = `${TAG}@wdoc.local`;
  const nickname = TAG;
  db.prepare("DELETE FROM users WHERE email=?").run(email);
  const row = db
    .prepare(
      "INSERT INTO users (email, nickname, pw_hash, points, is_adult, real_name, creator_points) VALUES (?,?,?,0,1,?,0)"
    )
    .run(email, nickname, "x", "홍길동");
  return { id: Number(row.lastInsertRowid), email };
}

function cleanup(): void {
  const db = getDb();
  const ids = (
    db.prepare("SELECT id FROM users WHERE email LIKE '%@wdoc.local'").all() as { id: number }[]
  ).map((row) => row.id);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM withdrawal_requests WHERE user_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM creator_point_logs WHERE user_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids);
}

after(cleanup);

describe("withdrawal document columns", () => {
  it("stores empty document paths and does not write a secure-upload file", () => {
    assert.equal(fs.existsSync(path.join("src", "lib", "withdrawalStorage.ts")), false);
    const route = fs.readFileSync(path.join("src", "app", "api", "creator", "withdraw", "route.ts"), "utf8");
    assert.equal(route.includes("saveWithdrawalDocument"), false);
    assert.equal(route.includes("formData("), false);
    assert.equal(route.includes("req.json("), true);

    const user = createUser();
    const db = getDb();
    db.prepare("UPDATE users SET creator_points = 100000 WHERE id=?").run(user.id);
    const result = requestCreatorWithdrawal(
      user.id,
      30000,
      { bankName: "테스트은행", accountNumber: "1000000000", accountHolder: "홍길동" },
      {
        residentNumberEncrypted: encryptSensitive(SYNTHETIC_RESIDENT),
        taxConsent: true,
        verifiedRealName: "홍길동",
      }
    );
    const stored = db
      .prepare(
        `SELECT id_card_url, bankbook_url, length(resident_number) AS resident_len
         FROM withdrawal_requests WHERE id=?`
      )
      .get(result.withdrawalId) as {
      id_card_url: string;
      bankbook_url: string;
      resident_len: number;
    };
    assert.equal(stored.id_card_url, "");
    assert.equal(stored.bankbook_url, "");
    assert.equal(stored.resident_len > 20, true);
    assert.equal(
      fs.existsSync(path.join("data", "secure-uploads", "withdrawals", String(user.id))),
      false
    );
  });
});
