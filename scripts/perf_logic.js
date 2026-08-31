// 앱 '계산' 쪽 성능 — 네트워크가 아니라 JS 실행 시간을 잰다.
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\perf_logic.js
//   node ...\perf_logic.js --max=40000      # 스트레스 상한 조절
//   node ...\perf_logic.js --reps=9         # 반복 횟수(중앙값)
//
// 왜 필요한가: measure_load.js·measure_timeline.js는 **네트워크**만 본다. 데이터가 늘 때
// 진짜로 무너지는 건 집계·렌더 쪽인데 그걸 재는 도구가 없었다. 절대값보다 **차수**가 중요하다 —
// 행이 4배일 때 시간이 4배면 O(n), 16배면 O(n²)다. 후자는 지금 빨라도 언젠가 앱을 세운다.
//
// ⚠️ 절대값은 이 PC(데스크톱) 기준이다. 폰은 대략 4배 느리다고 보면 된다
//    (CLAUDE.md의 CPU 4배 스로틀 관행과 같은 근사).
// ⚠️ 실 DB를 건드리지 않는다 — 실제 분포(카테고리 14·계좌 5·결제수단 13·이동 10%·입금 16%)만
//    본떠 합성한다. 메모 등 실제 내용은 쓰지 않는다.
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const MAX  = Number((args.find(a => a.startsWith("--max=")) || "--max=40000").slice(6));
const REPS = Number((args.find(a => a.startsWith("--reps=")) || "--reps=7").slice(7));
const SRC  = args.find(a => a.endsWith(".html")) || path.join(__dirname, "..", "public", "index.html");

const html = fs.readFileSync(SRC, "utf8");
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

// ── stub 환경 ──────────────────────────────────────────────
function makeEnv() {
  const store = new Map();
  const els = new Map();
  const el = () => ({ style: { setProperty(){}, removeProperty(){} },
                      classList: { add(){}, remove(){}, toggle(){}, contains:()=>false },
                      addEventListener(){}, removeEventListener(){}, appendChild(){}, setAttribute(){},
                      focus(){}, getBoundingClientRect:()=>({top:0,left:0,width:0,height:0}),
                      innerHTML: "", textContent: "", value: "", scrollTop: 0, checked:false, dataset:{} });
  const doc = {
    createElement: () => el(), head:{ appendChild(){} }, body: el(),
    documentElement: el(),
    getElementById: id => { if(!els.has(id)) els.set(id, el()); return els.get(id); },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener(){}, removeEventListener(){},
  };
  const win = {
    Chart: undefined, addEventListener(){}, removeEventListener(){},
    matchMedia: () => ({ matches:false, addEventListener(){} }),
    requestIdleCallback: null, scrollTo(){}, scrollY: 0,
    location:{ reload(){}, href:"" },
    getComputedStyle: () => ({ getPropertyValue: () => "#888888" }),
    IntersectionObserver: function(){ this.observe=()=>{}; this.disconnect=()=>{}; },
  };
  return {
    document: doc, window: win, els,
    localStorage: { getItem: k => store.has(k)?store.get(k):null,
                    setItem: (k,v)=>{store.set(k,String(v));}, removeItem: k=>{store.delete(k);}, _store: store },
    supabase: { createClient: () => ({ auth:{ getSession: async()=>({data:{session:null}}), onAuthStateChange(){} } }) },
    getComputedStyle: win.getComputedStyle,
    Chart: undefined, setTimeout, clearTimeout, console, Intl, Date, Math, JSON,
    navigator:{ userAgent:"node" }, fetch: async()=>({ok:true,json:async()=>({})}),
    IntersectionObserver: win.IntersectionObserver,
    __T: {},
  };
}
function load(){
  const env = makeEnv();
  const names = Object.keys(env);
  const fn = new Function(...names, code + "\n;return (expr)=>eval(expr);");
  return { ev: fn(...names.map(n => env[n])), env };
}

// ── 실제 분포를 본뜬 합성 행 ────────────────────────────────
const CATS = ["식비","교통","생활","의료","문화","교육","통신","주거","보험","경조사","의류","미용","반려","기타"];
const ACCTS = ["국민은행","신한은행","카카오뱅크","현대카드","토스"];
const METHODS = ["현대카드","신한체크","카카오페이","현금","계좌이체","삼성카드","네이버페이",
                 "국민카드","토스페이","우리체크","배민페이","기프트카드","제로페이"];
const MEMBERS = ["정우","지현"];
const TRANSFER_CAT = "계좌간 이동";

// 밀도를 실제와 맞춘다: 629행 / 9개월 ≈ 70행/월. N이 커지면 기간이 길어진다(주기 수도 함께 는다)
function makeRows(n){
  const rows = [];
  const months = Math.max(9, Math.round(n / 70));
  const end = new Date(2026, 7, 28);
  const start = new Date(end.getFullYear(), end.getMonth() - months, 1);
  const span = end - start;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + rnd() * span);
    const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const isTrf = rnd() < 0.105;                       // 실제 66/629
    const isInc = !isTrf && rnd() < 0.19;              // 실제 102/629
    rows.push({
      id: "r" + i, date,
      member: MEMBERS[i % 2],
      type: isTrf ? (i % 2 ? "지출" : "입금") : (isInc ? "입금" : "지출"),
      category: isTrf ? TRANSFER_CAT : CATS[Math.floor(rnd()*CATS.length)],
      account: ACCTS[Math.floor(rnd()*ACCTS.length)],
      method: METHODS[Math.floor(rnd()*METHODS.length)],
      amount: Math.floor(rnd()*180000) + 1000,
      memo: "메모" + (i % 9999),
    });
  }
  return rows.sort((a,b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? -1 : 1));
}

// ── 계측 ──────────────────────────────────────────────────
const ms = t => Number(t) / 1e6;
function timeIt(fn, reps){
  const out = [];
  fn();                                        // 워밍업(JIT) — 첫 회는 늘 느리다
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    out.push(ms(process.hrtime.bigint() - t0));
  }
  return out.sort((a,b)=>a-b)[Math.floor(out.length/2)];
}

const SIZES = [629, 2500, 10000, MAX].filter((v,i,a) => a.indexOf(v)===i && v<=MAX).sort((a,b)=>a-b);

// [이름, 준비(선택), 실행식] — 실행식은 스크립트 스코프에서 eval 된다
const CASES = [
  ["bucketByPeriod(6주기)", null, "bucketByPeriod(ROWS, 6, MEMBERS[0])"],
  ["aggCat(카테고리)",       null, "aggCat(ROWS, 'category')"],
  ["aggCat(결제수단)",       null, "aggCat(ROWS, 'method')"],
  ["orphanTransfers",       null, "orphanTransfers()"],
  ["taxCalc",               null, "taxCalc(MEMBERS[0])"],
  ["myRows(멤버필터)",       "memberFilter=MEMBERS[0]", "myRows()"],
  ["scoped(이번주기)",       "tab='list';scope='current';periodOffset=0", "scoped()"],
  ["scoped(전체)",           "tab='list';scope='all'",  "scoped()"],
  ["viewList(전체)",         "tab='list';scope='all';searchQ=''", "viewList()"],
  // 검색은 200ms 디바운스 뒤 #listResults만 부분 갱신한다 — 타이핑마다 도는 경로라 따로 본다
  ["listResultsHtml(검색)",  "tab='list';scope='all';searchQ='메모1'", "listResultsHtml()"],
  ["listResultsHtml(무검색)", "tab='list';scope='all';searchQ=''", "listResultsHtml()"],
  ["viewCategory",          "tab='cat';scope='current'", "viewCategory()"],
  ["viewLimit",             "tab='limit'", "viewLimit()"],
  ["viewAnalysis",          "tab='analysis';anView='spend'", "viewAnalysis()"],
  ["viewTaxYear",           "tab='analysis';anView='tax'", "viewTaxYear()"],
  ["viewAccount",           "tab='acct'", "viewAccount()"],
  ["saveSnapshot",          null, "saveSnapshot(__T.payload)"],
  ["readSnapshot",          null, "readSnapshot()"],
  ["render(내역)",           "tab='list';scope='current';periodOffset=0", "render()"],
  ["render(분석)",           "tab='analysis';anView='spend'", "render()"],
  ["render(계좌)",           "tab='acct'", "render()"],
];

const results = {};   // 이름 → {크기: ms}

for (const n of SIZES) {
  const { ev, env } = load();
  const rows = makeRows(n);
  env.__T.rows = rows;
  env.__T.payload = {
    mem:{data:MEMBERS.map(m=>({name:m})),error:null}, tx:{data:rows,error:null},
    lim:{data:[],error:null}, mst:{data:[],error:null}, cfg:{data:[],error:null}, mtm:{data:[],error:null},
  };
  // 전역을 실제 로드 결과와 같은 모양으로 세운다
  ev(`applyLoad(__T.payload)`);
  ev(`ROWS = __T.rows`);
  ev(`MASTER = {}; MEMBERS.forEach(m => MASTER[m] = {categories:${JSON.stringify(CATS)},
       methods:${JSON.stringify(METHODS)}, accounts:${JSON.stringify(ACCTS)}})`);
  ev(`LIMITS = {}; MEMBERS.forEach(m => { LIMITS[m]={}; ${JSON.stringify(CATS)}.forEach(c => LIMITS[m][c]=300000); })`);
  ev(`MTMAP={}; CTMAP={}; MEMBERS.forEach(m=>{ MTMAP[m]={}; CTMAP[m]={};
       ${JSON.stringify(METHODS)}.forEach((v,i)=>MTMAP[m][v]= i%3===0?'credit':i%3===1?'check':'cash');
       CTMAP[m]['기타']='income'; })`);
  ev(`TAX_READY=true; ROWS_PARTIAL=false; loadError=null; loadWarn=[]; memberFilter='전체'`);

  // ⚠️ 케이스마다 화면 상태를 초기화한다. 안 하면 앞 케이스의 memberFilter가 남아
  //    다음 케이스가 절반의 행만 처리하고, 그 수치가 조용히 작게 나온다
  //    (2026-09-01에 실제로 viewAnalysis가 자기 안의 bucketByPeriod보다 싸게 나왔다).
  const RESET = "tab='list';scope='current';periodOffset=0;memberFilter='전체';searchQ='';" +
                "anView='spend';catBy='category';limitMember=MEMBERS[0];masterMember=MEMBERS[0];tyMember=MEMBERS[0]";
  for (const [name, prep, expr] of CASES) {
    ev(RESET);
    if (prep) ev(prep);
    let t;
    try { t = timeIt(() => ev(expr), REPS); }
    catch (e) { t = null; if(!results[name]) results[name]={}; results[name].err = e.message; }
    (results[name] = results[name] || {})[n] = t;
  }
}

// ── 출력 ──────────────────────────────────────────────────
const pad = (s, w) => String(s).padEnd(w);
const num = t => t == null ? "  -  " : (t < 10 ? t.toFixed(2) : t.toFixed(0)).padStart(7);

console.log(`\n대상: ${path.basename(SRC)} · 반복 ${REPS}회 중앙값 · 데스크톱 기준(폰은 ~4배)\n`);
console.log(pad("함수", 22) + SIZES.map(n => (n + "행").padStart(8)).join("") + "     차수");
console.log("─".repeat(22 + SIZES.length * 8 + 12));

const flags = [];
for (const [name] of CASES) {
  const r = results[name] || {};
  const first = r[SIZES[0]], last = r[SIZES[SIZES.length-1]];
  let order = "-";
  if (first != null && last != null && first > 0.02) {
    const nRatio = SIZES[SIZES.length-1] / SIZES[0];
    const tRatio = last / first;
    const exp = Math.log(tRatio) / Math.log(nRatio);       // t ∝ n^exp
    order = exp < 0.4 ? "O(1)" : exp < 1.45 ? "O(n)" : exp < 1.8 ? `n^${exp.toFixed(1)}` : `O(n²)⚠`;
    if (exp >= 1.45) flags.push([name, exp, last]);
  }
  console.log(pad(name, 22) + SIZES.map(n => num(r[n])).join("") + "     " + order);
  if (r.err) console.log(pad("", 22) + "  ⚠ " + r.err);
}

console.log("");
if (flags.length) {
  console.log("⚠ 선형을 넘는 항목:");
  flags.forEach(([n, e, t]) => console.log(`   ${n} — n^${e.toFixed(2)}, ${MAX}행에서 ${t.toFixed(0)}ms`));
} else {
  console.log("이차 복잡도 없음 — 전부 선형 이하");
}
// 폰 근사로 체감선(첫 화면 100ms / 상호작용 200ms)을 넘는 것
const SLOW = SIZES[SIZES.length-1];
const heavy = CASES.map(([n]) => [n, (results[n]||{})[SLOW]])
                   .filter(([, t]) => t != null && t * 4 > 200);
if (heavy.length) {
  console.log(`\n폰 근사(×4)로 ${SLOW}행에서 200ms를 넘는 것:`);
  heavy.sort((a,b)=>b[1]-a[1]).forEach(([n,t]) => console.log(`   ${pad(n,22)} ${(t*4).toFixed(0)}ms`));
}
console.log("");
