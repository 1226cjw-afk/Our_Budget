// 가족 공용 계정 로그인 헬퍼.
// RLS를 to authenticated로 좁힌 뒤로 anon key만으로는 REST에서 한 행도 오지 않는다(401).
// 스크립트가 데이터를 읽으려면 access_token이 있어야 한다.
//
// 비밀번호는 코드·리포·커밋 어디에도 두지 않는다 → 환경변수 BUDGET_PW로 받는다.
//
// ⚠️ PowerShell에서 `$env:BUDGET_PW='비밀번호'`처럼 **직접 치지 말 것**.
//    PSReadLine이 명령줄을 그대로 파일에 남긴다
//    ($env:APPDATA\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt)
//    → 비밀번호가 평문으로 영구 보존된다. 아래 Read-Host 방식은 입력이 화면에도 기록에도 안 남는다.
//
//   PowerShell (권장):
//     $s = Read-Host '가족 공용 비밀번호' -AsSecureString
//     $env:BUDGET_PW = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
//     node C:\Users\1226c\Projects\Our_Budget\scripts\<스크립트>.js   # 전체 경로면 어느 폴더에서든 동작
//     Remove-Item Env:\BUDGET_PW                                      # 쓰고 나면 지운다
//
//   bash: 앞에 공백 한 칸을 두면 히스토리에 안 남는다(HISTCONTROL=ignorespace일 때)
//      BUDGET_PW='비밀번호' node scripts/dump.js
const https = require("https");

const HOST  = "hqyvkyflakhuvethrstw.supabase.co";
const KEY   = "sb_publishable_phZGH7odPTBoB4z8FQF_4A_mO2ltQ6J";
const EMAIL = "1226cjw@gmail.com";

// ⚠️ 응답을 문자열로 누적하지 말 것 — 청크 경계에서 한글 UTF-8 3바이트가 쪼개져
//    U+FFFD로 조용히 깨진다(매 요청마다 깨지는 행이 달라져 오진하기 쉬움)
function req(method, path, headers, body){
  return new Promise((res, rej) => {
    const r = https.request({host:HOST, path, method, headers}, x => {
      const bufs = [];
      x.on("data", d => bufs.push(d));
      x.on("end", () => res({status:x.statusCode, headers:x.headers, body:Buffer.concat(bufs).toString("utf8")}));
    });
    r.on("error", rej);
    if(body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function login(){
  const pw = process.env.BUDGET_PW;
  if(!pw){
    console.error("BUDGET_PW 환경변수가 필요합니다 (가족 공용 비밀번호).");
    console.error("  PowerShell (기록에 안 남는 방식):");
    console.error("    $s = Read-Host '가족 공용 비밀번호' -AsSecureString");
    console.error("    $env:BUDGET_PW = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))");
    console.error("    node " + __filename.replace(/lib_auth\.js$/, "<스크립트>.js"));
    console.error("    Remove-Item Env:\\BUDGET_PW");
    process.exit(2);
  }
  const r = await req("POST", "/auth/v1/token?grant_type=password",
    {apikey:KEY, "Content-Type":"application/json"}, {email:EMAIL, password:pw});
  // 응답 본문에 토큰이 들어 있으므로 출력하지 않는다 — 상태코드만 남긴다
  if(r.status !== 200) throw new Error(`로그인 실패: HTTP ${r.status} (비밀번호 또는 계정 상태를 확인하세요)`);
  const tok = JSON.parse(r.body).access_token;
  if(!tok) throw new Error("로그인 응답에 access_token이 없습니다");
  return tok;
}

const authedGet = (tok, path, extra) =>
  req("GET", path, Object.assign({apikey:KEY, Authorization:"Bearer "+tok}, extra||{}));

/* 사람 없이 도는 작업(월간 리포트 예약 작업)용 인증.
   ⚠️ 클라우드 예약 작업엔 비밀번호를 줄 수 없다(로그인은 본문에 비밀번호를 실어야 한다).
   대신 그 클라우드 환경('Our_Budget 월간 리포트')의 네트워크 비밀값에 Supabase **secret key**가 저장돼 있고,
   프록시가 이 호스트로 가는 요청의 `apikey` 헤더를 그 값으로 **덮어쓴다**(2026-11-25 설정).
   그래서 코드는 자리표시자만 보내고, 진짜 키는 코드·리포·대화 어디에도 나타나지 않는다.
   ⚠️ 이 모드에서 Authorization 헤더를 붙이지 말 것 — 새 형식 secret key는 JWT가 아니라서
      Bearer로 보내면 오히려 거부된다. apikey 하나면 게이트웨이가 service_role로 통과시킨다.
   ⚠️ secret key는 RLS를 우회한다(같은 프로젝트의 휴양림 테이블까지). 이 모드를 쓰는 스크립트는
      가계부 표만, 그리고 monthly_reports 외엔 **읽기만** 할 것.

   BUDGET_PW 가 있으면 그쪽(공용 계정 로그인)이 우선이다 — PC에서 같은 스크립트를 돌릴 때. */
async function dbHeaders(){
  if(process.env.BUDGET_PW) return {apikey:KEY, Authorization:"Bearer "+await login()};
  if(process.env.BUDGET_AUTH === "proxy") return {apikey:"sb_secret_proxy-injected"};
  console.error("인증 수단이 없습니다: PC에선 BUDGET_PW(lib_auth.js 머리주석), 클라우드 예약 작업에선 BUDGET_AUTH=proxy");
  process.exit(2);
}

module.exports = {HOST, KEY, EMAIL, req, login, authedGet, dbHeaders};
