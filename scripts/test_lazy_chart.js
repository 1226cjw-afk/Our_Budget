// chart.js 지연 로드 단위테스트 (브라우저·프레임워크 없이).
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\test_lazy_chart.js
//
// 왜 필요한가: chart.js를 <head>의 defer에서 뺀 대신 ensureChart()가 탭 진입 때 받는다.
// 이 배선이 조용히 깨지면 (a) 차트가 영영 안 그려지거나 (b) 이미 사라진 캔버스에 그려서
// 새 화면의 차트를 destroyCharts()가 지운다 — 둘 다 콘솔 오류 없이 "차트만 없는" 화면이 된다.
// 그래서 화면이 아니라 '순서·횟수'를 검사한다.
const fs = require("fs");
const path = require("path");

// 인자로 다른 파일을 줄 수 있다 — 일부러 깨뜨린 사본에 대고 FAIL이 나는지 확인하는 용도
const SRC = process.argv[2] || path.join(__dirname, "..", "public", "index.html");
const html = fs.readFileSync(SRC, "utf8");
// 손으로 복사하지 않고 원본에서 뽑는다 — 복사본은 원본이 바뀌어도 옛 코드를 검증한다
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

let fails = 0;
const ok = (name, cond, note) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && note ? "  — " + note : ""}`);
};

// ── 최소 stub: 스크립트 최상단 코드가 죽지 않을 만큼만 ──
function makeEnv() {
  const added = [];                       // document.head에 붙은 <script> 태그들
  const el = () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} },
                      addEventListener(){}, appendChild(){}, setAttribute(){},
                      innerHTML: "", textContent: "", value: "" });
  const doc = {
    createElement: () => { const s = el(); added.push(s); return s; },
    head: { appendChild(){} },
    body: el(),
    documentElement: el(),
    // null이면 최상단의 $("fAmount").addEventListener(...) 배선에서 죽는다 → 엘리먼트 stub을 준다.
    // 차트 그리기 경로는 이 테스트에서 호출하지 않으므로 캔버스 유무는 문제되지 않는다
    getElementById: () => el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(){}, removeEventListener(){},
  };
  const win = {
    Chart: undefined,
    addEventListener(){}, removeEventListener(){},
    matchMedia: () => ({ matches: false, addEventListener(){} }),
    requestIdleCallback: null,
    location: { reload(){}, href: "" },
    IntersectionObserver: function(){ this.observe=()=>{}; this.disconnect=()=>{}; },
  };
  const env = {
    document: doc, window: win, added,
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }),
                                               onAuthStateChange(){} } }) },
    Chart: undefined,
    setTimeout, clearTimeout, console, Intl, Date, Math, JSON,
    navigator: { userAgent: "node" }, fetch: async () => ({ ok: true, json: async () => ({}) }),
    IntersectionObserver: win.IntersectionObserver,
  };
  return env;
}

// eval 훅: return {…} 로는 함수만 꺼내져 내부 스코프의 전역 대입을 못 한다 (CLAUDE.md 참조)
function load() {
  const env = makeEnv();
  const names = Object.keys(env);
  const fn = new Function(...names, code + "\n;return (expr)=>eval(expr);");
  const ev = fn(...names.map(n => env[n]));
  return { ev, env };
}

// ── 1. 소스 구조: chart.js가 <head>에서 빠졌는가 ──
ok("head에 chart.js <script>가 없다",
   !/<script[^>]*src=["'][^"']*npm\/chart\.js/.test(html),
   "defer chart.js가 되살아났다 — DOMContentLoaded가 다시 72KB를 기다린다");
ok("supabase-js는 여전히 defer로 <head>에 있다",
   /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2">/.test(html));
ok("DB에 preconnect가 걸려 있다",
   /rel="preconnect"[^>]*supabase\.co/.test(html),
   "첫 쿼리가 DNS+TCP+TLS(~290ms)를 그 자리에서 치른다");
{
  // 네트워크 태그가 26KB짜리 apple-touch-icon보다 앞에 있어야 preload 스캐너가 일찍 발견한다
  // 주석에도 'apple-touch-icon'이 나오므로 태그 자체를 앵커로 쓴다 (문자열 앵커의 우연한 통과 방지)
  const icon = html.indexOf('rel="apple-touch-icon"');
  const pre  = html.indexOf('rel="preconnect"');
  const sb   = html.indexOf("npm/@supabase/supabase-js@2");
  const font = html.indexOf("pretendardvariable-dynamic-subset");
  ok("preconnect·폰트·supabase-js가 아이콘 data URI보다 앞",
     pre > 0 && pre < icon && sb < icon && font < icon,
     `icon@${icon} / preconnect@${pre} / supabase-js@${sb} / font@${font}`);
}
{
  // 폰트 CSS가 렌더 블로킹으로 되돌아갔는가.
  // chart.js와 같은 모양의 문제였다 — 화면 겉모습에만 쓰는 리소스가 첫 픽셀 앞에 줄을 선다.
  // 2026-08-30 교대 A/B(N=6, 4G+CPU4배): 비블로킹으로 FCP -444ms · DCL -268ms.
  // @font-face 92개가 전부 font-display:swap 이라 교체 깜빡임은 어차피 이미 일어난다(시각적 손해 없음).
  const tag = (html.match(/<link[^>]*pretendardvariable-dynamic-subset[^>]*>/g) || [])
    .find(t => !/^\s*<noscript/.test(t) && !html.includes("<noscript>" + t));
  ok("폰트 CSS가 렌더 블로킹이 아니다",
     !!tag && /media=["']print["']/.test(tag) && /onload=["'][^"']*media\s*=\s*['"]all['"]/.test(tag),
     `rel="stylesheet" 단독으로 되돌아갔다 — 첫 픽셀이 jsdelivr 왕복 뒤로 밀린다\n     태그: ${tag || "(못 찾음)"}`);
  ok("스크립트 꺼진 브라우저용 <noscript> 폴백이 있다",
     /<noscript>\s*<link[^>]*pretendardvariable-dynamic-subset[^>]*rel="stylesheet"[^>]*>\s*<\/noscript>/.test(html),
     "onload가 안 도는 환경에서 폰트가 영영 안 걸린다");
}

// ── 2. ensureChart(): 중복 삽입하지 않는가 ──
{
  const { ev, env } = load();
  ev("ensureChart()"); ev("ensureChart()"); ev("ensureChart()");
  ok("ensureChart를 3번 불러도 <script>는 1개", env.added.length === 1,
     `${env.added.length}개 삽입됨 — 같은 라이브러리를 여러 번 받는다`);
  ok("삽입된 src가 chart.js", (env.added[0] || {}).src === "https://cdn.jsdelivr.net/npm/chart.js");
}

// ── 3. 이미 로드돼 있으면 네트워크를 타지 않는다 ──
{
  const { ev, env } = load();
  ev("window.Chart = function(){}");
  let drawn = 0;
  ev("window.__t = " + "()=>{}");
  env.window.__draw = () => drawn++;
  ev("drawWhenChartReady(window.__draw)");
  ok("Chart가 이미 있으면 즉시 그린다", drawn === 1, `drawn=${drawn}`);
  ok("Chart가 이미 있으면 <script>를 안 붙인다", env.added.length === 0);
}

// ── 4. 기다리는 사이 화면이 바뀌면 그리지 않는다 ──
(async () => {
  {
    const { ev, env } = load();
    let drawn = 0;
    env.window.__draw = () => drawn++;
    ev("drawWhenChartReady(window.__draw)");
    ok("아직 도착 전이면 안 그린다", drawn === 0);

    ev("_renderSeq++");                       // 사용자가 탭·필터를 바꾼 상황
    env.added[0].onload();                    // 그 뒤 chart.js 도착
    await new Promise(r => setTimeout(r, 0));
    ok("화면이 바뀌었으면 도착해도 안 그린다", drawn === 0,
       `drawn=${drawn} — 없어진 캔버스에 그리거나 새 차트를 destroy한다`);
  }

  // ── 5. 같은 화면이면 도착했을 때 그린다 ──
  {
    const { ev, env } = load();
    let drawn = 0;
    env.window.__draw = () => drawn++;
    ev("drawWhenChartReady(window.__draw)");
    env.added[0].onload();
    await new Promise(r => setTimeout(r, 0));
    ok("같은 화면이면 도착 후 그린다", drawn === 1, `drawn=${drawn}`);
  }

  // ── 6. CDN 실패: 앱은 살고, 다음에 다시 시도한다 ──
  {
    const { ev, env } = load();
    let drawn = 0;
    env.window.__draw = () => drawn++;
    ev("drawWhenChartReady(window.__draw)");
    env.added[0].onerror();
    await new Promise(r => setTimeout(r, 0));
    ok("CDN 실패해도 예외 없이 넘어간다(차트만 생략)", drawn === 0);
    ev("ensureChart()");
    ok("실패 뒤엔 재시도한다", env.added.length === 2,
       `${env.added.length}개 — 한 번 실패하면 영영 차트가 안 나온다`);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
