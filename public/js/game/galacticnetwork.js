import {db} from '../gamedata.js';
const INF=0xffffffff,key=x=>String(x||'').toUpperCase(),edgeCache=new WeakMap();
function edges(g){
  const n=g.planets.length,radius=db.constants.num('MaximumFleetMovementDistance',100);let e=edgeCache.get(g);
  if(e&&e.n===n&&e.routes===g.routes&&e.routeCount===g.routes.length&&e.radius===radius&&g.planets.every((p,i)=>p.type===e.types[i]&&p.pos===e.pos[i]))return e;
  const routes=new Map();for(const r of g.routes){routes.set(r.a+':'+r.b,r);routes.set(r.b+':'+r.a,r);}
  const dist=new Int32Array(n*n).fill(-1);
  for(let i=0;i<n;i++){const a=g.planets[i],z=a.type.num('Layer_Z_Adjust',0);for(let j=0;j<n;j++){
    if(i===j)continue;const b=g.planets[j];
    let distance=Math.hypot(b.pos[0]-a.pos[0],b.pos[1]-a.pos[1],b.pos[2]+z-a.pos[2]);const route=routes.get(i+':'+j);
    if(route)distance/=route.type.num('HS_Speed_Factor',1);else if(distance>radius)continue;
    dist[i*n+j]=Math.trunc(distance*10)&65535;
  }}
  e={n,dist,radius,routes:g.routes,routeCount:g.routes.length,types:g.planets.map(p=>p.type),pos:g.planets.map(p=>p.pos)};edgeCache.set(g,e);return e;
}
export class GalacticNetwork {
  constructor(ai){this.ai=ai;this.cache=new Map();}
  matrix(controller){
    const g=this.ai.game.galaxy,id=controller.player.faction,old=this.cache.get(id);if(old&&g.time-old.time<3)return old;
    const n=g.planets.length,{dist}=edges(g),view=this.ai.forces();
    const usable=p=>!p.background&&!p.destroyed&&!p.restricted&&(g.autoReveal!==false||p.revealed),power=g.planets.map(p=>view.total(id,false,true,null,p)+(p.station&&view.related(id,p.stationOwner||p.owner,false)?p.station.num('AI_Combat_Power',0):0));
    const U=[],use=new Uint8Array(n),weight=new Int32Array(n);for(let i=0;i<n;i++){if(usable(g.planets[i])){use[i]=1;U.push(i);}weight[i]=Math.trunc(power[i]/100)<<16;}
    if(old&&old.n===n&&old.dist===dist&&old.use&&old.use.every((v,i)=>v===use[i])&&old.weight.every((v,i)=>v===weight[i])){const result={...old,time:g.time};this.cache.set(id,result);return result;}
    const cost=new Uint32Array(n*n).fill(INF),prev=new Int32Array(n*n).fill(-1);
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const at=i*n+j;if(i===j){cost[at]=0;continue;}if(!use[i]||!use[j])continue;const d=dist[at];if(d<0)continue;
      cost[at]=(weight[j]+d)>>>0;prev[at]=i;
    }
    const m=U.length,u=Int32Array.from(U);
    for(let kk=0;kk<m;kk++){const k=u[kk],kn=k*n;
      for(let ii=0;ii<m;ii++){const i=u[ii],row=i*n,ik=cost[row+k];if(ik===INF)continue;
        for(let jj=0;jj<m;jj++){const j=u[jj],kj=cost[kn+j];if(kj===INF)continue;const at=row+j,value=(ik+kj)>>>0;if(value<cost[at]){cost[at]=value;prev[at]=prev[kn+j];}}
      }
    }
    const result={time:g.time,n,cost,prev,use,weight,dist};this.cache.set(id,result);return result;
  }
  path(owner,from,to){
    const controller=this.ai.controllers.get(key(owner));if(!controller||!from||!to)return [];
    if(from===to)return [from,to];const {n,prev}=this.matrix(controller),out=[to];let at=to.index;
    while(at!==from.index){at=prev[from.index*n+at];if(at<0||out.length>n)return [];out.unshift(this.ai.game.galaxy.planets[at]);}return out;
  }
}
