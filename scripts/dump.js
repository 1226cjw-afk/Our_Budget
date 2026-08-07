// 변경 전 전량 덤프. RLS를 조이기 전 롤백 근거를 확보한다.
// anon key 읽기가 아직 열려 있을 때만 동작한다(= RLS 축소 이전에 실행할 것).
// ⚠️ 응답을 문자열로 누적하지 말 것 — 청크 경계에서 한글 UTF-8이 쪼개져 U+FFFD로 조용히 깨진다.
const https = require("https"), fs = require("fs"), path = require("path");
const HOST = "hqyvkyflakhuvethrstw.supabase.co";
const KEY  = "sb_publishable_phZGH7odPTBoB4z8FQF_4A_mO2ltQ6J";
const TABLES = ["members","transactions","category_limits","master_data","tax_map","app_settings"];
const OUT = path.join(__dirname, "..", "_backup");

function get(p){
  return new Promise((res, rej) => {
    https.get({host:HOST, path:p, headers:{apikey:KEY, Authorization:"Bearer "+KEY}}, r => {
      const bufs = [];
      r.on("data", d => bufs.push(d));
      r.on("end", () => res({status:r.statusCode, body:Buffer.concat(bufs).toString("utf8")}));
    }).on("error", rej);
  });
}

(async () => {
  fs.mkdirSync(OUT, {recursive:true});
  const dump = {}, counts = {};
  for(const t of TABLES){
    const r = await get(`/rest/v1/${t}?select=*`);
    if(r.status !== 200) throw new Error(`${t}: HTTP ${r.status} — ${r.body.slice(0,200)}`);
    dump[t] = JSON.parse(r.body);
    counts[t] = dump[t].length;
  }
  const stamp = new Date().toISOString().slice(0,10);
  const file = path.join(OUT, `${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 1), "utf8");
  const raw = fs.readFileSync(file, "utf8");
  console.log("저장:", file);
  console.log("건수:", JSON.stringify(counts));
  console.log("한글 깨짐(U+FFFD):", /�/.test(raw) ? "⚠️ 있음 — 재실행할 것" : "없음");
})();
