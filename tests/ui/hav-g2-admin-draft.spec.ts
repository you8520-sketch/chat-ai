import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const baseline = process.env.HAV_G2_UI_BASELINE === "1";
const evidenceDir = process.env.HAV_G2_UI_EVIDENCE_DIR;
const adminId = 97391, userId = 97392;
let id: number;
const payload = JSON.parse(fs.readFileSync("docs/official-supply/reviews/g2-2026-10-28/preview-first-form.json", "utf8"));

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  await request.get("/login");
  const dataDir = path.resolve(process.env.PLAYWRIGHT_DATA_DIR!);
  if (!process.env.PLAYWRIGHT_DATA_DIR || [path.resolve("data"), "/data"].includes(dataDir)) throw new Error("G2 UI requires a separate local fixture database");
  const db = new Database(path.join(dataDir, "app.db"));
  try {
    db.prepare("DELETE FROM characters WHERE creator_id=?").run(adminId);
    for (const [user, admin] of [[adminId, 1], [userId, 0]]) {
      db.prepare("INSERT OR IGNORE INTO users (id,email,nickname,pw_hash,is_adult,is_admin) VALUES (?,?,?,'fixture',1,?)").run(user, `g2-ui-${user}@test.local`, admin ? "G2 검수 관리자" : "G2 일반 사용자", admin);
      db.prepare("INSERT OR REPLACE INTO sessions (token,user_id,expires_at) VALUES (?,?,'2099-01-01')").run(`g2-ui-${user}`, user);
    }
    const res = await request.post("/api/characters", { headers: { Cookie: `session=g2-ui-${adminId}` }, data: payload });
    expect(res.status()).toBe(baseline ? 400 : 200);
    if (baseline) {
      // Identical unsupported fixture for the BEFORE editor screenshot only.
      id = Number(db.prepare(`INSERT INTO characters (creator_id,creator_name,name,tagline,description,greeting,system_prompt,world,example_dialog,creator_comment,gender,genres,genre,tags,participant_min_age,visibility,official,assets,images)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,28,'private',0,'[]','[]')`).run(adminId, "G2 검수 관리자", payload.name, payload.tagline, payload.description, payload.greeting, payload.system_prompt, payload.world, fs.readFileSync("docs/official-supply/reviews/g2-2026-10-28/preview-first-example-dialog.txt", "utf8"), payload.creator_comment, payload.gender, JSON.stringify(payload.genres), "로맨스 판타지", JSON.stringify(payload.tags)).lastInsertRowid);
    } else {
      id = (await res.json()).id;
      const row = db.prepare("SELECT creator_id,visibility,official,assets,images FROM characters WHERE id=?").get(id);
      expect(row).toMatchObject({ creator_id: adminId, visibility: "private", official: 0, assets: "[]", images: "[]" });
    }
    const reopen = await request.get(`/api/characters/${id}`, { headers: { Cookie: `session=g2-ui-${adminId}` } });
    expect(reopen.status()).toBe(200);
    const normal = await request.post("/api/characters", { headers: { Cookie: `session=g2-ui-${userId}` }, data: { ...payload, isAdmin: true, is_admin: 1 } });
    expect(normal.status()).toBe(400);
    for (const visibility of ["public", "link"]) {
      const publicReq = await request.post("/api/characters", { headers: { Cookie: `session=g2-ui-${adminId}` }, data: { ...payload, visibility } });
      expect(publicReq.status()).toBe(400);
    }
  } finally { db.close(); }
});

for (const width of [390, 1440]) {
  test(`image-free administrator editor and own list at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.context().addCookies([{ name: "session", value: `g2-ui-${adminId}`, url: test.info().project.use.baseURL! }]);
    await page.goto(`/create?edit=${id}`);
    await expect(page.locator('input[value="테오"]')).toBeVisible({ timeout: 60_000 });
    if (!baseline) await expect(page.getByText("관리자 비공개 초안은 이미지 없이 저장할 수 있어요.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({ path: path.join(evidenceDir, `${baseline ? "before" : "after"}-editor-${width}.png`), fullPage: true });
    }
    if (!baseline) {
      const saved = page.waitForResponse(res => res.url().endsWith(`/api/characters/${id}`) && ["PATCH", "PUT"].includes(res.request().method()));
      await page.getByRole("button", { name: "변경사항 저장", exact: true }).click();
      expect((await saved).status()).toBe(200);
      await page.waitForURL(`**/character/${id}`);
    }
    await page.goto("/my-characters");
    const card = page.locator('[data-testid="studio-work-card"]').filter({ hasText: "테오" }).first();
    await expect(card).toBeVisible();
    if (!baseline) {
      await expect(card.locator('[data-status="draft-imageless"]')).toHaveText("비공개 초안 · 이미지 미등록");
      await expect(card.getByText("검수 통과")).toHaveCount(0);
    } else {
      await expect(card.getByText("검수 통과")).toBeVisible();
    }
    if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, `${baseline ? "before" : "after"}-list-${width}.png`), fullPage: true });
    await expect(page.getByRole("link", { name: /수정|편집/ }).first()).toBeVisible();
    const editor = await page.request.get(`/api/characters/${id}`, { headers: { Cookie: `session=g2-ui-${adminId}` } });
    expect(editor.status()).toBe(200);
    const data = await editor.json();
    expect(data.assets).toEqual([]);
    expect(data.greeting).toBe(payload.greeting);
  });
}
