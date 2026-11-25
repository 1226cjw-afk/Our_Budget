// 월간 리포트 — 결제 주기가 끝난 멤버의 '직전 주기'를 집계하고, Claude가 쓴 리포트를 DB에 저장한다.
//
//   node scripts/monthly_report.js due   [--today=YYYY-MM-DD]                 리포트를 쓸 차례인 (멤버, 주기) 목록
//   node scripts/monthly_report.js facts <멤버> [--start=YYYY-MM-DD] [--today=…] 그 주기의 집계(JSON) — 리포트의 재료
//   node scripts/monthly_report.js save  <멤버> <주기시작 YYYY-MM-DD> <리포트.md>  monthly_reports 에 upsert
//   node scripts/monthly_report.js list                                         저장된 리포트 목록
//
// 인증: lib_auth.dbHeaders() — PC 는 BUDGET_PW, 클라우드 예약 작업은 BUDGET_AUTH=proxy (그 주석 참조).
// 절차 전체(언제 돌고 무엇을 쓰는가)는 docs/monthly-report.md.
//
// ⚠️ 집계를 이 파일에 다시 짜지 말 것. public/index.html 의 앱 스크립트를 vm 에서 통째로 돌려
//    applyLoad·billingPeriod·netSplit·limitUsage·bigSpends 를 **그대로** 쓴다.
//    손으로 옮긴 사본은 앱이 바뀌어도 옛 계산을 하고, 그러면 리포트 숫자가 앱 화면과 갈린다
//    (멤버별 주기 시작일·순액 집계가 실제로 두 번씩 바뀐 프로젝트다 — CLAUDE.md '결제 주기'·netSplit).
// ⚠️ 시간대는 Asia/Seoul 고정. 컨테이너는 UTC 라 그대로 두면 billingPeriod 의 '로컬 자정'이
//    한국과 9시간 어긋나고, 주기 첫날 오전 거래가 이웃 주기로 밀린다.
process.env.TZ = "Asia/Seoul";
// ⚠️ 클라우드(BUDGET_AUTH=proxy)에선 Node 의 https 가 HTTPS_PROXY 를 기본으로 안 따른다 → 프록시를 건너뛰면
//    secret key 주입이 안 돼 'Invalid API key'(401)로 떨어진다(2026-11-25 실측). NODE_USE_ENV_PROXY 는
//    시작 시점에만 읽히므로 붙여서 자기 자신을 다시 띄운다
if(process.env.BUDGET_AUTH === "proxy" && !process.env.NODE_USE_ENV_PROXY){
  const r = require("child_process").spawnSync(process.execPath, process.argv.slice(1),
    { stdio:"inherit", env:{ ...process.env, NODE_USE_ENV_PROXY:"1", NODE_NO_WARNINGS:"1" } });
  process.exit(r.status == null ? 1 : r.status);
}

const fs = require("fs"), path = require("path"), vm = require("vm");
const { HOST, req, dbHeaders } = require("./lib_auth");

const ROOT = path.join(__dirname, "..");
const GRACE_DAYS = 2;   // 새 주기 시작 후 이만큼 지나야 '끝난 주기'로 본다 — 마지막 날 지출을 다음 날 입력하는 일이 흔하다
const PREV_N = 3;       // 비교에 쓰는 지난 주기 수
const MAX_MD = 20000;   // 리포트 본문 상한(바이트) — 앱이 한 화면에 그리는 글이다

/* ── 인자 ── */
const argv = process.argv.slice(2);
const opt = k => { const a = argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const pos = argv.filter(x => !x.startsWith("--"));
const cmd = pos[0];

/* ── 앱 스크립트를 vm 에서 로드 ── */
function loadApp(){
  const src = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  const code = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
  // DOM·supabase 는 시작 시점에 '등록'만 하고 부르지 않는다 — 무엇이든 삼키는 Proxy 로 충분하다
  const any = () => new Proxy(function(){}, {
    get:(t,k) => k === Symbol.toPrimitive ? () => "" : any(), apply:() => any(), construct:() => any() });
  const ctx = { console, Intl, Date, Math, JSON, Promise, setTimeout, clearTimeout, Set, Map, Array, Object,
                Number, String, RegExp, Error };
  Object.assign(ctx, { window:ctx, document:any(), navigator:{}, location:{},
    localStorage:{ getItem:() => null, setItem(){}, removeItem(){} },
    supabase:{ createClient:() => any() }, getComputedStyle:() => ({ getPropertyValue:() => "" }) });
  vm.createContext(ctx);
  vm.runInContext(code + "\n;globalThis.__x = e => eval(e);", ctx);
  return ctx.__x;
}

/* ── DB ── */
let H = null;
async function get(p){
  const r = await req("GET", p, H);
  if(r.status !== 200 && r.status !== 206) {
    const e = new Error(`GET ${p.split("?")[0]} → HTTP ${r.status}: ${r.body.slice(0,200)}`); e.status = r.status; e.body = r.body; throw e;
  }
  return { rows: JSON.parse(r.body), range: r.headers["content-range"] };
}
// PostgREST max-rows(1000)에서 에러 없이 잘린다 → 앱의 fetchTransactions 와 같은 이유로 끝까지 이어 받는다
async function getAll(p){
  const out = [], seen = new Set(), step = 1000;
  for(let from = 0; ; from += step){
    const r = await req("GET", p, Object.assign({ Range:`${from}-${from + step - 1}`, "Range-Unit":"items" }, H));
    if(r.status !== 200 && r.status !== 206) throw new Error(`GET ${p.split("?")[0]} → HTTP ${r.status}: ${r.body.slice(0,200)}`);
    const rows = JSON.parse(r.body);
    rows.forEach(x => { if(!seen.has(x.id)){ seen.add(x.id); out.push(x); } });
    if(rows.length < step) break;
  }
  return out;
}
async function loadData(app){
  const [mem, tx, lim, mst, cfg, mtm] = await Promise.all([
    get("/rest/v1/members?select=name&order=id"),
    getAll("/rest/v1/transactions?select=*&order=date.desc,id"),
    get("/rest/v1/category_limits?select=*"),
    get("/rest/v1/master_data?select=*"),
    get("/rest/v1/app_settings?select=*"),
    get("/rest/v1/tax_map?select=*").catch(e => ({ error:e })),
  ]);
  // 앱의 applyLoad 에 응답 6종을 그대로 먹인다 — 캐시 복원과 같은 원칙(파생은 한 벌)
  app("applyLoad")({ mem:{data:mem.rows}, tx:{data:tx}, lim:{data:lim.rows}, mst:{data:mst.rows},
                     cfg:{data:cfg.rows}, mtm:mtm.error ? {error:mtm.error} : {data:mtm.rows} });
  const warn = app("loadWarn");
  if(warn.length) throw new Error("앱 로드 경고: " + warn.join(", "));
}
async function reportsOf(member){
  try{
    const q = `/rest/v1/monthly_reports?select=member,period_start,period_end,headline,md,created_at&order=period_start.desc` +
              (member ? `&member=eq.${encodeURIComponent(member)}` : "");
    return { ready:true, rows:(await get(q)).rows };
  }catch(e){
    // 테이블이 아직 없다(PGRST205) — 리포트는 써도 저장은 못 한다. 호출부가 판단한다
    if(e.status === 404) return { ready:false, rows:[] };
    throw e;
  }
}

/* ── 주기 ── */
let A;   // 앱 스코프 eval
const DAY = 864e5;
const todayDate = () => { const t = opt("today"); return t ? A("parseDate")(t) : A("parseDate")(A("todayStr")()); };
const cycleAt   = (m, d) => A("billingPeriod")(m, d);
const prevCycle = (m, p) => cycleAt(m, new Date(p.sT - DAY / 2));
const ymdOf     = d => A("ymd")(d);
const periodInfo = p => ({ start:ymdOf(p.start), end:ymdOf(p.end), label:p.label,
                           days:Math.round((p.eT - p.sT) / DAY) });

/* ── due: 끝난 지 GRACE_DAYS 이상 된 직전 주기 중 리포트가 없는 것 ── */
async function due(){
  const today = todayDate(), rep = await reportsOf(null);
  const have = new Set(rep.rows.map(r => r.member + "|" + r.period_start));
  const out = [];
  A("MEMBERS").forEach(m => {
    const cur = cycleAt(m, today);
    const elapsed = Math.floor((today.getTime() - cur.sT) / DAY);   // 새 주기 시작일 = 0
    const p = prevCycle(m, cur), info = periodInfo(p);
    const rowsN = A("ROWS").filter(r => r.member === m && A("inPeriodRow")(r, p)).length;
    out.push({ member:m, ...info, billingStart:A("BILLING_STARTS")[m], daysSinceEnd:elapsed + 1,
               reported:have.has(m + "|" + info.start), rows:rowsN,
               due:elapsed >= GRACE_DAYS && !have.has(m + "|" + info.start) && rowsN > 0 });
  });
  console.log(JSON.stringify({ today:ymdOf(today), tableReady:rep.ready, graceDays:GRACE_DAYS, members:out }, null, 1));
}

/* ── facts: 한 멤버·한 주기의 재료 ── */
async function facts(m, startArg){
  if(!A("MEMBERS").includes(m)) throw new Error(`없는 멤버: ${m} (있는 멤버: ${A("MEMBERS").join(", ")})`);
  const P = startArg ? cycleAt(m, A("parseDate")(startArg)) : prevCycle(m, cycleAt(m, todayDate()));
  if(startArg && ymdOf(P.start) !== startArg)
    throw new Error(`${startArg} 는 ${m} 의 주기 시작일이 아니다 (그 날이 속한 주기: ${P.label})`);
  const prevs = []; for(let p = P, i = 0; i < PREV_N; i++){ p = prevCycle(m, p); prevs.push(p); }

  const inP = A("inPeriodRow"), isT = A("isTransfer"), netSplit = A("netSplit"), limitUsage = A("limitUsage");
  const mine = A("ROWS").filter(r => r.member === m);
  const rowsOf = p => mine.filter(r => inP(r, p));
  const cur = rowsOf(P), prevRows = prevs.map(rowsOf);
  const n = netSplit(cur), pn = prevRows.map(netSplit);
  const recorded = prevRows.map((rs, i) => rs.length ? i : -1).filter(i => i >= 0);   // 기록 전 빈 주기는 평균에서 뺀다(앱과 같은 원칙)
  const avgOf = f => recorded.length ? Math.round(recorded.reduce((s, i) => s + f(i), 0) / recorded.length) : null;
  const exp = cur.filter(r => r.type !== "입금" && !isT(r));

  // 카테고리 — 금액은 앱 분석 탭과 같은 기준(catFlows: 정산·환불 크기의 입금만 지출에서 상쇄)
  const flows = A("catFlows")(cur);
  const cats = new Set([...Object.keys(n.exp), ...pn.flatMap(x => Object.keys(x.exp))]);
  const categories = [...cats].map(c => {
    const amount = n.exp[c] || 0;
    const rs = cur.filter(r => r.category === c && !isT(r));
    return { category:c, amount, share:n.expTot ? Math.round(amount / n.expTot * 1000) / 10 : 0,
      prev:pn[0] ? (pn[0].exp[c] || 0) : null, avgPrev:avgOf(i => pn[i].exp[c] || 0),
      count:rs.filter(r => r.type !== "입금").length,
      grossSpend:flows[c] ? flows[c].spend : 0,    // 상쇄 전 지출
      offset:flows[c] ? flows[c].offset : 0,       // 정산·환불로 보고 지출에서 뺀 입금
      inflowAsIncome:flows[c] ? flows[c].extra : 0, // 지출보다 커서 수입으로 센 같은 카테고리 입금
      newThisCycle:!pn.some(x => x.exp[c]) };
  }).filter(x => x.amount || x.prev || x.avgPrev).sort((a, b) => b.amount - a.amount);

  const usage = limitUsage(cur), LIM = A("LIMITS")[m] || {};
  const limits = Object.entries(LIM).map(([c, limit]) => ({ category:c, limit, used:usage[c] || 0,
    pct:A("limPct")(usage[c] || 0, limit), state:A("limState")(usage[c] || 0, limit) }))
    .sort((a, b) => b.pct - a.pct);

  // 평소(지난 주기 포함 중앙값) 대비 튄 지출 — 표본을 넓히려고 지난 주기까지 넣고, 이번 주기 것만 남긴다
  const curIds = new Set(cur.map(r => r.id));
  const brief = r => ({ date:r.date, category:r.category, memo:r.memo || "", amount:r.amount,
                        method:r.method || "", account:r.account || "" });
  const bigSpends = A("bigSpends")([...cur, ...prevRows.flat()]).filter(r => curIds.has(r.id))
    .map(r => ({ ...brief(r), usual:Math.round(r.med), ratio:Math.round(r.ratio * 10) / 10 }));
  const topExpenses = [...exp].sort((a, b) => b.amount - a.amount).slice(0, 10).map(brief);

  // 반복 지출 — 세부내역(메모)이 같은 지출이 지난 주기에도 있었는가. 키는 분석 탭과 같다(괄호 제거)
  const key = r => r.category + "::" + String(r.memo || "").replace(/\(.*\)/, "").trim();
  const byKey = {};
  [cur, ...prevRows].forEach((rs, pi) => rs.filter(r => r.type !== "입금" && r.memo && !isT(r)).forEach(r => {
    const k = key(r), x = byKey[k] || (byKey[k] = { category:r.category, memo:r.memo, amounts:Array(PREV_N + 1).fill(0) });
    x.amounts[pi] += r.amount;
  }));
  const recurring = Object.values(byKey).filter(x => x.amounts[0] && x.amounts.slice(1).some(v => v))
    .sort((a, b) => b.amounts[0] - a.amounts[0]).slice(0, 15)
    .map(x => ({ category:x.category, memo:x.memo, thisCycle:x.amounts[0], prevCycles:x.amounts.slice(1) }));

  // 흐름 — 주차(시작일부터 7일씩)·요일·결제수단. 여긴 총액(정산 입금을 빼지 않은 지출)이다
  const sum = rs => rs.reduce((s, r) => s + r.amount, 0);
  const dayIdx = r => Math.floor((A("rowTime")(r) - P.sT) / DAY);
  const weeks = []; exp.forEach(r => { const w = Math.floor(dayIdx(r) / 7); weeks[w] = (weeks[w] || 0) + r.amount; });
  const DOW = A("DOW"), byDow = {}; exp.forEach(r => { const d = DOW[A("parseDate")(r.date).getDay()]; byDow[d] = (byDow[d] || 0) + r.amount; });
  const byMethod = {}; exp.forEach(r => { const k = r.method || "미지정"; byMethod[k] = (byMethod[k] || 0) + r.amount; });
  const weekend = sum(exp.filter(r => [0, 6].includes(A("parseDate")(r.date).getDay())));

  // 기록 상태 — 리포트가 '덜 입력된 달'을 '덜 쓴 달'로 읽지 않게 하는 근거
  const daysWithRows = new Set(cur.map(r => r.date)).size;
  const lateEntries = cur.filter(r => r.created_at && new Date(r.created_at).getTime() > P.eT).length;
  const transfers = cur.filter(isT);
  const lastRowDate = cur.reduce((d, r) => r.date > d ? r.date : d, "");
  // 같은 날·같은 금액 지출이 두 번 — 중복 입력 의심(2026-10-21 '교통'·'교통비' 74,200원 실례). 판정은 리포트가 한다
  const dupG = {};
  exp.forEach(r => { const k = r.date + "|" + r.amount; (dupG[k] = dupG[k] || []).push(r); });
  const possibleDuplicates = Object.values(dupG).filter(g => g.length > 1).map(g => g.map(brief));

  const prevReports = (await reportsOf(m)).rows.filter(r => r.period_start < ymdOf(P.start)).slice(0, 1)
    .map(r => ({ period:`${r.period_start} ~ ${r.period_end}`, headline:r.headline, md:r.md }));

  const out = {
    member:m, period:periodInfo(P), generatedFor:ymdOf(todayDate()),
    note:"금액 단위 원. expense/income 은 앱 분석 탭과 같은 기준 — 같은 카테고리 입금 중 정산·환불 크기(그 카테고리 지출 이하, 20% 여유)만 지출에서 빼고 나머지 입금은 수입. 계좌간 이동 제외.",
    totals:{ expense:n.expTot, income:n.incTot, net:n.incTot - n.expTot,
             grossExpense:A("expOf")(cur), grossIncome:A("incOf")(cur), txCount:cur.length - transfers.length },
    previousCycles:prevs.map((p, i) => ({ ...periodInfo(p), expense:pn[i].expTot, income:pn[i].incTot, txCount:prevRows[i].length,
                                          daysWithRows:new Set(prevRows[i].map(r => r.date)).size })),
    avgPrevExpense:avgOf(i => pn[i].expTot), avgPrevIncome:avgOf(i => pn[i].incTot),
    categories, incomeCategories:Object.entries(n.inc).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount })),
    limits, warnThreshold:A("WARN_TH"),
    bigSpends, topExpenses, recurring,
    flow:{ weeks, byWeekday:byDow, weekendShare:sum(exp) ? Math.round(weekend / sum(exp) * 100) : 0, byMethod },
    possibleDuplicates,
    recording:{ daysWithRows, periodDays:periodInfo(P).days, lastRowDate, lateEntries,
                transfers:{ count:transfers.length / 2, amount:sum(transfers.filter(r => r.type !== "입금")) } },
    previousReport:prevReports[0] || null,
  };
  console.log(JSON.stringify(out, null, 1));
}

/* ── save ── */
async function save(m, start, file){
  if(!A("MEMBERS").includes(m)) throw new Error(`없는 멤버: ${m}`);
  const P = cycleAt(m, A("parseDate")(start));
  if(ymdOf(P.start) !== start) throw new Error(`${start} 는 ${m} 의 주기 시작일이 아니다 (${P.label})`);
  const raw = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
  // 첫 줄 '# 한 줄 요약' 이 목록에 뜨는 제목(headline)이다 — 본문엔 넣지 않는다
  const m1 = raw.match(/^# (.+)\n+([\s\S]+)$/);
  if(!m1) throw new Error("리포트 첫 줄은 '# 한 줄 요약' 이어야 한다 (docs/monthly-report.md)");
  const headline = m1[1].trim(), md = m1[2].trim();
  if(Buffer.byteLength(md) > MAX_MD) throw new Error(`본문이 너무 길다 (${Buffer.byteLength(md)}B > ${MAX_MD}B)`);
  if(/sb_secret_|sb_publishable_|eyJhbGci/.test(raw)) throw new Error("본문에 키처럼 보이는 문자열이 있다 — 저장 거부");
  const body = { member:m, period_start:start, period_end:ymdOf(P.end), headline, md };
  const r = await req("POST", "/rest/v1/monthly_reports?on_conflict=member,period_start",
    Object.assign({ "Content-Type":"application/json", Prefer:"resolution=merge-duplicates,return=representation" }, H), body);
  if(r.status !== 201 && r.status !== 200) throw new Error(`저장 실패: HTTP ${r.status} ${r.body.slice(0,300)}`);
  // 말만 믿지 않는다 — 다시 읽어 본문이 그대로 들어갔는지 확인
  const back = (await reportsOf(m)).rows.find(x => x.period_start === start);
  if(!back || back.md !== md || back.headline !== headline) throw new Error("저장 후 재조회 불일치");
  console.log(`저장됨: ${m} ${start} ~ ${body.period_end} — ${headline} (${Buffer.byteLength(md)}B)`);
}

async function list(){
  const rep = await reportsOf(null);
  if(!rep.ready){ console.log("monthly_reports 테이블 없음 — docs/monthly-report.md 의 설치 SQL 을 실행할 것"); return; }
  rep.rows.forEach(r => console.log(`${r.member}\t${r.period_start} ~ ${r.period_end}\t${r.headline}`));
  if(!rep.rows.length) console.log("(저장된 리포트 없음)");
}

(async () => {
  if(!["due", "facts", "save", "list"].includes(cmd)){
    console.error("사용: due | facts <멤버> [--start=] | save <멤버> <주기시작> <md파일> | list   (--today=YYYY-MM-DD)");
    process.exit(2);
  }
  H = await dbHeaders();
  A = loadApp();
  await loadData(A);
  if(cmd === "due") await due();
  else if(cmd === "facts") await facts(pos[1], opt("start"));
  else if(cmd === "save") await save(pos[1], pos[2], pos[3]);
  else await list();
})().catch(e => { console.error("오류:", e.message); process.exit(1); });
