'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const S = { cur: null, rec: null, daily: null, range: 1, cal: 'temp', epoch: null };
  const darkMq = matchMedia('(prefers-color-scheme: dark)');

  /* ================================================================ čas (Europe/Prague) */
  const offCache = {};
  function lastSundayUtc(y, m) {
    const d = new Date(Date.UTC(y, m, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 1) / 1000;
  }
  function pragueOffset(ts) {
    const y = new Date(ts * 1000).getUTCFullYear();
    const o = offCache[y] || (offCache[y] = [lastSundayUtc(y, 3), lastSundayUtc(y, 10)]);
    return ts >= o[0] && ts < o[1] ? 7200 : 3600;
  }
  const L = (ts) => new Date((ts + pragueOffset(ts)) * 1000); // čtěte přes getUTC*
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (ts) => { const d = L(ts); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const keyParts = (k) => k.split('-').map(Number);
  function keyAdd(k, n) {
    const [Y, M, D] = keyParts(k);
    const d = new Date(Date.UTC(Y, M - 1, D + n));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  function dayStart(k) {
    const [Y, M, D] = keyParts(k);
    return Date.UTC(Y, M - 1, D) / 1000 - pragueOffset(Date.UTC(Y, M - 1, D, 12) / 1000);
  }
  const keyDate = (k) => { const [Y, M, D] = keyParts(k); return new Date(Date.UTC(Y, M - 1, D)); };

  /* ================================================================ formátování */
  const DOW = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
  const DOW_LONG = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  const MON_SHORT = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
  const MON = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const DIR8 = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
  const DIR8_FROM = ['od severu', 'od severovýchodu', 'od východu', 'od jihovýchodu', 'od jihu', 'od jihozápadu', 'od západu', 'od severozápadu'];
  const DIR8_NAME = ['Sever', 'Severovýchod', 'Východ', 'Jihovýchod', 'Jih', 'Jihozápad', 'Západ', 'Severozápad'];

  function num(v, d = 1) {
    if (v == null || !isFinite(v)) return '–';
    const f = 10 ** d;
    let x = Math.round(v * f) / f;
    if (Object.is(x, -0) || x === 0) x = 0;
    let s = x.toFixed(d).replace('.', ',');
    if (s[0] === '-') s = '−' + s.slice(1);
    return s;
  }
  const hm = (ts) => { const d = L(ts); return `${d.getUTCHours()}:${pad(d.getUTCMinutes())}`; };
  const shortDate = (k) => { const d = keyDate(k); return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`; };
  const fullDate = (k) => { const d = keyDate(k); return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`; };
  const longDate = (k) => { const d = keyDate(k); return `${DOW_LONG[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`; };
  const dirIndex = (deg) => Math.floor((((deg % 360) + 360) % 360 + 22.5) / 45) % 8;
  const dayWord = (n) => (n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dní');

  function beaufort(k) {
    const lim = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
    const names = ['bezvětří', 'vánek', 'větřík', 'slabý vítr', 'mírný vítr', 'čerstvý vítr', 'silný vítr', 'prudký vítr', 'bouřlivý vítr', 'vichřice', 'silná vichřice', 'mohutná vichřice', 'orkán'];
    let i = 0;
    while (i < lim.length && k >= lim[i]) i++;
    return names[i];
  }
  const setText = (id, t) => { $(id).textContent = t; };
  function setRich(el, parts) { // parts: string | {b: string}
    el.replaceChildren();
    for (const p of parts) {
      if (typeof p === 'string') el.append(document.createTextNode(p));
      else { const b = document.createElement('b'); b.textContent = p.b; el.append(b); }
    }
  }

  /* ================================================================ tooltip */
  const tip = $('tip');
  function showTip(cx, cy, title, rows) {
    tip.replaceChildren();
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = title;
    tip.append(t);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'r';
      if (r.color) {
        const k = document.createElement('span');
        k.className = r.rect ? 'key-rect' : 'key-line';
        k.style.background = r.color;
        row.append(k);
      }
      const b = document.createElement('b');
      b.textContent = r.value;
      row.append(b);
      if (r.name) {
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = r.name;
        row.append(n);
      }
      tip.append(row);
    }
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = cx + 14, top = cy - h - 14;
    if (left + w > innerWidth - 8) left = cx - w - 14;
    if (left < 8) left = 8;
    if (top < 8) top = cy + 18;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  /* ================================================================ pomocné výpočty */
  function lin(d0, d1, r0, r1) {
    const k = (r1 - r0) / ((d1 - d0) || 1);
    const f = (v) => r0 + (v - d0) * k;
    f.inv = (p) => d0 + (p - r0) / k;
    return f;
  }
  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1;
    const raw = span / n;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const e = raw / mag;
    const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(6));
    return { lo: a, hi: b, step, ticks };
  }
  function bisect(arr, v) {
    let a = 0, b = arr.length;
    while (a < b) { const m = (a + b) >> 1; if (arr[m] < v) a = m + 1; else b = m; }
    return a;
  }
  function nearest(arr, v, i0 = 0, i1 = arr.length) {
    let i = bisect(arr, v);
    i = Math.max(i0, Math.min(i1 - 1, i));
    if (i > i0 && v - arr[i - 1] < arr[i] - v) i--;
    return i;
  }
  function valueAt(key, ts, tol = 1200) {
    const r = S.rec;
    if (!r || !r.ts.length) return null;
    const i = nearest(r.ts, ts);
    return Math.abs(r.ts[i] - ts) <= tol ? r[key][i] : null;
  }
  function maxBy(arr, f) { let best = null; for (const x of arr) { const v = f(x); if (v != null && (best == null || v > f(best))) best = x; } return best; }
  function minBy(arr, f) { let best = null; for (const x of arr) { const v = f(x); if (v != null && (best == null || v < f(best))) best = x; } return best; }

  /* ================================================================ barvy */
  function hexToLab(hex) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
    const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
    const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function labToHex([L_, a, b]) {
    const l = (L_ + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L_ - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L_ - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    return '#' + rgb.map((v) => { v = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return pad(Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16)); }).join('');
  }
  function mix(h1, h2, t) { const a = hexToLab(h1), b = hexToLab(h2); return labToHex(a.map((v, i) => v + (b[i] - v) * t)); }
  const TEMP_COLD = -12, TEMP_HOT = 28;
  function tempColor(v) {
    const th = darkMq.matches ? { mid: '#383835', cold: '#86b6ef', hot: '#f0876a' } : { mid: '#f0efec', cold: '#184f95', hot: '#b3261e' };
    if (v <= 0) return mix(th.mid, th.cold, Math.min(1, v / TEMP_COLD));
    return mix(th.mid, th.hot, Math.min(1, v / TEMP_HOT));
  }
  const RAIN_BINS = [0.1, 1, 5, 10, 20];
  const RAIN_LABELS = ['0', 'do 1', '1–5', '5–10', '10–20', '20+ mm'];
  function rainColors() {
    return darkMq.matches
      ? ['#232321', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6']
      : ['#f0efec', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
  }
  function rainColor(v) { let i = 0; while (i < RAIN_BINS.length && v >= RAIN_BINS[i]) i++; return rainColors()[i]; }
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* ================================================================ graf s časovou osou */
  function timeTicks(mode, xMin, xMax, pw) {
    const grid = [], labels = [];
    if (mode === 'hours') {
      const step = pw < 520 ? 6 : 3;
      for (let t = Math.ceil(xMin / 3600) * 3600; t <= xMax; t += 3600) {
        const d = L(t), h = d.getUTCHours();
        if (h % step) continue;
        grid.push(t);
        labels.push({ ts: t, text: h === 0 ? `${DOW[d.getUTCDay()]} ${d.getUTCDate()}.` : `${h}:00`, strong: h === 0 });
      }
    } else if (mode === 'days' || mode === 'weeks') {
      for (let k = dayKey(xMin + 7200); dayStart(k) < xMax - 3600; k = keyAdd(k, 1)) {
        const s = dayStart(k), d = keyDate(k);
        if (mode === 'days') {
          grid.push(s);
          labels.push({ ts: s + 43200, text: `${DOW[d.getUTCDay()]} ${d.getUTCDate()}.` });
        } else if (d.getUTCDay() === 1) {
          grid.push(s);
          labels.push({ ts: s, text: `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.` });
        }
      }
    } else if (mode === 'months') {
      let k = dayKey(xMin + 7200);
      k = k.slice(0, 8) + '01';
      while (dayStart(k) < xMax) {
        const s = dayStart(k), [Y, M] = keyParts(k);
        if (s >= xMin - 3600) {
          grid.push(s);
          labels.push({ ts: s, text: M === 1 ? `${MON_SHORT[0]} ${Y}` : MON_SHORT[M - 1], strong: M === 1 });
        }
        k = `${M === 12 ? Y + 1 : Y}-${pad(M === 12 ? 1 : M + 1)}-01`;
      }
    }
    return { grid, labels };
  }

  const groups = {};
  function timeChart(el, c) {
    const W = Math.max(260, Math.floor(el.clientWidth));
    const H = c.height || 150;
    const m = { l: 40, r: 10, t: 10, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const x = lin(c.xMin, c.xMax, m.l, m.l + pw);
    const series = c.series || [];
    const N = c.x ? c.x.length : 0;
    const i0 = c.x ? bisect(c.x, c.xMin) : 0, i1 = c.x ? bisect(c.x, c.xMax + 1) : 0;

    let lo = Infinity, hi = -Infinity;
    const acc = (v) => { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    for (const s of series) for (let i = i0; i < i1; i++) acc(s.v[i]);
    if (c.bars) c.bars.v.forEach(acc);
    if (lo === Infinity) { lo = 0; hi = 1; }
    if (c.y0) lo = Math.min(lo, 0);
    const minSpan = c.minSpan || 1;
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = mid - minSpan / 2; hi = mid + minSpan / 2;
      if (c.y0 && lo < 0) { hi -= lo; lo = 0; }
    }
    const nt = niceTicks(lo, hi, ph < 110 ? 3 : 4);
    if (c.yCap != null && nt.hi > c.yCap) { nt.hi = c.yCap; nt.ticks = nt.ticks.filter((v) => v <= c.yCap); }
    const y = lin(nt.lo, nt.hi, m.t + ph, m.t);
    const dec = nt.step < 1 ? 1 : 0;
    const xt = timeTicks(c.ticks, c.xMin, c.xMax, pw);

    let s = `<svg width="${W}" height="${H}" role="img" aria-label="${c.label}"><g class="grid">`;
    for (const v of nt.ticks) { const py = Math.round(y(v)) + 0.5; s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${py}" y2="${py}"/>`; }
    for (const g of xt.grid) { const px = Math.round(x(g)) + 0.5; if (px > m.l + 1 && px < m.l + pw) s += `<line x1="${px}" x2="${px}" y1="${m.t}" y2="${m.t + ph}"/>`; }
    s += '</g>';
    for (const v of nt.ticks) s += `<text x="${m.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${num(v, dec)}</text>`;
    if (c.zero && nt.lo < 0 && nt.hi > 0) { const py = Math.round(y(0)) + 0.5; s += `<line class="base" x1="${m.l}" x2="${m.l + pw}" y1="${py}" y2="${py}"/>`; }
    s += `<line class="base" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph + 0.5}" y2="${m.t + ph + 0.5}"/>`;
    // popisky osy x (bez překryvů; názvy dní/měsíců mají přednost)
    const placed = [];
    for (const lb of [...xt.labels].sort((a, b) => (b.strong ? 1 : 0) - (a.strong ? 1 : 0))) {
      const px = x(lb.ts), w = lb.text.length * 6.6 + 8;
      let anchor = 'middle', left = px - w / 2;
      if (c.ticks === 'months') { anchor = 'start'; left = px; }
      if (px < m.l - 2 || px > m.l + pw + 2 || left < 0 || left + w > W + 4) continue;
      if (placed.some(([a, b]) => left < b && left + w > a)) continue;
      placed.push([left, left + w]);
      s += `<text x="${(anchor === 'start' ? px + 3 : px).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}"${lb.strong ? ' class="lbl"' : ''}>${lb.text}</text>`;
    }
    // sloupce
    if (c.bars) {
      const b = c.bars, y0 = y(Math.max(0, nt.lo));
      s += '<g>';
      for (let i = 0; i < b.v.length; i++) {
        const v = b.v[i];
        if (!v || v <= 0) continue;
        const px0 = x(Math.max(b.x0[i], c.xMin)), px1 = x(Math.min(b.x1[i], c.xMax));
        const bw = Math.max(1.5, Math.min(24, px1 - px0 - 2)), bx = (px0 + px1) / 2 - bw / 2;
        const by = Math.min(y(v), y0 - 1.5), r = Math.min(4, bw / 2, (y0 - by) / 2);
        s += `<path d="M${bx.toFixed(1)},${y0}V${(by + r).toFixed(1)}Q${bx.toFixed(1)},${by.toFixed(1)} ${(bx + r).toFixed(1)},${by.toFixed(1)}H${(bx + bw - r).toFixed(1)}Q${(bx + bw).toFixed(1)},${by.toFixed(1)} ${(bx + bw).toFixed(1)},${(by + r).toFixed(1)}V${y0}Z" fill="${b.color}" data-i="${i}"/>`;
      }
      s += '</g>';
    }
    // pás min–max
    if (c.band) {
      let d = '', seg = [];
      const flush = () => {
        if (seg.length > 1) {
          d += 'M' + seg.map((i) => `${x(c.x[i]).toFixed(1)},${y(c.band.hi[i]).toFixed(1)}`).join('L');
          d += 'L' + seg.slice().reverse().map((i) => `${x(c.x[i]).toFixed(1)},${y(c.band.lo[i]).toFixed(1)}`).join('L') + 'Z';
        }
        seg = [];
      };
      for (let i = i0; i < i1; i++) {
        if (c.band.hi[i] == null || c.band.lo[i] == null || (seg.length && c.x[i] - c.x[seg[seg.length - 1]] > c.gap)) flush();
        if (c.band.hi[i] != null && c.band.lo[i] != null) seg.push(i);
      }
      flush();
      s += `<path d="${d}" fill="${c.band.color}" opacity="0.12"/>`;
    }
    // čáry
    for (const ser of series) {
      let d = '', prev = null;
      for (let i = i0; i < i1; i++) {
        const v = ser.v[i];
        if (v == null) { prev = null; continue; }
        const cmd = prev == null || c.x[i] - c.x[prev] > c.gap ? 'M' : 'L';
        d += `${cmd}${x(c.x[i]).toFixed(1)},${y(v).toFixed(1)}`;
        prev = i;
      }
      s += `<path d="${d}" fill="none" stroke="${ser.color}" stroke-width="${ser.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (c.emptyText) s += `<text class="empty" x="${m.l + pw / 2}" y="${m.t + ph / 2 + 5}" text-anchor="middle">${c.emptyText}</text>`;
    // vrstva pro najetí myší
    s += `<g class="hover" visibility="hidden"><line class="xhair" y1="${m.t}" y2="${m.t + ph}"/>`;
    for (const ser of series) s += `<circle r="4" fill="${ser.color}" stroke="var(--surface)" stroke-width="2"/>`;
    s += `</g><rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></svg>`;
    el.innerHTML = s;

    const svg = el.firstChild, hov = svg.querySelector('.hover'), line = hov.querySelector('line');
    const dots = [...hov.querySelectorAll('circle')];
    const bars = c.bars ? [...svg.querySelectorAll('path[data-i]')] : [];
    let curIdx = null;

    function indexAt(ts) {
      if (c.bars && !series.length) {
        for (let i = 0; i < c.bars.x0.length; i++) if (ts >= c.bars.x0[i] && ts < c.bars.x1[i]) return i;
        return ts < c.bars.x0[0] ? 0 : c.bars.x0.length - 1;
      }
      if (i1 <= i0) return null;
      return nearest(c.x, ts, i0, i1);
    }
    const api = {
      show(ts, ev) {
        const i = indexAt(ts);
        if (i == null) return;
        curIdx = i;
        let px;
        if (c.bars && !series.length) {
          px = (x(Math.max(c.bars.x0[i], c.xMin)) + x(Math.min(c.bars.x1[i], c.xMax))) / 2;
          bars.forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
        } else {
          px = x(c.x[i]);
          series.forEach((ser, k) => {
            const v = ser.v[i];
            dots[k].setAttribute('visibility', v == null ? 'hidden' : 'visible');
            if (v != null) { dots[k].setAttribute('cx', px); dots[k].setAttribute('cy', y(v)); }
          });
        }
        line.setAttribute('x1', px); line.setAttribute('x2', px);
        hov.setAttribute('visibility', 'visible');
        if (c.readoutEl && c.readout) setRich(c.readoutEl, c.readout(i));
        if (ev) {
          const r = svg.getBoundingClientRect();
          const cx = ev.clientX != null ? ev.clientX : r.left + px;
          const cy = ev.clientY != null ? ev.clientY : r.top + m.t + ph / 3;
          showTip(cx, cy, c.tipTitle(i), c.tipRows(i));
        }
      },
      clear() {
        curIdx = null;
        hov.setAttribute('visibility', 'hidden');
        bars.forEach((b) => b.classList.remove('on'));
        if (c.readoutEl && c.readout) setRich(c.readoutEl, c.readout(null));
      },
      tsOf(i) { return c.bars && !series.length ? (c.bars.x0[i] + c.bars.x1[i]) / 2 : c.x[i]; },
    };
    const grp = c.group ? (groups[c.group] = groups[c.group] || new Set()) : new Set();
    grp.add(api);
    api.el = el;
    const broadcast = (ts, ev) => { for (const g of grp) { if (!g.el.isConnected) { grp.delete(g); continue; } g.show(ts, g === api ? ev : null); } };
    const clearAll = () => { hideTip(); for (const g of grp) g.clear(); };
    const hit = svg.querySelector('.hit');
    hit.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      broadcast(x.inv(ev.clientX - r.left), ev);
    });
    hit.addEventListener('pointerdown', (ev) => {
      const r = svg.getBoundingClientRect();
      broadcast(x.inv(ev.clientX - r.left), ev);
    });
    hit.addEventListener('pointerleave', clearAll);
    el.tabIndex = 0;
    el.onkeydown = (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      const max = c.bars && !series.length ? c.bars.x0.length - 1 : i1 - 1;
      const min = c.bars && !series.length ? 0 : i0;
      let i = curIdx == null ? max : curIdx + (ev.key === 'ArrowRight' ? 1 : -1);
      i = Math.max(min, Math.min(max, i));
      broadcast(api.tsOf(i), {});
    };
    el.onblur = clearAll;
    api.clear();
    return api;
  }

  /* ================================================================ načtení dat */
  async function getJSON(name) {
    const r = await fetch('data/' + name, { cache: 'no-store' });
    if (!r.ok) throw new Error(name + ': ' + r.status);
    return r.json();
  }
  async function loadAll() {
    const [cur, rec, daily, fc] = await Promise.all([getJSON('current.json'), getJSON('recent.json'), getJSON('daily.json'), getJSON('forecast.json').catch(() => null)]);
    S.cur = cur; S.rec = rec; S.daily = daily.days; S.epoch = cur.values.epoch; S.fc = fc;
  }
  async function refresh() {
    try {
      const cur = await getJSON('current.json');
      if (cur.values.epoch !== S.epoch) {
        $('charts').classList.add('loading');
        await loadAll();
        renderAll();
        $('charts').classList.remove('loading');
      } else {
        S.cur = cur;
      }
    } catch (e) { /* zkusí se znovu */ }
    renderStatus();
  }

  /* ================================================================ Právě teď */
  function todayRow() {
    const k = dayKey(Date.now() / 1000);
    const last = S.daily[S.daily.length - 1];
    return last && last.d === k ? last : null;
  }

  function renderStatus() {
    const el = $('status');
    if (!S.cur) return;
    const ep = S.cur.values.epoch;
    const age = Math.round((Date.now() / 1000 - ep) / 60);
    const ago = age < 1 ? 'právě teď' : age < 60 ? `před ${age} min` : age < 1440 ? `před ${Math.floor(age / 60)} h ${age % 60} min` : `před ${Math.floor(age / 1440)} dny`;
    el.textContent = `Měřeno v ${hm(ep)} (${ago})`;
    el.classList.toggle('stale', age > 45);
    if (age > 45) el.textContent += ' – data nejsou čerstvá, běží sběrač?';
  }

  function drawCompass(deg, calm) {
    let s = '<circle r="16" fill="none" stroke="var(--grid)" stroke-width="1.5"/>';
    for (let a = 0; a < 360; a += 90) s += `<line y1="-16" y2="-13" stroke="var(--axis)" stroke-width="1.5" transform="rotate(${a})"/>`;
    s += '<text y="-19" text-anchor="middle" font-size="7.5" font-family="system-ui,sans-serif" fill="var(--muted)">S</text>';
    if (calm || deg == null) s += '<circle r="2.5" fill="var(--muted)"/>';
    else s += `<g transform="rotate(${(deg + 180) % 360})"><path d="M0,-12 L5.5,4 L0,1.2 L-5.5,4 Z" fill="var(--series-1)"/><line y1="1" y2="11" stroke="var(--series-1)" stroke-width="2" stroke-linecap="round"/></g>`;
    const el = $('now-compass');
    el.setAttribute('viewBox', '-22 -27 44 48');
    el.innerHTML = s;
  }

  function renderNow() {
    const v = S.cur.values, st = S.cur.stats || {};
    setText('now-temp', num(v.temp));
    const t1 = valueAt('t', v.epoch - 3600);
    if (t1 != null && v.temp != null) {
      const d = v.temp - t1;
      setText('now-trend', Math.abs(d) < 0.3 ? 'Za poslední hodinu beze změny' : `${d > 0 ? '↑ Za hodinu o' : '↓ Za hodinu o'} ${num(Math.abs(d))} °C ${d > 0 ? 'tepleji' : 'chladněji'}`);
    } else setText('now-trend', '');

    const feels = v.temp != null && v.temp >= 26 && st.heat_current ? st.heat_current[1] : v.chill;
    $('now-feels').textContent = `${num(feels)} °C`;
    const today = todayRow();
    const fact = (id, val, t) => {
      const dd = $(id);
      dd.replaceChildren(document.createTextNode(`${num(val)} °C`));
      if (t) { const sm = document.createElement('small'); sm.textContent = `v ${t}`; dd.append(sm); }
    };
    if (today) { fact('now-min', today.tmin, today.tmin_t); fact('now-max', today.tmax, today.tmax_t); }
    else { fact('now-min', st.temp_day_min && st.temp_day_min[1], st.temp_day_min && hm(st.temp_day_min[0])); fact('now-max', st.temp_day_max && st.temp_day_max[1], st.temp_day_max && hm(st.temp_day_max[0])); }

    // vítr
    const ws = v.wspdavg != null ? v.wspdavg : v.wspd, calm = ws == null || ws < 1;
    const wd = v.wdiravg != null ? v.wdiravg : v.wdir;
    $('now-wind').replaceChildren(document.createTextNode(calm ? 'Bezvětří' : `${num(ws)} `));
    if (!calm) { const sm = document.createElement('small'); sm.textContent = `km/h ${DIR8[dirIndex(wd)]}`; $('now-wind').append(sm); }
    setText('now-wind-note', calm ? (v.wspdhi ? `nárazy ${num(v.wspdhi)} km/h` : '') : `${beaufort(ws)} ${DIR8_FROM[dirIndex(wd)]}, nárazy ${num(v.wspdhi)} km/h`);
    drawCompass(wd, calm);

    // tlak
    $('now-bar').replaceChildren(document.createTextNode(`${num(v.bar)} `));
    { const sm = document.createElement('small'); sm.textContent = 'hPa'; $('now-bar').append(sm); }
    const p3 = valueAt('p', v.epoch - 3 * 3600);
    if (p3 != null && v.bar != null) {
      const d = v.bar - p3, a = Math.abs(d);
      const word = a < 1 ? 'Stálý' : a < 3 ? (d > 0 ? 'Mírně stoupá' : 'Mírně klesá') : (d > 0 ? 'Rychle stoupá' : 'Rychle klesá');
      setText('now-bar-note', `${word} (${d >= 0 ? '+' : '−'}${num(a)} hPa za 3 h)`);
    } else setText('now-bar-note', '');

    // vlhkost
    $('now-hum').replaceChildren(document.createTextNode(`${num(v.hum, 0)} `));
    { const sm = document.createElement('small'); sm.textContent = '%'; $('now-hum').append(sm); }
    setText('now-hum-note', `rosný bod ${num(v.dew)} °C`);

    // srážky
    $('now-rain').replaceChildren(document.createTextNode(`${num(v.rain)} `));
    { const sm = document.createElement('small'); sm.textContent = 'mm'; $('now-rain').append(sm); }
    const mk = dayKey(Date.now() / 1000).slice(0, 7), yk = mk.slice(0, 4);
    let mr = 0, yr = 0;
    for (const d of S.daily) { if (d.d.startsWith(mk)) mr += d.rain || 0; if (d.d.startsWith(yk)) yr += d.rain || 0; }
    const rr = v.rainrate;
    setText('now-rain-note', `${rr > 0 ? `právě prší ${num(rr)} mm/h · ` : ''}${MON[+mk.slice(5) - 1]} ${num(mr)} mm · letos ${num(yr, 0)} mm`);
  }

  /* ================================================================ Průběh */
  function aggregateHourly(r, i0, i1) {
    const keys = ['t', 'dew', 'h', 'p', 'ws'];
    const out = { ts: [], wg: [] };
    keys.forEach((k) => (out[k] = []));
    let cur = null, sum, cnt, wg;
    const flush = () => {
      if (cur == null) return;
      out.ts.push(cur + 1800);
      keys.forEach((k) => out[k].push(cnt[k] ? sum[k] / cnt[k] : null));
      out.wg.push(wg);
    };
    for (let i = i0; i < i1; i++) {
      const b = Math.floor(r.ts[i] / 3600) * 3600;
      if (b !== cur) { flush(); cur = b; sum = {}; cnt = {}; wg = null; }
      for (const k of keys) { const v = r[k][i]; if (v != null) { sum[k] = (sum[k] || 0) + v; cnt[k] = (cnt[k] || 0) + 1; } }
      if (r.wg[i] != null && (wg == null || r.wg[i] > wg)) wg = r.wg[i];
    }
    flush();
    return out;
  }

  function rainHourly(r, i0, i1) {
    const map = new Map();
    let prev = null, prevDay = null;
    for (let i = Math.max(0, i0 - 1); i < i1; i++) {
      const rv = r.r[i];
      if (rv == null) continue;
      const dk = dayKey(r.ts[i]);
      const inc = prev == null ? 0 : dk !== prevDay || rv < prev ? rv : rv - prev;
      prev = rv; prevDay = dk;
      if (i < i0) continue;
      const b = Math.floor((r.ts[i] - 1) / 3600) * 3600;
      map.set(b, (map.get(b) || 0) + inc);
    }
    return map;
  }

  const CHARTS = [
    { id: 'temp', title: 'Teplota (°C)', height: 190, zero: true },
    { id: 'rain', title: 'Srážky (mm)', height: 130 },
    { id: 'wind', title: 'Vítr (km/h)', height: 150 },
    { id: 'bar', title: 'Tlak vzduchu (hPa)', height: 140 },
    { id: 'hum', title: 'Vlhkost (%)', height: 130 },
  ];

  function chartCard(id, title, legend) {
    const card = document.createElement('div');
    card.className = 'card chart-card';
    const head = document.createElement('div');
    head.className = 'chart-head';
    const left = document.createElement('div');
    const h = document.createElement('h3');
    h.className = 'chart-title';
    h.textContent = title;
    left.append(h);
    if (legend && legend.length) {
      const lg = document.createElement('div');
      lg.className = 'legend';
      for (const it of legend) {
        const sp = document.createElement('span');
        const k = document.createElement('i');
        k.className = it.rect ? 'key-rect' : 'key-line';
        k.style.background = it.color;
        sp.append(k, document.createTextNode(it.name));
        lg.append(sp);
      }
      left.append(lg);
    }
    const ro = document.createElement('div');
    ro.className = 'readout';
    head.append(left, ro);
    const body = document.createElement('div');
    body.className = 'chart';
    body.id = 'c-' + id;
    card.append(head, body);
    return { card, body, ro };
  }

  function renderTrend() {
    const r = S.rec, days = S.range;
    const last = r.ts[r.ts.length - 1];
    let xMin, xMax, ticks;
    if (days === 1) { xMax = last; xMin = last - 86400; ticks = 'hours'; }
    else {
      const today = dayKey(last);
      xMin = dayStart(keyAdd(today, -(days - 1)));
      xMax = dayStart(keyAdd(today, 1));
      ticks = days === 7 ? 'days' : 'weeks';
    }
    const i0 = bisect(r.ts, xMin), i1 = bisect(r.ts, xMax + 1);
    const src = days === 30 ? aggregateHourly(r, i0, i1) : (() => {
      const o = {};
      for (const k of ['ts', 't', 'dew', 'h', 'p', 'ws', 'wg']) o[k] = r[k].slice(i0, i1);
      return o;
    })();
    const gap = days === 30 ? 3 * 3600 : 45 * 60;

    // srážky: po hodinách (24 h) nebo po dnech
    let bars;
    if (days === 1) {
      const map = rainHourly(r, i0, i1);
      bars = { x0: [], x1: [], v: [] };
      for (let t = Math.floor(xMin / 3600) * 3600; t < xMax; t += 3600) { bars.x0.push(t); bars.x1.push(t + 3600); bars.v.push(map.get(t) || 0); }
    } else {
      bars = { x0: [], x1: [], v: [], k: [] };
      const byKey = new Map(S.daily.map((d) => [d.d, d]));
      for (let k = dayKey(xMin + 7200), n = 0; n < days; k = keyAdd(k, 1), n++) {
        const d = byKey.get(k);
        bars.x0.push(dayStart(k)); bars.x1.push(dayStart(keyAdd(k, 1))); bars.v.push(d ? d.rain || 0 : 0); bars.k.push(k);
      }
    }

    // souhrn období
    let tmax = null, tmin = null, gmax = null;
    for (let i = 0; i < src.ts.length; i++) {
      const t = src.t[i];
      if (t != null) { if (tmax == null || t > tmax) tmax = t; if (tmin == null || t < tmin) tmin = t; }
    }
    const rawG = r.wg.slice(i0, i1);
    for (const g of rawG) if (g != null && (gmax == null || g > gmax)) gmax = g;
    // u 7/30 dní ber denní extrémy (zpřesněné ze statistik)
    if (days > 1) {
      for (const k of bars.k) {
        const d = S.daily.find((x) => x.d === k);
        if (!d) continue;
        if (d.tmax != null && (tmax == null || d.tmax > tmax)) tmax = d.tmax;
        if (d.tmin != null && (tmin == null || d.tmin < tmin)) tmin = d.tmin;
        if (d.gmax != null && (gmax == null || d.gmax > gmax)) gmax = d.gmax;
      }
    }
    const rainSum = bars.v.reduce((a, b) => a + b, 0);
    const label = days === 1 ? 'Za posledních 24 hodin' : `Za posledních ${days} dní`;
    setRich($('range-summary'), [`${label}: nejvýš `, { b: `${num(tmax)} °C` }, ', nejníž ', { b: `${num(tmin)} °C` }, ', srážky ', { b: `${num(rainSum)} mm` }, ', nejsilnější náraz větru ', { b: `${num(gmax)} km/h` }, '.']);

    const box = $('charts');
    box.replaceChildren();
    groups.trend = new Set();
    const c1 = css('--series-1'), c2 = css('--series-2'), cm = css('--series-muted');
    const when = (ts) => (days === 1 ? `${DOW_LONG[L(ts).getUTCDay()]} ${hm(ts)}` : `${DOW[L(ts).getUTCDay()]} ${shortDate(dayKey(ts))} ${hm(ts)}`);
    const base = { x: src.ts, xMin, xMax, ticks, gap, group: 'trend' };

    for (const def of CHARTS) {
      let legend = [];
      if (def.id === 'temp') legend = [{ name: 'Teplota', color: c1 }, { name: 'Rosný bod', color: cm }];
      if (def.id === 'wind') legend = [{ name: 'Průměr', color: c1 }, { name: 'Nárazy', color: c2 }];
      const { card, body, ro } = chartCard(def.id, def.title, legend);
      box.append(card);
      let cfg;
      if (def.id === 'temp') {
        cfg = { ...base, label: 'Graf teploty', series: [{ name: 'Rosný bod', v: src.dew, color: cm, width: 1.5 }, { name: 'Teplota', v: src.t, color: c1 }], zero: true, minSpan: 4,
          readout: (i) => i == null ? ['nejvýš ', { b: num(tmax) }, ' · nejníž ', { b: num(tmin) }] : ['teplota ', { b: `${num(src.t[i])} °C` }],
          tipTitle: (i) => when(src.ts[i]),
          tipRows: (i) => [{ color: c1, value: `${num(src.t[i])} °C`, name: 'teplota' }, { color: cm, value: `${num(src.dew[i])} °C`, name: 'rosný bod' }] };
        if (days === 30) cfg.readout = (i) => i == null ? ['nejvýš ', { b: num(tmax) }, ' · nejníž ', { b: num(tmin) }] : ['hodinový průměr ', { b: `${num(src.t[i])} °C` }];
      } else if (def.id === 'rain') {
        const bucketTitle = (i) => days === 1 ? `${hm(bars.x0[i])}–${hm(bars.x1[i])}` : longDate(bars.k[i]);
        cfg = { ...base, x: null, label: 'Graf srážek', series: [], bars: { ...bars, color: c1 }, y0: true, minSpan: 1,
          emptyText: rainSum > 0 ? '' : (days === 1 ? 'Za posledních 24 hodin nepršelo' : `Za posledních ${days} dní nepršelo`),
          readout: (i) => i == null ? ['celkem ', { b: `${num(rainSum)} mm` }] : [days === 1 ? 'za hodinu ' : 'za den ', { b: `${num(bars.v[i])} mm` }],
          tipTitle: bucketTitle, tipRows: (i) => [{ color: c1, rect: true, value: `${num(bars.v[i])} mm`, name: 'srážky' }] };
      } else if (def.id === 'wind') {
        cfg = { ...base, label: 'Graf větru', series: [{ name: 'Nárazy', v: src.wg, color: c2, width: 1.5 }, { name: 'Průměr', v: src.ws, color: c1 }], y0: true, minSpan: 5,
          readout: (i) => i == null ? ['nejsilnější náraz ', { b: `${num(gmax)} km/h` }] : ['průměr ', { b: num(src.ws[i]) }, ' · nárazy ', { b: num(src.wg[i]) }],
          tipTitle: (i) => when(src.ts[i]),
          tipRows: (i) => [{ color: c1, value: `${num(src.ws[i])} km/h`, name: 'průměr' }, { color: c2, value: `${num(src.wg[i])} km/h`, name: 'nárazy' }] };
      } else if (def.id === 'bar') {
        cfg = { ...base, label: 'Graf tlaku', series: [{ name: 'Tlak', v: src.p, color: c1 }], minSpan: 6,
          readout: (i) => i == null ? ['teď ', { b: `${num(S.cur.values.bar)} hPa` }] : [{ b: `${num(src.p[i])} hPa` }],
          tipTitle: (i) => when(src.ts[i]), tipRows: (i) => [{ color: c1, value: `${num(src.p[i])} hPa`, name: 'tlak' }] };
      } else {
        cfg = { ...base, label: 'Graf vlhkosti', series: [{ name: 'Vlhkost', v: src.h, color: c1 }], minSpan: 20, yCap: 100,
          readout: (i) => i == null ? ['teď ', { b: `${num(S.cur.values.hum, 0)} %` }] : [{ b: `${num(src.h[i], 0)} %` }],
          tipTitle: (i) => when(src.ts[i]), tipRows: (i) => [{ color: c1, value: `${num(src.h[i], 0)} %`, name: 'vlhkost' }] };
      }
      cfg.height = def.height;
      cfg.readoutEl = ro;
      timeChart(body, cfg);
    }
  }

  /* ================================================================ 12 měsíců */
  function yearDays() { return S.daily.slice(-365); }

  function longestRun(days, pred) {
    let best = { n: 0 }, cur = null, prevKey = null;
    for (const d of days) {
      const ok = pred(d);
      if (ok && cur && prevKey && keyAdd(prevKey, 1) === d.d) cur.n++, (cur.to = d.d);
      else if (ok) cur = { n: 1, from: d.d, to: d.d };
      else cur = null;
      if (cur && cur.n > best.n) best = { ...cur };
      prevKey = d.d;
    }
    return best;
  }

  function renderYear() {
    const days = yearDays();
    if (!days.length) return;
    $('year-span').textContent = `${fullDate(days[0].d)} – ${fullDate(days[days.length - 1].d)}`;

    // počty
    const cnt = (f) => days.filter(f).length;
    const rainSum = days.reduce((a, d) => a + (d.rain || 0), 0);
    const tAvg = days.filter((d) => d.tavg != null).reduce((a, d, _, arr) => a + d.tavg / arr.length, 0);
    const counts = [
      [`${num(rainSum, 0)} mm`, 'srážek celkem'],
      [cnt((d) => d.rain >= 1), 'deštivých dní'],
      [`${num(tAvg)} °C`, 'průměrná teplota'],
      [cnt((d) => d.tmin != null && d.tmin < 0), 'mrazových dní'],
      [cnt((d) => d.tmax != null && d.tmax < 0), 'ledových dní'],
      [cnt((d) => d.tmax >= 25), 'letních dní'],
      [cnt((d) => d.tmax >= 30), 'tropických dní'],
      [cnt((d) => d.tmin >= 20), 'tropických nocí'],
    ];
    const cBox = $('year-counts');
    cBox.replaceChildren();
    for (const [v, l] of counts) {
      const c = document.createElement('div');
      c.className = 'card count';
      const a = document.createElement('div'); a.className = 'v'; a.textContent = String(v);
      const b = document.createElement('div'); b.className = 'l'; b.textContent = l;
      c.append(a, b);
      cBox.append(c);
    }

    // rekordy
    const hot = maxBy(days, (d) => d.tmax), cold = minBy(days, (d) => d.tmin);
    const warmNight = maxBy(days, (d) => d.tmin), coldDay = minBy(days, (d) => d.tmax);
    const swing = maxBy(days, (d) => (d.tmax != null && d.tmin != null ? d.tmax - d.tmin : null));
    const wet = maxBy(days, (d) => d.rain), gust = maxBy(days, (d) => d.gmax);
    const pHi = maxBy(days, (d) => d.pmax), pLo = minBy(days, (d) => d.pmin);
    const dry = longestRun(days, (d) => (d.rain || 0) < 0.1);
    const frost = longestRun(days, (d) => d.tmin != null && d.tmin < 0);
    const summer = longestRun(days, (d) => d.tmax != null && d.tmax >= 25);
    const at = (d, t) => `${DOW[keyDate(d.d).getUTCDay()]} ${fullDate(d.d)}${t ? ` v ${t}` : ''}`;
    const span = (r) => (r.n ? `${shortDate(r.from)} – ${fullDate(r.to)}` : 'zatím žádné');
    const recs = [
      ['Nejtepleji', `${num(hot.tmax)} °C`, at(hot, hot.tmax_t)],
      ['Nejchladněji', `${num(cold.tmin)} °C`, at(cold, cold.tmin_t)],
      ['Nejteplejší noc', `${num(warmNight.tmin)} °C`, `ani v noci nekleslo níž · ${at(warmNight)}`],
      ['Nejchladnější den', `${num(coldDay.tmax)} °C`, `ani přes den nebylo víc · ${at(coldDay)}`],
      ['Největší rozdíl za den', `${num(swing.tmax - swing.tmin)} °C`, `z ${num(swing.tmin)} na ${num(swing.tmax)} °C · ${at(swing)}`],
      ['Nejvíc srážek za den', `${num(wet.rain)} mm`, at(wet)],
      ['Nejsilnější náraz větru', `${num(gust.gmax)} km/h`, at(gust, gust.gmax_t)],
      ['Nejvyšší tlak', `${num(pHi.pmax)} hPa`, at(pHi)],
      ['Nejnižší tlak', `${num(pLo.pmin)} hPa`, at(pLo)],
      ['Nejdelší období bez srážek', `${dry.n} ${dayWord(dry.n)}`, span(dry)],
      ['Nejdelší mrazivé období', `${frost.n} ${dayWord(frost.n)} v řadě`, span(frost)],
      ['Nejdelší série letních dní', `${summer.n} ${dayWord(summer.n)} nad 25 °C`, span(summer)],
    ];
    const rBox = $('records');
    rBox.replaceChildren();
    for (const [l, v, w] of recs) {
      const c = document.createElement('div');
      c.className = 'card rec';
      for (const [cls, txt] of [['l', l], ['v', v], ['w', w]]) { const e = document.createElement('div'); e.className = cls; e.textContent = txt; c.append(e); }
      rBox.append(c);
    }

    renderYearTemp(days);
    renderCalendar(days);
    renderMonthRain(days);
    renderWindRose(days);
    renderTables(days);
  }

  function renderYearTemp(days) {
    const c1 = css('--series-1'), c2 = css('--series-2');
    const xs = days.map((d) => dayStart(d.d) + 43200);
    const lo = days.map((d) => d.tmin), hi = days.map((d) => d.tmax);
    const lg = $('year-temp-legend');
    lg.replaceChildren();
    for (const [name, color] of [['Nejnižší za den', c1], ['Nejvyšší za den', c2]]) {
      const sp = document.createElement('span');
      const k = document.createElement('i'); k.className = 'key-line'; k.style.background = color;
      sp.append(k, document.createTextNode(name));
      lg.append(sp);
    }
    timeChart($('year-temp'), {
      label: 'Teplota den po dni za 12 měsíců', x: xs, xMin: dayStart(days[0].d), xMax: dayStart(keyAdd(days[days.length - 1].d, 1)),
      ticks: 'months', gap: 1.6 * 86400, height: 230, zero: true, minSpan: 10,
      series: [{ name: 'Nejnižší', v: lo, color: c1, width: 1.5 }, { name: 'Nejvyšší', v: hi, color: c2, width: 1.5 }],
      band: { lo, hi, color: css('--muted') },
      readoutEl: $('year-temp-readout'),
      readout: (i) => i == null ? [] : [shortDate(days[i].d) + ' ', { b: `${num(days[i].tmin)} / ${num(days[i].tmax)} °C` }],
      tipTitle: (i) => longDate(days[i].d),
      tipRows: (i) => [
        { color: c2, value: `${num(days[i].tmax)} °C`, name: 'nejvyšší' },
        { color: c1, value: `${num(days[i].tmin)} °C`, name: 'nejnižší' },
        { value: `${num(days[i].tavg)} °C`, name: 'průměr' },
        { value: `${num(days[i].rain)} mm`, name: 'srážky' },
      ],
    });
  }

  function renderCalendar(days) {
    const el = $('calendar');
    const W = Math.max(280, Math.floor(el.clientWidth));
    const byKey = new Map(days.map((d) => [d.d, d]));
    const months = [];
    for (let k = days[0].d.slice(0, 8) + '01'; k <= days[days.length - 1].d; ) {
      const [Y, M] = keyParts(k);
      months.push([Y, M]);
      k = `${M === 12 ? Y + 1 : Y}-${pad(M === 12 ? 1 : M + 1)}-01`;
    }
    // širší obrazovka: měsíce v řádcích; mobil: měsíce ve sloupcích, dny pod sebou
    const tall = W < 560;
    const labelW = tall ? 22 : 76, top = tall ? 22 : 18;
    const cell = tall ? Math.max(14, Math.min(24, Math.floor((W - labelW) / months.length))) : Math.max(10, Math.min(26, Math.floor((W - labelW) / 31)));
    const size = cell - 2;
    const svgW = tall ? labelW + months.length * cell : labelW + 31 * cell;
    const H = tall ? top + 31 * cell + 2 : top + months.length * cell + 2;
    let s = `<svg width="${svgW}" height="${H}" role="img" aria-label="Kalendář dní">`;
    for (const dnum of [1, 5, 10, 15, 20, 25, 31]) {
      s += tall
        ? `<text x="${labelW - 6}" y="${top + (dnum - 1) * cell + size / 2 + 4}" text-anchor="end">${dnum}</text>`
        : `<text x="${labelW + (dnum - 1) * cell + size / 2}" y="12" text-anchor="middle">${dnum}</text>`;
    }
    const mode = S.cal;
    months.forEach(([Y, M], row) => {
      const yy = top + row * cell;
      if (tall) {
        s += `<text class="${M === 1 ? 'lbl-strong' : 'lbl'}" x="${labelW + row * cell + size / 2}" y="${top - 8}" text-anchor="middle">${MON_SHORT[M - 1]}</text>`;
      } else {
        s += `<text class="lbl" x="0" y="${yy + size / 2 + 4}">${MON[M - 1]}${M === 1 || row === 0 ? ' ' + Y : ''}</text>`;
      }
      const dim = new Date(Date.UTC(Y, M, 0)).getUTCDate();
      for (let dnum = 1; dnum <= dim; dnum++) {
        const k = `${Y}-${pad(M)}-${pad(dnum)}`;
        const d = byKey.get(k);
        const xx = tall ? labelW + row * cell : labelW + (dnum - 1) * cell;
        const yy = tall ? top + (dnum - 1) * cell : top + row * cell;
        if (!d) { s += `<rect x="${xx + 0.5}" y="${yy + 0.5}" width="${size - 1}" height="${size - 1}" rx="3" fill="none" stroke="var(--grid)"/>`; continue; }
        const v = mode === 'temp' ? d.tavg : d.rain || 0;
        const fill = v == null ? 'var(--grid)' : mode === 'temp' ? tempColor(v) : rainColor(v);
        s += `<rect class="cell" data-k="${k}" x="${xx}" y="${yy}" width="${size}" height="${size}" rx="3" fill="${fill}"/>`;
      }
    });
    s += '</svg>';
    el.innerHTML = s;
    const svg = el.firstChild;
    let on = null;
    const hover = (ev) => {
      const t = ev.target.closest && ev.target.closest('.cell');
      if (on && on !== t) on.classList.remove('on');
      if (!t) { hideTip(); on = null; return; }
      on = t; t.classList.add('on');
      const d = byKey.get(t.dataset.k);
      showTip(ev.clientX, ev.clientY, longDate(d.d), [
        { value: `${num(d.tavg)} °C`, name: 'průměr dne' },
        { value: `${num(d.tmin)} až ${num(d.tmax)} °C`, name: 'rozpětí' },
        { value: `${num(d.rain)} mm`, name: 'srážky' },
      ]);
    };
    svg.addEventListener('pointermove', hover);
    svg.addEventListener('pointerdown', hover);
    svg.addEventListener('pointerleave', () => { hideTip(); if (on) on.classList.remove('on'); on = null; });

    // stupnice
    const sc = $('cal-scale');
    sc.replaceChildren();
    if (mode === 'temp') {
      const wrap = document.createElement('span'); wrap.className = 'grad-wrap';
      const g = document.createElement('span'); g.className = 'grad';
      const stops = [];
      for (let i = 0; i <= 20; i++) { const v = TEMP_COLD + (TEMP_HOT - TEMP_COLD) * (i / 20); stops.push(`${tempColor(v)} ${(i / 20) * 100}%`); }
      g.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
      const ticks = document.createElement('span'); ticks.className = 'grad-ticks';
      for (const t of [TEMP_COLD, 0, 10, 20, TEMP_HOT]) { const e = document.createElement('span'); e.textContent = num(t, 0); ticks.append(e); }
      // poloha nuly na stupnici
      g.style.backgroundSize = '100% 100%';
      wrap.append(g, ticks);
      sc.append(document.createTextNode('Průměrná teplota dne (°C)'), wrap);
    } else {
      const cols = rainColors();
      sc.append(document.createTextNode('Srážky za den:'));
      RAIN_LABELS.forEach((l, i) => {
        const sw = document.createElement('span'); sw.className = 'sw';
        const k = document.createElement('i'); k.className = 'key-rect'; k.style.background = cols[i];
        if (i === 0) k.style.boxShadow = '0 0 0 1px var(--ring)';
        sw.append(k, document.createTextNode(l));
        sc.append(sw);
      });
    }
  }

  function renderMonthRain(days) {
    const el = $('month-rain');
    const months = monthStats(days);
    const W = Math.max(260, Math.floor(el.clientWidth)), H = 210;
    const m = { l: 34, r: 6, t: 16, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxV = Math.max(1, ...months.map((x) => x.rain));
    const nt = niceTicks(0, maxV, 4);
    const y = lin(0, nt.hi, m.t + ph, m.t);
    const band = pw / months.length, bw = Math.min(24, band - 6);
    const c1 = css('--series-1');
    const top = maxBy(months, (x) => x.rain);
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="Srážky po měsících"><g class="grid">`;
    for (const v of nt.ticks) s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Math.round(y(v)) + 0.5}" y2="${Math.round(y(v)) + 0.5}"/>`;
    s += '</g>';
    for (const v of nt.ticks) s += `<text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${num(v, 0)}</text>`;
    s += `<line class="base" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph + 0.5}" y2="${m.t + ph + 0.5}"/>`;
    months.forEach((mo, i) => {
      const cx = m.l + band * (i + 0.5), bx = cx - bw / 2, y0 = m.t + ph;
      if (mo.rain > 0) {
        const by = Math.min(y(mo.rain), y0 - 1.5), r = Math.min(4, (y0 - by) / 2);
        s += `<path class="bar-hover" data-i="${i}" d="M${bx},${y0}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + bw - r}Q${bx + bw},${by} ${bx + bw},${by + r}V${y0}Z" fill="${c1}"/>`;
      }
      s += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}"/>`;
      s += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${MON_SHORT[mo.M - 1]}</text>`;
      if (mo === top) s += `<text class="lbl-strong" x="${cx}" y="${y(mo.rain) - 5}" text-anchor="middle">${num(mo.rain, 0)}</text>`;
    });
    s += '</svg>';
    el.innerHTML = s;
    const svg = el.firstChild;
    const paths = [...svg.querySelectorAll('path.bar-hover')];
    const move = (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-i]');
      if (!t) return;
      const i = +t.dataset.i, mo = months[i];
      paths.forEach((p) => p.classList.toggle('on', +p.dataset.i === i));
      showTip(ev.clientX, ev.clientY, `${MON[mo.M - 1]} ${mo.Y}${mo.partial ? ` (zatím ${mo.n} ${dayWord(mo.n)})` : ''}`, [
        { color: c1, rect: true, value: `${num(mo.rain)} mm`, name: 'srážky' },
        { value: `${mo.wet}`, name: 'deštivých dní (≥ 1 mm)' },
      ]);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { hideTip(); paths.forEach((p) => p.classList.remove('on')); });
    setRich($('rain-total'), ['celkem ', { b: `${num(months.reduce((a, x) => a + x.rain, 0), 0)} mm` }]);
  }

  function renderWindRose(days) {
    const el = $('windrose');
    const counts = new Array(8).fill(0);
    let calm = 0;
    for (const d of days) { (d.wr || []).forEach((c, i) => (counts[i] += c)); calm += d.calm || 0; }
    const moving = counts.reduce((a, b) => a + b, 0), all = moving + calm;
    const pct = counts.map((c) => (moving ? (c / moving) * 100 : 0));
    const W = Math.max(260, Math.floor(el.clientWidth)), size = Math.min(W, 300);
    const cx = W / 2, cy = size / 2 + 4, R = size / 2 - 30, r0 = 10;
    const maxP = Math.max(...pct, 1);
    const nt = niceTicks(0, maxP, 3);
    const rad = (p) => r0 + (R - r0) * (p / nt.hi);
    const c1 = css('--series-1');
    const pt = (a, r) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    let s = `<svg width="${W}" height="${size + 8}" role="img" aria-label="Větrná růžice"><g class="grid">`;
    for (const v of nt.ticks.slice(1)) s += `<circle cx="${cx}" cy="${cy}" r="${rad(v)}" fill="none" stroke="var(--grid)"/>`;
    s += '</g>';
    for (const v of nt.ticks.slice(1)) { const [tx, ty] = pt(Math.PI / 8, rad(v)); s += `<text x="${tx + 2}" y="${ty - 2}">${num(v, 0)} %</text>`; }
    pct.forEach((p, i) => {
      const a = (i * 45 * Math.PI) / 180, half = (19.5 * Math.PI) / 180;
      const ro = rad(p);
      const [x1, y1] = pt(a - half, r0), [x2, y2] = pt(a - half, ro), [x3, y3] = pt(a + half, ro), [x4, y4] = pt(a + half, r0);
      if (p > 0) s += `<path class="bar-hover" data-i="${i}" d="M${x1},${y1}L${x2},${y2}A${ro},${ro} 0 0 1 ${x3},${y3}L${x4},${y4}A${r0},${r0} 0 0 0 ${x1},${y1}Z" fill="${c1}"/>`;
      const [lx, ly] = pt(a, R + 16);
      s += `<text class="lbl" x="${lx}" y="${ly + 4}" text-anchor="middle">${DIR8[i]}</text>`;
      const [hx2, hy2] = pt(a - Math.PI / 8, R + 8), [hx3, hy3] = pt(a + Math.PI / 8, R + 8);
      s += `<path class="hit" data-i="${i}" d="M${cx},${cy}L${hx2},${hy2}A${R + 8},${R + 8} 0 0 1 ${hx3},${hy3}Z"/>`;
    });
    s += '</svg>';
    el.innerHTML = s;
    const svg = el.firstChild;
    const paths = [...svg.querySelectorAll('path.bar-hover')];
    const move = (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-i]');
      if (!t) return;
      const i = +t.dataset.i;
      paths.forEach((p) => p.classList.toggle('on', +p.dataset.i === i));
      showTip(ev.clientX, ev.clientY, `${DIR8_NAME[i]} (${DIR8[i]})`, [{ color: c1, rect: true, value: `${num(pct[i], 0)} %`, name: `času, kdy foukalo – ${DIR8_FROM[i]}` }]);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { hideTip(); paths.forEach((p) => p.classList.remove('on')); });
    const topDir = pct.indexOf(Math.max(...pct));
    setRich($('calm-note'), ['nejčastěji ', { b: DIR8_FROM[topDir] }, ` · bezvětří ${num(all ? (calm / all) * 100 : 0, 0)} % času`]);
  }

  function monthStats(days) {
    const map = new Map();
    for (const d of days) {
      const key = d.d.slice(0, 7);
      let m = map.get(key);
      if (!m) {
        const [Y, M] = keyParts(d.d);
        m = { key, Y, M, n: 0, tsum: 0, tn: 0, tmax: null, tmin: null, rain: 0, wet: 0, frost: 0, ice: 0, summer: 0, tropic: 0, tnight: 0, gmax: null };
        map.set(key, m);
      }
      m.n++;
      if (d.tavg != null) { m.tsum += d.tavg; m.tn++; }
      if (d.tmax != null && (m.tmax == null || d.tmax > m.tmax)) m.tmax = d.tmax;
      if (d.tmin != null && (m.tmin == null || d.tmin < m.tmin)) m.tmin = d.tmin;
      m.rain += d.rain || 0;
      if (d.rain >= 1) m.wet++;
      if (d.tmin != null && d.tmin < 0) m.frost++;
      if (d.tmax != null && d.tmax < 0) m.ice++;
      if (d.tmax >= 25) m.summer++;
      if (d.tmax >= 30) m.tropic++;
      if (d.tmin >= 20) m.tnight++;
      if (d.gmax != null && (m.gmax == null || d.gmax > m.gmax)) m.gmax = d.gmax;
    }
    const out = [...map.values()];
    for (const m of out) { m.tavg = m.tn ? m.tsum / m.tn : null; m.partial = m.n < new Date(Date.UTC(m.Y, m.M, 0)).getUTCDate(); }
    return out;
  }

  function table(el, head, rows, foot) {
    el.replaceChildren();
    const th = document.createElement('thead'), tr = document.createElement('tr');
    for (const h of head) { const c = document.createElement('th'); c.scope = 'col'; c.textContent = h; tr.append(c); }
    th.append(tr);
    const tb = document.createElement('tbody');
    for (const r of rows) {
      const row = document.createElement('tr');
      r.forEach((v, i) => {
        const c = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) c.scope = 'row';
        if (v && typeof v === 'object') { c.textContent = v.t; if (v.dim) { const sp = document.createElement('span'); sp.className = 'dim'; sp.textContent = ' ' + v.dim; c.append(sp); } }
        else c.textContent = v;
        row.append(c);
      });
      tb.append(row);
    }
    el.append(th, tb);
    if (foot) {
      const tf = document.createElement('tfoot'), row = document.createElement('tr');
      foot.forEach((v) => { const c = document.createElement('td'); c.textContent = v; row.append(c); });
      tf.append(row);
      el.append(tf);
    }
  }

  function renderTables(days) {
    const ms = monthStats(days);
    const all = days.filter((d) => d.tavg != null);
    table($('month-table'),
      ['Měsíc', 'Průměr °C', 'Nejvýš °C', 'Nejníž °C', 'Srážky mm', 'Deštivé dny', 'Mrazové dny', 'Ledové dny', 'Letní dny', 'Tropické dny', 'Tropické noci', 'Max. náraz km/h'],
      ms.map((m) => [{ t: `${MON[m.M - 1]} ${m.Y}`, dim: m.partial ? `(${m.n} ${dayWord(m.n)})` : '' }, num(m.tavg), num(m.tmax), num(m.tmin), num(m.rain), m.wet, m.frost, m.ice, m.summer, m.tropic, m.tnight, num(m.gmax)]),
      ['Celkem', num(all.reduce((a, d) => a + d.tavg, 0) / (all.length || 1)), num(Math.max(...ms.map((m) => m.tmax ?? -99))), num(Math.min(...ms.map((m) => m.tmin ?? 99))),
        num(ms.reduce((a, m) => a + m.rain, 0), 0), ...['wet', 'frost', 'ice', 'summer', 'tropic', 'tnight'].map((k) => ms.reduce((a, m) => a + m[k], 0)), num(Math.max(...ms.map((m) => m.gmax ?? 0)))]);

    table($('day-table'),
      ['Den', 'Nejníž °C', 'Nejvýš °C', 'Průměr °C', 'Srážky mm', 'Max. náraz km/h', 'Vlhkost %', 'Tlak hPa'],
      days.slice().reverse().map((d) => [`${DOW[keyDate(d.d).getUTCDay()]} ${fullDate(d.d)}`, num(d.tmin), num(d.tmax), num(d.tavg), num(d.rain), num(d.gmax), num(d.havg, 0), num(d.pavg)]));
  }

  /* ================================================================ Předpověď */
  const SYM_WORD = { clear: 'jasno', mostly_clear: 'skoro jasno', partly: 'polojasno', cloudy: 'oblačno', overcast: 'zataženo', fog: 'mlha', rain: 'déšť', showers: 'přeháňky', snow: 'sníh', sleet: 'déšť se sněhem', storm: 'bouřky' };
  function icon(sym) {
    const sun = (cx, cy, r) => {
      let s = '';
      for (let a = 0; a < 360; a += 45) {
        const rad = (a * Math.PI) / 180;
        s += `<line class="ico-ray" x1="${cx + Math.cos(rad) * (r + 3)}" y1="${cy + Math.sin(rad) * (r + 3)}" x2="${cx + Math.cos(rad) * (r + 6)}" y2="${cy + Math.sin(rad) * (r + 6)}"/>`;
      }
      return s + `<circle class="ico-sun" cx="${cx}" cy="${cy}" r="${r}"/>`;
    };
    const cloud = (dx, dy, cls = 'ico-cloud', k = 1) => `<path class="${cls}" transform="translate(${dx} ${dy}) scale(${k})" d="M10,26 h22 a7,7 0 0 0 0-14 a10,10 0 0 0-19-2 a8,8 0 0 0-3,16 z"/>`;
    const drops = (n) => { let s = ''; for (let i = 0; i < n; i++) s += `<line class="ico-drop" x1="${16 + i * 8}" y1="31" x2="${13 + i * 8}" y2="37"/>`; return s; };
    const flakes = (n) => { let s = ''; for (let i = 0; i < n; i++) s += `<circle class="ico-flake" cx="${15 + i * 8}" cy="${33 + (i % 2) * 3}" r="2"/>`; return s; };
    let b = '';
    switch (sym) {
      case 'clear': b = sun(24, 20, 8); break;
      case 'mostly_clear': b = sun(20, 16, 7) + cloud(14, 12, 'ico-cloud', 0.75); break;
      case 'partly': b = sun(17, 13, 7) + cloud(6, 6); break;
      case 'cloudy': b = cloud(2, 3, 'ico-cloud2', 0.8) + cloud(6, 6); break;
      case 'overcast': b = cloud(0, 2, 'ico-cloud2', 0.85) + cloud(8, 8, 'ico-cloud2'); break;
      case 'fog': b = cloud(6, 0, 'ico-cloud', 0.9) + '<line class="ico-fog" x1="8" y1="31" x2="40" y2="31"/><line class="ico-fog" x1="12" y1="37" x2="36" y2="37"/>'; break;
      case 'rain': b = cloud(6, 2) + drops(3); break;
      case 'showers': b = sun(15, 11, 6) + cloud(8, 3) + drops(2); break;
      case 'snow': b = cloud(6, 2) + flakes(3); break;
      case 'sleet': b = cloud(6, 2) + '<line class="ico-drop" x1="17" y1="31" x2="14" y2="37"/><circle class="ico-flake" cx="25" cy="34" r="2"/><line class="ico-drop" x1="33" y1="31" x2="30" y2="37"/>'; break;
      case 'storm': b = cloud(6, 2) + '<path class="ico-bolt" d="M24,27 L19,35 H23 L21,40 L29,31 H25 L27,27 Z"/>'; break;
      default: b = cloud(6, 6);
    }
    return `<svg viewBox="0 0 48 40" role="img" aria-label="${SYM_WORD[sym] || ''}">${b}</svg>`;
  }

  function renderForecast() {
    const fc = S.fc, sec = $('fc-section');
    if (!fc || !fc.daily || !fc.daily.length) { sec.hidden = true; return; }
    sec.hidden = false;
    const nModels = fc.models.filter((m) => m.mae1 != null).length;
    $('fc-note').textContent = `spočteno v ${hm(fc.generated)} z ${nModels} modelů`;

    // texty
    const tb = $('fc-texts');
    tb.replaceChildren();
    for (const t of fc.texts) {
      const c = document.createElement('div');
      c.className = 'card fc-text';
      const h = document.createElement('h3'); h.textContent = t.title;
      const p = document.createElement('p'); p.textContent = t.text.replace(/ (°C|cm|mm|km\/h|%)/g, ' $1');
      c.append(h, p);
      tb.append(c);
    }

    // dny
    const today = dayKey(Date.now() / 1000), tomorrow = keyAdd(today, 1);
    const db = $('fc-days');
    db.replaceChildren();
    for (const d of fc.daily) {
      const c = document.createElement('div');
      c.className = 'card fc-day';
      c.setAttribute('role', 'listitem');
      const dd = keyDate(d.d);
      const name = d.d === today ? 'Dnes' : d.d === tomorrow ? 'Zítra' : DOW_LONG[dd.getUTCDay()].replace(/^./, (x) => x.toUpperCase());
      const snow = d.sym === 'snow';
      const rainTxt = d.rain >= 0.1 ? (snow ? `${num(Math.max(1, Math.round(d.rain)), 0)} cm` : `${num(d.rain)} mm`) : 'bez srážek';
      const spread = d.tmax_hi != null && d.tmax_lo != null ? d.tmax_hi - d.tmax_lo : 0;
      const parts = [
        ['dn', name], ['dd', `${dd.getUTCDate()}. ${dd.getUTCMonth() + 1}.`],
      ];
      for (const [cls, txt] of parts) { const e = document.createElement('div'); e.className = cls; e.textContent = txt; c.append(e); }
      c.insertAdjacentHTML('beforeend', icon(d.sym));
      const sw = document.createElement('div'); sw.className = 'sw'; sw.textContent = SYM_WORD[d.sym] || ''; c.append(sw);
      const tt = document.createElement('div'); tt.className = 'tt';
      tt.append(document.createTextNode(`${num(d.tmax, 0)}° `));
      const mn = document.createElement('span'); mn.textContent = `/ ${num(d.tmin, 0)}°`; tt.append(mn);
      c.append(tt);
      const rr = document.createElement('div'); rr.className = 'rr';
      rr.textContent = d.rain >= 0.1 || d.prob >= 20 ? `${rainTxt} · ${d.prob} %` : rainTxt;
      c.append(rr);
      if (spread >= 4) { const u = document.createElement('div'); u.className = 'unc'; u.textContent = 'nejisté'; u.title = `modely se liší o ${num(spread)} °C`; c.append(u); }
      c.title = `${name} ${dd.getUTCDate()}. ${dd.getUTCMonth() + 1}.: ${SYM_WORD[d.sym] || ''}, ${num(d.tmin)} až ${num(d.tmax)} °C, srážky ${num(d.rain)} mm (${d.prob} %), vítr do ${num(d.ws)} km/h, nárazy ${num(d.wg)} km/h`;
      db.append(c);
    }

    // grafy na 48 h
    const H = fc.hourly, now = Date.now() / 1000;
    const xMin = Math.floor(now / 3600) * 3600, xMax = xMin + 48 * 3600;
    const c1 = css('--series-1'), cm = css('--muted');
    const lg = $('fc-temp-legend');
    lg.replaceChildren();
    for (const [nm, col, rect] of [['Předpověď', c1, false], ['Rozpětí modelů', cm, true]]) {
      const sp = document.createElement('span');
      const k = document.createElement('i'); k.className = rect ? 'key-rect' : 'key-line'; k.style.background = col;
      if (rect) k.style.opacity = '0.35';
      sp.append(k, document.createTextNode(nm));
      lg.append(sp);
    }
    const i0 = bisect(H.ts, xMin), i1 = bisect(H.ts, xMax + 1);
    let tmx = null, tmn = null, rsum = 0;
    for (let i = i0; i < i1; i++) {
      if (tmx == null || H.t[i] > tmx) tmx = H.t[i];
      if (tmn == null || H.t[i] < tmn) tmn = H.t[i];
      rsum += H.rain[i] || 0;
    }
    const when = (ts) => `${DOW[L(ts).getUTCDay()]} ${hm(ts)}`;
    groups.fc = new Set();
    timeChart($('fc-temp'), {
      label: 'Předpověď teploty na 48 hodin', x: H.ts, xMin, xMax, ticks: 'hours', gap: 2 * 3600, height: 200, zero: true, minSpan: 4, group: 'fc',
      series: [{ name: 'Předpověď', v: H.t, color: c1 }], band: { lo: H.tlo, hi: H.thi, color: cm },
      readoutEl: $('fc-temp-readout'),
      readout: (i) => i == null ? ['nejvýš ', { b: num(tmx) }, ' · nejníž ', { b: num(tmn) }] : [{ b: `${num(H.t[i])} °C` }],
      tipTitle: (i) => when(H.ts[i]),
      tipRows: (i) => [
        { color: c1, value: `${num(H.t[i])} °C`, name: 'předpověď' },
        { value: `${num(H.tlo[i])} až ${num(H.thi[i])} °C`, name: 'rozpětí modelů' },
        { value: `${num(H.ws[i])} km/h`, name: `vítr${H.wd[i] != null ? ' ' + DIR8_FROM[dirIndex(H.wd[i])] : ''}` },
        { value: `${num(H.cloud[i], 0)} %`, name: 'oblačnost' },
      ],
    });
    const bars = { x0: [], x1: [], v: [], p: [] };
    for (let i = i0; i < i1; i++) { bars.x0.push(H.ts[i] - 3600); bars.x1.push(H.ts[i]); bars.v.push(H.rain[i] || 0); bars.p.push(H.prob[i]); }
    timeChart($('fc-rain'), {
      label: 'Předpověď srážek na 48 hodin', x: null, xMin, xMax, ticks: 'hours', height: 130, group: 'fc',
      series: [], bars: { ...bars, color: c1 }, y0: true, minSpan: 1,
      emptyText: rsum >= 0.1 ? '' : 'V příštích 48 hodinách srážky nevypadají pravděpodobně',
      readoutEl: $('fc-rain-readout'),
      readout: (i) => i == null ? ['celkem ', { b: `${num(rsum)} mm` }] : [{ b: `${num(bars.v[i])} mm` }, ` · ${bars.p[i]} %`],
      tipTitle: (i) => `${when(bars.x0[i])}–${hm(bars.x1[i])}`,
      tipRows: (i) => [{ color: c1, rect: true, value: `${num(bars.v[i])} mm`, name: 'srážky' }, { value: `${bars.p[i]} %`, name: 'pravděpodobnost' }],
    });

    // přesnost
    const ex = $('fc-explain');
    const best = fc.models.find((m) => m.mae1 != null);
    setRich(ex, [
      `Každý model se porovnává s měřením stanice za posledních ${fc.calib_days} dní a opravuje se jeho typická chyba (třeba že čidlo na slunci ukazuje víc). Modely, které se trefují líp, mají v předpovědi větší váhu. `,
      `Za posledních ${fc.test_days} dní se předpověď teploty na další den mýlila v průměru o `, { b: `${num(fc.blend_mae1)} °C` },
      best ? ` – nejlepší samostatný model (${best.name}, ${best.src}) o ${num(best.mae1)} °C, prostý průměr modelů o ${num(fc.raw_mean_mae1)} °C.` : '.',
    ]);
    table($('fc-models'), ['Model', 'Kdo ho počítá', 'Průměrná chyba °C', 'Váha'],
      fc.models.map((m) => [m.name, m.src + (m.horizon ? ` (na ${m.horizon / 24} dny)` : ''), m.mae1 != null ? num(m.mae1) : '–', m.weight != null ? `${m.weight} %` : '–']));
  }

  /* ================================================================ vše dohromady */
  function renderAll() {
    renderNow();
    renderStatus();
    renderForecast();
    renderTrend();
    renderYear();
  }

  function bindControls() {
    $('range').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      S.range = +b.dataset.range;
      for (const x of $('range').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      renderTrend();
    });
    $('cal-mode').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      S.cal = b.dataset.mode;
      for (const x of $('cal-mode').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      renderCalendar(yearDays());
    });
    let lastW = innerWidth, t = null;
    addEventListener('resize', () => {
      if (Math.abs(innerWidth - lastW) < 4) return;
      lastW = innerWidth;
      clearTimeout(t);
      t = setTimeout(() => { if (S.rec) { renderForecast(); renderTrend(); renderYear(); } }, 150);
    });
    darkMq.addEventListener('change', () => { if (S.rec) { renderAll(); } });
    addEventListener('scroll', hideTip, { passive: true });
  }

  async function start() {
    bindControls();
    try {
      await loadAll();
      renderAll();
    } catch (e) {
      $('status').textContent = 'Data se nepodařilo načíst. Běží sběrač (server.py)?';
      $('status').classList.add('stale');
      return;
    }
    setInterval(refresh, 2 * 60 * 1000);
    setInterval(renderStatus, 30 * 1000);
  }
  start();
})();
