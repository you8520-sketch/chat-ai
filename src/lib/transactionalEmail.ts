import { getConfiguredPublicOrigin } from "@/lib/publicOrigin";

export const TRANSACTIONAL_EMAIL_UNCONFIGURED_MESSAGE =
  "이메일 발송이 설정되지 않아 가입 인증을 진행할 수 없습니다.";
export const TRANSACTIONAL_EMAIL_SEND_FAILED_MESSAGE =
  "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.";
export const TRANSACTIONAL_EMAIL_ORIGIN_UNVERIFIED_MESSAGE =
  "인증 메일 주소를 만들 수 없습니다. 사이트 도메인이 설정되지 않았습니다.";

const RESEND_API_URL = "https://api.resend.com/emails";

export type TransactionalEmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export function getResendApiKey(): string {
  return process.env.RESEND_API_KEY?.trim() || "";
}

export function getTransactionalFromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || process.env.RESEND_FROM?.trim() || "";
}

export function isTransactionalEmailConfigured(): boolean {
  return getResendApiKey().length > 0 && getTransactionalFromAddress().length > 0;
}

/** Email verify links use the configured public origin only — never raw forwarded hosts. */
export function resolveVerifiedMailOrigin(req: Request): string | null {
  const configured = getConfiguredPublicOrigin();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return null;
  try {
    const url = new URL(req.url);
    const host = req.headers.get("host")?.split(",")[0]?.trim();
    if (host && host.split(":")[0] !== "0.0.0.0") {
      return `${url.protocol}//${host}`;
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

export function buildEmailVerificationUrl(origin: string, rawToken: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
}

/** Confirm-page and post-verify redirects never use raw Host / request origin. */
export function resolveSafeAppRedirect(req: Request, path: string): string {
  const safePath = /^\/(?!\/)[^?#\s]*(?:\?[^#\s]*)?$/.test(path) ? path : "/";
  const origin = resolveVerifiedMailOrigin(req);
  return origin ? `${origin.replace(/\/$/, "")}${safePath}` : safePath;
}

export async function sendTransactionalEmail(
  payload: TransactionalEmailPayload
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isTransactionalEmailConfigured()) {
    return { ok: false, error: TRANSACTIONAL_EMAIL_UNCONFIGURED_MESSAGE };
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getResendApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getTransactionalFromAddress(),
      to: [payload.to],
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    }),
  });

  if (!response.ok) {
    return { ok: false, error: TRANSACTIONAL_EMAIL_SEND_FAILED_MESSAGE };
  }
  return { ok: true };
}

export function buildSignupVerificationEmail(opts: {
  nickname: string;
  verifyUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = "하브 회원가입 이메일 인증";
  const text = [
    `${opts.nickname}님, 하브 가입을 완료하려면 아래 링크를 연 뒤 인증 완료를 눌러 주세요.`,
    "",
    opts.verifyUrl,
    "",
    "링크를 열면 확인 화면이 나옵니다. 인증 완료를 누르기 전에는 계정이 만들어지지 않습니다.",
    "이 링크는 일정 시간 후 만료되며 한 번만 사용할 수 있습니다.",
    "요청하지 않으셨다면 이 메일을 무시해 주세요.",
  ].join("\n");
  const html = `
    <p>${escapeHtml(opts.nickname)}님, 하브 가입을 완료하려면 아래 링크를 연 뒤 인증 완료를 눌러 주세요.</p>
    <p><a href="${escapeHtml(opts.verifyUrl)}">이메일 인증 화면 열기</a></p>
    <p>링크를 열면 확인 화면이 나옵니다. 인증 완료를 누르기 전에는 계정이 만들어지지 않습니다.</p>
    <p>이 링크는 일정 시간 후 만료되며 한 번만 사용할 수 있습니다.</p>
    <p>요청하지 않으셨다면 이 메일을 무시해 주세요.</p>
  `.trim();
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
