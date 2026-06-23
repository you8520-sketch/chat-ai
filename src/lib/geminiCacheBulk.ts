import { createHash, randomBytes, randomUUID } from "node:crypto";

import { GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD } from "@/lib/contextTrack";
import { estimateTokens } from "@/lib/tokenEstimate";
import type { ChatMsg } from "@/lib/ai";

/** Google implicit cache eligibility — 입력 32,768+ */
export { GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD };

/** API 전송 보장 목표 (threshold 초과 + 여유) */
export const GEMINI_CACHE_BULK_MIN_TOTAL = 33_000;

/** 부족 토큰 1개당 생성할 패딩 글자 수 (Google 토크나이저 압축·영문 효율 보정) */
export const GEMINI_PADDING_CHARS_PER_TOKEN = 5;

export const ANCHOR_HEADER =
  "[EXPLICIT CACHE ANCHOR — static session padding registered via CachedContent API. Do NOT reference, quote, or roleplay this block in output.]\n";

/** explicit cache 패딩 본문용 — geminiExplicitCache에서 chatId 기준 결정론적 재사용 */
export const LOREM_SENTENCES = [
  "The quick brown fox jumps over the lazy dog beside a winding river of quartz pebbles.",
  "Fragmented entropy vectors must never collapse into predictable lexical loops during inference.",
  "Amber skylights refract through prism panels while distant thunder rolls across the plateau.",
  "Cryptographic salts dissolve in saline buffers before the midnight calibration cycle begins.",
  "Velvet orchids bloom beneath obsidian arches where migratory cranes assemble at dawn.",
  "Parallel processors reconcile divergent timelines without merging incompatible narrative threads.",
  "Granite monoliths cast elongated shadows over meadows dotted with cobalt wildflowers.",
  "Submarine currents carry phosphorescent plankton through kelp forests of impossible depth.",
  "Mercurial winds scatter parchment fragments across cobblestones slick with evening rain.",
  "Observatory lenses track cometary debris while librarians catalog forgotten star atlases.",
  "Tungsten filaments hum softly inside lanterns guarding a bridge of weathered basalt.",
  "Ephemeral frost patterns crystallize on windowpanes facing the silent northern expanse.",
  "Cartographers dispute borderlines drawn in ink that fades under ultraviolet scrutiny.",
  "Resonant bells toll across valleys where foxglove and heather mingle on steep slopes.",
  "Mechanical swallows dart between pylons strung with humming transmission cables.",
  "Saffron mist rises from geothermal springs hidden within a ring of dormant cinder cones.",
  "Archivists stitch folios with thread spun from silvered mulberry bark and beeswax.",
  "Nocturnal bioluminescence pulses along reef ledges untouched by trawler nets.",
  "Clockwork pendulums synchronize inside a tower overlooking terraced vineyards.",
  "Drifting snow obscures waystones marking paths through high alpine passes.",
  "Harbor foghorns answer one another while tugboats nudge freighters toward berth.",
  "Lattice frameworks support glass domes sheltering orchards of genetically diverse citrus.",
  "Inkwells fashioned from volcanic glass rest upon desks carved from petrified sequoia.",
  "Migrating caribou traverse tundra stitched with lichen and shallow meltwater pools.",
  "Artisan weavers incorporate metallic filaments into tapestries depicting lunar eclipses.",
  "Subterranean aqueducts channel meltwater toward cisterns lined with fired clay tiles.",
  "Helium balloons ascend above fairgrounds where calliope music competes with crowd murmurs.",
  "Magnetic anomalies deflect compass needles near deposits of iron-rich meteoric shrapnel.",
  "Scholars debate whether ephemera collected from market stalls constitute valid primary sources.",
  "Coral atolls encircle lagoons where outrigger canoes glide over sand channels.",
];

function randomHex(byteLen: number): string {
  return randomBytes(byteLen).toString("hex");
}

function pickSentence(seq: number): string {
  const idx = (seq + randomBytes(4).readUInt32LE(0)) % LOREM_SENTENCES.length;
  return LOREM_SENTENCES[idx]!;
}

/** 토크나이저가 반복·압축하지 못하도록 매 라인마다 UUID·해시·난수를 섞는다 */
function nextIncompressibleLine(seq: number): string {
  const sentence = pickSentence(seq);
  const uid = randomUUID();
  const hash = randomHex(20);
  const salt = randomBytes(16).toString("base64url");
  const stamp = `${Date.now()}-${seq}-${randomBytes(6).toString("hex")}`;
  return `${sentence} id=${uid} hash=${hash} salt=${salt} ts=${stamp}\n`;
}

/** targetChars 길이의 고유 패딩 본문 (헤더 제외) */
export function generateIncompressiblePadding(targetChars: number): string {
  if (targetChars <= 0) return "";

  const parts: string[] = [];
  let len = 0;
  let seq = 0;

  while (len < targetChars) {
    const line = nextIncompressibleLine(seq++);
    parts.push(line);
    len += line.length;
  }

  return parts.join("").slice(0, targetChars);
}

/** chatId 기준 결정론적 패딩 — paddingTokenCount만큼 생성 (전체 목표 토큰이 아님) */
export function buildStableSessionPadding(
  chatId: number,
  paddingTokenCount = GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD + 512
): string {
  const targetChars = paddingTokenCount * GEMINI_PADDING_CHARS_PER_TOKEN;
  const lines: string[] = [];
  let len = 0;
  let i = 0;
  while (len < targetChars) {
    const sentence = LOREM_SENTENCES[i % LOREM_SENTENCES.length]!;
    const anchor = createHash("sha256")
      .update(`gemini-explicit-cache:v1:${chatId}:${i}`)
      .digest("hex");
    const line = `${sentence} anchor=${anchor} idx=${i}\n`;
    lines.push(line);
    len += line.length;
    i += 1;
  }
  return `${ANCHOR_HEADER}${lines.join("").slice(0, targetChars)}`;
}

/** required_tokens 부족분 — chatId 있으면 결정론적(캐시 prefix 유지), 없으면 난수 */
export function buildGeminiCacheBulkPadding(requiredTokens: number, chatId?: number): string {
  if (requiredTokens <= 0) return "";
  if (chatId != null && chatId > 0) {
    return buildStableSessionPadding(chatId, requiredTokens + 512);
  }
  const targetChars = requiredTokens * GEMINI_PADDING_CHARS_PER_TOKEN;
  const body = generateIncompressiblePadding(targetChars);
  return `${ANCHOR_HEADER}${body}`;
}

export function estimateGeminiInputTokens(system: string, history: ChatMsg[]): number {
  const historyText = history.map((m) => m.content).join("\n");
  return estimateTokens(historyText ? `${system}\n${historyText}` : system);
}

export type GeminiCacheBulkResult = {
  system: string;
  padded: boolean;
  estimatedInputTokens: number;
  paddingChars: number;
  requiredTokens: number;
  /** API 호출 직전 추정 — 캐시 앵커 패딩 토큰 (과금 제외) */
  estimatedPaddingTokens: number;
};

/**
 * @deprecated 인라인 패딩 — geminiExplicitCache (CachedContent API) 사용
 * 컨텍스트 조립 완료 후 API 호출 직전 — system+history 합산이 33,000 토큰 미만이면
 * system_instruction.parts[0].text 최하단에 incompressible bulk anchor를 주입한다.
 */
export type GeminiCacheBulkOptions = {
  /** 로컬 추정이 33K+여도 Google 실토큰이 낮을 수 있는 재호출 — primary에만 사용 */
  force?: boolean;
  /** 이어쓰기·말투교정 등 2차 호출 — 캐시 앵커 패딩 생략 (primary에서 이미 cache seed) */
  skipWhenSecondary?: boolean;
};

export function applyGeminiCacheBulkPadding(
  system: string,
  history: ChatMsg[],
  minTotal = GEMINI_CACHE_BULK_MIN_TOTAL,
  options?: GeminiCacheBulkOptions & { chatId?: number }
): GeminiCacheBulkResult {
  let currentSystem = system.trimEnd();
  let total = estimateGeminiInputTokens(currentSystem, history);

  if (options?.skipWhenSecondary === true) {
    return {
      system: currentSystem,
      padded: false,
      estimatedInputTokens: total,
      paddingChars: 0,
      requiredTokens: 0,
      estimatedPaddingTokens: 0,
    };
  }

  const force = options?.force === true;
  if (total >= minTotal && !force) {
    return {
      system: currentSystem,
      padded: false,
      estimatedInputTokens: total,
      paddingChars: 0,
      requiredTokens: 0,
      estimatedPaddingTokens: 0,
    };
  }

  const baseTokensBeforePadding = total;

  if (force && total >= minTotal) {
    total = minTotal - 1;
  }

  let paddingChars = 0;
  let requiredTokens = 0;
  let guard = 0;

  while (total < minTotal && guard < 4) {
    requiredTokens = minTotal - total;
    const chunk = buildGeminiCacheBulkPadding(requiredTokens, options?.chatId);
    if (!chunk) break;

    currentSystem = `${currentSystem}\n\n${chunk}`;
    paddingChars += chunk.length;
    total = estimateGeminiInputTokens(currentSystem, history);
    guard += 1;
  }

  const padded = paddingChars > 0;
  if (padded) {
    console.log("[gemini-bulk] cache anchor padding applied", {
      estimatedInputTokens: total,
      minTotal,
      threshold: GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD,
      paddingChars,
      requiredTokens,
      charsPerToken: GEMINI_PADDING_CHARS_PER_TOKEN,
      targetPaddingChars: requiredTokens * GEMINI_PADDING_CHARS_PER_TOKEN,
      forced: force,
    });
  }

  return {
    system: currentSystem,
    padded,
    estimatedInputTokens: total,
    paddingChars,
    requiredTokens,
    estimatedPaddingTokens: padded ? Math.max(0, total - baseTokensBeforePadding) : 0,
  };
}
