export { fontPixels as dialogFontPixels } from '../fontpolicy.js';
export const uiTextHeight = () => Math.min(innerHeight, Math.floor((globalThis.innerWidth ?? Infinity) * 768 / 1024));

export const dialogStaticText = text => text.replace(/\\n/g, '\n');

export function wrapStaticText(text,width,measure) {
  if(text.length>=8192)return [];
  const rows=[];
  for(let line of dialogStaticText(text).split('\n'))while(line.length){
    if(measure(line)<=width){rows.push(line);break;}
    let end=line.lastIndexOf(' '),space=true;
    while(end>=0&&measure(line.slice(0,end))>width)end=line.lastIndexOf(' ',end-1);
    if(end<0){space=false;end=line.length-1;while(end>1&&measure(line.slice(0,end))>width)end--;}
    if(end<=0){rows.push(line[0]);line=line.slice(1);}
    else{rows.push(line.slice(0,end));line=line.slice(end+(space?1:0));}
  }
  return rows;
}

export function wrapDialogText(text, width, measure) {
  if (!text) return [];
  if (measure(text) < width) return [text];
  if (text.length > 1024) return [];
  const rows = []; let cursor = 0;
  while (cursor < text.length) {
    const start = cursor; let line = '', space = -1;
    while (cursor < text.length && measure(line + text[cursor]) < width) {
      if (text[cursor] === ' ') space = cursor;
      line += text[cursor++];
    }
    if (cursor === text.length) rows.push(line);
    else if (space >= start) { rows.push(text.slice(start,space)); cursor = space + 1; }
    else if (cursor > start) rows.push(line);
    else rows.push(text[cursor++]);
  }
  return rows;
}
