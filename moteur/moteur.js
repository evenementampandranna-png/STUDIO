/* Moteur de lecture des invitations — Studio d'invitations
 * Un plan = un fond vidéo + des calques (texte, image, vidéo) dessinés sur un canvas,
 * + des calques interactifs (bouton, compteur, champ) posés en HTML par-dessus.
 * Positions en % de l'écran (x, y = centre du calque), tailles de texte en % de la hauteur, temps en secondes.
 */
(function (global) {
  'use strict';

  const W = 720, H = 1280;
  const POLICES = ['Cormorant Garamond', 'Great Vibes', 'Playfair Display', 'Dancing Script', 'Montserrat', 'Parisienne', 'Cinzel'];
  const ANIMATIONS = ['aucune', 'fondu', 'fondu-montee', 'fondu-descente', 'ecriture', 'mot-par-mot', 'zoom', 'zoom-arriere', 'rebond', 'flou', 'glissement-gauche', 'glissement-droite'];
  const SORTIES = ['aucune', 'fondu', 'fondu-montee', 'fondu-descente', 'zoom', 'zoom-arriere', 'flou', 'glissement-gauche', 'glissement-droite'];
  const NOMS_EFFETS = { aucune: 'Aucun', fondu: 'Fondu', 'fondu-montee': 'Fondu en montant', 'fondu-descente': 'Fondu en descendant', ecriture: 'Lettre par lettre', 'mot-par-mot': 'Mot par mot', zoom: 'Zoom avant', 'zoom-arriere': 'Zoom arrière', rebond: 'Rebond', flou: 'Flou', 'glissement-gauche': 'Glisse depuis la gauche', 'glissement-droite': 'Glisse depuis la droite' };
  const rebond = q => { q = Math.max(0, Math.min(1, q)); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(q - 1, 3) + c1 * Math.pow(q - 1, 2); };
  const ACTIONS = ['suivant', 'precedent', 'passer', 'confirmer', 'refuser', 'map', 'appeler', 'whatsapp', 'messenger', 'partager', 'calendrier', 'revoir', 'lien'];
  const TYPES_HTML = ['bouton', 'compteur', 'champ'];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = p => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- Variables {famille} {places} ... ---------- */
  function joursAvant(dateIso, heure) {
    if (!dateIso) return null;
    const t = Date.parse(dateIso + 'T' + (heure || '00:00') + ':00+03:00');
    if (isNaN(t)) return null;
    return Math.max(0, t - Date.now());
  }
  function texteCompte(ms, langue) {
    if (ms == null) return '';
    const s = Math.floor(ms / 1000), j = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    const p = n => String(n).padStart(2, '0');
    return langue === 'mg' ? `${j} andro  ${p(h)} ora  ${p(m)} min  ${p(sec)} s` : `${j} jours  ${p(h)} h  ${p(m)} min  ${p(sec)} s`;
  }
  const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MOIS_MG = ['Janoary', 'Febroary', 'Martsa', 'Aprily', 'Mey', 'Jona', 'Jolay', 'Aogositra', 'Septambra', 'Oktobra', 'Novambra', 'Desambra'];
  const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const JOURS_MG = ['Alahady', 'Alatsinainy', 'Talata', 'Alarobia', 'Alakamisy', 'Zoma', 'Sabotsy'];
  function dateLisible(iso, langue) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return langue === 'mg' ? `${JOURS_MG[wd]} ${d} ${MOIS_MG[m - 1]} ${y}` : `${JOURS_FR[wd]} ${d} ${MOIS_FR[m - 1]} ${y}`;
  }
  function remplacer(texte, vars) {
    if (!texte) return '';
    return String(texte).replace(/\{(\w+)\}/g, (all, k) => (vars && vars[k] != null && vars[k] !== '') ? String(vars[k]) : (k === 'places' ? '' : all));
  }
  function variablesDe(projet, famille, form) {
    const f = (projet && projet.fiche) || {};
    const lang = f.langue || 'fr';
    return {
      famille: famille ? famille.nom : '',
      places: famille ? famille.places : '',
      adultes: form && form.adultes != null ? form.adultes : (famille ? famille.adultes : ''),
      enfants: form && form.enfants != null ? form.enfants : (famille ? famille.enfants : ''),
      titre: f.titre || '',
      date: dateLisible(f.date, lang),
      heure: f.heure || '',
      date_limite: dateLisible(f.date_limite, lang),
      compte_a_rebours: texteCompte(joursAvant(f.date, f.heure), lang)
    };
  }

  /* ---------- Texte : découpe en lignes ---------- */
  function lignes(ctx, texte, largeurPx) {
    const out = [];
    String(texte).split('\n').forEach(par => {
      const mots = par.split(/\s+/).filter(Boolean);
      if (!mots.length) { out.push(''); return; }
      let l = mots[0];
      for (let i = 1; i < mots.length; i++) {
        const essai = l + ' ' + mots[i];
        if (ctx.measureText(essai).width > largeurPx) { out.push(l); l = mots[i]; } else l = essai;
      }
      out.push(l);
    });
    return out;
  }

  /* ---------- Moteur ---------- */
  class Moteur {
    constructor(racine, opts) {
      opts = opts || {};
      this.racine = racine;
      this.base = opts.base || '';
      this.mode = opts.mode || 'invitation';      // 'invitation' | 'edition' | 'rendu'
      this.resolveur = opts.resolveur || null;     // async (src) => url
      this.onAction = opts.onAction || function () {};
      this.onFin = opts.onFin || function () {};
      this.onTemps = opts.onTemps || function () {};
      this.famille = opts.famille || null;
      this.form = { adultes: null, enfants: null, places_transport: 1, quartier: '' };
      this.bbox = {};
      this.medias = {};
      this.urls = {};
      this.projet = null;
      this.seq = [];     // indices de plans joués
      this.pos = 0;      // position dans la séquence
      this.t = 0;        // temps dans le plan courant
      this.lecture = false;
      this.planFixe = null; // en édition : plan affiché
      this.masquerHTML = false;

      racine.classList.add('mt-racine');
      this.canvas = document.createElement('canvas');
      this.canvas.width = W; this.canvas.height = H;
      this.canvas.className = 'mt-canvas';
      this.ctx = this.canvas.getContext('2d');
      this.calqueHTML = document.createElement('div');
      this.calqueHTML.className = 'mt-html';
      racine.appendChild(this.canvas);
      racine.appendChild(this.calqueHTML);
      injecterStyle();
      this._boucle = this._boucle.bind(this);
      this._dernier = performance.now();
      this._raf = requestAnimationFrame(this._boucle);
    }

    detruire() { cancelAnimationFrame(this._raf); Object.values(this.medias).forEach(m => { if (m.pause) m.pause(); }); this.racine.innerHTML = ''; }

    async setProjet(projet) {
      this.projet = projet;
      this._miseEnPage = projet && projet.mise_en_page === false;
      if (this.famille && this.form.adultes == null) {
        this.form.adultes = Number(this.famille.adultes) || Number(this.famille.places) || 1;
        this.form.enfants = Number(this.famille.enfants) || 0;
      }
      await this.precharger();
      if (this._miseEnPage) {   // première ouverture : textes empilés avec les vraies polices
        (projet.plans || []).forEach(p => { if (p.role !== 'confirmation') this.empilerTextes(p, 3); });
        projet.mise_en_page = true;
      }
    }

    async url(src) {
      if (!src) return null;
      if (this.urls[src]) return this.urls[src];
      let u = src;
      if (this.resolveur) u = await this.resolveur(src);
      else if (!/^(https?:|blob:|data:)/.test(src)) u = this.base + src;
      this.urls[src] = u;
      return u;
    }

    async media(src, type) {
      if (!src) return null;
      if (this.medias[src]) return this.medias[src];
      const u = await this.url(src);
      if (!u) return null;
      let el;
      if (type === 'image' || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(src)) {
        el = new Image(); el.decoding = 'async'; el.src = u;
      } else {
        el = document.createElement('video');
        el.muted = true; el.playsInline = true; el.loop = true; el.preload = 'auto';
        el.setAttribute('playsinline', ''); el.setAttribute('muted', '');
        if (location.protocol !== 'file:' && /^https?:/.test(new URL(u, location.href).href)) el.crossOrigin = 'anonymous';
        el.src = u;
      }
      this.medias[src] = el;
      return el;
    }

    async precharger() {
      if (!this.projet) return;
      const polices = new Set();
      const promesses = [];
      (this.projet.plans || []).forEach(p => {
        if (p.fond && p.fond.media) promesses.push(this.media(p.fond.media, 'video'));
        (p.calques || []).forEach(c => {
          if (c.police) polices.add(c.police);
          if ((c.type === 'image' || c.type === 'video') && c.media) promesses.push(this.media(c.media, c.type));
        });
      });
      await Promise.all(promesses);
      if (document.fonts && document.fonts.load) {
        await Promise.all([...polices].map(p => document.fonts.load(`40px "${p}"`).catch(() => null)));
      }
    }

    /* ----- Séquences ----- */
    plansFilm() { return (this.projet.plans || []).map((p, i) => i).filter(i => this.projet.plans[i].role !== 'confirmation'); }
    plansInvitation() {
      const pl = this.projet.plans || [];
      const film = pl.map((p, i) => i).filter(i => pl[i].role === 'ouverture' || pl[i].role === 'intermediaire');
      const conf = pl.map((p, i) => i).filter(i => pl[i].role === 'confirmation');
      const merci = pl.map((p, i) => i).filter(i => pl[i].role === 'remerciement');
      return film.concat(conf, merci);
    }

    jouer(seq, depuis) {
      this.planFixe = null;
      this.seq = seq;
      this.pos = depuis || 0;
      this.t = 0;
      this.lecture = true;
      this._entrerPlan();
    }
    pause() { this.lecture = false; Object.values(this.medias).forEach(m => m.pause && m.pause()); }
    reprendre() { this.lecture = true; const p = this.planCourant(); if (p) this._lancerVideos(p, false); }

    afficherPlan(index, t) {       // édition : plan fixe, temps choisi
      this.lecture = false;
      this.seq = [index]; this.pos = 0;
      this.planFixe = index;
      this.t = t || 0;
      const p = this.planCourant();
      if (p) this._caler(p, this.t);
      this._construireHTML();
    }
    jouerPlan(index) { this.jouer([index], 0); this.planFixe = index; }

    planCourant() { return this.projet && this.projet.plans ? this.projet.plans[this.seq[this.pos]] : null; }
    plansuivant() { return this.projet && this.projet.plans ? this.projet.plans[this.seq[this.pos + 1]] : null; }

    allerA(pos) { if (pos < 0 || pos >= this.seq.length) return; this.pos = pos; this.t = 0; this.lecture = true; this._entrerPlan(); }
    suivant() { if (this.pos < this.seq.length - 1) this.allerA(this.pos + 1); }
    precedent() { if (this.pos > 0) this.allerA(this.pos - 1); }
    passerFilm() {
      const pl = this.projet.plans;
      const i = this.seq.findIndex(k => pl[k].role === 'confirmation' || pl[k].role === 'remerciement');
      if (i >= 0) this.allerA(i);
    }

    _entrerPlan() {
      const p = this.planCourant();
      if (!p) return;
      const avant = this.projet.plans[this.seq[this.pos - 1]];
      const memeFond = avant && avant.fond && p.fond && avant.fond.media === p.fond.media;
      this._lancerVideos(p, !memeFond);
      this._construireHTML();
    }

    _lancerVideos(p, reset) {
      const els = [];
      if (p.fond && p.fond.media) els.push([this.medias[p.fond.media], p.fond]);
      (p.calques || []).forEach(c => { if (c.type === 'video' && c.media) els.push([this.medias[c.media], c]); });
      els.forEach(([v, conf]) => {
        if (!v || v.tagName !== 'VIDEO') return;
        v.loop = conf.boucle !== false;
        v.playbackRate = conf.vitesse || 1;
        if (reset) { try { v.currentTime = 0; } catch (e) {} }
        if (this.lecture) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
      });
    }

    _caler(p, t) {   // édition : mettre les vidéos à l'instant t (pause)
      const caler = (v, conf) => {
        if (!v || v.tagName !== 'VIDEO') return;
        v.pause();
        const go = () => {
          const d = v.duration || 1;
          let tt = t * (conf.vitesse || 1);
          tt = conf.boucle === false ? Math.min(tt, d - 0.05) : tt % d;
          try { v.currentTime = tt; } catch (e) {}
        };
        if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true });
      };
      if (p.fond && p.fond.media) caler(this.medias[p.fond.media], p.fond);
      (p.calques || []).forEach(c => { if (c.type === 'video' && c.media) caler(this.medias[c.media], c); });
    }

    _boucle(now) {
      const dt = Math.min(0.1, (now - this._dernier) / 1000);
      this._dernier = now;
      if (this.projet) {
        const p = this.planCourant();
        if (p && this.lecture) {
          this.t += dt;
          const duree = Number(p.duree) || 0;
          if (duree > 0 && this.t >= duree) {
            if (this.pos < this.seq.length - 1) { this.pos++; this.t = 0; this._entrerPlan(); }
            else if (this.planFixe != null) { this.t = 0; this._entrerPlan(); }
            else { this.t = duree; this.lecture = false; this.onFin(); }
          }
          this.onTemps(this.t, this.pos);
        }
        this.dessiner();
        if (this._compteurTick === undefined || now - this._compteurTick > 500) { this._compteurTick = now; this._majTextesHTML(); }
      }
      this._raf = requestAnimationFrame(this._boucle);
    }

    /* ----- Dessin ----- */
    dessiner() {
      const ctx = this.ctx;
      const p = this.planCourant();
      ctx.save();
      ctx.fillStyle = '#f4ede2'; ctx.fillRect(0, 0, W, H);
      if (!p) { ctx.restore(); return; }
      const tr = p.transition || {};
      const dTr = Number(tr.duree) || 0;
      const avant = this.projet.plans[this.seq[this.pos - 1]];
      if (avant && dTr > 0 && this.t < dTr && tr.type && tr.type !== 'aucune' && this.planFixe == null) {
        const q = ease(this.t / dTr);
        this._dessinerPlan(avant, (Number(avant.duree) || 0) + this.t, 1, false);
        if (tr.type === 'fondu-blanc' || tr.type === 'fondu-noir') {
          ctx.globalAlpha = q < 0.5 ? q * 2 : (1 - q) * 2;
          ctx.fillStyle = tr.type === 'fondu-blanc' ? '#fff' : '#000';
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
          if (q >= 0.5) this._dessinerPlan(p, this.t, (q - 0.5) * 2, true);
        } else if (tr.type === 'glissement') {
          ctx.save(); ctx.translate(W * (1 - q), 0); this._dessinerPlan(p, this.t, 1, true); ctx.restore();
        } else {
          this._dessinerPlan(p, this.t, q, true);
        }
      } else {
        this._dessinerPlan(p, this.t, 1, true);
      }
      ctx.restore();
    }

    _dessinerImage(el, x, y, w, h, cover) {
      const ctx = this.ctx;
      const iw = el.videoWidth || el.naturalWidth, ih = el.videoHeight || el.naturalHeight;
      if (!iw || !ih) return false;
      if (el.tagName === 'VIDEO' && el.readyState < 2) return false;
      if (el.tagName === 'IMG' && !el.complete) return false;
      const r = cover ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
      const dw = iw * r, dh = ih * r;
      ctx.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      return true;
    }

    _dessinerPlan(p, t, alpha, mesurer) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = alpha;
      const f = p.fond || {};
      const v = f.media ? this.medias[f.media] : null;
      if (v) {
        if (f.flou) ctx.filter = `blur(${f.flou}px)`;
        this._dessinerImage(v, 0, 0, W, H, true);
        ctx.filter = 'none';
      } else { ctx.fillStyle = '#f4ede2'; ctx.fillRect(0, 0, W, H); }
      if (f.assombrir) { ctx.fillStyle = `rgba(0,0,0,${clamp(f.assombrir, 0, 0.9)})`; ctx.fillRect(0, 0, W, H); }
      if (f.eclaircir) { ctx.fillStyle = `rgba(255,255,255,${clamp(f.eclaircir, 0, 0.9)})`; ctx.fillRect(0, 0, W, H); }
      const vars = variablesDe(this.projet, this.famille, this.form);
      (p.calques || []).forEach(c => {
        if (c.masque || (c.condition === 'famille' && !this.famille) || (c.condition === 'general' && this.famille)) { if (mesurer) delete this.bbox[c.id]; return; }
        if (c._edition && c.type === 'texte') return;   // en cours d'écriture dans l'éditeur : garder le cadre, ne pas dessiner
        if (TYPES_HTML.includes(c.type)) { if (mesurer) this._bboxHTML(c); return; }
        this._dessinerCalque(c, t, p, vars, alpha, mesurer);
      });
      ctx.restore();
    }

    _bboxHTML(c) {
      const larg = Number(c.largeur) || 60, haut = Number(c.hauteur) || (c.type === 'compteur' ? 6 : 6);
      this.bbox[c.id] = { x: c.x - larg / 2, y: c.y - haut / 2, w: larg, h: haut };
    }

    _etat(c, t, p) {
      const deb = Number(c.debut) || 0;
      const dureePlan = Number(p.duree) || 0;
      let fin = c.fin != null && c.fin !== '' ? Number(c.fin) : 0;
      if (!fin || (dureePlan && fin > dureePlan)) fin = dureePlan || 1e9;
      const edition = this.mode === 'edition' && !this.lecture;
      if (!edition && (t < deb || t > fin)) return null;
      const entree = c.animation || 'fondu';
      const sortie = c.sortie || 'aucune';
      const nbMots = String(c.texte || '').split(/\s+/).length;
      const dE = Number(c.duree_animation) || (entree === 'ecriture' ? clamp(String(c.texte || '').length * 0.05, 0.8, 2.5) : entree === 'mot-par-mot' ? clamp(nbMots * 0.22, 0.8, 3) : 0.9);
      const dS = Number(c.duree_sortie) || 0.6;
      let brutE = edition && t < deb ? 1 : clamp((t - deb) / dE, 0, 1);
      if (entree === 'aucune') brutE = 1;
      // sortie : se termine à « fin » (ou à la fin du plan)
      let brutS = 1;
      if (!edition && sortie !== 'aucune' && fin < 1e8) brutS = clamp((fin - t) / dS, 0, 1);
      else if (!edition && sortie === 'aucune' && dureePlan && fin < dureePlan) brutS = clamp((fin - t) / 0.3, 0, 1);
      return { entree, sortie, brutE, pE: entree === 'rebond' ? rebond(brutE) : ease(brutE), brutS, pS: ease(brutS) };
    }

    // Transformation d'un effet : q = 0 (invisible / hors champ) → 1 (en place)
    _effet(nom, q, brut, r) {
      if (nom === 'aucune') return;
      if (nom === 'ecriture' || nom === 'mot-par-mot') { r.a *= Math.min(1, brut * 6 + 0.001); return; }
      r.a *= nom === 'rebond' ? Math.min(1, brut * 3) : q;
      if (nom === 'fondu-montee') r.dy += (1 - q) * 0.035 * H;
      if (nom === 'fondu-descente') r.dy -= (1 - q) * 0.035 * H;
      if (nom === 'zoom') r.sc *= 0.8 + 0.2 * q;
      if (nom === 'zoom-arriere') r.sc *= 1.35 - 0.35 * q;
      if (nom === 'rebond') r.sc *= Math.max(0.01, q);
      if (nom === 'flou') r.flou += (1 - q) * 14;
      if (nom === 'glissement-gauche') r.dx -= (1 - q) * 0.3 * W;
      if (nom === 'glissement-droite') r.dx += (1 - q) * 0.3 * W;
    }

    _dessinerCalque(c, t, p, vars, alphaPlan, mesurer) {
      const e = this._etat(c, t, p);
      if (!e) { if (mesurer) delete this.bbox[c.id]; return; }
      const ctx = this.ctx;
      const cx = (Number(c.x) || 50) / 100 * W, cy = (Number(c.y) || 50) / 100 * H;
      const larg = (Number(c.largeur) || 80) / 100 * W;
      ctx.save();
      const r = { a: (c.opacite != null ? Number(c.opacite) : 1) * alphaPlan, dx: 0, dy: 0, sc: 1, flou: 0 };
      this._effet(e.entree, e.pE, e.brutE, r);
      if (e.brutS < 1) this._effet(e.sortie === 'aucune' ? 'fondu' : e.sortie, e.pS, e.brutS, r);
      let a = r.a, dx = r.dx, dy = r.dy, sc = r.sc;
      if (r.flou > 0.3) ctx.filter = `blur(${r.flou.toFixed(1)}px)`;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.translate(cx + dx, cy + dy);
      if (sc !== 1) ctx.scale(sc, sc);

      if (c.type === 'texte') {
        const taille = (Number(c.taille) || 4) / 100 * H;
        const police = c.police || 'Cormorant Garamond';
        ctx.font = `${c.italique ? 'italic ' : ''}${c.gras ? '700 ' : '400 '}${taille}px "${police}", serif`;
        ctx.textBaseline = 'middle';
        const align = c.align || 'center';
        ctx.textAlign = align;
        let txt = remplacer(c.texte, vars);
        if (c.majuscules) txt = txt.toUpperCase();
        const ls = lignes(ctx, txt, larg);
        const inter = taille * (Number(c.interligne) || 1.25);
        const hTot = inter * ls.length;
        let total = txt.length, montrer = total;
        const motsTxt = txt.split(/(\s+)/);
        if (e.entree === 'ecriture') montrer = Math.floor(e.brutE * total);
        if (e.entree === 'mot-par-mot') { const nm = Math.ceil(e.brutE * txt.split(/\s+/).length); let k = 0, n = 0; for (const m of motsTxt) { if (!/^\s+$/.test(m)) { n++; if (n > nm) break; } k += m.length; } montrer = k; }
        const ax = align === 'left' ? -larg / 2 : align === 'right' ? larg / 2 : 0;
        if (c.fond_couleur) {
          ctx.save(); ctx.globalAlpha *= (c.fond_opacite != null ? Number(c.fond_opacite) : 0.6);
          ctx.fillStyle = c.fond_couleur;
          arrondi(ctx, -larg / 2 - taille * 0.4, -hTot / 2 - taille * 0.3, larg + taille * 0.8, hTot + taille * 0.6, taille * 0.4);
          ctx.fill(); ctx.restore();
        }
        if (c.ombre) { ctx.shadowColor = c.ombre_couleur || 'rgba(255,255,255,0.85)'; ctx.shadowBlur = taille * 0.25; }
        let compte = 0;
        ls.forEach((l, i) => {
          const y = -hTot / 2 + inter * (i + 0.5);
          let morceau = l;
          if (e.entree === 'ecriture' || e.entree === 'mot-par-mot') { const reste = montrer - compte; morceau = reste <= 0 ? '' : l.slice(0, reste); compte += l.length + 1; }
          if (c.contour) { ctx.lineWidth = Number(c.contour_epaisseur) || taille * 0.06; ctx.strokeStyle = c.contour; ctx.strokeText(morceau, ax, y); }
          ctx.fillStyle = c.couleur || '#7a1f2b';
          ctx.fillText(morceau, ax, y);
        });
        if (mesurer) this.bbox[c.id] = { x: (cx - larg / 2) / W * 100, y: (cy - hTot / 2) / H * 100, w: larg / W * 100, h: hTot / H * 100 };
      } else if (c.type === 'image' || c.type === 'video') {
        const el = this.medias[c.media];
        const haut = c.hauteur ? Number(c.hauteur) / 100 * H : larg * 1.0;
        if (el) {
          if (c.forme === 'rond' || c.forme === 'arrondi') {
            ctx.save();
            if (c.forme === 'rond') { ctx.beginPath(); ctx.ellipse(0, 0, larg / 2, haut / 2, 0, 0, Math.PI * 2); }
            else arrondi(ctx, -larg / 2, -haut / 2, larg, haut, Math.min(larg, haut) * 0.08);
            ctx.clip();
            this._dessinerImage(el, -larg / 2, -haut / 2, larg, haut, true);
            ctx.restore();
          } else this._dessinerImage(el, -larg / 2, -haut / 2, larg, haut, c.remplir === true);
          if (c.bordure) { ctx.strokeStyle = c.bordure; ctx.lineWidth = 3; if (c.forme === 'rond') { ctx.beginPath(); ctx.ellipse(0, 0, larg / 2, haut / 2, 0, 0, Math.PI * 2); ctx.stroke(); } else { arrondi(ctx, -larg / 2, -haut / 2, larg, haut, c.forme === 'arrondi' ? Math.min(larg, haut) * 0.08 : 0); ctx.stroke(); } }
        } else {
          ctx.strokeStyle = 'rgba(122,31,43,.5)'; ctx.setLineDash([8, 6]); ctx.strokeRect(-larg / 2, -haut / 2, larg, haut);
        }
        if (mesurer) this.bbox[c.id] = { x: (cx - larg / 2) / W * 100, y: (cy - haut / 2) / H * 100, w: larg / W * 100, h: haut / H * 100 };
      }
      ctx.restore();
    }

    /* ----- Calques HTML (boutons, compteurs) ----- */
    _construireHTML() {
      const box = this.calqueHTML;
      box.innerHTML = '';
      const p = this.planCourant();
      if (!p || this.masquerHTML) return;
      const vars = variablesDe(this.projet, this.famille, this.form);
      const lang = (this.projet.fiche && this.projet.fiche.langue) || 'fr';
      (p.calques || []).forEach(c => {
        if (!TYPES_HTML.includes(c.type) || c.masque) return;
        if (c.condition === 'famille' && !this.famille) return;
        if (c.condition === 'general' && this.famille) return;
        const el = document.createElement('div');
        el.className = 'mt-el mt-' + c.type + ' mt-style-' + (c.style || 'plein');
        el.dataset.id = c.id;
        el.style.left = (Number(c.x) - (Number(c.largeur) || 60) / 2) + '%';
        el.style.top = c.y + '%';
        el.style.width = (Number(c.largeur) || 60) + '%';
        el.style.setProperty('--mt-taille', (Number(c.taille) || 2.6));
        el.style.setProperty('--mt-couleur', c.couleur || '#7a1f2b');
        if (c.police) el.style.fontFamily = `"${c.police}", serif`;
        const t0 = Number(c.debut) || 0;
        if (this.mode !== 'edition' && t0 > 0) { el.style.animationDelay = t0 + 's'; }
        if (c.type === 'bouton') {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = remplacer(c.texte, vars);
          b.addEventListener('click', ev => { ev.stopPropagation(); if (this.mode === 'edition') return; this._action(c); });
          el.appendChild(b);
        } else if (c.type === 'compteur') {
          const champ = c.champ || 'adultes';
          if (this.form[champ] == null) this.form[champ] = Number(c.defaut) || 0;
          el.innerHTML = `<span class="mt-lib"></span><span class="mt-ctrl"><button type="button" class="mt-moins" aria-label="moins">−</button><b class="mt-val"></b><button type="button" class="mt-plus" aria-label="plus">+</button></span>`;
          el.querySelector('.mt-lib').textContent = remplacer(c.texte, vars);
          const val = el.querySelector('.mt-val');
          const maj = () => { val.textContent = this.form[champ]; };
          maj();
          const min = c.min != null ? Number(c.min) : 0;
          const maxDe = () => {
            if (c.max != null && c.max !== '') return Number(c.max);
            if (this.famille && Number(this.famille.places)) {
              const autre = champ === 'adultes' ? 'enfants' : champ === 'enfants' ? 'adultes' : null;
              if (autre) return Number(this.famille.places) - (Number(this.form[autre]) || 0);
            }
            return 20;
          };
          el.querySelector('.mt-moins').addEventListener('click', ev => { ev.stopPropagation(); if (this.mode === 'edition') return; this.form[champ] = Math.max(min, (Number(this.form[champ]) || 0) - 1); maj(); });
          el.querySelector('.mt-plus').addEventListener('click', ev => { ev.stopPropagation(); if (this.mode === 'edition') return; this.form[champ] = Math.min(maxDe(), (Number(this.form[champ]) || 0) + 1); maj(); });
        } else if (c.type === 'champ') {
          const champ = c.champ || 'quartier';
          el.innerHTML = `<input type="text" class="mt-input">`;
          const inp = el.querySelector('input');
          inp.placeholder = remplacer(c.texte, vars) || (lang === 'mg' ? 'Soraty eto' : 'Écrire ici');
          inp.value = this.form[champ] || '';
          inp.addEventListener('input', () => { this.form[champ] = inp.value; });
          inp.addEventListener('click', ev => ev.stopPropagation());
        }
        box.appendChild(el);
      });
    }

    _majTextesHTML() {
      // rien à faire pour l'instant : les textes dynamiques sont dessinés sur le canvas
    }

    _action(c) {
      const fiche = this.projet.fiche || {};
      const a = c.action || 'suivant';
      if (a === 'suivant') return this.suivant();
      if (a === 'precedent') return this.precedent();
      if (a === 'passer') return this.passerFilm();
      if (a === 'revoir') { const seq = this.seq; return this.jouer(seq, 0); }
      this.onAction(a, c, Object.assign({}, this.form), this);
    }

    /* ----- Mesure réelle d'un texte (pour éviter les chevauchements) ----- */
    hauteurTexte(c) {
      const ctx = this.ctx;
      const taille = (Number(c.taille) || 4) / 100 * H;
      ctx.save();
      ctx.font = `${c.italique ? 'italic ' : ''}${c.gras ? '700 ' : '400 '}${taille}px "${c.police || 'Cormorant Garamond'}", serif`;
      let txt = remplacer(c.texte, variablesDe(this.projet, this.famille || { nom: 'Fianakaviana Rakotomalala', places: 4 }, this.form));
      if (c.majuscules) txt = txt.toUpperCase();
      const n = lignes(ctx, txt, (Number(c.largeur) || 80) / 100 * W).length;
      ctx.restore();
      return n * taille * (Number(c.interligne) || 1.25) / H * 100;
    }
    // Empile les textes d'un plan de haut en bas, sans chevauchement, autour de leur centre actuel
    empilerTextes(plan, ecart) {
      ecart = ecart == null ? 3 : ecart;
      const ts = (plan.calques || []).filter(c => (c.type === 'texte' || c.type === 'image' || c.type === 'video') && !c.masque && c.condition !== 'general').sort((a, b) => Number(a.y) - Number(b.y));
      if (ts.length < 2) return false;
      const hs = ts.map(c => c.type === 'texte' ? this.hauteurTexte(c) : (Number(c.hauteur) || (Number(c.largeur) || 40) * W / H));
      const centre = ts.reduce((s, c, i) => s + Number(c.y) * hs[i], 0) / (hs.reduce((a, b) => a + b, 0) || 1);
      const total = hs.reduce((a, b) => a + b, 0) + ecart * (ts.length - 1);
      let y = Math.max(6, Math.min(94 - total, centre - total / 2));
      ts.forEach((c, i) => { c.y = Math.round((y + hs[i] / 2) * 10) / 10; y += hs[i] + ecart; });
      return true;
    }

    /* ----- Image test ----- */
    imageTest(type) {
      try { return this.canvas.toDataURL(type || 'image/jpeg', 0.9); }
      catch (e) { throw new Error('Image impossible quand le site est ouvert depuis un dossier de l\'ordinateur : ouvrez-le depuis son adresse en ligne.'); }
    }

    /* ----- Export vidéo dans le navigateur (temps réel) ----- */
    async exporterFilm(opts) {
      opts = opts || {};
      const seq = opts.seq || this.plansFilm();
      if (!seq.length) throw new Error('Aucun plan à filmer');
      if (location.protocol === 'file:') throw new Error('L\'enregistrement du film fonctionne quand le studio est ouvert depuis son adresse en ligne (GitHub Pages), pas depuis un dossier de l\'ordinateur.');
      const total = seq.reduce((s, i) => s + (Number(this.projet.plans[i].duree) || 4), 0);
      const stream = this.canvas.captureStream(30);
      let audioCtx = null, musique = null;
      if (opts.musique) {
        try {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          musique = new Audio(); musique.crossOrigin = 'anonymous'; musique.src = opts.musique;
          const srcN = audioCtx.createMediaElementSource(musique);
          const dest = audioCtx.createMediaStreamDestination();
          const gain = audioCtx.createGain(); gain.gain.value = opts.volume != null ? opts.volume : 0.9;
          srcN.connect(gain); gain.connect(dest);
          dest.stream.getAudioTracks().forEach(tk => stream.addTrack(tk));
        } catch (e) { console.warn('musique', e); }
      }
      const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3.5e6 });
      const morceaux = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) morceaux.push(e.data); };
      const fini = new Promise(res => { rec.onstop = res; });
      this.masquerHTML = true;
      const ancienFin = this.onFin, ancienTemps = this.onTemps;
      let ecoule = 0;
      const debut = performance.now();
      this.onTemps = () => { ecoule = (performance.now() - debut) / 1000; if (opts.progres) opts.progres(Math.min(1, ecoule / total)); };
      const termine = new Promise(res => { this.onFin = res; });
      rec.start(250);
      if (musique) { try { await audioCtx.resume(); musique.currentTime = opts.debut || 0; await musique.play(); } catch (e) {} }
      this.jouer(seq, 0);
      await termine;
      await new Promise(r => setTimeout(r, 300));
      rec.stop();
      if (musique) musique.pause();
      await fini;
      this.onFin = ancienFin; this.onTemps = ancienTemps;
      this.masquerHTML = false;
      if (audioCtx) audioCtx.close();
      const blob = new Blob(morceaux, { type: mime || 'video/webm' });
      return { blob, extension: /mp4/.test(mime) ? 'mp4' : 'webm', duree: total };
    }
  }

  function arrondi(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  let styleInjecte = false;
  function injecterStyle() {
    if (styleInjecte) return; styleInjecte = true;
    const s = document.createElement('style');
    s.textContent = `
.mt-racine{position:relative;aspect-ratio:9/16;overflow:hidden;container-type:size;background:#f4ede2;user-select:none;-webkit-user-select:none}
.mt-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.mt-html{position:absolute;inset:0;pointer-events:none}
.mt-el{position:absolute;transform:translateY(-50%);pointer-events:auto;display:flex;justify-content:center;align-items:center;font-size:calc(var(--mt-taille) * 1cqh);animation:mtEntree .7s ease both;font-family:"Cormorant Garamond",serif}
@keyframes mtEntree{from{opacity:0;transform:translateY(-30%)}to{opacity:1;transform:translateY(-50%)}}
.mt-bouton button{font:inherit;font-weight:600;width:100%;padding:.55em .8em;border-radius:999px;cursor:pointer;border:1.5px solid var(--mt-couleur);line-height:1.15;transition:transform .15s}
.mt-bouton button:active{transform:scale(.96)}
.mt-style-plein button{background:var(--mt-couleur);color:#fff;box-shadow:0 .3em .9em rgba(60,10,20,.25)}
.mt-style-contour button{background:rgba(255,255,255,.82);color:var(--mt-couleur)}
.mt-style-lien button{background:none;border:none;color:var(--mt-couleur);text-decoration:underline}
.mt-compteur{justify-content:space-between;gap:.5em;background:rgba(255,255,255,.82);border:1.5px solid color-mix(in srgb,var(--mt-couleur) 40%,transparent);border-radius:1em;padding:.35em .6em;color:var(--mt-couleur);font-weight:600;box-sizing:border-box}
.mt-ctrl{display:flex;align-items:center;gap:.5em}
.mt-ctrl button{font:inherit;width:1.7em;height:1.7em;border-radius:50%;border:1.5px solid var(--mt-couleur);background:#fff;color:var(--mt-couleur);cursor:pointer;line-height:1;padding:0}
.mt-val{min-width:1.4em;text-align:center}
.mt-champ input{font:inherit;width:100%;box-sizing:border-box;padding:.45em .7em;border-radius:.7em;border:1.5px solid color-mix(in srgb,var(--mt-couleur) 40%,transparent);background:rgba(255,255,255,.9);color:#3a2a2a}
`;
    document.head.appendChild(s);
  }

  global.Moteur = Moteur;
  global.MoteurInfo = { W, H, POLICES, ANIMATIONS, SORTIES, NOMS_EFFETS, ACTIONS, TYPES_HTML, uid, variablesDe, dateLisible, remplacer, MOIS_MG, MOIS_FR };
})(window);
