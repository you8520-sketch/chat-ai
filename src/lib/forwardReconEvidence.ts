import type { ForwardUnmatchedRequest } from "./forwardReconAudit";
import { createHash } from "node:crypto";

export function hashForwardRequestId(requestId: string): string {
  return createHash("sha256").update(requestId).digest("hex");
}

/** Exact captured billing IDs identify a measurement, never its approval or a ledger match. */
const MEASUREMENTS = [
  {
    "source": "https://github.com/you8520-sketch/chat-ai/tree/6cb5502048cd97844b0fff9f44a31d398eba8b6c/docs/audits/adult-off-output-guard/live",
    "date": "2026-10-19",
    "ids": [
      "16803788-946d-48f2-bdd1-3ed7ab82f522",
      "d0b3b11b-2ce6-402e-9703-419392c9a3c0",
      "7b710c18-2d42-4286-b16a-bcf468be1968",
      "d98bb301-4126-405b-9ed7-b8693e49965a",
      "63494d2d-4a9c-435f-a539-8eaa7c8df2f6",
      "d2927a93-670a-46e9-bb9e-25dda80f8504",
      "41f8000a-b6ef-458a-afac-885cfa0abe8e",
      "c971d06c-5bfa-45f4-b6a8-7cf9493feba1",
      "8908822f-2466-4445-b34e-184d390670d6",
      "1dea18ad-f769-4e6f-9c23-c28ecd2030ba",
      "53a489de-aef3-4a2a-84c2-e91e819197ea",
      "1a792587-5996-47e0-adbc-f32dba49a675",
      "8968d393-5350-4f56-9700-c94319def2e4",
      "8b443f89-3b36-4b80-81a5-c3847810f8ee",
      "2b8790d9-ad46-4496-a620-87635adf5f84",
      "0ab42532-3ad8-44a1-b6ee-36e32eb8f63b",
      "8e399dc2-dccb-42b7-89c9-82bd65d20f32",
      "d51489c9-512f-4f78-8587-cc144345e36f",
      "d6a6b72a-2898-404e-88e6-01f7c218b8b2"
    ]
  },
  {
    "source": "https://github.com/you8520-sketch/chat-ai/blob/4f95ea316afd61fcbe44a8f6afc513dc90a88f35/docs/audits/adult-off-output-guard/live/classifier-probe.json",
    "date": "2026-10-20",
    "ids": [
      "89312dd8-34db-43f3-86e7-ec38e90a8399",
      "8dd35dbf-517d-481a-8cd2-8426f0b548d0",
      "a1aef213-d52c-4aa8-b796-4f35ddc9880b",
      "869a7783-1980-4b4c-a7b8-be3598b91d70",
      "b38fff44-e438-477a-b4f0-ed73669f2c57",
      "eb080957-3cec-4f49-bba0-9b33da74aba1",
      "62457b2f-6974-4d55-ad5c-8eee2d84039e",
      "8bdf3822-9950-4c4a-b088-66aaa1b0503c",
      "2518d482-578f-497c-8a57-c2f41a72b541",
      "f66c597d-a4df-41c0-b713-98a3bf6e909a",
      "31cfc172-5239-4e4d-b83d-273e4f71b0bd",
      "8d28ada2-d460-4602-9cbd-a241bba18dab",
      "e36d88a3-369e-490f-b965-86ab67ae2ce6",
      "3fb91145-0b9f-4b0c-8343-38a58ae1e1b6",
      "a9fec12c-b296-447e-8084-82e6fe36d33f",
      "91987d1a-bf97-4561-8cec-894c53edc371",
      "35d9c194-0da2-4007-9562-183a0e65b0ef",
      "94f91dfd-ddf6-476f-9ab1-61871f443e98",
      "45c74f17-98ba-427c-9eee-195a2c62ff22",
      "754f1ae6-0f2c-41dc-9c61-1733a08ca12a",
      "823c578e-98ac-492f-bb54-b3db63080426",
      "0ca285bf-21e9-4141-b83f-55afa2c3d195",
      "af413b6c-b703-465e-aa20-0561153c9525",
      "e1afe899-f874-4d5a-a174-1a7fdee036f6",
      "6b826d4e-5356-4f0a-b347-fb6933d20f8c",
      "558eae12-f800-4292-952b-c0fc8dd60998",
      "1d6ba9f8-c4bb-4a47-b181-22f4a8966eb6",
      "bcb9e4f0-8d70-4cd7-aadc-62461fdcbc43"
    ]
  }
] as const;

const MEASUREMENT_HASHES = MEASUREMENTS.map(group => ({
  source: group.source, date: group.date, hashes: new Set(group.ids.map(hashForwardRequestId)),
}));

export function identifiedForwardMeasurement(row: ForwardUnmatchedRequest): string | null {
  if (row.scope !== "undetermined" || row.model !== "gpt-6-luna") return null;
  for (const group of MEASUREMENT_HASHES) {
    if (row.createdAt.startsWith(group.date) && group.hashes.has(row.requestHash)) return group.source;
  }
  return null;
}
