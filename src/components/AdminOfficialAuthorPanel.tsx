"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { CHARACTER_GENRES } from "@/lib/characterGenres";
import { GENDER_LABELS, type CharacterGender } from "@/lib/characterGender";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

export type AdminAuthorGenreRecommendation = {
  genre: string;
  tone: string;
  humor: string;
  pacing: string;
  nameWordplay: string;
  worldScale: string;
  namingProfile: string;
  castIntent: string;
};

type Preview = {
  previewId: string;
  qaOk: boolean;
  issues: { code: string; message: string }[];
  repairable: boolean;
  voiceRepairs: number;
  textLock: string;
  manuscript: {
    name: string;
    tagline: string;
    description: string;
    greeting: string;
    genres: string[];
    tags: string[];
  };
  resolved: AdminAuthorGenreRecommendation;
};

const TONE_OPTIONS = [
  ["auto", "자동 추천"],
  ["serious", "진지"],
  ["lyrical", "서정"],
  ["light", "경쾌"],
  ["dry", "건조"],
  ["satirical", "풍자"],
  ["tragic", "비극"],
] as const;

const HUMOR_OPTIONS = [
  ["auto", "자동 추천"],
  ["none", "없음"],
  ["light", "가벼움"],
  ["central", "핵심"],
] as const;

const PACING_OPTIONS = [
  ["auto", "자동 추천"],
  ["narration", "서술"],
  ["balanced", "균형"],
  ["dialogue", "대사"],
] as const;

const WORDPLAY_OPTIONS = [
  ["auto", "자동 추천"],
  ["none", "없음"],
  ["nickname", "별명"],
  ["pun", "말장난"],
] as const;

const AXIS_LABEL: Record<string, string> = {
  serious: "진지",
  lyrical: "서정",
  light: "경쾌",
  dry: "건조",
  satirical: "풍자",
  tragic: "비극",
  none: "없음",
  central: "핵심",
  narration: "서술",
  balanced: "균형",
  dialogue: "대사",
  nickname: "별명",
  pun: "말장난",
  full: "full",
  scene: "scene",
};

function label(value: string): string {
  return AXIS_LABEL[value] ?? value;
}

export default function AdminOfficialAuthorPanel({
  recommendations,
}: {
  recommendations: readonly AdminAuthorGenreRecommendation[];
}) {
  const [genre, setGenre] = useState<string>("현대/일상");
  const [tone, setTone] = useState("auto");
  const [humor, setHumor] = useState("auto");
  const [pacing, setPacing] = useState("auto");
  const [nameWordplay, setNameWordplay] = useState("auto");
  const [gender, setGender] = useState<CharacterGender>("female");
  const [castIntent, setCastIntent] = useState("");
  const [busy, setBusy] = useState<"preview" | "repair" | "save" | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<{ characterId: number; editPath: string; alreadySaved: boolean } | null>(null);

  const recommendation = useMemo(
    () => recommendations.find((item) => item.genre === genre) ?? recommendations[0],
    [genre, recommendations]
  );

  useEffect(() => {
    setPreview(null);
    setSaved(null);
    setError("");
  }, [genre, tone, humor, pacing, nameWordplay, gender, castIntent]);

  async function post(path: string, body: unknown): Promise<{ status: number; payload: Record<string, unknown> }> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, payload };
  }

  async function generate() {
    setBusy("preview");
    setError("");
    setSaved(null);
    setPreview(null);
    const { payload } = await post("/api/admin/official-author/preview", {
      genre,
      tone,
      humor,
      pacing,
      nameWordplay,
      gender,
      castIntent,
    });
    setBusy(null);
    if (payload.ok !== true) {
      const issues = Array.isArray(payload.issues) ? payload.issues : [];
      setError(typeof payload.error === "string" ? payload.error : "생성에 실패했습니다.");
      if (issues.length) {
        setPreview({
          previewId: "",
          qaOk: false,
          repairable: false,
          voiceRepairs: 0,
          textLock: "",
          manuscript: { name: "", tagline: "", description: "", greeting: "", genres: [], tags: [] },
          resolved: recommendation!,
          issues: issues as Preview["issues"],
        });
      }
      return;
    }
    setPreview(payload as unknown as Preview);
  }

  async function repair() {
    if (!preview?.previewId) return;
    setBusy("repair");
    setError("");
    const { payload } = await post("/api/admin/official-author/repair", { previewId: preview.previewId });
    setBusy(null);
    if (payload.ok !== true) {
      setError(typeof payload.error === "string" ? payload.error : "보정에 실패했습니다.");
      return;
    }
    setPreview(payload as unknown as Preview);
  }

  async function save() {
    if (!preview?.previewId || !preview.qaOk) return;
    setBusy("save");
    setError("");
    const { payload } = await post("/api/admin/official-author/save", { previewId: preview.previewId });
    setBusy(null);
    if (payload.ok !== true) {
      setError(typeof payload.error === "string" ? payload.error : "저장에 실패했습니다.");
      return;
    }
    setSaved({
      characterId: Number(payload.characterId),
      editPath: String(payload.editPath),
      alreadySaved: payload.alreadySaved === true,
    });
  }

  return (
    <section
      data-testid="admin-official-author"
      className={cn(studioSurface.card, "mb-6 p-4 sm:p-5")}
      aria-label="공식 범용 초안 생성"
    >
      <h2 className={cn(studioType.heading, "text-lg")}>공식 범용 초안</h2>
      <p className={cn(studioType.helper, "mt-1")}>
        장르·문체·유머·전개·작명은 자동 추천이 기본입니다. 필요한 항목만 바꾸세요. 검수를 통과한 원고만 관리자
        소유의 비공개 초안(이미지 없음)으로 저장합니다. 공개와 승인은 하지 않습니다. 저장하지 않은 미리보기는 서버
        재시작·배포 후 복구되지 않습니다.
      </p>
      {recommendation ? (
        <p className="mt-3 break-words text-sm text-zinc-300" data-testid="admin-author-recommendation">
          추천: {recommendation.genre} · {label(recommendation.tone)} · 유머 {label(recommendation.humor)} · 전개{" "}
          {label(recommendation.pacing)} · 작명 {label(recommendation.nameWordplay)} · 세계 {recommendation.worldScale} ·{" "}
          {recommendation.namingProfile}
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm text-zinc-300">
          장르
          <select className={fieldClass} value={genre} onChange={(event) => setGenre(event.target.value)}>
            {CHARACTER_GENRES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-zinc-300">
          성별
          <select
            className={fieldClass}
            value={gender}
            onChange={(event) => setGender(event.target.value as CharacterGender)}
          >
            {(Object.keys(GENDER_LABELS) as CharacterGender[]).map((item) => (
              <option key={item} value={item}>
                {GENDER_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <SelectField label="문체" value={tone} options={TONE_OPTIONS} onChange={setTone} />
        <SelectField label="유머" value={humor} options={HUMOR_OPTIONS} onChange={setHumor} />
        <SelectField label="전개" value={pacing} options={PACING_OPTIONS} onChange={setPacing} />
        <SelectField label="작명" value={nameWordplay} options={WORDPLAY_OPTIONS} onChange={setNameWordplay} />
      </div>
      <label className="mt-3 block text-sm text-zinc-300">
        캐스트 의도 (비우면 장르 추천)
        <textarea
          className={cn(fieldClass, "min-h-20")}
          value={castIntent}
          maxLength={500}
          placeholder={recommendation?.castIntent ?? ""}
          onChange={(event) => setCastIntent(event.target.value)}
        />
      </label>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" className={primaryButton} disabled={busy != null} onClick={() => void generate()}>
          {busy === "preview" ? "생성 중…" : "원고 생성"}
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={busy != null || !preview?.repairable}
          onClick={() => void repair()}
        >
          {busy === "repair" ? "보정 중…" : "선택 보정"}
        </button>
        <button
          type="button"
          className={primaryButton}
          data-testid="admin-author-save"
          disabled={busy != null || !preview?.qaOk || !preview.previewId}
          onClick={() => void save()}
        >
          {busy === "save" ? "저장 중…" : "비공개 초안으로 저장"}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {preview && (preview.manuscript.name || preview.issues.length > 0) ? (
        <div className="mt-4 space-y-2 text-sm text-zinc-200" data-testid="admin-author-preview">
          <p data-testid="admin-author-qa">
            검수 {preview.qaOk ? "통과" : "실패"}
            {preview.textLock ? ` · Text Lock ${preview.textLock.slice(0, 12)}` : ""}
            {preview.voiceRepairs ? ` · 선택 보정 ${preview.voiceRepairs}회` : ""}
          </p>
          {preview.issues.map((issue) => (
            <p key={`${issue.code}:${issue.message}`} className="text-rose-200">
              {issue.code}: {issue.message}
            </p>
          ))}
          {preview.manuscript.name ? (
            <>
              <p className="font-semibold text-white">
                {preview.manuscript.name} — {preview.manuscript.tagline}
              </p>
              <p className="whitespace-pre-wrap text-zinc-300">{preview.manuscript.description}</p>
              <p className="whitespace-pre-wrap text-zinc-300">{preview.manuscript.greeting}</p>
            </>
          ) : null}
        </div>
      ) : null}
      {saved ? (
        <p className="mt-4 text-sm text-emerald-300" data-testid="admin-author-saved">
          비공개 초안 #{saved.characterId}
          {saved.alreadySaved ? " (이미 저장됨)" : ""}.{" "}
          <Link className="underline" href={saved.editPath}>
            에디터에서 열기
          </Link>
          {" · "}
          <Link className="underline" href="/studio">
            제작 메뉴
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function SelectField({
  label: fieldLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm text-zinc-300">
      {fieldLabel}
      <select className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

const fieldClass =
  "mt-1 w-full rounded-xl border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400";
const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50";
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-semibold text-zinc-100 disabled:opacity-50";
