/**
 * 성인 OFF 출력 검사 분류기 live 프로브(수동, 소형). 샘플당 1회, 재시도 없음.
 *
 *   node --conditions=react-server --import tsx scripts/adult-off-guard-classifier-probe.ts
 *
 * 정확도를 증명하지 않는다. 표본이 작아 동작 경향·비용·지연만 기록한다.
 * env: PROBE_OUT_DIR, PROBE_USD_KRW(미지정 시 open.er-api.com 현재가), PROBE_MAX_KRW(기본 40)
 */
import Module from "node:module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADULT_OFF_PROBE_SAMPLES } from "./lib/adultOffGuardProbeFixtures";

const OUT_DIR =
  process.env.PROBE_OUT_DIR?.trim() || "docs/audits/adult-off-output-guard/live";
const MAX_KRW = Number(process.env.PROBE_MAX_KRW ?? "40");

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required for the live classifier probe");
  }
  const { createAdultOffClassifier, ADULT_OFF_CLASSIFIER_MODEL } = await import(
    "../src/lib/adultOffOutputClassifier"
  );
  const { ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT, ADULT_OFF_GUARD_POLICY_VERSION } = await import(
    "../src/lib/adultOffOutputGuard"
  );
  let usdKrw = Number(process.env.PROBE_USD_KRW ?? "");
  if (!(usdKrw > 0)) {
    const fx = (await (await fetch("https://open.er-api.com/v6/latest/USD")).json()) as {
      rates?: { KRW?: number };
    };
    usdKrw = Number(fx.rates?.KRW);
  }
  if (!(usdKrw > 0)) throw new Error("USD/KRW rate unavailable");
  const effective = usdKrw * 1.02;

  const rows: Array<Record<string, unknown>> = [];
  let spentKrw = 0;
  for (const sample of ADULT_OFF_PROBE_SAMPLES) {
    if (spentKrw >= MAX_KRW) {
      rows.push({ id: sample.id, skipped: "probe_budget" });
      continue;
    }
    const startedAt = Date.now();
    try {
      const classify = createAdultOffClassifier({
        chatId: 0,
        assistantMessageId: 0,
        generationSequence: 0,
        generationRequestId: `adult-off-probe-${sample.id}`,
      });
      const result = await classify(sample.text);
      const costKrw = (result.usage.costUsd ?? 0) * effective;
      spentKrw += costKrw;
      rows.push({
        id: sample.id,
        group: sample.group,
        expected: sample.expected,
        note: sample.note,
        text: sample.text,
        textChars: sample.text.length,
        verdict: result.verdict,
        match: result.verdict.decision === sample.expected,
        usage: result.usage,
        costKrw,
        wallMs: Date.now() - startedAt,
      });
    } catch (error) {
      rows.push({
        id: sample.id,
        group: sample.group,
        expected: sample.expected,
        note: sample.note,
        text: sample.text,
        textChars: sample.text.length,
        error: error instanceof Error ? error.message.slice(0, 200) : String(error),
        wallMs: Date.now() - startedAt,
      });
    }
  }

  const scored = rows.filter((row) => "match" in row);
  const count = (pred: (row: Record<string, unknown>) => boolean) => scored.filter(pred).length;
  const latencies = scored.map((row) => Number(row.wallMs)).sort((a, b) => a - b);
  const report = {
    model: ADULT_OFF_CLASSIFIER_MODEL,
    policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
    promptChars: ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT.length,
    usdKrwEffective: effective,
    qualityScore: null,
    samples: ADULT_OFF_PROBE_SAMPLES.length,
    scored: scored.length,
    errors: rows.filter((row) => "error" in row).length,
    allowCorrect: count((r) => r.expected === "allow" && r.match === true),
    allowTotal: count((r) => r.expected === "allow"),
    restrictCorrect: count((r) => r.expected === "restrict" && r.match === true),
    restrictTotal: count((r) => r.expected === "restrict"),
    totalCostKrw: spentKrw,
    meanCostKrw: scored.length ? spentKrw / scored.length : null,
    latencyMs: {
      p50: latencies[Math.floor(latencies.length * 0.5)] ?? null,
      max: latencies.at(-1) ?? null,
    },
    rows,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "classifier-probe.json"), JSON.stringify(report, null, 2));
  console.info(
    JSON.stringify({ ...report, rows: undefined }, null, 2)
  );
  for (const row of rows) {
    console.info(
      `${String(row.id).padEnd(36)} expected=${row.expected} got=${(row.verdict as { decision?: string; category?: string } | undefined)?.decision ?? "ERR"}/${(row.verdict as { category?: string } | undefined)?.category ?? ""} conf=${(row.verdict as { confidence?: string } | undefined)?.confidence ?? ""} match=${row.match} ${row.wallMs}ms ${Number(row.costKrw ?? 0).toFixed(2)}KRW ${row.error ?? ""}`
    );
  }
  Module._load = originalLoad;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
