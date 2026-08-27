/**
 * Synthetic GPT Image cast smoke (2 calls).
 * Writes docs/audits/chat-image-multicast-674/smoke/*
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildLdSceneGenerationPlan } from "@/lib/chatLdIllustrationGeneration";
import { groundCastIntent, type ChatImageCastGroundedManifest } from "@/lib/chatImageCastManifest";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "@/lib/chatImageScenePlan";
import { callOpenAiImageEdit } from "@/lib/openAiImageEdit";

const OUT_DIR = "docs/audits/chat-image-multicast-674/smoke";

async function makeBustRef(opts: {
  path: string;
  hair: string;
  eyes: string;
  outfit: string;
  skin: string;
  label: string;
}): Promise<string> {
  const svg = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#111827"/>
  <ellipse cx="256" cy="290" rx="150" ry="180" fill="${opts.skin}"/>
  <path d="M106 250 C130 80, 382 80, 406 250 C390 120, 122 120, 106 250 Z" fill="${opts.hair}"/>
  <circle cx="206" cy="260" r="24" fill="#fff"/>
  <circle cx="306" cy="260" r="24" fill="#fff"/>
  <circle cx="206" cy="260" r="12" fill="${opts.eyes}"/>
  <circle cx="306" cy="260" r="12" fill="${opts.eyes}"/>
  <rect x="156" y="360" width="200" height="120" rx="24" fill="${opts.outfit}"/>
  <text x="256" y="480" text-anchor="middle" fill="#ffffff" font-size="20">${opts.label}</text>
</svg>`;
  const webp = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
  const dataUrl = `data:image/webp;base64,${webp.toString("base64")}`;
  writeFileSync(join(OUT_DIR, `${opts.path}.webp`), webp);
  return dataUrl;
}

async function makeComicTemplateRef(): Promise<string> {
  const svg = `
<svg width="512" height="704" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="704" fill="#ffffff"/>
  <rect x="24" y="24" width="464" height="200" fill="#f3f4f6" stroke="#111827"/>
  <rect x="24" y="248" width="464" height="200" fill="#f3f4f6" stroke="#111827"/>
  <rect x="24" y="472" width="464" height="200" fill="#f3f4f6" stroke="#111827"/>
  <text x="256" y="360" text-anchor="middle" fill="#6b7280" font-size="24">comic template</text>
</svg>`;
  const webp = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
  writeFileSync(join(OUT_DIR, "ref-comic-template.webp"), webp);
  return `data:image/webp;base64,${webp.toString("base64")}`;
}

function mustGround(
  manifest: Parameters<typeof groundCastIntent>[0],
  refs: { persona: string; main: string; support: string }
): ChatImageCastGroundedManifest {
  const ctx = {
    persona: {
      name: "UserPersona",
      gender: "female" as const,
      referenceImageUrl: refs.persona,
      savedAppearance: "short black bob, blue eyes, white-blue outfit",
      appearanceMode: "image_plus_saved" as const,
    },
    mainCharacter: {
      name: "CharacterA",
      gender: "male" as const,
      referenceImageUrl: refs.main,
      savedAppearance: "short white hair, red eyes, black-red outfit",
      appearanceMode: "image_plus_saved" as const,
    },
    selectableAssets: [{ url: refs.support, tag: "SupportC" }],
  };
  const result = groundCastIntent(manifest, ctx);
  if (!result.ok) throw new Error(result.reason);
  return result.manifest;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const personaRef = await makeBustRef({
    path: "ref-persona",
    hair: "#111111",
    eyes: "#2563eb",
    outfit: "#dbeafe",
    skin: "#f5d0b5",
    label: "persona",
  });
  const mainRef = await makeBustRef({
    path: "ref-main",
    hair: "#f8fafc",
    eyes: "#dc2626",
    outfit: "#111827",
    skin: "#e8c4a8",
    label: "main",
  });
  const supportRef = await makeBustRef({
    path: "ref-support",
    hair: "#15803d",
    eyes: "#d97706",
    outfit: "#fef08a",
    skin: "#f0c9a0",
    label: "support",
  });
  const templateRef = await makeComicTemplateRef();
  const refs = { persona: personaRef, main: mainRef, support: supportRef };

  writeFileSync(
    join(OUT_DIR, "refs.json"),
    JSON.stringify(
      {
        persona: "ref-persona.webp",
        main: "ref-main.webp",
        support: "ref-support.webp",
      },
      null,
      2
    )
  );

  const source = buildSceneSourceMessages([
    { id: 1, role: "user", content: '*손을 잡는다*\n"같이 가자."' },
    { id: 2, role: "assistant", content: "SupportC가 옆에서 미소 지었다." },
  ]);
  const scenePlan = buildDeterministicScenePlan(source, 3);
  const castManifest = mustGround(
    {
      compositionGoal: "trio_group",
      subjects: [
        {
          key: "persona",
          role: "persona",
          name: "UserPersona",
          included: true,
          importance: "primary",
          visibility: "required_visible",
        },
        {
          key: "main_character",
          role: "main_character",
          name: "CharacterA",
          included: true,
          importance: "primary",
          visibility: "required_visible",
        },
        {
          key: "supporting:C",
          role: "supporting_character",
          name: "SupportC",
          included: true,
          importance: "primary",
          visibility: "required_visible",
          requestedReferenceAssetUrl: refs.support,
        },
      ],
    },
    refs
  );

  const ldPlan = buildLdSceneGenerationPlan({
    characterName: "CharacterA",
    characterGender: "male",
    personaName: "UserPersona",
    personaGender: "female",
    characterImageUrl: refs.main,
    characterSavedAppearance: "short white hair, red eyes, black-red outfit",
    characterAppearanceMode: "image_plus_saved",
    personaImageUrl: refs.persona,
    personaSavedAppearance: "short black bob, blue eyes, white-blue outfit",
    personaAppearanceMode: "image_plus_saved",
    approvedScenePlan: scenePlan,
    castManifest,
  });

  const comicPlan = buildChatComicGenerationPlan({
    characterName: "CharacterA",
    characterGender: "male",
    personaName: "UserPersona",
    personaGender: "female",
    characterImageUrl: refs.main,
    characterSavedAppearance: "short white hair, red eyes, black-red outfit",
    characterAppearanceMode: "image_plus_saved",
    personaImageUrl: refs.persona,
    personaSavedAppearance: "short black bob, blue eyes, white-blue outfit",
    personaAppearanceMode: "image_plus_saved",
    plan: scenePlan,
    castManifest,
  });

  const ldRefs = ldPlan.referenceUrls;
  const comicRefs = [templateRef, personaRef, mainRef, supportRef];

  writeFileSync(join(OUT_DIR, "G1-prompt.txt"), ldPlan.prompt);
  writeFileSync(
    join(OUT_DIR, "G1-reference-order.json"),
    JSON.stringify(ldPlan.referenceUrls, null, 2)
  );
  writeFileSync(join(OUT_DIR, "G2-prompt.txt"), comicPlan.prompt);
  writeFileSync(
    join(OUT_DIR, "G2-reference-order.json"),
    JSON.stringify(comicRefs, null, 2)
  );

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    writeFileSync(
      join(OUT_DIR, "GPT-IMAGE-SMOKE-BLOCKED.json"),
      JSON.stringify(
        {
          reason: "OPENAI_API_KEY is not configured in this environment",
          gptImageRealCalls: 0,
          promptsGenerated: true,
          refsGenerated: true,
        },
        null,
        2
      )
    );
    console.error(
      "OPENAI_API_KEY missing — saved prompts/refs only under docs/audits/chat-image-multicast-674/smoke/"
    );
    process.exit(1);
  }

  const g1 = await callOpenAiImageEdit({
    model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
    prompt: ldPlan.prompt,
    references: ldRefs,
    size: "1024x1536",
    quality: "medium",
    outputCompression: 82,
  });
  writeFileSync(join(OUT_DIR, "G1-output.webp"), g1.buffer);
  writeFileSync(
    join(OUT_DIR, "G1-metadata.json"),
    JSON.stringify({ costUsd: g1.costUsd, referenceCount: ldRefs.length }, null, 2)
  );

  const g2 = await callOpenAiImageEdit({
    model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
    prompt: comicPlan.prompt,
    references: comicRefs,
    size: "1024x1536",
    quality: "medium",
    outputCompression: 82,
  });
  writeFileSync(join(OUT_DIR, "G2-output.webp"), g2.buffer);
  writeFileSync(
    join(OUT_DIR, "G2-metadata.json"),
    JSON.stringify({ costUsd: g2.costUsd, referenceCount: comicRefs.length }, null, 2)
  );

  console.log(`Wrote ${OUT_DIR}/G1-output.webp and G2-output.webp`);
}

void main();
