"use client";

import { useMemo } from "react";
import NovelText from "@/components/NovelText";
import TaggedNovelText from "@/components/TaggedNovelText";
import JsxComponentSandbox from "@/components/JsxComponentSandbox";
import { useJsxComponentCatalog, useJsxHostBridge } from "@/components/JsxHostBridge";
import type { CharacterAsset } from "@/lib/characterAssets";
import type { InlineAssetOrientationPolicy } from "@/lib/chatAssetPresentation";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import {
  parseMarkdownPipeTable,
  partitionRichBlocksForDisplay,
  splitChatRichBlocks,
  type ChatRichBlock,
} from "@/lib/chatRichContent";
import { sanitizeChatStatusHtml, sanitizeChatVisualCardHtml } from "@/lib/chatHtmlSanitize";
import { isIncompleteJsxInvocation, resolveJsxInvocationProps } from "@/lib/jsxComponent/invocation";

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

function ChatJsxCall({ block }: { block: Extract<ChatRichBlock, { kind: "jsx-call" }> }) {
  const catalog = useJsxComponentCatalog();
  const bridge = useJsxHostBridge();
  const record = catalog.find((component) => component.name === block.name) ?? null;
  if (!record) {
    return (
      <div className="mt-3 rounded-lg border border-white/10 bg-[#0a0a0e] px-3 py-2 text-xs text-zinc-400">
        등록되지 않은 컴포넌트: {block.name}
      </div>
    );
  }
  const resolved = resolveJsxInvocationProps(record.props, block.props);
  if (!resolved.ok) {
    return (
      <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90">
        컴포넌트 호출 오류: {resolved.error}
      </div>
    );
  }
  return (
    <div className="mt-3">
      <JsxComponentSandbox
        compiled={record.compiled}
        props={resolved.props}
        title={record.name}
        chatSendEnabled={record.chatSend}
        bridge={bridge}
      />
      {record.chatSend ? (
        <p className="mt-1 text-[11px] text-amber-200/80">이 컴포넌트는 채팅 전송 기능을 사용합니다.</p>
      ) : null}
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
  inlineAssets,
  inlineOrientationPolicy,
  viewerIsCreator = false,
  unlockedUrls,
  assetSelectionKey,
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
  inlineAssets?: CharacterAsset[];
  inlineOrientationPolicy?: InlineAssetOrientationPolicy;
  viewerIsCreator?: boolean;
  unlockedUrls?: ReadonlySet<string>;
  assetSelectionKey?: string;
}) {
  const displayContent = useMemo(() => {
    if (!streaming) return content;
    let next = content;
    const fenceIdx = next.lastIndexOf("```html");
    if (fenceIdx >= 0) {
      const after = next.slice(fenceIdx + 7);
      if (!/```/.test(after)) next = next.slice(0, fenceIdx).trimEnd();
    }
    if (isIncompleteJsxInvocation(next)) {
      const open = next.lastIndexOf("<");
      next = next.slice(0, open).trimEnd();
    }
    return next;
  }, [content, streaming]);

  const { topHtml, body, bottomHtml } = useMemo(() => {
    const all = splitChatRichBlocks(displayContent);
    const filtered = proseOnly
      ? all.filter((b) => b.kind === "novel" || b.kind === "html" || b.kind === "jsx-call")
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
          if (inlineAssets && inlineAssets.length > 0) {
            return (
              <TaggedNovelText
                key={`novel-${i}`}
                content={block.text}
                assets={inlineAssets}
                display={display}
                paragraphMode={paragraphMode}
                streaming={streaming}
                viewerIsCreator={viewerIsCreator}
                unlockedUrls={unlockedUrls}
                assetSelectionKey={assetSelectionKey}
                inlineOrientationPolicy={inlineOrientationPolicy}
              />
            );
          }
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
        if (block.kind === "jsx-call") {
          return <ChatJsxCall key={`jsx-${i}`} block={block} />;
        }
        return null;
      })}
      {bottomHtml.map((html, i) => (
        <ChatStatusHtml key={`html-bottom-${i}`} html={html} visualCard placement="bottom" />
      ))}
    </>
  );
}
