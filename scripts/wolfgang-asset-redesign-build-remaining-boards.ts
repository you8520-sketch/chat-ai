import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DOC = path.join(process.cwd(), "docs/official-supply/reviews/assets/wolfgang-asset-redesign");
const ART = "/opt/cursor/artifacts";

type Box = { left: number; top: number; width: number; height: number };
type Shot = { id: string; tag: string; file: string; face: Box; hair: Box; fur: Box; armor: Box };

const shots: Shot[] = [
  {
    id: "sig1",
    tag: "지도를 짚음",
    file: "sig1-map-f-raw.webp",
    face: { left: 500, top: 180, width: 420, height: 340 },
    hair: { left: 500, top: 0, width: 420, height: 180 },
    fur: { left: 980, top: 80, width: 420, height: 320 },
    armor: { left: 740, top: 540, width: 420, height: 280 },
  },
  {
    id: "sig2",
    tag: "턱을 괴고 생각",
    file: "sig2-chin-f-raw.webp",
    face: { left: 430, top: 20, width: 340, height: 300 },
    hair: { left: 400, top: 0, width: 220, height: 120 },
    fur: { left: 760, top: 180, width: 360, height: 280 },
    armor: { left: 430, top: 300, width: 380, height: 300 },
  },
  {
    id: "sig3",
    tag: "열쇠를 확인함",
    file: "sig3-key-f-raw.webp",
    face: { left: 500, top: 30, width: 380, height: 340 },
    hair: { left: 520, top: 0, width: 360, height: 160 },
    fur: { left: 980, top: 160, width: 400, height: 300 },
    armor: { left: 520, top: 400, width: 420, height: 320 },
  },
  {
    id: "emo1",
    tag: "의심",
    file: "emo1-doubt-f-raw.webp",
    face: { left: 180, top: 40, width: 460, height: 400 },
    hair: { left: 220, top: 0, width: 420, height: 180 },
    fur: { left: 900, top: 200, width: 420, height: 300 },
    armor: { left: 520, top: 540, width: 420, height: 280 },
  },
  {
    id: "emo3",
    tag: "진지함",
    file: "emo3-serious-f-raw.webp",
    face: { left: 430, top: 70, width: 340, height: 280 },
    hair: { left: 500, top: 0, width: 240, height: 110 },
    fur: { left: 710, top: 220, width: 220, height: 180 },
    armor: { left: 400, top: 360, width: 360, height: 300 },
  },
  {
    id: "emo4",
    tag: "당황",
    file: "emo4-fluster-f-raw.webp",
    face: { left: 420, top: 80, width: 480, height: 400 },
    hair: { left: 480, top: 0, width: 460, height: 180 },
    fur: { left: 40, top: 200, width: 360, height: 280 },
    armor: { left: 340, top: 700, width: 560, height: 300 },
  },
  {
    id: "emo5",
    tag: "편안함",
    file: "emo5-ease-f-raw.webp",
    face: { left: 430, top: 40, width: 320, height: 280 },
    hair: { left: 520, top: 0, width: 240, height: 100 },
    fur: { left: 690, top: 220, width: 150, height: 160 },
    armor: { left: 400, top: 340, width: 360, height: 300 },
  },
  {
    id: "scene1",
    tag: "문서를 대조함",
    file: "scene1-docs-f-raw.webp",
    face: { left: 720, top: 40, width: 380, height: 320 },
    hair: { left: 760, top: 0, width: 340, height: 150 },
    fur: { left: 1080, top: 150, width: 400, height: 300 },
    armor: { left: 620, top: 380, width: 400, height: 300 },
  },
  {
    id: "scene2",
    tag: "기록을 맞춤",
    file: "scene2-records-f-raw.webp",
    face: { left: 420, top: 30, width: 340, height: 280 },
    hair: { left: 450, top: 0, width: 300, height: 140 },
    fur: { left: 200, top: 180, width: 320, height: 240 },
    armor: { left: 400, top: 320, width: 360, height: 280 },
  },
  {
    id: "scene3",
    tag: "긴장",
    file: "scene3-tense-f-raw.webp",
    face: { left: 640, top: 40, width: 360, height: 300 },
    hair: { left: 800, top: 30, width: 200, height: 80 },
    fur: { left: 360, top: 100, width: 340, height: 260 },
    armor: { left: 520, top: 360, width: 380, height: 300 },
  },
];

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function labeled(buf: Buffer, label: string, width: number, height: number) {
  const bar = await sharp({ create: { width, height: 28, channels: 3, background: "#111111" } })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="28"><text x="6" y="19" font-size="14" fill="#ffffff" font-family="sans-serif">${label}</text></svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  return sharp({ create: { width, height: height + 28, channels: 3, background: "#000" } })
    .composite([
      { input: bar, top: 0, left: 0 },
      { input: buf, top: 28, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function row(items: Array<{ label: string; buf: Buffer; width: number; height: number }>) {
  const cells = await Promise.all(items.map((item) => labeled(item.buf, item.label, item.width, item.height)));
  const width = items.reduce((sum, item) => sum + item.width, 0);
  const height = Math.max(...items.map((item) => item.height)) + 28;
  let left = 0;
  const placed = items.map((item, index) => {
    const out = { input: cells[index]!, top: 0, left };
    left += item.width;
    return out;
  });
  return sharp({ create: { width, height, channels: 3, background: "#000" } }).composite(placed).webp({ quality: 86 }).toBuffer();
}

async function partBoard(part: "face" | "hair" | "fur" | "armor") {
  const items = [];
  for (const shot of shots) {
    const box = shot[part];
    const buf = await sharp(path.join(DOC, shot.file)).extract(box).webp({ quality: 90 }).toBuffer();
    items.push({ label: `${shot.id} ${box.width}x${box.height}`, buf, width: box.width, height: box.height });
  }
  const image = await row(items);
  const file = `compare-remaining-10-${part}.webp`;
  fs.writeFileSync(path.join(DOC, file), image);
  fs.writeFileSync(path.join(ART, file), image);
  return { file, sha256: sha256(image), bytes: image.length };
}

async function labelBar(text: string, width: number): Promise<Buffer> {
  const svg = `<svg width="${width}" height="40"><rect width="100%" height="100%" fill="#111111"/><text x="10" y="27" font-size="20" fill="#ffffff" font-family="WenQuanYi Micro Hei, sans-serif">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function grid(cards: Array<{ label: string; file: string; portrait?: boolean }>, columns: number, fileName: string) {
  const cellW = 460;
  const cellH = 307;
  const labelH = 40;
  const gap = 10;
  const rows = Math.ceil(cards.length / columns);
  const width = columns * cellW + (columns - 1) * gap;
  const height = rows * (cellH + labelH) + (rows - 1) * gap;
  const placed = [];
  for (const [index, card] of cards.entries()) {
    const column = index % columns;
    const rowIndex = Math.floor(index / columns);
    const fitted = await sharp(path.join(DOC, card.file))
      .resize(cellW, cellH, { fit: "contain", background: "#111111" })
      .png()
      .toBuffer();
    const left = column * (cellW + gap);
    const top = rowIndex * (cellH + labelH + gap);
    placed.push({ input: await labelBar(card.label, cellW), left, top });
    placed.push({ input: fitted, left, top: top + labelH });
  }
  const image = await sharp({ create: { width, height, channels: 3, background: "#000000" } })
    .composite(placed)
    .webp({ quality: 86 })
    .toBuffer();
  fs.writeFileSync(path.join(DOC, fileName), image);
  fs.writeFileSync(path.join(ART, fileName), image);
}

async function fourteen() {
  await grid(
    [
      { label: "기본 초상", file: "rep-f-raw.webp", portrait: true },
      { label: "지도를 짚음", file: "sig1-map-f-raw.webp" },
      { label: "턱을 괴고 생각", file: "sig2-chin-f-raw.webp" },
      { label: "열쇠를 확인함", file: "sig3-key-f-raw.webp" },
      { label: "옅은 미소", file: "sig4-smile-f-raw.webp" },
      { label: "의심", file: "emo1-doubt-f-raw.webp" },
      { label: "분노", file: "emo2-anger-f-raw.webp" },
      { label: "진지함", file: "emo3-serious-f-raw.webp" },
      { label: "당황", file: "emo4-fluster-f-raw.webp" },
      { label: "편안함", file: "emo5-r2-raw.webp" },
      { label: "안도", file: "emo6-r2-raw.webp" },
      { label: "문서를 대조함", file: "scene1-docs-f-raw.webp" },
      { label: "기록을 맞춤", file: "scene2-records-f-raw.webp" },
      { label: "긴장", file: "scene3-tense-f-raw.webp" },
    ],
    4,
    "compare-14-candidates.webp"
  );
  await grid(
    [
      { label: "새 편안함", file: "emo5-r2-raw.webp" },
      { label: "기존 편안함", file: "emo5-ease-f-raw.webp" },
      { label: "진지함", file: "emo3-serious-f-raw.webp" },
      { label: "옅은 미소", file: "sig4-smile-f-raw.webp" },
      { label: "안도", file: "emo6-r2-raw.webp" },
    ],
    5,
    "compare-ease-r2.webp"
  );
}

type Actual = {
  promptSha256?: string;
  primaryPromptSha256?: string;
  sentPromptSha256?: string;
  providerRequestId?: string;
  costUsd?: number;
  raw?: { sha256?: string; bytes?: number };
};

const CANDIDATES: Array<{
  slot: string;
  tag: string;
  file: string;
  actual: string;
  sentField: "promptSha256" | "primaryPromptSha256" | "sentPromptSha256";
  role: "candidate" | "history";
}> = [
  { slot: "rep", tag: "기본 초상", file: "rep-f-raw.webp", actual: "rep-f-actual.json", sentField: "promptSha256", role: "candidate" },
  { slot: "sig1", tag: "지도를 짚음", file: "sig1-map-f-raw.webp", actual: "sig1-map-f-actual.json", sentField: "sentPromptSha256", role: "candidate" },
  { slot: "sig2", tag: "턱을 괴고 생각", file: "sig2-chin-f-raw.webp", actual: "sig2-chin-f-actual.json", sentField: "sentPromptSha256", role: "candidate" },
  { slot: "sig3", tag: "열쇠를 확인함", file: "sig3-key-f-raw.webp", actual: "sig3-key-f-actual.json", sentField: "sentPromptSha256", role: "candidate" },
  { slot: "sig4", tag: "옅은 미소", file: "sig4-smile-f-raw.webp", actual: "sig4-smile-f-actual.json", sentField: "promptSha256", role: "candidate" },
  { slot: "emo1", tag: "의심", file: "emo1-doubt-f-raw.webp", actual: "emo1-doubt-f-actual.json", sentField: "sentPromptSha256", role: "candidate" },
  { slot: "emo2", tag: "분노", file: "emo2-anger-f-raw.webp", actual: "emo2-anger-f-actual.json", sentField: "primaryPromptSha256", role: "candidate" },
  { slot: "emo3", tag: "진지함", file: "emo3-serious-f-raw.webp", actual: "emo3-serious-f-actual.json", sentField: "sentPromptSha256", role: "candidate" },
  { slot: "emo4", tag: "당황", file: "emo4-fluster-f-raw.webp", actual: "emo4-fluster-f-actual.json", sentField: "sentPromptSha256", role: "candidate" },
  { slot: "emo5", tag: "편안함", file: "emo5-r2-raw.webp", actual: "emo5-r2-actual.json", sentField: "primaryPromptSha256", role: "candidate" },
  { slot: "emo6", tag: "안도", file: "emo6-r2-raw.webp", actual: "emo6-r2-actual.json", sentField: "primaryPromptSha256", role: "candidate" },
  { slot: "scene1", tag: "문서를 대조함", file: "scene1-docs-f-raw.webp", actual: "scene1-docs-f-actual.json", sentField: "sentPromptSha256", role: "candidate" },
  { slot: "scene2", tag: "기록을 맞춤", file: "scene2-records-f-raw.webp", actual: "scene2-records-f-actual.json", sentField: "sentPromptSha256", role: "candidate" },
  { slot: "scene3", tag: "긴장", file: "scene3-tense-f-raw.webp", actual: "scene3-tense-f-actual.json", sentField: "sentPromptSha256", role: "candidate" },
  { slot: "emo5-r1", tag: "편안함", file: "emo5-ease-f-raw.webp", actual: "emo5-ease-f-actual.json", sentField: "sentPromptSha256", role: "history" },
  { slot: "emo6-r1", tag: "안도", file: "emo6-relief-f-raw.webp", actual: "emo6-relief-f-actual.json", sentField: "primaryPromptSha256", role: "history" },
];

function usd(value: number): number {
  return Number(value.toFixed(6));
}

function candidateList() {
  const smileOwner = JSON.parse(fs.readFileSync(path.join(DOC, "sig4-smile-f-owner-request.json"), "utf8")) as {
    primaryPromptSha256?: string;
  };
  const rows = CANDIDATES.map((row) => {
    const actual = JSON.parse(fs.readFileSync(path.join(DOC, row.actual), "utf8")) as Actual;
    const sent = actual[row.sentField];
    const rawSha = actual.raw?.sha256;
    if (!sent || !rawSha || actual.providerRequestId == null || actual.costUsd == null) {
      throw new Error(`incomplete actual ${row.actual}`);
    }
    const fileSha = sha256(fs.readFileSync(path.join(DOC, row.file)));
    if (fileSha !== rawSha) throw new Error(`raw file sha mismatch ${row.file}`);
    const entry: Record<string, unknown> = {
      slot: row.slot,
      tag: row.tag,
      role: row.role,
      file: row.file,
      rawSha256: rawSha,
      sentPromptSha256: sent,
      sentPromptSource: `${row.actual} ${row.sentField}`,
      providerRequestId: actual.providerRequestId,
      costUsd: usd(actual.costUsd),
    };
    if (row.slot === "sig4") {
      entry.laterOwnerAssemblyPromptSha256 = smileOwner.primaryPromptSha256;
      entry.laterAssemblyIsNotTheSentCall = true;
    }
    if (row.slot === "rep") entry.internalName = "F";
    if (row.slot === "emo5" || row.slot === "emo6") entry.revision = "r2";
    if (row.slot === "emo5-r1") entry.notTheFinalEmo5Candidate = true;
    if (row.slot === "emo6-r1") entry.notTheFinalEmo6Candidate = true;
    return entry;
  });
  const candidates = rows.filter((row) => row.role === "candidate");
  const history = rows.filter((row) => row.role === "history");
  const tenLedger = JSON.parse(fs.readFileSync(path.join(DOC, "remaining-10-f-ledger.json"), "utf8")) as {
    postsCompleted: number;
    spentUsd: number;
  };
  const emo5r2 = candidates.find((row) => row.slot === "emo5");
  const text = `${JSON.stringify(
    {
      pipeline: "composeOfficialSlotGeneration + prepareOfficialImageReferences + callOpenAiImageEdit",
      model: "gpt-image-2.5-sunburst",
      settings: { size: "1536x1024", quality: "medium", n: 1, outputFormat: "webp", outputCompression: 88, background: "opaque" },
      note: "User tag for the representative is 기본 초상. F is the internal candidate name. The representative file is the earlier 1024x1536 generation. emo5 and emo6 candidates are the r2 files. Sent hashes are copied from each call actual.",
      candidates,
      history,
      tenSlotRunPosts: tenLedger.postsCompleted,
      tenSlotRunCostUsd: usd(tenLedger.spentUsd),
      emo5r2Posts: 1,
      emo5r2CostUsd: usd(Number(emo5r2?.costUsd ?? 0)),
      emo5r2BudgetUsd: 0.08,
      qualityReview: "not started; candidate submission only",
      persistedToProduction: false,
    },
    null,
    2,
  )}\n`;
  fs.writeFileSync(path.join(DOC, "fourteen-f-candidates.json"), text);
  fs.writeFileSync(path.join(ART, "fourteen-f-candidates.json"), text);
}

async function main() {
  const parts = {
    face: await partBoard("face"),
    hair: await partBoard("hair"),
    fur: await partBoard("fur"),
    armor: await partBoard("armor"),
  };
  await fourteen();
  const text = `${JSON.stringify({ scale: "1:1 extract", shots, parts }, null, 2)}\n`;
  fs.writeFileSync(path.join(DOC, "compare-remaining-10-windows.json"), text);
  fs.writeFileSync(path.join(ART, "compare-remaining-10-windows.json"), text);
  candidateList();
  console.log("boards");
}

main();
