import {db} from '../gamedata.js';
export class LinkedPresentation {
  constructor(options,height){this.alpha=options.faded?1:0;this.bar=options.letterbox?height:0;this.height=height;this.fade=null;this.slide=null;}
  fadeTo(visible,seconds){if(seconds===undefined)return;this.alpha=visible?1:0;this.fade={from:this.alpha,to:visible?0:1,seconds:Math.max(0,typeof seconds==='number'?seconds:0.5),elapsed:0};this.update(0);}
  bars(on,seconds){
    if(seconds===undefined)return;
    const target=on?this.height:0;if(this.slide?.to===target||!this.slide&&this.bar===target)return;
    let duration=Math.max(0,typeof seconds==='number'?seconds:0.5);
    if(this.slide)duration*=this.height?this.bar/this.height:0;
    this.slide={from:this.bar,to:target,seconds:duration,elapsed:0};this.update(0);
  }
  update(dt,modal=false){for(const [field,slot]of [['alpha','fade'],['bar','slide']]){const t=this[slot];if(!t||slot==='slide'&&modal)continue;t.elapsed+=Math.max(0,dt);const a=t.seconds?Math.min(1,t.elapsed/t.seconds):1;this[field]=t.from+(t.to-t.from)*a;if(a===1)this[slot]=null;}}
}
export function installLinkedPresentation(game,scripts){
  const options=game.setup.linkedTactical;if(!options)return;
  const fx=game.linkedPresentation=new LinkedPresentation(options,db.constants.num('Camera_FX_Manager_Letterbox_Height',.085));
  const mask=document.createElement('div');mask.style.cssText='position:fixed;inset:0;background:#000;pointer-events:none;z-index:8';document.body.appendChild(mask);
  const bars=['letterTop','letterBottom'].map(id=>document.getElementById(id)).filter(Boolean);
  for(const bar of bars)bar.style.transition='none';
  let lastAlpha,lastBar;
  fx.paint=()=>{if(fx.alpha!==lastAlpha){mask.style.opacity=String(fx.alpha);lastAlpha=fx.alpha;}if(fx.bar!==lastBar){for(const bar of bars)bar.style.height=fx.bar*100+'vh';lastBar=fx.bar;document.body.classList.toggle('letterboxed',fx.bar>0);}};fx.paint();
  if(scripts){const vm=scripts.vm;
    vm.global('Fade_Screen_In',seconds=>fx.fadeTo(true,seconds));vm.global('Fade_Screen_Out',seconds=>fx.fadeTo(false,seconds));
    vm.global('Letter_Box_In',seconds=>fx.bars(true,seconds));vm.global('Letter_Box_Out',seconds=>fx.bars(false,seconds));
    vm.global('Letter_Box_On',()=>{fx.slide=null;fx.bar=fx.height;});vm.global('Letter_Box_Off',()=>{fx.slide=null;fx.bar=0;});
    vm.global('Resume_Hyperspace_In',()=>{if(!game.landBattle)game.world.holdHyperspace=false;});
  }
}
