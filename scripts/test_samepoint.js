// 분석 탭 '같은 시점' 비교 단위테스트 — 브라우저·실 DB 없이 ~1초.
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\test_samepoint.js [다른파일.html]
//
// 왜 필요한가: 이번 주기는 진행 중인데 지난 주기는 다 찬 값이라, 그대로 비교하면 주기 초반엔
// 늘 "지출 ▼64% · 평균 대비 −52%"(초록 = 잘하고 있다)가 뜨고 급증 진단은 주기 말에만 걸렸다
// (2026-10-05 실제 화면 — 11/30일째). 화면은 멀쩡해 보이고 숫자도 '맞게' 계산된 것이라 오류로 안 보인다.
// 지금은 지난 주기를 '같은 날까지'로 잘라 비교한다(samePointBuckets). 이 테스트는:
//   ① 지난 주기의 오늘 이후 행이 빠지고 이번 주기는 그대로인가 — 멤버별 시작일이 달라도
//   ② 요약 숫자(전 주기 대비·평균 대비)가 같은 시점 기준인가, 기록 전 빈 주기가 평균을 끌어내리지 않는가
//   ③ 급증 진단이 주기 중간에도 잡히는가
// 날짜는 전부 '오늘' 기준 상대값이다 — 고정 날짜는 달이 바뀌면 조용히 무력화된다(커밋 4d7d26a·69b6cb2).
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

function boot() {
  const els = new Map();
  const el = () => ({ style: {}, classList: { add(){}, remove(){}, contains: () => false }, addEventListener(){}, focus(){},
                      innerHTML: "", textContent: "", value: "" });
  const doc = { getElementById: id => { if (!els.has(id)) els.set(id, el()); return els.get(id); },
                createElement: () => el(), head: { appendChild(){} }, body: el(), documentElement: el(),
                querySelector: () => null, querySelectorAll: () => [], addEventListener(){} };
  const env = {
    document: doc, window: { addEventListener(){}, matchMedia: () => ({ addEventListener(){} }), scrollTo(){}, scrollY: 0 },
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} }, supabase: { createClient: () => ({}) }, Chart: undefined,
    setTimeout, clearTimeout, console, Intl, Date, Math, JSON, navigator: {}, fetch: async () => ({}),
    IntersectionObserver: function(){ this.observe = () => {}; this.disconnect = () => {}; },
    getComputedStyle: () => ({ getPropertyValue: () => "" }), confirm: () => true, alert(){}, innerHeight: 800, __T: {},
  };
  const keys = Object.keys(env);
  return new Function(...keys, code + "\n;return (expr)=>eval(expr);")(...keys.map(k => env[k]));
}
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

function setup(ev, rows) {
  ev(`MEMBERS=["정우","지현"]; BILLING_STARTS={정우:25,지현:21}; AN_PERIODS=3; WARN_TH=80;
      LIMITS={정우:{},지현:{}}; MASTER={정우:{categories:[],methods:[],accounts:[]},지현:{categories:[],methods:[],accounts:[]}};`);
  ev(`ROWS=stampRows(${JSON.stringify(rows)})`);
}
let _id = 0;
const row = (member, date, amount, category = "식비") =>
  ({ id: "r" + (++_id), date, member, type: "지출", category, account: "국민", method: "", amount, memo: "" });

// 각 멤버의 최근 3주기 시작 시각과 오늘 경과일(0부터)
function frame(ev, m) {
  const ps = ev(`recentPeriods(3, ${JSON.stringify(m)}).map(p=>({sT:p.sT,eT:p.eT}))`);
  const el = ev(`Math.floor((parseDate(todayStr()).getTime() - billingPeriod(${JSON.stringify(m)}).sT)/864e5)`);
  const day = (i, d) => ymd(ps[i].sT + d * 864e5 + 12 * 3600e3);       // i번째 주기의 d일째(0부터)
  const lenOf = i => Math.round((ps[i].eT - ps[i].sT) / 864e5);
  return { ps, el, day, lenOf };
}

// ── ① 지난 주기는 같은 날까지, 이번 주기는 그대로 — 멤버별 시작일 ──
{
  const ev = boot();
  setup(ev, []);
  const J = frame(ev, "정우"), H = frame(ev, "지현");
  const rows = [
    row("정우", J.day(1, 0), 1), row("정우", J.day(1, J.el), 2),
    row("정우", J.day(2, 0), 3),
    row("지현", H.day(1, 0), 4), row("지현", H.day(1, H.el), 5),
  ];
  const lateJ = J.el + 1 < J.lenOf(1), lateH = H.el + 1 < H.lenOf(1);
  if (lateJ) rows.push(row("정우", J.day(1, J.el + 1), 100));
  if (lateH) rows.push(row("지현", H.day(1, H.el + 1), 200));
  setup(ev, rows);
  const got = ev(`(()=>{ const b=bucketByPeriod(ROWS,3,"정우"); const s=samePointBuckets(b,3,"정우");
                   return {b:b.map(x=>x.map(r=>r.amount).sort((a,c)=>a-c)), s:s.map(x=>x.map(r=>r.amount).sort((a,c)=>a-c))}; })()`);
  ok("지난 주기: 오늘 경과일까지의 행은 남는다", [1, 2, 4, 5].every(a => got.s[1].includes(a)), JSON.stringify(got.s[1]));
  ok("지난 주기: 오늘 이후 행은 빠진다(멤버별 경과일 기준)", !got.s[1].includes(100) && !got.s[1].includes(200),
     `${JSON.stringify(got.s[1])} (경과일 정우 ${J.el} / 지현 ${H.el})`);
  ok("이번 주기 버킷은 그대로", JSON.stringify(got.s[2]) === JSON.stringify(got.b[2]));
  if (!lateJ || !lateH) console.log("     (주기 마지막 날이라 '오늘 이후' 행을 못 만든 멤버가 있다 — 그 검사는 약해진다)");
}

// ── ② 요약 숫자가 같은 시점 기준인가 ─────────────────────
{
  const ev = boot();
  setup(ev, []);
  const J = frame(ev, "정우");
  // 2주기 전은 비어 있다(기록 시작 전) · 전 주기: 첫날 10만 + 오늘 이후 90만 · 이번 주기: 첫날 10만
  const rows = [row("정우", J.day(1, 0), 100000), row("정우", J.day(2, 0), 100000)];
  if (J.el + 1 < J.lenOf(1)) rows.push(row("정우", J.day(1, J.el + 1), 900000));
  setup(ev, rows);
  const h = ev(`memberFilter="정우"; viewAnalysis()`);
  ok("전 주기 대비는 '같은 날' 기준 (0%)", /–0%<\/span> <span[^>]*>전 주기 같은 날/.test(h),
     "다 찬 전 주기(100만)와 비교하면 ▼90%가 뜬다");
  ok("평균 대비도 같은 시점 + 빈 주기·이번 주기 제외 (+0%)", />\+0%<\/div><div class="am-sub"[^>]*>같은 날 평균 10만/.test(h),
     (h.match(/평균 대비<\/div><div[^>]*>[^<]*<\/div><div[^>]*>[^<]*/) || [""])[0]);
  ok("진행 일수를 밝힌다", /이번 주기 \d+\/\d+일째/.test(h));
}

// ── ③ 급증 진단이 주기 중간에도 잡힌다 ───────────────────
{
  const ev = boot();
  setup(ev, []);
  const J = frame(ev, "정우");
  // 전 주기: 같은 날까지 식비 2만, 그 뒤 50만 / 이번 주기: 식비 6만 → 같은 시점 기준 +200%
  const rows = [row("정우", J.day(1, 0), 20000), row("정우", J.day(2, 0), 60000)];
  if (J.el + 1 < J.lenOf(1)) rows.push(row("정우", J.day(1, J.el + 1), 500000));
  setup(ev, rows);
  const h = ev(`memberFilter="정우"; viewAnalysis()`);
  // 인사이트 문구는 esc()를 거쳐 ' 가 &#39; 로 들어간다
  ok("급증 진단이 같은 시점 평균으로 잡힌다", /(&#39;|')식비(&#39;|') 지출이 평소보다 200% 늘었어요/.test(h),
     "다 찬 전 주기(52만)를 평소로 보면 6만은 급증이 아니다 — 주기 말에야 잡힌다");
}

console.log(fails ? `\n${fails}건 FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
