import {driverOracleSources} from './driver-oracle-sources.mjs';
const extra=[...['io_ops','io','frame','store_lock','atomic_file','append_log'].map(name=>`lib/durable/${name}.ml`),
  'lib/durable_store/record_codec.ml','lib/durable_store/consensus_store_disk.ml',
  'lib/durable_checkpoint/checkpoint_codec.ml','lib/durable_checkpoint/checkpoint_file.ml'];
export const durableDiskOracleSources={...driverOracleSources,
  packages:driverOracleSources.packages+',unix',
  sources:[...driverOracleSources.sources,...extra],
  modules:[...driverOracleSources.modules,...extra.map(path=>path.split('/').at(-1)),
    'tn_driver.ml','tn_durable.ml','tn_durable_store.ml'],
  extraAliases:{...driverOracleSources.extraAliases,'tn_driver.ml':['Chain_spec','Checkpoint','Driver'],
    'tn_durable.ml':['Io_ops','Io','Frame','Store_lock','Atomic_file','Append_log'],
    'tn_durable_store.ml':['Consensus_store_disk']},
};
