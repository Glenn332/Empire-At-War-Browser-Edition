export const planetVertex = `
attribute vec3 tangent, binormal;
uniform vec3 sunDir, sunColor, fillDir, fillColor, fillDir2, fillColor2, ambient;
uniform vec3 emissive, diffuse, specular, sunSpecular;
uniform vec4 atmosphere;
uniform vec4 lightScale;
uniform float atmospherePower, cloudScroll, time, opacity;
varying vec2 vUv, vCloudUv;
varying vec3 vLight, vHalf, vFill;
varying vec3 vSpecular;
varying float vRim, vNight;
varying float vAlpha;
vec3 fillLight(vec3 n, vec3 d, vec3 color) {
  float sh = .282095*.282095*3.141593
    + .488603*.488603*2.094395*dot(n,d)
    + 1.092548*1.092548*.785398*(n.x*n.y*d.x*d.y+n.y*n.z*d.y*d.z+n.z*n.x*d.z*d.x)
    + .315392*.315392*.785398*(3.0*n.z*n.z-1.0)*(3.0*d.z*d.z-1.0)
    + .546274*.546274*.785398*(n.x*n.x-n.y*n.y)*(d.x*d.x-d.y*d.y);
  return color*sh;
}
void main() {
  vec4 world = modelMatrix*vec4(position,1.0);
  vec3 worldNormal = normalize(mat3(modelMatrix)*normal);
  vec3 eye = normalize(cameraPosition-world.xyz);
  mat3 rotation = mat3(modelMatrix);
  mat3 inverseRotation = mat3(cross(rotation[1],rotation[2]),cross(rotation[2],rotation[0]),cross(rotation[0],rotation[1]));
  float determinant=dot(rotation[0],inverseRotation[0]);
  #ifdef PLANET_FIXED
  worldNormal=normalize(inverseRotation*normal/determinant);
  vFill=clamp(emissive+diffuse*ambient+diffuse*lightScale.rgb*(
    sunColor*max(dot(worldNormal,sunDir),0.0)
    +fillColor*max(dot(worldNormal,fillDir),0.0)
    +fillColor2*max(dot(worldNormal,fillDir2),0.0)),0.0,1.0);
  vCloudUv=uv;
  #else
  vec3 objectLight = normalize(vec3(dot(inverseRotation[0],sunDir),dot(inverseRotation[1],sunDir),dot(inverseRotation[2],sunDir))/determinant);
  vec3 objectEye = normalize(vec3(dot(inverseRotation[0],eye),dot(inverseRotation[1],eye),dot(inverseRotation[2],eye))/determinant);
  vec3 halfDirection = normalize(objectEye+objectLight);
  vLight = normalize(vec3(dot(objectLight,tangent),dot(objectLight,binormal),dot(objectLight,normal)));
  vHalf = normalize(vec3(dot(halfDirection,tangent),dot(halfDirection,binormal),dot(halfDirection,normal)));
  vFill = clamp(emissive+diffuse*lightScale.rgb*(ambient*(3.5449052*.282095)+fillLight(worldNormal,fillDir,fillColor)+fillLight(worldNormal,fillDir2,fillColor2)),0.0,1.0);
  vSpecular=clamp(specular*sunSpecular*pow(max(dot(worldNormal,normalize(eye+sunDir)),0.0),16.0),0.0,1.0);
  vRim = 2.0*atmosphere.a*pow(1.0-dot(worldNormal,eye),atmospherePower);
  vNight = clamp(dot(normal,-32.0*objectLight),0.0,1.0);
  vCloudUv=uv+vec2(time*cloudScroll,0.0);
  #endif
  vAlpha=clamp(lightScale.a*opacity,0.0,1.0);
  vUv=uv;
  gl_Position=projectionMatrix*viewMatrix*world;
}`;

export const planetFragment = `
uniform sampler2D map, normalMap, cloudMap, cloudNormalMap;
uniform vec3 sunColor, sunSpecular, diffuse, specular, cityColor;
uniform vec4 atmosphere;
uniform float opacity;
varying vec2 vUv, vCloudUv;
varying vec3 vLight, vHalf, vFill;
varying vec3 vSpecular;
varying float vRim, vNight;
varying float vAlpha;
void main() {
  vec4 base=texture2D(map,vUv);
  vec4 cloud=texture2D(cloudMap,vCloudUv);
  #ifdef PLANET_FIXED
  gl_FragColor=vec4(2.0*vFill*mix(base.rgb,cloud.rgb,cloud.a),vAlpha);
  #else
  vec4 normal=texture2D(normalMap,vUv);
  vec3 decodedNormal=normal.rgb*2.0-1.0;
  #ifdef PLANET_DX8
  vec3 light=sunColor*diffuse*clamp(dot(decodedNormal,vLight),0.0,1.0)+vFill;
  vec3 rgb=2.0*light*(mix(base.rgb,cloud.rgb,cloud.a)+atmosphere.rgb*vRim)
    +cityColor*(cloud.a*base.a*vNight)+normal.a*vSpecular;
  gl_FragColor=vec4(rgb,vAlpha);
  #else
  vec3 cloudNormal=texture2D(cloudNormalMap,vCloudUv).rgb*2.0-1.0;
  vec3 surface=2.0*(sunColor*diffuse*clamp(dot(decodedNormal,vLight),0.0,1.0)+vFill)
    *(base.rgb+atmosphere.rgb*vRim);
  vec3 city=cityColor*base.a*vNight*(1.0-cloud.a);
  vec3 gloss=specular*sunSpecular*pow(clamp(dot(decodedNormal,vHalf),0.0,1.0),16.0)*normal.a;
  vec3 clouds=2.0*(cloud.rgb*clamp(dot(cloudNormal,vLight),0.0,1.0)*sunColor+vFill);
  gl_FragColor=vec4(mix(surface+city+gloss,clouds,cloud.a),vAlpha);
  #endif
  #endif
}`;
