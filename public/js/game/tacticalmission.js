import {db} from '../gamedata.js';
import {installTacticalCinematics} from './tacticalcinematics.js';
import {CinematicTransports} from './cinematictransport.js';
import {TacticalMovies} from './tacticalmovies.js';
export function installTacticalMission(game,scripts){
  if(!scripts)return;
  const vm=scripts.vm,audio=game.audio;
  installTacticalCinematics(game,scripts);
  if(game.landBattle){
    game.cinematicTransports=new CinematicTransports(game);
    vm.global('Create_Cinematic_Transport',(...args)=>{if(args.length<8)return;args[2]=scripts.at(args[2]);return scripts.wrap(game.cinematicTransports.create(...args));});
  }
  vm.global('Set_Cinematic_Environment',on=>game.setCinematicEnvironment?.(on));
  game.tacticalMovies=new TacticalMovies(game,scripts);
  vm.global('Lock_Controls',(...args)=>{if(args.length)game.controlsLocked=typeof args[0]==='number'&&args[0]>0;});
  vm.global('Suspend_AI',on=>{game.world.aiSuspended=typeof on==='number'&&on>0;});
  vm.global('Weather_Audio_Pause',on=>{game.weatherAudioPaused=on===true;});
  vm.global('Play_Bink_Movie',name=>game.tacticalMovies.play(name));
  vm.global('Stop_Bink_Movie',()=>game.tacticalMovies.stop());
  let playlist=[];
  vm.global('Stop_All_Music',()=>{if(audio?.playlist?.length)playlist=audio.playlist.slice();audio?.stopMusic();});
  vm.global('Play_Music',name=>{const event=db.music.get(String(name||'').toUpperCase());if(!event)return;if(audio?.playMusicEvent)audio.playMusicEvent(event,12);else audio?.setPlaylist(event.list('Files'),false,true);});
  vm.global('Resume_Mode_Based_Music',()=>{if(playlist.length)audio?.setPlaylist(playlist);});
  vm.global('Stop_All_Speech',()=>audio?.speech?.stopActive());
}
