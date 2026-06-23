import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const SALT = "withdrawal-resident-v1";

function deriveKey(): Buffer {
  const secret =
    process.env.WITHDRAWAL_ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "dev-withdrawal-key-change-in-production";
  return crypto.scryptSync(secret, SALT, 32);
}

/** AES-256-GCM 암호화 — DB 저장용 */
export function encryptSensitive(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** 관리자 세무 export 등 서버 전용 복호화 */
export function decryptSensitive(payload: string): string {
  if (!payload) return "";
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + 16 + 1) {
    throw new Error("암호화 데이터 형식 오류");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
