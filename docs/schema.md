# Our_Budget — DB 스키마 (전체 정의)

> `CLAUDE.md` 에서 분리해 온 **참조 문서**다 (2026-08-24 분리).
> 어기면 조용히 깨지는 **규칙 요약은 `CLAUDE.md` 의 `## DB 스키마` 절**에 남아 있다. 여기엔 전체 정의와 그 근거가 있다.
> 스키마 실물은 `mcp__supabase__list_tables` 로 언제든 실측할 수 있다 — 문서와 어긋나면 **DB가 정답**이다.
> ⚠️ 이 Supabase 프로젝트는 휴양림 앱과 공유한다. 아래는 **가계부 6개 테이블**만 다룬다.

---


## members
```sql
id         serial primary key
name       text unique not null
created_at timestamptz default now()
```
> MEMBERS는 JS 하드코딩 없음. 앱 로드 시 이 테이블에서 동적 로드.

## transactions
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

## category_limits
```sql
id            uuid default gen_random_uuid()
member        text not null references members(name) on delete cascade
category      text not null
monthly_limit numeric not null check (monthly_limit >= 0)
primary key (member, category)   -- saveLimit의 onConflict 대상
```
> 멤버별 독립 한도. 복합 PK (member, category).
> ⚠️ 과거 `UNIQUE(category)` 단독 제약이 남아 멤버별 한도를 막던 버그가 있었음 → 2026-06 제거됨. 다시 추가 금지.

## master_data
```sql
id         uuid default gen_random_uuid() primary key   -- ⚠️ serial 아님(2026-08-14 실측 정정)
member     text not null references members(name) on delete cascade
type       text not null   -- 'category' | 'method' | 'account'
value      text not null
created_at timestamptz default now()
unique (member, type, value)   -- addMaster의 onConflict 대상
```

## tax_map
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

## app_settings
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

## upsert 계약 (코드 ↔ DB) — 2026-08-14 실측 대조 완료
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

## RLS 정책 (가계부 6개 테이블 공통) — 2026-08-07 축소
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

## ✅ 뷰 3개 + `billing_key()`는 삭제됨 (2026-08-14, 마이그레이션 `drop_legacy_budget_views`)
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
