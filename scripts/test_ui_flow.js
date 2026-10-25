// 입력·목록 UI 동작을 실제 브라우저(Edge 헤드리스, 가짜 DB)에서 확인한다 — ~15초.
//
//   node C:/Users/1226c/Projects/Our_Budget/scripts/test_ui_flow.js [다른파일.html]
//
// 단위테스트(test_optimistic.js)는 마크업 '모양'만 본다. 여기서는 실제 좌표로 눌러서:
//   ① 내역 행을 누르면 수정 시트가 열리는가(행 전체 = 수정)
//   ② 삭제 글자 위·아래(넓힌 터치 영역)를 눌러도 삭제가 받고, 수정 시트는 안 열리는가(전파 차단)
//   ③ role=button 카드에 Enter → 동작하는가
//   ④ 375×667 폰에서 저장 버튼이 스크롤 없이 화면 안에 있고 눌리는가(sticky) — 옛 배치는 808~854px(화면 밖)
//   ⑤ 금액 칸 22px · '원'이 입력 영역과 안 겹치는가
// ⚠️ 실서비스 DB 를 건드리지 않는다(lib_mock.js). 삭제는 스텁으로 덮고 confirm 은 '취소'를 돌려준다.
const http = require("http"), os = require("os"), path = require("path"), fs = require("fs");
const { spawn } = require("child_process");
const ROOT = path.join(__dirname, "..");
const SRC = process.argv[2] || path.join(ROOT, "public", "index.html");
const { MOCK } = require(path.join(__dirname, "lib_mock.js"));
const PORT = 9416, EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const get = p => new Promise((res, rej) => { http.get({ host: "127.0.0.1", port: PORT, path: p }, r => { const b = []; r.on("data", d => b.push(d)); r.on("end", () => res(Buffer.concat(b).toString())); }).on("error", rej); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let html = fs.readFileSync(SRC, "utf8").replace("</head>", "<script>" + MOCK + "</script>\n</head>");
  const tmp = path.join(os.tmpdir(), "ourbudget-verify-ui.html"); fs.writeFileSync(tmp, html);
  const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), "ob-verify-ui")}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
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
  let bad = 0; const ok = (n, c, d) => { if (!c) bad++; console.log((c ? "ok   " : "FAIL ") + n + (d ? "  — " + d : "")); };

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: "file:///" + tmp.replace(/\\/g, "/") }); await sleep(2500);
  await ev("try{closeDeviceUser()}catch(e){}; goTab('list'); setScope('all'); 1");
  await sleep(500);
  // 저장·삭제 함수는 스텁으로 덮는다(가짜 DB지만 원칙대로)
  await ev("window.__calls=[]; window.delEntry=function(id){__calls.push(['del',id]); return confirm('x');}; window.confirm=function(){return false}; 1");

  // ① 행 몸통(카테고리 글자)을 실제 좌표로 탭 → 수정 시트
  const p1 = JSON.parse(await ev("(function(){var it=document.querySelector('.item'); it.scrollIntoView({block:'center'}); var r=it.querySelector('.i-cat').getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()"));
  await tap(p1.x, p1.y); await sleep(300);
  const t1 = JSON.parse(await ev("JSON.stringify({open:document.getElementById('overlay').classList.contains('open'), title:document.getElementById('sheetTitle').textContent})"));
  ok("행을 누르면 수정 시트가 열린다", t1.open && t1.title === "내역 수정", JSON.stringify(t1));
  await ev("closeSheet(); 1"); await sleep(200);

  // ② '삭제' 글자 바로 위·아래 10px(넓힌 영역) 탭 → 삭제만 불리고 시트는 안 열린다
  const p2 = JSON.parse(await ev("(function(){var b=document.querySelector('.b-del'); b.scrollIntoView({block:'center'}); var r=b.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top-9, y2:r.bottom+9})})()"));
  await tap(p2.x, p2.y); await sleep(200);
  await tap(p2.x, p2.y2); await sleep(300);
  const t2 = JSON.parse(await ev("JSON.stringify({calls:__calls.length, open:document.getElementById('overlay').classList.contains('open')})"));
  ok("삭제 글자 위·아래 9px을 눌러도 삭제가 받는다(넓힌 영역)", t2.calls === 2, JSON.stringify(t2));
  ok("삭제를 눌러도 수정 시트는 안 열린다(전파 차단)", !t2.open);

  // ③ 키보드: 분류 카드에 포커스 → Enter
  await ev("goTab('cat'); 1"); await sleep(400);
  await ev("document.querySelector('.ccard.link').focus(); 1");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(400);
  ok("분류 카드에 Enter → 내역으로 드릴다운", (await ev("tab")) === "list" && (await ev("searchQ")).length > 0);

  // ④ 작은 폰(375×667)에서 저장 버튼이 스크롤 없이 보인다
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: true });
  await ev("openSheet(); document.activeElement.blur(); 1"); await sleep(400);
  const t4 = JSON.parse(await ev("(function(){var b=document.getElementById('saveBtn').getBoundingClientRect(); var e=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2); return JSON.stringify({top:Math.round(b.top),bottom:Math.round(b.bottom),vh:innerHeight,hit:e&&e.id})})()"));
  ok("667px 폰에서 저장 버튼이 화면 안에 있고 눌린다", t4.bottom <= t4.vh && t4.hit === "saveBtn", JSON.stringify(t4));
  const t5 = JSON.parse(await ev("(function(){var o=document.getElementById('overlay'); o.scrollTop=o.scrollHeight; var b=document.getElementById('saveBtn').getBoundingClientRect(), m=document.getElementById('fMemo').getBoundingClientRect(); return JSON.stringify({gap:Math.round(b.top-m.bottom)})})()"));
  ok("끝까지 내리면 원래 자리(메모 아래)로 돌아온다", t5.gap > 0, JSON.stringify(t5));
  // 금액 칸 '원' 단위가 입력과 겹치지 않는다
  const t6 = JSON.parse(await ev("(function(){var i=document.getElementById('fAmount'); i.value='1,234,567,890'; var u=document.querySelector('.amt-u').getBoundingClientRect(), r=i.getBoundingClientRect(); var cs=getComputedStyle(i); return JSON.stringify({fs:cs.fontSize, padR:cs.paddingRight, uLeft:Math.round(u.left), contentRight:Math.round(r.right-parseFloat(cs.paddingRight))})})()"));
  ok("금액 글자 22px · '원'이 입력 영역 밖(오른쪽 여백)에 있다", t6.fs === "22px" && t6.uLeft >= t6.contentRight, JSON.stringify(t6));

  ws.close(); edge.kill();
  console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
