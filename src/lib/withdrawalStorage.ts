import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const SECURE_ROOT = path.join(process.cwd(), "data", "secure-uploads", "withdrawals");
const MAX_DOC_SIZE = 8 * 1024 * 1024;
const ALLOWED_IMAGE = new Set(["image/png", "image/jpeg", "image/webp", "image/jpg"]);
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

export type WithdrawalDocKind = "id_card" | "bankbook";

function assertAllowedImage(file: File, label: string) {
  if (!ALLOWED_IMAGE.has(file.type)) {
    throw new Error(`${label}: PNG/JPEG/WebP 이미지만 업로드할 수 있습니다.`);
  }
  if (file.size > MAX_DOC_SIZE) {
    throw new Error(`${label}: 파일 크기는 8MB 이하여야 합니다.`);
  }
}

/** 프라이빗 스토리지에 저장 — DB에는 상대 경로 키만 저장 */
export async function saveWithdrawalDocument(
  userId: number,
  kind: WithdrawalDocKind,
  file: File
): Promise<string> {
  const label = kind === "id_card" ? "신분증 사본" : "통장 사본";
  assertAllowedImage(file, label);

  const ext = EXT[file.type] ?? "bin";
  const fileName = `${kind}_${crypto.randomUUID()}.${ext}`;
  const relKey = path.join(String(userId), fileName);
  const absPath = path.join(SECURE_ROOT, relKey);

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, Buffer.from(await file.arrayBuffer()));

  return relKey.replace(/\\/g, "/");
}

export function resolveWithdrawalDocPath(storageKey: string): string {
  const normalized = storageKey.replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error("잘못된 파일 경로");
  }
  return path.join(SECURE_ROOT, normalized);
}
