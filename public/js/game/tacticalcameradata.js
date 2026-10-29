import {parseXML} from '../xml.js';
import {fetchText} from '../vfs.js';

export const TACTICAL_CAMERA_DEFAULTS=Object.freeze({near:70,far:7000,fadeBegin:7000,fadeEnd:7000});
const fields={Near_Clip:'near',Far_Clip:'far',Object_Fade_Begin:'fadeBegin',Object_Fade_End:'fadeEnd'};

export function parseTacticalCameraData(source){
  const result={...TACTICAL_CAMERA_DEFAULTS};
  const visit=node=>{
    if(node.tag==='TacticalCamera'&&node.attrs.Name==='Unlocked'){
      for(const [tag,field] of Object.entries(fields)){
        const value=parseFloat(node.val(tag));
        if(Number.isFinite(value))result[field]=value;
      }
    }
    for(const child of node.children)visit(child);
  };
  visit(parseXML(source||''));
  return Object.freeze(result);
}

export function parseTacticalCamera(source,name,defaults={}){
  const tags={pitchDefault:'Pitch_Default',pitchMin:'Pitch_Min',pitchMax:'Pitch_Max',pitchZoomedIn:'Pitch_When_Zoomed_In',pitchZoomBegin:'Pitch_Zoom_Begin_Fraction',yawDefault:'Yaw_Default',
    fovDefault:'Fov_Default',fovMin:'Fov_Min',fovMax:'Fov_Max',fovPerUnit:'Fov_Per_Mouse_Unit',
    distDefault:'Distance_Default',distMin:'Distance_Min',distMax:'Distance_Max',distPerUnit:'Distance_Per_Mouse_Unit'};
  const result={...defaults};
  const visit=node=>{
    if(node.tag==='TacticalCamera'&&node.attrs.Name===name)for(const [field,tag] of Object.entries(tags)){const value=parseFloat(node.val(tag));if(Number.isFinite(value))result[field]=value;}
    for(const child of node.children)visit(child);
  };
  visit(parseXML(source||''));
  return result;
}
const cameraFiles=new Map();
export function loadTacticalCamera(name,defaults){
  if(!cameraFiles.has(name))cameraFiles.set(name,fetchText('Data/XML/TacticalCameras.xml').catch(()=>'').then(source=>parseTacticalCamera(source,name,defaults)));
  return cameraFiles.get(name);
}

let pending;
export function loadTacticalCameraData(){
  return pending??=fetchText('Data/XML/TacticalCameras.xml').then(parseTacticalCameraData);
}
