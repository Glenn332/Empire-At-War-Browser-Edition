import {db} from '../gamedata.js';
import { simRandom } from './simrandom.js';
const key=x=>String(x||'').toUpperCase(),f=Math.fround;
export const isTacticalSuperweapon=t=>!!t?.behaviors().has('TACTICAL_SUPER_WEAPON');
export const isSuperweaponTarget=t=>!!t?.behaviors().has('DUMMY_TACTICAL_SUPER_WEAPON_TARGET');
const faction=o=>key(o.player?.factionName||o.owner||'Neutral');
export class TacticalSuperweapons {
  constructor(world,{planet=null,defender=null,destroyPlanet=()=>false,replace=()=>{},music=()=>{},voice=()=>{},requestVictory=()=>{},resetHUD=()=>{},camera=()=>{},random=simRandom}={}){
    this.world=world;this.planet=planet;this.defender=defender;this.destroyPlanet=destroyPlanet;this.replace=replace;this.music=music;this.voice=voice;this.requestVictory=requestVictory;this.resetHUD=resetHUD;this.random=random;
    this.camera=camera;this.units=[];this.targets=[];this.records=new WeakMap();this.disableDepth=0;this.events=[];this.frame=0;this.destroyed=false;this.destroyer=null;
  }
  add(unit){
    if(!isTacticalSuperweapon(unit.type)||this.records.has(unit))return;
    const r={unit,state:0,initialized:false,target:null,targetType:null,speed:0,acceleration:0,left:0,previousDistance:0,transform:null};
    this.units.push(unit);this.records.set(unit,r);unit.noAI=true;
  }
  addTarget(target){if(isSuperweaponTarget(target.type)&&!this.targets.includes(target))this.targets.push(target);}
  record(unit){return this.records.get(unit);}
  first(player){const unit=this.units.find(u=>!u.dead);return unit&&(!player||unit.player===player)?unit:null;}
  eligible(){return !!this.planet&&!this.planet.destroyed&&this.planet.type.bool('Planet_Is_Destroyable_By_TSW',true);}
  ready(unit){return this.record(unit)?.state===4;}
  nearest(unit){let target=null,best=Infinity;for(const t of this.targets){if(t.dead||faction(t)===faction(unit))continue;const distance=(t.x-unit.x)**2+(t.y-unit.y)**2+(t.z-unit.z)**2;if(distance<best){best=distance;target=t;}}return target;}
  approach(unit){
    const r=this.record(unit);if(!r||r.state!==0||!this.eligible())return false;
    const target=this.nearest(unit);if(!target)return false;
    r.target=target;r.targetType=target.type;r.state=2;return true;
  }
  fire(unit){
    const r=this.record(unit);if(!r||r.state!==4||!r.target||r.target.dead||!this.eligible())return false;
    this.camera(unit,r.target);
    r.state=5;r.left=Math.trunc(f(30*unit.type.num('TSW_Power_Up_Countdown_Seconds',0)));
    this.disableDepth++;
    for(const tag of ['TSW_SFXEvent_Activate_Voice','TSW_SFXEvent_Weapon_Power_Up'])this.world.audio?.play(unit.type.str(tag));
    this.music(unit.type.str('TSW_MusicEvent_Activation_Start'));
    return true;
  }
  command(unit,player,sound=true){
    const r=this.record(unit);if(!r||unit.dead||unit.player!==player||!this.eligible()||![0,4].includes(r.state))return false;
    this.events.push({unit,player,command:r.state===0?1:2});if(sound)this.world.audio?.play(unit.type.str('TSW_SFXEvent_GUI_Bttton_Press'));return true;
  }
  face(r){const u=r.unit,t=r.target;if(t){u.heading=Math.atan2(t.y-u.y,t.x-u.x);u.syncObj?.();}}
  distance(r){const u=r.unit,t=r.target;return t?Math.hypot(t.x-u.x,t.y-u.y,t.z-u.z):0;}
  initialize(r){
    const u=r.unit;r.initialized=true;const target=this.nearest(u);u.heading=0;u.syncObj?.();if(!target)return;
    const defender=u.player.team===this.defender,distance=u.type.num(defender?'TSW_Attack_Distance_From_Target':'TSW_Start_Distance_From_Target',0),length=Math.hypot(u.x-target.x,u.y-target.y,u.z-target.z);
    if(distance>0){const scale=length?distance/length:0;u.x=f(target.x+f((u.x-target.x)*scale));u.y=f(target.y+f((u.y-target.y)*scale));u.z=u.type.bool('TSW_Start_Pos_Match_Targets_Z')?target.z:f(target.z+f((u.z-target.z)*scale));u.z=f(u.z+u.type.num('TSW_Z_Adjust_Relative_To_Target_Pos',0));u.syncObj?.();}
    if(defender){r.state=4;r.target=target;}else this.approach(u);
  }
  move(r){
    const u=r.unit,t=r.target;if(!t)return false;
    const distance=this.distance(r),max=f(u.type.num('Max_Speed',0)*(u.bonus?.speed??1)*(u.mods?.speed??1));
    r.speed=f(Math.max(0,Math.min(max,f(r.speed+r.acceleration))));
    if(r.speed>0&&distance>0){const scale=r.speed/distance;u.x=f(u.x+f((t.x-u.x)*scale));u.y=f(u.y+f((t.y-u.y)*scale));u.z=f(u.z+f((t.z-u.z)*scale));u.syncObj?.();}
    const before=r.previousDistance;r.previousDistance=Math.max(0,this.distance(r)-u.type.num('TSW_Attack_Distance_From_Target',0));
    if(r.speed===max&&max>0)for(const threshold of [5,15,30,60])if(before/max/30-2>threshold&&r.previousDistance/max/30-2<=threshold)this.voice(u,threshold);
    return distance<=u.type.num('TSW_Attack_Distance_From_Target',0);
  }
  update(){
    if(!this.units.length)return;
    this.frame++;
    const events=this.events;this.events=[];
    for(const e of events)if(!e.unit.dead&&e.unit.player===e.player)(e.command===1?this.approach(e.unit):this.fire(e.unit));
    for(const u of this.units){
      if(u.dead)continue;const r=this.record(u);if(!r.initialized)this.initialize(r);
      if(r.target?.dead&&r.state<9){r.target=null;r.state=0;}
      switch(r.state){
        case 1:{const target=this.nearest(u);if(target){r.target=target;r.targetType=target.type;r.state=2;}break;}
        case 2:this.face(r);r.state=3;r.speed=0;r.acceleration=u.type.num('Max_Thrust',0);r.previousDistance=Math.max(0,this.distance(r)-u.type.num('TSW_Attack_Distance_From_Target',0));break;
        case 3:if(this.move(r)){r.state=4;r.acceleration=-u.type.num('Max_Thrust',0);this.voice(u,0);}break;
        case 4:this.move(r);break;
        case 5:if(--r.left<=0){r.left=0;r.state=6;}break;
        case 6:r.state=7;break;
        case 7:u.playAnim?.('ATTACK');this.world.audio?.play(u.type.str('SFXEvent_Fire'));this.face(r);r.state=8;r.left=Math.trunc(f(30*u.type.num('TSW_Attack_Anim_Duration_Seconds',0)));break;
        case 8:if(--r.left<=0){r.left=0;r.state=9;}break;
        case 9:{
          const t=r.target;if(!t){r.state=0;break;}
          r.state=10;r.left=Math.trunc(u.type.num('TSW_Explosion_Debris_Creation_Frame_Delay',0));
          r.transform={x:t.x,y:t.y,z:t.z,rotation:t.rotation?.slice()||[0,0,0],scale:t.scale??1};
          u.target=null;
          u.anim=null;
          if(u.model){for(const [i,bone]of u.model.bones.entries()){const rest=bone.userData.rest;if(rest){bone.position.copy(rest.p);bone.quaternion.copy(rest.q);bone.scale.copy(rest.s);}bone.visible=u.model.model.bones[i].visible;bone.userData.animHid=!bone.visible;}u.model.syncFromBones();}
          const clones=t.type.list('Death_Explosions'),clone=clones.length?db.type(clones[Math.floor(this.random()*clones.length)]):null;
          if(clone)this.replace(clone,r.transform,true);
          this.world.audio?.play(t.type.str('Death_SFXEvent_Start_Die'));
          t.dead=true;t.remove?.();
          const leader=this.destroyPlanet(u);this.destroyed=true;this.destroyer=u;
          if(leader)this.requestVictory(u.player.team,16,30);
          break;
        }
        case 10:if(--r.left<=0){
          for(const name of r.targetType?.list('Death_By_TSW_Replacements')||[]){const type=db.type(name);if(type)this.replace(type,r.transform,false);}
          r.state=12;r.left=Math.trunc(u.type.num('TSW_Post_Destruction_Wait_Frames',0));
        }break;
        case 12:if(--r.left<=0){r.left=0;r.state=13;}break;
        case 13:r.state=0;r.target=null;r.targetType=null;this.resetHUD();this.music('');if(this.disableDepth>0)this.disableDepth--;break;
      }
    }
  }
}
