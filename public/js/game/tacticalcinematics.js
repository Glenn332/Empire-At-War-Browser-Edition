import {cameraEase} from './tacticalsuperweaponcamera.js';
import {TACTICAL_CAMERA_DEFAULTS} from './tacticalcameradata.js';

const RATE=30;
export const SPACE_LAYER=20000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const lead=e=>e?.members?.[0]||e?.fighters?.[0]||e;
const copy=p=>({x:p.x,y:p.y,z:p.z||0});
export function cinematicOffset(a,b,c,polar){
  if(!polar)return {x:a,y:b,z:c};
  const pitch=b*Math.PI/180,yaw=c*Math.PI/180;
  return {x:a*Math.cos(pitch)*Math.sin(yaw),y:-a*Math.cos(pitch)*Math.cos(yaw),z:a*Math.sin(pitch)};
}
export function cinematicKeyPosition(key){
  const e=lead(key.entity),o=key.offset;
  if(!key.entity)return key.position;
  if(e&&!e.dead){
    const object=e.obj||e.holder||e.grp;
    object?.updateMatrixWorld?.(true);
    let matrix=object?.matrixWorld?.elements;
    if(key.muzzle){
      const bones=e.inst?.bones||e.model?.bones||[];
      const bone=bones.find(b=>b.name?.toUpperCase()==='MUZZLEA_00')||bones.find(b=>b.name?.toUpperCase()==='MUZZLEA_01');
      bone?.updateWorldMatrix?.(true,false);matrix=bone?.matrixWorld?.elements||matrix;
      key.last={x:(matrix?.[12]??e.x)+o.x,y:(matrix?.[13]??e.y)+o.y,z:(matrix?.[14]??e.z??0)+o.z};
    }else if(key.rotate&&matrix){
      key.last={x:matrix[0]*o.x+matrix[4]*o.y+matrix[8]*o.z+matrix[12],y:matrix[1]*o.x+matrix[5]*o.y+matrix[9]*o.z+matrix[13],z:matrix[2]*o.x+matrix[6]*o.y+matrix[10]*o.z+matrix[14]+(e.type?.num('Ranged_Target_Z_Adjust',0)||0)};
    }else{
      key.last={x:(matrix?.[12]??e.x)+o.x,y:(matrix?.[13]??e.y)+o.y,z:(matrix?.[14]??e.z??0)+o.z+(e.type?.num('Ranged_Target_Z_Adjust',0)||0)};
    }
  }
  return key.last||key.position;
}

export class TacticalCinematics{
  constructor(game,scripts){this.game=game;this.scripts=scripts;this.on=false;this.tick=0;this.elapsed=0;this.position=null;this.target=null;this.returning=false;}
  start(music=true){
    if(typeof music!=='boolean')return;
    if(this.on)this.stop();
    const g=this.game,c=g.landBattle?g.camera:g.renderer?.camera;if(!c)return;
    g.cine?.stop?.();this.camera=c;this.saved=c.clone(false);this.savedOverride=g.landBattle?null:g.renderer.cameraOverride;
    this.tick=0;this.elapsed=0;this.on=true;this.returning=false;
    const rig=g.landBattle?g.view:g.renderer.rig;
    const look={x:rig?.x??0,y:rig?.y??0,z:0};
    this.savedTarget=look;
    this.position={from:copy(c.position),to:null,start:0,end:0};this.target={from:look,to:null,start:0,end:0};
    c.near=1;c.far=10000;c.up.set(0,0,1);c.updateProjectionMatrix();
    if(typeof document!=='undefined')document.body.classList.add('cinematic');
    if(g.landBattle)g.hudTimer=0;
    if(!g.landBattle)g.renderer.cameraOverride=()=>this.paint();
    if(music)g.playCinematicMusic?.();
  }
  stop(){
    if(!this.on)return;this.on=false;this.returning=false;
    const aspect=this.camera.aspect;this.camera.copy(this.saved,false);this.camera.aspect=aspect;this.camera.updateProjectionMatrix();
    if(!this.game.landBattle)this.game.renderer.cameraOverride=this.savedOverride;
    else this.game.hudTimer=0;
    if(typeof document!=='undefined')document.body.classList.remove('cinematic');
  }
  key(channel,args,transition=false){
    if(!this.on||args.length<(transition?9:8))return;
    const p=this.scripts.at(args[0]);if(!p)return;
    const i=transition?2:1,seconds=transition?(finite(args[1])?args[1]:0):0;
    const [a,b,c]=args.slice(i,i+3).map(n=>finite(n)?n:0),offset=cinematicOffset(a,b,c,finite(args[i+3])&&args[i+3]>0);
    const entity=this.scripts.of(args[i+4]),key={position:{x:p.x+offset.x,y:p.y+offset.y,z:(p.z||0)+offset.z},offset,entity,rotate:finite(args[i+5])&&args[i+5]>0,muzzle:!!entity&&finite(args[i+6])&&args[i+6]>0,last:null};
    const duration=Math.trunc(RATE*seconds);
    const from=this.evaluate(channel);
    this[channel]=seconds>1/RATE?{from,to:key,start:this.tick,end:this.tick+duration}:{from:key,to:null,start:this.tick,end:this.tick};
    this.returning=false;this.paint();
  }
  evaluate(channel){
    const k=this[channel],read=v=>v?.position?cinematicKeyPosition(v):v;
    if(!k)return {x:0,y:0,z:0};
    const a=read(k.from);if(!k.to)return a;
    const b=read(k.to),t=cameraEase((this.tick-k.start)/(k.end-k.start),.5,.5);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
  }
  transitionToTactical(seconds){
    if(!this.on||!finite(seconds))return;
    const duration=Math.max(1,Math.trunc(RATE*seconds));
    this.position={from:copy(this.evaluate('position')),to:copy(this.saved.position),start:this.tick,end:this.tick+duration};
    this.target={from:copy(this.evaluate('target')),to:this.savedTarget,start:this.tick,end:this.tick+duration};
    this.returning=true;
  }
  update(dt){if(this.on){this.elapsed+=Math.max(0,dt);this.tick=Math.floor(this.elapsed*RATE+1e-6);}}
  paint(){
    if(!this.on)return;
    const p=this.evaluate('position'),t=this.evaluate('target'),c=this.camera;
    c.position.set(p.x,p.y,p.z);c.up.set(0,0,1);c.lookAt(t.x,t.y,t.z);c.updateMatrixWorld();
    const lens=this.game.tacticalCameraData||TACTICAL_CAMERA_DEFAULTS;
    if(c.near!==lens.near||c.far!==lens.far){c.near=lens.near;c.far=lens.far;c.updateProjectionMatrix();}
  }
  promote(value){
    const e=this.scripts.of(value);if(!e)return;
    if(this.game.landBattle&&this.scripts.cmd?.teleport){this.scripts.cmd.teleport(e,e.x,e.y,(e.z||0)+SPACE_LAYER);return;}
    const units=e.members?.length?e.members:e.fighters?.length?e.fighters:[e];
    for(const u of units){if(u.point)u.point.z=(u.point.z||0)+SPACE_LAYER;else u.z=(u.z||0)+SPACE_LAYER;const object=u.obj||u.holder||u.grp;if(object){object.position.z+=SPACE_LAYER;object.updateMatrixWorld(true);}u.syncObj?.();}
  }
}

export function installTacticalCinematics(game,scripts){
  const camera=game.tacticalCinematics=new TacticalCinematics(game,scripts),vm=scripts.vm;
  vm.global('Point_Camera_At',value=>{const at=scripts.at(value),rig=game.landBattle?game.view:game.renderer?.rig;if(at&&rig){rig.x=at.x;rig.y=at.y;}});
  vm.global('Start_Cinematic_Camera',(...args)=>camera.start(args.length?args[0]:true));
  vm.global('End_Cinematic_Camera',()=>camera.stop());
  vm.global('Set_Cinematic_Camera_Key',(...args)=>camera.key('position',args));
  vm.global('Set_Cinematic_Target_Key',(...args)=>camera.key('target',args));
  vm.global('Transition_Cinematic_Camera_Key',(...args)=>camera.key('position',args,true));
  vm.global('Transition_Cinematic_Target_Key',(...args)=>camera.key('target',args,true));
  vm.global('Transition_To_Tactical_Camera',seconds=>{if(seconds!==undefined)camera.transitionToTactical(finite(seconds)?seconds:1);});
  vm.global('Promote_To_Space_Cinematic_Layer',value=>camera.promote(value));
  return camera;
}
