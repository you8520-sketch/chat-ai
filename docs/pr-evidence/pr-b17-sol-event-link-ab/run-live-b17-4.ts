/**
 * B17-4: one Arm A + one Arm B Sol call via CHEAPER_INFERENCE_BENCHMARK_API_KEY only.
 * Frozen wire bodies from wire/arm-*-request.json. No retries on auth failure.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildCheaperInferenceHeaders } from "@/lib/cheaperInferenceConfig";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import {
  BENCHMARK_CHEAPER_INFERENCE_ENV,
  resolveBenchmarkCheaperInferenceApiKey,
  sanitizeBenchmarkCredentialText,
} from "../../../scripts/lib/benchmarkCheaperInferenceCredential";

const EVIDENCE = path.join(process.cwd(), "docs/pr-evidence/pr-b17-sol-event-link-ab");
const OUT = path.join(EVIDENCE, "live-b17-4");
const MODEL = "gpt-6.1-sol";

type WireFile = {
  endpoint: string;
  requestBody: Record<string, unknown>;
};

function canonicalRequestBodySha(body: Record<string, unknown>): string {
  const canonicalJson = JSON.stringify(sortKeysDeep(body));
  return createHash("sha256").update(canonicalJson).digest("hex");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, sortKeysDeep(obj[k])])
    );
  }
  return value;
}

function loadWire(arm: "a" | "b"): WireFile {
  const file = path.join(EVIDENCE, "wire", arm === "a" ? "arm-a-request.json" : "arm-b-request.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as WireFile;
}

async function streamCompletion(
  endpoint: string,
  apiKey: string,
  requestBody: Record<string, unknown>
) {
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(apiKey),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(12 * 60 * 1000),
  });
  const httpStatus = res.status;
  if (httpStatus === 401 || httpStatus === 403) {
    const errText = sanitizeBenchmarkCredentialText(await res.text());
    return {
      httpStatus,
      latencyMs: Date.now() - started,
      finishReason: null as string | null,
      resolvedModel: null as string | null,
      text: "",
      usage: null,
      providerRequestId: null as string | null,
      errorBody: errText.slice(0, 4000),
    };
  }
  if (!res.body) {
    return {
      httpStatus,
      latencyMs: Date.now() - started,
      finishReason: null,
      resolvedModel: null,
      text: "",
      usage: null,
      providerRequestId: null,
      errorBody: "missing response body",
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let resolvedModel: string | null = null;
  let usageRaw: unknown = null;
  let providerRequestId: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof ev.model === "string") resolvedModel = ev.model;
      if (typeof ev.id === "string") providerRequestId = ev.id;
      const choice = Array.isArray(ev.choices) ? (ev.choices[0] as Record<string, unknown>) : null;
      if (choice && typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
      const delta = choice?.delta as Record<string, unknown> | undefined;
      if (delta && typeof delta.content === "string") text += delta.content;
      if (ev.usage) usageRaw = ev.usage;
    }
  }

  const usage = usageRaw ? parseOpenRouterUsage(usageRaw) : null;
  return {
    httpStatus,
    latencyMs: Date.now() - started,
    finishReason,
    resolvedModel,
    text,
    usage,
    providerRequestId,
    errorBody: null as string | null,
  };
}

function usdAndKrw(usage: ReturnType<typeof parseOpenRouterUsage> | null) {
  if (!usage) {
    return {
      usd: null as number | null,
      krw: null as number | null,
      fx: getEffectiveKrwPerUsd(),
      promptTokens: null as number | null,
      completionTokens: null as number | null,
      finishReasonTokens: null as number | null,
    };
  }
  const priced = openRouterUsdCostFromRates({
    modelId: MODEL,
    promptTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });
  const fx = getEffectiveKrwPerUsd();
  const usd = usage.upstreamCostUsd ?? priced.usdCost;
  const krw = Math.round(usd * fx * 10) / 10;
  return {
    usd,
    krw,
    fx,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens,
    upstreamCostUsd: usage.upstreamCostUsd,
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const prod = process.env.CHEAPER_INFERENCE_API_KEY?.trim() ?? "";
  const bench = resolveBenchmarkCheaperInferenceApiKey();
  if (!bench) {
    console.log("STOP missing benchmark key");
    process.exit(2);
  }
  if (prod && bench === prod) {
    console.log("STOP BENCHMARK_EQUALS_PRODUCTION");
    process.exit(2);
  }

  const wireA = loadWire("a");
  const wireB = loadWire("b");
  const shaA = canonicalRequestBodySha(wireA.requestBody);
  const shaB = canonicalRequestBodySha(wireB.requestBody);
  const expectedA = "47aa63445a79506b17f32a3f4c7bbadc0f8aa758fe59544479993253d17761ff";
  const expectedB = "fca4a547fb1adbff4ae64df66372f09aa47744d84d1956b871325cea3c7820ac";
  if (shaA !== expectedA || shaB !== expectedB) {
    console.log("STOP wire SHA mismatch", { shaA, shaB });
    process.exit(2);
  }

  const keyAudit = {
    verifiedAt: new Date().toISOString(),
    revision: "B17-4-resume",
    approvedCredential: BENCHMARK_CHEAPER_INFERENCE_ENV,
    wireSha256Verified: { armA_requestBody: shaA, armB_requestBody: shaB },
    comparisonToProduction: { equals_CHEAPER_INFERENCE_API_KEY: false },
    authPath: {
      buildCheaperInferenceHeaders: true,
      authorizationScheme: "Bearer",
      paidRunnerDirectPath: "not_used",
    },
    guards: {
      PRODUCTION_KEY_FALLBACK_FORBIDDEN: "maintained",
      userMandate_stopIfBenchmarkEqualsProduction: "not_triggered",
    },
  };
  fs.writeFileSync(path.join(OUT, "key-audit.json"), `${JSON.stringify(keyAudit, null, 2)}\n`);

  console.log("WIRE_SHA_OK");
  console.log("ARM_A_START");
  const resultA = await streamCompletion(wireA.endpoint, bench, wireA.requestBody);
  fs.writeFileSync(
    path.join(OUT, "arm-a-trace.json"),
    `${JSON.stringify({ ...resultA, textLength: resultA.text.length }, null, 2)}\n`
  );
  fs.writeFileSync(path.join(OUT, "arm-a-output.txt"), resultA.text, "utf8");

  if (resultA.httpStatus !== 200 || !resultA.text) {
    fs.writeFileSync(
      path.join(OUT, "run-status.json"),
      `${JSON.stringify(
        {
          revision: "B17-4-resume",
          status: "STOPPED_AFTER_ARM_A",
          httpStatus: resultA.httpStatus,
          armAExecuted: true,
          armBExecuted: false,
          providerCalls: 1,
        },
        null,
        2
      )}\n`
    );
    console.log("STOP arm A failed", resultA.httpStatus);
    process.exit(resultA.httpStatus === 401 || resultA.httpStatus === 403 ? 3 : 4);
  }

  console.log("ARM_B_START");
  const resultB = await streamCompletion(wireB.endpoint, bench, wireB.requestBody);
  fs.writeFileSync(
    path.join(OUT, "arm-b-trace.json"),
    `${JSON.stringify({ ...resultB, textLength: resultB.text.length }, null, 2)}\n`
  );
  fs.writeFileSync(path.join(OUT, "arm-b-output.txt"), resultB.text, "utf8");

  const costA = usdAndKrw(resultA.usage);
  const costB = usdAndKrw(resultB.usage);
  const totalKrw =
    costA.krw != null && costB.krw != null ? Math.round((costA.krw + costB.krw) * 10) / 10 : null;

  fs.writeFileSync(
    path.join(OUT, "run-status.json"),
    `${JSON.stringify(
      {
        revision: "B17-4-resume",
        status: resultB.httpStatus === 200 && resultB.text ? "COMPLETE" : "STOPPED_AFTER_ARM_B",
        armAExecuted: true,
        armBExecuted: resultB.httpStatus === 200,
        providerCalls: resultB.httpStatus === 200 ? 2 : 2,
        resultLabel: resultB.httpStatus === 200 && resultB.text ? "READY_FOR_GPT_REVIEW" : "PARTIAL",
        cost: { armA: costA, armB: costB, totalKrw },
      },
      null,
      2
    )}\n`
  );

  console.log("DONE", { totalKrw, armAChars: resultA.text.length, armBChars: resultB.text.length });
  if (resultB.httpStatus !== 200 || !resultB.text) {
    process.exit(4);
  }
}

main().catch((err) => {
  console.error(sanitizeBenchmarkCredentialText(String(err)));
  process.exit(1);
});
