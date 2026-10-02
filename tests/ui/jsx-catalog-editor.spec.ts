import { expect, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "컴파일 / 미리보기" }).click();
  await expect(page.getByText("내 컴포넌트 미리보기")).toBeVisible();
  await expect(page.frameLocator('iframe[title="QuestCardExample"]').getByText("사라진 지도")).toBeVisible();
  expect(providerCalls).toEqual([]);
});
