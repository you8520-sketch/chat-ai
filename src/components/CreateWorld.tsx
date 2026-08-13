"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import StudioButton from "@/components/studio/StudioButton";
import { StudioBackLink } from "@/components/studio/StudioEmptyState";
import { StudioInput, StudioTextarea } from "@/components/studio/StudioInput";
import StudioSaveBar from "@/components/studio/StudioSaveBar";
import GenrePicker from "@/components/GenrePicker";
import TrpgScenarioEditor from "@/app/trpg/TrpgScenarioEditor";
import type { TrpgCatalog } from "@/lib/trpg/catalog";
import type { CharacterGenre } from "@/lib/characterGenres";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";
import { cropImageFileToSquare } from "@/lib/worldCoverCrop";
import {
  WORLD_CONTENT_LIMIT,
  WORLD_NAME_LIMIT,
  WORLD_SUMMARY_LIMIT,
  parseWorldStudioKind,
  type WorldListItem,
} from "@/lib/worlds";

const FORM_ID = "studio-world-form";

type Props = {
  worldId?: number;
  showTrpg?: boolean;
  catalog?: TrpgCatalog | null;
};

export default function CreateWorld({ worldId, showTrpg = false, catalog = null }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEdit = worldId != null;
  const kind = !isEdit && showTrpg ? parseWorldStudioKind(searchParams.get("tab")) : "world";

  function setKind(next: "world" | "scenario") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "world") params.delete("tab");
    else params.set("tab", "scenario");
    const qs = params.toString();
    router.replace(qs ? `/world/create?${qs}` : "/world/create", { scroll: false });
  }

  return (
    <div className={cn("mx-auto max-w-2xl px-4 py-6 sm:py-8", kind === "world" ? "pb-32" : "pb-8")}>
      <StudioBackLink href="/studio?tab=worlds">← 제작 · 세계관</StudioBackLink>

      <h1 className={`${studioType.heading} mt-4`}>
        {isEdit ? "세계관 수정" : "세계관 제작"}
      </h1>
      <p className={`${studioType.helper} mt-2`}>
        {isEdit
          ? "캐릭터·시뮬레이션에서 불러올 세계관 본문과 대표 이미지를 수정합니다."
          : showTrpg
            ? "캐릭터·시뮬레이션용 세계관과 TRPG 시나리오를 탭으로 나눠 만듭니다."
            : "배경·시대·장소·세력·규칙 등을 저장해 두면, 캐릭터 제작 시 불러올 수 있습니다."}
      </p>

      {!isEdit && showTrpg ? (
        <div
          role="tablist"
          aria-label="세계관 종류"
          className="mt-5 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-[#0e1120] p-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={kind === "world"}
            onClick={() => setKind("world")}
            className={cn(
              "min-h-11 rounded-xl px-3 text-sm font-semibold transition",
              kind === "world" ? studioSurface.tabActive : studioSurface.tabIdle,
            )}
          >
            캐릭터·시뮬레이션 세계관
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "scenario"}
            onClick={() => setKind("scenario")}
            className={cn(
              "min-h-11 rounded-xl px-3 text-sm font-semibold transition",
              kind === "scenario" ? studioSurface.tabActive : studioSurface.tabIdle,
            )}
          >
            TRPG 시나리오
          </button>
        </div>
      ) : null}

      {kind === "scenario" && catalog ? (
        <div className="mt-6">
          <TrpgScenarioEditor
            catalog={catalog}
            embedded
            returnHref="/studio?tab=worlds"
          />
        </div>
      ) : (
        <WorldForm worldId={worldId} />
      )}
    </div>
  );
}

function WorldForm({ worldId }: { worldId?: number }) {
  const router = useRouter();
  const isEdit = worldId != null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [genres, setGenres] = useState<CharacterGenre[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bootLoading, setBootLoading] = useState(isEdit);

  useEffect(() => {
    if (!isEdit || worldId == null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/worlds/${worldId}`);
        const data = (await res.json()) as { world?: WorldListItem; error?: string };
        if (!res.ok || !data.world) {
          if (!cancelled) setError(data.error || "불러오기에 실패했습니다.");
          return;
        }
        if (cancelled) return;
        setName(data.world.name);
        setSummary(data.world.summary);
        setContent(data.world.content);
        setCoverUrl(data.world.coverUrl ?? "");
        setGenres(data.world.genres ?? []);
      } catch {
        if (!cancelled) setError("불러오는 중 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, worldId]);

  async function uploadCover(file: File) {
    setUploading(true);
    setError("");
    try {
      const square = await cropImageFileToSquare(file);
      const fd = new FormData();
      fd.append("files", square);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { urls?: string[]; error?: string };
      if (!res.ok || !data.urls?.[0]) {
        setError(data.error || "이미지 업로드에 실패했습니다.");
        return;
      }
      setCoverUrl(data.urls[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  }

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
      const res = await fetch(isEdit ? `/api/worlds/${worldId}` : "/api/worlds", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, summary, content, coverUrl, genres }),
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

  if (bootLoading) {
    return <p className={`mt-8 ${studioType.helper}`}>불러오는 중...</p>;
  }

  return (
    <>
      <form id={FORM_ID} onSubmit={(e) => void submit(e)} className="mt-8 space-y-6">
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

        <div>
          <GenrePicker value={genres} onChange={setGenres} disabled={loading} />
          <p className={cn(studioType.helper, "mt-2")}>
            장르는 TRPG 탭 세계관 카드에만 보입니다. 제작 메뉴 세계관 목록에는 나오지 않습니다.
          </p>
        </div>

        <div>
          <p className={studioType.label}>대표 이미지</p>
          <p className={cn(studioType.helper, "mb-2")}>
            선택입니다. 정사각으로 가운데를 잘라 저장합니다. 없으면 TRPG 카드에 검은 화면이 나옵니다.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="aspect-square w-28 overflow-hidden rounded-xl bg-black sm:w-32">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadCover(file);
                }}
              />
              <StudioButton
                type="button"
                variant="secondary"
                size="sm"
                disabled={uploading || loading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "업로드 중…" : coverUrl ? "이미지 바꾸기" : "이미지 올리기"}
              </StudioButton>
              {coverUrl ? (
                <StudioButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading || loading}
                  onClick={() => setCoverUrl("")}
                >
                  이미지 제거
                </StudioButton>
              ) : null}
            </div>
          </div>
        </div>

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

        <div className="flex flex-wrap gap-3">
          <StudioButton href="/create" variant="secondary">
            캐릭터 제작으로
          </StudioButton>
        </div>
      </form>

      <StudioSaveBar
        formId={FORM_ID}
        saveType="submit"
        saveLabel={loading ? "저장 중…" : isEdit ? "세계관 저장" : "세계관 저장"}
        saveDisabled={loading || uploading}
        error={error || null}
      />
    </>
  );
}
