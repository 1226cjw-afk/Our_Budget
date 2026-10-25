// UX 실측 감사 — 눈으로 보는 캡처(shot_theme.js)가 못 잡는 것을 숫자로 잰다.
//
//   node C:/Users/1226c/Projects/Our_Budget/scripts/audit_ux.js [다른파일.html] [--verbose]
//
// 화면 9종(탭 7 + 입력 시트 + 피커)을 390×844 폰 뷰포트로 렌더하고:
//   ① 터치 영역 — 누를 수 있는 요소의 **실제 반응 영역**이 24px 미만(WCAG 2.5.8 AA 실패)인가,
//      44px 미만(iOS HIG)인가. 겉보기 박스가 아니라 elementFromPoint 로 중심에서 상하좌우를 찍어 잰다 —
//      ::after 로 넓힌 영역은 들어가고, 이웃에 가려진 부분은 빠진다.
//   ② 글자 크기 — 화면에 보이는 글자 중 12px 미만. 한글은 영문보다 획이 많아 같은 크기에서 더 뭉개진다.
//   ③ 키보드·스크린리더 — onclick 이 달린 div/span 인데 role·tabindex 가 없는 것(탭으로 못 가고
//      '버튼'이라고 읽히지 않는다), 이름 없는 아이콘 버튼, 라벨 없는 입력칸.
// ⚠️ 실서비스 DB 를 건드리지 않는다 — shot_theme.js 와 같은 가짜 클라이언트(lib_mock.js)를 쓴다.
// ⚠️ 저장 함수를 발화시키지 않는다. 읽기(측정)만 한다.
//
// 판정: ①의 AA 실패(24px 미만 + 간격 부족)와 ③이 하나라도 있으면 exit 1.
//       ②와 ①의 44px 권고는 목록만 보여준다(디자인 판단이 필요한 영역).

const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const argv = process.argv.slice(2);
const VERBOSE = argv.includes("--verbose");
const SRC = argv.find(a => !a.startsWith("--")) || path.join(__dirname, "..", "public", "index.html");
const PORT = 9415;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = path.join(os.tmpdir(), "ourbudget-audit-ux");
const { MOCK } = require(path.join(__dirname, "lib_mock.js"));

const SHOTS = [
  ["list", "내역"], ["cat", "분류"], ["limit", "한도"],
  ["analysis", "지출분석"], ["analysis:tax", "연말정산"],
  ["acct", "계좌"], ["master", "설정"],
  ["list:sheet", "입력 시트"], ["list:picker", "피커"],
];

const get = p => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
    const b = []; r.on("data", d => b.push(d)); r.on("end", () => res(Buffer.concat(b).toString("utf8")));
  }).on("error", rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 페이지 안에서 도는 측정 코드. 문자열로 넘기므로 `$`·백틱을 쓰지 않는다(CLAUDE.md 환경 quirk)
const PROBE = function () {
  var de = document.documentElement, H = innerHeight;
  function vis(el) {
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none") return null;
    for (var p = el; p; p = p.parentElement) if (getComputedStyle(p).opacity === "0" && p !== el) return null;
    return r;
  }
  function desc(el) {
    var t = (el.getAttribute("aria-label") || el.textContent || el.value || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 18);
    return el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "") + (t ? " '" + t + "'" : "");
  }
  // 오버레이가 열려 있으면 맨 위 것만 본다(뒤 화면은 가려져 누를 수 없다). 피커(z 60)가 입력 시트(z 50) 위다
  var root = document.querySelector(".picker-ov.open") || document.querySelector(".overlay.open") || document;
  // 실제 반응 영역 — 중심에서 상하좌우로 elementFromPoint 를 찍어 '이 요소가 받는' 범위를 잰다.
  // 겉보기 박스가 아니라 손가락이 닿는 영역이다(::after 로 넓힌 것·이웃에 가려진 것까지 반영된다)
  function hitBox(el) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    var r = el.getBoundingClientRect(), cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    var hit = function (x, y) { var e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)); };
    if (!hit(cx, cy)) return { w: 0, h: 0, l: cx, t: cy, r: cx, b: cy };
    var L = 0, R = 0, U = 0, D = 0;
    while (L < 40 && hit(cx - L - 1, cy)) L++;
    while (R < 40 && hit(cx + R + 1, cy)) R++;
    while (U < 40 && hit(cx, cy - U - 1)) U++;
    while (D < 40 && hit(cx, cy + D + 1)) D++;
    return { w: L + R + 1, h: U + D + 1, l: cx - L, r: cx + R, t: cy - U, b: cy + D };
  }
  var sel = "button, a[href], select, input:not([type=hidden]), textarea, [onclick], [role=button]";
  var all = [].slice.call(root.querySelectorAll(sel)).filter(function (el) {
    // 투명 네이티브 입력(.date-native)은 '표시' 위에 덮인 실제 반응 영역이라 그대로 잰다
    if (el.matches("input, select") && getComputedStyle(el).display === "none") return false;
    return true;
  });
  // 바깥 반응 영역 안에 든 요소는 바깥 것이 대신 받는다(예: 한도 행 전체가 onclick) — 자식은 따로 안 잰다.
  // 단 버튼·입력처럼 스스로 다른 동작을 하는 것은 따로 잰다.
  var own = function (el) { return el.matches("button, a[href], select, input, textarea") || el.hasAttribute("onclick"); };
  var targets = all.filter(own).filter(function (el) { return vis(el); });
  var small = [], hig = [];
  var sy = scrollY;
  targets.forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.width >= 44 && r.height >= 44) return;          // 겉보기부터 충분하면 잴 필요 없다
    var b = hitBox(el);
    if (b.w >= 44 && b.h >= 44) return;
    var item = desc(el) + " " + b.w + "x" + b.h + (b.w !== Math.round(r.width) || b.h !== Math.round(r.height)
      ? " (보이는 크기 " + Math.round(r.width) + "x" + Math.round(r.height) + ")" : "");
    // WCAG 2.5.8(AA)는 24px. 간격 예외는 따지지 않는다 — 실제 반응 영역을 쟀으므로 24 미만이면 그냥 작다
    (b.w < 24 || b.h < 24 ? small : hig).push(item);
  });
  scrollTo(0, sy);
  // ② 작은 글자 — 보이는 텍스트 노드의 부모 기준
  var tiny = {};
  var tw = document.createTreeWalker(root === document ? document.body : root, NodeFilter.SHOW_TEXT);
  for (var n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    var el = n.parentElement; if (!el || el.closest("script,style,noscript,option,.auth-ov,#authOv")) continue;
    if (!vis(el)) continue;
    var fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) {
      var k = (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase()) + " " + fs + "px";
      if (!tiny[k]) tiny[k] = { n: 0, ex: n.nodeValue.trim().slice(0, 20) };
      tiny[k].n++;
    }
  }
  // ③ 키보드·스크린리더
  // data-row-tap: 행 전체 탭은 손가락 편의이고, 같은 동작이 안쪽 <button>(내역 '수정')으로 열려 있다 —
  // 행에 role=button 을 주면 버튼 안에 버튼이 든 꼴이라 일부러 안 준다. 대신 안쪽 버튼이 있는지는 확인한다
  var noRole = [].slice.call(root.querySelectorAll("div[onclick], span[onclick], li[onclick]")).filter(function (el) {
    if (el.hasAttribute("data-row-tap")) return !el.querySelector("button");
    // 시트 본체의 onclick="event.stopPropagation()" 은 동작이 아니라 '바깥 클릭으로 닫기'를 막는 차단막이다
    if (/^\s*event\.stopPropagation\(\)\s*;?\s*$/.test(el.getAttribute("onclick"))) return false;
    return vis(el) && !el.hasAttribute("role") && !el.hasAttribute("tabindex");
  }).map(desc);
  var noName = [].slice.call(root.querySelectorAll("button")).filter(function (el) {
    return vis(el) && !el.getAttribute("aria-label") && !el.textContent.replace(/\s/g, "") && !el.title;
  }).map(desc);
  var noLabel = [].slice.call(root.querySelectorAll("input:not([type=hidden]), select, textarea")).filter(function (el) {
    if (!vis(el) || getComputedStyle(el).opacity === "0") return false;
    if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.title) return false;
    if (el.id && document.querySelector("label[for='" + el.id + "']")) return false;
    if (el.closest("label")) return false;
    return true;
  }).map(desc);
  // ④ 겹침 — 일반 흐름의 블록이 바로 앞 형제 아래쪽(테두리·글자)을 파고드는가.
  //    음수 margin 으로 간격을 '당기다' 제목 밑줄이 안내문 글자를 긋던 것(설정 탭, 6px)을 잡는다
  var overlap = [];
  [].slice.call((root === document ? document.body : root).querySelectorAll("div, p, section")).forEach(function (el) {
    var p = el.previousElementSibling; if (!p || !el.textContent.trim()) return;
    var cs = getComputedStyle(el), ps = getComputedStyle(p);
    // sticky 헤더(입력 시트 상단)는 스크롤된 본문 위에 떠 있는 게 정상이다
    if (/absolute|fixed/.test(cs.position) || /absolute|fixed|sticky/.test(ps.position)) return;
    if (cs.display.indexOf("inline") === 0 || ps.display === "none" || cs.display === "none") return;
    if (cs.float !== "none" || ps.float !== "none") return;
    var a = vis(el), b = vis(p); if (!a || !b) return;
    if (a.left >= b.right || b.left >= a.right) return;                // 가로로 안 겹치면(같은 줄의 flex 형제) 무관
    var d = b.bottom - a.top;
    if (d > 1.5) overlap.push(desc(el) + " ↔ 앞 " + desc(p) + " " + Math.round(d) + "px");
  });
  var uniq = function (a) { var o = {}; a.forEach(function (s) { o[s] = (o[s] || 0) + 1; }); return Object.keys(o).map(function (s) { return o[s] > 1 ? s + " ×" + o[s] : s; }); };
  return JSON.stringify({ small: uniq(small), hig: uniq(hig), tiny: tiny, noRole: uniq(noRole), noName: uniq(noName), noLabel: uniq(noLabel), overlap: uniq(overlap),
                          overflow: de.scrollWidth > de.clientWidth, err: !!document.querySelector(".err-card") });
};

(async () => {
  let html = fs.readFileSync(SRC, "utf8");
  html = html.replace("</head>", "<script>" + MOCK + "</script>\n</head>");
  const tmp = path.join(os.tmpdir(), "ourbudget-audit-ux.html");
  fs.writeFileSync(tmp, html, "utf8");
  const TARGET = "file:///" + tmp.replace(/\\/g, "/");

  const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60; i++) { try { await get("/json/version"); up = true; break; } catch { await sleep(500); } }
  if (!up) { console.error("devtools endpoint 가 안 떴다"); edge.kill(); process.exit(1); }
  const page = JSON.parse(await get("/json/list")).find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  await send("Page.enable", {}); await send("Runtime.enable", {}); await send("Network.enable", {});
  await send("Network.setBlockedURLs", { urls: ["*@supabase/supabase-js*"] });
  // 화면 전체를 한 번에 재려고 뷰포트를 길게 둔다(스크롤 밖 요소도 getBoundingClientRect 로 잡히지만 fixed 요소 위치가 바뀐다)
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  let fail = 0;
  const seen = { tiny: {}, hig: {} };
  for (const [tabKey, tabName] of SHOTS) {
    await send("Page.navigate", { url: TARGET });
    await sleep(2400);
    await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
    const [tab, seg] = tabKey.split(":");
    const open = seg === "sheet" ? "openSheet();" : seg === "picker" ? "openSheet(); openPicker('fCategory','카테고리');"
               : seg ? `setAnView(${JSON.stringify(seg)});` : "";
    await send("Runtime.evaluate", { expression: `(function(){try{closeDeviceUser&&closeDeviceUser();}catch(e){} goTab(${JSON.stringify(tab)}); ${open}})()` });
    await sleep(tab === "analysis" ? 2600 : 700);
    const r = await send("Runtime.evaluate", { returnByValue: true, expression: "(" + PROBE.toString() + ")()" });
    if (!r.result || r.result.type !== "string") { console.log(tabName, "측정 실패", JSON.stringify(r).slice(0, 300)); fail++; continue; }
    const p = JSON.parse(r.result.value);
    const bad = p.overlap.length + p.small.length + p.noRole.length + p.noName.length + p.noLabel.length + (p.err ? 1 : 0) + (p.overflow ? 1 : 0);
    fail += bad;
    console.log(`\n[${tabName}] ${bad ? "FAIL " + bad : "ok"}`);
    if (p.err) console.log("  ✗ 데이터 연결 오류 카드가 떴다 (목 문제)");
    if (p.overflow) console.log("  ✗ 가로 넘침");
    p.small.forEach(s => console.log("  ✗ 터치 24px 미만·간격 부족  " + s));
    p.noRole.forEach(s => console.log("  ✗ 키보드로 못 누름(role/tabindex 없음)  " + s));
    p.noName.forEach(s => console.log("  ✗ 이름 없는 버튼  " + s));
    p.noLabel.forEach(s => console.log("  ✗ 라벨 없는 입력칸  " + s));
    p.overlap.forEach(s => console.log("  ✗ 앞 요소와 겹침  " + s));
    p.hig.forEach(s => { if (VERBOSE || !seen.hig[s]) console.log("  · 44px 미만(권고)  " + s); seen.hig[s] = 1; });
    Object.keys(p.tiny).forEach(k => { if (VERBOSE || !seen.tiny[k]) console.log(`  · 12px 미만 글자  ${k} ×${p.tiny[k].n}  '${p.tiny[k].ex}'`); seen.tiny[k] = 1; });
  }
  ws.close(); edge.kill();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS (권고 항목은 위 목록 참고)");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
