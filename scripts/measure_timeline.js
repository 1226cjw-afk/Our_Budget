// 로그인된 상태의 "첫 화면까지" 전체 타임라인을 잰다 — 어느 구간에서 시간이 가는지 가른다.
//
//   node scripts/measure_timeline.js            # 데스크톱
//   node scripts/measure_timeline.js --4g       # 4G + CPU 4배 (폰 근사)
//   node scripts/measure_timeline.js --4g --wait=9000 http://127.0.0.1:8799/old.html
//
// ⚠️ 왜 measure_load.js로 부족한가: 그건 DCL/FCP까지만 본다. 사용자가 기다리는 건 '앱이 시작한 시점'이
//    아니라 '데이터가 보이는 시점'이고, 그 사이에 세션 확인 → 6쿼리 → 렌더가 더 있다.
//    2026-08-15에 DCL만 기준선으로 잡았다가 "고쳤는데 체감이 그대로"라는 말을 들은 게 이 도구를 만든 이유다.
//
// ⚠️ BUDGET_PW가 없으면 더미 세션으로 돈다. 그러면 '첫 DB 요청 발사' 시점까지만 유효하다 —
//    supabase-js가 401을 받고 토큰 갱신을 재시도하느라 그 뒤 구간이 실제보다 길게 나온다(요청도 2배로 보인다).
//    데이터 구간까지 진짜로 재려면 BUDGET_PW를 넘길 것(CLAUDE.md '스크립트에 비밀번호 넘기기').
//
// ⚠️ 절대값을 1회로 믿지 말 것 — CDN 응답 편차만으로 DCL이 217~1,166ms까지 흔들린다(실측).
//    개선 전/후 비교는 두 버전을 '교대로' 여러 번 돌려 중앙값으로 볼 것.
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = Number(process.env.CDP_PORT || 9377);
const PROFILE = path.join(os.tmpdir(), "ourbudget-timeline-" + Date.now());
const args = process.argv.slice(2);
const IS4G = args.includes("--4g");
const TARGET = args.find(a => /^https?:\/\//.test(a)) || "https://ourbudget.1226cjw.workers.dev/";
const SUPA = "https://hqyvkyflakhuvethrstw.supabase.co";
const ANON = "sb_publishable_phZGH7odPTBoB4z8FQF_4A_mO2ltQ6J";

const get = p => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
    const b = []; r.on("data", d => b.push(d));
    r.on("end", () => res(Buffer.concat(b).toString("utf8")));
  }).on("error", rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// BUDGET_PW가 있으면 실제 세션 토큰을 미리 받아 localStorage에 심는다(진짜 데이터량까지 측정)
async function realSession() {
  const pw = process.env.BUDGET_PW;
  if (!pw) return null;
  const https = require("https");
  const body = JSON.stringify({ email: "1226cjw@gmail.com", password: pw });
  return new Promise((resolve, reject) => {
    const req = https.request(SUPA + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON, "Content-Length": Buffer.byteLength(body) },
    }, res => {
      const b = []; res.on("data", d => b.push(d));
      res.on("end", () => {
        const j = JSON.parse(Buffer.concat(b).toString("utf8"));
        if (!j.access_token) return reject(new Error("로그인 실패: " + (j.error_description || j.msg || res.statusCode)));
        resolve(j);
      });
    });
    req.on("error", reject); req.end(body);
  });
}

(async () => {
  let sess = null;
  try { sess = await realSession(); } catch (e) { console.error("!! " + e.message); process.exit(1); }

  const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check",
    "--disable-gpu", "about:blank"], { stdio: "ignore" });

  let up = false;
  for (let i = 0; i < 60; i++) { try { await get("/json/version"); up = true; break; } catch { await sleep(500); } }
  if (!up) { console.error("devtools 안 뜸"); edge.kill(); process.exit(1); }

  const page = JSON.parse(await get("/json/list")).find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });

  const reqs = new Map();
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    const p = m.params || {};
    if (m.method === "Network.requestWillBeSent") reqs.set(p.requestId, { url: p.request.url, start: p.timestamp });
    else if (m.method === "Network.responseReceived") { const r = reqs.get(p.requestId); if (r) r.status = p.response.status; }
    else if (m.method === "Network.loadingFinished") { const r = reqs.get(p.requestId); if (r) { r.end = p.timestamp; r.bytes = p.encodedDataLength; } }
  });

  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });

  // 세션 주입 + 앱 안에 계측 훅 삽입 (문서 스크립트보다 먼저 도는 자리)
  const token = sess
    ? { access_token: sess.access_token, refresh_token: sess.refresh_token, expires_at: sess.expires_at,
        expires_in: sess.expires_in, token_type: "bearer", user: sess.user }
    : { access_token: "dummy", refresh_token: "dummy", expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600, token_type: "bearer", user: { id: "x", email: "x@x" } };
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      try { localStorage.setItem("ourbudget.auth", JSON.stringify(${JSON.stringify(token)})); } catch(e){}
      try { localStorage.setItem("ourbudget.deviceUser", "정우"); } catch(e){}
      window.__M = {};
      const mark = k => { if (window.__M[k] == null) window.__M[k] = performance.now(); };
      window.__mark = mark;
      document.addEventListener("DOMContentLoaded", () => mark("dcl"));
      // supabase-js가 실행돼 전역이 생긴 순간
      let _sb; Object.defineProperty(window, "supabase", {
        configurable: true,
        get(){ return _sb; },
        set(v){ _sb = v; mark("supabaseReady"); },
      });
      let _ch; Object.defineProperty(window, "Chart", {
        configurable: true, get(){ return _ch; }, set(v){ _ch = v; mark("chartReady"); },
      });
      // 첫 렌더: #main에 내용이 들어오는 순간
      new MutationObserver(() => {
        const m = document.getElementById("main");
        if (m && m.innerHTML.length > 400) mark("firstRender");
      }).observe(document.documentElement, { childList: true, subtree: true });
    `,
  });

  await send("Page.navigate", { url: TARGET });
  await sleep(Number((args.find(a=>a.startsWith("--wait="))||"").slice(7)) || (IS4G ? 20000 : 15000));

  const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.value;
  const M = JSON.parse(await ev("JSON.stringify(window.__M||{})") || "{}");
  const nav = JSON.parse(await ev("JSON.stringify(performance.getEntriesByType('navigation')[0])") || "null");
  const paints = JSON.parse(await ev("JSON.stringify(performance.getEntriesByType('paint'))") || "[]");
  const rowsLoaded = await ev("(typeof ROWS!=='undefined'&&ROWS)?ROWS.length:-1");

  const list = [...reqs.values()].filter(r => r.end != null);
  const base = Math.min(...list.map(r => r.start));
  const rel = t => Math.round((t - base) * 1000);

  console.log(`대상: ${TARGET}`);
  console.log(`조건: ${IS4G ? "4G + CPU 4배 (폰 근사)" : "데스크톱"} · 콜드 캐시 · ${sess ? "실제 로그인 세션" : "더미 세션(401)"}\n`);
  console.log("  시작 → 완료      바이트  리소스");
  list.sort((a, b) => a.start - b.start).forEach(r => {
    const host = r.url.replace(/^https?:\/\//, "").split("/")[0];
    let name = r.url.split("?")[0].split("/").pop() || "/";
    if (/supabase\.co/.test(host)) name = decodeURIComponent(r.url.split("/rest/v1/")[1] || r.url.split("/auth/v1/")[1] || name).slice(0, 46);
    console.log(`  ${String(rel(r.start)).padStart(5)} →${String(rel(r.end)).padStart(6)}ms ${String(r.bytes || 0).padStart(8)}b  ${host === "ourbudget.1226cjw.workers.dev" ? "앱" : host === "cdn.jsdelivr.net" ? "CDN" : host === "hqyvkyflakhuvethrstw.supabase.co" ? "DB " : host}  ${name.slice(0, 52)}`);
  });

  const fcp = Math.round((paints.find(p => p.name === "first-contentful-paint") || {}).startTime || 0);
  const db = list.filter(r => /supabase\.co/.test(r.url));
  const dbStart = db.length ? rel(Math.min(...db.map(r => r.start))) : null;
  const dbEnd = db.length ? rel(Math.max(...db.map(r => r.end))) : null;

  console.log(`\n  ── 단계 ──`);
  const row = (k, v) => console.log(`  ${k.padEnd(34)} ${v == null ? "-" : String(Math.round(v)) + "ms"}`);
  row("HTML 도착 완료", rel(list.find(r => r.url === TARGET)?.end ?? base));
  row("supabase-js 실행됨", M.supabaseReady);
  row("chart.js 실행됨", M.chartReady);
  row("DOMContentLoaded (앱 시작)", M.dcl ?? nav?.domContentLoadedEventEnd);
  row("FCP (첫 픽셀)", fcp);
  row("첫 DB 요청 발사", dbStart);
  row("마지막 DB 응답 도착", dbEnd);
  // 더미 세션이면 loadAll이 401 → showAuth로 빠져 #main이 안 채워진다(빈 값이 정상)
  console.log(`  ${"첫 렌더 (#main 채워짐)".padEnd(34)} ${M.firstRender != null ? Math.round(M.firstRender) + "ms" : (sess ? "-" : "- (더미 세션이라 로그인 화면 · BUDGET_PW 필요)")}`);
  row("load", nav?.loadEventEnd);
  console.log(`\n  DB 요청 ${db.length}개 · 수신 ${(db.reduce((a, r) => a + (r.bytes || 0), 0) / 1024).toFixed(0)}KB · ROWS=${rowsLoaded}`);
  console.log(`  총 ${(list.reduce((a, r) => a + (r.bytes || 0), 0) / 1024).toFixed(0)}KB · 요청 ${list.length}개`);

  ws.close(); edge.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
})().catch(e => { console.error("ERR", e); process.exit(1); });
