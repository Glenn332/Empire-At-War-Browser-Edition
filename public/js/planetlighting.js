export function planetEnvironment(env) {
  const [sun={},fill={},fill2={}]=env.lights||[],direction=light=>light.nativeDir||light.dir||[0,0,1];
  return {sunDir:direction(sun),sunColor:sun.color||[.5,.5,.5],sunSpecular:(sun.specular||[1,1,1]).map(c=>c*2*(sun.intensity??.5)),
    fillDir:direction(fill),fillColor:fill.color||[0,0,0],fillDir2:direction(fill2),fillColor2:fill2.color||[0,0,0],ambient:env.ambient||[.05,.05,.05]};
}
