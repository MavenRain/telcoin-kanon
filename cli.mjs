#!/usr/bin/env node
import { loadFoundation } from './runtime.mjs';

const usage = `telcoin-kanon (partial simulation port)
Usage:
  telcoin-kanon bcs encode <u8|u16|u32|u64|uleb> <decimal>
  telcoin-kanon bcs decode <u8|u16|u32|u64|uleb|bool|bytes|option-u8|fixed3|sized3> <hex>
  telcoin-kanon scalar <round|epoch|workerId|timestamp|stake|duration|baseFee|leaderRound> <decimal>
  telcoin-kanon bcs normalize <list-u8|list-u64|set-u8|map-u8-u16> <hex>
  telcoin-kanon prng <next|split> <u64-seed>
  telcoin-kanon wire <batch|sealed-batch|header> <hex>
  telcoin-kanon simulation hash <hex>
  telcoin-kanon simulation key <u64-seed>
  telcoin-kanon simulation <sign|vote> <u64-seed> <message-or-header-hex>
  telcoin-kanon simulation committee <comma-separated-u64-seeds>
`;
const integerKinds = { u8: 'U8', u16: 'U16', u32: 'U32', u64: 'U64', uleb: 'Uleb' };
const scalarKinds = new Set(['round', 'epoch', 'workerId', 'timestamp', 'stake', 'duration', 'baseFee', 'leaderRound']);
const normalizers = { 'list-u8': 'apiNormalizeListU8', 'list-u64': 'apiNormalizeListU64', 'set-u8': 'apiNormalizeSetU8', 'map-u8-u16': 'apiNormalizeMapU8U16' };
const inspectors = { batch: 'apiBatchInspect', 'sealed-batch': 'apiSealedBatchInspect', header: 'apiHeaderInspect' };
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write(usage);
} else {
  const [command, operation, kind, input] = args;
  const integerKind = Object.hasOwn(integerKinds, kind) ? integerKinds[kind] : undefined;
  const scalar = command === 'scalar' && args.length === 3 && scalarKinds.has(operation);
  const encode = command === 'bcs' && operation === 'encode' && args.length === 4 && integerKind;
  const decode = command === 'bcs' && operation === 'decode' && args.length === 4 &&
    (integerKind || ['bool', 'bytes', 'option-u8', 'fixed3', 'sized3'].includes(kind));
  const normalize = command === 'bcs' && operation === 'normalize' && args.length === 4 && Object.hasOwn(normalizers, kind);
  const prng = command === 'prng' && ['next', 'split'].includes(operation) && args.length === 3;
  const wire = command === 'wire' && Object.hasOwn(inspectors, operation) && args.length === 3;
  const simulation = command === 'simulation' && (
    (['hash', 'key', 'committee'].includes(operation) && args.length === 3) ||
    (['sign', 'vote'].includes(operation) && args.length === 4));
  const hexInput = (decode || normalize || (simulation && ['sign', 'vote'].includes(operation))) ? input :
    (wire || (simulation && operation === 'hash')) ? kind : undefined;
  if (!scalar && !encode && !decode && !normalize && !prng && !wire && !simulation) {
    process.stderr.write(usage);
    process.exitCode = 64;
  } else if (hexInput !== undefined && !/^(?:[0-9a-fA-F]{2})*$/.test(hexInput)) {
    process.stderr.write('Hex input must contain complete byte pairs.\n');
    process.exitCode = 1;
  } else {
    try {
      const { exports: e, toBytes, fromBytes } = await loadFoundation();
      const text = bytes => fromBytes(bytes).toString('utf8');
      let output;
      let failed = false;
      if (normalize) {
        output = text(e[normalizers[kind]](toBytes(Buffer.from(input, 'hex'))));
        failed = output.startsWith('error: ');
      } else if (prng) {
        output = text(e[operation === 'next' ? 'apiPrngNext' : 'apiPrngSplit'](toBytes(kind)));
        failed = output.startsWith('error: ');
        if (!failed) {
          const [first, second] = output.split(':');
          output = JSON.stringify(operation === 'next' ? { value: first, state: second } : { left: first, right: second });
        }
      } else if (wire) {
        output = text(e[inspectors[operation]](toBytes(Buffer.from(kind, 'hex'))));
        failed = output.startsWith('error: ');
        if (!failed) {
          const [bytes, digest, computed] = output.split(':');
          const profile = text(e.cryptoProfile());
          output = JSON.stringify(operation === 'sealed-batch' ? { profile, bytes, claimedDigest: digest, computedDigest: computed } : { profile, bytes, digest });
        }
      } else if (simulation) {
        const profile = text(e.cryptoProfile());
        if (operation === 'hash') output = JSON.stringify({ profile, digest: fromBytes(e.blake2s256(toBytes(Buffer.from(kind, 'hex')))).toString('hex') });
        else if (operation === 'committee') {
          let seeds = e.seqBytesEmpty();
          for (const seed of (kind === '' ? [] : kind.split(',')).reverse()) seeds = e.seqBytesCons(toBytes(seed), seeds);
          output = text(e.apiCommitteeInspect(seeds));
          failed = output.startsWith('error: ');
          if (!failed) {
            const [size, quorum, validity, roster] = output.split(':');
            output = JSON.stringify({ profile, epoch: 0, size: Number(size), quorum: Number(quorum), validity: Number(validity), authorities: roster.split(',') });
          }
        } else {
          output = operation === 'key' ? text(e.apiSimulationKey(toBytes(kind))) :
            text(e[operation === 'vote' ? 'apiVoteSign' : 'apiSimulationSign'](toBytes(kind), toBytes(Buffer.from(input, 'hex'))));
          failed = output.startsWith('error: ');
          if (!failed) output = JSON.stringify(operation === 'key' ? { profile, publicKey: output } : { profile, signature: output });
        }
      } else if (scalar) {
        output = text(e[`${operation}Text`](e[`${operation}Parse`](toBytes(kind))));
        failed = output === 'none';
      } else if (encode) {
        const result = e[`bcsWrite${integerKind}`](toBytes(input));
        failed = !e.bcsWriteIsOk(result);
        output = failed ? 'Expected an unsigned decimal integer at most 18446744073709551615.'
          : fromBytes(e.bcsWriteBytes(result)).toString('hex');
      } else {
        const bytes = toBytes(Buffer.from(input, 'hex'));
        if (['bytes', 'fixed3', 'sized3'].includes(kind)) {
          const result = kind === 'bytes' ? e.bcsDecodeBytes(bytes) :
            kind === 'fixed3' ? e.bcsDecodeFixedBytes(3, bytes) : e.bcsDecodeSizedBytes(3, bytes);
          failed = !e.bcsBytesIsOk(result);
          output = failed ? text(e.bcsBytesText(result)) : fromBytes(e.bcsBytesText(result)).toString('hex');
        } else {
          output = kind === 'option-u8' ? text(e.bcsOptionText(e.bcsDecodeOptionU8(bytes))) :
            text(e.bcsNatText(e[`bcsDecode${integerKind ?? 'Bool'}`](bytes)));
          failed = output.startsWith('error: ');
        }
      }
      (failed ? process.stderr : process.stdout).write(`${output}\n`);
      process.exitCode = failed ? 1 : 0;
    } catch (error) {
      process.stderr.write(`${error.code === 'ENOENT' ? 'Build the foundation module with npm run build first.' : error.message}\n`);
      process.exitCode = 1;
    }
  }
}
