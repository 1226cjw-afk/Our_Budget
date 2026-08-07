// 전량 덤프(롤백·백업 근거).
// ⚠️ 2026-08-07 RLS를 to authenticated로 좁힌 뒤로 anon key로는 401이다 → 공용 계정 로그인이 필요하다.
//    $env:BUDGET_PW='비밀번호'; node scripts\dump.js
// ⚠️ 응답을 문자열로 누적하지 말 것 — 청크 경계에서 한글 UTF-8이 쪼개져 U+FFFD로 조용히 깨진다.
const fs = require("fs"), path = require("path");
const { login, authedGet } = require("./lib_auth");

const TABLES = ["members","transactions","category_limits","master_data","tax_map","app_settings"];
const OUT = path.join(__dirname, "..", "_backup");

(async () => {
  const tok = await login();
  fs.mkdirSync(OUT, {recursive:true});
  const dump = {}, counts = {};
  for(const t of TABLES){
    const r = await authedGet(tok, `/rest/v1/${t}?select=*`);
    if(r.status !== 200) throw new Error(`${t}: HTTP ${r.status} — ${r.body.slice(0,200)}`);
    dump[t] = JSON.parse(r.body);
    counts[t] = dump[t].length;
  }
  const stamp = new Date().toISOString().slice(0,10);
  const file = path.join(OUT, `${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 1), "utf8");
  const raw = fs.readFileSync(file, "utf8");
  console.log("저장:", file);
  console.log("건수:", JSON.stringify(counts));
  console.log("한글 깨짐(U+FFFD):", /�/.test(raw) ? "⚠️ 있음 — 재실행할 것" : "없음");
})().catch(e => { console.error(e.message); process.exit(1); });
