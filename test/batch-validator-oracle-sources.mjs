import {txShapeOracleSources} from './tx-shape-oracle-sources.mjs';
export const batchValidatorOracleSources={
  ...txShapeOracleSources,
  sources:[...txShapeOracleSources.sources,'lib/batch/batch_validator.ml'],
  modules:[...txShapeOracleSources.modules,'batch_validator.ml'],
};
