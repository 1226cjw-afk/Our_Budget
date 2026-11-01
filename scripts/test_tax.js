// 연말정산 계산 + 한도 판정 단위테스트 (브라우저·실 DB 없이 ~1초).
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\test_tax.js [다른파일.html]
//
// 무엇을 지키나 (2026-11-01 로직 검토에서 나온 5건):
//   ① 연환산은 경과 '일수'로 — 옛 x/m*12는 11/1에 10개월+하루치를 11로 나눠 ~9% 낮았고, 12월엔 연환산을 안 했다
//   ② 총급여 추정·경고는 '입금이 있던 달' 기준 — 옛 `salaryCnt < m`은 매달 1일~급여일 전까지 늘 경고를 띄웠다
//   ③ 한도 초과는 금액으로 판정 — 옛 Math.round(99.6)=100이라 한도 안인데 "−400원 초과"가 떴다
//   ④ 총급여가 실수령 자동 추정이면 그 사실을 알린다
//   ⑤ 영수증 없는 '현금'은 cash(30%)로 추천하지 않는다
// taxCalc는 `now`를 받으므로 날짜를 고정해 돌린다(오늘 날짜에 따라 결과가 바뀌지 않는다).
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
  const el = () => ({ style: {}, classList: { add(){}, remove(){}, contains: () => false, toggle(){} },
    addEventListener(){}, focus(){}, innerHTML: "", textContent: "", value: "" });
  const doc = { getElementById: id => { if (!els.has(id)) els.set(id, el()); return els.get(id); },
                createElement: () => el(), head: { appendChild(){} }, body: el(), documentElement: el(),
                querySelector: () => null, querySelectorAll: () => [], addEventListener(){} };
  const env = {
    document: doc, window: { addEventListener(){}, matchMedia: () => ({ addEventListener(){} }), scrollTo(){}, scrollY: 0 },
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} }, supabase: { createClient: () => ({}) }, Chart: undefined,
    setTimeout, clearTimeout, console, Intl, Date, Math, JSON, navigator: {}, fetch: async () => ({}),
    IntersectionObserver: function(){ this.observe = () => {}; this.disconnect = () => {}; },
    getComputedStyle: () => ({ getPropertyValue: () => "" }), confirm: () => true, alert(){}, innerHeight: 800,
  };
  const keys = Object.keys(env);
  return new Function(...keys, code + "\n;return (expr)=>eval(expr);")(...keys.map(k => env[k]));
}

// 2026년, 매달 25일 월급 300만 + 매달 10일 체크카드 100만 + 매달 12일 '현금' 5만
function yearRows(lastDate) {
  const rows = [];
  const add = (date, type, category, method, amount) =>
    date <= lastDate && rows.push({ id: rows.length + 1, date, member: "정우", type, category, account: "국민", method, amount, memo: "" });
  for (let mo = 1; mo <= 12; mo++) {
    const mm = String(mo).padStart(2, "0");
    add(`2026-${mm}-25`, "입금", "월급", "", 3000000);
    add(`2026-${mm}-10`, "지출", "식비", "우리체크", 1000000);
    add(`2026-${mm}-12`, "지출", "식비", "현금", 50000);
  }
  return rows;
}
function setupTax(ev, lastDate, extra) {
  ev(`MEMBERS=["정우"]; TY_SALARY={}; WARN_TH=80;
      CTMAP={정우:{"월급":"income"}}; MTMAP={정우:{"우리체크":"check","현금":"${extra && extra.cashAs || "none"}"}};`);
  ev(`ROWS=stampRows(${JSON.stringify(yearRows(lastDate))})`);
}
const at = s => `new Date(${s.split("-").map((x, i) => i === 1 ? Number(x) - 1 : Number(x)).join(",")},15,0)`;

// ── ① 연환산 = 경과 일수 ─────────────────────────────────
{
  const ev = boot();
  setupTax(ev, "2026-11-01");
  const t = ev(`taxCalc("정우", ${at("2026-11-01")})`);
  ok("11/1 경과 일수 = 305", t.elapsed === 305, `elapsed ${t.elapsed}`);
  // 체크 1,000만(1~10월) / 305일 × 365일
  const want = 10000000 / 305 * 365;
  ok("11/1 체크 연환산 = 1,000만 ÷ 305 × 365 (옛 식은 ÷11×12 = 1,091만)",
     Math.abs(t.projK.check - want) < 1, `${Math.round(t.projK.check)} vs ${Math.round(want)}`);
  ok("11/1 남은 기간 = 60일(약 2개월) — 옛 식은 1개월", t.remainDays === 60 && t.remainLabel === "약 2개월", t.remainLabel);

  const ev2 = boot();
  setupTax(ev2, "2026-12-01");
  const d = ev2(`taxCalc("정우", ${at("2026-12-01")})`);
  ok("12/1에도 연환산한다 — 옛 식은 m>=12라 12월 사용분이 통째로 빠졌다",
     d.projK.check > d.ytd.check * 1.08, `proj ${Math.round(d.projK.check)} ytd ${d.ytd.check}`);
  ok("12/1 남은 기간 = 30일", d.remainDays === 30 && d.remainLabel === "30일", d.remainLabel);

  const ev3 = boot();
  setupTax(ev3, "2026-12-31");
  const e = ev3(`taxCalc("정우", ${at("2026-12-31")})`);
  ok("12/31엔 연환산 = 실적 그대로", Math.abs(e.projK.check - e.ytd.check) < 1e-6 && e.remainDays === 0);
}

// ── ② 총급여 추정·누락 경고 ─────────────────────────────
{
  const ev = boot();
  setupTax(ev, "2026-11-01");                                   // 10번 입금, 11월 급여일 전
  const t = ev(`taxCalc("정우", ${at("2026-11-01")})`);
  ok("급여일 전이어도 추정 총급여 = 월 300만 × 12 (옛 식은 ÷11×12 = 3,273만)", t.autoSalary === 36000000, `${t.autoSalary}`);
  ok("급여일 전엔 '기록 없는 달' 경고가 없다 (옛 `salaryCnt < m`은 떴다)", t.missingMonths === 0, `missing ${t.missingMonths}`);

  const ev2 = boot();
  setupTax(ev2, "2026-11-01");
  ev2(`ROWS=stampRows(ROWS.filter(r=>!(r.type==="입금"&&(r.date.startsWith("2026-03")||r.date.startsWith("2026-04")))))`);
  const u = ev2(`taxCalc("정우", ${at("2026-11-01")})`);
  ok("3·4월 급여 기록이 빠지면 누락 2개월로 잡힌다", u.missingMonths === 2, `missing ${u.missingMonths}`);
  ok("빠진 달은 평균에서도 빠진다 (8개월 평균 × 12)", u.autoSalary === 36000000, `${u.autoSalary}`);

  const ev3 = boot();
  setupTax(ev3, "2026-11-26");                                  // 11월 급여까지 들어온 뒤
  const v = ev3(`taxCalc("정우", ${at("2026-11-26")})`);
  ok("급여일 뒤엔 이번 달도 센다 (11개월, 누락 0)", v.incMonths === 11 && v.missingMonths === 0);
}

// ── ③ 한도 판정 ─────────────────────────────────────────
{
  const ev = boot();
  ev("WARN_TH=80");
  ok("99.6% 사용은 초과가 아니다 (옛 Math.round → 100% 초과)", ev("limState(99600,100000)") === "warn");
  ok("99.6%는 99%로 표시", ev("limPct(99600,100000)") === 99);
  ok("딱 한도면 초과·100%", ev("limState(100000,100000)") === "over" && ev("limPct(100000,100000)") === 100);
  ok("79.6%는 임박 아님 (옛 반올림은 80% 임박)", ev("limState(79600,100000)") === "ok");
  ok("80%는 임박", ev("limState(80000,100000)") === "warn");
  ok("순입금(음수)은 0%·정상", ev("limPct(-5000,100000)") === 0 && ev("limState(-5000,100000)") === "ok");

  // 한도 탭 실렌더 — '−N원 초과'가 나오지 않아야 한다
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  ev(`MEMBERS=["정우"]; BILLING_STARTS={정우:${Math.min(28, d.getDate())}}; limitMember="정우"; limEdit=null;
      LIMITS={정우:{식비:100000}}; MASTER={정우:{categories:["식비"],methods:[],accounts:[]}};
      ROWS=stampRows([{id:1,date:"${today}",member:"정우",type:"지출",category:"식비",account:"국민",method:"",amount:99600,memo:""}]);`);
  const h = ev("viewLimit()");
  ok("한도 탭 — 99,600/100,000에 초과 경고·음수 초과 문구 없음", !/한도 초과!/.test(h) && !/-[\d,]+원 초과/.test(h));
  ok("한도 탭 — 대신 '한도까지 400원'", /한도까지 400원/.test(h));
}

// ── ④ 실수령 기준 안내 ──────────────────────────────────
{
  const ev = boot();
  setupTax(ev, "2026-11-01");
  const t = ev(`taxCalc("정우", ${at("2026-11-01")})`);
  const notes = ev(`tyNotes(taxCalc("정우", ${at("2026-11-01")}))`);
  ok("자동 추정이면 실수령 안내가 붙는다", notes.some(n => /실수령/.test(n.t)));
  ev(`TY_SALARY={정우:45000000}`);
  const notes2 = ev(`tyNotes(taxCalc("정우", ${at("2026-11-01")}))`);
  ok("수동 입력하면 안내가 사라진다", !notes2.some(n => /실수령/.test(n.t)));
  ok("(참고) 자동 추정 총급여", t.salary === 36000000);
}

// ── ⑤ 영수증 없는 현금 ──────────────────────────────────
{
  const ev = boot();
  ok("추천: '현금' → 제외", ev(`suggestKind("현금")`) === "none");
  ok("추천: '현금영수증' → cash", ev(`suggestKind("현금영수증")`) === "cash");
  ok("추천: '우리 체크카드' → check", ev(`suggestKind("우리 체크카드")`) === "check");
  ok("추천: '삼성카드' → credit", ev(`suggestKind("삼성카드")`) === "credit");
  ok("매핑 라벨이 '현금영수증'", ev(`TY_KINDS.cash`) === "현금영수증");

  setupTax(ev, "2026-11-01", { cashAs: "cash" });              // 이미 '현금'을 cash로 매핑해 둔 경우
  const t = ev(`taxCalc("정우", ${at("2026-11-01")})`);
  ok("이미 cash로 매핑된 '현금' 금액을 따로 센다", t.cashNoReceipt === 500000, `${t.cashNoReceipt}`);
  const notes = ev(`tyNotes(taxCalc("정우", ${at("2026-11-01")}))`);
  ok("그 경우 경고가 붙는다", notes.some(n => /영수증 없는 현금/.test(n.t)));
}

// ── 공제 계산 자체는 그대로 (회귀 가드) ──────────────────
{
  const ev = boot();
  // 총급여 4,000만 → 문턱 1,000만, 신용 1,200만 + 체크 400만 → (200만×15%) + (400만×30%) = 150만
  ok("tyDeduct — 신용이 문턱 초과", ev("tyDeduct(12000000,4000000,40000000)") === 1500000);
  // 신용 600만 + 체크 600만 → (1,200−1,000)만×30% = 60만
  ok("tyDeduct — 신용이 문턱 아래면 초과분 전체 30%", ev("tyDeduct(6000000,6000000,40000000)") === 600000);
  ok("tyDeduct — 한도 300만 / 7천만 초과 250만",
     ev("tyDeduct(0,50000000,40000000)") === 3000000 && ev("tyDeduct(0,90000000,80000000)") === 2500000);
}

console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
