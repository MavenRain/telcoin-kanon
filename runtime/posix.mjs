import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

// One helper owns every descriptor in a session, including process-owned locks.
export function createPosixHost({python='python3'}={}) {
  const child=spawn(python,['-u',fileURLToPath(new URL('./posix.py',import.meta.url))],{stdio:['pipe','pipe','pipe']});
  const pending=[];
  let failed=null,closing=false,stderr='';
  const fail=error=>{
    failed??=error;
    for(const waiter of pending.splice(0)) waiter.reject(failed);
  };
  const exited=new Promise(resolve=>{
    child.once('error',error=>{fail(error);resolve({error});});
    child.once('close',(code,signal)=>{
      if(!closing||pending.length||code!==0) fail(new Error(`POSIX helper exited (${code??signal}): ${stderr}`));
      resolve({code,signal});
    });
  });
  child.stdin.on('error',fail);
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4096);});
  createInterface({input:child.stdout}).on('line',line=>{
    const waiter=pending.shift();
    if(!waiter) {fail(new Error('Unexpected POSIX helper reply.'));child.kill();return;}
    try {
      const value=JSON.parse(line);
      const bytes=field=>{
        if(typeof value[field]!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value[field]))
          throw new Error(`Malformed POSIX reply field ${field}.`);
        return Buffer.from(value[field],'base64');
      };
      switch(value.kind) {
        case 'ok':waiter.resolve({kind:'ok',scalar:bytes('scalar'),body:bytes('body')});break;
        case 'unix':
          if(typeof value.errno!=='string') throw new Error('Malformed POSIX errno.');
          waiter.resolve({kind:'unix',errno:value.errno,message:bytes('message')});break;
        case 'sys':waiter.resolve({kind:'sys',message:bytes('message')});break;
        default:throw new Error('Malformed POSIX reply kind.');
      }
    } catch(error) {waiter.reject(error);fail(error);child.kill();}
  });
  return {
    dispatch(request) {
      if(failed||closing) return Promise.reject(failed??new Error('POSIX host is closed.'));
      const bytes=value=>Buffer.from(value).toString('base64');
      const line=JSON.stringify({op:request.op,args:request.args.map(bytes),body:bytes(request.body??Buffer.alloc(0))})+'\n';
      return new Promise((resolve,reject)=>{
        pending.push({resolve,reject});
        child.stdin.write(line,error=>{if(error) fail(error);});
      });
    },
    async close() {
      if(!closing) {closing=true;child.stdin.end();}
      await exited;
      if(failed) throw failed;
    },
  };
}
