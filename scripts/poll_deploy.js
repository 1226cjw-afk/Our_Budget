// 배포 반영을 기다리며 상태를 라운드마다 기록한다.
// 가장 중요한 확인은 '/'가 계속 200인지 — 배포 설정을 바꾼 뒤엔 앱이 통째로 안 뜰 수 있다.
//
// ⚠️ 도착 판정은 반드시 '이번 변경에만 있는 콘텐츠 마커'로 할 것.
//    상태코드만 보면 이전 배포에서 이미 참이던 조건을 '반영됨'으로 오독한다(실제로 겪음).
// 사용법: node poll_deploy.js [최대라운드] [마커문자열]   (마커만 줘도 됨)
// ⚠️ 마커를 첫 인자로 주면 예전엔 Number(마커)=NaN이라 루프가 0회 돌고 곧장
//    "시간 내 미반영"을 찍었다 — 배포가 안 된 것처럼 보이는 조용한 오작동이었다.
//    이제 첫 인자가 숫자가 아니면 마커로 받는다.
const https = require("https");
const HOST = "ourbudget.1226cjw.workers.dev";
const a2 = process.argv[2], a3 = process.argv[3];
const numFirst = a2 !== undefined && a2 !== "" && Number.isFinite(Number(a2));
const MAX = numFirst ? Number(a2) : 12, GAP = 20000;
const MARKER = (numFirst ? a3 : a2) || "";

function get(p){
  return new Promise((res, rej) => {
    const bufs = [];
    https.get({host:HOST, path:p+(p.includes("?")?"&":"?")+"cb="+Date.now(),
               headers:{"Cache-Control":"no-cache"}}, r => {
      r.on("data", d => bufs.push(d));
      r.on("end", () => {
        const buf = Buffer.concat(bufs);
        res({status:r.statusCode, len:buf.length, body:buf.toString("utf8")});
      });
    }).on("error", rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for(let i = 1; i <= MAX; i++){
    const root = await get("/");
    const leak = await get("/CLAUDE.md");
    const git  = await get("/.git/config");
    const hasMarker = !MARKER || root.body.includes(MARKER);
    const done = root.status === 200 && leak.status === 404 && git.status === 404 && hasMarker;
    console.log(`[${i}/${MAX}] / -> ${root.status} (${root.len}b) | /CLAUDE.md -> ${leak.status} | /.git/config -> ${git.status}`
      + (MARKER ? ` | 마커 ${hasMarker?"있음":"없음"}` : "") + (done ? "   ← 반영됨" : ""));
    if(root.status !== 200){
      console.log("\n⚠️ 앱이 200이 아니다. 배포가 깨졌을 수 있음 — 즉시 확인할 것");
    }
    if(done){ console.log("\n배포 반영 완료"); process.exit(0); }
    if(i < MAX) await sleep(GAP);
  }
  console.log("\n시간 내 미반영 — 배포 로그를 확인할 것");
  process.exit(1);
})();
