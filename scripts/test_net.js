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
const R = (type, category, amount) => ({ type, category, amount });

const rows = [
  R("지출", "생활비", 50000), R("입금", "생활비", 12000),       // 부분 정산 → 38,000 지출
  R("지출", "쇼핑", 30000),   R("입금", "쇼핑", 30000),         // 전액 환불 → 사라짐
  R("지출", "경조사", 100000), R("입금", "경조사", 300000),     // 받은 게 더 많음 → 200,000 수입
  R("입금", "월급", 3000000),                                   // 순수 수입
  R("지출", "교통", 20000),                                     // 순수 지출
  R("지출", "계좌간 이동", 500000), R("입금", "계좌간 이동", 500000),  // 이동은 어디에도 안 잡힌다
];

// ── 한도: 부호 있는 순액 ──
const u = limitUsage(rows);
ok("한도 — 부분 정산은 지출에서 차감", u["생활비"] === 38000, `생활비 ${u["생활비"]}`);
ok("한도 — 전액 환불은 0", u["쇼핑"] === 0, `쇼핑 ${u["쇼핑"]}`);
ok("한도 — 받은 게 더 많으면 음수(바는 0%로 바닥)", u["경조사"] === -200000, `경조사 ${u["경조사"]}`);
ok("한도 — 계좌간 이동 제외", !("계좌간 이동" in u));

// ── 분석: 양수는 지출, 음수는 수입 ──
const n = netSplit(rows);
ok("분석 — 지출 쪽 = 순액이 양수인 카테고리만",
   JSON.stringify(n.exp) === JSON.stringify({ 생활비: 38000, 교통: 20000 }), JSON.stringify(n.exp));
ok("분석 — 수입 쪽 = 순액이 음수인 카테고리(경조사·월급)",
   JSON.stringify(n.inc) === JSON.stringify({ 경조사: 200000, 월급: 3000000 }), JSON.stringify(n.inc));
ok("분석 — 0이 된 카테고리는 어느 쪽에도 없다", !("쇼핑" in n.exp) && !("쇼핑" in n.inc));
ok("분석 — 합계가 카테고리 합과 같다",
   n.expTot === 58000 && n.incTot === 3200000, `exp ${n.expTot} inc ${n.incTot}`);

// ── 핵심 불변식: 순수익은 옛 총액 방식과 같다 (상쇄분만 양쪽에서 빠진다) ──
ok("분석 — 순수익(수입−지출)은 총액 방식과 동일",
   n.incTot - n.expTot === incOf(rows) - expOf(rows),
   `순액 ${n.incTot - n.expTot} vs 총액 ${incOf(rows) - expOf(rows)}`);
ok("분석 — 순액 지출 ≤ 총액 지출 (부풀지 않고 줄기만 한다)", n.expTot <= expOf(rows));

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
