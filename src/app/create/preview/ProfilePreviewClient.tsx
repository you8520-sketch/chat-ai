"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import EditableCharacterProfileCard from "@/components/EditableCharacterProfileCard";
import type { GeneratedProfile } from "@/lib/generateProfile";
import { normalizeGeneratedProfile } from "@/lib/generateProfile";
import {
  broadcastProfilePreviewSync,
  readProfilePreviewPayload,
  saveProfilePreviewPayload,
  type ProfilePreviewPayload,
} from "@/lib/profilePreviewSession";

export default function ProfilePreviewClient({ viewerDisplayName }: { viewerDisplayName: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<ProfilePreviewPayload | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = readProfilePreviewPayload();
    if (raw?.profile) {
      setPayload({ ...raw, profile: normalizeGeneratedProfile(raw.profile) });
    } else {
      setPayload(raw);
    }
    setReady(true);
  }, []);

  const handleChange = useCallback(
    (profile: GeneratedProfile, imageUrls: string[]) => {
      setPayload((prev) => {
        if (!prev) return prev;
        const next = { ...prev, profile, imageUrls };
        saveProfilePreviewPayload(next);
        return next;
      });
    },
    []
  );

  const handlePersist = useCallback(
    (profile: GeneratedProfile, imageUrls: string[]) => {
      let nextPayload: ProfilePreviewPayload | null = null;
      setPayload((prev) => {
        nextPayload = {
          profile,
          imageUrls,
          estimated: prev?.estimated,
          warning: prev?.warning,
        };
        return nextPayload;
      });
      if (nextPayload) {
        broadcastProfilePreviewSync(nextPayload);
      }
    },
    []
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] text-sm text-gray-500">
        불러오는 중…
      </div>
    );
  }

  if (!payload?.profile) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 bg-[#0a0a0a] px-6 text-center">
        <p className="text-sm text-gray-400">미리보기 데이터가 없습니다.</p>
        <p className="text-xs text-gray-600">제작 페이지에서 AI 자동 디자인 생성을 먼저 실행해 주세요.</p>
        <button
          type="button"
          onClick={() => window.close()}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
        >
          창 닫기
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] px-3 py-4 sm:px-6 sm:py-6">
      {payload.warning ? (
        <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-xs leading-relaxed text-amber-100/90">
          {payload.warning}
        </div>
      ) : null}
      <EditableCharacterProfileCard
        mode="preview"
        layout="page"
        editing
        profile={payload.profile}
        imageUrls={payload.imageUrls}
        estimated={false}
        onChange={handleChange}
        onPersist={handlePersist}
        onPreviewClose={() => router.push("/create")}
        viewerDisplayName={viewerDisplayName}
      />
    </div>
  );
}
