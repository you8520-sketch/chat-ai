/**
 * Step 7.6b pre-prod — Step 2: schema generalization dry-run (no API).
 */

import { parseCharacterSetting } from "@/utils/characterParser";
import { collectCharacterSettingText } from "@/lib/bodyHairRules";
import {
  filterExampleDialogInSetting,
  filterTaggedExampleDialogBody,
  inferSceneRegisterContext,
  stripLeadingContextTag,
} from "@/lib/exampleDialogSceneFilter";

export type DryRunProfile = {
  id: string;
  label: string;
  registerPattern: string;
  charName: string;
  systemPrompt: string;
  world: string;
  exampleDialog: string;
  sceneCues: { label: string; userMessage: string; recentHistory: string };
};

export const DRY_RUN_PROFILES: DryRunProfile[] = [
  {
    id: "leon",
    label: "Leon — 2-register context split (다나까/해요)",
    registerPattern: "공적=다나까 · 사적/침대=해요",
    charName: "레온",
    systemPrompt: `# 말투
공적인 자리: 건조한 군대식 다나까체
유저와 둘만 있을 때: 해요체
침대: 속삭이는 해요체`,
    world: "제국 기사단",
    exampleDialog: `[공적] 유저: 적이다!
레온: …각오하십시오.
[사적] 유저: 괜찮아?
레온: …괜찮아요.
[침대] 유저: …불 끌까?
레온: …그래요.`,
    sceneCues: {
      label: "bed",
      userMessage: "…가까이 와도 돼?",
      recentHistory: "…불 끌까?\n레온: …그래요.",
    },
  },
  {
    id: "ren",
    label: "Ren (백하율) — single register (해요 only)",
    registerPattern: "평소=해요 (context split 없음)",
    charName: "백하율",
    systemPrompt: `# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말`,
    world: "현대 도시",
    exampleDialog: `[사적] 유저: 밤산책 갈래?
백하율: …필요하면요.
[사적] 유저: …괜찮아?
백하율: …그래요.`,
    sceneCues: {
      label: "daily",
      userMessage: "민수: 오늘도 커피 맛있네.",
      recentHistory: "",
    },
  },
  {
    id: "rogue_banmal",
    label: "Rogue — single register (반말 only)",
    registerPattern: "전 구간=반말",
    charName: "카인",
    systemPrompt: `# 말투
- 평소: 반말, 짧은 문장`,
    world: "암시장 도시",
    exampleDialog: `[사적] 유저: 따라와.
카인: …알았어.
[사적] 유저: 위험해.
카인: …상관없어.`,
    sceneCues: {
      label: "alley",
      userMessage: "…저쪽 봐, 경비야.",
      recentHistory: "",
    },
  },
  {
    id: "three_context_formal",
    label: "Scholar — 3-label card but 2 registers (합니다/해요, no 다나까)",
    registerPattern: "강의=합니다 · 학생=해요 · 친구=해요",
    charName: "서연",
    systemPrompt: `# 말투
강의실: 격식 있는 합니다체
학생 앞: 부드러운 해요체
친구와: 편한 해요체`,
    world: "현대 대학",
    exampleDialog: `[공적] 유저: 교수님, 발표 시작해도 될까요?
서연: …네, 시작하세요.
[사적] 유저: …오늘 수업 힘들었어?
서연: …괜찮아요.
[침대] 유저: …피곤하면 기대도 돼?
서연: …그래요.`,
    sceneCues: {
      label: "lecture",
      userMessage: "학생: 교수님, 다음 주 과제 확인 부탁드립니다.",
      recentHistory: "",
    },
  },
];

export type DryRunResult = {
  profileId: string;
  label: string;
  registerPattern: string;
  parseOk: boolean;
  parseErrors: string[];
  inferredScene: string;
  filteredExample: string;
  injectedPairCount: number;
  hadTags: boolean;
  filterSkipped: boolean;
  assemblyOk: boolean;
  assemblyErrors: string[];
};

function dryRunProfile(profile: DryRunProfile): DryRunResult {
  const parseErrors: string[] = [];
  const assemblyErrors: string[] = [];

  for (const line of profile.exampleDialog.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const { tag, rest } = stripLeadingContextTag(t);
    if (t.startsWith("[") && !tag && t.match(/^\[[^\]]+\]/)) {
      parseErrors.push(`Unrecognized tag prefix: ${t.slice(0, 24)}`);
    }
    if (tag && !rest && !/^(?:유저|user)/i.test(t)) {
      /* tag-only line ok */
    }
  }

  const inferredScene = inferSceneRegisterContext({
    userMessage: profile.sceneCues.userMessage,
    recentHistory: profile.sceneCues.recentHistory,
  });

  const { filtered, hadTags, injectedCount } = filterTaggedExampleDialogBody(
    profile.exampleDialog,
    inferredScene
  );

  const chunks = parseCharacterSetting({
    characterId: `dry-${profile.id}`,
    characterName: profile.charName,
    gender: "other",
    systemPrompt: profile.systemPrompt,
    world: profile.world,
    exampleDialog: profile.exampleDialog,
    statusWindowPrompt: "",
  });
  const combined = collectCharacterSettingText(chunks);

  const prev = process.env.EXAMPLE_DIALOG_SCENE_FILTER;
  process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";
  let assemblyOk = true;
  let filteredCombined = combined;
  try {
    filteredCombined = filterExampleDialogInSetting(combined, {
      userMessage: profile.sceneCues.userMessage,
      recentHistory: profile.sceneCues.recentHistory,
    });
    if (hadTags && filteredCombined === combined) {
      assemblyErrors.push("Expected assembly filter to rewrite [예시 대화] but setting unchanged");
      assemblyOk = false;
    }
    if (!hadTags && filteredCombined !== combined) {
      assemblyErrors.push("Untagged example should pass through unchanged");
      assemblyOk = false;
    }
  } catch (err) {
    assemblyOk = false;
    assemblyErrors.push(String(err));
  } finally {
    if (prev === undefined) delete process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    else process.env.EXAMPLE_DIALOG_SCENE_FILTER = prev;
  }

  return {
    profileId: profile.id,
    label: profile.label,
    registerPattern: profile.registerPattern,
    parseOk: parseErrors.length === 0,
    parseErrors,
    inferredScene,
    filteredExample: filtered,
    injectedPairCount: injectedCount,
    hadTags,
    filterSkipped: !hadTags,
    assemblyOk,
    assemblyErrors,
  };
}

export function runSchemaDryRun(): DryRunResult[] {
  return DRY_RUN_PROFILES.map(dryRunProfile);
}
