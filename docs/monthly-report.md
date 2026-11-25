# 월간 리포트 — 절차

결제 주기가 끝나면 Claude가 그 멤버의 **직전 주기**를 분석해 리포트를 쓰고, 앱의 **분석 → 월간 리포트**에 올린다.
쓰는 주체는 클라우드 예약 작업(아래)이고, 앱은 읽어서 보여주기만 한다.

> ⚠️ 이 리포는 public 이다. **리포트 본문·집계 JSON을 리포에 커밋하지 말 것.** 리포트는 DB(`monthly_reports`)에만 둔다.
> 이 문서에는 절차와 형식만 있다.

## 구성

| 조각 | 위치 | 역할 |
|---|---|---|
| 테이블 | `monthly_reports` (설치 SQL = `public/index.html`의 `REPORTS_DDL`) | 리포트 저장. 경계는 다른 표와 같다(`to authenticated` + anon `revoke`) |
| 스크립트 | `scripts/monthly_report.js` | `due`(쓸 차례) · `facts`(집계 JSON) · `save`(upsert) · `list` |
| 화면 | 분석 탭 → `월간 리포트` 세그먼트 (`viewReports`·`mdHtml`) | 멤버별 목록, 최신 것 펼침 |
| 인증 | 클라우드 환경 **`Our_Budget 월간 리포트`** 의 네트워크 비밀값 | Supabase secret key를 프록시가 `apikey` 헤더로 주입 (`lib_auth.dbHeaders`) |
| 일정 | claude.ai 예약 작업 (각 멤버 주기 시작일 + 2일, 오전) | 아래 '예약 작업' |

- 집계는 앱 스크립트를 vm에서 그대로 돌려 낸다 → **리포트 숫자 = 앱 분석 탭 숫자**(순액·멤버별 주기). 스크립트에 계산을 다시 짜지 말 것.
- 주기가 끝나고 **2일**(`GRACE_DAYS`) 기다린다 — 마지막 날 지출을 다음 날 입력하는 일이 흔하다.
- PC에서도 같은 스크립트가 돈다: `BUDGET_PW`(lib_auth.js 머리주석의 Read-Host 방식) 후 `node scripts\monthly_report.js due`.

## 예약 작업이 하는 일

1. `BUDGET_AUTH=proxy node scripts/monthly_report.js due` → `due:true` 인 멤버만 대상. 없으면 아무것도 하지 않고 끝낸다.
   `tableReady:false` 면 리포트를 쓰지 말고 "테이블 설치 필요"라고만 보고한다.
2. 대상마다 `BUDGET_AUTH=proxy node scripts/monthly_report.js facts <멤버> > <스크래치>/facts.json` 를 읽고 아래 형식으로 리포트를 쓴다.
3. 스크래치 디렉터리에 `.md`로 저장 → `BUDGET_AUTH=proxy node scripts/monthly_report.js save <멤버> <period.start> <파일>`.
   스크립트가 다시 읽어 대조한다. "저장됨"이 안 나오면 실패로 보고한다.
4. **git 커밋·푸시 하지 않는다.** 리포에 바꿀 것이 없다(있다면 그건 사고다).

## 리포트 형식

```
# <한 줄 요약 — 40자 이내, 목록에 제목으로 뜬다>

## 한눈에
## 어디에 썼나
## 눈에 띈 것
## 다음 주기 제안
## 지난 제안 돌아보기      ← facts.previousReport 가 있을 때만
```

**허용 문법은 `## 소제목` · `- 목록` · `**굵게**` · 빈 줄로 나눈 문단뿐이다.** 표·링크·이미지·코드블록은 앱이 그리지 않는다.
소제목에 이모지를 넣지 않는다(디자인 계약). 해요체, 1,500~2,500자.

쓰는 규칙:
- **숫자는 facts.json에 있는 것만.** 계산이 필요하면 facts 값끼리의 단순 차·비율만. 금액은 `182만원`·`8.4만원`처럼 만원 단위(1만원 미만은 원).
- 비교 기준은 `avgPrevExpense`(기록이 있던 지난 주기 평균)와 `previousCycles[0]`. 기록 전 빈 주기는 이미 빠져 있다.
- **"덜 썼다"고 말하기 전에 기록 상태부터 본다.** `recording.daysWithRows`가 지난 주기들(`previousCycles[].daysWithRows`)보다 크게 적거나
  `recording.lastRowDate`가 주기 끝보다 한참 이르면, 지출 감소가 아니라 **입력 누락 가능성**을 먼저 쓰고 판정을 보류한다.
- **지출 카테고리에 들어온 큰 입금을 짚는다.** 앱은 같은 카테고리 입금 중 정산·환불 크기(그 카테고리 지출 이하, 20% 여유)만
  지출에서 빼고, 그보다 큰 입금은 수입으로 센다(2026-11-25 규칙 — `catFlows`). 그래서 지출은 사라지지 않지만,
  `categories[].inflowAsIncome`이 크면 그 입금이 정말 수입인지(월세·판매) 분류가 잘못된 것인지(예금 해지·적금 만기 —
  2026-10-04 지현 생활비 '예금 해지' 1,057만원이 실례) 수입 숫자를 해석하기 전에 "입금 분류 확인 필요"로 쓴다.
- `possibleDuplicates`(같은 날·같은 금액)는 '중복 입력 의심'으로 날짜·메모를 들어 알려준다. 단정하지 않는다.
- 적금·보험처럼 저축·보장 성격의 고정 지출은 소비와 구분해 말한다(앱은 카테고리만 안다).
- `limits`의 `over`/`warn`, `bigSpends`(평소 대비 배수), `categories[].newThisCycle`, `recurring`(금액 변화)를 우선 소재로 쓴다.
- 제안은 **2~3개, 다음 주기에 바로 할 수 있는 구체적 행동**으로. 금액 근거를 붙인다. 훈계·도덕 판단 금지.
- 계좌번호·카드번호 등 식별 정보는 쓰지 않는다(메모에 있어도 옮기지 않는다).
- 매매·투자 권유를 하지 않는다.

## 설치·운영 메모

- 테이블이 없으면 앱이 그 세그먼트에 설치 SQL과 복사 버튼을 띄운다(`REPORTS_STATE="missing"`). 설치 후 `node scripts/verify_rls.js`로 anon 차단(401) 확인.
- 멤버 주기 시작일을 바꾸면(설정 탭) **예약 작업 일정도 같이 바꿀 것** — `due`는 '직전 주기'만 보므로, 일정이 어긋나면 그 달 리포트가
  늦어질 뿐 빠지진 않는다(다음 실행 때 같은 주기가 여전히 직전이면 쓴다. 한 주기 넘게 어긋나면 빠진다).
- 같은 주기를 다시 쓰고 싶으면 `save`를 다시 하면 된다(`unique(member, period_start)` upsert로 덮어쓴다).
- secret key는 RLS를 우회한다. 이 환경에서 돌리는 스크립트는 가계부 표를 **읽기만** 하고, 쓰기는 `monthly_reports`에만 한다.
