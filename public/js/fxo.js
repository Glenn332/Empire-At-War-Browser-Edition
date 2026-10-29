export function effectInfo(buffer) {
  const out={samplers:new Map(),techniques:[]},v=new DataView(buffer),n=v.byteLength;
  const u=at=>{if(at<0||at+4>n)throw new Error('FXO offset');return v.getUint32(at,true);};
  const text=(at,length)=>{if(length>65536||at+length>n)throw new Error('FXO string');return new TextDecoder().decode(new Uint8Array(buffer,at,length)).replace(/\0.*$/s,'');};
  const str=offset=>text(12+offset,u(8+offset));
  try {
    if(u(0)!==0xfeff0901)return out;
    let cursor=8+u(4);const count=u(cursor),techniques=u(cursor+4),parameters=new Map(),strings=new Map(),pending=[];
    if(count>4096||techniques>4096)throw new Error('FXO counts');cursor+=16;
    const annotations=count=>{
      if(count>4096)throw new Error('FXO annotations');const result={};
      for(let i=0;i<count;i++){
        const type=8+u(cursor),value=8+u(cursor+4),name=str(u(type+8));cursor+=8;
        if(u(type)===4&&u(type+4)===4)pending.push({result,name,id:u(value)});
        else if(u(type)===1||u(type)===2)result[name]=u(value);
        else if(u(type)===3)result[name]=v.getFloat32(value,true);
      }
      return result;
    };
    const states=(at,count,index)=>{
      if(count>4096)throw new Error('FXO states');const list=[];
      for(let j=0;j<count;j++){
        const p=at+j*16,id=u(p),stage=u(p+4),type=8+u(p+8),value=8+u(p+12);
        const literal=(u(type)===2||u(type)===3)&&u(type+4)===2&&u(type+16)===0&&u(type+20)===1&&u(type+24)===1;
        list.push({id,index:stage,value:literal&&(index===undefined||stage===index)?u(value):undefined});
      }
      return list;
    };
    for(let i=0;i<count;i++){
      const type=8+u(cursor),value=8+u(cursor+4),a=u(cursor+12);cursor+=16;annotations(a);
      if(u(type)<10||u(type)>14||u(type+4)!==4)continue;
      const list=states(value+4,u(value),0x100),values=new Map(list.filter(s=>s.value!==undefined).map(s=>[s.id,s.value]));
      out.samplers.set(str(u(type+8)),values);parameters.set(i,{list,values});
    }
    for(let i=0;i<techniques;i++){
      const name=str(u(cursor)),a=u(cursor+4),passes=u(cursor+8);cursor+=12;
      if(passes>4096)throw new Error('FXO passes');
      const technique={name,annotations:annotations(a),passes:[]};out.techniques.push(technique);
      for(let j=0;j<passes;j++){
        const name=str(u(cursor)),a=u(cursor+4),count=u(cursor+8);cursor+=12;
        const annotation=annotations(a),list=states(cursor,count);cursor+=count*16;
        technique.passes.push({name,annotations:annotation,states:list});
      }
    }
    const stringCount=u(cursor),resources=u(cursor+4);cursor+=8;
    if(stringCount>65536||resources>65536)throw new Error('FXO resources');
    for(let i=0;i<stringCount;i++){const id=u(cursor),size=u(cursor+4);strings.set(id,text(cursor+8,size));cursor+=8+Math.ceil(size/4)*4;}
    for(let i=0;i<resources;i++){
      const technique=u(cursor),parameter=u(cursor+4),state=u(cursor+12),size=u(cursor+20);cursor+=24+Math.ceil(size/4)*4;
      if(cursor>n)throw new Error('FXO resource');
      if(technique===0xffffffff){const p=parameters.get(parameter);if(p)p.values.delete(p.list[state]?.id);}
      else {const s=out.techniques[technique]?.passes[parameter]?.states[state];if(s)s.value=undefined;}
    }
    for(const {result,name,id}of pending)if(strings.has(id))result[name]=strings.get(id);
  }catch{out.samplers.clear();out.techniques.length=0;}
  return out;
}

export const effectSamplers=buffer=>effectInfo(buffer).samplers;
export const effectLOD=name=>({FIXEDFUNCTION:0,DX8:1,DX8ATI:2,DX9:3}[name]??3);
export function selectEffectTechnique(effect,detail,{water=3,vendor=0,validate=()=>true}={}) {
  return effect.techniques.find(t=>t.name!=='max_viewport'&&effectLOD(t.annotations.LOD)<=detail
    &&(t.annotations.WaterLOD===undefined||effectLOD(t.annotations.WaterLOD)<=water)
    &&!Array.from({length:10},(_,i)=>t.annotations['VENDOR_FILTER_'+i]).some(id=>id!==undefined&&id===vendor)
    &&validate(t))||null;
}
