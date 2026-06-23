"use client";

type Props = {
  html: string;
};

export default function StatusWidgetCard({ html }: Props) {
  if (!html.trim()) return null;
  return (
    <div className="status-widget-card my-4">
      <div
        className="status-widget-card__inner overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
