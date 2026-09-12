export function mockSyscalls({payload,counts='-',failures='-',fault}) {
  const remaining=counts==='-'?[]:counts.split(',').map(BigInt),failed=failures.split(','),hits=new Map(),trace=[];
  let position=0n;
  return {trace,dispatch({op,args,body}) {
    const a=args.map(value=>value.toString('utf8'));
    trace.push(`${op}|${args.map(value=>value.toString('hex')).join(',')}|${(op==='read'?body.subarray(0,Number(a[1])):body).toString('hex')}`);
    hits.set(op,(hits.get(op)??0)+1);
    if(failed.includes(`${op}:${hits.get(op)}`)) return fault;
    switch(op) {
      case 'open':return {kind:'ok',scalar:'7'};
      case 'write':return {kind:'ok',scalar:String(remaining.shift()??BigInt(a[2]))};
      case 'read':{
        const off=Number(a[1]),len=Number(a[2]),available=position>BigInt(payload.length)?0:payload.length-Number(position);
        const reported=remaining.shift()??BigInt(Math.min(len,available));
        const copied=Math.min(available,len,Number(reported<0n?0n:reported)),buffer=Buffer.from(body);
        payload.copy(buffer,off,Math.min(Number(position),payload.length),Math.min(Number(position),payload.length)+copied);
        position+=BigInt(copied);return {kind:'ok',scalar:String(reported),body:buffer};
      }
      case 'lseek':position=BigInt.asIntN(63,BigInt(a[1])+(a[2]==='end'?BigInt(payload.length):a[2]==='cur'?position:0n));return {kind:'ok',scalar:String(position)};
      case 'stat':return {kind:'ok',scalar:'true'};
      case 'realpath':return {kind:'ok',body:Buffer.concat([Buffer.from('/resolved/'),args[0]])};
      case 'close':case 'fsync':case 'ftruncate':case 'rename':case 'mkdir':case 'unlink':case 'lockf':return {kind:'ok'};
      default:throw new Error(`Unexpected syscall ${op}`);
    }
  }};
}
