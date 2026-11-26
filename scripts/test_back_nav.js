// 뒤로가기 = 이전 탭 — 실제 브라우저(헤드리스, 가짜 DB)에서 history.back() 으로 확인한다. ~10초.
//
//   node C:/Users/1226c/Projects/Our_Budget/scripts/test_back_nav.js [다른파일.html]
//   클라우드 리눅스: BROWSER=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node scripts/test_back_nav.js
//
// 왜: 2026-11-26 까지 탭 이동이 history 에 안 남아, 폰에서 뒤로가기를 누르면 앱이 통째로 닫혔다.
//   ① 탭을 눌러 옮긴 뒤 뒤로가기 → 이전 탭 (여러 번)
//   ② 같은 탭을 다시 눌러도 기록이 안 쌓인다
//   ③ 맨 앞(바닥)까지 오면 앱이 안 닫히고 안내 토스트
//   ④ 입력 시트·피커가 열려 있으면 뒤로가기가 탭 대신 레이어를 닫는다(피커 → 시트 순)
//   ⑤ 분류 카드 드릴다운(→내역) 뒤 뒤로가기 → 분류
//   ⑥ 로그인 화면에선 뒤로가기가 아무것도 안 한다
// ⚠️ 실서비스 DB 를 건드리지 않는다(lib_mock.js).
const http = require("http"), os = require("os"), path = require("path"), fs = require("fs");
const { spawn } = require("child_process");
const ROOT = path.join(__dirname, "..");
const SRC = process.argv[2] || path.join(ROOT, "public", "index.html");
const { MOCK } = require(path.join(__dirname, "lib_mock.js"));
const PORT = 9417;
const EDGE = process.env.BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const XARGS = process.platform === "linux" ? ["--no-sandbox"] : [];
const get = p => new Promise((res, rej) => { http.get({ host: "127.0.0.1", port: PORT, path: p }, r => { const b = []; r.on("data", d => b.push(d)); r.on("end", () => res(Buffer.concat(b).toString())); }).on("error", rej); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const html = fs.readFileSync(SRC, "utf8").replace("</head>", "<script>" + MOCK + "</script>\n</head>");
  const tmp = path.join(os.tmpdir(), "ourbudget-back-nav.html"); fs.writeFileSync(tmp, html);
  const edge = spawn(EDGE, [...XARGS, "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), "ob-back-nav")}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await get("/json/version"); break; } catch { await sleep(500); } }
  const page = JSON.parse(await get("/json/list")).find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pend = new Map();
  const send = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await send("Page.enable", {}); await send("Runtime.enable", {});
  await send("Network.enable", {}); await send("Network.setBlockedURLs", { urls: ["*@supabase/supabase-js*"] });
  const ev = async x => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.result.value; };
  const tap = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  // 하단 탭바의 버튼을 실제 좌표로 누른다(goTab 직접 호출이 아니라 사용자가 하는 그대로)
  const tapTab = async label => {
    const p = JSON.parse(await ev(`(function(){var b=[...document.querySelectorAll('#nav .tab')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); var r=b.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`));
    await tap(p.x, p.y); await sleep(350);
  };
  const back = async () => { await ev("history.back(); 1"); await sleep(400); };
  const st = async () => JSON.parse(await ev("JSON.stringify({tab, href:location.href, main:!!document.getElementById('main'), sheet:document.getElementById('overlay').classList.contains('open'), picker:document.getElementById('pickerOv').classList.contains('open'), toast:document.getElementById('toast').classList.contains('show')?document.getElementById('toast').textContent:'', len:history.length})"));
  let bad = 0; const ok = (n, c, d) => { if (!c) bad++; console.log((c ? "ok   " : "FAIL ") + n + (d ? "  — " + d : "")); };

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: "file:///" + tmp.replace(/\\/g, "/") }); await sleep(2500);
  await ev("try{closeDeviceUser()}catch(e){}; 1");
  const href0 = (await st()).href;
  ok("시작 탭은 내역", (await st()).tab === "list");

  // ① 탭 세 번 이동 → 뒤로 세 번
  await tapTab("분류"); await tapTab("한도"); await tapTab("분석");
  ok("탭을 누르면 옮겨 간다", (await st()).tab === "analysis");
  await back(); ok("뒤로 → 한도", (await st()).tab === "limit", (await st()).tab);
  await back(); ok("뒤로 → 분류", (await st()).tab === "cat", (await st()).tab);
  await back(); ok("뒤로 → 내역", (await st()).tab === "list", (await st()).tab);

  // ② 같은 탭 재탭은 기록을 안 쌓는다
  const l0 = (await st()).len; await tapTab("내역"); await tapTab("내역");
  ok("같은 탭을 다시 눌러도 기록이 안 쌓인다", (await st()).len === l0, `${l0} → ${(await st()).len}`);

  // ③ 바닥까지 → 앱이 안 닫히고 안내
  await back();
  const s3 = await st();
  ok("첫 화면에서 뒤로 → 페이지를 떠나지 않는다", s3.main && s3.href === href0, s3.href);
  ok("첫 화면에서 뒤로 → '한 번 더' 안내 토스트", /한 번 더/.test(s3.toast), s3.toast);

  // ④ 레이어: 피커 → 시트 순으로 닫히고 탭은 그대로
  await tapTab("한도");
  await ev("openSheet(); document.activeElement && document.activeElement.blur(); 1"); await sleep(300);
  await ev("openPicker('fCategory','카테고리'); 1"); await sleep(300);
  await back(); let s4 = await st();
  ok("피커가 열려 있으면 뒤로 → 피커만 닫힌다", !s4.picker && s4.sheet && s4.tab === "limit", JSON.stringify(s4));
  await back(); s4 = await st();
  ok("시트가 열려 있으면 뒤로 → 시트가 닫히고 탭은 그대로", !s4.sheet && s4.tab === "limit", JSON.stringify(s4));
  await back(); s4 = await st();
  ok("레이어를 다 닫은 뒤 뒤로 → 이전 탭(내역)", s4.tab === "list", s4.tab);

  // ⑤ 분류 카드 드릴다운 → 뒤로 → 분류
  await tapTab("분류");
  const p5 = JSON.parse(await ev("(function(){var c=document.querySelector('.ccard.link'); c.scrollIntoView({block:'center'}); var r=c.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()"));
  await tap(p5.x, p5.y); await sleep(400);
  ok("분류 카드를 누르면 내역으로", (await st()).tab === "list");
  await back(); ok("드릴다운 뒤 뒤로 → 분류", (await st()).tab === "cat", (await st()).tab);

  // ⑥ 로그인 화면에선 아무것도 안 한다
  await tapTab("계좌");
  await ev("showAuth(); 1"); await sleep(200);
  await back();
  const s6 = JSON.parse(await ev("JSON.stringify({tab, auth:document.getElementById('authOv').classList.contains('open')})"));
  ok("로그인 화면에서 뒤로 → 탭이 바뀌지 않고 게이트가 그대로", s6.tab === "acct" && s6.auth, JSON.stringify(s6));

  ws.close(); edge.kill();
  console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
