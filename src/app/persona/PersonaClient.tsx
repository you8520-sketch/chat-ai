"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { GENDER_LABELS, type CharacterGender } from "@/lib/characterGender";
import {
  PERSONA_NAME_LIMIT,
  PERSONA_CONTENT_MAX,
  USER_PERSONA_MAX_COUNT,
  USER_NOTE_MAX,
  USER_NOTE_FOCUS_MAX,
  personaContentLength,
  personaCombinedContentLength,
  capPersonaFieldToSharedBudget,
} from "@/lib/persona";
import {
  PERSONA_IMAGE_FOCUS_DEFAULT,
  type OwnerPersonaEditorItem,
  type PublicPersonaListItem,
} from "@/lib/userPersonasClient";
import type { PersonaSecretSettingsCapability } from "@/lib/personaSecretCapabilities";
import type { PersonaSecretCompileSummaryDto } from "@/lib/personaSecretCompiler";
import {
  applyOwnerEditorCacheUpdate,
  resolveSecretDraftOnStartEdit,
  shouldHydrateSecretDraftFromEditor,
} from "@/lib/personaSecretEditHydration";
import type { UserNotePresetItem } from "@/lib/userNotePresetTypes";
import { USER_NOTE_PRESET_TITLE_MAX } from "@/lib/userNotePresetTypes";
import UserNoteSplitEditor from "@/components/UserNoteSplitEditor";
import StatusWidgetEditor from "@/components/StatusWidgetEditor";
import {
  STATUS_WIDGET_SHARED_DESIGN_HREF,
  STATUS_WIDGET_SHARED_DESIGN_LABEL,
} from "@/lib/statusWidget/authoringChoice";
import ShareLinkBox from "@/components/ShareLinkBox";
import PersonaAvatar from "@/components/PersonaAvatar";
import PersonaImageEditor from "@/components/PersonaImageEditor";
import {
  readStoredFocus,
  userNoteCombinedCharCount,
  parseUserNoteCombined,
  validateUserNoteFocusPreset,
} from "@/lib/userNoteStatusWindow";
import type { StatusWidgetPresetItem } from "@/lib/statusWidgetPresetTypes";
import { STATUS_WIDGET_PRESET_TITLE_MAX } from "@/lib/statusWidgetPresetTypes";
import {
  characterStatusWidgetOrDefault,
  parseStatusWidgetJson,
  serializeStatusWidget,
  type StatusWidget,
} from "@/lib/statusWidget";
import { estimateStatusWidgetContextChars, formatWidgetBudgetHint, STATUS_WIDGET_USER_CONTEXT_MAX } from "@/lib/statusWidget/contextBudget";
import type { StatusWidgetShareVisibility } from "@/lib/statusWidgetShareTypes";
import StudioButton from "@/components/studio/StudioButton";
import {
  EditingBadge,
  EditorActionBar,
  ScopedNotice,
  type PageNotice,
} from "@/components/studio/PersonaPageParts";
import {
  UNSAVED_DRAFT_CONFIRM_MESSAGE,
  isPersonaDraftDirty,
  isTitledDraftDirty,
} from "@/lib/personaDraftDirty";
import {
  cn,
  studioInputClass,
  studioSurface,
  studioTextareaClass,
  studioType,
} from "@/lib/studioDesign";

type NoticeScope = "persona" | "note" | "widget";

const DEFAULT_SECRET_SETTINGS: PersonaSecretSettingsCapability = {
  canEdit: false,
  discoveryActive: false,
};

export default function PersonaClient({
  initialPersonas,
  initialNotePresets,
  initialStatusWidgetPresets,
  initialSecretSettings = DEFAULT_SECRET_SETTINGS,
  nickname,
}: {
  initialPersonas: PublicPersonaListItem[];
  initialNotePresets: UserNotePresetItem[];
  initialStatusWidgetPresets: StatusWidgetPresetItem[];
  /** Safe capability only — never includes secret source. */
  initialSecretSettings?: PersonaSecretSettingsCapability;
  nickname: string;
}) {
  const router = useRouter();
  const [personas, setPersonas] = useState(initialPersonas);
  const [notePresets, setNotePresets] = useState(initialNotePresets);
  const [statusWidgetPresets, setStatusWidgetPresets] = useState(initialStatusWidgetPresets);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftMemo, setDraftMemo] = useState("");
  const [draftGender, setDraftGender] = useState<CharacterGender | "">("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftSecretDescription, setDraftSecretDescription] = useState("");
  const [draftSecretDescriptionLoaded, setDraftSecretDescriptionLoaded] = useState(false);
  const [draftSecretDescriptionDirty, setDraftSecretDescriptionDirty] = useState(false);
  const [secretSettings, setSecretSettings] =
    useState<PersonaSecretSettingsCapability>(initialSecretSettings);
  const [editorPersonas, setEditorPersonas] = useState<Record<number, OwnerPersonaEditorItem>>({});
  const [compileSummary, setCompileSummary] = useState<PersonaSecretCompileSummaryDto | null>(null);
  const [compilePreservedPrior, setCompilePreservedPrior] = useState(false);
  const [draftImageUrl, setDraftImageUrl] = useState("");
  const [draftImageFocusX, setDraftImageFocusX] = useState<number>(PERSONA_IMAGE_FOCUS_DEFAULT.x);
  const [draftImageFocusY, setDraftImageFocusY] = useState<number>(PERSONA_IMAGE_FOCUS_DEFAULT.y);
  const [creating, setCreating] = useState(false);
  const [noteCreating, setNoteCreating] = useState(false);
  const [noteEditingId, setNoteEditingId] = useState<number | null>(null);
  const [noteDraftTitle, setNoteDraftTitle] = useState("");
  const [noteDraftContent, setNoteDraftContent] = useState("");
  const [widgetCreating, setWidgetCreating] = useState(false);
  const [widgetEditingId, setWidgetEditingId] = useState<number | null>(null);
  const [widgetDraftTitle, setWidgetDraftTitle] = useState("");
  const [widgetDraft, setWidgetDraft] = useState<StatusWidget>(() =>
    characterStatusWidgetOrDefault(null)
  );
  const [notice, setNotice] = useState<(PageNotice & { scope: NoticeScope }) | null>(null);
  const noticeScopeRef = useRef<NoticeScope>("persona");
  const [noticeAnchor, setNoticeAnchor] = useState<{ scope: NoticeScope; id: number | null } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const widgetBaselineRef = useRef("");
  const personaEditorRef = useRef<HTMLDivElement>(null);
  const noteEditorRef = useRef<HTMLDivElement>(null);
  const widgetEditorRef = useRef<HTMLDivElement>(null);
  const formIds = useId();
  const setMsg = (text: string) =>
    setNotice(text ? { scope: noticeScopeRef.current, kind: "ok", text } : null);
  const setError = (text: string) =>
    setNotice(text ? { scope: noticeScopeRef.current, kind: "error", text } : null);
  const [widgetShare, setWidgetShare] = useState<{
    slug: string;
    path: string;
    visibility: StatusWidgetShareVisibility;
  } | null>(null);
  const [focusMaxChars, setFocusMaxChars] = useState(USER_NOTE_FOCUS_MAX);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data: { user?: { memoryCapability?: { focusMaxChars?: number } } }) => {
        if (cancelled) return;
        const next = data.user?.memoryCapability?.focusMaxChars;
        if (typeof next === "number" && next > 0) setFocusMaxChars(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPersonas(initialPersonas);
  }, [initialPersonas]);

  useEffect(() => {
    setSecretSettings(initialSecretSettings);
  }, [initialSecretSettings]);

  useEffect(() => {
    let cancelled = false;
    async function loadOwnerCapabilities() {
      try {
        const publicRes = await fetch("/api/personas", { cache: "no-store" });
        const publicData = (await publicRes.json()) as {
          personas?: PublicPersonaListItem[];
          capabilities?: { personaSecretSettings?: PersonaSecretSettingsCapability };
        };
        if (cancelled || !publicRes.ok) return;
        if (Array.isArray(publicData.personas)) setPersonas(publicData.personas);
        const capability = publicData.capabilities?.personaSecretSettings ?? DEFAULT_SECRET_SETTINGS;
        setSecretSettings(capability);
        if (!capability.canEdit) return;

        const editorRes = await fetch("/api/personas/editor", { cache: "no-store" });
        const editorData = (await editorRes.json()) as { personas?: OwnerPersonaEditorItem[] };
        if (cancelled || !editorRes.ok || !Array.isArray(editorData.personas)) return;
        setEditorPersonas(
          Object.fromEntries(editorData.personas.map((persona) => [persona.id, persona]))
        );
      } catch {
        // The public editor remains usable; do not convert an owner secret load
        // failure into an empty secret draft.
      }
    }
    void loadOwnerCapabilities();
    return () => {
      cancelled = true;
    };
  }, []);

  function personaDraftHasUnsavedChanges() {
    if (!creating && editingId == null) return false;
    return isPersonaDraftDirty(
      {
        name: draftName,
        memo: draftMemo,
        gender: draftGender,
        description: draftDesc,
        imageUrl: draftImageUrl,
        imageFocusX: draftImageFocusX,
        imageFocusY: draftImageFocusY,
        secretDescription: draftSecretDescription,
        secretDirty: draftSecretDescriptionDirty,
      },
      editingId != null ? (personas.find((item) => item.id === editingId) ?? null) : null
    );
  }

  function requestCancelForm() {
    if (personaDraftHasUnsavedChanges() && !confirm(UNSAVED_DRAFT_CONFIRM_MESSAGE)) return;
    cancelForm();
  }

  function startEdit(p: PublicPersonaListItem) {
    noticeScopeRef.current = "persona";
    if (editingId === p.id && !creating) {
      personaEditorRef.current?.focus({ preventScroll: true });
      return;
    }
    if (personaDraftHasUnsavedChanges() && !confirm(UNSAVED_DRAFT_CONFIRM_MESSAGE)) return;
    setEditingId(p.id);
    setDraftName(p.name);
    setDraftMemo(p.memo ?? "");
    setDraftGender(p.gender ?? "other");
    setDraftDesc(p.description);
    const editor = editorPersonas[p.id];
    const secretDraft = resolveSecretDraftOnStartEdit(editor);
    setDraftSecretDescription(secretDraft.draftSecretDescription);
    setDraftSecretDescriptionLoaded(secretDraft.draftSecretDescriptionLoaded);
    setDraftSecretDescriptionDirty(false);
    setCompileSummary(null);
    setCompilePreservedPrior(false);
    setDraftImageUrl(p.image_url ?? "");
    setDraftImageFocusX(p.image_focus_x ?? PERSONA_IMAGE_FOCUS_DEFAULT.x);
    setDraftImageFocusY(p.image_focus_y ?? PERSONA_IMAGE_FOCUS_DEFAULT.y);
    setCreating(false);
    setError("");
    setMsg("");
  }

  function startCreate() {
    noticeScopeRef.current = "persona";
    if (personaDraftHasUnsavedChanges() && !confirm(UNSAVED_DRAFT_CONFIRM_MESSAGE)) return;
    if (personas.length >= USER_PERSONA_MAX_COUNT) {
      setError(`페르소나는 최대 ${USER_PERSONA_MAX_COUNT.toLocaleString()}개까지 만들 수 있습니다.`);
      setMsg("");
      return;
    }
    setCreating(true);
    setEditingId(null);
    setDraftName("");
    setDraftMemo("");
    setDraftGender("");
    setDraftDesc("");
    setDraftSecretDescription("");
    setDraftSecretDescriptionLoaded(true);
    setDraftSecretDescriptionDirty(false);
    setCompileSummary(null);
    setCompilePreservedPrior(false);
    setDraftImageUrl("");
    setDraftImageFocusX(PERSONA_IMAGE_FOCUS_DEFAULT.x);
    setDraftImageFocusY(PERSONA_IMAGE_FOCUS_DEFAULT.y);
    setError("");
    setMsg("");
  }

  function cancelForm() {
    setCreating(false);
    setEditingId(null);
    setDraftName("");
    setDraftMemo("");
    setDraftGender("");
    setDraftDesc("");
    setDraftSecretDescription("");
    setDraftSecretDescriptionLoaded(false);
    setDraftSecretDescriptionDirty(false);
    setCompileSummary(null);
    setCompilePreservedPrior(false);
    setDraftImageUrl("");
    setDraftImageFocusX(PERSONA_IMAGE_FOCUS_DEFAULT.x);
    setDraftImageFocusY(PERSONA_IMAGE_FOCUS_DEFAULT.y);
  }

  useEffect(() => {
    if (editingId == null) return;
    const editor = editorPersonas[editingId];
    if (
      !shouldHydrateSecretDraftFromEditor({
        canEdit: secretSettings.canEdit,
        draftSecretDescriptionLoaded,
        draftSecretDescriptionDirty,
        hasEditor: Boolean(editor),
      })
    ) {
      return;
    }
    setDraftSecretDescription(editor!.secret_description);
    setDraftSecretDescriptionLoaded(true);
  }, [
    draftSecretDescriptionDirty,
    draftSecretDescriptionLoaded,
    editingId,
    editorPersonas,
    secretSettings.canEdit,
  ]);

  useEffect(() => {
    if (!creating && editingId == null) return;
    personaEditorRef.current?.scrollIntoView({ block: "start" });
    personaEditorRef.current?.focus({ preventScroll: true });
  }, [creating, editingId]);

  useEffect(() => {
    if (!noteCreating && noteEditingId == null) return;
    noteEditorRef.current?.scrollIntoView({ block: "start" });
    noteEditorRef.current?.focus({ preventScroll: true });
  }, [noteCreating, noteEditingId]);

  useEffect(() => {
    if (!widgetCreating && widgetEditingId == null) return;
    widgetEditorRef.current?.scrollIntoView({ block: "start" });
    widgetEditorRef.current?.focus({ preventScroll: true });
  }, [widgetCreating, widgetEditingId]);

  async function refreshList() {
    try {
      const res = await fetch("/api/personas", { cache: "no-store" });
      const data = (await res.json()) as { personas?: PublicPersonaListItem[]; error?: string };
      if (!res.ok) {
        setError(data.error || "페르소나 목록을 불러오지 못했습니다.");
        return;
      }
      setPersonas(Array.isArray(data.personas) ? data.personas : []);
    } catch {
      setError("페르소나 목록을 불러오지 못했습니다.");
    }
  }

  async function refreshOwnerEditorPersona(personaId: number) {
    if (!secretSettings.canEdit) return null;
    try {
      const res = await fetch(`/api/personas/${personaId}/editor`, { cache: "no-store" });
      const data = (await res.json()) as {
        persona?: OwnerPersonaEditorItem;
        error?: string;
      };
      if (!res.ok || !data.persona) return null;
      setEditorPersonas((prev) => applyOwnerEditorCacheUpdate(prev, data.persona!));
      return data.persona;
    } catch {
      return null;
    }
  }

  async function savePersona() {
    noticeScopeRef.current = "persona";
    setNoticeAnchor({ scope: "persona", id: editingId });
    setBusy(true);
    setError("");
    setMsg("");
    if (!draftGender) {
      setBusy(false);
      setError("페르소나 성별을 선택하세요.");
      return;
    }
    const secretWasSubmitted =
      secretSettings.canEdit &&
      (creating ||
        (editingId != null && draftSecretDescriptionLoaded && draftSecretDescriptionDirty));
    const submittedSecret = draftSecretDescription;
    const payload: Record<string, unknown> = {
      name: draftName,
      memo: draftMemo,
      gender: draftGender,
      description: draftDesc,
      image_url: draftImageUrl,
      image_focus_x: draftImageFocusX,
      image_focus_y: draftImageFocusY,
    };
    if (secretSettings.canEdit && creating) {
      payload.secret_description = draftSecretDescription;
    } else if (
      secretSettings.canEdit &&
      editingId != null &&
      draftSecretDescriptionLoaded &&
      draftSecretDescriptionDirty
    ) {
      payload.secret_description = draftSecretDescription;
    }

    const res = editingId
      ? await fetch(`/api/personas/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/personas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    setBusy(false);
    const data = (await res.json()) as {
      error?: string;
      persona?: PublicPersonaListItem;
      compile?: PersonaSecretCompileSummaryDto;
      compilePreservedPrior?: boolean;
    };
    if (!res.ok) {
      setError(data.error || "저장에 실패했습니다.");
      return;
    }
    if (data.persona) {
      setPersonas((prev) => {
        const idx = prev.findIndex((p) => p.id === data.persona!.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = data.persona!;
          return next;
        }
        return [...prev, data.persona!];
      });
    }
    setCompileSummary(data.compile ?? null);
    setCompilePreservedPrior(Boolean(data.compilePreservedPrior));
    if (secretWasSubmitted) {
      setDraftSecretDescriptionDirty(false);
    }
    if (data.persona && secretSettings.canEdit && (secretWasSubmitted || creating)) {
      const authoritative = await refreshOwnerEditorPersona(data.persona.id);
      if (authoritative) {
        setDraftSecretDescription(authoritative.secret_description);
        setDraftSecretDescriptionLoaded(true);
      } else if (secretWasSubmitted) {
        // Fallback: keep submitted source in cache until next authoritative fetch.
        setEditorPersonas((prev) =>
          applyOwnerEditorCacheUpdate(prev, {
            ...(data.persona as PublicPersonaListItem),
            secret_description: submittedSecret,
          })
        );
        setDraftSecretDescription(submittedSecret);
        setDraftSecretDescriptionLoaded(true);
      }
    }
    setMsg(editingId ? "페르소나가 수정되었습니다." : "페르소나가 생성되었습니다.");
    if (!data.compile && !data.compilePreservedPrior) {
      cancelForm();
    } else if (data.persona) {
      setCreating(false);
      setEditingId(data.persona.id);
    }
    await refreshList();
    router.refresh();
  }

  async function deletePersona(id: number) {
    noticeScopeRef.current = "persona";
    setNoticeAnchor({ scope: "persona", id: null });
    if (!confirm("이 페르소나를 삭제할까요?")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/personas/${id}`, { method: "DELETE" });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "삭제에 실패했습니다.");
      return;
    }
    setMsg("페르소나가 삭제되었습니다.");
    if (editingId === id) cancelForm();
    await refreshList();
    router.refresh();
  }

  async function selectPersonaStatusWidget(personaId: number, presetId: number | null) {
    noticeScopeRef.current = "persona";
    setNoticeAnchor({ scope: "persona", id: personaId });
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/personas/${personaId}/status-widget`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId }),
      });
      const data = (await res.json()) as {
        error?: string;
        persona?: PublicPersonaListItem | null;
      };
      if (!res.ok || !data.persona) {
        setError(data.error || "상태창 선택을 저장하지 못했습니다.");
        return;
      }
      setPersonas((prev) =>
        prev.map((persona) => (persona.id === data.persona!.id ? data.persona! : persona))
      );
      setMsg(presetId == null ? "페르소나 상태창을 사용하지 않습니다." : "페르소나 상태창이 선택되었습니다.");
      router.refresh();
    } catch {
      setError("상태창 선택을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshNotePresets() {
    const res = await fetch("/api/user-note-presets");
    const data = await res.json();
    if (res.ok) setNotePresets(data.presets ?? []);
  }

  function noteDraftHasUnsavedChanges() {
    if (!noteCreating && noteEditingId == null) return false;
    const saved = noteEditingId != null ? notePresets.find((item) => item.id === noteEditingId) : null;
    return isTitledDraftDirty(
      { title: noteDraftTitle, content: noteDraftContent },
      saved ? { title: saved.title, content: saved.content } : null
    );
  }

  function requestCancelNoteForm() {
    if (noteDraftHasUnsavedChanges() && !confirm(UNSAVED_DRAFT_CONFIRM_MESSAGE)) return;
    cancelNoteForm();
  }

  function startNoteCreate() {
    noticeScopeRef.current = "note";
    if (noteDraftHasUnsavedChanges() && !confirm(UNSAVED_DRAFT_CONFIRM_MESSAGE)) return;
    setNoteCreating(true);
    setNoteEditingId(null);
    setNoteDraftTitle("");
    setNoteDraftContent("");
    setError("");
    setMsg("");
  }

  function startNoteEdit(preset: UserNotePresetItem) {
    noticeScopeRef.current = "note";
    if (noteEditingId === preset.id && !noteCreating) {
      noteEditorRef.current?.focus({ preventScroll: true });
      return;
    }
    if (noteDraftHasUnsavedChanges() && !confirm(UNSAVED_DRAFT_CONFIRM_MESSAGE)) return;
    setNoteEditingId(preset.id);
    setNoteCreating(false);
    setNoteDraftTitle(preset.title);
    setNoteDraftContent(preset.content);
    setError("");
    setMsg("");
  }

  function cancelNoteForm() {
    setNoteCreating(false);
    setNoteEditingId(null);
    setNoteDraftTitle("");
    setNoteDraftContent("");
  }

  async function refreshStatusWidgetPresets() {
    const res = await fetch("/api/status-widget-presets");
    const data = await res.json();
    if (res.ok) setStatusWidgetPresets(data.presets ?? []);
  }

  function widgetDraftHasUnsavedChanges() {
    if (!widgetCreating && widgetEditingId == null) return false;
    const saved =
      widgetEditingId != null
        ? statusWidgetPresets.find((item) => item.id === widgetEditingId)
        : null;
    return (
      widgetDraftTitle !== (saved?.title ?? "") ||
      serializeStatusWidget(widgetDraft) !== widgetBaselineRef.current
    );
  }

  function requestCancelWidgetForm() {
    if (widgetDraftHasUnsavedChanges() && !confirm(UNSAVED_DRAFT_CONFIRM_MESSAGE)) return;
    cancelWidgetForm();
  }

  function startWidgetCreate() {
    noticeScopeRef.current = "widget";
    if (widgetDraftHasUnsavedChanges() && !confirm(UNSAVED_DRAFT_CONFIRM_MESSAGE)) return;
    const initial = characterStatusWidgetOrDefault(null);
    widgetBaselineRef.current = serializeStatusWidget(initial);
    setWidgetCreating(true);
    setWidgetEditingId(null);
    setWidgetDraftTitle("");
    setWidgetDraft(initial);
    setWidgetShare(null);
    setError("");
    setMsg("");
  }

  function startWidgetEdit(preset: StatusWidgetPresetItem) {
    noticeScopeRef.current = "widget";
    if (widgetEditingId === preset.id && !widgetCreating) {
      widgetEditorRef.current?.focus({ preventScroll: true });
      return;
    }
    if (widgetDraftHasUnsavedChanges() && !confirm(UNSAVED_DRAFT_CONFIRM_MESSAGE)) return;
    const loaded = parseStatusWidgetJson(preset.widget_json) ?? characterStatusWidgetOrDefault(null);
    widgetBaselineRef.current = serializeStatusWidget(loaded);
    setWidgetEditingId(preset.id);
    setWidgetCreating(false);
    setWidgetDraftTitle(preset.title);
    setWidgetDraft(loaded);
    setWidgetShare(null);
    setError("");
    setMsg("");
  }

  function cancelWidgetForm() {
    setWidgetCreating(false);
    setWidgetEditingId(null);
    setWidgetDraftTitle("");
    setWidgetDraft(characterStatusWidgetOrDefault(null));
    setWidgetShare(null);
  }

  async function createWidgetShareLink(body: {
    presetId?: number;
    title?: string;
    widget_json?: string;
    visibility?: StatusWidgetShareVisibility;
  }) {
    noticeScopeRef.current = "widget";
    setNoticeAnchor({ scope: "widget", id: body.presetId ?? widgetEditingId });
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch("/api/status-widget-shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "공유 링크 생성에 실패했습니다.");
      return;
    }
    const visibility: StatusWidgetShareVisibility =
      data.visibility === "public" ? "public" : "unlisted";
    setWidgetShare({ slug: data.shareSlug, path: data.applyPath, visibility });
    setMsg(
      visibility === "public"
        ? "커뮤니티에 공개했습니다. 링크도 함께 사용할 수 있습니다."
        : "공유 링크가 생성되었습니다. 커뮤니티 목록에는 올라가지 않습니다."
    );
  }

  async function unpublishWidgetShare() {
    noticeScopeRef.current = "widget";
    if (!widgetShare) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/status-widget-shares/${encodeURIComponent(widgetShare.slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "공개 해제에 실패했습니다.");
      return;
    }
    setWidgetShare({ ...widgetShare, visibility: "unlisted" });
    setMsg("커뮤니티 공개를 해제했습니다. 링크는 그대로 열립니다.");
  }

  async function saveWidgetPreset() {
    noticeScopeRef.current = "widget";
    setNoticeAnchor({ scope: "widget", id: widgetEditingId });
    if (!widgetDraftTitle.trim()) {
      setError("상태창 제목을 입력하세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    const payload = {
      title: widgetDraftTitle,
      widget_json: serializeStatusWidget(widgetDraft),
    };
    const res = widgetEditingId
      ? await fetch(`/api/status-widget-presets/${widgetEditingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/status-widget-presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "저장에 실패했습니다.");
      return;
    }
    setMsg(widgetEditingId ? "상태창이 수정되었습니다." : "상태창이 저장되었습니다.");
    cancelWidgetForm();
    await refreshStatusWidgetPresets();
    router.refresh();
  }

  async function deleteWidgetPreset(id: number) {
    noticeScopeRef.current = "widget";
    setNoticeAnchor({ scope: "widget", id: null });
    if (!confirm("이 상태창을 삭제할까요?")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/status-widget-presets/${id}`, { method: "DELETE" });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "삭제에 실패했습니다.");
      return;
    }
    setMsg("상태창이 삭제되었습니다.");
    if (widgetEditingId === id) cancelWidgetForm();
    await refreshStatusWidgetPresets();
    await refreshList();
    router.refresh();
  }

  async function saveNotePreset() {
    noticeScopeRef.current = "note";
    setNoticeAnchor({ scope: "note", id: noteEditingId });
    const focusContent = readStoredFocus(noteDraftContent);
    const noteCheck = validateUserNoteFocusPreset(focusContent, focusMaxChars);
    if (!noteCheck.ok) {
      setError(noteCheck.error);
      return;
    }
    if (!noteDraftTitle.trim()) {
      setError("유저 노트 제목을 입력하세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    const res = noteEditingId
      ? await fetch(`/api/user-note-presets/${noteEditingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: noteDraftTitle, content: focusContent }),
        })
        : await fetch("/api/user-note-presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: noteDraftTitle, content: focusContent }),
        });
    setBusy(false);
    let data: { error?: string } = {};
    try {
      const text = await res.text();
      if (text) data = JSON.parse(text) as { error?: string };
    } catch {
      setError("저장에 실패했습니다.");
      return;
    }
    if (!res.ok) {
      setError(data.error || "저장에 실패했습니다.");
      return;
    }
    setMsg(noteEditingId ? "유저 노트가 수정되었습니다." : "유저 노트가 추가되었습니다.");
    cancelNoteForm();
    await refreshNotePresets();
    router.refresh();
  }

  async function deleteNotePreset(id: number) {
    noticeScopeRef.current = "note";
    setNoticeAnchor({ scope: "note", id: null });
    if (!confirm("이 유저 노트를 삭제할까요?")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/user-note-presets/${id}`, { method: "DELETE" });
    setBusy(false);
    let data: { error?: string } = {};
    try {
      const text = await res.text();
      if (text) data = JSON.parse(text) as { error?: string };
    } catch {
      setError("삭제에 실패했습니다.");
      return;
    }
    if (!res.ok) {
      setError(data.error || "삭제에 실패했습니다.");
      return;
    }
    setMsg("유저 노트가 삭제되었습니다.");
    if (noteEditingId === id) cancelNoteForm();
    await refreshNotePresets();
    router.refresh();
  }

  const personaFormOpen = creating || editingId != null;
  const noteFormOpen = noteCreating || noteEditingId != null;
  const widgetFormOpen = widgetCreating || widgetEditingId != null;
  const combinedChars = personaCombinedContentLength(draftDesc, draftSecretDescription);
  const personaMissing = [!draftName.trim() ? "이름" : null, !draftGender ? "성별" : null].filter(
    Boolean
  );

  function noticeFor(scope: NoticeScope): PageNotice | null {
    return notice && notice.scope === scope ? { kind: notice.kind, text: notice.text } : null;
  }
  function itemNotice(scope: NoticeScope, id: number, formOpen: boolean) {
    if (formOpen || !noticeAnchor || noticeAnchor.scope !== scope || noticeAnchor.id !== id) return null;
    return noticeFor(scope);
  }
  function headerNotice(scope: NoticeScope, formOpen: boolean, ids: number[]) {
    if (formOpen) return null;
    if (noticeAnchor?.scope === scope && noticeAnchor.id != null && ids.includes(noticeAnchor.id)) {
      return null;
    }
    return noticeFor(scope);
  }

  const editorShellClass = (inline: boolean) =>
    cn(
      "scroll-mt-32 space-y-4 outline-none lg:scroll-mt-24",
      inline
        ? "border-t border-white/10 pt-4"
        : "rounded-xl border border-violet-400/30 bg-[#0b0d14]/70 p-4 sm:p-5"
    );

  const personaEditor = personaFormOpen ? (
    <div
      ref={personaEditorRef}
      id="persona-editor"
      tabIndex={-1}
      role="group"
      aria-labelledby={`${formIds}-persona-title`}
      className={editorShellClass(!creating)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${formIds}-persona-title`} className={studioType.sectionTitle}>
          {creating
            ? "새 페르소나 만들기"
            : `‘${personas.find((item) => item.id === editingId)?.name || "이름 없음"}’ 수정 중`}
        </h3>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            combinedChars >= PERSONA_CONTENT_MAX
              ? "text-rose-400"
              : combinedChars >= PERSONA_CONTENT_MAX * 0.9
                ? "text-zinc-200"
                : "text-zinc-400"
          )}
        >
          합계 {combinedChars.toLocaleString()} / {PERSONA_CONTENT_MAX.toLocaleString()}자
        </span>
      </div>
      <p className={studioType.helper}>
        기본 설정과 비밀 설정의 합계는 {PERSONA_CONTENT_MAX.toLocaleString()}자까지입니다.
      </p>
      <PersonaImageEditor
        disabled={busy}
        value={{
          image_url: draftImageUrl,
          image_focus_x: draftImageFocusX,
          image_focus_y: draftImageFocusY,
        }}
        onChange={(next) => {
          setDraftImageUrl(next.image_url);
          setDraftImageFocusX(next.image_focus_x);
          setDraftImageFocusY(next.image_focus_y);
        }}
      />
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={`${formIds}-name`} className="text-sm font-medium text-zinc-300">
            이름
          </label>
          <span className={studioType.counter}>
            {draftName.length} / {PERSONA_NAME_LIMIT}자
          </span>
        </div>
        <input
          id={`${formIds}-name`}
          className={studioInputClass}
          maxLength={PERSONA_NAME_LIMIT}
          placeholder={`비우면 안 됨 · 닉네임: ${nickname}`}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value.slice(0, PERSONA_NAME_LIMIT))}
        />
      </div>
      <div role="group" aria-labelledby={`${formIds}-gender`}>
        <p id={`${formIds}-gender`} className={studioType.label}>
          성별 <span className="text-rose-300">필수</span>
        </p>
        <p className={`mb-2 ${studioType.caption}`}>
          AI가 이 페르소나를 지칭·묘사할 때 반드시 따릅니다.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {(["male", "female", "other"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={draftGender === value}
              onClick={() => setDraftGender(value)}
              className={cn(
                "min-h-11 rounded-xl border py-2.5 text-sm font-semibold transition",
                draftGender === value ? studioSurface.choiceActive : studioSurface.choiceIdle
              )}
            >
              {draftGender === value ? "✓ " : ""}
              {GENDER_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={`${formIds}-memo`} className="text-sm font-medium text-zinc-300">
            메모 (참고용 · AI 미전달)
          </label>
          <span className={studioType.counter}>{draftMemo.length.toLocaleString()}자</span>
        </div>
        <input
          id={`${formIds}-memo`}
          className={studioInputClass}
          placeholder="예: 메인 RP용"
          value={draftMemo}
          onChange={(e) => setDraftMemo(e.target.value)}
        />
      </div>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={`${formIds}-desc`} className="text-sm font-medium text-zinc-300">
            기본 페르소나 설정 <span className="font-normal text-zinc-400">· 공개 설명</span>
          </label>
          <span className={studioType.counter}>
            {personaContentLength(draftDesc).toLocaleString()}자
          </span>
        </div>
        <textarea
          id={`${formIds}-desc`}
          rows={8}
          maxLength={Math.max(
            draftDesc.length,
            PERSONA_CONTENT_MAX - personaContentLength(draftSecretDescription)
          )}
          className={studioTextareaClass}
          placeholder="나이, 외모, 성격, 배경, 말투, AI에게 알려줄 공개 역할 설정…"
          value={draftDesc}
          onChange={(e) =>
            setDraftDesc(capPersonaFieldToSharedBudget(draftSecretDescription, e.target.value))
          }
        />
      </div>
      {secretSettings.canEdit ? (
        <div className="space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={`${formIds}-secret`} className="text-sm font-medium text-zinc-300">
              비밀 설정 (선택)
            </label>
            <span className={studioType.counter}>
              {personaContentLength(draftSecretDescription).toLocaleString()}자
            </span>
          </div>
          <p className={studioType.caption}>
            캐릭터가 대화 시작 시점에는 모르는 설정입니다. 외형, 성격, 직업, 평소 말투처럼
            처음부터 알아야 하는 내용은 일반 설정에 작성하세요.
          </p>
          {secretSettings.discoveryActive ? (
            <p className={studioType.caption}>
              직접 공개하거나, 목격·조사·전달을 통해 알게 될 수 있습니다.
            </p>
          ) : null}
          <textarea
            id={`${formIds}-secret`}
            rows={6}
            maxLength={Math.max(
              draftSecretDescription.length,
              PERSONA_CONTENT_MAX - personaContentLength(draftDesc)
            )}
            disabled={!creating && !draftSecretDescriptionLoaded}
            className={`${studioTextareaClass} disabled:opacity-50`}
            placeholder="예: 과거 포드 감염 실험에 자원했으며, 오른팔의 감염 흔적을 긴 장갑으로 숨기고 있다."
            value={draftSecretDescription}
            onChange={(e) => {
              setDraftSecretDescription(capPersonaFieldToSharedBudget(draftDesc, e.target.value));
              setDraftSecretDescriptionDirty(true);
            }}
          />
          {!creating && !draftSecretDescriptionLoaded && (
            <p className="text-xs text-zinc-400">비밀 설정을 불러오는 중…</p>
          )}
          {compileSummary && (
            <details className="text-[13px] text-zinc-400">
              <summary>
                비밀 설정이 저장되었습니다. 발견 가능한 비밀 {compileSummary.compiledSecretCount}
                개가 정리되었습니다.
              </summary>
              <p className="mt-1">
                {compileSummary.titles.join(" · ") || "정리된 비밀 없음"}
                {compileSummary.needsReview ? " · 검토 필요" : ""}
                {compileSummary.reused ? " · 기존 분석 재사용" : ""}
              </p>
              {compileSummary.warnings.length > 0 && (
                <p className="mt-1">{compileSummary.warnings.join(" · ")}</p>
              )}
            </details>
          )}
          {compilePreservedPrior && (
            <p className="text-xs leading-relaxed text-amber-300">
              페르소나 설정은 저장됐지만 비밀 설정 분석에 실패했습니다. 기존 분석 결과는
              보존되었으며, 같은 내용을 다시 저장하면 분석을 재시도합니다.
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2 text-xs text-zinc-400">
          비밀 설정은 현재 일부 사용자에게 순차 공개 중입니다.
        </p>
      )}
      <EditorActionBar
        onSave={savePersona}
        onCancel={requestCancelForm}
        saving={busy}
        saveDisabled={busy || personaMissing.length > 0}
        disabledReason={
          personaMissing.length > 0 ? `${personaMissing.join("과 ")}은(는) 필수 항목이에요.` : null
        }
        notice={noticeFor("persona")}
      />
    </div>
  ) : null;

  const noteSavedForEdit =
    noteEditingId != null ? notePresets.find((item) => item.id === noteEditingId) : null;
  const noteEditor = noteFormOpen ? (
    <div
      ref={noteEditorRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={`${formIds}-note-title`}
      className={editorShellClass(!noteCreating)}
    >
      <h3 id={`${formIds}-note-title`} className={studioType.sectionTitle}>
        {noteCreating ? "새 유저 노트 만들기" : `‘${noteSavedForEdit?.title || "유저 노트"}’ 수정 중`}
      </h3>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={`${formIds}-note-name`} className="text-sm font-medium text-zinc-300">
            제목
          </label>
          <span className={studioType.counter}>
            {noteDraftTitle.length} / {USER_NOTE_PRESET_TITLE_MAX}자
          </span>
        </div>
        <input
          id={`${formIds}-note-name`}
          className={studioInputClass}
          maxLength={USER_NOTE_PRESET_TITLE_MAX}
          placeholder="예: 본편 설정, 로맨스 루트"
          value={noteDraftTitle}
          onChange={(e) => setNoteDraftTitle(e.target.value.slice(0, USER_NOTE_PRESET_TITLE_MAX))}
        />
      </div>
      <UserNoteSplitEditor
        userNote={noteDraftContent}
        onUserNoteChange={setNoteDraftContent}
        focusOnly
        focusMaxChars={focusMaxChars}
        focusRows={5}
        textareaClassName={studioTextareaClass}
        textareaAriaLabel="중요 기억 내용"
      />
      <EditorActionBar
        onSave={() => void saveNotePreset()}
        onCancel={requestCancelNoteForm}
        saving={busy}
        saveDisabled={busy || !noteDraftTitle.trim()}
        disabledReason="제목은 필수 항목이에요."
        notice={noticeFor("note")}
      />
    </div>
  ) : null;

  const widgetEditor = widgetFormOpen ? (
    <div
      ref={widgetEditorRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={`${formIds}-widget-title`}
      className={editorShellClass(!widgetCreating)}
    >
      <h3 id={`${formIds}-widget-title`} className={studioType.sectionTitle}>
        {widgetCreating
          ? "새 상태창 만들기"
          : `‘${statusWidgetPresets.find((item) => item.id === widgetEditingId)?.title || "상태창"}’ 수정 중`}
      </h3>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={`${formIds}-widget-name`} className="text-sm font-medium text-zinc-300">
            제목
          </label>
          <span className={studioType.counter}>
            {widgetDraftTitle.length} / {STATUS_WIDGET_PRESET_TITLE_MAX}자
          </span>
        </div>
        <input
          id={`${formIds}-widget-name`}
          className={studioInputClass}
          maxLength={STATUS_WIDGET_PRESET_TITLE_MAX}
          placeholder="예: 다크 카드, 미니멀 HUD"
          value={widgetDraftTitle}
          onChange={(e) =>
            setWidgetDraftTitle(e.target.value.slice(0, STATUS_WIDGET_PRESET_TITLE_MAX))
          }
        />
      </div>
      <StatusWidgetEditor
        key={
          widgetEditingId != null
            ? `status-widget-preset-${widgetEditingId}`
            : "status-widget-preset-new"
        }
        value={widgetDraft}
        onChange={setWidgetDraft}
        disabled={busy}
        contextLimit={STATUS_WIDGET_USER_CONTEXT_MAX}
        showSharedDesignEntry={false}
      />
      <EditorActionBar
        onSave={() => void saveWidgetPreset()}
        onCancel={requestCancelWidgetForm}
        saving={busy}
        saveDisabled={busy || !widgetDraftTitle.trim()}
        disabledReason="제목은 필수 항목이에요."
        notice={noticeFor("widget")}
        extra={
          <>
            <StudioButton
              type="button"
              variant="secondary"
              disabled={busy || !widgetDraftTitle.trim()}
              onClick={() =>
                void createWidgetShareLink({
                  title: widgetDraftTitle,
                  widget_json: serializeStatusWidget(widgetDraft),
                  visibility: "unlisted",
                })
              }
            >
              링크 공유
            </StudioButton>
            <StudioButton
              type="button"
              variant="secondary"
              disabled={busy || !widgetDraftTitle.trim()}
              onClick={() =>
                void createWidgetShareLink({
                  title: widgetDraftTitle,
                  widget_json: serializeStatusWidget(widgetDraft),
                  visibility: "public",
                })
              }
            >
              커뮤니티 공개
            </StudioButton>
          </>
        }
      />
    </div>
  ) : null;

  const rowButtonClass = "min-w-[4.5rem]";
  const dangerButtonClass =
    "min-w-[4.5rem] border-rose-500/30 text-rose-300 hover:bg-rose-500/10 disabled:hover:bg-transparent";

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-6">
      <div>
        <h1 className={studioType.heading}>페르소나·노트 제작</h1>
        <p className={`mt-1 ${studioType.body}`}>
          원하는 만큼 페르소나를 만들고 채팅방 상단에서 선택해 사용합니다.
        </p>
      </div>

      <section id="personas" className={cn(studioSurface.sectionAccent, "scroll-mt-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={studioType.sectionTitle}>
              내 페르소나 ({personas.length} / {USER_PERSONA_MAX_COUNT})
            </h2>
            <p className={cn(studioType.helper, "mt-0.5")}>
              채팅에서 내가 연기하는 인물입니다 · 최대 {USER_PERSONA_MAX_COUNT.toLocaleString()}개 ·
              기본+비밀 합계 최대 {PERSONA_CONTENT_MAX.toLocaleString()}자
            </p>
          </div>
          <StudioButton
            size="sm"
            onClick={startCreate}
            disabled={busy || creating || personas.length >= USER_PERSONA_MAX_COUNT}
          >
            + 새 페르소나
          </StudioButton>
        </div>

        <ScopedNotice
          notice={headerNotice(
            "persona",
            personaFormOpen,
            personas.map((item) => item.id)
          )}
          revealOnChange
        />

        {creating ? personaEditor : null}

        {personas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 bg-[#0e1120] px-4 py-6 text-center text-sm text-zinc-400">
            저장된 페르소나가 없습니다. 위 버튼으로 새 페르소나를 만들어 주세요.
          </p>
        ) : null}

        <ul className="space-y-3">
          {personas.map((p) => {
            const desc = (p.description ?? "").trim();
            const isEditing = editingId === p.id && !creating;
            return (
              <li
                key={p.id}
                aria-current={isEditing ? "true" : undefined}
                className={cn(
                  "rounded-xl border px-4 py-3 transition-colors sm:px-5",
                  isEditing
                    ? "border-violet-400/60 bg-violet-500/[0.07] ring-1 ring-violet-400/30"
                    : "border-white/10 bg-[#0e1120]"
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <PersonaAvatar
                    name={p.name}
                    imageUrl={p.image_url}
                    focusX={p.image_focus_x}
                    focusY={p.image_focus_y}
                    sizeClassName="h-12 w-12"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-white">
                      <span className="break-words">{p.name || "(이름 없음)"}</span>
                      <span className="text-xs font-normal text-zinc-400">
                        · {GENDER_LABELS[p.gender ?? "other"]}
                      </span>
                      {isEditing ? <EditingBadge /> : null}
                    </p>
                    {p.memo?.trim() && (
                      <p className="mt-0.5 break-words text-xs text-zinc-400">{p.memo}</p>
                    )}
                    <p className={`mt-1 line-clamp-2 break-words ${studioType.caption}`}>
                      {desc || "(설명 없음)"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {desc.length.toLocaleString()} / {PERSONA_CONTENT_MAX.toLocaleString()}자
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-white/5 pt-3">
                  <label className="block min-w-[11rem] flex-1 text-xs text-zinc-400">
                    사용할 상태창
                    <select
                      value={p.active_status_widget_preset_id ?? ""}
                      disabled={busy}
                      onChange={(event) => {
                        const value = event.target.value;
                        void selectPersonaStatusWidget(p.id, value ? Number(value) : null);
                      }}
                      className={`${studioInputClass} mt-1 w-full`}
                    >
                      <option value="">사용 안 함</option>
                      {statusWidgetPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex shrink-0 gap-2">
                    <StudioButton
                      size="sm"
                      variant="secondary"
                      className={rowButtonClass}
                      disabled={busy}
                      aria-label={`${p.name || "이름 없음"} 수정`}
                      onClick={() => startEdit(p)}
                    >
                      수정
                    </StudioButton>
                    <StudioButton
                      size="sm"
                      variant="secondary"
                      className={dangerButtonClass}
                      disabled={busy || personas.length <= 1}
                      aria-label={`${p.name || "이름 없음"} 삭제`}
                      onClick={() => deletePersona(p.id)}
                    >
                      삭제
                    </StudioButton>
                  </div>
                </div>
                <ScopedNotice
                  notice={itemNotice("persona", p.id, personaFormOpen)}
                  className="mt-3"
                  revealOnChange
                />
                {isEditing ? <div className="mt-3">{personaEditor}</div> : null}
              </li>
            );
          })}
        </ul>
        {personas.length === 1 ? (
          <p className={studioType.caption}>
            페르소나는 최소 1개가 필요해서 지금은 삭제할 수 없어요. 새로 만든 뒤 삭제할 수 있어요.
          </p>
        ) : null}
      </section>

      <section id="user-note-presets" className={cn(studioSurface.sectionAccent, "scroll-mt-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={studioType.sectionTitle}>유저 노트 보관함 ({notePresets.length})</h2>
            <p className={cn(studioType.helper, "mt-0.5")}>
              AI가 매 턴 기억할 중요 기억을 저장해 두고 채팅에서 불러와 씁니다 · 현재 요금제 최대{" "}
              {focusMaxChars.toLocaleString()}자
            </p>
          </div>
          <StudioButton size="sm" onClick={startNoteCreate} disabled={busy || noteCreating}>
            + 새 노트
          </StudioButton>
        </div>

        <ScopedNotice
          notice={headerNotice(
            "note",
            noteFormOpen,
            notePresets.map((item) => item.id)
          )}
          revealOnChange
        />

        {noteCreating ? noteEditor : null}

        <ul className="space-y-3">
          {notePresets.map((preset) => {
            const parsed = parseUserNoteCombined(preset.content);
            const chars = userNoteCombinedCharCount(parsed.body, parsed.statusTemplate);
            const isEditing = noteEditingId === preset.id && !noteCreating;
            return (
              <li
                key={preset.id}
                aria-current={isEditing ? "true" : undefined}
                className={cn(
                  "rounded-xl border px-4 py-3 transition-colors sm:px-5",
                  isEditing
                    ? "border-violet-400/60 bg-violet-500/[0.07] ring-1 ring-violet-400/30"
                    : "border-white/10 bg-[#0e1120]"
                )}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
                    <span className="break-words">{preset.title}</span>
                    {isEditing ? <EditingBadge /> : null}
                  </p>
                  <p className={`mt-0.5 ${studioType.caption}`}>중요 기억 · 고집중 구간</p>
                  <p className={`mt-1 line-clamp-2 break-words ${studioType.caption}`}>
                    {parsed.body.trim() || "(내용 없음)"}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      chars > focusMaxChars ? "text-rose-300" : "text-zinc-400"
                    )}
                  >
                    {chars.toLocaleString()} / {focusMaxChars.toLocaleString()}자
                    {chars > focusMaxChars
                      ? ` · 현재 요금제로는 앞 ${focusMaxChars.toLocaleString()}자만 주입됩니다`
                      : ""}
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <StudioButton
                    size="sm"
                    variant="secondary"
                    className={rowButtonClass}
                    disabled={busy}
                    aria-label={`${preset.title} 수정`}
                    onClick={() => startNoteEdit(preset)}
                  >
                    수정
                  </StudioButton>
                  <StudioButton
                    size="sm"
                    variant="secondary"
                    className={dangerButtonClass}
                    disabled={busy}
                    aria-label={`${preset.title} 삭제`}
                    onClick={() => void deleteNotePreset(preset.id)}
                  >
                    삭제
                  </StudioButton>
                </div>
                <ScopedNotice
                  notice={itemNotice("note", preset.id, noteFormOpen)}
                  className="mt-3"
                  revealOnChange
                />
                {isEditing ? <div className="mt-3">{noteEditor}</div> : null}
              </li>
            );
          })}
          {notePresets.length === 0 && (
            <li className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-zinc-400">
              저장된 유저 노트가 없습니다. 채팅 설정에서 작성·저장하거나 여기서 추가하세요.
            </li>
          )}
        </ul>
      </section>

      <section
        id="status-widget-presets"
        className={cn(studioSurface.sectionAccent, "scroll-mt-4")}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={studioType.sectionTitle}>
              상태창 보관함 ({statusWidgetPresets.length})
            </h2>
            <p className={cn(studioType.helper, "mt-0.5")}>
              디자인과 상태값으로 만들거나, 직접 제작에서 HTML·JSX를 작성합니다
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StudioButton size="sm" variant="secondary" href={STATUS_WIDGET_SHARED_DESIGN_HREF}>
              {STATUS_WIDGET_SHARED_DESIGN_LABEL}
            </StudioButton>
            <StudioButton size="sm" onClick={startWidgetCreate} disabled={busy || widgetCreating}>
              + 새 상태창
            </StudioButton>
          </div>
        </div>

        <ScopedNotice
          notice={headerNotice(
            "widget",
            widgetFormOpen,
            statusWidgetPresets.map((item) => item.id)
          )}
          revealOnChange
        />

        {widgetCreating ? widgetEditor : null}

        <ul className="space-y-3">
          {statusWidgetPresets.map((preset) => {
            const reserved = estimateStatusWidgetContextChars(
              parseStatusWidgetJson(preset.widget_json)
            );
            const isEditing = widgetEditingId === preset.id && !widgetCreating;
            return (
              <li
                key={preset.id}
                aria-current={isEditing ? "true" : undefined}
                className={cn(
                  "rounded-xl border px-4 py-3 transition-colors sm:px-5",
                  isEditing
                    ? "border-violet-400/60 bg-violet-500/[0.07] ring-1 ring-violet-400/30"
                    : "border-white/10 bg-[#0e1120]"
                )}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
                    <span className="break-words">{preset.title}</span>
                    {isEditing ? <EditingBadge /> : null}
                  </p>
                  <p className={`mt-0.5 ${studioType.caption}`}>
                    {formatWidgetBudgetHint(reserved, STATUS_WIDGET_USER_CONTEXT_MAX)}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StudioButton
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    aria-label={`${preset.title} 수정`}
                    onClick={() => startWidgetEdit(preset)}
                  >
                    수정
                  </StudioButton>
                  <StudioButton
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    aria-label={`${preset.title} 링크 공유`}
                    onClick={() =>
                      void createWidgetShareLink({ presetId: preset.id, visibility: "unlisted" })
                    }
                  >
                    링크 공유
                  </StudioButton>
                  <StudioButton
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    aria-label={`${preset.title} 커뮤니티 공개`}
                    onClick={() =>
                      void createWidgetShareLink({ presetId: preset.id, visibility: "public" })
                    }
                  >
                    커뮤니티 공개
                  </StudioButton>
                  <StudioButton
                    size="sm"
                    variant="secondary"
                    className={dangerButtonClass}
                    disabled={busy}
                    aria-label={`${preset.title} 삭제`}
                    onClick={() => void deleteWidgetPreset(preset.id)}
                  >
                    삭제
                  </StudioButton>
                </div>
                <ScopedNotice
                  notice={itemNotice("widget", preset.id, widgetFormOpen)}
                  className="mt-3"
                  revealOnChange
                />
                {isEditing ? <div className="mt-3">{widgetEditor}</div> : null}
              </li>
            );
          })}
          {statusWidgetPresets.length === 0 && (
            <li className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-zinc-400">
              저장된 상태창이 없습니다. 위 버튼으로 새로 만들 수 있습니다.
            </li>
          )}
        </ul>

        {widgetShare && (
          <div className="space-y-2">
            <ShareLinkBox path={widgetShare.path} label="위젯 적용 링크 (열어서 내 위젯에 추가)" />
            {widgetShare.visibility === "public" ? (
              <StudioButton
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void unpublishWidgetShare()}
              >
                커뮤니티에서 내리기
              </StudioButton>
            ) : (
              <p className="text-xs text-zinc-400">이 링크는 커뮤니티 목록에 보이지 않습니다.</p>
            )}
          </div>
        )}
      </section>

      <p className={`text-center ${studioType.body} text-zinc-500`}>
        <Link href="/" className="inline-flex min-h-11 items-center text-violet-400 hover:underline">
          홈으로
        </Link>
      </p>
    </div>
  );
}
