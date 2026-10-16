import { expect, type Page } from "@playwright/test";

/** Live picker id used by follow/suggested-reply specs so send is not blocked. */
export const LIVE_FOLLOW_PICKER_MODEL_ID = "gemini-3.8-flash";

/**
 * Account-global Main RP selection is required before paid send.
 * Follow and suggested-reply specs are not picker tests; they need a valid live id.
 */
export async function ensureLivePickerModel(
  page: Page,
  modelId = LIVE_FOLLOW_PICKER_MODEL_ID
): Promise<void> {
  const select = page.locator("select").first();
  await expect(select).toBeVisible({ timeout: 45_000 });
  if ((await select.inputValue()) === modelId) return;

  const save = page.waitForResponse(
    (res) =>
      res.url().includes("/api/user/selected-ai") &&
      res.request().method() === "PATCH" &&
      res.ok(),
    { timeout: 15_000 }
  );
  await select.selectOption(modelId);
  await save;
  await expect(select).toHaveValue(modelId);
}
