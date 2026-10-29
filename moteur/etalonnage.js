/* Étalonnage : mesurer la palette d'une vidéo et recolorer une autre vidéo dans cette palette.
 * Gratuit, tout se fait dans le navigateur (canvas + MediaRecorder).
 * Méthode : transfert de couleurs dans l'espace Lab (moyenne et écart par canal, par zones claires / moyennes / sombres),
 * appliqué image par image à travers une table de correspondance (LUT) 64×64×64. */
(function (global) {
  'use strict';

  /* ---------- Conversions sRGB ↔ Lab ---------- */
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const delin = c => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const fi = t => t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27);
  function rgbLab(r, g, b) {
    const R = lin(r), G = lin(g), B = lin(b);
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function labRgb(L, a, bb) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
    const x = fi(fx) * 0.95047, y = fi(fy), z = fi(fz) * 1.08883;
    return [delin(x * 3.2406 - y * 1.5372 - z * 0.4986), delin(-x * 0.9689 + y * 1.8758 + z * 0.0415), delin(x * 0.0557 - y * 0.2040 + z * 1.0570)];
  }
  const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

  /* ---------- Échantillonner une vidéo ---------- */
  function chargerVideo(url) {
    return new Promise((ok, ko) => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      v.onloadeddata = () => ok(v);
      v.onerror = () => ko(new Error('Vidéo illisible'));
    });
  }
  const aller = (v, t) => new Promise(ok => { v.onseeked = () => ok(); v.currentTime = t; });
  async function echantillon(url, nbImages) {
    const v = await chargerVideo(url);
    const W = 72, H = Math.round(72 * (v.videoHeight || 1280) / (v.videoWidth || 720));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const px = [];
    const n = nbImages || 6;
    for (let i = 0; i < n; i++) {
      await aller(v, (v.duration || 1) * (i + 0.5) / n);
      ctx.drawImage(v, 0, 0, W, H);
      let d;
      try { d = ctx.getImageData(0, 0, W, H).data; }
      catch (e) { throw new Error('Lecture des couleurs impossible quand le site est ouvert depuis un dossier : ouvrez-le depuis son adresse en ligne.'); }
      for (let j = 0; j < d.length; j += 4) px.push([d[j], d[j + 1], d[j + 2]]);
    }
    return { px, video: v };
  }

  /* ---------- Palette (k-moyennes en Lab) ---------- */
  function kmoyennes(labs, k) {
    const centres = [];
    const pas = Math.floor(labs.length / k);
    const tri = labs.slice().sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < k; i++) centres.push(tri[Math.min(tri.length - 1, i * pas + Math.floor(pas / 2))].slice());
    let groupes;
    for (let it = 0; it < 12; it++) {
      groupes = centres.map(() => ({ s: [0, 0, 0], n: 0 }));
      for (const p of labs) {
        let m = 0, dm = 1e9;
        for (let c = 0; c < k; c++) { const d = (p[0] - centres[c][0]) ** 2 + (p[1] - centres[c][1]) ** 2 + (p[2] - centres[c][2]) ** 2; if (d < dm) { dm = d; m = c; } }
        const g = groupes[m]; g.s[0] += p[0]; g.s[1] += p[1]; g.s[2] += p[2]; g.n++;
      }
      groupes.forEach((g, c) => { if (g.n) centres[c] = [g.s[0] / g.n, g.s[1] / g.n, g.s[2] / g.n]; });
    }
    return centres.map((c, i) => ({ lab: c, part: groupes[i].n / labs.length })).filter(x => x.part > 0.005).sort((a, b) => b.part - a.part);
  }
  function nommer(palette) {
    const chroma = x => Math.hypot(x.lab[1], x.lab[2]);
    const restants = palette.slice();
    const prendre = (filtre, role) => { const i = restants.findIndex(filtre); if (i >= 0) { restants[i].role = role; restants.splice(i, 1); } };
    const clairs = restants.filter(x => x.lab[0] > 62).sort((a, b) => b.part - a.part);
    if (clairs[0]) prendre(x => x === clairs[0], 'fond');
    const sombre = restants.slice().sort((a, b) => a.lab[0] - b.lab[0])[0];
    if (sombre && sombre.lab[0] < 45) prendre(x => x === sombre, 'ombres et contours');
    const vifs = restants.slice().sort((a, b) => chroma(b) - chroma(a));
    if (vifs[0] && chroma(vifs[0]) > 15) prendre(x => x === vifs[0], 'élément principal (accent)');
    if (vifs[1] && chroma(vifs[1]) > 10) prendre(x => x === vifs[1], 'éléments secondaires (feuillage…)');
    restants.forEach(x => { x.role = x.lab[0] > 62 ? 'fond clair / lumière' : x.lab[0] < 40 ? 'tons sombres' : 'nuance intermédiaire'; });
    return palette;
  }
  async function palette(url, k) {
    const { px } = await echantillon(url, 6);
    const pasEch = Math.max(1, Math.floor(px.length / 6000));
    const labs = []; for (let i = 0; i < px.length; i += pasEch) labs.push(rgbLab(...px[i]));
    const pal = nommer(kmoyennes(labs, k || 6)).map(x => { const [r, g, b] = labRgb(...x.lab); return { role: x.role, hex: hex(r, g, b), part: Math.round(x.part * 100), lab: x.lab }; });
    return { palette: pal, stats: statsLab(labs) };
  }

  /* ---------- Statistiques par tranches de luminosité ---------- */
  const TRANCHES = [[0, 40], [40, 70], [70, 101]];
  function statsLab(labs) {
    const parTranche = TRANCHES.map(() => ({ s: [0, 0, 0], q: [0, 0, 0], n: 0 }));
    const glob = { s: [0, 0, 0], q: [0, 0, 0], n: 0 };
    for (const p of labs) {
      const t = TRANCHES.findIndex(([a, b]) => p[0] >= a && p[0] < b);
      for (const g of [parTranche[t < 0 ? 2 : t], glob]) { for (let c = 0; c < 3; c++) { g.s[c] += p[c]; g.q[c] += p[c] * p[c]; } g.n++; }
    }
    const fin = g => g.n < 30 ? null : { m: g.s.map(v => v / g.n), e: g.s.map((v, c) => Math.max(1, Math.sqrt(Math.max(0, g.q[c] / g.n - (v / g.n) ** 2)))) };
    const G = fin(glob);
    return { global: G, tranches: parTranche.map(g => fin(g) || G) };
  }

  /* ---------- Table de correspondance ---------- */
  function construireLUT(src, ref, force) {
    force = force == null ? 1 : force;
    const N = 64, lut = new Uint8Array(N * N * N * 3);
    const poids = L => { // mélange doux entre tranches
      const c = [20, 55, 85];
      const w = c.map(x => Math.exp(-((L - x) ** 2) / (2 * 15 * 15)));
      const s = w.reduce((a, b) => a + b, 0); return w.map(x => x / s);
    };
    let i = 0;
    for (let r = 0; r < N; r++) for (let g = 0; g < N; g++) for (let b = 0; b < N; b++) {
      const R = r * 255 / (N - 1), G = g * 255 / (N - 1), B = b * 255 / (N - 1);
      const lab = rgbLab(R, G, B);
      const w = poids(lab[0]);
      const out = [0, 0, 0];
      for (let t = 0; t < 3; t++) {
        const S = src.tranches[t], F = ref.tranches[t];
        for (let c = 0; c < 3; c++) {
          // luminosité : transfert global (garde le relief), chroma : transfert par tranche
          const s = c === 0 ? src.global : S, fr = c === 0 ? ref.global : F;
          out[c] += w[t] * ((lab[c] - s.m[c]) / s.e[c] * fr.e[c] + fr.m[c]);
        }
      }
      const mix = out.map((v, c) => lab[c] + (v - lab[c]) * force);
      mix[0] = Math.max(0, Math.min(100, mix[0]));
      const [rr, gg, bb] = labRgb(mix[0], mix[1], mix[2]);
      lut[i++] = rr; lut[i++] = gg; lut[i++] = bb;
    }
    return lut;
  }
  function appliquer(data, lut) {
    for (let j = 0; j < data.length; j += 4) {
      const k = ((data[j] >> 2) * 4096 + (data[j + 1] >> 2) * 64 + (data[j + 2] >> 2)) * 3;
      data[j] = lut[k]; data[j + 1] = lut[k + 1]; data[j + 2] = lut[k + 2];
    }
  }

  /* ---------- Aperçu d'une image ---------- */
  async function apercu(url, lut, t) {
    const v = await chargerVideo(url);
    await aller(v, Math.min((v.duration || 1) * 0.4, t != null ? t : 1.5));
    const c = document.createElement('canvas'); c.width = 270; c.height = Math.round(270 * v.videoHeight / v.videoWidth);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const avant = c.toDataURL('image/jpeg', 0.85);
    const im = ctx.getImageData(0, 0, c.width, c.height); appliquer(im.data, lut); ctx.putImageData(im, 0, 0);
    return { avant, apres: c.toDataURL('image/jpeg', 0.85) };
  }

  /* ---------- Recoloration de toute la vidéo (temps réel) ---------- */
  async function recolorer(url, lut, opts) {
    opts = opts || {};
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('Ce navigateur ne sait pas enregistrer : utilisez Chrome sur ordinateur.');
    const v = await chargerVideo(url);
    const Wv = v.videoWidth, Hv = v.videoHeight;
    const echelle = Math.min(1, 1080 / Wv);
    const c = document.createElement('canvas'); c.width = Math.round(Wv * echelle / 2) * 2; c.height = Math.round(Hv * echelle / 2) * 2;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 });
    const morceaux = []; rec.ondataavailable = e => { if (e.data.size) morceaux.push(e.data); };
    const fini = new Promise(ok => { rec.onstop = ok; });
    const peindre = () => { ctx.drawImage(v, 0, 0, c.width, c.height); const im = ctx.getImageData(0, 0, c.width, c.height); appliquer(im.data, lut); ctx.putImageData(im, 0, 0); };
    v.loop = false; v.currentTime = 0;
    await aller(v, 0); peindre();
    rec.start(200);
    let actif = true;
    const boucle = () => { if (!actif) return; peindre(); if (opts.progres) opts.progres(Math.min(1, v.currentTime / (v.duration || 1))); if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(boucle); else requestAnimationFrame(boucle); };
    const fin = new Promise(ok => { v.onended = ok; });
    await v.play();
    boucle();
    await fin; actif = false; peindre();
    await new Promise(r => setTimeout(r, 250));
    rec.stop(); await fini;
    return { blob: new Blob(morceaux, { type: mime || 'video/webm' }), extension: /mp4/.test(mime) ? 'mp4' : 'webm' };
  }

  global.Etalonnage = { palette, construireLUT, apercu, recolorer, rgbLab };
})(window);
