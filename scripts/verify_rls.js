// anon key로 외부에서 실제로 막혔는지 확인. 정책만 바꾸고 revoke를 빠뜨리면
// 빈 배열이 200으로 와서 '차단됐다'고 오독하기 쉽다 → 그 경우를 명시적으로 실패 처리한다
const https = require("https");
const HOST = "hqyvkyflakhuvethrstw.supabase.co";
const KEY  = "sb_publishable_phZGH7odPTBoB4z8FQF_4A_mO2ltQ6J";
const BUDGET = ["members","transactions","category_limits","master_data","tax_map","app_settings"];
// 이 뷰들은 원래 security_invoker=off + owner=postgres라 하위 테이블 RLS를 우회했다 —
// 테이블만 잠갔을 때 anon이 잔액·카테고리 지출을 그대로 읽는 것을 실측으로 확인했다(200).
// 지금은 두 겹으로 막혀 있다: ① anon revoke ② security_invoker=on(2026-08-07).
// ②가 있어야 누가 나중에 grant를 되돌려도 RLS가 막는다 — 그래도 ①의 회귀를 잡으려고 계속 검사한다.
const VIEWS  = ["v_account_balance","v_limit_usage","v_period_category"];
const FOREST = ["forests","rules","favorites"];   // 휴양림 무영향 확인용

function req(method, path, body){
  return new Promise((res, rej) => {
    const r = https.request({host:HOST, path, method,
      headers:{apikey:KEY, Authorization:"Bearer "+KEY, "Content-Type":"application/json"}}, x => {
      const bufs=[]; x.on("data",d=>bufs.push(d));
      x.on("end",()=>res({status:x.statusCode, body:Buffer.concat(bufs).toString("utf8")}));
    });
    r.on("error", rej);
    if(body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  let bad = 0;
  const say = (ok,msg) => { if(!ok) bad++; console.log(`${ok?"ok  ":"FAIL"} ${msg}`); };

  // 200 []를 차단으로 세지 않는다 — 이 스크립트의 존재 이유
  async function mustBlock(t){
    const r = await req("GET", `/rest/v1/${t}?select=*&limit=1`);
    const blocked = r.status===401 || r.status===403 || r.status===404;
    const emptyOk = r.status===200 && r.body.trim()==="[]";
    say(blocked, `${t} GET -> ${r.status}${emptyOk?"  ⚠️ 200 []는 차단이 아님(revoke 누락)":""}`);
  }

  console.log("V1 — anon 읽기가 막혔는가 (가계부 테이블)");
  for(const t of BUDGET) await mustBlock(t);

  console.log("\nV1b — anon 읽기가 막혔는가 (RLS 우회 뷰)");
  for(const t of VIEWS) await mustBlock(t);

  console.log("\nV3 — anon 쓰기가 막혔는가");
  const w = await req("POST", "/rest/v1/transactions",
    {date:"2000-01-01", amount:1, type:"지출", member:"__probe__", category:"__probe__"});
  say(w.status===401||w.status===403||w.status===404, `transactions POST -> ${w.status}`);
  if(w.status>=200 && w.status<300) console.log("   ⚠️ 행이 실제로 들어갔을 수 있다 — 즉시 확인·삭제할 것");

  console.log("\nV2 — 휴양림은 무영향인가");
  for(const t of FOREST){
    const r = await req("GET", `/rest/v1/${t}?select=*&limit=1`);
    say(r.status===200, `${t} GET -> ${r.status} (기대 200)`);
  }

  console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
  process.exit(bad ? 1 : 0);
})();
