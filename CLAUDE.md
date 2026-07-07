# 우리집 가계부 — CLAUDE.md

## 프로젝트 개요

가족 공용 가계부 웹앱. 단일 HTML 파일(`index.html`)로 배포, Cloudflare Workers로 서빙, Supabase를 백엔드로 사용.

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
작업 후 항상 `git add index.html && git commit && git push` — Cloudflare Workers가 GitHub `main`을 감지해 자동 배포됨.
> Cloudflare가 GitHub 연결 시 자동 생성한 `cloudflare/workers-autoconfig` 원격 브랜치가 연동 증거. 배포 설정은 저장소가 아니라 Cloudflare 대시보드에 있음.

### Supabase MCP (SQL 직접 실행)
프로젝트 폴더의 `Our_Budget/.mcp.json`에 설정됨 (project 범위).
- ⚠️ **반드시 `Our_Budget` 폴더에서 claude를 열어야 연결됨.** 다른 폴더(예: 홈)에서 열면 MCP 안 붙음
- 바탕화면 "가계부 Claude" 바로가기 또는 PowerShell `budget` 명령으로 열면 자동 연결
- **연결 안 될 경우**: Claude Code 완전 재시작
- ⚠️ `.mcp.json`에 Supabase access token이 평문 저장됨 → git에 커밋 금지 (`.gitignore` 확인)
- 연결되면 `mcp__supabase__*` 도구로 SQL 직접 실행 가능 (Supabase 대시보드 불필요)

### Supabase 프로젝트
```
Project Ref : hqyvkyflakhuvethrstw
URL         : https://hqyvkyflakhuvethrstw.supabase.co
Anon Key    : sb_publishable_phZGH7odPTBoB4z8FQF_4A_mO2ltQ6J
```

---

## 파일 구조

```
Our_Budget/
├── index.html           # 앱 전체 (HTML + CSS + JS 단일 파일) — 유일한 배포 산출물
├── backup_appscript.gs  # 구글 시트 백업용 GAS 코드 (참고용, 배포는 Apps Script에 수동 반영)
└── CLAUDE.md            # 이 파일
# (git 미추적 보조: PROGRESS.md, insert_master.ps1, .mcp.json — 커밋 대상 아님)
```

CSS · JS 모두 `index.html` 안에 인라인. 외부 의존성:
- `@supabase/supabase-js@2` (CDN)
- `chart.js` (CDN)
- Pretendard / Noto Sans KR (Google Fonts)

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
id       uuid default gen_random_uuid() primary key
date     date
amount   numeric
type     text   -- '지출' | '입금'
member   text references members(name) on delete cascade
category text
method   text
account  text
memo     text
```

### category_limits
```sql
id            uuid default gen_random_uuid()
member        text references members(name) on delete cascade
category      text
monthly_limit numeric check (monthly_limit >= 0)
primary key (member, category)
```
> 멤버별 독립 한도. 복합 PK (member, category).
> ⚠️ 과거 `UNIQUE(category)` 단독 제약이 남아 멤버별 한도를 막던 버그가 있었음 → 2026-06 제거됨. 다시 추가 금지.

### master_data
```sql
id     serial primary key
member text references members(name) on delete cascade
type   text   -- 'category' | 'method' | 'account'
value  text
unique (member, type, value)
```

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
> - `cat_icon_<카테고리명>` : 카테고리 이모지 아이콘 (전 멤버 공통). master_data에 icon 컬럼을 두지 않은 이유: 신규 멤버는 카테고리가 DB 없이 DEFAULT_CATS fallback으로 돌아 행이 없을 수 있음

### RLS 정책 (모든 테이블 공통)
```sql
FOR ALL USING (true) WITH CHECK (true)
```

---

## 앱 구조 (JS)

### 전역 상태
```js
MEMBERS        // string[]  — DB에서 로드
ROWS           // 거래내역 전체
LIMITS         // { 멤버: { 카테고리: 금액 } }
MASTER         // { 멤버: { categories, methods, accounts } }
BILLING_STARTS // { 멤버: 시작일 } — app_settings에서 로드
DEVICE_USER    // 이 기기의 기본 사용자 (localStorage, 없으면 null)
USER_ICONS     // { 카테고리: 이모지 } — app_settings의 cat_icon_* (icon() 헬퍼가 CAT_ICON보다 우선 사용)
WARN_TH        // 한도 경고 임계값 % (app_settings.warn_threshold, 기본 80)
AN_PERIODS     // 분석·분류 탭 표시 주기 수 (app_settings.analysis_periods, 기본 3)

tab          // 현재 탭: list | cat | limit | analysis | acct | master
scope        // 'current' | 'all'
periodOffset // 내역·분류 탭 주기 탐색: 0=이번 주기, -1=한 주기 전 … (◀▶로 이동, 0 초과 불가)
memberFilter // 내역·분류·분석·계좌 탭 공통 멤버 필터 ('전체' 포함)
searchQ      // 내역 탭 검색어 (메모·카테고리·계좌·결제수단·멤버 부분일치)
catBy        // 분류 탭 집계 기준: 'category' | 'method' — aggCat(rs, field)가 키 필드로 사용, 빈 결제수단은 '미지정'
limitMember  // 한도 탭 전용 멤버 선택 (null 없음)
masterMember // 설정 탭 전용 멤버 선택
memberVal    // 입력 시트의 '누가' 선택값
```

### 기기별 기본 사용자 (DEVICE_USER)
인증 없이 기기마다 기본 사용자를 기억하는 방식. `localStorage["ourbudget.deviceUser"]`에 멤버명 저장.
- 최초 접속 시 "이 기기는 누구의 폰인가요?" 모달 1회 표시
- 설정 탭 → 📱 이 기기 사용자에서 변경 (멤버 / 공용)
- 정해지면 입력 시트 '누가', `memberFilter`·`limitMember`·`masterMember` 기본값이 그 사람으로 맞춰짐 (`defMember()`)
- '공용' 선택 시 기존처럼 `MEMBERS[0]` 기본 + `memberFilter='전체'`

### 결제 주기
멤버별 시작일 설정 (`BILLING_STARTS`, 기본 매월 25일~익월 24일). `billingPeriod(member, ref)`가 해당 멤버 주기 계산.
`viewedPeriod(member)`는 여기에 `periodOffset`을 반영한 '현재 조회 중인 주기' — `scoped()`가 사용.

### 주요 함수
| 함수 | 역할 |
|------|------|
| `loadAll()` | members·transactions·category_limits·master_data·app_settings 병렬 로드 |
| `refreshData()` | 헤더 ↻ 버튼 — 수동 재로드 (다른 기기 입력 동기화) |
| `setSearch(v)` | 내역 검색 — 200ms 디바운스 후 render, searchBox 포커스·커서 복원 |
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
| `addMember() / delMember()` | 멤버 DB CRUD |
| `addMaster(key) / delMaster(key, val)` | 카테고리·결제수단·계좌 CRUD |
| `refreshCatList()` | 입력 시트 select 옵션 갱신 |
| `openPicker(sel,title) / pickOptIdx(i) / updateSelBtn(sel)` | 커스텀 하단 시트 피커 열기·선택·버튼 표시 갱신 |
| `viewAnalysis() / buildInsights() / bigSpends(rows)` | 분석 탭 렌더 + 스마트 진단·절약팁 + 일회성 이상치(카테고리 중앙값 대비 ≥2.5배·표본≥3) |
| `drawAnalysisCharts() / destroyCharts()` | 도넛 + 주기별 스택막대(지출=카테고리·왼축, 수입=오른 보조축) + 추이 라인 / 인스턴스 일괄 파괴 |
| `expOf(rs) / incOf(rs) / catColor(c)` | 지출·수입 합계 헬퍼(이동 제외), 카테고리 색 — **처음 등장 순서대로 팔레트 배정**(`_catOrder`). ⚠️이름해시 금지: 한글 카테고리가 한 칸에 몰려 전부 초록으로 보였음 |
| `isTransfer(r)` | 계좌간 이동 거래 판별(`r.category===TRANSFER_CAT`) — 통계 제외 필터에 공통 사용 |
| `$(id) / parseDate(s) / todayStr() / amtVal(id)` | getElementById 축약 / 날짜 파싱(YYYY-MM-DD는 정오로 — 타임존 경계 안전) / 오늘 날짜 문자열 / 콤마 금액 input→숫자 |
| `reloadAndRender()` | `loadAll()+render()` — CRUD 후 공통 마무리 |
| `movePeriod(d) / resetPeriod() / viewedPeriod(m)` | 내역·분류 탭 ◀▶ 주기 탐색 (periodOffset 0 클램프, 누르면 scope='current') |
| `drillTo(q)` | 분류 카드 클릭 → 내역 탭 이동 + 검색어 세팅 (주기·멤버 필터 유지, '미지정' 카드는 비활성) |
| `exportCSV()` | 설정 탭 — 전체 거래 CSV 다운로드 (UTF-8 BOM, 콤마·따옴표·개행 인용 처리) |
| `ensureOpt(selId,val)` | 수정 시트에서 마스터에 없는 기존 값을 select에 임시 옵션으로 추가 — 삭제된 카테고리·계좌가 첫 옵션으로 바뀌는 것 방지 |
| `render()` | 현재 탭 전체 재렌더 |

### 탭 구성
| 탭 | 설명 |
|----|------|
| 내역 (list) | 날짜별 거래 목록, 주기(◀▶ 과거 주기 탐색)/멤버 필터 + 검색바(searchQ)·건수 표시 |
| 분류 (cat) | 카테고리별/결제수단별 집계(catBy 토글 필), 주기(◀▶)/멤버 필터, 카드 클릭 시 내역 드릴다운 |
| 한도 (limit) | 멤버별 한도 설정 및 진행률 (warn 임계값=WARN_TH) + 상단 '전체 한도 요약' 카드 |
| 분석 (analysis) | 최근 AN_PERIODS주기 차트·반복지출·요약 |
| 계좌 (acct) | 계좌별 잔액(이동 포함), 총수입·지출(이동 제외), 멤버 필터 |
| 설정 (master) | 멤버·기기사용자·앱설정(임계값·주기수)·CSV 내보내기·결제주기·카테고리(아이콘 포함)·결제수단·계좌 관리 |

> 헤더 우측: 👤 기기사용자 칩(누르면 openDeviceUser) + ↻ 새로고침(refreshData). 칩 텍스트는 render()에서 갱신.

> ⚠️ 한도 탭(`viewLimit`) 카테고리 목록은 `MASTER[멤버].categories`(master_data DB) 기준 + 기존 저장 한도. 지출 발생 카테고리(`spent`)로 만들면 '계좌간 이동'처럼 설정에 없는 항목까지 한도 UI가 떠서 안 됨.

---

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

### DB 스키마 변경이 필요할 때
Supabase MCP가 연결되어 있으면:
```
"~~ SQL 실행해줘" → mcp__supabase__ 도구로 직접 실행
```
연결 안 되어 있으면 사용자에게 Supabase 대시보드 → SQL Editor에서 실행 요청.

### 배포
```bash
git add index.html
git commit -m "..."
git push
# Cloudflare Workers 자동 배포 (1~2분 소요)
```
> GAS 백업 코드를 고쳤다면 `backup_appscript.gs`도 함께 커밋. (단 실제 반영은 Apps Script "새 버전" 재배포 필요)

### JS 검증 (테스트 프레임워크 없음)
브라우저 없이 인라인 JS를 확인하는 법: 마지막 `<script>` 블록을 추출 → `new Function`/`Module._compile`에 stub(supabase·Chart·document·localStorage) 주입해 파싱/순수함수 단위테스트. `node`로 실행.
- 빠른 문법 검사(복붙용): `node -e "const fs=require('fs');const c=[...fs.readFileSync('index.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];try{new Function(c);console.log('JS OK')}catch(e){console.error(e.message);process.exit(1)}"`
- 순수함수 단위테스트: 대상 헬퍼(`expOf`·`isTransfer` 등)를 `node -e`에 그대로 복사해 입력/기대값 비교 (이번 세션 이동 제외·짝 매칭 검증에 사용)
- 차트·UI 시각 확인(헤드리스 Chrome): index.html 복사본의 supabase CDN 뒤에 mock(`window.supabase.createClient`→체이너블 thenable `{data,error}`)+`localStorage` 기기사용자 주입, `goTab()`로 탭 강제 후 `chrome --headless=new --screenshot=<절대경로>.png --window-size=480,H --force-device-scale-factor=2 --virtual-time-budget=6000`(탭 강제 setTimeout이 돌 시간 확보 — 없으면 탭 전환 전에 찍힘). `--screenshot`은 절대경로 필수(상대경로면 "액세스 거부(0x5)"로 파일 미생성). CDN(Chart.js·폰트)은 헤드리스에서도 로드됨. Chrome 경로: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- ⚠️ `node -e '...'`에 작은따옴표 든 JS(예: `goTab('analysis')`)는 bash 따옴표와 충돌해 조용히 no-op. **heredoc도 금지**: 인용 heredoc(`<<'EOF'`)조차 백슬래시 `\\`가 소실돼 정규식/이스케이프 든 JS가 깨짐 → 스크립트 파일은 Write 도구로 생성 후 `node <절대경로>`로 실행. node에 경로는 인자로 전달(`-e` 문자열 속 `/tmp`는 `C:\tmp`로 오인됨)
⚠️ 차트 재렌더 시 이전 인스턴스 `destroyCharts()` 필수 (누수 방지). `viewX()`는 HTML만 반환, 캔버스는 `drawX()`에서.

### 입력 시트 구분(type) — 지출 / 입금 / 이동
- 토글 버튼 3개: `tgExp`(지출)·`tgInc`(입금)·`tgTrf`(이동). `setType(t)`가 버튼 색(`tg-e/tg-i/tg-t`)과 행 표시를 토글
- **'이동'(계좌간 이동)** 선택 시: 카테고리·결제수단·계좌 행(`#rowCategory/#rowMethod/#rowAccount`) 숨김 → 출금/입금계좌 행(`#rowFrom/#rowTo`) 노출. `fFromAccount`·`fToAccount` 셀렉트는 계좌 마스터로 채움
- 저장 시 `saveTransfer()`가 거래 2건 insert: 출금계좌 `지출` + 입금계좌 `입금`, 둘 다 `category=TRANSFER_CAT('계좌간 이동')`. 계좌 탭 잔액은 정확히 반영(출금 −, 입금 +)
- **소비/수입 통계에서 제외**: `isTransfer(r)`(=`r.category===TRANSFER_CAT`) 헬퍼로 `expOf/incOf`·`aggCat`·분석 집계·한도 spent에서 이동을 빼서 총지출·총수입·분류·분석이 부풀지 않음. **계좌 탭(`viewAccount`)은 이원화**: 잔액(`bal`·계좌별)은 이동 포함(계좌간 돈 흐름에 필요), 상단 총수입·총지출 카드는 이동 제외 표시('계좌간 이동 제외' 캡션). 새 집계 추가 시 `!isTransfer(r)` 적용 여부 판단
- 내역(list) 리스트엔 이동 2건이 그대로 보임 + `🔄` 아이콘과 `.chip.trf`(파란 '출금·이동'/'입금·이동' 배지)로 한 쌍임을 표시. 날짜별 소계 `de=expOf()`도 이동 제외라, 이동이 낀 날은 보이는 지출행이 소계에 안 잡힐 수 있음(의도된 동작)
- **수정 불가**: 이동 leg는 한 쌍이라 단건 수정 시 짝과 어긋남 → `editEntry`가 `isTransfer(r)`이면 토스트 띄우고 차단(삭제 후 재등록 유도). 신규 입력에서만 `tgTrf` 노출
- **짝 삭제**: `delEntry(id)`가 이동 leg 삭제 시 짝(같은 member·date·amount·`TRANSFER_CAT`·반대 type)을 찾아 `.in("id",[id,mate])`로 함께 삭제 + 구글 시트 백업도 양쪽 전송. 동일 이동이 2쌍 있어도 1건씩 매칭돼 남은 쌍은 유효하게 보존됨

### 모바일 대응 주의사항
- `<input list="datalist">` 사용 금지 → iOS Safari 미지원
- 카테고리·결제수단·계좌는 **커스텀 하단 시트 피커**: 값은 숨김 `<select>`에 저장, 표시는 `*Disp` span, 열기는 `openPicker(selId,title)`
- 피커 클래스 `.picker-ov`/`.picker-sht`는 입력 피커(`#pickerOv`)와 기기 사용자 모달(`#duOv`) **공용** — CSS 수정 시 둘 다 영향
- 피커 시트(`.picker-sht`)는 높이를 `dvh`로(vh 금지 — 모바일 툴바에 하단 잘림) + `padding-bottom:env(safe-area-inset-bottom)` 필수. 열릴 때 배경 `#overlay` 스크롤 잠금(`overflow:hidden`)
- `position: fixed` 오버레이는 `overflow-y: auto` 필수
- 입력 시트(`#overlay`) 열릴 때 `body.sheet-open{overflow:hidden}`으로 배경 스크롤 잠금 + `.overlay`에 `overscroll-behavior:contain` 필수 (안 하면 시트 스크롤이 뒤 내역 리스트로 전파돼 비침). `openSheet()`·`editEntry()`에서 클래스 추가, `closeSheet()`에서 제거

### 보안
- `.mcp.json`엔 Supabase 연결정보 포함 → 커밋 금지. `.gitignore`에 `.mcp.json`·`PROGRESS.md`·`insert_master.ps1` 등록됨
- 추적 파일은 `index.html`·`CLAUDE.md`·`backup_appscript.gs`·`.gitignore` 4개뿐
- **사용자 입력 렌더링 규칙**: innerHTML에 들어가는 모든 사용자 문자열(메모·항목명·멤버명·계좌명)은 `esc()`, `onclick="fn('…')"` 인자는 `jsq()` 필수. 안 지키면 따옴표·`<` 든 입력에 UI가 깨짐 (2026-07 전면 적용됨)

---

## 현재 멤버
DB `members` 테이블 기준 (코드에 하드코딩 없음):
- 정우
- 지현
