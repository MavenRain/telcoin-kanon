import {hash,u16,u32,u64,sequence,uleb} from './harness.mjs';
export const mockTx=(gas=0n,kind=0)=>kind.toString(16).padStart(2,'0')+u64(gas);
export const batchWire=({txs=[],epoch=0,worker=0,fee=7n,badDigest=false}={})=>{
  const preimage=sequence(txs.map(tx=>uleb(tx.length/2)+tx))+u32(epoch)+'14'+'00'.repeat(20)+u64(fee)+u16(worker);
  return preimage+'20'+(badDigest?'ff'.repeat(32):hash(preimage));
};
export const batchRow=(mode,options={},snapshot={})=>[mode,batchWire(options),String(snapshot.worker??options.worker??0),String(snapshot.epoch??options.epoch??0),u64(snapshot.fee??options.fee??7n)];
