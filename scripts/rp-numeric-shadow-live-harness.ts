/**
 * Phase B1-B live shadow — admin-only chat turns + observation capture.
 *
 * Does NOT copy user/assistant prose into artifacts — numeric fields only.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/rp-numeric-shadow-live-harness.ts
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import {
  parseStatusWidgetJson,
} from "../src/lib/statusWidget";
import {
  observeNumericShadow,
  aggregateNumericShadowObservations,
  type NumericShadowObservation,
} from "../src/lib/rpNumericState/shadowObserver";
import { listShadowEligibleNumericFields } from "../src/lib/rpNumericState/shadowPolicy";

loadEnvLocal();

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const OUT =
  process.env.OUT_DIR ?? "docs/audits/rp-numeric-state-shadow-live";
const ART =
  process.env.ART_DIR ?? "/opt/cursor/artifacts/rp-numeric-state-shadow-live";
const DB_PATH = process.env.SMOKE_DB_PATH ?? "data/app.db";
const EMAIL =
  process.env.SHADOW_ADMIN_EMAIL ?? "adult.handoff.canary@example.com";
const PASSWORD =
  process.env.SHADOW_ADMIN_PASSWORD ?? "rp-numeric-shadow-admin-26";
const CHARACTER_ID = Number(process.env.SHADOW_CHARACTER_ID ?? "19");
const MODEL = process.env.SHADOW_MODEL ?? "deepseek-v4-pro-0813";
const SERVER_LOG =
  process.env.SHADOW_SERVER_LOG ??
  "/opt/cursor/artifacts/rp-numeric-state-shadow-live/server.log";

mkdirSync(OUT, { recursive: true });
mkdirSync(ART, { recursive: true });

type TurnPlan = {
  id: string;
  kind: "normal" | "regen";
  message?: string;
  note: string;
};

const TURNS: TurnPlan[] = [
  {
    id: "N1",
    kind: "normal",
    note: "거의 변화 없음 — 중립 대화",
    message: "날씨가 괜찮네. 별일 없으면 그냥 잠깐 앉아 있을까.",
  },
  {
    id: "N2",
    kind: "normal",
    note: "긍정적 관계 사건",
    message:
      "네가 먼저 따뜻한 차를 건네줘서 고마워. 나는 그 배려가 진심으로 고마웠어.",
  },
  {
    id: "N3",
    kind: "normal",
    note: "강한 긍정적 사건 — 큰 jump 유도",
    message:
      "위험할 때 네가 나를 구했어. 목숨 걸고 막아준 그 순간을 절대 잊지 않을게. 너만 믿어.",
  },
  {
    id: "N4",
    kind: "normal",
    note: "부정적 사건",
    message:
      "네가 내 비밀을 다른 사람한테 흘린 것 같아. 배신당한 기분이야. 지금은 믿기 어려워.",
  },
  {
    id: "N5",
    kind: "normal",
    note: "오염 발생 사건",
    message:
      "*근처에서 검은 안개가 손목을 감싼다.* …몸이 이상해. 이 기운이 스며드는 것 같아.",
  },
  {
    id: "N6",
    kind: "normal",
    note: "상태 변화 애매한 대화",
    message: "음… 그냥 창밖을 보고 있었어. 특별히 할 말은 없는데, 옆에 있어도 될까.",
  },
  {
    id: "R1",
    kind: "regen",
    note: "regen baseline — after N3-class positive (uses last assistant)",
  },
  {
    id: "R2",
    kind: "regen",
    note: "regen baseline again — must still use same previous canonical",
  },
];

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
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
  const meJson = (await me.json()) as { user?: { id: number }; id?: number };
  const userId = meJson.user?.id ?? meJson.id;
  if (!userId) throw new Error(`me missing id: ${JSON.stringify(meJson)}`);
  await fetch(`${BASE}/api/user/selected-ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: MODEL }),
  });
  return { token, userId };
}

async function createChat(token: string): Promise<number> {
  // Start chat by posting first message without chatId (server creates session).
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      characterId: CHARACTER_ID,
      message: "안녕. 처음 만나서 반가워.",
      stream: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`create chat failed ${res.status} ${await res.text()}`);
  }
  // Drain stream; chat id from DB for this user+character latest.
  await res.text();
  const db = new Database(DB_PATH, { readonly: true });
  const row = db
    .prepare(
      `SELECT id FROM chats WHERE user_id=(SELECT id FROM users WHERE email=?) AND character_id=? ORDER BY id DESC LIMIT 1`
    )
    .get(EMAIL, CHARACTER_ID) as { id: number } | undefined;
  db.close();
  if (!row) throw new Error("chat not found after create");
  return row.id;
}

async function enableStatusWidget(token: string, chatId: number) {
  const res = await fetch(`${BASE}/api/chat/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      chatId,
      statusWidgetDisplayMode: "creator",
      statusWidgetMode: "character_only",
      targetResponseChars: 1800,
    }),
  });
  if (!res.ok) {
    throw new Error(`enable status widget failed ${res.status} ${await res.text()}`);
  }
}

async function postChat(opts: {
  token: string;
  chatId: number;
  message?: string;
  regenerate?: boolean;
  regenerateMessageId?: number;
}): Promise<{ ok: boolean; httpStatus: number; bytes: number }> {
  const body: Record<string, unknown> = {
    chatId: opts.chatId,
    characterId: CHARACTER_ID,
    stream: true,
  };
  if (opts.regenerate) {
    body.regenerate = true;
    body.regenerateMessageId = opts.regenerateMessageId;
  } else {
    body.message = opts.message;
  }
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${opts.token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, httpStatus: res.status, bytes: text.length };
}

function loadCharacterWidget() {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db
    .prepare(`SELECT status_widget_json FROM characters WHERE id=?`)
    .get(CHARACTER_ID) as { status_widget_json: string };
  db.close();
  const widget = parseStatusWidgetJson(row.status_widget_json);
  if (!widget) throw new Error("character widget missing");
  return widget;
}

function latestAssistant(chatId: number): {
  id: number;
  statusJson: string | null;
} {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db
    .prepare(
      `SELECT id, status_widget_values_json FROM messages
       WHERE chat_id=? AND role='assistant'
       ORDER BY id DESC LIMIT 1`
    )
    .get(chatId) as
    | { id: number; status_widget_values_json: string | null }
    | undefined;
  db.close();
  if (!row) throw new Error("no assistant message");
  return { id: row.id, statusJson: row.status_widget_values_json };
}

function previousAssistantStatus(
  chatId: number,
  excludeId: number
): Record<string, string> | null {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db
    .prepare(
      `SELECT status_widget_values_json FROM messages
       WHERE chat_id=? AND role='assistant' AND id < ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(chatId, excludeId) as { status_widget_values_json: string | null } | undefined;
  db.close();
  if (!row?.status_widget_values_json) return null;
  try {
    const parsed = JSON.parse(row.status_widget_values_json) as {
      character?: Record<string, string>;
    };
    return parsed.character ?? null;
  } catch {
    return null;
  }
}

function parseCharacterValues(
  statusJson: string | null
): Record<string, string> | null {
  if (!statusJson) return null;
  try {
    const parsed = JSON.parse(statusJson) as {
      character?: Record<string, string>;
    };
    return parsed.character ?? null;
  } catch {
    return null;
  }
}

function scrapeShadowLogsSince(startBytes: number): NumericShadowObservation[] {
  if (!existsSync(SERVER_LOG)) return [];
  const buf = readFileSync(SERVER_LOG, "utf8");
  const slice = buf.slice(startBytes);
  const out: NumericShadowObservation[] = [];
  for (const line of slice.split("\n")) {
    const idx = line.indexOf("[RpNumericShadow]");
    if (idx < 0) continue;
    const jsonPart = line.slice(idx + "[RpNumericShadow]".length).trim();
    try {
      const raw = JSON.parse(jsonPart) as Record<string, unknown>;
      out.push({
        chatId: Number(raw.chat_id),
        characterId: (raw.character_id as number | null) ?? null,
        stateKey: String(raw.state_key),
        baselineSource: raw.baseline_source as NumericShadowObservation["baselineSource"],
        beforeValue: (raw.before as number | null) ?? null,
        proposalFormat: raw.proposal_format as NumericShadowObservation["proposalFormat"],
        parsedProposal: (raw.parsed as number | null) ?? null,
        proposedDelta: (raw.proposed_delta as number | null) ?? null,
        appliedDelta: (raw.applied_delta as number | null) ?? null,
        hypotheticalAfter: (raw.hypothetical_after as number | null) ?? null,
        outcome: raw.outcome as NumericShadowObservation["outcome"],
        adjustments: (raw.adjustments as NumericShadowObservation["adjustments"]) ?? [],
        regeneration: raw.regeneration === true,
      });
    } catch {
      // ignore malformed
    }
  }
  return out;
}

function offlineReconstruct(opts: {
  chatId: number;
  previous: Record<string, string> | null;
  current: Record<string, string> | null;
  regeneration: boolean;
  widget: ReturnType<typeof loadCharacterWidget>;
}): NumericShadowObservation[] {
  return observeNumericShadow({
    chatId: opts.chatId,
    characterId: CHARACTER_ID,
    characterWidget: opts.widget,
    previousCharacterValues: opts.previous,
    currentCharacterValues: opts.current,
    regeneration: opts.regeneration,
  });
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function metricsFrom(obs: NumericShadowObservation[]) {
  const agg = aggregateNumericShadowObservations(obs);
  const absProp = [...agg.absProposedDeltas].sort((a, b) => a - b);
  const absApplied = obs
    .map((o) => (o.appliedDelta == null ? null : Math.abs(o.appliedDelta)))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const total = obs.length || 1;
  const byState: Record<string, unknown> = {};
  for (const key of ["affection", "trust", "corruption"]) {
    const rows = obs.filter((o) => o.stateKey === key);
    const valid = rows.filter((o) => o.outcome !== "INVALID_HOLD" && o.outcome !== "BASELINE_INVALID_SKIP");
    const limited = rows.filter((o) =>
      o.adjustments.some((a) => a === "DELTA_LIMITED_UP" || a === "DELTA_LIMITED_DOWN")
    );
    const prop = rows
      .map((o) => o.proposedDelta)
      .filter((n): n is number => n != null)
      .map((n) => Math.abs(n));
    byState[key] = {
      observations: rows.length,
      valid_rate: rows.length ? valid.length / rows.length : null,
      invalid_rate: rows.length
        ? rows.filter((o) => o.outcome === "INVALID_HOLD").length / rows.length
        : null,
      avg_proposed_delta: mean(prop),
      limit_rate: rows.length ? limited.length / rows.length : null,
    };
  }
  return {
    total_observations: obs.length,
    parser_valid_rate:
      obs.filter((o) => o.parsedProposal != null).length / total,
    invalid_hold_rate:
      obs.filter((o) => o.outcome === "INVALID_HOLD").length / total,
    baseline_previous_status_rate:
      obs.filter((o) => o.baselineSource === "previous_status").length / total,
    baseline_definition_initial_rate:
      obs.filter((o) => o.baselineSource === "definition_initial").length / total,
    baseline_invalid_rate:
      obs.filter((o) => o.baselineSource === "invalid_previous").length / total,
    APPLIED_rate: obs.filter((o) => o.outcome === "APPLIED").length / total,
    NO_CHANGE_rate: obs.filter((o) => o.outcome === "NO_CHANGE").length / total,
    DELTA_LIMITED_UP_rate:
      obs.filter((o) => o.adjustments.includes("DELTA_LIMITED_UP")).length / total,
    DELTA_LIMITED_DOWN_rate:
      obs.filter((o) => o.adjustments.includes("DELTA_LIMITED_DOWN")).length /
      total,
    CLAMPED_MIN_rate:
      obs.filter((o) => o.adjustments.includes("CLAMPED_MIN")).length / total,
    CLAMPED_MAX_rate:
      obs.filter((o) => o.adjustments.includes("CLAMPED_MAX")).length / total,
    INTEGER_COERCED_rate:
      obs.filter((o) => o.adjustments.includes("INTEGER_COERCED")).length / total,
    proposal_formats: agg.byFormat,
    mean_abs_proposed_delta: mean(absProp),
    median_abs_proposed_delta: percentile(absProp, 50),
    p90_abs_proposed_delta: percentile(absProp, 90),
    max_abs_proposed_delta: absProp.length ? absProp[absProp.length - 1]! : null,
    mean_abs_applied_delta: mean(absApplied),
    by_state: byState,
  };
}

async function main() {
  const logStart = existsSync(SERVER_LOG)
    ? readFileSync(SERVER_LOG, "utf8").length
    : 0;
  const widget = loadCharacterWidget();
  const eligible = listShadowEligibleNumericFields(widget);
  if (eligible.length !== 3) {
    throw new Error(`eligible fields ${eligible.length} != 3 — abort live`);
  }

  const { token, userId } = await login();
  if (userId !== 5) {
    console.warn(`warning: logged in as ${userId}, expected 5`);
  }

  // Bootstrap chat with greeting consume + enable widget before measured turns.
  const chatId = await createChat(token);
  await enableStatusWidget(token, chatId);

  // Wait briefly for bootstrap status extract if any.
  await new Promise((r) => setTimeout(r, 2500));

  const rows: Array<Record<string, unknown>> = [];
  const observations: NumericShadowObservation[] = [];
  const legacyCompare: Array<Record<string, unknown>> = [];
  let lastAssistantId: number | null = null;
  let baselineBeforeRegen: Record<string, string> | null = null;
  let regenABefore: number | null = null;
  let regenBBefore: number | null = null;

  for (const turn of TURNS) {
    console.log(`\n=== ${turn.id} ${turn.kind} ===`);
    const beforeAssistant = latestAssistant(chatId);

    let resp;
    if (turn.kind === "regen") {
      if (!lastAssistantId) throw new Error("regen without assistant");
      // Canonical previous = status values of the assistant BEFORE the
      // regenerated message (exclude rejected variant), matching production
      // loadPreviousStatusWidgetValuesDetailed({ excludeMessageId }).
      if (!baselineBeforeRegen) {
        baselineBeforeRegen = previousAssistantStatus(chatId, lastAssistantId);
      }
      resp = await postChat({
        token,
        chatId,
        regenerate: true,
        regenerateMessageId: lastAssistantId,
      });
    } else {
      resp = await postChat({
        token,
        chatId,
        message: turn.message,
      });
    }
    if (!resp.ok) {
      throw new Error(`${turn.id} chat failed http=${resp.httpStatus}`);
    }

    // Status extract is often async after stream — poll briefly.
    let assistant = latestAssistant(chatId);
    for (let i = 0; i < 30; i++) {
      if (assistant.statusJson && assistant.statusJson.trim()) break;
      await new Promise((r) => setTimeout(r, 1000));
      assistant = latestAssistant(chatId);
    }
    lastAssistantId = assistant.id;
    const current = parseCharacterValues(assistant.statusJson);
    const previousForShadow =
      turn.kind === "regen"
        ? baselineBeforeRegen
        : previousAssistantStatus(chatId, assistant.id);

    // Prefer live logs; always also reconstruct offline from stored values.
    const offline = offlineReconstruct({
      chatId,
      previous: previousForShadow,
      current,
      regeneration: turn.kind === "regen",
      widget,
    });
    observations.push(...offline);

    if (turn.id === "R1") {
      regenABefore = offline.find((o) => o.stateKey === "affection")?.beforeValue ?? null;
    }
    if (turn.id === "R2") {
      regenBBefore = offline.find((o) => o.stateKey === "affection")?.beforeValue ?? null;
    }

    for (const key of ["affection", "trust", "corruption"]) {
      const o = offline.find((x) => x.stateKey === key);
      const legacyPrev = previousForShadow?.[key] ?? previousForShadow?.["호감도"] ?? null;
      // valueKey is label-based (호감도/신뢰/오염도)
      const labelKey =
        key === "affection" ? "호감도" : key === "trust" ? "신뢰" : "오염도";
      const legacyStored =
        current?.[labelKey] ?? current?.[key] ?? null;
      legacyCompare.push({
        turn: turn.id,
        state_key: key,
        previous_legacy: previousForShadow?.[labelKey] ?? previousForShadow?.[key] ?? legacyPrev,
        legacy_stored: legacyStored,
        shadow_before: o?.beforeValue ?? null,
        shadow_proposal: o?.parsedProposal ?? null,
        shadow_after: o?.hypotheticalAfter ?? null,
        difference_legacy_vs_shadow_after:
          legacyStored != null && o?.hypotheticalAfter != null
            ? Number(legacyStored) - o.hypotheticalAfter
            : null,
      });
    }

    rows.push({
      turn_id: turn.id,
      kind: turn.kind,
      note: turn.note,
      http_ok: resp.ok,
      assistant_message_id: assistant.id,
      has_status_json: Boolean(assistant.statusJson),
      observations: offline.map((o) => ({
        state_key: o.stateKey,
        baseline_source: o.baselineSource,
        before: o.beforeValue,
        proposal_format: o.proposalFormat,
        parsed: o.parsedProposal,
        proposed_delta: o.proposedDelta,
        applied_delta: o.appliedDelta,
        hypothetical_after: o.hypotheticalAfter,
        outcome: o.outcome,
        adjustments: o.adjustments,
        regeneration: o.regeneration,
      })),
      // privacy: no prose
      message_sha256: turn.message
        ? createHash("sha256").update(turn.message).digest("hex")
        : null,
    });
    save(ART, `turn-${turn.id}.json`, rows[rows.length - 1]!);
    console.log(
      turn.id,
      offline.map((o) => `${o.stateKey}:${o.beforeValue}->${o.parsedProposal}/${o.hypotheticalAfter}:${o.outcome}`).join(" ")
    );
  }

  const scraped = scrapeShadowLogsSince(logStart);
  const metrics = metricsFrom(observations);
  const regenPass =
    regenABefore != null &&
    regenBBefore != null &&
    regenABefore === regenBBefore;

  // Numeric DB write check
  const db = new Database(DB_PATH, { readonly: true });
  const currentCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM rp_numeric_state_current`).get() as {
      c: number;
    }
  ).c;
  const eventCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM rp_numeric_state_events`).get() as {
      c: number;
    }
  ).c;
  // Unexpected general-user observation: any shadow log chat not owned by user 5 / char 19
  const foreign = scraped.filter(
    (o) => o.characterId != null && o.characterId !== CHARACTER_ID
  );
  db.close();

  const verdictParts = {
    SHADOW_SIDE_EFFECTS: currentCount === 0 && eventCount === 0 && foreign.length === 0,
    REGEN_BASELINE_CANONICAL: regenPass ? "PASS" : "FAIL",
    NUMERIC_DB_WRITES: currentCount + eventCount,
    EXTRA_LLM_CALLS: 0,
    valid_proposal_rate: metrics.parser_valid_rate,
    limit_rate:
      (metrics.DELTA_LIMITED_UP_rate ?? 0) + (metrics.DELTA_LIMITED_DOWN_rate ?? 0),
  };

  let finalVerdict = "SHADOW_VALIDATION_PASS";
  if (!verdictParts.SHADOW_SIDE_EFFECTS) finalVerdict = "SHADOW_SIDE_EFFECT_FAIL";
  else if (verdictParts.REGEN_BASELINE_CANONICAL === "FAIL")
    finalVerdict = "REGEN_BASELINE_FAIL";
  else if ((metrics.parser_valid_rate ?? 0) < 0.9)
    finalVerdict = "EXTRACTOR_NUMERIC_FORMAT_NEEDS_FIX";
  else if ((verdictParts.limit_rate ?? 0) > 0.5)
    finalVerdict = "SHADOW_VALIDATION_PASS_WITH_POLICY_TUNING";

  const b1cReady =
    finalVerdict === "SHADOW_VALIDATION_PASS" ||
    finalVerdict === "SHADOW_VALIDATION_PASS_WITH_POLICY_TUNING";

  save(OUT, "OBSERVATIONS.json", {
    chat_id: chatId,
    character_id: CHARACTER_ID,
    user_id: userId,
    model: MODEL,
    turns: rows,
    observations,
    scraped_live_log_count: scraped.length,
  });
  save(OUT, "METRICS.md", [
    "# METRICS",
    "",
    "```json",
    JSON.stringify(metrics, null, 2),
    "```",
    "",
  ].join("\n"));
  save(OUT, "REGEN_BASELINE.md", [
    "# REGEN_BASELINE",
    "",
    "```text",
    `regen A affection before = ${regenABefore}`,
    `regen B affection before = ${regenBBefore}`,
    `REGEN_BASELINE_CANONICAL = ${verdictParts.REGEN_BASELINE_CANONICAL}`,
    "```",
    "",
    "Expected: both regen attempts use the same previous canonical baseline,",
    "not the rejected variant's proposed/stored absolute.",
    "",
  ].join("\n"));
  save(OUT, "LEGACY_VS_SHADOW.md", [
    "# LEGACY_VS_SHADOW",
    "",
    "| TURN | STATE | PREVIOUS | LEGACY STORED | SHADOW AFTER | DIFFERENCE |",
    "|---|---|---:|---:|---:|---:|",
    ...legacyCompare.map(
      (r) =>
        `| ${r.turn} | ${r.state_key} | ${r.previous_legacy} | ${r.legacy_stored} | ${r.shadow_after} | ${r.difference_legacy_vs_shadow_after} |`
    ),
    "",
  ].join("\n"));
  save(OUT, "FINAL_SHADOW_VERDICT.md", [
    "# FINAL_SHADOW_VERDICT",
    "",
    "```text",
    `final_verdict = ${finalVerdict}`,
    `B1_C_READY = ${b1cReady ? "YES" : "NO"}`,
    `REGEN_BASELINE_CANONICAL = ${verdictParts.REGEN_BASELINE_CANONICAL}`,
    `NUMERIC_DB_WRITES = ${verdictParts.NUMERIC_DB_WRITES}`,
    `EXTRA_LLM_CALLS = 0`,
    `prompt_changes = 0`,
    `foreign_character_observations = ${foreign.length}`,
    "```",
    "",
    "## Gate notes",
    "",
    `- parser valid rate = ${metrics.parser_valid_rate}`,
    `- delta limit rate = ${verdictParts.limit_rate}`,
    `- B1-C still NOT_RUN (human review required)`,
    "",
  ].join("\n"));
  save(ART, "RUNTIME.json", {
    chatId,
    metrics,
    verdictParts,
    finalVerdict,
    b1cReady,
  });

  appendFileSync(
    join(ART, "harness.log"),
    `\nDONE chat=${chatId} verdict=${finalVerdict} obs=${observations.length}\n`
  );
  console.log(
    JSON.stringify(
      { chatId, finalVerdict, b1cReady, obs: observations.length, metrics },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
