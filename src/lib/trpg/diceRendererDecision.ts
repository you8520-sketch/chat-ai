export type TrpgDiceRenderer = "dice-box-threejs" | "static";

export type TrpgDiceFallbackReason = "none" | "no-webgl" | "reduced-motion";

export type DiceRendererDecision = {
  webgl: boolean;
  reducedMotion: boolean;
  renderer: TrpgDiceRenderer;
  fallbackReason: TrpgDiceFallbackReason;
};

export function decideTrpgDiceRenderer(input: {
  webgl: boolean;
  reducedMotion: boolean;
}): DiceRendererDecision {
  const webgl = Boolean(input.webgl);
  const reducedMotion = Boolean(input.reducedMotion);
  if (!webgl) {
    return {
      webgl: false,
      reducedMotion,
      renderer: "static",
      fallbackReason: "no-webgl",
    };
  }
  if (reducedMotion) {
    return {
      webgl: true,
      reducedMotion: true,
      renderer: "static",
      fallbackReason: "reduced-motion",
    };
  }
  return {
    webgl: true,
    reducedMotion: false,
    renderer: "dice-box-threejs",
    fallbackReason: "none",
  };
}

export function trpgDiceRendererDecisionAttrs(decision: DiceRendererDecision): {
  "data-trpg-dice-webgl": "true" | "false";
  "data-trpg-dice-reduced-motion": "true" | "false";
  "data-trpg-dice-fallback-reason": TrpgDiceFallbackReason;
} {
  return {
    "data-trpg-dice-webgl": decision.webgl ? "true" : "false",
    "data-trpg-dice-reduced-motion": decision.reducedMotion ? "true" : "false",
    "data-trpg-dice-fallback-reason": decision.fallbackReason,
  };
}
