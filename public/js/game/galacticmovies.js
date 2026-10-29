import { db } from '../gamedata.js';
import { fetchText, fetchBinary } from '../vfs.js';
import { parseXML } from '../xml.js';
import { BinkPlayer } from '../bink.js';
import { uiBoneTransforms } from './hud.js';

const key = s => String(s || '').toUpperCase();
const vector = s => String(s || '').trim().split(/[\s,]+/).map(Number);
const yes = s => /^(yes|true|1)$/i.test(s || '');
let definitions;
export async function movieDefinitions() {
  if (!definitions) definitions = fetchText('Data/XML/Movies.xml').then(source => {
    const movies = new Map();
    const visit = node => { if (key(node.tag) === 'MOVIE' && node.attrs.Name) movies.set(key(node.attrs.Name), node); for (const child of node.children) visit(child); };
    visit(parseXML(source || '')); return movies;
  });
  return definitions;
}

export class GalacticMovies {
  constructor(game, hud) {
    this.game=game;this.generation=0;this.active=false;this.movie=null;
    const index=hud.model.bones.findIndex(b=>key(b.name)==='MOVIE_GALACTIC');
    const matrix=index>=0?uiBoneTransforms(hud.model)[index]:null;
    this.anchor=matrix?[matrix[3],matrix[7]]:null;
    this.canvas=document.createElement('canvas');this.canvas.className='galactic-commandbar-movie';this.canvas.hidden=true;
    this.canvas.style.cssText='position:fixed;pointer-events:none;z-index:7';document.body.appendChild(this.canvas);
    this.player=new BinkPlayer(this.canvas,{onEnd:()=>this.finish(),onError:error=>{console.warn('Commandbar movie',error);this.finish();}});
  }
  async play(name, loop=false) {
    this.stop();const generation=this.generation;
    try {
      const movie=(await movieDefinitions()).get(key(name));
      if (!movie || !this.anchor || generation!==this.generation) return false;
      const buffer=await fetchBinary(movie.val('Movie_File'));
      if (!buffer || generation!==this.generation) return false;
      this.movie=movie;this.active=true;this.canvas.dataset.movie=name;
      const color=db.constants.vec('CB_Movie_Color',[255,255,255,255]);
      await this.player.play(buffer,{loop,alpha:yes(movie.val('Alpha')),startFrame:movie.num('Movie_Start_Frame',0),color});
      if(generation!==this.generation)return false;
      this.canvas.style.opacity=String((color[3]??255)/255);this.resize();this.canvas.hidden=false;return true;
    } catch(error) {if(generation===this.generation){console.warn('Commandbar movie',error);this.player.stop();this.finish();}return false;}
  }
  resize() {
    if(!this.movie||!this.anchor)return;
    const s=this.game.overlayScale(),offset=db.constants.vec('CB_Movie_Offset',[0,0]),own=vector(this.movie.val('Commandbar_Offset'));
    Object.assign(this.canvas.style,{left:((this.anchor[0]+(offset[0]||0)+(own[0]||0))*s)+'px',
      top:(innerHeight-(this.anchor[1]+(offset[1]||0)+(own[1]||0))*s)+'px',width:(this.canvas.width*s)+'px',height:(this.canvas.height*s)+'px'});
  }
  update(dt) {if(this.active)this.player.update(dt);}
  setPaused(on) {this.player.setPaused(on);}
  finish() {this.active=false;this.movie=null;this.canvas.hidden=true;}
  stop() {this.generation++;this.player.stop();this.finish();}
  dispose() {this.stop();this.player.dispose();this.canvas.remove();}
}
