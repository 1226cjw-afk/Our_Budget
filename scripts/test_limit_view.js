// 한도 탭 — 오늘 눈금·속도 경고·접힌 입력칸 + 진입 모션 1회 단위테스트 (브라우저·실 DB 없이 ~1초).
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\test_limit_view.js [다른파일.html]
//
// 무엇을 지키나:
//   ① 막대의 '오늘' 눈금이 주기 경과율 자리에 있는가 — 같은 97%라도 3일째와 29일째는 뜻이 정반대다
//   ② 속도 경고(주기 말 어림)가 주기 1/4 전엔 안 뜨는가 — 첫날 3만원이 '주기 말 90만원'이 되면 늘 경고가 뜬다
//   ③ 입력칸이 기본으로 접혀 있고, 탭한 카테고리 하나만 펴지는가 — 예전엔 화면 절반이 입력칸이었다
//   ④ 진입 모션은 화면이 바뀔 때만 — 같은 화면 재렌더(캐시→최근→전량, 행 펼치기)엔 깜빡이지 않는다
// 날짜는 전부 '오늘' 기준 상대값이다.
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
  const el = () => { const cls = new Set();
    return { style: {}, classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle(){} },
             addEventListener(){}, focus(){}, innerHTML: "", textContent: "", value: "" }; };
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
  const ev = new Function(...keys, code + "\n;return (expr)=>eval(expr);")(...keys.map(k => env[k]));
  return { ev, main: doc.getElementById("main") };
}
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

// 시작일을 바꿔 가며 '오늘이 주기 몇째 날인가'를 원하는 대로 만든다
function setup(ev, startDay, rows) {
  ev(`MEMBERS=["정우"]; BILLING_STARTS={정우:${startDay}}; WARN_TH=80; limitMember="정우"; limEdit=null;
      LIMITS={정우:{식비:300000,카페:100000}};
      MASTER={정우:{categories:["식비","카페","교통","의료"],methods:[],accounts:[]}};`);
  ev(`ROWS=stampRows(${JSON.stringify(rows)})`);
}
const row = (date, amount, category) => ({ id: category + date + amount, date, member: "정우", type: "지출", category, account: "국민", method: "", amount, memo: "" });
const today = ymd(Date.now());

// 오늘이 주기 '첫날'이 되는 시작일 / 주기 중반 이후가 되는 시작일 (1~28 범위)
const d = new Date().getDate();
const startFirstDay = d <= 28 ? d : null;                 // 오늘 = 1일째
const startLate = ((d - 20 + 31 - 1) % 28) + 1;           // 오늘이 대략 20일째 이후가 되도록

// ── ① 오늘 눈금 위치 ─────────────────────────────────────
{
  const { ev } = boot();
  setup(ev, startLate, [row(today, 50000, "카페")]);
  const p = ev(`periodProgress("정우")`);
  const h = ev("viewLimit()");
  const want = (Math.min(1, p.day / p.len) * 100).toFixed(1);
  const marks = [...h.matchAll(/class="l-pace" style="left:([\d.]+)%"/g)].map(m => m[1]);
  ok(`한도 있는 막대마다 오늘 눈금 (${p.day}/${p.len}일 → ${want}%)`, marks.length === 3 && marks.every(x => x === want),
     JSON.stringify(marks));
  ok("머리에 진행 일수", h.includes(`${p.day}/${p.len}일째`));
}

// ── ② 속도 경고 ──────────────────────────────────────────
{
  const { ev } = boot();
  setup(ev, startLate, [row(today, 90000, "식비")]);           // 30% 사용 — warn 아래
  const p = ev(`periodProgress("정우")`), pace = p.day / p.len;
  const h = ev("viewLimit()");
  const expectWarn = pace >= 0.25 && 90000 / pace > 300000;
  ok(`주기 ${Math.round(pace*100)}% 경과 · 30% 사용 → 경고 ${expectWarn ? "있음" : "없음"}`,
     /지금 속도면 주기 말/.test(h) === expectWarn);

  // 경고 '임박'(80%) 아래인데 속도가 빠른 경우 — 이게 이 기능이 새로 잡는 상태다
  if (pace >= 0.25 && pace < 0.79) {
    const C = boot();
    setup(C.ev, startLate, [row(today, 237000, "식비")]);       // 79% 사용
    const hc = C.ev("viewLimit()");
    ok(`주기 ${Math.round(pace*100)}% 경과 · 79% 사용 → 주기 말 초과 예상 경고`,
       /식비[\s\S]*?지금 속도면 주기 말 약 [\d,]+원 — 한도를 넘을 수 있어요/.test(hc));
  } else console.log("     (경과율이 범위 밖이라 '빠른 속도' 경우를 건너뜀)");

  if (startFirstDay) {
    const B = boot();
    setup(B.ev, startFirstDay, [row(today, 90000, "식비")]);
    ok("주기 첫날엔 어림 경고를 안 띄운다(1/4 전)", !/지금 속도면 주기 말/.test(B.ev("viewLimit()")),
       "첫날 사용액을 30배 하면 늘 '한도 초과 예상'이 뜬다");
  } else console.log("     (오늘이 29~31일이라 '첫날' 경우를 만들 수 없다 — 건너뜀)");
}

// ── ③ 입력칸은 접혀 있다 ──────────────────────────────────
{
  const { ev } = boot();
  setup(ev, startLate, [row(today, 20000, "교통")]);
  const h0 = ev("viewLimit()");
  ok("기본 상태엔 한도 입력칸이 하나도 없다", !/id="lim_/.test(h0), (h0.match(/id="lim_[^"]*"/g) || []).join(","));
  ok("한도 없는 카테고리는 '한도 미설정'으로 접힌다", /한도 미설정<span>2개/.test(h0));
  ev("limEdit='교통'");
  const h1 = ev("viewLimit()");
  const ids = h1.match(/id="lim_[^"]*"/g) || [];
  ok("탭한 카테고리 하나만 입력칸이 펴진다", ids.length === 1 && ids[0] === 'id="lim_정우_교통"', ids.join(","));
  ok("미설정 행에 사용액이 보인다", /교통<\/div>\s*<span class="lrow-s">20,000원 사용/.test(h1));
}

// ── ④ 진입 모션은 화면이 바뀔 때만 ────────────────────────
{
  const { ev, main } = boot();
  setup(ev, startLate, []);
  ev("tab='limit'; render()");
  ok("탭 첫 렌더엔 모션", main.classList.contains("anim"));
  ev("render()");
  ok("같은 화면 재렌더엔 모션 없음(캐시→최근→전량·행 펼치기)", !main.classList.contains("anim"));
  ev("tab='acct'; render()");
  ok("탭을 바꾸면 다시 모션", main.classList.contains("anim"));
  ok("CSS 모션이 .anim 아래에만 걸려 있다",
     !/(^|\n)\.panel,\.cards \.card[^{]*\{\s*animation:riseIn/.test(html) && /\.anim \.panel[^{]*\{\s*animation:riseIn/.test(html));
}

console.log(fails ? `\n${fails}건 FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
