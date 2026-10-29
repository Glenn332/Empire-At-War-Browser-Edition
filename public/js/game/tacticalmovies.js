import {db} from '../gamedata.js';
import {fetchBinary} from '../vfs.js';
import {BinkPlayer} from '../bink.js';
import {TacticalCrawl} from './tacticalcrawl.js';
import {movieDefinitions} from './galacticmovies.js';
const yes=value=>/^(yes|true|1)$/i.test(value||'');
export class TacticalMovies {
  constructor(game,scripts,{createCrawl=name=>TacticalCrawl.create(name)}={}){
    this.createCrawl=createCrawl;this.crawl=null;
    this.game=game;this.scripts=scripts;this.active=false;this.pausesMode=false;this.generation=0;this.movie=null;this.frame=0;
    this.canvas=document.createElement('canvas');this.canvas.hidden=true;
    this.canvas.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9';
    document.body.appendChild(this.canvas);
    this.player=new BinkPlayer(this.canvas,{onEnd:()=>this.finish(),onError:error=>{console.warn('Tactical movie',error);this.finish();}});
  }
  play(name){
    this.stop();const generation=this.generation;this.active=true;
    this.open(name,generation);
    return {__wrap:true,__name:'BinkMovieBlockStatus',Is_Valid:()=>true,IsFinished:()=>!this.active,Result:()=>true};
  }
  async open(name,generation){
    try{
      const movie=(await movieDefinitions()).get(String(name||'').toUpperCase());
      if(generation!==this.generation)return;
      if(!movie){this.finish();return;}
      this.movie=movie;this.pausesMode=yes(movie.val('Pause_Game_While_Playing'));
      if(yes(movie.val('Halt_Game_Music')))this.game.audio?.stopMusic();
      if(movie.val('Text_Crawl_Name')){
        const crawl=await this.createCrawl(movie.val('Text_Crawl_Name')).catch(error=>{console.warn('Text crawl',error);return null;});
        if(generation!==this.generation){crawl?.dispose();return;}
        this.crawl=crawl;
      }
      if(yes(movie.val('Has_Credits')))this.scripts.missing.set('Movie.Credits',1);
      const buffer=await fetchBinary(movie.val('Movie_File'));
      if(generation!==this.generation)return;
      if(!buffer){this.finish();return;}
      await this.player.play(buffer,{alpha:yes(movie.val('Alpha')),startFrame:movie.num('Movie_Start_Frame',0)});
      if(generation!==this.generation)return;
      this.frame=0;this.canvas.hidden=false;
    }catch(error){if(generation===this.generation){console.warn('Tactical movie',error);this.finish();}}
  }
  update(dt,paused){
    if(!this.active)return;
    this.player.setPaused(paused);this.player.update(dt);
    if(!this.active||this.player.frame<0)return;
    this.crawl?.update(this.player.frame+1-this.movie.num('Text_Crawl_Start_Frame',0));
    const frame=this.player.frame+1,old=this.frame;this.frame=frame;
    for(const [tag,emit]of [
      ['SFXEvent_Frame',name=>this.game.audio?.play(name)],
      ['SpeechEvent_Frame',name=>this.game.audio?.speech?.replace(name)],
      ['MusicEvent_Frame',name=>{const event=db.music.get(name.toUpperCase());const a=this.game.audio;if(!event)return;if(a?.playMusicEvent)a.playMusicEvent(event,12);else a?.setPlaylist(event.list('Files'),false,true);}]
    ]){
      const entry=this.movie.all(tag).map(node=>node.text.trim().split(/[\s,]+/)).find(([name,at])=>name&&old<+at&&+at<=frame);
      if(entry)emit(entry[0]);
    }
  }
  finish(){this.crawl?.dispose();this.crawl=null;this.active=false;this.pausesMode=false;this.movie=null;this.canvas.hidden=true;}
  stop(){this.generation++;this.player.stop();this.finish();}
  dispose(){this.stop();this.player.dispose();this.canvas.remove();}
}
