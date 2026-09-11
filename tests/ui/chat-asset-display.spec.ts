import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const PORTRAIT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#7c6aae"/><text x="150" y="200" font-size="28" text-anchor="middle" fill="white">guardrail</text></svg>`;
const PORTRAIT_DATA_URL =
  "data:image/svg+xml;charset=utf-8," + encodeURIComponent(PORTRAIT_SVG);
const PORTRAIT_WIDTH = 300;
const PORTRAIT_HEIGHT = 400;

const ASSISTANT_MARKER_TEXT =
  "guardrail deterministic assistant prose for selection action verification";

function playwrightDbPath(): string {
  const dataDir = process.env.PLAYWRIGHT_DATA_DIR;
  if (!dataDir) throw new Error("PLAYWRIGHT_DATA_DIR must be resolved by playwright.config.ts");
  const dbPath = path.resolve(dataDir, "app.db");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Expected app bootstrap to create the database first: ${dbPath}`);
  }
  return dbPath;
}

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

/** Give character 2 a single deterministic portrait asset (300x400 data URL). */
function seedPortraitAsset(characterId: number) {
  snapshotCharacterAssets(characterId);
  const db = new Database(playwrightDbPath());
  try {
    const assets = JSON.stringify([
      {
        url: PORTRAIT_DATA_URL,
        tag: "guardrail",
        width: PORTRAIT_WIDTH,
        height: PORTRAIT_HEIGHT,
        orientation: "portrait",
        public: true,
        chat: true,
        viewerBlur: false,
      },
    ]);
    const updated = db.prepare("UPDATE characters SET assets = ? WHERE id = ?").run(assets, characterId);
    if (updated.changes === 0) {
      throw new Error(`No character row to seed portrait asset: ${characterId}`);
    }
  } finally {
    db.close();
  }
}

function seedAssistantMessage(chatId: number, content: string) {
  const db = new Database(playwrightDbPath());
  try {
    db.prepare(
      "INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?, 'assistant', ?, 'playwright-fixture', 'completed')"
    ).run(chatId, content);
  } finally {
    db.close();
  }
}

function currentChatId(page: Page): number {
  const chatId = Number(new URL(page.url()).searchParams.get("chat"));
  if (!Number.isInteger(chatId) || chatId <= 0) {
    throw new Error(`Could not resolve chatId from ${page.url()}`);
  }
  return chatId;
}

// Shared Playwright DB isolation: this spec mutates character 2's assets and
// inserts marker messages. Snapshot before first mutation and restore in
// afterAll so later spec files (live-follow) see pristine shared rows.
// `assetsSnapshotTaken` records whether a snapshot was captured; it is NOT the
// stored value sentinel. `originalCharacterAssets` preserves the raw DB value
// verbatim, including a SQL NULL (distinct from "no snapshot taken").
let originalCharacterAssets: string | null = null;
let assetsSnapshotTaken = false;

function snapshotCharacterAssets(characterId: number) {
  if (assetsSnapshotTaken) return;
  const db = new Database(playwrightDbPath());
  try {
    const row = db
      .prepare("SELECT assets FROM characters WHERE id = ?")
      .get(characterId) as { assets: string | null } | undefined;
    if (!row) {
      throw new Error(`No character row to snapshot assets from: ${characterId}`);
    }
    originalCharacterAssets = row.assets;
    assetsSnapshotTaken = true;
  } finally {
    db.close();
  }
}

async function openFreshChat(page: Page, characterId = 2) {
  await page.goto(`/chat/${characterId}?fresh=1`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/chat\/\d+\?chat=\d+/, { timeout: 45_000 });
  await page.waitForSelector("textarea[placeholder*='메시지 입력']", { timeout: 45_000 });
}

test.describe("general chat asset display guardrails (B0)", () => {
  test.afterAll(async () => {
    const db = new Database(playwrightDbPath());
    try {
      // Guard on snapshot success, not on the value's nullability: a captured
      // SQL NULL must still be restored as SQL NULL.
      if (assetsSnapshotTaken) {
        db.prepare("UPDATE characters SET assets = ? WHERE id = 2").run(
          originalCharacterAssets
        );
        const restored = db
          .prepare("SELECT assets FROM characters WHERE id = 2")
          .get() as { assets: string | null };
        if (restored.assets !== originalCharacterAssets) {
          throw new Error(
            `assets restore mismatch for character 2: expected ${JSON.stringify(
              originalCharacterAssets
            )}, got ${JSON.stringify(restored.assets)}`
          );
        }
      }
      db.prepare("DELETE FROM messages WHERE content LIKE ?").run(`%${ASSISTANT_MARKER_TEXT}%`);
    } finally {
      db.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await demoLogin(page);
  });

  test("LEFT-NO-CROP: portrait image is fully visible inside its frame", async ({ page }) => {
    await page.goto("/chat/2?fresh=1", { waitUntil: "domcontentloaded" });
    seedPortraitAsset(2);
    await page.goto(`/chat/2?fresh=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("textarea[placeholder*='메시지 입력']", { timeout: 45_000 });

    const img = page.locator(".chat-room-portrait-column img:not([aria-hidden])").first();
    await expect(img).toBeVisible({ timeout: 45_000 });

    const geometry = await page.evaluate(() => {
      // The panel renders a blurred cover background plus the real image;
      // the guardrail targets the foreground (non-background) image only.
      const imgEl = document.querySelector(
        ".chat-room-portrait-column img:not([aria-hidden])"
      ) as HTMLImageElement | null;
      if (!imgEl) return null;
      // The frame is the ancestor carrying the asset aspect-ratio style.
      let frame: HTMLElement | null = imgEl.parentElement;
      while (frame && !(frame as HTMLElement).style?.aspectRatio) {
        frame = frame.parentElement;
      }
      const imgRect = imgEl.getBoundingClientRect();
      const frameRect = frame ? frame.getBoundingClientRect() : null;
      return {
        naturalWidth: imgEl.naturalWidth,
        naturalHeight: imgEl.naturalHeight,
        objectFit: getComputedStyle(imgEl).objectFit,
        frameAspect: frame ? getComputedStyle(frame).aspectRatio : null,
        frameInlineAspect: (frame as HTMLElement | null)?.style.aspectRatio ?? null,
        imgRect: { left: imgRect.left, right: imgRect.right, top: imgRect.top, bottom: imgRect.bottom },
        frameRect: frameRect
          ? { left: frameRect.left, right: frameRect.right, top: frameRect.top, bottom: frameRect.bottom }
          : null,
      };
    });
    expect(geometry).not.toBeNull();
    // Intrinsic fixture dimensions are preserved (no upscale/distortion).
    expect(geometry!.naturalWidth).toBe(PORTRAIT_WIDTH);
    expect(geometry!.naturalHeight).toBe(PORTRAIT_HEIGHT);
    // object-contain keeps the whole image visible.
    expect(geometry!.objectFit).toBe("contain");
    // Frame binds the asset's own aspect ratio (300/400), so contain == no crop.
    expect(geometry!.frameRect).not.toBeNull();
    expect(geometry!.frameInlineAspect).not.toBeNull();
    expect(geometry!.frameInlineAspect!.replace(/\s+/g, "")).toBe(
      `${PORTRAIT_WIDTH}/${PORTRAIT_HEIGHT}`
    );
    // No sideways (or any-side) clipping: image fully inside its frame.
    expect(geometry!.imgRect.left).toBeGreaterThanOrEqual(geometry!.frameRect!.left - 1);
    expect(geometry!.imgRect.right).toBeLessThanOrEqual(geometry!.frameRect!.right + 1);
    expect(geometry!.imgRect.top).toBeGreaterThanOrEqual(geometry!.frameRect!.top - 1);
    expect(geometry!.imgRect.bottom).toBeLessThanOrEqual(geometry!.frameRect!.bottom + 1);
  });

  test("SELECTION-ACTION: selecting assistant text shows the image action", async ({ page }) => {
    await openFreshChat(page);
    const chatId = currentChatId(page);
    seedAssistantMessage(chatId, ASSISTANT_MARKER_TEXT);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("textarea[placeholder*='메시지 입력']", { timeout: 45_000 });
    const assistant = page.locator("[data-quote-assistant]", { hasText: ASSISTANT_MARKER_TEXT }).first();
    await expect(assistant).toBeVisible({ timeout: 45_000 });

    await assistant.selectText();
    const action = page.getByRole("button", { name: "이미지 저장", exact: true });
    await expect(action).toBeVisible({ timeout: 15_000 });
    await expect(action).toBeEnabled();
  });
});
