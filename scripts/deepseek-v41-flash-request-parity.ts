/**
 * DeepSeek V4 Pro vs V4.1 Flash — deterministic FINAL REQUEST parity harness.
 * Credential-free: buildContext + assemblePrimaryRpRequest only, no live calls.
 * Run: node --conditions=react-server --import tsx scripts/deepseek-v41-flash-request-parity.ts
 * MERGE=NO / read-only audit artifact for PR #993 correction pass.
 */
import Module from "module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildContext } from "@/services/contextBuilder";
import { assemblePrimaryRpRequest, type AssembledPrimaryRpRequest } from "@/lib/openRouterAdult";
import { MODELS, fixtures, OUT_DIR, type Fixture } from "./deepseek-v41-flash-rp-ab";

const originalLoad = Module._load;
Module._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy hook
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

type BodyRecord = Record<string, unknown>;
type Label = "pro" | "flash";

function asRecord(value: unknown): BodyRecord {
  return value && typeof value === "object" ? (value as BodyRecord) : {};
}

function diffKeys(a: BodyRecord, b: BodyRecord): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
}

function messagesDiff(
  a: AssembledPrimaryRpRequest,
  b: AssembledPrimaryRpRequest
): { identical: true; firstDivergence: null } | { identical: false; firstDivergence: string } {
  const fmt = (req: AssembledPrimaryRpRequest) =>
    req.messages.map((m) => `${m.role}:|:${m.content}`).join("\u0001");
  const fa = fmt(a);
  const fb = fmt(b);
  if (fa === fb) return { identical: true, firstDivergence: null };
  const la = fa.split("\u0001");
  const lb = fb.split("\u0001");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return {
        identical: false,
        firstDivergence: `index ${i}: pro=${(la[i] ?? "<missing>").slice(0, 120)} flash=${(lb[i] ?? "<missing>").slice(0, 120)}`,
      };
    }
  }
  return { identical: false, firstDivergence: "<length only>" };
}

function fixtureTarget(fixture: Fixture): number {
  return fixture.id === "H_long_output" ? 3500 : 3200;
}

function buildForModel(
  fixture: Fixture,
  modelId: string,
  targetChars: number
): {
  assembled: AssembledPrimaryRpRequest;
  systemPromptChars: number;
  historyMessages: number;
} {
  const ctx = buildContext({
    charName: fixture.charName,
    chunks: fixture.chunks,
    userNickname: "민수",
    shortTermHistory: fixture.history,
    currentUserMessage: fixture.userMessage,
    nsfw: fixture.nsfw,
    modelId,
    provider: "cheaperinference",
  });
  const assembled = assemblePrimaryRpRequest({
    system: ctx.systemPrompt,
    history: ctx.history,
    modelId,
    targetResponseChars: targetChars,
    messageOpts: {
      transportProvider: "cheaperinference",
      requestKind: "v41-flash-preflight-parity",
    },
    stream: true,
  });
  return {
    assembled,
    systemPromptChars: ctx.systemPrompt.length,
    historyMessages: ctx.history.length,
  };
}

type FixtureParityRow = {
  fixtureId: string;
  label: string;
  transportProvider: string;
  preAdapt: {
    changedKeys: string[];
    messageOrderingDiff:
      | { identical: true; firstDivergence: null }
      | { identical: false; firstDivergence: string };
  };
  finalRequest: {
    changedKeys: string[];
    reasoningControls: {
      pro: Record<string, unknown>;
      flash: Record<string, unknown>;
    };
    sampling: {
      pro: Record<string, unknown>;
      flash: Record<string, unknown>;
    };
  };
  adapterAdaptationKeyDiff: unknown;
  systemPrompt: { proChars: number; flashChars: number; charDelta: number };
  historyMessages: { pro: number; flash: number };
  targetResponseChars: number;
};

const parity: FixtureParityRow[] = [];

for (const fixture of fixtures()) {
  const targetChars = fixtureTarget(fixture);
  const pro = buildForModel(fixture, MODELS.pro, targetChars);
  const flash = buildForModel(fixture, MODELS.flash, targetChars);

  const proBefore = asRecord(pro.assembled.requestBodyBeforeAdapt);
  const flashBefore = asRecord(flash.assembled.requestBodyBeforeAdapt);
  const proAdapt = asRecord(pro.assembled.requestBody);
  const flashAdapt = asRecord(flash.assembled.requestBody);

  parity.push({
    fixtureId: fixture.id,
    label: fixture.label,
    transportProvider: pro.assembled.transport.provider,
    preAdapt: {
      changedKeys: diffKeys(proBefore, flashBefore),
      messageOrderingDiff: messagesDiff(pro.assembled, flash.assembled),
    },
    finalRequest: {
      changedKeys: diffKeys(proAdapt, flashAdapt),
      reasoningControls: {
        pro: {
          thinking: proAdapt.thinking ?? null,
          reasoning_effort: proAdapt.reasoning_effort ?? null,
          reasoning: proAdapt.reasoning ?? null,
        },
        flash: {
          thinking: flashAdapt.thinking ?? null,
          reasoning_effort: flashAdapt.reasoning_effort ?? null,
          reasoning: flashAdapt.reasoning ?? null,
        },
      },
      sampling: {
        pro: {
          temperature: proAdapt.temperature ?? null,
          top_p: proAdapt.top_p ?? null,
          max_tokens: proAdapt.max_tokens ?? null,
        },
        flash: {
          temperature: flashAdapt.temperature ?? null,
          top_p: flashAdapt.top_p ?? null,
          max_tokens: flashAdapt.max_tokens ?? null,
        },
      },
    },
    adapterAdaptationKeyDiff: {
      pro: pro.assembled.adaptationKeyDiff,
      flash: flash.assembled.adaptationKeyDiff,
    },
    systemPrompt: {
      proChars: pro.systemPromptChars,
      flashChars: flash.systemPromptChars,
      charDelta: pro.systemPromptChars - flash.systemPromptChars,
    },
    historyMessages: { pro: pro.historyMessages, flash: flash.historyMessages },
    targetResponseChars: targetChars,
  });
}

const outPath = join(OUT_DIR, "request-parity.json");
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), fixtures: parity }, null, 2),
  "utf8"
);
console.log(`Wrote ${outPath} — ${parity.length} fixtures`);
