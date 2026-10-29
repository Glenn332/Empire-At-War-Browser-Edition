import {db} from '../gamedata.js';
import {iconUrl} from '../icons.js';
import {loadTextureCanvas} from '../dds.js';
import {openDialog} from './dialogs.js';
import {toMainMenu} from './transit.js';
export async function campaignScore(game,result){
  const won=result.player.toUpperCase()===game.me.toUpperCase(),faction=db.faction(game.me);
  const d=await openDialog('IDD_CAMPAIGN_SCORE_DIALOG',{nativeImages:true,nativeFonts:true,nativeLists:true});
  if(!d)return null;
  game.campaignScore=d;d.show('IDC_DIALOG_CLOSE_BUTTON',false);
  d.setText('IDC_VICTORY_STATIC',()=>db.t(won?'TEXT_VICTORY':'TEXT_DEFEAT'));
  d.textList('IDC_VICTORY_LIST',()=>db.t(faction.str(won?'Victory_Text':'Defeat_Text')));
  const ids=['IDC_TITLE_STATIC','IDC_MILITARY_EFFICIENCY_STATIC','IDC_CONQUEST_EFFICIENCY_STATIC','IDC_KILL_EFFICIENCY_STATIC'];
  for(const id of ids){
    const host=game.story,inst=host?.scoring;
    const value=inst&&host.vm.call(inst.env,'Get_Game_Stat_For_Control_ID',host.player(game.me),id,false);
    const score=value?.ok?value.value:undefined;
    d.setText(id,()=>id==='IDC_TITLE_STATIC'?db.t(typeof score==='string'?score:''):typeof score==='number'?String(Math.max(0,Math.min(100,Math.trunc(score*100)))):'0%');
  }
  const image=faction.str((Math.random()<.5?'Space_':'Land_')+(won?'Win_Image':'Lose_Image'));
  if(image){const url=iconUrl(image)||(await loadTextureCanvas(image).catch(()=>null))?.toDataURL();if(game.campaignScore===d&&url)d.setImage('IDC_BATTLE_VICTORY_IMAGE',url);}
  d.imageFrame('IDC_BATTLE_VICTORY_IMAGE',false);
  d.setText('IDC_QUIT_BUTTON',()=>db.t('TEXT_BUTTON_MAIN_MENU'));
  const quit=()=>toMainMenu(),button=d.ctl('IDC_QUIT_BUTTON');
  if(button){button.setAttribute('role','button');button.tabIndex=0;button.onkeydown=e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();quit();}};button.focus();}
  d.on('IDC_QUIT_BUTTON',quit);
  return d;
}
