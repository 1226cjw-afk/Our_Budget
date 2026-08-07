// 가족 공용 계정 로그인 헬퍼.
// RLS를 to authenticated로 좁힌 뒤로 anon key만으로는 REST에서 한 행도 오지 않는다(401).
// 스크립트가 데이터를 읽으려면 access_token이 있어야 한다.
//
// 비밀번호는 코드·리포·커밋 어디에도 두지 않는다 → 환경변수 BUDGET_PW로 받는다.
//   PowerShell:  $env:BUDGET_PW='비밀번호'; node scripts\dump.js
//   bash:        BUDGET_PW='비밀번호' node scripts/dump.js
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
    console.error("  PowerShell:  $env:BUDGET_PW='...'; node scripts\\<스크립트>.js");
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

module.exports = {HOST, KEY, EMAIL, req, login, authedGet};
