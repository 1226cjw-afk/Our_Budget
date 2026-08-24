// 디자인 테마의 '구조'를 검사한다 — 시간이 아니라 규칙을.
//
//   node C:/Users/1226c/Projects/Our_Budget/scripts/check_theme.js
//
// 왜 필요한가: 디자인 규칙은 조용히 되돌아온다. backdrop-filter 한 줄,
// linear-gradient 한 줄이 다시 들어와도 앱은 멀쩡히 돌기 때문에 아무도 모른다.
// 이 검사기는 '앱이 도는가'가 아니라 '2026-08-24 디자인 계약을 지키는가'를 본다.
// 계약 원문: docs/superpowers/specs/2026-08-24-light-redesign-design.md
//
// ⚠️ 이 스크립트를 고쳤으면 반드시 '일부러 깨서' FAIL 이 나는지 확인할 것.
//    check_authgate.js 가 문자열 앵커라 그 문자열이 주석에만 남아도 우연히
//    통과하고 있던 전례가 있다(2026-08-15).

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "public", "index.html");
const html = fs.readFileSync(SRC, "utf8");

const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];
if (!style) {
  console.error("FATAL: <style> 블록을 못 찾았다");
  process.exit(1);
}
// 앱 본체 JS = 마지막 <script> 블록
const js = (() => {
  const all = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return all.length ? all[all.length - 1][1] : "";
})();

const fails = [];
const oks = [];
const check = (name, cond, detail) => {
  if (cond) oks.push(name);
  else fails.push(name + "\n          " + detail);
};

/* ── 중괄호를 세어 블록 하나를 통째로 떼어낸다 (정규식으로는 중첩을 못 센다) ── */
function blockAt(src, startIdx) {
  const open = src.indexOf("{", startIdx);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "");

/* ══════ 1. :root 에 라이트 토큰이 정의됐는가 ══════ */
const LIGHT = {
  "--bg": "#FFFFFF", "--fill": "#F4F4F2", "--fill-2": "#EAEAE7",
  "--ink": "#14161A", "--ink-2": "#5A6068", "--ink-3": "#8A9099",
  "--line": "#E4E5E7", "--line-2": "#CFD2D6",
  "--exp": "#C0392B", "--inc": "#0F6B4F", "--warn": "#9A5B14", "--on-ink": "#FFFFFF",
};
const CHART_LIGHT = {
  "--s1": "#2a78d6", "--s2": "#eb6834", "--s3": "#1baf7a",
  "--s4": "#eda100", "--s5": "#e87ba4", "--s6": "#4a3aa7",
};
const rootIdx = style.search(/(^|\n)\s*:root\s*\{/);
const rootBlock = rootIdx < 0 ? "" : stripComments(blockAt(style, rootIdx));
const hasVar = (block, k, v) =>
  new RegExp("\\" + k + "\\s*:\\s*" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[;}]", "i").test(block);

const missLight = Object.entries(LIGHT).filter(([k, v]) => !hasVar(rootBlock, k, v)).map(([k]) => k);
check("라이트 토큰 12개가 :root 에 있다", missLight.length === 0,
  "누락/불일치: " + (missLight.join(", ") || "(:root 블록을 못 찾음)"));

const missCl = Object.entries(CHART_LIGHT).filter(([k, v]) => !hasVar(rootBlock, k, v)).map(([k]) => k);
check("차트 슬롯 6개(라이트)가 :root 에 있다", missCl.length === 0, "누락/불일치: " + missCl.join(", "));

/* ══════ 2. 다크는 prefers-color-scheme 안에만 ══════ */
const DARK = {
  "--bg": "#101215", "--fill": "#1E2126", "--fill-2": "#262A30",
  "--ink": "#E9EBEE", "--ink-2": "#A2A8B0", "--ink-3": "#767D86",
  "--line": "#272B31", "--line-2": "#373C44",
  "--exp": "#FF7A6B", "--inc": "#4FCB96", "--warn": "#D9A054", "--on-ink": "#101215",
};
const CHART_DARK = {
  "--s1": "#3987e5", "--s2": "#d95926", "--s3": "#199e70",
  "--s4": "#c98500", "--s5": "#d55181", "--s6": "#9085e9",
};
const darkIdx = style.search(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/);
const darkBlock = darkIdx < 0 ? "" : stripComments(blockAt(style, darkIdx));

const missDark = Object.entries(DARK).filter(([k, v]) => !hasVar(darkBlock, k, v)).map(([k]) => k);
check("다크 토큰 12개가 미디어쿼리 안에 있다", missDark.length === 0,
  "누락/불일치: " + (missDark.join(", ") || "(다크 미디어쿼리를 못 찾음)"));

const missCd = Object.entries(CHART_DARK).filter(([k, v]) => !hasVar(darkBlock, k, v)).map(([k]) => k);
check("차트 슬롯 6개(다크)가 미디어쿼리 안에 있다", missCd.length === 0, "누락/불일치: " + missCd.join(", "));

// 요청이 "OS 가 다크일 때만" 이었다 — 수동 토글을 만들면 그 계약이 깨진다
check("수동 테마 토글이 없다",
  !/\[data-theme|data-theme\s*=|ourbudget\.theme|["']theme["']\s*\)/.test(html),
  "data-theme 속성 또는 theme 저장 흔적이 있다");

/* ══════ 3. 금지 패턴 ══════ */
const styleNC = stripComments(style);
const BANNED = [
  ["backdrop-filter (유리 블러)", /backdrop-filter\s*:/g],
  ["background-clip:text (그라디언트 글자)", /background-clip\s*:\s*text/g],
  ["font-weight:900", /font-weight\s*:\s*900/g],
  ["text-transform:uppercase (한글에 무의미)", /text-transform\s*:\s*uppercase/g],
  ["linear-gradient", /linear-gradient\s*\(/g],
  ["radial-gradient (앰비언트 광원)", /radial-gradient\s*\(/g],
];
for (const [name, re] of BANNED) {
  const n = (styleNC.match(re) || []).length;
  check("금지 패턴 없음: " + name, n === 0, n + "건 남아 있다");
}

/* ══════ 4. 토큰 밖 생 hex 금지 ══════ */
// :root 와 다크 블록을 들어낸 나머지에 hex 가 있으면 토큰 체계를 우회한 것이다.
let rest = styleNC;
if (rootIdx >= 0) rest = rest.replace(stripComments(blockAt(style, rootIdx)), "");
if (darkIdx >= 0) rest = rest.replace(stripComments(blockAt(style, darkIdx)), "");
const strayHex = [...new Set(rest.match(/#[0-9a-fA-F]{3,8}\b/g) || [])];
check("토큰 밖에 생 hex 가 없다", strayHex.length === 0,
  "셀렉터 안에서 직접 쓴 색: " + strayHex.join(" "));

/* ══════ 4b. 옛 토큰이 인라인 스타일에 남아 있는가 ══════ */
// ⚠️ 이 검사가 없었을 때 JS 템플릿의 style="color:var(--t3)" 57건이 그대로 살아남았다.
// <style> 만 보면 안 된다 — 이 앱은 인라인 스타일을 많이 쓴다.
const LEGACY = ["--t1","--t2","--t3","--bg2","--bg3","--card","--bd","--bd2",
                "--ac","--ac2","--acg","--acg2","--g","--gb","--r","--rb",
                "--amber","--amberg","--shadow","--glow"];
const legacyFound = LEGACY.filter(t =>
  new RegExp("var\\(\\s*" + t + "\\s*\\)").test(html));
check("옛 토큰 참조가 없다 (인라인 포함)", legacyFound.length === 0,
  "아직 쓰이는 옛 토큰: " + legacyFound.join(" ") + "  — 정의가 없어 색이 상속으로 떨어진다");

/* ══════ 4c. 금지 패턴이 인라인 스타일에도 없는가 ══════ */
// <style> 밖(정적 마크업 + JS 템플릿)도 같은 규칙을 받는다.
const outside = html.slice(0, html.indexOf("<style>")) + html.slice(html.indexOf("</style>"));
for (const [name, re] of [
  ["font-weight:900", /font-weight\s*:\s*900/g],
  ["text-transform:uppercase", /text-transform\s*:\s*uppercase/g],
  ["linear-gradient", /linear-gradient\s*\(/g],
]) {
  const n = (outside.match(re) || []).length;
  check("인라인에도 금지: " + name, n === 0, n + "건 남아 있다");
}
// 골드는 브랜드에서 빠졌다 — 어디에도 남으면 안 된다
const gold = (html.match(/rgba\(\s*201\s*,\s*147\s*,\s*58/g) || []).length
           + (html.match(/#C9933A/gi) || []).length;
check("골드 잔재가 없다", gold === 0, gold + "건 (rgba(201,147,58) 또는 #C9933A)");

/* ══════ 5. 고아 class — 마크업이 참조하는데 CSS 에 없는 것 ══════ */
// 정적 <body> 와 JS 템플릿 문자열의 class="..." 를 모두 모은다.
// ${...} 보간이 든 값은 이름을 확정할 수 없으므로 건너뛴다.
const used = new Set();
for (const m of html.matchAll(/class="([^"]*)"/g)) {
  const v = m[1];
  if (v.includes("${") || v.includes("`")) continue;
  v.split(/\s+/).filter(Boolean).forEach(c => used.add(c));
}
const defined = new Set((styleNC.match(/\.[-_a-zA-Z][-_a-zA-Z0-9]*/g) || []).map(s => s.slice(1)));
const orphans = [...used].filter(c => !defined.has(c)).sort();
check("고아 class 가 없다", orphans.length === 0,
  orphans.length + "개: " + orphans.join(" "));

/* ══════ 6. 차트 규칙 (dataviz 계약) ══════ */
// ⚠️ 주석을 먼저 걷어낸다. '되돌리지 말 것' 류의 경고 주석에 옛 식별자를 적어두면
//    검사기가 그걸 코드로 오인한다(실제로 CAT_PALETTE 주석에 걸려 오탐이 났다).
const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

check("카테고리 색을 순환시키지 않는다",
  !/CAT_PALETTE/.test(jsCode) && /_catSlots/.test(jsCode),
  "팔레트 인덱스 순환이 살아 있다 — 안전한 색은 6개뿐이라 같은 차트에 같은 색이 두 번 나온다");
check("차트 계열 상한이 6(+기타)다", /\bTOPN\s*=\s*6\b/.test(jsCode),
  "TOPN 이 6 이 아니다 — 검증된 슬롯은 6개뿐이라 넘으면 순환이 생긴다");
check("도넛에도 상한이 걸렸다", /donut\s*:\s*donutArr\b/.test(jsCode),
  "도넛이 curCatArr 전량을 넘긴다 — 슬라이스가 카테고리 수만큼 생긴다");
// 하드코딩 hex 가 한 개도 없는 것이 'CSS 변수를 읽는다'의 진짜 증거다.
// (cssVar("--s1") 같은 리터럴 앵커는 cssVar("--s"+n) 형태를 못 잡아 오탐이 났다.)
const jsHex = [...new Set(jsCode.match(/#[0-9a-fA-F]{6}\b/g) || [])];
check("차트·인라인에 하드코딩 hex 가 없다", jsHex.length === 0 && /const\s+cssVar\s*=/.test(jsCode),
  jsHex.length ? "남은 색: " + jsHex.join(" ") : "cssVar 헬퍼가 없다");
check("이중 축이 없다", !/\byInc\s*:/.test(jsCode),
  "보조축 yInc 가 남아 있다 — 두 축은 없는 상관관계를 만든다");
check("OS 테마 전환에 반응한다",
  /matchMedia\s*\(\s*["']\(\s*prefers-color-scheme\s*:\s*dark\s*\)["']\s*\)[\s\S]{0,120}addEventListener/.test(jsCode),
  "테마가 바뀌어도 차트가 옛 색으로 남는다");

/* ══════ 결과 ══════ */
console.log("");
oks.forEach(s => console.log("  PASS  " + s));
fails.forEach(s => console.log("  FAIL  " + s));
console.log("");
if (fails.length) {
  console.log("  " + fails.length + " FAILED  /  " + oks.length + " passed");
  process.exit(1);
}
console.log("  ALL PASS  (" + oks.length + ")");
