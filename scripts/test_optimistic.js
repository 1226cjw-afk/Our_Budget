// 저장 직후 즉시 반영(낙관적 갱신) 단위테스트 — 브라우저·실 DB 없이 ~2초.
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\test_optimistic.js [다른파일.html]
//
// 왜 필요한가: 예전엔 저장 → 전체 재로드(표 6개 + 거래 전량) → 그제야 새 행이 보였다.
// 한국→싱가포르 DB 왕복이 가장 비싼 구간인데 가장 자주 하는 동작에 왕복이 두 번 붙어 있었다.
// 지금은 insert가 돌려준 행을 ROWS에 바로 넣고(patchRows) 동기화는 뒤에서 돈다(syncInBackground).
// 이 구조는 **조용히 틀리는** 방식이 셋 있다 — 전부 화면으로는 잘 안 보인다:
//   ① 로컬에 넣은 순서가 DB 정렬과 다르면 동기화가 끝날 때 같은 날 행들이 자리를 바꿔 튄다
//   ② 동기화가 연달아 돌 때 먼저 출발한 쪽 응답이 늦게 오면 방금 저장한 행이 사라진다
//   ③ 결과가 같은데도 다시 그리면 진입 애니메이션이 한 번 더 돌아 깜빡인다
// ⚠️ 실 DB를 건드리지 않는다 — 가짜 sb만 쓴다(테스트 DB 없음, 가족 실데이터다).
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2] || path.join(__dirname, "..", "public", "index.html");
const html = fs.readFileSync(SRC, "utf8");
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

let fails = 0;
const ok = (name, cond, note) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && note ? "  — " + note : ""}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 가짜 supabase ─────────────────────────────────────────
// thenable 빌더. 지연은 delay(call)로 호출마다 정할 수 있다 — 직렬/병렬·응답 역전을 시간으로 가른다
const COLS = ["id","date","amount","type","category","member","method","account","memo","created_at"];
const norm = r => Object.fromEntries(COLS.map(k => [k, r[k] === undefined ? (k === "memo" || k === "method" ? "" : null) : r[k]]));
const dbOrder = (a,b) => a.date<b.date ? 1 : a.date>b.date ? -1 : (a.id<b.id ? -1 : a.id>b.id ? 1 : 0);
let _uid = 0;
const uuid = () => { _uid++; const h = (Math.random().toString(16).slice(2) + "0".repeat(12)).slice(0,12);
                     return `${String(_uid).padStart(8,"0")}-0000-4000-8000-${h}`; };

function fakeSb(db, delay) {
  const calls = [];
  const from = table => {
    const st = { table, op: "select", filters: [], range: null, payload: null, single: false, count: false, gte: false };
    const b = {
      select(_c, o) { if (st.op === "select" && o && o.count) st.count = true; return b; },
      order() { return b; },
      gte(c, v) { st.gte = true; st.filters.push(r => r[c] >= v); return b; },
      eq(c, v) { st.filters.push(r => r[c] === v); return b; },
      in(c, a) { st.filters.push(r => a.includes(r[c])); return b; },
      range(a, z) { st.range = [a, z]; return b; },
      single() { st.single = true; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      upsert(p) { st.op = "upsert"; st.payload = p; return b; },
      delete() { st.op = "delete"; return b; },
      then(res, rej) {
        const call = { table, op: st.op, gte: st.gte };
        calls.push(call);
        // ⚠️ 결과는 **요청 시점**에 만든다. 도착 시점에 만들면 늦게 온 응답도 최신 DB를 읽어서
        //    응답 역전(아래 5번)이 재현되지 않는다 — 실제로 그래서 가드를 빼도 통과했었다.
        const out = exec(st);
        return new Promise(r => setTimeout(r, delay(call))).then(() => out).then(res, rej);
      },
    };
    return b;
  };
  const clone = x => JSON.parse(JSON.stringify(x));
  function exec(st) {
    const rows = db[st.table] || (db[st.table] = []);
    const hit = r => st.filters.every(f => f(r));
    if (st.op === "select") {
      let out = rows.filter(hit);
      if (st.table === "transactions") out = out.slice().sort(dbOrder);
      const total = out.length;
      if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
      return { data: clone(out), error: null, count: st.count ? total : null };
    }
    if (st.op === "insert") {
      const made = [].concat(st.payload).map(p => norm({ ...p, id: uuid(), created_at: "2026-10-05T00:00:00+00:00" }));
      rows.push(...made);
      const d = clone(made);
      return { data: st.single ? d[0] : d, error: null };
    }
    if (st.op === "update") {
      const m = rows.filter(hit); m.forEach(r => Object.assign(r, st.payload));
      const d = clone(m.map(norm));
      return { data: st.single ? d[0] : d, error: null };
    }
    if (st.op === "delete") { db[st.table] = rows.filter(r => !hit(r)); return { data: null, error: null }; }
    return { data: null, error: null };   // upsert — 이 테스트에선 결과만 성공으로
  }
  return { sb: { from, auth: { onAuthStateChange(){}, getSession: async () => ({ data: { session: {} } }) } }, calls };
}

// ── stub 환경 (test_boot_cache.js 와 같은 방식) ─────────────
function makeEnv() {
  const store = new Map(), els = new Map();
  const el = () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
                      addEventListener(){}, appendChild(){}, setAttribute(){}, focus(){}, select(){},
                      innerHTML: "", textContent: "", value: "", scrollTop: 0, options: [], selectedIndex: 0 });
  let mainSets = 0;
  const main = el();
  let mainHtml = "";
  Object.defineProperty(main, "innerHTML", { get: () => mainHtml, set: v => { mainHtml = v; mainSets++; } });
  els.set("main", main);
  const doc = {
    createElement: () => el(), head: { appendChild(){} }, body: el(), documentElement: el(),
    getElementById: id => { if (!els.has(id)) els.set(id, el()); return els.get(id); },
    querySelector: () => null, querySelectorAll: () => [], addEventListener(){}, removeEventListener(){},
    activeElement: null,
  };
  const win = {
    addEventListener(){}, removeEventListener(){}, matchMedia: () => ({ matches: false, addEventListener(){} }),
    requestIdleCallback: null, scrollTo(){}, scrollY: 0, location: { reload(){}, href: "" },
    IntersectionObserver: function(){ this.observe = () => {}; this.disconnect = () => {}; },
  };
  return {
    document: doc, window: win, els, mainSets: () => mainSets,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k,v) => store.set(k, String(v)),
                    removeItem: k => store.delete(k) },
    supabase: { createClient: () => ({}) }, Chart: undefined,
    setTimeout, clearTimeout, console, Intl, Date, Math, JSON,
    navigator: { userAgent: "node" }, fetch: async () => ({}),   // 구글 시트 백업은 무시
    IntersectionObserver: win.IntersectionObserver,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    confirm: () => true, alert(){}, innerHeight: 800,
    __T: {},
  };
}
function boot(db, delay) {
  const env = makeEnv();
  const { sb, calls } = fakeSb(db, delay);
  const keys = Object.keys(env).filter(k => k !== "els" && k !== "mainSets");
  const ev = new Function(...keys, code + "\n;return (expr)=>eval(expr);")(...keys.map(k => env[k]));
  env.__T.sb = sb;
  ev("sb = __T.sb");
  const $ = id => env.document.getElementById(id);
  return { ev, env, calls, $ };
}
function seed() {
  const t = new Date(), d = n => { const x = new Date(t); x.setDate(x.getDate() - n);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; };
  const tx = [];
  for (let i = 0; i < 40; i++)
    tx.push(norm({ id: uuid(), date: d(i % 20), amount: 1000 * (i + 1), type: i % 7 ? "지출" : "입금",
                   category: ["식비","교통","생활비"][i % 3], member: i % 2 ? "정우" : "지현",
                   method: "", account: i % 2 ? "국민" : "신한", memo: "m" + i, created_at: "2026-09-01T00:00:00+00:00" }));
  return {
    members: [{ name: "정우" }, { name: "지현" }],
    transactions: tx, category_limits: [{ member: "정우", category: "식비", monthly_limit: 300000 }],
    master_data: [{ member: "정우", type: "account", value: "국민" }],
    app_settings: [{ key: "billing_start_정우", value: "25" }, { key: "billing_start_지현", value: "21" }],
    tax_map: [], today: d(0),
  };
}
const RTT = 60;
const txRows = A => JSON.parse(A.ev("JSON.stringify(ROWS)"));
const dbRowsSorted = db => db.transactions.slice().sort(dbOrder).map(r => r.id);

(async () => {
  // ── 1. 소스 구조 ─────────────────────────────────────────
  ok("patchRows·syncInBackground가 있다", /function patchRows\s*\(/.test(code) && /async function syncInBackground\s*\(/.test(code));
  for (const f of ["saveEntry", "saveTransfer", "delEntry", "saveLimit"]) {
    const i = code.indexOf(`async function ${f}(`), j = code.indexOf("\nasync function", i + 10);
    const body = code.slice(i, j < 0 ? undefined : j);
    ok(`${f}가 전체 재로드를 기다리지 않는다`, i >= 0 && !/await\s+reloadAndRender\(\)/.test(body),
       "저장 뒤 왕복이 다시 직렬로 붙는다");
  }

  // ── 2. CRUD 재로드는 '최근 45일' 쿼리를 내지 않는다 ─────────
  {
    const A = boot(seed(), () => 1);
    await A.ev("loadAll()");
    ok("onPartial 없는 loadAll은 gte(최근분) 쿼리를 안 낸다",
       !A.calls.some(c => c.table === "transactions" && c.gte), "버려질 쿼리가 매번 하나 더 나간다");
    const B = boot(seed(), () => 1);
    await B.ev("loadAll(()=>{})");
    ok("onPartial이 있으면 여전히 최근분을 먼저 받는다", B.calls.some(c => c.table === "transactions" && c.gte));
  }

  // ── 3. 저장 → 왕복 1회만에 화면 반영, 동기화 결과가 같으면 다시 안 그린다 ──
  {
    const db = seed();
    const A = boot(db, () => RTT);
    await A.ev("loadAll()");
    A.ev("memberVal='정우'; typeVal='지출'; editId=null");
    A.$("fDate").value = db.today; A.$("fAmount").value = "12,345";
    A.$("fCategory").value = "식비"; A.$("fMethod").value = ""; A.$("fAccount").value = "국민";
    A.$("fMemo").value = "새 행";
    const n0 = txRows(A).length, calls0 = A.calls.length;
    const t0 = Date.now();
    await A.ev("saveEntry()");
    const dt = Date.now() - t0;
    const after = txRows(A);
    ok(`저장이 왕복 1회 안에 끝난다 (${dt}ms, RTT ${RTT}ms)`, dt < RTT * 1.8, "재로드 왕복을 기다리고 있다");
    ok("저장 직후 ROWS에 새 행이 있다", after.length === n0 + 1 && after.some(r => r.memo === "새 행"));
    ok("새 행에 _t(주기 판정용 숫자)가 심겼다", after.every(r => typeof r._t === "number"));
    ok("로컬 순서 = DB 정렬", JSON.stringify(after.map(r => r.id)) === JSON.stringify(dbRowsSorted(db)),
       "동기화가 끝날 때 같은 날 행들이 자리를 바꿔 튄다");
    ok("저장 직후 동기화가 출발했다(아직 진행 중)", A.calls.length > calls0 + 1);
    const setsBefore = A.env.mainSets();
    await sleep(RTT * 4);
    ok("동기화 뒤에도 ROWS가 같다", JSON.stringify(txRows(A)) === JSON.stringify(after));
    ok("결과가 같으면 다시 그리지 않는다(깜빡임 없음)", A.env.mainSets() === setsBefore,
       `innerHTML ${A.env.mainSets() - setsBefore}회 재주입`);
  }

  // ── 4. 다른 기기 입력이 동기화로 들어오면 그때는 다시 그린다 ──
  {
    const db = seed();
    const A = boot(db, () => 5);
    await A.ev("loadAll()");
    db.transactions.push(norm({ id: uuid(), date: db.today, amount: 777, type: "지출", category: "식비",
                                member: "지현", account: "신한", memo: "다른 폰" }));
    const s0 = A.env.mainSets();
    await A.ev("syncInBackground()");
    ok("새 데이터가 오면 다시 그린다", A.env.mainSets() > s0 && txRows(A).some(r => r.memo === "다른 폰"));
  }

  // ── 5. 응답 역전: 먼저 출발한 동기화가 늦게 와도 새 행을 지우지 않는다 ──
  {
    const db = seed();
    let nFull = 0;
    // 거래 전량 select만: 첫 동기화는 느리게(250ms), 두 번째는 빠르게
    const A = boot(db, c => c.table === "transactions" && c.op === "select" && !c.gte ? (++nFull === 2 ? 250 : 10) : 10);
    await A.ev("loadAll()");                       // nFull=1 (초기 로드)
    const p1 = A.ev("loadAll()");                  // nFull=2 — 느림, 아래 insert 전 상태를 읽는다
    await sleep(20);
    db.transactions.push(norm({ id: uuid(), date: db.today, amount: 1, type: "지출", category: "식비",
                                member: "정우", account: "국민", memo: "늦게 들어온 행" }));
    const p2 = A.ev("loadAll()");                  // nFull=3 — 빠름
    const [r1, r2] = await Promise.all([p1, p2]);
    ok("늦게 온 옛 응답은 버려진다(false)", r1 === false && r2 === true);
    ok("최신 응답의 행이 남는다", txRows(A).some(r => r.memo === "늦게 들어온 행"),
       "먼저 출발한 쪽이 늦게 와서 방금 들어온 행을 지웠다");
  }

  // ── 6. 수정 · 이동 · 삭제 · 한도 ─────────────────────────
  {
    const db = seed();
    const A = boot(db, () => 5);
    await A.ev("loadAll()");
    const target = db.transactions.find(r => r.type === "지출");
    A.ev(`editId='${target.id}'; memberVal='${target.member}'; typeVal='지출'`);
    A.$("fDate").value = target.date; A.$("fAmount").value = "99,000";
    A.$("fCategory").value = target.category; A.$("fAccount").value = target.account; A.$("fMemo").value = "고침";
    const n0 = txRows(A).length;
    await A.ev("saveEntry()");
    const e = txRows(A).find(r => r.id === target.id);
    ok("수정이 즉시 반영된다(건수 그대로)", txRows(A).length === n0 && e && e.amount === 99000 && e.memo === "고침");

    A.ev("editId=null; typeVal='이동'; memberVal='정우'");
    A.$("fAmount").value = "50,000"; A.$("fFromAccount").value = "국민"; A.$("fToAccount").value = "신한"; A.$("fMemo").value = "";
    await A.ev("saveEntry()");
    const legs = txRows(A).filter(r => r.category === "계좌간 이동");
    ok("이동 2건이 즉시 반영된다", legs.length === 2 && legs.some(r => r.type === "입금") && legs.some(r => r.type === "지출"));

    await sleep(40);
    await A.ev(`delEntry('${legs[0].id}')`);
    ok("이동 삭제는 짝까지 즉시 빠진다", txRows(A).filter(r => r.category === "계좌간 이동").length === 0);

    A.$("lim_정우_교통").value = "50,000";
    await A.ev("saveLimit('정우','교통')");
    ok("한도 저장이 즉시 반영된다", A.ev("LIMITS['정우']['교통']") === 50000);
    A.$("lim_정우_식비").value = "";
    await A.ev("saveLimit('정우','식비')");
    ok("빈값 저장은 한도를 즉시 지운다", A.ev("LIMITS['정우']['식비']") === undefined);
    await sleep(40);
    ok("동기화 뒤 DB와 일치", JSON.stringify(txRows(A).map(r => r.id)) === JSON.stringify(dbRowsSorted(db)));
  }

  console.log(fails ? `\n${fails}건 FAIL` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
