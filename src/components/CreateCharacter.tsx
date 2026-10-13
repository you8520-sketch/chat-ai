"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CharacterGender } from "@/lib/characterGender";
import { GENDER_LABELS } from "@/lib/characterGender";
import {
  assignRepresentativeRanks,
  countRepresentativeSelections,
  defaultAssetFlags,
  normalizeCharacterAssets,
  withAssetSize,
  type CharacterAsset,
} from "@/lib/characterAssets";
import { measureImageUrl } from "@/lib/measureImageSize";
import { isAssetHardRejected } from "@/lib/assetVisionPolicy";
import {
  allAgesAssetChangeRequest,
  partitionAllAgesTaggingBatch,
} from "@/lib/characterListingModeration";
import AssetManagerGrid, {
  type ManagedAsset,
} from "@/components/AssetManagerGrid";
import CreatorCommentHtml from "@/components/CreatorCommentHtml";
import PublicDescriptionEditor from "@/components/PublicDescriptionEditor";
import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { countPublicDescriptionVisibleChars } from "@/lib/publicDescriptionText";
import {
  speechContextualCharCount,
  speechCreatorCharCount,
  type SpeechContextualRegister,
} from "@/lib/speechCreatorFields";
import StatusWidgetEditor from "@/components/StatusWidgetEditor";
import StatusWidgetTriggerEditor, {
  type StatusWidgetTriggerDraft,
} from "@/components/StatusWidgetTriggerEditor";
import JsxComponentCatalogEditor from "@/components/JsxComponentCatalogEditor";
import {
  characterStatusWidgetOrDefault,
  parseStatusWidgetJson,
  serializeStatusWidget,
  STATUS_WIDGET_CONTEXT_MAX,
  type StatusWidget,
} from "@/lib/statusWidget";
import {
  parseJsxComponentCatalog,
  serializeJsxComponentCatalog,
  type JsxComponentRecord,
} from "@/lib/jsxComponent";

import type { CharacterWorldSourceKind } from "@/lib/worldPermissions";
import { isBorrowAvailableForNewUse, worldPrivatePromptContent } from "@/lib/worlds";
import type { WorldListItem } from "@/lib/worlds";
import {
  isReadOnlyWorldLibraryRef,
  parseWorldLibraryRef,
  savedShareWorldLibraryRef,
  worldLibraryRef,
} from "@/lib/worlds";
import { CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT } from "@/lib/creatorLorebook";
import type { KeywordLorebookListItem } from "@/lib/keywordLorebooks";
import GenrePicker from "@/components/GenrePicker";
import ToggleSwitch from "@/components/ToggleSwitch";
import type { CharacterGenre } from "@/lib/characterGenres";
import { CHARACTER_NAME_LIMIT, CREATOR_COMMENT_LIMIT } from "@/lib/characters";
import {
  NARRATION_STYLE_INSTRUCTIONS_LIMIT,
  substantiveAiLearningCharCount,
} from "@/lib/creatorNarrationStyle";
import {
  AI_LEARNING_LIMIT,
  AI_LEARNING_MIN,
  GREETING_LIMIT,
  SPEECH_CONTEXTUAL_LIMIT,
  SPEECH_EXAMPLES_LIMIT,
  SPEECH_FORBIDDEN_LIMIT,
  TAGLINE_LIMIT,
  aiLearningLimitExceededMessage,
} from "@/lib/characterFormLimits";
import TagChipInput from "@/components/TagChipInput";
import StudioSaveBar from "@/components/studio/StudioSaveBar";
import {
  AiLearningMeter,
  FieldCount,
  FieldCounter,
  FieldError,
  FieldLabel,
  RequirementBadge,
  RequirementSummary,
  SectionHeader,
  type RequirementEntry,
} from "@/components/studio/CreatorEditorParts";
import { StudioBackLink } from "@/components/studio/StudioEmptyState";
import { parseCharacterTagsInput } from "@/lib/characterTags";
import {
  parseParticipantMinAgeInput,
  validateNsfwParticipantAgeContract,
  validateParticipantMinAgeValue,
} from "@/lib/participantMinAge";
import {
  clearCharacterCreateDraft,
  formatDraftSavedAt,
  loadCharacterCreateDraft,
  saveCharacterCreateDraft,
  type CharacterCreateDraft,
} from "@/lib/characterCreateDraft";
import {
  parsePublicDossierFromBody,
  publicDossierHasItems,
  readPublicDossier,
  WORLD_PUBLIC_NAME_MAX,
  type PublicDossierView,
} from "@/lib/characterPublicDossier";
import { PublicDossierBlock } from "@/components/CharacterPublicPagePreview";
import {
  cn,
  studioInputClass,
  studioSelectClass,
  studioSurface,
  studioType,
} from "@/lib/studioDesign";
import {
  buildSimulationSystemPrompt,
  SIMULATION_CAST_EXAMPLE,
  type ContentKind,
} from "@/lib/simulationMode";
import {
  CHARACTER_VISUAL_SUBJECT_LIMIT,
  countCharacterVisualSubjectOwnedAssets,
  createCharacterVisualSubjectKey,
} from "@/lib/characterVisualSubjects";
import {
  configuredSimulationCastNames,
  materializeSimulationVisualSubjectsForEditor,
  parseSimulationVisualSubjectsJson,
} from "@/lib/simulationVisualSubjects";
import {
  assetsForVisualSubject,
  emptyVisualSubjectsDocument,
  validateRepresentativeAsset,
  VISUAL_SUBJECT_NAME_LIMIT,
  type VisualSubjectsDocument,
} from "@/lib/visualSubjects";

const MAX_IMAGES = 100;

type PageTab = "create" | "preview" | "widget" | "publish";

const PAGE_TABS = [
  ["create", "제작"],
  ["preview", "공개 소개"],
  ["widget", "상태창"],
  ["publish", "공개 설정"],
] as const satisfies ReadonlyArray<readonly [PageTab, string]>;

const PAGE_TAB_LABEL: Record<PageTab, string> = {
  create: "제작",
  preview: "공개 소개",
  widget: "상태창",
  publish: "공개 설정",
};

type FieldKey =
  | "name"
  | "tagline"
  | "world"
  | "system_prompt"
  | "simulation_cast"
  | "speech_personality"
  | "speech_examples"
  | "speech_contextual"
  | "speech_forbidden"
  | "ai_total"
  | "gender"
  | "assets"
  | "narration"
  | "greeting"
  | "genres"
  | "participant_min_age"
  | "dossier";

const FIELD_TAB: Record<FieldKey, PageTab> = {
  name: "create",
  tagline: "create",
  world: "create",
  system_prompt: "create",
  simulation_cast: "create",
  speech_personality: "create",
  speech_examples: "create",
  speech_contextual: "create",
  speech_forbidden: "create",
  ai_total: "create",
  gender: "create",
  assets: "create",
  narration: "create",
  greeting: "create",
  genres: "publish",
  participant_min_age: "publish",
  dossier: "preview",
};

const VISIBILITY_SAVE_NOTE: Record<"public" | "link" | "private", string> = {
  public: "저장하면 ‘공개’로 등록돼요",
  link: "저장하면 ‘링크 공개’로 등록돼요",
  private: "저장하면 ‘비공개’로 보관돼요",
};

type TaggedAsset = ManagedAsset;

type ImportCharacter = {
  id: number;
  name: string;
  tagline: string;
  creatorName: string;
  owned: boolean;
  nsfw: boolean;
  promptChars: number;
  thumbnail: string | null;
};

type SelectedImport = {
  characterId: number;
  name: string;
  creatorName: string;
  promptChars: number;
};

function fallbackAssetTag(index: number): string {
  return `에셋 ${index + 1}`;
}

export default function CreateCharacter({
  editCharacterId = null,
  viewerDisplayName,
  creatorDisplayName = "제작자",
  creatorIsPartner = false,
  userId,
  initialContentKind = "character",
  initialWorldId = null,
  initialWorldBorrowId = null,
}: {
  editCharacterId?: number | null;
  viewerDisplayName?: string;
  creatorDisplayName?: string;
  creatorIsPartner?: boolean;
  userId: number;
  initialContentKind?: ContentKind;
  initialWorldId?: number | null;
  initialWorldBorrowId?: number | null;
}) {
  const router = useRouter();
  const isEditMode = editCharacterId != null && editCharacterId > 0;
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    content_kind: initialContentKind,
    name: "",
    tagline: "",
    description: "",
    greeting: "",
    system_prompt: "",
    world: "",
    speech_personality: "",
    speech_traits: "",
    speech_examples: "",
    speech_forbidden: "",
    speech_contextual_registers: [] as SpeechContextualRegister[],
    status_window_prompt: "",
    genres: [] as CharacterGenre[],
    tags: [] as string[],
    nsfw: false,
    participant_min_age: "" as string | number,
    emoji: "✨",
    hue: 260,
    audience: "all",
    gender: "" as "" | CharacterGender,
    gender_public: false,
    height_cm: "",
    weight_kg: "",
    world_public_name: "",
    world_public: false,
    visibility: "public" as "public" | "link" | "private",
    narration_style_instructions: "",
    comments_enabled: true,
    creator_comment: "",
    simulation_reuse_allowed: false,
    simulation_nsfw_allowed: false,
    trpg_reuse_allowed: false,
    simulation_cast: "",
    simulation_rules: "",
  });
  function persistLoadedAssets(list: CharacterAsset[]): CharacterAsset[] {
    const normalized = normalizeCharacterAssets(list);
    if (countRepresentativeSelections(normalized) > 0 || normalized.length === 0) {
      return normalized;
    }
    return assignRepresentativeRanks(normalized, [0]);
  }

  const [assets, setAssets] = useState<TaggedAsset[]>([]);
  const [visualSubjects, setVisualSubjects] = useState<VisualSubjectsDocument>(
    emptyVisualSubjectsDocument()
  );
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [savedWorlds, setSavedWorlds] = useState<WorldListItem[]>([]);
  const [selectedWorldRef, setSelectedWorldRef] = useState<string>("");
  const [worldSourceKind, setWorldSourceKind] = useState<CharacterWorldSourceKind | null>(null);
  const [worldDetach, setWorldDetach] = useState(false);
  const [initialBorrowUnavailable, setInitialBorrowUnavailable] = useState(false);
  const [worldsLoading, setWorldsLoading] = useState(true);
  const [savedLorebooks, setSavedLorebooks] = useState<
    KeywordLorebookListItem[]
  >([]);
  const [selectedLorebookIds, setSelectedLorebookIds] = useState<number[]>([]);
  const [lorebooksLoading, setLorebooksLoading] = useState(true);
  const [editLoading, setEditLoading] = useState(isEditMode);
  const [editLoadError, setEditLoadError] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftFlash, setDraftFlash] = useState(false);
  const [simulationImports, setSimulationImports] = useState<SelectedImport[]>([]);
  const [simulationImportOptions, setSimulationImportOptions] = useState<ImportCharacter[]>([]);
  const [simulationImportSearch, setSimulationImportSearch] = useState("");
  const [statusWidget, setStatusWidget] = useState<StatusWidget>(() =>
    characterStatusWidgetOrDefault(null),
  );
  const [statusWidgetTriggers, setStatusWidgetTriggers] = useState<StatusWidgetTriggerDraft[]>([]);
  const [jsxCatalog, setJsxCatalog] = useState<JsxComponentRecord[]>([]);
  const [chatJsxEditorOpen, setChatJsxEditorOpen] = useState(false);
  const [pageTab, setPageTab] = useState<PageTab>("create");
  const [fieldError, setFieldError] = useState<{ key: FieldKey; message: string } | null>(null);
  const [requirementsExpanded, setRequirementsExpanded] = useState(false);
  const [jump, setJump] = useState<{ key: FieldKey; n: number } | null>(null);
  const fieldUid = useId();
  const tabListRef = useRef<HTMLDivElement>(null);
  const titleBlockRef = useRef<HTMLDivElement>(null);
  const draftRestoredRef = useRef(false);

  const filePreviewUrlMapRef = useRef<Map<File, string>>(new Map());
  const editPromptBaselineRef = useRef<string | null>(null);

  const selectedWorldItem = useMemo(
    () => savedWorlds.find((w) => worldLibraryRef(w) === selectedWorldRef),
    [savedWorlds, selectedWorldRef]
  );
  const isWorldFieldReadOnly =
    selectedWorldRef.startsWith("saved-share:") ||
    selectedWorldItem?.readOnly === true ||
    worldSourceKind === "borrowed_snapshot" ||
    worldSourceKind === "legacy_borrowed_snapshot" ||
    isReadOnlyWorldLibraryRef(selectedWorldRef);

  const configuredVisualSubjectNames = useMemo(
    () => configuredSimulationCastNames(form.simulation_cast, form.name),
    [form.simulation_cast, form.name]
  );

  useEffect(() => {
    if (form.content_kind !== "simulation") return;
    setVisualSubjects((current) =>
      materializeSimulationVisualSubjectsForEditor({
        configuredNames: configuredVisualSubjectNames,
        document: current,
      })
    );
  }, [configuredVisualSubjectNames, form.content_kind]);

  function buildPromptEditSignature(input = form) {
    return JSON.stringify({
      name: input.name.trim(),
      content_kind: input.content_kind,
      greeting: input.greeting,
      system_prompt: input.system_prompt,
      simulation_cast: input.simulation_cast,
      simulation_rules: input.simulation_rules,
      simulation_import_ids: simulationImports.map((item) => item.characterId),
      world: input.world,
      speech_personality: input.speech_personality,
      speech_traits: input.speech_traits,
      speech_examples: input.speech_examples,
      speech_forbidden: input.speech_forbidden,
      speech_contextual_registers: input.speech_contextual_registers,
      gender: input.gender,
      world_id: selectedWorldRef.startsWith("world:") ? selectedWorldRef.slice(6) : "",
      world_borrow_id: selectedWorldRef.startsWith("borrow:") ? selectedWorldRef.slice(7) : "",
      lorebook_ids: selectedLorebookIds,
      narration_style_instructions: input.narration_style_instructions,
    });
  }

  function buildDraftSnapshot(): CharacterCreateDraft {
    return {
      savedAt: Date.now(),
      form,
      assets,
      visualSubjects,
      selectedWorldRef,
      selectedLorebookIds,
      pageTab,
      simulationImports,
    };
  }

  function applyDraftSnapshot(draft: CharacterCreateDraft) {
    const legacyDescription =
      draft.form.description?.trim() ||
      draft.rawDraft?.trim() ||
      draft.generatedProfile?.biography?.trim() ||
      "";
    setForm({
      ...draft.form,
      description: legacyDescription,
      tags: parseCharacterTagsInput(draft.form.tags),
      speech_contextual_registers: Array.isArray(draft.form.speech_contextual_registers)
        ? draft.form.speech_contextual_registers
        : [],
      simulation_reuse_allowed: false,
      simulation_nsfw_allowed: false,
      trpg_reuse_allowed: draft.form.trpg_reuse_allowed ?? false,
      content_kind: draft.form.content_kind ?? initialContentKind,
      simulation_cast: draft.form.simulation_cast ?? "",
      simulation_rules: draft.form.simulation_rules ?? "",
      participant_min_age: draft.form.participant_min_age ?? "",
      narration_style_instructions: draft.form.narration_style_instructions ?? "",
      gender_public: draft.form.gender_public === true,
      height_cm: draft.form.height_cm ?? "",
      weight_kg: draft.form.weight_kg ?? "",
      world_public_name: draft.form.world_public_name ?? "",
      world_public: draft.form.world_public === true,
    });
    setSimulationImports(Array.isArray(draft.simulationImports) ? draft.simulationImports : []);
    setAssets(persistLoadedAssets(draft.assets));
    if (draft.visualSubjects) {
      setVisualSubjects({
        version: 1,
        subjects: Array.isArray(draft.visualSubjects.subjects) ? draft.visualSubjects.subjects : [],
      });
    }
    setSelectedWorldRef(
      draft.selectedWorldRef ||
        (draft.selectedWorldId !== "" && draft.selectedWorldId != null
          ? `world:${draft.selectedWorldId}`
          : "")
    );
    setSelectedLorebookIds(
      Array.isArray(draft.selectedLorebookIds)
        ? draft.selectedLorebookIds
        : draft.selectedLorebookId !== "" && draft.selectedLorebookId != null
          ? [Number(draft.selectedLorebookId)]
          : []
    );
    setPageTab(
      draft.pageTab === "preview"
        ? "preview"
        : draft.pageTab === "widget"
          ? "widget"
          : draft.pageTab === "publish"
            ? "publish"
            : "create",
    );
    setDraftSavedAt(draft.savedAt);
  }

  function saveDraftLocally() {
    const snapshot = buildDraftSnapshot();
    saveCharacterCreateDraft(userId, editCharacterId ?? null, snapshot);
    setDraftSavedAt(snapshot.savedAt);
    setDraftFlash(true);
    window.setTimeout(() => setDraftFlash(false), 2000);
  }

  useEffect(() => {
    if (isEditMode || draftRestoredRef.current) return;
    const draft = loadCharacterCreateDraft(userId, null);
    if (!draft) return;
    draftRestoredRef.current = true;
    applyDraftSnapshot(draft);
  }, [isEditMode, userId]);

  useEffect(() => {
    if (!isEditMode || editLoading || draftRestoredRef.current) return;
    const draft = loadCharacterCreateDraft(userId, editCharacterId ?? null);
    if (!draft) return;
    draftRestoredRef.current = true;
    setDraftSavedAt(draft.savedAt);
  }, [isEditMode, editLoading, userId, editCharacterId]);

  const simulationPromptChars = buildSimulationSystemPrompt({
    cast: form.simulation_cast,
    rules: form.simulation_rules,
  }).length + simulationImports.reduce((sum, item) => sum + item.promptChars + 80, 0);
  const substantiveAiLearningTotal =
    form.content_kind === "simulation"
      ? form.world.length + simulationPromptChars
      : substantiveAiLearningCharCount({
          world: form.world,
          systemPrompt: form.system_prompt,
          speechInput: {
            speech_personality: form.speech_personality,
            speech_traits: form.speech_traits,
            speech_examples: form.speech_examples,
            speech_forbidden: form.speech_forbidden,
            speech_contextual_registers: form.speech_contextual_registers,
          },
        });
  const aiLearningTotal =
    substantiveAiLearningTotal + form.narration_style_instructions.trim().length;
  const speechContextualTotal = speechContextualCharCount(
    form.speech_contextual_registers,
  );

  const createRequirements = useMemo(
    () => ({
      hasAsset: assets.length >= 1 && files.length === 0,
      hasMinAiText: substantiveAiLearningTotal >= AI_LEARNING_MIN,
      hasGender: form.content_kind === "simulation" || !!form.gender,
      hasGreeting: !!form.greeting.trim(),
      hasGenre: form.genres.length >= 1,
    }),
    [
      assets.length,
      files.length,
      substantiveAiLearningTotal,
      form.gender,
      form.content_kind,
      form.greeting,
      form.genres.length,
    ],
  );

  const createReady = Object.values(createRequirements).every(Boolean);

  const participantAgeParsed = parseParticipantMinAgeInput(form.participant_min_age);
  const hasParticipantAge = participantAgeParsed.ok && participantAgeParsed.value != null;
  const isSimulationKind = form.content_kind === "simulation";
  const requirementEntries: RequirementEntry<FieldKey>[] = [
    {
      id: "name",
      label: isSimulationKind ? "시뮬레이션명" : "캐릭터명",
      done: form.name.trim().length > 0,
      tabLabel: PAGE_TAB_LABEL.create,
    },
    {
      id: "tagline",
      label: "한 줄 소개",
      done: form.tagline.trim().length > 0,
      tabLabel: PAGE_TAB_LABEL.create,
    },
    {
      id: isSimulationKind ? "simulation_cast" : "system_prompt",
      label: `AI 설정 ${AI_LEARNING_MIN.toLocaleString()}자 이상`,
      done: createRequirements.hasMinAiText,
      tabLabel: PAGE_TAB_LABEL.create,
    },
    ...(isSimulationKind
      ? []
      : [
          {
            id: "gender" as const,
            label: "캐릭터 성별",
            done: createRequirements.hasGender,
            tabLabel: PAGE_TAB_LABEL.create,
          },
        ]),
    {
      id: "assets",
      label: files.length > 0 ? "이미지 업로드·태깅 완료" : "감정 에셋 이미지 1장",
      done: createRequirements.hasAsset,
      tabLabel: PAGE_TAB_LABEL.create,
    },
    {
      id: "greeting",
      label: "첫 메세지",
      done: createRequirements.hasGreeting,
      tabLabel: PAGE_TAB_LABEL.create,
    },
    {
      id: "genres",
      label: "장르 1개 이상",
      done: createRequirements.hasGenre,
      tabLabel: PAGE_TAB_LABEL.publish,
    },
    {
      id: "participant_min_age",
      label: isSimulationKind ? "등장인물 최저 나이" : "캐릭터 나이",
      done: hasParticipantAge,
      tabLabel: PAGE_TAB_LABEL.publish,
    },
  ];
  const missingRequirements = requirementEntries.filter((entry) => !entry.done);
  const tabMissingCount = (tab: PageTab) =>
    missingRequirements.filter((entry) => FIELD_TAB[entry.id] === tab).length;

  const fieldId = (key: FieldKey) => `${fieldUid}-${key}`;
  const errorFor = (key: FieldKey) => (fieldError?.key === key ? fieldError.message : null);
  const fieldProps = (key: FieldKey) => ({
    id: fieldId(key),
    ...(fieldError?.key === key
      ? { "aria-invalid": true as const, "aria-describedby": `${fieldId(key)}-error` }
      : {}),
  });

  function jumpToField(key: FieldKey) {
    setPageTab(FIELD_TAB[key]);
    setJump({ key, n: Date.now() });
  }

  function failField(message: string, key?: FieldKey) {
    setError(message);
    if (!key) return;
    setFieldError({ key, message });
    jumpToField(key);
  }

  function selectTab(tab: PageTab) {
    setPageTab(tab);
    const title = titleBlockRef.current;
    if (!title) return;
    const headerH = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--site-header-height"),
    );
    const top =
      title.getBoundingClientRect().bottom +
      window.scrollY -
      (Number.isFinite(headerH) ? headerH : 44) +
      8;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top) });
  }

  useEffect(() => {
    if (!jump) return;
    const el = document.getElementById(fieldId(jump.key));
    if (!el) return;
    const headerH = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--site-header-height"),
    );
    const offset =
      (Number.isFinite(headerH) ? headerH : 44) + (tabListRef.current?.offsetHeight ?? 0) + 20;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset),
      behavior: reduce ? "auto" : "smooth",
    });
    el.focus({ preventScroll: true });
  }, [jump]);

  useEffect(() => {
    setFieldError(null);
  }, [form, assets, files]);

  function addCharacterVisualSubject() {
    setVisualSubjects((current) => {
      if (current.subjects.length >= CHARACTER_VISUAL_SUBJECT_LIMIT) return current;
      return {
        version: 1,
        subjects: [
          ...current.subjects,
          {
            subjectKey: createCharacterVisualSubjectKey(),
            name: "",
            savedAppearance: "",
            representativeAssetUrl: null,
            sourceCharacterId: null,
          },
        ],
      };
    });
  }

  function updateCharacterVisualSubject(
    index: number,
    patch: Partial<VisualSubjectsDocument["subjects"][number]>
  ) {
    setVisualSubjects((current) => ({
      ...current,
      subjects: current.subjects.map((subject, subjectIndex) =>
        subjectIndex === index ? { ...subject, ...patch } : subject
      ),
    }));
  }

  function removeCharacterVisualSubject(index: number) {
    const subject = visualSubjects.subjects[index];
    if (!subject) return;
    const ownedCount = countCharacterVisualSubjectOwnedAssets(subject.subjectKey, assets);
    if (ownedCount > 0) {
      setError("이 인물에 연결된 이미지를 먼저 주인공 또는 다른 인물로 재지정해 주세요.");
      return;
    }
    setVisualSubjects((current) => ({
      ...current,
      subjects: current.subjects.filter((_, subjectIndex) => subjectIndex !== index),
    }));
  }

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const room = MAX_IMAGES - assets.length;
    const next = [...files, ...Array.from(list)].slice(0, room);
    setFiles(next);
  }

  function removeAsset(i: number) {
    setAssets((a) => normalizeCharacterAssets(a.filter((_, idx) => idx !== i)));
  }

  async function uploadAssetBatch(
    batchFiles: File[],
    options: { visualSubjectKey?: string; clearPendingFiles?: boolean } = {}
  ) {
    if (batchFiles.length === 0) return;
    setLoading(true);
    setError("");
    setProgress(
      options.visualSubjectKey
        ? `인물 이미지 ${batchFiles.length}장 업로드 중…`
        : `에셋 ${batchFiles.length}장 업로드 중…`
    );

    try {
      const fd = new FormData();
      batchFiles.forEach((file) => fd.append("files", file));
      const up = await fetch("/api/upload?purpose=character-asset", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) {
        setError(upData.error || "에셋 업로드에 실패했습니다.");
        return;
      }

      const uploadedUrls: string[] = Array.isArray(upData.urls)
        ? upData.urls.filter((url: unknown): url is string => typeof url === "string" && url.trim().length > 0)
        : [];
      const uploadedMedia = new Map<
        string,
        { url: string; mediaId: string; publicRenditionUrl: string; blurPreviewUrl: string }
      >(
        (Array.isArray(upData.media) ? upData.media : [])
          .filter((item: unknown): item is {
            url: string;
            mediaId: string;
            publicRenditionUrl: string;
            blurPreviewUrl: string;
          } => {
            if (!item || typeof item !== "object") return false;
            const row = item as Record<string, unknown>;
            return (
              typeof row.url === "string" &&
              typeof row.mediaId === "string" &&
              typeof row.publicRenditionUrl === "string" &&
              typeof row.blurPreviewUrl === "string"
            );
          })
          .map((item: {
            url: string;
            mediaId: string;
            publicRenditionUrl: string;
            blurPreviewUrl: string;
          }) => [item.url, item] as const)
      );
      if (uploadedUrls.length === 0) {
        setError("업로드된 이미지 URL을 확인하지 못했습니다.");
        return;
      }

      setProgress("이미지 표정·자세 태그 분석 중…");
      let taggedAssets: Array<{
        url: string;
        tag: string;
        adultFlagged?: boolean;
        moderationReject?: boolean;
        moderationReason?: string;
      }> = [];
      try {
        const tagRes = await fetch("/api/assets/tag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: uploadedUrls }),
        });
        const tagData = (await tagRes.json()) as {
          assets?: unknown;
          error?: string;
        };
        if (tagRes.ok && Array.isArray(tagData.assets)) {
          taggedAssets = tagData.assets
            .filter((a: unknown): a is {
              url: string;
              tag: string;
              adultFlagged?: boolean;
              moderationReject?: boolean;
              moderationReason?: string;
            } => {
              return (
                !!a &&
                typeof a === "object" &&
                typeof (a as { url?: unknown }).url === "string" &&
                typeof (a as { tag?: unknown }).tag === "string"
              );
            })
            .map((a, i) => ({
              url: a.url,
              tag: a.tag.trim() || fallbackAssetTag(assets.length + i),
              ...(typeof a.adultFlagged === "boolean" ? { adultFlagged: a.adultFlagged } : {}),
              ...(typeof a.moderationReject === "boolean" ? { moderationReject: a.moderationReject } : {}),
              ...(typeof a.moderationReason === "string" && a.moderationReason.trim()
                ? { moderationReason: a.moderationReason.trim() }
                : {}),
            }));
        } else if (!tagRes.ok) {
          setError(tagData.error || "자동 태깅에 실패했습니다. 기본 태그로 추가했으니 직접 수정해 주세요.");
        }
      } catch {
        setError("자동 태깅에 실패했습니다. 기본 태그로 추가했으니 직접 수정해 주세요.");
      }

      const byUrl = new Map(taggedAssets.map((asset) => [asset.url, asset]));
      const measured = await Promise.all(uploadedUrls.map((url) => measureImageUrl(url)));
      const batch = uploadedUrls.map((url: string, i: number) => {
        const tagged = byUrl.get(url);
        const stored = uploadedMedia.get(url);
        const size = measured[i];
        return withAssetSize(
          {
            url,
            tag: tagged?.tag || fallbackAssetTag(assets.length + i),
            ...(options.visualSubjectKey
              ? { visualSubjectKey: options.visualSubjectKey }
              : {}),
            ...defaultAssetFlags(assets, i),
            ...(stored
              ? {
                  mediaId: stored.mediaId,
                  publicRenditionUrl: stored.publicRenditionUrl,
                  blurPreviewUrl: stored.blurPreviewUrl,
                }
              : {}),
            ...(typeof tagged?.adultFlagged === "boolean" ? { adultFlagged: tagged.adultFlagged } : {}),
            ...(typeof tagged?.moderationReject === "boolean"
              ? { moderationReject: tagged.moderationReject }
              : {}),
            ...(tagged?.moderationReason ? { moderationReason: tagged.moderationReason } : {}),
          },
          size?.width,
          size?.height
        );
      });
      const { accepted, rejected } = partitionAllAgesTaggingBatch(batch, form.nsfw);
      if (accepted.length > 0) {
        setAssets((prev) => normalizeCharacterAssets([...prev, ...accepted]));
      }
      if (options.clearPendingFiles) setFiles([]);
      if (rejected.length > 0) {
        setError(allAgesAssetChangeRequest(rejected.length));
      }
    } catch {
      setError("에셋 업로드 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  async function tagPendingFiles() {
    await uploadAssetBatch(files, { clearPendingFiles: true });
  }

  function removeFile(i: number) {
    setFiles((f) => f.filter((_, idx) => idx !== i));
  }

  const filePreviewUrls = useMemo(() => {
    const map = filePreviewUrlMapRef.current;
    const nextSet = new Set(files);
    for (const [file, url] of map) {
      if (!nextSet.has(file)) {
        URL.revokeObjectURL(url);
        map.delete(file);
      }
    }
    for (const file of files) {
      if (!map.has(file)) {
        map.set(file, URL.createObjectURL(file));
      }
    }
    return files.map((file) => map.get(file)!);
  }, [files]);

  useEffect(() => {
    const map = filePreviewUrlMapRef.current;
    return () => {
      for (const url of map.values()) {
        URL.revokeObjectURL(url);
      }
      map.clear();
    };
  }, []);

  useEffect(() => {
    if (!isEditMode || !editCharacterId) return;
    let cancelled = false;
    (async () => {
      setEditLoading(true);
      setEditLoadError("");
      try {
        const res = await fetch(`/api/characters/${editCharacterId}`);
        const data = await res.json();
        if (!res.ok) {
          if (!cancelled)
            setEditLoadError(data.error || "캐릭터를 불러오지 못했습니다.");
          return;
        }
        if (cancelled) return;
        setForm({
          content_kind: data.content_kind === "simulation" ? "simulation" : "character",
          name: data.name ?? "",
          tagline: data.tagline ?? "",
          description: data.description ?? "",
          greeting: data.greeting ?? "",
          system_prompt: data.system_prompt ?? "",
          world: data.world ?? "",
          speech_personality: data.speech_personality ?? "",
          speech_traits: data.speech_traits ?? "",
          speech_examples: data.speech_examples ?? "",
          speech_forbidden: data.speech_forbidden ?? "",
          speech_contextual_registers: Array.isArray(data.speech_contextual_registers)
            ? data.speech_contextual_registers
            : [],
          status_window_prompt: "",
          genres: Array.isArray(data.genres) ? data.genres : [],
          tags: parseCharacterTagsInput(data.tags ?? ""),
          nsfw: !!data.nsfw,
          participant_min_age:
            data.participant_min_age != null ? data.participant_min_age : "",
          emoji: data.emoji ?? "✨",
          hue: Number(data.hue) || 260,
          audience: data.audience ?? "all",
          gender: data.gender ?? "",
          gender_public: data.gender_public === true,
          height_cm: data.height_cm != null ? String(data.height_cm) : "",
          weight_kg: data.weight_kg != null ? String(data.weight_kg) : "",
          world_public_name: data.world_public_name ?? "",
          world_public: data.world_public === true,
          visibility: data.visibility ?? "public",
          narration_style_instructions: data.narration_style_instructions ?? "",
          comments_enabled: data.comments_enabled !== false,
          creator_comment: data.creator_comment ?? "",
          simulation_reuse_allowed: false,
          simulation_nsfw_allowed: false,
          trpg_reuse_allowed: data.trpg_reuse_allowed === true,
          simulation_cast: data.simulation_cast ?? "",
          simulation_rules: data.simulation_rules ?? "",
        });
        setSimulationImports(Array.isArray(data.simulation_imports) ? data.simulation_imports : []);
        setAssets(persistLoadedAssets(Array.isArray(data.assets) ? data.assets : []));
        setVisualSubjects(
          data.visual_subjects
            ? {
                version: 1,
                subjects: Array.isArray(data.visual_subjects.subjects)
                  ? data.visual_subjects.subjects
                  : [],
              }
            : data.simulation_visual_subjects
            ? {
                version: 1,
                subjects: Array.isArray(data.simulation_visual_subjects.subjects)
                  ? data.simulation_visual_subjects.subjects
                  : [],
              }
            : parseSimulationVisualSubjectsJson(
                typeof data.simulation_visual_subjects_json === "string"
                  ? data.simulation_visual_subjects_json
                  : ""
              )
        );
        setSelectedWorldRef(
          data.source_world_share_id
            ? savedShareWorldLibraryRef(Number(data.source_world_share_id))
            : data.world_id
              ? `world:${data.world_id}`
              : ""
        );
        setWorldSourceKind((data.world_source_kind as CharacterWorldSourceKind | undefined) ?? null);
        setWorldDetach(false);
        setSelectedLorebookIds(
          Array.isArray(data.lorebook_ids)
            ? data.lorebook_ids.map(Number).filter((id: number) => Number.isFinite(id) && id > 0)
            : data.lorebook_id != null && data.lorebook_id !== ""
              ? [Number(data.lorebook_id)]
              : []
        );
        editPromptBaselineRef.current = JSON.stringify({
          name: String(data.name ?? "").trim(),
          content_kind: data.content_kind === "simulation" ? "simulation" : "character",
          greeting: data.greeting ?? "",
          system_prompt: data.system_prompt ?? "",
          simulation_cast: data.simulation_cast ?? "",
          simulation_rules: data.simulation_rules ?? "",
          simulation_import_ids: Array.isArray(data.simulation_imports)
            ? data.simulation_imports.map((item: SelectedImport) => item.characterId)
            : [],
          world: data.world ?? "",
          speech_personality: data.speech_personality ?? "",
          speech_traits: data.speech_traits ?? "",
          speech_examples: data.speech_examples ?? "",
          speech_forbidden: data.speech_forbidden ?? "",
          speech_contextual_registers: Array.isArray(data.speech_contextual_registers)
            ? data.speech_contextual_registers
            : [],
          gender: data.gender ?? "",
          world_id: data.world_id ?? "",
          lorebook_ids: Array.isArray(data.lorebook_ids) ? data.lorebook_ids : [],
          narration_style_instructions: data.narration_style_instructions ?? "",
        });
        const parsedWidget = parseStatusWidgetJson(data.status_widget_json);
        setStatusWidget(parsedWidget ?? characterStatusWidgetOrDefault(null));
        setStatusWidgetTriggers(
          Array.isArray(data.status_widget_triggers) ? data.status_widget_triggers : [],
        );
        setJsxCatalog(parseJsxComponentCatalog(data.jsx_components_json));
      } catch {
        if (!cancelled)
          setEditLoadError("네트워크 오류로 캐릭터를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editCharacterId, isEditMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/worlds");
        if (!res.ok) return;
        const data = (await res.json()) as { worlds?: WorldListItem[] };
        if (!cancelled && Array.isArray(data.worlds)) {
          setSavedWorlds(data.worlds);
        }
      } finally {
        if (!cancelled) setWorldsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (form.content_kind !== "simulation") {
      setSimulationImportOptions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/simulations/characters?nsfw=${form.nsfw ? "1" : "0"}&q=${encodeURIComponent(simulationImportSearch)}`)
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) {
            setSimulationImportOptions(Array.isArray(data.characters) ? data.characters : []);
          }
        })
        .catch(() => {
          if (!cancelled) setSimulationImportOptions([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.content_kind, form.nsfw, simulationImportSearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lorebooks");
        if (!res.ok) return;
        const data = (await res.json()) as {
          lorebooks?: KeywordLorebookListItem[];
        };
        if (!cancelled && Array.isArray(data.lorebooks)) {
          setSavedLorebooks(data.lorebooks);
        }
      } finally {
        if (!cancelled) setLorebooksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (worldsLoading || savedWorlds.length === 0) return;
    if (selectedWorldRef) return;
    if (initialWorldBorrowId != null && initialWorldBorrowId > 0) {
      const picked = savedWorlds.find((w) => w.borrowId === initialWorldBorrowId);
      if (picked && isBorrowAvailableForNewUse(picked)) {
        const ref = worldLibraryRef(picked);
        setSelectedWorldRef(ref);
        setWorldSourceKind("borrowed_snapshot");
        setForm((f) => ({
          ...f,
          world: worldPrivatePromptContent(picked.content, picked.secretContent ?? ""),
        }));
        setInitialBorrowUnavailable(false);
      } else if (picked) {
        setInitialBorrowUnavailable(true);
      }
      return;
    }
    setInitialBorrowUnavailable(false);
    if (initialWorldId != null && initialWorldId > 0) {
      const picked = savedWorlds.find((w) => w.id === initialWorldId && w.libraryKind !== "borrowed");
      if (picked) {
        const ref = worldLibraryRef(picked);
        setSelectedWorldRef(ref);
        setForm((f) => ({
          ...f,
          world: worldPrivatePromptContent(picked.content, picked.secretContent ?? ""),
        }));
      }
    }
  }, [worldsLoading, savedWorlds, selectedWorldRef, initialWorldBorrowId, initialWorldId]);

  function applySavedWorld(ref: string) {
    if (ref === "") {
      setSelectedWorldRef("");
      setWorldSourceKind(null);
      setWorldDetach(true);
      setForm((f) => ({ ...f, world: "" }));
      return;
    }
    const picked = savedWorlds.find((w) => worldLibraryRef(w) === ref);
    if (picked && !isBorrowAvailableForNewUse(picked)) return;
    setWorldDetach(false);
    setSelectedWorldRef(ref);
    if (picked) {
      setWorldSourceKind(
        picked.libraryKind === "borrowed"
          ? "borrowed_snapshot"
          : picked.libraryKind === "legacy_borrowed"
            ? "legacy_borrowed_snapshot"
            : "owned"
      );
      setForm((f) => ({
        ...f,
        world: worldPrivatePromptContent(picked.content, picked.secretContent ?? ""),
      }));
    } else if (ref.startsWith("saved-share:")) {
      setWorldSourceKind("borrowed_snapshot");
    }
  }

  function addSpeechRegister() {
    setForm((f) => ({
      ...f,
      speech_contextual_registers: [
        ...f.speech_contextual_registers,
        {
          label: "",
          condition: "",
          style: "",
          examples: "",
          priority: 80,
        },
      ].slice(0, 8),
    }));
  }

  function updateSpeechRegister(index: number, patch: Partial<SpeechContextualRegister>) {
    setForm((f) => {
      const nextRegisters = f.speech_contextual_registers.map((register, i) =>
        i === index ? { ...register, ...patch } : register,
      );
      let overflow =
        speechContextualCharCount(nextRegisters) - SPEECH_CONTEXTUAL_LIMIT;
      if (overflow <= 0) {
        return { ...f, speech_contextual_registers: nextRegisters };
      }
      const merged = { ...nextRegisters[index]! };
      for (const key of ["examples", "style", "condition", "label"] as const) {
        if (!(key in patch) || typeof merged[key] !== "string" || overflow <= 0) continue;
        const value = merged[key];
        const trimmed = value.slice(0, Math.max(0, value.length - overflow));
        overflow -= value.length - trimmed.length;
        merged[key] = trimmed;
      }
      nextRegisters[index] = merged;
      return { ...f, speech_contextual_registers: nextRegisters };
    });
  }

  function removeSpeechRegister(index: number) {
    setForm((f) => ({
      ...f,
      speech_contextual_registers: f.speech_contextual_registers.filter((_, i) => i !== index),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const promptUnchangedForEdit =
      isEditMode &&
      editPromptBaselineRef.current != null &&
      editPromptBaselineRef.current === buildPromptEditSignature();
    if (!form.name.trim()) {
      failField("캐릭터 이름(또는 시뮬레이션명)을 입력해 주세요.", "name");
      return;
    }
    if (form.name.length > CHARACTER_NAME_LIMIT) {
      failField(`이름은 ${CHARACTER_NAME_LIMIT}자 이하여야 합니다.`, "name");
      return;
    }
    if (!form.tagline.trim()) {
      failField("한 줄 소개를 입력해 주세요.", "tagline");
      return;
    }
    if (form.tagline.length > TAGLINE_LIMIT) {
      failField(`한 줄 소개는 ${TAGLINE_LIMIT}자 이하여야 합니다.`, "tagline");
      return;
    }
    if (!promptUnchangedForEdit && form.content_kind === "character" && !form.system_prompt.trim()) {
      failField("캐릭터 설정은 필수입니다.", "system_prompt");
      return;
    }
    if (!promptUnchangedForEdit && form.content_kind === "simulation" && !form.world.trim()) {
      failField("시뮬레이션 세계관을 입력해 주세요.", "world");
      return;
    }
    if (!promptUnchangedForEdit && form.content_kind === "simulation" && !form.simulation_cast.trim()) {
      failField("캐릭터 설정을 입력해 주세요.", "simulation_cast");
      return;
    }
    if (!promptUnchangedForEdit && substantiveAiLearningTotal < AI_LEARNING_MIN) {
      failField(`세계관 + 캐릭터 설정 + 기본 말투는 합쳐서 ${AI_LEARNING_MIN.toLocaleString()}자 이상 작성해 주세요.`, "system_prompt");
      return;
    }
    if (!promptUnchangedForEdit && form.content_kind === "character" && !form.gender) {
      failField("캐릭터 성별(남성/여성/기타)을 선택해 주세요.", "gender");
      return;
    }
    if (form.genres.length === 0) {
      failField("장르를 1개 이상 선택해 주세요.", "genres");
      return;
    }
    if (!promptUnchangedForEdit && !form.greeting.trim()) {
      failField("첫 메세지를 입력해 주세요.", "greeting");
      return;
    }
    if (form.narration_style_instructions.length > NARRATION_STYLE_INSTRUCTIONS_LIMIT) {
      failField(`서술·문체 지침은 ${NARRATION_STYLE_INSTRUCTIONS_LIMIT}자 이하여야 합니다.`, "narration");
      return;
    }
    if (!promptUnchangedForEdit && aiLearningTotal > AI_LEARNING_LIMIT) {
      failField(aiLearningLimitExceededMessage(), "ai_total");
      return;
    }
    if (form.content_kind === "character" && form.speech_examples.length > SPEECH_EXAMPLES_LIMIT) {
      failField(`캐릭터 대사 예시는 ${SPEECH_EXAMPLES_LIMIT.toLocaleString()}자 이하여야 합니다.`, "speech_examples");
      return;
    }
    if (form.content_kind === "character" && speechContextualTotal > SPEECH_CONTEXTUAL_LIMIT) {
      failField(`상황별 말투는 합쳐서 ${SPEECH_CONTEXTUAL_LIMIT.toLocaleString()}자 이하여야 합니다.`, "speech_contextual");
      return;
    }
    if (form.content_kind === "character" && form.speech_forbidden.length > SPEECH_FORBIDDEN_LIMIT) {
      failField(`금지 말투는 ${SPEECH_FORBIDDEN_LIMIT.toLocaleString()}자 이하여야 합니다.`, "speech_forbidden");
      return;
    }
    if (!promptUnchangedForEdit && form.greeting.length > GREETING_LIMIT) {
      failField(`첫 메세지는 ${GREETING_LIMIT.toLocaleString()}자 이하여야 합니다.`, "greeting");
      return;
    }
    if (files.length > 0) {
      failField("선택한 이미지를 먼저 「업로드 · 태깅」을 실행한 뒤, 가리기 설정을 확인해 주세요.", "assets");
      return;
    }
    if (assets.length === 0) {
      failField("감정 에셋 이미지를 1장 이상 업로드해 주세요.", "assets");
      return;
    }
    const dossierParsed = parsePublicDossierFromBody({
      gender_public: form.gender_public,
      height_cm: form.height_cm,
      weight_kg: form.weight_kg,
      world_public_name: form.world_public_name,
      world_public: form.world_public,
    });
    if (!dossierParsed.ok) {
      failField(dossierParsed.error, "dossier");
      return;
    }
    const ageParsed = parseParticipantMinAgeInput(form.participant_min_age);
    if (!ageParsed.ok) {
      failField(ageParsed.error, "participant_min_age");
      return;
    }
    if (ageParsed.value == null) {
      failField("캐릭터 나이를 입력해 주세요.", "participant_min_age");
      return;
    }
    const ageRangeError = validateParticipantMinAgeValue(ageParsed.value);
    if (ageRangeError) {
      failField(ageRangeError, "participant_min_age");
      return;
    }
    const nsfwAgeError = validateNsfwParticipantAgeContract({
      nsfw: form.nsfw,
      participantMinAge: ageParsed.value,
    });
    if (nsfwAgeError) {
      failField(nsfwAgeError, "participant_min_age");
      return;
    }
    setLoading(true);
    setError("");

    const finalAssets = normalizeCharacterAssets(assets);
    const description = form.description.trim();
    const worldSelection = parseWorldLibraryRef(selectedWorldRef);
    const payload = {
      ...form,
      participant_min_age: ageParsed.value,
      system_prompt: form.content_kind === "simulation" ? form.simulation_cast : form.system_prompt,
      gender: form.content_kind === "simulation" ? "other" : form.gender,
      simulation_import_ids: form.content_kind === "simulation"
        ? simulationImports.map((item) => item.characterId)
        : [],
      description,
      status_window_prompt: "",
      status_widget_json: serializeStatusWidget(statusWidget),
      jsx_components_json: serializeJsxComponentCatalog(jsxCatalog),
      status_widget_triggers: statusWidgetTriggers,
      assets: finalAssets,
      visual_subjects: visualSubjects,
      simulation_visual_subjects: form.content_kind === "simulation" ? visualSubjects : undefined,
      world_library_ref: selectedWorldRef,
      world_detach: worldDetach && selectedWorldRef === "",
      world_id: worldSelection.worldId,
      world_borrow_id: worldSelection.borrowId,
      lorebook_ids: selectedLorebookIds,
    };
    const canUseFastEditSave = promptUnchangedForEdit;

    const contentLabel = form.content_kind === "simulation" ? "시뮬레이션" : "캐릭터";
    setProgress(isEditMode ? `${contentLabel} 저장 중…` : `${contentLabel} 생성 중…`);
    if (canUseFastEditSave) {
      setProgress("공개/표시 정보 저장 중…");
    }
    const res = await fetch(
      isEditMode ? `/api/characters/${editCharacterId}` : "/api/characters",
      {
        method: canUseFastEditSave ? "PATCH" : isEditMode ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          canUseFastEditSave ? { ...payload, scope: "public_profile" } : payload,
        ),
      },
    );
    setLoading(false);
    setProgress("");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    if (data.moderationStatus === "rejected") {
      setError(
        `노출 이미지 검수 반려: ${data.moderationNote || "규정 위반"}. 캐릭터는 비공개로 저장되었습니다. 아래에서 수정 후 다시 저장하세요. (새로 만들면 중복됩니다)`,
      );
      router.replace(`/create?edit=${data.id}`);
      return;
    }
    if (data.moderationStatus === "pending") {
      setError("");
      clearCharacterCreateDraft(userId, editCharacterId ?? null);
      router.push(`/character/${data.id}`);
      return;
    }
    if (data.visibility === "link" && data.sharePath) {
      setError("");
    }
    clearCharacterCreateDraft(userId, editCharacterId ?? null);
    router.push(`/character/${data.id}`);
  }

  const cls = studioInputClass;
  const selectCls = studioSelectClass;
  const cardNameCls = `${studioInputClass} py-3.5 text-lg font-semibold tracking-tight`;
  const cardTaglineCls = `${studioInputClass} py-3.5 text-base font-semibold`;
  const greetingCls = `${studioInputClass} min-h-[280px] resize-y py-5 text-base leading-[1.7] sm:min-h-[360px]`;
  const label = studioType.label;
  const longTextCls = `${studioInputClass} resize-y px-4 py-3.5 text-base leading-[1.7] sm:text-[15px]`;
  const tabPanelClass = (tab: PageTab) =>
    `min-w-0 space-y-6 ${pageTab === tab ? "" : "hidden"}`;
  const tabPanelProps = (tab: PageTab) => ({
    id: `${fieldUid}-panel-${tab}`,
    role: "tabpanel" as const,
    "aria-labelledby": `${fieldUid}-tab-${tab}`,
    hidden: pageTab !== tab,
    className: tabPanelClass(tab),
  });
  const sectionPublic = studioSurface.section;
  const sectionPrivate = studioSurface.sectionAccent;
  const sectionMuted = studioSurface.section;
  const sectionGreeting = studioSurface.sectionAccent;

  const saveLabel = loading
    ? progress || "처리 중…"
    : isEditMode
      ? "변경사항 저장"
      : form.content_kind === "simulation"
        ? "시뮬레이션 만들기"
        : "캐릭터 만들기";

  return (
    <div className="mx-auto mt-4 max-w-6xl px-4 pb-36 sm:pb-32">
      <div ref={titleBlockRef}>
        <StudioBackLink href="/studio">← 제작 메뉴</StudioBackLink>
        <h1 className={cn(studioType.heading, "mt-3 text-xl sm:text-2xl")}>
          {isEditMode
            ? `${form.content_kind === "simulation" ? "시뮬레이션" : "캐릭터"} 수정`
            : "캐릭터·시뮬레이션 제작"}
        </h1>
        {isEditMode && (
          <p className={cn(studioType.helper, "mt-1")}>
            저장된 설정을 불러와 수정합니다. 저장 시 RP 프롬프트 청크가 다시
            생성됩니다.
          </p>
        )}
        {editLoading && (
          <p className={cn(studioType.helper, "mt-2 text-violet-300")}>
            캐릭터 정보 불러오는 중…
          </p>
        )}
        {editLoadError && (
          <p className="mt-2 text-sm text-rose-400">{editLoadError}</p>
        )}
      </div>

      <div
        ref={tabListRef}
        className={cn(
          studioSurface.tabList,
          "sticky top-[var(--site-header-height,44px)] z-30 mt-6 bg-[#0e1120]/95 backdrop-blur-md",
        )}
        role="tablist"
        aria-label="캐릭터·시뮬레이션 제작 탭"
      >
        {PAGE_TABS.map(([id, tabLabel], index) => {
          const missing = tabMissingCount(id);
          return (
            <button
              key={id}
              id={`${fieldUid}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={pageTab === id}
              aria-controls={`${fieldUid}-panel-${id}`}
              onClick={() => selectTab(id)}
              className={cn(
                "relative flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-1 text-[13px] font-semibold transition min-[576px]:text-sm sm:px-2",
                pageTab === id ? studioSurface.tabActive : studioSurface.tabIdle,
              )}
            >
              <span aria-hidden className="hidden text-[11px] tabular-nums opacity-60 min-[576px]:inline">
                {index + 1}
              </span>
              <span>{tabLabel}</span>
              {missing > 0 ? (
                <span className="absolute -right-0.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-300 px-1 text-[11px] font-bold leading-none text-zinc-950 shadow-sm shadow-black/40 min-[576px]:static min-[576px]:shadow-none">
                  {missing}
                  <span className="sr-only">개 필수 항목 남음</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {!editLoadError ? (
        <div className="mt-4">
          <RequirementSummary
            entries={requirementEntries}
            onJump={jumpToField}
            expanded={requirementsExpanded}
            onToggleExpanded={() => setRequirementsExpanded((open) => !open)}
          />
        </div>
      ) : null}

      <form id="studio-character-form" onSubmit={submit} noValidate className="mt-6">
        <div>
          <div {...tabPanelProps("create")}>
            <section className={sectionMuted}>
              <SectionHeader
                title="무엇을 만들까요?"
                description="제작 화면과 공개 기능은 같고, AI가 사용하는 설정 입력 방식만 달라집니다."
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ["character", "단일 캐릭터", "한 캐릭터의 성격·말투·외형을 상세히 설정합니다."],
                  ["simulation", "다인 시뮬레이션", "세계관과 여러 등장인물을 한 번에 자유롭게 작성합니다."],
                ] as const).map(([value, title, description]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={isEditMode}
                    onClick={() => setForm((current) => ({
                      ...current,
                      content_kind: value,
                      gender: value === "simulation" ? "other" : current.gender,
                    }))}
                    className={cn(
                      "rounded-xl border p-4 text-left transition disabled:cursor-not-allowed",
                      form.content_kind === value ? studioSurface.choiceActive : studioSurface.choiceIdle,
                    )}
                  >
                    <strong className="block text-sm">{title}</strong>
                    <span className="mt-1 block text-xs font-normal leading-relaxed text-zinc-400">{description}</span>
                  </button>
                ))}
              </div>
              {isEditMode && (
                <p className="text-xs text-zinc-400">기존 콘텐츠의 유형은 수정 중 변경할 수 없습니다.</p>
              )}
            </section>

            {/* 0. 홈·목록 노출 (공개) */}
            <section className={sectionPublic}>
              <SectionHeader
                title="홈·목록 노출 정보"
                visibility="public"
                description={
                  <>
                    홈 화면 카드에 표시 · 대표 이미지는 아래 감정 에셋{" "}
                    <span className="text-zinc-300">1번(메인)</span>
                  </>
                }
              />
              <div>
                <FieldLabel
                  htmlFor={fieldId("name")}
                  requirement="required"
                  aside={<FieldCounter now={form.name.length} max={CHARACTER_NAME_LIMIT} />}
                >
                  {form.content_kind === "simulation" ? "시뮬레이션명" : "캐릭터명"}
                </FieldLabel>
                <input
                  {...fieldProps("name")}
                  className={cardNameCls}
                  placeholder={form.content_kind === "simulation" ? "예: WW2 시뮬레이터" : "예: 리카르트 발크리드"}
                  value={form.name}
                  maxLength={CHARACTER_NAME_LIMIT}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      name: e.target.value.slice(0, CHARACTER_NAME_LIMIT),
                    })
                  }
                />
                <FieldError id={`${fieldId("name")}-error`} message={errorFor("name")} />
              </div>
              <div>
                <FieldLabel
                  htmlFor={fieldId("tagline")}
                  requirement="required"
                  aside={<FieldCounter now={form.tagline.length} max={TAGLINE_LIMIT} />}
                >
                  한 줄 소개
                </FieldLabel>
                <input
                  {...fieldProps("tagline")}
                  className={cardTaglineCls}
                  placeholder="홈·목록에 보이는 짧은 소개 (50자 이내)"
                  value={form.tagline}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      tagline: e.target.value.slice(0, TAGLINE_LIMIT),
                    })
                  }
                />
                <FieldError id={`${fieldId("tagline")}-error`} message={errorFor("tagline")} />
              </div>
              <div>
                <FieldLabel htmlFor={`${fieldUid}-tags`} requirement="optional">
                  태그
                </FieldLabel>
                <p className={cn(studioType.helper, "mb-1.5")}>
                  홈 카드·공개 페이지와 연동 · Enter로 추가 · 최대 12개
                </p>
                <TagChipInput
                  inputId={`${fieldUid}-tags`}
                  tags={form.tags}
                  onChange={(tags) => setForm({ ...form, tags })}
                  inputClassName={cls}
                  disabled={loading || editLoading}
                  placeholder="로판"
                />
              </div>
            </section>

            {/* 1. AI 학습 (비공개) */}
            <section className={sectionPrivate}>
              <SectionHeader
                title="AI 설정"
                visibility="private"
                description="AI 대화에만 쓰이고 공개되지 않아요. 글자수가 많아질수록 유저의 포인트 소모가 증가하니, 항상 기억해야 할 내용이 아니라면 로어북을 이용해보세요."
              />
              <AiLearningMeter
                id={fieldId("ai_total")}
                total={aiLearningTotal}
                substantive={substantiveAiLearningTotal}
                limit={AI_LEARNING_LIMIT}
                min={AI_LEARNING_MIN}
                minHint={`최소 ${AI_LEARNING_MIN.toLocaleString()}자는 서술·문체 지침을 뺀 분량 기준`}
                breakdown={
                  form.content_kind === "simulation"
                    ? "세계관 + 등장 캐릭터 + 추가 규칙을 합산"
                    : `세계관 + 캐릭터 설정 + 기본 말투 + 서술·문체 지침을 합산 · 대사 예시·상황별 말투·금지 말투는 각 ${SPEECH_EXAMPLES_LIMIT.toLocaleString()}자(합산 제외)`
                }
              />
              <div>
                <FieldLabel
                  htmlFor={fieldId("world")}
                  requirement={form.content_kind === "simulation" ? "required" : "optional"}
                  aside={<FieldCount now={form.world.length} />}
                >
                  세계관 / 배경
                </FieldLabel>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <select
                    aria-label="저장된 세계관 불러오기"
                    className={selectCls}
                    value={selectedWorldRef}
                    disabled={worldsLoading}
                    onChange={(e) => {
                      applySavedWorld(e.target.value);
                    }}
                  >
                    <option value="">직접 입력</option>
                    {savedWorlds.map((w) => {
                      const unavailable = !isBorrowAvailableForNewUse(w);
                      return (
                        <option
                          key={worldLibraryRef(w)}
                          value={worldLibraryRef(w)}
                          disabled={unavailable}
                        >
                          {w.name}
                          {unavailable
                            ? " (공유 종료 · 사용 불가)"
                            : w.libraryKind === "borrowed" || w.libraryKind === "legacy_borrowed"
                              ? " (빌림·읽기 전용)"
                              : ""}
                          {w.summary ? ` — ${w.summary}` : ""}
                        </option>
                      );
                    })}
                  </select>
                  {initialBorrowUnavailable && (
                    <span className="text-[11px] text-rose-400">
                      선택한 빌린 세계관은 공유가 종료되어 자동 적용할 수 없습니다.
                    </span>
                  )}
                  {!worldsLoading && savedWorlds.length === 0 && (
                    <Link
                      href="/world/create"
                      className="text-xs text-cyan-400 hover:underline"
                    >
                      세계관 먼저 만들기
                    </Link>
                  )}
                  {selectedWorldRef !== "" && (
                    <span className="text-[11px] text-cyan-400/80">
                      {isWorldFieldReadOnly
                        ? worldSourceKind === "borrowed_snapshot"
                          ? "공유 세계관 스냅샷 · 읽기 전용"
                          : "빌린 세계관 적용 중 · 읽기 전용"
                        : "저장된 세계관 불러옴 · 아래에서 수정 가능"}
                    </span>
                  )}
                </div>
                <textarea
                  {...fieldProps("world")}
                  rows={7}
                  className={longTextCls}
                  placeholder="이야기의 배경, 시대, 장소, 세력, 규칙 등"
                  value={form.world}
                  readOnly={isWorldFieldReadOnly}
                  onChange={(e) => {
                    if (isWorldFieldReadOnly) return;
                    setWorldDetach(true);
                    setSelectedWorldRef("");
                    setWorldSourceKind(null);
                    setForm({ ...form, world: e.target.value });
                  }}
                />
                <FieldError id={`${fieldId("world")}-error`} message={errorFor("world")} />
              </div>
              {form.content_kind === "character" ? <>
              <div>
                <FieldLabel
                  htmlFor={fieldId("system_prompt")}
                  requirement="required"
                  aside={<FieldCount now={form.system_prompt.length} />}
                >
                  캐릭터 설정
                </FieldLabel>
                <p className={cn(studioType.helper, "mb-1.5")}>
                  성격, 말투 특징, 외모, 배경, 관계, 습관, 가치관 등
                </p>
                <textarea
                  {...fieldProps("system_prompt")}
                  required
                  rows={10}
                  className={longTextCls}
                  placeholder="성격, 말투 특징, 외모, 배경, 관계, 습관, 가치관 등 (대사 예시는 아래 「말투 설정」에 작성)"
                  value={form.system_prompt}
                  onChange={(e) => {
                    setForm({ ...form, system_prompt: e.target.value });
                  }}
                />
                <FieldError id={`${fieldId("system_prompt")}-error`} message={errorFor("system_prompt")} />
              </div>
              <div className="space-y-4 rounded-xl border border-white/10 bg-[#161922] p-4">
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">말투 고정</h3>
                  <p className={cn(studioType.helper, "mt-1")}>
                    평소 말투와 상황별 말투 변화를 나누어 입력하면 장면에 맞는 대사가 더 안정적으로 유지됩니다.
                  </p>
                </div>
                <div>
                  <FieldLabel
                    htmlFor={fieldId("speech_personality")}
                    requirement="recommended"
                    aside={<FieldCount now={form.speech_personality.length} />}
                  >
                    기본 말투
                  </FieldLabel>
                  <textarea
                    {...fieldProps("speech_personality")}
                    rows={4}
                    className={longTextCls}
                    placeholder="예: 평소에는 낮고 무뚝뚝한 반말. 감정을 직접 말하지 않고 짧게 돌려 말한다."
                    value={form.speech_personality}
                    onChange={(e) =>
                      setForm({ ...form, speech_personality: e.target.value })
                    }
                  />
                  <p className="mt-1 text-xs text-zinc-400">
                    상황별 규칙이 맞지 않을 때 적용되는 캐릭터의 기본 대화 톤입니다.
                  </p>
                </div>
                <div>
                  <FieldLabel
                    htmlFor={fieldId("speech_examples")}
                    requirement="recommended"
                    aside={
                      <FieldCounter
                        now={form.speech_examples.length}
                        max={SPEECH_EXAMPLES_LIMIT}
                      />
                    }
                  >
                    캐릭터 대사 예시
                  </FieldLabel>
                  <textarea
                    {...fieldProps("speech_examples")}
                    rows={8}
                    className={longTextCls}
                    maxLength={SPEECH_EXAMPLES_LIMIT}
                    placeholder={
                      '어, 벌써 왔어? 기다리다 졸 뻔했는데.\n그건… 솔직히 나도 잘 모르겠어. 그냥 느낌이 그랬어.\n"오늘은 좀 일찍 자야겠다. 내일 아침에 일 있거든."\n뭐, 그렇게까지 생각할 일까지야?'
                    }
                    value={form.speech_examples}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        speech_examples: e.target.value.slice(
                          0,
                          SPEECH_EXAMPLES_LIMIT,
                        ),
                      })
                    }
                  />
                  <FieldError id={`${fieldId("speech_examples")}-error`} message={errorFor("speech_examples")} />
                  <p className={cn(studioType.helper, "mt-1.5")}>
                    캐릭터 대사만 한 줄씩 · 유저 대사 불필요 · 따옴표 있어도
                    없어도 됩니다 · {AI_LEARNING_LIMIT.toLocaleString()}자 합산 제외 · 최대{" "}
                    {SPEECH_EXAMPLES_LIMIT.toLocaleString()}자
                  </p>
                </div>
                <div
                  id={fieldId("speech_contextual")}
                  tabIndex={-1}
                  className="space-y-3 rounded-xl border border-white/10 bg-black/10 p-3 outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-zinc-100">
                        상황별 말투
                        <RequirementBadge kind="optional" />
                      </h4>
                      <p className={cn(studioType.helper, "mt-0.5")}>
                        공적 자리, 친밀도 상승, 적대 상황처럼 말투가 달라지는 조건을 추가합니다.
                        · {AI_LEARNING_LIMIT.toLocaleString()}자 합산 제외 · 전체 합계 최대{" "}
                        {SPEECH_CONTEXTUAL_LIMIT.toLocaleString()}자
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <FieldCounter
                        now={speechContextualTotal}
                        max={SPEECH_CONTEXTUAL_LIMIT}
                      />
                      <button
                        type="button"
                        onClick={addSpeechRegister}
                        disabled={form.speech_contextual_registers.length >= 8}
                        className="min-h-11 rounded-lg border border-violet-400/30 px-3.5 text-sm font-semibold text-zinc-100 hover:bg-violet-400/10 disabled:opacity-40"
                      >
                        + 상황별 말투 추가
                      </button>
                    </div>
                  </div>

                  {form.speech_contextual_registers.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-zinc-400">
                      필요할 때만 추가하세요. 예: 공적인 자리에서는 짧은 존댓말, 유저와 단둘일 때는 부드러운 반말.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {form.speech_contextual_registers.map((register, index) => (
                        <div
                          key={index}
                          className="space-y-3 rounded-xl border border-white/10 bg-[#161922] p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-zinc-200">
                              #{index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeSpeechRegister(index)}
                              className="min-h-11 px-3 text-sm text-zinc-300 hover:text-rose-300"
                            >
                              삭제
                            </button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className={label}>상황 이름</label>
                              <input
                                className={cls}
                                placeholder="예: 공적인 자리"
                                value={register.label}
                                onChange={(e) =>
                                  updateSpeechRegister(index, {
                                    label: e.target.value.slice(0, 40),
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className={label}>적용 조건</label>
                              <input
                                className={cls}
                                placeholder="예: 상관, 임무 보고, 공개 장소"
                                value={register.condition}
                                onChange={(e) =>
                                  updateSpeechRegister(index, {
                                    condition: e.target.value.slice(0, 160),
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div>
                            <label className={label}>말투 설명</label>
                            <textarea
                              rows={2}
                              className={cls}
                              placeholder="예: 짧고 절제된 존댓말/다나까체. 감정을 드러내지 않고 군인처럼 말한다."
                              value={register.style}
                              onChange={(e) =>
                                updateSpeechRegister(index, {
                                  style: e.target.value.slice(0, 240),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className={label}>대사 예시</label>
                            <textarea
                              rows={3}
                              className={cls}
                              placeholder={'"명령 확인했습니다."\n"즉시 이동하겠습니다."'}
                              value={register.examples}
                              onChange={(e) =>
                                updateSpeechRegister(index, {
                                  examples: e.target.value.slice(0, 600),
                                })
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <FieldLabel
                    htmlFor={fieldId("speech_forbidden")}
                    requirement="optional"
                    aside={
                      <FieldCounter
                        now={form.speech_forbidden.length}
                        max={SPEECH_FORBIDDEN_LIMIT}
                      />
                    }
                  >
                    금지 말투
                  </FieldLabel>
                  <textarea
                    {...fieldProps("speech_forbidden")}
                    rows={3}
                    className={longTextCls}
                    maxLength={SPEECH_FORBIDDEN_LIMIT}
                    placeholder="예: 입니다요, 하세요요, ㅋㅋ, 레전드, 헐, 대박, 밈, 인터넷체, 반말"
                    value={form.speech_forbidden}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        speech_forbidden: e.target.value.slice(
                          0,
                          SPEECH_FORBIDDEN_LIMIT,
                        ),
                      })
                    }
                  />
                  <FieldError id={`${fieldId("speech_forbidden")}-error`} message={errorFor("speech_forbidden")} />
                  <p className={cn(studioType.helper, "mt-1.5")}>
                    쉼표·줄바꿈으로 구분 · 비우면 기본 금지 목록(혼합 존댓말·밈
                    등)이 적용됩니다 · {AI_LEARNING_LIMIT.toLocaleString()}자 합산 제외 · 최대{" "}
                    {SPEECH_FORBIDDEN_LIMIT.toLocaleString()}자
                  </p>
                </div>
              </div>
              </> : <>
                <div>
                  <FieldLabel
                    htmlFor={fieldId("simulation_cast")}
                    requirement="required"
                    aside={<FieldCount now={form.simulation_cast.length} />}
                  >
                    캐릭터 설정
                  </FieldLabel>
                  <p className={cn(studioType.helper, "mb-1.5")}>
                    캐릭터를 따로 등록할 필요 없이 이름, 외형, 성격, 말투, 관계,
                    배경(과거) 등을 원하는 형식으로 작성하세요.
                    <span className="mt-1 block text-zinc-300">
                      이미지 생성에는 &apos;외형:&apos; / &apos;외모:&apos; /
                      &apos;외관:&apos;처럼 적은 내용을 우선 참고합니다.
                    </span>
                  </p>
                  <textarea
                    {...fieldProps("simulation_cast")}
                    required
                    rows={18}
                    className={longTextCls}
                    placeholder={SIMULATION_CAST_EXAMPLE}
                    value={form.simulation_cast}
                    onChange={(e) => setForm({ ...form, simulation_cast: e.target.value })}
                  />
                  {!form.simulation_cast.trim() && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, simulation_cast: SIMULATION_CAST_EXAMPLE })}
                      className="mt-2 text-xs font-semibold text-violet-300 hover:text-violet-200"
                    >
                      예시 형식 넣기
                    </button>
                  )}
                  <FieldError id={`${fieldId("simulation_cast")}-error`} message={errorFor("simulation_cast")} />
                </div>

                <div className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">추가 캐릭터 불러오기 <span className="font-normal text-zinc-400">· 선택</span></h3>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                      직접 작성만으로도 완성됩니다. 필요할 때 내가 만든 캐릭터를 추가하세요. TRPG 사용 허용과 관계없이 내 캐릭터는 내 시뮬레이션에서 쓸 수 있습니다.
                    </p>
                  </div>
                  {simulationImports.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {simulationImports.map((item) => (
                        <button
                          type="button"
                          key={item.characterId}
                          onClick={() => setSimulationImports((current) => current.filter((entry) => entry.characterId !== item.characterId))}
                          className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100"
                          title="클릭하여 제거"
                        >
                          {item.name} <span className="text-cyan-300/60">×</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    className={cls}
                    value={simulationImportSearch}
                    onChange={(e) => setSimulationImportSearch(e.target.value)}
                    placeholder="내 캐릭터 검색"
                  />
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {simulationImportOptions.map((character) => {
                      const selected = simulationImports.some((item) => item.characterId === character.id);
                      return (
                        <button
                          type="button"
                          key={character.id}
                          disabled={selected || simulationImports.length >= 12}
                          onClick={() => setSimulationImports((current) => [...current, {
                            characterId: character.id,
                            name: character.name,
                            creatorName: character.creatorName,
                            promptChars: character.promptChars,
                          }])}
                          className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#0d0f17] p-3 text-left hover:border-cyan-500/35 disabled:opacity-40"
                        >
                          {character.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={character.thumbnail} alt="" className="h-11 w-11 rounded-lg object-cover object-top" />
                          ) : (
                            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/5">🎭</span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-white">{character.name}</span>
                            <span className="block truncate text-[10px] text-zinc-400">
                              내 캐릭터
                            </span>
                          </span>
                          <span className="text-cyan-300">＋</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-zinc-400">가져온 원본 설정은 화면에 공개되지 않으며 AI 설정 글자 수에는 포함됩니다.</p>
                </div>

                <p className="text-right text-xs text-zinc-400">
                  AI 프롬프트 합계 (세계관 + 등장 캐릭터 + 규칙 + 서술·문체 지침){" "}
                  <span className={substantiveAiLearningTotal < AI_LEARNING_MIN ? "font-semibold text-amber-400" : ""}>
                    {aiLearningTotal.toLocaleString()}
                  </span>{" "}
                  / {AI_LEARNING_LIMIT.toLocaleString()}자 · 최소 {AI_LEARNING_MIN.toLocaleString()}자
                </p>
              </>}
              <div>
                <label className={label}>키워드 로어북</label>
                <p className="mb-2 text-xs text-zinc-400">
                  유저 입력에 키워드가 포함되면 해당 로어북 내용이 번역 없이 프롬프트에
                  주입됩니다. 캐릭터당 최대 {CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT}개까지 연결할
                  수 있습니다.
                </p>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-zinc-400">
                    선택 {selectedLorebookIds.length} / {CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT}
                  </span>
                  {!lorebooksLoading && savedLorebooks.length === 0 ? (
                    <Link
                      href="/lorebook/create"
                      className="text-xs text-zinc-300 hover:underline"
                    >
                      로어북 먼저 만들기
                    </Link>
                  ) : (
                    <Link
                      href="/lorebook"
                      className="text-xs text-zinc-400 hover:text-zinc-300"
                    >
                      관리
                    </Link>
                  )}
                </div>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-[#161922] p-3">
                  {lorebooksLoading ? (
                    <p className="text-xs text-zinc-400">불러오는 중...</p>
                  ) : savedLorebooks.length === 0 ? (
                    <p className="text-xs text-zinc-400">등록된 로어북이 없습니다.</p>
                  ) : (
                    savedLorebooks.map((lb) => {
                      const checked = selectedLorebookIds.includes(lb.id);
                      const atLimit =
                        !checked &&
                        selectedLorebookIds.length >= CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT;
                      return (
                        <label
                          key={lb.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm",
                            checked
                              ? "border-violet-500/40 bg-violet-500/10 text-zinc-100"
                              : "border-white/5 text-zinc-300 hover:border-white/15",
                            atLimit && "cursor-not-allowed opacity-50"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={checked}
                            disabled={atLimit}
                            onChange={(e) => {
                              setSelectedLorebookIds((prev) => {
                                if (e.target.checked) {
                                  if (prev.includes(lb.id)) return prev;
                                  if (prev.length >= CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT) {
                                    return prev;
                                  }
                                  return [...prev, lb.id];
                                }
                                return prev.filter((id) => id !== lb.id);
                              });
                            }}
                          />
                          <span>
                            <span className="font-medium">{lb.name}</span>
                            {lb.summary ? (
                              <span className="text-zinc-400"> — {lb.summary}</span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </section>

            {form.content_kind === "character" && (
              <section className={sectionMuted}>
                <SectionHeader
                  title="이미지 인물 설정"
                  requirement="optional"
                  visibility="private"
                  description="멀티 캐스트 이미지 생성에 등장할 조연·NPC의 이름과 외형 메모, 전용 참고 이미지를 등록합니다. 주인공(1번 이미지)과 별도로 관리됩니다."
                  aside={
                    <span className="text-xs font-semibold tabular-nums text-zinc-300">
                      {visualSubjects.subjects.length} / {CHARACTER_VISUAL_SUBJECT_LIMIT}명
                    </span>
                  }
                />
                <div className="space-y-3">
                  {visualSubjects.subjects.map((subject, index) => {
                    const ownedAssets = assetsForVisualSubject(assets, subject.subjectKey);
                    return (
                      <div
                        key={subject.subjectKey}
                        className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <label className={label}>인물 이름</label>
                          <button
                            type="button"
                            onClick={() => removeCharacterVisualSubject(index)}
                            className="text-xs font-semibold text-rose-300 hover:text-rose-200"
                          >
                            삭제
                          </button>
                        </div>
                        <input
                          className={cls}
                          value={subject.name}
                          maxLength={VISUAL_SUBJECT_NAME_LIMIT}
                          placeholder="예: 민준"
                          onChange={(event) =>
                            updateCharacterVisualSubject(index, {
                              name: event.target.value,
                            })
                          }
                        />
                        <div>
                          <label className={label}>저장 외형 메모</label>
                          <textarea
                            rows={2}
                            className={cls}
                            value={subject.savedAppearance}
                            placeholder="예: 검은 단발, 날카로운 눈매, 교복"
                            onChange={(event) =>
                              updateCharacterVisualSubject(index, {
                                savedAppearance: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className={label}>대표 참고 이미지</label>
                          <select
                            className={selectCls}
                            value={subject.representativeAssetUrl ?? ""}
                            onChange={(event) =>
                              updateCharacterVisualSubject(index, {
                                representativeAssetUrl: event.target.value || null,
                              })
                            }
                          >
                            <option value="">선택 안 함</option>
                            {ownedAssets.map((asset) => (
                              <option key={asset.url} value={asset.url}>
                                {asset.tag || asset.url}
                              </option>
                            ))}
                          </select>
                          {subject.representativeAssetUrl &&
                          !validateRepresentativeAsset(subject, assets) ? (
                            <p className="mt-1 text-xs text-amber-400">
                              해당 인물에 연결된 이미지만 대표로 선택할 수 있습니다.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    disabled={visualSubjects.subjects.length >= CHARACTER_VISUAL_SUBJECT_LIMIT}
                    onClick={addCharacterVisualSubject}
                    className="min-h-11 w-full rounded-xl border border-dashed border-cyan-500/30 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-40"
                  >
                    + 이미지 인물 추가
                  </button>
                </div>
              </section>
            )}

            {/* 2. 감정 에셋 (비공개) */}
            <section className={sectionMuted}>
              <SectionHeader
                title="감정 에셋 이미지"
                requirement="required"
                visibility="private"
                aside={
                  <span className="text-xs font-semibold tabular-nums text-zinc-300">
                    {assets.length + files.length} / {MAX_IMAGES}장
                  </span>
                }
              />
              <p className={studioType.helper}>
                대화 중 AI가 출력하는 [태그]에 맞는 이미지가 표시됩니다.{" "}
                <strong className="text-zinc-200">1번</strong>이 카드 대표 이미지입니다.
              </p>
              <details className="rounded-xl border border-white/10 bg-[#0e1120] px-4">
                <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold text-zinc-200">
                  태그·가리기 사용 안내
                </summary>
                <p className={cn(studioType.helper, "pb-3")}>
                  대화 중 AI가 [태그: …]를 출력하면 세로로 긴 이미지는 좌측 초상(모바일은
                  채팅 배경)으로 바뀌고, 가로로 긴 이미지는 본문 가로폭에 맞춰 스트리밍
                  중에 바로 뜹니다. 태그는 표정·포즈·상황 모두 가능합니다(예: 부끄러움,
                  침대에 누움). 업로드 시 Gemini Vision이 태그를 자동 분석하며, 잘못된
                  태그는 에셋 하단 태그를 클릭해 직접 수정할 수 있습니다.
                  <br />
                  <span className="text-zinc-300">가리기</span>를 켠 이미지는
                  제작자에게만 선명하게 보이고, 다른 유저에게는 블러 처리됩니다.
                  올린 이미지는 모두 소개·대화에 쓰이며,{" "}
                  <strong className="text-zinc-200">1번</strong>이 카드 대표
                  이미지입니다. 새로 올린 장은 첫 번째만 비가림, 나머지는 가림
                  ON이 기본입니다.
                </p>
              </details>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(e) => {
                  pickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                {...fieldProps("assets")}
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={assets.length + files.length >= MAX_IMAGES}
                className={studioSurface.uploadZone}
              >
                + 에셋 이미지 추가
                <span className="mt-1.5 block text-xs font-semibold tracking-normal text-zinc-200/80 sm:text-sm">
                  최대 {MAX_IMAGES}장 · 장당 4MB · 자동 태깅
                </span>
              </button>
              <FieldError id={`${fieldId("assets")}-error`} message={errorFor("assets")} />

              {files.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-400">
                    {files.length}장 선택됨 · 「업로드 · 태깅」 후 가리기·순서를
                    설정할 수 있습니다.
                  </p>
                  <button
                    type="button"
                    onClick={tagPendingFiles}
                    disabled={loading}
                    className="w-full min-h-11 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    {loading && progress.includes("태그")
                      ? progress
                      : loading && progress.includes("업로드")
                        ? progress
                        : `${files.length}장 업로드 · 태깅`}
                  </button>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {files.map((f, i) => (
                      <div
                        key={`${f.name}-${f.size}-${i}`}
                        className="group relative overflow-hidden rounded-xl border border-amber-500/20 bg-[#0e1120]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={filePreviewUrls[i]}
                          alt=""
                          className="aspect-[3/4] w-full object-cover object-top opacity-90"
                        />
                        <span className="absolute bottom-0 left-0 right-0 truncate bg-black/75 px-2 py-1 text-[10px] text-amber-200/90">
                          {f.name}
                        </span>
                        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300">
                          대기
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/80 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-rose-600/90"
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {assets.length > 0 && (
                <AssetManagerGrid
                  assets={assets}
                  allAges={!form.nsfw}
                  onChange={(next) => setAssets(normalizeCharacterAssets(next))}
                  onRemove={removeAsset}
                  visualSubjects={
                    form.content_kind === "simulation" || form.content_kind === "character"
                      ? visualSubjects.subjects
                      : undefined
                  }
                  contentKind={form.content_kind}
                />
              )}
            </section>

            {form.content_kind === "simulation" && (
              <details className={sectionMuted}>
                <summary className="cursor-pointer text-sm font-semibold text-zinc-200">
                  고급 진행 규칙
                </summary>
                <div className="mt-3">
                  <p className="mb-2 text-xs text-zinc-400">
                    보통은 비워도 됩니다. 시뮬레이션 전체 진행에만 적용할 특별 규칙이
                    있을 때 사용하세요.
                  </p>
                  <textarea
                    rows={5}
                    className={cls}
                    placeholder="예: 인물은 자신이 직접 알게 된 정보만 사용한다."
                    value={form.simulation_rules}
                    onChange={(event) =>
                      setForm({ ...form, simulation_rules: event.target.value })
                    }
                  />
                </div>
              </details>
            )}

            {/* 3. 부가 설정 (비공개) */}
            {form.content_kind === "character" && (
            <section className={sectionMuted}>
              <SectionHeader title="부가 설정" visibility="private" />
              <div>
                <FieldLabel requirement="required">캐릭터 성별</FieldLabel>
                <p className={cn(studioType.helper, "mb-2")}>
                  AI가 지문·외형·호칭을 이 성별에 맞게 묘사합니다
                </p>
                <div
                  {...fieldProps("gender")}
                  role="group"
                  aria-label="캐릭터 성별"
                  tabIndex={-1}
                  className="grid grid-cols-3 gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                >
                  {(["male", "female", "other"] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setForm({ ...form, gender: value })}
                      className={cn(
                        "min-h-11 rounded-xl border py-3 text-sm font-semibold transition",
                        form.gender === value
                          ? studioSurface.choiceActive
                          : studioSurface.choiceIdle,
                      )}
                    >
                      {GENDER_LABELS[value]}
                    </button>
                  ))}
                </div>
                <FieldError id={`${fieldId("gender")}-error`} message={errorFor("gender")} />
              </div>
            </section>
            )}

            {/* 서술·문체 지침 (Character + Simulation) */}
            <section className={sectionMuted}>
              <SectionHeader
                title="서술·문체 지침"
                requirement="optional"
                visibility="private"
                description="응답의 서술 방식과 문체를 세부 조정할 수 있습니다. 비우면 플랫폼 기본 문체가 적용됩니다."
              />
              <div>
                <FieldLabel
                  htmlFor={fieldId("narration")}
                  aside={
                    <FieldCounter
                      now={form.narration_style_instructions.length}
                      max={NARRATION_STYLE_INSTRUCTIONS_LIMIT}
                    />
                  }
                >
                  문체 지침
                </FieldLabel>
                <textarea
                  {...fieldProps("narration")}
                  rows={4}
                  className={longTextCls}
                  maxLength={NARRATION_STYLE_INSTRUCTIONS_LIMIT}
                  placeholder="예: 3인칭 제한 시점, 건조한 문장, 감정을 직접 설명하지 않고 행동으로 표현"
                  value={form.narration_style_instructions}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      narration_style_instructions: event.target.value.slice(
                        0,
                        NARRATION_STYLE_INSTRUCTIONS_LIMIT
                      ),
                    })
                  }
                />
                <FieldError id={`${fieldId("narration")}-error`} message={errorFor("narration")} />
                <p className={cn(studioType.helper, "mt-1.5")}>
                  {AI_LEARNING_LIMIT.toLocaleString()}자 합산 한도에 포함 · 최소 작성 분량(세계관+설정+말투)에는
                  포함되지 않음
                </p>
              </div>
            </section>

            {/* 4. 첫 메세지 (비공개) */}
            <section className={sectionGreeting}>
              <SectionHeader
                title="첫 메세지"
                requirement="required"
                visibility="private"
                description="대화 시작 시 캐릭터가 보내는 첫 메시지 · 소개 페이지에 노출되지 않음"
              />
              <div>
                <FieldLabel
                  htmlFor={fieldId("greeting")}
                  aside={<FieldCounter now={form.greeting.length} max={GREETING_LIMIT} />}
                >
                  첫 메세지 본문
                </FieldLabel>
                <textarea
                  {...fieldProps("greeting")}
                  rows={14}
                  className={greetingCls}
                  placeholder={`대화 시작 시 캐릭터가 보내는 첫 메시지를 입력하세요.\n\n예:\n*창가에 기대어 연기를 내뿜으며 시선을 올린다.*\n"……왔어?"`}
                  value={form.greeting}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      greeting: e.target.value.slice(0, GREETING_LIMIT),
                    })
                  }
                />
                <FieldError id={`${fieldId("greeting")}-error`} message={errorFor("greeting")} />
                <details className="mt-3 rounded-xl border border-white/10 bg-[#161922] px-4 py-3 text-[13px] leading-relaxed text-zinc-300">
  <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold text-zinc-200">
                    지문과 대사는 이렇게 구분해요
                  </summary>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-zinc-300">
                    <li>
                      <span className="text-zinc-400">지문</span> (행동·묘사):
                      따옴표 없이 서술하거나{" "}
                      <code className="rounded bg-black/30 px-1 text-zinc-300">
                        *별표*
                      </code>
                      로 감싸기 →{" "}
                      <span className="italic text-zinc-400">회색 이탤릭</span>
                    </li>
                    <li>
                      <span className="text-orange-300">대사</span> (캐릭터 말):
                      반드시{" "}
                      <code className="rounded bg-black/30 px-1 text-orange-200">
                        &quot;큰따옴표&quot;
                      </code>
                      로 감싸기 →{" "}
                      <span className="font-semibold text-orange-300">
                        주황색
                      </span>
                    </li>
                    <li>Enter로 줄바꿈하면 채팅에서 문단이 나뉩니다.</li>
                  </ul>
                </details>
              </div>
            </section>
          </div>

          <div {...tabPanelProps("preview")}>
            <section className={`${sectionPublic} scroll-mt-24`}>
              <SectionHeader
                title={
                  form.content_kind === "simulation"
                    ? "공개 시뮬레이션/세계관 정보"
                    : "공개 캐릭터/세계관 정보"
                }
                requirement="optional"
                visibility="public"
                description={`보이는 그대로 작성 · Enter 줄바꿈 그대로 반영 · 최대 ${PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자`}
              />
              <p className="mt-2 rounded-lg border border-white/10 bg-[#161922] px-3.5 py-2.5 text-sm font-medium leading-relaxed text-zinc-300">
                공개 소개 페이지에는 아래 입력칸에 보이는 모양 그대로 표시됩니다.
                필요한 문장을 드래그해서 굵기·크기·색상만 조절하세요.
              </p>
              <PublicDescriptionEditor
                value={form.description}
                maxLength={PROFILE_BIOGRAPHY_LIMIT}
                disabled={loading || editLoading}
                onChange={(description) => setForm({ ...form, description })}
              />
              <p className="text-right text-xs text-zinc-400">
                {countPublicDescriptionVisibleChars(form.description).toLocaleString()} /{" "}
                {PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자
              </p>
              <PublicDossierFields
                containerId={fieldId("dossier")}
                form={form}
                disabled={loading || editLoading}
                onChange={(patch) => setForm({ ...form, ...patch })}
              />
            </section>
          </div>

          <div {...tabPanelProps("widget")}>
            <section className={sectionMuted}>
              <SectionHeader
                title="상태창 위젯"
                requirement="optional"
                description={`디자인과 상태값을 입력하면 미리보기에 반영됩니다. HTML·JSX는 직접 제작에서 작성합니다. 채팅 호출 컴포넌트는 아래에서 따로 엽니다. 상태값·지시 추정 토큰 ${STATUS_WIDGET_CONTEXT_MAX}`}
                aside={
                  <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-zinc-200">
                    기본 적용
                  </span>
                }
              />
              <StatusWidgetEditor
                key={
                  editLoading
                    ? "status-widget-loading"
                    : `status-widget-${editCharacterId ?? "new"}`
                }
                value={statusWidget}
                onChange={setStatusWidget}
                disabled={loading || editLoading}
                profileNames={{
                  characterName: form.name.trim() || "캐릭터",
                  personaName: "유저",
                }}
              />
              <StatusWidgetTriggerEditor
                value={statusWidgetTriggers}
                onChange={setStatusWidgetTriggers}
                statusWidget={statusWidget}
                disabled={loading}
              />
              <div className="mt-6 rounded-2xl border border-amber-500/20 bg-[#0c0c10] p-4">
                <button
                  type="button"
                  aria-expanded={chatJsxEditorOpen}
                  onClick={() => setChatJsxEditorOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span>
                    <span className="block text-sm font-semibold text-zinc-100">
                      대화용 인터랙티브 화면 만들기
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-400">
                      예제를 눌러 본 뒤 적용합니다. 저장하면 AI가 대화 상황에 맞춰 호출할 수
                      있습니다. TRPG 캐릭터 시트도 여기서 만듭니다.
                      {jsxCatalog.length > 0
                        ? ` 저장됨: ${jsxCatalog.map((component) => component.name).join(", ")}`
                        : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {chatJsxEditorOpen ? "닫기" : "편집"}
                  </span>
                </button>
                <div hidden={!chatJsxEditorOpen}>
                  <JsxComponentCatalogEditor
                    key={
                      editLoading
                        ? "jsx-catalog-loading"
                        : `jsx-catalog-${editCharacterId ?? "new"}`
                    }
                    value={jsxCatalog}
                    onChange={setJsxCatalog}
                    disabled={loading || editLoading}
                  />
                </div>
              </div>
            </section>
          </div>

          <div {...tabPanelProps("publish")}>
            <section className={sectionPrivate}>
              <SectionHeader
                title="공개 설정"
                description="공개 범위 · 이용등급 · 댓글을 먼저 설정합니다."
              />

              <div className="rounded-xl border border-white/10 bg-[#161922] p-4">
                <p className="text-sm font-semibold text-zinc-100">공개 범위</p>
                <p className="mt-1 text-xs text-zinc-400">
                  공개·링크 공개 선택 시 노출 이미지가 자동 분류됩니다.
                  유두·성기·항문 노출만 반려되고, 애매한 선정성은 관리자 검수 후 공개됩니다.
                  반려 시 비공개로 저장됩니다.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ["public", "공개", "신작·목록에 노출"],
                      ["link", "링크 공개", "URL로만 공유 · 목록 숨김"],
                      ["private", "비공개", "나만 볼 수 있음"],
                    ] as const
                  ).map(([value, title, desc]) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setForm({ ...form, visibility: value })}
                      className={`rounded-xl border p-3 text-left transition ${
                        form.visibility === value
                          ? "border-violet-500 bg-violet-600/20 ring-1 ring-violet-500/40"
                          : "border-white/10 bg-[#161922] hover:border-white/20"
                      }`}
                    >
                      <p className="text-sm font-bold text-white">{title}</p>
                      <p className="mt-0.5 text-xs text-zinc-400">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-[#161922] p-4 transition hover:border-violet-400/25">
                <input
                  type="checkbox"
                  checked={form.nsfw}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setForm({ ...form, nsfw: next });
                    if (!next && assets.some(isAssetHardRejected)) {
                      setError(allAgesAssetChangeRequest(assets.filter(isAssetHardRejected).length));
                    }
                  }}
                  className="h-5 w-5 accent-violet-500"
                />
                <div>
                  <p className="font-semibold text-zinc-100">
                    성인용 {form.content_kind === "simulation" ? "시뮬레이션" : "캐릭터"}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {form.content_kind === "simulation"
                      ? "성인 장면 기능을 사용할 시뮬레이션입니다. 성인 장면에 참여 가능한 주요 등장인물은 모두 만 19세 이상이어야 합니다."
                      : "성인 장면 기능을 사용할 캐릭터입니다. 성인 장면에 참여 가능한 주요 등장인물은 모두 만 19세 이상이어야 합니다."}
                  </p>
                </div>
              </label>

              <div className="rounded-xl border border-white/10 bg-[#161922] p-4">
                <FieldLabel htmlFor={fieldId("participant_min_age")} requirement="required">
                  {form.content_kind === "simulation"
                    ? "성인 장면 참여 가능 등장인물 중 최저 나이"
                    : "캐릭터 나이"}
                </FieldLabel>
                <input
                  {...fieldProps("participant_min_age")}
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  inputMode="numeric"
                  value={form.participant_min_age}
                  onChange={(e) =>
                    setForm({ ...form, participant_min_age: e.target.value })
                  }
                  className={cls}
                  placeholder="예: 28"
                  disabled={loading}
                />
                <FieldError
                  id={`${fieldId("participant_min_age")}-error`}
                  message={errorFor("participant_min_age")}
                />
                <p className="mt-2 text-xs text-zinc-400">
                  {form.content_kind === "simulation"
                    ? "성인 장면에 참여할 수 있는 주요 등장인물 중 가장 어린 인물의 현재 만 나이를 입력해 주세요. 자녀·가족·학생·아동 NPC 등 성인 장면에 참여하지 않는 설정상 조연은 제외합니다."
                    : "현재 캐릭터의 만 나이를 입력해 주세요."}
                </p>
                {form.nsfw && form.participant_min_age === "" ? (
                  <p className="mt-2 text-xs text-amber-400">
                    성인용 캐릭터로 설정하려면 나이를 입력해 주세요.
                  </p>
                ) : null}
                {form.nsfw &&
                form.participant_min_age !== "" &&
                Number(form.participant_min_age) > 0 &&
                Number(form.participant_min_age) < 19 ? (
                  <p className="mt-2 text-xs text-amber-400">
                    성인용 캐릭터/시뮬레이션은 성인 장면 참여 가능 인물이 모두 만
                    19세 이상이어야 합니다.
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-white/10 bg-[#161922] p-4">
                <ToggleSwitch
                  checked={form.comments_enabled}
                  onChange={(next) =>
                    setForm({ ...form, comments_enabled: next })
                  }
                  disabled={loading}
                  label="댓글 허용"
                  description={`OFF 시 다른 사용자는 이 ${
                    form.content_kind === "simulation" ? "시뮬레이션" : "캐릭터"
                  }에 댓글을 보거나 작성할 수 없습니다.`}
                />
              </div>

              {form.content_kind === "character" && (
              <div className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                <ToggleSwitch
                  checked={form.trpg_reuse_allowed}
                  onChange={(next) => setForm({ ...form, trpg_reuse_allowed: next })}
                  disabled={loading}
                  label="TRPG에서 사용 허용"
                  description="허용하면 공개·검수 승인된 이 캐릭터를 다른 유저가 TRPG에 데려갈 수 있습니다. 그때 유료 라운드 사용액의 최대 5%가 CP로 지급됩니다. 기본값은 OFF입니다. 내가 만든 시뮬레이션에는 이 설정과 관계없이 내 캐릭터를 쓸 수 있습니다."
                />
              </div>
              )}
            </section>

            <section className={sectionMuted}>
              <SectionHeader
                title="노출 · 장르"
                description="홈·목록 노출 대상과 장르를 설정합니다."
              />
              <div>
                <FieldLabel requirement="required">타깃</FieldLabel>
                <p className={cn(studioType.helper, "mb-2")}>홈·목록 노출 대상</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["all", "공용"],
                      ["female", "여성향"],
                      ["male", "남성향"],
                    ] as const
                  ).map(([value, audienceLabel]) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setForm({ ...form, audience: value })}
                      className={cn(
                        "min-h-11 rounded-xl px-4 text-sm font-semibold transition",
                        form.audience === value
                          ? "bg-violet-600 text-white"
                          : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200",
                      )}
                    >
                      {audienceLabel}
                    </button>
                  ))}
                </div>
              </div>
              <div
                {...fieldProps("genres")}
                tabIndex={-1}
                className="space-y-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
              >
                <GenrePicker
                  value={form.genres}
                  onChange={(genres) => setForm({ ...form, genres })}
                  disabled={loading}
                />
                <FieldError id={`${fieldId("genres")}-error`} message={errorFor("genres")} />
              </div>
            </section>

            <section className={sectionMuted}>
              <div>
                <FieldLabel
                  htmlFor={`${fieldUid}-creator-comment`}
                  requirement="optional"
                  aside={
                    <FieldCounter
                      now={form.creator_comment.length}
                      max={CREATOR_COMMENT_LIMIT}
                    />
                  }
                >
                  제작자 코멘트
                </FieldLabel>
                <p className={cn(studioType.helper, "mb-2")}>
                  공개 페이지 {form.content_kind === "simulation" ? "시뮬레이션" : "캐릭터"} 설명 하단에 표시 · HTML 사용 가능 (p, b, a,
                  ul, img 등 · script 금지) · 업데이트 안내, 플레이 팁 등 (선택)
                </p>
                <textarea
                  id={`${fieldUid}-creator-comment`}
                  rows={8}
                  className={longTextCls}
                  placeholder="예: v1.2 업데이트 — 말투를 조금 부드럽게 수정했습니다. 플레이 팁: 첫 대화에서 ○○를 언급하면 반응이 좋아요."
                  value={form.creator_comment}
                  maxLength={CREATOR_COMMENT_LIMIT}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      creator_comment: e.target.value.slice(
                        0,
                        CREATOR_COMMENT_LIMIT,
                      ),
                    })
                  }
                />
                {form.creator_comment.trim() ? (
                  <div className="mt-3 rounded-xl border border-white/10 bg-[#0e1120] p-4">
                    <p className="mb-2 text-xs font-semibold text-zinc-400">
                      미리보기
                    </p>
                    <CreatorCommentHtml html={form.creator_comment} />
                  </div>
                ) : null}
              </div>

              <p className={cn(studioType.helper, "leading-relaxed")}>
                저장 중에는 공개 이미지 검수와 AI 대화용 설정 정리가 함께 진행되어
                이미지가 많거나 외부 AI 응답이 느리면 시간이 걸릴 수 있습니다.
                에셋만 수정한 경우에는 설정 정리 단계를 건너뛰어 더 빠르게
                저장됩니다.
              </p>
            </section>
          </div>
        </div>
      </form>

      <StudioSaveBar
        formId="studio-character-form"
        saveType="submit"
        saveLabel={saveLabel}
        saveDisabled={
          loading || editLoading || !!editLoadError || !createReady
        }
        error={error || null}
        secondary={{
          label: draftFlash ? "저장됨 ✓" : "임시저장",
          onClick: saveDraftLocally,
          disabled: editLoading,
          flash: draftFlash,
          hint: draftSavedAt
            ? `마지막 임시저장: ${formatDraftSavedAt(draftSavedAt)}`
            : "공개되지 않고 이 브라우저에만 보관",
        }}
      >
        {!loading && !editLoading && !editLoadError && missingRequirements[0] ? (
          <button
            type="button"
            onClick={() => jumpToField(missingRequirements[0].id)}
            className="min-h-8 text-left text-[13px] text-zinc-300 underline decoration-amber-300/60 underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
          >
            필수 {missingRequirements.length}개 남음 ·{" "}
            <span className="font-semibold text-amber-200">{missingRequirements[0].label}</span> 채우러 가기
          </button>
        ) : !loading && !editLoading && !editLoadError && !error ? (
          <p className="text-xs text-zinc-400">
            {isEditMode ? "변경사항은 저장 즉시 반영돼요" : VISIBILITY_SAVE_NOTE[form.visibility]}
          </p>
        ) : null}
      </StudioSaveBar>
    </div>
  );
}

type PublicDossierFormPatch = {
  gender_public?: boolean;
  height_cm?: string;
  weight_kg?: string;
  world_public_name?: string;
  world_public?: boolean;
};

function PublicDossierFields({
  containerId,
  form,
  disabled,
  onChange,
}: {
  containerId: string;
  form: {
    gender: "" | CharacterGender;
    gender_public: boolean;
    height_cm: string;
    weight_kg: string;
    world_public_name: string;
    world_public: boolean;
    content_kind: ContentKind;
  };
  disabled: boolean;
  onChange: (patch: PublicDossierFormPatch) => void;
}) {
  const heightError = form.height_cm.trim()
    ? parsePublicDossierFromBody({ height_cm: form.height_cm }).ok
      ? ""
      : (parsePublicDossierFromBody({ height_cm: form.height_cm }) as { error: string }).error
    : "";
  const weightError = form.weight_kg.trim()
    ? parsePublicDossierFromBody({ weight_kg: form.weight_kg }).ok
      ? ""
      : (parsePublicDossierFromBody({ weight_kg: form.weight_kg }) as { error: string }).error
    : "";
  const preview: PublicDossierView = readPublicDossier({
    gender: form.gender || undefined,
    gender_public: form.gender_public ? 1 : 0,
    height_cm: /^\d+$/.test(form.height_cm.trim()) ? Number(form.height_cm.trim()) : null,
    weight_kg: /^\d+$/.test(form.weight_kg.trim()) ? Number(form.weight_kg.trim()) : null,
    world_public_name: form.world_public_name,
    world_public: form.world_public ? 1 : 0,
  });
  const worldPreview = form.world_public_name.trim()
    ? form.world_public_name.trim().slice(0, WORLD_PUBLIC_NAME_MAX)
    : "";

  return (
    <div
      id={containerId}
      tabIndex={-1}
      className="mt-6 space-y-5 border-t border-white/10 pt-5 outline-none"
    >
      <div>
        <h3 className="text-base font-semibold text-zinc-100">
          공개 인물 정보
          <RequirementBadge kind="optional" />
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
          동의한 항목만 공개 프로필과 등장 연출에 표시됩니다. 기본값은 모두 비공개입니다.
        </p>
      </div>

      <div className="space-y-2">
        <label className={studioType.label}>세계관 이름</label>
        <p className="text-xs text-zinc-400">
          공개 프로필에 쓸 표시명입니다. 비공개 세계관 원문이나 빌린 세계관 이름은 자동으로 넣지 않습니다.
        </p>
        <input
          className={studioInputClass}
          maxLength={WORLD_PUBLIC_NAME_MAX}
          disabled={disabled}
          placeholder="예: 에테르노스 제국"
          value={form.world_public_name}
          onChange={(event) =>
            onChange({ world_public_name: event.target.value.slice(0, WORLD_PUBLIC_NAME_MAX) })
          }
        />
        <p className="text-right text-xs text-zinc-400">
          {form.world_public_name.trim().length} / {WORLD_PUBLIC_NAME_MAX}자
        </p>
        <ToggleSwitch
          checked={form.world_public}
          disabled={disabled}
          label="세계관 이름 프로필 공개"
          description="기본 OFF. 켜면 아래 미리보기 문구가 그대로 공개됩니다."
          onChange={(world_public) => onChange({ world_public })}
        />
        <p className="rounded-lg border border-white/10 bg-[#161922] px-3 py-2 text-xs text-zinc-300">
          공개될 텍스트:{" "}
          {form.world_public && worldPreview ? (
            <span className="font-semibold text-[#f0e7d4]">WORLD / {worldPreview}</span>
          ) : (
            <span className="text-zinc-400">표시하지 않음</span>
          )}
        </p>
      </div>

      {form.content_kind === "character" ? (
        <div className="space-y-2">
          <p className={studioType.label}>성별 공개</p>
          <p className="text-xs text-zinc-400">
            AI용 성별은 부가 설정에서 선택합니다. 현재 값:{" "}
            <span className="font-semibold text-zinc-200">
              {form.gender ? GENDER_LABELS[form.gender] : "미선택"}
            </span>
          </p>
          <ToggleSwitch
            checked={form.gender_public}
            disabled={disabled || !form.gender}
            label="AI용 성별을 프로필에 공개"
            description="기본 OFF. 비공개 성별 입력의 의미는 바뀌지 않습니다."
            onChange={(gender_public) => onChange({ gender_public })}
          />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={studioType.label}>키 · cm</label>
          <input
            className={studioInputClass}
            inputMode="numeric"
            disabled={disabled}
            placeholder="예: 183"
            value={form.height_cm}
            onChange={(event) => onChange({ height_cm: event.target.value })}
          />
          {heightError ? <p className="mt-1 text-xs text-rose-400">{heightError}</p> : null}
          <p className="mt-1 text-xs text-zinc-400">공란이면 미표시</p>
        </div>
        <div>
          <label className={studioType.label}>몸무게 · kg</label>
          <input
            className={studioInputClass}
            inputMode="numeric"
            disabled={disabled}
            placeholder="예: 71"
            value={form.weight_kg}
            onChange={(event) => onChange({ weight_kg: event.target.value })}
          />
          {weightError ? <p className="mt-1 text-xs text-rose-400">{weightError}</p> : null}
          <p className="mt-1 text-xs text-zinc-400">공란이면 미표시</p>
        </div>
      </div>

      {publicDossierHasItems(preview) ? (
        <div className="rounded-xl border border-white/10 bg-[#0e1120] p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            공개 미리보기
          </p>
          <PublicDossierBlock dossier={preview} />
        </div>
      ) : (
        <p className="text-xs text-zinc-400">공개할 인물 정보가 없으면 프로필에서 이 영역은 생략됩니다.</p>
      )}
    </div>
  );
}
