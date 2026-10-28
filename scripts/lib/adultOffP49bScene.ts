/**
 * P4-9B isolated scene for the existing Adult OFF live runner.
 * One Cheaper Inference gpt-6.1-sol turn plus the official OpenAI gpt-6-luna
 * checks that turn already makes. No output cap is added. The paid call runs
 * only after this process recomputes a combined ceiling at or under KRW 2,500.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAdultOffLiveCapture,
  type MeasuredLedgerRow,
} from "./adultOffGuardLiveCapture";
import {
  checkMessageApiResponse,
  reconstructScreenText,
  reconstructScreenTimeline,
  screenBeforeAndAfter,
} from "./adultOffGuardEvidence";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "../../src/lib/test/isolatedTestDatabase";
import { listOpenTurnTailWork } from "../../src/lib/turnTailWork";

const CHARACTER_ID = 50;
const USER_ID = 1;
const PERSONA_ID = 1;
const LOREBOOK_ID = 13;
const MODEL_ID = "gpt-6.1-sol";
const BUDGET_KRW = 2500;
const MAX_OUTPUT_TOKENS = 128_000;
const INPUT_TOKENS_PER_CHAR_UPPER = 2;
const OUTPUT_CHARS_PER_TOKEN_UPPER = 4;
const FX_BUFFER = 1.02;
const FULL_LENGTH_CLASSIFIER_CANDIDATES = 3;
const SHORT_AUX_CLASSIFIER_CALLS = 2;
const CLASSIFIER_OUTPUT_TOKENS = 200;
const OFFICIAL_LUNA_INPUT_USD_PER_M = 0.1;
const OFFICIAL_LUNA_OUTPUT_USD_PER_M = 0.5;
const OFFICIAL_LUNA_CACHE_WRITE_USD_PER_M = 0.125;
const GREETING_SHA256 = "ec730fe0820bef0fcdab9c2f15c6c1c56f204a0548298a27f1ea2192a3d1239b";
const PERSONA_SHA256 = "9ef42c7f92091ca158a53c4321b06dab4e687d3a882210c4a576e87029703a36";
const USER_MESSAGE_SHA256 = "c810149a53ec8060380faef8ffb3b439386fc0b0db92315cf159b2254cb3c664";
const LOREBOOK_ENTRY_KEY = "mercator_exchange_underworld";
const UNBOUNDED_BACKGROUND =
  /background-memory|background-lorebook-compact|background-status-meta-extract|background-suggested-replies-extract|background-status-widget-extract/i;

type DryCall = { url: string; model: string; chars: number; systemSha256: string | null };

function collectJsonStrings(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => collectJsonStrings(item)).join("\n");
  if (value && typeof value === "object") return Object.values(value).map((item) => collectJsonStrings(item)).join("\n");
  return "";
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

function columnSet(db: { prepare: (sql: string) => { all: () => Array<{ name: string }> } }, table: string): Set<string> {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function insertPresent(
  db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } },
  table: string,
  columns: Set<string>,
  row: Record<string, unknown>
): void {
  const entries = Object.entries(row).filter(([key, value]) => columns.has(key) && value !== undefined);
  const sql = `INSERT INTO ${table} (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`;
  db.prepare(sql).run(...entries.map(([, value]) => value));
}

export type P49bDeps = {
  setSessionToken: (token: string) => void;
  realFetch: typeof fetch;
  restoreModuleLoad: () => void;
};

export async function runAdultOffP49bScene(deps: P49bDeps): Promise<void> {
  const evidenceDir = process.env.LIVE_MEASURE_EVIDENCE_DIR?.trim();
  if (!evidenceDir) throw new Error("LIVE_MEASURE_EVIDENCE_DIR is required for scene p49b");
  const evidenceOut = process.env.LIVE_MEASURE_EVIDENCE_OUT?.trim() || evidenceDir;
  const execute = process.env.LIVE_MEASURE_EXECUTE === "1";
  delete process.env.MOCK_MODE;
  process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "1";
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim() || !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("CHEAPER_INFERENCE_API_KEY and OPENAI_API_KEY are required before the p49b probe");
  }

  installIsolatedTestDatabase();
  const fx = await loadFx(deps.realFetch);
  const scene = loadScene(evidenceDir);
  const lore = loadLorebookEntry();
  const modules = await loadModules();
  const keywordStop = assertKeywordScope(modules, scene, lore);
  const db = modules.dbMod.getDb();
  seedScene(db, modules, scene, lore);
  deps.setSessionToken(modules.auth.createSession(USER_ID));
  const room = readRoomDefaults(db, modules);

  const dryCalls: DryCall[] = [];
  let lorebookInjected = false;
  let personaInjected = false;
  let greetingInjected = false;
  let userMessageInjected = false;
  let selectedChunksInWire = 0;
  const selectedChunkContents = loadSelectedChunkContents(evidenceDir);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!/openai\.com|openrouter\.ai|cheaperinference/i.test(url)) return deps.realFetch(input, init);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    let model = "";
    let system = "";
    try {
      const body = JSON.parse(bodyText) as { model?: unknown; messages?: Array<{ role?: string; content?: unknown }> };
      model = String(body.model ?? "");
      const systemMessage = body.messages?.find((message) => message.role === "system");
      system = typeof systemMessage?.content === "string" ? systemMessage.content : JSON.stringify(systemMessage?.content ?? "");
      const wireText = collectJsonStrings(body);
      if (model === MODEL_ID && wireText.includes(lore.content)) lorebookInjected = true;
      if (model === MODEL_ID && wireText.includes(scene.personaDescription)) personaInjected = true;
      if (model === MODEL_ID && wireText.includes(scene.greeting)) greetingInjected = true;
      if (model === MODEL_ID && wireText.includes(scene.userMessage)) userMessageInjected = true;
      if (model === MODEL_ID) {
        selectedChunksInWire = selectedChunkContents.filter((content) => wireText.includes(content)).length;
      }
    } catch {
      /* recorded as an unparsed provider call */
    }
    dryCalls.push({ url, model, chars: bodyText.length, systemSha256: system ? sha256(system) : null });
    return new Response(JSON.stringify({ error: { message: "p49b dry estimate" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const dryChatId = modules.session.createChatSession({
    userId: USER_ID,
    characterId: CHARACTER_ID,
    greeting: scene.greeting,
    mode: "safe",
    selectedPersonaId: PERSONA_ID,
    adultHandoffEnabled: false,
    __testOnGreetingSchedule: () => {},
  });
  const dryResponse = await modules.route.POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: CHARACTER_ID,
        chatId: dryChatId,
        message: scene.userMessage,
        clientRequestId: `p49b-dry-${Date.now()}`,
      }),
    })
  );
  await dryResponse.text();
  const mainCalls = dryCalls.filter((call) => call.model === MODEL_ID);
  const injected = lorebookInjected && personaInjected && greetingInjected && userMessageInjected;
  const ceiling = buildCeiling({
    fx,
    mainBodyChars: mainCalls.reduce((max, call) => Math.max(max, call.chars), 0),
    modules,
  });
  const preflight = {
    scene: "p49b",
    productSha: "542e47d6f415d0374d94b7edf5b3ddd8843009d4",
    characterId: CHARACTER_ID,
    personaId: PERSONA_ID,
    lorebookId: LOREBOOK_ID,
    modelId: MODEL_ID,
    room,
    keywordStop,
    dryProviderCalls: dryCalls.map((call) => ({ urlHost: safeHost(call.url), model: call.model, chars: call.chars })),
    mainCallCount: mainCalls.length,
    lorebookContentSha256: scene.lorebookContentSha256,
    lorebookInjectedInDrySystem: lorebookInjected,
    personaInjected,
    greetingInjected,
    userMessageInjected,
    selectedChunksInWire,
    selectedChunkCount: selectedChunkContents.length,
    personaSha256: PERSONA_SHA256,
    greetingSha256: GREETING_SHA256,
    userMessageSha256: USER_MESSAGE_SHA256,
    ceiling,
    executeRequested: execute,
  };
  mkdirSync(evidenceOut, { recursive: true });
  const stopBeforePaid =
    mainCalls.length !== 1 ||
    !injected ||
    keywordStop !== "only-13" ||
    !ceiling.established ||
    ceiling.totalKrw > BUDGET_KRW;
  if (stopBeforePaid || !execute) {
    writeFileSync(join(evidenceOut, stopBeforePaid ? "p49b-preflight-stop.json" : "p49b-preflight.json"), JSON.stringify({ ...preflight, decision: stopBeforePaid ? "stop" : "preflight-only" }, null, 2));
    console.info(`[p49b] ${stopBeforePaid ? "STOP" : "preflight"} ceilingKRW=${ceiling.totalKrw} established=${ceiling.established} mainCalls=${mainCalls.length} injected=${injected}`);
    globalThis.fetch = deps.realFetch;
    uninstallIsolatedTestDatabase();
    deps.restoreModuleLoad();
    if (stopBeforePaid) process.exitCode = 3;
    return;
  }

  const ledgerTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_cost_ledger'")
    .get() as { name: string } | undefined;
  if (ledgerTable) db.prepare("DELETE FROM api_cost_ledger").run();
  const capture = createAdultOffLiveCapture();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!/openai\.com|openrouter\.ai|cheaperinference/i.test(url)) return deps.realFetch(input, init);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    let model = "";
    let system = "";
    try {
      const body = JSON.parse(bodyText) as { model?: unknown; messages?: Array<{ role?: string; content?: unknown }> };
      model = String(body.model ?? "");
      const systemMessage = body.messages?.find((message) => message.role === "system");
      system = typeof systemMessage?.content === "string" ? systemMessage.content : "";
    } catch {
      /* classifier or tail body still forwarded */
    }
    const kind = model === "gpt-6-luna" && system.includes("독립 검수기") ? "classifier" : model === MODEL_ID ? "main" : "other";
    return capture.forward(deps.realFetch, input, init, { kind, model });
  }) as typeof fetch;

  const balanceBefore = modules.points.getPointBalance(USER_ID);
  const chatId = modules.session.createChatSession({
    userId: USER_ID,
    characterId: CHARACTER_ID,
    greeting: scene.greeting,
    mode: "safe",
    selectedPersonaId: PERSONA_ID,
    adultHandoffEnabled: false,
    __testOnGreetingSchedule: () => {},
  });
  const t0 = Date.now();
  const response = await modules.route.POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: CHARACTER_ID,
        chatId,
        message: scene.userMessage,
        clientRequestId: `p49b-live-${t0}`,
      }),
    })
  );
  const events = await readSse(response, t0);
  const report = await capture.finish({
    listOwners: () => listOpenTurnTailWork(),
    readLedger: () =>
      db
        .prepare(
          `SELECT provider_request_id, request_kind, model, event_status,
                  input_tokens, output_tokens, actual_cost_usd, actual_cost_source
           FROM api_cost_ledger ORDER BY id ASC`
        )
        .all() as MeasuredLedgerRow[],
    deadlineMs: Number(process.env.LIVE_MEASURE_SETTLE_TIMEOUT_MS ?? "180000"),
  });
  const stored = db
    .prepare(
      `SELECT id, role, content, model, generation_status FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(chatId) as Array<{ id: number; role: string; content: string; model: string | null; generation_status: string | null }>;
  const assistant = [...stored].reverse().find((row) => row.role === "assistant" && row.model !== "greeting");
  const messageApi = assistant
    ? await modules.messageRoute.GET(new Request(`http://localhost/api/chat/message?messageId=${assistant.id}`))
    : null;
  const messageCheck = messageApi && assistant
    ? checkMessageApiResponse({ status: messageApi.status, bodyText: await messageApi.text(), storedContent: assistant.content })
    : null;
  const exportResponse = await modules.exportRoute.GET(new Request(`http://localhost/api/chat/export?chatId=${chatId}`));
  const exportText = await exportResponse.text();
  const screen = reconstructScreenText(events.map((event) => event.event));
  const timeline = screenBeforeAndAfter(reconstructScreenTimeline(events));
  const classifierEndedAt = report.calls
    .filter((call) => call.kind === "classifier" && call.endedAtMs != null)
    .map((call) => call.endedAtMs as number);
  const firstClassifierDone = classifierEndedAt.length ? Math.min(...classifierEndedAt) : null;
  const balanceAfter = modules.points.getPointBalance(USER_ID);
  const evidence = {
    ...preflight,
    decision: report.mayReportSuccess ? "measured" : "incomplete",
    settle: report.reason,
    httpStatus: response.status,
    chatId,
    calls: report.calls.map((call) => ({
      kind: call.kind,
      model: call.model,
      urlHost: safeHost(call.url),
      status: call.status,
      requestBodyChars: call.requestBodyChars,
      providerRequestId: call.providerRequestId,
      ledgerRequestKind: call.ledgerRequestKind,
      startedAtMs: call.startedAtMs,
      headerAtMs: call.headerAtMs,
      endedAtMs: call.endedAtMs,
      headerError: call.headerError,
      bodyError: call.bodyError,
    })),
    ledger: report.ledger,
    cost: report.cost,
    pointsBefore: balanceBefore,
    pointsAfter: balanceAfter,
    timeline,
    withheldUntilClassifier: firstClassifierDone != null && timeline.firstBodyAtMs != null && t0 + timeline.firstBodyAtMs >= firstClassifierDone,
    parity: {
      sseChars: screen.length,
      sseSha256: sha256(screen),
      dbChars: assistant?.content.length ?? 0,
      dbSha256: assistant ? sha256(assistant.content) : null,
      sseEqualsDb: assistant ? screen === assistant.content : false,
      messageApi: messageCheck,
      exportStatus: exportResponse.status,
      exportContainsAssistant: assistant ? exportText.includes(assistant.content.trim()) : false,
      exportContainsUser: exportText.includes(scene.userMessage),
      exportContainsGreeting: exportText.includes(scene.greeting.trim()),
      generationStatus: assistant?.generation_status ?? null,
    },
    assistantText: assistant?.content ?? "",
    exportText,
    screenText: screen,
  };
  writeFileSync(join(evidenceOut, "p49b-live-result.json"), JSON.stringify(evidence, null, 2));
  console.info(
    `[p49b] measured settle=${report.reason} calls=${report.calls.length} sseEqualsDb=${evidence.parity.sseEqualsDb} dbChars=${evidence.parity.dbChars} status=${evidence.parity.generationStatus}`
  );
  globalThis.fetch = deps.realFetch;
  uninstallIsolatedTestDatabase();
  deps.restoreModuleLoad();
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparsed";
  }
}

async function loadFx(realFetch: typeof fetch): Promise<{ spot: number; effective: number }> {
  const override = Number(process.env.LIVE_MEASURE_USD_KRW ?? "");
  if (override > 0) return { spot: override, effective: override * FX_BUFFER };
  const response = await realFetch("https://open.er-api.com/v6/latest/USD");
  const body = (await response.json()) as { rates?: { KRW?: number } };
  const spot = Number(body.rates?.KRW);
  if (!(spot > 0)) throw new Error("USD/KRW rate unavailable; refusing to estimate");
  return { spot, effective: spot * FX_BUFFER };
}

function loadScene(evidenceDir: string): {
  greeting: string;
  userMessage: string;
  personaName: string;
  personaGender: string;
  personaDescription: string;
  character: Record<string, unknown>;
  genres: string;
  participantMinAge: number | null;
  recommendedWritingStyle: string;
  contentKind: string;
  lorebookContentSha256: string;
  systemHasLorebook: boolean;
} {
  const fixture = JSON.parse(readText(join(evidenceDir, "fixture.response.json"))) as {
    character: { source: Record<string, unknown> };
    persona: { name: string; gender: string; description: string };
  };
  const projection = JSON.parse(readText(join(evidenceDir, "character.response.projection.json"))) as {
    greeting: string;
    genres: string[];
    participant_min_age: number | null;
    recommended_writing_style: string;
    content_kind: string;
    nsfw: boolean;
  };
  const greeting = readText(join(evidenceDir, "greeting.txt"));
  const userMessage = readText(join(evidenceDir, "p45-user-message.txt"));
  if (sha256(greeting) !== GREETING_SHA256 || greeting.length !== 813) throw new Error("greeting evidence hash mismatch");
  if (sha256(fixture.persona.description) !== PERSONA_SHA256 || fixture.persona.description.length !== 583) {
    throw new Error("persona evidence hash mismatch");
  }
  if (sha256(userMessage) !== USER_MESSAGE_SHA256 || userMessage.length !== 54) throw new Error("user message evidence hash mismatch");
  if (projection.greeting !== greeting) throw new Error("projection greeting differs from greeting.txt");
  if (projection.nsfw) throw new Error("character projection is marked nsfw");
  return {
    greeting,
    userMessage,
    personaName: fixture.persona.name,
    personaGender: fixture.persona.gender,
    personaDescription: fixture.persona.description,
    character: fixture.character.source,
    genres: JSON.stringify(projection.genres),
    participantMinAge: projection.participant_min_age,
    recommendedWritingStyle: projection.recommended_writing_style,
    contentKind: projection.content_kind,
    lorebookContentSha256: "",
    systemHasLorebook: false,
  };
}

function loadSelectedChunkContents(evidenceDir: string): string[] {
  const selected = JSON.parse(readText(join(evidenceDir, "selected-chunks.json"))) as {
    chunks?: Array<{ content?: string }>;
  };
  return (selected.chunks ?? []).map((chunk) => String(chunk.content ?? "")).filter((content) => content.length > 0);
}

function loadLorebookEntry(): { name: string; keywords: string[]; content: string } {
  const pilot = JSON.parse(readText(join(process.cwd(), "src/lib/officialSupply/pilot/characters/pilot-rf-03.json"))) as {
    lorebook?: { entries?: Array<{ entryKey?: string; name?: string; keywords?: string[]; content?: string }> };
  };
  const entries = pilot.lorebook?.entries ?? findEntries(pilot);
  const entry = entries.find((item) => item.entryKey === LOREBOOK_ENTRY_KEY);
  if (!entry?.content || !entry.keywords?.length || !entry.name) throw new Error("official lorebook #13 entry missing");
  if (entry.content.length !== 191) throw new Error(`official lorebook #13 content is ${entry.content.length} chars`);
  return { name: entry.name, keywords: entry.keywords, content: entry.content };
}

function findEntries(value: unknown): Array<{ entryKey?: string; name?: string; keywords?: string[]; content?: string }> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => findEntries(item));
  const record = value as { entryKey?: string; entries?: unknown };
  if (typeof record.entryKey === "string") return [record as { entryKey?: string; name?: string; keywords?: string[]; content?: string }];
  return Object.values(record).flatMap((item) => findEntries(item));
}

async function loadModules() {
  const [auth, dbMod, points, selected, session, route, messageRoute, exportRoute, pricing, guard, keywords, lorebooks, userLorebook, prose, ai] = await Promise.all([
    import("../../src/lib/auth"),
    import("../../src/lib/db"),
    import("../../src/lib/points"),
    import("../../src/lib/userSelectedAI"),
    import("../../src/lib/chatSessionCreate"),
    import("../../src/app/api/chat/route"),
    import("../../src/app/api/chat/message/route"),
    import("../../src/app/api/chat/export/route"),
    import("../../src/lib/publishedModelPricing"),
    import("../../src/lib/adultOffOutputGuard"),
    import("../../src/lib/keywordLorebooks"),
    import("../../src/lib/creatorLorebook"),
    import("../../src/lib/userLorebook"),
    import("../../src/lib/proseStyleResolver"),
    import("../../src/lib/ai"),
  ]);
  return { auth, dbMod, points, selected, session, route, messageRoute, exportRoute, pricing, guard, keywords, lorebooks, userLorebook, prose, ai };
}

function assertKeywordScope(
  modules: Awaited<ReturnType<typeof loadModules>>,
  scene: ReturnType<typeof loadScene>,
  lore: { keywords: string[]; content: string }
): "only-13" | "other-hit" | "thirteen-miss" {
  const keywords = JSON.parse(readText(join(process.env.LIVE_MEASURE_EVIDENCE_DIR!.trim(), "p45-admin-keywords.json"))) as {
    character: { lorebooks: Array<{ id: number; keywords: string[] }> };
  };
  const activation = { currentUserText: scene.userMessage, recentRawText: scene.greeting };
  const hits = keywords.character.lorebooks.flatMap((book) => {
    const matched = modules.keywords.matchKeywordLorebookEntryDetails(
      [{ keywords: book.keywords, content: book.id === LOREBOOK_ID ? lore.content : "unused-keyword-probe" }],
      activation
    );
    return matched.length ? [book.id] : [];
  });
  if (hits.length === 1 && hits[0] === LOREBOOK_ID) return "only-13";
  if (!hits.includes(LOREBOOK_ID)) return "thirteen-miss";
  return "other-hit";
}

function seedScene(
  db: ReturnType<Awaited<ReturnType<typeof loadModules>>["dbMod"]["getDb"]>,
  modules: Awaited<ReturnType<typeof loadModules>>,
  scene: ReturnType<typeof loadScene>,
  lore: { name: string; keywords: string[]; content: string }
): void {
  modules.userLorebook.ensureUserLorebookSchema(db);
  modules.lorebooks.ensureCreatorLorebookSchema(db);
  insertPresent(db, "users", columnSet(db, "users"), {
    id: USER_ID,
    email: "adult-off-p49b@example.test",
    nickname: scene.personaName,
    pw_hash: "x",
    is_admin: 0,
    is_adult: 0,
  });
  modules.selected.setUserSelectedAI(db, USER_ID, MODEL_ID as never);
  insertPresent(db, "user_personas", columnSet(db, "user_personas"), {
    id: PERSONA_ID,
    user_id: USER_ID,
    name: scene.personaName,
    gender: scene.personaGender,
    description: scene.personaDescription,
    speech_examples: "",
    secret_description: "",
  });
  const source = scene.character;
  insertPresent(db, "characters", columnSet(db, "characters"), {
    id: CHARACTER_ID,
    name: source.name,
    gender: source.gender,
    description: source.description,
    system_prompt: source.system_prompt,
    world: source.world,
    example_dialog: source.example_dialog,
    setting_chunks: source.setting_chunks,
    setting_chunks_en: source.setting_chunks_en,
    prompt_translation_hash: source.prompt_translation_hash,
    speech_profile: source.speech_profile,
    creator_compiled_description_json: source.creator_compiled_description_json,
    appearance_raw: source.appearance_raw,
    appearance_compiled: source.appearance_compiled,
    narration_style_instructions: source.narration_style_instructions,
    content_kind: scene.contentKind,
    greeting: scene.greeting,
    genres: scene.genres,
    nsfw: 0,
    official: 1,
    participant_min_age: scene.participantMinAge,
    recommended_writing_style: scene.recommendedWritingStyle,
  });
  insertPresent(db, "keyword_lorebooks", columnSet(db, "keyword_lorebooks"), {
    id: LOREBOOK_ID,
    creator_id: USER_ID,
    name: lore.name,
    summary: "",
    entries_json: JSON.stringify([{ keywords: lore.keywords, content: lore.content }]),
    scope: "creator",
  });
  db.prepare(
    `INSERT INTO character_lorebook_attachments (character_id, lorebook_id, position) VALUES (?,?,?)`
  ).run(CHARACTER_ID, LOREBOOK_ID, 0);
  modules.points.creditPoints(USER_ID, 200000, "FREE", "p49b isolated free");
  modules.points.creditPoints(USER_ID, 200000, "PAID", "p49b isolated paid");
  scene.lorebookContentSha256 = sha256(lore.content);
  scene.systemHasLorebook = true;
}

function readRoomDefaults(
  db: ReturnType<Awaited<ReturnType<typeof loadModules>>["dbMod"]["getDb"]>,
  modules: Awaited<ReturnType<typeof loadModules>>
): Record<string, unknown> {
  const chatId = modules.session.createChatSession({
    userId: USER_ID,
    characterId: CHARACTER_ID,
    greeting: "probe",
    mode: "safe",
    selectedPersonaId: PERSONA_ID,
    adultHandoffEnabled: false,
    __testOnGreetingSchedule: () => {},
  });
  const row = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Record<string, unknown>;
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
  return {
    targetResponseChars: row.target_response_chars ?? null,
    narrativePov: row.narrative_pov ?? null,
    adultHandoffEnabled: row.adult_handoff_enabled ?? null,
    mode: row.mode ?? null,
    selectedPersonaId: row.selected_persona_id ?? null,
    proseRoute: modules.prose.resolveProseStyleRouteName(USER_ID, MODEL_ID),
    proseSectionSha256: sha256(modules.prose.resolveProseStyleSection(USER_ID, MODEL_ID) ?? "legacy-undefined"),
  };
}

function buildCeiling(input: {
  fx: { spot: number; effective: number };
  mainBodyChars: number;
  modules: Awaited<ReturnType<typeof loadModules>>;
}): {
  established: boolean;
  totalKrw: number;
  spot: number;
  effective: number;
  mainInputTokensUpper: number;
  longContext: boolean;
  partsKrw: Record<string, number>;
  note: string;
} {
  const pricing = input.modules.pricing.getPublishedPricing(MODEL_ID);
  const inputTokensUpper = Math.ceil(input.mainBodyChars * INPUT_TOKENS_PER_CHAR_UPPER);
  const rates = input.modules.pricing.resolvePublishedReferenceRatesForPrompt(pricing, inputTokensUpper);
  const promptUsdPerM = Math.max(rates.inputUsdPerMillion, rates.cacheWriteUsdPerMillion ?? 0);
  if (!(promptUsdPerM > 0) || !(rates.outputUsdPerMillion > 0) || !(input.fx.effective > 0) || input.mainBodyChars <= 0) {
    return {
      established: false,
      totalKrw: Number.POSITIVE_INFINITY,
      spot: input.fx.spot,
      effective: input.fx.effective,
      mainInputTokensUpper: inputTokensUpper,
      longContext: rates.longContextApplied,
      partsKrw: {},
      note: "missing rate, FX, or main prompt body",
    };
  }
  const mainPromptKrw = (inputTokensUpper * promptUsdPerM * input.fx.effective) / 1_000_000;
  const mainOutputKrw = (MAX_OUTPUT_TOKENS * rates.outputUsdPerMillion * input.fx.effective) / 1_000_000;
  const maxChars = MAX_OUTPUT_TOKENS * OUTPUT_CHARS_PER_TOKEN_UPPER;
  const windows = input.modules.guard.splitAdultOffGuardWindows("x".repeat(maxChars)).length;
  const systemChars = input.modules.guard.ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT.length + 80;
  const windowInputTokens = Math.ceil((input.modules.guard.ADULT_OFF_GUARD_WINDOW_CHARS + systemChars) * INPUT_TOKENS_PER_CHAR_UPPER);
  const classifierCalls = windows * FULL_LENGTH_CLASSIFIER_CANDIDATES + SHORT_AUX_CLASSIFIER_CALLS;
  const classifierUsd =
    classifierCalls *
    ((windowInputTokens * OFFICIAL_LUNA_CACHE_WRITE_USD_PER_M + CLASSIFIER_OUTPUT_TOKENS * OFFICIAL_LUNA_OUTPUT_USD_PER_M) / 1_000_000);
  const tailKinds = [
    "background-post-turn-shared-initial",
    "background-post-turn-shared-initial-episodic",
    "background-margin",
  ];
  let tailUsd = 0;
  for (const kind of tailKinds) {
    const unbounded = UNBOUNDED_BACKGROUND.test(kind);
    const outputTokens = unbounded ? MAX_OUTPUT_TOKENS : input.modules.ai.resolveBackgroundMaxOutputTokens(kind);
    const inputTokens = unbounded ? inputTokensUpper : input.modules.ai.BACKGROUND_MAX_INPUT_TOKENS;
    tailUsd +=
      (inputTokens * OFFICIAL_LUNA_CACHE_WRITE_USD_PER_M + outputTokens * OFFICIAL_LUNA_OUTPUT_USD_PER_M) / 1_000_000;
  }
  const classifierKrw = classifierUsd * input.fx.effective;
  const tailKrw = tailUsd * input.fx.effective;
  const totalKrw = mainPromptKrw + mainOutputKrw + classifierKrw + tailKrw;
  return {
    established: Number.isFinite(totalKrw),
    totalKrw,
    spot: input.fx.spot,
    effective: input.fx.effective,
    mainInputTokensUpper: inputTokensUpper,
    longContext: rates.longContextApplied,
    partsKrw: { mainPromptKrw, mainOutputKrw, classifierKrw, tailKrw },
    note: "list Sol rates, official Luna list rates, 2 tokens/char input upper, 4 chars/token output window upper, 3 full classifier texts plus 2 short checks, 3 capped Luna tail calls",
  };
}

async function readSse(response: Response, t0: number): Promise<Array<{ atMs: number; event: Record<string, unknown> }>> {
  const events: Array<{ atMs: number; event: Record<string, unknown> }> = [];
  if (!response.body) return events;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = block.split("\n").map((part) => part.trim()).find((part) => part.startsWith("data:"));
      if (line) {
        const json = line.slice(5).trim();
        if (json && json !== "[DONE]") {
          try {
            events.push({ atMs: Date.now() - t0, event: JSON.parse(json) as Record<string, unknown> });
          } catch {
            /* keepalive */
          }
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
  return events;
}
