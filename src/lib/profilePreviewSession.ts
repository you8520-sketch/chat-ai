import type { GeneratedProfile } from "@/lib/generateProfile";

export const PROFILE_PREVIEW_STORAGE_KEY = "hobbyai.profilePreview.v1";

export type ProfilePreviewPayload = {
  profile: GeneratedProfile;
  imageUrls: string[];
  estimated?: boolean;
  warning?: string;
  /** Set when user clicks Apply — used for cross-tab storage sync fallback */
  appliedAt?: number;
};

function writePreviewPayload(payload: ProfilePreviewPayload): void {
  const serialized = JSON.stringify(payload);
  // localStorage — 같은 origin의 팝업/새 탭에서도 읽기 가능
  localStorage.setItem(PROFILE_PREVIEW_STORAGE_KEY, serialized);
  // sessionStorage — 같은 탭 내 라우팅용
  sessionStorage.setItem(PROFILE_PREVIEW_STORAGE_KEY, serialized);
}

export const PROFILE_PREVIEW_SYNC_MESSAGE = "hobbyai-profile-preview-sync";

export function saveProfilePreviewPayload(payload: ProfilePreviewPayload): void {
  if (typeof window === "undefined") return;
  writePreviewPayload(payload);
}

export function broadcastProfilePreviewSync(payload: ProfilePreviewPayload): void {
  if (typeof window === "undefined") return;
  const withApplySignal: ProfilePreviewPayload = { ...payload, appliedAt: Date.now() };
  writePreviewPayload(withApplySignal);
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: PROFILE_PREVIEW_SYNC_MESSAGE, payload: withApplySignal },
        window.location.origin
      );
    }
  } catch {
    /* ignore */
  }
}

export function readProfilePreviewPayload(): ProfilePreviewPayload | null {
  if (typeof window === "undefined") return null;
  const raw =
    localStorage.getItem(PROFILE_PREVIEW_STORAGE_KEY) ??
    sessionStorage.getItem(PROFILE_PREVIEW_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProfilePreviewPayload;
  } catch {
    return null;
  }
}

/** AI 디자인 생성 결과 — 새 창 미리보기 (saveProfilePreviewPayload 직후 호출) */
export function openProfilePreviewWindow(): Window | null {
  if (typeof window === "undefined") return null;
  const popup = window.open(
    "/create/preview",
    "hobbyaiProfilePreview",
    "width=1280,height=920,scrollbars=yes,resizable=yes"
  );
  if (popup) {
    try {
      popup.focus();
      if (popup.location.pathname.endsWith("/create/preview")) {
        popup.location.reload();
      }
    } catch {
      /* navigation in progress */
    }
  }
  return popup;
}
