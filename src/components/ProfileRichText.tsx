import type { ReactNode } from "react";
import {
  isAllowedProfileImageUrl,
  isProfileFieldLabel,
  parseProfileMarkdown,
  type ProfileBlock,
} from "@/lib/profileMarkdown";
import {
  effectiveProfileSize,
  parseProfileInlineSegments,
  PROFILE_TEXT_COLOR_CLASS,
  PROFILE_TEXT_COLORS,
  PROFILE_TEXT_SIZE_PX,
  PROFILE_TEXT_SIZES,
  stripProfileSizeTags,
  type ProfileTextSize,
} from "@/lib/profileTextFormat";
import { profileTypography } from "@/lib/profileTypography";

const FIELD_LABEL_SUFFIX = /[:：]$/;
const FIELD_ITEM_RE = /^\*\*(.{1,28}?)([:：])\*\*\s*(.+)$/;
const FIELD_ITEM_PLAIN_RE = /^(.{1,28}?)([:：])\s*(.+)$/;

function isFieldLabelBold(inner: string): boolean {
  return FIELD_LABEL_SUFFIX.test(inner.trim());
}

function splitFieldListItem(text: string): { label: string; value: string } | null {
  const trimmed = text.trim();
  if (/\[color:|\[size:|\[\/color\]|\[\/size\]/i.test(trimmed)) return null;
  const bold = trimmed.match(FIELD_ITEM_RE);
  if (bold) {
    return { label: `${bold[1].trim()}${bold[2]}`, value: bold[3].trim() };
  }
  const plain = trimmed.match(FIELD_ITEM_PLAIN_RE);
  if (plain && isFieldLabelBold(`${plain[1].trim()}${plain[2]}`)) {
    return { label: `${plain[1].trim()}${plain[2]}`, value: plain[3].trim() };
  }
  return null;
}

function renderPlainSegment(text: string, key: string) {
  const trimmed = text.trimStart();
  const lead = text.slice(0, text.length - trimmed.length);
  const labelOnly = trimmed.match(/^(.{1,28}?)([:：])\s*$/);
  if (
    labelOnly &&
    isProfileFieldLabel(labelOnly[1].trim()) &&
    !/\[size:|\[color:|\[\/size\]|\[\/color\]/i.test(trimmed)
  ) {
    return (
      <span key={key}>
        {lead}
        <strong className={profileTypography.fieldLabel}>
          {labelOnly[1].trim()}
          {labelOnly[2]}
        </strong>
      </span>
    );
  }

  const match = trimmed.match(/^(.{1,28}?)([:：])\s*(.+)$/);

  if (
    match &&
    isFieldLabelBold(`${match[1].trim()}${match[2]}`) &&
    !/\[size:|\[color:|\[\/size\]|\[\/color\]/i.test(trimmed)
  ) {
    return (
      <span key={key}>
        {lead}
        <strong className={profileTypography.fieldLabel}>
          {match[1].trim()}
          {match[2]}
        </strong>
        <span className={profileTypography.fieldValue}> {match[3]}</span>
      </span>
    );
  }

  return <span key={key}>{text}</span>;
}

/** 마크다운 본문 — **볼드** · [color] · [size] · **라벨:** 필드 */
export function ProfileInlineText({ text }: { text: string }) {
  const segments = parseProfileInlineSegments(text);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "bold") {
          const inner = seg.value;
          if (isFieldLabelBold(inner.trim())) {
            return (
              <strong key={i} className={profileTypography.fieldLabel}>
                {inner}
              </strong>
            );
          }
          return (
            <strong key={i} className="font-semibold text-inherit">
              <ProfileInlineText text={inner} />
            </strong>
          );
        }
        if (seg.type === "color") {
          return (
            <span
              key={i}
              className={PROFILE_TEXT_COLOR_CLASS[seg.color]}
              style={{ color: PROFILE_TEXT_COLORS[seg.color] }}
            >
              <ProfileInlineText text={seg.value} />
            </span>
          );
        }
        if (seg.type === "size") {
          const nested = /^\[size:/.test(seg.value.trim());
          const displaySize: ProfileTextSize = nested
            ? effectiveProfileSize(`[size:${seg.size}]${seg.value}[/size]`)
            : seg.size;
          const inner = nested ? stripProfileSizeTags(seg.value) : seg.value;
          return (
            <span
              key={i}
              className={PROFILE_TEXT_SIZES[displaySize]}
              style={{ fontSize: PROFILE_TEXT_SIZE_PX[displaySize], lineHeight: 1.45 }}
            >
              <ProfileInlineText text={inner} />
            </span>
          );
        }
        if (!seg.value) return null;
        return renderPlainSegment(seg.value, String(i));
      })}
    </>
  );
}

/** 구조 정리용 기본 라벨 — 화면에는 표시하지 않음(사용자 입력 내용이 아닌 내부 구조 표시일 뿐) */
function isSubCharacterSection(title: string): boolean {
  return /서브\s*캐릭터|조연\s*캐릭터|서브캐/i.test(title.trim());
}

function isMainCharacterSection(title: string): boolean {
  return /메인\s*캐릭터|주인공|주요\s*캐릭터/i.test(title.trim());
}

function renderBlock(block: ProfileBlock, key: number) {
  switch (block.type) {
    case "h2":
      return (
        <h3 key={key} className={profileTypography.sectionH2}>
          <ProfileInlineText text={block.text} />
        </h3>
      );
    case "h3":
      return (
        <h4 key={key} className={profileTypography.sectionH3}>
          <ProfileInlineText text={block.text} />
        </h4>
      );
    case "p":
      {
        const field = splitFieldListItem(block.text);
        if (field) {
          return (
            <p key={key} className={profileTypography.paragraph}>
              <strong className={profileTypography.fieldLabel}>{field.label}</strong>{" "}
              <ProfileInlineText text={field.value} />
            </p>
          );
        }
        return (
          <p key={key} className={profileTypography.paragraph}>
            <ProfileInlineText text={block.text} />
          </p>
        );
      }
    case "ul":
      return (
        <ul key={key} className={profileTypography.list}>
          {block.items.map((item, j) => {
            const field = splitFieldListItem(item);
            if (field) {
              return (
                <li key={j} className={profileTypography.listItem}>
                  <strong className={profileTypography.fieldLabel}>{field.label}</strong>{" "}
                  <ProfileInlineText text={field.value} />
                </li>
              );
            }
            return (
              <li key={j} className={profileTypography.listItem}>
                <ProfileInlineText text={item} />
              </li>
            );
          })}
        </ul>
      );
    case "quote":
      return (
        <blockquote key={key} className={profileTypography.blockquote}>
          <ProfileInlineText text={block.text} />
        </blockquote>
      );
    case "hr":
      return <hr key={key} className={profileTypography.divider} />;
    case "img":
      if (!isAllowedProfileImageUrl(block.url)) return null;
      return (
        <figure key={key} className="my-6 w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.url}
            alt={block.alt || "캐릭터 이미지"}
            className={profileTypography.inlineImage}
          />
          {block.alt ? (
            <figcaption className="mt-2 text-center text-xs text-gray-500">{block.alt}</figcaption>
          ) : null}
        </figure>
      );
    default:
      return null;
  }
}

/** 사이트 공통 프로필 디자인 렌더 — 칸 분할 없이 제목·필드 라벨만 굵게·색상 처리한 순차 흐름 */
export function ProfileRichText({ content }: { content: string }) {
  const blocks = parseProfileMarkdown(content);
  if (blocks.length === 0) return null;

  const nodes: ReactNode[] = [];
  let key = 0;

  for (const block of blocks) {
    if (block.type === "h2" && (isMainCharacterSection(block.text) || isSubCharacterSection(block.text))) {
      // 내부 구조 정리용 기본 라벨("메인 캐릭터"/"서브 캐릭터")은 화면에 표시하지 않음
      continue;
    }
    nodes.push(renderBlock(block, key++));
  }

  return (
    <div className="profile-rich-text min-w-0 w-full break-words [overflow-wrap:anywhere]">{nodes}</div>
  );
}
