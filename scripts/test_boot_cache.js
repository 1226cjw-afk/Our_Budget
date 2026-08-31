// 첫 화면 부팅 경로 단위테스트 (브라우저·프레임워크 없이, ~1초).
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\test_boot_cache.js [다른파일.html]
//
// 왜 필요한가: 첫 화면을 빠르게 하려고 두 가지를 넣었는데, 둘 다 **조용히 틀리는** 종류다.
//
//   ① localStorage 스냅샷으로 즉시 렌더 — 캐시 복원 경로가 DB 경로와 어긋나면
//      화면엔 그럴듯한 숫자가 뜨는데 실제 DB와 다르다. 오류도 안 난다.
//      그래서 캐시는 '파생된 전역'이 아니라 '쿼리 원본 응답'을 담고 복원도 applyLoad를 그대로 탄다.
//      이 테스트는 저장→복원→applyLoad 가 직접 로드와 **바이트 동일한 전역**을 만드는지 본다.
//
//   ② 최근 45일만 먼저 받아 렌더(ROWS_PARTIAL) — 이때 계좌 잔액·연말정산 공제액을 그리면
//      반쪽 데이터로 계산된 숫자가 나간다. 전액이 아니라 '그럴듯하게 적은' 값이라
//      사용자가 틀린 줄 모른다. needsFullRows() 가드가 그 화면들을 막는지 본다.
//
// ⚠️ 실 DB를 건드리지 않는다 — 가짜 응답 객체만 쓴다(테스트 DB 없음, 가족 실데이터다).
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2] || path.join(__dirname, "..", "public", "index.html");
const html = fs.readFileSync(SRC, "utf8");
// 손으로 복사하지 않고 원본에서 뽑는다 — 복사본은 원본이 바뀌어도 옛 코드를 검증한다
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

let fails = 0;
const ok = (name, cond, note) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && note ? "  — " + note : ""}`);
};

// ── stub 환경 ──────────────────────────────────────────────
function makeEnv() {
  const store = new Map();
  const els = new Map();
  const el = () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){}, contains:()=>false },
                      addEventListener(){}, appendChild(){}, setAttribute(){}, focus(){},
                      innerHTML: "", textContent: "", value: "", scrollTop: 0 });
  const doc = {
    createElement: () => el(),
    head: { appendChild(){} },
    body: el(),
    documentElement: el(),
    getElementById: id => { if(!els.has(id)) els.set(id, el()); return els.get(id); },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(){}, removeEventListener(){},
  };
  const win = {
    Chart: undefined, addEventListener(){}, removeEventListener(){},
    matchMedia: () => ({ matches: false, addEventListener(){} }),
    requestIdleCallback: null, scrollTo(){}, scrollY: 0,
    location: { reload(){}, href: "" },
    IntersectionObserver: function(){ this.observe=()=>{}; this.disconnect=()=>{}; },
  };
  const env = {
    document: doc, window: win, els,
    localStorage: {
      getItem: k => store.has(k) ? store.get(k) : null,
      setItem: (k,v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
      _store: store,
    },
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }),
                                               onAuthStateChange(){} } }) },
    Chart: undefined,
    setTimeout, clearTimeout, console, Intl, Date, Math, JSON,
    navigator: { userAgent: "node" }, fetch: async () => ({ ok: true, json: async () => ({}) }),
    IntersectionObserver: win.IntersectionObserver,
    __T: {},   // 테스트가 스크립트 스코프로 값을 넘기는 통로
  };
  return env;
}

function load() {
  const env = makeEnv();
  const names = Object.keys(env);
  const fn = new Function(...names, code + "\n;return (expr)=>eval(expr);");
  return { ev: fn(...names.map(n => env[n])), env };
}

// 실제 DB 응답과 같은 모양의 가짜 6종 (멤버 2명 · 시작일 다름 — 이 앱의 실제 상태)
const payload = () => ({
  mem: { data: [{ name:"정우" }, { name:"지현" }], error: null },
  tx:  { data: [
          { id:"a1", date:"2026-08-20", member:"정우", type:"지출", category:"식비",
            account:"국민", method:"신용", amount:12000, memo:"점심" },
          { id:"a2", date:"2026-06-02", member:"지현", type:"입금", category:"급여",
            account:"신한", method:"이체", amount:3000000, memo:"" },
        ], error: null },
  lim: { data: [{ member:"정우", category:"식비", monthly_limit:300000 }], error: null },
  mst: { data: [{ member:"정우", type:"category", value:"식비" },
                { member:"정우", type:"method",   value:"신용" },
                { member:"지현", type:"account",  value:"신한" }], error: null },
  cfg: { data: [{ key:"billing_start_정우", value:"25" },
                { key:"billing_start_지현", value:"21" },
                { key:"warn_threshold",     value:"85" },
                { key:"analysis_periods",   value:"4"  },
                { key:"ty_salary_정우",     value:"52000000" },
                { key:"cat_icon_식비",      value:"🍚" }], error: null },
  mtm: { data: [{ member:"정우", type:"method",   value:"신용", kind:"credit" },
                { member:"정우", type:"category", value:"급여", kind:"income" }], error: null },
});

// applyLoad 가 만들어내는 전역 전부 — 하나라도 빠지면 캐시 화면이 조용히 달라진다
const GLOBALS = "JSON.stringify({MEMBERS,ROWS,LIMITS,MASTER,BILLING_STARTS,USER_ICONS," +
                "WARN_TH,AN_PERIODS,MTMAP,CTMAP,TAX_READY,TY_SALARY,loadWarn})";

// ── 1. 소스 구조 ───────────────────────────────────────────
ok("applyLoad 가 분리돼 있다", /function applyLoad\s*\(/.test(code),
   "파생이 loadAll 안에만 있으면 캐시 복원이 따로 파생하게 되고 둘이 갈린다");
ok("loadAll 이 applyLoad 를 쓴다", /applyLoad\s*\(/.test(code) && /async function loadAll/.test(code));
ok("ROWS_PARTIAL 전역이 있다", /ROWS_PARTIAL/.test(code));
ok("needsFullRows 가드가 있다", /function needsFullRows\s*\(/.test(code));
ok("render 가 부분 데이터를 가드한다", /ROWS_PARTIAL\s*&&\s*needsFullRows\(\)/.test(code),
   "가드가 없으면 반쪽 데이터로 잔액·공제액이 계산돼 나간다");
ok("스냅샷 저장·복원·삭제 3종이 있다",
   /function saveSnapshot/.test(code) && /function readSnapshot/.test(code) && /function clearSnapshot/.test(code));

// ⚠️ 이 기능의 전부는 '순서'다. bootFromSnapshot이 await getSession() 뒤로 밀리면
//    앱은 멀쩡히 동작하는데 효과만 사라진다 — 화면으로는 절대 안 보이는 회귀라 여기서 잡는다.
//    (getSession은 토큰이 만료됐으면 갱신 왕복을 await 한다. 그게 우리가 앞지르려는 대상이다)
function fnBody(s, anchor){
  const i = s.indexOf(anchor);
  if(i < 0) return null;
  const open = s.indexOf("{", i);
  if(open < 0) return null;
  let d = 0;
  for(let j = open; j < s.length; j++){
    if(s[j] === "{") d++;
    else if(s[j] === "}"){ d--; if(!d) return s.slice(open, j + 1); }
  }
  return null;
}
{
  const boot = fnBody(code, 'document.addEventListener("DOMContentLoaded"');
  const iSnap = boot ? boot.indexOf("bootFromSnapshot()") : -1;
  const iSess = boot ? boot.indexOf("await sb.auth.getSession()") : -1;
  ok("시작 핸들러에 캐시 렌더와 getSession이 둘 다 있다", iSnap > 0 && iSess > 0);
  ok("캐시 렌더가 getSession await 보다 먼저다", iSnap > 0 && iSess > 0 && iSnap < iSess,
     "뒤로 밀리면 토큰 갱신 왕복을 다시 기다린다 — 개선이 통째로 사라진다");
  ok("bootFromSnapshot이 실제로 그린다", /function bootFromSnapshot[\s\S]{0,600}?render\(\)/.test(code));
}

// ── 2. 캐시 왕복이 직접 로드와 동일한 전역을 만드는가 ──────────
{
  const A = load();
  A.env.__T.p = payload();
  A.ev("applyLoad(__T.p)");
  const direct = A.ev(GLOBALS);
  const saved  = A.ev("saveSnapshot(__T.p)");
  ok("완전한 응답이면 스냅샷이 저장된다", saved === true);

  const raw = A.env.localStorage.getItem("ourbudget.snapshot");
  ok("스냅샷이 localStorage 에 들어간다", typeof raw === "string" && raw.length > 0);

  // 새 세션(= 다음 접속)에서 같은 캐시를 복원한다
  const B = load();
  B.env.localStorage.setItem("ourbudget.snapshot", raw);
  const restored = B.ev("readSnapshot()");
  ok("readSnapshot 이 6종을 되돌린다", !!restored && !!restored.mem && !!restored.tx);
  B.env.__T.r = restored;
  B.ev("applyLoad(__T.r)");
  const viaCache = B.ev(GLOBALS);

  ok("캐시 복원 전역 === 직접 로드 전역", viaCache === direct,
     "복원 경로가 파생을 다르게 한다 — 캐시 화면이 DB 화면과 어긋난다");
  // 실제로 값이 들어 있는지도 확인 (둘 다 빈 값이면 위 비교는 무의미하게 통과한다)
  const g = JSON.parse(direct);
  ok("파생이 실제로 채워졌다", g.MEMBERS.length === 2 && g.ROWS.length === 2 &&
     g.BILLING_STARTS["지현"] === 21 && g.WARN_TH === 85 && g.AN_PERIODS === 4 &&
     g.USER_ICONS["식비"] === "🍚" && g.TAX_READY === true);
}

// ── 3. 스냅샷 위생 ─────────────────────────────────────────
{
  const A = load();
  const p = payload();
  p.lim = { data: null, error: { message: "boom" } };
  A.env.__T.p = p;
  ok("부분 실패한 응답은 저장하지 않는다", A.ev("saveSnapshot(__T.p)") === false,
     "폴백이 섞인 캐시를 다음 접속에 '사용자 설정'처럼 보여주게 된다");

  const B = load();
  B.env.localStorage.setItem("ourbudget.snapshot", JSON.stringify({ v: 999, mem: [], tx: [] }));
  ok("버전이 다른 캐시는 버린다", B.ev("readSnapshot()") === null);

  const C = load();
  C.env.localStorage.setItem("ourbudget.snapshot", "{깨진 JSON");
  ok("깨진 캐시는 null 로 떨어진다(예외 아님)", C.ev("readSnapshot()") === null);

  const D = load();
  D.ev("clearSnapshot()");
  ok("clearSnapshot 이 예외 없이 돈다", true);
  const E = load();
  E.env.__T.p = payload();
  E.ev("saveSnapshot(__T.p)");
  E.ev("clearSnapshot()");
  ok("clearSnapshot 이 실제로 지운다", E.env.localStorage.getItem("ourbudget.snapshot") === null);
}

// ── 4. 부분 데이터 가드 매트릭스 ─────────────────────────────
// 45일 창 안에서 답이 맞는 화면만 통과시킨다. 나머지는 숫자 대신 로딩.
{
  const A = load();
  const cases = [
    // [tab, scope, periodOffset, 전체내역이 필요한가]
    ["list",     "current",  0, false],   // 이번 주기 = 45일 안
    ["cat",      "current",  0, false],
    ["limit",    "current",  0, false],
    ["master",   "current",  0, false],
    ["list",     "all",      0, true ],   // 전체 범위
    ["list",     "current", -1, true ],   // 지난 주기 탐색
    ["cat",      "current", -2, true ],
    ["analysis", "current",  0, true ],   // 최근 N주기 · 연말정산 역년
    ["acct",     "current",  0, true ],   // 전기간 잔액
  ];
  let allOk = true, detail = [];
  cases.forEach(([t, s, off, want]) => {
    A.ev(`tab=${JSON.stringify(t)}; scope=${JSON.stringify(s)}; periodOffset=${off}`);
    const got = A.ev("needsFullRows()");
    if (got !== want) { allOk = false; detail.push(`${t}/${s}/${off}: ${got} (기대 ${want})`); }
  });
  ok("needsFullRows 매트릭스 9종", allOk, detail.join(", "));
}

// ── 5. render 가 부분 상태에서 숫자를 안 그린다 ───────────────
{
  const A = load();
  A.env.__T.p = payload();
  A.ev("applyLoad(__T.p)");
  A.ev("ROWS_PARTIAL=true; tab='acct'; scope='current'; periodOffset=0; loadError=null");
  A.ev("render()");
  const out = A.env.document.getElementById("main").innerHTML;
  ok("부분 상태의 계좌 탭은 로딩을 낸다", /불러오는 중/.test(out),
     "반쪽 데이터로 계산된 잔액이 그대로 나갔다");
  ok("부분 상태의 계좌 탭에 금액이 없다", !/원<\/|amt/.test(out) || /불러오는 중/.test(out));

  A.ev("ROWS_PARTIAL=false");
  A.ev("render()");
  const full = A.env.document.getElementById("main").innerHTML;
  ok("전량이 오면 계좌 탭이 실제로 그려진다", !/불러오는 중/.test(full) && full.length > 0);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
