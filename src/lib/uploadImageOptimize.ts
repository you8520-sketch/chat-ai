import sharp, { type Metadata } from "sharp";

export type OptimizedUpload = {
  buffer: Buffer;
  mime: string;
  ext: string;
};

export class UploadImageError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "UploadImageError";
  }
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Declared MIME -> sharp-detected format (content must match the claim). */
const MIME_FORMAT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Pixel/dimension safety guard against decompression bombs. A 40MP cap (e.g.
 * 8000x5000) is far above normal creator uploads but bounds decode memory
 * (sharp also applies its own limits). Must be enforced before any full decode.
 */
export const MAX_UPLOAD_PIXELS = 40_000_000;
export const MAX_UPLOAD_DIMENSION = 12_000;
/** Canonical stored format for new static uploads. Conservative project convention (quality 90, effort 4). */
export const UPLOAD_WEBP_QUALITY = 90;

/**
 * Authoritative upload normalization.
 *
 * input -> verify decodable (reject corrupt) -> verify MIME/content match ->
 * pixel/dimension safety -> EXIF orientation -> no-crop/no-stretch/no-upscale
 * -> canonical WebP (quality 90) -> buffer.
 *
 * Animated inputs (multi-frame GIF / animated WebP) are preserved byte-for-byte
 * so animation is never flattened. Throws UploadImageError (400) on invalid input.
 */
export async function optimizeUploadImage(
  input: Buffer,
  mime: string
): Promise<OptimizedUpload> {
  const format = MIME_FORMAT[mime];
  const ext = MIME_EXT[mime];
  if (!format || !ext) {
    throw new UploadImageError("지원하지 않는 이미지 형식입니다.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, { failOn: "error" }).metadata();
  } catch {
    throw new UploadImageError("이미지 파일을 읽을 수 없습니다.");
  }

  if (!metadata.format || metadata.format !== format) {
    throw new UploadImageError("파일 내용과 이미지 형식이 일치하지 않습니다.");
  }

  const width = Number(metadata.width ?? 0);
  const height = Number(metadata.height ?? 0);
  if (!width || !height) {
    throw new UploadImageError("이미지 크기를 확인할 수 없습니다.");
  }
  if (
    width > MAX_UPLOAD_DIMENSION ||
    height > MAX_UPLOAD_DIMENSION ||
    width * height > MAX_UPLOAD_PIXELS
  ) {
    throw new UploadImageError("이미지 해상도가 너무 큽니다.");
  }

  // GIF (any frame count) and animated WebP must not be flattened by re-encoding.
  if (format === "gif" || (metadata.pages ?? 1) > 1) {
    return { buffer: input, mime, ext };
  }

  const webp = await sharp(input, { failOn: "error" })
    .rotate()
    .webp({ quality: UPLOAD_WEBP_QUALITY, effort: 4 })
    .toBuffer();
  return { buffer: webp, mime: "image/webp", ext: "webp" };
}
