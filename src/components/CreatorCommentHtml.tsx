"use client";

import { useMemo } from "react";
import { sanitizeCreatorCommentHtml } from "@/lib/creatorCommentHtmlSanitize";

type Props = {
  html: string;
  className?: string;
};

export default function CreatorCommentHtml({ html, className = "" }: Props) {
  const safeHtml = useMemo(() => sanitizeCreatorCommentHtml(html), [html]);
  if (!safeHtml) return null;

  return (
    <div
      className={`creator-comment-html text-sm leading-relaxed text-gray-300 ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
