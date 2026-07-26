import sharp from "sharp";

export type OptimizedUpload = {
  buffer: Buffer;
  mime: string;
  ext: string;
};

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * 품질 저하 없이 용량만 줄인다.
 * - GIF: 원본 유지 (애니메이션 재인코딩 위험)
 * - 그 외: EXIF 방향 적용·메타데이터 제거 후 lossless WebP / PNG 압축 후보를 만들고
 *   원본보다 작을 때만 교체. 더 커지면 원본 유지.
 */
export async function optimizeUploadImage(
  input: Buffer,
  mime: string
): Promise<OptimizedUpload> {
  const ext = MIME_EXT[mime] || "jpg";
  const original: OptimizedUpload = { buffer: input, mime, ext };

  if (mime === "image/gif") {
    return original;
  }

  try {
    const base = sharp(input, { failOn: "none" }).rotate();
    const candidates: OptimizedUpload[] = [original];

    const losslessWebp = await base
      .clone()
      .webp({ lossless: true, effort: 4 })
      .toBuffer();
    candidates.push({ buffer: losslessWebp, mime: "image/webp", ext: "webp" });

    if (mime === "image/png") {
      const png = await base
        .clone()
        .png({ compressionLevel: 9, effort: 7, palette: false })
        .toBuffer();
      candidates.push({ buffer: png, mime: "image/png", ext: "png" });
    }

    if (mime === "image/webp") {
      const webpLossless = await base
        .clone()
        .webp({ lossless: true, effort: 6 })
        .toBuffer();
      candidates.push({ buffer: webpLossless, mime: "image/webp", ext: "webp" });
    }

    // JPEG: 손실 재인코딩하지 않음. lossless WebP가 더 작을 때만 교체.
    return candidates.reduce((best, cur) =>
      cur.buffer.length < best.buffer.length ? cur : best
    );
  } catch (err) {
    console.warn("[upload] optimize failed — keeping original:", err);
    return original;
  }
}
