import type Database from "better-sqlite3";
import { adultOffProofCarrier } from "@/lib/adultOffAuxApproval";
import {
  filterAdultOffStatusMeta,
  presentAdultOffStoredRead,
} from "@/lib/adultOffOutputGuard";
import { resolveClientAsyncRecordsFromMessageRow } from "@/lib/clientAsyncRecordRead";
import { normalizeMessageVariants } from "@/lib/messageAlternates";
import { resolveClientStatusMetaFlags } from "@/lib/statusMeta/displayPolicy";
import { statusMetaDisplayMarkdown } from "@/lib/statusMeta/render";
import { partitionPlainStatusBlockForDisplay } from "@/lib/statusMeta/stripArtifacts";
import {
  markdownPipeTableStatusWindowActive,
  resolveUserNoteStatusWindowPolicy,
} from "@/lib/statusWindowNotePolicy";
import { shouldShowStatusWidgetOnMessage } from "@/lib/statusWidget/displayPolicy";
import {
  parseStoredStatusWidgetValuesJson,
  stripExtractedFactsForClient,
} from "@/lib/statusWidget/parseValues";
import { formatRenderedStatusWidgetText } from "@/lib/statusWidget/render";
import { orderedWidgetsForRender, resolveStatusWidgetTurn, statusWidgetModeForDefinitions } from "@/lib/statusWidget/resolve";
import type { StatusWidgetProfileNames } from "@/lib/statusWidget/placeholders";

/**
 * 채팅방 전체 대화 TXT 내보내기. 화면 페이지네이션과 무관하게 chat_id 단위로
 * id 오름차순 keyset 배치를 읽는다. 읽기 전용: UPDATE/DELETE/INSERT 금지
 * (고아 메시지 purge 등 `/api/chat/messages`의 조회 부작용을 복제하지 않는다).
 */
export const TRANSCRIPT_BATCH_ROWS = 200;
export const TRANSCRIPT_EMPTY_ASSISTANT_PLACEHOLDER = "[AI 응답 없음]";
export const TRANSCRIPT_GREETING_HEADING = "[인사말]";
export const TRANSCRIPT_EXTRA_ASSISTANT_HEADING = "[추가 응답]";
export const TRANSCRIPT_UNTITLED_ROOM = "제목 없음";
export const TRANSCRIPT_STATUS_META_HEADING = "[상태창]";
export const TRANSCRIPT_STATUS_WIDGET_HEADING = "[상태 위젯]";
const TURN_SEPARATOR = "---";
const FILENAME_MAX_CHARS = 120;
const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type TranscriptMessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model: string;
  usage: string | null;
  alternates: string | null;
  active_variant: number | null;
  generation_status: string | null;
  status_meta: string | null;
  status_widget_values_json: string | null;
  status_widget_turn_active: number | null;
  suggested_replies_json: string | null;
  request_id: string | null;
};

/** 채팅 화면과 같은 상태창 표시 입력. 비밀 원문이나 추출 레코드 전체가 아니다. */
export type TranscriptStatusContext = {
  userNote: string;
  personaDescription: string;
  characterWidgetJson: string;
  personaWidgetJson: string;
  characterAllowUserOverride: boolean;
  statusWidgetStackOrder: string | null;
  statusWidgetDisplayMode: string | null;
  profileNames: StatusWidgetProfileNames;
};

export type TranscriptHeader = {
  characterName: string;
  chatTitle: string;
  personaName: string;
};

export function formatTranscriptHeader(header: TranscriptHeader): string {
  const title = header.chatTitle.trim() || TRANSCRIPT_UNTITLED_ROOM;
  return `캐릭터: ${header.characterName}\n채팅방 이름: ${title}\n페르소나 이름: ${header.personaName}\n\n`;
}

export function buildTranscriptFilename(header: TranscriptHeader, now: Date = new Date()): string {
  const clean = (value: string) =>
    value
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "_")
      .replace(/^[._]+|[._]+$/g, "");
  const character = clean(header.characterName) || "캐릭터";
  const title = clean(header.chatTitle) || clean(TRANSCRIPT_UNTITLED_ROOM);
  const date = KST_DATE_FORMATTER.format(now);
  const base = `${character}_${title}`.slice(0, FILENAME_MAX_CHARS).replace(/_+$/g, "");
  return `${base}_${date}.txt`;
}

export function buildAttachmentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="chat-transcript.txt"; filename*=UTF-8''${encoded}`;
}

type AssistantPresentation = {
  prose: string;
  before: string;
  after: string;
};

function storedStatusWidgetValues(row: TranscriptMessageRow, activeVariant: {
  statusWidgetValues?: unknown;
} | undefined): ReturnType<typeof parseStoredStatusWidgetValuesJson> | null {
  const hasVariantStatusSnapshot =
    activeVariant != null &&
    Object.prototype.hasOwnProperty.call(activeVariant, "statusWidgetValues");
  if (hasVariantStatusSnapshot) {
    return (activeVariant.statusWidgetValues as ReturnType<typeof parseStoredStatusWidgetValuesJson> | null) ?? null;
  }
  return parseStoredStatusWidgetValuesJson(row.status_widget_values_json);
}

function parseUsageJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function section(heading: string, body: string): string {
  const text = body.trim();
  return text ? `${heading}\n${text}` : "";
}

/**
 * 채팅 화면이 본문 밖에 그리는 상태만 줄글로 옮긴다.
 * 메시지 읽기와 같은 표시·성인오프 정책을 쓰고, 추출 사실·지시문·템플릿·레코드 메타는 넣지 않는다.
 */
function presentAssistant(
  row: TranscriptMessageRow,
  userMessage: string | null,
  applyAdultOffReadGuard: boolean,
  statusContext: TranscriptStatusContext | null
): AssistantPresentation {
  try {
    const { variants, activeVariant } = normalizeMessageVariants(row);
    const activeSnapshot = variants[activeVariant];
    const presented = presentAdultOffStoredRead({
      applyGuard: applyAdultOffReadGuard,
      rowContent: row.content,
      variants,
      activeVariant,
      messageModel: row.model,
      storedAlternates: row.alternates,
      statusWidgetValues: storedStatusWidgetValues(row, activeSnapshot),
    });
    if (row.model === "greeting" || !statusContext) {
      return { prose: presented.content, before: "", after: "" };
    }

    const policy = resolveUserNoteStatusWindowPolicy(statusContext.userNote);
    const markdownStatusWindowActive = markdownPipeTableStatusWindowActive(policy);
    const widgetTurn = resolveStatusWidgetTurn({
      characterWidgetJson: statusContext.characterWidgetJson,
      chatMode: statusWidgetModeForDefinitions({
        characterWidgetJson: statusContext.characterWidgetJson,
        personaWidgetJson: statusContext.personaWidgetJson,
        characterAllowUserOverride: statusContext.characterAllowUserOverride,
      }),
      userWidgetJson: statusContext.personaWidgetJson,
      stackOrder: statusContext.statusWidgetStackOrder,
      displayMode: statusContext.statusWidgetDisplayMode,
      characterAllowUserOverride: statusContext.characterAllowUserOverride,
    });
    const { statusRecord } = resolveClientAsyncRecordsFromMessageRow({
      id: row.id,
      alternates: row.alternates,
      active_variant: row.active_variant,
      request_id: row.request_id,
      generation_status: row.generation_status,
      content: row.content,
      model: row.model,
      usage: row.usage,
      status_meta: row.status_meta,
      suggested_replies_json: row.suggested_replies_json,
    });
    const activeUsage = activeSnapshot?.usage ?? parseUsageJson(row.usage);
    const flags = resolveClientStatusMetaFlags({
      statusRecord,
      messageContent: presented.content,
      userNote: statusContext.userNote,
      userPersona: statusContext.personaDescription,
      userMessage: userMessage ?? undefined,
      markdownStatusWindowActive,
      statusWidgetActive: widgetTurn.active,
    });
    const statusMeta = filterAdultOffStatusMeta(
      applyAdultOffReadGuard,
      activeUsage,
      flags.statusMeta,
      adultOffProofCarrier(statusRecord?.adultOffGuard)
    );
    const statusMarkdown =
      statusMeta && flags.statusMetaRequested && !flags.statusMetaPending && !flags.statusMetaFailed
        ? statusMetaDisplayMarkdown(statusMeta, statusRecord?.formatSpec ?? policy.formatSpec)
        : null;
    const widgetValues = stripExtractedFactsForClient(presented.statusWidgetValues);
    const showWidget = shouldShowStatusWidgetOnMessage({
      model: row.model,
      statusWidgetTurnActive: row.status_widget_turn_active === 1,
      statusWidgetValues: widgetValues,
      displayHidden: widgetTurn.displayMode === "hidden",
    });
    const topWidgetLines: string[] = [];
    const bottomWidgetLines: string[] = [];
    if (showWidget) {
      for (const item of orderedWidgetsForRender(widgetTurn, widgetValues)) {
        const text = formatRenderedStatusWidgetText(
          item.widget,
          item.values,
          statusContext.profileNames
        );
        if (!text) continue;
        if (item.widget.placement === "top") topWidgetLines.push(text);
        else bottomWidgetLines.push(text);
      }
    }
    const formatSpec = statusRecord?.formatSpec ?? policy.formatSpec ?? null;
    const prose =
      markdownStatusWindowActive && formatSpec
        ? partitionPlainStatusBlockForDisplay(presented.content, formatSpec, policy.placement).prose
        : presented.content;
    const metaSection = section(TRANSCRIPT_STATUS_META_HEADING, statusMarkdown ?? "");
    const topWidgetSection = section(TRANSCRIPT_STATUS_WIDGET_HEADING, topWidgetLines.join("\n\n"));
    const bottomWidgetSection = section(
      TRANSCRIPT_STATUS_WIDGET_HEADING,
      bottomWidgetLines.join("\n\n")
    );
    const metaOnTop = policy.placement === "top";
    return {
      prose,
      before: [topWidgetSection, metaOnTop ? metaSection : ""].filter(Boolean).join("\n\n"),
      after: [bottomWidgetSection, metaOnTop ? "" : metaSection].filter(Boolean).join("\n\n"),
    };
  } catch {
    // 손상된 variant JSON: 가드가 켜져 있으면 미확정 본문을 내보내지 않는다.
    return { prose: applyAdultOffReadGuard ? "" : row.content, before: "", after: "" };
  }
}

function assistantBody(presentation: AssistantPresentation): string {
  const parts = [presentation.before, presentation.prose.trim(), presentation.after].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : TRANSCRIPT_EMPTY_ASSISTANT_PLACEHOLDER;
}

/**
 * 스트리밍 어셈블러. 화면의 `partitionChatMessages` 규칙과 같은 의미를 유지한다:
 * - 인사말(model=greeting)은 턴 번호 없이 앞에 둔다.
 * - AI 응답이 붙지 않은 user 행(고아)은 화면과 동일하게 내보내지 않는다.
 * - 현재 선택된 assistant variant 하나만 내보낸다.
 * - 본문 밖에 표시되는 상태창·상태 위젯만 같은 턴에 붙인다.
 */
export class TranscriptAssembler {
  private pendingUser: string | null = null;
  private turnNumber = 0;

  constructor(
    private readonly applyAdultOffReadGuard: boolean,
    private readonly statusContext: TranscriptStatusContext | null
  ) {}

  get exportedTurnCount(): number {
    return this.turnNumber;
  }

  push(row: TranscriptMessageRow): string {
    if (row.role === "user") {
      this.pendingUser = row.content;
      return "";
    }
    if (row.role !== "assistant") return "";

    const userMessage = this.pendingUser;
    const presentation = presentAssistant(
      row,
      userMessage,
      this.applyAdultOffReadGuard,
      this.statusContext
    );
    const body = assistantBody(presentation);

    if (row.model === "greeting") {
      this.pendingUser = null;
      if (!presentation.prose.trim()) return "";
      return `${TRANSCRIPT_GREETING_HEADING}\n${presentation.prose}\n\n`;
    }
    if (userMessage === null) {
      return `${TRANSCRIPT_EXTRA_ASSISTANT_HEADING}\n${body}\n\n`;
    }
    this.turnNumber += 1;
    this.pendingUser = null;
    return `[턴 ${this.turnNumber}]\n${userMessage}\n${TURN_SEPARATOR}\n${body}\n\n`;
  }
}

export function* readTranscriptRowBatches(
  db: Database.Database,
  chatId: number,
  batchRows: number = TRANSCRIPT_BATCH_ROWS
): Generator<TranscriptMessageRow[]> {
  const stmt = db.prepare(
    `SELECT id, role, content, model, usage, alternates, active_variant, generation_status,
            status_meta, status_widget_values_json, status_widget_turn_active,
            suggested_replies_json, request_id
     FROM messages WHERE chat_id=? AND id>? ORDER BY id ASC LIMIT ?`
  );
  let lastId = 0;
  for (;;) {
    const rows = stmt.all(chatId, lastId, batchRows) as TranscriptMessageRow[];
    if (rows.length === 0) return;
    yield rows;
    lastId = rows[rows.length - 1]!.id;
    if (rows.length < batchRows) return;
  }
}

export function* generateTranscriptChunks(input: {
  db: Database.Database;
  chatId: number;
  header: TranscriptHeader;
  applyAdultOffReadGuard: boolean;
  statusContext?: TranscriptStatusContext | null;
  batchRows?: number;
}): Generator<string> {
  yield formatTranscriptHeader(input.header);
  const assembler = new TranscriptAssembler(
    input.applyAdultOffReadGuard,
    input.statusContext ?? null
  );
  for (const rows of readTranscriptRowBatches(input.db, input.chatId, input.batchRows)) {
    let chunk = "";
    for (const row of rows) chunk += assembler.push(row);
    if (chunk) yield chunk;
  }
}
