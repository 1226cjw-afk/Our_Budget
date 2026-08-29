// 초기 로딩 실측 — CLAUDE.md '초기 로딩 기준선' 표를 재현·검증한다.
// 기준선이 있는데 재는 도구가 없으면 그 표는 반증 불가능한 숫자일 뿐이라 남긴다.
//
//   node scripts/measure_load.js            # 배포본, 데스크톱 조건
//   node scripts/measure_load.js --4g       # 4G + CPU 4배 (폰 근사)
//   node scripts/measure_load.js --block='*packages/pretendard*'   # 통제 실험(그 리소스만 빼고 재측정)
//   node scripts/measure_load.js http://127.0.0.1:8787/            # 다른 대상
//
// ⚠️ 도착 판정이 아니라 '성능'을 보는 도구다. 배포 반영 확인은 poll_deploy.js / check_live.js.
// ⚠️ 측정은 매번 새 프로필(콜드 캐시)로 돈다. 스로틀 측정은 ±20% 편차가 있으니 1회로 결론내지 말 것.
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9366;
// ⚠️ 프로필은 반드시 리포 밖에 — __dirname 아래에 만들면 리포를 오염시킨다
const PROFILE = path.join(os.tmpdir(), "ourbudget-measure-" + Date.now());

const args = process.argv.slice(2);
const IS4G = args.includes("--4g");
const BLOCK = (args.find(a => a.startsWith("--block=")) || "").slice(8);
const URL_TARGET = args.find(a => /^https?:\/\//.test(a)) || "https://ourbudget.1226cjw.workers.dev/";

// CLAUDE.md에 적어둔 기준선 (2026-08-30 배포본 실측, N=5 교대 중앙값).
// 여기를 고칠 땐 CLAUDE.md 표도 같이 고칠 것.
// ⚠️ 시간 검사는 '거친 backstop'일 뿐이다 — 콜드 CDN 스파이크 하나로 데스크톱 DCL이 1,595ms까지 튄 적이 있다
//    (같은 배포본, 같은 세션). 한 번 FAIL이 났다고 회귀로 단정하지 말고 다시 돌려볼 것.
//    진짜 회귀 감지는 아래 '구조' 검사들과 test_lazy_chart.js의 배선 검사가 한다.
const BASE = {
  desktop: { dcl: 477, fcp: 268 },
  "4g":     { dcl: 781, fcp: 572 },
  bytes: 400 * 1024,
};
const MAX_BYTES = 1024 * 1024;   // 1MB — 폰트가 static 통파일로 되돌아가면 3.4MB로 튄다

const get = p => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
    const b = []; r.on("data", d => b.push(d));
    r.on("end", () => res(Buffer.concat(b).toString("utf8")));
  }).on("error", rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check",
    "--disable-gpu", "about:blank"], { stdio: "ignore" });

  let up = false;
  for (let i = 0; i < 60; i++) { try { await get("/json/version"); up = true; break; } catch { await sleep(500); } }
  if (!up) { console.error("devtools 엔드포인트가 안 뜸 — Edge 경로 확인"); edge.kill(); process.exit(1); }

  const page = JSON.parse(await get("/json/list")).find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });

  const reqs = new Map(), errs = [];
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    const p = m.params || {};
    if (m.method === "Network.requestWillBeSent") reqs.set(p.requestId, { url: p.request.url, start: p.timestamp });
    else if (m.method === "Network.responseReceived") { const r = reqs.get(p.requestId); if (r) r.status = p.response.status; }
    else if (m.method === "Network.loadingFinished") { const r = reqs.get(p.requestId); if (r) { r.end = p.timestamp; r.bytes = p.encodedDataLength; } }
    else if (m.method === "Runtime.exceptionThrown") errs.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
    else if (m.method === "Runtime.consoleAPICalled" && p.type === "error") errs.push((p.args || []).map(a => a.value || a.description).join(" "));
  });

  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  if (BLOCK) await send("Network.setBlockedURLs", { urls: BLOCK.split("|") });
  if (IS4G) {
    await send("Network.emulateNetworkConditions", {
      offline: false, latency: 85,
      downloadThroughput: 9 * 1024 * 1024 / 8, uploadThroughput: 9 * 1024 * 1024 / 8,
    });
    await send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  }

  await send("Page.navigate", { url: URL_TARGET });
  await sleep(IS4G ? 15000 : 10000);

  const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.value;
  const nav = JSON.parse(await ev(`JSON.stringify(performance.getEntriesByType('navigation')[0])`) || "null");
  const paints = JSON.parse(await ev(`JSON.stringify(performance.getEntriesByType('paint'))`) || "[]");

  const list = [...reqs.values()].filter(r => r.end != null);
  const base = Math.min(...list.map(r => r.start));
  const bytes = list.reduce((a, r) => a + (r.bytes || 0), 0);
  const fcp = Math.round((paints.find(p => p.name === "first-contentful-paint") || {}).startTime || 0);
  const dcl = Math.round(nav?.domContentLoadedEventEnd || 0);
  const load = Math.round(nav?.loadEventEnd || 0);
  const mode = IS4G ? "4g" : "desktop";

  console.log(`대상: ${URL_TARGET}`);
  console.log(`조건: ${IS4G ? "4G + CPU 4배 (폰 근사)" : "데스크톱"}${BLOCK ? ` · 차단 ${BLOCK}` : ""}\n`);
  list.sort((a, b) => a.start - b.start).forEach(r => {
    const s = Math.round((r.start - base) * 1000), e = Math.round((r.end - base) * 1000);
    console.log(`  ${String(s).padStart(5)} → ${String(e).padStart(5)}ms  ${String(r.bytes || 0).padStart(7)}b  ${r.url.slice(0, 78)}`);
  });
  console.log(`\n앱 시작(DCL) ${dcl}ms · FCP ${fcp}ms · load ${load}ms · 총 ${(bytes / 1024).toFixed(0)}KB · 요청 ${list.length}개`);
  console.log(`기준선       DCL ${BASE[mode].dcl}ms · FCP ${BASE[mode].fcp}ms · 총 ${(BASE.bytes / 1024).toFixed(0)}KB\n`);

  // ── 회귀 검사 (시간은 환경 편차가 커서 느슨하게, 구조는 엄격하게) ──
  let bad = 0;
  // note는 실패했을 때만 — 통과 줄에 경고 문구가 붙으면 읽는 사람이 실패로 오독한다
  const chk = (name, ok, note) => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && note ? "  — " + note : ""}`); };
  const urls = list.map(r => r.url);

  chk("/ 가 200", list.some(r => r.url === URL_TARGET && r.status === 200));
  chk("콘솔 오류 없음", errs.length === 0, errs[0]);
  if (!BLOCK) {
    chk(`총 바이트 < 1MB`, bytes < MAX_BYTES, `${(bytes / 1024).toFixed(0)}KB — static 폰트로 되돌아가면 3.4MB로 튄다`);
    chk("Pretendard가 dynamic-subset", !urls.some(u => /web\/static\/pretendard/.test(u)),
      "static(통파일) 경로가 잡혔다 — weight마다 한글 전체를 받는다");
    chk("Google Fonts 미사용", !urls.some(u => /fonts\.googleapis\.com/.test(u)),
      "@font-face 496개짜리 렌더블로킹 CSS가 되살아났다");
    // chart.js는 분석 탭 전용이다. <head>에 defer로 두면 DOMContentLoaded가 그걸 기다리므로
    // 첫 DB 요청이 72KB 뒤에 줄을 선다(2026-08-24 실측: DCL이 chart.js 실행 시점과 정확히 일치).
    chk("초기 로딩에 chart.js 없음", !urls.some(u => /npm\/chart\.js/.test(u)),
      "chart.js가 다시 크리티컬 패스에 올라왔다 — 지연 로드는 ensureChart()");
    // ⚠️ '기준선의 N배' 로 두지 말 것 — 기준선이 내려갈수록 검사가 조여져 거짓 경보만 늘어난다.
    //    2026-08-30 에 실제로 그랬다: 기준선을 730→477ms 로 갱신하자마자 정상 배포본이 FAIL 했다
    //    (DCL 1,727ms · 그런데 FCP 는 316ms 로 멀쩡 — supabase-js 하나만 늦게 온 CDN 스파이크였다).
    //    시간은 파국적 회귀(폰트 통파일 3.15MB, chart.js 부활 같은)만 잡으면 된다 → 절대 상한.
    //    정밀한 감지는 위 구조 검사들과 test_lazy_chart.js 의 배선 검사가 한다.
    const CEIL = mode === "desktop" ? 2500 : 4000;
    chk(`DCL이 상한(${CEIL}ms) 이내`, dcl <= CEIL,
      `${dcl}ms — 파국적 회귀만 잡는 느슨한 상한이다. 이걸 넘으면 폰트·chart.js·시작점을 볼 것 ` +
      `(기준선 중앙값은 ${BASE[mode].dcl}ms)`);
  }
  console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");

  ws.close(); edge.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
