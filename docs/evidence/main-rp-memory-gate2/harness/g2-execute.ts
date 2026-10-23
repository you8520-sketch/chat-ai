import Module from "module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildCheaperInferenceHeaders } from "@/lib/cheaperInferenceConfig";
import { buildOpenRouterHeaders } from "@/lib/openRouterConfig";
import {
  RP_QUALITY_PAID_PRODUCTION_KEY_ENVS,
  experimentSecretUsesProductionKey,
} from "@/lib/rpQualityPaidRunner";

const WIRE = process.env.G2_WIRE ?? "/opt/cursor/artifacts/gate2/wire";
const OUTDIR = process.env.G2_RESULTS ?? "/opt/cursor/artifacts/gate2/results";
const MODELS = (process.env.G2_MODELS ?? "").split(",").filter(Boolean);
const BUDGET_KRW = Number(process.env.G2_BUDGET_KRW ?? "1000");
const FX = Number(process.env.G2_FX ?? "1700");
const OUT_ALLOW_TOKENS = 6000;
const WATCHDOG_CHARS = 12000;
const TIMEOUT_MS = 240_000;
const EXECUTE = process.env.G2_EXECUTE === "1";

const RATES: Record<string, { in: number; out: number; inWorst: number; cacheRead: number }> = {
  "deepseek-v4.1-flash": { in: 0.075, out: 0.3, inWorst: 0.075, cacheRead: 0.0015 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75, inWorst: 0.75, cacheRead: 0.075 },
  "gpt-6.1-sol": { in: 1.3, out: 6.5, inWorst: 1.625, cacheRead: 0.065 },
  "claude-opus-5.5": { in: 2.6, out: 13, inWorst: 3.25, cacheRead: 0.13 },
};

const SCENES = ["A_direct_quote", "B_npc_no_cue"];
const ARMS = ["old", "b1", "cur"];

const openRouterKey = process.env.RP_QUALITY_PAID_OPENROUTER_KEY?.trim() ?? "";
const cheaperKey = process.env.RP_QUALITY_PAID_CHEAPERINFERENCE_KEY?.trim() ?? "";

function worstCaseUsd(modelId: string, bodyChars: number): number {
  const r = RATES[modelId]!;
  return (bodyChars * r.inWorst) / 1e6 + (OUT_ALLOW_TOKENS * r.out) / 1e6;
}

type CallRecord = Record<string, unknown>;

async function post(wire: any): Promise<CallRecord> {
  const bodyJson = JSON.stringify(wire.requestBody);
  const headers =
    wire.provider === "openrouter" ? buildOpenRouterHeaders(openRouterKey) : buildCheaperInferenceHeaders(cheaperKey);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const rec: CallRecord = { startedAt: new Date(started).toISOString() };
  let text = "";
  let usage: any = null;
  let resolvedModel: string | null = null;
  let id: string | null = null;
  let finish: string | null = null;
  let sawDone = false;
  let reasoningChars = 0;
  let aborted = false;
  let firstByteMs: number | null = null;
  try {
    const res = await fetch(wire.endpoint, { method: "POST", headers, body: bodyJson, signal: controller.signal });
    rec.httpStatus = res.status;
    rec.requestId = res.headers.get("x-request-id") ?? res.headers.get("x-generation-id") ?? res.headers.get("cf-ray") ?? null;
    if (res.status < 200 || res.status >= 300) {
      rec.error = (await res.text()).slice(0, 400);
      rec.ok = false;
      return rec;
    }
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    outer: for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (firstByteMs == null) firstByteMs = Date.now() - started;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          sawDone = true;
          break outer;
        }
        let j: any;
        try {
          j = JSON.parse(payload);
        } catch {
          continue;
        }
        if (j.id) id = j.id;
        if (j.model) resolvedModel = j.model;
        if (j.usage) usage = j.usage;
        const ch = j.choices?.[0];
        if (ch?.delta?.content) text += ch.delta.content;
        if (ch?.delta?.reasoning) reasoningChars += String(ch.delta.reasoning).length;
        if (ch?.delta?.reasoning_content) reasoningChars += String(ch.delta.reasoning_content).length;
        if (ch?.finish_reason) finish = ch.finish_reason;
        if (text.length >= WATCHDOG_CHARS) {
          aborted = true;
          controller.abort();
          break outer;
        }
      }
    }
    rec.ok = !aborted && text.length > 0;
  } catch (e) {
    rec.ok = false;
    rec.error = aborted ? "WATCHDOG_ABORT" : String((e as Error).message ?? e).slice(0, 300);
  } finally {
    clearTimeout(timer);
  }
  rec.aborted = aborted;
  rec.text = text;
  rec.usage = usage;
  rec.resolvedModel = resolvedModel;
  rec.providerId = id;
  rec.finishReason = finish;
  rec.sawDone = sawDone;
  rec.reasoningChars = reasoningChars;
  rec.firstByteMs = firstByteMs;
  rec.latencyMs = Date.now() - started;
  return rec;
}

function computeUsd(modelId: string, usage: any): { usdNoCacheDiscount: number; usdWithCache: number | null; reportedCost: number | null } {
  const r = RATES[modelId]!;
  const pt = Number(usage?.prompt_tokens ?? 0);
  const ct = Number(usage?.completion_tokens ?? 0);
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? 0);
  const worstIn = (pt * r.inWorst) / 1e6 + (ct * r.out) / 1e6;
  const withCache = ((pt - cached) * r.in) / 1e6 + (cached * r.cacheRead) / 1e6 + (ct * r.out) / 1e6;
  const reported = usage?.cost != null ? Number(usage.cost) : null;
  return { usdNoCacheDiscount: worstIn, usdWithCache: withCache, reportedCost: reported };
}

async function main() {
  if (!MODELS.length) throw new Error("G2_MODELS required");
  for (const m of MODELS) if (!RATES[m]) throw new Error("unknown model " + m);
  if (!openRouterKey || !cheaperKey) throw new Error("MISSING_EXPERIMENT_KEYS");
  if (experimentSecretUsesProductionKey(openRouterKey) || experimentSecretUsesProductionKey(cheaperKey)) {
    throw new Error("PRODUCTION_KEY_FALLBACK_FORBIDDEN");
  }
  void RP_QUALITY_PAID_PRODUCTION_KEY_ENVS;
  mkdirSync(OUTDIR, { recursive: true });

  const plan: { caseId: string; wire: any; worstKrw: number }[] = [];
  for (const model of MODELS) {
    for (const scene of SCENES) {
      for (const arm of ARMS) {
        const caseId = `g2_${scene}_${arm}_${model}`;
        const wire = JSON.parse(readFileSync(`${WIRE}/${caseId}.json`, "utf8"));
        if ("max_tokens" in wire.requestBody || "max_completion_tokens" in wire.requestBody) throw new Error("MAX_TOKENS_PRESENT");
        if (wire.requestBody.model !== wire.wireModel) throw new Error("WIRE_MODEL_MISMATCH");
        const chars = JSON.stringify(wire.requestBody).length;
        plan.push({ caseId, wire, worstKrw: worstCaseUsd(model, chars) * FX });
      }
    }
  }
  const totalWorst = plan.reduce((s, p) => s + p.worstKrw, 0);
  console.log(`PLAN calls=${plan.length} worstTotalKRW=${totalWorst.toFixed(0)} budget=${BUDGET_KRW} fx=${FX}`);
  if (totalWorst >= BUDGET_KRW) throw new Error(`WORST_CASE_${totalWorst.toFixed(0)}_EXCEEDS_BUDGET`);
  if (!EXECUTE) {
    console.log("DRY_RUN (G2_EXECUTE!=1): no POST");
    return;
  }

  let spentKrw = 0;
  let posts = 0;
  for (const p of plan) {
    const outFile = `${OUTDIR}/${p.caseId}.json`;
    if (existsSync(outFile)) {
      console.log("SKIP_ALREADY_RECORDED", p.caseId);
      continue;
    }
    if (spentKrw + p.worstKrw > BUDGET_KRW) {
      console.log("STOP_BUDGET", p.caseId, spentKrw.toFixed(1), p.worstKrw.toFixed(1));
      break;
    }
    posts += 1;
    const rec = await post(p.wire);
    const cost = rec.usage ? computeUsd(p.wire.modelId, rec.usage) : null;
    const usdForBudget = cost ? Math.max(cost.usdNoCacheDiscount, cost.reportedCost ?? 0) : worstCaseUsd(p.wire.modelId, JSON.stringify(p.wire.requestBody).length);
    spentKrw += usdForBudget * FX;
    const record = {
      caseId: p.caseId,
      arm: p.wire.arm,
      sceneId: p.wire.sceneId,
      modelId: p.wire.modelId,
      wireModel: p.wire.wireModel,
      provider: p.wire.provider,
      postIndex: posts,
      ...rec,
      cost,
      budgetedUsd: usdForBudget,
      cumulativeBudgetedKrw: Math.round(spentKrw * 10) / 10,
      cursorQualityScore: null,
    };
    writeFileSync(outFile, JSON.stringify(record, null, 2));
    console.log(
      `POST#${posts} ${p.caseId} status=${rec.httpStatus} ok=${rec.ok} chars=${String(rec.text ?? "").length} usage=${JSON.stringify(rec.usage)?.slice(0, 160)} cumKRW=${spentKrw.toFixed(1)}`
    );
  }
  console.log(`DONE posts=${posts} spentKRW(budgeted, no cache discount)=${spentKrw.toFixed(1)}`);
}

main().catch((e) => {
  console.error("FATAL", e instanceof Error ? e.message : e);
  process.exit(1);
});
