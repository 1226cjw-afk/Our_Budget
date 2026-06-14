# 우리집 가계부 — CLAUDE.md

## 프로젝트 개요

가족 공용 가계부 웹앱. 단일 HTML 파일(`index.html`)로 배포, GitHub Pages로 서빙, Supabase를 백엔드로 사용.

- **배포 URL**: `https://1226cjw-afk.github.io/Our_Budget/`
- **GitHub**: `https://github.com/1226cjw-afk/Our_Budget`
- **로컬 경로 (주)**: `C:/Users/1226c/Our_Budget/` ← 여기서 작업
- **로컬 경로 (부)**: `C:/budget/` (동일 remote, main 브랜치로 동기화됨)

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
├── index.html        # 앱 전체 (HTML + CSS + JS 단일 파일)
└── CLAUDE.md         # 이 파일
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

### 모바일 대응 주의사항
- `<input list="datalist">` 사용 금지 → iOS Safari 미지원. 반드시 `<select>` 사용
- `position: fixed` 오버레이는 `overflow-y: auto` 필수

---

## 현재 멤버
DB `members` 테이블 기준 (코드에 하드코딩 없음):
- 정우
- 지현
