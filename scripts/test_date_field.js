// 날짜 필드 기능 검증.
//
//   node C:/Users/1226c/Projects/Our_Budget/scripts/test_date_field.js
//
// 왜 필요한가: 입력 시트의 날짜는 네이티브 <input type=date> 를 **투명하게 덮고**
// 표시만 우리가 그린다(브라우저가 그리는 'yyyy. mm. dd.' 는 OS 로케일 소관이라 못 바꾼다).
// 그래서 두 가지가 조용히 깨질 수 있다:
//   ① 표시 동기화를 빠뜨리면 값은 들어 있는데 칸이 비어 보인다
//   ② 표시 span 이 탭을 가로채면 폰에서 날짜를 아예 못 고른다
// 둘 다 화면만 봐서는 모르고, 폰에서만 드러난다. 그래서 여기서 잡는다.
//
// ⚠️ saveEntry 는 부르지 않는다 — 테스트 DB 가 없다(가족 실데이터).
//    대신 saveEntry 가 읽는 바로 그 값($("fDate").value)을 직접 확인한다.

const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "public", "index.html");
const { MOCK } = require(path.join(__dirname, "lib_mock.js"));

const PORT = 9416;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = path.join(os.tmpdir(), "ourbudget-datetest");

const get = p => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
    const b = []; r.on("data", d => b.push(d));
    r.on("end", () => res(Buffer.concat(b).toString("utf8")));
  }).on("error", rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let html = fs.readFileSync(SRC, "utf8");
  html = html.replace("</head>", "<script>" + MOCK + "</script>\n</head>");
  const tmp = path.join(os.tmpdir(), "ourbudget-datetest.html");
  fs.writeFileSync(tmp, html, "utf8");

  const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check",
    "--disable-gpu", "--lang=ko-KR", "about:blank"], { stdio: "ignore" });
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
  await send("Network.setBlockedURLs", { urls: ["*@supabase/supabase-js*"] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: "file:///" + tmp.replace(/\\/g, "/") });
  await sleep(2600);

  const r = await send("Runtime.evaluate", {
    returnByValue: true, expression: `(function(){
      var out=[], DOW=["일","월","화","수","목","금","토"];
      function T(name, got, want){ out.push({name:name, got:String(got), want:String(want), ok:String(got)===String(want)}); }
      function label(v){ var t=parseDate(v);
        return t.getFullYear()+"년 "+(t.getMonth()+1)+"월 "+t.getDate()+"일 ("+DOW[t.getDay()]+")"; }
      var disp=function(){ return document.getElementById("fDateDisp"); };
      var el=function(){ return document.getElementById("fDate"); };

      // ① 신규 입력 — openSheet 가 오늘을 넣고 표시가 따라오는가
      openSheet();
      T("신규: 표시", disp().textContent, label(todayStr()));
      T("신규: saveEntry 가 읽는 값", el().value, todayStr());

      // ② 수정 — editEntry 가 그 행의 날짜를 넣고 표시가 따라오는가
      var row = ROWS.filter(function(x){ return !isTransfer(x); })[3];
      editEntry(row.id);
      T("수정: 표시", disp().textContent, label(row.date));
      T("수정: saveEntry 가 읽는 값", el().value, row.date);

      // ③ 사용자가 피커로 고른 경우
      el().value="2026-01-01"; el().dispatchEvent(new Event("change"));
      T("피커 선택 후 표시", disp().textContent, "2026년 1월 1일 (목)");
      T("피커 선택 후 값", el().value, "2026-01-01");

      // ④ 탭이 네이티브 입력에 닿는가 — 막히면 폰에서 날짜를 못 고른다
      var b=disp().getBoundingClientRect();
      var hit=document.elementFromPoint(b.left+b.width/2, b.top+b.height/2);
      T("표시 중앙 탭 → 네이티브 입력", hit && hit.id, "fDate");

      // ⑤ 빈 값 안내
      el().value=""; el().dispatchEvent(new Event("change"));
      T("빈 값 문구", disp().textContent, "날짜 선택");
      T("빈 값 흐린 색", disp().classList.contains("ph"), "true");

      return JSON.stringify(out);
    })()`,
  });

  ws.close(); edge.kill();

  const res = JSON.parse(r.result.value);
  let bad = 0;
  console.log("");
  res.forEach(x => {
    console.log((x.ok ? "  ok   " : "  FAIL ") + x.name + "  →  " + x.got + (x.ok ? "" : "\n         기대: " + x.want));
    if (!x.ok) bad++;
  });
  console.log(bad ? "\n  " + bad + " FAILED\n" : "\n  ALL PASS (" + res.length + ")\n");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
