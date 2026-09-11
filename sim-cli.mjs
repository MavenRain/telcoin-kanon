import { loadTelcoin } from './runtime.mjs';

// OCaml's decimal and prefixed integer syntax, including ignored underscores.
export function parseOcamlInteger(text, bits) {
  const match = /^([+-]?)(?:(0[xX])([0-9a-fA-F][0-9a-fA-F_]*)|(0[oO])([0-7][0-7_]*)|(0[bB])([01][01_]*)|(0[uU])([0-9][0-9_]*)|([0-9][0-9_]*))$/.exec(text ?? '');
  if (!match) return undefined;
  const prefixed = !!(match[2] || match[4] || match[6] || match[8]);
  const digits = (match[3] ?? match[5] ?? match[7] ?? match[9] ?? match[10]).replaceAll('_', '');
  const prefix = match[2] ? '0x' : match[4] ? '0o' : match[6] ? '0b' : '';
  const magnitude = BigInt(prefix + digits);
  const negative = match[1] === '-';
  const limit = prefixed ? (1n << BigInt(bits)) - 1n : (1n << BigInt(bits - 1)) - (negative ? 0n : 1n);
  if (magnitude > limit) return undefined;
  return BigInt.asIntN(bits, negative ? -magnitude : magnitude);
}

export async function runSimulatorCli(args) {
  const scan = (flag, bits, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 && index + 1 < args.length ? parseOcamlInteger(args[index + 1], bits) ?? fallback : fallback;
  };
  const count = scan('--validators', 63, 4n);
  const seed = scan('--seed', 64, 42n);
  const seconds = scan('--until-s', 63, 20n);
  const rawSeed = Buffer.alloc(8);
  rawSeed.writeBigUInt64LE(BigInt.asUintN(64, seed));
  try {
    const { exports: e, toBytes, fromBytes } = await loadTelcoin();
    const result = e.apiSimulatorRun(toBytes(String(count < 2n ? 2n : count)), toBytes(rawSeed), toBytes(String(seconds < 1n ? 1n : seconds)));
    const status = e.simulatorReportExit(result);
    process.stdout.write(fromBytes(e.simulatorReportText(result)));
    process.exitCode = status;
  } catch (error) {
    process.stderr.write(`${error.code === 'ENOENT' ? 'Build the module with npm run build first.' : error.message}\n`);
    process.exitCode = 1;
  }
}
