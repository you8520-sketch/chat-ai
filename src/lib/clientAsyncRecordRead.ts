import {
  resolveActiveAssistantGenerationScopeFromRow,
  resolveCurrentGenerationAsyncRecord,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import { parseStatusMetaRecord, type StatusMetaRecord } from "@/lib/statusMeta/types";
import { parseSuggestedRepliesRecord } from "@/lib/suggestedReplies/parse";
import type { SuggestedRepliesRecord } from "@/lib/suggestedReplies/types";

/** Message row fields required to resolve active generation and async logical records. */
export type ClientAsyncRecordMessageRow = {
  id: number;
  alternates: string | null;
  active_variant: number | null;
  request_id: string | null;
  generation_status: string | null;
  content: string;
  model: string;
  usage: string | null;
  status_meta: string | null;
  suggested_replies_json: string | null;
};

/** Canonical client read owner for generation-scoped async logical records. */
export function resolveClientAsyncRecordsFromMessageRow(row: ClientAsyncRecordMessageRow): {
  generationScope: AssistantGenerationScope | null;
  statusRecord: StatusMetaRecord | null;
  suggestedRepliesRecord: SuggestedRepliesRecord | null;
} {
  const generationScope = resolveActiveAssistantGenerationScopeFromRow(row);
  const rawStatus = parseStatusMetaRecord(row.status_meta);
  const rawSuggested = parseSuggestedRepliesRecord(row.suggested_replies_json);
  return {
    generationScope,
    statusRecord: resolveCurrentGenerationAsyncRecord(rawStatus, generationScope),
    suggestedRepliesRecord: resolveCurrentGenerationAsyncRecord(rawSuggested, generationScope),
  };
}
