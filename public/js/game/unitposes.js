// The page draws between simulation steps: a unit is shown somewhere between its pose at the last step and the one
// before. What that needs for each unit (the two step poses, the pose it is shown at and its true pose meanwhile) is
// kept side by side in one array of numbers (ours). In a battle of thousands of fighters every frame reads and writes
// all of it, and as separate fields on each unit that was most of the cost of drawing between steps.

const PREVIOUS = 0,
  CURRENT = 5,
  TRUE = 10,
  SHOWN = 15,
  PREVIOUS_PITCH = 20,
  CURRENT_PITCH = 21,
  TRUE_PITCH = 22,
  ROW = 23;
// within a pose: x, y, z, heading, roll
const HEADING = 3,
  ROLL = 4;

// A unit's roll and pitch may be unset; they are kept as not-a-number and given back unset.
const kept = value => (value === undefined ? NaN : value);
const givenBack = value => (value !== value ? undefined : value);

export class UnitPoses {
  constructor() {
    this.values = new Float64Array(1024 * ROW);
    this.owners = [];
  }

  // Where this unit's row starts, or -1 when no step has been remembered for it yet.
  rowOf(unit) {
    const slot = unit.poseSlot;
    return slot >= 0 && this.owners[slot] === unit ? slot * ROW : -1;
  }

  addRow(unit) {
    const slot = this.owners.length;
    if ((slot + 1) * ROW > this.values.length) {
      const grown = new Float64Array(this.values.length * 2);
      grown.set(this.values);
      this.values = grown;
    }
    this.owners.push(unit);
    unit.poseSlot = slot;
    this.values.fill(0, slot * ROW, (slot + 1) * ROW);
    return slot * ROW;
  }

  // Rows of units that died are given up once they outnumber the living. Only called when no unit is shown between
  // steps (after settle), so nothing still refers to a row by its old place.
  dropDeadRows(units) {
    let living = 0;
    for (const unit of units) if (!unit.dead && this.rowOf(unit) >= 0) living++;
    if (this.owners.length <= living * 2 + 2048) return;
    const old = this.values,
      values = new Float64Array(Math.max(1024, living * 2) * ROW),
      owners = [];
    for (const unit of units) {
      const from = unit.dead ? -1 : this.rowOf(unit);
      if (from < 0) continue;
      values.set(old.subarray(from, from + ROW), owners.length * ROW);
      unit.poseSlot = owners.length;
      owners.push(unit);
    }
    this.values = values;
    this.owners = owners;
  }

  // After a step: the pose every living unit had becomes its previous one, the pose it has now its current one.
  remember(units) {
    this.dropDeadRows(units);
    for (const unit of units) {
      if (unit.dead) continue;
      let row = this.rowOf(unit);
      const first = row < 0;
      if (first) row = this.addRow(unit);
      const values = this.values,
        roll = unit.roll || 0;
      if (first) {
        values[row + PREVIOUS] = unit.x;
        values[row + PREVIOUS + 1] = unit.y;
        values[row + PREVIOUS + 2] = unit.z;
        values[row + PREVIOUS + HEADING] = unit.heading;
        values[row + PREVIOUS + ROLL] = roll;
      } else {
        values[row + PREVIOUS] = values[row + CURRENT];
        values[row + PREVIOUS + 1] = values[row + CURRENT + 1];
        values[row + PREVIOUS + 2] = values[row + CURRENT + 2];
        values[row + PREVIOUS + HEADING] = values[row + CURRENT + HEADING];
        values[row + PREVIOUS + ROLL] = values[row + CURRENT + ROLL];
      }
      values[row + CURRENT] = unit.x;
      values[row + CURRENT + 1] = unit.y;
      values[row + CURRENT + 2] = unit.z;
      values[row + CURRENT + HEADING] = unit.heading;
      values[row + CURRENT + ROLL] = roll;
      if (!unit.isFighter) continue;
      const pitch = unit.pitch || 0;
      values[row + PREVIOUS_PITCH] = first ? pitch : values[row + CURRENT_PITCH];
      values[row + CURRENT_PITCH] = pitch;
      if (unit.flip) {
        // the fighter flew over the top: it is shown turning on from the mirrored pose
        unit.flip = false;
        values[row + PREVIOUS + HEADING] += values[row + PREVIOUS + HEADING] > 0 ? -Math.PI : Math.PI;
        values[row + PREVIOUS_PITCH] = (values[row + PREVIOUS_PITCH] < 0 ? -Math.PI : Math.PI) - values[row + PREVIOUS_PITCH];
        values[row + PREVIOUS + ROLL] += values[row + PREVIOUS + ROLL] > 0 ? -Math.PI : Math.PI;
      }
    }
  }

  // Before a frame is drawn: every unit that moved is put the given part of the way from its previous step pose to
  // its current one, and listed in shown. Its true pose is kept for settle.
  present(units, part, shown) {
    const values = this.values,
      owners = this.owners;
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (unit.dead) continue;
      const slot = unit.poseSlot;
      if (!(slot >= 0) || owners[slot] !== unit) continue;
      const row = slot * ROW;
      const currentX = values[row + CURRENT],
        currentY = values[row + CURRENT + 1],
        currentZ = values[row + CURRENT + 2],
        currentHeading = values[row + CURRENT + HEADING],
        currentRoll = values[row + CURRENT + ROLL],
        previousX = values[row + PREVIOUS],
        previousY = values[row + PREVIOUS + 1],
        previousZ = values[row + PREVIOUS + 2],
        previousHeading = values[row + PREVIOUS + HEADING],
        previousRoll = values[row + PREVIOUS + ROLL];
      if (
        previousX === currentX &&
        previousY === currentY &&
        previousZ === currentZ &&
        previousHeading === currentHeading &&
        previousRoll === currentRoll &&
        currentX === unit.x &&
        currentY === unit.y &&
        currentZ === unit.z &&
        currentHeading === unit.heading &&
        currentRoll === (unit.roll || 0)
      ) {
        if (unit.wasShown) {
          unit.wasShown = false;
          unit.syncObj();
        }
        continue;
      }
      values[row + TRUE] = unit.x;
      values[row + TRUE + 1] = unit.y;
      values[row + TRUE + 2] = unit.z;
      values[row + TRUE + HEADING] = unit.heading;
      values[row + TRUE + ROLL] = kept(unit.roll);
      let turn = currentHeading - previousHeading;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      else if (turn < -Math.PI) turn += 2 * Math.PI;
      const x = (unit.x = values[row + SHOWN] = previousX + (currentX - previousX) * part),
        y = (unit.y = values[row + SHOWN + 1] = previousY + (currentY - previousY) * part),
        z = (unit.z = values[row + SHOWN + 2] = previousZ + (currentZ - previousZ) * part);
      const heading = (unit.heading = values[row + SHOWN + HEADING] = previousHeading + turn * part),
        roll = (unit.roll = values[row + SHOWN + ROLL] = previousRoll + (currentRoll - previousRoll) * part);
      const object = unit.obj,
        e = object.matrix.elements,
        scale = object.scale.x,
        angle = heading + Math.PI / 2,
        ca = Math.cos(angle) * scale,
        sa = Math.sin(angle) * scale;
      object.position.set(x, y, z);
      const currentPitch = values[row + CURRENT_PITCH],
        previousPitch = values[row + PREVIOUS_PITCH];
      if (currentPitch || previousPitch) {
        // A climbing or diving fighter: heading, then pitch, then roll, written straight into the matrix. Thousands of
        // fighters turn every frame, and building each one's quaternion first cost more than the rest of this loop.
        values[row + TRUE_PITCH] = kept(unit.pitch);
        const pitch = (unit.pitch = previousPitch + (currentPitch - previousPitch) * part);
        unit.pitched = true;
        const cosPitch = Math.cos(pitch),
          sinPitch = Math.sin(pitch),
          cosRoll = Math.cos(roll),
          sinRoll = Math.sin(roll);
        e[0] = ca * cosRoll + sa * sinPitch * sinRoll;
        e[1] = sa * cosRoll - ca * sinPitch * sinRoll;
        e[2] = -cosPitch * sinRoll * scale;
        e[4] = -sa * cosPitch;
        e[5] = ca * cosPitch;
        e[6] = -sinPitch * scale;
        e[8] = ca * sinRoll - sa * sinPitch * cosRoll;
        e[9] = sa * sinRoll + ca * sinPitch * cosRoll;
        e[10] = cosPitch * cosRoll * scale;
      } else {
        if (roll) {
          const cosRoll = Math.cos(roll),
            sinRoll = Math.sin(roll);
          e[0] = ca * cosRoll;
          e[1] = sa * cosRoll;
          e[2] = -sinRoll * scale;
          e[8] = ca * sinRoll;
          e[9] = sa * sinRoll;
          e[10] = cosRoll * scale;
        } else {
          e[0] = ca;
          e[1] = sa;
          e[2] = 0;
          e[8] = 0;
          e[9] = 0;
          e[10] = scale;
        }
        e[4] = -sa;
        e[5] = ca;
        e[6] = 0;
      }
      e[12] = x;
      e[13] = y;
      e[14] = z;
      unit.wasShown = true;
      shown.push(unit);
    }
  }

  // Before the next step: every shown unit gets its true pose back, unless something else moved it meanwhile.
  settle(shown) {
    const values = this.values;
    for (let i = 0; i < shown.length; i++) {
      const unit = shown[i],
        row = this.rowOf(unit);
      if (row < 0) continue;
      if (unit.x === values[row + SHOWN]) unit.x = values[row + TRUE];
      if (unit.y === values[row + SHOWN + 1]) unit.y = values[row + TRUE + 1];
      if (unit.z === values[row + SHOWN + 2]) unit.z = values[row + TRUE + 2];
      if (unit.heading === values[row + SHOWN + HEADING]) unit.heading = values[row + TRUE + HEADING];
      if (unit.roll === values[row + SHOWN + ROLL]) unit.roll = givenBack(values[row + TRUE + ROLL]);
      if (unit.pitched) {
        unit.pitch = givenBack(values[row + TRUE_PITCH]);
        unit.pitched = false;
      }
    }
  }
}
