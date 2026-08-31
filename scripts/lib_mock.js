// 렌더·기능 검증용 가짜 Supabase 클라이언트 + 합성 데이터.
// shot_theme.js 와 test_date_field.js 가 함께 쓴다 — 데이터를 두 벌 유지하면 어긋난다.
//
// ⚠️ 실서비스 DB 를 건드리지 않기 위한 장치다. 이 mock 을 쓰는 스크립트에서
//    저장 함수(saveEntry·setTaxMap 등)를 dispatchEvent 로 발화시키지 말 것 — 테스트 DB 가 없다.
// ⚠️ <head> 에 동기 삽입할 것. CDN(supabase-js)은 Network.setBlockedURLs 로 함께 막아야 한다 —
//    CDN 이 defer 라 나중에 실행되면 window.supabase 를 도로 덮어쓴다.

/* ══════ 가짜 데이터 — 실제 분포를 닮게 합성한다 (가족 실데이터를 쓰지 않는다) ══════ */
const MOCK = `
(function(){
  var CATS=[["식비",42],["장보기",14],["공과금",9],["교통/차량",11],["카페",13],
            ["의료",4],["문화",5],["구독",4]];
  var ACC={"정우":["국민은행","현대카드"],"지현":["신한은행","카카오뱅크"]};
  var MET={"정우":["현대카드","현금","자동이체"],"지현":["신한카드","카카오페이","자동이체"]};
  // 메모에 달(月)을 박지 말 것 — 위 앵커가 상대 날짜라 '8월 전기요금'이 9월 행에 붙는다
  var MEMO=["회사 근처 백반","주말 장보기","전기요금","주유","친구 만남","정기 검진","","",""];
  // ⚠️ 앵커를 고정 날짜로 두지 말 것 (2026-08-30 에 실제로 썩었다).
  //    원래 2026-08-24 고정이었는데, 그날이 지나자 합성 행이 전부 '이전 주기'로 떨어져
  //    shot_theme 의 내역·분류 스크린샷이 "내역이 없어요" 빈 화면으로 찍히고 있었다.
  //    앱이 죽은 게 아니라 검증 도구가 조용히 아무것도 안 보게 된 것이라 알아채기 어렵다.
  //    → 오늘 기준 상대 날짜로 만든다. 대신 스크린샷은 날마다 조금씩 달라진다(그게 정상).
  var ANCHOR = new Date(); ANCHOR.setHours(12,0,0,0);   // 정오 고정 — 타임존 경계에서 하루 밀리는 것 방지
  function d(off){var t=new Date(ANCHOR);t.setDate(t.getDate()-off);
    return t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0");}
  var rows=[],id=0;
  function pick(a,i){return a[i%a.length];}
  for(var k=0;k<180;k++){
    var m = k%3===0 ? "지현" : "정우";
    var c = pick(CATS,(k*7)%CATS.length)[0];
    rows.push({id:"r"+(++id),date:d(Math.floor(k*0.62)),amount:(3+((k*37)%78))*1000,
      type:"지출",category:c,account:pick(ACC[m],k),member:m,method:pick(MET[m],k),memo:pick(MEMO,k)});
  }
  for(var j=0;j<6;j++){
    rows.push({id:"r"+(++id),date:d(j*30+2),amount:2800000,type:"입금",category:"월급",
      account:"국민은행",member:"정우",method:null,memo:"급여"});
  }
  // 계좌간 이동 한 쌍 (지출+입금 2건으로 풀린다 — type 에 '이동' 은 없다)
  rows.push({id:"r"+(++id),date:d(2),amount:500000,type:"지출",category:"계좌간 이동",
    account:"국민은행",member:"정우",method:null,memo:null});
  rows.push({id:"r"+(++id),date:d(2),amount:500000,type:"입금",category:"계좌간 이동",
    account:"현대카드",member:"정우",method:null,memo:null});

  var master=[];
  ["정우","지현"].forEach(function(m){
    CATS.concat([["월급",0]]).forEach(function(c){master.push({member:m,type:"category",value:c[0]});});
    MET[m].forEach(function(v){master.push({member:m,type:"method",value:v});});
    ACC[m].forEach(function(v){master.push({member:m,type:"account",value:v});});
  });

  var DATA={
    members:[{name:"정우"},{name:"지현"}],
    transactions:rows,
    category_limits:[
      {member:"정우",category:"식비",monthly_limit:600000},
      {member:"정우",category:"카페",monthly_limit:75000},
      {member:"정우",category:"교통/차량",monthly_limit:300000},
      {member:"지현",category:"장보기",monthly_limit:400000}
    ],
    master_data:master,
    app_settings:[
      {key:"billing_start_정우",value:"25"},{key:"billing_start_지현",value:"21"},
      {key:"warn_threshold",value:"80"},{key:"analysis_periods",value:"3"},
      {key:"cat_icon_식비",value:"🍚"},{key:"cat_icon_카페",value:"☕"},
      {key:"cat_icon_공과금",value:"💡"},{key:"cat_icon_장보기",value:"🛒"},
      {key:"cat_icon_교통/차량",value:"⛽"},{key:"cat_icon_월급",value:"💰"},
      {key:"cat_icon_의료",value:"🏥"},{key:"cat_icon_문화",value:"🎬"},
      {key:"cat_icon_구독",value:"📺"}
    ],
    tax_map:[
      {member:"정우",type:"method",value:"현대카드",kind:"credit"},
      {member:"정우",type:"method",value:"현금",kind:"cash"},
      {member:"정우",type:"method",value:"자동이체",kind:"none"},
      {member:"정우",type:"category",value:"월급",kind:"income"},
      {member:"지현",type:"method",value:"신한카드",kind:"check"},
      {member:"지현",type:"method",value:"카카오페이",kind:"check"}
    ]
  };

  function builder(table){
    var payload = DATA[table] || [];
    var b = {
      select:function(){return b;}, order:function(){return b;}, eq:function(){return b;},
      in:function(){return b;}, range:function(){return b;}, limit:function(){return b;},
      // 1차 로드가 최근 RECENT_DAYS일만 받아오는 데 쓴다. 실제로 걸러야 ROWS_PARTIAL 경로가
      // 목에서도 '부분 데이터'가 된다 — 전량을 돌려주면 그 경로를 검증하지 못한다.
      // ⚠️ 앱이 새 필터 메서드를 쓰기 시작하면 여기에도 추가할 것. 없으면 TypeError로
      //    앱 전체가 죽고, 목을 쓰는 검사들이 "JSON parse 실패"라는 엉뚱한 오류로 떨어진다
      gte:function(col,val){ payload = payload.filter(function(r){ return String(r[col]) >= String(val); }); return b; },
      then:function(res){ res({data:payload, error:null, count:payload.length}); return Promise.resolve(); }
    };
    return b;
  }
  window.supabase = { createClient:function(){
    return {
      from:builder,
      auth:{
        getSession:function(){return Promise.resolve({data:{session:{user:{email:"mock@local"}}}});},
        onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
        signOut:function(){return Promise.resolve({});}
      }
    };
  }};
  try{ localStorage.setItem("ourbudget.deviceUser","정우"); }catch(e){}
})();
`;

module.exports = { MOCK };
