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
  // ── 스냅샷 캐시(2026-09-01) ──
  // 캐시는 로그인 화면을 건너뛰고 금액을 그린다. 그래서 '언제 그리는가'와 '언제 지우는가'가
  // 게이트의 일부다 — 지우는 자리를 하나라도 빠뜨리면 로그아웃·세션만료 뒤에도 금액이 다시 뜬다.
  // 지우는 일은 authLost() 한 곳이 맡는다(아래 'showAuth 직접 호출' 검사가 우회를 막는다).
  ["세션 없으면 authLost",        /if\(!session\)\{\s*authLost\(\);\s*return;/],
  ["SIGNED_OUT → authLost",      /onAuthStateChange[\s\S]{0,120}?SIGNED_OUT[\s\S]{0,40}?authLost\(\)/],
  ["storageKey가 AUTH_KEY와 한 벌", /storageKey\s*:\s*AUTH_KEY/],
  ["캐시 렌더는 저장된 세션이 있을 때만", /if\(hasStoredSession\(\)\)\s*bootFromSnapshot\(\)/],
  ["스냅샷은 전량일 때만 저장",     /saveSnapshot[\s\S]{0,700}?res\.lim\.error\s*\|\|\s*res\.mst\.error/],
  ["로그인 폼 비밀번호 필드",      /id="authPw"[\s\S]{0,80}?autocomplete="current-password"/],
  ["비밀번호 관리자용 username",  /autocomplete="username"/],
  ["로그아웃 버튼",               /onclick="doLogout\(\)"/],
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

// authLost — 세션을 잃었을 때의 유일한 경로. 캐시를 지운 뒤에 로그인 화면을 띄워야 한다
const lostBody = fnBody(src, "function authLost(");
if(lostBody === null){ bad++; console.log("FAIL authLost 본문을 못 찾음"); }
else {
  const iC = lostBody.indexOf("clearSnapshot()"), iS = lostBody.indexOf("showAuth()");
  const okL = iC > 0 && iS > iC;
  if(!okL) bad++;
  console.log(`${okL ? "ok  " : "FAIL"} authLost가 캐시를 지우고 로그인 화면으로`);
}

// showAuth()를 authLost 밖에서 직접 부르면 그 자리는 캐시를 남긴다.
// 2026-10-25까지 refreshData·retryLoad가 실제로 그랬다 — 지우는 자리가 4곳에 흩어져 있어
// 새 경로를 만들 때마다 빠뜨릴 수 있었다. 이제 호출 자체를 한 곳으로 모으고 여기서 센다.
// (주석 속 언급은 오탐이므로 주석을 걷어낸 코드만 본다. URL의 '//'는 앞이 ':'라 안 걷힌다)
{
  const script = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
  const codeOnly = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}()])\/\/[^\n]*/g, "$1");
  const direct = (codeOnly.match(/(?<!function\s+)showAuth\(\)/g) || []).length;   // 선언은 호출이 아니다
  const okD = direct === 1;   // authLost 안의 한 번
  if(!okD) bad++;
  console.log(`${okD ? "ok  " : "FAIL"} showAuth()는 authLost 안에서만 호출 (${direct}곳)`);
}

// 인증오류 분기 — 로드를 부르는 곳마다 에러 카드가 아니라 authLost로 가야 한다.
// ⚠️ 함수 본문 단위로 본다(위 fnBody 주석) — 소스 전체에 걸면 다른 함수의 같은 조각에 매칭된다
for (const anchor of ["async function startApp(", "async function syncInBackground(",
                      "async function refreshData(", "async function retryLoad(",
                      "async function reloadAndRender("]) {
  const nm = anchor.replace(/^async function |\($/g, "");
  const b = fnBody(src, anchor);
  if(b === null){ bad++; console.log(`FAIL ${nm} 본문을 못 찾음`); continue; }
  const okA = /if\(isAuthErr\(e\)\)\{\s*authLost\(\);\s*return;\s*\}/.test(b);
  if(!okA) bad++;
  console.log(`${okA ? "ok  " : "FAIL"} ${nm} 인증오류 → authLost (캐시 삭제 + 로그인 화면)`);
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
