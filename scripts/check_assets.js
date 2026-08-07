// 배포본이 앱 외 파일을 서빙하는지 점검.
// assets.directory="." 라 리포 루트가 통째로 공개되던 문제의 검증용.
// (.assetsignore는 wrangler 4.120에서 적용되지 않았다 — '*'를 넣어도 파일 수가 그대로.
//  그래서 배포 대상을 public/ 로 좁히는 방식으로 해결했다. 이 스크립트가 그 결과를 확인한다)
// 캐시 버스터를 붙여 엣지 캐시가 옛 200을 돌려주는 것을 피한다.
const https = require("https");
const HOST = "ourbudget.1226cjw.workers.dev";
const MUST_BLOCK = [
  "/CLAUDE.md", "/backup_appscript.gs", "/.gitignore",
  "/wrangler.jsonc", "/.git/config", "/.git/HEAD", "/.git/index", "/.git/logs/HEAD",
  "/docs/superpowers/specs/2026-08-07-auth-gate-design.md",
  "/scripts/dump.js", "/public/index.html",   // public/ 은 루트로 매핑되므로 이 경로도 404여야 정상
];
const MUST_SERVE = ["/"];

function get(p){
  const sep = p.includes("?") ? "&" : "?";
  return new Promise((res, rej) => {
    https.get({host:HOST, path:p+sep+"cb="+Date.now(), headers:{"Cache-Control":"no-cache"}}, r => {
      r.resume();
      r.on("end", () => res(r.statusCode));
    }).on("error", rej);
  });
}

(async () => {
  let bad = 0;
  for(const p of MUST_BLOCK){
    const s = await get(p);
    const ok = s === 404;
    if(!ok) bad++;
    console.log(`${ok?"ok  ":"FAIL"} ${p} -> ${s} (기대 404)`);
  }
  for(const p of MUST_SERVE){
    const s = await get(p);
    const ok = s === 200;
    if(!ok) bad++;
    console.log(`${ok?"ok  ":"FAIL"} ${p} -> ${s} (기대 200)`);
  }
  console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
  process.exit(bad ? 1 : 0);
})();
