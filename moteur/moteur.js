/* Moteur de lecture des invitations — Studio d'invitations
 * Un plan = un fond vidéo + des calques (texte, image, vidéo) dessinés sur un canvas,
 * + des calques interactifs (bouton, compteur, champ) posés en HTML par-dessus.
 * Positions en % de l'écran (x, y = centre du calque), tailles de texte en % de la hauteur, temps en secondes.
 */
(function (global) {
  'use strict';

  const W = 720, H = 1280;
  // Polices (Google Fonts) : [nom, catégorie, graisses]
  const CATALOGUE_POLICES = [
    ['Cormorant Garamond', 'Élégantes', 'ital,wght@0,400;0,600;0,700;1,400'], ['Playfair Display', 'Élégantes', 'ital,wght@0,400;0,700;1,400'], ['Cinzel', 'Élégantes', 'wght@400;600;700'], ['Cinzel Decorative', 'Élégantes', 'wght@400;700'],
    ['EB Garamond', 'Élégantes', 'ital,wght@0,400;0,600;1,400'], ['Libre Baskerville', 'Élégantes', 'ital,wght@0,400;0,700;1,400'], ['Lora', 'Élégantes', 'ital,wght@0,400;0,700;1,400'], ['Bodoni Moda', 'Élégantes', 'ital,wght@0,400;0,700;1,400'],
    ['DM Serif Display', 'Élégantes', 'ital@0;1'], ['Marcellus', 'Élégantes', ''], ['Prata', 'Élégantes', ''], ['Yeseva One', 'Élégantes', ''], ['Abril Fatface', 'Élégantes', ''], ['Merriweather', 'Élégantes', 'ital,wght@0,400;0,700;1,400'], ['Cormorant Upright', 'Élégantes', 'wght@400;600'],
    ['Great Vibes', 'Manuscrites', ''], ['Parisienne', 'Manuscrites', ''], ['Dancing Script', 'Manuscrites', 'wght@400;700'], ['Alex Brush', 'Manuscrites', ''], ['Allura', 'Manuscrites', ''], ['Pinyon Script', 'Manuscrites', ''],
    ['Sacramento', 'Manuscrites', ''], ['Tangerine', 'Manuscrites', 'wght@400;700'], ['Italianno', 'Manuscrites', ''], ['Satisfy', 'Manuscrites', ''], ['Rouge Script', 'Manuscrites', ''], ['Monsieur La Doulaise', 'Manuscrites', ''],
    ['Mrs Saint Delafield', 'Manuscrites', ''], ['Petit Formal Script', 'Manuscrites', ''], ['Herr Von Muellerhoff', 'Manuscrites', ''], ['Imperial Script', 'Manuscrites', ''], ['Lavishly Yours', 'Manuscrites', ''], ['Ballet', 'Manuscrites', ''],
    ['WindSong', 'Manuscrites', 'wght@400;500'], ['Mea Culpa', 'Manuscrites', ''], ['Corinthia', 'Manuscrites', 'wght@400;700'], ['Kaushan Script', 'Manuscrites', ''], ['Pacifico', 'Manuscrites', ''], ['Caveat', 'Manuscrites', 'wght@400;700'],
    ['Montserrat', 'Modernes', 'ital,wght@0,400;0,600;0,700;1,400'], ['Poppins', 'Modernes', 'ital,wght@0,400;0,600;0,700;1,400'], ['Raleway', 'Modernes', 'ital,wght@0,400;0,600;0,700;1,400'], ['Josefin Sans', 'Modernes', 'ital,wght@0,400;0,600;0,700;1,400'],
    ['Lato', 'Modernes', 'ital,wght@0,400;0,700;1,400'], ['Open Sans', 'Modernes', 'ital,wght@0,400;0,700;1,400'], ['Roboto', 'Modernes', 'ital,wght@0,400;0,700;1,400'], ['Nunito', 'Modernes', 'ital,wght@0,400;0,700;1,400'], ['Quicksand', 'Modernes', 'wght@400;600;700'],
    ['Oswald', 'Modernes', 'wght@400;600;700'], ['Bebas Neue', 'Modernes', ''], ['Tenor Sans', 'Modernes', ''], ['Questrial', 'Modernes', ''],
    ['Lobster', 'Fantaisie', ''], ['Comfortaa', 'Fantaisie', 'wght@400;700'], ['Amatic SC', 'Fantaisie', 'wght@400;700'], ['Fredoka', 'Fantaisie', 'wght@400;600;700'], ['Baloo 2', 'Fantaisie', 'wght@400;600;700'], ['Righteous', 'Fantaisie', ''],
    ['Bungee', 'Fantaisie', ''], ['Chewy', 'Fantaisie', ''], ['Luckiest Guy', 'Fantaisie', ''], ['Indie Flower', 'Fantaisie', ''], ['Shadows Into Light', 'Fantaisie', ''], ['Permanent Marker', 'Fantaisie', ''], ['Cookie', 'Fantaisie', ''], ['Yellowtail', 'Fantaisie', '']
  ];
  const POLICES = CATALOGUE_POLICES.map(x => x[0]);
  const POLICE_EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
  // Charge les polices demandées depuis Google Fonts (une seule fois chacune)
  const policesChargees = new Set();
  function chargerPolices(noms) {
    const nouveaux = [...new Set(noms || [])].filter(n => n && !policesChargees.has(n) && CATALOGUE_POLICES.some(x => x[0] === n));
    if (!nouveaux.length || typeof document === 'undefined') return Promise.resolve();
    nouveaux.forEach(n => policesChargees.add(n));
    const morceaux = [];
    for (let i = 0; i < nouveaux.length; i += 20) morceaux.push(nouveaux.slice(i, i + 20));
    return Promise.all(morceaux.map(m => new Promise(ok => {
      const l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?' + m.map(n => { const ax = (CATALOGUE_POLICES.find(x => x[0] === n) || [])[2]; return 'family=' + n.replace(/ /g, '+') + (ax ? ':' + ax : ''); }).join('&') + '&display=swap';
      l.onload = ok; l.onerror = ok; setTimeout(ok, 6000); document.head.appendChild(l);
    })));
  }
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
    if (langue === 'mg') return `${j} andro  ${p(h)} ora  ${p(m)} min  ${p(sec)} s`;
    if (langue === 'fr') return `${j} jours  ${p(h)} h  ${p(m)} min  ${p(sec)} s`;
    return `${j} ${({ de: 'Tage', it: 'giorni', es: 'días', pt: 'dias', ru: 'дн.', zh: '天', ja: '日', ar: 'يوم' })[langue] || 'days'}  ${p(h)} h  ${p(m)} min  ${p(sec)} s`;
  }
  const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MOIS_MG = ['Janoary', 'Febroary', 'Martsa', 'Aprily', 'Mey', 'Jona', 'Jolay', 'Aogositra', 'Septambra', 'Oktobra', 'Novambra', 'Desambra'];
  const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const JOURS_MG = ['Alahady', 'Alatsinainy', 'Talata', 'Alarobia', 'Alakamisy', 'Zoma', 'Sabotsy'];
  // Vidéo coupée (début / fin en secondes) : position dans le fichier pour un temps t de lecture
  // Fond d'un plan : vidéo (par défaut), photo, couleur unie / dégradé, ou aucun (transparent)
  function typeFond(f) { f = f || {}; if (f.type === 'couleur' || f.type === 'aucun') return f.type; if (!f.media) return 'defaut'; if (f.type === 'image' || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(f.media) || /^data:image/.test(f.media)) return 'image'; return 'video'; }
  function fondMedia(p) { const t = typeFond(p && p.fond); return (t === 'video' || t === 'image') ? p.fond.media : null; }
  function rgba(hex, a) { const h = String(hex).replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h.slice(0, 6), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
  function plage(conf) { const c = conf && conf.coupe; return c && Number(c.fin) > (Number(c.debut) || 0) ? [Number(c.debut) || 0, Number(c.fin)] : null; }
  function positionVideo(conf, t, duree) {
    let x = t * ((conf && conf.vitesse) || 1);
    const pl = plage(conf);
    const deb = pl ? pl[0] : 0, fin = pl ? Math.min(pl[1], duree || pl[1]) : (duree || 1), d = Math.max(0.05, fin - deb);
    x = conf && conf.boucle === false ? Math.min(x, d - 0.04) : x % d;
    return deb + x;
  }
  function dateLisible(iso, langue) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (langue === 'mg') return `${JOURS_MG[wd]} ${d} ${MOIS_MG[m - 1]} ${y}`;
    if (langue === 'fr' || !langue) return `${JOURS_FR[wd]} ${d} ${MOIS_FR[m - 1]} ${y}`;
    try { return new Intl.DateTimeFormat(langue, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))); }
    catch (e) { return `${JOURS_FR[wd]} ${d} ${MOIS_FR[m - 1]} ${y}`; }
  }
  function remplacer(texte, vars) {
    if (!texte) return '';
    return String(texte).replace(/\{(\w+)\}/g, (all, k) => (vars && vars[k] != null && vars[k] !== '') ? String(vars[k]) : (k === 'places' ? '' : all));
  }
  // Texte d'un calque dans la langue affichée (traduction si elle existe, sinon le texte d'origine)
  function texteDe(c, langue) { return (langue && c.trad && c.trad[langue]) || c.texte; }
  function variablesDe(projet, famille, form, langue) {
    const f = (projet && projet.fiche) || {};
    const lang = langue || f.langue || 'fr';
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
      this.onAction = opts.onAction || null;
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

    // Change la langue affichée (null = langue principale) ; tout se redessine tout de suite
    changerLangue(code) { this.langue = code && this.projet && this.projet.fiche && code !== this.projet.fiche.langue ? code : null; this._construireHTML(); }
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
        el = new Image(); el.decoding = 'async';
        if (location.protocol !== 'file:' && /^https?:/.test(new URL(u, location.href).href) && new URL(u, location.href).origin !== location.origin) el.crossOrigin = 'anonymous';
        el.src = u;
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
        if (p.fond && p.fond.media && p.fond.type !== 'couleur' && p.fond.type !== 'aucun') promesses.push(this.media(p.fond.media, p.fond.type === 'image' ? 'image' : 'video'));
        (p.calques || []).forEach(c => {
          if (c.police) polices.add(c.police);
          if ((c.type === 'image' || c.type === 'video') && c.media) promesses.push(this.media(c.media, c.type));
        });
      });
      const els = await Promise.all(promesses);
      // les photos doivent être vraiment chargées (sinon elles manquent dans le film)
      await Promise.all(els.filter(e => e && e.tagName === 'IMG' && !e.complete).map(e => new Promise(ok => { e.addEventListener('load', ok, { once: true }); e.addEventListener('error', ok, { once: true }); setTimeout(ok, 15000); })));
      await chargerPolices([...polices]);
      if (document.fonts && document.fonts.load) {
        await Promise.all([...polices].map(p => document.fonts.load(`40px "${p}"`).catch(() => null)));
      }
    }

    /* ----- Séquences ----- */
    // Film à télécharger : tous les plans dans l'ordre de l'invitation, confirmation comprise
    plansFilmComplet() { return this.plansInvitation(); }
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
    // Aller au plan de remerciement (après « Je confirme » / « Je ne pourrai pas venir »)
    allerRemerciement() {
      const pl = this.projet.plans;
      let i = this.seq.findIndex(k => pl[k].role === 'remerciement');
      if (i < 0) { const m = pl.findIndex(p => p.role === 'remerciement'); if (m < 0) return; this.seq = this.seq.concat(m); i = this.seq.length - 1; }
      this.planFixe = null; this.allerA(i);
    }
    passerFilm() {
      const pl = this.projet.plans;
      const i = this.seq.findIndex(k => pl[k].role === 'confirmation' || pl[k].role === 'remerciement');
      if (i >= 0) this.allerA(i);
    }

    _entrerPlan() {
      const p = this.planCourant();
      if (!p) return;
      const avant = this.projet.plans[this.seq[this.pos - 1]];
      const memeFond = avant && fondMedia(avant) && fondMedia(p) && avant.fond.media === p.fond.media;
      this._lancerVideos(p, !memeFond);
      this._construireHTML();
    }

    _lancerVideos(p, reset) {
      const els = [];
      if (fondMedia(p)) els.push([this.medias[p.fond.media], p.fond]);
      (p.calques || []).forEach(c => { if (c.type === 'video' && c.media) els.push([this.medias[c.media], c]); });
      els.forEach(([v, conf]) => {
        if (!v || v.tagName !== 'VIDEO') return;
        const pl = plage(conf);
        v.loop = conf.boucle !== false && !pl;      // vidéo coupée : la boucle est gérée par le moteur (retour au début de la coupe)
        v._plage = pl; v._boucle = conf.boucle !== false;
        v.playbackRate = conf.vitesse || 1;
        if (reset) { try { v.currentTime = pl ? pl[0] : 0; } catch (e) {} }
        if (this.lecture) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
      });
    }

    _caler(p, t) {   // édition : mettre les vidéos à l'instant t (pause)
      const caler = (v, conf) => {
        if (!v || v.tagName !== 'VIDEO') return;
        v.pause();
        const go = () => { try { v.currentTime = positionVideo(conf, t, v.duration || 1); } catch (e) {} };
        if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true });
      };
      if (fondMedia(p)) caler(this.medias[p.fond.media], p.fond);
      (p.calques || []).forEach(c => { if (c.type === 'video' && c.media) caler(this.medias[c.media], c); });
    }

    _boucle(now) {
      const dt = Math.min(0.1, (now - this._dernier) / 1000);
      this._dernier = now;
      if (this.projet) {
        const p = this.planCourant();
        if (p && this.lecture) {
          this.t += dt;
          // vidéos coupées : on revient au début de la coupe (ou on s'arrête) à la fin de la coupe
          Object.values(this.medias).forEach(v => { if (v && v._plage && !v.paused && v.currentTime >= v._plage[1] - 0.03) { if (v._boucle) { try { v.currentTime = v._plage[0]; } catch (e) {} } else v.pause(); } });
          const duree = Number(p.duree) || (this.enFilm ? (p.role === 'confirmation' ? 7 : 4) : 0);
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
      ctx.clearRect(0, 0, W, H);
      if (!p) { ctx.fillStyle = '#f4ede2'; ctx.fillRect(0, 0, W, H); ctx.restore(); return; }
      const tr = p.transition || {};
      const dTr = Number(tr.duree) || (tr.type && tr.type !== 'aucune' ? 0.8 : 0);
      const avant = this.projet.plans[this.seq[this.pos - 1]];
      if (avant && dTr > 0 && this.t < dTr && tr.type && tr.type !== 'aucune' && this.planFixe == null) {
        const q = ease(this.t / dTr);
        // le plan qui part reste figé sur son dernier instant (ses textes ne disparaissent pas d'un coup)
        const tAvant = Math.max(0, (Number(avant.duree) || 0) - 0.02);
        const dessinerAvant = (al) => this._dessinerPlan(avant, tAvant, al == null ? 1 : al, false);
        const dessinerNouveau = (al) => this._dessinerPlan(p, this.t, al == null ? 1 : al, true);
        const T = tr.type;
        if (T === 'fondu-blanc' || T === 'fondu-noir') {
          dessinerAvant();
          ctx.globalAlpha = q < 0.5 ? q * 2 : (1 - q) * 2;
          ctx.fillStyle = T === 'fondu-blanc' ? '#fff' : '#000';
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
          if (q >= 0.5) dessinerNouveau((q - 0.5) * 2);
        } else if (T === 'glissement' || T === 'glissement-haut') {
          ctx.save(); if (T === 'glissement') ctx.translate(-W * q, 0); else ctx.translate(0, -H * q); dessinerAvant(); ctx.restore();
          ctx.save(); if (T === 'glissement') ctx.translate(W * (1 - q), 0); else ctx.translate(0, H * (1 - q)); dessinerNouveau(); ctx.restore();
        } else if (T === 'zoom') {
          ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(1 + 0.25 * q, 1 + 0.25 * q); ctx.translate(-W / 2, -H / 2); dessinerAvant(1); ctx.restore();
          ctx.save(); ctx.translate(W / 2, H / 2); const z = 0.85 + 0.15 * q; ctx.scale(z, z); ctx.translate(-W / 2, -H / 2); dessinerNouveau(q); ctx.restore();
        } else if (T === 'flou') {
          ctx.save(); ctx.filter = `blur(${(q * 18).toFixed(1)}px)`; dessinerAvant(); ctx.restore();
          ctx.save(); ctx.filter = `blur(${((1 - q) * 18).toFixed(1)}px)`; dessinerNouveau(q); ctx.restore(); ctx.filter = 'none';
        } else if (T === 'volet') {
          dessinerAvant();
          ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W * q, H); ctx.clip(); dessinerNouveau(); ctx.restore();
        } else if (T === 'cercle') {
          dessinerAvant();
          ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * q, 0, Math.PI * 2); ctx.clip(); dessinerNouveau(); ctx.restore();
        } else if (T === 'rideau') {
          dessinerAvant();
          ctx.save(); ctx.beginPath(); ctx.rect(W / 2 * (1 - q), 0, W * q, H); ctx.clip(); dessinerNouveau(); ctx.restore();
        } else {
          dessinerAvant(); dessinerNouveau(q);
        }
      } else {
        this._dessinerPlan(p, this.t, 1, true);
      }
      ctx.restore();
    }

    _dessinerImage(el, x, y, w, h, cover, rec) {
      const ctx = this.ctx;
      let src = el;
      const iw0 = el.videoWidth || el.naturalWidth, ih0 = el.videoHeight || el.naturalHeight;
      const pret = iw0 && ih0 && !(el.tagName === 'VIDEO' && el.readyState < 2) && !(el.tagName === 'IMG' && !el.complete);
      if (!pret) {
        // vidéo pas encore prête (chargement, saut, boucle) : on garde sa dernière image au lieu d'un trou
        if (!el._cache) return false;
        src = el._cache;
      } else if (el.tagName === 'VIDEO') {
        el._nCache = (el._nCache || 0) + 1;
        if (!el._cache || el._nCache % 6 === 0) {
          try {
            const k = Math.min(1, 720 / Math.max(iw0, ih0));
            if (!el._cache) { el._cache = document.createElement('canvas'); }
            if (el._cache.width !== Math.round(iw0 * k)) { el._cache.width = Math.round(iw0 * k); el._cache.height = Math.round(ih0 * k); }
            el._cache.getContext('2d').drawImage(el, 0, 0, el._cache.width, el._cache.height);
          } catch (e) {}
        }
      }
      const iw = src === el ? iw0 : src.width, ih = src === el ? ih0 : src.height;
      // recadrage (rogner) : partie de l'image gardée, en fractions de la largeur et de la hauteur
      let sx = 0, sy = 0, sw = iw, sh = ih;
      if (rec && Number(rec.w) > 0 && Number(rec.h) > 0) {
        sx = clamp(Number(rec.x) || 0, 0, 0.99) * iw; sy = clamp(Number(rec.y) || 0, 0, 0.99) * ih;
        sw = Math.max(1, Math.min(iw - sx, Number(rec.w) * iw)); sh = Math.max(1, Math.min(ih - sy, Number(rec.h) * ih));
      }
      const r = cover ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
      if (cover) {
        // remplir le cadre : on prend le centre de la partie gardée
        const cw = w / r, ch = h / r;
        ctx.drawImage(src, sx + (sw - cw) / 2, sy + (sh - ch) / 2, cw, ch, x, y, w, h);
      } else {
        const dw = sw * r, dh = sh * r;
        ctx.drawImage(src, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      }
      return true;
    }

    _dessinerPlan(p, t, alpha, mesurer) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = alpha;
      const f = p.fond || {};
      const typeF = typeFond(f);
      const v = typeF === 'video' || typeF === 'image' ? this.medias[f.media] : null;
      if (typeF === 'aucun') {
        // sans fond : transparent (aperçu en damier, vidéo WebM transparente) ; dans un MP4 on met une couleur unie
        if (this.fondOpaque) { ctx.fillStyle = this.fondOpaque; ctx.fillRect(0, 0, W, H); }
      } else if (typeF === 'couleur') {
        const c1 = f.couleur || '#f4ede2';
        if (f.couleur2) {
          const a = (Number(f.angle) || 180) * Math.PI / 180, dx = Math.sin(a) * H / 2, dy = -Math.cos(a) * H / 2;
          const g = f.degrade === 'radial' ? ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2) : ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
          g.addColorStop(0, c1); g.addColorStop(1, f.couleur2); ctx.fillStyle = g;
        } else ctx.fillStyle = c1;
        ctx.fillRect(0, 0, W, H);
      } else if (v) {
        ctx.fillStyle = '#f4ede2'; ctx.fillRect(0, 0, W, H);
        if (f.flou) ctx.filter = `blur(${f.flou}px)`;
        this._dessinerImage(v, 0, 0, W, H, true, f.recadrage);
        ctx.filter = 'none';
      } else { ctx.fillStyle = '#f4ede2'; ctx.fillRect(0, 0, W, H); }
      if (f.assombrir) { ctx.fillStyle = `rgba(0,0,0,${clamp(f.assombrir, 0, 0.9)})`; ctx.fillRect(0, 0, W, H); }
      if (f.eclaircir) { ctx.fillStyle = `rgba(255,255,255,${clamp(f.eclaircir, 0, 0.9)})`; ctx.fillRect(0, 0, W, H); }
      const vars = variablesDe(this.projet, this.famille, this.form, this.langue);
      (p.calques || []).forEach(c => {
        if (c.masque || (c.condition === 'famille' && !this.famille) || (c.condition === 'general' && this.famille)) { if (mesurer) delete this.bbox[c.id]; return; }
        if (c._edition && c.type === 'texte' && this.mode === 'edition' && !this.boutonsDessines) return;   // en cours d'écriture dans l'éditeur : garder le cadre, ne pas dessiner
        if (TYPES_HTML.includes(c.type)) { if (mesurer) this._bboxHTML(c); if (this.boutonsDessines) this._dessinerBouton(c, t, p, vars, alpha); return; }
        this._dessinerCalque(c, t, p, vars, alpha, mesurer);
      });
      ctx.restore();
    }

    // Film : les boutons (HTML dans l'invitation) sont dessinés comme des images, sauf ceux de navigation
    _dessinerBouton(c, t, p, vars, alphaPlan) {
      if (c.type === 'compteur') return this._dessinerCompteur(c, t, vars, alphaPlan);
      if (c.type === 'champ') return this._dessinerChamp(c, t, vars, alphaPlan);
      if (c.type !== 'bouton') return;
      const deb = Number(c.debut) || 0; if (t < deb) return;
      const ctx = this.ctx, fs = (Number(c.taille) || 2.4) / 100 * H, larg = (Number(c.largeur) || 60) / 100 * W, haut = fs * 2.3;
      const x = (Number(c.x) || 50) / 100 * W - larg / 2, y = (Number(c.y) || 50) / 100 * H - haut / 2;
      const coul = c.couleur || '#7a1f2b', style = c.style || 'plein';
      ctx.save(); ctx.globalAlpha = alphaPlan * clamp((t - deb) / 0.6, 0, 1);
      if (style !== 'lien') { arrondi(ctx, x, y, larg, haut, haut / 2); ctx.fillStyle = style === 'plein' ? coul : 'rgba(255,255,255,.85)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = coul; ctx.stroke(); }
      ctx.fillStyle = style === 'plein' ? '#fff' : coul; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${fs.toFixed(1)}px "${c.police || 'Cormorant Garamond'}", Georgia, serif, ${POLICE_EMOJI}`;
      ctx.fillText(remplacer(texteDe(c, this.langue), vars), x + larg / 2, y + haut / 2, larg - fs);
      ctx.restore();
    }

    _dessinerChamp(c, t, vars, alphaPlan) {
      const deb = Number(c.debut) || 0; if (t < deb) return;
      const ctx = this.ctx, fs = (Number(c.taille) || 2.3) / 100 * H, larg = (Number(c.largeur) || 66) / 100 * W, haut = fs * 2.3;
      const x = (Number(c.x) || 50) / 100 * W - larg / 2, y = (Number(c.y) || 50) / 100 * H - haut / 2, coul = c.couleur || '#7a1f2b';
      ctx.save(); ctx.globalAlpha = alphaPlan * clamp((t - deb) / 0.6, 0, 1);
      arrondi(ctx, x, y, larg, haut, fs * 0.7); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = coul; ctx.globalAlpha *= 0.8; ctx.stroke();
      ctx.fillStyle = '#8a7a7a'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = `400 ${fs.toFixed(1)}px "Cormorant Garamond", Georgia, serif`;
      ctx.fillText(remplacer(texteDe(c, this.langue), vars) || 'Écrire ici', x + fs * 0.7, y + haut / 2, larg - fs * 1.4);
      ctx.restore();
    }

    _dessinerCompteur(c, t, vars, alphaPlan) {
      const deb = Number(c.debut) || 0; if (t < deb) return;
      const ctx = this.ctx, fs = (Number(c.taille) || 2.3) / 100 * H, larg = (Number(c.largeur) || 66) / 100 * W, haut = fs * 2.4;
      const x = (Number(c.x) || 50) / 100 * W - larg / 2, y = (Number(c.y) || 50) / 100 * H - haut / 2, coul = c.couleur || '#7a1f2b';
      ctx.save(); ctx.globalAlpha = alphaPlan * clamp((t - deb) / 0.6, 0, 1);
      arrondi(ctx, x, y, larg, haut, fs * 0.9); ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = coul; ctx.globalAlpha *= 0.9; ctx.stroke();
      ctx.fillStyle = coul; ctx.textBaseline = 'middle'; ctx.font = `600 ${fs.toFixed(1)}px "Cormorant Garamond", Georgia, serif`;
      ctx.textAlign = 'left'; ctx.fillText(remplacer(texteDe(c, this.langue), vars), x + fs * 0.7, y + haut / 2, larg * 0.55);
      const r = fs * 0.75, cxP = x + larg - fs * 1.2, cxM = cxP - fs * 3.2, cy = y + haut / 2;
      [[cxM, '−'], [cxP, '+']].forEach(([cx, sgn]) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); ctx.fillStyle = coul; ctx.textAlign = 'center'; ctx.fillText(sgn, cx, cy); });
      ctx.textAlign = 'center'; ctx.fillText(String(c.defaut != null ? c.defaut : (c.champ === 'enfants' ? 0 : 1)), (cxM + cxP) / 2, cy);
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
      const nbMots = String(texteDe(c, this.langue) || '').split(/\s+/).length;
      const dE = Number(c.duree_animation) || (entree === 'ecriture' ? clamp(String(texteDe(c, this.langue) || '').length * 0.05, 0.8, 2.5) : entree === 'mot-par-mot' ? clamp(nbMots * 0.22, 0.8, 3) : 0.9);
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
      if (c.fusion && c.fusion !== 'normal') ctx.globalCompositeOperation = c.fusion;   // superposition (mode de fusion)
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
        ctx.font = `${c.italique ? 'italic ' : ''}${c.gras ? '700 ' : '400 '}${taille}px "${police}", serif, ${POLICE_EMOJI}`;
        ctx.textBaseline = 'middle';
        const align = c.align || 'center';
        ctx.textAlign = align;
        let txt = remplacer(texteDe(c, this.langue), vars);
        if (c.majuscules) txt = txt.toUpperCase();
        const ls = lignes(ctx, txt, larg);
        const inter = taille * (Number(c.interligne) || 1.25);
        const hTot = inter * ls.length;
        let total = txt.length, montrer = total;
        const motsTxt = txt.split(/(\s+)/);
        if (e.entree === 'ecriture') montrer = Math.floor(e.brutE * total);
        if (e.entree === 'mot-par-mot') { const nm = Math.ceil(e.brutE * txt.split(/\s+/).length); let k = 0, n = 0; for (const m of motsTxt) { if (!/^\s+$/.test(m)) { n++; if (n > nm) break; } k += m.length; } montrer = k; }
        const ax = align === 'left' ? -larg / 2 : align === 'right' ? larg / 2 : 0;
        if (c.fond_couleur) {   // arrière-plan du texte (bandeau / cartouche)
          ctx.save(); ctx.globalAlpha *= (c.fond_opacite != null && c.fond_opacite !== '' ? Number(c.fond_opacite) : 0.6);
          ctx.fillStyle = c.fond_couleur;
          const mg = taille * (c.fond_marge != null && c.fond_marge !== '' ? Number(c.fond_marge) : 0.4);
          const ar = c.fond_arrondi != null && c.fond_arrondi !== '' ? Number(c.fond_arrondi) : 0.4;
          const fh = hTot + mg * 1.5;
          arrondi(ctx, -larg / 2 - mg, -fh / 2, larg + mg * 2, fh, Math.min(fh / 2, taille * ar));
          ctx.fill(); ctx.restore();
        }
        if (c.ombre) {   // halo (sans décalage) ou ombre portée (avec décalage)
          const op = c.ombre_opacite != null && c.ombre_opacite !== '' ? Number(c.ombre_opacite) : 0.85;
          ctx.shadowColor = /^#/.test(c.ombre_couleur || '') ? rgba(c.ombre_couleur, op) : (c.ombre_couleur || 'rgba(255,255,255,0.85)');
          ctx.shadowBlur = taille * 0.25 * (c.ombre_force != null && c.ombre_force !== '' ? Number(c.ombre_force) : 1);
          const dec = Number(c.ombre_decalage) || 0;
          if (dec) { ctx.shadowOffsetX = dec * taille * 0.06 * Math.max(0.01, sc); ctx.shadowOffsetY = dec * taille * 0.06 * Math.max(0.01, sc); }
        }
        let compte = 0;
        ls.forEach((l, i) => {
          const y = -hTot / 2 + inter * (i + 0.5);
          let morceau = l;
          if (e.entree === 'ecriture' || e.entree === 'mot-par-mot') { const reste = montrer - compte; morceau = reste <= 0 ? '' : l.slice(0, reste); compte += l.length + 1; }
          if (c.contour) { ctx.lineWidth = Number(c.contour_epaisseur) || taille * 0.06; ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.strokeStyle = c.contour; ctx.strokeText(morceau, ax, y); }
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
            this._dessinerImage(el, -larg / 2, -haut / 2, larg, haut, true, c.recadrage);
            ctx.restore();
          } else this._dessinerImage(el, -larg / 2, -haut / 2, larg, haut, c.remplir === true, c.recadrage);
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
      const vars = variablesDe(this.projet, this.famille, this.form, this.langue);
      const lang = this.langue || (this.projet.fiche && this.projet.fiche.langue) || 'fr';
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
          b.textContent = remplacer(texteDe(c, this.langue), vars);
          b.addEventListener('click', ev => { ev.stopPropagation(); if (this.mode === 'edition') return; this._action(c); });
          el.appendChild(b);
        } else if (c.type === 'compteur') {
          const champ = c.champ || 'adultes';
          if (this.form[champ] == null) this.form[champ] = Number(c.defaut) || 0;
          el.innerHTML = `<span class="mt-lib"></span><span class="mt-ctrl"><button type="button" class="mt-moins" aria-label="moins">−</button><b class="mt-val"></b><button type="button" class="mt-plus" aria-label="plus">+</button></span>`;
          el.querySelector('.mt-lib').textContent = remplacer(texteDe(c, this.langue), vars);
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
          // − / + : marchent partout (aussi dans l'aperçu du studio) ; au maximum, on montre pourquoi
          const signaler = () => { el.classList.remove('mt-max'); void el.offsetWidth; el.classList.add('mt-max'); const places = this.famille && Number(this.famille.places);
            if (places) { const lib = el.querySelector('.mt-lib'); const ancien = lib.textContent; lib.textContent = (lang === 'mg' ? `Toerana ${places} ihany` : lang === 'fr' ? `${places} place(s) en tout` : `${places} seat(s) in total`); clearTimeout(el._t); el._t = setTimeout(() => { lib.textContent = ancien; }, 1600); } };
          ['pointerdown', 'mousedown'].forEach(n => el.addEventListener(n, ev => ev.stopPropagation()));
          el.querySelector('.mt-moins').addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); this.form[champ] = Math.max(min, (Number(this.form[champ]) || 0) - 1); maj(); });
          el.querySelector('.mt-plus').addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); const v = (Number(this.form[champ]) || 0); if (v >= maxDe()) return signaler(); this.form[champ] = v + 1; maj(); });
        } else if (c.type === 'champ') {
          const champ = c.champ || 'quartier';
          el.innerHTML = `<input type="text" class="mt-input">`;
          const inp = el.querySelector('input');
          inp.placeholder = remplacer(texteDe(c, this.langue), vars) || (lang === 'mg' ? 'Soraty eto' : lang === 'fr' ? 'Écrire ici' : 'Write here');
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
      if (this.onAction) return this.onAction(a, c, Object.assign({}, this.form), this);
      // sans gestionnaire (aperçu du studio) : on montre quand même la suite
      if (a === 'confirmer' || a === 'refuser') this.allerRemerciement();
    }

    /* ----- Mesure réelle d'un texte (pour éviter les chevauchements) ----- */
    hauteurTexte(c) {
      const ctx = this.ctx;
      const taille = (Number(c.taille) || 4) / 100 * H;
      ctx.save();
      ctx.font = `${c.italique ? 'italic ' : ''}${c.gras ? '700 ' : '400 '}${taille}px "${c.police || 'Cormorant Garamond'}", serif`;
      let txt = remplacer(texteDe(c, this.langue), variablesDe(this.projet, this.famille || { nom: 'Fianakaviana Rakotomalala', places: 4 }, this.form, this.langue));
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
    /* ----- Film image par image (WebCodecs) : MP4 H.264 + AAC complet, lisible partout ----- */
    // Rendu hors temps réel : chaque image est calculée puis encodée ; rien ne saute, même si l'onglet n'est pas au premier plan.
    async exporterFilmImages(opts) {
      opts = opts || {};
      const seq = opts.seq || this.plansFilmComplet();
      if (!seq.length) throw new Error('Aucun plan à filmer');
      if (!window.Mp4Muxer) await new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.min.js'; sc.onload = ok; sc.onerror = () => ko(new Error('Outil MP4 indisponible (connexion ?)')); document.head.appendChild(sc); });
      const FPS = 30, pl = this.projet.plans;
      const durees = seq.map(i => Number(pl[i].duree) || (pl[i].role === 'confirmation' ? 7 : 4));
      const total = durees.reduce((a, b) => a + b, 0), N = Math.round(total * FPS);
      // vidéo
      let vcodec = null;
      for (const c of ['avc1.640028', 'avc1.4d0028', 'avc1.42E028']) { try { if ((await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: 4e6, framerate: FPS })).supported) { vcodec = c; break; } } catch (e) {} }
      if (!vcodec) throw new Error('H.264 non disponible');
      // audio : la chanson, à partir du début choisi, en boucle si besoin, fondu à la fin
      let audio = null, SR = 48000;
      if (opts.musique) {
        try {
          const ctxA = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
          const buf = await ctxA.decodeAudioData(await (await fetch(opts.musique)).arrayBuffer()); ctxA.close();
          const n = Math.round(total * SR), deb = Math.round((opts.debut || 0) * SR), vol = opts.volume != null ? opts.volume : 0.9, fondu = Math.min(n, 2.5 * SR);
          const canaux = [0, 1].map(k => { const src = buf.getChannelData(Math.min(k, buf.numberOfChannels - 1)), o = new Float32Array(n); for (let i = 0; i < n; i++) { const j = (deb + i) % src.length; o[i] = src[j] * vol * (i > n - fondu ? (n - i) / fondu : 1); } return o; });
          for (const c of ['mp4a.40.2', 'opus']) { if ((await AudioEncoder.isConfigSupported({ codec: c, sampleRate: SR, numberOfChannels: 2, bitrate: 192000 })).supported) { audio = { codec: c, canaux, n }; break; } }
        } catch (e) { console.warn('audio du film', e); }
      }
      const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
        video: { codec: 'avc', width: W, height: H, frameRate: FPS }, audio: audio ? { codec: audio.codec === 'opus' ? 'opus' : 'aac', numberOfChannels: 2, sampleRate: SR } : undefined });
      let erreur = null;
      const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => { erreur = e; } });
      venc.configure({ codec: vcodec, width: W, height: H, bitrate: 4e6, framerate: FPS });
      // préparer le moteur : lecture arrêtée, boutons dessinés, pas de HTML
      const avantEtat = { lecture: this.lecture, seq: this.seq, pos: this.pos, t: this.t, planFixe: this.planFixe };
      this.lecture = false; this.masquerHTML = true; this.boutonsDessines = true; this._construireHTML();
      this.seq = seq; this.planFixe = null;
      Object.values(this.medias).forEach(m => { if (m && m.pause) m.pause(); });
      // temps de chaque vidéo : elle continue si le plan suivant garde le même fond, sinon elle repart à 0
      const departMedia = {};
      // place une vidéo à l'instant voulu et attend qu'une image soit vraiment prête (sinon le fond disparaîtrait de l'image)
      const attendre = (v, evs, ms) => new Promise(r => { let fait = false; const fin = () => { if (fait) return; fait = true; evs.forEach(e => v.removeEventListener(e, fin)); r(); }; evs.forEach(e => v.addEventListener(e, fin)); setTimeout(fin, ms); });
      const caler = async (src, conf, tm) => {
        const v = this.medias[src]; if (!v || v.tagName !== 'VIDEO') return;
        if (v.preload !== 'auto') { v.preload = 'auto'; }
        if (v.readyState < 1) { try { v.load(); } catch (e) {} await attendre(v, ['loadedmetadata'], 15000); }
        const x = positionVideo(conf, tm, v.duration || 1);
        if (!(Math.abs(v.currentTime - x) < 0.004 && v.readyState >= 2)) {
          const p = attendre(v, ['seeked'], 8000); try { v.currentTime = x; } catch (e) {} await p;
        }
        for (let essai = 0; v.readyState < 2 && essai < 40; essai++) await attendre(v, ['loadeddata', 'canplay', 'seeked'], 250);
      };
      const mediasDe = p => { const l = []; if (fondMedia(p)) l.push([p.fond.media, p.fond]); (p.calques || []).forEach(c => { if (c.type === 'video' && c.media) l.push([c.media, c]); }); return l; };
      const remplaces = {};
      this.fondOpaque = '#f4ede2';   // un MP4 ne peut pas être transparent
      try {
        if (opts.progres) opts.progres(0);
        // vidéos en ligne (bibliothèque d'équipe…) : téléchargées d'abord, pour que chaque image du film ait bien son fond
        const enLigne = [...new Set(seq.flatMap(i => mediasDe(pl[i]).map(x => x[0])))].filter(src => { const v = this.medias[src]; return v && v.tagName === 'VIDEO' && /^https?:/.test(v.currentSrc || v.src || '') && new URL(v.currentSrc || v.src).origin !== location.origin; });
        for (let k = 0; k < enLigne.length; k++) {
          const src = enLigne[k], v = this.medias[src];
          try {
            if (opts.etape) opts.etape('Préparation des vidéos ' + (k + 1) + '/' + enLigne.length + '…');
            const b = await (await fetch(v.currentSrc || v.src)).blob();
            const nv = document.createElement('video'); nv.muted = true; nv.playsInline = true; nv.preload = 'auto'; nv.src = URL.createObjectURL(b);
            remplaces[src] = v; this.medias[src] = nv;
          } catch (e) { console.warn('vidéo en ligne non téléchargée', src, e); }
        }
        for (const i of seq) for (const [src] of mediasDe(pl[i])) { const v = this.medias[src]; if (v && v.tagName === 'VIDEO' && v.readyState < 2) { v.preload = 'auto'; try { v.load(); } catch (e) {} await attendre(v, ['loadeddata', 'error'], 20000); } }
        let pos = 0, debPlan = 0;
        const entrer = k => { const p = pl[seq[k]], av = k > 0 ? pl[seq[k - 1]] : null; mediasDe(p).forEach(([src]) => { const garde = av && fondMedia(av) && fondMedia(p) === fondMedia(av) && src === fondMedia(p) && departMedia[src] != null; if (!garde) departMedia[src] = debPlan; }); };
        entrer(0);
        for (let f = 0; f < N; f++) {
          if (erreur) throw erreur;
          const T = f / FPS;
          while (pos < seq.length - 1 && T >= debPlan + durees[pos]) { debPlan += durees[pos]; pos++; entrer(pos); }
          this.pos = pos; this.t = T - debPlan;
          const p = pl[seq[pos]];
          for (const [src, conf] of mediasDe(p)) await caler(src, conf, T - departMedia[src]);
          const av = pos > 0 ? pl[seq[pos - 1]] : null, dTr = Number((p.transition || {}).duree) || 0.8;
          if (av && this.t < dTr) for (const [src, conf] of mediasDe(av)) if (!mediasDe(p).some(x => x[0] === src)) await caler(src, conf, T - (departMedia[src] || 0));
          this.dessiner();
          const fr = new VideoFrame(this.canvas, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
          venc.encode(fr, { keyFrame: f % (FPS * 2) === 0 }); fr.close();
          if (venc.encodeQueueSize > 8) await new Promise(r => venc.addEventListener('dequeue', r, { once: true }));
          if (opts.progres && f % 5 === 0) opts.progres(f / N * (audio ? 0.92 : 1));
        }
        await venc.flush();
        if (audio) {
          const aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: e => { erreur = e; } });
          aenc.configure({ codec: audio.codec, sampleRate: SR, numberOfChannels: 2, bitrate: 192000 });
          const bloc = 4800;
          for (let i = 0; i < audio.n; i += bloc) {
            const m = Math.min(bloc, audio.n - i), data = new Float32Array(m * 2);
            data.set(audio.canaux[0].subarray(i, i + m), 0); data.set(audio.canaux[1].subarray(i, i + m), m);
            const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round(i / SR * 1e6), data });
            aenc.encode(ad); ad.close();
            if (aenc.encodeQueueSize > 20) await new Promise(r => setTimeout(r, 5));
          }
          await aenc.flush(); aenc.close();
          if (erreur) throw erreur;
        }
        venc.close();
        muxer.finalize();
        if (opts.progres) opts.progres(1);
        return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), extension: 'mp4', duree: total };
      } finally {
        this.boutonsDessines = false; this.masquerHTML = false; this.fondOpaque = null;
        Object.entries(remplaces).forEach(([src, v]) => { const nv = this.medias[src]; try { nv.pause(); URL.revokeObjectURL(nv.src); } catch (e) {} this.medias[src] = v; });
        Object.assign(this, avantEtat);
        this._construireHTML();
      }
    }

    async exporterFilm(opts) {
      opts = opts || {};
      if (window.VideoEncoder && window.AudioEncoder && window.VideoFrame && opts.tempsReel !== true && !opts.transparent) {
        try { return await this.exporterFilmImages(opts); }
        catch (e) { console.warn('Film image par image impossible, enregistrement en temps réel', e); }
      }
      const seq = opts.seq || (opts.transparent ? this.plansFilmComplet() : this.plansFilm());
      if (!seq.length) throw new Error('Aucun plan à filmer');
      if (location.protocol === 'file:') throw new Error('L\'enregistrement du film fonctionne quand le studio est ouvert depuis son adresse en ligne (GitHub Pages), pas depuis un dossier de l\'ordinateur.');
      const total = seq.reduce((s, i) => s + (Number(this.projet.plans[i].duree) || (this.projet.plans[i].role === 'confirmation' ? 7 : 4)), 0);
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
      const types = opts.transparent ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm'] : ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3.5e6 });
      const morceaux = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) morceaux.push(e.data); };
      const fini = new Promise(res => { rec.onstop = res; });
      this.enFilm = true; this.masquerHTML = true; this.boutonsDessines = true; this.fondOpaque = opts.transparent ? null : (/mp4/.test(mime) ? '#f4ede2' : null);
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
      this.enFilm = false; this.masquerHTML = false; this.boutonsDessines = false; this.fondOpaque = null;
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
.mt-compteur.mt-max{animation:mtSecoue .35s ease}
@keyframes mtSecoue{25%{transform:translateY(-50%) translateX(-5px)}75%{transform:translateY(-50%) translateX(5px)}}
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
  // Langues proposées pour les invitations
  const LANGUES = { mg: 'Malagasy', fr: 'Français', en: 'English', de: 'Deutsch', it: 'Italiano', es: 'Español', pt: 'Português', zh: '中文', ar: 'العربية', ru: 'Русский', ja: '日本語' };
  const FUSIONS = [['normal', 'Normale'], ['multiply', 'Produit (assombrit, garde les ombres)'], ['screen', 'Écran (éclaircit, garde les lumières)'], ['overlay', 'Superposition'], ['soft-light', 'Lumière douce'], ['hard-light', 'Lumière crue'], ['color-dodge', 'Densité couleur −'], ['color-burn', 'Densité couleur +'], ['darken', 'Obscurcir'], ['lighten', 'Éclaircir'], ['difference', 'Différence'], ['luminosity', 'Luminosité'], ['color', 'Couleur']];
  global.MoteurInfo = { CATALOGUE_POLICES, chargerPolices, typeFond, fondMedia, FUSIONS, plage, positionVideo, LANGUES, texteDe, W, H, POLICES, ANIMATIONS, SORTIES, NOMS_EFFETS, ACTIONS, TYPES_HTML, uid, variablesDe, dateLisible, remplacer, MOIS_MG, MOIS_FR };
})(window);
