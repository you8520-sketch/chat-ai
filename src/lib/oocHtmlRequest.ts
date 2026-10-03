/** Main-model inline HTML contract. Flash visual cards own ```html``` when that policy is on. */
export const OOC_HTML_MODE_SYSTEM_DIRECTIVE = `[OOC HTML MODE — THIS TURN]
User explicitly requested inline HTML via OOC. Output allowed: inline HTML with <div> and <span> only. FORBIDDEN: <!DOCTYPE>, <html>, <head>, <body>, <script>. You may mix Korean prose with HTML. Server Flash status window is DISABLED this turn.`;

export function isOocHtmlRequest(userMessage: string): boolean {
  const oocPattern = /ooc[\s:\]\-\)]+.*(html|코드|디자인|레이아웃|ui)/i;
  return oocPattern.test(userMessage);
}

/**
 * Route gate for main-model OOC HTML.
 * Auto-continue and Flash visual-card turns stay off so Flash keeps ```html```.
 */
export function resolveMainModelOocHtmlMode(input: {
  autoContinue: boolean;
  userMessage: string;
  htmlVisualCardEnabled: boolean;
}): boolean {
  return (
    !input.autoContinue &&
    isOocHtmlRequest(input.userMessage) &&
    !input.htmlVisualCardEnabled
  );
}

/** Append the existing directive once. A second call keeps the same text. */
export function appendOocHtmlModeDirective(block: string): string {
  const base = block.trim();
  if (!base) return OOC_HTML_MODE_SYSTEM_DIRECTIVE;
  if (base.endsWith(OOC_HTML_MODE_SYSTEM_DIRECTIVE)) return base;
  return `${base}\n\n${OOC_HTML_MODE_SYSTEM_DIRECTIVE}`;
}
