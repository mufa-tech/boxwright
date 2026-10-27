// Box maths for the Boxwright website: a line-by-line port of the parts of
// packages/box_acoustics that the free web pages use (same constants, same order of operations,
// same issue names). research/acoustics.md is the spec; tools/site/calc.test.mjs runs every
// research/test-vectors.json vector of these functions against this file, so a drift from the
// engine turns the site build red.
//
//   constants.dart  air (343.0 m/s, 1.204 kg/m³), end corrections, unit factors
//   units.dart      ft³ ↔ L, in ↔ mm
//   sealed.dart     α, Qtc, Fc, F3, volume for a target Qtc, designSealed
//   port.dart       port area, end correction (one flanged + one free end by default),
//                   portLength, portTuning, pipe mode, slot diameters
//   wiring.dart     series, parallel, one driver's coils, DVC banks
//   ts.dart         Qts, Cms ↔ Vas, Fs from Mms and Cms, Sd from D, checkConsistency
//
// Every function returns { value, issue, findings }: `issue` (or null) blocks and then `value` is
// null; `findings` are warnings that leave the value standing. No network, no storage.

/** Air the engine computes with (constants.dart Air.standard, 20 °C). */
export const AIR = Object.freeze({ c: 343.0, rho: 1.204 });
/** Litres per cubic foot, exact: 0.3048³ m³ (NIST SP 811). */
export const LITRES_PER_FT3 = 28.316846592;
/** Cubic centimetres per cubic inch, exact. */
export const CM3_PER_IN3 = 16.387064;
/** Millimetres per inch, exact. */
export const MM_PER_INCH = 25.4;
/** Flanged end, × radius: 8/(3π) (Rayleigh). */
export const END_FLANGED = 8 / (3 * Math.PI);
/** Free end, × radius (Levine & Schwinger 1948). */
export const END_FREE = 0.6133;
export const DEFAULT_ENDS = Object.freeze(['flanged', 'free']);

// ---- result helpers (result.dart / guard.dart) -----------------------------------------------

const ok = (value, findings = []) => ({ value, issue: null, findings });
const fail = (code, field, extra = {}) => ({ value: null, issue: { code, field, ...extra }, findings: [] });

/** First input that is not finite and > 0, as a blocking issue (guard.dart requirePositive). */
function positive(inputs) {
  for (const [field, v] of Object.entries(inputs)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fail('nonFinite', field);
    if (v <= 0) return fail('invalidInput', field, { actual: v });
  }
  return null;
}
function nonNegative(inputs) {
  for (const [field, v] of Object.entries(inputs)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fail('nonFinite', field);
    if (v < 0) return fail('invalidInput', field, { actual: v });
  }
  return null;
}
/** guard.dart scalar(): positive inputs, finite output (else outOfRange on `result`). */
function scalar(inputs, f, nonNeg = {}) {
  const bad = positive(inputs) || nonNegative(nonNeg);
  if (bad) return bad;
  const v = f();
  return Number.isFinite(v) ? ok(v) : fail('outOfRange', 'result');
}
const sq = (x) => x * x;
const log10 = (x) => Math.log(x) / Math.LN10;

/** numeric.dart bisect: 200 halvings. */
export function bisect(f, lo, hi, iterations = 200) {
  const positiveAtLo = f(lo) > 0;
  for (let i = 0; i < iterations; i++) {
    const m = (lo + hi) / 2;
    if ((f(m) > 0) === positiveAtLo) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

// ---- units.dart --------------------------------------------------------------------------------

export const ft3ToL = (ft3) => ft3 * LITRES_PER_FT3;
export const lToFt3 = (l) => l / LITRES_PER_FT3;
export const in3ToL = (in3) => (in3 * CM3_PER_IN3) / 1000;
export const inToMm = (inches) => inches * MM_PER_INCH;
export const mmToIn = (mm) => mm / MM_PER_INCH;
export const m3ToL = (m3) => m3 * 1000;
export const lToM3 = (l) => l / 1000;

// ---- sealed.dart -------------------------------------------------------------------------------

/** α = Vas/Vb. */
export const sealedAlpha = (vas, vb) => scalar({ vas, vb }, () => vas / vb);
/** Qtc = Qts·√(α + 1). */
export const sealedQtc = (qts, alpha) => scalar({ qts, alpha }, () => qts * Math.sqrt(alpha + 1));
/** Fc = Fs·√(α + 1). */
export const sealedFc = (fs, alpha) => scalar({ fs, alpha }, () => fs * Math.sqrt(alpha + 1));

function f3Ratio(q) {
  const b = 1 / (q * q) - 2;
  return Math.sqrt((b + Math.sqrt(b * b + 4)) / 2);
}
/** F3/Fc of s²/(s² + s/Q + 1) re the passband asymptote. */
export const f3OverFc = (qtc) => scalar({ qtc }, () => f3Ratio(qtc));
/** F3 = Fc·F3/Fc. */
export const sealedF3 = (fc, qtc) => scalar({ fc, qtc }, () => fc * f3Ratio(qtc));

/** Net volume for a target Qtc: Vb = Vas/((Qtc/Qts)² − 1); Qtc ≤ Qts has no solution
 *  (qtcNotAboveQts, with the info considerInfiniteBaffle). */
export function sealedVbForQtc(qts, vas, qtc) {
  const c = scalar({ qts, vas, qtc }, () => (qtc <= qts ? 0 : vas / (sq(qtc / qts) - 1)));
  if (c.value !== null && qtc <= qts) {
    return { ...fail('qtcNotAboveQts', 'qtc', { limit: qts, actual: qtc }), findings: [{ code: 'considerInfiniteBaffle' }] };
  }
  return c;
}

/** Sealed design for a driver (Fs, Qts, Vas) in net volume vb (sealed.dart designSealed). */
export function designSealed({ fs, qts, vas, vb, fill = 1 }) {
  const bad = positive({ fs, qts, vas, vb, fill });
  if (bad) return bad;
  const vbe = vb * fill;
  const alpha = vas / vbe;
  const k = Math.sqrt(alpha + 1);
  const qtc = qts * k;
  const fc = fs * k;
  const f3 = fc * f3Ratio(qtc);
  let f3FromPeak = f3;
  let peakDb = 0;
  let peakHz = null;
  if (qtc > Math.SQRT1_2) {
    const up = 1 / (1 - 1 / (2 * qtc * qtc));
    const m2 = (qtc * qtc) / (1 - 1 / (4 * qtc * qtc));
    peakDb = 10 * log10(m2);
    peakHz = fc * Math.sqrt(up);
    const u = bisect((x) => (x * x) / (sq(1 - x) + x / (qtc * qtc)) - m2 / 2, 0, up);
    f3FromPeak = fc * Math.sqrt(u);
  }
  if (![alpha, qtc, fc, f3, f3FromPeak, peakDb].every(Number.isFinite)) return fail('outOfRange', 'result');
  return ok({ vbEffective: vbe, alpha, qtc, fc, f3, f3FromPeak, peakDb, peakHz });
}

// ---- port.dart ---------------------------------------------------------------------------------

export const endFactor = (e) => (e === 'flanged' ? END_FLANGED : END_FREE);
/** Sum of the end corrections, × radius: flanged + free 1.4621 (default). */
export const endCorrectionFactor = (ends) => ends.reduce((a, e) => a + endFactor(e), 0);

/** A port: { shape: 'round', diameter } or { shape: 'slot', width, height }, with count and ends
 *  (default one flanged + one free). SI: m. */
export function makePort(p) {
  return { count: 1, ends: DEFAULT_ENDS, slotDiameter: 'areaEquivalent', ...p };
}
export const areaEach = (p) => (p.shape === 'slot' ? p.width * p.height : Math.PI * sq(p.diameter / 2));
export const portArea = (p) => p.count * areaEach(p);
export function endDiameter(p) {
  if (p.shape !== 'slot') return p.diameter;
  return p.slotDiameter === 'areaEquivalent' ? Math.sqrt((4 * areaEach(p)) / Math.PI) : (4 * areaEach(p)) / (2 * (p.width + p.height));
}
export const endCorrection = (p) => (endCorrectionFactor(p.ends) * endDiameter(p)) / 2;
/** Slots and flares use an estimated end correction. */
export const portIsEstimate = (p) => p.shape !== 'round';

function checkPort(p) {
  const dims = p.shape === 'slot' ? { width: p.width, height: p.height } : { d: p.diameter };
  const bad = positive(dims);
  if (bad) return bad;
  if (!Number.isInteger(p.count) || p.count < 1) return fail('invalidInput', 'count', { actual: p.count });
  if (!Array.isArray(p.ends) || p.ends.length !== 2) return fail('invalidInput', 'ends');
  return null;
}
function checkAir(air) {
  return positive({ c: air.c, rho: air.rho });
}

/** Helmholtz: Leff = c²·Sp/(4π²·Fb²·Vb). */
export function portEffectiveLength(sp, vb, fb, air = AIR) {
  return checkAir(air) || scalar({ sp, vb, fb }, () => (air.c * air.c * sp) / (4 * Math.PI * Math.PI * fb * fb * vb));
}
/** Fb = (c/2π)·√(Sp/(Vb·Leff)). */
export function fbFromPort(sp, vb, leff, air = AIR) {
  return checkAir(air) || scalar({ sp, vb, leff }, () => (air.c / (2 * Math.PI)) * Math.sqrt(sp / (vb * leff)));
}
/** First open-open pipe mode c/(2·Leff). */
export function pipeResonance(leff, air = AIR) {
  return checkAir(air) || scalar({ leff }, () => air.c / (2 * leff));
}
/** One round port with the area of n ports of diameter d: √n·d. */
export const equivalentDiameter = (n, d) => scalar({ n, d }, () => Math.sqrt(n) * d);
/** Area-equivalent √(4wh/π) and hydraulic 4A/P diameters of a slot. */
export function slotEquivalentDiameter(w, h) {
  const bad = positive({ w, h });
  if (bad) return bad;
  return ok({ areaEquivalent: Math.sqrt((4 * w * h) / Math.PI), hydraulic: (4 * w * h) / (2 * (w + h)) });
}
/** Longest internal dimension of a box of volume vb at 1 : 1.25 : 1.6. */
export const defaultLongestDimension = (vb) => 1.6 * Math.pow(vb / (1.25 * 1.6), 1 / 3);

/** Length of `port` that tunes net volume vb (m³) to fb (Hz) (port.dart portLength).
 *  portTooShort blocks; portTooLong, pipeResonanceLow and portAreaBelowMinimum warn. */
export function portLength(port, vb, fb, { air = AIR, longestInside = null, lowPassHz = 80, vd = null } = {}) {
  const p = makePort(port);
  const bad = checkPort(p) || positive({ vb, fb, lowPassHz })
    || positive({ ...(longestInside !== null ? { longestInside } : {}), ...(vd !== null ? { vd } : {}) }) || checkAir(air);
  if (bad) return bad;
  const sp = portArea(p);
  const leff = (air.c * air.c * sp) / (4 * Math.PI * Math.PI * fb * fb * vb);
  const ec = endCorrection(p);
  const phys = leff - ec;
  if (!Number.isFinite(leff) || !Number.isFinite(phys)) return fail('outOfRange', 'result');
  if (phys <= 0) return fail('portTooShort', 'leff', { limit: ec, actual: leff });
  const pipe = air.c / (2 * leff);
  const clearance = p.shape === 'slot' ? p.width : p.diameter;
  const available = (longestInside ?? defaultLongestDimension(vb)) - clearance;
  const findings = [];
  if (phys > available) findings.push({ code: 'portTooLong', field: 'physical', limit: available, actual: phys });
  if (pipe < 4 * lowPassHz) findings.push({ code: 'pipeResonanceLow', field: 'pipeModeHz', limit: 4 * lowPassHz, actual: pipe });
  if (vd !== null && sp < 0.8 * fb * vd) findings.push({ code: 'portAreaBelowMinimum', field: 'area', limit: 0.8 * fb * vd, actual: sp });
  return {
    ...ok({ physical: phys, effective: leff, endCorrection: ec, area: sp, pipeModeHz: pipe, availableLength: available }, findings),
    isEstimate: portIsEstimate(p) || (longestInside === null && phys > available),
  };
}

/** Tuning of a built port of `physical` length on net volume vb (port.dart portTuning). */
export function portTuning(port, physical, vb, air = AIR) {
  const p = makePort(port);
  const bad = checkPort(p) || positive({ physical, vb }) || checkAir(air);
  if (bad) return bad;
  const leff = physical + endCorrection(p);
  const fb = (air.c / (2 * Math.PI)) * Math.sqrt(portArea(p) / (vb * leff));
  if (!Number.isFinite(fb)) return fail('outOfRange', 'result');
  return { ...ok(fb), isEstimate: portIsEstimate(p) };
}

// ---- wiring.dart -------------------------------------------------------------------------------

function list(z, f) {
  if (!Array.isArray(z) || !z.length) return fail('invalidInput', 'z');
  for (const x of z) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return fail('nonFinite', 'z');
    if (x <= 0) return fail('invalidInput', 'z', { actual: x });
  }
  const v = f();
  return Number.isFinite(v) ? ok(v) : fail('outOfRange', 'result');
}
/** Series: Z = ΣZi. */
export const seriesImpedance = (z) => list(z, () => z.reduce((a, b) => a + b, 0));
/** Parallel: 1/Z = Σ1/Zi. */
export const parallelImpedance = (z) => list(z, () => 1 / z.reduce((a, b) => a + 1 / b, 0));

/** The coil wirings that connect every coil of a driver with `coils` coils. */
export const coilWiringsFor = (coils) => ({ 1: ['single'], 2: ['series', 'parallel'], 4: ['series', 'parallel', 'seriesParallel'] }[coils] || []);

/** One driver: `coils` coils of coilOhm wired `wiring` (single, series, parallel, seriesParallel). */
export function driverImpedance(coilOhm, coils, wiring) {
  const bad = positive({ coilOhm });
  if (bad) return bad;
  if (!coilWiringsFor(coils).includes(wiring)) return fail('invalidInput', 'wiring', { actual: coils });
  const z = { single: coilOhm, series: coils * coilOhm, parallel: coilOhm / coils, seriesParallel: coilOhm }[wiring];
  return Number.isFinite(z) ? ok(z) : fail('outOfRange', 'result');
}

/** A bank of `subs` identical drivers: coils wired coilWiring, subs wired subWiring (series or
 *  parallel; ignored for one sub). */
export function dvcBank({ subs, coilOhm, coilsPerSub = 2, coilWiring, subWiring = 'parallel' }) {
  const bad = positive({ subs, coilOhm });
  if (bad) return bad;
  const one = driverImpedance(coilOhm, coilsPerSub, coilWiring);
  if (one.value === null) return one;
  const zd = one.value;
  let z;
  if (subs === 1) z = zd;
  else if (subWiring === 'series') z = subs * zd;
  else if (subWiring === 'parallel') z = zd / subs;
  else return fail('invalidInput', 'subWiring');
  return Number.isFinite(z) ? ok(z) : fail('outOfRange', 'result');
}

// ---- ts.dart -----------------------------------------------------------------------------------

/** Qts = Qes·Qms/(Qes + Qms). */
export const qtsFromQesQms = (qes, qms) => scalar({ qes, qms }, () => (qes * qms) / (qes + qms));
/** Cms = Vas/(ρc²·Sd²). */
export const cmsFromVas = (vas, sd, air = AIR) => checkAir(air) || scalar({ vas, sd }, () => vas / (air.rho * air.c * air.c * sd * sd));
/** Vas = ρc²·Sd²·Cms. */
export const vasFromCms = (cms, sd, air = AIR) => checkAir(air) || scalar({ cms, sd }, () => air.rho * air.c * air.c * sd * sd * cms);
/** Fs = 1/(2π√(Mms·Cms)). */
export const fsFromMmsCms = (mms, cms) => scalar({ mms, cms }, () => 1 / (2 * Math.PI * Math.sqrt(mms * cms)));
/** Sd = π(D/2)². */
export const sdFromDiameter = (d) => scalar({ d }, () => Math.PI * sq(d / 2));

/** Relative thresholds of the cross-checks (ts.dart checkThreshold; Sd vs D is [E]). */
export const CHECK_THRESHOLD = Object.freeze({ qts: 0.02, fs: 0.03, vas: 0.05, vasFromDiameter: 0.05, qesBl: 0.05, sdDiameter: 0.03 });
const CHECK_ISSUE = { qts: 'qtsMismatch', fs: 'fsMismatch', vas: 'vasMismatch', vasFromDiameter: 'vasMismatch', qesBl: 'qesBlMismatch', sdDiameter: 'sdDiameterMismatch' };
const nearRatio = (ratio, target, rel) => Math.abs(ratio / target - 1) <= rel;

/** Cross-checks between the entered T/S values (ts.dart checkConsistency). SI: Hz, m³, m², m,
 *  kg, m/N, T·m, Ω; leave a value out (null/undefined) when the datasheet does not print it.
 *  value = the checks [{ kind, given, derived, deviation, threshold, passed }]; findings = the
 *  failed checks and unit traps; issue = qtsNotBelowQesQms when Qts ≥ min(Qes, Qms). */
export function checkConsistency(d, air = AIR) {
  const present = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined));
  const bad = positive(present) || checkAir(air);
  if (bad) return bad;
  const rhoC2 = air.rho * air.c * air.c;
  const checks = [];
  const findings = [];
  let overflowed = false;
  const add = (kind, given, derived, reverse = false) => {
    const dev = reverse ? (given - derived) / derived : (derived - given) / given;
    if (!Number.isFinite(derived) || !Number.isFinite(dev)) { overflowed = true; return; }
    const threshold = CHECK_THRESHOLD[kind];
    const c = { kind, given, derived, deviation: dev, threshold, passed: Math.abs(dev) <= threshold };
    checks.push(c);
    if (!c.passed) findings.push({ code: CHECK_ISSUE[kind], severity: 'warning', field: kind, limit: threshold, actual: given, derived });
  };
  const { qts, qes, qms, fs, mms, cms, vas, sd, diameter: dia, re, bl, xmax, vd } = present;
  if (qts !== undefined && qes !== undefined && qms !== undefined) {
    if (qts >= Math.min(qes, qms)) {
      return { value: null, issue: { code: 'qtsNotBelowQesQms', field: 'qts', limit: Math.min(qes, qms), actual: qts }, findings: [] };
    }
    add('qts', qts, (qes * qms) / (qes + qms));
  }
  if (fs !== undefined && mms !== undefined && cms !== undefined) add('fs', fs, 1 / (2 * Math.PI * Math.sqrt(mms * cms)));
  const sdOfD = dia === undefined ? undefined : Math.PI * sq(dia / 2);
  if (sd !== undefined && sdOfD !== undefined) {
    add('sdDiameter', sd, sdOfD, true);
    if (nearRatio(sd / sdOfD, 1e4, 0.1) || nearRatio(sd / sdOfD, 1e-4, 0.1)) findings.push({ code: 'sdLooksLikeCm2', severity: 'warning', field: 'sd', actual: sd, derived: sdOfD });
  }
  if (vas !== undefined && cms !== undefined && (sd ?? sdOfD) !== undefined) {
    const area = sd ?? sdOfD;
    const derived = rhoC2 * area * area * cms;
    add('vas', vas, derived);
    const ratio = vas / derived;
    if (nearRatio(ratio, 1 / LITRES_PER_FT3, 0.1)) findings.push({ code: 'vasLooksLikeFt3', severity: 'warning', field: 'vas', actual: vas, derived });
    else if (nearRatio(ratio, LITRES_PER_FT3, 0.1)) findings.push({ code: 'vasLooksLikeLitres', severity: 'warning', field: 'vas', actual: vas, derived });
    if (sd !== undefined && sdOfD !== undefined && Math.abs(sd / sdOfD - 1) > 0.03) add('vasFromDiameter', vas, rhoC2 * sdOfD * sdOfD * cms);
  }
  if (qes !== undefined && fs !== undefined && mms !== undefined && re !== undefined && bl !== undefined) {
    add('qesBl', qes, (2 * Math.PI * fs * mms * re) / (bl * bl));
  }
  if (xmax !== undefined && vd !== undefined && (sd ?? sdOfD) !== undefined) {
    const ratio = vd / ((sd ?? sdOfD) * xmax);
    if (nearRatio(ratio, 0.5, 0.1)) findings.push({ code: 'xmaxLooksPeakToPeak', severity: 'warning', field: 'xmax', actual: xmax, derived: vd / (sd ?? sdOfD) });
  }
  if (overflowed) return fail('outOfRange', 'result');
  return ok(checks, findings);
}
