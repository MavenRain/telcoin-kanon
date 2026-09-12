#!/usr/bin/env node
import { loadProfile } from './runtime.mjs';
import { runSimulatorCli } from './sim-cli.mjs';

const usage = `telcoin-kanon
Usage:
  telcoin-kanon simulate [--validators N] [--seed S] [--until-s T]
  telcoin-kanon bcs encode <u8|u16|u32|u64|uleb> <decimal>
  telcoin-kanon bcs decode <u8|u16|u32|u64|uleb|bool|bytes|option-u8|fixed3|sized3> <hex>
  telcoin-kanon scalar <round|epoch|workerId|timestamp|stake|duration|baseFee|leaderRound> <decimal>
  telcoin-kanon bcs normalize <list-u8|list-u64|set-u8|map-u8-u16> <hex>
  telcoin-kanon prng <next|split> <u64-seed>
  telcoin-kanon wire <batch|sealed-batch|header> <hex>
  telcoin-kanon evm precompile <20-byte-address-hex> <gas-decimal> <input-hex>
  telcoin-kanon <simulation|bls> hash <hex>
  telcoin-kanon <simulation|bls> key <u64-seed>
  telcoin-kanon <simulation|bls> <sign|vote> <u64-seed> <message-or-header-hex>
  telcoin-kanon <simulation|bls> committee <comma-separated-u64-seeds>
  telcoin-kanon <simulation|bls> verify <public-key-hex> <message-hex> <signature-hex>
  telcoin-kanon <simulation|bls> aggregate <comma-separated-signature-hex>
  telcoin-kanon <simulation|bls> verify-aggregate <comma-separated-public-key-hex> <message-hex> <aggregate-hex>
`;
const integerKinds = { u8: 'U8', u16: 'U16', u32: 'U32', u64: 'U64', uleb: 'Uleb' };
const scalarKinds = new Set(['round', 'epoch', 'workerId', 'timestamp', 'stake', 'duration', 'baseFee', 'leaderRound']);
const normalizers = { 'list-u8': 'apiNormalizeListU8', 'list-u64': 'apiNormalizeListU64', 'set-u8': 'apiNormalizeSetU8', 'map-u8-u16': 'apiNormalizeMapU8U16' };
const inspectors = { batch: 'apiBatchInspect', 'sealed-batch': 'apiSealedBatchInspect', header: 'apiHeaderInspect' };
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write(usage);
} else if (args[0] === 'simulate') {
  await runSimulatorCli(args.slice(1));
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
  const precompile = command === 'evm' && operation === 'precompile' && args.length === 5;
  const crypto = ['simulation', 'bls'].includes(command) && (
    (['hash', 'key', 'committee', 'aggregate'].includes(operation) && args.length === 3) ||
    (['sign', 'vote'].includes(operation) && args.length === 4) ||
    (['verify', 'verify-aggregate'].includes(operation) && args.length === 5));
  const csv = value => value === '' ? [] : value.split(',');
  const hexInput = precompile ? args[4] : (decode || normalize || (crypto && ['sign', 'vote'].includes(operation))) ? input :
    (wire || (crypto && operation === 'hash')) ? kind : undefined;
  const hexInputs = hexInput === undefined ? [] : [hexInput];
  if (crypto && operation === 'aggregate') hexInputs.push(...csv(kind));
  if (crypto && ['verify', 'verify-aggregate'].includes(operation)) hexInputs.push(...(operation === 'verify' ? [kind] : csv(kind)), input, args[4]);
  if (!scalar && !encode && !decode && !normalize && !prng && !wire && !crypto && !precompile) {
    process.stderr.write(usage);
    process.exitCode = 64;
  } else if (hexInputs.some(value => !/^(?:[0-9a-fA-F]{2})*$/.test(value))) {
    process.stderr.write('Hex input must contain complete byte pairs.\n');
    process.exitCode = 1;
  } else if (precompile && !/^[0-9a-fA-F]{40}$/.test(kind)) {
    process.stderr.write('Address must contain exactly 20 hex bytes.\n');
    process.exitCode = 1;
  } else {
    try {
      const { exports: e, toBytes, fromBytes } = await loadProfile(command === 'bls' ? 'bls' : 'simulation');
      const text = bytes => fromBytes(bytes).toString('utf8');
      const raw = hex => toBytes(Buffer.from(hex, 'hex'));
      const byteList = (values, convert) => {
        let result = e.seqBytesEmpty();
        for (const value of [...values].reverse()) result = e.seqBytesCons(convert(value), result);
        return result;
      };
      let output;
      let failed = false;
      if (precompile) {
        output = text(e.apiPrecompile(toBytes(Buffer.from(kind, 'hex')), toBytes(input), toBytes(Buffer.from(args[4], 'hex'))));
        failed = output.startsWith('error: ');
        if (!failed) {
          const [status, gasUsed, bytes] = output.split(':');
          output = JSON.stringify(status === 's' ? { status: 'succeeded', gasUsed, output: bytes } : { status });
        }
      } else if (normalize) {
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
      } else if (crypto) {
        const profile = text(e.cryptoProfile());
        if (operation === 'hash') output = JSON.stringify({ profile, digest: text(e.apiCryptoHash(raw(kind))) });
        else if (['verify', 'verify-aggregate', 'aggregate'].includes(operation)) {
          output = operation === 'aggregate' ? text(e.apiCryptoAggregate(byteList(csv(kind), raw))) :
            operation === 'verify' ? text(e.apiCryptoVerify(raw(kind), raw(input), raw(args[4]))) :
              text(e.apiCryptoVerifyAggregate(byteList(csv(kind), raw), raw(input), raw(args[4])));
          failed = output.startsWith('error: ');
          if (!failed) output = JSON.stringify(operation === 'aggregate' ? { profile, aggregate: output } : { profile, valid: output === 'true' });
        }
        else if (operation === 'committee') {
          output = text(e.apiCommitteeInspect(byteList(csv(kind), toBytes)));
          failed = output.startsWith('error: ');
          if (!failed) {
            const [size, quorum, validity, roster] = output.split(':');
            output = JSON.stringify({ profile, epoch: 0, size: Number(size), quorum: Number(quorum), validity: Number(validity), authorities: roster.split(',') });
          }
        } else {
          output = operation === 'key' ? text(e.apiCryptoKey(toBytes(kind))) :
            text(e[operation === 'vote' ? 'apiVoteSign' : 'apiCryptoSign'](toBytes(kind), raw(input)));
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
      process.stderr.write(`${error.code === 'ENOENT' ? `Build the ${command === 'bls' ? 'BLS' : 'simulation'} module with npm run ${command === 'bls' ? 'build:bls' : 'build'} first.` : error.message}\n`);
      process.exitCode = 1;
    }
  }
}
