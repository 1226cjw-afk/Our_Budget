// 입력 시트 습관 기본값 + iOS 확대 방지 단위테스트 — 브라우저·실 DB 없이 ~1초.
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\test_input_habit.js [다른파일.html]
//
// 무엇을 지키나 (전부 '조용히' 틀리는 종류):
//   ① 피커가 자주 쓰는 순으로 정렬되는가 — 동률은 설정 순서 유지
//   ② 계좌 자동 선택이 '그 카테고리의 단골 계좌'인가, 사용자가 직접 고른 계좌를 덮지 않는가
//   ③ 설정에서 지운 계좌를 자동 선택으로 되살리지 않는가 (지운 계좌에 조용히 쌓이면 잔액이 틀어진다)
//   ④ 입력칸 글자가 16px 이상인가 — 미만이면 iOS가 포커스 때 화면을 확대하고 안 돌린다
// ⚠️ 실 DB를 건드리지 않는다.
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2] || path.join(__dirname, "..", "public", "index.html");
const html = fs.readFileSync(SRC, "utf8");
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];

let fails = 0;
const ok = (name, cond, note) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && note ? "  — " + note : ""}`);
};

// <select> 흉내 — innerHTML의 <option>을 파싱하고 value/selectedIndex를 맞춘다
function selectEl() {
  const s = { style: {}, classList: { add(){}, remove(){}, contains: () => false }, options: [], _i: -1, focused: 0 };
  Object.defineProperty(s, "innerHTML", { set(h) {
    s.options = [...h.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(m => ({ value: m[1], text: m[2] }));
    s._i = s.options.length ? 0 : -1;
  }, get: () => "" });
  Object.defineProperty(s, "value", {
    get: () => (s.options[s._i] || { value: "" }).value,
    set(v) { s._i = s.options.findIndex(o => o.value === v); },
  });
  Object.defineProperty(s, "selectedIndex", { get: () => s._i, set(i) { s._i = i; } });
  s.add = o => s.options.push({ value: o.value, text: o.text });
  return s;
}
function boot() {
  const els = new Map();
  const el = () => ({ style: {}, classList: { add(){}, remove(){}, contains: () => false },
                      addEventListener(){}, focus(){ el.lastFocus = this; }, innerHTML: "", textContent: "", value: "" });
  for (const id of ["fCategory", "fMethod", "fAccount", "fFromAccount", "fToAccount"]) els.set(id, selectEl());
  const focusLog = [];
  const doc = {
    getElementById: id => {
      if (!els.has(id)) { const e = el(); e.focus = () => focusLog.push(id); els.set(id, e); }
      return els.get(id);
    },
    createElement: () => el(), head: { appendChild(){} }, body: el(), documentElement: el(),
    querySelector: () => null, querySelectorAll: () => [], addEventListener(){},
  };
  const env = {
    document: doc, window: { addEventListener(){}, matchMedia: () => ({ addEventListener(){} }), scrollTo(){}, scrollY: 0 },
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    supabase: { createClient: () => ({}) }, Chart: undefined, setTimeout, clearTimeout, console, Intl, Date, Math, JSON,
    navigator: {}, fetch: async () => ({}), IntersectionObserver: function(){ this.observe = () => {}; this.disconnect = () => {}; },
    getComputedStyle: () => ({ getPropertyValue: () => "" }), confirm: () => true, alert(){}, innerHeight: 800, __T: {},
  };
  const keys = Object.keys(env);
  const ev = new Function(...keys, code + "\n;return (expr)=>eval(expr);")(...keys.map(k => env[k]));
  return { ev, env, $: id => doc.getElementById(id), focusLog };
}

// 최근이 앞(날짜 내림차순) — ROWS와 같은 순서
const R = (date, category, account, method = "", member = "정우") => ({ id: date + category + account, date, member, type: "지출", category, account, method, amount: 1000, memo: "" });
function seed(A) {
  A.env.__T.rows = [
    R("2026-10-05", "카페", "현대카드", "신용"),
    R("2026-10-04", "식비", "국민은행", "체크"),
    R("2026-10-03", "카페", "현대카드", "신용"),
    R("2026-10-02", "카페", "국민은행", "체크"),
    R("2026-10-01", "교통", "신한", "체크"),
    R("2026-09-30", "식비", "국민은행", "체크"),
    R("2026-09-29", "식비", "국민은행", "체크"),
    R("2026-09-28", "카페", "현대카드", "신용", "지현"),   // 남의 행은 습관에 섞이지 않는다
    { ...R("2026-09-27", "계좌간 이동", "신한"), category: "계좌간 이동" },   // 이동도 제외
  ];
  A.ev(`MEMBERS=["정우","지현"]; ROWS=stampRows(__T.rows); LIMITS={정우:{},지현:{}};
        MASTER={정우:{categories:["식비","교통","카페","의료"],methods:["신용","체크"],accounts:["신한","국민은행","현대카드"]},
                지현:{categories:["식비"],methods:[],accounts:["우리"]}};
        memberVal="정우"; editId=null;`);
}
const opts = (A, id) => A.$(id).options.map(o => o.value);

// ── ① 자주 쓰는 순 정렬 ───────────────────────────────────
{
  const A = boot(); seed(A);
  A.ev("refreshCatList()");
  ok("카테고리가 사용 횟수순 (식비·카페 3회 동률은 설정 순서대로)",
     JSON.stringify(opts(A, "fCategory")) === JSON.stringify(["식비", "카페", "교통", "의료"]),
     opts(A, "fCategory").join(","));
  ok("계좌가 사용 횟수순 + '계좌 선택'이 맨 앞",
     JSON.stringify(opts(A, "fAccount")) === JSON.stringify(["", "국민은행", "현대카드", "신한"]),
     opts(A, "fAccount").join(","));
  ok("결제수단도 사용 횟수순 + '선택 안함'이 맨 앞",
     JSON.stringify(opts(A, "fMethod")) === JSON.stringify(["", "체크", "신용"]), opts(A, "fMethod").join(","));
}

// ── ② 카테고리별 단골 계좌 ────────────────────────────────
{
  const A = boot(); seed(A);
  A.ev("openSheet()");
  ok("시트를 열면 첫 카테고리(식비)의 단골 계좌가 골라진다", A.$("fAccount").value === "국민은행", A.$("fAccount").value);
  ok("자동 선택 표시가 켜진다", A.ev("acctAuto") === true && A.$("fAccountHint").style.display === "");
  ok("시트를 열면 금액 칸에 포커스", A.focusLog.includes("fAmount"), A.focusLog.join(","));

  A.ev(`pickerSel="fCategory"; pickOptIdx(${opts(A, "fCategory").indexOf("카페")})`);
  ok("카테고리를 카페로 바꾸면 카페의 단골(현대카드)로 따라간다", A.$("fAccount").value === "현대카드", A.$("fAccount").value);

  A.ev(`pickerSel="fAccount"; pickOptIdx(${opts(A, "fAccount").indexOf("신한")})`);
  ok("계좌를 직접 고르면 표시가 꺼진다", A.ev("acctAuto") === false && A.$("fAccountHint").style.display === "none");
  A.ev(`pickerSel="fCategory"; pickOptIdx(${opts(A, "fCategory").indexOf("식비")})`);
  ok("직접 고른 계좌는 카테고리를 바꿔도 덮지 않는다", A.$("fAccount").value === "신한", A.$("fAccount").value);

  A.ev(`pickerSel="fCategory"; pickOptIdx(${opts(A, "fCategory").indexOf("의료")})`);
  ok("쓴 적 없는 카테고리면 계좌를 건드리지 않는다(직접 고른 상태 유지)", A.$("fAccount").value === "신한");

  const B = boot(); seed(B);
  B.ev("openSheet()");
  B.ev(`pickerSel="fCategory"; pickOptIdx(${opts(B, "fCategory").indexOf("의료")})`);
  ok("쓴 적 없는 카테고리는 그 멤버의 최다 계좌로", B.$("fAccount").value === "국민은행", B.$("fAccount").value);
}

// ── ③ 지운 계좌는 되살리지 않는다 ──────────────────────────
{
  const A = boot(); seed(A);
  A.ev(`MASTER["정우"].accounts=["신한","현대카드"]`);   // 국민은행을 설정에서 지웠다
  A.ev("openSheet()");
  ok("설정에서 지운 계좌는 자동 선택하지 않는다", A.$("fAccount").value === "" && A.ev("acctAuto") === false,
     A.$("fAccount").value);
}

// ── 수정 시트는 저장된 계좌 그대로 ─────────────────────────
{
  const A = boot(); seed(A);
  const id = A.env.__T.rows[0].id;   // 카페·현대카드
  A.ev(`editEntry('${id}')`);
  ok("수정 시트는 저장된 계좌 그대로, 자동 표시 없음",
     A.$("fAccount").value === "현대카드" && A.ev("acctAuto") === false);
  A.ev(`pickerSel="fCategory"; pickOptIdx(${opts(A, "fCategory").indexOf("식비")})`);
  ok("수정 중 카테고리를 바꿔도 계좌를 덮지 않는다", A.$("fAccount").value === "현대카드", A.$("fAccount").value);
}

// ── ④ iOS 확대 방지: 입력칸 16px 이상 ──────────────────────
{
  const sizeOf = sel => {
    const m = css.match(new RegExp("(^|\\n)" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}"));
    const f = m && m[2].match(/font-size:([\d.]+)(rem|px)/);
    return f ? (f[2] === "rem" ? +f[1] * 16 : +f[1]) : null;
  };
  for (const sel of [".inp", ".search-inp", ".l-edit input", ".m-add input", ".set-in", ".auth-pw"]) {
    const px = sizeOf(sel);
    ok(`${sel} 글자 ≥ 16px (${px}px)`, px != null && px >= 16, "iOS가 포커스 때 화면을 확대한다");
  }
  ok("매핑 셀렉트는 iOS에서 16px", /@supports\s*\(-webkit-touch-callout:none\)\s*\{[^}]*\.tym-sel[^}]*font-size:16px/.test(css));
  ok(".date-native 는 16px 유지", /\.date-native\{[\s\S]*?font-size:16px/.test(css));
}

console.log(fails ? `\n${fails}건 FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
