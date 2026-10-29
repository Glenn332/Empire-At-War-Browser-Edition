import assert from 'node:assert/strict';
import {pauseGalactic,userPauseGalactic} from '../public/js/game/galacticpause.js';
import {Menus} from '../public/js/game/menus.js';

const notifications=[],game={paused:false,userPaused:false,galacticPauseCount:0,setUIPause:(...args)=>notifications.push(args)};
userPauseGalactic(game,true);assert.equal(game.galacticPauseCount,1);assert(game.userPaused);
pauseGalactic(game,true);pauseGalactic(game,true);assert.equal(game.galacticPauseCount,3);
pauseGalactic(game,false);pauseGalactic(game,false);assert.equal(game.galacticPauseCount,1);assert(game.paused);
userPauseGalactic(game,false);assert.equal(game.galacticPauseCount,0);assert(!game.paused);
assert.deepEqual(notifications,[['player',true],['player',false]]);
pauseGalactic(game,false);assert.equal(game.galacticPauseCount,0);
pauseGalactic(game,true);userPauseGalactic(game,true);assert.equal(game.galacticPauseCount,1);assert(!game.userPaused,'Native player control cannot acquire during a scripted pause');
pauseGalactic(game,false);assert(!game.paused);
userPauseGalactic(game,true);game.pauseGalactic=on=>pauseGalactic(game,on);pauseGalactic(game,true);
const menu={game,pauseHeld:true,wasPaused:true};
Menus.prototype.releasePause.call(menu);assert.equal(game.galacticPauseCount,1);assert(game.paused);
Menus.prototype.releasePause.call(menu);assert.equal(game.galacticPauseCount,1,'Closing an already-closed menu cannot consume the player pause');
userPauseGalactic(game,false);assert(!game.paused);
console.log('Native counted galactic pause, nested script requests and independent player button state passed');
