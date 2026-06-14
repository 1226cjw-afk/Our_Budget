/**
 * 우리집 가계부 — 구글 시트 백업용 Apps Script (단방향: 앱 → 시트)
 *
 * [배포 방법]
 * 1. 백업할 구글 스프레드시트 열기 → 확장 프로그램 → Apps Script
 * 2. 이 코드 전체를 붙여넣기 (SECRET 값을 index.html의 GAS_BACKUP_SECRET과 동일하게)
 * 3. 배포 → 새 배포(또는 배포 관리 → 편집 → 새 버전) → 유형: 웹 앱
 *    - 실행 계정: 나
 *    - 액세스 권한: "모든 사용자"  ← ★반드시★ (로그인 필요로 두면 앱에서 호출 안 됨)
 * 4. 웹 앱 URL(/exec)을 index.html의 GAS_BACKUP_URL 에 붙여넣기
 *    ※ "배포 관리 → 편집 → 새 버전"으로 재배포하면 URL이 그대로 유지됨
 *
 * [시트 컬럼 순서]  date | amount | type | category | method | account | memo | user | id
 *   - 앞 8개는 기존 시트 형식과 동일
 *   - 마지막 id(uuid)는 수정/삭제를 같은 행에 반영하기 위한 매칭용 (Supabase id)
 */

const SHEET_NAME = '가계부백업';   // 기존 데이터 탭에 합치려면 그 탭 이름으로 변경
const SECRET     = 'ourbudget-backup-2026';  // ← index.html의 GAS_BACKUP_SECRET 과 동일해야 함
const HEADERS    = ['date','amount','type','category','method','account','memo','user','id'];
const ID_COL     = HEADERS.length;  // id 컬럼 위치 (9)

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return _json({ ok: false, error: 'unauthorized' });

    const sh = _sheet();
    if (body.action === 'upsert')      _upsert(sh, body);
    else if (body.action === 'delete') _delete(sh, body.id);
    else return _json({ ok: false, error: 'unknown action' });

    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// 헬스 체크 (브라우저로 URL 열면 확인 가능 — 단, 액세스 권한이 "모든 사용자"여야 보임)
function doGet() {
  return _json({ ok: true, sheet: SHEET_NAME, headers: HEADERS });
}

function _sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  } else if (!sh.getRange(1, ID_COL).getValue()) {
    sh.getRange(1, ID_COL).setValue('id');  // 기존 8컬럼 시트면 id 헤더만 보강
  }
  return sh;
}

// id로 행 번호(2부터) 찾기. 없으면 -1
function _findRow(sh, id) {
  const last = sh.getLastRow();
  if (last < 2 || !id) return -1;
  const ids = sh.getRange(2, ID_COL, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function _upsert(sh, b) {
  // 시트 컬럼 순서에 맞춰 정렬: date, amount, type, category, method, account, memo, user, id
  const rowArr = [
    b.date, b.amount, b.type, b.category,
    b.method || '', b.account || '', b.memo || '', b.member || '', b.id
  ];
  const at = _findRow(sh, b.id);
  if (at > 0) sh.getRange(at, 1, 1, rowArr.length).setValues([rowArr]);  // 수정
  else        sh.appendRow(rowArr);                                       // 신규
}

function _delete(sh, id) {
  const at = _findRow(sh, id);
  if (at > 0) sh.deleteRow(at);
}

function _json(o) {
  return ContentService
    .createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
