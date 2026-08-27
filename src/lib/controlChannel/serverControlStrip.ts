/**
 * ONE shared server-control strip owner — S4 always; status per existing policy.
 */

import {
  projectStreamVisibleWithoutIncompleteControlMarkers,
  type ControlBlockMarker,
} from "./incompleteMarkerSuffix";
import {
  STATUS_VALUES_BLOCK,
  STATUS_VALUES_CHAR_BLOCK,
  STATUS_VALUES_END,
  STATUS_VALUES_USER_BLOCK,
} from "@/lib/statusWidget/parseValues";
import { splitProseAndS4TransferEnvelope } from "@/lib/s4GenerationTransfer/controlChannel";
import { S4_TRANSFER_BLOCK, S4_TRANSFER_END } from "@/lib/s4GenerationTransfer/types";

export const SERVER_CONTROL_START_MARKERS = [
  S4_TRANSFER_BLOCK,
  STATUS_VALUES_CHAR_BLOCK,
  STATUS_VALUES_USER_BLOCK,
  STATUS_VALUES_BLOCK,
] as const;

export const SERVER_CONTROL_BLOCKS: ControlBlockMarker[] = [
  { start: S4_TRANSFER_BLOCK, end: S4_TRANSFER_END },
  { start: STATUS_VALUES_CHAR_BLOCK, end: STATUS_VALUES_END },
  { start: STATUS_VALUES_USER_BLOCK, end: STATUS_VALUES_END },
  { start: STATUS_VALUES_BLOCK, end: STATUS_VALUES_END },
];

/** S4 + status incomplete tails — shared streaming primitive. */
export function stripIncompleteServerControlTails(raw: string): string {
  return projectStreamVisibleWithoutIncompleteControlMarkers(raw, {
    startMarkers: SERVER_CONTROL_START_MARKERS,
    blocks: SERVER_CONTROL_BLOCKS,
  });
}

/** Always-on S4 server-control removal (stream + save). Status blocks untouched. */
export function stripS4ServerControlFromText(raw: string): string {
  const withoutIncomplete = projectStreamVisibleWithoutIncompleteControlMarkers(raw, {
    startMarkers: [S4_TRANSFER_BLOCK],
    blocks: [{ start: S4_TRANSFER_BLOCK, end: S4_TRANSFER_END }],
  });
  return splitProseAndS4TransferEnvelope(withoutIncomplete).prose;
}
