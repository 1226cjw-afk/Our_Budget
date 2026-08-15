# 우리집 가계부 — CLAUDE.md

## 프로젝트 개요

가족 공용 가계부 웹앱. 단일 HTML 파일(`public/index.html`)로 배포, Cloudflare Workers로 서빙, Supabase를 백엔드로 사용.
**가족 공용 계정 1개로 로그인해야 데이터가 보인다** (2026-08-07~). 세션이 없으면 앱은 한 행도 불러오지 않고, DB 쪽도 anon을 차단한다.

- **배포 URL**: `https://ourbudget.1226cjw.workers.dev/` (Cloudflare Workers)
- **GitHub**: `https://github.com/1226cjw-afk/Our_Budget`
- **로컬 경로**: `C:/Users/1226c/Projects/Our_Budget/` ← 여기서 작업

---

## 연결 정보

### Git
```
remote: https://github.com/1226cjw-afk/Our_Budget.git
branch: main
```
작업 후 항상 `git add public/index.html && git commit && git push` — Cloudflare Workers가 GitHub `main`을 감지해 자동 배포됨.
> Cloudflare가 GitHub 연결 시 자동 생성한 `cloudflare/workers-autoconfig` 원격 브랜치가 연동 증거. 배포 설정은 저장소가 아니라 Cloudflare 대시보드에 있음.

### Supabase MCP (SQL 직접 실행)
프로젝트 폴더의 `Our_Budget/.mcp.json`에 설정됨 (project 범위).
- ⚠️ **반드시 `Our_Budget` 폴더에서 claude를 열어야 연결됨.** 다른 폴더(예: 홈)에서 열면 MCP 안 붙음
- 바탕화면 "가계부 Claude" 바로가기 또는 PowerShell `budget` 명령으로 열면 자동 연결
- **연결 안 될 경우**: Claude Code 완전 재시작
- ⚠️ 토큰 만료 시 모든 `mcp__supabase__*`가 `Unauthorized`로 실패한다(재시작해도 안 됨).
  이때 REST가 폴백이지만 **anon key만으로는 더 이상 안 된다**(2026-08-07 RLS 축소로 전부 `401`).
  공용 계정 로그인으로 access_token을 받아야 한다 → `scripts/lib_auth.js`의 `login()` 재사용,
  비밀번호는 `BUDGET_PW` 환경변수로만 전달 — 전달법은 아래 '스크립트에 비밀번호 넘기기' 참조.
  단 **DDL은 불가** → 테이블 생성은 사용자에게 SQL을 주고 대시보드에서 실행 요청.
  REST가 `404`면 그 테이블이 없는 것(JS 클라이언트에선 `PGRST205`), `401`이면 **인증 문제**(테이블은 있을 수 있음) — 둘을 섞어 읽지 말 것.
- BOM 회피: PowerShell 대신 node `https.get`으로 받아 파일로 쓰면 `U+FEFF` 제거가 아예 불필요
  - ⚠️ 단 **응답을 문자열로 누적하지 말 것**(`let b=''; r.on('data',d=>b+=d)`). 청크 경계에서 한글 UTF-8 3바이트가 쪼개져 `U+FFFD`로 깨진다.
    `const bufs=[]; r.on('data',d=>bufs.push(d))` → `Buffer.concat(bufs).toString('utf8')` (또는 `r.setEncoding('utf8')`)로 받을 것.
    깨진 값은 `정우`→`정��`처럼 **일부 행만** 조용히 망가지고 매 요청마다 깨지는 행이 달라진다 →
    같은 DB인데 스냅샷마다 집계가 달라져 "DB가 실시간으로 변한다"고 오진하기 쉬움. 실제로 이번에 그렇게 헤맸다.
    검증법: 같은 쿼리를 2회 받아 파일이 바이트 동일한지 + `/�/` 미포함인지 확인.
- ⚠️ `.mcp.json`에 Supabase access token이 평문 저장됨 → git에 커밋 금지 (`.gitignore` 확인)
- 연결되면 `mcp__supabase__*` 도구로 SQL 직접 실행 가능 (Supabase 대시보드 불필요)

### Supabase 프로젝트
```
Project Ref : hqyvkyflakhuvethrstw
URL         : https://hqyvkyflakhuvethrstw.supabase.co
Anon Key    : sb_publishable_phZGH7odPTBoB4z8FQF_4A_mO2ltQ6J   # 공개돼도 무해 — RLS가 to authenticated
공용 계정   : 1226cjw@gmail.com  (비밀번호는 코드·문서·커밋 어디에도 두지 않는다)
```
⚠️ **이 Supabase 프로젝트는 휴양림 프로젝트와 공유한다.** `forests`·`rules`·`favorites`·`policy_snapshots`가
그쪽 테이블이고 **anon으로 열려 있어야 정상**이다(그 앱엔 로그인이 없음).
가계부 쪽 DB 작업은 대상 6개 테이블 + 뷰 3개로 범위를 명시해서 할 것 — `public` 스키마 전체를 훑는
`do $$ ... pg_policies ...$$` 류를 조건 없이 돌리면 남의 앱을 잠근다.

---

## 파일 구조

```
Our_Budget/
├── public/
│   └── index.html       # 앱 전체 (HTML + CSS + JS 단일 파일) — 유일한 배포 산출물
├── wrangler.jsonc       # 배포 설정. assets.directory = "./public" ← 배포 범위를 이 폴더로 한정
├── scripts/             # 검증·운영 스크립트 (배포 안 됨)
│   ├── lib_auth.js      #   공용 계정 로그인 헬퍼 (BUDGET_PW 환경변수)
│   ├── dump.js          #   전량 덤프 → _backup/<날짜>.json
│   ├── verify_rls.js    #   anon이 막혔는가 (외부에서)
│   ├── verify_login.js  #   로그인 세션은 읽히는가 (반대편)
│   ├── check_assets.js  #   배포본에 앱 외 파일이 서빙되는가
│   ├── check_authgate.js#   로그인 게이트 배선이 소스에 들어갔는가
│   ├── check_live.js    #   배포본이 커밋한 것과 동일한가 (sha256)
│   ├── shot_auth.js     #   헤드리스 렌더 확인
│   └── poll_deploy.js   #   배포 반영 폴링
├── docs/superpowers/    # 스펙·플랜 (배포 안 됨)
├── backup_appscript.gs  # 구글 시트 백업용 GAS 코드 (참고용, 배포는 Apps Script에 수동 반영)
└── CLAUDE.md            # 이 파일
# (git 미추적: PROGRESS.md, insert_master.ps1, .mcp.json, _backup/ — 커밋 대상 아님)
```

⚠️ **배포되는 것은 `public/` 안뿐이다.** 예전엔 `assets.directory: "."`라 리포 루트가 통째로 서빙돼
`/CLAUDE.md`(anon key·GAS URL 포함)와 `/.git/**`이 공개돼 있었다(2026-08-07 차단).
새 파일을 추가할 땐 **공개돼도 되는가**를 먼저 판단하고, 앱 자산일 때만 `public/`에 둘 것.
검증: `node scripts/check_assets.js` — 앱 외 경로가 404인지, `/`가 200인지 함께 본다.

CSS · JS 모두 `public/index.html` 안에 인라인. 외부 의존성 (모두 `<head>`에서 논블로킹 로드):
- `@supabase/supabase-js@2` · `chart.js` (CDN, `defer` — 파싱 비차단. 둘 다 `DOMContentLoaded` 이후에만 사용하므로 안전.
  `defer`는 명세상 DOMContentLoaded **직전**에 실행이 끝나므로 시작 시점에 `window.supabase`·`Chart`가 이미 있다)
- Pretendard (jsdelivr `<link>`, **variable + dynamic-subset**) — 폰트는 이것 하나뿐이다
  - ⚠️ CSS `@import`로 되돌리면 직렬·렌더블로킹이 됨(금지)
  - ⚠️ **`static/pretendard.min.css`로 되돌리지 말 것** — 서브셋이 아니라 weight마다 한글 전체 woff2를 받는다.
    앱이 5개 weight를 쓰므로 4파일 **3.15MB**였다(2026-08-15 실측). dynamic-subset은 유니코드 92조각 중 쓰는 것만
    받고 variable 한 파일이 45~920 전 weight를 담당 → 실측 **9조각 244KB**
  - ⚠️ Noto Sans KR(Google Fonts) `<link>`는 **제거됨**(2026-08-15). `@font-face` 496개짜리 93KB CSS를
    렌더블로킹으로 받으면서 정작 `font-family` 1순위가 Pretendard라 폴백으로만 쓰였다 —
    첫 페인트만 데스크톱 ~150ms·4G ~520ms 늦추고 있었다. CSS 폰트 스택엔 이름이 남아 있는데 그건 **로컬 설치본 폴백**이다
  - `font-family` 1순위는 `'Pretendard Variable'` — dynamic-subset의 실제 패밀리명이 그것이다.
    `'Pretendard'`로만 적으면 웹폰트가 안 잡히고 조용히 시스템 폰트로 떨어진다

**초기 로딩 기준선** (2026-08-15 배포본 실측, 콜드 캐시·세션 없음. Edge 헤드리스+CDP 워터폴):

| | 앱 시작(DCL) | FCP | 총 바이트 |
|---|---|---|---|
| 데스크톱 | 730ms | 752ms | 462KB |
| 4G+CPU4배 | 1,432ms | 1,176ms | 462KB |

> 바꾸기 전엔 앱 시작이 각각 1,506ms / 4,274ms에 3.45MB였다.
> **'앱 시작'은 `load`가 아니라 DOMContentLoaded 시점**이다 — 여기서 `getSession`→`loadAll`이 출발한다.
> 로그인된 상태면 여기에 REST 왕복(6쿼리 병렬, 거래 134KB JSON, 실측 RTT 0.15~0.19s)이 더 붙는다.
> 회귀 의심 시: 총 바이트가 1MB를 넘거나 DCL이 load에 가까워지면 폰트/시작점을 먼저 볼 것.
- `cdn.jsdelivr.net`·`fonts.gstatic.com` `preconnect`로 연결 핸드셰이크 선점
- 숫자 포맷 `comma()`는 `Intl.NumberFormat` 인스턴스 1회 캐시 재사용(렌더당 수백 회 호출 — 매 호출 `toLocaleString` 금지)

웹 아이콘도 인라인: `<head>`에 SVG 파비콘(data URI) + `apple-touch-icon`(180×180 PNG base64, 헤드리스 Chrome 캔버스로 생성) + `theme-color`·standalone 메타. 별도 이미지 파일 없음 — 아이콘 교체 시 data URI를 다시 생성해 갈아끼울 것.
재생성법: canvas에 그린 뒤 `toDataURL()`을 `document.body.textContent`로 출력하는 임시 HTML을 Write 도구로 만들고 `chrome --headless=new --dump-dom --virtual-time-budget=4000 file:///<절대경로>`로 덤프해서 추출 (Node에 이미지 라이브러리 불필요).
크기 주의: 이모지 PNG는 180px ≈ 57KB로 큼 → 120px로 생성(≈26KB)해 iOS가 확대하게 두는 게 절충안. ₩ 글리프+그림자는 오히려 더 커짐(blur가 압축 방해).

---

## DB 스키마

### members
```sql
id         serial primary key
name       text unique not null
created_at timestamptz default now()
```
> MEMBERS는 JS 하드코딩 없음. 앱 로드 시 이 테이블에서 동적 로드.

### transactions
```sql
id         uuid default gen_random_uuid() primary key
date       date        not null
amount     numeric     not null check (amount >= 0)
type       text        not null check (type in ('지출','입금'))
category   text        not null
account    text        not null
member     text        references members(name) on delete cascade   -- null 허용
method     text                                                     -- null 허용
memo       text                                                     -- null 허용
created_at timestamptz default now()
```
> ⚠️ **`type` CHECK에 `'이동'`은 없다** — 입력 시트의 '이동' 토글은 UI 개념일 뿐,
> `saveTransfer()`가 `지출`+`입금` 2건으로 풀어서 저장하고 `category='계좌간 이동'`으로 구분한다.
> 이 CHECK가 그 설계를 DB에서 강제한다. '이동'을 type으로 직접 저장하도록 '단순화'하면 insert가 통째로 실패한다.
> ⚠️ `category`·`account`가 NOT NULL이라 `saveEntry()`의 "금액·카테고리·계좌는 필수" 검증을 없애면
> 토스트 대신 DB 오류가 뜬다(둘은 같이 움직여야 한다).

### category_limits
```sql
id            uuid default gen_random_uuid()
member        text not null references members(name) on delete cascade
category      text not null
monthly_limit numeric not null check (monthly_limit >= 0)
primary key (member, category)   -- saveLimit의 onConflict 대상
```
> 멤버별 독립 한도. 복합 PK (member, category).
> ⚠️ 과거 `UNIQUE(category)` 단독 제약이 남아 멤버별 한도를 막던 버그가 있었음 → 2026-06 제거됨. 다시 추가 금지.

### master_data
```sql
id         uuid default gen_random_uuid() primary key   -- ⚠️ serial 아님(2026-08-14 실측 정정)
member     text not null references members(name) on delete cascade
type       text not null   -- 'category' | 'method' | 'account'
value      text not null
created_at timestamptz default now()
unique (member, type, value)   -- addMaster의 onConflict 대상
```

### tax_map
```sql
member text references members(name) on delete cascade
type   text not null check (type in ('method','category'))
value  text not null default ''
kind   text not null
primary key (member, type, value)
check ( (type='method'   and kind in ('credit','check','cash','none'))
     or (type='category' and kind in ('income','none')) )
```
> 연말정산 매핑 2종을 한 테이블에. `master_data`의 (member, type, value) 형태를 그대로 따랐다.
>
> ⚠️ **이 테이블의 설치 SQL은 앱 안에도 있다**(`TAX_MAP_DDL` — 테이블이 없으면 연말정산 화면이 띄워 사용자가 그대로 실행한다).
> 그래서 이 DDL은 아래 'RLS 정책'과 **반드시 같이 움직여야 한다**. 실제로 2026-08-07에 RLS를 좁힐 때 앱 안의 DDL만
> 옛 `create policy "all" ... using (true)`(anon 포함) + `revoke` 없음으로 남아 있었다 —
> 그대로 실행됐다면 앱이 방금 닫은 구멍을 스스로 다시 열어주는 셈이었다(2026-08-14 수정).
> 스키마를 바꿀 땐 `public/index.html`의 `TAX_MAP_DDL`도 함께 고칠 것.
> - `type='method'` → **지출 매핑**: `credit`=신용 15% / `check`=체크 30% / `cash`=현금영수증 30% / `none`=공제제외(이체 등). 체크·현금은 공제율이 같지만 사용 추이를 따로 보려고 화면에서만 분리
> - `type='category'` → **소득 매핑**: `income`=총급여에 산입 / `none`=제외. **총급여 판정은 오직 이 매핑만 따른다** (`SALARY_RE`는 추천 UI 전용 — 하드코딩 regex로 집계하지 말 것)
>
> ⚠️ 매핑 대상은 **설정(master_data)이 기준**, 거래엔 있는데 설정엔 없는 값은 `tyItems()`가 `unregistered`로 분리해 '미등록' 배지로 노출한다. 미등록을 빼면 `제일은행카드`(1,140만) 같은 실사용 값이 통째로 집계에서 빠진다.
> **미등록 그룹은 연말정산 화면과 설정 탭(카테고리·결제수단 관리) 양쪽에 모두 띄운다** — 설정 탭이 `MASTER` 등록분만 순회하던 시절엔 미등록 항목을 설정에서 볼 수도 고칠 수도 없었다. 금액은 `tyAmounts()`로 공용 집계(두 화면이 다른 숫자를 보이면 안 됨). master_data 행이 없으므로 미등록 행엔 삭제 버튼을 두지 않는다.
> ⚠️ 저장된 매핑만 집계에 반영한다. 추천값(`suggestKind`/`suggestCatKind`)은 UI 제안일 뿐 몰래 적용하지 않는다 — 근거 없이 숫자가 움직이면 안 되므로.
> ⚠️ 일괄 분류(`applyTaxSuggest`)는 **올해 활동(금액>0)이 있는 항목만** 저장한다. 활동 없는 카테고리까지 `none`으로 저장하면 그게 '매핑됨'이 되어 소득 목록에 도로 나타난다.
> ⚠️ 테이블이 없어도 앱은 정상 동작한다(`loadAll`이 error를 무시하고 `MTMAP/CTMAP={}`). 다만 `TAX_READY=false`가 되어 연말정산 화면은 계산 대신 **설치 안내(DDL + 복사 버튼)** 를 띄운다 — 예전엔 조용히 전 항목 0원으로 보여 버그로 오인됐다.

### app_settings
```sql
key   text primary key
value text
```
> 전역 key-value 설정.
> - `billing_start_day` : 전역 기본 시작일 (fallback)
> - `billing_start_<멤버명>` : 멤버별 시작일 override (예: `billing_start_지현` = `21`)
> - `warn_threshold` : 한도 경고 임계값 % (50~99, 기본 80) — 한도 탭 warn 상태·분석 '한도 임박' 공통
> - `analysis_periods` : 분석·분류 탭 표시 주기 수 (2~6, 기본 3)
> - `ty_salary_<멤버명>` : 연말정산 총급여 수동값. 없으면 올해 '월급·급여·상여' 입금의 연환산 추정을 쓴다(수동값이 항상 우선)
> - `cat_icon_<카테고리명>` : 카테고리 이모지 아이콘 (전 멤버 공통). master_data에 icon 컬럼을 두지 않은 이유: 신규 멤버는 카테고리가 DB 없이 DEFAULT_CATS fallback으로 돌아 행이 없을 수 있음

### upsert 계약 (코드 ↔ DB) — 2026-08-14 실측 대조 완료
`sb.from(...).upsert(..., {onConflict:"…"})`의 `onConflict`는 **DB에 그 이름의 유니크 제약이 실재해야** 동작한다.
없으면 저장이 `dbErr` 토스트 한 줄로 끝나 원인이 안 보인다. 현재 4곳 모두 대응이 확인됐다:

| 코드 | onConflict | DB 제약 |
|------|-----------|---------|
| `saveLimit` | `member,category` | `category_limits_pkey` PRIMARY KEY (member, category) |
| `addMaster` | `member,type,value` | `master_data_member_type_value_key` UNIQUE (member, type, value) |
| `saveBillingStart`·`saveAppSetting`·`saveIcon`·`saveTySalary` | `key` | `app_settings_pkey` PRIMARY KEY (key) |
| `setTaxMap`·`applyTaxSuggest` | `member,type,value` | `tax_map_pkey` PRIMARY KEY (member, type, value) |

> FK는 4개 테이블 모두 `member → members(name) ON DELETE CASCADE` — `delMember`가 거래 1건이라도 있으면
> 차단하는 이유가 이것이다(위 `delMember` 항목).
> PostgREST 행 상한: `pgrst.db_max_rows` 역할 오버라이드 없음 → Supabase 기본값(1000). 507행은 그 아래라
> 현재 잘림 없음. 1000에 근접하면 `fetchTransactions`의 페이지네이션이 실제로 발동하기 시작한다.

### RLS 정책 (가계부 6개 테이블 공통) — 2026-08-07 축소
```sql
create policy family_only on public.<table>
  for all to authenticated using (true) with check (true);
revoke all on public.<table> from anon;
```
가족 안에서는 서로의 내역을 다 보므로 행 단위 분리는 하지 않는다. 경계는 **로그인 여부 하나**다.

⚠️ **정책만 `to authenticated`로 바꾸고 `revoke`를 빠뜨리면 anon에게 `200 []`가 간다** — 빈 배열이라
차단된 것처럼 보이지만 테이블 존재와 컬럼 구조는 그대로 새고, 정책이 하나만 느슨해져도 즉시 열린다.
`scripts/verify_rls.js`가 이 경우를 성공으로 세지 않도록 명시적으로 실패 처리한다.

⚠️ **뷰 3개(`v_account_balance`·`v_limit_usage`·`v_period_category`)는 두 겹으로 막았다.**
원래 `security_invoker=off` + owner=`postgres`라 **하위 테이블의 RLS를 우회**했다 —
테이블만 잠갔을 때 anon이 이 뷰로 계좌 잔액과 카테고리별 지출을 그대로 읽는 것을 실측으로 확인했다(200).
① anon `revoke` ② `security_invoker=on`.
②를 추가한 이유: ①만으로는 **"권한을 회수한 상태를 계속 유지해야" 성립하는 방어**다.
누가 나중에 `grant`를 되돌리면 조용히 다시 열린다. `security_invoker=on`이면 호출자 권한으로 평가되므로 그 경우에도 RLS가 막는다.
**새 뷰도 `security_invoker=on`으로 만들 것** — Supabase 어드바이저가 ERROR로 잡는다.

### ✅ 뷰 3개 + `billing_key()`는 삭제됨 (2026-08-14, 마이그레이션 `drop_legacy_budget_views`)
막아만 두다가 지웠다. 앱 참조 0건이면서 **쓰면 조용히 틀린 값이 나오는** 물건이었기 때문이다 —
전부 멤버 개념이 없던 옛 모델의 잔재다:
- `v_limit_usage` — `member` 컬럼이 없어 `category`만으로 join. 멤버별 한도(복합 PK)로 바뀐 뒤로는
  한 사람의 한도가 **가족 전체 지출**과 대조됐다.
- `v_period_category` — `billing_key(date)`가 **25일을 하드코딩**(`extract(day from d) >= 25`)해
  지현(21일) 주기를 무시. 앱에서 같은 날 고친 버그가 DB에 남아 있던 것.
- `v_account_balance` — 멤버 구분 없이 계좌명으로만 합산.

→ **주기 집계의 유일한 기준은 앱의 `bucketByPeriod`/`billingPeriod`다.** DB 쪽에 '편한 집계 뷰'를
다시 만들고 싶어지면, 멤버별 시작일(`app_settings.billing_start_*`)을 받지 못하는 순간 같은 버그가 재생산된다.
만들려면 `member`를 축에 넣고 시작일을 조인해야 한다.
- 원본 정의는 커밋 `docs: 쓰지 않는 옛 뷰·함수 삭제` 메시지에 그대로 남겨뒀다(되돌릴 일이 있으면 거기서).
- `verify_rls.js`는 이 3개를 계속 검사한다 — 이제 404가 정상이고, 같은 이름으로 다시 생기면 잡는다
  (원래 RLS를 우회해 anon에게 잔액이 새던 경로라 이름 자체가 지뢰다).

검증 짝 (둘 다 통과해야 끝난 것):
- `node scripts/verify_rls.js` — anon이 막혔는가 (기대: 가계부 401, 삭제된 뷰 404, 휴양림 200)
- `node scripts/verify_login.js` (BUDGET_PW 필요) — 로그인 세션은 읽히는가 + 덤프 건수 대조
  - 2026-08-14 실행: `ALL PASS`. 건수가 MCP로 읽은 값과 완전 일치(507/2/3/30/18/2) — 서버 안쪽과 바깥쪽
    두 경로가 같은 답을 냈다는 뜻이라, 세션이 전량을 읽고 잘림도 없음을 함께 증명한다
- 비밀번호 없이 정책만 확인하려면 SQL에서 역할을 갈아끼운다(가장 빠른 판별):
  `begin; set local role authenticated; select count(*) from transactions; rollback;`
  ⚠️ 이때 **대조군을 반드시 같이 볼 것** — `postgres`는 RLS를 우회하므로 역할 전환이 실패해도 같은 숫자가 나온다.
  `set local role anon`이 `42501 permission denied`를 내야 전환이 실효한 것이다.

---

## 앱 구조 (JS)

### 전역 상태
```js
FAMILY_EMAIL   // (상수) 가족 공용 계정 이메일. 비밀번호는 앱 어디에도 없다 — 사용자가 입력해 Supabase가 검증
MEMBERS        // string[]  — DB에서 로드
ROWS           // 거래내역 전체
LIMITS         // { 멤버: { 카테고리: 금액 } }
MASTER         // { 멤버: { categories, methods, accounts } }
BILLING_STARTS // { 멤버: 시작일 } — app_settings에서 로드
DEVICE_USER    // 이 기기의 기본 사용자 (localStorage, 없으면 null)
USER_ICONS     // { 카테고리: 이모지 } — app_settings의 cat_icon_* (icon() 헬퍼가 CAT_ICON보다 우선 사용)
WARN_TH        // 한도 경고 임계값 % (app_settings.warn_threshold, 기본 80)
AN_PERIODS     // 분석·분류 탭 표시 주기 수 (app_settings.analysis_periods, 기본 3)
MTMAP          // { 멤버: { 결제수단: kind } } — tax_map(type='method')
CTMAP          // { 멤버: { 카테고리: kind } } — tax_map(type='category'), 소득 판정
TAX_READY      // tax_map 테이블 존재 여부. false면 연말정산이 설치 안내를 띄움
TY_SALARY      // { 멤버: 총급여 수동값 } — app_settings의 ty_salary_*
loadWarn       // string[] 부분 로드 실패 테이블 이름 — warnBanner()가 모든 탭 상단에 노출

tab          // 현재 탭: list | cat | limit | analysis | acct | master
scope        // 'current' | 'all'
periodOffset // 내역·분류 탭 주기 탐색: 0=이번 주기, -1=한 주기 전 … (◀▶로 이동, 0 초과 불가)
memberFilter // 내역·분류·분석·계좌 탭 공통 멤버 필터 ('전체' 포함)
searchQ      // 내역 탭 검색어 (메모·카테고리·계좌·결제수단·멤버 부분일치)
catBy        // 분류 탭 집계 기준: 'category' | 'method' — aggCat(rs, field)가 키 필드로 사용, 빈 결제수단은 '미지정'
limitMember  // 한도 탭 전용 멤버 선택 (null 없음)
masterMember // 설정 탭 전용 멤버 선택
anView       // 분석 탭 세그먼트: 'spend'(지출분석) | 'tax'(연말정산)
tyMember     // 연말정산 전용 멤버 ('전체' 없음 — 각자 총급여·25% 문턱이 달라 합산이 무의미)
memberVal    // 입력 시트의 '누가' 선택값
```

### 기기별 기본 사용자 (DEVICE_USER)
기기마다 기본 사용자를 기억하는 방식. `localStorage["ourbudget.deviceUser"]`에 멤버명 저장.
> 로그인은 **가족 공용 계정 1개**라 '정우냐 지현이냐'를 인증이 구분해주지 않는다 —
> 앱 안의 사람 구분은 예전 그대로 이 값이 맡는다. 로그인 게이트와 서로 대체 관계가 아니다.
- 최초 접속 시 "이 기기는 누구의 폰인가요?" 모달 1회 표시
- 설정 탭 → 📱 이 기기 사용자에서 변경 (멤버 / 공용)
- 정해지면 입력 시트 '누가', `memberFilter`·`limitMember`·`masterMember` 기본값이 그 사람으로 맞춰짐 (`defMember()`)
- '공용' 선택 시 기존처럼 `MEMBERS[0]` 기본 + `memberFilter='전체'`

### 로그인 게이트 (2026-08-07)
Supabase Auth 공유 계정 1개. Worker 프록시도, 자체 인증 코드도 만들지 않았다 —
`supabase-js`가 세션·토큰 갱신을, Supabase가 레이트리밋을 처리한다. `sb.from(...)` 호출부는 그대로다.

- **시작 흐름**: `DOMContentLoaded` 핸들러가 `getSession()`으로 분기 → 세션 없으면 `showAuth()`하고 **끝**(`loadAll()`을 호출하지 않는다),
  있으면 `startApp()`이 기존 초기화(로드·렌더·기기사용자 모달)를 그대로 수행
  - ⚠️ **`window.onload`로 되돌리지 말 것**(2026-08-15). `load`는 폰트·이미지까지 다 기다리므로 첫 DB 요청이
    폰트 다운로드 뒤에 줄을 선다 — 실측으로 앱 시작이 데스크톱 **+817ms**, 4G **+3,164ms** 늦었다.
    `check_authgate.js`가 `window.onload =` 대입을 금지 항목으로 잡는다(주석 속 언급은 오탐이라 `=`까지 봐야 한다)
- 세션은 `localStorage["ourbudget.auth"]`에 유지(`persistSession`·`autoRefreshToken`) → 한 번 로그인하면 다시 안 묻는다
- `onAuthStateChange`의 `SIGNED_OUT`에서 `showAuth()`로 복귀. **이게 없으면 세션 만료 시 빨간 '데이터 연결 오류' 카드가 떠서
  원인을 RLS 문제로 오도한다** — 인증 실패는 로드 실패와 다른 화면이어야 한다. 같은 이유로 `loadAll` 실패는 `isAuthErr(e)`로 갈라 처리
- 로그인 실패 문구는 뭉뚱그린다("비밀번호가 맞지 않아요"). Supabase가 계정 존재 여부를 구분해 알려주지 않는 것과 같은 이유
- 비밀번호 변경은 **설정 탭 안에서** 가능(`openPwChange`) — 대시보드에 갈 일이 없다.
  ⚠️ `updateUser` 전에 **현재 비밀번호를 `signInWithPassword`로 다시 확인**한다.
  세션만으로 바꾸게 두면 폰을 주운 사람이 비밀번호를 바꿔 **가족 전체를 잠가버린다** — 데이터 열람보다 나쁜 결과다. 이 확인을 제거하지 말 것
- 숨김 username input은 `display:none`이 아니라 화면 밖으로 보낸다 — `display:none`이면 비밀번호 관리자가 폼을 인식하지 못한다
- 배선 검증: `node scripts/check_authgate.js` (소스에 조각이 실제로 들어갔는지 정규식 대조)

### 결제 주기
멤버별 시작일 설정 (`BILLING_STARTS`, 기본 매월 25일~익월 24일). `billingPeriod(member, ref)`가 해당 멤버 주기 계산 — 종료일은 '다음 시작일 하루 전'으로 산출 (시작일=1이면 같은 달 말일. 과거엔 1일 설정 시 두 달짜리 주기가 되던 버그 → 2026-07 수정, 회귀 금지).
`viewedPeriod(member)`는 여기에 `periodOffset`을 반영한 '현재 조회 중인 주기' — `scoped()`가 사용.

⚠️ **멤버마다 시작일이 다르다** (실제로 정우 25일 / 지현 21일). 그래서 여러 멤버의 행을 주기로 나눌 땐
**행마다 그 멤버의 주기**로 판정해야 한다 — 한 사람 기준으로 자르면 다른 사람의 21~24일 거래가 이웃 주기로 밀린다.
- 내역 탭 `scoped()`는 원래부터 행별 판정이었지만, 분석·분류 탭은 `MEMBERS[0]` 주기로 전원을 잘랐다
  → 같은 '이번 주기'인데 두 탭 숫자가 달랐다(2026-08 기준 지현 **24건·293만원**이 엉뚱한 주기에 잡힘). 2026-08-14 수정.
- 이제 `bucketByPeriod(rows, n, refMember)`가 그 판정을 전담한다. **주기 버킷이 필요하면 이 함수를 쓸 것** —
  `periods.map(p => rows.filter(r => inPeriod(r.date, p)))` 패턴을 다시 쓰면 같은 버그가 돌아온다.
- 인덱스 `n-1`이 각 멤버의 '이번 주기'이고, 이는 `viewedPeriod(m)`(periodOffset=0)과 일치한다(테스트로 고정).
- 라벨은 기준 멤버 것이라 집계 기준과 어긋나 보일 수 있어, `mixedPeriods()`가 참이면 화면에 '각자 주기 기준'을 명시한다.

### 주요 함수
| 함수 | 역할 |
|------|------|
| `startApp()` | 세션 확보 뒤의 시작 절차 — `loadAll`·`renderMemberSeg`·`render`·기기사용자 모달. `DOMContentLoaded` 핸들러와 `doLogin` 양쪽에서 호출 |
| `showAuth() / hideAuth()` | 로그인 오버레이 토글. `.picker-ov`를 재사용하되 ESC 핸들러에 넣지 않아 **닫히지 않는다** |
| `doLogin(ev) / doLogout()` | 공용 계정 로그인 / 로그아웃(`signOut` 후 `location.reload()`로 전역 상태를 확실히 비움) |
| `openPwChange() / doPwChange(ev)` | 설정 탭 비밀번호 변경. **현재 비밀번호를 재확인한 뒤** `updateUser` (위 '로그인 게이트' 절의 이유) |
| `isAuthErr(e)` | 인증 실패를 일반 로드 오류와 구분 (`401`·`JWT`·`PGRST301`·`Invalid Refresh Token`) — 화면 분기의 기준 |
| `loadAll()` | members·transactions·category_limits·master_data·app_settings 병렬 로드. 끝에서 `rebuildCatOrder()` |
| `fetchTransactions()` | 거래 전량 수신 — `count:"exact"`의 전체 행 수와 실수신 건수를 대조해 모자라면 `.range()`로 이어 받는다. PostgREST `max-rows` 상한에 걸리면 **에러 없이 잘려** 모든 집계가 조용히 틀어지므로 (507행/2026-08-14 기준 미도달, 연 ~650건 페이스) |
| `warnBanner()` | 부분 로드 실패(`loadWarn`) 배너 — `render()`가 모든 탭 본문 앞에 붙임 |
| `orphanTransfers() / orphanBanner()` | 짝 없는 계좌간 이동 leg 탐지 / 계좌 탭 경고 배너. 짝 판정 기준은 **`delEntry`의 mate 탐색과 동일하게 유지**(같은 멤버·날짜·금액의 반대 type) |
| `rebuildCatOrder()` | 카테고리 색 배정 순서를 ROWS+MASTER 합집합의 로케일 정렬로 고정 (`loadAll` 끝에서 1회) |
| `refreshData()` | 헤더 ↻ 버튼 — 수동 재로드 (다른 기기 입력 동기화) |
| `setSearch(v)` / `listResultsHtml(all?)` | 내역 검색 — 200ms 디바운스 후 **`#listResults`만** 부분 갱신(`listResultsHtml`가 결과 목록 HTML만 반환). ⚠️`render()`로 전체 재렌더하면 조합 중인 input 노드까지 교체돼 한글 IME가 자모로 flush된다('ㅇㅣㅂㄹㅕㄱ'). 모바일 IME는 compositionstart/end를 신뢰성 있게 쏘지 않아 조합 가드로는 못 막음 — **포커스·커서 복원 방식으로 되돌리지 말 것** |
| `setDeviceUser(name) / openDeviceUser()` | 기기 기본 사용자 설정·선택 모달 (헤더 👤 칩에서도 열림) |
| `saveBillingStart(member)` | 멤버별 결제 주기 시작일 저장 |
| `saveAppSetting(key,elId,min,max,def,unit)` | 전역 앱 설정 upsert (warn_threshold·analysis_periods) |
| `openIconPicker(cat) / saveIcon(emo)` | 카테고리 이모지 설정 — pickerOv 재사용(이모지 그리드+직접입력), app_settings `cat_icon_*` upsert/삭제. 빈값=기본 복귀 |
| `esc(s) / jsq(s)` | HTML 이스케이프 / onclick 속성 내 JS 문자열 이스케이프 — **innerHTML에 넣는 사용자 문자열은 esc, onclick 인자는 jsq 필수** |
| `bumpAmt(n) / fmtNum(el)` | 금액 빠른 입력 칩(+n 누적, 0=지움) / 동적 input 콤마 포맷 |
| `saveEntry()` | 거래 추가/수정 (구분이 '이동'이면 `saveTransfer()`로 위임) |
| `saveTransfer(amount)` | 계좌간 이동 — 출금계좌 지출 + 입금계좌 입금 2건을 한 번에 insert (category='계좌간 이동') |
| `saveLimit(member, cat)` | 멤버별 한도 upsert — **빈값/0이면 해당 행 delete**(한도 해제) |
| `editEntry(id)` | 수정 시트 열기 — id로 ROWS 조회. ⚠️행 JSON을 onclick에 인라인 금지(메모 따옴표에 깨짐) |
| `addMember() / delMember()` | 멤버 DB CRUD. **거래가 1건이라도 있으면 delMember는 차단** — `transactions.member` FK가 cascade라 거래가 통째로 사라지는데 구글 시트 백업엔 그 삭제가 전파되지 않아 복구 근거가 없다 |
| `addMaster(key) / delMaster(key, val)` | 카테고리·결제수단·계좌 CRUD |
| `refreshCatList()` | 입력 시트 select 옵션 갱신 |
| `openPicker(sel,title) / pickOptIdx(i) / updateSelBtn(sel)` | 커스텀 하단 시트 피커 열기·선택·버튼 표시 갱신 |
| `viewAnalysis() / buildInsights() / bigSpends(rows)` | 분석 탭 렌더 + 스마트 진단·절약팁 + 일회성 이상치(카테고리 중앙값 대비 ≥2.5배·표본≥3) |
| `taxCalc(member) / tyDeduct(credit,thirty,salary)` | 연말정산 집계(역년·연환산) / 소득공제액 — **최저사용금액(총급여 25%)은 공제율 낮은 신용부터 소진**되므로 신용<문턱이면 초과분 전체가 30% |
| `tyAdvice(t) / viewTaxYear() / drawTaxChart()` | 상태별 핵심 조언 분기 / 연말정산 화면 / 월별 스택막대+월 적정페이스 점선 |
| `tyNeed(kind,C,D,salary)` | 공제 한도를 채우는 데 **앞으로 더 써야 할 금액**(수단별). 문턱·한도 경계에서 케이스가 갈려 닫힌 식은 틀리기 쉬움 → 단조 증가 함수 이분탐색으로 통일 |
| `tyMarginal(C,D,salary)` | **다음 1원의 한계 공제율** + 사유 4상태: `limit`(한도소진) `below`(문턱미달) `same`(신용<문턱→둘 다 30%) `split`(신용>문턱→15% vs 30%) |
| `tyItems(m,kind)` | 매핑 대상을 `{registered, unregistered}`로 분리 — 설정 등록분 / 거래에만 있는 값 |
| `tyAmounts(m,kind)` | 올해 금액 `{값: 금액}` (역년·이동 제외) — 연말정산 화면·설정 탭 공용 |
| `suggestKind(method) / suggestCatKind(cat)` | 이름 규칙 추천. `체크\|직불\|선불` → check를 `카드`보다 **먼저** 검사할 것 ('우리 체크카드'가 credit으로 새는 것 방지) |
| `taxMapSection(m,kind,t)` | 소득·지출 매핑 UI 공용 빌더 (연말정산 화면용). 소득은 입금 있는 카테고리로 좁힘 |
| `setTaxMap / applyTaxSuggest / saveTySalary / resetTySalary / copyTaxDDL` | 매핑 단건 저장(빈값=삭제) / 미분류 일괄 추천 / 총급여 수동값(0이면 삭제=추정 복귀) / 설치 SQL 복사 |
| `drawAnalysisCharts() / destroyCharts()` | 도넛 + 주기별 스택막대(지출=카테고리·왼축, 수입=오른 보조축) + 추이 라인 / 인스턴스 일괄 파괴 |
| `expOf(rs) / incOf(rs) / catColor(c)` | 지출·수입 합계 헬퍼(이동 제외), 카테고리 색 — `_catOrder` 인덱스로 팔레트 배정. ⚠️**이름해시 금지**(한글이 한 칸에 몰려 전부 초록), ⚠️**'처음 등장 순서'로도 되돌리지 말 것**(탭 여는 순서·멤버 필터에 따라 기기·세션마다 색이 달라짐) → `rebuildCatOrder()`의 로케일 정렬이 유일한 기준 |
| `isTransfer(r)` | 계좌간 이동 거래 판별(`r.category===TRANSFER_CAT`) — 통계 제외 필터에 공통 사용 |
| `$(id) / parseDate(s) / todayStr() / amtVal(id)` | getElementById 축약 / 날짜 파싱(YYYY-MM-DD는 정오로 — 타임존 경계 안전) / 오늘 날짜 문자열 / 콤마 금액 input→숫자 |
| `comma(n) / dbErr(res,pre?)` | 콤마 숫자 포맷 / Supabase 응답 에러 공통 처리(에러면 토스트 후 true — `if(dbErr(res))return;` 패턴) |
| `pills(items,cur,fn) / segBtns(items,cur,fn)` | 필 바(.filter)·세그먼트(.seg) 버튼 공통 빌더 — items는 문자열 또는 [값,라벨] 쌍 배열, jsq/esc 내장 |
| `catsOf(m)` | 멤버 카테고리 목록 = master_data 설정 + 저장된 한도 카테고리 합집합 (한도 탭·입력 시트 공용) |
| `reloadAndRender()` | `loadAll()+render()` — CRUD 후 공통 마무리 |
| `movePeriod(d) / resetPeriod() / viewedPeriod(m)` | 내역·분류 탭 ◀▶ 주기 탐색 (periodOffset 0 클램프, 누르면 scope='current') |
| `bucketByPeriod(rows,n,ref)` / `mixedPeriods()` | 최근 n주기 버킷팅(**행마다 그 멤버 주기**, 인덱스 n-1=이번 주기) / 멤버 간 시작일이 갈리는 상태인지 — 위 '결제 주기' 절 참조 |
| `myRows() / retryLoad() / recentPeriods(n,m)` | 멤버 필터 적용 행 / 로드 실패 후 재시도(배너·에러카드 버튼) / 최근 n주기 목록 |
| `taxSelect(member,kind,value,cur)` / `tyAmtLabel(a,isCat,cur)` | 연말정산 매핑 셀렉트·금액 캡션 공용 빌더 — 연말정산 화면·설정 탭 **4곳**이 같은 마크업을 쓴다. 인라인으로 복붙하지 말 것(옵션 하나 고칠 때 한 곳을 빠뜨린다) |
| `drillTo(q)` | 분류 카드 클릭 → 내역 탭 이동 + 검색어 세팅 (주기·멤버 필터 유지, '미지정' 카드는 비활성) |
| `exportCSV()` | 설정 탭 — 전체 거래 CSV 다운로드 (UTF-8 BOM, 콤마·따옴표·개행 인용 처리) |
| `ensureOpt(selId,val)` | 수정 시트에서 마스터에 없는 기존 값을 select에 임시 옵션으로 추가 — 삭제된 카테고리·계좌가 첫 옵션으로 바뀌는 것 방지 |
| `render()` | 현재 탭 전체 재렌더. 본문을 `body` 변수에 모아 `warnBanner()+body`로 **한 번에** 주입하고, 캔버스 그리기는 `after`로 미뤄 innerHTML 이후 실행 — 탭별로 `m.innerHTML=`을 흩어 쓰면 공용 배너를 붙일 자리가 사라진다 |

### 탭 구성
| 탭 | 설명 |
|----|------|
| 내역 (list) | 날짜별 거래 목록, 주기(◀▶ 과거 주기 탐색)/멤버 필터 + 검색바(searchQ)·건수 표시 |
| 분류 (cat) | 카테고리별/결제수단별 집계(catBy 토글 필), 주기(◀▶)/멤버 필터, 카드 클릭 시 내역 드릴다운 |
| 한도 (limit) | 멤버별 한도 설정 및 진행률 (warn 임계값=WARN_TH) + 상단 '전체 한도 요약' 카드 |
| 분석 (analysis) | 상단 세그먼트 2개(`anView`) — **지출분석**: 최근 AN_PERIODS주기 차트·반복지출·요약 / **연말정산**: 아래 참조 |
| 계좌 (acct) | 계좌별 잔액(이동 포함), 총수입·지출(이동 제외), 멤버 필터 |
| 설정 (master) | 멤버·기기사용자(+비밀번호 변경·로그아웃)·앱설정(임계값·주기수)·CSV 내보내기·결제주기·카테고리(아이콘 포함)·결제수단·계좌 관리 |

> 헤더 우측: 기기사용자 칩(누르면 openDeviceUser) + 새로고침(refreshData). 칩의 이름 텍스트는 `#hdUserName` span을 render()에서 갱신 (칩 innerHTML을 통째로 덮으면 SVG 아이콘이 사라지므로 금지).

### 네비게이션·아이콘 (2026-07 모던 리디자인)
- **네비는 하단 고정 탭바**: `.nav`가 `position:fixed; bottom:0` + 글래스 블러 + `env(safe-area-inset-bottom)` 패딩. z-index 30이라 입력 시트(z-50)·피커(z-60)가 위를 덮음. 활성 탭은 아이콘 뒤 골드 필(`.tab.on .tab-ic`)
- FAB·토스트·`.app` padding-bottom은 하단 탭바 높이만큼 올려둠(모두 `env(safe-area-inset-bottom)` 반영) — 탭바 높이 바꾸면 셋 다 조정할 것
- **구조 아이콘은 인라인 SVG** (Lucide 스타일, stroke=currentColor): 탭 아이콘은 `TABS` 상수의 `NI()` 헬퍼, 헤더 칩·새로고침·FAB·셀렉트 화살표(.sel-arr)는 HTML에 직접. 이모지를 구조 아이콘으로 되돌리지 말 것(OS별 렌더 제각각) — 단 **카테고리 이모지(icon()·cat_icon_*)는 사용자 설정 콘텐츠라 유지**
- 숫자는 body에 `font-variant-numeric:tabular-nums`(금액 세로 정렬), 전역 `:focus-visible` 골드 링 있음
- 텍스트 토큰 대비: `--t2` ≈4.5:1↑, `--t3` ≈3:1 (마이크로 라벨용) — 더 어둡게 내리면 WCAG 미달로 회귀

> ⚠️ 한도 탭(`viewLimit`) 카테고리 목록은 `MASTER[멤버].categories`(master_data DB) 기준 + 기존 저장 한도. 지출 발생 카테고리(`spent`)로 만들면 '계좌간 이동'처럼 설정에 없는 항목까지 한도 UI가 떠서 안 됨.

---

## 연말정산 세그먼트 (분석 탭)

목적은 **세금 계산기가 아니라 "앞으로 신용/체크/현금 중 뭘 쓸까" 판단 도구**.
과세표준·근로소득공제표·한계세율·지방소득세·예상환급금은 **의도적으로 계산하지 않는다** — 부양가족·의료비 등을 모르면 구간이 어긋나는데, 그 부정확함이 판단에 필요하지도 않기 때문. `공제액`까지만 낸다.

**매핑 2종** (둘 다 `tax_map`, 같은 값을 두 곳에서 편집 — 설정 탭이 본체, 연말정산 화면은 미등록 항목까지 포함):
1. **소득 매핑 = 카테고리 기준** — 어떤 입금을 총급여로 볼지. 설정 탭 → 카테고리 관리 / 연말정산 화면 → 소득 카테고리 매핑
2. **지출 매핑 = 결제수단 기준** — 신용/체크/현금/제외. 설정 탭 → 결제수단 관리 / 연말정산 화면 → 결제수단 매핑

- **기간은 역년(1/1~12/31)**. 결제주기(`billingPeriod`)와 무관 — 연말정산 자체가 역년 단위. 새 집계 추가 시 `inPeriod` 쓰지 말 것
- 12월 전이면 `x / 현재월 * 12`로 연환산해 연말을 예측
- 공제한도: 총급여 7천만 이하 300만 / 초과 250만 (`TY_LIMIT`)
- **최적 전략 = 신용으로 문턱(총급여 25%)까지만 채우고 나머지는 체크·현금.** 문턱 구간은 공제율과 무관하게 소진되므로 혜택 좋은 신용카드로 쓰는 게 이득
- `tyAdvice()` 분기 순서 주의: **테이블 미설치 → 지출 미분류 → 소득 미지정 → 계산 결과** 순. 전부 미분류일 때 '공제 0원'이라고 하면 덜 쓴 탓으로 오해함
- 총급여 자동추정은 월급 입금 건수가 경과 월수보다 적으면 경고를 띄운다(지현처럼 급여를 앱에 안 적는 멤버는 추정이 크게 낮게 잡힘)
- 진행 바 눈금 최대치는 `max(Sp*1.06, th*1.3)` — 사용액 0일 때 문턱 마커가 100%에 붙어 라벨이 잘리는 것 방지
- **신용<문턱이면 신용·체크의 한계 공제율이 30%로 같다** (`(S-th)*30%` 구간이라 어디에 써도 S만 늘림). 시나리오 차이가 0일 때 사유를 '문턱 미달'로 뭉뚱그리면 틀린다 — 한도 도달 / 문턱 미달 / 신용이 문턱 아래 3가지를 구분할 것
- `tyNotes()`: '제외(none)' 금액이 커서 공제액을 좌우할 때 `dedIfNone`(제외를 30%로 봤을 때)과 대조해 보여준다. 정우 실데이터에서 이체·제일은행카드 3,039만이 제외라 공제액이 9.4만 → 대상으로 보면 250만(한도)

### '남은 공제 여력' 패널 (2026-07 추가)
"연말에 얼마?"(예측)가 아니라 **"지금부터 뭘, 얼마나 더?"**(행동)에 답하는 패널. 이 탭의 실질적 결론.
- **문턱·한도는 연환산 총급여로 정하되, '앞으로 얼마'는 오늘까지의 실적(C·D·S)에서 잰다.** 여기에 연환산을 섞으면 "이미 쓴 셈 친 돈"만큼 필요액이 과소평가된다
- `tyNeed()`는 이분탐색 — 문턱·한도 경계에서 케이스가 갈려(신용이 문턱을 넘느냐, 30%로 채우다 한도에 걸리느냐) 닫힌 식으로 쓰면 한쪽 케이스가 조용히 틀린다
- **'한도 소진'과 '문턱 미달'은 조언이 정반대**다. 둘 다 한계 공제율은 0%지만 한도 소진은 "더 써도 소용없음", 문턱 미달은 "더 쓰면 곧 공제 시작". 뭉뚱그리지 말 것
- `tyAdvice()`는 `dedNow>=limit`(확정으로 한도 달성)과 `ded>=limit`(추세상 달성)을 분리한다 — 전자는 "이제 신용 혜택 챙기세요", 후자는 "체크·현금 N원만 더"
- 신용카드엔 '유리' 배지가 붙을 수 없다(공제율이 체크·현금보다 높은 경우가 없음). 신용을 권하는 상황(문턱 미달·한도 소진)은 배지 대신 하단 설명문이 담당
- ⚠️ 이 패널은 **의도적으로 미다루는 항목**이 있다: 전통시장·대중교통 추가공제(각 한도 100만, 공제율 40%↑)와 도서·공연 30%. 결제수단 축만으로는 분류가 불가능해서다. 실제 공제액은 이 앱 계산보다 클 수 있음

## 구글 시트 백업 (단방향)

거래 저장/수정/삭제 시 Supabase와 함께 구글 시트에도 기록하는 백업.
- **기존 가계부 GAS 프로젝트**(구버전 앱을 `doGet`으로 서빙)에 `doPost` 백업 수신부만 추가하는 방식
- 코드: `backup_appscript.gs` (그 프로젝트 Code.gs 맨 끝에 추가하는 블록), 배포 방법 주석 참고
- 시트: `지출리스트` 탭 (1~7열 기존 형식 + 8열 user + 9열 id(uuid, 매칭용))
- 클라이언트: `backupToSheet(action, payload)` — `saveEntry()`·`saveTransfer()`(2건)·`delEntry()`(이동이면 짝 포함 2건)에서 호출
- `GAS_BACKUP_URL` 비어있으면 자동 비활성 (앱 동작엔 영향 없음, fire-and-forget)
- 시트 행은 Supabase `id`(uuid)로 매칭 → 수정/삭제가 같은 행에 반영
- CORS: `mode:'no-cors'` + `Content-Type:text/plain` 으로 preflight 회피 (응답은 읽지 않음)
- ⚠️ Apps Script 코드 수정 후엔 "배포 관리 → 새 버전"으로 재배포해야 반영됨

---

## 자주 하는 작업

### DB 연계 점검 (코드가 DB에 대해 가정하는 것이 아직 참인가)
스크립트 검증(`verify_rls`·`verify_login`)은 **경계**만 본다. 스키마 계약이 어긋나면 저장이 토스트 한 줄로
조용히 실패하므로, 스키마를 건드렸거나 저장이 안 될 땐 아래를 MCP로 직접 확인한다 (전부 읽기 전용):

1. **upsert 대상**: `select conname, contype, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.<표>'::regclass;`
   → 위 'upsert 계약' 표와 대조. `onConflict` 문자열과 제약이 어긋나면 그 저장 기능만 죽는다.
2. **컬럼·NOT NULL**: `information_schema.columns` → 앱의 필수값 검증(`saveEntry`의 카테고리·계좌)과 NOT NULL이 같이 움직이는지.
3. **정책·권한**: `pg_policies` + `has_table_privilege('anon'|'authenticated', …)`
   → 기대: anon 전부 false / authenticated SELECT·INSERT·UPDATE·DELETE 전부 true + policy `using(true) with check(true)`.
4. **어드바이저**: `mcp__supabase__get_advisors({type:"security"})` — ERROR 0건이어야 한다.
   현재 WARN 1건: **누출 비밀번호 보호 비활성**. (`billing_key` search_path WARN은 함수 삭제로 해소됨)
   ⚠️ 후자는 이 앱에선 예사롭지 않다 — 보안 경계 전체가 **공용 비밀번호 하나**다.
   Supabase 대시보드 → Authentication → Password Protection에서 켜두는 편이 낫다(HaveIBeenPwned 대조, 무료·설정 한 번).
5. ⚠️ 쿼리는 **가계부 6개 테이블 + 뷰 3개로 범위를 명시**할 것 — `public` 전체를 훑으면 휴양림 프로젝트가 섞여 나온다.

> 실제 REST 왕복(로그인 세션으로 전량이 오는가)은 `node scripts\verify_login.js`.
> 비밀번호가 없으면 여기까지는 확인할 수 없다 — MCP로는 서버 안쪽만 본다.

### 스크립트에 비밀번호 넘기기 (BUDGET_PW)
⚠️ **`$env:BUDGET_PW='비밀번호'`를 PowerShell에 직접 치지 말 것.** PSReadLine이 명령줄을 그대로
`%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`에 남겨 **평문으로 영구 보존**된다.
아래 방식은 입력이 화면에도 기록에도 남지 않는다:
```powershell
$s = Read-Host '가족 공용 비밀번호' -AsSecureString
$env:BUDGET_PW = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
node C:\Users\1226c\Projects\Our_Budget\scripts\verify_login.js
Remove-Item Env:\BUDGET_PW
```
- **스크립트는 전체 경로로 부를 것** — `__dirname` 기준으로 파일을 찾게 짜여 있어 어느 폴더에서 실행해도 동작한다
  (상대경로 `scripts\...`는 홈 폴더에서 치면 `MODULE_NOT_FOUND`로 떨어진다. 실제로 겪음)
- Read-Host는 **입력이 화면에 안 보이는 게 정상**(별표도 안 나옴)
- 사용자에게 실행을 부탁할 땐 Claude 세션의 `!` 명령이 아니라 **본인 터미널**로 안내할 것 —
  세션에서 돌리면 비밀번호가 대화에 남고, `Read-Host`는 비대화형이라 어차피 멈춘다
- 유출 점검: `ConsoleHost_history.txt`에서 `BUDGET_PW`를 세어 Read-Host/Remove-Item 형태로 전부 설명되는지 확인
  (값을 출력하지 말 것 — `grep -c`로 개수만)

### DB 스키마 변경이 필요할 때
Supabase MCP가 연결되어 있으면:
```
"~~ SQL 실행해줘" → mcp__supabase__ 도구로 직접 실행
```
연결 안 되어 있으면 사용자에게 Supabase 대시보드 → SQL Editor에서 실행 요청.
실행됐다고 하면 **말만 믿지 말고 검증**: `select` 200 확인 + 임시 행 insert→delete로 RLS 쓰기까지 확인
(정책을 빠뜨리면 읽기는 되고 저장만 조용히 실패한다).
앱은 새 테이블이 없어도 죽지 않게 짜되(`if(!res.error)`), **없는 상태를 화면에 명시**할 것 —
이번에 조용히 전 항목 0원으로 보여 사용자가 버그로 오인했다.
표면화 수단 2종: 테이블 단위 기능이면 `TAX_READY`처럼 전용 플래그로 화면을 갈아끼우고,
로드 실패가 폴백값으로 흡수되는 경우엔 `loadWarn.push("…")` → `warnBanner()`.
**폴백이 사용자 데이터와 구별되지 않는 게 진짜 위험** — 빈 한도·`DEFAULT_CATS`를 보고 다시 저장하면 원본을 덮어쓴다.

### 배포
```bash
git add public/index.html
git commit -m "..."
git push
# Cloudflare Workers 자동 배포 (1~2분 소요)
node scripts/poll_deploy.js "<이번 변경에만 있는 문자열>"   # 반영을 기다림 (인자: [최대라운드] [마커], 마커만 줘도 됨)
node scripts/check_live.js                              # 반영 확인 (배포본 sha256 == origin/main blob)
```
> GAS 백업 코드를 고쳤다면 `backup_appscript.gs`도 함께 커밋. (단 실제 반영은 Apps Script "새 버전" 재배포 필요)

⚠️ **배포 도착 판정을 상태코드로 하지 말 것.** 옛 버전도 `200`을 주므로 `200`은 "떠 있다"는 뜻일 뿐
"내 변경이 반영됐다"가 아니다. 마커 검사(`poll_deploy.js`)가 최소선이고, 확정 판정은 `check_live.js`의 해시 비교다 —
마커는 "그 문자열이 있다"까지만 보장하지만 해시는 한 바이트만 달라도 잡는다.
⚠️ 비교 대상은 **작업 사본이 아니라 커밋된 blob**(`git show origin/main:public/index.html`).
Windows 작업 사본은 CRLF, 리포 blob은 LF라 작업 사본과 비교하면 항상 불일치가 난다.

### JS 검증 (테스트 프레임워크 없음)
브라우저 없이 인라인 JS를 확인하는 법: 마지막 `<script>` 블록을 추출 → `new Function`/`Module._compile`에 stub(supabase·Chart·document·localStorage) 주입해 파싱/순수함수 단위테스트. `node`로 실행.
- 빠른 문법 검사(복붙용): `node -e "const fs=require('fs');const c=[...fs.readFileSync('public/index.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];try{new Function(c);console.log('JS OK')}catch(e){console.error(e.message);process.exit(1)}"`
- 순수함수 단위테스트: 헬퍼를 **손으로 복사하지 말고** `public/index.html`에서 정규식으로 뽑아 `new Function(code+'return {…}')`으로 실행 — 복사본은 원본이 바뀌어도 옛 코드를 검증한다. 상태 매트릭스(경계값 9종)로 불변식을 돌리는 게 값 1~2개 대조보다 훨씬 잘 잡힌다(`tyNeed` 검증에 사용)
- **실 DB 검증**: 복사본에 mock 없이 `localStorage` 기기사용자 + `goTab()`만 주입하면 실제 Supabase로 렌더된다. 목은 "숫자가 나온다"까지만 보장 — 실제 매핑·데이터로 띄워야 결론이 맞는지 알 수 있다
  - ⚠️ **2026-08-07 이후로는 세션도 필요하다.** 로그인 게이트가 세션 없으면 `loadAll()`을 아예 호출하지 않으므로,
    빈 프로필로 띄우면 로그인 카드만 나온다(빈 화면이 아니라 **로그인 화면**으로 보이는 게 정상). 실데이터로 띄우려면
    `sb.auth.signInWithPassword`를 `<head>` 인라인으로 한 번 태우거나 `localStorage["ourbudget.auth"]`에 세션을 심을 것
  - ⚠️ **이 모드에서 `dispatchEvent`로 onchange/onclick을 발화시키면 실서비스 DB에 그대로 쓴다** (테스트 DB 없음 — 가족 실데이터다). 배선만 확인할 땐 load 리스너에서 `window.setTaxMap=(...a)=>calls.push(a)`처럼 **변경 함수를 스텁으로 덮은 뒤** 이벤트를 쏘고 인자만 회수할 것 (설정 탭 미등록 8행 셀렉트를 이렇게 무해하게 검증 — 인자 이스케이프·기존값 선택까지 확인)
- **화면 숫자가 의심스러우면**: REST로 실데이터 스냅샷을 받아 순수함수를 복사한 재현 스크립트로 대조. 이번에 시나리오 비교의 잘못된 사유 문구와, 공제액을 좌우하던 '제외' 금액을 이 방법으로 발견
  - 이 대조는 **"앱이 데이터를 전량 받았다"의 증명**도 된다 — 렌더된 잔액·총수입·총지출이 REST 507행(2026-08-14) 직접 계산과 자릿수까지 일치하면 잘림이 없다는 뜻(`fetchTransactions` 검증에 사용). 건수만 세는 것보다 강한 증거
- **차트가 실제로 그려졌는지**: 스크린샷을 눈으로 보는 대신 `getImageData`의 알파 채널에 0 아닌 픽셀이 있는지 세어 `document.title`에 `"CANVAS 3/3"`처럼 찍고 `--dump-dom | grep '<title>'`로 회수. 빈 캔버스가 배경색과 같아 '그려진 것처럼' 보이는 경우를 잡는다
- 헤드리스 chrome은 **Bash 툴로 실행**할 것. PowerShell에서 `& $chrome ... 2>$null`로 돌리면 파일은 생성되는데 출력이 사라져 실패로 오인함
- 차트·UI 시각 확인(헤드리스 Chrome): `public/index.html` 복사본에 mock(`window.supabase.createClient`→체이너블 thenable `{data,error}`)+`localStorage` 기기사용자 주입, `goTab()`로 탭 강제 후 `chrome --headless=new --screenshot=<절대경로>.png --force-device-scale-factor=2 --virtual-time-budget=8000`(탭 강제 setTimeout이 돌 시간 확보 — 없으면 탭 전환 전에 찍힘). `--screenshot`은 절대경로 필수(상대경로면 "액세스 거부(0x5)"로 파일 미생성). Chrome 경로: `C:\Program Files\Google\Chrome\Application\chrome.exe`
  - ⚠️ **mock은 `<head>`의 인라인 `<script>`에서 `document.addEventListener('DOMContentLoaded', 주입)`으로 걸 것**(2026-08-15 변경).
    supabase CDN이 `<script defer>`라 인라인 mock보다 **나중에** 실행돼 `window.supabase`를 덮어쓴다 → CDN 태그 뒤에 그냥 인라인으로 두면
    mock이 무시되고 조용히 실서비스 DB를 조회한다(스크린샷은 그럴듯하게 나와서 알아채기 어려움).
    DOMContentLoaded 시점엔 defer가 이미 끝나 있고, 리스너는 **등록 순서대로** 돌므로 `<head>`(23행대)에 건 mock이
    본체 스크립트(931행~)의 시작 핸들러보다 먼저 실행된다.
    ⚠️ 예전 방식인 `window.addEventListener('load', …)`은 **이제 늦다** — 앱이 load를 기다리지 않고 DOMContentLoaded에 이미 시작한다
  - ⚠️ **`--window-size`가 뷰포트 *폭*엔 안 먹는다**(clientWidth가 485로 고정). 그 폭으로 스크린샷을 찍으면 오른쪽이 잘려 나가 오버플로 버그처럼 보인다. 특정 폰 폭 검증은 `<iframe src="mock.html" width="360">`로 감싼 래퍼를 찍을 것
  - **높이는 먹는다** → 긴 화면 한 장에 담기: 래퍼에 `<iframe width="360" height="1500">` + `--window-size=400,1520`. 스크린샷은 뷰포트만 찍히므로 window 높이를 늘리는 게 유일한 방법(`--screenshot`엔 full-page 옵션 없음)
  - 실측·수치 회수는 **iframe 안쪽 문서**에서(래퍼를 재면 래퍼 폭이 나옴). 헤드리스는 콘솔이 안 보이므로 `document.title` 또는 `<pre id="DUMP">`에 JSON을 찍고 `--dump-dom | grep`으로 회수. 오버플로는 `documentElement.scrollWidth` vs `clientWidth` + 넘치는 엘리먼트 목록
- ⚠️ `node -e '...'`에 작은따옴표 든 JS(예: `goTab('analysis')`)는 bash 따옴표와 충돌해 조용히 no-op. **heredoc도 금지**: 인용 heredoc(`<<'EOF'`)조차 백슬래시 `\\`가 소실돼 정규식/이스케이프 든 JS가 깨짐 → 스크립트 파일은 Write 도구로 생성 후 `node <절대경로>`로 실행. node에 경로는 인자로 전달(`-e` 문자열 속 `/tmp`는 `C:\tmp`로 오인됨)
⚠️ 차트 재렌더 시 이전 인스턴스 `destroyCharts()` 필수 (누수 방지) — `render()` 첫 줄에서 항상 호출됨(분석 탭 이탈 시 해제 포함). `viewX()`는 HTML만 반환, 캔버스는 `drawX()`에서.

### 입력 시트 구분(type) — 지출 / 입금 / 이동
- 토글 버튼 3개: `tgExp`(지출)·`tgInc`(입금)·`tgTrf`(이동). `setType(t)`가 버튼 색(`tg-e/tg-i/tg-t`)과 행 표시를 토글
- **'이동'(계좌간 이동)** 선택 시: 카테고리·결제수단·계좌 행(`#rowCategory/#rowMethod/#rowAccount`) 숨김 → 출금/입금계좌 행(`#rowFrom/#rowTo`) 노출. `fFromAccount`·`fToAccount` 셀렉트는 계좌 마스터로 채움
- 저장 시 `saveTransfer()`가 거래 2건 insert: 출금계좌 `지출` + 입금계좌 `입금`, 둘 다 `category=TRANSFER_CAT('계좌간 이동')`. 계좌 탭 잔액은 정확히 반영(출금 −, 입금 +)
- **소비/수입 통계에서 제외**: `isTransfer(r)`(=`r.category===TRANSFER_CAT`) 헬퍼로 `expOf/incOf`·`aggCat`·분석 집계·한도 spent에서 이동을 빼서 총지출·총수입·분류·분석이 부풀지 않음. **계좌 탭(`viewAccount`)은 이원화**: 잔액(`bal`·계좌별)은 이동 포함(계좌간 돈 흐름에 필요), 상단 총수입·총지출 카드는 이동 제외 표시('계좌간 이동 제외' 캡션). 새 집계 추가 시 `!isTransfer(r)` 적용 여부 판단
- 내역(list) 리스트엔 이동 2건이 그대로 보임 + `🔄` 아이콘과 `.chip.trf`(파란 '출금·이동'/'입금·이동' 배지)로 한 쌍임을 표시. 날짜별 소계 `de=expOf()`도 이동 제외라, 이동이 낀 날은 보이는 지출행이 소계에 안 잡힐 수 있음(의도된 동작)
- **수정 불가**: 이동 leg는 한 쌍이라 단건 수정 시 짝과 어긋남 → `editEntry`가 `isTransfer(r)`이면 토스트 띄우고 차단(삭제 후 재등록 유도). 신규 입력에서만 `tgTrf` 노출
- **짝 삭제**: `delEntry(id)`가 이동 leg 삭제 시 짝(같은 member·date·amount·`TRANSFER_CAT`·반대 type)을 찾아 `.in("id",[id,mate])`로 함께 삭제 + 구글 시트 백업도 양쪽 전송. 동일 이동이 2쌍 있어도 1건씩 매칭돼 남은 쌍은 유효하게 보존됨
- **짝 없는 leg 감지**: `orphanTransfers()`가 (멤버·날짜·금액) 그룹에서 지출·입금 수를 맞춰보고 남는 쪽을 반환 → `orphanBanner()`가 계좌 탭 상단에 경고. 한쪽만 남으면 **그 계좌 잔액이 금액만큼 틀어지는데 `isTransfer`로 통계에서도 빠져 화면 어디에도 안 드러난다**(구 시트 이관분으로 추정되는 50만원 건이 그렇게 숨어 있었음 — 코드 경로로는 재현 불가). 짝 판정 기준은 `delEntry`와 반드시 같이 움직일 것

### 모바일 대응 주의사항
- `<input list="datalist">` 사용 금지 → iOS Safari 미지원
- 카테고리·결제수단·계좌는 **커스텀 하단 시트 피커**: 값은 숨김 `<select>`에 저장, 표시는 `*Disp` span, 열기는 `openPicker(selId,title)`
- 피커 클래스 `.picker-ov`/`.picker-sht`는 입력 피커(`#pickerOv`)와 기기 사용자 모달(`#duOv`) **공용** — CSS 수정 시 둘 다 영향
- 피커 시트(`.picker-sht`)는 높이를 `dvh`로(vh 금지 — 모바일 툴바에 하단 잘림) + `padding-bottom:env(safe-area-inset-bottom)` 필수. 열릴 때 배경 `#overlay` 스크롤 잠금(`overflow:hidden`)
- `position: fixed` 오버레이는 `overflow-y: auto` 필수
- 입력 시트(`#overlay`) 열릴 때 `body.sheet-open{overflow:hidden}`으로 배경 스크롤 잠금 + `.overlay`에 `overscroll-behavior:contain` 필수 (안 하면 시트 스크롤이 뒤 내역 리스트로 전파돼 비침). `openSheet()`·`editEntry()`에서 클래스 추가, `closeSheet()`에서 제거

### 보안
경계는 **두 겹**이고, 둘 다 있어야 한다:
1. **앱** — 세션이 없으면 `loadAll()`을 호출하지 않는다 (위 '로그인 게이트')
2. **DB** — RLS가 `to authenticated` + anon `revoke`. 앱을 우회해 REST를 직접 때려도 `401` (위 'RLS 정책')

⚠️ 1번만 있으면 **아무 의미 없다**. 배포된 HTML에 anon key가 들어 있으므로 그 키로 REST를 직접 호출하면
로그인 화면을 통째로 건너뛴다. 게이트는 UI 편의고, 실제 차단은 2번이다.

- `.mcp.json`엔 Supabase 연결정보 포함 → 커밋 금지. `.gitignore`에 `.mcp.json`·`PROGRESS.md`·`insert_master.ps1`·`_backup/` 등록됨
- **비밀번호는 코드·문서·커밋·대화 어디에도 남기지 않는다.** 스크립트에 필요하면 `BUDGET_PW` 환경변수로만 (`scripts/lib_auth.js`)
- 추적 파일: `public/index.html`·`wrangler.jsonc`·`scripts/*.js`·`docs/**`·`CLAUDE.md`·`backup_appscript.gs`·`.gitignore`.
  ⚠️ **리포에 넣는 것과 배포되는 것은 다르다** — 배포는 `public/`만. 리포는 public이므로 새 파일은 *공개 저장소에 올라가도 되는가*를 따로 판단할 것
- **잔여 위험(미해결)**: 구글 시트 백업 엔드포인트. `doPost`가 공유 시크릿(`BACKUP_SECRET`)을 검사하긴 하는데,
  그 값이 `backup_appscript.gs`(public 리포)와 배포된 `public/index.html:941` 양쪽에 평문으로 있다 →
  **사실상 무인증**이다. `/exec` URL과 시크릿을 아는 사람은 시트에 행을 넣거나(`upsert`), uuid를 알면 지울 수 있다(`delete`).
  읽기 경로는 없다. 브라우저에서 호출하는 구조상 시크릿을 숨길 방법이 없으므로, 고치려면 GAS를 앱 세션 검증으로 바꿔야 한다
- **사용자 입력 렌더링 규칙**: innerHTML에 들어가는 모든 사용자 문자열(메모·항목명·멤버명·계좌명)은 `esc()`, `onclick="fn('…')"` 인자는 `jsq()` 필수. 안 지키면 따옴표·`<` 든 입력에 UI가 깨짐 (2026-07 전면 적용됨)

---

## 현재 멤버
DB `members` 테이블 기준 (코드에 하드코딩 없음):
- 정우
- 지현
