import crypto from "crypto";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import { OPENROUTER_GEMINI_31_FLASH_MODEL } from "@/lib/chatModels";

export const APPEARANCE_COMPILED_VERSION = 1;
export const DEEPSEEK_APPEARANCE_VARIATION_RULE =
  "외형·복식의 설명형 키워드는 의미를 반영해 자연스럽게 변주하되, 인명·고유명·정식 명칭은 유지한다.";

export type AppearanceCompiledJson = {
  body: string;
  hair: string;
  eyes: string;
  face: string;
  lips_makeup: string;
  clothing: string;
  impression: string;
  compiled_text: string;
};

const KEYS: (keyof AppearanceCompiledJson)[] = [
  "body",
  "hair",
  "eyes",
  "face",
  "lips_makeup",
  "clothing",
  "impression",
  "compiled_text",
];

export function normalizeAppearanceRaw(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function hashAppearanceRaw(raw: string, version = APPEARANCE_COMPILED_VERSION): string {
  return crypto.createHash("sha256").update(`v${version}\n${normalizeAppearanceRaw(raw)}`).digest("hex");
}

export function emptyAppearanceCompiled(): AppearanceCompiledJson {
  return { body: "", hair: "", eyes: "", face: "", lips_makeup: "", clothing: "", impression: "", compiled_text: "" };
}

export function clampAppearanceCompiledText(text: string, raw: string): string {
  const normalizedRawLength = normalizeAppearanceRaw(raw).length;
  const maxLength = Math.min(1200, Math.max(120, Math.ceil(normalizedRawLength * 2)));
  const trimmed = text.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trimEnd() : trimmed;
}

export function validateAppearanceCompiledJson(value: unknown, rawForLength = ""): AppearanceCompiledJson | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = emptyAppearanceCompiled();
  for (const key of KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v !== "string") return null;
    out[key] = v.trim().slice(0, 500);
  }
  out.compiled_text = clampAppearanceCompiledText(out.compiled_text, rawForLength);
  return out;
}

export function serializeAppearanceCompiledJson(value: AppearanceCompiledJson | null): string {
  return value ? JSON.stringify(value) : "";
}

export function parseAppearanceCompiledJson(raw: string | null | undefined): AppearanceCompiledJson | null {
  if (!raw?.trim()) return null;
  try { return validateAppearanceCompiledJson(JSON.parse(raw)); } catch { return null; }
}

export function appearancePromptText(input: { raw: string; compiledJson?: string | null }): string {
  const compiled = parseAppearanceCompiledJson(input.compiledJson);
  const compiledText = compiled?.compiled_text.trim() || KEYS.filter((k) => k !== "compiled_text").map((k) => compiled?.[k]).filter(Boolean).join(", ");
  return (compiledText || input.raw).trim();
}

export function extractAppearanceRawFromSetting(systemPrompt: string): string {
  const lines = systemPrompt.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inAppearance = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const inline = line.match(/^\[(?:외형|외모|Appearance)\]\s+(.+)$/i) || line.match(/^(?:외형|외모|Appearance)\s*[:：]\s*(.+)$/i);
    if (inline?.[1]) {
      inAppearance = true;
      out.push(inline[1].trim());
      continue;
    }
    if (/^(?:\[(?:외형|외모|Appearance)\]|#{1,3}\s*(?:외형|외모|Appearance))$/i.test(line)) {
      inAppearance = true;
      continue;
    }
    if (inAppearance && (/^\[[^\]]{1,64}\]$/.test(line) || /^#{1,3}\s+\S+/.test(line) || /^(?:이름|성격|말투|배경|관계|세계관)\s*[:：]?.*$/i.test(line))) break;
    if (inAppearance) out.push(rawLine);
  }
  return out.join("\n").trim().slice(0, 3000);
}

export function replaceAppearanceInSetting(systemPrompt: string, appearanceText: string): string {
  if (!appearanceText.trim()) return systemPrompt;
  const lines = systemPrompt.replace(/\r\n?/g, "\n").split("\n");
  const result: string[] = [];
  let inAppearance = false;
  let replaced = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const startsInline = /^\[(?:외형|외모|Appearance)\]\s+.+$/i.test(line) || /^(?:외형|외모|Appearance)\s*[:：]\s*.+$/i.test(line);
    const startsHeader = /^(?:\[(?:외형|외모|Appearance)\]|#{1,3}\s*(?:외형|외모|Appearance))$/i.test(line);
    if (!inAppearance && (startsInline || startsHeader)) {
      result.push("[외형]", appearanceText.trim());
      inAppearance = true;
      replaced = true;
      continue;
    }
    if (inAppearance) {
      if (/^\[[^\]]{1,64}\]$/.test(line) || /^#{1,3}\s+\S+/.test(line)) {
        inAppearance = false;
        result.push(rawLine);
      }
      continue;
    }
    result.push(rawLine);
  }
  return replaced ? result.join("\n").trim() : `${systemPrompt.trim()}\n\n[외형]\n${appearanceText.trim()}`;
}

export async function compileAppearanceForChat(raw: string): Promise<AppearanceCompiledJson | null> {
  const normalized = normalizeAppearanceRaw(raw).slice(0, 3000);
  if (!normalized) return emptyAppearanceCompiled();
  try {
    const { text } = await callOpenRouterCompletion({
      model: process.env.APPEARANCE_COMPILER_MODEL?.trim() || OPENROUTER_GEMINI_31_FLASH_MODEL,
      temperature: 0.1,
      maxTokens: 500,
      requestKind: "background-appearance-compile",
      timeoutMs: 30_000,
      system: `캐릭터 외형 원문을 채팅 모델용의 짧고 자연스러운 외형 속성 JSON으로 정리한다. 입력에 없는 사실·성격·행동·감정을 추가하지 않는다. 브랜드/고유명사가 설정상 중요하면 보존하고, 단순 스타일 용어만 외관상 의미로 풀어쓴다. 원문보다 길어지지 않게 한다. JSON만 출력한다. 키: ${KEYS.join(", ")}`,
      history: [{ role: "user", content: normalized }],
    });
    const jsonText = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return validateAppearanceCompiledJson(JSON.parse(jsonText), normalized);
  } catch (err) {
    console.warn("[appearanceCompiler] compile failed", { raw_hash: hashAppearanceRaw(normalized).slice(0, 12), error: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160) });
    return null;
  }
}
