// 로그인 게이트를 실 DB 상대로 렌더한다(읽기만 — 어떤 변경 함수도 호출하지 않는다).
// 이 시점엔 RLS가 아직 열려 있으므로, 게이트가 고장났다면 데이터가 실제로 화면에 뜬다.
// 즉 "데이터가 안 보인다"가 의미 있는 신호가 된다.
// 두 번째 인자로 "wrongpw"를 주면 틀린 비밀번호로 실제 로그인을 시도해 실패 경로를 확인한다.
// 비밀번호를 모르는 채로도 폼·Supabase 호출·에러 표시 배선을 검증할 수 있다(실패 1회는 무해).
const fs = require("fs"), path = require("path");
const DIR = process.argv[2];
const MODE = process.argv[3] || "";
if(!DIR){ console.error("사용법: node shot_auth.js <출력디렉터리> [wrongpw]"); process.exit(1); }
const base = fs.readFileSync("C:/Users/1226c/Projects/Our_Budget/public/index.html", "utf8");

const WRONG = MODE === "wrongpw";
const inject = `<script>
var __WRONG__ = ${WRONG};
try{
  localStorage.removeItem("ourbudget.auth");        // 로그아웃 상태 강제
  localStorage.setItem("ourbudget.deviceUser","정우");
}catch(e){}
window.addEventListener("load", function(){
  // 변경 함수 전면 스텁 — 실서비스 DB에 쓰는 사고 방지
  var stubs = ["setTaxMap","saveLimit","addMaster","delMaster","addMember","delMember","saveEntry",
   "saveTransfer","delEntry","saveIcon","saveAppSetting","saveBillingStart","saveTySalary",
   "applyTaxSuggest","doLogout"];
  if(!__WRONG__) stubs.push("doLogin");   // 실패경로 테스트일 때만 진짜 doLogin을 돌린다
  stubs.forEach(function(f){ window[f]=function(){ console.log("BLOCKED "+f); return false; }; });

  function snap(extra){
    var ov = document.getElementById("authOv");
    var main = document.getElementById("main");
    var txt = (main && main.innerText || "").trim();
    var old = document.getElementById("DUMP");
    if(old) old.remove();
    var d = document.createElement("pre");
    d.id = "DUMP";
    d.textContent = JSON.stringify(Object.assign({
      authOpen: !!(ov && ov.classList.contains("open")),
      mainLen: txt.length,
      hasMoney: /[0-9],[0-9]{3}원/.test(txt),        // 금액이 렌더됐는가
      hasErrCard: /데이터 연결 오류/.test(txt),
      pwField: !!document.getElementById("authPw")
    }, extra || {}));
    document.body.appendChild(d);
  }

  setTimeout(function(){
    if(!__WRONG__){ snap(); return; }
    // 틀린 비밀번호로 제출 → 에러 문구가 뜨고 데이터는 여전히 안 나와야 한다
    document.getElementById("authPw").value = "definitely-not-the-password-" + Date.now();
    document.querySelector("#authOv form").dispatchEvent(new Event("submit", {cancelable:true}));
    setTimeout(function(){
      snap({ errMsg: (document.getElementById("authMsg").textContent || "").trim(),
             btnLabel: (document.getElementById("authBtn").textContent || "").trim() });
    }, 4000);
  }, 3000);
});
</` + `script>`;

fs.writeFileSync(path.join(DIR, "auth.html"), base.replace("</head>", inject + "</head>"), "utf8");
fs.writeFileSync(path.join(DIR, "wrap_auth.html"),
  `<body style="margin:0;background:#111"><iframe src="auth.html" width="360" height="740" style="border:0;display:block"></iframe></body>`,
  "utf8");
console.log("written to", DIR);
