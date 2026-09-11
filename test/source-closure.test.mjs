import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceClosure } from '../scripts/source-closure.mjs';
const project = text => [{ path: 'fixture.kan', text }];
test('closure retains constructor families, recursive and transitive references in source order', () => {
  const source = 'mu L : Type 0 :=\n| nil : L\n| cons (tail : L) : L\ndef rec loop : L -> L := fun (x : L) => loop x\ndef unused : Nat := 5\ndef root : L := loop (cons nil)\n';
  assert.equal(sourceClosure(project(source), ['root']).text, source.replace('def unused : Nat := 5\n', '').replaceAll('\ndef', '\n\ndef'));
});
test('closure ignores references in comments and escaped strings but conservatively retains shadowed globals', () => {
  const source = 'def commented : Nat := 1\ndef quoted : Nat := 2\ndef x : Nat := 3\ndef root : Nat -> Bytes := fun (x : Nat) => b"quoted \\" quoted" -- commented\n';
  assert.deepEqual(sourceClosure(project(source), ['root']).declarations.map(d => d.names[0]), ['x', 'root']);
});
test('closure rejects missing exports, duplicate declarations and unrecognized preambles', () => {
  assert.throws(() => sourceClosure(project('def x : Nat := 1\n'), ['missing']), /Unknown export/);
  assert.throws(() => sourceClosure(project('def x : Nat := 1\ndef x : Nat := 2\n'), ['x']), /Duplicate declaration/);
  assert.throws(() => sourceClosure(project('import foreign\ndef x : Nat := 1\n'), ['x']), /Unsupported source preamble/);
});
