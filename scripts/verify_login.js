// RLS 축소의 '반대편' 검증 — 로그인한 세션은 여전히 전부 읽히는가.
// verify_rls.js(anon이 막혔는가)와 짝. 둘 다 통과해야 변경이 끝난 것이다.
//
//   비밀번호 전달법은 lib_auth.js 머리주석 참조 (PowerShell에 직접 치면 명령 기록에 평문으로 남는다)
//
// 비밀번호·access_token은 출력하지 않는다.
const fs = require("fs"), path = require("path");
const { login, authedGet } = require("./lib_auth");

const TABLES = ["members","transactions","category_limits","master_data","tax_map","app_settings"];
const BACKUP = path.join(__dirname, "..", "_backup");

// 전량을 받지 않고 헤더의 총 건수만 회수한다
async function countOf(tok, t){
  const r = await authedGet(tok, `/rest/v1/${t}?select=*`, {Prefer:"count=exact", Range:"0-0"});
  if(r.status !== 200 && r.status !== 206) return {status:r.status, n:null};
  const m = /\/(\d+)$/.exec(r.headers["content-range"] || "");
  return {status:r.status, n: m ? +m[1] : null};
}

// 가장 최근 덤프와 대조 — 건수가 줄었다면 그게 진짜 사고다
function latestDump(){
  if(!fs.existsSync(BACKUP)) return null;
  const files = fs.readdirSync(BACKUP).filter(f => f.endsWith(".json")).sort();
  if(!files.length) return null;
  const f = path.join(BACKUP, files[files.length-1]);
  return {file:f, data: JSON.parse(fs.readFileSync(f, "utf8"))};
}

(async () => {
  const tok = await login();
  console.log("로그인 성공\n");

  let bad = 0;
  const say = (ok,msg) => { if(!ok) bad++; console.log(`${ok?"ok  ":"FAIL"} ${msg}`); };

  const got = {};
  for(const t of TABLES){
    const {status, n} = await countOf(tok, t);
    got[t] = n;
    say(n !== null && n > 0, `${t} -> HTTP ${status}, ${n===null?"건수 회수 실패":n+"건"}`);
  }

  const dump = latestDump();
  if(dump){
    console.log(`\n덤프 대조: ${path.basename(dump.file)}`);
    for(const t of TABLES){
      const was = Array.isArray(dump.data[t]) ? dump.data[t].length : null;
      if(was === null) continue;
      // 늘어난 건 정상(그 사이 입력), 줄어든 건 비정상
      say(got[t] !== null && got[t] >= was, `${t}: 덤프 ${was}건 → 현재 ${got[t]}건`);
    }
  } else {
    console.log("\n(비교할 덤프가 없어 건수 대조는 건너뜀 — node scripts/dump.js 먼저 실행)");
  }

  console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
