// 배포 반영을 기다리며 상태를 라운드마다 기록한다.
// 가장 중요한 확인은 '/'가 계속 200인지 — 배포 설정을 바꾼 뒤엔 앱이 통째로 안 뜰 수 있다.
const https = require("https");
const HOST = "ourbudget.1226cjw.workers.dev";
const MAX = Number(process.argv[2] || 12), GAP = 20000;

function get(p){
  return new Promise((res, rej) => {
    const bufs = [];
    https.get({host:HOST, path:p+(p.includes("?")?"&":"?")+"cb="+Date.now(),
               headers:{"Cache-Control":"no-cache"}}, r => {
      r.on("data", d => bufs.push(d));
      r.on("end", () => res({status:r.statusCode, len:Buffer.concat(bufs).length}));
    }).on("error", rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for(let i = 1; i <= MAX; i++){
    const root = await get("/");
    const leak = await get("/CLAUDE.md");
    const git  = await get("/.git/config");
    const done = root.status === 200 && leak.status === 404 && git.status === 404;
    console.log(`[${i}/${MAX}] / -> ${root.status} (${root.len}b) | /CLAUDE.md -> ${leak.status} | /.git/config -> ${git.status}${done?"   ← 반영됨":""}`);
    if(root.status !== 200){
      console.log("\n⚠️ 앱이 200이 아니다. 배포가 깨졌을 수 있음 — 즉시 확인할 것");
    }
    if(done){ console.log("\n배포 반영 완료"); process.exit(0); }
    if(i < MAX) await sleep(GAP);
  }
  console.log("\n시간 내 미반영 — 배포 로그를 확인할 것");
  process.exit(1);
})();
