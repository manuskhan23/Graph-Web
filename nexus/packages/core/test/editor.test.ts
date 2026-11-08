import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeProject } from './fixtures.js';
import { EditorService } from '../src/editor/service.js';
import { SnapshotService } from '../src/snapshots/service.js';
import { NexusError } from '../src/errors.js';
import { buildFileDiff } from '../src/editor/diff.js';

function services(project: ReturnType<typeof makeProject>) {
  const snapshots = new SnapshotService(project.db);
  const editor = new EditorService(project.db, snapshots);
  return { snapshots, editor };
}

test('staging produces diffs without touching disk, apply writes once', () => {
  const project = makeProject({ 'src/a.ts': 'export const a = 1;\n' });
  const { editor } = services(project);

  const staged = editor.stage(project.projectId, [
    { kind: 'write', relPath: 'src/a.ts', content: 'export const a = 2;\n' },
    { kind: 'create', relPath: 'src/b.ts', content: 'export const b = 1;\n' },
  ], 'Change a, add b');

  assert.equal(staged.changes.length, 2);
  assert.equal(staged.summary.files, 2);
  assert.equal(staged.summary.additions, 2);
  assert.ok(staged.summary.deletions >= 1);
  assert.ok(staged.snapshotId);
  // nothing written yet
  assert.equal(readFileSync(join(project.dir, 'src/a.ts'), 'utf8'), 'export const a = 1;\n');
  assert.ok(!existsSync(join(project.dir, 'src/b.ts')));

  const result = editor.apply(staged.operationId);
  assert.deepEqual(result.applied.sort(), ['src/a.ts', 'src/b.ts']);
  assert.equal(readFileSync(join(project.dir, 'src/a.ts'), 'utf8'), 'export const a = 2;\n');
  assert.equal(readFileSync(join(project.dir, 'src/b.ts'), 'utf8'), 'export const b = 1;\n');
  // staged set is consumed
  assert.equal(editor.getStaged(staged.operationId), null);
  project.cleanup();
});

test('hash conflict detection blocks silent overwrite of user edits', () => {
  const project = makeProject({ 'src/a.ts': 'export const a = 1;\n' });
  const { editor } = services(project);
  const original = editor.readFile(project.projectId, 'src/a.ts');

  const staged = editor.stage(project.projectId, [
    { kind: 'write', relPath: 'src/a.ts', content: 'agent version\n', expectedHash: original.hash },
  ]);

  // The user edits the file after the agent inspected it.
  writeFileSync(join(project.dir, 'src/a.ts'), 'user version\n');

  assert.throws(
    () => editor.apply(staged.operationId),
    (err: unknown) => err instanceof NexusError && err.code === 'CONFLICT',
  );
  assert.equal(readFileSync(join(project.dir, 'src/a.ts'), 'utf8'), 'user version\n');
  project.cleanup();
});

test('stale expected hash is rejected at stage time', () => {
  const project = makeProject({ 'src/a.ts': 'original\n' });
  const { editor } = services(project);
  writeFileSync(join(project.dir, 'src/a.ts'), 'changed by user\n');
  assert.throws(
    () =>
      editor.stage(project.projectId, [
        { kind: 'write', relPath: 'src/a.ts', content: 'x', expectedHash: 'deadbeef' },
      ]),
    (err: unknown) => err instanceof NexusError && err.code === 'CONFLICT',
  );
  project.cleanup();
});

test('replace requires an unambiguous match', () => {
  const project = makeProject({ 'src/a.ts': 'const x = 1;\nconst x = 1;\n' });
  const { editor } = services(project);
  assert.throws(
    () => editor.stage(project.projectId, [{ kind: 'replace', relPath: 'src/a.ts', search: 'const x = 1;', replace: 'const x = 2;' }]),
    (err: unknown) => err instanceof NexusError && err.code === 'CONFLICT' && /ambiguous/.test(err.message),
  );
  assert.throws(
    () => editor.stage(project.projectId, [{ kind: 'replace', relPath: 'src/a.ts', search: 'not here', replace: 'x' }]),
    (err: unknown) => err instanceof NexusError && err.code === 'CONFLICT',
  );

  const staged = editor.stage(project.projectId, [
    { kind: 'replace', relPath: 'src/a.ts', search: 'const x = 1;\nconst x = 1;\n', replace: 'const x = 2;\nconst x = 1;\n' },
  ]);
  editor.apply(staged.operationId);
  assert.equal(readFileSync(join(project.dir, 'src/a.ts'), 'utf8'), 'const x = 2;\nconst x = 1;\n');
  project.cleanup();
});

test('create refuses to clobber and delete/move work through the snapshot pipeline', () => {
  const project = makeProject({ 'src/a.ts': 'a\n', 'src/keep.ts': 'keep\n' });
  const { editor } = services(project);

  assert.throws(
    () => editor.stage(project.projectId, [{ kind: 'create', relPath: 'src/a.ts', content: 'x' }]),
    (err: unknown) => err instanceof NexusError && err.code === 'CONFLICT',
  );

  const staged = editor.stage(project.projectId, [
    { kind: 'move', relPath: 'src/keep.ts', to: 'src/moved/keep.ts' },
    { kind: 'delete', relPath: 'src/a.ts' },
    { kind: 'mkdir', relPath: 'src/newdir' },
  ]);
  editor.apply(staged.operationId);

  assert.ok(!existsSync(join(project.dir, 'src/a.ts')));
  assert.ok(existsSync(join(project.dir, 'src/moved/keep.ts')));
  assert.ok(existsSync(join(project.dir, 'src/newdir')));
  project.cleanup();
});

test('editor rejects traversal and protected paths', () => {
  const project = makeProject({ 'src/a.ts': 'a\n' });
  const { editor } = services(project);
  assert.throws(
    () => editor.stage(project.projectId, [{ kind: 'create', relPath: '../escape.txt', content: 'x' }]),
    (err: unknown) => err instanceof NexusError,
  );
  assert.throws(
    () => editor.stage(project.projectId, [{ kind: 'write', relPath: '.git/config', content: 'x' }]),
    (err: unknown) => err instanceof NexusError && err.code === 'PERMISSION_DENIED',
  );
  assert.throws(
    () => editor.readFile(project.projectId, '.env'),
    (err: unknown) => err instanceof NexusError && err.code === 'SENSITIVE_DATA_BLOCKED',
  );
  project.cleanup();
});

test('snapshots restore file content and are themselves reversible', () => {
  const project = makeProject({ 'src/a.ts': 'version 1\n', 'src/b.ts': 'b1\n' });
  const { snapshots, editor } = services(project);

  const snapshotId = snapshots.capture({
    projectId: project.projectId,
    relPaths: ['src/a.ts'],
    operationId: 'op1',
    label: 'before edit',
  });
  writeFileSync(join(project.dir, 'src/a.ts'), 'version 2\n');

  const restored = snapshots.restore(snapshotId);
  assert.deepEqual(restored.restored, ['src/a.ts']);
  assert.equal(readFileSync(join(project.dir, 'src/a.ts'), 'utf8'), 'version 1\n');
  // A safety snapshot of the pre-restore state was taken.
  assert.ok(restored.safetySnapshotId);

  const safety = snapshots.detail(restored.safetySnapshotId!);
  assert.equal(safety.files[0]!.content, 'version 2\n');

  // Restore the safety snapshot → back to version 2 (rollback is reversible).
  snapshots.restore(restored.safetySnapshotId!);
  assert.equal(readFileSync(join(project.dir, 'src/a.ts'), 'utf8'), 'version 2\n');

  assert.equal(snapshots.list(project.projectId).length, 3);
  const diff = snapshots.diffWithCurrent(snapshotId, 'src/a.ts');
  assert.equal(diff.changed, true);
  assert.equal(diff.before, 'version 1\n');
  assert.equal(diff.after, 'version 2\n');
  project.cleanup();
});

test('restore recreates files that were deleted and removes files that were created', () => {
  const project = makeProject({ 'src/old.ts': 'old\n' });
  const { snapshots } = services(project);
  const snapshotId = snapshots.capture({
    projectId: project.projectId,
    relPaths: ['src/old.ts', 'src/ghost.ts'],
    operationId: 'op2',
    label: 'mixed',
  });
  writeFileSync(join(project.dir, 'src/ghost.ts'), 'created later\n');
  writeFileSync(join(project.dir, 'src/temp.ts'), 'temp\n');

  const second = snapshots.capture({
    projectId: project.projectId,
    relPaths: ['src/temp.ts'],
    operationId: 'op3',
    label: 'with temp',
  });
  assert.ok(second);

  // Capture a snapshot that recorded ghost.ts as non-existent, then delete it.
  const restoreResult = snapshots.restore(snapshotId);
  assert.ok(!existsSync(join(project.dir, 'src/ghost.ts')), 'file absent in snapshot should be removed on restore');
  assert.ok(restoreResult.deleted.includes('src/ghost.ts'));
  project.cleanup();
});

test('snapshot retention only expires data outside the window', () => {
  const project = makeProject({ 'src/a.ts': 'a\n' });
  const { snapshots } = services(project);
  snapshots.capture({ projectId: project.projectId, relPaths: ['src/a.ts'], operationId: 'op', label: 'recent' });
  const result = snapshots.applyRetention(30);
  assert.equal(result.snapshots, 0);
  assert.equal(snapshots.list(project.projectId).length, 1);
  project.cleanup();
});

test('diff builder reports additions, deletions and line numbers', () => {
  const diff = buildFileDiff('src/x.ts', 'a\nb\nc\n', 'a\nB\nc\nd\n');
  assert.equal(diff.additions, 2);
  assert.equal(diff.deletions, 1);
  const adds = diff.lines.filter((l) => l.type === 'add');
  assert.ok(adds.every((l) => l.newLine !== null));
  const dels = diff.lines.filter((l) => l.type === 'del');
  assert.ok(dels.every((l) => l.oldLine !== null));
  assert.ok(diff.unified.includes('-b'));
  assert.ok(diff.unified.includes('+B'));
});
