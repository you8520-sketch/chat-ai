import type Database from "better-sqlite3";
import { presentAdultOffStoredRead } from "@/lib/adultOffOutputGuard";
import { normalizeMessageVariants } from "@/lib/messageAlternates";

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

function resolveAssistantText(row: TranscriptMessageRow, applyAdultOffReadGuard: boolean): string {
  try {
    const { variants, activeVariant } = normalizeMessageVariants(row);
    return presentAdultOffStoredRead({
      applyGuard: applyAdultOffReadGuard,
      rowContent: row.content,
      variants,
      activeVariant,
    }).content;
  } catch {
    // 손상된 variant JSON: 가드가 켜져 있으면 미확정 본문을 내보내지 않는다.
    return applyAdultOffReadGuard ? "" : row.content;
  }
}

/**
 * 스트리밍 어셈블러. 화면의 `partitionChatMessages` 규칙과 같은 의미를 유지한다:
 * - 인사말(model=greeting)은 턴 번호 없이 앞에 둔다.
 * - AI 응답이 붙지 않은 user 행(고아)은 화면과 동일하게 내보내지 않는다.
 * - 현재 선택된 assistant variant 하나만 내보낸다.
 */
export class TranscriptAssembler {
  private pendingUser: string | null = null;
  private turnNumber = 0;

  constructor(private readonly applyAdultOffReadGuard: boolean) {}

  get exportedTurnCount(): number {
    return this.turnNumber;
  }

  push(row: TranscriptMessageRow): string {
    if (row.role === "user") {
      this.pendingUser = row.content;
      return "";
    }
    if (row.role !== "assistant") return "";

    const assistantText = resolveAssistantText(row, this.applyAdultOffReadGuard);
    const body = assistantText.trim() ? assistantText : TRANSCRIPT_EMPTY_ASSISTANT_PLACEHOLDER;

    if (row.model === "greeting") {
      this.pendingUser = null;
      if (!assistantText.trim()) return "";
      return `${TRANSCRIPT_GREETING_HEADING}\n${assistantText}\n\n`;
    }
    if (this.pendingUser === null) {
      return `${TRANSCRIPT_EXTRA_ASSISTANT_HEADING}\n${body}\n\n`;
    }
    this.turnNumber += 1;
    const userText = this.pendingUser;
    this.pendingUser = null;
    return `[턴 ${this.turnNumber}]\n${userText}\n${TURN_SEPARATOR}\n${body}\n\n`;
  }
}

export function* readTranscriptRowBatches(
  db: Database.Database,
  chatId: number,
  batchRows: number = TRANSCRIPT_BATCH_ROWS
): Generator<TranscriptMessageRow[]> {
  const stmt = db.prepare(
    `SELECT id, role, content, model, usage, alternates, active_variant, generation_status
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
  batchRows?: number;
}): Generator<string> {
  yield formatTranscriptHeader(input.header);
  const assembler = new TranscriptAssembler(input.applyAdultOffReadGuard);
  for (const rows of readTranscriptRowBatches(input.db, input.chatId, input.batchRows)) {
    let chunk = "";
    for (const row of rows) chunk += assembler.push(row);
    if (chunk) yield chunk;
  }
}
