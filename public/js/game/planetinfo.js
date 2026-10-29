import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadTextureCanvas } from '../dds.js';
import { lighting, planetLighting, updateBillboards } from '../model.js';
import { preparePlanetPortrait, portraitBounds, portraitViewport, alignPortraitPixels } from './planetportrait.js';
import { openDialog } from './dialogs.js';
import { planetInfoContents, canOpenPlanetInfo } from './planetinfodata.js';

const pictures = new Map();
const picture = (name, opaque = false) => {
  if (!name) return Promise.resolve(null);
  const key = name.toUpperCase() + (opaque ? '|copy' : '|alpha');
  if (!pictures.has(key))
    pictures.set(
      key,
      loadTextureCanvas(name)
        .then(cv => {
          if (!cv) return null;
          if (opaque) {
            const ctx = cv.getContext('2d'),
              pixels = ctx.getImageData(0, 0, cv.width, cv.height);
            for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
            ctx.putImageData(pixels, 0, 0);
          }
          return cv.toDataURL();
        })
        .catch(() => null)
    );
  return pictures.get(key);
};
const rgba = c => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;

export const CORRUPTION_PICTURE = { size: 256, eye: [0, 35.5, 15], fov: 45, ambient: [0.05, 0.05, 0.07] };
export async function capturePlanet(game, p, custom = null) {
  const source = game.planetViews[p.index]?.inst;
  if (!source) return null;
  const portrait = await preparePlanetPortrait(source, { info: true }),
    inst = portrait.inst;
  const half = portraitBounds(inst).getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const fov = custom ? (custom.fov * Math.PI) / 180 : Math.atan(0.5),
    distance = (0.5 * half.length()) / Math.tan(fov / 2),
    SIZE = custom?.size || 512;
  const camera = new THREE.PerspectiveCamera((fov * 180) / Math.PI, 1, 1, 10000),
    scene = new THREE.Scene();
  camera.up.set(0, 0, 1);
  if (custom) camera.position.set(...custom.eye).add(inst.root.position);
  else
    camera.position
      .fromArray(db.constants.vec('Battle_Load_Planet_Direction', [0, 0.75, 0.55]))
      .multiplyScalar(distance)
      .add(inst.root.position);
  camera.lookAt(inst.root.position);
  scene.add(inst.root);
  const nativeSaved = Object.fromEntries(Object.entries(planetLighting).map(([key, uniform]) => [key, uniform.value.clone()]));
  const saved = Object.fromEntries(
    ['sunDir', 'sunColor', 'sunSpecular', 'fillColor', 'fillColor2', 'ambient', 'fogRange'].map(k => [k, lighting[k].value.clone()])
  );
  const shadow = lighting.shadowOn.value,
    r = game.renderer,
    previous = r.getRenderTarget(),
    clear = r.getClearColor(new THREE.Color()),
    alpha = r.getClearAlpha(),
    viewport = r.getViewport(new THREE.Vector4());
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE),
    pixels = new Uint8Array(SIZE * SIZE * 4);
  let read = null;
  try {
    lighting.sunDir.value.set(-Math.SQRT1_2 / 2, -Math.sqrt(3 / 8), Math.SQRT1_2);
    lighting.sunColor.value.setRGB(0.5, 0.5, 0.5);
    lighting.sunSpecular.value.setRGB(1, 1, 1);
    lighting.fillColor.value.setRGB(0, 0, 0);
    lighting.fillColor2.value.setRGB(0, 0, 0);
    lighting.ambient.value.fromArray(custom ? custom.ambient : db.constants.vec('Battle_Load_Planet_Ambient', [0.1, 0.1, 0.13]));
    lighting.fogRange.value.set(0, 0);
    lighting.shadowOn.value = 0;
    for (const key of Object.keys(planetLighting)) planetLighting[key].value.copy(lighting[key].value);
    updateBillboards(inst, camera);
    inst.syncFromBones();
    r.syncPipelines = true;
    r.setRenderTarget(target);
    r.setClearColor(
      custom?.rgb
        ? new THREE.Color(custom.rgb[0] / 255, custom.rgb[1] / 255, custom.rgb[2] / 255)
        : new THREE.Color(157 / 255, 123 / 255, 49 / 255),
      1
    );
    r.clear();
    const captureViewport = custom
      ? [0, 0, SIZE, SIZE]
      : portraitViewport(db.constants.vec('Battle_Load_Planet_Viewport', [0, 1, 1, 0]), 512, 512);
    r.setViewport(...captureViewport);
    alignPortraitPixels(camera, captureViewport[2], captureViewport[3]);
    r.render(scene, camera);
    read = r.isWebGLRenderer
      ? r.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels)
      : r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE, pixels);
  } finally {
    for (const [key, value] of Object.entries(nativeSaved)) planetLighting[key].value.copy(value);
    for (const [key, value] of Object.entries(saved)) lighting[key].value.copy(value);
    lighting.shadowOn.value = shadow;
    r.setRenderTarget(previous);
    r.setViewport(viewport);
    r.setClearColor(clear, alpha);
    r.syncPipelines = false;
    target.dispose();
    portrait.dispose();
  }
  await read;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d'),
    image = ctx.createImageData(SIZE, SIZE);
  image.data.set(pixels);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  ctx.putImageData(image, 0, 0);
  return cv.toDataURL();
}

export class PlanetInfo {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.dialog = null;
    this.generation = 0;
  }

  async show(p) {
    if (this.open || !canOpenPlanetInfo(this.game, p)) return false;
    this.open = true;
    const generation = ++this.generation,
      snapshot = planetInfoContents(this.game.galaxy, p);
    this.game.keys.clear();
    this.game.mouse.in = false;
    try {
      const d = await openDialog('IDD_PLANET_INFO', {
        cls: 'planet-info',
        anchor: 9,
        nativeImages: true,
        nativeLists: true,
        nativeFonts: true
      });
      if (!d) {
        this.close();
        return false;
      }
      if (!this.open || generation !== this.generation) {
        d.close();
        return false;
      }
      this.dialog = d;
      d.el.setAttribute('role', 'dialog');
      d.el.setAttribute('aria-modal', 'true');
      d.el.setAttribute('aria-label', snapshot.title);
      const contents = () => planetInfoContents(this.game.galaxy, p);
      d.onLanguageRefresh(() => d.el.setAttribute('aria-label', contents().title));
      d.show('IDC_DIALOG_CLOSE_BUTTON', false);
      const text = (id, value, color = '#fff') => {
        d.setText(id, value, color);
        const c = d.ctl(id);
        if (c) {
          c.style.color = color;
          c.style.backgroundImage = 'none';
        }
      };
      text('IDC_STATIC_PLANET_NAME', () => contents().title, rgba(snapshot.color));
      text('IDC_STATIC_FACTION', () => contents().faction, rgba(snapshot.color));
      text('IDC_STATIC_CREDIT', snapshot.income);
      for (const [id, key] of [
        ['IDC_STATIC_NATIVE', 'population'],
        ['IDC_STATIC_WILDLIFE', 'wildlife'],
        ['IDC_STATIC_TERRAIN', 'terrain'],
        ['IDC_STATIC_WEATHER', 'weather']
      ])
        text(id, () => contents()[key]);
      for (const [id, key, color] of [
        ['IDC_LIST_TACTICAL', 'tactical', 'rgb(50,200,255)'],
        ['IDC_LIST_ADVANTAGE', 'advantage', '#fff'],
        ['IDC_LIST_REFERENCE', 'history', '#fff']
      ]) {
        d.textList(id, () => contents()[key], color);
        const label = () =>
          d
            .ctl(id)
            ?.setAttribute(
              'aria-label',
              db.t(
                { tactical: 'TEXT_TACTICAL_INFORMATION', advantage: 'TEXT_PLANETARY_ADVANTAGES', history: 'TEXT_HISTORICAL_REFERENCE' }[key]
              )
            );
        label();
        d.onLanguageRefresh(label);
      }
      const close = d.ctl('IDC_CLOSE_BUTTON');
      close?.setAttribute('role', 'button');
      if (close) {
        close.tabIndex = 0;
        close.onkeydown = e => {
          if (e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            close.click();
          }
        };
      }
      d.on('IDC_CLOSE_BUTTON', () => this.close());
      close?.focus();
      await Promise.all(
        [
          ['IDC_WEATHER_ICON', 'weatherImage', 2],
          ['IDC_NATIVE_ICON', 'nativeImage', 2],
          ['IDC_MAP_ICON', 'mapImage', 0],
          ['IDC_PLANET_OVERLAY', 'overlayImage', 2],
          ['IDC_PLANET_ICON', null, 2]
        ].map(async ([id, key, blend]) => {
          const c = d.ctl(id);
          if (!c) return;
          d.imageFrame(id, id === 'IDC_MAP_ICON');
          const url = key ? await picture(snapshot[key], blend === 0) : await capturePlanet(this.game, p);
          if (!this.open || generation !== this.generation) return;
          d.setImage(id, url);
          d.show(id, !!url);
        })
      );
      return this.open && generation === this.generation;
    } catch (e) {
      this.close();
      throw e;
    }
  }

  close() {
    this.open = false;
    this.generation++;
    this.dialog?.close();
    this.dialog = null;
  }
}
