/**
 * 우리집 가계부 — 구글 시트 백업용 Apps Script (단방향: 앱 → 시트)
 *
 * [배포 방법]
 * 1. 백업할 구글 스프레드시트 열기 → 확장 프로그램 → Apps Script
 * 2. 이 코드 전체를 붙여넣기 (SECRET 값을 index.html의 GAS_BACKUP_SECRET과 동일하게)
 * 3. 배포 → 새 배포 → 유형: 웹 앱
 *    - 실행 계정: 나
 *    - 액세스 권한: "모든 사용자(익명 포함)"  ← 중요
 * 4. 배포 후 나오는 "웹 앱 URL"을 복사 → index.html의 GAS_BACKUP_URL 에 붙여넣기
 * 5. 코드 수정 시 반드시 "배포 관리 → 편집(연필) → 새 버전"으로 재배포해야 반영됨
 */

const SHEET_NAME = '가계부백업';
const SECRET     = 'ourbudget-backup-2026';  // ← index.html의 GAS_BACKUP_SECRET 과 동일해야 함
const HEADERS    = ['id','date','member','type','category','amount','method','account','memo','updated_at'];

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

// 헬스 체크용 (브라우저로 URL 열면 확인 가능)
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
  }
  return sh;
}

// id로 행 번호(2부터) 찾기. 없으면 -1
function _findRow(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function _upsert(sh, b) {
  const rowArr = [
    b.id, b.date, b.member, b.type, b.category,
    b.amount, b.method || '', b.account || '', b.memo || '',
    new Date()
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
