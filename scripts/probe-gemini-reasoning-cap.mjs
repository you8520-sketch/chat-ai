/**
 * Probe Gemini 3.1 Pro reasoning cap mechanism — diagnostic only, no src changes.
 * Usage: npx.cmd tsx scripts/probe-gemini-reasoning-cap.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const root = process.cwd();

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k === "OPENROUTER_API_KEY" || !process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();

const MODEL = "google/gemini-3.1-pro-preview";
const PROMPT =
  "한 문단으로 답하라: 엘리베이터에 갇힌 두 사람이 서로를 처음 알아본 순간의 긴장감을 묘사해.";

async function fetchModelsReasoningMeta() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const j = await res.json();
  const m = (j.data ?? []).find((x) => x.id === MODEL);
  return m?.reasoning ?? null;
}

async function callOpenRouter(label, body) {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY missing");

  const requestBody = {
    model: MODEL,
    messages: [{ role: "user", content: PROMPT }],
    stream: false,
    max_tokens: 1024,
    temperature: 0.95,
    stream_options: { include_usage: true },
    ...body,
  };

  console.log("\n" + "=".repeat(72));
  console.log(`CASE: ${label}`);
  console.log("REQUEST JSON (exact body sent):");
  console.log(JSON.stringify(requestBody, null, 2));

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.log("RAW RESPONSE (non-JSON):", text.slice(0, 2000));
    return { error: "non-json", status: res.status };
  }

  if (!res.ok) {
    console.log("HTTP", res.status, JSON.stringify(data, null, 2));
    return { error: data, status: res.status };
  }

  const usage = data.usage ?? {};
  const details = usage.completion_tokens_details ?? {};
  const content = data.choices?.[0]?.message?.content ?? "";
  const reasoningField = data.choices?.[0]?.message?.reasoning;
  const reasoningDetails = data.choices?.[0]?.message?.reasoning_details;

  console.log("RESPONSE usage (raw):");
  console.log(JSON.stringify(usage, null, 2));
  console.log("finish_reason:", data.choices?.[0]?.finish_reason);
  console.log("content_chars:", String(content).length);
  console.log("message.reasoning present:", reasoningField != null);
  console.log(
    "reasoning_details count:",
    Array.isArray(reasoningDetails) ? reasoningDetails.length : 0
  );

  return {
    completion_tokens: usage.completion_tokens,
    reasoning_tokens: details.reasoning_tokens ?? null,
    finish_reason: data.choices?.[0]?.finish_reason,
    content_chars: String(content).length,
  };
}

async function callProductionBody() {
  const origLoad = require("module")._load;
  require("module")._load = function (request, parent, isMain) {
    if (request === "server-only") return {};
    return origLoad(request, parent, isMain);
  };

  const { buildOpenRouterRequestBody } = await import("../src/lib/openRouterClient.ts");
  const body = buildOpenRouterRequestBody(
    MODEL,
    [{ role: "user", content: PROMPT }],
    false,
    2400,
    "probe-gemini-reasoning"
  );

  const key = process.env.OPENROUTER_API_KEY?.trim();
  console.log("\n" + "=".repeat(72));
  console.log("CASE: production buildOpenRouterRequestBody (current src)");
  console.log("REQUEST JSON (exact body sent):");
  console.log(JSON.stringify(body, null, 2));

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.log("HTTP", res.status, JSON.stringify(data, null, 2));
    return { error: data };
  }

  const usage = data.usage ?? {};
  const details = usage.completion_tokens_details ?? {};
  console.log("RESPONSE usage (raw):");
  console.log(JSON.stringify(usage, null, 2));
  console.log("finish_reason:", data.choices?.[0]?.finish_reason);
  console.log(
    "content_chars:",
    String(data.choices?.[0]?.message?.content ?? "").length
  );

  return {
    completion_tokens: usage.completion_tokens,
    reasoning_tokens: details.reasoning_tokens ?? null,
    finish_reason: data.choices?.[0]?.finish_reason,
    content_chars: String(data.choices?.[0]?.message?.content ?? "").length,
  };
}

async function main() {
  const meta = await fetchModelsReasoningMeta();
  console.log("OpenRouter GET /models reasoning metadata for", MODEL);
  console.log(JSON.stringify(meta, null, 2));

  const results = {};

  results.production = await callProductionBody();

  results.max_tokens_128 = await callOpenRouter("manual reasoning.max_tokens=128 + include_reasoning=false", {
    reasoning: { max_tokens: 128 },
    include_reasoning: false,
  });

  results.effort_low = await callOpenRouter("manual reasoning.effort=low + include_reasoning=false", {
    reasoning: { effort: "low" },
    include_reasoning: false,
  });

  results.effort_minimal = await callOpenRouter("manual reasoning.effort=minimal + include_reasoning=false", {
    reasoning: { effort: "minimal" },
    include_reasoning: false,
  });

  results.no_reasoning_param = await callOpenRouter("no reasoning param (default model behavior)", {});

  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY");
  console.log(JSON.stringify(results, null, 2));

  const outPath = path.join(root, "output", "probe-gemini-reasoning-cap.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ model: MODEL, modelsApiReasoning: meta, results }, null, 2),
    "utf8"
  );
  console.log("Written:", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
