import { startStrategicMusic } from './galacticmusic.js';
export function pauseGalactic(game,on) {
  const count=game.galacticPauseCount||0;
  if(on){game.galacticPauseCount=count+1;if(!count)game.paused=true;}
  else if(count){game.galacticPauseCount=count-1;if(count===1){game.paused=false;startStrategicMusic(game);}}
}

export function userPauseGalactic(game,on) {
  on=!!on;if(game.userPaused===on||on&&game.galacticPauseCount>0)return;
  game.userPaused=on;pauseGalactic(game,on);game.setUIPause('player',on);game.showPauseShell?.(on);
}
