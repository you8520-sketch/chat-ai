export const WORLD_COVER_MAX_PX = 1536;

export function squareCropRect(
  width: number,
  height: number
): { sx: number; sy: number; size: number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const size = Math.min(w, h);
  return {
    sx: Math.floor((w - size) / 2),
    sy: Math.floor((h - size) / 2),
    size,
  };
}

/** Center-crops the file to a square WebP for world cover cards. */
export async function cropImageFileToSquare(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const { sx, sy, size } = squareCropRect(bitmap.width, bitmap.height);
    const out = Math.min(size, WORLD_COVER_MAX_PX);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 자를 수 없습니다.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, out, out);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (next) => (next ? resolve(next) : reject(new Error("이미지를 자를 수 없습니다."))),
        "image/webp",
        0.92
      );
    });
    return new File([blob], "world-cover.webp", { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}
