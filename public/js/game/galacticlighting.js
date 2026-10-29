export function galacticLight(out,inside,level,progress) {
  const q=Math.max(0,Math.min(1,progress)),yaw=(out[1]+(inside[1]-out[1])*q)*Math.PI/180,pitch=(out[2]+(inside[2]-out[2])*q)*Math.PI/180;
  return {direction:[Math.sin(yaw)*Math.cos(pitch),-Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch)],intensity:.5+(level-.5)*q};
}
