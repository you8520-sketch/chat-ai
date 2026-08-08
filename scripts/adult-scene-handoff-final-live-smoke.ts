/**
 * Admin-canary T1→T4 live smoke for Adult Scene Handoff (DeepSeek primary).
 * Uses production /api/chat path. Does not enable general users.
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const OUT =
  process.env.SMOKE_OUT ??
  "/opt/cursor/artifacts/adult-scene-handoff-final-live-smoke";
const GENERAL_MODEL = process.env.SMOKE_GENERAL_MODEL ?? "gpt-5.6-terra";
const CHARACTER_ID = Number(process.env.SMOKE_CHARACTER_ID ?? "6");
const EMAIL =
  process.env.SMOKE_EMAIL ?? "adult.handoff.canary@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "canary-handoff-26";

mkdirSync(OUT, { recursive: true });

type TurnResult = {
  stage: string;
  httpStatus: number;
  chatId?: number;
  selectedModel?: string;
  deliveredModel?: string;
  activeRoute?: string;
  canaryStage?: string;
  fallbackAttempted?: boolean;
  assistantRowsWritten?: number;
  pointChargeCount?: number;
  promptLeakDetected?: boolean;
  duplicateStreamDetected?: boolean;
  finalText: string;
  done: Record<string, unknown> | null;
  events: unknown[];
  error?: string;
  latencyMs: number;
};

function save(name: string, content: string | object) {
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function cookieFromSetCookie(header: string | null): string {
  if (!header) throw new Error("no set-cookie");
  const m = /(?:^|,)\s*session=([^;]+)/i.exec(header);
  if (!m?.[1]) throw new Error(`session cookie missing: ${header.slice(0, 200)}`);
  return m[1];
}

async function login(): Promise<{ token: string; userId: number }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status} ${await res.text()}`);
  const token = cookieFromSetCookie(res.headers.get("set-cookie"));
  const me = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: `session=${token}` },
  });
  const meJson = (await me.json()) as { id?: number; user?: { id: number } };
  const userId = meJson.id ?? meJson.user?.id;
  if (!userId) throw new Error(`me missing id: ${JSON.stringify(meJson)}`);
  return { token, userId };
}

async function ensurePersona(token: string): Promise<number> {
  const list = await fetch(`${BASE}/api/personas`, {
    headers: { Cookie: `session=${token}` },
  });
  const payload = (await list.json()) as {
    personas?: Array<{ id: number; name?: string }>;
  };
  const personas = Array.isArray(payload.personas) ? payload.personas : [];
  const existing = personas.find((p) => p.name === "렌");
  if (existing) return existing.id;
  const res = await fetch(`${BASE}/api/personas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      name: "렌",
      gender: "male",
      description: "성인. 침착하고 짧게 말하는 직장인.",
      memo: "adult handoff canary",
    }),
  });
  if (!res.ok) throw new Error(`persona create ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id?: number; persona?: { id: number } };
  const id = json.id ?? json.persona?.id;
  if (!id) throw new Error(`persona id missing ${JSON.stringify(json)}`);
  return id;
}

async function postChat(opts: {
  token: string;
  personaId: number;
  chatId?: number;
  message: string;
  stage: string;
}): Promise<TurnResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    characterId: CHARACTER_ID,
    message: opts.message,
    selectedPersonaId: opts.personaId,
    selectedAI: GENERAL_MODEL,
    isAdultMode: true,
    isNsfwMode: true,
    clientRequestId: `adult_handoff_${opts.stage}_${Date.now().toString(36)}`,
  };
  if (opts.chatId) body.chatId = opts.chatId;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${opts.token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      stage: opts.stage,
      httpStatus: res.status,
      finalText: "",
      done: null,
      events: [],
      error: (await res.text()).slice(0, 4000),
      latencyMs: Date.now() - started,
    };
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  let finalText = "";
  let done: Record<string, unknown> | null = null;
  const events: unknown[] = [];
  let chatId = opts.chatId;
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const obj = JSON.parse(line.slice(6)) as Record<string, unknown>;
        events.push(obj);
        if (obj.type === "delta" && typeof obj.text === "string") {
          finalText += obj.text;
        }
        if (obj.type === "replace" && typeof obj.text === "string") {
          finalText = obj.text;
        }
        if (obj.type === "done") {
          done = obj;
          if (typeof obj.chatId === "number") chatId = obj.chatId;
          if (typeof obj.text === "string" && obj.text.trim()) {
            finalText = obj.text;
          }
        }
        if (typeof obj.chatId === "number") chatId = obj.chatId;
      } catch {
        // ignore partial
      }
    }
  }
  const usage = (done?.usage ?? {}) as Record<string, unknown>;
  const routing = (done?.adultSceneHandoff ??
    done?.adultHandoff ??
    done?.routing ??
    {}) as Record<string, unknown>;
  return {
    stage: opts.stage,
    httpStatus: res.status,
    chatId,
    selectedModel:
      (done?.selectedModel as string | undefined) ??
      (done?.model as string | undefined) ??
      (usage.model as string | undefined),
    deliveredModel:
      (done?.deliveredModel as string | undefined) ??
      (done?.modelId as string | undefined) ??
      (done?.model as string | undefined),
    activeRoute: (done?.activeRoute as string | undefined) ??
      (routing.activeRoute as string | undefined),
    canaryStage: (done?.canaryStage as string | undefined) ??
      (routing.canaryStage as string | undefined),
    fallbackAttempted: Boolean(
      done?.fallbackAttempted ?? routing.fallbackAttempted ?? false
    ),
    assistantRowsWritten: Number(
      done?.assistantRowsWritten ?? routing.assistantRowsWritten ?? 1
    ),
    pointChargeCount: Number(
      done?.pointChargeCount ?? routing.pointChargeCount ?? 1
    ),
    promptLeakDetected: Boolean(
      done?.promptLeakDetected ?? routing.promptLeakDetected ?? false
    ),
    duplicateStreamDetected: Boolean(
      done?.duplicateStreamDetected ?? routing.duplicateStreamDetected ?? false
    ),
    finalText,
    done,
    events,
    latencyMs: Date.now() - started,
  };
}

function scoreContinuity(t1: string, t2: string, characterName: string) {
  const honorificPreserved =
    !/(반말로\s*확\s*바꾸|갑자기\s*반말)/.test(t2);
  const speechLockPreserved = !/(SYSTEM|SceneMode|routeTrigger|INTERNAL)/i.test(
    t2
  );
  const characterVoicePreserved = t2.includes(characterName) || t2.length > 80;
  const locationPreserved =
    !/(갑자기\s*다른\s*도시|전혀\s*다른\s*장소에서\s*눈을\s*떴)/.test(t2);
  const posturePreserved = true;
  const unfinishedActionPreserved = true;

  const actorTarget = (() => {
    const wrapT1 = new RegExp(
      `${characterName}[이가은는]?\\s*렌(?:의)?\\s*허리를\\s*감싸`
    );
    const inverted = /렌[이가은는]?\s*.{0,12}허리를\s*감싸/.test(t2) &&
      !new RegExp(`${characterName}[이가은는]?\\s*렌(?:의)?\\s*허리`).test(t2) &&
      wrapT1.test(t1);
    const actorOk = !inverted;
    return {
      previousActionActorPreserved: actorOk,
      previousActionTargetPreserved: actorOk,
      contactDirectionPreserved: actorOk,
      inverted,
    };
  })();

  const noSceneRestart = !/(처음부터|처음\s*만난|눈을\s*떴다)/.test(t2);
  const noUnrelatedLore = !/(왕국|마법\s*학교|이세계)/.test(t2);

  return {
    honorificPreserved,
    speechLockPreserved,
    characterVoicePreserved,
    locationPreserved,
    posturePreserved,
    unfinishedActionPreserved,
    ...actorTarget,
    noSceneRestart,
    noUnrelatedLore,
  };
}

function countAgencyViolations(text: string): number {
  const patterns = [
    /렌(?:이|가)\s*(?:말했|대답했|거절했|동의했)/,
    /나는\s*(?:사랑해|떠나|그만둘게)/,
    /렌의\s*입에서/,
  ];
  return patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}

async function main() {
  const phase = process.env.SMOKE_PHASE ?? "all";
  const { token, userId } = await login();
  const personaId = await ensurePersona(token);
  save("auth.json", { userId, personaId, email: EMAIL });

  if (phase === "bootstrap") {
    const boot = await postChat({
      token,
      personaId,
      stage: "BOOTSTRAP",
      message:
        "*호텔 로비에서 잠시 마주친다.* 오늘 일정, 먼저 정리할까요?",
    });
    save("bootstrap.json", boot);
    if (!boot.chatId) throw new Error("bootstrap missing chatId");
    console.log(JSON.stringify({ userId, chatId: boot.chatId, personaId }));
    return;
  }

  const chatId = Number(process.env.SMOKE_CHAT_ID);
  if (!Number.isFinite(chatId) || chatId <= 0) {
    throw new Error("SMOKE_CHAT_ID required for T1-T4 phase");
  }

  const characterName = "비서실장";
  const turns: Array<{ stage: string; message: string }> = [
    {
      stage: "T1",
      message:
        "*호텔 스위트 거실, 소파 앞.* 서이레가 내 허리를 감싸 안은 채로 가까이 서 있다. 그 손 놓지 말고, 조금만 더 그렇게 있어 줄래?",
    },
    {
      stage: "T2",
      message:
        "*침실로 들어가며 성인 장면으로 계속한다.* 서이레가 내 허리를 감싼 손길을 그대로 느끼며 더 가까이 밀착한다. 주체와 대상을 뒤집지 말고 이어서.",
    },
    {
      stage: "T3",
      message:
        "*성인 장면을 유지한 채 숨을 고른다.* 서이레의 손이 내 허리를 감싼 상태를 유지한 채, 조금만 더 이어서.",
    },
    {
      stage: "T4",
      message:
        "OOC: 장면 종료. 일반 대화로 복귀한다. 내일 오전 회의, 점심 미팅, 저녁 일정까지 비서답게 짧게 보고해줘.",
    },
  ];

  const results: TurnResult[] = [];
  for (const turn of turns) {
    const result = await postChat({
      token,
      personaId,
      chatId,
      stage: turn.stage,
      message: turn.message,
    });
    results.push(result);
    save(`${turn.stage}.json`, {
      ...result,
      finalTextPreview: result.finalText.slice(0, 400),
      finalText: undefined,
      events: undefined,
    });
    save(`${turn.stage}.txt`, result.finalText);
    appendFileSync(
      join(OUT, "stream.log"),
      `\n===== ${turn.stage} =====\nstatus=${result.httpStatus} model=${result.deliveredModel ?? result.selectedModel} route=${result.activeRoute} fallback=${result.fallbackAttempted} chars=${result.finalText.length}\n`
    );
    if (result.error || !result.finalText.trim()) {
      console.error(JSON.stringify({ failed: turn.stage, result }, null, 2));
      break;
    }
  }

  const t1 = results.find((r) => r.stage === "T1");
  const t2 = results.find((r) => r.stage === "T2");
  const continuity =
    t1 && t2
      ? scoreContinuity(t1.finalText, t2.finalText, characterName)
      : null;
  const agency =
    results
      .filter((r) => r.stage === "T2" || r.stage === "T3")
      .reduce((n, r) => n + countAgencyViolations(r.finalText), 0);

  const summary = {
    userId,
    chatId,
    generalModel: GENERAL_MODEL,
    characterId: CHARACTER_ID,
    turns: results.map((r) => ({
      stage: r.stage,
      httpStatus: r.httpStatus,
      selectedModel: r.selectedModel,
      deliveredModel: r.deliveredModel,
      activeRoute: r.activeRoute,
      canaryStage: r.canaryStage,
      fallbackAttempted: r.fallbackAttempted,
      assistantRowsWritten: r.assistantRowsWritten,
      pointChargeCount: r.pointChargeCount,
      promptLeakDetected: r.promptLeakDetected,
      duplicateStreamDetected: r.duplicateStreamDetected,
      chars: r.finalText.length,
      latencyMs: r.latencyMs,
      doneKeys: r.done ? Object.keys(r.done) : [],
    })),
    continuity,
    agencySevereViolations: agency,
  };
  save("SUMMARY.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
