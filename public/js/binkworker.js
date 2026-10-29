import { FFMPEG } from './deploy.js';
import { binkHeader } from './binkdata.js';

const WRITTEN = 0, READ = 1, STOP = 2, DONE = 3;
let corePromise,core,job,header,id,chain=Promise.resolve();
class Stopped extends Error {}
async function ready() {
  if(!corePromise)corePromise=import(FFMPEG).then(m=>m.default()).then(c=>{
    core=c;core.setLogger(({message})=>{if(job&&!/^Aborted/.test(message))job.errors.push(message);});
    const dev=core.FS.makedev(200,0);
    core.FS.registerDevice(dev,{write(stream,buffer,offset,length){
      let at=offset,left=length;
      while(left){
        if(job.ring){
          const r=job.ring,size=r.frameBytes;
          while(Atomics.load(r.ctrl,WRITTEN)-Atomics.load(r.ctrl,READ)>=r.slots){
            if(Atomics.load(r.ctrl,STOP))throw new Stopped('stopped');
            Atomics.wait(r.ctrl,READ,Atomics.load(r.ctrl,READ),250);
          }
          if(Atomics.load(r.ctrl,STOP))throw new Stopped('stopped');
          const slot=Atomics.load(r.ctrl,WRITTEN)%r.slots,count=Math.min(left,size-job.offset);
          r.pixels.set(buffer.subarray(at,at+count),slot*size+job.offset);job.offset+=count;at+=count;left-=count;
          if(job.offset===size){job.offset=0;Atomics.add(r.ctrl,WRITTEN,1);Atomics.notify(r.ctrl,WRITTEN);}
          continue;
        }
        const count=Math.min(left,job.pixels.length-job.offset);
        job.pixels.set(buffer.subarray(at,at+count),job.offset);job.offset+=count;at+=count;left-=count;
        if(job.offset===job.pixels.length){
          const pixels=job.pixels.buffer;postMessage({type:'frame',id,index:job.index++,pixels},[pixels]);
          job.pixels=new Uint8Array(header.width*header.height*4);job.offset=0;
        }
      }
      return length;
    }});
    core.FS.mkdev('/frames',0o666,dev);return core;
  });
  return corePromise;
}

async function handle(data) {
  await ready();
  if(data.type==='open'){
    id=data.id;header=binkHeader(data.buffer);core.FS.writeFile('/movie.bik',new Uint8Array(data.buffer));
    postMessage({type:'ready',id,header});return;
  }
  if(data.id!==id)return;
  if(data.type==='stream'){
    const ctrl=new Int32Array(data.control),ring={ctrl,pixels:new Uint8Array(data.pixels),slots:data.slots,frameBytes:header.width*header.height*4};
    job={ring,offset:0,errors:[]};
    let result=1,stopped=false;
    try{
      result=core.exec('-v','error',...(data.start?['-ss',String(data.start/header.fps)]:[]),'-i','/movie.bik','-map','0:v:0',
        '-an','-pix_fmt','rgba','-f','rawvideo','/frames');
    }catch(error){if(error instanceof Stopped)stopped=true;else job.errors.push(error.message);}
    core.reset();
    if(!stopped&&result!==0&&!Atomics.load(ctrl,STOP)){const message=job.errors.join('\n')||'Bink decoder failed';Atomics.store(ctrl,DONE,2);Atomics.notify(ctrl,DONE);job=null;throw Error(message);}
    Atomics.store(ctrl,DONE,1);Atomics.notify(ctrl,DONE);job=null;return;
  }
  if(data.type!=='decode')return;
  job={index:data.start,pixels:new Uint8Array(header.width*header.height*4),offset:0,errors:[]};
  const result=core.exec('-v','error','-ss',String(data.start/header.fps),'-i','/movie.bik','-map','0:v:0',
    '-frames:v',String(data.count),'-an','-pix_fmt','rgba','-f','rawvideo','/frames');
  core.reset();
  if(result!==0)throw Error(job.errors.join('\n')||'Bink decoder failed');
  postMessage({type:'done',id,start:data.start,count:job.index-data.start});job=null;
}
self.onmessage=({data})=>{chain=chain.then(()=>handle(data)).catch(error=>{postMessage({type:'error',id:data.id,message:error.message});job=null;});};
