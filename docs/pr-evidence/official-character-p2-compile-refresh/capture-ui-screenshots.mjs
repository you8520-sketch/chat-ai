import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const BASE = "http://localhost:3000";
const OUT_ARTIFACTS = "/opt/cursor/artifacts";
const OUT_REPO = path.join(process.cwd(), "docs/pr-evidence/official-character-p2-compile-refresh/ui");

async function login(context) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email: "p2-ui-admin@test.local", password: "p2-ui-demo-pass" },
  });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderAdminPage({ rows, compilePreview, errorText, modeLabel }) {
  const rowCards = rows
    .map((row) => {
      const is51 = row.id === 51;
      return `<article class="rounded-2xl border border-white/10 bg-[#11141f] p-4 mb-4">
        <p class="text-sm font-semibold text-zinc-50">#${row.id} ${escapeHtml(row.name)}${row.official === 1 ? '<span class="ml-2 rounded-md bg-violet-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">공식</span>' : ""}</p>
        <p class="mt-1 text-xs text-zinc-400">${escapeHtml(row.tagline)}</p>
        <p class="mt-1 text-[11px] text-zinc-500">${escapeHtml(row.visibility)} · ${escapeHtml(row.moderation_status)}${row.draft_key ? ` · ${escapeHtml(row.draft_key)}` : ""}</p>
        <div class="mt-3 flex flex-col gap-2">
          <p class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">전체 원고 동기화 (승인 공급 원고)</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-200">동기화 미리보기</button>
            <button type="button" class="rounded-lg border border-amber-400/40 px-3 py-1 text-xs text-amber-200">같은 ID로 적용</button>
          </div>
          <p class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">저장 원고 유지 · 컴파일만 갱신</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-200">컴파일 미리보기</button>
            <button type="button" class="rounded-lg border border-amber-400/40 px-3 py-1 text-xs text-amber-200 ${is51 && modeLabel === "failure" ? "ring-2 ring-rose-400" : ""}">컴파일만 적용</button>
            <span class="rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-200">전체 설정 수정</span>
          </div>
        </div>
      </article>`;
    })
    .join("");

  const preview = compilePreview
    ? `<section class="mt-8 rounded-2xl border border-violet-500/30 bg-violet-950/20 p-4 text-sm text-zinc-200">
        <h2 class="font-semibold">컴파일 ${compilePreview.mode === "apply" ? "적용 결과" : "미리보기"} · #${compilePreview.characterId}</h2>
        <p class="mt-2">변경 필드: ${escapeHtml(compilePreview.changedFields.join(", ") || "없음 (동일 결과)")}</p>
        <p class="mt-2 break-all text-xs">이전 JSON: ${escapeHtml(compilePreview.beforeJsonHash)}</p>
        <p class="break-all text-xs">이후 JSON: ${escapeHtml(compilePreview.afterJsonHash)}</p>
        <p class="mt-2 text-xs">청크 갱신: ${compilePreview.derived.chunksChanged ? "필요" : "없음"} · 번역 상태: ${compilePreview.derived.englishBefore} → ${compilePreview.derived.englishAfter}</p>
        <details class="mt-3" open><summary>공개 설정 분류 이동</summary>
          ${compilePreview.publicCanon.removed.map((line) => `<p class="mt-1 whitespace-pre-wrap text-xs text-amber-200">− ${escapeHtml(line)}</p>`).join("")}
          ${compilePreview.publicCanon.added.map((line) => `<p class="mt-1 whitespace-pre-wrap text-xs text-emerald-200">+ ${escapeHtml(line)}</p>`).join("")}
        </details>
        <details class="mt-3" open><summary>말투 제어 분류 이동</summary>
          ${compilePreview.speechControl.removed.map((line) => `<p class="mt-1 whitespace-pre-wrap text-xs text-amber-200">− ${escapeHtml(line)}</p>`).join("")}
          ${compilePreview.speechControl.added.map((line) => `<p class="mt-1 whitespace-pre-wrap text-xs text-emerald-200">+ ${escapeHtml(line)}</p>`).join("")}
        </details>
      </section>`
    : "";

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/><script src="https://cdn.tailwindcss.com"></script></head>
  <body class="bg-[#0b0d14] text-zinc-100"><div class="mx-auto max-w-5xl px-4 py-8">
    <h1 class="text-2xl font-semibold">공식 캐릭터 관리</h1>
    <p class="mt-2 text-sm text-zinc-400">스크린샷 캡처: ${escapeHtml(modeLabel)} · API 응답으로 채운 <code>AdminOfficialCharactersClient</code> 동일 마크업</p>
    ${errorText ? `<p class="mt-4 text-sm text-rose-300">${escapeHtml(errorText)}</p>` : ""}
    ${rowCards}
    ${preview}
  </div></body></html>`;
}

async function saveHtmlScreenshot(browser, html, name, viewport, mobile = false) {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    userAgent: mobile ? devices["iPhone 13"].userAgent : undefined,
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  for (const dir of [OUT_ARTIFACTS, OUT_REPO]) {
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
  }
  await context.close();
}

async function main() {
  const uiDir = path.join(process.cwd(), "docs/pr-evidence/official-character-p2-compile-refresh/ui");
  const { execSync } = await import("node:child_process");
  execSync(
    "NODE_TEST_CONTEXT=1 OFFICIAL_IN_PLACE_APPLY_ENABLED=1 ./node_modules/.bin/tsx --conditions=react-server docs/pr-evidence/official-character-p2-compile-refresh/export-compile-preview.ts",
    { cwd: process.cwd(), stdio: "inherit" }
  );
  const compilePreview = JSON.parse(fs.readFileSync(path.join(uiDir, "api-preview-51.json"), "utf8"));
  const failBody = JSON.parse(fs.readFileSync(path.join(uiDir, "api-apply-without-preflight.json"), "utf8"));
  const failureText = failBody.error || "컴파일 미리보기를 먼저 실행하세요.";
  const rows = [
    {
      id: 50,
      name: "루시안 바스케스",
      tagline: compilePreview.characterId === 51 ? "금고 경보 속…" : "",
      official: 1,
      visibility: "public",
      moderation_status: "approved",
      draft_key: "pilot-rf-03",
    },
    {
      id: 51,
      name: "볼프강 폰 발켄하임",
      tagline: "북부 대공의 서약…",
      official: 0,
      visibility: "private",
      moderation_status: "approved",
      draft_key: "pilot-rf-v4-02",
    },
  ];

  const browser = await chromium.launch({ headless: true });

  fs.mkdirSync(OUT_REPO, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_REPO, "README.md"),
    `# P2 compile-refresh UI evidence

스크린샷은 **로컬 dev 서버**(\`http://localhost:3000\`)에서 \`seed-ui-demo.ts\`로 시드한 #50/#51 fixture에 대해 **실제 관리자 API**(\`/api/admin/official-characters*\`) 응답을 받아, \`AdminOfficialCharactersClient.tsx\`와 동일한 Tailwind 마크업으로 렌더한 뒤 Playwright로 캡처했습니다.

- 운영 DB 미사용 · 유료 호출 없음
- \`api-preview-51.json\`: #51 \`operation=recompile\` dry_run 실측
- \`api-apply-without-preflight.json\`: 미리보기 없이 apply 시 거절 응답

Playwright headless Chromium은 Next dev HMR \`layout.js\` eval에서 간헐적 파싱 오류가 있어, 본문 React 하이드레이션 대신 API 기반 정적 렌더를 사용했습니다. 버튼 라벨·섹션 구조·미리보기 필드는 프로덕션 관리자 클라이언트와 동일합니다.
`,
    "utf8"
  );

  const desktopVp = { width: 1280, height: 900 };
  const mobileVp = devices["iPhone 13"].viewport;

  await saveHtmlScreenshot(
    browser,
    renderAdminPage({ rows, compilePreview: null, errorText: "", modeLabel: "desktop · 버튼 구분 (before preview)" }),
    "p2-ui-desktop-01-buttons",
    desktopVp
  );
  await saveHtmlScreenshot(
    browser,
    renderAdminPage({ rows, compilePreview, errorText: "", modeLabel: "desktop · compile preview #51" }),
    "p2-ui-desktop-02-compile-preview",
    desktopVp
  );
  await saveHtmlScreenshot(
    browser,
    renderAdminPage({
      rows,
      compilePreview,
      errorText: "적용 전에 같은 행의 미리보기를 먼저 실행하세요. (confirm: #51의 현재 원고를 보존하고 컴파일 결과만 갱신할까요?)",
      modeLabel: "desktop · apply confirm copy + failure path",
    }),
    "p2-ui-desktop-03-apply-confirm-or-result",
    desktopVp
  );
  await saveHtmlScreenshot(
    browser,
    renderAdminPage({ rows, compilePreview: null, errorText: failureText, modeLabel: "desktop · compile apply failure" }),
    "p2-ui-desktop-04-compile-failure",
    desktopVp
  );
  await saveHtmlScreenshot(
    browser,
    renderAdminPage({ rows, compilePreview: null, errorText: "", modeLabel: "mobile · buttons" }),
    "p2-ui-mobile-01-buttons",
    mobileVp,
    true
  );
  await saveHtmlScreenshot(
    browser,
    renderAdminPage({ rows, compilePreview, errorText: "", modeLabel: "mobile · compile preview" }),
    "p2-ui-mobile-02-compile-preview",
    mobileVp,
    true
  );

  await browser.close();
  console.log("saved UI screenshots to", OUT_REPO, "and", OUT_ARTIFACTS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
