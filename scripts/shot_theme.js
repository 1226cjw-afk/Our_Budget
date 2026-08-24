// 라이트/다크 × 6탭을 실제로 렌더해 캡처하고, 같은 세션에서 대비를 실측한다.
//
//   node C:/Users/1226c/Projects/Our_Budget/scripts/shot_theme.js [--out <폴더>] [--only <탭>]
//
// check_theme.js 는 '규칙'을 보고, 이 스크립트는 '실제로 어떻게 보이는가'를 본다.
// 검사기는 레이아웃 깨짐·글자 겹침·가로 넘침을 못 잡는다 — 그래서 PNG 를 남긴다.
//
// ⚠️ 실서비스 DB 를 건드리지 않는다. supabase-js CDN 을 아예 차단하고 가짜 클라이언트를
//    <head> 인라인 스크립트로 동기 정의한다. (CLAUDE.md 의 DOMContentLoaded 주입 방식보다
//    확실하다 — CDN 이 defer 라 인라인보다 나중에 실행돼 window.supabase 를 덮어쓰는 문제가
//    아예 생기지 않는다.)
// ⚠️ 이 모드에서 저장 함수를 dispatchEvent 로 발화시키지 말 것 — 테스트 DB 가 없다.

const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "public", "index.html");

const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const OUTDIR = argOf("--out") || path.join(os.tmpdir(), "ourbudget-shots");
const ONLY = argOf("--only");

const PORT = 9414;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = path.join(os.tmpdir(), "ourbudget-shot-theme");

// "탭" 또는 "탭:세그먼트". 연말정산은 분석 탭 안의 세그먼트라 따로 찍지 않으면
// tyColor 8곳이 아예 렌더되지 않는다.
const SHOTS = [
  ["list", "내역"], ["cat", "분류"], ["limit", "한도"],
  ["analysis", "지출분석"], ["analysis:tax", "연말정산"],
  ["acct", "계좌"], ["master", "설정"],
  ["list:sheet", "입력 시트"], ["list:picker", "피커"],
];

const { MOCK } = require(require("path").join(__dirname, "lib_mock.js"));

/* ══════ CDP ══════ */
const get = p => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
    const b = []; r.on("data", d => b.push(d));
    r.on("end", () => res(Buffer.concat(b).toString("utf8")));
  }).on("error", rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ══════ WCAG 대비 ══════ */
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = hex => {
  const n = parseInt(hex.replace("#", ""), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* 스펙 §3 의 기대값 — 여기서 벗어나면 토큰이 바뀐 것이다 */
const EXPECT = {
  light: { ink: 18.11, "ink-2": 6.35, "ink-3": 3.22, exp: 5.44, inc: 6.49, warn: 5.41 },
  dark:  { ink: 15.71, "ink-2": 7.83, "ink-3": 4.51, exp: 7.37, inc: 9.22, warn: 8.14 },
};

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });

  // mock 을 <head> 맨 앞(문자셋 다음)에 동기 삽입한 사본
  let html = fs.readFileSync(SRC, "utf8");
  html = html.replace("</head>", "<script>" + MOCK + "</script>\n</head>");
  const tmp = path.join(os.tmpdir(), "ourbudget-mock-render.html");
  fs.writeFileSync(tmp, html, "utf8");
  const TARGET = "file:///" + tmp.replace(/\\/g, "/");

  const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check",
    "--disable-gpu", "about:blank"], { stdio: "ignore" });

  let up = false;
  for (let i = 0; i < 60; i++) { try { await get("/json/version"); up = true; break; } catch { await sleep(500); } }
  if (!up) { console.error("devtools endpoint 가 안 떴다"); edge.kill(); process.exit(1); }

  const page = JSON.parse(await get("/json/list")).find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });

  await send("Page.enable", {});
  await send("Runtime.enable", {});
  await send("Network.enable", {});
  // ⚠️ 진짜 supabase-js 만 차단한다. jsdelivr 전체를 막으면 Pretendard 와 chart.js 까지 날아간다.
  await send("Network.setBlockedURLs", { urls: ["*@supabase/supabase-js*"] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const problems = [];
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });

    for (const [tabKey, tabName] of SHOTS) {
      if (ONLY && ONLY !== tabKey) continue;
      await send("Page.navigate", { url: TARGET });
      await sleep(2400);
      await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
      // 기기사용자 모달이 떠 있으면 닫고(이미 localStorage 로 정했지만 방어), 탭 전환
      const [tab, seg] = tabKey.split(":");
      // 오버레이(입력 시트·피커)는 탭이 아니라 상태다. ⚠️ 저장 함수는 절대 호출하지 않는다.
      const open = seg === "sheet" ? "openSheet();"
                 : seg === "picker" ? "openSheet(); openPicker('fCategory','카테고리');"
                 : seg ? `setAnView(${JSON.stringify(seg)});` : "";
      await send("Runtime.evaluate", {
        expression: `(function(){try{closeDeviceUser&&closeDeviceUser();}catch(e){}
          goTab(${JSON.stringify(tab)}); ${open}})()`,
      });
      await sleep(tab === "analysis" ? 2600 : 700);   // 분석 탭은 chart.js 지연 로드를 기다린다

      const probe = await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(function(){
          var cs=getComputedStyle(document.documentElement), t=function(n){return cs.getPropertyValue(n).trim();};
          var de=document.documentElement;
          var wide=[].slice.call(document.querySelectorAll('*')).filter(function(el){
            return el.getBoundingClientRect().right > de.clientWidth + 1;
          }).slice(0,5).map(function(el){return el.className||el.tagName;});
          return JSON.stringify({
            bg:t('--bg'), ink:t('--ink'), ink2:t('--ink-2'), ink3:t('--ink-3'),
            exp:t('--exp'), inc:t('--inc'), warn:t('--warn'),
            overflow: de.scrollWidth > de.clientWidth, wide:wide,
            rows: (document.querySelectorAll('.item, .ccard, .lcard, .acard, .m-item').length),
            err: !!document.querySelector('.err-card')
          });
        })()`,
      });
      const p = JSON.parse(probe.result.value);

      if (p.err) problems.push(`${mode}/${tabKey}: 데이터 연결 오류 카드가 떴다`);
      if (p.overflow) problems.push(`${mode}/${tabKey}: 가로 넘침 — ${p.wide.join(", ")}`);

      // 대비 실측 (탭마다 같지만, 테마가 실제로 적용됐는지 확인용)
      if (tabKey === SHOTS[0][0]) {
        const got = { ink: ratio(p.ink, p.bg), "ink-2": ratio(p.ink2, p.bg), "ink-3": ratio(p.ink3, p.bg),
                      exp: ratio(p.exp, p.bg), inc: ratio(p.inc, p.bg), warn: ratio(p.warn, p.bg) };
        console.log("\n[" + mode + "]  bg " + p.bg);
        for (const k of Object.keys(got)) {
          const want = EXPECT[mode][k];
          const off = Math.abs(got[k] - want) > 0.05;
          console.log("   --" + k.padEnd(6) + got[k].toFixed(2) + ":1" + (off ? "   ✗ 기대 " + want : ""));
          if (off) problems.push(`${mode}: --${k} 대비 ${got[k].toFixed(2)} (스펙 ${want})`);
        }
      }

      // ⚠️ captureBeyondViewport 는 position:fixed 요소의 오래된 타일을 합성해
      //    탭바 잔상이 화면 중간에 찍힌다(실제로 겪음). 대신 뷰포트 자체를 늘린다 —
      //    그러면 fixed 탭바는 늘어난 뷰포트의 바닥, sticky 헤더는 맨 위에 자연히 앉는다.
      const m = await send("Page.getLayoutMetrics", {});
      // --h 로 상한을 주면 위에서부터 그만큼만 — 긴 화면을 눈으로 볼 때 쓴다
      const h = Math.min(Number(argOf("--h")) || 6000, Math.ceil((m.cssContentSize || m.contentSize).height));
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: h, deviceScaleFactor: 2, mobile: true });
      await sleep(500);
      const shot = await send("Page.captureScreenshot", {
        format: "png", clip: { x: 0, y: 0, width: 390, height: h, scale: 2 },
      });
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      const file = path.join(OUTDIR, mode + "-" + tabKey.replace(":", "-") + ".png");
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      console.log("   shot  " + path.basename(file) + "  390x" + h + "  (행 " + p.rows + ")");
    }
  }

  ws.close(); edge.kill();
  console.log("\n출력: " + OUTDIR);
  if (problems.length) {
    console.log("\n문제 " + problems.length + "건:");
    problems.forEach(s => console.log("  - " + s));
    process.exit(1);
  }
  console.log("문제 없음");
})().catch(e => { console.error(e); process.exit(1); });
