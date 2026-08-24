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
  var MEMO=["회사 근처 백반","주말 장보기","8월 전기요금","주유","친구 만남","정기 검진","","",""];
  function d(off){var t=new Date(2026,7,24);t.setDate(t.getDate()-off);
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
