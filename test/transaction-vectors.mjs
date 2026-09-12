import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { project } from '../scripts/build.mjs';
export function pinnedText(path) {
  const lock = JSON.parse(readFileSync(resolve(project, 'source-lock.json'), 'utf8'));
  const bytes = readFileSync(resolve(process.env.TELCOIN_OCAML_ROOT ?? lock.upstream.root, path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), lock.upstream.files.find(f => f.path === path)?.sha256, path);
  return bytes.toString('utf8');
}
const source = pinnedText('test/tx_vectors.ml');
const senders = Object.fromEntries([...source.matchAll(/let (sender_key\d*) = "([0-9a-f]+)"/g)].map(m => [m[1], m[2]]));
export const transactionGoldens = [...source.matchAll(/name = "([^"]+)";([\s\S]*?)(?=\n  \})/g)].map(match => {
  const result = { name: match[1] };
  for (const field of ['signing_payload', 'signing_hash', 'encoded_2718', 'tx_hash']) {
    result[field] = match[2].match(new RegExp(`${field} =\\s*"([0-9a-f]+)"`))?.[1];
    assert.ok(result[field], `${result.name}: missing ${field}`);
  }
  const sender = match[2].match(/sender = (sender_key\d*);/)?.[1];
  result.sender = senders[sender];
  assert.ok(result.sender, `${result.name}: missing sender`);
  return result;
});
assert.ok(transactionGoldens.length >= 7, 'All pinned signed transaction records must be available');
export const scalar = value => {
  const n = BigInt(value);
  return n === 0n ? '' : n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0');
};
export const word = n => BigInt(n).toString(16).padStart(64, '0');
export function rlp(value) {
  const list = Array.isArray(value);
  const body = list ? value.map(rlp).join('') : value;
  const size = body.length / 2;
  if (!list && size === 1 && parseInt(body, 16) < 128) return body;
  if (size < 56) return (size + (list ? 192 : 128)).toString(16) + body;
  const length = scalar(size);
  return (length.length / 2 + (list ? 247 : 183)).toString(16) + length + body;
}
export const wire = (type, fields) => (type ? scalar(type) : '') + rlp(fields);
export const txFields = type => {
  const common = [scalar(21000), '00'.repeat(20), '', ''];
  if (type === 0) return ['', '01', ...common, '1b', '01', '01'];
  if (type === 1) return ['01', '', '01', ...common, [], '', '01', '01'];
  return ['01', '', '01', '02', ...common, [], ...(type === 4 ? [[]] : []), '', '01', '01'];
};
export const txLayouts = [
  { type: 0, scalars: [[0, 8], [1, 16], [2, 8], [4, 32], [6, 16], [7, 32], [8, 32]], native: [0, 2], target: 3, data: 5, access: null, parity: 6 },
  { type: 1, scalars: [[0, 8], [1, 8], [2, 16], [3, 8], [5, 32], [8, 1], [9, 32], [10, 32]], native: [1, 3], target: 4, data: 6, access: 7, parity: 8 },
  { type: 2, scalars: [[0, 8], [1, 8], [2, 16], [3, 16], [4, 8], [6, 32], [9, 1], [10, 32], [11, 32]], native: [1, 4], target: 5, data: 7, access: 8, parity: 9 },
  { type: 4, scalars: [[0, 8], [1, 8], [2, 16], [3, 16], [4, 8], [6, 32], [10, 1], [11, 32], [12, 32]], native: [1, 4], target: 5, data: 7, access: 8, parity: 10 },
];
const authSource = pinnedText('test/eip7702_vectors.ml');
const authLiteral = name => {
  const value = authSource.match(new RegExp(`let ${name} =\\s*"([0-9a-f]+)"`))?.[1];
  assert.ok(value, `Missing pinned EIP-7702 literal ${name}`);
  return value;
};
export const authorizationGolden = {
  fields: ['01', '11'.repeat(20), '', '01', authLiteral('auth_key0_r_hex'), authLiteral('auth_key0_s_hex')],
  hash: authLiteral('auth_signature_hash_hex'), authority: authLiteral('authority_key0_hex'),
};
const type4Body = ['01', '03', '07', '0b', scalar(100000), '11'.repeat(20), '0d', '',
  [['00'.repeat(19) + 'ff', [word(1)]]], [authorizationGolden.fields]];
export const type4Golden = {
  name: 'eip7702_distinct_authority_and_sender',
  encoded_2718: wire(4, [...type4Body, '', authLiteral('type4_r_hex'), authLiteral('type4_s_hex')]),
  signing_payload: wire(4, type4Body), signing_hash: authLiteral('type4_signing_hash_hex'),
  tx_hash: authLiteral('type4_tx_hash_hex'), sender: authLiteral('sender_key1_hex'),
};
