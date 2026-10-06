import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function saveShot(page: Page, name: string) {
  if (!fs.existsSync("/opt/cursor/artifacts")) return;
  await page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: false });
}

test("interactive component examples preview at 390px without chat calls", async ({ page }) => {
  const providerCalls: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/\/api\/chat|openrouter\.ai|api\.openai\.com/i.test(url)) providerCalls.push(url);
    if (request.method() === "POST" && /\/api\/points\/(charge|gift|subscribe)/i.test(url)) {
      providerCalls.push(url);
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const loginStatus = await page.evaluate(async () => {
    const res = await fetch("/api/auth/demo-login", { method: "POST" });
    return res.status;
  });
  expect(loginStatus).toBe(200);
  await page.goto("/create");

  const pageTab = page.getByRole("tab", { name: "상태창", exact: true });
  await expect(pageTab).toBeVisible();
  await expect
    .poll(async () => {
      if ((await pageTab.getAttribute("aria-selected")) !== "true") await pageTab.click();
      return pageTab.getAttribute("aria-selected");
    })
    .toBe("true");

  const opener = page.getByRole("button", { name: /^대화용 인터랙티브 화면 만들기/ });
  await opener.click();
  await expect(page.getByRole("list", { name: "예제 갤러리" })).toBeVisible();
  for (const label of ["진행 상황 카드", "퀘스트 카드", "선택지 카드", "인물 정보 패널"]) {
    await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }

  const nameInput = page.getByLabel("이름 (PascalCase)");
  await expect(nameInput).toHaveValue("");

  await page.getByRole("button", { name: /퀘스트 카드/ }).click();
  const questFrame = page.frameLocator('iframe[title="QuestCardExample"]');
  await expect(questFrame.getByText("사라진 지도")).toBeVisible();
  await page.getByLabel("퀘스트 제목").fill("새 의뢰");
  await expect(questFrame.getByText("새 의뢰")).toBeVisible();
  await expect(nameInput).toHaveValue("");

  await page.getByRole("button", { name: "이 예제 적용" }).click();
  await expect(nameInput).toHaveValue("QuestCardExample");
  await expect(page.getByText("내 컴포넌트 미리보기")).toBeVisible();

  await page.getByRole("button", { name: /선택지 카드/ }).click();
  const choiceFrame = page.frameLocator('iframe[title="ChoiceCardExample"]');
  await choiceFrame.getByRole("button", { name: "조심스럽게 노크한다" }).click();
  await expect(choiceFrame.getByText("지금 선택: 조심스럽게 노크한다")).toBeVisible();
  await expect(nameInput).toHaveValue("QuestCardExample");

  // Browsing a different example must not strand the user's own preview
  // after they explicitly compile their existing component again.
  await page.getByText("고급 JSX 코드 및 Props").click();
  const sourceInput = page.getByLabel("JSX source");
  const draftSource = await sourceInput.inputValue();
  await sourceInput.fill(draftSource + "\n// explicit-compile-only");
  await page.getByRole("button", { name: /인물 정보 패널/ }).click();
  await expect(page.getByText("미저장 초안입니다.")).toBeVisible();
  await expect(nameInput).toHaveValue("QuestCardExample");
  await page.getByRole("button", { name: "컴파일 / 미리보기" }).click();
  await expect(page.getByText("내 컴포넌트 미리보기")).toBeVisible();
  // The user changed the title before applying the example. The editor must
  // preserve that override through save, later gallery browsing and recompilation.
  await expect(page.frameLocator('iframe[title="QuestCardExample"]').getByText("새 의뢰")).toBeVisible();

  const guide = "새 퀘스트가 등장하거나 주요 진행 상황이 변경되면 사용합니다. 일반 대화에서는 사용하지 않습니다.";
  const guideInput = page.getByLabel("AI 호출 설명");
  await guideInput.fill(guide);
  await expect(page.getByRole("region", { name: "AI에게 실제로 전달되는 정보" })).toContainText(guide);
  await saveShot(page, "jsx-call-guide-mobile");
  await expect(page.getByRole("region", { name: "AI에게 실제로 전달되는 정보" })).not.toContainText("export default function");

  await page.getByRole("button", { name: /인물 정보 패널/ }).click();
  await expect(guideInput).toHaveValue(guide);
  await expect(page.getByLabel("이름 (PascalCase)")).toHaveValue("QuestCardExample");

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(guideInput).toBeVisible();
  await guideInput.fill(`${guide} 데스크톱`);
  const manifest = page.getByRole("region", { name: "AI에게 실제로 전달되는 정보" });
  await expect(manifest).toContainText("데스크톱");
  await manifest.scrollIntoViewIfNeeded();
  if (fs.existsSync("/opt/cursor/artifacts")) {
    await manifest.screenshot({ path: "/opt/cursor/artifacts/jsx-call-guide-manifest.png" });
  }
  await saveShot(page, "jsx-call-guide-desktop");

  // A changed name makes this a draft. A subsequent guide edit must not appear
  // in the saved manifest until the creator explicitly applies the draft.
  await page.getByLabel("이름 (PascalCase)").fill("UnappliedBoard");
  await guideInput.fill("아직 저장하지 않은 호출 지시입니다.");
  await expect(manifest).toContainText("QuestCardExample");
  await expect(manifest).toContainText("데스크톱");
  await expect(manifest).not.toContainText("UnappliedBoard");
  await expect(manifest).not.toContainText("아직 저장하지 않은 호출 지시입니다.");
  await expect(page.getByText("작성 중인 초안은 적용하기 전까지 모델에 전달되지 않습니다.")).toBeVisible();
  expect(providerCalls).toEqual([]);
});

test("TRPG sheet surface edits its own slot with fixed sample data and enforces surface policy", async ({ page }) => {
  const providerCalls: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/chat|openrouter\.ai|api\.openai\.com/i.test(request.url())) providerCalls.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const loginStatus = await page.evaluate(async () => (await fetch("/api/auth/demo-login", { method: "POST" })).status);
  expect(loginStatus).toBe(200);
  await page.goto("/create");
  const pageTab = page.getByRole("tab", { name: "상태창", exact: true });
  await expect
    .poll(async () => {
      if ((await pageTab.getAttribute("aria-selected")) !== "true") await pageTab.click();
      return pageTab.getAttribute("aria-selected");
    })
    .toBe("true");
  await page.getByRole("button", { name: /^대화용 인터랙티브 화면 만들기/ }).click();

  const surfaces = page.getByRole("radiogroup", { name: "컴포넌트 용도" });
  await expect(surfaces.getByRole("radio", { name: /채팅 중 호출/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: /퀘스트 카드/ }).click();
  await page.getByRole("button", { name: "이 예제 적용" }).click();
  await expect(page.getByLabel("이름 (PascalCase)")).toHaveValue("QuestCardExample");

  await surfaces.getByRole("radio", { name: /TRPG 캐릭터 시트/ }).click();
  await expect(page.getByText("AI가 답변에서 호출하는 컴포넌트가 아니며", { exact: false })).toBeVisible();
  await expect(page.getByLabel("AI 호출 설명")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "예제 갤러리" })).toHaveCount(0);
  await page.getByRole("button", { name: "기본 시트 코드로 시작" }).click();
  await page.getByRole("button", { name: "시트 컴파일 / 미리보기" }).click();
  const preview = page.frameLocator("iframe[title='TrpgSheet 시트 미리보기']");
  await expect(preview.getByText("백하율")).toBeVisible();
  await expect(preview.getByText("HP 9/20")).toBeVisible();
  await expect(preview.getByText("폐역 승강장")).toBeVisible();
  await expect(preview.getByText("왼팔 부상: 근력 판정 -1")).toBeVisible();
  await expect(surfaces.getByRole("radio", { name: /TRPG 캐릭터 시트/ })).toContainText("저장됨: TrpgSheet");
  await page.getByText("시트가 받는 고정 데이터").click();
  await expect(page.locator("[data-jsx-trpg-sheet-editor] li").filter({ hasText: "props.modifiersNote" })).toBeVisible();
  if (fs.existsSync("/opt/cursor/artifacts")) {
    await page.locator("[data-jsx-trpg-sheet-editor]").screenshot({ path: "/opt/cursor/artifacts/trpg-sheet-editor-mobile.png" });
  }

  const sourceInput = page.getByLabel("시트 JSX source");
  await sourceInput.fill(`export default function TrpgSheet() { return <button onClick={() => sendToChat("x")}>x</button>; }`);
  await page.getByRole("button", { name: "시트 컴파일 / 미리보기" }).click();
  await expect(page.getByText("TRPG 캐릭터 시트에서는 sendToChat을 사용할 수 없습니다.", { exact: false })).toBeVisible();
  await expect(page.getByText("저장된 시트는 유지됩니다: TrpgSheet.", { exact: false })).toBeVisible();

  await surfaces.getByRole("radio", { name: /채팅 중 호출/ }).click();
  await expect(page.getByLabel("이름 (PascalCase)")).toHaveValue("QuestCardExample");
  const manifest = page.getByRole("region", { name: "AI에게 실제로 전달되는 정보" });
  await expect(manifest).toContainText("QuestCardExample");
  await expect(manifest).not.toContainText("TrpgSheet");
  await page.getByText("고급 JSX 코드 및 Props").click();
  await page.getByLabel("JSX source").fill(
    `export default function QuestCardExample() { return <button onClick={() => setTrpgActionDraft("free", "x")}>x</button>; }`
  );
  await page.getByRole("button", { name: "컴파일 / 미리보기" }).click();
  await expect(page.getByText("setTrpgActionDraft는 TRPG 캐릭터 시트 컴포넌트에서만", { exact: false })).toBeVisible();
  expect(providerCalls).toEqual([]);
});
