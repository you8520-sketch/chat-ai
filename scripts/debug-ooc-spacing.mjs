import {
  ensureOocHtmlSectionSpacing,
  isOocCreativeHtmlRichEnough,
  oocFlashHtmlMustBeRejected,
  visiblePlainFromHtmlInner,
} from "../src/lib/htmlVisualCardPolicy.ts";

const ooc =
  "OOC: 대화 잠시 중지. 항목은[외형 · 키워드 · 모에화 · 기타 상징 · 대외적 이미지]로 작성";
const pad = (s) => s.repeat(12);
const crammed = `<div style="padding:12px">외형: ${pad("은발 롱헤어 ")}키워드: ${pad("츤데레 ")}모에화: ${pad("고양이 ")}기타 상징: ${pad("겨울 ")}대외적 이미지: ${pad("빙공주 ")}</div>`;
const spaced = ensureOocHtmlSectionSpacing(crammed, ooc);
console.log("spaced len", spaced.length);
console.log("rich", isOocCreativeHtmlRichEnough(spaced, ooc));
console.log("reject", oocFlashHtmlMustBeRejected(spaced));
console.log("plain len", visiblePlainFromHtmlInner(spaced).length);
console.log("has margin", /margin-bottom:14px/.test(spaced));
console.log("has margin12", /margin-bottom:12px/.test(spaced));
console.log("plain preview", visiblePlainFromHtmlInner(spaced).slice(0, 200));
console.log("spaced preview", spaced.slice(0, 400));
