/**
 * 우리집 가계부 — 구글 시트 백업 수신부 (단방향: 앱 → 시트)
 *
 * ※ 이건 "독립 스크립트"가 아니라, 기존 가계부 GAS 프로젝트(Code.gs, doGet으로 구버전 앱 서빙)의
 *   맨 아래에 그대로 추가하는 블록이다. 기존 doGet / 분석 / Gemini 기능에는 영향 없음.
 *
 * [배포]
 * 1. 기존 가계부 Apps Script 프로젝트의 Code.gs 맨 끝에 이 블록 추가
 * 2. 배포 → 배포 관리 → 편집(✏️) → 버전 "새 버전" → 배포   (URL 유지됨)
 *    - 액세스 권한: "모든 사용자"  ← ★반드시★ (로그인 필요로 두면 앱에서 호출 안 됨)
 * 3. 발급된 /exec URL 을 index.html의 GAS_BACKUP_URL 에 넣음 (이미 연결됨)
 *
 * [시트(지출리스트) 컬럼 순서]
 *   date | amount | type | category | method | account | memo | user | id
 *   - 1~7열: 기존 형식 그대로  (getSheet() = '지출리스트')
 *   - 8열 user  : 앱의 member(누가)
 *   - 9열 id    : Supabase uuid — 수정/삭제를 같은 행에 반영하기 위한 매칭용
 *
 * 백업을 기존 데이터와 분리하고 싶으면 _backupUpsert/_backupDelete의 getSheet() 대신
 * ss.getSheetByName('가계부백업') 같은 별도 탭을 쓰면 됨.
 */

const BACKUP_SECRET = 'ourbudget-backup-2026';  // index.html의 GAS_BACKUP_SECRET 과 동일
const BACKUP_ID_COL = 9;                          // id 컬럼 위치 (I열)

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== BACKUP_SECRET) return _backupJson({ ok: false, error: 'unauthorized' });

    const sheet = getSheet();  // 기존 '지출리스트' 시트 재사용
    if (body.action === 'upsert')      _backupUpsert(sheet, body);
    else if (body.action === 'delete') _backupDelete(sheet, body.id);
    else return _backupJson({ ok: false, error: 'unknown action' });

    return _backupJson({ ok: true });
  } catch (err) {
    return _backupJson({ ok: false, error: String(err) });
  }
}

function _backupFindRow(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2 || !id) return -1;
  const ids = sheet.getRange(2, BACKUP_ID_COL, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function _backupUpsert(sheet, b) {
  // 컬럼 순서: date, amount, type, category, method, account, memo, user, id
  const rowArr = [
    b.date, Number(b.amount), b.type, b.category,
    b.method || '', b.account || '', b.memo || '', b.member || '', b.id
  ];
  const at = _backupFindRow(sheet, b.id);
  if (at > 0) sheet.getRange(at, 1, 1, rowArr.length).setValues([rowArr]);  // 수정
  else        sheet.appendRow(rowArr);                                       // 신규
}

function _backupDelete(sheet, id) {
  const at = _backupFindRow(sheet, id);
  if (at > 0) sheet.deleteRow(at);
}

function _backupJson(o) {
  return ContentService
    .createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
