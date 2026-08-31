// 로그인 게이트가 소스에 실제로 배선됐는지 확인. 헤드리스 렌더는 별도(shot_auth.js).
// 여기서 잡으려는 건 "화면은 그럴듯한데 게이트가 사실상 없는" 상태다.
const fs = require("fs");
const path = require("path");
// 인자로 다른 파일을 줄 수 있다 — 일부러 깨뜨린 사본에 대고 FAIL이 나는지 확인하는 용도.
// (검사기가 '항상 통과'하는 상태를 잡으려면 검사기 자체를 반증할 수 있어야 한다)
const SRC = process.argv[2] || path.join(__dirname, "..", "public", "index.html");
const src = fs.readFileSync(SRC, "utf8");

const must = [
  ["공용 계정 상수",             /const FAMILY_EMAIL\s*=\s*"[^"]+"/],
  ["persistSession 옵션",        /persistSession\s*:\s*true/],
  ["autoRefreshToken 옵션",      /autoRefreshToken\s*:\s*true/],
  ["세션 없으면 showAuth",        /if\(!session\)\{\s*clearSnapshot\(\);\s*showAuth\(\)/],
  ["SIGNED_OUT 복귀",            /onAuthStateChange[\s\S]{0,120}?SIGNED_OUT[\s\S]{0,60}?showAuth/],
  // ── 스냅샷 캐시(2026-09-01) ──
  // 캐시는 로그인 화면을 건너뛰고 금액을 그린다. 그래서 '언제 그리는가'와 '언제 지우는가'가
  // 게이트의 일부다 — 지우는 자리를 하나라도 빠뜨리면 로그아웃·세션만료 뒤에도 금액이 다시 뜬다.
  ["storageKey가 AUTH_KEY와 한 벌", /storageKey\s*:\s*AUTH_KEY/],
  ["캐시 렌더는 저장된 세션이 있을 때만", /if\(hasStoredSession\(\)\)\s*bootFromSnapshot\(\)/],
  ["SIGNED_OUT이 캐시를 지움",     /SIGNED_OUT[\s\S]{0,40}?clearSnapshot\(\)/],
  ["세션 없으면 캐시를 지움",       /if\(!session\)\{\s*clearSnapshot\(\)/],
  ["스냅샷은 전량일 때만 저장",     /saveSnapshot[\s\S]{0,700}?res\.lim\.error\s*\|\|\s*res\.mst\.error/],
  ["로그인 폼 비밀번호 필드",      /id="authPw"[\s\S]{0,80}?autocomplete="current-password"/],
  ["비밀번호 관리자용 username",  /autocomplete="username"/],
  ["로그아웃 버튼",               /onclick="doLogout\(\)"/],
  ["refreshData 인증오류 분기",   /refreshData[\s\S]{0,400}?isAuthErr\(e\)/],
  ["retryLoad 인증오류 분기",     /retryLoad[\s\S]{0,300}?isAuthErr\(e\)/],
];

const forbid = [
  ["비밀번호 하드코딩",           /signInWithPassword\(\{[^}]*password\s*:\s*["'][^"']/],
  // load는 폰트·이미지까지 기다려 첫 DB 요청이 그 뒤로 밀린다(2026-08-15 실측 +817ms/데스크톱).
  // 주석 속 'window.onload' 언급은 오탐이므로 대입(=)까지 있어야 잡는다.
  ["시작점이 window.onload",      /window\.onload\s*=/],
];

// ESC 핸들러가 로그인 게이트를 닫으면 안 된다(닫히면 게이트가 아니다).
// 주석에서 authOv를 '언급'만 해도 걸리면 오탐이므로 줄 주석을 걷어낸 뒤 코드만 본다.
function escHandlerCode(s){
  const i = s.indexOf('e.key!=="Escape"');
  if(i < 0) return null;
  const end = s.indexOf("});", i);
  if(end < 0) return null;
  return s.slice(i, end).replace(/\/\/[^\n]*/g, "");
}

// 시작 핸들러 본문 안에서 loadAll을 직접 부르면 안 된다 — 세션 없이 데이터를 긁게 된다.
// (startApp 안의 loadAll은 정상이므로 '근처 문자열' 매칭으로는 판정할 수 없다. 본문을 잘라내 확인)
// ⚠️ 앵커는 실제 시작점이어야 한다. 예전엔 "window.onload"로 찾았는데, 그 문자열이 주석에만 남아도
//    엉뚱한 위치가 잡혀 검사가 '우연히' 통과한다 — 시작점을 옮길 땐 이 앵커도 같이 옮길 것.
// ⚠️ 함수 본문 단위로 잘라서 본다. 소스 전체에 대고 정규식을 돌리면 **다른 함수의 같은 조각**에
//    매칭돼 우연히 통과한다 — 2026-09-01에 "startApp 인증오류 분기"가 실제로 retryLoad를 보고
//    통과하고 있었다(startApp엔 clearSnapshot이 끼어들어 더는 안 맞는데도 ok가 떴다).
function fnBody(s, anchor){
  const i = s.indexOf(anchor);
  if(i < 0) return null;
  const open = s.indexOf("{", i);
  if(open < 0) return null;
  let d = 0;
  for(let j = open; j < s.length; j++){
    if(s[j] === "{") d++;
    else if(s[j] === "}"){ d--; if(!d) return s.slice(open, j + 1); }
  }
  return null;
}
const bootBody = s => fnBody(s, 'document.addEventListener("DOMContentLoaded"');

let bad = 0;
must.forEach(([n, re]) => {
  const ok = re.test(src);
  if(!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${n}`);
});
forbid.forEach(([n, re]) => {
  const hit = re.test(src);
  if(hit) bad++;
  console.log(`${hit ? "FAIL" : "ok  "} ${n} (없어야 함)`);
});

const esc = escHandlerCode(src);
if(esc === null){ bad++; console.log("FAIL ESC 핸들러를 못 찾음"); }
else {
  const hit = /authOv/.test(esc);
  if(hit) bad++;
  console.log(`${hit ? "FAIL" : "ok  "} ESC가 로그인 게이트를 닫음 (없어야 함)`);
}

const body = bootBody(src);
if(body === null){ bad++; console.log("FAIL DOMContentLoaded 시작 핸들러 본문을 못 찾음"); }
else {
  const hit = /loadAll\(/.test(body);
  if(hit) bad++;
  console.log(`${hit ? "FAIL" : "ok  "} 시작 핸들러가 loadAll을 직접 호출 (없어야 함)`);
}

// startApp 안의 인증오류 분기 — 여기서 캐시를 안 지우면 다음 접속에 '로그인 못 하는데 금액은 보이는' 상태가 된다
const startBody = fnBody(src, "async function startApp(");
if(startBody === null){ bad++; console.log("FAIL startApp 본문을 못 찾음"); }
else {
  const okA = /if\(isAuthErr\(e\)\)\{\s*clearSnapshot\(\);\s*showAuth\(\);\s*return;\s*\}/.test(startBody);
  if(!okA) bad++;
  console.log(`${okA ? "ok  " : "FAIL"} startApp 인증오류가 캐시를 지우고 로그인 화면으로`);
}

// doLogout — signOut 전에 캐시를 지워야 한다(지우기 전에 reload가 걸리면 캐시가 남는다)
const outBody = fnBody(src, "async function doLogout(");
if(outBody === null){ bad++; console.log("FAIL doLogout 본문을 못 찾음"); }
else {
  const okB = outBody.indexOf("clearSnapshot()") > 0 &&
              outBody.indexOf("clearSnapshot()") < outBody.indexOf("signOut()");
  if(!okB) bad++;
  console.log(`${okB ? "ok  " : "FAIL"} doLogout이 signOut 전에 캐시를 지움`);
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
