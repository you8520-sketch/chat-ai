"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import StudioButton from "@/components/studio/StudioButton";
import { StudioBackLink } from "@/components/studio/StudioEmptyState";
import { StudioInput, StudioTextarea } from "@/components/studio/StudioInput";
import StudioSaveBar from "@/components/studio/StudioSaveBar";
import { studioType } from "@/lib/studioDesign";
import { WORLD_CONTENT_LIMIT, WORLD_NAME_LIMIT, WORLD_SUMMARY_LIMIT } from "@/lib/worlds";

const FORM_ID = "studio-world-form";

export default function CreateWorld() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [trpgEnabled, setTrpgEnabled] = useState(false);
  const [trpgVisibility, setTrpgVisibility] = useState<"public" | "private">("private");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("세계관 이름을 입력해 주세요.");
      return;
    }
    if (!content.trim()) {
      setError("세계관 본문을 입력해 주세요.");
      return;
    }
    if (content.length > WORLD_CONTENT_LIMIT) {
      setError(`세계관 본문은 ${WORLD_CONTENT_LIMIT.toLocaleString()}자 이하여야 합니다.`);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/worlds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, summary, content, trpgEnabled, trpgVisibility }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "저장에 실패했습니다.");
        return;
      }
      router.push("/studio?tab=worlds");
      router.refresh();
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-32 sm:py-8">
      <StudioBackLink href="/studio?tab=worlds">← 제작 · 세계관</StudioBackLink>

      <h1 className={`${studioType.heading} mt-4`}>세계관 제작</h1>
      <p className={`${studioType.helper} mt-2`}>
        배경·시대·장소·세력·규칙 등을 저장해 두면, 캐릭터 제작 시 불러올 수 있습니다.
        TRPG에서 쓰려면 아래에서 공개 여부를 고르면 됩니다.
      </p>

      <form id={FORM_ID} onSubmit={submit} className="mt-8 space-y-6">
        <StudioInput
          label="세계관 이름 *"
          placeholder="예: 북부 대공국 · 현대 서울 판타지"
          value={name}
          maxLength={WORLD_NAME_LIMIT}
          counter={{ now: name.length, max: WORLD_NAME_LIMIT }}
          onChange={(e) => setName(e.target.value.slice(0, WORLD_NAME_LIMIT))}
        />

        <StudioInput
          label="한 줄 요약"
          placeholder="목록에서 구분하기 위한 짧은 설명 (선택)"
          value={summary}
          maxLength={WORLD_SUMMARY_LIMIT}
          onChange={(e) => setSummary(e.target.value.slice(0, WORLD_SUMMARY_LIMIT))}
        />

        <StudioTextarea
          label="세계관 본문 *"
          rows={14}
          placeholder={
            "시대와 배경, 주요 지역, 세력 관계, 마법/기술 규칙, 사회 구조, 금기, 분위기 등을 자유롭게 작성하세요.\n\n캐릭터 제작 시 이 내용이 「세계관 / 배경」란에 자동으로 채워집니다."
          }
          value={content}
          counter={{ now: content.length, max: WORLD_CONTENT_LIMIT }}
          onChange={(e) => setContent(e.target.value.slice(0, WORLD_CONTENT_LIMIT))}
        />

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <label className="flex items-start gap-3 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={trpgEnabled}
              onChange={(e) => setTrpgEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 accent-violet-500"
            />
            <span>
              <span className="font-semibold">TRPG에서 사용</span>
              <span className="mt-1 block text-xs text-zinc-500">
                캠페인 만들 때 이 세계관을 고를 수 있습니다. 공개하면 TRPG 탭 목록에도 올라갑니다.
              </span>
            </span>
          </label>
          {trpgEnabled ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTrpgVisibility("private")}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  trpgVisibility === "private"
                    ? "bg-violet-600 text-white"
                    : "border border-white/10 bg-white/5 text-zinc-300"
                }`}
              >
                비공개 (나만)
              </button>
              <button
                type="button"
                onClick={() => setTrpgVisibility("public")}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  trpgVisibility === "public"
                    ? "bg-violet-600 text-white"
                    : "border border-white/10 bg-white/5 text-zinc-300"
                }`}
              >
                공개 (TRPG 탭)
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <StudioButton href="/create" variant="secondary">
            캐릭터 제작으로
          </StudioButton>
        </div>
      </form>

      <StudioSaveBar
        formId={FORM_ID}
        saveType="submit"
        saveLabel={loading ? "저장 중…" : "세계관 저장"}
        saveDisabled={loading}
        error={error || null}
      />
    </div>
  );
}
