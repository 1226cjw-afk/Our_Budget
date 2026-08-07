// "지금 배포된 것이 내가 커밋한 것과 같은가" — 마커 검사보다 강한 판정.
// 마커는 '그 문자열이 있다'까지만 보장한다. 해시는 한 바이트라도 다르면 잡는다.
//
// ⚠️ 비교 대상은 작업 사본이 아니라 **커밋된 blob**(`git show`)이다.
//    Windows 작업 사본은 CRLF, 리포 blob은 LF라 작업 사본과 비교하면 항상 다르다고 나온다.
//    Cloudflare는 리포를 clone해서 빌드하므로 blob이 정답이다.
const https = require("https"), crypto = require("crypto");
const { execFileSync } = require("child_process");

const HOST = "ourbudget.1226cjw.workers.dev";
const REF  = process.argv[2] || "origin/main";

const get = p => new Promise((res, rej) => {
  const bufs = [];
  https.get({host:HOST, path:p+(p.includes("?")?"&":"?")+"cb="+Date.now(),
             headers:{"Cache-Control":"no-cache"}}, r => {
    r.on("data", d => bufs.push(d));
    r.on("end", () => res({status:r.statusCode, buf:Buffer.concat(bufs)}));
  }).on("error", rej);
});

const sha = b => crypto.createHash("sha256").update(b).digest("hex").slice(0,16);

(async () => {
  let bad = 0;
  const say = (ok,msg) => { if(!ok) bad++; console.log(`${ok?"ok  ":"FAIL"} ${msg}`); };

  const live = await get("/");
  say(live.status === 200, `/ -> ${live.status} (${live.buf.length}b)`);

  const local = execFileSync("git", ["show", `${REF}:public/index.html`], {maxBuffer: 1 << 28});
  const same = sha(live.buf) === sha(local);
  say(same, `배포본 == ${REF}:public/index.html  (live ${sha(live.buf)} / repo ${sha(local)}, ${local.length}b)`);
  if(!same) console.log("   → 배포가 아직 안 끝났거나, 커밋 안 된 로컬 변경이 있다");

  // 해시가 같으면 아래는 사실 중복이지만, 다를 때 '무엇이 빠졌는지'를 바로 알려준다
  const body = live.buf.toString("utf8");
  for(const [name, s] of [
    ["로그인 오버레이",   'id="authOv"'],
    ["세션 유지 설정",     'storageKey:"ourbudget.auth"'],
    ["비밀번호 변경",      'openPwChange()'],
    ["로그아웃",           'doLogout()'],
  ]) say(body.includes(s), `배포본에 ${name}`);

  console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
