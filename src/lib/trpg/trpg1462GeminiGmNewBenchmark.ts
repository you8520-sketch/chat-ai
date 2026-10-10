import { createHash } from "node:crypto";
import { buildTrpgGmProviderRequest } from "./gmCall";
import { trpgProviderRequestContract } from "./gmClient";
import { buildTrpgGmUserBlock, formatTrpgSheetCanon, TRPG_GM_SYSTEM } from "./gmPrompt";
import { formatTrpgPlayerPersonaBlock } from "./hostPersona";
import { serializeLocalSceneDeltaContract } from "./localSceneProgress";
import { DEFAULT_TRPG_STAT_DEFS, evenStats } from "./stats";
import { TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "./types";

export const TRPG_1462_NEW_BENCHMARK_ID = "TRPG_1462_GEMINI_GM_NEW_BENCHMARK_v1";
export const TRPG_1462_HISTORICAL_F_PROMPT_SHA256 =
  "13fd812b8358a522e061fd6b1e805ee8cefcbc4dd1f5a5a4a1a0d99adf499ad8";
export const TRPG_1462_OLD_LOCATION_RULES =
  "Inventory, location, quests, NPCs, flags, and story progress remain yours";
export const TRPG_1462_NEW_LOCATION_RULES =
  "Inventory, quests, NPCs, flags, story progress, and world/NPC location remain yours";
export const TRPG_1462_SYSTEM_SHA_1465 =
  "0887fbd2fb1c66870bfb1865411c96bba0790b52ad3a3a0fc638ed0f562ccfd5";
export const TRPG_1462_SYSTEM_SHA_1480 =
  "f35aa34f99a70f93394943ad042193243dcaa4b23938f32a32fb8446b0697515";

export const TRPG_1462_NEW_BENCHMARK_REQUEST_IDS = [
  "A",
  "B",
  "C_1465",
  "C_1480",
  "D_1465",
  "D_1480",
] as const;

export type Trpg1462NewBenchmarkRequestId = (typeof TRPG_1462_NEW_BENCHMARK_REQUEST_IDS)[number];

/** Minimum paid matrix after approval. C/D on #1480 only. */
export const TRPG_1462_MIN_PAID_REQUEST_IDS = ["A", "B", "C_1480", "D_1480"] as const;

export const TRPG_1462_NEW_BENCHMARK_WORLD = [
  "석등 골목. 비 온 뒤 돌바닥이 젖어 있다.",
  "골목 끝에 닫힌 철문이 있고, 맞은편에는 열린 찻집 문이 보인다.",
  "물리 법칙은 깨지지 않는다. 달은 하늘에만 있다.",
  "named NPC: 찻집 주인 이슬(짧게 말하고 잔을 닦는다), 골목 순찰 돌쇠(의심이 많다).",
].join("\n");

export const TRPG_1462_NEW_BENCHMARK_MEMORY = [
  "[TRPG STRUCTURED STATE — authoritative; do not contradict HP/items/location/flags]",
  "location=석등 골목",
].join("\n");

const EVEN_STATS = evenStats(DEFAULT_TRPG_STAT_DEFS);

export function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function apply1480LocationRule(system1465: string): string {
  if (!system1465.includes(TRPG_1462_OLD_LOCATION_RULES)) {
    throw new Error("1465 system is missing the old location Rules sentence");
  }
  if (system1465.includes(TRPG_1462_NEW_LOCATION_RULES)) {
    throw new Error("1465 system already has the 1480 location Rules sentence");
  }
  const next = system1465.replace(TRPG_1462_OLD_LOCATION_RULES, TRPG_1462_NEW_LOCATION_RULES);
  if (next === system1465) {
    throw new Error("1480 location Rules replacement did not change the system prompt");
  }
  return next;
}

type UserCaseId = "F" | "C" | "D";

function userCaseIdFor(requestId: Trpg1462NewBenchmarkRequestId): UserCaseId {
  switch (requestId) {
    case "A":
    case "B":
      return "F";
    case "C_1465":
    case "C_1480":
      return "C";
    case "D_1465":
    case "D_1480":
      return "D";
    default: {
      const _exhaustive: never = requestId;
      return _exhaustive;
    }
  }
}

function systemFor(requestId: Trpg1462NewBenchmarkRequestId, system1465: string, system1480: string): string {
  switch (requestId) {
    case "A":
    case "C_1465":
    case "D_1465":
      return system1465;
    case "B":
    case "C_1480":
    case "D_1480":
      return system1480;
    default: {
      const _exhaustive: never = requestId;
      return _exhaustive;
    }
  }
}

function frozenAction(caseId: UserCaseId): {
  body: string;
  needsCheck: false;
  checkReason: "no_meaningful_uncertainty" | "routine_traversal";
  d20: number;
  finalScore: number;
  dc: null;
  tier: null;
  statKey: "dex";
  statLabel: "민첩";
  statValue: number;
} {
  const shared = {
    needsCheck: false as const,
    d20: 10,
    finalScore: 10,
    dc: null,
    tier: null,
    statKey: "dex" as const,
    statLabel: "민첩" as const,
    statValue: EVEN_STATS.dex ?? 8,
  };
  switch (caseId) {
    case "F":
      return { ...shared, body: "달을 주머니에 넣는다.", checkReason: "no_meaningful_uncertainty" };
    case "C":
      return { ...shared, body: "열린 찻집 문으로 들어간다.", checkReason: "routine_traversal" };
    case "D":
      return { ...shared, body: "그 자리에 서서 골목 소리를 듣는다.", checkReason: "no_meaningful_uncertainty" };
    default: {
      const _exhaustive: never = caseId;
      return _exhaustive;
    }
  }
}

export function buildTrpg1462NewBenchmarkUser(caseId: UserCaseId): string {
  const action = frozenAction(caseId);
  return buildTrpgGmUserBlock({
    worldBrief: TRPG_1462_NEW_BENCHMARK_WORLD,
    memoryBlock: TRPG_1462_NEW_BENCHMARK_MEMORY,
    opening: false,
    genres: ["공포/추리"],
    playerPersonas: formatTrpgPlayerPersonaBlock(
      {
        personaId: 0,
        name: "한결",
        gender: "male",
        description: "말이 짧고 관찰이 앞선다.",
        speechExamples: "먼저 보고, 그다음에 움직인다.",
      },
      1
    ),
    sheetCanon: formatTrpgSheetCanon({
      defs: DEFAULT_TRPG_STAT_DEFS,
      sheets: [{ name: "한결", stats: EVEN_STATS }],
    }),
    localSceneDeltaContract: serializeLocalSceneDeltaContract(),
    actions: [
      {
        participantId: 1,
        name: "한결",
        body: action.body,
        participantKind: "human",
        needsCheck: action.needsCheck,
        checkReason: action.checkReason,
        statKey: action.statKey,
        statLabel: action.statLabel,
        statValue: action.statValue,
        d20: action.d20,
        finalScore: action.finalScore,
        dc: action.dc,
        tier: action.tier,
      },
    ],
  });
}

export type Trpg1462NewBenchmarkRequest = {
  id: Trpg1462NewBenchmarkRequestId;
  userCase: UserCaseId;
  systemSha256: string;
  userSha256: string;
  promptSha256: string;
  requestBodySha256: string;
  userChars: number;
  contract: ReturnType<typeof trpgProviderRequestContract>;
  model: string;
  temperature: unknown;
  stream: unknown;
  maxTokens: unknown;
  reasoningEffort: unknown;
};

export function assembleTrpg1462NewBenchmark(system1465: string = TRPG_GM_SYSTEM): {
  system1465: string;
  system1480: string;
  users: Record<UserCaseId, string>;
  requests: Record<Trpg1462NewBenchmarkRequestId, Trpg1462NewBenchmarkRequest>;
} {
  const system1480 = apply1480LocationRule(system1465);
  const users = {
    F: buildTrpg1462NewBenchmarkUser("F"),
    C: buildTrpg1462NewBenchmarkUser("C"),
    D: buildTrpg1462NewBenchmarkUser("D"),
  };
  const requests = {} as Record<Trpg1462NewBenchmarkRequestId, Trpg1462NewBenchmarkRequest>;
  for (const id of TRPG_1462_NEW_BENCHMARK_REQUEST_IDS) {
    const userCase = userCaseIdFor(id);
    const system = systemFor(id, system1465, system1480);
    const user = users[userCase];
    const request = buildTrpgGmProviderRequest({ system, user });
    const serialized = JSON.stringify(request.body);
    requests[id] = {
      id,
      userCase,
      systemSha256: sha256Utf8(system),
      userSha256: sha256Utf8(user),
      promptSha256: sha256Utf8(`${system}\n\n${user}`),
      requestBodySha256: sha256Utf8(serialized),
      userChars: user.length,
      contract: trpgProviderRequestContract(request.body),
      model: request.model,
      temperature: request.body.temperature,
      stream: request.body.stream,
      maxTokens: request.body.max_tokens,
      reasoningEffort: request.body.reasoning_effort,
    };
  }
  return { system1465, system1480, users, requests };
}

export const TRPG_1462_PINNED_REQUEST_HASHES: Record<
  Trpg1462NewBenchmarkRequestId,
  { promptSha256: string; requestBodySha256: string; userSha256: string }
> = {
  A: {
    promptSha256: "e37c1d45cf734aeaa9d7f08b973eb9c606c1ea2bd8a78fccd263b87d1ebbd3cf",
    requestBodySha256: "cf26e3598bbc360c7e247d7474e5e720a5f6c0b456bcf4395b264a17801b1bdb",
    userSha256: "b68dfc858da0fdcc60fec260cdec5f770d22c25041ce0ee62130094fb5a232b3",
  },
  B: {
    promptSha256: "add5dfa19870f2affe6739b6ded67f39cace965b27f66f05d4d49f11ac1b8ecd",
    requestBodySha256: "cf6047cb0b59d8e87413663e129c7047546caf399fa619e37a2b17d9a9cfb71c",
    userSha256: "b68dfc858da0fdcc60fec260cdec5f770d22c25041ce0ee62130094fb5a232b3",
  },
  C_1465: {
    promptSha256: "38fce07216c886cfbe745ef184dbb7dd88c4a65f83d262b2d6d3e2c98611d335",
    requestBodySha256: "def9bdc9f554b39390e5b3b57f9ed76c7bb88879a4e3e1903afd05a4f2946a01",
    userSha256: "1bf7e4f7a674cbea933fc4dcd8a26e39763064b762bcb630805f6e87f306386d",
  },
  C_1480: {
    promptSha256: "bcd09ec5051b6907cb5e6ace15fe9264d6342f0d3b57017e1bd8d34b024de326",
    requestBodySha256: "b706f8585ef120f70dd6b91c4dd603c18ab5d13f3e05497c2566aa39a249da76",
    userSha256: "1bf7e4f7a674cbea933fc4dcd8a26e39763064b762bcb630805f6e87f306386d",
  },
  D_1465: {
    promptSha256: "b9a5ab30667449ce86ead1c9439610c7d34409baa28abee0f049a63d264f10c2",
    requestBodySha256: "560b2f64161873ab54c18083fd82e175e078798a17b8ef25ab1999b07b1cc76e",
    userSha256: "971ce9aa140df5b210894ab84efea7216105d6ebf422139a3850dd3c3b2fe1d3",
  },
  D_1480: {
    promptSha256: "ca238304a7aa6f92451589cf3427268f2f02d97bb4254756deb7028559e124df",
    requestBodySha256: "8b29adbf4789c34daddc98e77277f8e5a7e9be3effad4e1b83c4271a40d7b7ce",
    userSha256: "971ce9aa140df5b210894ab84efea7216105d6ebf422139a3850dd3c3b2fe1d3",
  },
};

export function assertProductionGmContract(row: Trpg1462NewBenchmarkRequest): void {
  if (row.model !== TRPG_GM_MODEL) throw new Error(`model ${row.model}`);
  if (row.contract.model !== TRPG_GM_MODEL) throw new Error(`contract.model ${row.contract.model}`);
  if (row.temperature !== 0.7) throw new Error(`temperature ${String(row.temperature)}`);
  if (row.stream !== true) throw new Error("stream must be true");
  if (row.maxTokens !== TRPG_GM_MAX_TOKENS) throw new Error(`max_tokens ${String(row.maxTokens)}`);
  if (row.reasoningEffort !== "low") throw new Error(`reasoning_effort ${String(row.reasoningEffort)}`);
  if (row.contract.reasoningEffort !== "low") throw new Error("contract.reasoningEffort");
  if (row.contract.stream !== true) throw new Error("contract.stream");
}
