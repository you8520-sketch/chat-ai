export function isOocHtmlRequest(userMessage: string): boolean {
  const oocPattern = /ooc[\s:\]\-\)]+.*(html|코드|디자인|레이아웃|ui)/i;
  return oocPattern.test(userMessage);
}
