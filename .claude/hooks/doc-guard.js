#!/usr/bin/env node
/**
 * doc-guard — keeps the repo guide's part files (docs/claude/*.md) in step with the code.
 *
 *   node .claude/hooks/doc-guard.js post-edit   (PostToolUse on Edit|Write|MultiEdit|NotebookEdit)
 *     Tells Claude which part file covers the file it just edited, once per part per session,
 *     so it reads that area's traps before going further and knows where the note goes.
 *
 *   node .claude/hooks/doc-guard.js stop        (Stop)
 *     Blocks the end of a turn while a code change made this session is NEWER than every part
 *     file that covers it, and names the file to update. An installer change asks for
 *     installer.md, a Deal Center change for deal-center.md, and so on.
 *
 * The path → part mapping is parsed from the "Read before changing" column of the §8 table in
 * the root CLAUDE.md, so adding or widening a row there is all it takes to route a new area.
 *
 * ⚠️ Every failure path exits 0 silently. A broken guard must never block real work.
 * ⚠️ Staleness is judged from the working tree (git status + mtimes), not from tool calls, so
 * changes made through Bash scripts (the CRLF-safe python edits) are caught too.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PARTS_DIR = 'docs/claude';
/** Files listed per part in the block reason; the rest are summarised as "+N more". */
const MAX_LISTED = 8;

const toPosix = (p) => p.split(path.sep).join('/').replace(/\\/g, '/');

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function repoRoot(input) {
  const start = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: start, encoding: 'utf8' }).trim();
  } catch {
    return start;
  }
}

/** Only app code needs a note. Tests are gitignored, and docs/tooling are not "a change". */
function isCode(rel) {
  if (!/\.(tsx?|jsx?)$/.test(rel) || rel.includes('/__tests__/')) return false;
  return rel.startsWith('src/') || rel === 'index.js' || rel === 'App.tsx';
}

function globToRegex(glob, root) {
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === '*' && glob[i + 1] === '*') {
      src += '.*';
      i++;
    } else if (glob[i] === '*') {
      src += '[^/]*';
    } else {
      src += glob[i].replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  // A bare name that exists at the repo root (`index.js`) means THAT file, not every
  // `index.js` under src/. Any other bare name (`ZoomableImage.tsx`) matches wherever it lives.
  const anchor = !glob.includes('/') && fs.existsSync(path.join(root, glob)) ? '^' : '(^|/)';
  return new RegExp(`${anchor}${src}$`);
}

/** Parses CLAUDE.md §8 into [{ doc, rules: [{ re, weight }] }]. */
function loadAreas(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  } catch {
    return [];
  }
  const section = text.split(/^## 8\./m)[1] || '';
  const areas = [];
  for (const line of section.split(/\r?\n/)) {
    const doc = line.match(/\((docs\/claude\/[\w.-]+\.md)\)/);
    if (!doc) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|');
    const globs = [...cells[cells.length - 1].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    const rules = globs.map((g) => ({
      re: globToRegex(g, root),
      // A named file beats a directory glob, and a longer literal beats a shorter one, so
      // DynamicDealEditScreen.tsx routes to deal-edit-addendums.md rather than to the
      // `screens/DynamicDealCenter/**` row that also contains it.
      weight: (g.includes('**') ? 0 : 1000) + g.replace(/\*/g, '').length,
    }));
    areas.push({ doc: doc[1], rules });
  }
  return areas;
}

/** Every area covering `rel`, most specific first. */
function matchAreas(areas, rel) {
  return areas
    .map((a) => ({ doc: a.doc, weight: Math.max(-1, ...a.rules.filter((r) => r.re.test(rel)).map((r) => r.weight)) }))
    .filter((m) => m.weight >= 0)
    .sort((a, b) => b.weight - a.weight);
}

function statePath(input) {
  const id = String(input.session_id || 'unknown').replace(/[^\w-]/g, '_');
  return path.join(os.tmpdir(), 'claude-doc-guard', `${id}.json`);
}

function loadState(input) {
  try {
    return JSON.parse(fs.readFileSync(statePath(input), 'utf8'));
  } catch {
    return { announced: [], dismissed: [] };
  }
}

function saveState(input, state) {
  try {
    const file = statePath(input);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    /* state is a nicety; never fail on it */
  }
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------------------------

function postEdit(input, root) {
  const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!target) return;
  const rel = toPosix(path.relative(root, path.resolve(root, target)));
  if (!isCode(rel)) return;

  const best = matchAreas(loadAreas(root), rel)[0];
  const key = best ? best.doc : '(unmapped)';
  const state = loadState(input);
  if (state.announced.includes(key)) return;
  state.announced.push(key);
  saveState(input, state);

  const context = best
    ? `doc-guard: \`${rel}\` is covered by \`${best.doc}\`. If you have not read that part file this ` +
      'session, read it before changing more code in this area; it records traps not to "fix" back. ' +
      'When the change is done, record it there (a `##` ticket section, or a `###` follow-up under the ' +
      'existing ticket). Do not add ticket notes to the root CLAUDE.md.'
    : `doc-guard: no row in CLAUDE.md §8 covers \`${rel}\`. When the change is done, record it in the ` +
      'closest docs/claude part file (app-wide.md if none fits), and add the path to that row\'s ' +
      '"Read before changing" column.';
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } })
  );
}

/** Code files changed in the working tree: [{ rel, mtime }]. Deletions carry no mtime and are skipped. */
function changedCode(root) {
  let out;
  try {
    out = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const tokens = out.split('\0');
  const files = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const rel = entry.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the next token is the original path
    if (xy.includes('D') || !isCode(rel)) continue;
    const mtime = mtimeMs(path.join(root, rel));
    if (mtime) files.push({ rel, mtime });
  }
  return files;
}

function stop(input, root) {
  // A turn this guard already blocked once gets to finish; that is what breaks the loop.
  if (input.stop_hook_active) return;

  // Only changes made after this session began. Uncommitted work that was already sitting in the
  // tree beforehand is not this session's to document. (birthtime is 0 where the platform does not
  // record it; then every uncommitted change counts.)
  let since = 0;
  try {
    since = fs.statSync(input.transcript_path).birthtimeMs || 0;
  } catch {
    /* no transcript: no lower bound */
  }

  const areas = loadAreas(root);
  let partNames = [];
  try {
    partNames = fs.readdirSync(path.join(root, PARTS_DIR)).filter((f) => f.endsWith('.md'));
  } catch {
    return; // no part files in this checkout: nothing to guard
  }
  const partTime = Object.fromEntries(partNames.map((f) => [`${PARTS_DIR}/${f}`, mtimeMs(path.join(root, PARTS_DIR, f))]));
  const newestPart = Math.max(0, ...Object.values(partTime));

  const pending = new Map(); // doc → [rel]
  const unmapped = [];
  for (const { rel, mtime } of changedCode(root)) {
    if (mtime < since) continue;
    const matches = matchAreas(areas, rel);
    if (matches.length) {
      // Any covering part updated after the edit counts, since an area on the boundary of two rows
      // is legitimately written up in either.
      if (matches.some((m) => (partTime[m.doc] || 0) >= mtime)) continue;
      const doc = matches[0].doc;
      pending.set(doc, [...(pending.get(doc) || []), rel]);
    } else if (newestPart < mtime) {
      unmapped.push(rel);
    }
  }
  if (!pending.size && !unmapped.length) return;

  // Block once per distinct set of undocumented edits. If Claude judged them not worth a note and
  // said so, the same set must not be raised again on every later turn.
  const fingerprint = [...[...pending.values()].flat(), ...unmapped].sort().join('|');
  const state = loadState(input);
  if (state.dismissed.includes(fingerprint)) return;
  state.dismissed.push(fingerprint);
  saveState(input, state);

  const list = (files) =>
    files.slice(0, MAX_LISTED).map((f) => `\`${f}\``).join(', ') +
    (files.length > MAX_LISTED ? ` (+${files.length - MAX_LISTED} more)` : '');
  const lines = [...pending].map(([doc, files]) => `- \`${doc}\` ← ${list(files)}`);
  if (unmapped.length) {
    lines.push(
      `- no CLAUDE.md §8 row covers ${list(unmapped)}. Use the closest part (app-wide.md if none fits) ` +
        'and add the path to that row\'s "Read before changing" column.'
    );
  }

  const reason = [
    'doc-guard: the repo guide has not been updated for code changed this session. These changes are ' +
      'newer than the part file that covers them:',
    ...lines,
    '',
    'Before finishing, record the change in that file in its existing style: what changed and why, the ' +
      'file paths and endpoints, and ⚠️ traps. Use a `##` ticket section, or a `###` follow-up under the ticket ' +
      'it continues. Do not add ticket notes to the root CLAUDE.md, and skip tsc/eslint count narration. ' +
      'If the change does not warrant a note (it was reverted or exploratory, or the user said not to document ' +
      'it), say so in one line and finish. This check will not repeat for the same changes.',
  ].join('\n');
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

try {
  const input = readInput();
  const root = repoRoot(input);
  const mode = process.argv[2];
  if (mode === 'post-edit') postEdit(input, root);
  else if (mode === 'stop') stop(input, root);
} catch {
  /* never block on a guard bug */
}
process.exit(0);
