import {isTacticalSuperweapon} from './tacticalsuperweapon.js';
export function tacticalAnnouncement(world,human,winner){
  const won=winner===human.team,ally=won,enemy=!won&&!!winner&&winner.id>=0;
  const enemyWeapon=world.units.some(u=>isTacticalSuperweapon(u.type)&&u.player.id>=0&&u.player.team!==human.team);
  const killer=world.units.some(u=>!u.dead&&u.player===human&&u.type.bool('Is_Super_Weapon_Killer'));
  let sound=null;
  if(won)sound=enemyWeapon?(killer?'SFXEvent_HUD_Won_Space_Battle_Enemy_TSW_Present':'Space_Forced_Retreat_Due_To_Superweapon'):'SFXEvent_HUD_Won_Space_Battle';
  else if(enemy)sound=enemyWeapon?'SFXEvent_HUD_Lost_Space_Battle_Enemy_TSW_Present':'SFXEvent_HUD_Lost_Space_Battle';
  return {sound,music:won?'Music_Event_Tactical_Win':'Music_Event_Tactical_Lose',text:ally?'TEXT_WIN_TACTICAL':enemy?'TEXT_LOSE_TACTICAL':null,ally};
}
export class TacticalVictory {
  constructor(notify=()=>{},{retry=()=>false,onRetry=()=>{}}={}){this.winner=null;this.finished=false;this.notify=notify;this.pending=[];this.retry=retry;this.onRetry=onRetry;}
  request(team,type=11,frames=210,disabled=0,suppressNotice=false){
    if(this.winner)return false;
    if(disabled){if(!this.pending.some(r=>r.team===team&&r.type===type))this.pending.push({team,type,frames,suppressNotice});return true;}
    this.winner={team,type,frames,suppressNotice,retry:!!this.retry(team)};this.notify(this.winner);return true;
  }
  release(){
    const pending=this.pending;this.pending=[];
    for(const r of pending)this.request(r.team,r.type,r.frames,0,r.suppressNotice);
  }
  update(disabled,test){
    if(this.finished)return null;
    if(!disabled&&this.pending.length)this.release();
    if(!this.winner&&!disabled)test();
    const r=this.winner;if(!r)return null;
    if(r.frames>0)r.frames--;
    if(r.retry&&r.frames<=1&&!disabled){r.frames=1;if(!r.retryShown){r.retryShown=true;this.onRetry();}return null;}
    if(r.frames>0||disabled)return null;
    this.finished=true;return r;
  }
}
