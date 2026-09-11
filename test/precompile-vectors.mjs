const be = value => BigInt(value).toString(16).padStart(64, '0');
const gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const g1 = be(1) + be(2);
export const precompileVectors = [
  { address: 1, gas: 3000, input: be(1) + be(27) + be(gx) + be(gx + 1n) },
  { address: 2, gas: 72, input: '616263' },
  { address: 3, gas: 720, input: '616263' },
  { address: 4, gas: 18, input: '616263' },
  { address: 5, gas: 200, input: be(1) + be(1) + be(1) + '05030d' },
  { address: 6, gas: 150, input: g1 + g1 },
  { address: 7, gas: 6000, input: g1 + be(2) },
  { address: 8, gas: 45000, input: '' },
  { address: 9, gas: 0, input: '00'.repeat(213) },
];
