"use client";

import { useEffect, useState } from "react";
import type { ProfileData } from "@/lib/formatProfile";

const fieldCls =
  "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40";

type EditDraft = {
  name: string;
  tags: string;
  coreGoal: string;
  description: string;
  imageUrl: string;
};

function toDraft(data: ProfileData): EditDraft {
  return {
    name: data.name ?? "",
    tags: data.tags?.join(", ") ?? "",
    coreGoal: data.coreGoal ?? "",
    description: data.description ?? "",
    imageUrl: data.imageUrl ?? "",
  };
}

function draftToProfile(draft: EditDraft): ProfileData {
  return {
    name: draft.name.trim() || null,
    tags: draft.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    coreGoal: draft.coreGoal.trim() || null,
    description: draft.description.trim() || null,
    imageUrl: draft.imageUrl.trim() || null,
  };
}

export default function ProfilePreviewCard({
  profileData,
  onChange,
  estimated,
}: {
  profileData: ProfileData;
  onChange: (data: ProfileData) => void;
  estimated?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(() => toDraft(profileData));
  const [snapshot, setSnapshot] = useState<EditDraft>(() => toDraft(profileData));

  useEffect(() => {
    if (!isEditing) {
      setDraft(toDraft(profileData));
      setSnapshot(toDraft(profileData));
    }
  }, [profileData, isEditing]);

  function startEdit() {
    const cur = toDraft(profileData);
    setDraft(cur);
    setSnapshot(cur);
    setIsEditing(true);
  }

  function saveEdit() {
    onChange(draftToProfile(draft));
    setIsEditing(false);
  }

  function cancelEdit() {
    setDraft(snapshot);
    setIsEditing(false);
  }

  const data = isEditing ? draftToProfile(draft) : profileData;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#131626] shadow-xl shadow-black/30">
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0e1120] px-4 py-3">
        <div>
          <p className="text-xs font-bold text-violet-300">AI 정렬 프로필</p>
          {estimated && !isEditing && (
            <p className="text-[10px] text-amber-400/80">데모/추정 변환</p>
          )}
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={saveEdit}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500"
              >
                저장
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-700"
              >
                취소
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:border-violet-500/50"
            >
              수정하기
            </button>
          )}
        </div>
      </div>

      <div className="p-5">
        {isEditing ? (
          <EditForm draft={draft} setDraft={setDraft} />
        ) : (
          <PreviewView data={data} />
        )}
      </div>
    </div>
  );
}

function PreviewView({ data }: { data: ProfileData }) {
  return (
    <div className="space-y-5">
      {data.imageUrl && (
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.imageUrl}
            alt=""
            className="max-h-64 w-full max-w-full rounded-xl object-contain shadow-lg shadow-black/40"
          />
        </div>
      )}

      <h2 className="text-3xl font-bold text-white">{data.name || "이름 없음"}</h2>

      {data.tags && data.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-violet-600/30 px-3 py-1 text-xs font-semibold text-violet-200 ring-1 ring-violet-500/40"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {data.coreGoal && (
        <blockquote className="border-l-4 border-violet-500 bg-violet-500/10 px-4 py-3 text-sm italic leading-relaxed text-violet-100">
          {data.coreGoal}
        </blockquote>
      )}

      {data.description && (
        <div className="space-y-3 text-sm leading-relaxed text-gray-200">
          {data.description.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {para}
            </p>
          ))}
        </div>
      )}

      {!data.name && !data.description && !data.coreGoal && (
        <p className="text-sm italic text-gray-500">프로필 데이터가 비어 있습니다.</p>
      )}
    </div>
  );
}

function EditForm({ draft, setDraft }: { draft: EditDraft; setDraft: (d: EditDraft) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-400">이름</label>
        <input
          className={fieldCls}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="캐릭터 이름"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-400">태그 (쉼표 구분)</label>
        <input
          className={fieldCls}
          value={draft.tags}
          onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          placeholder="네크로맨서, 회귀자, 판타지"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-400">핵심 목표 / 한 줄 요약</label>
        <input
          className={fieldCls}
          value={draft.coreGoal}
          onChange={(e) => setDraft({ ...draft, coreGoal: e.target.value })}
          placeholder="캐릭터의 핵심 목표"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-400">이미지 URL</label>
        <input
          className={fieldCls}
          value={draft.imageUrl}
          onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
          placeholder="https://..."
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-400">상세 설명</label>
        <textarea
          rows={8}
          className={fieldCls}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="상세 소개 본문"
        />
      </div>
    </div>
  );
}
