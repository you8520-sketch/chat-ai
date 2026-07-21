type Props = {
  src: string;
  alt?: string;
  blurForViewer?: boolean;
  className?: string;
  imgClassName?: string;
  imgTestId?: string;
  /** 제작자 미리보기 — 가려짐 설정 표시만 */
  showHiddenBadge?: boolean;
};

export default function CharacterAssetImage({
  src,
  alt = "",
  blurForViewer = false,
  className = "",
  imgClassName = "block aspect-[3/4] w-full object-cover object-top",
  imgTestId,
  showHiddenBadge = false,
}: Props) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        data-testid={imgTestId}
        className={`${imgClassName} ${blurForViewer ? "scale-105 blur-xl" : ""}`}
        draggable={false}
      />
      {blurForViewer ? (
        <div className="absolute inset-0 bg-black/35" aria-hidden />
      ) : null}
      {showHiddenBadge && !blurForViewer && (
        <span className="absolute bottom-1 left-1 rounded bg-amber-600/90 px-1.5 py-0.5 text-[8px] font-bold text-white">
          타인 가림
        </span>
      )}
    </div>
  );
}
