import type { Page } from "@playwright/test";

/**
 * Explicit POST create from the browser cookie jar, then read-only GET.
 * page.request cannot send the production Secure session cookie over http://127.0.0.1;
 * Chromium document fetches can.
 */
export async function openExplicitFreshChat(page: Page, characterId = 2): Promise<number> {
  const current = page.url();
  if (!current || current === "about:blank" || !current.startsWith("http")) {
    await page.goto("/health", { waitUntil: "domcontentloaded" });
  }

  const result = await page.evaluate(async (id) => {
    const res = await fetch("/api/chat/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: id, fresh: true }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      chatId?: number;
      error?: string;
    };
    return {
      ok: res.ok,
      status: res.status,
      chatId: Number(data.chatId) || 0,
      error: typeof data.error === "string" ? data.error : "",
    };
  }, characterId);

  if (!result.ok || !result.chatId) {
    throw new Error(
      `POST /api/chat/session failed: ${result.status} ${result.error || ""}`.trim()
    );
  }

  await page.goto(`/chat/${characterId}?chat=${result.chatId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(new RegExp(`/chat/${characterId}\\?chat=${result.chatId}`), {
    timeout: 45_000,
  });
  return result.chatId;
}
