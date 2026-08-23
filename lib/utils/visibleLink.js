// When this skill is installed the recommended way — cloned into
// .claude/skills/<name> (project) or ~/.claude/skills/<name> (personal) — it
// lands inside a dot-directory that most file browsers hide by default, so
// a user who just cloned it often can't find it. This creates a symlink —
// a plain, visible sibling of .claude (e.g. ./buzzlens next to ./.claude) —
// pointing back at the real install, so the same content is browsable
// without unhiding dotfiles and always exactly reflects the real folder
// (it's the same files, not a snapshot).

const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('../config/constants');

function findVisibleTarget() {
  const segments = ROOT_DIR.split(path.sep);
  const claudeIdx = segments.lastIndexOf('.claude');
  if (claudeIdx === -1 || segments[claudeIdx + 1] !== 'skills') return null;

  const projectRoot = segments.slice(0, claudeIdx).join(path.sep) || path.sep;
  const skillName = segments[segments.length - 1];
  return path.join(projectRoot, skillName);
}

/**
 * Idempotent: safe to call on every run. Does nothing if the skill isn't
 * installed under .claude/skills/..., if the link already points at the
 * right place, or if something other than our own symlink already occupies
 * that path (never overwrites a real file/folder that isn't our doing).
 */
function ensureVisibleLink() {
  const target = findVisibleTarget();
  if (!target) return null;

  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (stat) {
    if (stat.isSymbolicLink()) {
      const current = fs.readlinkSync(target);
      if (path.resolve(path.dirname(target), current) === ROOT_DIR) return target;
      fs.unlinkSync(target);
    } else {
      return null; // don't touch a real file/folder we didn't create
    }
  }

  fs.symlinkSync(ROOT_DIR, target, 'dir');
  return target;
}

module.exports = { ensureVisibleLink, findVisibleTarget };
