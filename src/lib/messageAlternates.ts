import type { Usage } from "@/lib/chatUsage";

export type MessageVariant = {
  content: string;
  model: string;
  usage: Usage | null;
  created_at: string;
};

export function parseMessageVariants(raw: string | null | undefined): MessageVariant[] {
  if (!raw || raw === "[]") return [];
  try {
    const parsed = JSON.parse(raw) as MessageVariant[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeMessageVariants(row: {
  content: string;
  model: string;
  usage: string | null;
  alternates?: string | null;
  active_variant?: number | null;
}): { variants: MessageVariant[]; activeVariant: number } {
  let variants = parseMessageVariants(row.alternates);
  if (variants.length === 0 && row.content.trim()) {
    variants = [
      {
        content: row.content,
        model: row.model ?? "",
        usage: row.usage ? (JSON.parse(row.usage) as Usage) : null,
        created_at: "",
      },
    ];
  }
  let activeVariant = row.active_variant ?? variants.length - 1;
  if (activeVariant < 0) activeVariant = 0;
  if (variants.length > 0 && activeVariant >= variants.length) {
    activeVariant = variants.length - 1;
  }
  return { variants, activeVariant };
}

export function variantToRowFields(variants: MessageVariant[], activeVariant: number) {
  const v = variants[activeVariant];
  if (!v) {
    return { content: "", model: "", usage: null as string | null };
  }
  return {
    content: v.content,
    model: v.model,
    usage: v.usage ? JSON.stringify(v.usage) : null,
  };
}

export function appendMessageVariant(
  variants: MessageVariant[],
  variant: MessageVariant
): { variants: MessageVariant[]; activeVariant: number } {
  const next = [...variants, variant];
  return { variants: next, activeVariant: next.length - 1 };
}

export function serializeVariantsForClient(variants: MessageVariant[], activeVariant: number) {
  return { variants, activeVariant, variantCount: variants.length };
}

export function editedMessageVariant(input: {
  content: string;
  model?: string | null;
  usage?: Usage | null;
  createdAt?: string;
}): MessageVariant {
  return {
    content: input.content,
    model: input.model ?? "",
    usage: input.usage ?? null,
    created_at: input.createdAt ?? "",
  };
}

/** 재출력 버전 전환 — 항상 active variant 본문 사용 (messages.content와 어긋남 방지) */
export function resolveActiveVariantContent(
  row: { content: string; variants?: MessageVariant[]; activeVariant?: number | null },
  fallback = ""
): string {
  const variants = row.variants;
  const idx = row.activeVariant;
  if (variants?.length && idx != null && idx >= 0 && idx < variants.length) {
    const v = variants[idx]?.content?.trim();
    if (v) return v;
  }
  return row.content?.trim() || fallback;
}
