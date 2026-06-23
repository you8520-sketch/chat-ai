/** Server-side status window — extracted async, never model-generated */

export type StatusMeta = {

  /** User formatSpec template — filled pipe-table markdown */

  tableMarkdown?: string;

  /** @deprecated Legacy fixed fields — used when no formatSpec */

  datetime?: string;

  location?: string;

  relationship?: string;

  npcEmotion?: string;

  npcIntent?: string;

  nextObjective?: string;

  hiddenThought?: string;

  sceneSummary?: string;

};



export type StatusMetaRecord = {

  meta: StatusMeta;

  extractedAt: string;

  source: "background-flash";

  pending?: boolean;

  /** User-note pipe-table template used for this extraction */

  formatSpec?: string | null;

  /** Flash 추출 최종 실패 — pending=false, meta 비어 있음 */

  failed?: boolean;

};



export const EMPTY_STATUS_META: StatusMeta = {

  tableMarkdown: "",

  datetime: "",

  location: "",

  relationship: "",

  npcEmotion: "",

  npcIntent: "",

  nextObjective: "",

  hiddenThought: "",

  sceneSummary: "",

};



export function normalizeStatusMeta(raw: unknown): StatusMeta {

  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const pick = (k: keyof StatusMeta) => {

    const v = o[k];

    return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";

  };

  return {

    tableMarkdown: pick("tableMarkdown"),

    datetime: pick("datetime"),

    location: pick("location"),

    relationship: pick("relationship"),

    npcEmotion: pick("npcEmotion"),

    npcIntent: pick("npcIntent"),

    nextObjective: pick("nextObjective"),

    hiddenThought: pick("hiddenThought"),

    sceneSummary: pick("sceneSummary"),

  };

}



export function parseStatusMetaRecord(raw: string | null | undefined): StatusMetaRecord | null {

  if (!raw?.trim()) return null;

  try {

    const parsed = JSON.parse(raw) as Partial<StatusMetaRecord>;

    if (!parsed || typeof parsed !== "object") return null;

    return {

      meta: normalizeStatusMeta(parsed.meta ?? parsed),

      extractedAt: typeof parsed.extractedAt === "string" ? parsed.extractedAt : "",

      source: "background-flash",

      pending: parsed.pending === true,

      formatSpec: typeof parsed.formatSpec === "string" ? parsed.formatSpec : null,

      failed: parsed.failed === true,

    };

  } catch {

    return null;

  }

}



export function serializeStatusMetaRecord(record: StatusMetaRecord): string {

  return JSON.stringify(record);

}



export function hasVisibleStatusMeta(meta: StatusMeta): boolean {

  if (meta.tableMarkdown?.trim()) return true;

  return (

    !!meta.datetime?.trim() ||

    !!meta.location?.trim() ||

    !!meta.relationship?.trim() ||

    !!meta.npcEmotion?.trim() ||

    !!meta.npcIntent?.trim() ||

    !!meta.nextObjective?.trim() ||

    !!meta.hiddenThought?.trim() ||

    !!meta.sceneSummary?.trim()

  );

}


