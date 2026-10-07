import type { Page } from "@playwright/test";

/** Explicit POST create, then read-only GET of the returned room. */
export async function openExplicitFreshChat(page: Page, characterId = 2): Promise<number> {
  const created = await page.request.post("/api/chat/session", {
    data: { characterId, fresh: true },
  });
  if (!created.ok()) {
    throw new Error(`POST /api/chat/session failed: ${created.status()} ${await created.text()}`);
  }
  const body = (await created.json()) as { chatId?: number };
  if (!body.chatId) {
    throw new Error("POST /api/chat/session did not return chatId");
  }
  await page.goto(`/chat/${characterId}?chat=${body.chatId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(new RegExp(`/chat/${characterId}\\?chat=${body.chatId}`), {
    timeout: 45_000,
  });
  return body.chatId;
}
