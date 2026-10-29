import {activeLanguage} from '../language.js';
import {linkedTacticalSetup,linkedMapLoaded,finishLinkedTactical} from './linktactical.js';
import {snapshotGalaxy} from './galaxy.js';
import {StoryFlags} from './storyflags.js';
export async function launchLinkedMission(game,request){
  if(game.linkedMission)return false;
  const session=linkedTacticalSetup(game,request);
  game.pendingLinkedTactical=null;
  game.planetInfo?.close();game.galacticLog?.close();game.storyDialog?.close();game.baseLayout?.close?.();game.menus?.closeAll();
  linkedMapLoaded(game.story,request);
  session.setup.campaign.storyPlots=game.story?.startTactical(game.galaxy.planets[request.planet],request.mode==='space')||[];
  session.setup.campaign.galaxy=snapshotGalaxy(game.galaxy);
  game.battle=null;
  game.modeSuspended=true;game.keys.clear();game.mouse.in=false;
  game.setUIPause('linked-tactical',true);
  session.music=game.audio?.music;session.musicPlaying=!!session.music&&!session.music.paused;
  session.audioRunning=game.audio?.ctx?.state==='running';
  session.music?.pause();game.audio?.setLoops([]);game.audio?.ctx?.suspend();
  const frame=session.frame=document.createElement('iframe');
  frame.title='Tactical battle';frame.allow='autoplay';
  frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483646;background:#000';
  session.coveredElements=Array.from(document.body.children||[]).map(element=>[element,element.inert]);
  for(const [element]of session.coveredElements)element.inert=true;
  game.linkedMission=session;
  const url=new URL('../../play.html',import.meta.url);url.searchParams.set('linked-tactical','1');
  url.searchParams.set('language',String(activeLanguage));
  frame.src=url.href;document.body.appendChild(frame);frame.focus();return true;
}
export function linkedMissionVictory(game,winner,flags){
  const session=game.linkedMission;if(!session||session.victoryReported)return;
  session.victoryReported=true;
  if(flags&&game.story)game.story.flags=new StoryFlags(flags);
  const name=session.setup.tacticalStoryPlot||session.setup.campaign.storyPlots.at(-1)?.name;
  if(winner!==game.me&&name)for(const e of game.story?.eventTypes.get('STORY_MISSION_LOST')||[])if(String(e.params[0]||'').split(',').some(n=>n.trim().toUpperCase()===name.toUpperCase()))game.story.fire(e);
  return game.story?.flags.snapshot();
}
export async function returnLinkedMission(game,result){
  const session=game.linkedMission;if(!session||session.returning)return false;
  session.returning=true;
  const child=session.frame.contentWindow.game;if(child)child.modeSuspended=true;
  try{
    finishLinkedTactical(game,session,result);
    game.linkedMission=null;
    game.mergeFleets();
    for(const fleet of game.galaxy.fleets)if(!game.fleetViews.has(fleet))await game.fleetView(fleet);
    await game.ai?.reconcile?.();
    game.ui?.refresh();game.overview?.refresh();game.radar?.refresh();
  }finally{
    if(game.linkedMission===session)game.linkedMission=null;
    closeLinkedDocument(game,session);
  }
  return true;
}
export function abortLinkedMission(game,error){
  const session=game.linkedMission;if(!session)return;
  game.linkedMission=null;game.battle=null;
  game.story?.errors.set('LINK_TACTICAL',String(error?.message||error));
  closeLinkedDocument(game,session);
}
function closeLinkedDocument(game,session){
  const child=session.frame.contentWindow.game;
  if(child){child.paused=true;child.over=true;child.tacticalMovies?.dispose();child.tacticalCinematics?.stop();child.audio?.stopMusic();child.audio?.ctx?.close();
    const renderer=child.renderer?.renderer||child.renderer;renderer?.dispose?.();renderer?.forceContextLoss?.();}
  session.frame.remove();
  for(const [element,inert]of session.coveredElements||[])element.inert=inert;
  game.setUIPause('linked-tactical',false);if(session.audioRunning)game.audio?.ctx?.resume();
  if(session.musicPlaying&&game.audio?.music===session.music)session.music.play().catch(()=>{});
  if(game.fadeEl)game.fadeEl.style.opacity='0';
  game.modeSuspended=false;game.last=performance.now();game.fit();
  requestAnimationFrame(game.frame);
}
