// 순액(지출 − 입금) 집계 단위테스트 (브라우저 없이, ~0.1초).
//
//   node C:\Users\1226c\Projects\Our_Budget\scripts\test_net.js [다른파일.html]
//
// 왜 필요한가: 2026-09-28까지 한도 탭·분석 탭이 '지출'만 더했다. 생활비·데이트는 지출의 40% 안팎이
// 같은 카테고리의 정산 입금으로 돌아오는데, 그게 한도 사용액에서 안 빠지고 분석 탭에선 '수입'으로 부풀었다.
// 지금은 limitUsage(한도) / netSplit(분석)이 카테고리별 순액을 낸다. 여기서 그 계약을 고정한다.
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2] || path.join(__dirname, "..", "public", "index.html");
const src = fs.readFileSync(SRC, "utf8");

// 원본에서 뽑아 쓴다 — 손 복사본은 원본이 바뀌어도 옛 코드를 검증한다
const grab = re => { const m = src.match(re); if (!m) throw new Error("원본에서 못 찾음: " + re); return m[0]; };
const code = [
  grab(/const TRANSFER_CAT\s*=.*;/),
  grab(/const isTransfer\s*=.*;/),
  grab(/const expOf\s*=.*;/),
  grab(/const incOf\s*=.*;/),
  grab(/const SETTLE_SLACK\s*=.*;/),
  grab(/function catFlows\(rows\)\{[\s\S]*?\n\}/),
  grab(/function limitUsage\(rows\)\{[\s\S]*?\n\}/),
  grab(/function netSplit\(rows\)\{[\s\S]*?\n\}/),
].join("\n");
const { limitUsage, netSplit, expOf, incOf } =
  new Function(code + "\nreturn {limitUsage, netSplit, expOf, incOf};")();

let fails = 0;
const ok = (name, cond, note) => {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && note ? "  — " + note : ""}`);
};
const R = (type, category, amount, member = "A") => ({ type, category, amount, member });
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const rows = [
  R("지출", "생활비", 50000), R("입금", "생활비", 12000),       // 부분 정산 → 38,000 지출
  R("지출", "쇼핑", 30000),   R("입금", "쇼핑", 30000),         // 전액 환불 → 0
  R("지출", "경조사", 100000), R("입금", "경조사", 300000),     // 받은 축의금이 낸 것보다 큼 → 정산 아님: 지출 10만 + 수입 30만
  R("입금", "월급", 3000000),                                   // 순수 수입
  R("지출", "교통", 20000),                                     // 순수 지출
  R("지출", "계좌간 이동", 500000), R("입금", "계좌간 이동", 500000),  // 이동은 어디에도 안 잡힌다
];

// ── 한도: 지출 − 상쇄분 (이제 음수가 없다) ──
const u = limitUsage(rows);
ok("한도 — 부분 정산은 지출에서 차감", u["생활비"] === 38000, `생활비 ${u["생활비"]}`);
ok("한도 — 전액 환불은 0", u["쇼핑"] === 0, `쇼핑 ${u["쇼핑"]}`);
ok("한도 — 지출보다 큰 입금은 상쇄하지 않는다", u["경조사"] === 100000, `경조사 ${u["경조사"]}`);
ok("한도 — 계좌간 이동 제외", !("계좌간 이동" in u));
ok("한도 — 음수가 없다", Object.values(u).every(v => v >= 0), JSON.stringify(u));

// ── 분석: 상쇄 후 지출 / 상쇄 안 된 입금은 수입 ──
const n = netSplit(rows);
ok("분석 — 지출", same(n.exp, { 생활비: 38000, 경조사: 100000, 교통: 20000 }), JSON.stringify(n.exp));
ok("분석 — 수입", same(n.inc, { 경조사: 300000, 월급: 3000000 }), JSON.stringify(n.inc));
ok("분석 — 전액 환불 카테고리는 어느 쪽에도 없다", !("쇼핑" in n.exp) && !("쇼핑" in n.inc));
ok("분석 — 합계가 카테고리 합과 같다", n.expTot === 158000 && n.incTot === 3300000, `exp ${n.expTot} inc ${n.incTot}`);

// ── 2026-11-25 실데이터에서 지출을 지우던 세 모양 ──
const big = netSplit([R("지출", "생활비", 569625), R("입금", "생활비", 400000), R("입금", "생활비", 10576725)]);
ok("실례 — 예금 해지(지출보다 큼)는 수입, 정산 40만만 상쇄", big.exp["생활비"] === 169625 && big.inc["생활비"] === 10576725,
   JSON.stringify(big));
const rent = netSplit([R("지출", "이자", 876000), R("입금", "이자", 3080000)]);
ok("실례 — 이자 지출 87.6만이 월세 입금에 지워지지 않는다", rent.exp["이자"] === 876000 && rent.inc["이자"] === 3080000, JSON.stringify(rent));
const ins = netSplit([R("지출", "생활비", 10000), R("입금", "생활비", 3000), R("입금", "생활비", 4000), R("입금", "생활비", 5000)]);
ok("작은 입금부터 지출 한도까지만 상쇄 (3천+4천 상쇄, 5천은 수입)", ins.exp["생활비"] === 3000 && ins.inc["생활비"] === 5000, JSON.stringify(ins));
const slack = netSplit([R("지출", "데이트", 648746), R("입금", "데이트", 700000)]);
ok("정산 반올림(20% 이내) — 지출만큼 상쇄, 넘친 만큼만 수입", !("데이트" in slack.exp) && slack.inc["데이트"] === 51254, JSON.stringify(slack));
const over = netSplit([R("지출", "이자", 876000), R("입금", "이자", 1540000)]);
ok("20% 를 넘으면(1.76배) 상쇄하지 않는다", over.exp["이자"] === 876000 && over.inc["이자"] === 1540000, JSON.stringify(over));
const cross = netSplit([R("지출", "생활비", 490000, "정우"), R("입금", "생활비", 10576725, "지현"), R("지출", "생활비", 569625, "지현")]);
ok("멤버를 넘어 상쇄하지 않는다 ('전체' 필터)", cross.exp["생활비"] === 490000 + 569625, JSON.stringify(cross));

// ── 핵심 불변식: 순수익(수입−지출)은 총액 방식과 같다 (상쇄분만 양쪽에서 빠진다) ──
for (const [nm, rs] of [["기본", rows], ["예금 해지", [R("지출","생활비",569625), R("입금","생활비",400000), R("입금","생활비",10576725)]],
                         ["멤버 혼합", [R("지출","생활비",490000,"정우"), R("입금","생활비",10576725,"지현"), R("지출","생활비",569625,"지현")]]]) {
  const x = netSplit(rs);
  ok(`불변식(${nm}) — 순수익 = 총액 방식`, x.incTot - x.expTot === incOf(rs) - expOf(rs), `${x.incTot - x.expTot} vs ${incOf(rs) - expOf(rs)}`);
  ok(`불변식(${nm}) — 지출 ≤ 총액 지출`, x.expTot <= expOf(rs));
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
