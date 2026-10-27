// Page wiring for the free calculators on the Boxwright site. The maths is in boxcalc.js (a port of
// packages/box_acoustics); this file reads the page's strings from its JSON block (#calc-i18n),
// parses numbers with a comma or a dot, checks ranges with a reason, and writes the result with
// "how it was worked out". Results update while you type. Nothing is sent or stored.
// Adapted from Demijohn's tools/site/static/calc-ui.js.
import * as B from './boxcalc.js';

/** A number typed with a comma or a dot as the decimal mark, with optional thousands separators.
 *  Returns null for anything else (fractions, exponents, words). */
export function parseNumber(raw, decimal = '.') {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[\s  ']/g, '').replace(/−/g, '-');
  if (!s || !/^-?[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  let dec = null;
  if (lastComma >= 0 && lastDot >= 0) dec = lastComma > lastDot ? ',' : '.';
  else if (lastComma >= 0) dec = s.split(',').length === 2 && (decimal === ',' || !/^\d{1,3},\d{3}$/.test(s)) ? ',' : null;
  else if (lastDot >= 0) dec = s.split('.').length === 2 && (decimal === '.' || !/^\d{1,3}\.\d{3}$/.test(s)) ? '.' : null;
  const group = dec === ',' ? '.' : dec === '.' ? ',' : null;
  if (group) s = s.split(group).join('');
  if (!dec) s = s.replace(/[.,]/g, '');
  else s = s.replace(dec, '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ICON = {
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.5"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 8.5 7 7m0-7-7 7"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  good: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

function setup() {
  const form = document.getElementById('calc-form');
  const data = document.getElementById('calc-i18n');
  const res = document.getElementById('res');
  if (!form || !data || !res) return;
  const T = JSON.parse(data.textContent);
  const nojs = document.getElementById('calc-nojs');
  if (nojs) nojs.hidden = true;
  res.hidden = false;

  const nf = (d, min = 0) => new Intl.NumberFormat(T.locale, { maximumFractionDigits: d, minimumFractionDigits: min, useGrouping: false });
  const fmt = (n, d = 1, min = d) => nf(d, min).format(Math.abs(n) < 0.5 * 10 ** -d ? 0 : n);
  const fill = (tpl, o) => tpl.replace(/\{([a-zA-Z0-9]+)\}/g, (m, k) => (k in o ? o[k] : m));
  const NB = ' ';
  const flag = (kind, text) => `<div class="flag ${kind}">${ICON[kind]}<p><span class="flag-word">${esc(T.words[kind])}:</span> ${esc(text)}</p></div>`;
  const radio = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
  const unitsNow = () => radio('units') || T.units;

  // Groups shown for one radio value: data-show="name:value".
  function toggle() {
    for (const el of form.querySelectorAll('[data-show]')) {
      const [name, value] = el.dataset.show.split(':');
      const on = radio(name) === value;
      el.hidden = !on;
    }
    for (const el of form.querySelectorAll('[data-unit]')) el.textContent = T.unitNames[unitsNow()][el.dataset.unit];
  }

  /** Reads a field: { v } or { err } (empty optional fields are { v: null }). */
  function read(id, { min = null, max = null, optional = false, integer = false } = {}) {
    const input = document.getElementById(id);
    const err = document.getElementById(`${id}-err`);
    const show = (msg) => {
      if (msg) { input.setAttribute('aria-invalid', 'true'); err.textContent = msg; err.hidden = false; } else { input.removeAttribute('aria-invalid'); err.hidden = true; err.textContent = ''; }
    };
    if (!input || input.closest('[hidden]')) return { v: null, skip: true };
    const raw = input.value.trim();
    if (!raw) { if (optional) { show(''); return { v: null }; } show(T.errEmpty); return { err: true }; }
    const v = parseNumber(raw, T.decimal);
    if (v === null) { show(T.errNumber); return { err: true }; }
    if (integer && !Number.isInteger(v)) { show(T.errInteger); return { err: true }; }
    if ((min !== null && v < min) || (max !== null && v > max)) {
      show(fill(T.errRange, { min: fmt(min, 3, 0), max: fmt(max, 3, 0) }));
      return { err: true };
    }
    show('');
    return { v };
  }

  // Unit helpers: volumes in L or ft³, lengths in cm or in. SI inside (m³, m).
  const vol = (x) => (unitsNow() === 'imperial' ? B.ft3ToL(x) : x) / 1000;
  const len = (x) => (unitsNow() === 'imperial' ? B.inToMm(x) / 1000 : x / 100);
  const volOut = (m3) => (unitsNow() === 'imperial' ? `${fmt(B.lToFt3(m3 * 1000), 2)}${NB}ft³` : `${fmt(m3 * 1000, 1)}${NB}L`);
  function frac16(inches) {
    const n = Math.round(inches * 16);
    const whole = Math.floor(n / 16);
    let num = n % 16, den = 16;
    while (num && num % 2 === 0) { num /= 2; den /= 2; }
    return num ? `${whole ? `${whole} ` : ''}${num}/${den}` : `${whole}`;
  }
  const lenOut = (m) => (unitsNow() === 'imperial'
    ? `${fmt(m / 0.0254, 2)}${NB}in (${frac16(m / 0.0254)}″)`
    : `${fmt(m * 100, 1)}${NB}cm`);
  const areaOut = (m2) => (unitsNow() === 'imperial' ? `${fmt(m2 / 0.00064516, 1)}${NB}in²` : `${fmt(m2 * 1e4, 1)}${NB}cm²`);
  const hz = (f) => `${fmt(f, 1)}${NB}Hz`;

  // Switching units converts what is typed, so the box stays the same box.
  let lastUnits = unitsNow();
  form.addEventListener('change', (e) => {
    if (e.target.name === 'units' && unitsNow() !== lastUnits) {
      const toImp = unitsNow() === 'imperial';
      for (const input of form.querySelectorAll('input[data-kind]')) {
        const v = parseNumber(input.value, T.decimal);
        if (v === null) continue;
        const k = input.dataset.kind;
        const out = k === 'vol' ? (toImp ? B.lToFt3(v) : B.ft3ToL(v)) : (toImp ? v / 2.54 : v * 2.54);
        input.value = fmt(out, k === 'vol' ? 2 : 2, 0);
      }
      lastUnits = unitsNow();
    }
  });

  const calcs = { box: boxCalc, ts: tsCalc };
  const run = () => { toggle(); res.innerHTML = calcs[form.dataset.calc](); };
  form.addEventListener('input', run);
  form.addEventListener('change', run);
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  run();

  // ---- sealed / ported box ----------------------------------------------------------------------

  function boxCalc() {
    return radio('mode') === 'ported' ? ported() : sealed();
  }

  function sealed() {
    const fs = read('fs', { min: 5, max: 500 });
    const qts = read('qts', { min: 0.05, max: 3 });
    const vas = read('vas', { min: 0.001, max: 5000 });
    const vb = read('vb', { min: 0.001, max: 5000 });
    if ([fs, qts, vas, vb].some((x) => x.err)) return `<p class="res-what">${esc(T.fixInputs)}</p>`;
    const d = B.designSealed({ fs: fs.v, qts: qts.v, vas: vol(vas.v), vb: vol(vb.v) });
    if (d.value === null) return flag('stop', T.errPositive);
    const r = d.value;
    const band = r.qtc < 0.6 ? T.qtcLow : r.qtc <= 0.8 ? T.qtcFlat : r.qtc <= 1.0 ? T.qtcPunchy : T.qtcPeaky;
    const rows = [0.577, 0.707, 0.8, 0.9, 1.0].map((q) => {
      const v = B.sealedVbForQtc(qts.v, vol(vas.v), q);
      return `<tr><td>${fmt(q, 3)}</td><td>${v.value === null ? esc(T.noBox) : volOut(v.value)}</td></tr>`;
    }).join('');
    return `<h3>${esc(T.sealedH)}</h3>
<p class="big">Qtc ${fmt(r.qtc, 2)}</p>
<p class="res-what">${esc(band)}</p>
<ul class="kv">
<li><span>${esc(T.fc)}</span><b>${hz(r.fc)}</b></li>
<li><span>${esc(T.f3)}</span><b>${hz(r.f3)}</b></li>
${r.peakHz ? `<li><span>${esc(T.f3Peak)}</span><b>${hz(r.f3FromPeak)}</b></li><li><span>${esc(T.peak)}</span><b>+${fmt(r.peakDb, 1)}${NB}dB @ ${hz(r.peakHz)}</b></li>` : ''}
<li><span>α = Vas/Vb</span><b>${fmt(r.alpha, 2)}</b></li>
</ul>
<div class="table-wrap"><table class="num-table"><caption>${esc(T.qtcTable)}</caption><thead><tr><th scope="col">Qtc</th><th scope="col">${esc(T.netVolume)}</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="how"><p class="how-h">${esc(T.howTitle)}</p>
<p>α = Vas/Vb = ${fmt(vas.v, 2, 0)} / ${fmt(vb.v, 2, 0)} = ${fmt(r.alpha, 3)}</p>
<p>Qtc = Qts·√(α + 1) = ${fmt(qts.v, 3, 0)} × ${fmt(Math.sqrt(r.alpha + 1), 3)} = ${fmt(r.qtc, 3)}</p>
<p>Fc = Fs·√(α + 1) = ${fmt(fs.v, 1)} × ${fmt(Math.sqrt(r.alpha + 1), 3)} = ${hz(r.fc)}</p>
<p>${esc(T.howSealed)}</p></div>`;
  }

  function ported() {
    const vb = read('pvb', { min: 0.001, max: 5000 });
    const fb = read('fb', { min: 5, max: 200 });
    const shape = radio('shape') || 'round';
    const count = read('count', { min: 1, max: 8, integer: true });
    const dia = shape === 'round' ? read('dia', { min: 0.1, max: 100 }) : { v: null };
    const sw = shape === 'slot' ? read('sw', { min: 0.1, max: 200 }) : { v: null };
    const sh = shape === 'slot' ? read('sh', { min: 0.1, max: 400 }) : { v: null };
    const built = read('built', { min: 0.1, max: 2000, optional: true });
    if ([vb, fb, count, dia, sw, sh, built].some((x) => x.err)) return `<p class="res-what">${esc(T.fixInputs)}</p>`;
    const ends = (radio('ends') || 'flanged-free').split('-');
    const port = shape === 'slot'
      ? { shape: 'slot', width: len(sw.v), height: len(sh.v), count: count.v, ends }
      : { shape: 'round', diameter: len(dia.v), count: count.v, ends };
    const vbm = vol(vb.v);
    const r = B.portLength(port, vbm, fb.v);
    if (r.value === null) {
      if (r.issue.code === 'portTooShort') return `<h3>${esc(T.portedH)}</h3>${flag('stop', fill(T.tooShort, { leff: lenOut(r.issue.actual), ec: lenOut(r.issue.limit) }))}`;
      return flag('stop', T.errPositive);
    }
    const p = r.value;
    const flags = [];
    for (const f of r.findings) {
      if (f.code === 'portTooLong') flags.push(flag('warn', fill(T.tooLong, { len: lenOut(f.actual), room: lenOut(f.limit) })));
      if (f.code === 'pipeResonanceLow') flags.push(flag('warn', fill(T.pipeLow, { hz: hz(f.actual) })));
    }
    if (shape === 'slot') flags.push(flag('info', T.slotEstimate));
    let builtHtml = '';
    if (built.v !== null) {
      const t = B.portTuning(port, len(built.v), vbm);
      if (t.value !== null) builtHtml = `<li><span>${esc(fill(T.builtTunes, { len: lenOut(len(built.v)) }))}</span><b>${hz(t.value)}</b></li>`;
    }
    const endsWord = T.endsNames[ends.join('-')];
    return `<h3>${esc(T.portedH)}</h3>
<p class="big">${lenOut(p.physical)}</p>
<p class="res-what">${esc(fill(T.portedWhat, { n: String(count.v), vb: volOut(vbm), fb: hz(fb.v) }))}</p>
<ul class="kv">
<li><span>${esc(T.effective)}</span><b>${lenOut(p.effective)}</b></li>
<li><span>${esc(T.endCorr)}</span><b>${lenOut(p.endCorrection)}</b></li>
<li><span>${esc(T.area)}</span><b>${areaOut(p.area)}</b></li>
<li><span>${esc(T.pipe)}</span><b>${hz(p.pipeModeHz)}</b></li>
${builtHtml}
</ul>
${flags.join('\n')}
${flag('info', T.netNote)}
<div class="how"><p class="how-h">${esc(T.howTitle)}</p>
<p>Leff = c²·Sp / (4π²·Fb²·Vb) = 343² × ${areaOut(p.area)} / (4π² × ${fmt(fb.v, 1)}² × ${volOut(vbm)}) = ${lenOut(p.effective)}</p>
<p>${esc(fill(T.howPorted, { ends: endsWord, ec: lenOut(p.endCorrection) }))}</p></div>`;
  }

  // ---- datasheet cross-check --------------------------------------------------------------------

  function tsCalc() {
    const opt = { optional: true };
    const f = {
      fs: read('t-fs', { ...opt, min: 1, max: 5000 }), qts: read('t-qts', { ...opt, min: 0.01, max: 10 }),
      qes: read('t-qes', { ...opt, min: 0.01, max: 50 }), qms: read('t-qms', { ...opt, min: 0.01, max: 100 }),
      vas: read('t-vas', { ...opt, min: 0.001, max: 10000 }), sd: read('t-sd', { ...opt, min: 0.1, max: 50000 }),
      d: read('t-d', { ...opt, min: 0.1, max: 200 }), cms: read('t-cms', { ...opt, min: 0.0001, max: 100 }),
      mms: read('t-mms', { ...opt, min: 0.01, max: 5000 }), re: read('t-re', { ...opt, min: 0.01, max: 100 }),
      bl: read('t-bl', { ...opt, min: 0.01, max: 100 }),
    };
    if (Object.values(f).some((x) => x.err)) return `<p class="res-what">${esc(T.fixInputs)}</p>`;
    const v = (k, s) => (f[k].v === null ? undefined : f[k].v * s);
    const driver = {
      fs: v('fs', 1), qts: v('qts', 1), qes: v('qes', 1), qms: v('qms', 1), vas: v('vas', 1e-3), sd: v('sd', 1e-4),
      diameter: v('d', 1e-2), cms: v('cms', 1e-3), mms: v('mms', 1e-3), re: v('re', 1), bl: v('bl', 1),
    };
    const r = B.checkConsistency(driver);
    if (r.value === null) {
      if (r.issue.code === 'qtsNotBelowQesQms') return `<h3>${esc(T.tsH)}</h3>${flag('stop', T.qtsImpossible)}`;
      return flag('stop', T.errPositive);
    }
    if (!r.value.length && !r.findings.length) return `<h3>${esc(T.tsH)}</h3><p class="res-what">${esc(T.tsNeedMore)}</p>`;
    const show = {
      qts: (x) => fmt(x, 3), fs: (x) => `${fmt(x, 2)}${NB}Hz`, vas: (x) => `${fmt(x * 1000, 1)}${NB}L`, vasFromDiameter: (x) => `${fmt(x * 1000, 1)}${NB}L`,
      qesBl: (x) => fmt(x, 3), sdDiameter: (x) => `${fmt(x * 1e4, 1)}${NB}cm²`,
    };
    const rows = r.value.map((c) => `<tr><th scope="row" class="l">${esc(T.checks[c.kind])}</th><td>${show[c.kind](c.given)}</td><td>${show[c.kind](c.derived)}</td><td>${c.deviation >= 0 ? '+' : '−'}${fmt(Math.abs(c.deviation) * 100, 1)}${NB}%</td><td>${c.passed ? `<span class="ok-mark">✓ ${esc(T.words.good)}</span>` : `✕ ${esc(T.words.warn)}`} (±${fmt(c.threshold * 100, 0)}${NB}%)</td></tr>`).join('');
    const traps = r.findings.filter((x) => T.traps[x.code]).map((x) => flag('warn', T.traps[x.code]));
    const bad = r.value.filter((c) => !c.passed).length;
    return `<h3>${esc(T.tsH)}</h3>
<p class="big">${bad ? `${bad} ✕` : '✓'}</p>
<p class="res-what">${esc(bad ? fill(T.tsBad, { n: String(bad), total: String(r.value.length) }) : fill(T.tsGood, { total: String(r.value.length) }))}</p>
${r.value.length ? `<div class="table-wrap"><table class="num-table"><thead><tr><th scope="col">${esc(T.tsCheck)}</th><th scope="col">${esc(T.tsGiven)}</th><th scope="col">${esc(T.tsDerived)}</th><th scope="col">Δ</th><th scope="col">${esc(T.tsResult)}</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
${traps.join('\n')}
<div class="how"><p class="how-h">${esc(T.howTitle)}</p><p>${esc(T.howTs)}</p></div>`;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
}
