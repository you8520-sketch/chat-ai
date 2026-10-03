"use client";

import { useCallback, useEffect, useState } from "react";
import { LUCIAN_CANONICAL_NAME, LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME } from "@/lib/officialDisplayCreatorName";

type OfficialRow = {
  id: number;
  name: string;
  tagline: string;
  creator_id: number | null;
  creator_name: string;
  official: number;
  visibility: string;
  moderation_status: string;
  nsfw: number;
  updated_at: string | null;
  draft_key: string | null;
  supply_stage: string | null;
};

type OwnerResolution =
  | { status: "ok"; id: number; nickname: string }
  | { status: "missing" }
  | { status: "ambiguous"; count: number };

type SyncResult = {
  mode: string;
  characterId: number;
  draftKey: string;
  applied: boolean;
  createdNewCharacter: boolean;
  notifiedFollowers: boolean;
  displayCreatorName: string;
  changedFields: string[];
  preflightSnapshot?: { token: string };
  before: { tagline: string; creatorName: string; lorebookKeys: string[] };
  after: { tagline: string; creatorName: string; lorebookKeys: string[]; lorebookCount: number };
};

export default function AdminOfficialCharactersClient() {
  const [rows, setRows] = useState<OfficialRow[]>([]);
  const [owner, setOwner] = useState<OwnerResolution | null>(null);
  const [aliases, setAliases] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [syncPreview, setSyncPreview] = useState<SyncResult | null>(null);
  const [preflightById, setPreflightById] = useState<Record<number, SyncResult["preflightSnapshot"]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/official-characters");
    const data = (await res.json()) as {
      characters?: OfficialRow[];
      owner?: OwnerResolution;
      error?: string;
    };
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "목록을 불러오지 못했습니다.");
      return;
    }
    setRows(data.characters ?? []);
    setOwner(data.owner ?? null);
    setAliases(
      Object.fromEntries((data.characters ?? []).map((row) => [row.id, row.creator_name]))
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveAlias(row: OfficialRow) {
    setBusyId(row.id);
    setError("");
    const res = await fetch(`/api/admin/official-characters/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_creator_name: aliases[row.id] ?? "" }),
    });
    const data = (await res.json()) as { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "공개 제작자명을 저장하지 못했습니다.");
      return;
    }
    await load();
  }

  async function syncRow(row: OfficialRow, mode: "dry_run" | "apply") {
    setBusyId(row.id);
    setError("");
    const res = await fetch("/api/admin/official-characters/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: row.id,
        draftKey: row.draft_key || undefined,
        mode,
        displayCreatorName:
          aliases[row.id] ||
          (row.name === LUCIAN_CANONICAL_NAME ? LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME : row.creator_name),
        preflightSnapshot: mode === "apply" ? preflightById[row.id] : undefined,
      }),
    });
    const data = (await res.json()) as SyncResult & { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "동기화에 실패했습니다.");
      return;
    }
    setSyncPreview(data);
    if (data.preflightSnapshot) {
      setPreflightById((current) => ({ ...current, [row.id]: data.preflightSnapshot }));
    }
    if (mode === "apply") await load();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-50">공식 캐릭터 관리</h1>
      <p className="mt-2 text-sm text-zinc-400">
        관리자 로그인으로 모든 공식 캐릭터를 보고 공개 제작자명을 바꾸거나, 승인된 원본으로 같은 ID를 갱신합니다.
        장르별 로그인 계정은 만들지 않습니다. 전체 설정 수정은 기존 제작 편집기를 재사용합니다.
        같은 ID 적용은 서버의 기본 차단 게이트와 미리보기 스냅샷이 있어야 합니다.
      </p>
      {owner?.status === "ok" ? (
        <p className="mt-3 text-xs text-zinc-500">내부 소유 계정: 사이트 관리 공식 계정 1개 (표시명과 분리)</p>
      ) : owner?.status === "missing" ? (
        <p className="mt-3 text-xs text-amber-300">사이트 관리 공식 계정이 없습니다. 새 계정을 자동 생성하지 않습니다.</p>
      ) : owner?.status === "ambiguous" ? (
        <p className="mt-3 text-xs text-amber-300">
          사이트 관리 계정이 {owner.count}개입니다. 하나를 확인하기 전에는 신규 등록을 하지 않습니다.
        </p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
      {loading ? <p className="mt-6 text-sm text-zinc-400">불러오는 중…</p> : null}

      <div className="mt-6 space-y-4">
        {rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-white/10 bg-[#11141f] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-50">
                  #{row.id} {row.name}
                  {row.official === 1 ? (
                    <span className="ml-2 rounded-md bg-violet-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      공식
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-zinc-400">{row.tagline}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {row.visibility} · {row.moderation_status}
                  {row.draft_key ? ` · ${row.draft_key}` : ""}
                </p>
              </div>
              <div className="flex min-w-[16rem] flex-col gap-2">
                <label className="text-[11px] text-zinc-400">
                  공개 제작자명
                  <input
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-zinc-100"
                    value={aliases[row.id] ?? ""}
                    onChange={(event) =>
                      setAliases((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    disabled={busyId === row.id}
                    onClick={() => void saveAlias(row)}
                  >
                    표시명 저장
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-200 disabled:opacity-50"
                    disabled={busyId === row.id}
                    onClick={() => void syncRow(row, "dry_run")}
                  >
                    동기화 미리보기
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-amber-400/40 px-3 py-1 text-xs text-amber-200 disabled:opacity-50"
                    disabled={busyId === row.id || !preflightById[row.id]}
                    onClick={() => {
                      if (!preflightById[row.id]) {
                        setError("적용 전에 같은 행의 미리보기를 먼저 실행하세요.");
                        return;
                      }
                      if (confirm(`캐릭터 #${row.id}를 같은 ID로 갱신할까요? 새 캐릭터는 만들지 않습니다.`)) {
                        void syncRow(row, "apply");
                      }
                    }}
                  >
                    같은 ID로 적용
                  </button>
                  <a
                    href={`/create?edit=${row.id}`}
                    className="rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-200"
                  >
                    전체 설정 수정
                  </a>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      {syncPreview ? (
        <section className="mt-8 rounded-2xl border border-violet-500/30 bg-violet-950/20 p-4 text-sm text-zinc-200">
          <h2 className="font-semibold text-violet-100">
            {syncPreview.applied ? "적용 결과" : "미리보기"} · #{syncPreview.characterId}
          </h2>
          <p className="mt-2 text-xs text-zinc-400">
            새 캐릭터 생성 {syncPreview.createdNewCharacter ? "예" : "아니오"} · 팔로워 알림{" "}
            {syncPreview.notifiedFollowers ? "예" : "아니오"} · 표시명 {syncPreview.displayCreatorName}
          </p>
          <p className="mt-2 text-xs">변경 필드: {syncPreview.changedFields.join(", ") || "없음"}</p>
          <p className="mt-2 text-xs">이전 한줄: {syncPreview.before.tagline}</p>
          <p className="mt-1 text-xs">이후 한줄: {syncPreview.after.tagline}</p>
          <p className="mt-1 text-xs">
            로어북 {syncPreview.after.lorebookCount}개: {syncPreview.after.lorebookKeys.join(", ")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
