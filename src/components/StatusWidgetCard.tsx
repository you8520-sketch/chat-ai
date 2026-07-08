"use client";

type Props = {
  html: string;
};

export default function StatusWidgetCard({ html }: Props) {
  if (!html.trim()) return null;
  return (
    <div className="status-widget-card my-4 w-full min-w-0 max-w-full overflow-hidden">
      <div
        className="status-widget-card__inner w-full min-w-0 max-w-full overflow-hidden"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
