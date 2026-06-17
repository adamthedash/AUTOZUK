// =====================================================
// PHASE 2: HEATMAP COLOR
// =====================================================
function heatmapColor(avgDmg, alpha) {
  if (isNaN(avgDmg) || avgDmg === null) return `rgba(40,40,40,${alpha || 0.6})`;
  if (avgDmg < 0) avgDmg = 0;
  let a = alpha || 1;
  if (avgDmg >= 80) return `rgba(0,0,0,${a})`;
  let r, g, b;
  // Target bands: 0-20 green, 21-26 green/yellow, 27-39 yellow,
  // 40-50 orange, 51-60 red, 61+ dark red/black.
  if (avgDmg <= 20) {
    let t = avgDmg / 20;
    r = Math.floor(25 + t * 65);
    g = Math.floor(175 + t * 45);
    b = Math.floor(35 - t * 10);
  } else if (avgDmg <= 26) {
    let t = (avgDmg - 20) / 6;
    r = Math.floor(90 + t * 140);
    g = 220;
    b = Math.floor(25 - t * 25);
  } else if (avgDmg <= 39) {
    let t = (avgDmg - 26) / 13;
    r = Math.floor(230 + t * 25);
    g = Math.floor(220 - t * 25);
    b = 0;
  } else if (avgDmg <= 50) {
    let t = (avgDmg - 39) / 11;
    r = 255;
    g = Math.floor(195 - t * 105);
    b = 0;
  } else if (avgDmg <= 60) {
    let t = (avgDmg - 50) / 10;
    r = Math.floor(255 - t * 35);
    g = Math.floor(90 - t * 90);
    b = 0;
  } else {
    let t = (avgDmg - 60) / 20;
    r = Math.floor(220 - t * 220);
    g = 0;
    b = 0;
  }
  return `rgba(${r},${g},${b},${a})`;
}
function autozukScoreValue(result, loadout = currentLoadout) {
  return loadout?.isBloodBarrage ? result.deathPct || 0 : result.avgDamage;
}
function autozukScoreText(result, loadout = currentLoadout) {
  let value = autozukScoreValue(result, loadout);
  return String(Math.round(value));
}
function isBetterAutozukResult(candidate, current, loadout = currentLoadout) {
  if (!current) return true;
  if (loadout?.isBloodBarrage) {
    if (!!candidate.markedDead !== !!current.markedDead) return !candidate.markedDead;
    if (candidate.deathPct !== current.deathPct) return candidate.deathPct < current.deathPct;
    if (candidate.avgDamage !== current.avgDamage) return candidate.avgDamage < current.avgDamage;
    return candidate.avgTicks < current.avgTicks;
  }
  if (candidate.avgDamage !== current.avgDamage) return candidate.avgDamage < current.avgDamage;
  if (candidate.deathPct !== current.deathPct) return candidate.deathPct < current.deathPct;
  return candidate.avgTicks < current.avgTicks;
}
function bloodBarrageDeathHeatValue(deathPct) {
  if (isNaN(deathPct) || deathPct === null) return deathPct;
  deathPct = Math.max(0, deathPct);
  if (deathPct <= 10) return deathPct * 2.6; // 0 green, 10 yellow
  if (deathPct <= 15) return 26 + (deathPct - 10) * 4.8; // 15 orange
  if (deathPct <= 20) return 50 + (deathPct - 15) * 2; // 20 red
  if (deathPct <= 40) return 60 + (deathPct - 20) * 0.5; // 40 dark red
  return 70 + (deathPct - 40) * 0.5; // fade toward black/grey
}
function autozukHeatValue(result, loadout = currentLoadout) {
  return loadout?.isBloodBarrage
    ? bloodBarrageDeathHeatValue(result.deathPct || 0)
    : result.avgDamage;
}
function heatmapBlended(avgDmg, fx, fy, maxBlend) {
  // Get raw heatmap RGB
  if (avgDmg < 0) avgDmg = 0;
  let r, g, b;
  if (isNaN(avgDmg) || avgDmg === null) {
    r = 40;
    g = 40;
    b = 40;
  } else if (avgDmg <= 20) {
    let t = avgDmg / 20;
    r = Math.floor(25 + t * 65);
    g = Math.floor(175 + t * 45);
    b = Math.floor(35 - t * 10);
  } else if (avgDmg <= 26) {
    let t = (avgDmg - 20) / 6;
    r = Math.floor(90 + t * 140);
    g = 220;
    b = Math.floor(25 - t * 25);
  } else if (avgDmg <= 39) {
    let t = (avgDmg - 26) / 13;
    r = Math.floor(230 + t * 25);
    g = Math.floor(220 - t * 25);
    b = 0;
  } else if (avgDmg <= 50) {
    let t = (avgDmg - 39) / 11;
    r = 255;
    g = Math.floor(195 - t * 105);
    b = 0;
  } else if (avgDmg <= 60) {
    let t = (avgDmg - 50) / 10;
    r = Math.floor(255 - t * 35);
    g = Math.floor(90 - t * 90);
    b = 0;
  } else if (avgDmg <= 80) {
    let t = (avgDmg - 60) / 20;
    r = Math.floor(220 - t * 220);
    g = 0;
    b = 0;
  } else {
    r = 0;
    g = 0;
    b = 0;
  }
  // For >60, blend with floor color so 51-60 remains visibly red.
  let mb = maxBlend || 0.8;
  if (avgDmg > 60 && FLOOR_RAW[fy] && FLOOR_RAW[fy][fx]) {
    let blend = Math.min((avgDmg - 60) / 50, mb);
    let fc = FLOOR_RAW[fy][fx];
    let fr = parseInt(fc.slice(1, 3), 16),
      fg = parseInt(fc.slice(3, 5), 16),
      fb = parseInt(fc.slice(5, 7), 16);
    r = Math.round(r * (1 - blend) + fr * blend);
    g = Math.round(g * (1 - blend) + fg * blend);
    b = Math.round(b * (1 - blend) + fb * blend);
  }
  return `rgb(${r},${g},${b})`;
}
function histogramColor(dmgVal) {
  // Same score bands as the tile heatmap, but keep very high values dark red
  // rather than pure black so histogram bars remain visible.
  if (dmgVal < 0) dmgVal = 0;
  let r, g, b;
  if (dmgVal <= 20) {
    let t = dmgVal / 20;
    r = Math.floor(25 + t * 65);
    g = Math.floor(175 + t * 45);
    b = Math.floor(35 - t * 10);
  } else if (dmgVal <= 26) {
    let t = (dmgVal - 20) / 6;
    r = Math.floor(90 + t * 140);
    g = 220;
    b = Math.floor(25 - t * 25);
  } else if (dmgVal <= 39) {
    let t = (dmgVal - 26) / 13;
    r = Math.floor(230 + t * 25);
    g = Math.floor(220 - t * 25);
    b = 0;
  } else if (dmgVal <= 50) {
    let t = (dmgVal - 39) / 11;
    r = 255;
    g = Math.floor(195 - t * 105);
    b = 0;
  } else if (dmgVal <= 60) {
    let t = (dmgVal - 50) / 10;
    r = Math.floor(255 - t * 35);
    g = Math.floor(90 - t * 90);
    b = 0;
  } else {
    let t = Math.min((dmgVal - 60) / 60, 1);
    r = Math.floor(220 - t * 100);
    g = 0;
    b = 0;
  }
  return `rgb(${r},${g},${b})`;
}
