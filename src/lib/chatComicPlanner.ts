import "server-only";

import {
  CHAT_COMIC_MAX_INPUT_CHARS,
  normalizeChatComicPlan,
  type ChatComicMood,
  type ChatComicPanelCount,
  type ChatComicPlan,
} from "@/lib/chatImageGeneration";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_COMIC_PLANNER_MODEL = "google/gemini-2.0-flash-001";

type PlannerResult = {
  plan: ChatComicPlan;
  model: string;
  costUsd: number | null;
};

class ComicPlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComicPlannerError";
  }
}

function messageText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return "";
  return raw
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new ComicPlannerError("컷 구성 JSON을 해석하지 못했습니다.");
  }
}

function plannerSystemPrompt(panelCount: ChatComicPanelCount, mood: ChatComicMood): string {
  return [
    "너는 한국어 관계형 캐릭터챗 장면을 컷만화 콘티로 압축하는 전문 편집자다.",
    `사용자가 붙여넣은 본문을 정확히 ${panelCount}개의 가로 컷으로 재구성한다.`,
    `전체 분위기 프리셋은 ${mood}다.`,
    "등장인물은 chat character와 user persona, 정확히 두 명뿐이다.",
    "본문의 사건 순서, 관계성, 감정 변화와 핵심 직접대사를 보존하되 반복 서술은 장면 행동으로 압축한다.",
    "각 컷은 장면 1개, 핵심 반응 1개, 말풍선 최대 2개로 구성한다.",
    "말풍선 대사는 자연스러운 한국어로 짧게 뽑되, 본문에 직접 인용된 중요한 대사는 가능한 한 원문 표현을 유지한다.",
    "대사 한 줄은 48자 이내로 한다. 긴 설명은 짧은 내레이션 상자 1개로만 정리한다.",
    "표정과 신체 연출은 앞뒤 컷의 감정 변화를 분명히 보여준다.",
    "마지막 컷은 관계 변화, 감정적 보상 또는 코믹한 오치로 마무리한다.",
    "새 인물, 새 설정, 본문에 없는 사건을 만들지 않는다.",
    "출력은 설명 없이 JSON 객체 하나만 반환한다.",
    "JSON 스키마:",
    JSON.stringify(
      {
        title: "40자 이내",
        panels: [
          {
            scene: "컷에서 실제로 보이는 장면",
            dialogue: [
              {
                speaker: "character | persona | narration",
                text: "말풍선 또는 내레이션 문구",
              },
            ],
            characterExpression: "캐릭터의 표정·자세",
            personaExpression: "페르소나의 표정·자세",
            caption: "필요할 때만 짧은 내레이션",
          },
        ],
      },
      null,
      2
    ),
  ].join("\n\n");
}

export function resolveChatComicPlannerModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.OPENROUTER_COMIC_PLANNER_MODEL?.trim() || DEFAULT_COMIC_PLANNER_MODEL;
}

export async function planChatComic(opts: {
  sourceText: string;
  panelCount: ChatComicPanelCount;
  mood: ChatComicMood;
}): Promise<PlannerResult> {
  const sourceText = opts.sourceText.trim();
  if (!sourceText) throw new ComicPlannerError("컷만화로 만들 본문을 입력해 주세요.");
  if (sourceText.length > CHAT_COMIC_MAX_INPUT_CHARS) {
    throw new ComicPlannerError(
      `본문은 최대 ${CHAT_COMIC_MAX_INPUT_CHARS.toLocaleString()}자까지 입력할 수 있습니다.`
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new ComicPlannerError("OpenRouter API 키가 설정되지 않았습니다.");

  const model = resolveChatComicPlannerModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Title": "Habi Chat Comic Planner",
    };
    const referer =
      process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
    if (referer) headers["HTTP-Referer"] = referer;

    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: plannerSystemPrompt(opts.panelCount, opts.mood),
          },
          {
            role: "user",
            content: sourceText,
          },
        ],
      }),
    });

    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const error = data && typeof data === "object" ? (data as { error?: unknown }).error : null;
      const message =
        typeof error === "string"
          ? error
          : error && typeof error === "object" &&
              typeof (error as { message?: unknown }).message === "string"
            ? String((error as { message?: unknown }).message)
            : "본문을 컷 구성으로 정리하지 못했습니다.";
      throw new ComicPlannerError(message.slice(0, 240));
    }

    const choice = data && typeof data === "object"
      ? (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
      : null;
    const content = messageText(choice?.message?.content);
    if (!content) throw new ComicPlannerError("컷 구성 응답이 비어 있습니다.");

    const plan = normalizeChatComicPlan(parseJsonObject(content), opts.panelCount);
    const rawCost = data && typeof data === "object"
      ? (data as { usage?: { cost?: unknown } }).usage?.cost
      : null;
    const parsedCost = Number(rawCost);

    return {
      plan,
      model,
      costUsd: Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : null,
    };
  } catch (error) {
    if (error instanceof ComicPlannerError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ComicPlannerError("컷 구성 시간이 초과되었습니다. 다시 시도해 주세요.");
    }
    throw new ComicPlannerError("본문을 컷 구성으로 정리하지 못했습니다.");
  } finally {
    clearTimeout(timer);
  }
}
