"use client";

import { useCallback, useEffect, useState } from "react";

import {
  CHAT_IMAGE_EXPRESSIONS,
  CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS,
  CHAT_IMAGE_MOODS,
  CHAT_IMAGE_PLACEMENTS,
  type ChatImageExpression,
  type ChatImageMood,
  type ChatImagePlacement,
} from "@/lib/chatImageGeneration";
import { dispatchPointsDeducted } from "@/lib/pointsEvents";

const PERSONA_STORAGE_KEY = "habi:lastPersonaId";

type ReferenceInfo = {
  id: number;
  name: string;
  imageUrl: string;
};

type Preflight = {
  ready: boolean;
  missing: string[];
  pricePoints: number;
  modelId: string;
  modelLabel: string;
  template: { id: string; name: string; previewUrl: string };
  character: ReferenceInfo;
  persona: ReferenceInfo | null;
  balance?: { total: number; paid: number; free: number };
  latestResult?: {
    imageUrl: string;
    chargedPoints: number;
    createdAt: string;
  } | null;
};

type GenerateResult = {
  ok?: boolean;
  error?: string;
  imageUrl?: string;
  modelLabel?: string;
  totalPointsCost?: number;
  remainingPoints?: number;
  paidPoints?: number;
  freePoints?: number;
};

function currentRouteIds() {
  const match = window.location.pathname.match(/^\/chat\/(\d+)/);
  const params = new URLSearchParams(window.location.search);
  const storedPersona = Number(localStorage.getItem(PERSONA_STORAGE_KEY));
  const chatId = Number(params.get("chat"));
  return {
    characterId: match ? Number(match[1]) : null,
    chatId: Number.isInteger(chatId) && chatId > 0 ? chatId : null,
    personaId:
      Number.isInteger(storedPersona) && storedPersona > 0 ? storedPersona : null,
  };
}

function queryString(ids: ReturnType<typeof currentRouteIds>) {
  const params = new URLSearchParams();
  if (ids.characterId) params.set("characterId", String(ids.characterId));
  if (ids.chatId) params.set("chatId", String(ids.chatId));
  if (ids.personaId) params.set("personaId", String(ids.personaId));
  return params.toString();
}

function IconImageSpark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className={className}
      aria-hidden
    >
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <circle cx="8" cy="10" r="1.4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 17 4-4 3 3 2-2 3 3" />
      <path strokeLinecap="round" d="M19.5 2.5v4M17.5 4.5h4" />
    </svg>
  );
}

function ReferenceCard({ label, info }: { label: string; info: ReferenceInfo | null }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-2">
      <p className="mb-1.5 text-[10px] font-semibold text-zinc-400">{label}</p>
      <div className="flex items-center gap-2">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black/25">
          {info?.imageUrl ? (
            <img src={info.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">
              이미지 없음
            </div>
          )}
        </div>
        <p className="min-w-0 truncate text-xs font-semibold text-zinc-200">
          {info?.name || "선택 안 됨"}
        </p>
      </div>
    </div>
  );
}

export default function ChatImageGeneratorRailButton() {
  const [open, setOpen] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [info, setInfo] = useState<Preflight | null>(null);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [placement, setPlacement] = useState<ChatImagePlacement>(
    CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.placement
  );
  const [topExpression, setTopExpression] = useState<ChatImageExpression>(
    CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.topExpression
  );
  const [bottomExpression, setBottomExpression] = useState<ChatImageExpression>(
    CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.bottomExpression
  );
  const [mood, setMood] = useState<ChatImageMood>(
    CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.mood
  );

  const loadInfo = useCallback(async () => {
    setLoadingInfo(true);
    setError("");
    try {
      const ids = currentRouteIds();
      const response = await fetch(`/api/chat/image-generation?${queryString(ids)}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as
        | (Preflight & { error?: string })
        | null;
      if (!response.ok || !data) {
        setInfo(null);
        setError(data?.error || "이미지 생성 정보를 불러오지 못했습니다.");
        return;
      }
      setInfo(data);
      if (!resultUrl && data.latestResult?.imageUrl) {
        setResultUrl(data.latestResult.imageUrl);
      }
    } catch {
      setInfo(null);
      setError("이미지 생성 정보를 불러오지 못했습니다.");
    } finally {
      setLoadingInfo(false);
    }
  }, [resultUrl]);

  useEffect(() => {
    if (!open) return;
    void loadInfo();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !generating) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, generating, loadInfo]);

  async function generate() {
    if (!info?.ready || generating) return;
    setGenerating(true);
    setError("");
    setResultUrl("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 300_000);
    try {
      const ids = currentRouteIds();
      const response = await fetch("/api/chat/image-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...ids,
          placement,
          topExpression,
          bottomExpression,
          mood,
        }),
      });
      const data = (await response.json().catch(() => null)) as GenerateResult | null;
      if (!response.ok || !data?.imageUrl) {
        setError(data?.error || "이미지 생성에 실패했습니다.");
        if (data && typeof data.remainingPoints === "number") {
          setInfo((prev) =>
            prev
              ? {
                  ...prev,
                  balance: {
                    total: data.remainingPoints!,
                    paid: data.paidPoints ?? prev.balance?.paid ?? 0,
                    free: data.freePoints ?? prev.balance?.free ?? 0,
                  },
                }
              : prev
          );
        }
        return;
      }
      setResultUrl(data.imageUrl);
      if (
        typeof data.totalPointsCost === "number" &&
        typeof data.remainingPoints === "number"
      ) {
        dispatchPointsDeducted({
          totalPointsCost: data.totalPointsCost,
          remainingPoints: data.remainingPoints,
          paidPoints: data.paidPoints ?? 0,
          freePoints: data.freePoints ?? 0,
        });
        setInfo((prev) =>
          prev
            ? {
                ...prev,
                balance: {
                  total: data.remainingPoints!,
                  paid: data.paidPoints ?? 0,
                  free: data.freePoints ?? 0,
                },
              }
            : prev
        );
      }
    } catch (caught) {
      const timedOut = caught instanceof DOMException && caught.name === "AbortError";
      setError(
        timedOut
          ? "이미지 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : "이미지 생성 중 오류가 발생했습니다."
      );
    } finally {
      window.clearTimeout(timer);
      setGenerating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full flex-col items-center gap-0.5 rounded-md px-0 py-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-violet-200"
        title="캐릭터와 페르소나로 SD 이미지 생성"
        aria-label="이미지 생성"
      >
        <IconImageSpark className="h-4 w-4 shrink-0" />
        <span className="max-w-full px-0.5 text-center text-[9px] font-medium leading-[1.15] tracking-tight">
          이미지
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="SD 이미지 생성"
          onClick={() => {
            if (!generating) setOpen(false);
          }}
        >
          <section
            className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111217] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold text-violet-300">GPT Image 2</p>
                <h2 className="text-base font-bold text-white">캐릭터 × 페르소나 SD 굿즈</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={generating}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-lg text-zinc-300 hover:bg-white/10 disabled:opacity-40"
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loadingInfo && !info ? (
                <p className="py-12 text-center text-sm text-zinc-400">이미지 정보를 불러오는 중…</p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white">
                      <img
                        src={resultUrl || info?.template.previewUrl || ""}
                        alt={resultUrl ? "생성된 SD 이미지" : "선물상자 SD 고정틀"}
                        className="aspect-[4/3] w-full object-contain"
                      />
                    </div>
                    <p className="text-center text-[10px] leading-relaxed text-zinc-500">
                      {resultUrl
                        ? "완성된 이미지는 서버에 저장됩니다."
                        : "선물상자·리본·인형·사탕 장식을 유지하면서 두 사람의 외형을 반영합니다."}
                    </p>
                    {resultUrl ? (
                      <a
                        href={resultUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-center text-xs font-semibold text-violet-200 hover:bg-violet-500/15"
                      >
                        완성 이미지 크게 보기
                      </a>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <ReferenceCard label="채팅 캐릭터" info={info?.character ?? null} />
                      <ReferenceCard label="선택 페르소나" info={info?.persona ?? null} />
                    </div>

                    <label className="block space-y-1">
                      <span className="text-[11px] font-semibold text-zinc-400">자리 배치</span>
                      <select
                        value={placement}
                        onChange={(event) => setPlacement(event.target.value as ChatImagePlacement)}
                        disabled={generating}
                        className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                      >
                        {CHAT_IMAGE_PLACEMENTS.map((item) => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-400">위 인물 표정</span>
                        <select
                          value={topExpression}
                          onChange={(event) => setTopExpression(event.target.value as ChatImageExpression)}
                          disabled={generating}
                          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                        >
                          {CHAT_IMAGE_EXPRESSIONS.map((item) => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[11px] font-semibold text-zinc-400">아래 인물 표정</span>
                        <select
                          value={bottomExpression}
                          onChange={(event) => setBottomExpression(event.target.value as ChatImageExpression)}
                          disabled={generating}
                          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                        >
                          {CHAT_IMAGE_EXPRESSIONS.map((item) => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="block space-y-1">
                      <span className="text-[11px] font-semibold text-zinc-400">분위기</span>
                      <select
                        value={mood}
                        onChange={(event) => setMood(event.target.value as ChatImageMood)}
                        disabled={generating}
                        className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                      >
                        {CHAT_IMAGE_MOODS.map((item) => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </select>
                    </label>

                    {info && !info.ready ? (
                      <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                        먼저 {info.missing.join(", ")}를 등록해 주세요.
                      </p>
                    ) : null}
                    {error ? (
                      <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
                        {error}
                      </p>
                    ) : null}

                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-zinc-400">
                      <div className="flex justify-between gap-3">
                        <span>모델</span>
                        <strong className="text-zinc-200">{info?.modelLabel ?? "GPT Image 2"}</strong>
                      </div>
                      <div className="mt-1 flex justify-between gap-3">
                        <span>1장 생성</span>
                        <strong className="text-violet-200">{(info?.pricePoints ?? 900).toLocaleString()}P</strong>
                      </div>
                      {info?.balance ? (
                        <div className="mt-1 flex justify-between gap-3">
                          <span>보유 포인트</span>
                          <strong className="text-zinc-200">{info.balance.total.toLocaleString()}P</strong>
                        </div>
                      ) : null}
                      <p className="mt-2 leading-relaxed text-zinc-500">
                        생성에 성공한 경우에만 차감됩니다. 실패 결과에는 포인트를 차감하지 않습니다.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void generate()}
                      disabled={
                        generating ||
                        loadingInfo ||
                        !info?.ready ||
                        (info.balance != null && info.balance.total < info.pricePoints)
                      }
                      className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {generating
                        ? "GPT Image 2로 생성 중… 최대 몇 분 걸릴 수 있습니다"
                        : resultUrl
                          ? `다시 생성 · ${(info?.pricePoints ?? 900).toLocaleString()}P`
                          : `이미지 생성 · ${(info?.pricePoints ?? 900).toLocaleString()}P`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
