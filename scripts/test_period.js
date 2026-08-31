// 주기 판정 단위테스트 (브라우저 없이, ~1초).
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\test_period.js [다른파일.html]
//
// 왜 필요한가: 주기 판정은 이 앱에서 **가장 자주 조용히 틀린** 곳이다.
//   · 2026-07: 시작일=1이면 두 달짜리 주기가 되던 버그
//   · 2026-08-14: 분석·분류 탭이 MEMBERS[0] 주기로 전원을 잘라, 지현의 21~24일 거래
//     24건·293만원이 이웃 주기에 잡혔다(내역 탭과 숫자가 달랐다)
// 둘 다 화면엔 그럴듯한 숫자가 떠서 오류가 안 났다. 그래서 값이 아니라 **불변식**을 건다.
//
// 2026-09-01: 성능 때문에 판정을 '문자열 파싱'에서 '타임스탬프 비교'로 바꿨다.
// 그 교체가 결과를 바꾸지 않았음을 여기서 고정한다 — 빨라도 틀리면 소용없다.
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2] || path.join(__dirname, "..", "public", "index.html");
const code = [...fs.readFileSync(SRC, "utf8").matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

let fails = 0;
const ok = (name, cond, note) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && note ? "  — " + note : ""}`);
};

function makeEnv() {
  const store = new Map(), els = new Map();
  const el = () => ({ style:{setProperty(){},removeProperty(){}},
    classList:{add(){},remove(){},toggle(){},contains:()=>false},
    addEventListener(){}, appendChild(){}, setAttribute(){}, focus(){},
    innerHTML:"", textContent:"", value:"", dataset:{} });
  const doc = { createElement:()=>el(), head:{appendChild(){}}, body:el(), documentElement:el(),
    getElementById:id=>{ if(!els.has(id)) els.set(id,el()); return els.get(id); },
    querySelector:()=>null, querySelectorAll:()=>[], addEventListener(){}, removeEventListener(){} };
  const win = { addEventListener(){}, removeEventListener(){},
    matchMedia:()=>({matches:false,addEventListener(){}}), requestIdleCallback:null,
    scrollTo(){}, scrollY:0, location:{reload(){},href:""},
    getComputedStyle:()=>({getPropertyValue:()=>"#888"}),
    IntersectionObserver:function(){this.observe=()=>{};this.disconnect=()=>{};} };
  return { document:doc, window:win,
    localStorage:{ getItem:k=>store.has(k)?store.get(k):null,
                   setItem:(k,v)=>{store.set(k,String(v));}, removeItem:k=>{store.delete(k);} },
    supabase:{ createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}}}) },
    getComputedStyle:win.getComputedStyle, Chart:undefined, setTimeout, clearTimeout,
    console, Intl, Date, Math, JSON, navigator:{userAgent:"node"},
    fetch:async()=>({ok:true,json:async()=>({})}),
    IntersectionObserver:win.IntersectionObserver, __T:{} };
}
function load(){
  const env = makeEnv(), names = Object.keys(env);
  return { ev: new Function(...names, code + "\n;return (expr)=>eval(expr);")(...names.map(n=>env[n])), env };
}

const { ev, env } = load();
// 실제 상태: 멤버마다 시작일이 다르다 (정우 25일 / 지현 21일)
ev(`MEMBERS = ["정우","지현"]; BILLING_STARTS = {"정우":25,"지현":21}; memberFilter="전체"`);

// ── 1. 타임스탬프 판정이 문자열 판정과 같은가 ──────────────
// 경계(시작일 당일·전날·종료일·종료 다음날)와 월말·연말을 포함한 날짜 매트릭스
{
  const dates = [];
  for (let m = 1; m <= 12; m++)
    for (const d of [1, 20, 21, 24, 25, 26, 28, 30, 31]) {
      const dd = new Date(2026, m - 1, d);
      if (dd.getMonth() !== m - 1) continue;         // 2/30 같은 없는 날 제외
      dates.push(`2026-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`);
    }
  env.__T.dates = dates;
  const same = ev(`(function(){
    var bad = [];
    ["정우","지현"].forEach(function(m){
      for (var off = 0; off > -6; off--) {
        periodOffset = off;
        var p = viewedPeriod(m);
        __T.dates.forEach(function(ds){
          var byString = inPeriod(ds, p);                       // 기존 판정(문자열 파싱)
          var byRow    = inPeriodRow({date: ds}, p);            // 새 판정(타임스탬프)
          if (byString !== byRow) bad.push(m + " " + ds + " off" + off);
        });
      }
    });
    periodOffset = 0;
    return bad.length ? bad.slice(0,5).join(", ") : "";
  })()`);
  ok("타임스탬프 판정 === 문자열 판정 (2멤버 × 6주기 × 104일)", same === "", same);
}

// ── 2. _t가 심어져 있든 없든 같은 답 ────────────────────────
{
  const same = ev(`(function(){
    var p = viewedPeriod("정우");
    var a = {date:"2026-08-26"};                 // 심기 전
    var b = {date:"2026-08-26"}; b._t = parseDate(b.date).getTime();
    var c = {date:"2026-08-26", _t: null};       // 값이 비어 있는 경우
    return [inPeriodRow(a,p), inPeriodRow(b,p), inPeriodRow(c,p)].join(",");
  })()`);
  ok("_t 없음/있음/null 이 모두 같은 답", same === "true,true,true", same);
}

// ── 3. bucketByPeriod 불변식 ───────────────────────────────
{
  // 각 멤버의 시작일 경계에 딱 걸리는 행들 — 여기가 옛 버그 자리다
  env.__T.rows = [
    { id:"j1", member:"정우", date:"2026-08-25", type:"지출", category:"식비", amount:1000 },
    { id:"j2", member:"정우", date:"2026-08-24", type:"지출", category:"식비", amount:1000 },
    { id:"h1", member:"지현", date:"2026-08-21", type:"지출", category:"식비", amount:1000 },
    { id:"h2", member:"지현", date:"2026-08-20", type:"지출", category:"식비", amount:1000 },
  ];
  ev(`ROWS = __T.rows; periodOffset = 0`);

  // 인덱스 n-1 = 각 멤버의 '이번 주기' = viewedPeriod(m) — CLAUDE.md가 고정하라고 적어둔 불변식
  const cur = ev(`(function(){
    var b = bucketByPeriod(ROWS, 3, "정우");
    return b[b.length-1].map(function(r){return r.id;}).sort().join(",");
  })()`);
  ok("이번 주기 버킷 = 각자 주기의 시작일 이후 행", cur === "h1,j1",
     `받은 값: ${cur} (정우 8/25·지현 8/21이 이번 주기, 그 하루 전은 지난 주기여야 한다)`);

  const prev = ev(`(function(){
    var b = bucketByPeriod(ROWS, 3, "정우");
    return b[b.length-2].map(function(r){return r.id;}).sort().join(",");
  })()`);
  ok("직전 주기 버킷 = 각자 시작일 하루 전 행", prev === "h2,j2",
     `받은 값: ${prev} — 한 사람 기준으로 자르면 지현의 21~24일이 엉뚱한 주기로 밀린다`);

  // 버킷 결과가 '문자열 판정 참조 구현'과 완전히 동일한가
  const ident = ev(`(function(){
    var n = 4, ref = {};
    var out = Array.from({length:n}, function(){ return []; });
    ROWS.forEach(function(r){
      var ps = ref[r.member] || (ref[r.member] = recentPeriods(n, MEMBERS.includes(r.member) ? r.member : "정우"));
      for (var i=0;i<n;i++) if (inPeriod(r.date, ps[i])) { out[i].push(r); break; }
    });
    var a = out.map(function(b){ return b.map(function(r){return r.id;}).join("+"); }).join("|");
    var b = bucketByPeriod(ROWS, n, "정우").map(function(b){ return b.map(function(r){return r.id;}).join("+"); }).join("|");
    return a === b ? "" : (a + "  vs  " + b);
  })()`);
  ok("bucketByPeriod === 참조 구현(문자열 판정)", ident === "", ident);
}

// ── 4. 시작일=1이면 그 달 하루만큼이다 (2026-07 버그) ───────
{
  const r = ev(`(function(){
    BILLING_STARTS = {"정우":1,"지현":1};
    var p = billingPeriod("정우", new Date(2026, 1, 10));   // 2026-02-10
    var s = p.start, e = p.end;
    BILLING_STARTS = {"정우":25,"지현":21};
    return s.getMonth() + "/" + s.getDate() + "~" + e.getMonth() + "/" + e.getDate();
  })()`);
  ok("시작일=1은 같은 달 1일~말일", r === "1/1~1/28",
     `받은 값: ${r} (2026-02는 28일까지. 다음 달로 넘어가면 두 달짜리 주기 버그)`);
}

// ── 5. scoped()도 같은 판정을 쓰는가 ───────────────────────
{
  const s = ev(`(function(){
    tab="list"; scope="current"; periodOffset=0; memberFilter="전체";
    return scoped().map(function(r){return r.id;}).sort().join(",");
  })()`);
  ok("scoped(이번주기·전체멤버) = 각자 주기", s === "h1,j1",
     `받은 값: ${s} — bucketByPeriod와 어긋나면 내역 탭과 분석 탭 숫자가 달라진다`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
