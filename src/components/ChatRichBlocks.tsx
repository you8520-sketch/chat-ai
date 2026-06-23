"use client";

import { useMemo } from "react";
import NovelText from "@/components/NovelText";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import {
  parseMarkdownPipeTable,
  partitionRichBlocksForDisplay,
  splitChatRichBlocks,
} from "@/lib/chatRichContent";
import { sanitizeChatStatusHtml, sanitizeChatVisualCardHtml } from "@/lib/chatHtmlSanitize";

function ChatMarkdownTable({ markdown }: { markdown: string }) {
  const parsed = useMemo(() => parseMarkdownPipeTable(markdown), [markdown]);
  if (!parsed || parsed.rows.length === 0) {
    return (
      <pre className="chat-md-fallback mt-3 overflow-x-auto rounded-lg border border-white/10 bg-[#0a0a0e] p-3 text-xs text-zinc-300 whitespace-pre-wrap">
        {markdown}
      </pre>
    );
  }

  const header = parsed.hasHeader ? parsed.rows[0] : null;
  const body = parsed.hasHeader ? parsed.rows.slice(1) : parsed.rows;

  return (
    <div className="chat-md-root mt-3 w-full overflow-x-auto">
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

function ChatStatusHtml({
  html,
  visualCard,
  placement,
}: {
  html: string;
  visualCard?: boolean;
  placement: "top" | "bottom";
}) {
  const safe = useMemo(
    () => (visualCard ? sanitizeChatVisualCardHtml(html) : sanitizeChatStatusHtml(html)),
    [html, visualCard]
  );
  if (!safe) return null;
  return (
    <div
      className={`chat-visual-card-html overflow-x-auto rounded-lg border border-white/10 p-1 text-sm leading-relaxed ${
        placement === "bottom" ? "mt-4 border-t border-white/10 pt-3" : "mb-3"
      }`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

/** AI assistant — 소설 본문 + (OOC 요청 시) 마크다운 표·HTML 상태창 */
export default function ChatRichBlocks({
  content,
  display,
  paragraphMode = "ai",
  proseOnly = false,
  streaming = false,
}: {
  content: string;
  display?: Pick<
    ChatDisplayPrefs,
    "narrationColor" | "dialogueColor" | "userNarrationColor" | "userDialogueColor"
  >;
  paragraphMode?: "ai" | "author";
  /** 상태창은 StatusMetaCard — 본문에서 표/HTML 블록 제외 */
  proseOnly?: boolean;
  streaming?: boolean;
}) {
  const displayContent = useMemo(() => {
    if (!streaming) return content;
    const fenceIdx = content.lastIndexOf("```html");
    if (fenceIdx < 0) return content;
    const after = content.slice(fenceIdx + 7);
    if (/```/.test(after)) return content;
    return content.slice(0, fenceIdx).trimEnd();
  }, [content, streaming]);

  const { topHtml, body, bottomHtml } = useMemo(() => {
    const all = splitChatRichBlocks(displayContent);
    const filtered = proseOnly
      ? all.filter((b) => b.kind === "novel" || b.kind === "html")
      : all;
    return partitionRichBlocksForDisplay(filtered);
  }, [displayContent, proseOnly]);
  if (!displayContent.trim()) return null;

  return (
    <>
      {topHtml.map((html, i) => (
        <ChatStatusHtml key={`html-top-${i}`} html={html} visualCard placement="top" />
      ))}
      {body.map((block, i) => {
        if (block.kind === "novel") {
          return (
            <NovelText
              key={`novel-${i}`}
              content={block.text}
              display={display}
              paragraphMode={paragraphMode}
              streaming={streaming}
            />
          );
        }
        if (block.kind === "markdown-table") {
          return <ChatMarkdownTable key={`md-${i}`} markdown={block.text} />;
        }
        return null;
      })}
      {bottomHtml.map((html, i) => (
        <ChatStatusHtml key={`html-bottom-${i}`} html={html} visualCard placement="bottom" />
      ))}
    </>
  );
}
