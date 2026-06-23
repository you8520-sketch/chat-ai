import { HTML_FLASH_SERVER_ONLY_BLOCK, userRequestsHtmlOutput } from "@/lib/htmlVisualCardPolicy";

export const GLOBAL_LOREBOOK_HTML_VISUAL_CARD_NAME = "HTML Output Mode";
export const GLOBAL_LOREBOOK_HTML_TRIGGERS = ["HTML"];

/** @deprecated 단일 HTML 로어북으로 통합 — seed 시 제거됨 */
export const GLOBAL_LOREBOOK_HTML_MESSENGER_NAME = "HTML Smartphone Messenger";
/** @deprecated */
export const GLOBAL_LOREBOOK_HTML_MESSENGER_TRIGGERS = [
  "스마트폰",
  "메신저",
  "카톡",
  "문자내역",
  "DM",
  "통화내역",
];
/** @deprecated */
export const GLOBAL_LOREBOOK_HTML_ALERT_NAME = "HTML System Alert";
/** @deprecated */
export const GLOBAL_LOREBOOK_HTML_ALERT_TRIGGERS = [
  "경고창",
  "시스템 경고",
  "시스템 알림",
  "위협 경고",
  "ALERT",
  "WARNING",
];

const LEGACY_HTML_LOREBOOK_NAMES = [
  GLOBAL_LOREBOOK_HTML_MESSENGER_NAME,
  GLOBAL_LOREBOOK_HTML_ALERT_NAME,
  "HTML Visual Card Mode",
];

export type GlobalLorebookEntryRow = {
  id: number;
  name: string;
  triggers_json: string;
  content: string;
  depth: number;
  enabled: number;
  sort_order: number;
};

export type GlobalLorebookEntry = {
  id: number;
  name: string;
  triggers: string[];
  content: string;
  depth: number;
  enabled: boolean;
  sortOrder: number;
};

export function parseGlobalLorebookTriggers(json: string): string[] {
  try {
    const parsed = JSON.parse(json || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => String(t ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function rowToGlobalLorebookEntry(row: GlobalLorebookEntryRow): GlobalLorebookEntry {
  return {
    id: row.id,
    name: row.name,
    triggers: parseGlobalLorebookTriggers(row.triggers_json),
    content: row.content.trim(),
    depth: row.depth,
    enabled: row.enabled !== 0,
    sortOrder: row.sort_order,
  };
}

function triggerMatches(text: string, trigger: string): boolean {
  const t = trigger.trim();
  if (!t) return false;
  if (t.toUpperCase() === "HTML") {
    return userRequestsHtmlOutput(text);
  }
  return text.toUpperCase().includes(t.toUpperCase());
}

function entryMatches(
  entry: GlobalLorebookEntry,
  scanText: string,
  userScanText: string
): boolean {
  if (!entry.enabled || !entry.content) return false;

  if (entry.name === GLOBAL_LOREBOOK_HTML_VISUAL_CARD_NAME) {
    return userRequestsHtmlOutput(scanText) || userRequestsHtmlOutput(userScanText);
  }

  if (entry.triggers.length === 0) return true;
  return entry.triggers.some((trigger) => triggerMatches(scanText, trigger));
}

/** Depth 0 = system prompt 최하단(최고 우선) — 매칭된 항목만 반환 */
export function matchGlobalLorebookEntries(
  entries: GlobalLorebookEntry[],
  scanText: string,
  userScanText?: string
): GlobalLorebookEntry[] {
  const text = scanText.trim();
  const userText = (userScanText ?? scanText).trim();
  if (!text || entries.length === 0) return [];

  const matched: GlobalLorebookEntry[] = [];
  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    if (!entryMatches(entry, text, userText)) continue;
    seen.add(entry.id);
    matched.push(entry);
  }

  return matched.sort((a, b) => a.depth - b.depth || a.sortOrder - b.sortOrder || a.id - b.id);
}

export function buildGlobalLorebookPromptBlock(entries: GlobalLorebookEntry[]): string {
  if (entries.length === 0) return "";
  const body = entries.map((e) => e.content).join("\n\n");
  return `[GLOBAL LOREBOOK — World Info · Depth 0 tail · 원문 그대로 · 번역·改変 금지]\n${body}`;
}

export function loadGlobalLorebookPromptBlock(
  db: import("better-sqlite3").Database,
  scanText: string,
  userScanText?: string
): string {
  const rows = db
    .prepare(
      `SELECT id, name, triggers_json, content, depth, enabled, sort_order
       FROM global_lorebook_entries
       WHERE enabled = 1
       ORDER BY depth ASC, sort_order ASC, id ASC`
    )
    .all() as GlobalLorebookEntryRow[];

  const entries = rows.map(rowToGlobalLorebookEntry);
  const matched = matchGlobalLorebookEntries(entries, scanText, userScanText);
  return buildGlobalLorebookPromptBlock(matched);
}

export function platformHtmlVisualCardLorebookContent(): string {
  return HTML_FLASH_SERVER_ONLY_BLOCK;
}

function upsertPlatformLorebookEntry(
  db: import("better-sqlite3").Database,
  opts: {
    name: string;
    triggers: string[];
    content: string;
    sortOrder: number;
  }
): void {
  const existing = db
    .prepare("SELECT id FROM global_lorebook_entries WHERE name = ? LIMIT 1")
    .get(opts.name) as { id: number } | undefined;

  const triggersJson = JSON.stringify(opts.triggers);

  if (existing) {
    db.prepare(
      `UPDATE global_lorebook_entries
       SET triggers_json = ?, content = ?, depth = 0, enabled = 1, sort_order = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(triggersJson, opts.content, opts.sortOrder, existing.id);
    return;
  }

  db.prepare(
    `INSERT INTO global_lorebook_entries
     (name, triggers_json, content, depth, enabled, sort_order, updated_at)
     VALUES (?, ?, ?, 0, 1, ?, datetime('now'))`
  ).run(opts.name, triggersJson, opts.content, opts.sortOrder);
}

/** 모든 DB 부팅 시 idempotent — 플랫폼 전역 HTML 로어북 (단일 항목) */
export function seedGlobalLorebookEntries(db: import("better-sqlite3").Database): void {
  for (const legacyName of LEGACY_HTML_LOREBOOK_NAMES) {
    db.prepare("DELETE FROM global_lorebook_entries WHERE name = ?").run(legacyName);
  }

  upsertPlatformLorebookEntry(db, {
    name: GLOBAL_LOREBOOK_HTML_VISUAL_CARD_NAME,
    triggers: GLOBAL_LOREBOOK_HTML_TRIGGERS,
    content: platformHtmlVisualCardLorebookContent(),
    sortOrder: 0,
  });
}
