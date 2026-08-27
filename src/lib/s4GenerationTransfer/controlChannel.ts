/**
 * S4 control-channel parse/strip — reuses the status-widget tail-stripping pattern.
 * ONE stream sanitizer owner: integrated via stripAllStatusWindowOutputArtifacts.
 */

import {
  S4_TRANSFER_BLOCK,
  S4_TRANSFER_END,
  S4_MAX_TRANSFER_EVENTS,
  type S4ParsedTransferEnvelope,
  type S4StructuredTransferEvent,
} from "./types";

const S4_PARTIAL_MARKER_RE =
  /\n?<<<\s*(?:S4(?:_KNOWLEDGE(?:_TRANSFER)?)?(?:\s*>>>?)?)?\s*$/i;

function parseTransferEnvelopeJson(raw: string): S4ParsedTransferEnvelope | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const nonce = typeof parsed.nonce === "string" ? parsed.nonce.trim() : "";
    if (!nonce || nonce.length > 64) return null;
    const rawEvents = parsed.events;
    if (!Array.isArray(rawEvents)) return null;
    const events: S4StructuredTransferEvent[] = [];
    for (const item of rawEvents.slice(0, S4_MAX_TRANSFER_EVENTS)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const factRef = String(row.factRef ?? "").trim();
      const receiverRef = String(row.receiverRef ?? "").trim();
      const transferType = String(row.transferType ?? "");
      const completed = row.completed === true;
      const proofText = String(row.proofText ?? "").trim();
      if (!factRef || !receiverRef) continue;
      if (transferType !== "DIRECT_STATEMENT") continue;
      events.push({ factRef, receiverRef, transferType: "DIRECT_STATEMENT", completed, proofText });
    }
    return { nonce, events };
  } catch {
    return null;
  }
}

function extractBlock(text: string, start: string, end: string): { before: string; inner: string; after: string } | null {
  const startIdx = text.indexOf(start);
  if (startIdx < 0) return null;
  const innerStart = startIdx + start.length;
  const endIdx = text.indexOf(end, innerStart);
  if (endIdx < 0) return null;
  return {
    before: text.slice(0, startIdx),
    inner: text.slice(innerStart, endIdx).trim(),
    after: text.slice(endIdx + end.length),
  };
}

/** Streaming/finalize — strip incomplete S4 tail (partial markers, unclosed block). */
export function stripIncompleteS4TransferTail(text: string): string {
  let work = text.trimEnd();

  const idx = work.indexOf(S4_TRANSFER_BLOCK);
  if (idx >= 0) {
    const tail = work.slice(idx);
    if (!tail.includes(S4_TRANSFER_END)) {
      work = work.slice(0, idx).trimEnd();
    }
  }

  const looseMatch = work.match(/<<<S4_KNOWLEDGE_TRANSFER>>>/i);
  if (looseMatch?.index != null) {
    const tail = work.slice(looseMatch.index);
    if (!tail.includes(S4_TRANSFER_END)) {
      work = work.slice(0, looseMatch.index).trimEnd();
    }
  }

  const partial = work.match(S4_PARTIAL_MARKER_RE);
  if (partial?.index != null) {
    work = work.slice(0, partial.index).trimEnd();
  }
  work = work.replace(/<<<\s*$/, "").trimEnd();

  return work;
}

function stripTrailingS4Markers(text: string): string {
  let work = text.trimEnd();
  const looseMatch = work.match(/<<<S4_KNOWLEDGE_TRANSFER>>>/i);
  if (looseMatch?.index != null) {
    work = work.slice(0, looseMatch.index).trimEnd();
  }
  return work;
}

/** Extract S4 envelope from raw model text and return prose without the block. */
export function splitProseAndS4TransferEnvelope(fullText: string): {
  prose: string;
  envelope: S4ParsedTransferEnvelope | null;
} {
  const block = extractBlock(fullText, S4_TRANSFER_BLOCK, S4_TRANSFER_END);
  if (!block) {
    return { prose: stripTrailingS4Markers(fullText.trim()), envelope: null };
  }
  const envelope = parseTransferEnvelopeJson(block.inner);
  const prose = stripTrailingS4Markers((block.before + block.after).trim());
  return { prose, envelope };
}

/** Capture envelope without mutating prose (finalize path uses pre-partition raw text). */
export function captureS4TransferEnvelopeFromModelText(text: string): S4ParsedTransferEnvelope | null {
  return splitProseAndS4TransferEnvelope(text).envelope;
}
