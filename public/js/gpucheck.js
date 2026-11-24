import { inApp } from './platform.js';

// Tells the player when the game is drawn by a software renderer or a power-saving graphics chip.
// The renderers already ask for the high-performance GPU, but browsers and Windows may still hand
// out the integrated one, and with hardware acceleration off everything is drawn on the CPU.

const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|\bwarp\b|software/i;
const INTEGRATED = [
  /intel/i,
  /radeon\s*(\(tm\))?\s*graphics/i,
  /radeon\s*(\(tm\))?\s*\d{3}m\b/i,
  /vega\s*\d+\s*graphics/i,
  /adreno|mali|powervr/i
];
const DISCRETE = /arc\s*(\(tm\))?\s*[ab]\d{3}|geforce|quadro|rtx|radeon\s*(\(tm\))?\s*(rx|pro)\b/i;
const HIDE_KEY = 'swr-gpu-notice-hidden';

const timeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

function webglName() {
  try {
    const canvas = document.createElement('canvas');
    const options = { powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

async function webgpuAdapter(powerPreference) {
  try {
    const adapter = await timeout(navigator.gpu.requestAdapter({ powerPreference }), 3000);
    if (!adapter) return null;
    const info = adapter.info || {};
    return {
      name: [info.vendor, info.architecture, info.description].filter(Boolean).join(' '),
      fallback: !!(info.isFallbackAdapter ?? adapter.isFallbackAdapter)
    };
  } catch {
    return null;
  }
}

// Readable chip name from an ANGLE string such as "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 ...)".
function shortName(name) {
  const angle = /^ANGLE \(([^,]*),\s*([^,]*?)(\s*\(0x[0-9a-f]+\))?(\s+Direct3D[^,]*|\s+OpenGL[^,]*|\s+Vulkan[^,]*)?(,|\)$)/i.exec(name);
  return (angle ? angle[2] : name).trim();
}

// gl: the WebGL renderer string, webgpu: the high-performance WebGPU adapter (or null).
export function classify(gl, webgpu) {
  const name = gl || webgpu?.name || '';
  const software = !!webgpu?.fallback || SOFTWARE.test(gl) || (!webgpu && !gl);
  const integrated = !software && !DISCRETE.test(name) && INTEGRATED.some(re => re.test(name));
  return { name, software, integrated };
}

export async function probeGpu() {
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform || '');
  const [high, low] = navigator.gpu ? await Promise.all([webgpuAdapter('high-performance'), webgpuAdapter('low-power')]) : [null, null];
  const gl = webglName();
  const { name, software, integrated } = classify(gl, high);
  const twoGpus = !!(high && low && high.name !== low.name);
  let onBattery = false;
  try {
    const battery = await timeout(navigator.getBattery?.(), 2000);
    onBattery = !!battery && !battery.charging;
  } catch {}
  return { name: shortName(name) || 'unknown', software, integrated: integrated && !mobile, twoGpus, onBattery };
}

function noticeText(gpu) {
  const app = inApp();
  const lines = [];
  if (gpu.software) {
    lines.push(`The game is being drawn without your graphics card (${gpu.name}), so it will run very slowly.`);
    lines.push(
      app
        ? 'Update your graphics driver and restart the game. If it still happens, press Ctrl+Shift+B to save a bug report and send it to us.'
        : 'Turn on "Use graphics acceleration when available" (or "hardware acceleration") in your browser\'s settings, restart the browser, and update your graphics driver.'
    );
  } else {
    lines.push(`The game is running on a power-saving graphics chip (${gpu.name}).`);
    lines.push(
      app
        ? 'The app already asks Windows for the fastest graphics card. If this computer also has a dedicated one, update its driver and set the preferred graphics processor to High performance in NVIDIA Control Panel or AMD Software, then restart the game.'
        : 'If this computer also has a dedicated graphics card, open Windows Settings → System → Display → Graphics, add your browser, choose High performance, then restart the browser.'
    );
    lines.push('Picking a lower Resolution in the graphics options also helps.');
  }
  if (gpu.onBattery) lines.push('Your laptop is on battery: plug it in, as battery saving slows the graphics down.');
  return lines;
}

export function showNotice(gpu) {
  const key = `${gpu.software ? 'sw' : 'igpu'}:${gpu.name}`;
  const box = document.createElement('div');
  box.id = 'gpuNotice';
  box.setAttribute('role', 'alert');
  box.style.cssText =
    'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:100000;max-width:560px;width:calc(100% - 32px);' +
    'background:rgba(12,16,22,.95);color:#e6e6e6;border:1px solid #e0453a;border-radius:4px;padding:14px 16px;' +
    'font:14px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6)';
  const title = document.createElement('div');
  title.textContent = gpu.software ? 'Graphics acceleration is off' : 'Slow graphics chip in use';
  title.style.cssText = 'font-weight:600;color:#ff7a6e;margin-bottom:6px';
  box.appendChild(title);
  for (const line of noticeText(gpu)) {
    const p = document.createElement('div');
    p.textContent = line;
    p.style.marginBottom = '4px';
    box.appendChild(p);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:10px';
  const button = (text, hide) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'background:#22303c;color:#e6e6e6;border:1px solid #4a5a68;border-radius:3px;padding:5px 12px;cursor:pointer;font:inherit';
    b.onclick = () => {
      if (hide)
        try {
          localStorage.setItem(HIDE_KEY, key);
        } catch {}
      box.remove();
    };
    row.appendChild(b);
  };
  button("Don't show again", true);
  button('OK', false);
  box.appendChild(row);
  document.body.appendChild(box);
}

export async function warnSlowGpu() {
  try {
    const gpu = await probeGpu();
    if (!gpu.software && !gpu.integrated) return;
    const key = `${gpu.software ? 'sw' : 'igpu'}:${gpu.name}`;
    if (localStorage.getItem(HIDE_KEY) === key) return;
    showNotice(gpu);
  } catch (error) {
    console.warn('gpu check failed:', error);
  }
}
