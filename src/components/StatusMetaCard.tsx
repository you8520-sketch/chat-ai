"use client";

import { useMemo } from "react";
import { parseMarkdownPipeTable } from "@/lib/chatRichContent";
import type { StatusMeta } from "@/lib/statusMeta/types";
import { statusMetaDisplayMarkdown } from "@/lib/statusMeta/render";
import { isPlainTextStatusFormatSpec } from "@/lib/statusMeta/formatSpec";

function StatusMetaTable({ markdown }: { markdown: string }) {
  const parsed = useMemo(() => parseMarkdownPipeTable(markdown), [markdown]);
  if (!parsed || parsed.rows.length === 0) {
    return (
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{markdown}</div>
    );
  }

  const header = parsed.hasHeader ? parsed.rows[0] : null;
  const body = parsed.hasHeader ? parsed.rows.slice(1) : parsed.rows;

  return (
    <div className="chat-md-root w-full overflow-x-auto">
      <table className="chat-md-table w-full min-w-[16rem]">
        {header ? (
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="chat-md-th"
                  style={{ textAlign: parsed.alignments[i] ?? "left" }}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="chat-md-td"
                  style={{ textAlign: parsed.alignments[ci] ?? "left" }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 매턴 plain 줄글 상태창 — StatusMetaCard와 동일 스타일, 본문과 분리 표시 */
export function PlainStatusBlock({ content }: { content: string }) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return (
    <div className="status-meta-card mt-4 rounded-xl border border-white/10 bg-gradient-to-b from-[#12121a] to-[#0a0a0e] px-4 py-3 text-sm leading-relaxed text-zinc-300 shadow-lg shadow-black/20">
      <div className="whitespace-pre-wrap">{trimmed}</div>
    </div>
  );
}

export default function StatusMetaCard({
  meta,
  formatSpec,
  pending,
  showStatusMeta,
  failed,
  placement = "bottom",
}: {
  meta: StatusMeta | null | undefined;
  formatSpec?: string | null;
  pending?: boolean;
  showStatusMeta?: boolean;
  failed?: boolean;
  placement?: "top" | "bottom";
}) {
  const gapClass = placement === "top" ? "mb-8" : "mt-8";

  if (!showStatusMeta) return null;

  if (pending) {
    return (
      <div className={`status-meta-card ${gapClass} rounded-xl border border-white/10 bg-[#0c0c10]/90 px-4 py-3 text-sm text-zinc-500`}>
        <span className="animate-pulse">상태창 불러오는 중…</span>
      </div>
    );
  }

  const tableMarkdown = meta?.tableMarkdown?.trim()
    ? statusMetaDisplayMarkdown(meta, formatSpec)
    : null;

  const hasDisplayContent =
    Boolean(tableMarkdown) ||
    (meta != null &&
      (Boolean(meta.datetime?.trim()) ||
        Boolean(meta.location?.trim()) ||
        Boolean(meta.relationship?.trim()) ||
        Boolean(meta.sceneSummary?.trim()) ||
        Boolean(meta.npcEmotion?.trim()) ||
        Boolean(meta.npcIntent?.trim()) ||
        Boolean(meta.nextObjective?.trim()) ||
        Boolean(meta.hiddenThought?.trim())));

  if (failed || !hasDisplayContent) {
    return (
      <div className={`status-meta-card ${gapClass} rounded-xl border border-white/10 bg-[#0c0c10]/90 px-4 py-3 text-sm text-zinc-500`}>
        상태창을 불러오지 못했습니다. 잠시 후 새로고침하거나 답변을 재생성해 주세요.
      </div>
    );
  }

  if (!meta) return null;

  if (tableMarkdown) {
    const plainLines = formatSpec && isPlainTextStatusFormatSpec(formatSpec);
    return (
      <div
        className={`status-meta-card ${gapClass} rounded-xl border border-amber-500/20 bg-[#181820] px-2 py-2 text-sm leading-relaxed text-zinc-200 shadow-lg shadow-black/20`}
      >
        {plainLines ? (
          <div className="whitespace-pre-wrap px-2 py-1">{tableMarkdown}</div>
        ) : (
          <StatusMetaTable markdown={tableMarkdown} />
        )}
      </div>
    );
  }

  const objectives = [meta.npcIntent, meta.nextObjective]
    .flatMap((s) => (s ?? "").split(/[·•\n]/))
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className={`status-meta-card ${gapClass} rounded-xl border border-white/10 bg-gradient-to-b from-[#12121a] to-[#0a0a0e] px-4 py-3 text-sm leading-relaxed text-zinc-300 shadow-lg shadow-black/20`}>
      <div className="mb-2 border-b border-white/10 pb-2 text-xs font-semibold tracking-wide text-zinc-500">
        ━━━━━━━━━━━━━━
      </div>
      <section className="space-y-1">
        <h4 className="text-xs font-semibold text-zinc-400">📍 현재 상황</h4>
        {meta.datetime?.trim() && (
          <p>
            <span className="text-zinc-500">시간:</span> {meta.datetime}
          </p>
        )}
        {meta.location?.trim() && (
          <p>
            <span className="text-zinc-500">장소:</span> {meta.location}
          </p>
        )}
        {meta.relationship?.trim() && (
          <p>
            <span className="text-zinc-500">관계:</span> {meta.relationship}
          </p>
        )}
        {meta.sceneSummary?.trim() && (
          <p className="text-zinc-400">{meta.sceneSummary}</p>
        )}
      </section>

      {meta.npcEmotion?.trim() && (
        <section className="mt-3 space-y-1">
          <h4 className="text-xs font-semibold text-zinc-400">💭 NPC 감정</h4>
          <p>{meta.npcEmotion}</p>
        </section>
      )}

      {objectives.length > 0 && (
        <section className="mt-3 space-y-1">
          <h4 className="text-xs font-semibold text-zinc-400">🎯 NPC 목표</h4>
          <ul className="list-none space-y-0.5 pl-0">
            {objectives.map((item, i) => (
              <li key={i} className="text-zinc-300">
                • {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {meta.hiddenThought?.trim() && (
        <section className="mt-3 space-y-1">
          <h4 className="text-xs font-semibold text-zinc-400">🫀 속마음</h4>
          <p className="italic text-zinc-400">&ldquo;{meta.hiddenThought.replace(/^["']|["']$/g, "")}&rdquo;</p>
        </section>
      )}
      <div className="mt-2 border-t border-white/10 pt-2 text-xs text-zinc-600">━━━━━━━━━━━━━━</div>
    </div>
  );
}
