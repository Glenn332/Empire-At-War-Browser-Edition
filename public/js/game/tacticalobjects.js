import {db} from '../gamedata.js';
export class TacticalMarker {
  constructor(object,owner){
    this.type=object.type;this.id=object.id;this.hint=object.hint||'';this.x=object.pos[0];this.y=object.pos[1];this.z=object.pos[2]||0;
    this.heading=(object.rot?.[2]||0)*Math.PI/180;this.owner=owner;this.dead=false;this.mapMarker=true;
    this.members=[];this.fighters=[];this.hardpoints=[];this.abilities=[];this.selectable=false;
  }
  get player(){return this.owner();}
  get scriptType(){return this.type;}
  get healthFrac(){return 1;}
  cats(){return this.type.categories();}
}
export const tacticalObjectType=object=>object?.scriptType||db.type(object?.type.str('Create_Team_Type'))||object?.type;
const hintTypes=new WeakMap();
function hasHint(type){
  let value=hintTypes.get(type);
  if(value===undefined){value=['Behavior','LandBehavior','SpaceBehavior'].some(tag=>type.list(tag).some(name=>name.toUpperCase()==='HINT'));hintTypes.set(type,value);}
  return value;
}
export function hintedObjects(host,type,hint){
  const world=host.world,map=host.game.map,out=[],name=typeof hint==='string'?hint.toUpperCase():null;
  if(!map)return out;
  for(const [index,placed]of map.objects.entries()){
    if(!placed.hint&&!hasHint(placed.type)||name!==null&&(placed.hint||'').toUpperCase()!==name)continue;
    const objects=world.mapObjectsAt?.(index)||world.mapObjects?.get(index)||(world.units||[]).filter(o=>o.mapIndex===index);
    for(const object of objects)if(object&&!object.dead&&(!type||tacticalObjectType(object)===type))out.push(object);
  }
  for(const entry of world.dynamicHints||world.w?.dynamicHints||[])if(!entry.object.dead&&(name===null||entry.hint.toUpperCase()===name)&&(!type||tacticalObjectType(entry.object)===type))out.push(entry.object);
  return out;
}
