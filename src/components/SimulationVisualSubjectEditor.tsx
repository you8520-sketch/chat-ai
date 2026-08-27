"use client";

import { useMemo, useRef, useState } from "react";

import CharacterAssetImage from "@/components/CharacterAssetImage";
import type { CharacterAsset } from "@/lib/characterAssets";
import { cn, studioSurface } from "@/lib/studioDesign";
import {
  assignAssetsToVisualSubject,
  assetsForVisualSubject,
  configuredSimulationCastNames,
  unassignVisualAssets,
  type SimulationVisualSubject,
  type SimulationVisualSubjectsDocument,
} from "@/lib/simulationVisualSubjects";

type Props = {
  simulationTitle: string;
  simulationCast: string;
  assets: CharacterAsset[];
  visualSubjects: SimulationVisualSubjectsDocument;
  onVisualSubjectsChange: (next: SimulationVisualSubjectsDocument) => void;
  onAssetsChange: (next: CharacterAsset[]) => void;
  onUploadBatch: (files: File[], subjectKey: string) => Promise<void>;
  uploading?: boolean;
};

function subjectLetter(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + (index % 26));
}

export default function SimulationVisualSubjectEditor({
  simulationTitle,
  simulationCast,
  assets,
  visualSubjects,
  onVisualSubjectsChange,
  onAssetsChange,
  onUploadBatch,
  uploading = false,
}: Props) {
  const [selectedUnassigned, setSelectedUnassigned] = useState<Set<string>>(new Set());
  const [selectedOwned, setSelectedOwned] = useState<Record<string, Set<string>>>({});
  const [bulkTargetKey, setBulkTargetKey] = useState("");
  const [moveTargetBySubject, setMoveTargetBySubject] = useState<Record<string, string>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const configuredNames = useMemo(
    () => configuredSimulationCastNames(simulationCast, simulationTitle),
    [simulationCast, simulationTitle]
  );

  const activeSubjects = useMemo(
    () =>
      configuredNames.flatMap((name) => {
        const matches = visualSubjects.subjects.filter(
          (subject) => subject.name.toLowerCase() === name.toLowerCase()
        );
        return matches.length === 1 ? [matches[0]!] : [];
      }),
    [configuredNames, visualSubjects.subjects]
  );
  const activeKeys = useMemo(
    () => new Set(activeSubjects.map((subject) => subject.subjectKey)),
    [activeSubjects]
  );
  const orphanedSubjects = useMemo(
    () => visualSubjects.subjects.filter((subject) => !activeKeys.has(subject.subjectKey)),
    [activeKeys, visualSubjects.subjects]
  );

  const unassignedAssets = useMemo(
    () => assets.filter((asset) => !asset.visualSubjectKey),
    [assets]
  );

  function updateSubject(subjectKey: string, patch: Partial<SimulationVisualSubject>) {
    const next = visualSubjects.subjects.map((subject) =>
      subject.subjectKey === subjectKey ? { ...subject, ...patch } : subject
    );
    for (const subject of activeSubjects) {
      if (!next.some((row) => row.subjectKey === subject.subjectKey)) {
        next.push(subject);
      }
    }
    onVisualSubjectsChange({ version: 1, subjects: next });
  }

  function toggleUnassigned(url: string) {
    setSelectedUnassigned((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleOwned(subjectKey: string, url: string) {
    setSelectedOwned((current) => {
      const nextForSubject = new Set(current[subjectKey] ?? []);
      if (nextForSubject.has(url)) nextForSubject.delete(url);
      else nextForSubject.add(url);
      return { ...current, [subjectKey]: nextForSubject };
    });
  }

  function changeOwnedAssetAssignments(
    sourceSubject: SimulationVisualSubject,
    targetSubjectKey?: string
  ) {
    const urls = [...(selectedOwned[sourceSubject.subjectKey] ?? [])];
    if (urls.length === 0) return;
    const nextAssets = targetSubjectKey
      ? assignAssetsToVisualSubject(assets, urls, targetSubjectKey)
      : unassignVisualAssets(assets, urls);
    onAssetsChange(nextAssets);
    if (
      sourceSubject.representativeAssetUrl &&
      urls.includes(sourceSubject.representativeAssetUrl)
    ) {
      updateSubject(sourceSubject.subjectKey, { representativeAssetUrl: null });
    }
    setSelectedOwned((current) => ({ ...current, [sourceSubject.subjectKey]: new Set() }));
  }

  function renderOwnedAssetManager(
    subject: SimulationVisualSubject,
    allowRepresentative: boolean
  ) {
    const owned = assetsForVisualSubject(assets, subject.subjectKey);
    const selected = selectedOwned[subject.subjectKey] ?? new Set<string>();
    const moveTarget = moveTargetBySubject[subject.subjectKey] ?? "";
    if (owned.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {owned.map((asset, index) => (
            <div key={asset.url} className="space-y-1">
              <label
                className={cn(
                  "relative block h-16 w-12 cursor-pointer overflow-hidden rounded-lg border",
                  selected.has(asset.url) ? "border-cyan-400" : "border-zinc-700",
                  allowRepresentative && subject.representativeAssetUrl === asset.url
                    ? "ring-2 ring-amber-400/50"
                    : ""
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={selected.has(asset.url)}
                  onChange={() => toggleOwned(subject.subjectKey, asset.url)}
                />
                <CharacterAssetImage
                  src={asset.url}
                  alt=""
                  className="h-full w-full"
                  imgClassName="h-full w-full object-cover object-top"
                />
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-zinc-200">
                  {subjectLetter(index)}
                </span>
              </label>
              {allowRepresentative && (
                <button
                  type="button"
                  onClick={() =>
                    updateSubject(subject.subjectKey, {
                      representativeAssetUrl: asset.url,
                    })
                  }
                  className="block w-12 truncate text-[10px] text-amber-300"
                  title="대표 이미지로 지정"
                >
                  {subject.representativeAssetUrl === asset.url ? "대표" : "대표 지정"}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => changeOwnedAssetAssignments(subject)}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-200 disabled:opacity-40"
          >
            미지정으로 이동
          </button>
          <select
            value={moveTarget}
            onChange={(event) =>
              setMoveTargetBySubject((current) => ({
                ...current,
                [subject.subjectKey]: event.target.value,
              }))
            }
            className="rounded-lg border border-zinc-700 bg-[#080a14] px-2.5 py-1.5 text-xs text-zinc-100"
          >
            <option value="">다른 인물에게 이동</option>
            {activeSubjects
              .filter((target) => target.subjectKey !== subject.subjectKey)
              .map((target) => (
                <option key={target.subjectKey} value={target.subjectKey}>
                  {target.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={selected.size === 0 || !moveTarget}
            onClick={() => changeOwnedAssetAssignments(subject, moveTarget)}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-200 disabled:opacity-40"
          >
            이동
          </button>
        </div>
      </div>
    );
  }

  if (configuredNames.length === 0) {
    return (
      <section className={cn(studioSurface.section, "space-y-2")}>
        <h2 className="text-sm font-semibold text-zinc-100">이미지 인물 설정</h2>
        <p className="text-xs text-zinc-400">
          시뮬레이션 캐스트에 인물 이름을 추가하면 인물별 이미지·외형 설정 카드가 표시됩니다.
        </p>
      </section>
    );
  }

  return (
    <section className={cn(studioSurface.section, "space-y-4")}>
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">이미지 인물 설정</h2>
        <p className="mt-1 text-xs text-zinc-400">
          인물 카드에서 여러 장을 한꺼번에 업로드하면 자동으로 해당 인물에 연결됩니다.
        </p>
      </div>

      <div className="space-y-4">
        {activeSubjects.map((subject) => {
          const stored =
            visualSubjects.subjects.find((row) => row.subjectKey === subject.subjectKey) ?? subject;
          const owned = assetsForVisualSubject(assets, subject.subjectKey);
          return (
            <div
              key={subject.subjectKey}
              className="space-y-3 rounded-xl border border-zinc-700/80 bg-[#0e1120] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-amber-100">{subject.name}</h3>
                <span className="text-xs text-zinc-500">이미지 {owned.length}장</span>
              </div>

              <label className="block text-xs font-medium text-zinc-300">이미지 외형 설정</label>
              <textarea
                value={stored.savedAppearance}
                onChange={(event) =>
                  updateSubject(subject.subjectKey, { savedAppearance: event.target.value })
                }
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-[#080a14] px-3 py-2 text-sm text-zinc-100"
                placeholder="짧은 검은 머리, 회색 눈, 넓은 어깨..."
              />

              {renderOwnedAssetManager(stored, true)}

              <input
                ref={(node) => {
                  fileRefs.current[subject.subjectKey] = node;
                }}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (event) => {
                  const list = event.target.files;
                  if (!list?.length) return;
                  await onUploadBatch(Array.from(list), subject.subjectKey);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRefs.current[subject.subjectKey]?.click()}
                className="rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-violet-400/40 disabled:opacity-40"
              >
                + {subject.name} 이미지 여러 장 추가
              </button>
            </div>
          );
        })}
      </div>

      {unassignedAssets.length > 0 && (
        <div className="space-y-3 rounded-xl border border-dashed border-zinc-700 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">
              미지정 이미지 · {unassignedAssets.length}
            </h3>
            <button
              type="button"
              className="text-xs text-amber-300 hover:underline"
              onClick={() => {
                if (selectedUnassigned.size === unassignedAssets.length) {
                  setSelectedUnassigned(new Set());
                } else {
                  setSelectedUnassigned(new Set(unassignedAssets.map((asset) => asset.url)));
                }
              }}
            >
              {selectedUnassigned.size === unassignedAssets.length ? "전체 해제" : "전체 선택"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {unassignedAssets.map((asset, index) => (
              <label
                key={asset.url}
                className={cn(
                  "relative h-16 w-12 cursor-pointer overflow-hidden rounded-lg border",
                  selectedUnassigned.has(asset.url) ? "border-amber-400" : "border-zinc-700"
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={selectedUnassigned.has(asset.url)}
                  onChange={() => toggleUnassigned(asset.url)}
                />
                <CharacterAssetImage src={asset.url} alt="" className="h-full w-full" imgClassName="h-full w-full object-cover object-top" />
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-zinc-200">
                  {subjectLetter(index)}
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkTargetKey}
              onChange={(event) => setBulkTargetKey(event.target.value)}
              className="rounded-lg border border-zinc-700 bg-[#080a14] px-3 py-2 text-xs text-zinc-100"
            >
              <option value="">선택한 이미지 인물 지정</option>
              {activeSubjects.map((subject) => (
                <option key={subject.subjectKey} value={subject.subjectKey}>
                  {subject.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!bulkTargetKey || selectedUnassigned.size === 0}
              onClick={() => {
                onAssetsChange(
                  assignAssetsToVisualSubject(assets, [...selectedUnassigned], bulkTargetKey)
                );
                setSelectedUnassigned(new Set());
              }}
              className="rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-violet-400/40 disabled:opacity-40"
            >
              일괄 지정
            </button>
          </div>
        </div>
      )}

      {orphanedSubjects.length > 0 && (
        <details className="rounded-lg border border-zinc-800 p-3 text-xs text-zinc-400">
          <summary className="cursor-pointer font-medium text-zinc-300">
            현재 캐스트에서 빠진 인물 · {orphanedSubjects.length}
          </summary>
          <div className="mt-3 space-y-4">
            {orphanedSubjects.map((subject) => (
              <div key={subject.subjectKey} className="space-y-2 border-t border-zinc-800 pt-3">
                <div className="font-medium text-zinc-300">{subject.name}</div>
                {renderOwnedAssetManager(subject, false)}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
