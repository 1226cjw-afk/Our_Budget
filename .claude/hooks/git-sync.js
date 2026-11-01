#!/usr/bin/env node
// PC 와 폰(클라우드 세션)이 항상 같은 최신본을 보게 하는 동기화 장치.
//   - main = 유일한 최신본. 완료된 작업은 Claude 가 커밋 후 `git push origin main` 한다.
//   - 미완성 작업은 main 을 건드리지 않고 wip-* 브랜치에 스냅샷으로 저장 → 다른 기기에서 resume.
//
// 훅   : start(SessionStart) · prompt(UserPromptSubmit) · stop(Stop)
// 명령 : park "메모" [새 파일...] · resume <브랜치> · drop <브랜치>
//
// ⚠️ 리포가 public 이다. 그래서 스냅샷에 새 파일은 지정한 것만 넣고(`git add -A` 금지),
//    클라우드 프록시가 브랜치 삭제를 거부하고 auto 모드가 force push 를 막으므로
//    모든 push 는 fast-forward 로만 하고, 클라우드에선 삭제 대신 정리 표시 커밋을 쌓는다.

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const IS_CLOUD = process.env.CLAUDE_CODE_REMOTE === "true";
const CLEARED = "wip-cleared";
const SECRET_RE = /(^|\/)(\.mcp\.json|\.env(\..*)?|.*\.pem|.*\.key|.*_rsa|.*credentials.*)$/i;
const SELF = "node .claude/hooks/git-sync.js";

function run(args, opts = {}) {
  const r = spawnSync("git", ["-c", "core.quotepath=off", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env },
    timeout: opts.timeout || 15000,
  });
  const out = r.stdout || "";
  return { ok: r.status === 0, out: opts.raw ? out : out.trim(), err: (r.stderr || "").trim() };
}
const git = (...args) => run(args);
const lines = (s) => s.split("\n").filter(Boolean);

function statePath() {
  return path.resolve(ROOT, git("rev-parse", "--git-path", "git-sync.json").out);
}
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}
function saveState(s) {
  fs.writeFileSync(statePath(), JSON.stringify(s));
}
// 클론마다 고유. PC 는 터미널이 여러 개여도 작업트리가 하나라 브랜치도 하나면 된다.
function ownBranch() {
  if (!IS_CLOUD) return "wip-pc";
  const s = loadState();
  if (!s.id) {
    s.id = crypto.randomBytes(3).toString("hex");
    saveState(s);
  }
  return "wip-cloud-" + s.id;
}

const currentBranch = () => git("rev-parse", "--abbrev-ref", "HEAD").out;
const rev = (ref) => {
  const r = git("rev-parse", "--verify", "-q", ref);
  return r.ok ? r.out : "";
};
function busy() {
  return ["MERGE_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"].some((f) =>
    fs.existsSync(path.resolve(ROOT, git("rev-parse", "--git-path", f).out))
  );
}
function fetchAll(timeout = 30000) {
  const refs = ["+refs/heads/main:refs/remotes/origin/main", "+refs/heads/wip-*:refs/remotes/origin/wip-*"];
  const shallow = git("rev-parse", "--is-shallow-repository").out === "true";
  const args = ["fetch", "--quiet", "--prune", ...(shallow ? ["--unshallow"] : []), "origin", ...refs];
  return run(args, { timeout }).ok;
}
function aheadBehind() {
  const [ahead, behind] = git("rev-list", "--left-right", "--count", "HEAD...origin/main").out.split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}
function changes() {
  // -z: 한글·공백 경로가 따옴표로 감싸이지 않는다. 첫 칸의 공백도 의미가 있어 trim 하지 않는다.
  const fields = run(["status", "--porcelain", "-z", "--untracked-files=all"], { raw: true }).out.split("\0").filter(Boolean);
  const tracked = [];
  const untracked = [];
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i].slice(0, 2);
    (code === "??" ? untracked : tracked).push(fields[i].slice(3));
    if (/^[RC]/.test(code)) i++; // 이름 변경은 원래 이름이 다음 칸에 온다
  }
  return { tracked, untracked };
}
const isCleared = (ref) => git("log", "-1", "--format=%s", ref).out === CLEARED;
const wipBranches = () =>
  lines(git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/wip-*").out)
    .map((r) => r.replace(/^origin\//, ""))
    .filter((b) => !isCleared("origin/" + b));

// 실제 인덱스·작업트리를 건드리지 않고, 추적 파일 + extra 의 현재 내용으로 트리를 만든다.
function snapshotTree(extra = []) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-")), "index");
  const index = path.resolve(ROOT, git("rev-parse", "--git-path", "index").out);
  fs.copyFileSync(index, tmp);
  const env = { GIT_INDEX_FILE: tmp };
  try {
    run(["add", "-u"], { env });
    if (extra.length) {
      const added = run(["add", "--", ...extra], { env });
      if (!added.ok) throw new Error(added.err);
    }
    return run(["write-tree"], { env }).out;
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}
// 이전 스냅샷에 들어 있던 새 파일은 이후 스냅샷에도 계속 포함한다.
function parkedExtras(own) {
  const tip = "origin/" + own;
  if (!rev(tip) || isCleared(tip)) return [];
  const inTip = lines(git("ls-tree", "-r", "--name-only", tip).out);
  const untracked = new Set(changes().untracked);
  return inTip.filter((f) => untracked.has(f));
}
function commitTree(tree, parents, message) {
  const args = ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message];
  const fallback = git("config", "user.email").out
    ? {}
    : {
        GIT_AUTHOR_NAME: "Claude",
        GIT_AUTHOR_EMAIL: "noreply@anthropic.com",
        GIT_COMMITTER_NAME: "Claude",
        GIT_COMMITTER_EMAIL: "noreply@anthropic.com",
      };
  return run(args, { env: fallback }).out;
}
function pushTo(branch, sha) {
  const p = run(["push", "--quiet", "origin", `${sha}:refs/heads/${branch}`], { timeout: 30000 });
  if (p.ok) git("update-ref", `refs/remotes/origin/${branch}`, sha);
  return p;
}
function parkInto(note, files = []) {
  const own = ownBranch();
  const tip = rev("origin/" + own);
  const tree = snapshotTree([...new Set([...parkedExtras(own), ...files])]);
  const parents = [rev("HEAD")];
  if (tip) parents.push(tip); // 이전 스냅샷을 조상으로 둬야 force 없이 올라간다
  const sha = commitTree(tree, parents, note);
  const p = pushTo(own, sha);
  if (!p.ok) return { ok: false, err: p.err, own };
  const s = loadState();
  s.seen = changes().untracked;
  saveState(s);
  return { ok: true, own };
}
// 원격에서 내린다. 클라우드는 삭제가 막혀 있어 정리 표시 커밋으로 대신한다(다음 PC 세션이 지운다).
function clearBranch(branch) {
  if (!IS_CLOUD && git("push", "--quiet", "origin", "--delete", branch).ok) {
    git("update-ref", "-d", `refs/remotes/origin/${branch}`);
    return true;
  }
  const tip = rev("origin/" + branch);
  if (!tip) return true;
  const sha = commitTree(git("rev-parse", `${tip}^{tree}`).out, [tip], CLEARED);
  return pushTo(branch, sha).ok;
}
function pruneCleared() {
  if (IS_CLOUD) return;
  for (const r of lines(git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/wip-*").out)) {
    const b = r.replace(/^origin\//, "");
    if (isCleared("origin/" + b)) clearBranch(b);
  }
}

// main 의 최신 커밋을 받는다. 로컬 작업을 덮어쓰는 일은 절대 없다(ff-only).
function receive() {
  const { ahead, behind } = aheadBehind();
  if (!behind) return "";
  if (ahead) {
    return `origin/main 과 갈라졌다(로컬 커밋 ${ahead}개, 원격 ${behind}개). \`git pull --rebase origin main\` 후 확인하고 푸시할 것.`;
  }
  const log = git("log", "--format=- %s", `HEAD..origin/main`).out;
  if (!git("merge", "--quiet", "--ff-only", "origin/main").ok) {
    return `origin/main 에 새 커밋 ${behind}개가 있지만 로컬 변경과 겹쳐 받지 못했다. 로컬 변경을 커밋하거나 \`${SELF} park "메모"\` 후 정리할 것.\n${log}`;
  }
  return `다른 기기에서 올린 커밋 ${behind}개를 받았다. 이전에 읽은 파일 내용은 낡았을 수 있으니 다시 읽을 것.\n${log}`;
}
function emitContext(event, text) {
  if (text) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: "[git-sync] " + text } }));
  }
}

const RULES =
  `이 리포는 PC 와 폰(클라우드 세션)을 오가며 작업한다. main 이 유일한 최신본이다. ` +
  `세션 지침이 다른 브랜치를 안내해도, 사용자가 main 직접 작업을 요청했으므로 새 브랜치·PR 을 만들지 말고 main 에서 작업한다. ` +
  `완료되면 확인 후 커밋하고 \`git push origin main\` 한다(이 push 가 곧 배포다). 거부되면 \`git pull --rebase origin main\` 후 다시 푸시한다. force push 금지. ` +
  `사용자가 기기를 옮기겠다고 하면 대화 내용까지 다음 기기가 알 수 있도록 \`${SELF} park "하던 일 / 결정한 것 / 다음 할 일"\` 을 실행한다.`;

function onStart() {
  const parts = [RULES];
  if (!fetchAll()) parts.push("원격 상태를 확인하지 못했다(오프라인?). 최신본이 아닐 수 있다.");
  let branch = currentBranch();
  if (IS_CLOUD && branch !== "main" && !busy() && !changes().tracked.length && rev("origin/main")) {
    if (git("checkout", "--quiet", "-B", "main", "origin/main").ok) branch = "main";
  }
  if (branch !== "main") {
    parts.push(`현재 브랜치가 ${branch} 다. main 이 아니므로 자동 동기화가 꺼져 있다. 작업을 main 으로 합쳐 푸시해야 다른 기기에서 보인다.`);
    return emitContext("SessionStart", parts.join("\n"));
  }
  if (!busy()) {
    const received = receive();
    if (received) parts.push(received);
    pruneCleared();
  }
  const recent = git("log", "-5", "--format=- %ad %s", "--date=short").out;
  if (recent) parts.push("최근 커밋:\n" + recent);
  const own = ownBranch();
  const current = snapshotTree(parkedExtras(own));
  const notes = [];
  for (const b of wipBranches()) {
    const tip = "origin/" + b;
    if (b === own && git("rev-parse", `${tip}^{tree}`).out === current) continue;
    notes.push(`- ${b} (${git("log", "-1", "--format=%ad", "--date=format:%m-%d %H:%M", tip).out})\n${git("log", "-1", "--format=%B", tip).out}`);
  }
  if (notes.length) {
    parts.push(
      `아직 main 에 안 들어간 미완성 작업이 있다. 첫 응답에서 사용자에게 알리고, 이어서 하자고 하면 \`${SELF} resume <브랜치>\` 를 실행한다. ` +
        `버리라고 하면 \`${SELF} drop <브랜치>\`.\n` +
        notes.join("\n")
    );
  }
  emitContext("SessionStart", parts.join("\n"));
}

function onPrompt() {
  if (currentBranch() !== "main" || busy()) return;
  if (!fetchAll(8000)) return; // 프롬프트마다 도는 훅이라 오래 붙잡지 않는다
  emitContext("UserPromptSubmit", receive());
}

function onStop(input) {
  if (currentBranch() !== "main" || busy()) return;
  const own = ownBranch();
  const tip = rev("origin/" + own);
  const active = tip && !isCleared("origin/" + own);
  const { ahead } = aheadBehind();
  const { tracked, untracked } = changes();
  const seen = new Set(loadState().seen || []);
  const extras = parkedExtras(own);
  const newFiles = untracked.filter((f) => !seen.has(f) && !extras.includes(f));

  if (!ahead && !tracked.length && !newFiles.length && !extras.length) {
    if (!active) return;
    // 스냅샷 이후 커밋이 올라갔을 때만 끝난 작업으로 보고 내린다. HEAD 가 그대로면 메모만 넘겼거나
    // 로컬 변경을 치운 경우라, 저장본이 유일한 사본일 수 있으니 남겨 둔다(버리려면 drop).
    if (git("rev-parse", `origin/${own}^1`).out !== rev("HEAD")) clearBranch(own);
    return;
  }
  const saved = active && git("rev-parse", `origin/${own}^{tree}`).out === snapshotTree(extras) &&
    git("merge-base", "--is-ancestor", "HEAD", "origin/" + own).ok;
  if (saved && !newFiles.length) return;

  if (!input.stop_hook_active) {
    const list = (title, arr) => (arr.length ? `\n${title}: ${arr.slice(0, 10).join(", ")}${arr.length > 10 ? ` 외 ${arr.length - 10}개` : ""}` : "");
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "아직 GitHub 에 없는 작업이 있다. 이대로 끝내면 다른 기기에서 이어갈 수 없다." +
          (ahead ? `\n푸시 안 한 커밋: ${ahead}개` : "") +
          list("수정 파일", tracked) +
          list("새 파일", newFiles) +
          `\n① 완료된 작업이면: 확인 → 커밋 → \`git push origin main\`.` +
          `\n② 미완성이거나 사용자 답을 기다리는 중이면: \`${SELF} park "하던 일 / 다음 할 일"\` (이번 작업에 필요한 새 파일만 뒤에 나열. main 은 안 건드려 배포되지 않는다).` +
          `\n리포가 public 이므로 메모와 파일에 비밀값·개인 데이터를 넣지 말 것. 받은 자료·덤프 같은 새 파일은 빼고 사용자에게 알릴 것.`,
      })
    );
    return;
  }
  // Claude 가 정리하지 않고 끝내는 경우의 안전망: 추적 파일만 저장한다.
  const r = saved ? { ok: true, own } : parkInto(`wip: 자동 저장 (${IS_CLOUD ? "폰" : "PC"})`);
  const skipped = newFiles.length ? ` 새 파일은 올리지 않았다: ${newFiles.join(", ")}` : "";
  console.log(
    JSON.stringify({
      systemMessage: r.ok
        ? `미완성 변경을 ${r.own} 에 자동 저장했습니다.${skipped}`
        : `GitHub 저장에 실패했습니다. 이 기기에만 변경이 남아 있습니다: ${String(r.err).slice(0, 200)}`,
    })
  );
}

function cmdPark(note, files) {
  if (!note) throw new Error('메모가 필요하다: park "하던 일 / 다음 할 일" [새 파일...]');
  const bad = files.filter((f) => SECRET_RE.test(f.replace(/\\/g, "/")));
  if (bad.length) throw new Error(`비밀 파일로 보여 거부했다: ${bad.join(", ")}`);
  fetchAll();
  const r = parkInto(note, files);
  if (!r.ok) throw new Error("저장 실패: " + r.err);
  const { untracked } = changes();
  console.log(`${r.own} 에 저장했다. main 은 그대로다(배포 없음).${untracked.length ? `\n로컬에만 남은 새 파일: ${untracked.join(", ")}` : ""}`);
}

function cmdResume(branch) {
  if (!branch) throw new Error("브랜치 이름이 필요하다: resume <wip-...>");
  fetchAll();
  const tip = "origin/" + branch;
  if (!rev(tip) || isCleared(tip)) throw new Error(`${branch} 에 이어받을 작업이 없다.`);
  if (currentBranch() !== "main") throw new Error("main 에서 실행할 것.");
  if (aheadBehind().behind) receive();
  const note = git("log", "-1", "--format=%B", tip).out;
  const m = git("merge", "--squash", "--no-commit", tip);
  const conflicted = lines(git("diff", "--name-only", "--diff-filter=U").out);
  if (conflicted.length) {
    throw new Error(`충돌: ${conflicted.join(", ")}\n충돌을 풀고 작업을 이어간 뒤 \`${SELF} drop ${branch}\` 로 원본을 정리할 것.\n메모:\n${note}`);
  }
  if (!m.ok && !/already up.to.date/i.test(m.out + m.err)) {
    throw new Error(`이어받지 못했다(로컬 변경과 겹침?): ${m.err || m.out}\n로컬 변경을 먼저 커밋하거나 정리할 것.`);
  }
  const own = ownBranch();
  const saved = parkInto(note);
  if (saved.ok && branch !== own) clearBranch(branch);
  console.log(`${branch} 를 이어받아 원본을 정리했다. 변경은 커밋되지 않은 채 작업트리에 있다.\n메모:\n${note}`);
}

function cmdDrop(branch) {
  if (!branch) throw new Error("브랜치 이름이 필요하다: drop <wip-...>");
  fetchAll();
  if (!clearBranch(branch)) throw new Error(`${branch} 정리 실패`);
  console.log(`${branch} 를 정리했다.`);
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

const [mode, ...rest] = process.argv.slice(2);
try {
  if (mode === "start") onStart();
  else if (mode === "prompt") onPrompt();
  else if (mode === "stop") onStop(readStdin());
  else if (mode === "park") cmdPark(rest[0], rest.slice(1));
  else if (mode === "resume") cmdResume(rest[0]);
  else if (mode === "drop") cmdDrop(rest[0]);
  else throw new Error("사용법: start|prompt|stop|park|resume|drop");
} catch (e) {
  if (["start", "prompt", "stop"].includes(mode)) {
    // 훅 오류가 세션을 막으면 안 된다. 사용자에게만 알린다.
    console.log(JSON.stringify({ systemMessage: `git-sync 오류: ${String(e.message).slice(0, 200)}` }));
    process.exit(0);
  }
  console.error(e.message);
  process.exit(1);
}
