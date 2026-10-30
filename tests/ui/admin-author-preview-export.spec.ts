import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import type { OfficialCharacterDraft } from "../../src/lib/officialSupply/types";

const evidenceDir = process.env.HAV_G5_3J_UI_EVIDENCE_DIR;
const adminId = 97395;
const park = JSON.parse(
  fs.readFileSync("docs/official-supply/reviews/g5-1-2026-10-28/candidates/g5-modern-comedy/draft.compiled.json", "utf8")
) as OfficialCharacterDraft;
const eunji = JSON.parse(
  fs.readFileSync(
    "docs/official-supply/reviews/g5-1-2026-10-28/candidates/g5-modern-comedy-e/draft.compiled.json",
    "utf8"
  )
) as OfficialCharacterDraft;

const resolved = {
  genre: "현대/일상",
  tone: "light",
  humor: "central",
  pacing: "dialogue",
  nameWordplay: "nickname",
  worldScale: "scene",
  namingProfile: "korean_modern",
  castIntent: "전체 이용자 대상 현대/일상 캐릭터 1명.",
};

function fixturePreview(input: {
  previewId: string;
  qaOk: boolean;
  draft: OfficialCharacterDraft;
  issues?: { code: string; message: string }[];
}) {
  return {
    ok: true,
    previewId: input.previewId,
    qaOk: input.qaOk,
    issues: input.issues ?? [],
    repairable: false,
    voiceRepairs: 0,
    textLock: input.qaOk ? "passlock12deadbeef" : "faillock12deadbeef",
    creatorComment: input.draft.creatorComment,
    manuscript: {
      name: input.draft.name,
      tagline: input.draft.tagline,
      description: input.draft.description,
      greeting: input.draft.greeting,
      genres: input.draft.genres,
      tags: input.draft.tags,
    },
    resolved,
    systemPrompt: "do-not-export",
  };
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  await request.get("/login");
  const dataDir = path.resolve(process.env.PLAYWRIGHT_DATA_DIR!);
  if (!process.env.PLAYWRIGHT_DATA_DIR || [path.resolve("data"), "/data"].includes(dataDir)) {
    throw new Error("admin preview export UI requires a separate local fixture database");
  }
  const db = new Database(path.join(dataDir, "app.db"));
  try {
    db.prepare(
      "INSERT OR IGNORE INTO users (id,email,nickname,pw_hash,is_adult,is_admin) VALUES (?,?,?,'fixture',1,1)"
    ).run(adminId, `g53j-ui-${adminId}@test.local`, "G5-3J 관리자");
    db.prepare("INSERT OR REPLACE INTO sessions (token,user_id,expires_at) VALUES (?,?,'2099-01-01')").run(
      `g53j-ui-${adminId}`,
      adminId
    );
  } finally {
    db.close();
  }
});

async function openCreate(page: import("@playwright/test").Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.context().addCookies([{ name: "session", value: `g53j-ui-${adminId}`, url: test.info().project.use.baseURL! }]);
  await page.goto("/create");
  await expect(page.getByTestId("admin-official-author")).toBeVisible({ timeout: 60_000 });
}

for (const width of [390, 1440]) {
  test(`empty admin author form has no copy control at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await openCreate(page, width);
    await expect(page.getByTestId("admin-author-copy-json")).toHaveCount(0);
    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      await page.locator('[data-testid="admin-official-author"]').screenshot({
        path: path.join(evidenceDir, `before-${width}.png`),
      });
    }
  });
}

test("copies a passing fixture and downloads a QA-fail fixture", async ({ page }) => {
  test.setTimeout(120_000);
  await openCreate(page, 1440);
  await page.route("**/api/admin/official-author/preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixturePreview({ previewId: "pass-fixture", qaOk: true, draft: park })),
    });
  });
  await page.getByRole("button", { name: "원고 생성", exact: true }).click();
  await expect(page.getByTestId("admin-author-copy-json")).toBeVisible();
  await expect(page.getByTestId("admin-author-qa")).toContainText("검수 통과");
  if (evidenceDir) {
    await page.getByTestId("admin-author-copy-json").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidenceDir, "after-1440.png") });
  }
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("admin-author-copy-json").click();
  await expect(page.getByText("미리보기 JSON을 복사했습니다.")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const pass = JSON.parse(copied) as Record<string, unknown>;
  expect(pass.previewId).toBe("pass-fixture");
  expect(pass.qaOk).toBe(true);
  expect((pass.manuscript as { name: string }).name).toBe("박수진");
  expect(JSON.stringify(pass)).not.toContain("systemPrompt");
  expect(JSON.stringify(pass)).not.toContain("do-not-export");

  await page.route("**/api/admin/official-author/preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        fixturePreview({
          previewId: "fail-fixture",
          qaOk: false,
          draft: { ...eunji, greeting: `${eunji.greeting}\n사정했다` },
          issues: [{ code: "sfw_public_text_has_adult_terms", message: "all-ages public text contains adult terms" }],
        })
      ),
    });
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("denied")),
      },
    });
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "원고 생성", exact: true }).click();
  await expect(page.getByTestId("admin-author-qa")).toContainText("검수 실패");
  await page.getByTestId("admin-author-copy-json").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("official-author-preview-fail-fixture.json");
  const downloadPath = path.join(process.env.HAV_G5_3J_UI_EVIDENCE_DIR ?? test.info().outputDir, download.suggestedFilename());
  await download.saveAs(downloadPath);
  const fail = JSON.parse(fs.readFileSync(downloadPath, "utf8")) as Record<string, unknown>;
  expect(fail.qaOk).toBe(false);
  expect((fail.issues as { code: string }[])[0]?.code).toBe("sfw_public_text_has_adult_terms");
  expect((fail.manuscript as { greeting: string }).greeting).toContain("사정했다");
  expect(JSON.stringify(fail)).not.toContain("systemPrompt");
  await expect(page.getByText("클립보드를 쓸 수 없어 JSON 파일로 저장했습니다.")).toBeVisible();
});

test("passing fixture copy control at 390px", async ({ page }) => {
  test.setTimeout(120_000);
  await openCreate(page, 390);
  await page.route("**/api/admin/official-author/preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixturePreview({ previewId: "pass-fixture", qaOk: true, draft: park })),
    });
  });
  await page.getByRole("button", { name: "원고 생성", exact: true }).click();
  await expect(page.getByTestId("admin-author-copy-json")).toBeVisible();
  if (evidenceDir) {
    await page.getByTestId("admin-author-copy-json").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidenceDir, "after-390.png") });
  }
});
