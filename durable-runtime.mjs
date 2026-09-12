import {byteAdapter} from './runtime.mjs';
export const durableHostExports = ['durableTaskIsDone','durableTaskOpBytes','durableTaskArgs','durableTaskBody',
  'durableArgsEmpty','durableArgsHead','durableArgsTail','durableTaskValueBytes','durableTaskFsyncBytes',
  'durableTaskWrittenBytes','durableTaskReplyOk','durableTaskReplyUnix','durableTaskReplySys'];
export function durableTaskAdapter(e) {
  const {toBytes,fromBytes}=byteAdapter(e);
  return {
    done:task=>e.durableTaskIsDone(task)===1,
    request(task) {
      if(e.durableTaskIsDone(task)) throw new Error('A completed durable task has no request.');
      const args=[];
      for(let values=e.durableTaskArgs(task);!e.durableArgsEmpty(values);values=e.durableArgsTail(values))
        args.push(fromBytes(e.durableArgsHead(values)));
      return {op:fromBytes(e.durableTaskOpBytes(task)).toString('ascii'),args,body:fromBytes(e.durableTaskBody(task))};
    },
    reply(task,reply) {
      switch(reply.kind) {
        case 'ok':return e.durableTaskReplyOk(task,toBytes(reply.scalar??''),toBytes(reply.body??Buffer.alloc(0)));
        case 'unix':return e.durableTaskReplyUnix(task,toBytes(reply.errno),toBytes(reply.message));
        case 'sys':return e.durableTaskReplySys(task,toBytes(reply.message));
        default:throw new TypeError('Unknown durable host reply kind.');
      }
    },
    result(task) {
      if(!e.durableTaskIsDone(task)) throw new Error('A pending durable task has no result.');
      return {task,value:fromBytes(e.durableTaskValueBytes(task)),
        fsyncs:BigInt(fromBytes(e.durableTaskFsyncBytes(task)).toString('ascii')),
        bytesWritten:BigInt(fromBytes(e.durableTaskWrittenBytes(task)).toString('ascii'))};
    },
  };
}
export async function runDurableTask(e,initial,dispatch) {
  const adapter=durableTaskAdapter(e);
  let task=initial;
  while(!adapter.done(task)) task=adapter.reply(task,await dispatch(adapter.request(task)));
  return adapter.result(task);
}
