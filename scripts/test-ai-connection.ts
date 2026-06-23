/** AI API 연결 진단 — npm run dev 중 터미널에서: npx tsx scripts/test-ai-connection.ts */
import { readFileSync } from "fs";
import { resolve } from "path";
import { geminiGenerateContentUrl } from "../src/lib/geminiApiUrl";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    console.log(".env.local 없음");
  }
}

async function testGemini(model: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log(`[SKIP] GEMINI ${model} — GEMINI_API_KEY 없음`);
    return;
  }
  const url = geminiGenerateContentUrl(model, key);
  const body = {
    contents: [{ role: "user", parts: [{ text: "한 줄로 인사해줘" }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 64 },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`[GEMINI] ${model} → HTTP ${res.status}`);
    console.log(text.slice(0, 400));
  } catch (e) {
    console.log(`[GEMINI] ${model} → FETCH 실패: ${(e as Error).message}`);
  }
}

loadEnvLocal();
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? `설정됨 (${process.env.GEMINI_API_KEY.length}자)` : "없음");
console.log("---");

async function main() {
  await testGemini("gemini-2.5-flash");
  await testGemini("gemini-3-flash-preview");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
