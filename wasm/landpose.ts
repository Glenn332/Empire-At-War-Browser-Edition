const REC = 80;

@inline function lf(p: usize, i: i32): f32 {
  return load<f32>(p + ((<usize>i) << 2));
}
@inline function li(p: usize, i: i32): i32 {
  return load<i32>(p + ((<usize>i) << 2));
}

@inline function mul(out: usize, a: usize, b: usize): void {
  const c0 = v128.load(a),
    c1 = v128.load(a, 16),
    c2 = v128.load(a, 32),
    c3 = v128.load(a, 48);
  for (let j: usize = 0; j < 64; j += 16) {
    const bj = b + j;
    let r = f32x4.mul(c0, f32x4.splat(load<f32>(bj)));
    r = f32x4.add(r, f32x4.mul(c1, f32x4.splat(load<f32>(bj, 4))));
    r = f32x4.add(r, f32x4.mul(c2, f32x4.splat(load<f32>(bj, 8))));
    r = f32x4.add(r, f32x4.mul(c3, f32x4.splat(load<f32>(bj, 12))));
    v128.store(out + j, r);
  }
}

function compose(out: usize, px: f32, py: f32, pz: f32, x: f32, y: f32, z: f32, w: f32, sx: f32, sy: f32, sz: f32): void {
  const l = Mathf.sqrt(x * x + y * y + z * z + w * w);
  if (l == 0) {
    x = 0;
    y = 0;
    z = 0;
    w = 1;
  } else {
    const n: f32 = 1 / l;
    x *= n;
    y *= n;
    z *= n;
    w *= n;
  }
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2,
    yy = y * y2,
    yz = y * z2,
    zz = z * z2,
    wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  store<f32>(out, (1 - (yy + zz)) * sx);
  store<f32>(out, (xy + wz) * sx, 4);
  store<f32>(out, (xz - wy) * sx, 8);
  store<f32>(out, 0, 12);
  store<f32>(out, (xy - wz) * sy, 16);
  store<f32>(out, (1 - (xx + zz)) * sy, 20);
  store<f32>(out, (yz + wx) * sy, 24);
  store<f32>(out, 0, 28);
  store<f32>(out, (xz + wy) * sz, 32);
  store<f32>(out, (yz - wx) * sz, 36);
  store<f32>(out, (1 - (xx + yy)) * sz, 40);
  store<f32>(out, 0, 44);
  store<f32>(out, px, 48);
  store<f32>(out, py, 52);
  store<f32>(out, pz, 56);
  store<f32>(out, 1, 60);
}

export function poseFrame(
  parents: usize,
  rest: usize,
  restInv: usize,
  order: usize,
  recs: usize,
  nb: i32,
  fr: i32,
  outM: usize,
  outS: usize,
  tmp: usize
): void {
  for (let n = 0; n < nb; n++) {
    const i = li(order, n),
      r0 = rest + <usize>i * 40;
    let px = lf(r0, 0),
      py = lf(r0, 1),
      pz = lf(r0, 2),
      qx = lf(r0, 3),
      qy = lf(r0, 4),
      qz = lf(r0, 5),
      qw = lf(r0, 6);
    const sx = lf(r0, 7),
      sy = lf(r0, 8),
      sz = lf(r0, 9);
    const r = recs + <usize>i * REC,
      kind = li(r, 0);
    if (kind >= 0) {
      const ox = lf(r, 7),
        oy = lf(r, 8),
        oz = lf(r, 9);
      if (kind & 1) {
        const d = <usize>li(r, 1) + ((<usize>(fr * li(r, 2) + li(r, 3))) << 1);
        px = ox + lf(r, 10) * <f32>load<u16>(d);
        py = oy + lf(r, 11) * <f32>load<u16>(d, 2);
        pz = oz + lf(r, 12) * <f32>load<u16>(d, 4);
      } else {
        px = ox;
        py = oy;
        pz = oz;
      }
      if (kind & 2) {
        const d = <usize>li(r, 4) + ((<usize>(fr * li(r, 5) + li(r, 6))) << 1);
        qx = <f32>load<i16>(d);
        qy = <f32>load<i16>(d, 2);
        qz = <f32>load<i16>(d, 4);
        qw = <f32>load<i16>(d, 6);
      } else if (kind & 4) {
        qx = lf(r, 13);
        qy = lf(r, 14);
        qz = lf(r, 15);
        qw = lf(r, 16);
      }
    }
    const m = outM + ((<usize>i) << 6),
      p = li(parents, i);
    if (p < 0) compose(m, px, py, pz, qx, qy, qz, qw, sx, sy, sz);
    else {
      compose(tmp, px, py, pz, qx, qy, qz, qw, sx, sy, sz);
      mul(m, outM + ((<usize>p) << 6), tmp);
    }
    mul(outS + ((<usize>i) << 6), m, restInv + ((<usize>i) << 6));
  }
}

export function blend(src: usize, a0: usize, a1: usize, k: f32, idx: usize, n: i32, flags: usize, xs: usize, out: usize, tmp: usize): void {
  const kk = f32x4.splat(k);
  for (let j = 0; j < n; j++) {
    const bi = <usize>li(idx, j),
      p0 = src + a0 + (bi << 6),
      p1 = src + a1 + (bi << 6);
    const o = out + ((<usize>j) << 6);
    const f = flags ? <i32>load<u8>(flags + bi) : 0;
    const dst = f ? tmp : o;
    for (let c: usize = 0; c < 64; c += 16) {
      const v0 = v128.load(p0 + c),
        v1 = v128.load(p1 + c);
      v128.store(dst + c, f32x4.add(v0, f32x4.mul(f32x4.sub(v1, v0), kk)));
    }
    if (f) mul(o, xs + ((<usize>(f - 1)) << 6), tmp);
  }
}
