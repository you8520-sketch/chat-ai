import {
  parseOpenAiImageFailureDiagnostic,
  resolveOpenAiImageProviderRequestId,
  type OpenAiImageFailureDiagnostic,
} from "@/lib/openAiImageFailureDiagnostic";

const OPENAI_IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";

/** `/v1/images/edits` requires at least one image. Zero-image requests are not supported. */
export const OPENAI_IMAGE_EDIT_MIN_REFERENCES = 1;

export type OpenAiImageQuality = "low" | "medium" | "high";
export type OpenAiImageUsageEvidence = "usage_present" | "usage_absent";

type OpenAiImageUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  input_tokens_details?: {
    image_tokens?: unknown;
    text_tokens?: unknown;
  };
};

export class OpenAiImageError extends Error {
  constructor(
    message: string,
    public status = 502,
    public diagnostic?: OpenAiImageFailureDiagnostic
  ) {
    super(message);
    this.name = "OpenAiImageError";
  }
}

function errorMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "OpenAI 이미지 생성 요청에 실패했습니다.";
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error.slice(0, 240);
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.slice(0, 240);
  }
  return "OpenAI 이미지 생성 요청에 실패했습니다.";
}

function finiteTokenCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function calculateGptImage2CostUsd(usage: OpenAiImageUsage | null | undefined) {
  if (!usage) return null;
  const imageInputTokens = finiteTokenCount(usage.input_tokens_details?.image_tokens);
  const textInputTokens = finiteTokenCount(usage.input_tokens_details?.text_tokens);
  const outputTokens = finiteTokenCount(usage.output_tokens);
  if (imageInputTokens + textInputTokens + outputTokens === 0) return null;

  return (
    imageInputTokens * 0.000008 +
    textInputTokens * 0.000005 +
    outputTokens * 0.00003
  );
}

function referenceToBlob(reference: string, index: number) {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(reference);
  if (!match) throw new OpenAiImageError(`참조 이미지 ${index + 1} 형식이 올바르지 않습니다.`, 400);
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) {
    throw new OpenAiImageError(`참조 이미지 ${index + 1} 데이터가 비어 있습니다.`, 400);
  }
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: match[1] }),
    filename: `reference-${index + 1}.webp`,
  };
}

export async function callOpenAiImageEdit(opts: {
  model: string;
  prompt: string;
  references: string[];
  size: string;
  quality: OpenAiImageQuality;
  outputCompression: number;
  signal?: AbortSignal;
  templateId?: string;
  mode?: string;
}): Promise<{
  buffer: Buffer;
  costUsd: number | null;
  providerRequestId: string | null;
  usageEvidence: OpenAiImageUsageEvidence;
}> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new OpenAiImageError("OpenAI API 키가 설정되지 않았습니다.", 503);
  if (opts.references.length < OPENAI_IMAGE_EDIT_MIN_REFERENCES) {
    throw new OpenAiImageError(
      "참조 이미지가 없어 이미지 편집을 요청할 수 없습니다.",
      400
    );
  }

  const form = new FormData();
  form.set("model", opts.model);
  form.set("prompt", opts.prompt);
  form.set("n", "1");
  form.set("quality", opts.quality);
  form.set("size", opts.size);
  form.set("background", "opaque");
  form.set("output_format", "webp");
  form.set("output_compression", String(opts.outputCompression));
  opts.references.forEach((reference, index) => {
    const file = referenceToBlob(reference, index);
    form.append("image[]", file.blob, file.filename);
  });

  const attemptStartedAt = new Date().toISOString();
  const response = await fetch(OPENAI_IMAGE_EDITS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    body: form,
    signal: opts.signal,
  });
  const attemptFinishedAt = new Date().toISOString();

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const diagnostic = parseOpenAiImageFailureDiagnostic({
      httpStatus: response.status,
      responseHeaders: response.headers,
      responseBody: data,
      attemptStartedAt,
      attemptFinishedAt,
      model: opts.model,
      size: opts.size,
      quality: opts.quality,
      referenceCount: opts.references.length,
      prompt: opts.prompt,
      templateId: opts.templateId,
      mode: opts.mode,
    });
    throw new OpenAiImageError(
      diagnostic.errorMessage,
      response.status >= 500 ? 502 : 400,
      diagnostic
    );
  }

  const encoded = (data as { data?: Array<{ b64_json?: string }> })?.data?.[0]?.b64_json
    ?.replace(/^data:[^;]+;base64,/, "");
  if (!encoded) throw new OpenAiImageError("생성된 이미지 데이터가 비어 있습니다.");
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new OpenAiImageError("생성된 이미지 데이터가 비어 있습니다.");

  const usage = (data as { usage?: OpenAiImageUsage })?.usage;
  const usageEvidence =
    usage &&
    (usage.input_tokens != null ||
      usage.output_tokens != null ||
      usage.input_tokens_details?.image_tokens != null ||
      usage.input_tokens_details?.text_tokens != null)
      ? "usage_present"
      : "usage_absent";
  return {
    buffer,
    costUsd: calculateGptImage2CostUsd(usage),
    providerRequestId: resolveOpenAiImageProviderRequestId({
      headers: response.headers,
      responseBody: data,
    }),
    usageEvidence,
  };
}
