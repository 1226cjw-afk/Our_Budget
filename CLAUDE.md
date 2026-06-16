# 우리집 가계부 — CLAUDE.md

## 프로젝트 개요

가족 공용 가계부 웹앱. 단일 HTML 파일(`index.html`)로 배포, GitHub Pages로 서빙, Supabase를 백엔드로 사용.

- **배포 URL**: `https://1226cjw-afk.github.io/Our_Budget/`
- **GitHub**: `https://github.com/1226cjw-afk/Our_Budget`
- **로컬 경로**: `C:/Users/1226c/Projects/Our_Budget/` ← 여기서 작업

---

## 연결 정보

### Git
```
remote: https://github.com/1226cjw-afk/Our_Budget.git
branch: main
```
작업 후 항상 `git add index.html && git commit && git push` — GitHub Pages가 자동 배포됨.

### Supabase MCP (SQL 직접 실행)
`~/.claude/mcp.json`에 이미 설정됨. 세션 시작 시 자동 연결.
- **연결 안 될 경우**: Claude Code 완전 재시작 필요
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
> 전역 key-value 설정. 결제 주기 시작일 저장에 사용.
> - `billing_start_day` : 전역 기본 시작일 (fallback)
> - `billing_start_<멤버명>` : 멤버별 시작일 override (예: `billing_start_지현` = `21`)

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

tab          // 현재 탭: list | cat | limit | analysis | acct | master
scope        // 'current' | 'all'
memberFilter // 내역·분류·분석·계좌 탭 공통 멤버 필터 ('전체' 포함)
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

### 주요 함수
| 함수 | 역할 |
|------|------|
| `loadAll()` | members·transactions·category_limits·master_data·app_settings 병렬 로드 |
| `setDeviceUser(name) / openDeviceUser()` | 기기 기본 사용자 설정·선택 모달 |
| `saveBillingStart(member)` | 멤버별 결제 주기 시작일 저장 |
| `saveEntry()` | 거래 추가/수정 |
| `saveLimit(member, cat)` | 멤버별 한도 upsert |
| `addMember() / delMember()` | 멤버 DB CRUD |
| `addMaster(key) / delMaster(key, val)` | 카테고리·결제수단·계좌 CRUD |
| `refreshCatList()` | 입력 시트 select 옵션 갱신 |
| `render()` | 현재 탭 전체 재렌더 |

### 탭 구성
| 탭 | 설명 |
|----|------|
| 내역 (list) | 날짜별 거래 목록, 주기/멤버 필터 |
| 분류 (cat) | 카테고리별 집계, 주기/멤버 필터 |
| 한도 (limit) | 멤버별 한도 설정 및 진행률 |
| 분석 (analysis) | 최근 3주기 차트·반복지출·요약 |
| 계좌 (acct) | 계좌별 잔액, 멤버 필터 |
| 설정 (master) | 멤버·카테고리·결제수단·계좌 관리 |

---

## 구글 시트 백업 (단방향)

거래 저장/수정/삭제 시 Supabase와 함께 구글 시트에도 기록하는 백업.
- **기존 가계부 GAS 프로젝트**(구버전 앱을 `doGet`으로 서빙)에 `doPost` 백업 수신부만 추가하는 방식
- 코드: `backup_appscript.gs` (그 프로젝트 Code.gs 맨 끝에 추가하는 블록), 배포 방법 주석 참고
- 시트: `지출리스트` 탭 (1~7열 기존 형식 + 8열 user + 9열 id(uuid, 매칭용))
- 클라이언트: `backupToSheet(action, payload)` — `saveEntry()`·`delEntry()`에서 호출
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
# GitHub Pages 자동 배포 (1~2분 소요)
```
> GAS 백업 코드를 고쳤다면 `backup_appscript.gs`도 함께 커밋. (단 실제 반영은 Apps Script "새 버전" 재배포 필요)

### 모바일 대응 주의사항
- `<input list="datalist">` 사용 금지 → iOS Safari 미지원. 반드시 `<select>` 사용
- `position: fixed` 오버레이는 `overflow-y: auto` 필수

### 보안
- `.mcp.json`엔 Supabase 연결정보 포함 → 커밋 금지 (현재 `.gitignore` 없음, 추가 권장)

---

## 현재 멤버
DB `members` 테이블 기준 (코드에 하드코딩 없음):
- 정우
- 지현
