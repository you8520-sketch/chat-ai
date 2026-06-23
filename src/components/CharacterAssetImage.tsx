type Props = {
  src: string;
  alt?: string;
  blurForViewer?: boolean;
  className?: string;
  imgClassName?: string;
  /** 제작자 미리보기 — 가려짐 설정 표시만 */
  showHiddenBadge?: boolean;
};

export default function CharacterAssetImage({
  src,
  alt = "",
  blurForViewer = false,
  className = "",
  imgClassName = "h-full w-full object-cover object-top",
  showHiddenBadge = false,
}: Props) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={`${imgClassName} ${blurForViewer ? "scale-105 blur-xl" : ""}`}
        draggable={false}
      />
      {blurForViewer && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 px-2 text-center">
          <span className="text-lg">🔒</span>
          <span className="mt-1 text-[9px] font-semibold leading-tight text-zinc-300">
            제작자만 볼 수 있는 이미지
          </span>
        </div>
      )}
      {showHiddenBadge && !blurForViewer && (
        <span className="absolute right-1 top-1 rounded bg-amber-600/90 px-1.5 py-0.5 text-[8px] font-bold text-white">
          타인 가림
        </span>
      )}
    </div>
  );
}
