# 가계부 디자인 전면 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `public/index.html`을 라이트 기본(OS 다크일 때만 다크)의 무채색 은행형 디자인으로 바꾼다 — 기능·계산·성능 구조는 그대로.

**Architecture:** 단일 HTML 파일 앱이다. `<style>` 블록(42–790행, 324개 셀렉터)을 통째로 재작성해 토큰 2세트를 만들고, `render()`가 조립하는 마크업 함수들을 화면 단위로 옮긴다. 차트는 하드코딩 hex를 버리고 CSS 커스텀 프로퍼티를 읽는다. 테스트 프레임워크가 없으므로 **검증 스크립트가 테스트 역할**을 하며, 신규 검사기를 **먼저** 만들어 현행 파일에 대고 FAIL을 확인한 뒤 구현한다.

**Tech Stack:** 순수 HTML/CSS/JS 단일 파일 · Pretendard Variable (dynamic-subset) · Chart.js (지연 로드) · Node 24 (검증 스크립트) · Edge + CDP (렌더 검증)

**Spec:** `docs/superpowers/specs/2026-08-24-light-redesign-design.md`

## Global Constraints

스펙에서 그대로 옮긴 값이다. **모든 Task에 암묵적으로 적용된다.**

- **토큰 12개** — 라이트: `--bg:#FFFFFF` `--fill:#F4F4F2` `--fill-2:#EAEAE7` `--ink:#14161A` `--ink-2:#5A6068` `--ink-3:#8A9099` `--line:#E4E5E7` `--line-2:#CFD2D6` `--exp:#C0392B` `--inc:#0F6B4F` `--warn:#9A5B14` `--on-ink:#FFFFFF`
- **토큰 12개** — 다크: `--bg:#101215` `--fill:#1E2126` `--fill-2:#262A30` `--ink:#E9EBEE` `--ink-2:#A2A8B0` `--ink-3:#767D86` `--line:#272B31` `--line-2:#373C44` `--exp:#FF7A6B` `--inc:#4FCB96` `--warn:#D9A054` `--on-ink:#101215`
- **차트 슬롯 6개** — 라이트 `--s1:#2a78d6` `--s2:#eb6834` `--s3:#1baf7a` `--s4:#eda100` `--s5:#e87ba4` `--s6:#4a3aa7` / 다크 `--s1:#3987e5` `--s2:#d95926` `--s3:#199e70` `--s4:#c98500` `--s5:#d55181` `--s6:#9085e9`
- **다크는 `@media (prefers-color-scheme: dark)` 안에만.** 수동 토글을 만들지 않는다.
- **금지 패턴 (0건이어야 함):** `backdrop-filter` · `background-clip:text` · `font-weight:900` · `text-transform:uppercase` · `<style>` 안의 `linear-gradient`/`radial-gradient`
- **radius:** 리스트 행 `0` / 입력·칩·버튼 `8px` / 하단 시트 `14px 14px 0 0` / FAB `10px`
- **그림자:** FAB `0 2px 8px rgba(0,0,0,.14)` 와 하단 시트 1단계뿐. 그 외 0.
- **타이포:** 최대 굵기 700. `font-variant-numeric: tabular-nums` 유지.
- **불변 (건드리면 안 됨):** `<head>` 네트워크 태그 순서 · `chart.js` 지연 로드(`ensureChart`) · `DOMContentLoaded` 시작점 · 로그인 게이트 배선 · `armListMore()` 호출 지점 · `dayGroupHtml`의 날짜 그룹 단위 청킹 · `esc()`/`jsq()` 이스케이프
- **커밋:** 각 Task 끝에서 1회. 메시지는 이 리포 관례대로 `타입: 한글 요약`.
- **push 금지** — Task 10에서 사용자 확인 후에만. push하면 Cloudflare가 자동 배포한다.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `public/index.html` | 앱 전체. `<style>`(42–790) · 정적 마크업(792–942) · JS(943–3019) | 수정 |
| `scripts/check_theme.js` | 테마 토큰·금지 패턴·고아 클래스·차트 규칙을 **구조**로 검사 | 신규 |
| `scripts/shot_theme.js` | Edge+CDP로 라이트/다크 6탭 캡처 + `getComputedStyle` 대비 실측 | 신규 |
| `CLAUDE.md` | 디자인 토큰·색 예산·금지 패턴·새 스크립트 기록 | 수정 |

단일 파일 앱이라는 기존 구조는 유지한다. 파일을 쪼개면 배포 산출물이 바뀌고 `check_live.js`의 해시 대조가 무의미해진다.

---

### Task 1: 테마 검사기 (`check_theme.js`)

먼저 만든다. **현행 파일에 대고 FAIL이 나야** 검사기가 실제로 동작하는 것이다.

**Files:**
- Create: `scripts/check_theme.js`

**Interfaces:**
- Consumes: 없음
- Produces: `node scripts/check_theme.js` → 전부 통과 시 exit 0 + `ALL PASS`, 하나라도 실패 시 exit 1 + 실패 목록. 이후 모든 Task가 이 명령으로 자기 작업을 확인한다.

- [ ] **Step 1: 검사기를 작성한다**

`__dirname` 기준으로 `../public/index.html`을 읽는다(어느 폴더에서 실행해도 동작해야 함 — CLAUDE.md 관례).

검사 6종:

```js
// scripts/check_theme.js
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "..", "public", "index.html");
const html = fs.readFileSync(SRC, "utf8");
const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];

const fails = [];
const ok = [];
const check = (name, cond, detail) => (cond ? ok : fails).push(name + (cond ? "" : "  — " + detail));

// ── 1. :root 에 라이트 토큰 12개가 정의됐는가
const LIGHT = {
  "--bg": "#FFFFFF", "--fill": "#F4F4F2", "--fill-2": "#EAEAE7",
  "--ink": "#14161A", "--ink-2": "#5A6068", "--ink-3": "#8A9099",
  "--line": "#E4E5E7", "--line-2": "#CFD2D6",
  "--exp": "#C0392B", "--inc": "#0F6B4F", "--warn": "#9A5B14", "--on-ink": "#FFFFFF",
};
// :root{...} 중 @media 밖의 첫 블록
const rootBlock = (style.match(/(^|\n)\s*:root\s*\{([\s\S]*?)\}/) || [, , ""])[2];
const missLight = Object.entries(LIGHT).filter(
  ([k, v]) => !new RegExp(k + "\\s*:\\s*" + v + "\\s*;", "i").test(rootBlock)
).map(([k]) => k);
check("라이트 토큰 12개", missLight.length === 0, "누락/불일치: " + missLight.join(", "));

// ── 2. 다크 값이 prefers-color-scheme 안에만 있는가
const DARK = {
  "--bg": "#101215", "--fill": "#1E2126", "--fill-2": "#262A30",
  "--ink": "#E9EBEE", "--ink-2": "#A2A8B0", "--ink-3": "#767D86",
  "--line": "#272B31", "--line-2": "#373C44",
  "--exp": "#FF7A6B", "--inc": "#4FCB96", "--warn": "#D9A054", "--on-ink": "#101215",
};
const darkMedia = (style.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\s*\}\s*\n/) || [, ""])[1];
const missDark = Object.entries(DARK).filter(
  ([k, v]) => !new RegExp(k + "\\s*:\\s*" + v + "\\s*;", "i").test(darkMedia)
).map(([k]) => k);
check("다크 토큰 12개 (미디어쿼리 안)", missDark.length === 0, "누락/불일치: " + missDark.join(", "));
check("수동 테마 토글 없음",
  !/data-theme|\[data-theme|localStorage\s*\[\s*["'][^"']*theme/i.test(html),
  "data-theme 또는 theme localStorage 흔적이 있다");

// ── 3. 금지 패턴 0건
const BANNED = [
  ["backdrop-filter", /backdrop-filter\s*:/g],
  ["background-clip:text", /background-clip\s*:\s*text/g],
  ["font-weight:900", /font-weight\s*:\s*900/g],
  ["text-transform:uppercase", /text-transform\s*:\s*uppercase/g],
  ["linear-gradient", /linear-gradient\(/g],
  ["radial-gradient", /radial-gradient\(/g],
];
for (const [name, re] of BANNED) {
  const n = (style.match(re) || []).length;
  check("금지: " + name, n === 0, n + "건 남아 있음");
}

// ── 4. :root 블록 바깥에 생 hex 가 없는가 (토큰 우회 방지)
const styleNoRoot = style
  .replace(/(^|\n)\s*:root\s*\{[\s\S]*?\}/, "")
  .replace(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?\n\s*\}\s*\n/, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");            // 주석 속 hex 는 오탐
const strayHex = [...new Set(styleNoRoot.match(/#[0-9a-fA-F]{3,8}\b/g) || [])];
check("토큰 밖 생 hex 없음", strayHex.length === 0, strayHex.join(" "));

// ── 5. 마크업이 참조하는 class 가 전부 <style> 에 정의됐는가 (고아 클래스)
//     정적 <body> + JS 템플릿 문자열의 class="..." 를 모두 수집한다.
const used = new Set();
for (const m of html.matchAll(/class="([^"$`]*)"/g)) {
  m[1].split(/\s+/).filter(Boolean).forEach(c => used.add(c));
}
const defined = new Set((style.match(/\.[-_a-zA-Z][-_a-zA-Z0-9]*/g) || []).map(s => s.slice(1)));
const orphans = [...used].filter(c => !defined.has(c)).sort();
check("고아 class 없음", orphans.length === 0, orphans.join(" "));

// ── 6. 차트 규칙 — 색 순환 없음 + 계열 상한 6 + 테마 연동
const js = html.slice(html.lastIndexOf("<script>"));
check("catColor 에 % 순환 없음",
  !/CAT_PALETTE\s*\[\s*\w+\s*%/.test(js),
  "팔레트 인덱스를 % 로 감고 있다 (dataviz: 색을 순환시키지 말 것)");
check("차트 계열 상한 5+기타", /const\s+TOPN\s*=\s*5\b/.test(js), "TOPN 이 5 가 아니다");
check("도넛에 상한 적용", /donut\s*:\s*donutArr/.test(js), "도넛이 여전히 curCatArr 전량을 넘긴다");
check("차트가 CSS 변수를 읽음",
  /getPropertyValue\(\s*["']--s1["']\s*\)/.test(js) || /cssVar\(\s*["']--s1["']\s*\)/.test(js),
  "차트 색이 여전히 하드코딩이다");
check("이중 축 제거", !/yInc\s*:/.test(js), "보조축 yInc 가 남아 있다");
check("테마 전환 리스너", /matchMedia\(\s*["']\(prefers-color-scheme:\s*dark\)["']\s*\)/.test(js),
  "OS 테마가 바뀌어도 차트가 다시 안 그려진다");

// ── 결과
ok.forEach(s => console.log("  PASS  " + s));
fails.forEach(s => console.log("  FAIL  " + s));
console.log(fails.length ? "\n" + fails.length + " FAILED" : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: 현행 파일에 대고 실행해 FAIL을 확인한다**

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/check_theme.js`
Expected: **exit 1**. 라이트 토큰 12개 누락, `backdrop-filter`·`linear-gradient`·`radial-gradient`·`font-weight:900`·`text-transform:uppercase` 다수, `catColor` 순환, `yInc` 존재 등으로 FAIL이 대량 출력돼야 한다.

만약 여기서 PASS가 나오면 **검사기가 잘못된 것이다** — 정규식이 아무것도 못 잡고 있다는 뜻이므로 고칠 것. (`check_authgate.js`가 문자열 앵커라 주석에만 남아도 우연히 통과한 전례가 있다.)

- [ ] **Step 3: 커밋**

```bash
git add scripts/check_theme.js
git commit -m "test: 테마 구조 검사기 — 토큰·금지패턴·고아클래스·차트규칙"
```

---

### Task 2: `<style>` 전면 재작성 + `<head>` 메타·파비콘

**Files:**
- Modify: `public/index.html:7` (theme-color), `:10` (status-bar-style), `:30` (SVG 파비콘), `:42-790` (`<style>` 전체)

**Interfaces:**
- Consumes: Task 1의 `check_theme.js`
- Produces: 324개 셀렉터를 커버하는 새 `<style>`. 이후 Task 3–8은 여기 정의된 클래스만 쓴다. 새 클래스가 필요하면 그 Task에서 `<style>`에 함께 추가한다.

- [ ] **Step 1: 현행 셀렉터 인벤토리를 뽑아둔다**

```bash
cd C:/Users/1226c/Projects/Our_Budget
sed -n '42,790p' public/index.html \
 | grep -oE '^[[:space:]]*[.#a-zA-Z][^{}/]*\{' | sed 's/{$//' \
 | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' \
 | sort -u > /tmp/sel_old.txt
wc -l < /tmp/sel_old.txt   # 324
```

- [ ] **Step 2: `<style>` 블록을 통째로 재작성한다**

⚠️ **Edit 도구로 부분 치환하지 말 것.** CLAUDE.md 기록: *"Edit 도구는 old_string에 BOM 등 특수문자가 있으면 이스케이프 치환을 시도하다 new_string의 한글을 `\uXXXX` 리터럴로 망가뜨린다."* 한글 주석이 촘촘한 블록이다. **Write 도구로 파일 전체를 재작성**하거나, `<style>`…`</style>` 구간만 교체하는 Node 스크립트를 Write로 만들어 실행한다.

작성 순서:
1. `:root` — 라이트 토큰 12개 + 차트 슬롯 6개 (Global Constraints의 값 그대로)
2. `@media (prefers-color-scheme: dark)` — 같은 이름 재정의 (다크 값 12 + 6)
3. `html` / `body` — `background:var(--bg); color:var(--ink)`, Pretendard 스택 유지, `tabular-nums` 유지
4. **`body::before` 삭제** (앰비언트 광원)
5. 나머지 컴포넌트를 스펙 §4·§5·§6 규칙대로. `/tmp/sel_old.txt`의 셀렉터를 순회하며 빠뜨리지 않는다

색은 전부 `var(--토큰)`으로. 반투명이 필요하면 토큰을 추가하지 말고 `color-mix(in srgb, var(--ink) 8%, transparent)`를 쓴다(생 hex 금지 검사에 걸리지 않으면서 토큰을 따라간다).

- [ ] **Step 3: `<head>` 메타·파비콘을 고친다**

```html
<!-- 7행 → theme-color 를 라이트/다크 2개로 -->
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101215" media="(prefers-color-scheme: dark)">
<!-- 10행 -->
<meta name="apple-mobile-web-app-status-bar-style" content="default">
```

30행 SVG 파비콘의 data URI를 잉크-온-화이트로 교체한다(`<defs><linearGradient>` 제거, 단색 `#14161A` 배경 + `#FFFFFF` `₩`).

⚠️ 31행 `apple-touch-icon`(base64 26KB 한 줄)은 **이 Task에서 건드리지 않는다** — Task 10에서 재생성한다. 지금은 위치만 유지한다(네트워크 태그보다 뒤).

- [ ] **Step 4: 셀렉터 누락을 확인한다**

```bash
sed -n '42,790p' public/index.html \
 | grep -oE '^[[:space:]]*[.#a-zA-Z][^{}/]*\{' | sed 's/{$//' \
 | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' \
 | sort -u > /tmp/sel_new.txt
comm -23 /tmp/sel_old.txt /tmp/sel_new.txt   # 사라진 셀렉터
```

의도적으로 없앤 것(`.acct-tot::after`, `.hd-t`의 그라디언트 등)만 나와야 한다. 예상 밖의 이름이 나오면 스타일이 통째로 빠진 요소가 생긴 것이다.

- [ ] **Step 5: 검사기와 문법 검사를 돌린다**

Run:
```bash
node C:/Users/1226c/Projects/Our_Budget/scripts/check_theme.js
node -e "const fs=require('fs');const c=[...fs.readFileSync('public/index.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];try{new Function(c);console.log('JS OK')}catch(e){console.error(e.message);process.exit(1)}"
```
Expected: `check_theme.js`의 검사 1·2·3·4는 **PASS**. 5(고아 class)와 6(차트)은 아직 FAIL이어도 된다 — Task 3–8, 7에서 각각 해결한다. `JS OK` 출력.

- [ ] **Step 6: 커밋**

```bash
git add public/index.html
git commit -m "style: 디자인 토큰 2세트 + 스타일 전면 재작성 — 라이트 기본"
```

---

### Task 3: 공통 크롬 — 헤더 · 탭바 · 필 · FAB · 배너

**Files:**
- Modify: `public/index.html` — 정적 마크업 792–942행 중 헤더/네비/FAB, `buildNav()` (1621), `pills()` (1050), `segBtns()` (1051), `filterBar()` (1733), `memberBar()` (1749), `warnBanner()` (1708)

**Interfaces:**
- Consumes: Task 2의 `.hd` `.logo` `.nav` `.tab` `.pill` `.fab` 클래스
- Produces: `pills(items, cur, fn)` · `segBtns(items, cur, fn)` 시그니처 **불변**. 반환 HTML의 클래스만 바뀐다. Task 4–8이 이 두 헬퍼를 그대로 호출한다.

- [ ] **Step 1: 헤더 마크업을 고친다**

`.logo-s`(그라디언트+glow+`::after` 하이라이트) → `.logo`(솔리드 `--ink` 정사각 + 흰 `₩`).
`.hd-t`의 `background-clip:text` 제거 — Task 2에서 CSS는 이미 빠졌으므로 마크업은 그대로 두면 된다.
`#hdUserName` span은 **유지**한다 — CLAUDE.md: *"칩 innerHTML을 통째로 덮으면 SVG 아이콘이 사라지므로 금지."*

- [ ] **Step 2: 탭바 선택 표시를 바꾼다**

`buildNav()`가 만드는 `.tab.on`의 표현을 골드 알약(`.tab-ic` 배경)에서 **`--ink` 아이콘 + 상단 2px 인디케이터**로. `TABS` 상수의 SVG는 **건드리지 않는다**.

- [ ] **Step 3: 필·세그먼트·배너를 정리한다**

`pills()`/`segBtns()`는 클래스만 새 규칙에 맞춘다. `jsq()`/`esc()` 호출을 **그대로 유지**한다.
`warnBanner()`의 `.warn-card`는 채도 낮춘 경고색 + 1px 테두리.

- [ ] **Step 4: 렌더해서 확인한다**

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/check_theme.js`
Expected: 고아 class 목록이 Step 1 이전보다 **줄어들어야** 한다(헤더·탭바 관련 이름이 사라짐).

Run: 위 JS 문법 검사 1줄 → `JS OK`

- [ ] **Step 5: 커밋**

```bash
git add public/index.html
git commit -m "style: 헤더·탭바·필·FAB — 블러와 골드 알약 제거"
```

---

### Task 4: 내역 탭

**Files:**
- Modify: `public/index.html` — `viewList()` (1754), `dayGroupHtml()` (1774), `listChunkHtml()` (1790), `listMoreHtml()` (1799), `listResultsHtml()` (1825), `scoped()` 주변 요약 카드

**Interfaces:**
- Consumes: Task 3의 `pills()`, Task 2의 `.item` `.i-ic` `.i-sub` `.sum` 클래스
- Produces: `dayGroupHtml(date, dr)` → 날짜 헤더 1개 + 행 N개 HTML **(시그니처·반환 계약 불변)**. `listChunkHtml()`/`growList()`/`armListMore()`의 호출 관계 불변.

- [ ] **Step 1: 행 마크업을 룰선 리스트로 바꾼다**

`.item` 카드 박스 → `border-bottom` 행. `.i-ic` 46px → 34px.
칩 3개(`.chips`/`.chip`) → **가운뎃점으로 이은 한 줄**(`결제수단 · 멤버 · 메모`).
이동 leg의 `출금·이동`/`입금·이동` 배지만 `.trf` 색 강조로 남긴다(`isTransfer(r)` 판정 그대로).

⚠️ 메모·계좌명·멤버명은 전부 `esc()`를 거쳐야 한다. 지금 코드에 있는 `esc()` 호출을 새 문자열로 **옮겨 붙인다**. `onclick="editEntry('…')"` 인자는 `jsq()`.

- [ ] **Step 2: 요약 2칸과 주기 네비를 바꾼다**

`.cards`의 카드 2장 → `.sum` 세로 룰선 2칸. 수입은 `--inc`, 지출은 `--exp`.
`movePeriod()`/`resetPeriod()` 호출은 그대로, 감싸는 마크업만 위아래 룰선 한 줄로.

- [ ] **Step 3: 점진 렌더링 배선이 살아 있는지 확인한다**

```bash
grep -n "armListMore()" public/index.html
```
Expected: **2곳 이상** — `render()`의 `after` 훅과 `setSearch`의 부분 갱신. 하나라도 사라졌으면 '전체' 필에서 스크롤이 멈춘다.

```bash
grep -n "LIST_CHUNK\|LIST_G\|LIST_I" public/index.html | head
```
Expected: 청킹 상수·상태가 그대로 있고 `dayGroupHtml`이 **그룹 단위**로 호출된다.

- [ ] **Step 4: 검사기 + 문법 검사**

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/check_theme.js` → 고아 class 추가 감소
Run: JS 문법 검사 1줄 → `JS OK`

- [ ] **Step 5: 커밋**

```bash
git add public/index.html
git commit -m "style: 내역 탭 — 카드 박스를 룰선 리스트로"
```

---

### Task 5: 분류 탭 · 한도 탭

**Files:**
- Modify: `public/index.html` — `catCard()` (1848), `viewCategory()` (1862), `viewLimit()` (1886)

**Interfaces:**
- Consumes: Task 3의 `pills()`, Task 2의 `.crow` `.trk` `.lrow` `.l-b` 클래스
- Produces: `catCard(cat, v, pct, drill)` 시그니처 불변 — `drillTo()`로 가는 클릭 배선을 Task 4의 내역 탭이 받는다.

- [ ] **Step 1: 분류 카드를 룰선 행으로**

항목명 + 금액 한 줄, 아래 3px 막대(`--ink-2`) + 퍼센트.
`.c-bd` 초록/빨강 배지는 **제거**하고 증감을 텍스트로 낸다(액센트 무채색 원칙).
`drillTo(q)` 호출과 '미지정' 카드 비활성은 **그대로**.

- [ ] **Step 2: 한도 행을 바꾼다**

진행바 5px, 트랙 `--fill-2`. 바 색: 정상 `--ink-2` / 임박 `--warn` / 초과 `--exp` — **그라디언트 제거**.
`WARN_TH` 임계값 비교 로직은 손대지 않는다.

⚠️ 카테고리 목록은 계속 `MASTER[멤버].categories` + 기존 저장 한도 기준이다. 지출 발생 카테고리(`spent`)로 바꾸면 '계좌간 이동'까지 한도 UI에 뜬다.

- [ ] **Step 3: 검사 + 커밋**

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/check_theme.js` · JS 문법 검사

```bash
git add public/index.html
git commit -m "style: 분류·한도 탭 — 룰선 행 + 무채색 진행바"
```

---

### Task 6: 계좌 탭

**Files:**
- Modify: `public/index.html` — `viewAccount()` (2717)

**Interfaces:**
- Consumes: Task 2의 `.tot` `.arow` 클래스
- Produces: 없음(말단 화면)

- [ ] **Step 1: 골드 총자산 카드를 걷어낸다**

`.acct-tot`의 **그라디언트 배경 · `::before` 원형 하이라이트 · `::after` 6rem `₩` 워터마크 · 컬러 그림자를 전부 삭제**하고,
라벨(`--ink-3`, 0.6875rem) + 큰 숫자(2.125rem/700/-0.045em) + 하단 `--line-2` 룰선으로 바꾼다.
수입·지출은 그 아래 작은 2칸.

- [ ] **Step 2: 계좌 카드를 룰선 행으로**

이름 + 소유자(`--ink-3`) 좌측, 잔액 우측 정렬.

⚠️ **이원화를 유지한다**: 계좌별 잔액은 **이동 포함**, 상단 총수입·총지출은 **이동 제외**(`!isTransfer(r)`) + '계좌간 이동 제외' 캡션.
`orphanBanner()`(짝 없는 이동 leg 경고)는 그대로 상단에 남긴다.

- [ ] **Step 3: 검사 + 커밋**

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/check_theme.js` · JS 문법 검사

```bash
git add public/index.html
git commit -m "style: 계좌 탭 — 골드 그라디언트 카드와 워터마크 제거"
```

---

### Task 7: 분석 탭 + 차트

가장 위험한 Task다. 색·구조·테마 연동이 한꺼번에 바뀐다.

**Files:**
- Modify: `public/index.html` — `CAT_PALETTE` (1082), `catColor()` (1094), `viewAnalysis()` (1960), `drawAnalysisCharts()` (2163), `drawTaxChart()` (2629), `TY_COLOR` (960)

**Interfaces:**
- Consumes: Task 2의 `--s1`…`--s6` CSS 변수
- Produces:
  - `cssVar(name)` → `string` — `getComputedStyle(document.documentElement).getPropertyValue(name).trim()`
  - `catColor(cat)` → `string` — 상위 5에 들면 해당 슬롯 색, 아니면 `--ink-3`
  - `_anStash.donut` → `[[cat, amt], …]` **상위 5 + `["기타", 합]`**
  - `_anStash.stackSeries` → `[{cat, data:[…]}, …]` 최대 6개(상위 5 + 기타)

- [ ] **Step 1: `cssVar()` 헬퍼와 색 배정을 다시 짠다**

```js
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// 차트에 색을 받는 카테고리 — viewAnalysis 가 표시 주기 전체합으로 계산해 채운다.
// 상위 5개만 슬롯 1–5를 받고 나머지는 전부 '기타'(무채색)로 접힌다.
// ⚠️ 옛 CAT_PALETTE[i % 12] 순환을 되살리지 말 것 — 안전한 색은 6개뿐이라
//    순환시키면 같은 차트 안에서 서로 다른 카테고리가 같은 색이 된다.
let _catSlots = {};                     // { 카테고리: 1..5 }
function setCatSlots(rankedCats){
  _catSlots = {};
  rankedCats.slice(0, 5).forEach((c, i) => { _catSlots[c] = i + 1; });
}
function catColor(c){
  const s = _catSlots[String(c)];
  return s ? cssVar("--s" + s) : cssVar("--ink-3");
}
```

`CAT_PALETTE` 상수와 `_catOrder`/`rebuildCatOrder()`의 **색 배정 용도**는 삭제한다.
⚠️ `rebuildCatOrder()` 자체를 지우지 말 것 — `loadAll()` 끝에서 호출되고 다른 곳에서 쓰일 수 있으니, 호출부와 함께 확인한 뒤 정리한다.

- [ ] **Step 2: `viewAnalysis()`에서 계열 상한을 통일한다**

`catTotals`(표시 주기 전체합 내림차순)를 하나의 기준으로 삼는다:

```js
const TOPN = 5;                                  // 6 → 5 (기타까지 합쳐 6슬롯)
const topCatNames = catTotals.slice(0, TOPN).map(([c]) => c);
setCatSlots(topCatNames);                        // 도넛·막대·라인이 이 매핑을 공유

const stackSeries = topCatNames.map(c => ({cat:c, data:catByPeriod[c]}));
if(catTotals.length > TOPN){
  const etc = Array(periods.length).fill(0);
  catTotals.slice(TOPN).forEach(([c]) => catByPeriod[c].forEach((v,i) => etc[i] += v));
  stackSeries.push({cat:"기타", data:etc});
}

// 도넛도 같은 상한을 받는다 — 지금은 curCatArr 전량이 넘어가 슬라이스가 20개까지 생긴다
const donutTop = curCatArr.filter(([c]) => _catSlots[c]);
const donutEtc = curCatArr.filter(([c]) => !_catSlots[c]).reduce((s,[,a]) => s+a, 0);
const donutArr = donutEtc > 0 ? [...donutTop, ["기타", donutEtc]] : donutTop;

// 추이 라인도 같은 5개로
const trend = topCatNames.map(c => ({cat:c, data: rowsByPeriod.map(rs => expOf(rs.filter(r=>r.category===c)))}));

_anStash = {labels, period, incomeByPeriod, stackSeries, donut:donutArr, totExp, trend};
```

- [ ] **Step 3: 이중 축을 제거한다**

`drawAnalysisCharts()`에서 `yInc` 축 정의와 수입 데이터셋을 **삭제**한다. 막대는 카테고리 스택 지출만 남는다.
`incomeByPeriod`는 계속 계산하되 요약 스탯 텍스트로만 쓴다 — 이미 `.astat` 영역이 있으므로 거기 붙인다.

- [ ] **Step 4: 하드코딩 hex를 CSS 변수로 바꾼다**

`drawAnalysisCharts()`(2166) · `drawTaxChart()`(2633)의 `tickC`/`gridC`/`subC`, 도넛 `borderColor:"#0E1020"`, `TY_COLOR`(960)를 전부 교체:

```js
const tickC = cssVar("--ink-2"), gridC = cssVar("--line"), subC = cssVar("--ink-3");
// 도넛 세그먼트 사이 2px 서피스 갭 — 배경색을 읽어야 테마를 따라간다
borderColor: cssVar("--bg"), borderWidth: 2,
// 연말정산 3색
const TY_COLOR = () => ({credit: cssVar("--s2"), check: cssVar("--s1"), cash: cssVar("--s4")});
```

⚠️ `TY_COLOR`가 상수 객체에서 함수로 바뀐다. **호출부를 전부 찾아 고칠 것**: `grep -n "TY_COLOR" public/index.html`

- [ ] **Step 5: OS 테마 전환에 반응시킨다**

```js
// OS 다크모드를 켜고 끄면 차트가 옛 색으로 남는다 — 분석 탭일 때만 다시 그린다.
// ⚠️ drawWhenChartReady 의 _renderSeq 대조 규약을 그대로 통과해야 한다.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if(tab === "analysis") render();
});
```

- [ ] **Step 6: 패널 마크업을 섹션으로**

`.panel` 테두리 박스 → 섹션 제목 + `--line-2` 아래줄. `.p-t::before` 골드 막대 제거.
인사이트(`.ins`)·이상치(`.anom`) 행 구조는 유지, 웰만 `--fill`.

⚠️ `destroyCharts()`가 `render()` 첫 줄에서 계속 호출되는지 확인한다 — 빠지면 차트 인스턴스가 샌다.

- [ ] **Step 7: 검사기를 돌린다**

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/check_theme.js`
Expected: 검사 6(차트 규칙) 5개 항목이 전부 **PASS**.

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/test_lazy_chart.js`
Expected: PASS — chart.js 지연 로드 배선과 `<head>` 순서가 깨지지 않았는가.

Run: JS 문법 검사 1줄 → `JS OK`

- [ ] **Step 8: 커밋**

```bash
git add public/index.html
git commit -m "style: 분석 탭 — 검증된 6색 팔레트, 색 순환·이중 축 제거"
```

---

### Task 8: 설정 탭 · 입력 시트 · 피커 · 로그인

**Files:**
- Modify: `public/index.html` — `viewMaster()` (2742), 정적 입력 시트 마크업(792–942), `openPicker()` 주변, `showAuth()` (1198)

**Interfaces:**
- Consumes: Task 2의 `.inp` `.sel-btn` `.tg` `.picker-sht` `.auth-card` 클래스
- Produces: 없음(말단 화면)

- [ ] **Step 1: 설정 탭을 룰선 목록으로**

`.m-section` 카드 → 섹션 제목 + 룰선 목록. `.m-item`·`.set-row`는 이미 룰선 구조라 색만 바뀐다.
연말정산 매핑 셀렉트는 **`taxSelect()`/`tyAmtLabel()` 공용 빌더를 계속 쓴다** — 인라인으로 복붙하면 4곳 중 하나를 빠뜨린다.

- [ ] **Step 2: 입력 시트·피커**

`.inp`/`.sel-btn`/`.set-in`: `--line-2` 테두리, radius 8px, 포커스는 `--ink` 테두리 + 무채색 링.
`.tg` 토글: 채도 낮춘 배경 + 의미색 테두리(지출 `--exp` / 입금 `--inc` / 이동 `--s1`).
`.picker-sht`: 오버레이 `rgba(0,0,0,.45)`, 시트 배경 `--bg`, radius `14px 14px 0 0`.

⚠️ 유지할 것: `.picker-sht`의 `dvh` 높이(vh 금지 — 모바일 툴바에 잘림) · `padding-bottom:env(safe-area-inset-bottom)` · `body.sheet-open{overflow:hidden}` · `.overlay`의 `overscroll-behavior:contain`.

- [ ] **Step 3: 로그인 오버레이**

`.auth-card`/`.auth-btn`을 잉크 버튼으로.

⚠️ **배선은 불변**: `showAuth`/`hideAuth`, `.auth-ov`를 ESC 핸들러에 넣지 않는 것(닫히면 게이트가 아니다), 숨김 username input을 `display:none`이 아니라 화면 밖으로 보내는 것(비밀번호 관리자 인식).

- [ ] **Step 4: 게이트 배선 검사**

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/check_authgate.js`
Expected: PASS

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/check_theme.js`
Expected: **ALL PASS** — 이 시점에 고아 class가 0이어야 한다.

Run: JS 문법 검사 1줄 → `JS OK`

- [ ] **Step 5: 커밋**

```bash
git add public/index.html
git commit -m "style: 설정·입력시트·피커·로그인 — 무채색 폼"
```

---

### Task 9: 렌더 검증 (`shot_theme.js`) + 회귀

**Files:**
- Create: `scripts/shot_theme.js`

**Interfaces:**
- Consumes: 완성된 `public/index.html`
- Produces: `node scripts/shot_theme.js` → 12장 PNG(6탭 × 라이트/다크) + 대비 실측 표를 stdout에

- [ ] **Step 1: 캡처·실측 스크립트를 만든다**

`docs/superpowers/2026-08-24-light-redesign-mockup.html`을 찍을 때 쓴 방식 그대로:
Edge 헤드리스 + CDP, `Emulation.setDeviceMetricsOverride`(390×844, dSF 2)로 폭을 잡고
(⚠️ `chrome --headless`의 `--window-size`는 뷰포트 *폭*에 안 먹는다), `Emulation.setEmulatedMedia`로 라이트/다크 전환,
`Page.captureScreenshot`에 `captureBeyondViewport:true`.

⚠️ `position:fixed`인 탭바·FAB는 풀페이지 캡처에서 뷰포트 위치에 박혀 본문을 가린다 → 캡처 직전에 `Runtime.evaluate`로 `position:absolute`로 바꾼다.

실데이터가 필요하므로 CLAUDE.md의 **mock 주입 방식**을 쓴다:
mock은 반드시 `<head>` 인라인 `<script>`에서 `document.addEventListener('DOMContentLoaded', 주입)`으로 걸 것 —
supabase CDN이 `defer`라 인라인보다 나중에 실행돼 `window.supabase`를 덮어쓴다.
⚠️ **`dispatchEvent`로 저장 함수를 발화시키지 말 것** — 실서비스 DB에 그대로 쓴다(테스트 DB 없음, 가족 실데이터).

같은 세션에서 대비를 실측한다:

```js
// 실제 렌더된 색으로 재는 것이 스펙 표보다 강한 증거다
const expr = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const t = n => cs.getPropertyValue(n).trim();
  return JSON.stringify({bg:t('--bg'), ink:t('--ink'), ink2:t('--ink-2'),
                         ink3:t('--ink-3'), exp:t('--exp'), inc:t('--inc')});
})()`;
```

회수한 값으로 WCAG 대비를 계산해 스펙 §3 표와 대조한다(라이트 `--ink` 18.11:1 / 다크 15.71:1 등).

- [ ] **Step 2: 실행하고 눈으로 본다**

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/shot_theme.js`
Expected: 12장 생성 + 대비 표가 스펙 §3과 일치. **PNG를 실제로 열어본다** — 검사기는 색을 보지만 레이아웃 깨짐·글자 겹침·가로 넘침은 못 잡는다.

가로 넘침 확인:
```js
document.documentElement.scrollWidth > document.documentElement.clientWidth
```
Expected: `false` (6탭 × 2테마 전부)

- [ ] **Step 3: 성능 회귀를 본다**

```bash
node C:/Users/1226c/Projects/Our_Budget/scripts/measure_load.js
node C:/Users/1226c/Projects/Our_Budget/scripts/measure_timeline.js --4g
```
Expected: `measure_load.js` **구조 검사 전부 PASS**(총 바이트 1MB 미만 · Pretendard dynamic-subset · Google Fonts 부재 · chart.js 초기 로딩 부재).

⚠️ **시간은 1회 측정으로 판정하지 않는다.** CLAUDE.md 기록: 같은 파일의 DCL이 CDN 편차만으로 217–1,166ms까지 흔들린다. 개선 전/후를 **교대로** N회씩 돌려 중앙값으로 본다. 기준선은 4G+CPU4배 DCL 1,102ms / FCP 1,128ms / 384KB.

이번 변경은 그라디언트·블러·그림자를 걷어내므로 페인트 비용이 늘 이유는 없다.

- [ ] **Step 4: 커밋**

```bash
git add scripts/shot_theme.js
git commit -m "test: 라이트/다크 렌더 캡처 + 대비 실측 스크립트"
```

---

### Task 10: 홈화면 아이콘 재생성 · 문서 · 배포

**Files:**
- Modify: `public/index.html:31` (apple-touch-icon), `CLAUDE.md`

**Interfaces:**
- Consumes: 완성된 앱
- Produces: 배포된 사이트

- [ ] **Step 1: apple-touch-icon을 재생성한다**

CLAUDE.md의 방법: canvas에 그린 뒤 `toDataURL()`을 `document.body.textContent`로 출력하는 임시 HTML을 Write로 만들고
`chrome --headless=new --dump-dom --virtual-time-budget=4000 file:///<절대경로>`로 덤프해 추출.

잉크 배경(`#14161A`) + 흰 `₩`. **120px로 생성**한다(180px는 ≈57KB, 120px는 ≈26KB — iOS가 확대하게 두는 절충).

- [ ] **Step 2: 바이트가 늘지 않았는지 확인한다**

```bash
node C:/Users/1226c/Projects/Our_Budget/scripts/measure_load.js
```
Expected: 총 바이트가 기준선 384KB 근처. 늘었으면 아이콘을 더 줄인다.

⚠️ 아이콘은 `<head>` 네트워크 태그(preconnect·폰트·supabase-js)보다 **뒤에** 있어야 한다. 앞에 두면 preload 스캐너의 CDN 발견이 26KB 뒤로 밀린다.

Run: `node C:/Users/1226c/Projects/Our_Budget/scripts/test_lazy_chart.js` → `<head>` 순서 PASS

- [ ] **Step 3: CLAUDE.md를 갱신한다**

추가할 것:
- 디자인 토큰 2세트와 **색 예산 3종**(지출/수입/차트 6색) — "액센트는 무채색"의 이유(초록이 '수입'과 '선택됨' 두 뜻이 되는 문제)
- 금지 패턴 목록과 `check_theme.js`가 그걸 지킨다는 것
- 차트 규칙: 계열 상한 5+기타, 색 순환 금지, 이중 축 금지, `cssVar()`로 테마 연동
- 파일 구조 표에 `check_theme.js`·`shot_theme.js` 추가
- 배포 절차의 검증 명령 목록에 `check_theme.js` 추가
- **되돌리지 말 것** 항목: `backdrop-filter`·그라디언트·`font-weight:900`·한글 uppercase

- [ ] **Step 4: 전체 검증을 한 번에 돌린다**

```bash
cd C:/Users/1226c/Projects/Our_Budget
node scripts/check_theme.js      # ALL PASS
node scripts/check_authgate.js   # PASS
node scripts/test_lazy_chart.js  # PASS
node scripts/measure_load.js     # 구조 검사 PASS
node -e "const fs=require('fs');const c=[...fs.readFileSync('public/index.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];try{new Function(c);console.log('JS OK')}catch(e){console.error(e.message);process.exit(1)}"
```

- [ ] **Step 5: 사용자에게 배포 확인을 받는다**

⚠️ **여기서 멈춘다.** push하면 Cloudflare가 자동 배포한다. 스크린샷을 보여주고 승인을 받은 뒤에만 진행한다.

- [ ] **Step 6: 배포하고 도착을 확인한다**

```bash
git add public/index.html CLAUDE.md
git commit -m "style: 홈화면 아이콘·문서 — 디자인 개편 마무리"
git push
node scripts/poll_deploy.js "<이번 변경에만 있는 문자열>"
node scripts/check_live.js
node scripts/check_assets.js
```

⚠️ **상태코드로 판정하지 말 것** — 옛 버전도 200을 준다. `check_live.js`의 sha256 비교가 확정 판정이고, 비교 대상은 작업 사본이 아니라 **커밋된 blob**(`git show origin/main:public/index.html`)이다(Windows 작업 사본은 CRLF).

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 절 | Task |
|---|---|
| §3 토큰 | 2 |
| §4 타이포 | 2 |
| §5 형태 규칙 | 2 |
| §6.1 공통 | 2(메타·파비콘) + 3(헤더·탭바·필·FAB·배너) |
| §6.2 내역 | 4 |
| §6.3 분류 / §6.4 한도 | 5 |
| §6.5 분석 | 7 |
| §6.6 계좌 | 6 |
| §6.7 설정·시트·피커·로그인 | 8 |
| §7.1 팔레트 | 2(CSS 변수) + 7(차트 소비) |
| §7.2 색 배정·상한 | 7 |
| §7.3 이중 축 제거 | 7 |
| §7.4 테마 연동 | 7 |
| §8 구현 방식(Write 전면 재작성) | 2 Step 2 |
| §9 검증 | 1(check_theme) + 9(shot_theme·회귀) + 10(전체) |
| §10 위험 | 2 Step 4(셀렉터 누락) · 4 Step 1/3(esc·armListMore) · 7 Step 6(destroyCharts) |
| §11 산출물 | 2·9·10 |

갭 없음.

**2. 플레이스홀더 스캔** — "TBD"/"적절히"/"에러 처리 추가" 없음. 코드가 필요한 단계엔 실제 코드가 들어 있다.

**3. 타입 일관성** — `cssVar(name)→string`, `setCatSlots(rankedCats)→void`, `catColor(cat)→string`, `_anStash.donut→[[cat,amt],…]`, `_anStash.stackSeries→[{cat,data},…]`. Task 7 안에서 정의·소비가 모두 끝나고 Task 1의 `check_theme.js`가 `donut:donutArr`·`TOPN = 5`·`cssVar("--s1")`·`yInc` 부재를 문자열로 검사한다 — **이름이 어긋나면 검사기가 FAIL을 낸다**(의도한 결합).

⚠️ 한 가지 주의: Task 7에서 `TY_COLOR`가 **상수 객체 → 함수**로 바뀐다. 호출부를 전부 고쳐야 하며 `check_theme.js`는 이걸 잡지 못한다. Task 7 Step 4에 `grep -n "TY_COLOR"` 지시를 명시해 뒀다.
