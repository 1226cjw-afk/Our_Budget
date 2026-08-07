# 가계부 보안 수습 — 공유 계정 로그인 게이트 설계

- 작성일: 2026-08-07
- 대상: `Our_Budget` (`index.html` 단일 파일 앱, Cloudflare Workers 정적 배포)
- 배경: `PROGRESS.md` 2026-08-06 전수 점검 #1

---

## 1. 문제

`index.html:25-26`에 Supabase URL과 publishable key(`sb_publishable_…`)가 평문으로 있고,
가계부 6개 테이블의 RLS가 모두 `FOR ALL USING (true) WITH CHECK (true)`다.
따라서 **키를 가진 누구나 거래 490건·급여·계좌 잔액을 읽고, 쓰고, 지울 수 있다.**

노출 경로는 두 갈래이며, 둘 다 확인됐다.

| 경로 | 상태 |
|---|---|
| GitHub public 리포 | `1226cjw-afk/Our_Budget` public. 봇이 이 키 형식을 상시 크롤링한다 |
| 배포 사이트 | `assets.directory: "."` 라 리포 루트가 통째로 서빙됨 |

배포 사이트에서 실측한 응답(2026-08-07):

```
/CLAUDE.md           200 (35KB)   ← URL·anon key·project ref·GAS secret 포함
/backup_appscript.gs 200
/.gitignore          200
/.git/config         200          ← remote URL 노출
/.git/HEAD           200
/.git/index          200
/.git/logs/HEAD      200
/.mcp.json           404 (gitignore 덕분)
```

**따라서 리포를 private으로 돌려도 유출은 멈추지 않는다.** 배포본이 같은 파일을 공개하기 때문이다.
점검 문서가 선택지 3(private 전환)을 "근본 해결 아님"으로 본 이유가 실제로는 더 강하다.

읽기보다 **삭제**가 더 현실적인 위험이다. 무료 플랜이라 PITR이 없고,
구글 시트 백업은 단방향이라 복구 근거가 되지 못한다(멤버 삭제 cascade도 전파되지 않는다).

## 2. 접근법 선택

| 안 | 내용 | 판정 |
|---|---|---|
| A | Worker 전체 프록시 + service_role 키 | ✗ 지키려는 것보다 위험한 것(프로젝트 전체 god-key)을 새로 만든다. 휴양림 테이블까지 사정권. 세션·비번검증·레이트리밋을 직접 구현해야 함 |
| B | Worker가 단기 JWT 서명, 앱은 Supabase 직접 호출 | ✗ A의 단점은 줄지만 Supabase가 이미 제공하는 세션·갱신을 재발명 |
| **C** | **Supabase Auth 공유 계정 1개 + RLS `to authenticated`** | **✓ 채택** |

점검 문서는 Supabase Auth를 "가족 계정 2개 = 로그인 UI 필요"로 보고 A를 유력안으로 뒀다.
그러나 요구사항이 **공유 비밀번호 1개**로 확정되면 그것은 곧 공용 계정 1개이고, 그러면 Worker 자체가 불필요해진다.

C를 고른 근거:
- 새 인프라 0개. 세션 유지·토큰 갱신·로그인 레이트리밋을 supabase-js와 Supabase가 처리
- `sb.from(...)` 호출부가 한 줄도 바뀌지 않음 (시작 흐름만 변경)
- publishable key는 공개된 채로 둬도 무해해진다 — 세션 없이는 한 행도 못 읽으므로
- 테이블 단위 정책이라 휴양림은 무영향

## 3. 설계

### 3-1. Supabase

공용 계정 1개를 대시보드에서 생성(Auto Confirm). 이메일은 `1226cjw@gmail.com`
— 비밀번호 재설정 메일이 실제로 도착하는 주소여야 복구가 가능하다.

6개 테이블(`members` `transactions` `category_limits` `master_data` `tax_map` `app_settings`)의
정책을 `TO authenticated`로 좁힌다. 기존 정책명을 몰라도 되도록 `pg_policies`를 순회한다.

```sql
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname='public'
     and tablename in ('members','transactions','category_limits','master_data','tax_map','app_settings')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['members','transactions','category_limits','master_data','tax_map','app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy family_only on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
```

`revoke ... from anon`을 함께 넣는 이유: 정책만 바꾸면 anon 요청이 **빈 배열**로 떨어지는데
그것은 "데이터 없음"과 구별되지 않는다. revoke하면 권한 오류가 되어 차단 여부를 확실히 판정할 수 있다.

### 3-2. 앱 (`index.html`)

시작 흐름만 바뀐다.

```
window.onload
  → createClient(URL, ANON, { auth: { persistSession: true, autoRefreshToken: true } })
  → getSession()
      세션 없음 → 로그인 화면. loadAll() 호출하지 않는다
      세션 있음 → loadAll() + render()      ← 기존 흐름 그대로
```

- 로그인 화면은 기존 `.picker-ov` / `.picker-sht` 오버레이 패턴 재사용(`#duOv`와 동일 구조).
  새 CSS 체계를 만들지 않는다
- **실제 `<form>` + 숨김 username input + `autocomplete="current-password"`.**
  이래야 브라우저·iOS 비밀번호 관리자가 저장하고, "기기당 1회 입력"이 실제로 1회가 된다
- `onAuthStateChange`에서 `SIGNED_OUT`을 받으면 로그인 화면으로 복귀.
  세션 만료·비밀번호 변경 시 기존의 빨간 "데이터 연결 오류" 카드가 뜨면 안 된다 (원인을 오도함)
- 로그아웃 버튼은 설정 탭 `📱 이 기기 사용자` 섹션 아래

`DEVICE_USER`(localStorage 기기 사용자)는 그대로 유지한다. 인증과 무관한 별개 개념이다.

### 3-3. 정적 자산 노출 차단

리포 루트에 `.assetsignore`를 두어 앱이 아닌 파일을 배포에서 제외한다.

```
CLAUDE.md
PROGRESS.md
backup_appscript.gs
docs/**
.git/**
.gitignore
.assetsignore
wrangler.jsonc
```

`wrangler.jsonc`는 Cloudflare가 빌드 때 자동 생성하던 것과 **동일 내용으로 main에 명시 커밋**해
동작을 고정한다(현재 main에는 없고 `cloudflare/workers-autoconfig` 브랜치에만 있다).

이 변경은 3-1·3-2와 독립이므로 **먼저 따로 배포해 검증한다.**
배포 설정 변경은 실패 시 앱이 통째로 뜨지 않는 종류라, 인증 변경과 섞으면 원인 분리가 안 된다.

## 4. 실행 순서

순서 자체가 설계의 일부다. **RLS를 조이기 전에 전량 덤프를 먼저 뜬다** —
정책을 잘못 걸어 본인도 못 들어가는 상황이 흔하고, 그때 데이터가 손에 있어야 한다.
이 덤프는 점검 문서 #7-3(백업)의 첫 산출물이기도 하다.

1. 6개 테이블 전량 JSON 덤프 → `C:\Users\1226c\Projects\Our_Budget\_backup\YYYY-MM-DD.json`
   (`.gitignore`·`.assetsignore` 양쪽에 `_backup/` 추가 — 리포에도 배포본에도 들어가면 안 된다)
2. `.assetsignore` + `wrangler.jsonc` 커밋·배포 → `/CLAUDE.md`·`/.git/config` 404 확인
3. 공용 계정 생성 (대시보드, Auto Confirm)
4. 앱 로그인 게이트 구현 → 헤드리스로 로그인 화면·로그인 후 렌더 확인
5. RLS SQL 적용 (MCP)
6. 외부 검증 (아래)
7. 배포 후 실기기 확인

## 5. 검증

| # | 확인 | 기대 |
|---|---|---|
| V1 | anon key로 6개 테이블 GET | HTTP 401/403 (**`200 []`이면 실패**로 판정) |
| V2 | anon key로 휴양림 테이블 GET | 200 + 데이터 (무영향 확인) |
| V3 | anon key로 `transactions` POST | 401/403. 쓰기가 열려 있으면 읽기 차단은 의미 없음 |
| V4 | `signInWithPassword` 후 GET | 200 + 490행 |
| V5 | 로그인 전 앱 렌더 | 로그인 화면. 데이터·에러카드 없음 |
| V6 | 로그인 후 앱 렌더 | 기존 화면 그대로 |
| V7 | 배포본 `/CLAUDE.md` `/.git/config` | 404 |

V1·V3은 **실패 시 조용히 넘어가면 안 되는 항목**이다. "정책을 걸었다"는 실행 결과가 아니라
외부에서 실제로 막혔는지로만 판정한다.

## 6. 잔여 위험 (의도적 범위 밖)

- **GAS 백업 secret 노출** — `index.html`이 공개라 `GAS_BACKUP_URL`·`GAS_BACKUP_SECRET`도 공개다.
  누구나 백업 시트에 행을 추가하거나 `action:'delete'`를 보낼 수 있다.
  GAS 웹앱은 오리진 검증이 불가능해 Worker 없이는 고칠 수 없다.
  C의 목표(DB 보호)와 별개 문제이며, 백업 시트가 오염돼도 Supabase 본체는 안전하다
- **변경 주체 추적 불가** — 공유 계정이라 누가 고쳤는지 알 수 없다.
  현재도 동일하며, `member` 필드는 데이터일 뿐 신원이 아니다
- **기기 분실** — 세션이 localStorage에 남는다. 대응은 대시보드에서 비밀번호 변경
  (전 기기 세션 무효화). 쿠키 방식이든 세션 방식이든 동일한 특성이다
- **스키마 분리(#7-2)** — RLS로 격리되면 실익이 크게 줄어든다. 테이블명 충돌은 남지만
  보안 사유는 해소되므로 우선순위를 낮춘다
