// 로그인 게이트가 소스에 실제로 배선됐는지 확인. 헤드리스 렌더는 별도(shot_auth.js).
// 여기서 잡으려는 건 "화면은 그럴듯한데 게이트가 사실상 없는" 상태다.
const fs = require("fs");
const src = fs.readFileSync("C:/Users/1226c/Projects/Our_Budget/public/index.html", "utf8");

const must = [
  ["공용 계정 상수",             /const FAMILY_EMAIL\s*=\s*"[^"]+"/],
  ["persistSession 옵션",        /persistSession\s*:\s*true/],
  ["autoRefreshToken 옵션",      /autoRefreshToken\s*:\s*true/],
  ["세션 없으면 showAuth",        /getSession\(\)[\s\S]{0,160}?if\(!session\)\{\s*showAuth\(\)/],
  ["SIGNED_OUT 복귀",            /onAuthStateChange[\s\S]{0,90}?SIGNED_OUT[\s\S]{0,30}?showAuth/],
  ["로그인 폼 비밀번호 필드",      /id="authPw"[\s\S]{0,80}?autocomplete="current-password"/],
  ["비밀번호 관리자용 username",  /autocomplete="username"/],
  ["로그아웃 버튼",               /onclick="doLogout\(\)"/],
  ["startApp 인증오류 분기",      /if\(isAuthErr\(e\)\)\{\s*showAuth\(\);\s*return;\s*\}/],
  ["refreshData 인증오류 분기",   /refreshData[\s\S]{0,400}?isAuthErr\(e\)/],
  ["retryLoad 인증오류 분기",     /retryLoad[\s\S]{0,300}?isAuthErr\(e\)/],
];

const forbid = [
  ["비밀번호 하드코딩",           /signInWithPassword\(\{[^}]*password\s*:\s*["'][^"']/],
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

// window.onload 본문 안에서 loadAll을 직접 부르면 안 된다 — 세션 없이 데이터를 긁게 된다.
// (startApp 안의 loadAll은 정상이므로 '근처 문자열' 매칭으로는 판정할 수 없다. 본문을 잘라내 확인)
function onloadBody(s){
  const i = s.indexOf("window.onload");
  if(i < 0) return null;
  const open = s.indexOf("{", i);
  let d = 0;
  for(let j = open; j < s.length; j++){
    if(s[j] === "{") d++;
    else if(s[j] === "}"){ d--; if(!d) return s.slice(open, j + 1); }
  }
  return null;
}

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

const body = onloadBody(src);
if(body === null){ bad++; console.log("FAIL window.onload 본문을 못 찾음"); }
else {
  const hit = /loadAll\(/.test(body);
  if(hit) bad++;
  console.log(`${hit ? "FAIL" : "ok  "} onload가 loadAll을 직접 호출 (없어야 함)`);
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
