"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import CreatorCommentHtml from "@/components/CreatorCommentHtml";
import { CHARACTER_GENRES } from "@/lib/characterGenres";
import { GENDER_LABELS, type CharacterGender } from "@/lib/characterGender";
import {
  adminAuthorManuscriptPresent,
  adminAuthorPreviewDownloadName,
  adminAuthorPreviewExportJson,
  copyOrDownloadAdminAuthorPreviewJson,
  readAdminAuthorServerFailure,
  type AdminAuthorPreviewExport,
} from "@/lib/officialSupply/adminAuthorPreviewExport";
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

type Preview = AdminAuthorPreviewExport & {
  viewOnly?: boolean;
};

function readRejectedManuscript(value: unknown): { greeting: string; description: string; comment: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const greeting = typeof row.greeting === "string" ? row.greeting : "";
  const description = typeof row.description === "string" ? row.description : "";
  const comment = typeof row.comment === "string" ? row.comment : "";
  if (!greeting && !description && !comment) return null;
  return { greeting, description, comment };
}

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
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState<"preview" | "repair" | "save" | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [copyNote, setCopyNote] = useState("");
  const [saved, setSaved] = useState<{
    characterId: number;
    editPath: string;
    alreadySaved: boolean;
    partialSave: boolean;
  } | null>(null);
  const previewRequestSeq = useRef(0);

  const recommendation = useMemo(
    () => recommendations.find((item) => item.genre === genre) ?? recommendations[0],
    [genre, recommendations]
  );

  useEffect(() => {
    previewRequestSeq.current += 1;
    setPreview(null);
    setSaved(null);
    setError("");
    setCopyNote("");
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
    const requestSeq = ++previewRequestSeq.current;
    setBusy("preview");
    setError("");
    setSaved(null);
    setCopyNote("");
    setPreview(null);
    const { status, payload } = await post("/api/admin/official-author/preview", {
      genre,
      tone,
      humor,
      pacing,
      nameWordplay,
      gender,
      castIntent,
      adult,
    });
    setBusy(null);
    if (requestSeq !== previewRequestSeq.current) return;
    if (payload.ok !== true) {
      const issues = Array.isArray(payload.issues) ? payload.issues : [];
      setError(typeof payload.error === "string" ? payload.error : "생성에 실패했습니다.");
      const rejected = readRejectedManuscript(payload.rejectedManuscript);
      const manuscript = {
        name: "",
        tagline: "",
        description: rejected?.description ?? "",
        greeting: rejected?.greeting ?? "",
        genres: [] as string[],
        tags: [] as string[],
      };
      setPreview({
        previewId: "",
        qaOk: false,
        repairable: false,
        voiceRepairs: 0,
        adult,
        textLock: "",
        viewOnly: Boolean(rejected),
        creatorComment: rejected?.comment ?? "",
        manuscript,
        resolved: recommendation ?? {
          genre,
          tone: "",
          humor: "",
          pacing: "",
          nameWordplay: "",
          worldScale: "",
          namingProfile: "",
          castIntent,
        },
        issues: issues as Preview["issues"],
        ...readAdminAuthorServerFailure({ httpStatus: status, payload }),
        selection: { genre, tone, humor, pacing, nameWordplay, gender, castIntent },
        resolvedSource: "client_recommendation",
        manuscriptPresent: adminAuthorManuscriptPresent(manuscript),
      });
      return;
    }
    setPreview(payload as unknown as Preview);
  }

  async function repair() {
    if (!preview?.previewId) return;
    const requestSeq = previewRequestSeq.current;
    setBusy("repair");
    setError("");
    setCopyNote("");
    const { payload } = await post("/api/admin/official-author/repair", { previewId: preview.previewId });
    setBusy(null);
    if (requestSeq !== previewRequestSeq.current) return;
    if (payload.ok !== true) {
      setError(typeof payload.error === "string" ? payload.error : "보정에 실패했습니다.");
      return;
    }
    setPreview(payload as unknown as Preview);
  }

  async function save() {
    if (!preview?.previewId || !preview.qaOk) return;
    const requestSeq = previewRequestSeq.current;
    setBusy("save");
    setError("");
    const { payload } = await post("/api/admin/official-author/save", { previewId: preview.previewId });
    setBusy(null);
    if (requestSeq !== previewRequestSeq.current) return;
    if (payload.ok !== true) {
      setError(typeof payload.error === "string" ? payload.error : "저장에 실패했습니다.");
      if (typeof payload.characterId === "number" && Number.isFinite(payload.characterId)) {
        setSaved({
          characterId: payload.characterId,
          editPath:
            typeof payload.editPath === "string" ? payload.editPath : `/create?edit=${payload.characterId}`,
          alreadySaved: false,
          partialSave: payload.partialSave === true,
        });
      }
      return;
    }
    setSaved({
      characterId: Number(payload.characterId),
      editPath: String(payload.editPath),
      alreadySaved: payload.alreadySaved === true,
      partialSave: false,
    });
  }

  async function copyPreviewJson() {
    if (!preview) return;
    const json = adminAuthorPreviewExportJson(preview);
    const outcome = await copyOrDownloadAdminAuthorPreviewJson(
      json,
      adminAuthorPreviewDownloadName(preview.previewId)
    );
    setCopyNote(
      outcome === "copied"
        ? "미리보기 JSON을 복사했습니다."
        : "클립보드를 쓸 수 없어 JSON 파일로 저장했습니다."
    );
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
      <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={adult}
          onChange={(event) => setAdult(event.target.checked)}
        />
        성인 캐릭터로 제작 (제작 권한 필요)
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
          disabled={busy != null || !preview?.qaOk || !preview.previewId || preview.viewOnly === true}
          onClick={() => void save()}
        >
          {busy === "save" ? "저장 중…" : "비공개 초안으로 저장"}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {preview && (preview.manuscript.name || preview.manuscript.description || preview.manuscript.greeting || preview.issues.length > 0 || preview.error || preview.httpStatus) ? (
        <div className="mt-4 space-y-2 text-sm text-zinc-200" data-testid="admin-author-preview">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p data-testid="admin-author-qa">
              {preview.adult ? "성인" : "일반"} · 검수 {preview.qaOk ? "통과" : "실패"}
              {preview.textLock ? ` · Text Lock ${preview.textLock.slice(0, 12)}` : ""}
              {preview.voiceRepairs ? ` · 선택 보정 ${preview.voiceRepairs}회` : ""}
            </p>
            <button
              type="button"
              className={secondaryButton}
              data-testid="admin-author-copy-json"
              onClick={() => void copyPreviewJson()}
            >
              미리보기 JSON 복사
            </button>
          </div>
          {copyNote ? <p className="text-xs text-zinc-400">{copyNote}</p> : null}
          {preview.viewOnly ? (
            <p data-testid="admin-author-rejected" className="text-amber-200">
              검수에서 탈락한 원고입니다. 열람만 가능하며 저장·승인·공개되지 않습니다.
            </p>
          ) : null}
          {preview.issues.map((issue) => (
            <p key={`${issue.code}:${issue.message}`} className="text-rose-200">
              {issue.code}: {issue.message}
            </p>
          ))}
          {preview.manuscript.name ? (
            <p className="font-semibold text-white">
              {preview.manuscript.name} — {preview.manuscript.tagline}
            </p>
          ) : null}
          {preview.manuscript.description ? (
            <p className="whitespace-pre-wrap text-zinc-300" data-testid="admin-author-rejected-description">
              {preview.manuscript.description}
            </p>
          ) : null}
          {preview.manuscript.greeting ? (
            <p className="whitespace-pre-wrap text-zinc-300" data-testid="admin-author-rejected-greeting">
              {preview.manuscript.greeting}
            </p>
          ) : null}
          {preview.creatorComment ? (
            <div data-testid="admin-author-creator-comment">
              <p className="font-semibold text-zinc-200">제작자 코멘트</p>
              <div data-testid="admin-author-rejected-comment">
                <CreatorCommentHtml html={preview.creatorComment} className="text-zinc-300" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {saved ? (
        <p className="mt-4 text-sm text-emerald-300" data-testid="admin-author-saved">
          비공개 초안 #{saved.characterId}
          {saved.partialSave
            ? " (부분 저장 — 후속 단계 실패, 에디터에서 확인)"
            : saved.alreadySaved
              ? " (이미 저장됨)"
              : ""}
          .{" "}
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
