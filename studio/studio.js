/* Studio d'invitations — application de montage (sans serveur).
 * Données : localStorage (projets, réglages) + IndexedDB (fichiers importés). Publication : GitHub (facultatif). */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = Fabrique.uid;
  const I = MoteurInfo;
  const BASE = '../';

  /* ================= Stockage ================= */
  let surEcriture = null;   // sauvegarde de tout (accessoires), branchée plus bas
  // ce que le navigateur avait vraiment au démarrage (pour savoir quoi reprendre de la copie de secours)
  const clesDemarrage = new Set(); try { for (let i = 0; i < localStorage.length; i++) clesDemarrage.add(localStorage.key(i)); } catch (e) {}
  const Stock = {
    lire(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    ecrire(k, v) { let ok = true; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { ok = false; toast('Mémoire du navigateur pleine : exportez vos projets.'); } if (surEcriture) surEcriture(k); return ok; }
  };
  let projets = Stock.lire('studio.projets', {});
  let medias = Stock.lire('studio.medias', []);
  let reglages = Stock.lire('studio.reglages', { github: { owner: '', repo: '', branche: 'main', token: '' }, firebase: null });
  let tSauve = 0;
  const sauverProjets = () => { const ok = Stock.ecrire('studio.projets', projets); Sauve.copie(); return ok; };
  const sauverMedias = () => Stock.ecrire('studio.medias', medias);
  const sauverReglages = () => Stock.ecrire('studio.reglages', reglages);
  // Un autre onglet a changé les réglages (ex. nouveau jeton GitHub) : on les reprend ici aussi
  window.addEventListener('storage', ev => { if (ev.key === 'studio.reglages') { try { reglages = Stock.lire('studio.reglages', reglages); } catch (e) {} } });

  const IDB = {
    _db: null,
    ouvrir() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((ok, ko) => { const r = indexedDB.open('studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('fichiers'); r.onsuccess = () => { this._db = r.result; ok(r.result); }; r.onerror = () => ko(r.error); });
    },
    async mettre(cle, blob) { const db = await this.ouvrir(); return new Promise((ok, ko) => { let t; try { t = db.transaction('fichiers', 'readwrite', { durability: 'strict' }); } catch (e) { t = db.transaction('fichiers', 'readwrite'); } t.objectStore('fichiers').put(blob, cle); t.oncomplete = ok; t.onerror = () => ko(t.error); }); },
    async lire(cle) { const db = await this.ouvrir(); return new Promise((ok, ko) => { const r = db.transaction('fichiers').objectStore('fichiers').get(cle); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); },
    async suppr(cle) { const db = await this.ouvrir(); return new Promise(ok => { const t = db.transaction('fichiers', 'readwrite'); t.objectStore('fichiers').delete(cle); t.oncomplete = ok; }); }
  };
  IDB.cles = async function (debut) { const db = await this.ouvrir(); return new Promise(ok => { const r = db.transaction('fichiers').objectStore('fichiers').getAllKeys(); r.onsuccess = () => ok((r.result || []).filter(k => typeof k === 'string' && k.startsWith(debut))); r.onerror = () => ok([]); }); };

  /* ================= Sauvegarde automatique =================
     1) chaque modification : navigateur (localStorage) + copie de secours (IndexedDB, survit à une mémoire pleine)
     2) une version datée toutes les 2 minutes de travail (30 par événement) : « 🕘 Versions » dans l'éditeur
     3) avec l'équipe : copie en ligne quelques secondes après, renvoyée dès que la connexion revient
     4) à l'ouverture du studio : ce qui est plus récent dans la copie de secours est repris tout seul */
  const Sauve = {
    _t: 0, attente: new Set(), enLigne: Stock.lire('studio.sauve.enligne', {}),
    copie() { clearTimeout(this._t); this._t = setTimeout(() => this.copieMaintenant(), 300); },
    copieMaintenant() { clearTimeout(this._t); return IDB.mettre('sauve:projets', JSON.stringify(projets)).catch(() => {}); },
    async version(p, forcer) {
      if (!p || !p.id) return;
      const der = this._der || (this._der = {});
      if (!forcer && der[p.id] && Date.now() - der[p.id] < 120000) return;
      der[p.id] = Date.now();
      try {
        await IDB.mettre('version:' + p.id + ':' + Date.now(), JSON.stringify(p));
        const ks = (await IDB.cles('version:' + p.id + ':')).sort();
        for (const k of ks.slice(0, Math.max(0, ks.length - 30))) await IDB.suppr(k);
      } catch (e) {}
    },
    async versions(id) {
      const ks = (await IDB.cles('version:' + id + ':')).sort().reverse();
      return ks.map(k => ({ cle: k, date: Number(k.split(':').pop()) }));
    },
    // au démarrage : reprendre la copie de secours si elle est plus récente
    async reprendre() {
      let n = 0;
      try {
        const t = await IDB.lire('sauve:projets'); if (!t) { this.copieMaintenant(); return 0; }
        const sec = JSON.parse(t);
        Object.values(sec).forEach(p => {
          const ici = projets[p.id];
          if (!ici || (p.modifie || '') > (ici.modifie || '')) { projets[p.id] = p; n++; }
        });
        if (n) Stock.ecrire('studio.projets', projets);
        this.copieMaintenant();
      } catch (e) {}
      return n;
    },
    etat(p) {
      const e = $('#etat-sauve'); if (!e || !p) return;
      const h = d => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      let t = '✓ Enregistré sur cet ordinateur';
      if (Equipe.actif()) {
        if (!navigator.onLine) t = '⚠ Hors connexion — enregistré sur cet ordinateur, envoi en ligne au retour de la connexion';
        else if (this.attente.has(p.id)) t = '✓ Enregistré sur cet ordinateur · ☁ envoi en ligne…';
        else if (this.enLigne[p.id]) t = '✓ Enregistré · ☁ copie en ligne à ' + h(this.enLigne[p.id]);
      }
      e.textContent = t; e.title = 'Sauvegarde automatique : rien à faire. Si le PC s\'éteint ou si la connexion coupe, le travail est repris à la prochaine ouverture.';
    }
  };
  /* ---- Sauvegarde de TOUT le reste (bibliothèque, mes polices, réglages, préférences…) ----
     1) sur cet ordinateur : copie de secours dans IndexedDB à chaque changement (écriture « sûre », résiste à une coupure de courant)
     2) avec l'équipe : copie en ligne (fichiers compris), renvoyée au retour de la connexion
     3) si le navigateur a perdu ses données : tout est remis à l'ouverture du studio */
  const CLES_EN_LIGNE = ['studio.medias', 'studio.polices.perso', 'studio.polices.recentes', 'studio.emojis.recents', 'studio.style', 'studio.regles', 'studio.presse', 'studio.vitrine.conditions', 'studio.illu.cat'];
  Object.assign(Sauve, {
    _tt: 0, _ta: 0, pret: false, accAttente: !!Stock.lire('studio.sauve.acc.attente', false),
    tout() { clearTimeout(this._tt); this._tt = setTimeout(() => this.toutMaintenant(), 400); },
    toutMaintenant() {
      clearTimeout(this._tt); if (!this.pret) return Promise.resolve(); const o = {};
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^studio\./.test(k) && k !== 'studio.projets' && !/^studio\.sauve\./.test(k)) o[k] = localStorage.getItem(k); } } catch (e) {}
      // fusion : une clé effacée par le navigateur ne disparaît pas de la copie de secours
      return IDB.lire('sauve:tout').then(t => { let a = {}; try { a = JSON.parse(t || '{}'); } catch (e) {} return IDB.mettre('sauve:tout', JSON.stringify(Object.assign(a, o))); }).catch(() => {});
    },
    // navigateur vidé (ou données perdues) : on remet ce qui manque
    async reprendreTout() {
      try {
        const t = await IDB.lire('sauve:tout'); if (!t) { this.pret = true; this.toutMaintenant(); return 0; }
        let n = 0; Object.entries(JSON.parse(t)).forEach(([k, v]) => { if (!clesDemarrage.has(k) && k !== 'studio.nouveautes.vu') { try { localStorage.setItem(k, v); n++; } catch (e) {} } });
        this.pret = true; if (!n) this.toutMaintenant();
        return n;
      } catch (e) { this.pret = true; return 0; }
    },
    // copie en ligne des accessoires (équipe) : les fichiers de la bibliothèque et des polices sont envoyés une fois
    accEnLigne(delai) {
      this.accAttente = true; try { localStorage.setItem('studio.sauve.acc.attente', 'true'); } catch (e) {}
      clearTimeout(this._ta);
      if (!Equipe.actif() || !navigator.onLine) return;
      this._ta = setTimeout(() => this.accEnvoyer().catch(e => console.warn('sauvegarde en ligne :', e.message)), delai == null ? 8000 : delai);
    },
    async accEnvoyer() {
      if (!Equipe.actif() || !navigator.onLine) return;
      const enLigne = async src => {
        if (!/^idb:/.test(src || '')) return src;
        if (Equipe.urlDe(src)) return Equipe.urlDe(src);
        const b = await IDB.lire(src); if (!b || b.size > 50e6) return src;
        const chemin = reglages.equipe.cle + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.' + ((src.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin');
        await Equipe.envoyerFichier(chemin, b); Equipe.urls[src] = Equipe.url(chemin); Stock.ecrire('studio.equipe.urls', Equipe.urls);
        return Equipe.urls[src];
      };
      const cles = {};
      for (const k of CLES_EN_LIGNE) { const v = Stock.lire(k, null); if (v != null) cles[k] = v; }
      for (const m of (cles['studio.medias'] || [])) { if (/^idb:/.test(m.src || '')) { try { const u = await enLigne(m.src); if (u !== m.src) m.url = u; } catch (e) {} } }
      for (const x of (cles['studio.polices.perso'] || [])) { if (/^idb:/.test(x.src || '')) { try { const u = await enLigne(x.src); if (u !== x.src) x.url = u; } catch (e) {} } }
      const donnees = JSON.stringify({ version: 1, date: new Date().toISOString(), cles });
      if (donnees.length > 4e6) throw new Error('copie trop grosse');
      await Equipe.rpc('equipe_accessoires_sauver', { p_membre: Equipe.membre(), p_donnees: JSON.parse(donnees) });
      this.accAttente = false; try { localStorage.removeItem('studio.sauve.acc.attente'); localStorage.setItem('studio.sauve.acc.date', JSON.stringify(Date.now())); } catch (e) {}
    },
    // PC changé / navigateur effacé : remettre bibliothèque, polices et préférences depuis la copie en ligne
    async accRecuperer() {
      const d = await Equipe.rpc('equipe_accessoires_lire', { p_membre: Equipe.membre() });
      if (!d || !d.cles) throw new Error('Aucune copie en ligne de votre bibliothèque');
      let fichiers = 0;
      const rapatrier = async (o) => {
        if (!o.url || !/^idb:/.test(o.src || '')) return;
        try { if (await IDB.lire(o.src)) return; const r = await fetch(o.url); if (!r.ok) return; await IDB.mettre(o.src, await r.blob()); Equipe.urls[o.src] = o.url; fichiers++; } catch (e) {}
      };
      const medIci = Stock.lire('studio.medias', []);
      for (const m of (d.cles['studio.medias'] || [])) { await rapatrier(m); delete m.url; if (!medIci.some(x => x.id === m.id)) medIci.push(m); }
      d.cles['studio.medias'] = medIci;
      const polIci = Stock.lire('studio.polices.perso', []);
      for (const x of (d.cles['studio.polices.perso'] || [])) { await rapatrier(x); delete x.url; if (!polIci.some(y => y.nom === x.nom)) polIci.push(x); }
      d.cles['studio.polices.perso'] = polIci;
      Object.entries(d.cles).forEach(([k, v]) => { if (k === 'studio.medias' || k === 'studio.polices.perso' || localStorage.getItem(k) == null) Stock.ecrire(k, v); });
      Stock.ecrire('studio.equipe.urls', Equipe.urls);
      return { date: d.date, medias: medIci.length, polices: polIci.length, fichiers };
    }
  });
  surEcriture = k => { if (k === 'studio.projets' || /^studio\.sauve\./.test(k)) return; Sauve.tout(); try { if (CLES_EN_LIGNE.includes(k)) Sauve.accEnLigne(); } catch (e) {} };
  // fermeture, mise en veille, coupure : on écrit tout de suite ce qui attend
  const toutEcrire = () => { if (tSauve) { clearTimeout(tSauve); tSauve = 0; Stock.ecrire('studio.projets', projets); } Sauve.copieMaintenant(); if (Sauve._tt) Sauve.toutMaintenant(); };
  window.addEventListener('pagehide', toutEcrire);
  window.addEventListener('beforeunload', toutEcrire);
  document.addEventListener('visibilitychange', () => { if (document.hidden) toutEcrire(); });
  window.addEventListener('offline', () => { const id = (location.hash.match(/#\/p\/([^/]+)/) || [])[1]; Sauve.etat(projets[id]); toast('Connexion coupée : votre travail continue d\'être enregistré sur cet ordinateur'); });
  window.addEventListener('online', () => { if (Sauve.accAttente) Sauve.accEnLigne(3000); });
  window.addEventListener('online', () => { const ids = [...Sauve.attente]; ids.forEach(id => projets[id] && Equipe.travail(projets[id], 500)); const id = (location.hash.match(/#\/p\/([^/]+)/) || [])[1]; Sauve.etat(projets[id]); if (ids.length) toast('Connexion revenue : envoi de la copie en ligne'); });
  // filet de sécurité : toutes les 20 s, si une écriture attend encore
  setInterval(() => { if (tSauve) toutEcrire(); }, 20000);

  const urlsIdb = {};
  async function resoudre(src) {
    if (!src) return null;
    if (/^idb:/.test(src)) {
      if (urlsIdb[src]) return urlsIdb[src];
      const b = await IDB.lire(src);
      if (!b) return null;
      return (urlsIdb[src] = URL.createObjectURL(b));
    }
    // vidéos et photos de l'équipe : gardées sur cet ordinateur après le premier téléchargement
    // (sinon chaque ouverture du studio les retélécharge depuis Supabase, et le forfait gratuit est vite dépassé)
    if (typeof Equipe !== 'undefined' && Equipe.estUrl(src)) {
      if (urlsIdb[src]) return urlsIdb[src];
      const cle = 'cache:' + src.split('/object/public/')[1];
      try {
        let b = await IDB.lire(cle);
        if (!b) { const r = await fetch(src); if (!r.ok) return src; b = await r.blob(); if (b.size < 80e6) IDB.mettre(cle, b).catch(() => {}); }
        return (urlsIdb[src] = URL.createObjectURL(b));
      } catch (e) { return src; }
    }
    if (/^(https?:|blob:|data:)/.test(src)) return src;
    return BASE + src;
  }
  /* ================= Équipe : bibliothèque commune, travail de chacun, admin ================= */
  const dureeTexte = s => { s = Math.round(Number(s) || 0); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s'; };
  const Equipe = {
    items: Stock.lire('studio.equipe.biblio', []),
    _enCours: new Set(),
    actif() { return !!(reglages.equipe && reglages.equipe.cle && reglages.supabase); },
    admin() { return !!(reglages.equipe && reglages.equipe.cle_admin); },
    membre() { return (reglages.equipe && reglages.equipe.membre) || ''; },
    cleAcces() { return reglages.equipe.cle_admin || reglages.equipe.cle; },
    rpc(fn, args) { return Base.rpc(reglages.supabase, fn, Object.assign({ p_cle: this.cleAcces() }, args || {})); },
    url(chemin) { return reglages.supabase.url.replace(/\/+$/, '') + '/storage/v1/object/public/equipe/' + chemin; },
    estUrl(src) { return !!(reglages.supabase && typeof src === 'string' && src.startsWith(reglages.supabase.url.replace(/\/+$/, '') + '/storage/v1/object/public/equipe/')); },
    async envoyerFichier(chemin, blob) {
      const a = reglages.supabase.anon;
      const r = await fetch(reglages.supabase.url.replace(/\/+$/, '') + '/storage/v1/object/equipe/' + chemin, { method: 'POST', body: blob,
        headers: Object.assign({ apikey: a, 'Content-Type': blob.type || 'video/mp4', 'x-upsert': 'false' }, /^eyJ/.test(a) ? { Authorization: 'Bearer ' + a } : {}) });
      if (!r.ok) throw new Error('Envoi du fichier impossible (' + r.status + ') ' + (await r.text()).slice(0, 120));
    },
    async charger() { if (!this.actif()) return; this.items = await this.rpc('equipe_biblio_lire') || []; Stock.ecrire('studio.equipe.biblio', this.items); },
    // éléments de l'équipe présentés comme des fichiers de la bibliothèque (sauf ceux qui sont déjà les miens en local)
    medias() {
      if (!this.actif()) return [];
      const miens = new Set(medias.map(m => m.equipe_id).filter(Boolean));
      return (this.items || []).filter(x => !miens.has(x.id) && x.type !== 'film').map(x => ({ id: 'eq-' + x.id, equipe_id: x.id, equipe: true, src: this.url(x.chemin), nom: x.nom, type: x.type, vignette: x.vignette, usage: x.usage || 'programme', description: x.description || '', duree: x.duree, l: x.l, h: x.h, auteur: x.auteur, secondes_creation: x.secondes_creation, evenement: x.evenement, zone: { x: 50, y: 50, largeur: 66 }, zone_texte: 'centre' }));
    },
    // partage un fichier local avec l'équipe (envoi + fiche)
    async partager(m, evtTitre) {
      if (!this.actif() || !m || m.equipe_id || this._enCours.has(m.id) || !/^idb:/.test(m.src)) return;
      this._enCours.add(m.id);
      try { await this._partager(m, evtTitre); } finally { this._enCours.delete(m.id); }
    },
    async _partager(m, evtTitre) {
      const blob = await IDB.lire(m.src); if (!blob) throw new Error('fichier introuvable');
      const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), ext = (m.src.split('.').pop() || 'mp4').toLowerCase();
      const chemin = reglages.equipe.cle + '/' + id + '.' + ext;
      await this.envoyerFichier(chemin, blob);
      await this.rpc('equipe_biblio_ajouter', { p_item: { id, auteur: this.membre(), type: m.type, nom: m.nom, chemin, vignette: m.vignette || '', usage: m.usage || '', description: m.description || '', duree: m.duree || 0, l: m.l || 0, h: m.h || 0, secondes_creation: m.secondes_creation || null, evenement: evtTitre || '' } });
      m.equipe_id = id; sauverMedias();
      this.items.unshift({ id, auteur: this.membre(), type: m.type, nom: m.nom, chemin, vignette: m.vignette, secondes_creation: m.secondes_creation, cree: new Date().toISOString() });
      Stock.ecrire('studio.equipe.biblio', this.items);
    },
    // après chaque ajout de fond ou de vidéo : partage automatique (sans bloquer)
    apresAjout(m, p) {
      if (!this.actif() || reglages.equipe.auto === false || !m || !(m.type === 'fond' || m.type === 'video' || m.anime)) return;
      this.partager(m, p && p.fiche && p.fiche.titre).then(() => toast('Partagé avec l\'équipe : ' + m.nom)).catch(e => toast('Partage avec l\'équipe impossible : ' + e.message));
    },
    // rattrapage : toutes mes vidéos et mes fonds pas encore partagés partent vers l'équipe (un par un, sans bloquer)
    async rattraper() {
      if (!this.actif() || reglages.equipe.auto === false || this._rattrapage) return;
      this._rattrapage = true; let n = 0;
      try {
        const l = medias.filter(m => (m.type === 'fond' || m.type === 'video' || m.anime) && !m.equipe_id && !m.brouillon && /^idb:/.test(m.src || ''));
        for (const m of l) {
          if (!navigator.onLine) break;
          try { await this.partager(m, projets[m.evt] && projets[m.evt].fiche && projets[m.evt].fiche.titre); n++; } catch (e) { console.warn('partage', m.nom, e.message); if (/fetch|network|402|quota|restrict/i.test(e.message)) break; }
        }
        if (n) toast(n + ' vidéo(s) / fond(s) partagé(s) avec l\'équipe');
      } finally { this._rattrapage = false; }
    },
    // temps de fabrication d'une vidéo, envoyé à l'admin
    noter(type, nom, secondes, p) {
      if (!this.actif()) return;
      this.rpc('equipe_creation', { p_creation: { auteur: this.membre(), projet: p ? p.id : '', titre_projet: p ? p.fiche.titre : '', type, nom, secondes } }).catch(() => {});
    },
    // le film MP4 fabriqué : visible par toute l'équipe, publiable sur la vitrine par l'admin
    async partagerFilm(blob, p, sec) {
      let v = vignetteDe(((p.plans.find(x => x.role !== 'ouverture') || p.plans[0] || {}).fond || {}).media || '');
      if (!/^data:/.test(v) || v.length >= 150000) v = '';
      return this.ajouterFilm(blob, { titre: p.fiche.titre || '', secondes: sec, vignette: v });
    },
    // un film terminé (fabriqué ici, ou un fichier MP4 déjà fait) : envoyé dans l'espace d'équipe, visible par tous
    async ajouterFilm(blob, o) {
      if (!this.actif()) throw new Error('vous n\'êtes dans aucune équipe');
      if (blob.size > 50e6) throw new Error('film de plus de 50 Mo (limite de l\'espace d\'équipe)');
      const type = /webm/.test(blob.type) ? 'video/webm' : /quicktime/.test(blob.type) ? 'video/quicktime' : 'video/mp4';
      const ext = type === 'video/webm' ? 'webm' : type === 'video/quicktime' ? 'mov' : 'mp4';
      const id = 'film' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const chemin = reglages.equipe.cle + '/' + id + '.' + ext;
      let vignette = o.vignette || '', duree = 0;
      try { const u = URL.createObjectURL(blob); const info = await Promise.race([vignetteVideo(u), new Promise(ok => setTimeout(() => ok({}), 15000))]); URL.revokeObjectURL(u); if (!vignette) vignette = info.vignette || ''; duree = Math.round((Number(info.duree) || 0) * 10) / 10; } catch (e) {}
      let dernier;
      for (let essai = 0; essai < 3; essai++) {   // réseau instable : on réessaie
        try { await this.envoyerFichier(chemin, blob.type === type ? blob : new Blob([blob], { type })); dernier = null; break; }
        catch (e) { dernier = e; if (/\(4\d\d\)/.test(e.message) && !/\(409\)/.test(e.message)) break; await new Promise(ok => setTimeout(ok, 2000 * (essai + 1))); }
      }
      if (dernier) throw dernier;
      await this.rpc('equipe_biblio_ajouter', { p_item: { id, auteur: this.membre(), type: 'film', nom: 'Film — ' + (o.titre || 'Sans titre'), chemin, vignette: vignette.length < 150000 ? vignette : '', duree, secondes_creation: o.secondes || null, evenement: o.titre || '' } });
      await this.charger();
    },
    // fichiers d'une invitation envoyés dans l'espace d'équipe (une seule fois chacun), pour que l'admin ait tout
    urls: Stock.lire('studio.equipe.urls', {}),
    urlDe(src) {
      const m = medias.find(x => x.src === src);
      if (m && m.equipe_id) { const it = (this.items || []).find(x => x.id === m.equipe_id); if (it) return this.url(it.chemin); }
      return this.urls[src] || null;
    },
    async envoyerSrc(src) {
      if (!/^idb:/.test(src || '') || this.urlDe(src)) return;
      const m = medias.find(x => x.src === src);
      if (m && (m.type === 'fond' || m.anime) && !m.brouillon) { await this.partager(m, ''); if (this.urlDe(src)) return; }
      const blob = await IDB.lire(src); if (!blob) return;
      if (blob.size > 50e6) throw new Error('fichier de plus de 50 Mo');
      const chemin = reglages.equipe.cle + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.' + ((src.split('.').pop() || 'bin').toLowerCase());
      await this.envoyerFichier(chemin, blob);
      this.urls[src] = this.url(chemin); Stock.ecrire('studio.equipe.urls', this.urls);
    },
    // le travail de chacun, visible par l'admin (avec ses fichiers, pour qu'il puisse le publier)
    _t: {},
    travail(p, delai) {
      if (!this.actif() || !p) return;
      Sauve.attente.add(p.id);
      clearTimeout(this._t[p.id]);
      if (!navigator.onLine) return;
      this._t[p.id] = setTimeout(async () => {
        const srcs = [...new Set(p.plans.flatMap(pl => [pl.fond && pl.fond.media].concat((pl.calques || []).map(c => c.media))).concat(p.musique ? [p.musique.src] : []).filter(x => /^idb:/.test(x || '')))];
        for (const src of srcs) { try { await this.envoyerSrc(src); } catch (e) { console.warn('équipe : envoi', src, e.message); } }
        const loc = src => (src && this.urlDe(src)) || src;
        const d = JSON.parse(JSON.stringify(p)); delete d.cle_hote;
        d.plans.forEach(pl => { if (pl.fond) pl.fond.media = loc(pl.fond.media); (pl.calques || []).forEach(c => { if (c.media) c.media = loc(c.media); }); });
        if (d.musique && d.musique.src) d.musique.src = loc(d.musique.src);
        for (const x of (d.polices_perso || [])) { if (/^idb:/.test(x.src || '')) { try { const b = await IDB.lire(x.src); if (b && b.size < 1.5e6) x.src = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); }); } catch (e) {} } }
        const v = vignetteDe(((p.plans.find(x => x.role !== 'ouverture') || p.plans[0] || {}).fond || {}).media || '');
        this.rpc('equipe_travail', { p_travail: { projet: p.id, auteur: this.membre(), titre: p.fiche.titre || '', slug: p.slug || '', plans: p.plans.length, publie: p.publie || null, vignette: /^data:/.test(v) ? (v.length < 150000 ? v : '') : (v ? new URL(v, location.href).href : ''), donnees: d } }).then(() => { Sauve.attente.delete(p.id); Sauve.enLigne[p.id] = Date.now(); Stock.ecrire('studio.sauve.enligne', Sauve.enLigne); Sauve.etat(projets[p.id]); }).catch(() => { Sauve.etat(projets[p.id]); });
      }, delai || 4000);
    }
  };
  if (Equipe.actif()) setTimeout(() => Equipe.charger().catch(() => {}), 1500);

  function tousFonds() {
    return Fabrique.FONDS.concat(medias.filter(m => m.type === 'fond'), Equipe.medias().filter(m => m.type === 'fond'));
  }
  // Fonds visibles pour un événement : fonds de base + fonds communs + fonds de cet événement (+ celui déjà utilisé)
  const pourEvt = (m, id) => !m.evt || m.evt === id;
  function fondsDe(p, garder) {
    return Fabrique.FONDS.concat(medias.filter(m => m.type === 'fond' && (pourEvt(m, p && p.id) || m.src === garder)), Equipe.medias().filter(m => m.type === 'fond'));
  }
  // Une seule fois : rattacher chaque fichier importé à l'événement qui l'utilise
  if (!Stock.lire('studio.medias.evt', false)) {
    medias.forEach(m => {
      if ('evt' in m) return;
      const qui = Object.values(projets).filter(x => JSON.stringify(x).includes(m.src));
      m.evt = qui.length === 1 ? qui[0].id : '';
    });
    Stock.ecrire('studio.medias', medias); Stock.ecrire('studio.medias.evt', true);
  }
  // Vignette d'un plan : couleur, transparence, photo ou vidéo
  function vignettePlan(pl) {
    const f = (pl && pl.fond) || {}, t = MoteurInfo.typeFond(f);
    if (t === 'couleur') return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 16"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${f.couleur || '#f4ede2'}"/><stop offset="1" stop-color="${f.couleur2 || f.couleur || '#f4ede2'}"/></linearGradient></defs><rect width="9" height="16" fill="url(#g)"/></svg>`);
    if (t === 'aucun') return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#fff"/><rect width="4" height="4" fill="#ddd"/><rect x="4" y="4" width="4" height="4" fill="#ddd"/></svg>');
    if (t === 'image') { const m = medias.find(x => x.src === f.media) || Equipe.medias().find(x => x.src === f.media); return (m && m.vignette) || (/^data:image/.test(f.media) ? f.media : ''); }
    return vignetteDe(f.media);
  }
  function vignetteDe(src) {
    const f = tousFonds().find(x => x.src === src);
    if (!f) return '';
    return /^data:/.test(f.vignette || '') ? f.vignette : (f.vignette ? BASE + f.vignette : '');
  }

  /* ================= Utilitaires UI ================= */
  let toastT;
  function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('vu'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('vu'), 2600); }
  function modale(html, onOuvre) {
    const m = $('#modale');
    $('.modale-contenu', m).innerHTML = html;
    m.hidden = false;
    const fermer = () => { m.hidden = true; $('.modale-contenu', m).innerHTML = ''; if (modale._fermer) modale._fermer(); modale._fermer = null; };
    $('.modale-fermer', m).onclick = fermer;
    m.onclick = e => { if (e.target === m) fermer(); };
    if (onOuvre) onOuvre($('.modale-contenu', m), fermer);
    return fermer;
  }
  /* ---------- Mes polices : fichiers .ttf / .otf / .woff importés (polices qui ne sont pas chez Google) ---------- */
  let mesPolices = Stock.lire('studio.polices.perso', []);
  const sauverMesPolices = () => Stock.ecrire('studio.polices.perso', mesPolices);
  async function chargerMesPolices(liste) { for (const x of (liste || mesPolices)) { try { const u = await resoudre(x.src); if (u) await MoteurInfo.chargerPolicePerso(x.nom, u); } catch (e) {} } }
  setTimeout(() => chargerMesPolices(), 300);
  // Polices du studio (dossier polices/ du site) : pour toute l'équipe et toutes les invitations
  let policesSite = [];
  const chargementPolicesSite = fetch(BASE + 'polices/index.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []).then(async l => {
    policesSite = (Array.isArray(l) ? l : []).filter(x => x && x.nom && x.fichier);
    for (const x of policesSite) await MoteurInfo.chargerPolicePerso(x.nom, BASE + x.fichier);
    return policesSite;
  });
  // Met une police importée dans le studio, pour toute l'équipe (fichier envoyé sur le site)
  async function partagerPolice(nom) {
    const g = reglages.github || {}; if (!(g.owner && g.repo && g.token)) throw new Error('Reliez d\'abord GitHub dans Réglages');
    const x = mesPolices.find(m => m.nom === nom); if (!x) throw new Error('Police introuvable');
    const b = await IDB.lire(x.src); if (!b) throw new Error('Fichier de police introuvable sur cet ordinateur');
    const ext = (x.src.split('.').pop() || 'ttf').toLowerCase(), fichier = 'polices/' + nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.' + ext;
    await GitHub.envoyer(fichier, b, 'Police ' + nom);
    let liste = []; try { liste = JSON.parse(await GitHub.lireTexte('polices/index.json')) || []; } catch (e) { if (e.message !== 'absent') throw e; }
    liste = liste.filter(p => p.nom !== nom).concat({ nom, fichier, auteur: 'ajoutée par ' + (Equipe.membre ? Equipe.membre() : '') });
    await GitHub.envoyer('polices/index.json', JSON.stringify(liste, null, 1), 'Polices du studio : ' + nom);
    policesSite = policesSite.filter(p => p.nom !== nom).concat({ nom, fichier });
    return fichier;
  }
  function nomDePolice(fichier) { return fichier.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ').replace(/\b(regular|normal|book)\b/ig, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim() || 'Ma police'; }
  async function importerPolice(f) {
    if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) throw new Error('Choisissez un fichier de police .ttf, .otf, .woff ou .woff2');
    if (f.size > 3e6) throw new Error('Fichier de police trop lourd (plus de 3 Mo)');
    let nom = prompt('Nom de la police (tel qu\'il apparaîtra dans la liste) :', nomDePolice(f.name)); if (nom === null) return null;
    nom = nom.trim().replace(/["\\]/g, '') || nomDePolice(f.name);
    if (MoteurInfo.CATALOGUE_POLICES.some(x => x[0] === nom)) nom += ' (importée)';
    const src = 'idb:police-' + uid() + '.' + f.name.split('.').pop().toLowerCase();
    await IDB.mettre(src, f);
    const u = await resoudre(src);
    try { await new FontFace(nom, `url("${u}")`).load(); } catch (e) { throw new Error('Ce fichier n\'est pas une police lisible'); }
    await MoteurInfo.chargerPolicePerso(nom, u);
    mesPolices = mesPolices.filter(x => x.nom !== nom).concat({ nom, src, fichier: f.name }); sauverMesPolices();
    return nom;
  }
  // Polices d'un projet reçu (modèle d'équipe…) : rangées dans « Mes polices » de cet ordinateur
  async function recevoirPolices(projet) {
    for (const x of (projet.polices_perso || [])) {
      if (!/^data:/.test(x.src || '')) continue;
      try { const b = dataURLversBlob(x.src); const src = 'idb:police-' + uid() + '.' + (/woff2/.test(b.type) ? 'woff2' : /woff/.test(b.type) ? 'woff' : /otf|opentype/.test(b.type) ? 'otf' : 'ttf'); await IDB.mettre(src, b); x.src = src; if (!mesPolices.some(m => m.nom === x.nom)) { mesPolices.push({ nom: x.nom, src, fichier: x.nom }); sauverMesPolices(); } } catch (e) {}
    }
    await chargerMesPolices(projet.polices_perso || []);
  }

  /* ---------- Petites fenêtres flottantes (polices, emojis) ---------- */
  let popOuvert = null;
  function fermerPop() { if (popOuvert) { popOuvert.remove(); popOuvert = null; } }
  function pop(ancre, html, classe) {
    fermerPop();
    const d = document.createElement('div'); d.className = 'pop ' + (classe || ''); d.innerHTML = html;
    document.body.appendChild(d); popOuvert = d;
    const r = ancre.getBoundingClientRect(), w = d.offsetWidth, h = d.offsetHeight;
    let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)), y = r.bottom + 6;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
    d.style.left = x + 'px'; d.style.top = y + 'px';
    setTimeout(() => {
      const dehors = e => { if (!d.isConnected) return document.removeEventListener('pointerdown', dehors, true); if (!d.contains(e.target) && e.target !== ancre) { fermerPop(); document.removeEventListener('pointerdown', dehors, true); } };
      document.addEventListener('pointerdown', dehors, true);
      const echap = e => { if (!d.isConnected) return document.removeEventListener('keydown', echap, true); if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fermerPop(); document.removeEventListener('keydown', echap, true); } };
      document.addEventListener('keydown', echap, true);
    }, 0);
    return d;
  }
  // Choix de la police : chaque police est montrée avec son propre dessin
  function ouvrirPolices(ancre, actuelle, choisir) {
    const cat = MoteurInfo.CATALOGUE_POLICES;
    MoteurInfo.chargerPolices(cat.map(x => x[0]));
    const recentes = Stock.lire('studio.polices.recentes', []).filter(n => cat.some(x => x[0] === n)).slice(0, 6);
    const perso = [...new Set(mesPolices.map(x => x.nom).concat(ouvrirPolices.projet ? (ouvrirPolices.projet.polices_perso || []).map(x => x.nom) : []))];
    const recentes2 = Stock.lire('studio.polices.recentes', []).filter(n => cat.some(x => x[0] === n) || perso.includes(n)).slice(0, 6);
    recentes.splice(0, recentes.length, ...recentes2);
    const site = policesSite.map(x => x.nom);
    const DEMANDEES = ['League Spartan', 'Accidental Presidency', 'Intro', 'Urbanist', 'Archivo', 'Archivo Black', 'Outfit', 'Cabin', 'League Gothic'];
    const demandees = DEMANDEES.filter(n => n === 'Intro' || cat.some(x => x[0] === n) || site.includes(n) || perso.includes(n));
    if (perso.some(n => /^intro/i.test(n))) demandees.splice(demandees.indexOf('Intro'), 1, ...perso.filter(n => /^intro/i.test(n)));
    const groupes = [['★ Demandées', demandees], ['Récentes', recentes], ['Polices du studio', site], ['Mes polices', perso.filter(n => !site.includes(n))]].concat([...new Set(cat.map(x => x[1]))].map(g => [g, cat.filter(x => x[1] === g).map(x => x[0])]));
    const d = pop(ancre, `<input type="search" class="pop-cherche" placeholder="Chercher une police…">
      <div class="pop-onglets">${groupes.filter(g => g[1].length).map(([g]) => `<button data-g="${esc(g)}" class="${g === '★ Demandées' ? 'on' : ''}">${esc(g)}</button>`).join('')}<button data-g="*">Toutes</button></div>
      <div class="pop-liste polices"></div>
      <label class="btn petit" style="margin-top:6px;width:100%;justify-content:center">+ Importer une police (.ttf, .otf, .woff)<input type="file" class="pop-import" accept=".ttf,.otf,.woff,.woff2,font/*" hidden></label>`, 'pop-polices');
    const liste = $('.polices', d);
    const montrer = (noms) => { liste.innerHTML = noms.map(n => `<button class="police-choix ${n === actuelle ? 'on' : ''}" data-n="${esc(n)}"><span style="font-family:'${esc(n)}',serif">${esc(n)}${site.includes(n) ? ' <em class="pc-tag">studio</em>' : perso.includes(n) ? ' <em class="pc-tag">importée</em>' : ''}</span><small style="font-family:'${esc(n)}',serif">${n === 'Intro' && !perso.includes('Intro') ? 'Intro Regular — touchez ici pour ajouter son fichier .ttf / .otf' : 'Mariage · Ho tonga 2026'}</small>${perso.includes(n) && !site.includes(n) && mesPolices.some(m => m.nom === n) ? `<i class="pc-partager" data-partager="${esc(n)}" title="Mettre cette police dans le studio : toute l'équipe l'aura">⇪ pour toute l'équipe</i>` : ''}</button>`).join('') || '<p class="muet">Aucune police.</p>'; };
    const groupe = g => g === '*' ? [...new Set(site.concat(perso, cat.map(x => x[0])))] : (groupes.find(x => x[0] === g) || [0, []])[1];
    let pourIntro = false;
    $('.pop-import', d).onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const nom = await importerPolice(f); if (!nom) return; toast('Police « ' + nom + ' » importée');
      // Intro : mise tout de suite dans le studio pour toute l'équipe (si la publication GitHub est reliée)
      if (pourIntro && reglages.github && reglages.github.token && !policesSite.some(x => x.nom === nom)) { try { await partagerPolice(nom); toast('« ' + nom + ' » est dans le studio pour toute l\'équipe'); } catch (err) { toast('Importée pour vous ; partage équipe : ' + err.message); } } Stock.ecrire('studio.polices.recentes', [nom].concat(recentes.filter(x => x !== nom)).slice(0, 6)); fermerPop(); choisir(nom); } catch (err) { toast(err.message); } };
    montrer(groupe('★ Demandées'));
    $$('[data-g]', d).forEach(b => b.onclick = () => { $$('[data-g]', d).forEach(x => x.classList.toggle('on', x === b)); $('.pop-cherche', d).value = ''; montrer(groupe(b.dataset.g)); });
    $('.pop-cherche', d).oninput = e => { const q = e.target.value.trim().toLowerCase(); montrer(q ? groupe('*').filter(n => n.toLowerCase().includes(q)) : groupe('*')); };
    liste.onclick = async e => {
      const pt = e.target.closest('[data-partager]');
      if (pt) { e.stopPropagation(); const n = pt.dataset.partager; pt.textContent = 'Envoi…'; try { await partagerPolice(n); toast('« ' + n + ' » est maintenant dans le studio pour toute l\'équipe'); fermerPop(); } catch (err) { toast(err.message); pt.textContent = '⇪ pour toute l\'équipe'; } return; }
      const b = e.target.closest('[data-n]'); if (!b) return;
      if (b.dataset.n === 'Intro' && !perso.includes('Intro')) { pourIntro = true; toast('Choisissez le fichier de la police Intro Regular (.ttf / .otf) : elle sera ajoutée pour toute l\'équipe'); $('.pop-import', d).click(); return; } const n = b.dataset.n; Stock.ecrire('studio.polices.recentes', [n].concat(recentes.filter(x => x !== n)).slice(0, 6)); fermerPop(); choisir(n); };
    setTimeout(() => $('.pop-cherche', d).focus(), 30);
  }
  // Emojis rangés par thème (les derniers utilisés en premier)
  const EMOJIS = {
    'Amour': '❤️ 🧡 💛 💚 💙 💜 🤍 🤎 🖤 💕 💞 💓 💗 💖 💘 💝 💌 💋 😍 🥰 😘 💑 💏 👩‍❤️‍👨 💍 💒 👰 🤵 🥂 🍾 💐',
    'Fête': '🎉 🎊 🎈 🎁 🎂 🍰 🧁 🥳 🎶 🎵 🎤 💃 🕺 🪅 🎆 🎇 ✨ 🌟 ⭐ 💫 🔥 🍽️ 🍷 🥤 🍹 🪩',
    'Fleurs': '🌸 🌹 🌺 🌷 🌻 🌼 💮 🏵️ 💐 🌿 🍃 🍀 🌱 🌴 🌾 🪷 🦋 🕊️',
    'Bébé et foi': '👶 🍼 🧸 🎀 👣 🤱 🙏 ✝️ ⛪ 🕊️ 👼 📿 ☀️ 🌙 ⭐ ☁️ 🌈',
    'Visages': '😊 😃 😄 😁 😂 🤩 😇 🙂 😉 🥹 😭 😢 🤗 🤭 😎 🥺 👏 🙌 👍 🤝 ✌️ 👋',
    'Infos': '📍 🗺️ 📅 🗓️ ⏰ 🕐 📞 📱 ✉️ 📩 🚗 🚌 🏠 🏡 🏛️ ⛪ 🎫 ✅ ❌ ➡️ ⬇️ ❗ ❓ ℹ️',
    'Drapeaux': '🇲🇬 🇫🇷 🇬🇧 🇺🇸 🇨🇦 🇩🇪 🇮🇹 🇪🇸 🇵🇹 🇨🇳 🇯🇵 🇷🇺 🇿🇦 🇲🇺 🇷🇪 🇰🇲 🇸🇨'
  };
  function ouvrirEmojis(ancre, choisir) {
    const recents = Stock.lire('studio.emojis.recents', []);
    const cats = (recents.length ? [['Récents', recents]] : []).concat(Object.entries(EMOJIS).map(([k, v]) => [k, v.split(' ')]));
    const d = pop(ancre, `<div class="pop-onglets">${cats.map(([k], i) => `<button data-c="${i}" class="${i ? '' : 'on'}">${esc(k)}</button>`).join('')}</div><div class="pop-liste emojis"></div><p class="muet" style="margin:6px 4px 0;font-size:11.5px">Astuce : sur l'ordinateur, Windows + . (point) ou Ctrl + Cmd + Espace sur Mac ouvre tous les emojis.</p>`, 'pop-emojis');
    const liste = $('.emojis', d);
    const montrer = i => { liste.innerHTML = cats[i][1].map(e => `<button data-e="${esc(e)}">${e}</button>`).join(''); };
    montrer(0);
    $$('[data-c]', d).forEach(b => b.onclick = () => { $$('[data-c]', d).forEach(x => x.classList.toggle('on', x === b)); montrer(Number(b.dataset.c)); });
    liste.onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; const em = b.dataset.e; Stock.ecrire('studio.emojis.recents', [em].concat(recents.filter(x => x !== em)).slice(0, 24)); choisir(em); };
  }

  /* ---------- Forme du cadre d'une photo ou d'une vidéo ---------- */
  function iconeForme(id, c, ratio) {
    const w = ratio >= 1 ? 40 : Math.round(40 * ratio), h = ratio >= 1 ? Math.round(40 / ratio) : 40;
    if (!id) return `<svg viewBox="-3 -3 46 46"><rect x="4" y="8" width="32" height="24" fill="#d9cbbb"/><path d="M8 28l8-9 6 6 4-4 8 7z" fill="#a98f78"/></svg>`;
    const d = MoteurInfo.cheminForme(Object.assign({}, c, { forme: id }), w, h);
    return `<svg viewBox="-3 -3 ${w + 6} ${h + 6}"><path d="${d}" fill="#d9cbbb" stroke="#7a1f2b" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }
  function grilleFormes(c, ratio) {
    return `<div class="formes-grille">${MoteurInfo.FORMES.map(([id, nom]) => `<button class="forme-btn ${(c.forme || '') === id ? 'on' : ''}" data-forme="${id}" title="${esc(nom)}">${iconeForme(id, c, ratio)}<span>${esc(nom.replace(/ \(.*\)$/, ''))}</span></button>`).join('')}</div>`;
  }
  // points d'une forme quelconque (pour la modifier librement)
  function pointsDeForme(c, n) {
    const d = MoteurInfo.cheminForme(c.forme ? c : Object.assign({}, c, { forme: 'rect' }), 1000, 1000);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.style.position = 'absolute'; svg.style.visibility = 'hidden';
    const pa = document.createElementNS('http://www.w3.org/2000/svg', 'path'); pa.setAttribute('d', d); svg.appendChild(pa); document.body.appendChild(svg);
    const L = pa.getTotalLength(), pts = [];
    for (let i = 0; i < n; i++) { const q = pa.getPointAtLength(L * i / n); pts.push([Math.round(q.x) / 1000, Math.round(q.y) / 1000]); }
    svg.remove(); return pts;
  }
  // Éditeur de forme libre : on déplace les points sur la photo
  async function modaleFormeLibre(c, ratio, fini) {
    let pts = Array.isArray(c.forme_points) && c.forme_points.length >= 3 ? c.forme_points.map(p => p.slice()) : pointsDeForme(c, (c.forme && c.forme !== 'rect' && c.forme !== 'arrondi') ? 12 : 8);
    let lisse = c.forme === 'libre' ? !!c.forme_lisse : !['rect', 'losange', 'triangle', 'pentagone', 'hexagone', 'octogone', 'coins-coupes', 'parallelogramme', 'etoile', ''].includes(c.forme || '');
    // image de la photo (ou de la vidéo)
    let img = '';
    try { const u = await resoudre(c.media); if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(c.media) || /^data:image/.test(c.media)) img = u; else { const v = document.createElement('video'); v.muted = true; v.crossOrigin = 'anonymous'; v.src = u; await new Promise(ok => { v.onloadeddata = ok; setTimeout(ok, 5000); }); v.currentTime = Math.min(1, (v.duration || 2) / 3); await new Promise(ok => { v.onseeked = ok; setTimeout(ok, 3000); }); const cv = document.createElement('canvas'); cv.width = v.videoWidth || 320; cv.height = v.videoHeight || 320; cv.getContext('2d').drawImage(v, 0, 0); img = cv.toDataURL('image/jpeg', 0.85); } } catch (e) {}
    const W0 = 1000, H0 = Math.round(1000 / ratio);
    modale(`<h2>✎ Forme libre du cadre</h2>
      <p class="muet">Glissez les points ronds. <b>Double-clic sur un trait</b> : ajouter un point · <b>double-clic sur un point</b> : le retirer (3 points au moins).</p>
      <div class="ligne" style="gap:10px;margin-bottom:8px;flex-wrap:wrap"><label class="cases"><input type="checkbox" id="fl-lisse" ${lisse ? 'checked' : ''}> Courbes douces</label>
        <span class="muet">Partir de :</span>${['rond', 'coeur', 'etoile', 'hexagone', 'arche', 'tache'].map(id => `<button class="btn petit" data-depart="${id}">${esc((MoteurInfo.FORMES.find(x => x[0] === id) || [0, id])[1])}</button>`).join('')}</div>
      <div class="fl-boite" style="aspect-ratio:${W0 + 120} / ${H0 + 120};width:min(100%, calc(62vh * ${((W0 + 120) / (H0 + 120)).toFixed(3)}))"><svg id="fl-svg" viewBox="-60 -60 ${W0 + 120} ${H0 + 120}" preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="fl-clip"><path id="fl-clip-p"/></clipPath></defs>
        ${img ? `<image href="${esc(img)}" x="0" y="0" width="${W0}" height="${H0}" preserveAspectRatio="xMidYMid slice" opacity=".28"/><image href="${esc(img)}" x="0" y="0" width="${W0}" height="${H0}" preserveAspectRatio="xMidYMid slice" clip-path="url(#fl-clip)"/>` : `<rect width="${W0}" height="${H0}" fill="#eee"/>`}
        <rect width="${W0}" height="${H0}" fill="none" stroke="#999" stroke-dasharray="8 8"/>
        <path id="fl-trait" fill="none" stroke="#c33a4c" stroke-width="5" stroke-linejoin="round" style="cursor:copy"/>
        <g id="fl-points"></g></svg></div>
      <div class="ligne" style="margin-top:12px;justify-content:space-between"><button class="btn" id="fl-annuler">Annuler</button><button class="btn plein" id="fl-ok">Appliquer cette forme</button></div>`, (racine, fermer) => {
      const svg = $('#fl-svg', racine);
      const chemin = () => { const P = pts.map(p => [p[0] * W0, p[1] * H0]); return MoteurInfo.cheminForme({ forme: 'libre', forme_points: pts, forme_lisse: lisse }, W0, H0); };
      const rendre = () => {
        const d = chemin(); $('#fl-trait', racine).setAttribute('d', d); $('#fl-clip-p', racine).setAttribute('d', d);
        $('#fl-points', racine).innerHTML = pts.map((p, i) => `<circle cx="${p[0] * W0}" cy="${p[1] * H0}" r="16" data-i="${i}" fill="#fff" stroke="#c33a4c" stroke-width="5" style="cursor:grab"/>`).join('');
      };
      const versSvg = e => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [Math.max(0, Math.min(1, q.x / W0)), Math.max(0, Math.min(1, q.y / H0))]; };
      let tire = null;
      svg.addEventListener('pointerdown', e => { const i = e.target.dataset && e.target.dataset.i; if (i == null) return; tire = Number(i); svg.setPointerCapture(e.pointerId); e.preventDefault(); });
      svg.addEventListener('pointermove', e => { if (tire == null) return; pts[tire] = versSvg(e).map(v => Math.round(v * 1000) / 1000); rendre(); });
      svg.addEventListener('pointerup', () => { tire = null; });
      svg.addEventListener('dblclick', e => {
        const i = e.target.dataset && e.target.dataset.i;
        if (i != null) { if (pts.length > 3) { pts.splice(Number(i), 1); rendre(); } else toast('Il faut au moins 3 points'); return; }
        // ajouter un point sur le trait le plus proche
        const q = versSvg(e); let best = 0, dmin = 1e9;
        pts.forEach((a, k) => { const b = pts[(k + 1) % pts.length]; const ax = a[0] * W0, ay = a[1] * H0, bx = b[0] * W0, by = b[1] * H0, px = q[0] * W0, py = q[1] * H0; const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1))); const d = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))); if (d < dmin) { dmin = d; best = k; } });
        pts.splice(best + 1, 0, q.map(v => Math.round(v * 1000) / 1000)); rendre();
      });
      $('#fl-lisse', racine).onchange = e => { lisse = e.target.checked; rendre(); };
      $$('[data-depart]', racine).forEach(b => b.onclick = () => { pts = pointsDeForme(Object.assign({}, c, { forme: b.dataset.depart }), b.dataset.depart === 'etoile' || b.dataset.depart === 'hexagone' ? (b.dataset.depart === 'etoile' ? 10 : 6) : 12); if (b.dataset.depart === 'etoile' || b.dataset.depart === 'hexagone') { pts = MoteurInfo.cheminForme(Object.assign({}, c, { forme: b.dataset.depart }), 1, 1) ? pointsSommets(b.dataset.depart) : pts; lisse = false; } else lisse = true; $('#fl-lisse', racine).checked = lisse; rendre(); });
      $('#fl-annuler', racine).onclick = fermer;
      $('#fl-ok', racine).onclick = () => { fermer(); fini(pts, lisse); };
      rendre();
    });
  }
  // sommets exacts des formes à angles (étoile, hexagone)
  function pointsSommets(id) {
    const d = MoteurInfo.cheminForme({ forme: id }, 1000, 1000);
    return (d.match(/[ML](-?[\d.]+) (-?[\d.]+)/g) || []).map(m => { const [x, y] = m.slice(1).split(' ').map(Number); return [Math.round(x) / 1000, Math.round(y) / 1000]; });
  }

  /* ---------- Rogner une photo ou une vidéo (garder une partie) ---------- */
  // conf.recadrage = { x, y, w, h } en fractions de l'image d'origine
  async function modaleRecadrer(conf, src, ratioCadre, fini, opts) {
    opts = opts || {};
    const url = await resoudre(src);
    const video = !/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(src) && !/^data:image/.test(src);
    let r = Object.assign({ x: 0, y: 0, w: 1, h: 1 }, conf.recadrage || {});
    let ratio = null;   // proportion imposée (largeur / hauteur, en pixels)
    modale(`<h2>⬚ Rogner ${video ? 'la vidéo' : 'la photo'}</h2>
      <p class="muet">Déplacez le cadre et tirez ses coins : seule la partie claire est gardée. ${opts.fond ? 'Le fond remplit tout l\'écran : le format 9:16 garde exactement ce que vous voyez.' : ''}</p>
      <div class="ligne rg-formats" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${[['libre', 'Libre'], ['cadre', opts.fond ? 'Écran 9:16' : 'Comme le cadre'], ['1', 'Carré 1:1'], ['0.8', 'Portrait 4:5'], ['0.5625', '9:16'], ['1.7778', '16:9'], ['0.75', '3:4']].map(([k, n]) => `<button class="btn petit" data-ratio="${k}">${n}</button>`).join('')}</div>
      <div class="rg-boite"><div class="rg-media"></div><div class="rg-voile"></div><div class="rg-cadre"><i data-p="nw"></i><i data-p="ne"></i><i data-p="sw"></i><i data-p="se"></i><i data-p="n"></i><i data-p="s"></i><i data-p="e"></i><i data-p="w"></i></div></div>
      ${video ? '<input type="range" id="rg-temps" min="0" max="1" step="0.01" value="0.2" style="width:100%;margin-top:8px" title="Choisir l\'image de la vidéo">' : ''}
      ${opts.adapter ? '<label class="cases" style="margin-top:8px"><input type="checkbox" id="rg-adapter" checked> Adapter la forme du calque à la partie gardée</label>' : ''}
      <div class="ligne" style="margin-top:12px;justify-content:space-between"><button class="btn" id="rg-tout">Tout garder (annuler le rognage)</button><button class="btn plein" id="rg-ok">Appliquer</button></div>`, (racine, fermer) => {
      const boite = $('.rg-boite', racine), zoneM = $('.rg-media', racine), cadreR = $('.rg-cadre', racine), voile = $('.rg-voile', racine);
      const el = video ? document.createElement('video') : new Image();
      if (video) { el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = /^https?:/.test(url) && new URL(url, location.href).origin !== location.origin ? 'anonymous' : null; }
      el.src = url; zoneM.appendChild(el);
      let iw = 1, ih = 1;
      const pret = () => { iw = el.videoWidth || el.naturalWidth || 1; ih = el.videoHeight || el.naturalHeight || 1; boite.style.aspectRatio = iw + ' / ' + ih; boite.style.setProperty('--r', (iw / ih).toFixed(4)); if (video) { try { el.currentTime = Math.min(1, (el.duration || 2) * 0.2); } catch (e) {} } maj(); };
      if (video) el.addEventListener('loadedmetadata', pret, { once: true }); else el.onload = pret;
      const ts = $('#rg-temps', racine); if (ts) ts.oninput = () => { try { el.currentTime = Number(ts.value) * (el.duration || 1); } catch (e) {} };
      const borner = () => { r.w = Math.max(0.05, Math.min(1, r.w)); r.h = Math.max(0.05, Math.min(1, r.h)); r.x = Math.max(0, Math.min(1 - r.w, r.x)); r.y = Math.max(0, Math.min(1 - r.h, r.y)); };
      const imposer = () => { if (!ratio) return; const cx = r.x + r.w / 2, cy = r.y + r.h / 2; let w = r.w, h = w * iw / ih / ratio; if (h > 1) { h = 1; w = h * ih * ratio / iw; } if (w > 1) { w = 1; h = w * iw / ih / ratio; } r.w = w; r.h = h; r.x = cx - w / 2; r.y = cy - h / 2; borner(); };
      function maj() { borner(); Object.assign(cadreR.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' }); voile.style.clipPath = `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${r.x * 100}% ${r.y * 100}%,${r.x * 100}% ${(r.y + r.h) * 100}%,${(r.x + r.w) * 100}% ${(r.y + r.h) * 100}%,${(r.x + r.w) * 100}% ${r.y * 100}%,${r.x * 100}% ${r.y * 100}%)`; }
      $$('[data-ratio]', racine).forEach(b => b.onclick = () => { $$('[data-ratio]', racine).forEach(x => x.classList.toggle('plein', x === b)); const k = b.dataset.ratio; ratio = k === 'libre' ? null : k === 'cadre' ? ratioCadre : Number(k); if (ratio) { r.w = 1; r.h = 1; r.x = 0; r.y = 0; imposer(); } maj(); });
      let dr = null;
      boite.addEventListener('pointerdown', e => { const rb = boite.getBoundingClientRect(); dr = { p: e.target.dataset.p || (e.target === cadreR ? 'deplacer' : null), x0: e.clientX, y0: e.clientY, r0: Object.assign({}, r), w: rb.width, h: rb.height }; if (!dr.p) { dr = null; return; } boite.setPointerCapture(e.pointerId); e.preventDefault(); });
      boite.addEventListener('pointermove', e => {
        if (!dr) return; const dx = (e.clientX - dr.x0) / dr.w, dy = (e.clientY - dr.y0) / dr.h, o = dr.r0, P = dr.p;
        if (P === 'deplacer') { r.x = o.x + dx; r.y = o.y + dy; }
        else {
          let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
          if (P.includes('w')) x1 = Math.min(x2 - 0.05, Math.max(0, o.x + dx)); if (P.includes('e')) x2 = Math.max(x1 + 0.05, Math.min(1, o.x + o.w + dx));
          if (P.includes('n')) y1 = Math.min(y2 - 0.05, Math.max(0, o.y + dy)); if (P.includes('s')) y2 = Math.max(y1 + 0.05, Math.min(1, o.y + o.h + dy));
          r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
          if (ratio) { const h = r.w * iw / ih / ratio; if (P.includes('n')) r.y = y2 - h; r.h = h; if (r.y < 0 || r.y + r.h > 1) { r.h = Math.min(1, r.h); r.w = r.h * ih * ratio / iw; } }
        }
        maj();
      });
      boite.addEventListener('pointerup', () => { dr = null; });
      $('#rg-tout', racine).onclick = () => { delete conf.recadrage; fermer(); fini(null); };
      $('#rg-ok', racine).onclick = () => {
        const garde = r.x < 0.002 && r.y < 0.002 && r.w > 0.997 && r.h > 0.997;
        if (garde) delete conf.recadrage; else conf.recadrage = { x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +r.w.toFixed(4), h: +r.h.toFixed(4) };
        const ad = $('#rg-adapter', racine);
        fermer(); fini(garde ? null : conf.recadrage, { iw, ih, adapter: ad ? ad.checked : false });
      };
    });
  }

  async function copier(t) { try { await navigator.clipboard.writeText(t); toast('Copié'); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copié'); } }
  function telecharger(nom, contenu, type) {
    const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: type || 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function dataURLversBlob(d) { const [t, b] = d.split(','); const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: t.match(/:(.*?);/)[1] }); }
  const codeFamille = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
  // Compte et dépôt déduits de l'adresse du site (ex. evenementampandranna-png.github.io/STUDIO)
  function depotDuSite() { const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname); const r = location.pathname.split('/').filter(Boolean)[0]; return m && r ? { owner: m[1], repo: r } : { owner: '', repo: '' }; }
  function urlSite() {
    const g = reglages.github || {};
    if (g.owner && g.repo) return `https://${g.owner.toLowerCase()}.github.io/${g.repo}/`;
    return location.href.replace(/studio\/.*$/, '');
  }
  const lienGeneral = p => urlSite() + 'i/?p=' + encodeURIComponent(p.slug);
  const lienFamille = (p, f) => lienGeneral(p) + '&f=' + encodeURIComponent(f.code);
  const telWa = n => String(n || '').replace(/\D/g, '').replace(/^0/, '261');

  /* ================= Routeur ================= */
  let moteurCourant = null;
  let nettoyeurs = [];
  function nettoyer() { if (moteurCourant) { moteurCourant.detruire(); moteurCourant = null; } if (boucleUI) { cancelAnimationFrame(boucleUI); boucleUI = null; } nettoyeurs.forEach(f => f()); nettoyeurs = []; }
  function ecouter(cible, ev, fn) { cible.addEventListener(ev, fn); nettoyeurs.push(() => cible.removeEventListener(ev, fn)); }
  /* ================= Nouveautés : affichées à chaque mise à jour ================= */
  // À chaque mise à jour du studio, ajouter une entrée EN HAUT de cette liste (identifiant = date-numéro).
  const NOUVEAUTES = [
    { id: '2026-11-10-4', date: '10 novembre 2026', titre: 'Éditeur disposé comme Photoshop, aux couleurs du studio', points: [
      '<b>En haut</b> : la barre d\'options du calque choisi, sur toute la largeur. <b>À gauche</b> : la colonne d\'outils. <b>Au centre</b> : l\'aperçu.',
      '<b>À droite</b> : la liste des panneaux (icône + nom : Fond, Durée, Texte, Animation, Ordre, Position…) ; on clique un nom pour ouvrir ce panneau seul. <b>Calques</b> reste toujours en bas, comme dans Photoshop.',
      'Fond : la liste déroulante « Ou dans la liste » est retirée ; tout passe par « 🔍 Choisir un fond… ».'
    ] },
    { id: '2026-11-10-3', date: '10 novembre 2026', titre: 'Panneau sombre façon Photoshop, boutons prêts à l\'emploi, vidéos de toute l\'équipe', points: [
      '<b>Panneau de droite</b> au style Photoshop : sombre, rubriques à titre gris, champs compacts.',
      '<b>Boutons</b> : choisissez ce que fait le bouton — ✅ Je confirme (enregistré dans la base, l\'organisateur est prévenu), ❌ Je ne viens pas, 📍 Itinéraire (lieu de la Fiche ou autre adresse / lien Maps), 📞 Appeler, 💬 WhatsApp (contact ou autre numéro), 📅 Calendrier, 📤 Partager, 🔗 Lien web, Messenger, Continuer, Retour… Le texte se met tout seul dans la langue de l\'invitation ; « Ouvrir pour tester ↗ ».',
      '<b>🎬 Vidéos</b> : films terminés <b>et</b> fonds vidéo de tous les membres. Toutes vos vidéos et fonds non partagés partent automatiquement vers l\'équipe (ou bouton « Les partager maintenant »).'
    ] },
    { id: '2026-11-10-2', date: '10 novembre 2026', titre: 'Éditeur façon Photoshop : outils, formes, zoom, ordre des calques, choix du fond', points: [
      '<b>Barre d\'outils à gauche de l\'aperçu</b> : T texte, ▭ forme, 🖼 photo, ✿ illustration, 😊 emoji, boutons, ▦ fond, et le zoom.',
      '<b>Panneau de droite</b> : une seule rubrique ouverte à la fois (cliquez son titre pour l\'ouvrir) ; le studio se souvient de la dernière utilisée. « Calques » reste toujours visible.',
      '<b>▭ Formes</b> : rectangle, rond, cœur, étoile, arche… (+ Forme ou ▭) avec couleur, dégradé, opacité, contour, ombre, forme libre.',
      '<b>Zoom</b> : ＋ / － et 100 % dans la barre d\'outils, Ctrl + molette, Ctrl + / Ctrl − / Ctrl 0.',
      '<b>Devant / derrière</b> : rubrique « Ordre » et barre du calque (⤒ ↑ ↓ ⤓), Ctrl+] / Ctrl+[ ; la liste des calques montre en haut ce qui est devant. Une photo ou vidéo peut devenir le <b>fond du plan</b> (« ▣ Mettre en fond du plan »).',
      '<b>🔍 Choisir un fond…</b> : recherche, classement <b>par événement</b> ou <b>par plan</b> (ouverture, intermédiaires, confirmation…), et appliquer à ce plan, aux plans du même type ou à tous.'
    ] },
    { id: '2026-11-10-1', date: '10 novembre 2026', titre: 'Rubrique « Vidéos » : tous les films de l\'équipe à publier', points: [
      'Nouveau menu <b>🎬 Vidéos</b> : tous les films terminés de l\'équipe au même endroit, avec qui l\'a fait, la date, et si le film est déjà <b>sur le site</b> ou pas.',
      'Filtres « Pas encore sur le site » / « Sur le site » / par membre ; <b>Publier sur le site</b> un film, une sélection (cases à cocher) ou <b>tout ce qui manque</b> d\'un coup ; « Retirer du site ».',
      'Sur le site, les films ont maintenant leur propre rubrique <b>« Nos vidéos réalisées »</b>, séparée des modèles d\'invitation (lien « Vidéos » en haut de la page).',
      'Corrigé : depuis le 4 novembre, « Publier sur la vitrine » et « ⇪ pour toute l\'équipe » (polices) échouaient à la lecture du site. Rien n\'a été abîmé ; ça remarche.'
    ] },
    { id: '2026-11-09-1', date: '9 novembre 2026', titre: 'Sauvegarde automatique de tout, même si le PC s\'éteint ou si la connexion coupe', points: [
      '<b>Les invitations</b> : enregistrées à chaque modification sur cet ordinateur (copie de secours « sûre », qui résiste à une coupure de courant), une version toutes les 2 minutes (« 🕘 Versions »), et en ligne avec l\'équipe. Rien à faire.',
      '<b>Tout le reste aussi</b> : bibliothèque (fonds, photos, vidéos importés), mes polices, styles, règles, préférences, réglages. Copie de secours sur cet ordinateur ; s\'il a perdu ses données, tout est remis à l\'ouverture du studio.',
      '<b>En ligne (équipe)</b> : bibliothèque et polices, fichiers compris, envoyées automatiquement, et renvoyées dès que la connexion revient. Sur un autre PC : Événements → « ☁ Récupérer depuis la copie en ligne » → <b>📚 Bibliothèque, mes polices et préférences</b>.',
      '<b>Invités</b> : si la connexion (ou le serveur) ne répond pas au moment de confirmer, la réponse reste sur le téléphone de l\'invité et part toute seule plus tard.',
      '<b>Espace organisateur</b> : sans connexion, les familles ajoutées ou modifiées restent sur le téléphone et partent toutes seules au retour de la connexion ; la dernière liste reste visible hors connexion.',
      'À faire une fois : Réglages → <b>« Mise à jour sauvegarde en ligne »</b>, coller dans Supabase → SQL Editor → Run.'
    ] },
    { id: '2026-11-05-1', date: '5 novembre 2026', titre: 'Compte à rebours réglable, textes du haut dans le film, police Intro', points: [
      '<b>Compte à rebours</b> : touchez le texte du compte à rebours (plan de confirmation) → bloc <b>⏱ Compte à rebours</b> : affichage (jours-heures-minutes-secondes, jours et heures, jours seulement, horloge 12 : 05 : 33 : 10), mots des unités (« andro », « ora »…), date et heure visées, texte le jour J. Bouton « ⏱ Ajouter le compte à rebours » sur n\'importe quel texte.',
      '<b>Film téléchargé</b> : les textes du haut de la confirmation réservés au lien personnel (« Réponse à l\'invitation », « Ho an\'i {famille} », « {places} olona »…) sont maintenant dans le film pour tout le monde. Film et publication → « {famille} devient » / « {places} devient » pour choisir ce qui s\'affiche.',
      'Un nombre écrit entre accolades (ex. « {4} ») s\'affiche maintenant sans les accolades.',
      '<b>Intro Regular</b> : dans la liste des polices (★ Demandées), touchez « Intro » et choisissez son fichier .ttf / .otf : elle est ajoutée pour toute l\'équipe.'
    ] },
    { id: '2026-11-04-4', date: '4 novembre 2026', titre: 'Adultes / enfants par famille, réponses en direct, pause sur l\'invitation', points: [
      '<b>Jeton GitHub refusé</b> : une petite fenêtre demande maintenant le nouveau jeton, le vérifie, puis la publication reprend toute seule.',
      '<b>Espace organisateur → Ajouter / Modifier une famille</b> : nombre d\'<b>adultes</b> et d\'<b>enfants</b> invités. L\'invité ne peut pas confirmer plus que ce nombre.',
      '<b>Réponses en direct</b> : alerte « ✓ X vient : 2 adultes, 1 enfant » ou « ✗ X ne vient pas » dès qu\'un invité répond ; totaux des personnes qui viennent / ne viennent pas / sans réponse.',
      '<b>Invitation</b> : l\'invité touche la vidéo pour la mettre en pause (▶ au centre pour reprendre).',
      'À faire une fois : Réglages → <b>« Mise à jour adultes / enfants »</b>, coller dans Supabase → SQL Editor → Run.'
    ] },
    { id: '2026-11-04-3', date: '4 novembre 2026', titre: 'Commandes depuis la vitrine, démo puis version finale avec licence', points: [
      '<b>Équipe → « Tout publier sur la vitrine »</b> : toutes les invitations et tous les films de l\'équipe qui n\'y sont pas encore, d\'un coup (noms remplacés par des exemples).',
      '<b>Vitrine</b> : chaque modèle a un bouton « Commander ce modèle ». Le visiteur lit et accepte les conditions (formules, prix, délai, paiement, licence), puis envoie toutes les informations : événement, noms, lieux, texte, couleurs, musique, photos.',
      '<b>Menu « Commandes »</b> (admin) : les commandes arrivent avec un numéro et un badge rouge. « Créer l\'invitation depuis le modèle » : le modèle est copié avec les noms, lieux, date et contacts du client, ses couleurs et ses photos ; vous ajustez ensuite.',
      '<b>Livraison</b> (onglet Film et publication) : 1. Démo marquée « DÉMO », réponses désactivées (+ film démo filigrané) → envoyée au client sur WhatsApp ; 2. après paiement, version finale avec un <b>code licence</b> personnel : l\'invitation ne marche que pour cet événement, et vous pouvez désactiver la licence (Commandes → Licences).',
      '<b>Commandes → Conditions de la vitrine</b> : vos formules, prix, délai, paiement et conditions, publiés sur le site.',
      'Les vidéos et photos de l\'équipe sont maintenant gardées sur l\'ordinateur après le premier téléchargement : le studio s\'ouvre plus vite et consomme beaucoup moins le forfait Supabase.'
    ] },
    { id: '2026-11-04-2', date: '4 novembre 2026', titre: 'Forme du cadre des photos', points: [
      'Choisissez une photo (ou une vidéo) : bouton <b>◇ Forme</b> dans la barre au-dessus de l\'aperçu, ou bloc « Forme du cadre » à droite.',
      '24 formes : rectangle, coins arrondis (arrondi réglable), rond / ovale, pilule, arche, arche double, cœur, étoile, étoile douce, fleur, nuage, goutte, feuille, forme organique, losange, triangle, pentagone, hexagone, octogone, coins coupés, parallélogramme, bas en vague…',
      '<b>✎ Forme libre</b> : partez de n\'importe quelle forme et déplacez ses points sur la photo ; double-clic sur un trait pour ajouter un point, sur un point pour le retirer ; « Courbes douces » pour des bords arrondis.',
      'Bordure qui suit la forme (couleur, épaisseur) et ombre. Marche aussi pour plusieurs photos choisies ensemble, dans l\'invitation et dans le film.'
    ] },
    { id: '2026-11-04-1', date: '4 novembre 2026', titre: 'Télécharger un fond · polices demandées en premier', points: [
      '<b>⬇ Télécharger</b> sur chaque fond, photo et vidéo de la Bibliothèque (les vôtres, ceux de l\'équipe et les fonds de base) : le fichier est enregistré sur l\'ordinateur.',
      'Liste des polices : nouvel onglet <b>★ Demandées</b>, ouvert en premier : League Spartan, Accidental Presidency, Intro (à importer, police payante), Urbanist, Archivo, Outfit, Cabin, League Gothic.'
    ] },
    { id: '2026-11-03-5', date: '3 novembre 2026', titre: 'Accidental Presidency, polices du studio pour toute l\'équipe', points: [
      '<b>Accidental Presidency</b> est maintenant dans le studio pour tout le monde (onglet « Polices du studio » de la liste des polices), dans les invitations et dans le film.',
      '<b>Intro</b> est une police payante (Fontfabric) : une fois achetée, importez son fichier (« + Importer une police »), puis « ⇪ pour toute l\'équipe » : elle est mise dans le studio et toute l\'équipe l\'a, sans rien refaire.'
    ] },
    { id: '2026-11-03-4', date: '3 novembre 2026', titre: 'Avertissement de nouvelle version, aperçu jusqu\'au remerciement', points: [
      'Quand une nouvelle version du studio est en ligne, un bandeau « Recharger maintenant » apparaît (un onglet resté ouvert longtemps gardait l\'ancienne version).',
      'Aperçu « ▶ Toute l\'invitation » : après 8 s sur la confirmation, l\'aperçu continue tout seul vers le remerciement (sur la vraie invitation, il vient après la réponse de l\'invité).',
      'Polices : League Spartan est dans « Modernes » (tapez « league » dans la recherche). Intro et Accidental Presidency ne sont pas chez Google : importez leur fichier avec « + Importer une police ». En attendant, polices proches ajoutées : League Gothic (proche d\'Accidental Presidency) et Urbanist (proche d\'Intro).'
    ] },
    { id: '2026-11-03-3', date: '3 novembre 2026', titre: 'Le remerciement final s\'affiche toujours', points: [
      'Après « Je confirme » ou « Je ne pourrai pas venir », le message de réponse se met en haut de l\'écran et se ferme tout seul : le plan de remerciement n\'est plus caché.',
      'Réponse à envoyer par WhatsApp : le remerciement vient juste après l\'envoi (ou après « Fermer »).',
      'Invitations de la vitrine (démos) : plus de nom demandé, on passe directement au remerciement.'
    ] },
    { id: '2026-11-03-2', date: '3 novembre 2026', titre: 'Alignement du texte, rotation, nouvelles polices, fonds choisis plan par plan', points: [
      '<b>Alignement du texte</b> : 4 boutons dans la barre au-dessus de l\'aperçu (gauche, centré, droite, <b>justifié</b>), aussi pour plusieurs textes à la fois.',
      '<b>⟳ Rotation</b> : poignée ronde au-dessus de l\'élément choisi (par 15°, ou librement avec Maj), ou réglage précis dans « Position » (⟲ ⟳ 0°). Marche pour les textes, photos, vidéos, illustrations et boutons, et dans le film.',
      '<b>Polices</b> : League Spartan, Cabin, Outfit, Archivo et Archivo Black ajoutées ; nouveau choix « Épaisseur des lettres » (de très fine à noire, ex. Archivo 800 ou 900).',
      '<b>Mes polices</b> : « + Importer une police » (fichier .ttf, .otf, .woff) dans la liste des polices, pour les polices qui ne sont pas chez Google (Intro, Accidental Presidency…). Elle part avec l\'invitation publiée, le film et les modèles d\'équipe.',
      '<b>Nouvel événement</b> : l\'étape 3 devient « Fonds, plan par plan » : vous choisissez vous-même le fond de chaque plan, dans l\'ordre (le studio passe au plan suivant), ou une couleur unie ; « Ce fond pour les plans suivants » ; rien n\'est réparti au hasard.'
    ] },
    { id: '2026-11-03-1', date: '3 novembre 2026', titre: 'Règles, sélection multiple, polices, emojis, illustrations, fonds couleur / photo / sans fond, rogner, pause', points: [
      '<b>📏 Règles</b> (sous l\'aperçu) : règles graduées autour de l\'aperçu ; tirez depuis une règle pour poser un repère bleu (double-clic ou glisser dehors pour l\'effacer). En déplaçant un élément, il s\'aimante au centre, aux repères et aux bords des autres éléments (traits roses). Maj pour déplacer sans aimant.',
      '<b>Plusieurs éléments à la fois</b> : Maj+clic (ou Ctrl+clic), ou tracez un cadre sur l\'aperçu, ou Ctrl+A. Ils se déplacent ensemble (souris ou flèches), et la barre propose : aligner (gauche, centre, droite, haut, milieu, bas), répartir, couleur et police pour tous, agrandir, dupliquer, copier-coller, supprimer.',
      '<b>⏸ Pause</b> pendant la lecture (bouton ou barre d\'espace), et aussi sur la page de l\'invitation pour les invités.',
      '<b>Polices</b> : plus de 60 polices Google (manuscrites, élégantes, modernes, fantaisie), chacune montrée avec son dessin, avec recherche et « Récentes ».',
      '<b>😊 Emojis</b> : dans un texte (bouton 😊) ou en élément seul (« + Emoji »), rangés par thème.',
      '<b>✿ Illustrations</b> : « + Illustration » : cœurs, alliances, coupes, colombe, bouquet, fleurs, croix, église, ourson, ballons, fanions, cadres, séparateurs… aux couleurs de l\'invitation, recolorables.',
      '<b>Fond du plan</b> : 🎬 Vidéo, 🖼 Photo, 🎨 Couleur (unie ou dégradé) ou ▦ Sans fond (transparent). « Appliquer ce fond à tous les plans ».',
      '<b>▦ Vidéo sans fond (WebM)</b> dans Film et publication : vidéo transparente à poser sur une autre vidéo (CapCut, Premiere…).',
      '<b>⬚ Rogner</b> une vidéo ou une photo (fond ou élément posé) : formats libre, 1:1, 4:5, 9:16, 16:9…',
      '<b>Plus rien ne disparaît</b> : le film télécharge d\'abord les vidéos en ligne (fonds de l\'équipe) pour que chaque image ait son fond ; une vidéo qui se recharge garde sa dernière image ; les photos sont attendues ; les boutons de réponse sont toujours dans le film ; « Film pour » une famille met les textes à son nom (« Ho an\'i {famille} »).'
    ] },
    { id: '2026-11-02-7', date: '2 novembre 2026', titre: 'Fond, ombre et contour des textes · vitesse des vidéos · toutes les vidéos de l\'équipe', points: [
      '<b>Textes</b> : nouveau panneau « Fond, ombre, contour » : arrière-plan (couleur, opacité, marge, arrondi), ombre (halo ou ombre portée : couleur, flou, intensité, décalage), contour (couleur, épaisseur). Styles rapides : Lisible sur fond chargé, Bandeau, Néon.',
      '<b>Vitesse des vidéos</b> : du ralenti ×0,25 à l\'accéléré ×3, pour le fond d\'un plan (panneau Fond vidéo) et pour chaque vidéo posée. Le film MP4 respecte la vitesse.',
      '<b>Équipe</b> : page Équipe → « Toutes les vidéos de l\'équipe » : films terminés et fonds vidéo de chacun, visibles par tous, avec filtres (type, membre), lecture et téléchargement.',
      '« + Ajouter un film terminé » : mettez dans l\'équipe un film déjà fabriqué (MP4). Et si l\'envoi automatique d\'un film échoue, un bouton « Réessayer » apparaît.'
    ] },
    { id: '2026-11-02-6', date: '2 novembre 2026', titre: 'Publication sur la vitrine plus fiable', points: [
      'Le studio relit toujours le dernier jeton GitHub enregistré (même s\'il a été changé dans un autre onglet) : plus d\'erreur « Bad credentials » avec un ancien jeton.',
      'Si GitHub refuse le jeton, un message clair explique quoi faire (Réglages → GitHub → nouveau jeton → Tester).',
      'Corrigé : l\'erreur « GitHub 422 sha wasn\'t supplied » à la fin de la publication (le studio réessaie automatiquement).',
      'Les fichiers déjà copiés ne sont pas recopiés : relancer une publication est rapide.'
    ] },
    { id: '2026-11-02-5', date: '2 novembre 2026', titre: 'Couper, superposition, modèles et films de l\'équipe', points: [
      '<b>✂ Couper une vidéo</b> : bouton « ✂ Couper » sur le fond d\'un plan et sur chaque vidéo posée : vous gardez seulement le passage voulu (début / fin).',
      '<b>Superposition</b> : pour chaque photo, vidéo ou texte, un mode de fusion avec le fond (produit, écran, superposition, lumière douce…).',
      '<b>Film</b> : tous les boutons apparaissent maintenant dans le film (et sur la vitrine du site).',
      '<b>Équipe</b> : chaque membre voit tous les modèles de l\'équipe (« Utiliser ce modèle ») et tous les films ; chaque film fabriqué y arrive tout seul.',
      '<b>Admin</b> : « Publier sur la vitrine » pour les films de l\'équipe ; les visiteurs du site les regardent dans « Modèles à essayer ».',
      '<b>Lien général</b> : quand l\'invité tape son nom, la liste des invités lui propose le sien ; sa réponse va directement à sa famille chez l\'organisateur.'] },
    { id: '2026-11-02-4', date: '2 novembre 2026', titre: 'Film complet, confirmation par le lien général, vitrine de l\'équipe', points: [
      '<b>Film</b> : le fond ne disparaît plus (chaque image attend que la vidéo soit prête), et le <b>plan de confirmation</b> est maintenant dans le film (7 s).',
      '<b>Lien général</b> : les invités peuvent aussi confirmer ou refuser (avec les compteurs) ; ils donnent leur nom, et la réponse arrive tout de suite chez l\'organisateur.',
      '<b>Admin</b> : dans la page Équipe, « Publier sur la vitrine » met l\'invitation d\'un membre sur la vitrine du site (anonymisée ou non), et « Retirer » l\'enlève. Les fichiers de chaque invitation sont envoyés tout seuls dans l\'espace d\'équipe pour cela.'] },
    { id: '2026-11-02-3', date: '2 novembre 2026', titre: 'Travail en équipe', points: [
      '<b>Un seul lien pour toute l\'équipe</b> (Réglages → Équipe) : chacun entre son nom, et c\'est tout.',
      '<b>Bibliothèque commune</b> : les fonds et images animées de chacun sont visibles et utilisables par toute l\'équipe (partage automatique, ou « Partager avec l\'équipe »).',
      '<b>Page Équipe pour l\'admin</b> : le travail de chaque membre, toutes les invitations (avec « Ouvrir une copie »), et le temps de fabrication de chaque vidéo.',
      'Chaque vidéo affiche son <b>temps de fabrication</b> (⏱ créé en 4 min 12 s) : fond Wan 2.2, image animée, recoloration et film.'] },
    { id: '2026-11-02-2', date: '2 novembre 2026', titre: 'Film MP4 complet, transitions, compteurs', points: [
      '<b>Film vidéo</b> : fabriqué image par image en MP4 (H.264 + son AAC). Il va jusqu\'au bout, s\'ouvre partout (téléphone, WhatsApp, QuickTime), avec la chanson qui baisse doucement à la fin. Vous pouvez changer d\'onglet pendant la fabrication.',
      'Les <b>boutons</b> (Sarintany, Antsoy…) apparaissent maintenant dans le film ; seuls les boutons qui ne servent qu\'en ligne (Dingano, Jereo indray, Zarao) n\'y sont pas.',
      '<b>Transitions</b> corrigées (le texte du plan précédent ne disparaît plus d\'un coup) et 6 nouvelles : glissement vers le haut, zoom, flou, volet, rideau, cercle. Durée réglable et bouton « ▶ Voir la transition ».',
      '<b>Compteurs</b> adultes / enfants : − et + marchent aussi dans l\'aperçu du studio ; au maximum de places, le compteur le signale.'] },
    { id: '2026-11-02-1', date: '2 novembre 2026', titre: 'Remerciement et nouveautés', points: [
      'Le plan de <b>remerciement</b> s\'affiche bien après « Ho tonga izahay », « Tsy ho afaka izahay » ou « Hamaly amin\'ny WhatsApp » (lien général), dans l\'invitation et dans l\'aperçu du studio.',
      'Quand la <b>date limite</b> des réponses est passée, le film continue tout seul vers le remerciement (au lieu de rester bloqué), et le studio vous prévient.',
      'Ce panneau « Nouveautés » s\'affiche à chaque mise à jour du studio ; tout l\'historique est dans le menu <b>Nouveautés</b>.'] },
    { id: '2026-10-31-3', date: '31 octobre 2026', titre: 'Catégories d\'invités', points: [
      'Dans le lien organisateur : catégories proposées (Fianakaviana avy amin\'ny ray, avy amin\'ny reny, Namana, Mpiara-miasa…), ＋ nouvelle catégorie, renommer, retirer, filtrer.'] },
    { id: '2026-10-31-2', date: '31 octobre 2026', titre: 'Invitation en plusieurs langues', points: [
      'Fiche → Langues de l\'invitation ; Plans → 🌐 Traduire ; l\'invité choisit sa langue d\'un clic (bouton 🌐).',
      'Bouton « 🔗 Liens du client » en haut de chaque événement : le lien des invités et le lien organisateur.'] },
    { id: '2026-10-31-1', date: '31 octobre 2026', titre: 'Lien organisateur, brouillons, vitrine', points: [
      'Lien organisateur privé : le client ajoute ses invités et voit qui vient, combien.',
      'Les vidéos créées sont gardées en brouillon tout de suite, et récupérées après une coupure.',
      'Vitrine du site : montrer une invitation (anonymisée ou non), la retirer.'] },
    { id: '2026-10-30-1', date: '30 octobre 2026', titre: 'Créer avec l\'IA, chanson, bibliothèque par événement', points: [
      '« ✨ Créer avec l\'IA » dans la Bibliothèque : Recolorer, Fond Wan 2.2, Animer une image.',
      'Chanson : tous les formats, début réglable.', 'Chaque événement a sa propre bibliothèque.'] },
  ];
  // Nouvelle version du studio en ligne : on le signale (un onglet resté ouvert garde l'ancienne)
  const VERSION_CHARGEE = ((document.querySelector('script[src*="studio.js"]') || {}).src || '').split('v=')[1] || '';
  async function verifierVersion() {
    try {
      const h = await (await fetch('index.html?t=' + Date.now(), { cache: 'no-store' })).text();
      const v = (h.match(/studio\.js\?v=(\d+)/) || [])[1];
      if (v && VERSION_CHARGEE && v !== VERSION_CHARGEE && !$('#nouvelle-version')) {
        const d = document.createElement('div'); d.id = 'nouvelle-version';
        d.innerHTML = '<b>Nouvelle version du studio disponible.</b> <span>Votre travail est enregistré.</span> <button class="btn petit plein">Recharger maintenant</button>';
        d.querySelector('button').onclick = () => { try { sauverProjets(); } catch (e) {} location.reload(); };
        document.body.appendChild(d);
      }
    } catch (e) {}
  }
  setInterval(verifierVersion, 4 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verifierVersion(); });
  function panneauNouveautes() {
    const vu = Stock.lire('studio.nouveautes.vu', '');
    const nouvelles = NOUVEAUTES.filter(n => n.id > vu).slice(0, vu ? 10 : 1);
    if (!nouvelles.length || $('.nouveautes-panneau')) return;
    const d = document.createElement('div'); d.className = 'nouveautes-panneau';
    d.innerHTML = `<div class="np-tete"><b>🆕 Mise à jour du studio</b><button class="modale-fermer" aria-label="Fermer">×</button></div>
      ${nouvelles.map(n => `<div class="np-bloc"><div class="muet">${n.date}</div><b>${n.titre}</b><ul>${n.points.map(x => `<li>${x}</li>`).join('')}</ul></div>`).join('')}
      <div class="ligne"><button class="btn plein petit" data-ok>J'ai compris</button><a class="btn petit" href="#/nouveautes">Tout l'historique</a></div>`;
    document.body.appendChild(d);
    const ok = () => { Stock.ecrire('studio.nouveautes.vu', NOUVEAUTES[0].id); d.remove(); };
    $('[data-ok]', d).onclick = ok; $('.modale-fermer', d).onclick = ok; $('a', d).onclick = ok;
  }
  function vueNouveautes() {
    $('#app').innerHTML = `<div class="entete"><div><h1>Nouveautés</h1><p>Ce qui a changé dans le studio, du plus récent au plus ancien.</p></div></div>
      <div class="pile" style="max-width:820px">${NOUVEAUTES.map(n => `<div class="carte pile"><div class="muet">${n.date}</div><h3 style="margin:0">${n.titre}</h3><ul style="margin:0;padding-left:20px">${n.points.map(x => `<li>${x}</li>`).join('')}</ul></div>`).join('')}</div>`;
    Stock.ecrire('studio.nouveautes.vu', NOUVEAUTES[0].id);
  }
  setTimeout(panneauNouveautes, 1200);

  function route() {
    nettoyer();
    const h = location.hash.replace(/^#\/?/, '').split('/');
    $$('.barre nav a').forEach(a => a.classList.toggle('actif', a.dataset.nav === (h[0] || 'accueil') || (h[0] === 'p' && a.dataset.nav === 'accueil')));
    window.scrollTo(0, 0);
    if (h[0] === 'nouveau') return vueNouveau();
    if (h[0] === 'bibliotheque') return vueBibliotheque();
    if (h[0] === 'reglages') return vueReglages();
    if (h[0] === 'guide') return vueGuide();
    if (h[0] === 'nouveautes') return vueNouveautes();
    if (h[0] === 'rejoindre') return vueRejoindre(h[1], h[2]);
    if (h[0] === 'equipe') return vueEquipe();
    if (h[0] === 'videos') return vueVideos();
    if (h[0] === 'commandes') return vueCommandes(h[1]);
    if (h[0] === 'p' && projets[h[1]]) return vueProjet(projets[h[1]], h[2] || 'plans');
    return vueAccueil();
  }
  window.addEventListener('hashchange', route);

  /* ================= Accueil ================= */
  function vueAccueil() {
    const liste = Object.values(projets).sort((a, b) => (b.modifie || '').localeCompare(a.modifie || ''));
    $('#app').innerHTML = `
      <div class="entete"><div><h1>Vos événements</h1><p>Chaque invitation part d'un texte et de quelques fonds vidéo vierges.</p></div>
        <div class="ligne">${Equipe.actif() ? '<button class="btn" id="recup-ligne" title="Après une panne ou sur un autre ordinateur">☁ Récupérer depuis la copie en ligne</button>' : ''}<label class="btn">Importer un projet<input type="file" accept=".json" id="imp-projet" hidden></label><a class="btn plein" href="#/nouveau">+ Nouvel événement</a></div></div>
      ${liste.length ? `<div class="grille">${liste.map(p => `
        <div class="carte projet-carte" data-id="${p.id}">
          <img src="${esc(vignettePlan(p.plans.find(x => x.role !== 'ouverture') || p.plans[0] || {}))}" alt="">
          <div><h3>${esc(p.fiche.titre)}</h3>
            <div class="muet">${esc(MoteurInfo.dateLisible(p.fiche.date, p.fiche.langue))}</div>
            <div class="muet">${p.plans.length} plans · ${(p.familles || []).length} familles</div>
            <div style="margin-top:6px">${p.publie ? '<span class="badge ok">Publié</span>' : '<span class="badge">Brouillon</span>'}</div></div>
        </div>`).join('')}</div>` : `
        <div class="carte vide"><h2>Aucun événement pour l'instant</h2><p class="muet">Collez le texte d'une invitation : le studio en tire les informations et propose les plans.</p><a class="btn plein" href="#/nouveau">Créer le premier événement</a>
        <p style="margin-top:14px"><button class="btn" id="demo">Charger l'exemple « Jobily faha-10 taona mariazy — Batemy »</button></p></div>`}`;
    $$('.projet-carte').forEach(c => c.onclick = () => { location.hash = '#/p/' + c.dataset.id + '/plans'; });
    const rl = $('#recup-ligne'); if (rl) rl.onclick = recupererEnLigne;
    const imp = $('#imp-projet');
    if (imp) imp.onchange = async () => {
      try { const p = JSON.parse(await imp.files[0].text()); if (!p.plans || !p.fiche) throw new Error(); p.id = p.id || uid(); projets[p.id] = p; sauverProjets(); toast('Projet importé'); route(); }
      catch (e) { toast('Fichier projet invalide'); }
    };
    const d = $('#demo');
    if (d) d.onclick = () => { const f = Fabrique.analyserTexte(TEXTE_EXEMPLE); const p = Fabrique.nouveauProjet(f, tousFonds()); projets[p.id] = p; sauverProjets(); location.hash = '#/p/' + p.id + '/plans'; };
  }

  const TEXTE_EXEMPLE = `ANDRIATSIDIKANA Dimbinirina Pierre sy RANDRIATSIMITOVIZAKA Njarasoa dia faly manasa anareo hanotrona ny fanamasinana ny jobily faha-folo taonan’ny mariazinay, sy ny Batemin’ny zanakay ANDRIATSIDIKANA Mihaja Kaël.

Hatao ny Sabotsy 7 Novambra 2026, amin’ny 8 ora maraina, ao amin’ny Ekar Kristy Mpanjaka Manjakaray.
Aorian’izay, dia mahafaly anay ny manasa olona ……… avy aminareo hiara-hikorana sy hizara hafaliana aminay ao amin’ny Espace Fenitra, By Pass.
Raha misy tsy fahafahana, iangaviana mba hampandre mialohan’ny 31 Oktobra 2026.
Fifandraisana:

* Tsidy : 034 22 174 97
* Njara : 034 27 541 47

Sary: Jobily faha-10 taona mariazy — Batemy`;

  /* ================= Nouvel événement (texte → fiche → fonds) ================= */
  let brouillon = null;
  function vueNouveau() {
    brouillon = brouillon || { etape: 1, texte: '', fiche: null, fonds: tousFonds().map(f => f.id) };
    const e = brouillon.etape;
    const etapes = `<div class="etapes"><span class="${e === 1 ? 'actif' : ''}">1. Texte de l'invitation</span><span class="${e === 2 ? 'actif' : ''}">2. Fiche événement</span><span class="${e === 3 ? 'actif' : ''}">3. Fonds, plan par plan</span></div>`;
    if (e === 1) {
      $('#app').innerHTML = `<div class="entete"><div><h1>Nouvel événement</h1><p>Collez le texte de l'invitation tel que le client l'a écrit, en malgache ou en français.</p></div></div>${etapes}
        <div class="ia-grille">
          <div class="carte pile">
            <label class="champ">Texte de l'invitation<textarea id="texte" rows="16" placeholder="Noms, événement, date, heure, lieux, nombre d'invités (………), date limite, contacts, Sary : titre…">${esc(brouillon.texte)}</textarea></label>
            <div class="ligne"><button class="btn plein" id="analyser">Analyser le texte</button><button class="btn" id="exemple">Utiliser l'exemple</button></div>
          </div>
          <div class="carte pile">
            <h3>Ou avec l'aide de ChatGPT / Claude</h3>
            <p class="muet">Plus fiable pour les textes inhabituels : copiez le prompt, envoyez-le, puis collez ici la réponse.</p>
            <button class="btn ia" id="prompt0">Copier le prompt 0 (texte → fiche)</button>
            <label class="champ">Réponse de l'IA (JSON)<textarea id="rep0" rows="8" placeholder='{"titre": "...", ...}'></textarea></label>
            <button class="btn" id="appliquer0">Utiliser cette réponse</button><div id="err0"></div>
          </div>
        </div>`;
      $('#exemple').onclick = () => { $('#texte').value = TEXTE_EXEMPLE; };
      $('#analyser').onclick = () => {
        brouillon.texte = $('#texte').value.trim();
        if (!brouillon.texte) return toast('Collez d\'abord le texte');
        brouillon.fiche = Fabrique.analyserTexte(brouillon.texte); brouillon.etape = 2; vueNouveau();
      };
      $('#prompt0').onclick = () => { brouillon.texte = $('#texte').value.trim(); copier(Fabrique.prompt0(brouillon.texte)); };
      $('#appliquer0').onclick = () => {
        try {
          const j = Fabrique.lireJSON($('#rep0').value);
          const base = Fabrique.analyserTexte($('#texte').value || '');
          brouillon.texte = $('#texte').value.trim();
          brouillon.fiche = Object.assign(base, {
            titre: j.titre || base.titre, type: j.type || base.type, langue: j.langue === 'mg' || j.langue === 'malgache' ? 'mg' : (j.langue ? 'fr' : base.langue),
            hotes: j.hotes || base.hotes, celebres: j.celebres || j.personnes_celebrees || base.celebres, date: j.date || base.date, heure: j.heure || base.heure,
            lieux: (j.lieux || base.lieux).map(l => Object.assign({ adresse: '', maps: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((l.nom || '') + ' ' + (l.adresse || '')) }, l)),
            date_limite: j.date_limite || base.date_limite, contacts: j.contacts || base.contacts, phrases: j.phrases || base.phrases, remerciement: j.remerciement || base.remerciement || '',
            a_verifier: j.a_verifier || []
          });
          brouillon.etape = 2; vueNouveau();
        } catch (err) { $('#err0').innerHTML = `<div class="erreur-boite">${esc(err.message)}</div>`; }
      };
      return;
    }
    if (e === 2) {
      const f = brouillon.fiche;
      const ligneLieu = (l, i) => `<div class="trois" data-lieu="${i}"><input type="text" data-k="nom" value="${esc(l.nom)}" placeholder="Nom du lieu"><select data-k="role"><option value="ceremonie" ${l.role === 'ceremonie' ? 'selected' : ''}>Cérémonie</option><option value="reception" ${l.role === 'reception' ? 'selected' : ''}>Réception</option></select><input type="url" data-k="maps" value="${esc(l.maps)}" placeholder="Lien Google Maps"></div>`;
      const ligneContact = (c, i) => `<div class="deux" data-contact="${i}"><input type="text" data-k="nom" value="${esc(c.nom)}" placeholder="Nom"><input type="text" data-k="telephone" value="${esc(c.telephone)}" placeholder="034 00 000 00"></div>`;
      const ligneHote = (h, i) => `<div class="deux" data-hote="${i}"><input type="text" data-k="nom_complet" value="${esc(h.nom_complet)}" placeholder="Nom complet"><input type="text" data-k="surnom" value="${esc(h.surnom)}" placeholder="Prénom usuel"></div>`;
      const ligneCel = (h, i) => `<div class="deux" data-cel="${i}"><input type="text" data-k="nom_complet" value="${esc(h.nom_complet)}" placeholder="Nom complet"><input type="text" data-k="occasion" value="${esc(h.occasion)}" placeholder="Occasion (Batemy…)"></div>`;
      $('#app').innerHTML = `<div class="entete"><div><h1>Fiche événement</h1><p>Relisez et corrigez ce que le studio a compris.</p></div></div>${etapes}
        ${f.a_verifier && f.a_verifier.length ? `<div class="alerte-boite" style="margin-bottom:14px"><b>À vérifier :</b><ul class="liste-mini">${f.a_verifier.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
        <div class="ia-grille">
          <div class="carte pile">
            <label class="champ">Titre (Sary)<input type="text" id="f-titre" value="${esc(f.titre)}"></label>
            <div class="deux"><label class="champ">Type<input type="text" id="f-type" value="${esc(f.type)}"></label>
              <label class="champ">Langue des boutons<select id="f-langue"><option value="mg" ${f.langue === 'mg' ? 'selected' : ''}>Malgache</option><option value="fr" ${f.langue === 'fr' ? 'selected' : ''}>Français</option></select></label></div>
            <div class="trois"><label class="champ">Date<input type="date" id="f-date" value="${esc(f.date)}"></label><label class="champ">Heure<input type="time" id="f-heure" value="${esc(f.heure)}"></label><label class="champ">Date limite<input type="date" id="f-limite" value="${esc(f.date_limite)}"></label></div>
            <div><div class="section-titre">Hôtes <button class="btn petit" id="add-hote">+</button></div><div class="pile" id="hotes">${(f.hotes.length ? f.hotes : [{ nom_complet: '', surnom: '' }]).map(ligneHote).join('')}</div></div>
            <div><div class="section-titre">Personnes célébrées <button class="btn petit" id="add-cel">+</button></div><div class="pile" id="cels">${f.celebres.map(ligneCel).join('')}</div></div>
          </div>
          <div class="carte pile">
            <div><div class="section-titre">Lieux <button class="btn petit" id="add-lieu">+</button></div><div class="pile" id="lieux">${f.lieux.map(ligneLieu).join('')}</div></div>
            <div><div class="section-titre">Contacts <button class="btn petit" id="add-contact">+</button></div><div class="pile" id="contacts">${f.contacts.map(ligneContact).join('')}</div></div>
            <label class="champ">Phrases du texte (une par ligne, {places} = nombre d'invités)<textarea id="f-phrases" rows="7">${esc(f.phrases.join('\n'))}</textarea></label>
            <label class="champ">Phrase de remerciement (plan de fin)<input type="text" id="f-merci" value="${esc(f.remerciement)}" placeholder="${f.langue === 'mg' ? 'Voninahitra ho anay ny fahatongavanareo' : 'Votre présence sera pour nous un grand honneur'}"></label>
          </div>
        </div>
        <div class="ligne" style="margin-top:16px;justify-content:space-between"><button class="btn" id="retour">‹ Texte</button><button class="btn plein" id="suite">Continuer : choisir les fonds ›</button></div>`;
      const lire = () => {
        f.titre = $('#f-titre').value.trim(); f.type = $('#f-type').value.trim(); f.langue = $('#f-langue').value;
        f.date = $('#f-date').value; f.heure = $('#f-heure').value; f.date_limite = $('#f-limite').value;
        f.hotes = $$('[data-hote]').map(r => ({ nom_complet: $('[data-k=nom_complet]', r).value.trim(), surnom: $('[data-k=surnom]', r).value.trim() })).filter(h => h.nom_complet || h.surnom);
        f.celebres = $$('[data-cel]').map(r => ({ nom_complet: $('[data-k=nom_complet]', r).value.trim(), occasion: $('[data-k=occasion]', r).value.trim() })).filter(h => h.nom_complet);
        f.lieux = $$('[data-lieu]').map(r => ({ nom: $('[data-k=nom]', r).value.trim(), role: $('[data-k=role]', r).value, maps: $('[data-k=maps]', r).value.trim(), adresse: '' })).filter(l => l.nom);
        f.contacts = $$('[data-contact]').map(r => ({ nom: $('[data-k=nom]', r).value.trim(), telephone: $('[data-k=telephone]', r).value.trim() })).filter(c => c.nom || c.telephone);
        f.phrases = $('#f-phrases').value.split('\n').map(s => s.trim()).filter(Boolean);
        f.remerciement = $('#f-merci').value.trim();
      };
      $('#add-hote').onclick = () => { lire(); f.hotes.push({ nom_complet: '', surnom: '' }); vueNouveau(); };
      $('#add-cel').onclick = () => { lire(); f.celebres.push({ nom_complet: ' ', occasion: '' }); vueNouveau(); };
      $('#add-lieu').onclick = () => { lire(); f.lieux.push({ nom: ' ', role: 'reception', maps: '' }); vueNouveau(); };
      $('#add-contact').onclick = () => { lire(); f.contacts.push({ nom: ' ', telephone: '' }); vueNouveau(); };
      $('#retour').onclick = () => { lire(); brouillon.etape = 1; vueNouveau(); };
      $('#suite').onclick = () => {
        lire();
        if (!f.remerciement) { if (!confirm('Aucune phrase de remerciement : le studio mettra une phrase type, à remplacer ensuite. Continuer ?')) return; }
        if (!f.date) return toast('Indiquez la date de l\'événement');
        brouillon.etape = 3; vueNouveau();
      };
      return;
    }
    // Étape 3 : le fond de chaque plan, choisi à la main, plan par plan
    const fonds = tousFonds();
    const squelette = Fabrique.genererPlans(brouillon.fiche, Fabrique.FONDS);
    brouillon.choix = (brouillon.choix || []).slice(0, squelette.length);
    while (brouillon.choix.length < squelette.length) brouillon.choix.push(null);
    if (brouillon.planActif == null || brouillon.planActif >= squelette.length) brouillon.planActif = 0;
    const NOMS_ROLE = { ouverture: 'Ouverture', intermediaire: 'Plan', confirmation: 'Confirmation', remerciement: 'Remerciement' };
    const fondDe = id => { if (!id) return null; if (/^couleur:/.test(id)) return { id, nom: 'Couleur unie', couleur: id.slice(8), usage: 'couleur' }; return fonds.find(f => f.id === id) || null; };
    const imgDe = f => !f ? '' : f.couleur ? '' : (/^data:/.test(f.vignette || '') ? f.vignette : (f.vignette ? BASE + f.vignette : ''));
    let filtre = brouillon.filtreFonds || 'tous';
    const rendre = () => {
      const k = brouillon.planActif, restants = brouillon.choix.filter(x => !x).length;
      const usages = [...new Set(fonds.map(f => f.usage).filter(Boolean))];
      $('#app').innerHTML = `<div class="entete"><div><h1>Fonds, plan par plan</h1><p>Choisissez vous-même le fond de chaque plan, dans l'ordre : cliquez un fond, le studio passe tout seul au plan suivant.</p></div><label class="btn">Importer un fond<input type="file" id="e3-import" accept="video/*,image/*" multiple hidden></label></div>${etapes}
        <div class="e3">
          <div class="carte e3-plans">
            <div class="ligne" style="justify-content:space-between;margin-bottom:8px"><b>${squelette.length} plans</b><span class="badge ${restants ? 'alerte' : 'ok'}">${restants ? restants + ' à choisir' : 'tout est choisi ✓'}</span></div>
            ${squelette.map((pl, i) => { const f = fondDe(brouillon.choix[i]); const txt = (pl.calques || []).filter(c => c.type === 'texte').map(c => c.texte).join(' · ').replace(/\{famille\}/g, '…').slice(0, 70); return `<div class="e3-plan ${i === k ? 'actif' : ''} ${f ? '' : 'vide'}" data-k="${i}">
              <div class="e3-mini" style="${f && f.couleur ? 'background:' + f.couleur : ''}">${f && !f.couleur ? `<img src="${esc(imgDe(f))}" alt="">` : f ? '' : '?'}</div>
              <div style="min-width:0"><b>${i + 1}. ${NOMS_ROLE[pl.role] || pl.role}</b><div class="muet e3-txt">${esc(txt || (pl.role === 'ouverture' ? 'Ouverture de l\'invitation' : '—'))}</div><div class="e3-nom">${f ? esc(f.nom) : '<span class="alerte-txt">Fond à choisir</span>'}</div></div>
              ${f ? `<button class="e3-x" data-effacer="${i}" title="Retirer ce fond">✕</button>` : ''}</div>`; }).join('')}
            <div class="ligne" style="gap:6px;margin-top:10px;flex-wrap:wrap"><button class="btn petit" id="e3-suivants" ${brouillon.choix.some(Boolean) && restants ? '' : 'disabled'} title="Met le dernier fond choisi sur tous les plans qui n'en ont pas encore">Dernier fond choisi → plans restants</button><button class="btn petit" id="e3-vider">Tout effacer</button></div>
          </div>
          <div class="carte e3-biblio">
            <div class="ligne" style="justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px"><b>Fond du plan ${k + 1} · ${NOMS_ROLE[squelette[k].role] || ''}</b>
              <div class="seg">${[['tous', 'Tous']].concat(usages.map(u => [u, u])).map(([u, n]) => `<button data-filtre="${esc(u)}" class="${filtre === u ? 'on' : ''}">${esc(n)}</button>`).join('')}</div></div>
            <div class="fonds-choix">${fonds.filter(f => filtre === 'tous' || f.usage === filtre).map(f => `
              <div class="fond-choix ${brouillon.choix[k] === f.id ? 'actif' : ''}" data-id="${esc(f.id)}"><img src="${esc(imgDe(f))}" alt="" loading="lazy"><b>${esc(f.nom)}</b><div class="muet">${esc(f.usage || '')}${f.duree ? ' · ' + f.duree.toFixed(1) + ' s' : ''}${f.equipe ? ' · équipe' : ''}${brouillon.choix.filter(x => x === f.id).length ? ' · ' + brouillon.choix.filter(x => x === f.id).length + ' plan(s)' : ''}</div></div>`).join('')}
              <div class="fond-choix couleur-choix ${/^couleur:/.test(brouillon.choix[k] || '') ? 'actif' : ''}"><div class="couleur-apercu" style="background:${/^couleur:/.test(brouillon.choix[k] || '') ? brouillon.choix[k].slice(8) : '#f4ede2'}"></div><b>Couleur unie</b><div class="ligne" style="gap:6px"><input type="color" id="e3-couleur" value="${/^couleur:/.test(brouillon.choix[k] || '') ? brouillon.choix[k].slice(8) : '#f4ede2'}"><button class="btn petit" id="e3-couleur-ok">Choisir</button></div></div>
            </div>
          </div>
        </div>
        <div class="ligne" style="margin-top:16px;justify-content:space-between"><button class="btn" id="retour">‹ Fiche</button><button class="btn plein" id="creer">Créer les plans ›</button></div>`;
      const attribuer = id => {
        brouillon.choix[k] = id; brouillon.dernier = id;
        const suivant = brouillon.choix.findIndex((x, i) => i > k && !x);
        if (suivant >= 0) brouillon.planActif = suivant; else if (k < squelette.length - 1 && !brouillon.choix.every(Boolean)) brouillon.planActif = brouillon.choix.findIndex(x => !x);
        rendre();
      };
      $$('.e3-plan').forEach(el => el.onclick = e => { if (e.target.dataset.effacer != null) { brouillon.choix[Number(e.target.dataset.effacer)] = null; brouillon.planActif = Number(e.target.dataset.effacer); return rendre(); } brouillon.planActif = Number(el.dataset.k); rendre(); });
      $$('.fond-choix[data-id]').forEach(el => el.onclick = () => attribuer(el.dataset.id));
      $('#e3-couleur-ok').onclick = () => attribuer('couleur:' + $('#e3-couleur').value);
      $$('[data-filtre]').forEach(b => b.onclick = () => { filtre = brouillon.filtreFonds = b.dataset.filtre; rendre(); });
      $('#e3-suivants').onclick = () => { const id = brouillon.dernier || brouillon.choix.filter(Boolean).pop(); if (!id) return; brouillon.choix = brouillon.choix.map(x => x || id); rendre(); toast('« ' + ((fondDe(id) || {}).nom || 'Fond') + ' » mis sur les plans qui n\'avaient pas de fond'); };
      $('#e3-vider').onclick = () => { if (!confirm('Retirer tous les fonds choisis ?')) return; brouillon.choix = brouillon.choix.map(() => null); brouillon.planActif = 0; rendre(); };
      $('#e3-import').onchange = async e => {
        const fs = [...e.target.files]; if (!fs.length) return;
        toast('Import de ' + fs.length + ' fichier(s)…');
        for (const f of fs) { const m = await importerFichier(f, /^video/.test(f.type) ? 'fond' : 'image', ''); if (m.type === 'image') { m.type = 'fond'; m.usage = m.usage || 'programme'; } sauverMedias(); Equipe.apresAjout(m, null); }
        vueNouveau();
      };
      $('#retour').onclick = () => { brouillon.etape = 2; vueNouveau(); };
      $('#creer').onclick = () => {
        const manque = brouillon.choix.findIndex(x => !x);
        if (manque >= 0) { brouillon.planActif = manque; rendre(); return toast(`Il reste ${brouillon.choix.filter(x => !x).length} plan(s) sans fond : choisissez le fond du plan ${manque + 1}`); }
        const parPlan = brouillon.choix.map(fondDe);
        const p = Fabrique.nouveauProjet(brouillon.fiche, fonds, parPlan);
        // une photo choisie comme fond : fond « photo »
        p.plans.forEach((pl, i) => { const f = parPlan[i]; if (f && /\.(png|jpe?g|webp|gif)$/i.test(f.src || '')) pl.fond.type = 'image'; });
        projets[p.id] = p; sauverProjets(); brouillon = null;
        location.hash = '#/p/' + p.id + '/plans';
      };
    };
    rendre();
  }

  /* ================= Projet ================= */
  let boucleUI = null;
  function vueProjet(p, onglet) {
    $('#app').innerHTML = `
      <div class="entete"><div><a href="#/" class="muet" style="text-decoration:none">‹ Événements</a><h1 style="margin-top:4px">${esc(p.fiche.titre)}</h1><p>${esc(MoteurInfo.dateLisible(p.fiche.date, p.fiche.langue))}${p.fiche.heure ? ' · ' + esc(p.fiche.heure) : ''}</p></div>
        <div class="ligne"><a class="btn ${p.publie ? 'plein' : ''}" href="#/p/${p.id}/publier" title="Les 2 liens à donner au client">🔗 Liens du client</a><button class="btn petit" id="btn-versions" title="Versions enregistrées automatiquement (revenir en arrière)">🕘 Versions</button><span class="muet" id="etat-sauve">Enregistré</span></div></div>
      <div class="onglets">
        <a href="#/p/${p.id}/plans" class="${onglet === 'plans' ? 'actif' : ''}">Plans</a>
        <a href="#/p/${p.id}/fiche" class="${onglet === 'fiche' ? 'actif' : ''}">Fiche</a>
        <a href="#/p/${p.id}/invites" class="${onglet === 'invites' ? 'actif' : ''}">Invités</a>
        <a href="#/p/${p.id}/publier" class="${onglet === 'publier' ? 'actif' : ''}">Film et publication</a>
      </div><div id="onglet"></div>`;
    Sauve.etat(p);
    $('#btn-versions').onclick = () => ouvrirVersions(p);
    if (onglet === 'invites') return ongletInvites(p);
    if (onglet === 'publier') return ongletPublier(p);
    if (onglet === 'fiche') return ongletFiche(p);
    return ongletPlans(p);
  }
  async function ouvrirVersions(p) {
    toutEcrire();
    const vs = await Sauve.versions(p.id);
    const j = d => new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    modale(`<h2>🕘 Versions enregistrées</h2><p class="muet">Le studio garde tout seul une version toutes les 2 minutes de travail (les 30 dernières), sur cet ordinateur. Choisissez-en une pour y revenir : la version actuelle est gardée elle aussi.</p>
      <div class="pile" style="max-height:55vh;overflow:auto;gap:6px">${vs.map(v => `<div class="ligne" style="justify-content:space-between;border:1px solid #eadfd3;border-radius:10px;padding:8px 10px"><span>${esc(j(v.date))}</span><button class="btn petit" data-v="${esc(v.cle)}">Revenir à cette version</button></div>`).join('') || '<p class="muet">Pas encore de version : elles apparaissent après quelques minutes de travail.</p>'}</div>`, (m, fermer) => {
      $$('[data-v]', m).forEach(b => b.onclick = async () => {
        try {
          const v = JSON.parse(await IDB.lire(b.dataset.v));
          await Sauve.version(p, true);
          v.modifie = new Date().toISOString(); if (p.cle_hote && !v.cle_hote) v.cle_hote = p.cle_hote;
          projets[p.id] = v; sauverProjets(); fermer(); toast('Version du ' + j(Number(b.dataset.v.split(':').pop())) + ' rétablie'); route();
        } catch (e) { toast('Version illisible'); }
      });
    });
  }
  // Récupérer ses invitations depuis la copie en ligne de l'équipe (PC changé, navigateur effacé…)
  async function recupererEnLigne() {
    let liste;
    try { liste = await Equipe.rpc('equipe_mes_projets', { p_auteur: Equipe.membre() }); }
    catch (e) {
      if (Equipe.admin()) { try { liste = (await Equipe.rpc('equipe_admin')).travaux; } catch (e2) { toast(e2.message); return; } }
      else { toast(/equipe_mes_projets|PGRST202|404/.test(e.message) ? 'La base doit être mise à jour : Réglages → « Mise à jour sauvegarde en ligne »' : e.message); return; }
    }
    const j = d => new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    modale(`<h2>☁ Récupérer depuis la copie en ligne</h2><p class="muet">Les invitations enregistrées en ligne par ${Equipe.admin() ? 'l\'équipe' : 'vous (<b>' + esc(Equipe.membre()) + '</b>)'}. Utile après une panne de l'ordinateur ou sur un autre PC.</p>
      <div class="pile" style="max-height:55vh;overflow:auto;gap:6px">${(liste || []).map(t => { const ici = projets[t.projet]; return `<div class="ligne" style="justify-content:space-between;border:1px solid #eadfd3;border-radius:10px;padding:8px 10px"><span><b>${esc(t.titre || 'Sans titre')}</b><br><span class="muet">${t.auteur ? 'par ' + esc(t.auteur) + ' · ' : ''}en ligne le ${esc(j(t.maj))}${ici ? ' · déjà sur cet ordinateur' : ''}</span></span><button class="btn petit ${ici ? '' : 'plein'}" data-r="${esc(t.projet)}">${ici ? 'Remplacer par la copie en ligne' : 'Récupérer'}</button></div>`; }).join('') || '<p class="muet">Aucune copie en ligne.</p>'}</div>
      <div class="ligne" style="justify-content:space-between;border:1px dashed #d8c3ae;border-radius:10px;padding:8px 10px;margin-top:8px"><span><b>📚 Bibliothèque, mes polices et préférences</b><br><span class="muet">fonds, photos et vidéos importés, polices importées, styles, réglages des textes</span></span><button class="btn petit plein" id="acc-recup">Récupérer</button></div>`, (m, fermer) => {
      $('#acc-recup', m).onclick = async e => {
        const b = e.target; b.textContent = 'Récupération…'; b.disabled = true;
        try { const r = await Sauve.accRecuperer(); toast('Récupéré : ' + r.medias + ' élément(s) de bibliothèque, ' + r.polices + ' police(s)'); setTimeout(() => location.reload(), 1500); }
        catch (err) { b.disabled = false; b.textContent = 'Réessayer'; toast(/accessoires|PGRST202|404/.test(err.message) ? 'La base doit être mise à jour : Réglages → « Mise à jour sauvegarde en ligne »' : err.message); }
      };
      $$('[data-r]', m).forEach(b => b.onclick = async () => {
        if (projets[b.dataset.r] && !confirm('Remplacer la version de cet ordinateur par la copie en ligne ? (elle reste dans « 🕘 Versions »)')) return;
        b.textContent = 'Récupération…';
        try {
          let d; try { d = await Equipe.rpc('equipe_mon_projet', { p_projet: b.dataset.r, p_auteur: Equipe.membre() }); } catch (e) { if (!Equipe.admin()) throw e; d = await Equipe.rpc('equipe_projet', { p_projet: b.dataset.r }); }
          if (!d || !d.plans) throw new Error('Copie vide');
          const ici = projets[d.id];
          if (ici) { await Sauve.version(ici, true); if (ici.cle_hote) d.cle_hote = ici.cle_hote; }
          d.modifie = new Date().toISOString(); projets[d.id] = d; sauverProjets(); toast('« ' + (d.fiche.titre || '') + ' » récupérée'); fermer(); route();
        } catch (e) { toast(e.message); b.textContent = 'Réessayer'; }
      });
    });
  }
  function enregistrer(p) {
    p.modifie = new Date().toISOString();
    const e = $('#etat-sauve'); if (e) e.textContent = 'Enregistrement…';
    clearTimeout(tSauve); tSauve = setTimeout(() => { tSauve = 0; sauverProjets(); Sauve.version(p); Sauve.etat(p); }, 400);
    Equipe.travail(p);
  }

  /* ---------- Fiche ---------- */
  function ongletFiche(p) {
    const f = p.fiche;
    $('#onglet').innerHTML = `<div class="carte pile" style="max-width:760px">
      <p class="muet">Ces informations alimentent les textes variables ({date}, {date_limite}, {compte_a_rebours}…), les boutons Map et Appeler, et le message WhatsApp.</p>
      <label class="champ">Titre<input type="text" data-f="titre" value="${esc(f.titre)}"></label>
      <div class="trois"><label class="champ">Date<input type="date" data-f="date" value="${esc(f.date)}"></label><label class="champ">Heure<input type="time" data-f="heure" value="${esc(f.heure)}"></label><label class="champ">Date limite<input type="date" data-f="date_limite" value="${esc(f.date_limite)}"></label></div>
      <div class="carte pile" style="padding:12px;background:#fbf7f1">
        <b>Langues de l'invitation</b>
        <label class="champ">Langue principale (celle de vos textes)<select data-f="langue">${Object.entries(MoteurInfo.LANGUES).map(([k, n]) => `<option value="${k}" ${f.langue === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <div class="muet">Autres langues proposées aux invités (un bouton 🌐 dans l'invitation permet de passer de l'une à l'autre) :</div>
        <div class="cases" style="flex-wrap:wrap">${Object.entries(MoteurInfo.LANGUES).filter(([k]) => k !== f.langue).map(([k, n]) => `<label><input type="checkbox" data-langue="${k}" ${(p.langues || []).includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
        <div class="muet">Ensuite : onglet Plans → <b>🌐 Traduire</b> pour traduire tous les textes d'un coup.</div>
      </div>
      <div class="section-titre">Lieux (n° pour les boutons Map : 0, 1…)</div>
      ${f.lieux.map((l, i) => `<div class="deux"><input type="text" data-l="${i}" data-k="nom" value="${esc(l.nom)}"><input type="url" data-l="${i}" data-k="maps" value="${esc(l.maps)}"></div>`).join('')}
      <div class="section-titre">Contacts (n° pour les boutons Appeler : 0, 1…)</div>
      ${f.contacts.map((c, i) => `<div class="deux"><input type="text" data-c="${i}" data-k="nom" value="${esc(c.nom)}"><input type="text" data-c="${i}" data-k="telephone" value="${esc(c.telephone)}"></div>`).join('')}
      <label class="champ">Texte source<textarea rows="8" readonly>${esc(f.texte_source || '')}</textarea></label>
    </div>`;
    $$('[data-f]').forEach(i => i.oninput = () => { f[i.dataset.f] = i.value; if (i.dataset.f === 'langue') { p.langues = (p.langues || []).filter(x => x !== i.value); enregistrer(p); return ongletFiche(p); } enregistrer(p); });
    $$('[data-langue]').forEach(i => i.onchange = () => { const l = new Set(p.langues || []); if (i.checked) l.add(i.dataset.langue); else l.delete(i.dataset.langue); p.langues = [...l]; enregistrer(p); });
    $$('[data-l]').forEach(i => i.oninput = () => { f.lieux[i.dataset.l][i.dataset.k] = i.value; enregistrer(p); });
    $$('[data-c]').forEach(i => i.oninput = () => { f.contacts[i.dataset.c][i.dataset.k] = i.value; enregistrer(p); });
  }

  /* ---------- Plans (éditeur) ---------- */
  const PALETTE_FONDS = [['#f4ede2'], ['#ffffff'], ['#fdf6ec'], ['#f6e1e1'], ['#e9efe4'], ['#e7eef6'], ['#1d1414'], ['#7a1f2b'], ['#b08a4f'], ['#3b4a3a'], ['#1f2a44'],
    ['#fdf6ec', '#ead5b8'], ['#fff5f5', '#f2c4ce'], ['#eef3ea', '#b9cdb0'], ['#f1f5fb', '#b9c9e2'], ['#7a1f2b', '#2b0b10'], ['#1f2a44', '#0b0f1c'], ['#f7e7c6', '#c9a15a'], ['#ffffff', '#e6dccb']];
  const ROLES = { ouverture: 'Ouverture', intermediaire: 'Plan intermédiaire', confirmation: 'Confirmation', remerciement: 'Remerciement' };
  const TYPES_BOUTON = [
    { a: 'confirmer', i: '✅', n: 'Je confirme', fr: 'Je confirme ma présence', mg: 'Ho tonga aho', en: 'I will attend', aide: 'Enregistre la présence dans la base (organisateur prévenu), puis remerciement.' },
    { a: 'refuser', i: '❌', n: 'Je ne viens pas', fr: 'Je ne pourrai pas venir', mg: 'Tsy ho afaka aho', en: 'I can\'t come', aide: 'Enregistre l\'absence dans la base (organisateur prévenu), puis remerciement.' },
    { a: 'map', i: '📍', n: 'Itinéraire', fr: 'Voir le lieu', mg: 'Jereo ny toerana', en: 'See the place', aide: 'Ouvre Google Maps sur le lieu choisi.' },
    { a: 'appeler', i: '📞', n: 'Appeler', fr: 'Appeler', mg: 'Antsoy', en: 'Call', aide: 'Appelle le numéro choisi.' },
    { a: 'whatsapp', i: '💬', n: 'WhatsApp', fr: 'Écrire sur WhatsApp', mg: 'Hafatra WhatsApp', en: 'WhatsApp', aide: 'Ouvre WhatsApp avec un message prêt.' },
    { a: 'calendrier', i: '📅', n: 'Calendrier', fr: 'Ajouter au calendrier', mg: 'Ampidiro amin\'ny tetiandro', en: 'Add to calendar', aide: 'Ajoute l\'événement dans le calendrier du téléphone.' },
    { a: 'partager', i: '📤', n: 'Partager', fr: 'Partager l\'invitation', mg: 'Zarao', en: 'Share', aide: 'Partage le lien de l\'invitation.' },
    { a: 'lien', i: '🔗', n: 'Lien web', fr: 'Ouvrir le lien', mg: 'Sokafy', en: 'Open link', aide: 'Ouvre une page web (Facebook, YouTube, cagnotte, programme…).' },
    { a: 'messenger', i: '💭', n: 'Messenger', fr: 'Écrire sur Messenger', mg: 'Hafatra Messenger', en: 'Messenger', aide: 'Ouvre une conversation Messenger.' },
    { a: 'suivant', i: '▶', n: 'Continuer', fr: 'Continuer', mg: 'Manaraka', en: 'Continue', aide: 'Passe au plan suivant.' },
    { a: 'precedent', i: '◀', n: 'Retour', fr: 'Retour', mg: 'Hiverina', en: 'Back', aide: 'Revient au plan précédent.' },
    { a: 'passer', i: '⏭', n: 'Passer le film', fr: 'Passer', mg: 'Dinganina', en: 'Skip', aide: 'Va directement à la confirmation.' },
    { a: 'revoir', i: '↺', n: 'Revoir', fr: 'Revoir le film', mg: 'Avereno jerena', en: 'Watch again', aide: 'Relance le film depuis le début.' }
  ];
  const NOMS_TYPE = { texte: 'Texte', bouton: 'Bouton', compteur: 'Compteur', champ: 'Champ', image: 'Image', video: 'Vidéo', forme: 'Forme' };
  const aHauteur = c => !!c && (c.type === 'image' || c.type === 'video' || c.type === 'forme');
  const nomType = c => c.illu ? 'Illustration' : NOMS_TYPE[c.type];
  const FAMILLE_TEST = { code: 'TEST', nom: 'Fianakaviana Rakoto', places: 4, adultes: 2, enfants: 2 };

  function ongletPlans(p) {
    const E = { p, i: 0, sel: null, t: 0, vue: 'famille', annuler: [], refaire: [] };
    Stock.ecrire('studio.bib.evt', p.id);
    $('#onglet').innerHTML = `<div class="editeur ps">
        <div class="barre-sel" id="barre-sel"></div>
          <div class="outils" id="outils">
            <button data-outil="texte" title="Texte">T</button><button data-outil="forme" title="Forme (rectangle, rond, cœur…)">▭</button><button data-outil="photo" title="Photo / vidéo">🖼</button>
            <button data-outil="illu" title="Illustration">✿</button><button data-outil="emoji" title="Emoji">😊</button><button data-outil="bouton" title="Bouton">⏺</button><button data-outil="compteur" title="Compteur">±</button>
            <span class="sep"></span><button data-outil="fond" title="Fond du plan">▦</button>
            <span class="sep"></span><button data-outil="zoom+" title="Zoom avant (Ctrl +)">＋</button><button data-outil="zoom0" title="Ajuster à l'écran (Ctrl 0)" id="zoom-val">100%</button><button data-outil="zoom-" title="Zoom arrière (Ctrl −)">－</button>
          </div>
        <div class="col-plans" id="col-plans"></div>
        <div class="col-apercu">
          <div class="atelier">
          <div class="zone-zoom" id="zone-zoom">
          <div class="cadre-regles" id="cadre-regles"><canvas class="regle regle-h" id="regle-h"></canvas><canvas class="regle regle-v" id="regle-v"></canvas><span class="regle-coin" title="Règles"></span>
          <div class="apercu-cadre" id="cadre" tabindex="0"><div id="scene"></div><div class="poignees" id="poignees"></div><div class="aimants" id="aimants"></div></div></div>
          </div></div>
          <div class="astuce">Maj+clic ou cadre de sélection : choisir plusieurs éléments · Double-clic : écrire dans le texte · Coins : agrandir · Côtés : élargir · Ctrl+C / Ctrl+V : copier-coller (aussi entre plans) · Ctrl+Alt+C / Ctrl+Alt+V : copier-coller la mise en forme · 🖌 : pinceau · Ctrl+D : dupliquer · Suppr : supprimer · Flèches : déplacer · Clic droit : menu</div>
          <div class="temps"><span id="t-aff">0,0 s</span><input type="range" id="t-curseur" min="0" max="6" step="0.05" value="0"><span id="t-dur"></span></div>
          <div class="commandes">
            <button class="btn petit" id="jouer-plan">▶ Plan</button><button class="btn petit" id="jouer-tout">▶ Toute l'invitation</button><button class="btn petit" id="pause" title="Pause / reprendre (barre d'espace)" disabled>⏸ Pause</button><button class="btn petit" id="stop">■</button>
            <button class="btn petit ${Stock.lire('studio.regles', false) ? 'on' : ''}" id="regles-btn" title="Afficher les règles et les repères">📏 Règles</button>
            <select id="vue" class="btn petit"><option value="famille">Voir : lien personnel</option><option value="general">Voir : lien général</option></select>
            <button class="btn petit icone" id="annuler" title="Annuler">↶</button><button class="btn petit icone" id="refaire" title="Rétablir">↷</button>
          </div>
          <div class="commandes"><button class="btn petit" id="musique-btn" title="Chanson de l'invitation">♪ ${p.musique ? esc((p.musique.nom || 'Chanson').replace(/\.\w+$/, '').slice(0, 18)) : 'Ajouter une chanson'}</button><button class="btn petit" id="traduire">🌐 Traduire</button><select id="voir-langue" class="btn petit" title="Voir l'aperçu dans une autre langue"></select><button class="btn petit" id="img-test">Image test</button><button class="btn ia" id="finaliser">✨ Finaliser ce plan avec l'IA</button></div>
        </div>
        <div class="col-reglages carte" id="col-reglages"></div>
      </div>`;
    const eng = new Moteur($('#scene'), { mode: 'edition', resolveur: resoudre, famille: FAMILLE_TEST });
    moteurCourant = eng;
    E.eng = eng;
    eng.setProjet(p).then(() => { enregistrer(p); afficher(); });
    // Zoom de l'aperçu (comme Photoshop) : boutons, Ctrl + molette, Ctrl +/−/0
    let zoom = 1;
    E.zoomer = f => {
      zoom = f === 0 ? 1 : Math.max(0.5, Math.min(4, Math.round(zoom * f * 100) / 100));
      if (Math.abs(zoom - 1) < 0.04) zoom = 1;
      $('#cadre').style.setProperty('--zoom', zoom); $('#zone-zoom').classList.toggle('zoome', zoom > 1);
      $('#zoom-val').textContent = Math.round(zoom * 100) + '%';
      requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); if (E.rafraichir) E.rafraichir(); });
    };
    $('#zone-zoom').addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); E.zoomer(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
    $$('#outils [data-outil]').forEach(b => b.onclick = () => {
      const o = b.dataset.outil;
      if (o === 'zoom+') return E.zoomer(1.25); if (o === 'zoom-') return E.zoomer(0.8); if (o === 'zoom0') return E.zoomer(0);
      if (o === 'texte' || o === 'bouton' || o === 'compteur') return E.ajouterCalque(o);
      if (o === 'forme') return E.choisirNouvelleForme(b);
      if (o === 'photo') { const i = $('#imp-calque'); if (i) i.click(); return; }
      if (o === 'illu') { const i = $('#ajout-illu'); if (i) i.click(); return; }
      if (o === 'emoji') { const i = $('#ajout-emoji'); if (i) i.click(); return; }
      if (o === 'fond') { E.sel = null; if (E.multi && E.multi.clear) E.multi.clear(); if (E.rafraichir) E.rafraichir(); E.rendreReglages(); E.ouvrirSection('Fond'); const pf = $('#p-fond-choisir'); if (pf) pf.click(); else E.choisirFond('video'); }
    });

    function snapshot() { E.annuler.push(JSON.stringify(p.plans)); if (E.annuler.length > 60) E.annuler.shift(); E.refaire = []; }
    let tSnap = 0;
    E.modif = (fort) => {
      const n = Date.now(); if (fort || n - tSnap > 1200) snapshot(); tSnap = n;
      enregistrer(p);
    };
    E.apres = () => { enregistrer(p); };
    function restaurer(json) { p.plans = JSON.parse(json); E.i = Math.min(E.i, p.plans.length - 1); E.sel = null; eng.precharger().then(() => afficher()); enregistrer(p); }
    $('#annuler').onclick = () => { if (!E.annuler.length) return toast('Rien à annuler'); E.refaire.push(JSON.stringify(p.plans)); restaurer(E.annuler.pop()); };
    $('#refaire').onclick = () => { if (!E.refaire.length) return; E.annuler.push(JSON.stringify(p.plans)); restaurer(E.refaire.pop()); };

    function plan() { return p.plans[E.i]; }
    function afficher() {
      const cd = $('#cadre'); if (cd) cd.classList.remove('en-lecture');
      rendrePlans(); rendreReglages();
      const pl = plan();
      const d = Number(pl.duree) || 6;
      $('#t-curseur').max = d; if (E.t > d) E.t = d;
      $('#t-curseur').value = E.t;
      $('#t-dur').textContent = Number(pl.duree) ? d.toFixed(1) + ' s' : 'interactif';
      eng.afficherPlan(E.i, E.t);
      $('#t-aff').textContent = E.t.toFixed(1).replace('.', ',') + ' s';
    }
    E.afficher = afficher;
    E.rafraichir = () => { eng.afficherPlan(E.i, E.t); };

    $('#t-curseur').oninput = e => { E.t = Number(e.target.value); $('#t-aff').textContent = E.t.toFixed(1).replace('.', ',') + ' s'; eng.afficherPlan(E.i, E.t); };
    const enLecture = on => { $('#cadre').classList.toggle('en-lecture', on); };
    $('#jouer-plan').onclick = () => { eng.mode = 'invitation'; enLecture(true); eng.jouerPlan(E.i); };
    let son = null;
    const couperSon = () => { if (son) { son.pause(); son = null; } };
    nettoyeurs.push(couperSon);
    $('#jouer-tout').onclick = async () => {
      eng.mode = 'invitation'; enLecture(true); eng.jouer(eng.plansInvitation(), 0);
      couperSon();
      if (p.musique && p.musique.src) { try { son = new Audio(await resoudre(p.musique.src)); son.volume = p.musique.volume != null ? p.musique.volume : 0.8; son.currentTime = Number(p.musique.debut) || 0; son.play(); } catch (e) {} }
    };
    $('#jouer-plan').addEventListener('click', couperSon);
    $('#stop').onclick = () => { couperSon(); enLecture(false); eng.pause(); eng.mode = 'edition'; E.enPause = false; majPause(); afficher(); };
    // Pause / reprendre (bouton ou barre d'espace) pendant la lecture
    E.enPause = false;
    const majPause = () => { const b = $('#pause'); if (!b) return; const actif = eng.lecture || E.enPause; b.disabled = !actif; b.textContent = E.enPause ? '▶ Reprendre' : '⏸ Pause'; b.classList.toggle('on', E.enPause); };
    const basculerPause = () => {
      if (E.enPause) { E.enPause = false; eng.reprendre(); if (son) son.play().catch(() => {}); }
      else if (eng.lecture) { E.enPause = true; eng.pause(); if (son) son.pause(); }
      majPause();
    };
    $('#pause').onclick = basculerPause;
    ['#jouer-plan', '#jouer-tout'].forEach(id => $(id).addEventListener('click', () => { E.enPause = false; setTimeout(majPause, 30); }));
    E.basculerPause = basculerPause;
    const majVoirLangue = () => { const sel = $('#voir-langue'); const ls = [p.fiche.langue].concat((p.langues || []).filter(l => l !== p.fiche.langue)); sel.style.display = ls.length > 1 ? '' : 'none'; sel.innerHTML = ls.map(l => `<option value="${l}" ${(eng.langue || p.fiche.langue) === l ? 'selected' : ''}>Voir en : ${esc(MoteurInfo.LANGUES[l] || l)}</option>`).join(''); };
    majVoirLangue();
    $('#voir-langue').onchange = e => { eng.changerLangue(e.target.value); E.rafraichir(); };
    $('#traduire').onclick = () => modaleTraduction(p, () => { majVoirLangue(); E.afficher(); });
    $('#musique-btn').onclick = () => modaleMusique(p, () => { $('#musique-btn').textContent = '♪ ' + (p.musique ? (p.musique.nom || 'Chanson').replace(/\.\w+$/, '').slice(0, 18) : 'Ajouter une chanson'); });
    eng.onTemps = (t) => {
      $('#t-aff').textContent = t.toFixed(1).replace('.', ',') + ' s'; if (eng.planFixe != null) $('#t-curseur').value = t;
      // aperçu de toute l'invitation : la confirmation attend l'invité ; ici on continue vers le remerciement après 8 s
      const pc = eng.planCourant();
      if (eng.planFixe == null && pc && pc.role === 'confirmation' && !Number(pc.duree) && t > 8 && !E._versMerci) { E._versMerci = true; toast('Aperçu : suite vers le remerciement (sur l\'invitation, il vient après la réponse de l\'invité)'); eng.allerRemerciement(); setTimeout(() => { E._versMerci = false; }, 1000); }
    };
    eng.onFin = () => { eng.mode = 'edition'; E.enPause = false; majPause(); afficher(); };
    eng.onAction = (a) => {
      if (a === 'whatsapp' && eng.planCourant() && eng.planCourant().role === 'confirmation') { toast('Réponse par WhatsApp (simulée) : suite du film'); return eng.allerRemerciement(); }
      if (a === 'confirmer' || a === 'refuser') { toast(a === 'confirmer' ? 'Réponse « vient » (simulée) : suite du film' : 'Réponse « ne vient pas » (simulée) : suite du film'); return eng.allerRemerciement(); }
      toast('Action « ' + a + ' » (active sur la page d\'invitation)');
    };
    $('#vue').onchange = e => { E.vue = e.target.value; eng.famille = E.vue === 'famille' ? FAMILLE_TEST : null; eng.form = { adultes: null, enfants: null }; if (eng.famille) { eng.form.adultes = 2; eng.form.enfants = 2; } E.rafraichir(); };
    eng.form.adultes = 2; eng.form.enfants = 2;
    $('#img-test').onclick = () => { try { telecharger(`plan-${E.i + 1}.jpg`, dataURLversBlob(eng.imageTest())); } catch (e) { toast(e.message); } };
    $('#finaliser').onclick = () => modaleFinaliser(E);

    // ===== Édition directe sur l'aperçu (sélection, déplacement, poignées, double-clic, copier-coller) =====
    const zone = $('#poignees');
    const cadre = $('#cadre');
    let drag = null, editeur = null;
    const POIGNEES = { texte: ['nw', 'ne', 'sw', 'se', 'e', 'w'], bouton: ['nw', 'ne', 'sw', 'se', 'e', 'w'], compteur: ['e', 'w'], champ: ['e', 'w'], image: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], video: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] };
    function calqueSel() { return (plan().calques || []).find(x => x.id === E.sel); }
    // ---- Sélection multiple : E.multi contient tous les éléments choisis (E.sel = le dernier cliqué)
    E.multi = new Set();
    const selection = () => { const pl = plan(); const ids = E.multi.size ? E.multi : new Set(E.sel ? [E.sel] : []); return (pl.calques || []).filter(c => ids.has(c.id)); };
    E.selection = selection;
    // ---- Règles et repères (en % de l'invitation, gardés avec l'événement)
    p.guides = p.guides || { v: [], h: [] };
    let regles = !!Stock.lire('studio.regles', false);
    let cadreSel = null;
    function rendrePoignees() {
      if (eng.lecture) { if (zone._html) { zone.innerHTML = ''; zone._html = ''; } return; }
      const pl = plan(), seule = E.multi.size <= 1;
      const html = (pl.calques || []).filter(c => eng.bbox[c.id] && !c.masque && !c._edition).map(c => {
        const b = eng.bbox[c.id], actif = E.sel === c.id, groupe = E.multi.has(c.id) && !seule;
        const hs = actif && seule ? (POIGNEES[c.type] || []).map(h => `<i class="h h-${h}" data-h="${h}"></i>`).join('') + '<i class="h h-rot" data-h="rot" title="Tourner (Maj : librement, sinon par 15°)">⟳</i>' : '';
        const rot = Number(c.rotation) || 0;
        return `<div class="poignee ${actif && seule ? 'actif' : ''} ${groupe ? 'groupe' : ''}" data-id="${c.id}" style="left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%${rot ? `;transform:rotate(${rot}deg)` : ''}"><span class="nom">${esc(nomType(c))}${drag && drag.mode === 'rotation' && drag.c === c ? ' · ' + rot + '°' : ''}</span>${hs}</div>`;
      }).join('') + (regles ? p.guides.v.map((x, k) => `<div class="guide guide-v" data-gv="${k}" style="left:${x}%" title="Glisser pour déplacer · double-clic ou glisser hors du cadre pour effacer"></div>`).join('') + p.guides.h.map((y, k) => `<div class="guide guide-h" data-gh="${k}" style="top:${y}%" title="Glisser pour déplacer · double-clic ou glisser hors du cadre pour effacer"></div>`).join('') : '')
        + (cadreSel ? `<div class="cadre-selection" style="left:${Math.min(cadreSel.x0, cadreSel.x1)}%;top:${Math.min(cadreSel.y0, cadreSel.y1)}%;width:${Math.abs(cadreSel.x1 - cadreSel.x0)}%;height:${Math.abs(cadreSel.y1 - cadreSel.y0)}%"></div>` : '');
      if (zone._html !== html) { zone.innerHTML = html; zone._html = html; dessinerRegles(); }
    }
    function tick() { rendrePoignees(); boucleUI = requestAnimationFrame(tick); }
    boucleUI = requestAnimationFrame(tick);
    // calque sous le pointeur (le plus haut d'abord), par coordonnées : robuste aux redessins
    function calqueA(e) {
      const r = zone.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
      const cs = (plan().calques || []).filter(c => eng.bbox[c.id] && !c.masque);
      for (let i = cs.length - 1; i >= 0; i--) {
        const b = eng.bbox[cs[i].id], rot = (Number(cs[i].rotation) || 0) * Math.PI / 180;
        let px = x, py = y;
        if (rot) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2, X = (x - cx) * r.width, Y = (y - cy) * r.height; px = cx + (X * Math.cos(-rot) - Y * Math.sin(-rot)) / r.width; py = cy + (X * Math.sin(-rot) + Y * Math.cos(-rot)) / r.height; }
        if (px >= b.x - 0.8 && px <= b.x + b.w + 0.8 && py >= b.y - 0.8 && py <= b.y + b.h + 0.8) return cs[i];
      }
      return null;
    }
    function choisir(id, ajout) {
      if (ajout && id) {
        if (!E.multi.size && E.sel) E.multi.add(E.sel);
        if (E.multi.has(id)) { E.multi.delete(id); E.sel = [...E.multi].pop() || null; } else { E.multi.add(id); E.sel = id; }
        if (E.multi.size <= 1) { E.multi.clear(); if (E.sel) E.multi.add(E.sel); }
        rendreReglages(); zone._html = ''; return;
      }
      if (E.sel !== id || E.multi.size > 1) { E.sel = id; E.multi.clear(); if (id) E.multi.add(id); rendreReglages(); zone._html = ''; }
    }
    E.choisir = choisir;
    function choisirPlusieurs(ids) { E.multi = new Set(ids); E.sel = ids[ids.length - 1] || null; rendreReglages(); zone._html = ''; }
    E.choisirPlusieurs = choisirPlusieurs;

    // ---- Aimants : centre de la page, repères, bords et centres des autres éléments
    const aimants = $('#aimants');
    function cibles(exclus) {
      const v = [50], h = [50];
      if (regles) { v.push(...p.guides.v); h.push(...p.guides.h); }
      (plan().calques || []).forEach(c => { if (exclus.has(c.id) || c.masque) return; const b = eng.bbox[c.id]; if (!b) return; v.push(b.x, b.x + b.w / 2, b.x + b.w); h.push(b.y, b.y + b.h / 2, b.y + b.h); });
      return { v, h };
    }
    function aimanter(b, dx, dy, exclus, seuilX, seuilY) {
      const t = cibles(exclus); let mx = null, my = null, bx = seuilX, by = seuilY;
      [b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w].forEach(e => t.v.forEach(g => { const d = Math.abs(g - e); if (d < bx) { bx = d; mx = { g, d: g - e }; } }));
      [b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h].forEach(e => t.h.forEach(g => { const d = Math.abs(g - e); if (d < by) { by = d; my = { g, d: g - e }; } }));
      aimants.innerHTML = (mx ? `<i class="ai-v" style="left:${mx.g}%"></i>` : '') + (my ? `<i class="ai-h" style="top:${my.g}%"></i>` : '');
      return { dx: dx + (mx ? mx.d : 0), dy: dy + (my ? my.d : 0) };
    }

    zone.addEventListener('pointerdown', e => {
      if (e.button === 2) return;
      fermerMenu();
      if (editeur) terminerEdition();
      cadre.focus({ preventScroll: true });
      const r = zone.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * 100, py = (e.clientY - r.top) / r.height * 100;
      // repère : déplacer
      const gd = e.target.closest('.guide');
      if (gd) { drag = { mode: 'guide', axe: gd.dataset.gv != null ? 'v' : 'h', k: Number(gd.dataset.gv != null ? gd.dataset.gv : gd.dataset.gh), w: r.width, h: r.height, r }; zone.setPointerCapture(e.pointerId); e.preventDefault(); return; }
      const h = e.target.closest('.h');
      if (h && h.dataset.h === 'rot' && calqueSel()) {
        const c = calqueSel(), b = eng.bbox[c.id];
        drag = { mode: 'rotation', c, cx: r.left + (b.x + b.w / 2) / 100 * r.width, cy: r.top + (b.y + b.h / 2) / 100 * r.height, r0: Number(c.rotation) || 0, bouge: false };
        drag.a0 = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
        zone.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      if (h && calqueSel() && E.multi.size <= 1) {
        const c = calqueSel(), b = eng.bbox[c.id];
        drag = { mode: 'taille', h: h.dataset.h, c, x0: e.clientX, y0: e.clientY, w: r.width, hz: r.height, b: Object.assign({}, b), v: { largeur: Number(c.largeur) || 60, taille: Number(c.taille) || 4, hauteur: Number(c.hauteur) || 22, x: Number(c.x), y: Number(c.y) }, bouge: false };
        zone.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      const c = calqueA(e);
      if (pinceau) { if (c) { appliquerStyle([c]); } else { pinceau = false; zone.classList.remove('pinceau'); rendreBarre(); } return; }
      const ajout = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!c) {
        // cadre de sélection
        if (!ajout) choisir(null);
        drag = { mode: 'cadre', ajout, avant: new Set(E.multi), w: r.width, h: r.height, r, bouge: false };
        cadreSel = { x0: px, y0: py, x1: px, y1: py };
        zone.setPointerCapture(e.pointerId); return;
      }
      if (ajout) { choisir(c.id, true); if (!E.multi.has(c.id)) return; }
      else if (!E.multi.has(c.id) || E.multi.size <= 1) choisir(c.id);
      else { E.sel = c.id; rendreBarre(); }
      const groupe = selection();
      drag = { mode: 'deplacer', c, groupe: groupe.map(x => ({ c: x, x: Number(x.x), y: Number(x.y) })), b: Object.assign({}, eng.bbox[c.id] || { x: c.x, y: c.y, w: 0, h: 0 }), x0: e.clientX, y0: e.clientY, w: r.width, h: r.height, bouge: false };
      // boîte qui englobe tout le groupe (c'est elle qu'on aimante)
      const bs = groupe.map(x => eng.bbox[x.id]).filter(Boolean);
      if (bs.length > 1) { const x1 = Math.min(...bs.map(b => b.x)), y1 = Math.min(...bs.map(b => b.y)); drag.b = { x: x1, y: y1, w: Math.max(...bs.map(b => b.x + b.w)) - x1, h: Math.max(...bs.map(b => b.y + b.h)) - y1 }; }
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', e => {
      if (!drag) { if (regles) { const r = zone.getBoundingClientRect(); majCurseurRegles((e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100); } return; }
      if (drag.mode === 'guide') {
        const x = (e.clientX - drag.r.left) / drag.w * 100, y = (e.clientY - drag.r.top) / drag.h * 100;
        p.guides[drag.axe][drag.k] = Math.round((drag.axe === 'v' ? x : y) * 10) / 10; drag.bouge = true; zone._html = ''; return;
      }
      if (drag.mode === 'cadre') {
        const x = (e.clientX - drag.r.left) / drag.w * 100, y = (e.clientY - drag.r.top) / drag.h * 100;
        cadreSel.x1 = Math.max(0, Math.min(100, x)); cadreSel.y1 = Math.max(0, Math.min(100, y)); drag.bouge = true;
        const x1 = Math.min(cadreSel.x0, cadreSel.x1), x2 = Math.max(cadreSel.x0, cadreSel.x1), y1 = Math.min(cadreSel.y0, cadreSel.y1), y2 = Math.max(cadreSel.y0, cadreSel.y1);
        const dedans = (plan().calques || []).filter(c => { const b = eng.bbox[c.id]; return b && !c.masque && b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1; }).map(c => c.id);
        const ids = drag.ajout ? [...new Set([...drag.avant, ...dedans])] : dedans;
        E.multi = new Set(ids); E.sel = ids[ids.length - 1] || null; zone._html = '';
        return;
      }
      if (drag.mode === 'rotation') {
        if (!drag.bouge) { snapshot(); drag.bouge = true; }
        let a = drag.r0 + (Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) - drag.a0) * 180 / Math.PI;
        a = ((a % 360) + 540) % 360 - 180;                 // entre −180 et 180
        a = e.shiftKey ? Math.round(a) : Math.round(a / 15) * 15;
        if (Math.abs(a) < 1) a = 0;
        drag.c.rotation = a; zone._html = '';
        if (I.TYPES_HTML.includes(drag.c.type)) E.rafraichir();
        const ir = $('#props [data-k="rotation"]'); if (ir) ir.value = a;
        return;
      }
      let dxp = e.clientX - drag.x0, dyp = e.clientY - drag.y0;
      if (drag.mode === 'taille' && Number(drag.c.rotation)) { const t = -Number(drag.c.rotation) * Math.PI / 180, X = dxp, Y = dyp; dxp = X * Math.cos(t) - Y * Math.sin(t); dyp = X * Math.sin(t) + Y * Math.cos(t); }
      if (!drag.bouge && Math.abs(dxp) + Math.abs(dyp) < 3) return;
      if (!drag.bouge) { snapshot(); drag.bouge = true; }
      const c = drag.c;
      if (drag.mode === 'deplacer') {
        let dx = dxp / drag.w * 100, dy = dyp / drag.h * 100;
        if (!e.shiftKey) { const a = aimanter(drag.b, dx, dy, new Set(drag.groupe.map(g => g.c.id)), 6 / drag.w * 100, 6 / drag.h * 100); dx = a.dx; dy = a.dy; }
        else aimants.innerHTML = '';
        drag.groupe.forEach(g => { g.c.x = Math.round(Math.max(0, Math.min(100, g.x + dx)) * 10) / 10; g.c.y = Math.round(Math.max(0, Math.min(100, g.y + dy)) * 10) / 10; });
        if (regles) majCurseurRegles(drag.b.x + dx + drag.b.w / 2, drag.b.y + dy + drag.b.h / 2);
      } else {
        const H = drag.h, v = drag.v, b = drag.b;
        const dx = dxp / drag.w * 100, dy = dyp / drag.hz * 100;
        const sx = H.includes('e') ? 1 : H.includes('w') ? -1 : 0, sy = H.includes('s') ? 1 : H.includes('n') ? -1 : 0;
        const coin = sx && sy;
        if (coin) {
          // agrandir proportionnellement depuis le centre
          const f = Math.max(0.2, Math.min(5, (b.w + 2 * sx * dx) / b.w));
          if (aHauteur(c)) { c.largeur = Math.round(Math.min(100, v.largeur * f) * 10) / 10; c.hauteur = Math.round(Math.min(100, v.hauteur * f) * 10) / 10; }
          else { c.taille = Math.round(Math.max(1, Math.min(15, v.taille * f)) * 10) / 10; c.largeur = Math.round(Math.max(8, Math.min(100, v.largeur * f)) * 10) / 10; }
        } else if (sx) {
          c.largeur = Math.round(Math.max(8, Math.min(100, v.largeur + 2 * sx * dx)) * 10) / 10;
        } else if (sy) {
          c.hauteur = Math.round(Math.max(4, Math.min(100, v.hauteur + 2 * sy * dy)) * 10) / 10;
        }
      }
      if (selection().some(x => I.TYPES_HTML.includes(x.type)) || I.TYPES_HTML.includes(c.type)) E.rafraichir();
      majChamps(c);
    });
    zone.addEventListener('pointerup', () => {
      if (drag && drag.mode === 'guide') {
        const g = p.guides[drag.axe][drag.k];
        if (drag.bouge && (g < -1 || g > 101)) { p.guides[drag.axe].splice(drag.k, 1); toast('Repère effacé'); }
        enregistrer(p); drag = null; zone._html = ''; return;
      }
      if (drag && drag.mode === 'cadre') { cadreSel = null; zone._html = ''; drag = null; rendreReglages(); return; }
      if (drag && drag.bouge) { enregistrer(p); if (drag.mode === 'taille' || drag.mode === 'rotation' || (drag.groupe && drag.groupe.length > 1)) rendreReglages(); }
      drag = null; aimants.innerHTML = '';
    });
    zone.addEventListener('dblclick', e => { const gd = e.target.closest('.guide'); if (!gd) return; e.stopPropagation(); if (gd.dataset.gv != null) p.guides.v.splice(Number(gd.dataset.gv), 1); else p.guides.h.splice(Number(gd.dataset.gh), 1); enregistrer(p); zone._html = ''; }, true);

    // ---- Règles graduées (0 à 100 %) : tirer depuis une règle pour poser un repère
    const regleH = $('#regle-h'), regleV = $('#regle-v'), boiteRegles = $('#cadre-regles');
    let curseurR = null;
    function majCurseurRegles(x, y) { curseurR = { x, y }; dessinerRegles(); }
    function dessinerRegles() {
      boiteRegles.classList.toggle('actives', regles);
      if (!regles) return;
      const rc = cadre.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const bs = selection().map(c => eng.bbox[c.id]).filter(Boolean);
      const b = bs.length ? (() => { const x1 = Math.min(...bs.map(q => q.x)), y1 = Math.min(...bs.map(q => q.y)); return { x: x1, y: y1, w: Math.max(...bs.map(q => q.x + q.w)) - x1, h: Math.max(...bs.map(q => q.y + q.h)) - y1 }; })() : null;
      [[regleH, rc.width, 18, 'h'], [regleV, 18, rc.height, 'v']].forEach(([cv, w, h, axe]) => {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
        const x = cv.getContext('2d'); x.scale(dpr, dpr); x.fillStyle = '#fbf7f1'; x.fillRect(0, 0, w, h);
        const L = axe === 'h' ? w : h;
        if (b) { x.fillStyle = 'rgba(195,58,76,.16)'; if (axe === 'h') x.fillRect(b.x / 100 * w, 0, b.w / 100 * w, h); else x.fillRect(0, b.y / 100 * h, w, b.h / 100 * h); }
        x.strokeStyle = '#a89484'; x.fillStyle = '#6b5a50'; x.font = '9px Inter, sans-serif'; x.lineWidth = 1;
        for (let k = 0; k <= 100; k += 2) {
          const pos = Math.round(k / 100 * L) + 0.5, long = k % 10 === 0 ? 9 : k % 5 === 0 ? 6 : 3;
          x.beginPath(); if (axe === 'h') { x.moveTo(pos, 18); x.lineTo(pos, 18 - long); } else { x.moveTo(18, pos); x.lineTo(18 - long, pos); } x.stroke();
          if (k % 10 === 0 && k > 0 && k < 100) { if (axe === 'h') x.fillText(String(k), pos + 2, 9); else { x.save(); x.translate(9, pos - 2); x.rotate(-Math.PI / 2); x.fillText(String(k), 0, 0); x.restore(); } }
        }
        x.strokeStyle = '#3d7ad6'; (axe === 'h' ? p.guides.v : p.guides.h).forEach(g => { const pos = g / 100 * L; x.beginPath(); if (axe === 'h') { x.moveTo(pos, 0); x.lineTo(pos, 18); } else { x.moveTo(0, pos); x.lineTo(18, pos); } x.stroke(); });
        if (curseurR) { x.strokeStyle = '#c33a4c'; const pos = (axe === 'h' ? curseurR.x : curseurR.y) / 100 * L; x.beginPath(); if (axe === 'h') { x.moveTo(pos, 0); x.lineTo(pos, 18); } else { x.moveTo(0, pos); x.lineTo(18, pos); } x.stroke(); }
      });
    }
    E.dessinerRegles = dessinerRegles;
    [[regleH, 'h'], [regleV, 'v']].forEach(([cv, axe]) => cv.addEventListener('pointerdown', e => {
      // tirer depuis la règle du haut → repère horizontal ; depuis celle de gauche → repère vertical
      e.preventDefault(); const nouveau = axe;
      p.guides[nouveau].push(-5); const k = p.guides[nouveau].length - 1;
      const r = zone.getBoundingClientRect();
      const bouger = ev => { const v = nouveau === 'v' ? (ev.clientX - r.left) / r.width * 100 : (ev.clientY - r.top) / r.height * 100; p.guides[nouveau][k] = Math.round(v * 10) / 10; zone._html = ''; };
      const fin = () => { document.removeEventListener('pointermove', bouger); document.removeEventListener('pointerup', fin); const g = p.guides[nouveau][k]; if (g < 0 || g > 100) p.guides[nouveau].splice(k, 1); else toast('Repère posé à ' + String(g).replace('.', ',') + ' % : les éléments s\'y aimantent'); enregistrer(p); zone._html = ''; };
      document.addEventListener('pointermove', bouger); document.addEventListener('pointerup', fin);
    }));
    const basculerRegles = () => { regles = !regles; Stock.ecrire('studio.regles', regles); $('#regles-btn').classList.toggle('on', regles); zone._html = ''; dessinerRegles(); if (regles) toast('Règles : tirez depuis une règle pour poser un repère'); };
    $('#regles-btn').onclick = basculerRegles;
    ecouter(window, 'resize', () => dessinerRegles());
    setTimeout(dessinerRegles, 50);
    E.effacerReperes = () => { p.guides = { v: [], h: [] }; enregistrer(p); zone._html = ''; dessinerRegles(); };

    // ---- Alignement de plusieurs éléments (ou d'un seul sur la page)
    function aligner(mode) {
      const cs = selection(); if (!cs.length) return;
      E.modif(true);
      const bs = cs.map(c => ({ c, b: eng.bbox[c.id] || { x: Number(c.x), y: Number(c.y), w: 0, h: 0 } }));
      const seul = cs.length === 1;
      const x1 = seul ? 0 : Math.min(...bs.map(q => q.b.x)), x2 = seul ? 100 : Math.max(...bs.map(q => q.b.x + q.b.w));
      const y1 = seul ? 0 : Math.min(...bs.map(q => q.b.y)), y2 = seul ? 100 : Math.max(...bs.map(q => q.b.y + q.b.h));
      const marge = seul ? 6 : 0;
      const dep = (q, dx, dy) => { q.c.x = Math.round(Math.max(0, Math.min(100, Number(q.c.x) + dx)) * 10) / 10; q.c.y = Math.round(Math.max(0, Math.min(100, Number(q.c.y) + dy)) * 10) / 10; };
      if (mode === 'gauche') bs.forEach(q => dep(q, x1 + marge - q.b.x, 0));
      if (mode === 'centre-h') bs.forEach(q => dep(q, (x1 + x2) / 2 - (q.b.x + q.b.w / 2), 0));
      if (mode === 'droite') bs.forEach(q => dep(q, x2 - marge - (q.b.x + q.b.w), 0));
      if (mode === 'haut') bs.forEach(q => dep(q, 0, y1 + marge - q.b.y));
      if (mode === 'centre-v') bs.forEach(q => dep(q, 0, (y1 + y2) / 2 - (q.b.y + q.b.h / 2)));
      if (mode === 'bas') bs.forEach(q => dep(q, 0, y2 - marge - (q.b.y + q.b.h)));
      if (mode === 'page') { const cx = (x1 + x2) / 2; bs.forEach(q => dep(q, 50 - cx, 0)); }
      if (mode === 'repartir-v' && bs.length > 2) {
        const tri = bs.slice().sort((a, b) => a.b.y - b.b.y), total = tri.reduce((s, q) => s + q.b.h, 0), ecart = ((y2 - y1) - total) / (tri.length - 1);
        let y = y1; tri.forEach(q => { dep(q, 0, y - q.b.y); y += q.b.h + ecart; });
      }
      if (mode === 'repartir-h' && bs.length > 2) {
        const tri = bs.slice().sort((a, b) => a.b.x - b.b.x), total = tri.reduce((s, q) => s + q.b.w, 0), ecart = ((x2 - x1) - total) / (tri.length - 1);
        let x = x1; tri.forEach(q => { dep(q, x - q.b.x, 0); x += q.b.w + ecart; });
      }
      E.rafraichir(); rendreReglages();
    }
    E.aligner = aligner;
    function majChamps(c) { ['x', 'y', 'largeur', 'taille', 'hauteur'].forEach(k => { const i = $(`#props [data-k="${k}"]`); if (i && document.activeElement !== i) i.value = c[k]; }); }

    // Double-clic : écrire directement dans le texte
    zone.addEventListener('dblclick', e => {
      const c = calqueA(e);
      if (c && (c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur')) { e.preventDefault(); editer(c); }
      else if (c && (c.type === 'image' || c.type === 'video')) { const inp = $('#props [data-remplacer]'); if (inp) inp.click(); }
    });
    function editer(c) {
      if (editeur) terminerEdition();
      choisir(c.id);
      const b = eng.bbox[c.id]; if (!b) return;
      snapshot();
      const hz = cadre.clientHeight;
      const ta = document.createElement('textarea');
      ta.className = 'edition-directe';
      ta.value = c.texte || '';
      const texte = c.type === 'texte';
      const taillePx = (Number(c.taille) || (texte ? 4 : 2.4)) / 100 * hz;
      Object.assign(ta.style, {
        left: (texte ? b.x : b.x) + '%', top: b.y + '%', width: b.w + '%', minHeight: Math.max(b.h, 4) + '%',
        fontFamily: `"${c.police || 'Cormorant Garamond'}", serif`, fontSize: taillePx + 'px', lineHeight: String(Number(c.interligne) || 1.25),
        color: texte ? (c.couleur || '#7a1f2b') : '#2b2222', textAlign: c.align || 'center', fontWeight: c.gras || !texte ? '700' : '400', fontStyle: c.italique ? 'italic' : 'normal',
        textTransform: c.majuscules ? 'uppercase' : 'none'
      });
      cadre.appendChild(ta);
      c._edition = true;
      editeur = { c, ta };
      const ajuster = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      ta.addEventListener('input', () => { c.texte = ta.value; ajuster(); const l = $(`.calque-ligne[data-id="${c.id}"] .t`); if (l) l.textContent = ta.value; const t2 = $('#props [data-k="texte"]'); if (t2) t2.value = ta.value; enregistrer(p); });
      ta.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || !texte))) { ev.preventDefault(); terminerEdition(); } });
      ta.addEventListener('blur', () => setTimeout(() => { if (editeur && editeur.ta === ta) terminerEdition(); }, 50));
      ajuster(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      E.rafraichir();
    }
    function terminerEdition() {
      if (!editeur) return;
      const { c, ta } = editeur; editeur = null;
      delete c._edition; ta.remove();
      enregistrer(p); E.rafraichir(); rendrePlans(); zone._html = '';
    }
    E.editer = editer;

    // Presse-papiers : copier, coller, dupliquer (aussi entre plans et entre événements)
    const MARQUE = '[[calque-studio]]';
    const jsonSelection = c => { const cs = E.multi.size > 1 ? selection() : [c]; return JSON.stringify(cs.length > 1 ? cs : cs[0], (k, v) => k === '_edition' ? undefined : v); };
    function copierCalque(c, couper) {
      if (!c) return;
      const json = jsonSelection(c);
      Stock.ecrire('studio.presse', json);
      try { navigator.clipboard && navigator.clipboard.writeText(MARQUE + json).catch(() => {}); } catch (e) {}
      if (couper) supprimerCalque(c); else toast(E.multi.size > 1 ? E.multi.size + ' éléments copiés' : 'Calque copié');
    }
    function collerCalque(json) {
      let lot;
      try { lot = JSON.parse(json || Stock.lire('studio.presse', null)); if (typeof lot === 'string') lot = JSON.parse(lot); } catch (e) { lot = null; }
      if (lot && !Array.isArray(lot)) lot = [lot];
      lot = (lot || []).filter(c => c && c.type);
      if (!lot.length) return toast('Rien à coller : copiez d\'abord un calque (Ctrl+C)');
      E.modif(true);
      const memePlan = lot.some(c => plan().calques.some(x => Math.abs(Number(x.x) - Number(c.x)) < 0.5 && Math.abs(Number(x.y) - Number(c.y)) < 0.5));
      lot.forEach(c => { c.id = uid(); if (memePlan) { c.x = Math.min(95, Number(c.x) + 2); c.y = Math.min(95, Number(c.y) + 2); } plan().calques.push(c); });
      E.multi = new Set(lot.map(c => c.id)); E.sel = lot[lot.length - 1].id;
      eng.precharger().then(() => { E.rafraichir(); rendreReglages(); rendrePlans(); });
      toast(lot.length > 1 ? lot.length + ' éléments collés' : 'Calque collé');
    }
    function dupliquerCalque(c) {
      if (!c) return; const cs = E.multi.size > 1 ? selection() : [c]; E.modif(true);
      const ds = cs.map(x => { const d = JSON.parse(JSON.stringify(x)); delete d._edition; d.id = uid(); d.x = Math.min(95, Number(d.x) + 2); d.y = Math.min(95, Number(d.y) + 2); plan().calques.push(d); return d; });
      E.multi = new Set(ds.map(d => d.id)); E.sel = ds[ds.length - 1].id; E.rafraichir(); rendreReglages(); rendrePlans();
    }
    function supprimerCalque(c) {
      if (!c) return; const ids = new Set(E.multi.size > 1 ? [...E.multi] : [c.id]); E.modif(true);
      const pl = plan(); pl.calques = pl.calques.filter(x => !ids.has(x.id)); E.sel = null; E.multi.clear(); E.rafraichir(); rendreReglages(); rendrePlans();
      if (ids.size > 1) toast(ids.size + ' éléments supprimés (Ctrl+Z pour annuler)');
    }
    function ordreCalque(c, sens) {
      if (!c) return; const pl = plan(); const cs = E.multi.size > 1 ? selection() : [c]; E.modif(true);
      if (sens === 'avance' || sens === 'recule') {
        const l = pl.calques, idx = cs.map(x => l.indexOf(x)).sort((a, b) => sens === 'avance' ? b - a : a - b);
        idx.forEach(k => { const j = sens === 'avance' ? k + 1 : k - 1; if (j < 0 || j >= l.length || cs.includes(l[j])) return; [l[k], l[j]] = [l[j], l[k]]; });
      } else { pl.calques = pl.calques.filter(x => !cs.includes(x)); if (sens === 'avant') pl.calques.push(...cs); else pl.calques.unshift(...cs); }
      E.rafraichir(); rendreReglages();
    }
    // Mise en forme : copier / coller le style d'un calque sur un autre (pinceau)
    const STYLE_TEXTE = ['police', 'graisse', 'rotation', 'taille', 'couleur', 'gras', 'italique', 'majuscules', 'align', 'interligne', 'ombre', 'ombre_couleur', 'ombre_force', 'ombre_opacite', 'ombre_decalage', 'contour', 'contour_epaisseur', 'fond_couleur', 'fond_opacite', 'fond_marge', 'fond_arrondi', 'opacite', 'animation', 'duree_animation', 'sortie', 'duree_sortie'];
    const STYLE_BOUTON = ['police', 'graisse', 'taille', 'couleur', 'style'];
    const STYLE_MEDIA = ['forme', 'arrondi', 'forme_points', 'forme_lisse', 'bordure_epaisseur', 'ombre_cadre', 'bordure', 'opacite', 'remplir', 'animation', 'duree_animation', 'sortie', 'duree_sortie'];
    const clesStyle = t => t === 'texte' ? STYLE_TEXTE : (t === 'bouton' || t === 'compteur' || t === 'champ') ? STYLE_BOUTON : STYLE_MEDIA;
    let pinceau = false;
    function copierStyle(c) {
      if (!c) return;
      const props = {}; clesStyle(c.type).forEach(k => { if (c[k] !== undefined) props[k] = c[k]; });
      Stock.ecrire('studio.style', { type: c.type, props });
      toast('Mise en forme copiée : choisissez un calque puis « Coller la mise en forme » (Ctrl+Alt+V), ou cliquez-le avec le pinceau');
      rendreBarre();
    }
    function appliquerStyle(cibles) {
      const st = Stock.lire('studio.style', null);
      if (!st) return toast('Copiez d\'abord une mise en forme (Ctrl+Alt+C)');
      E.modif(true);
      let n = 0;
      cibles.forEach(c => {
        const autorises = clesStyle(c.type);
        if (st.type === 'texte' && c.type === 'texte') ['fond_couleur', 'contour', 'ombre_decalage'].forEach(k => { if (!(k in st.props)) delete c[k]; });
        Object.entries(st.props).forEach(([k, v]) => {
          if (!autorises.includes(k)) return;
          if (k === 'taille' && st.type !== c.type) return;     // tailles de texte et de bouton ne se comparent pas
          c[k] = v;
        });
        n++;
      });
      E.rafraichir(); rendreReglages();
      toast(n > 1 ? `Mise en forme appliquée à ${n} calques` : 'Mise en forme collée');
    }
    function collerStyle(c) { if (c) appliquerStyle([c]); }
    function collerStylePartout(c, portee) {
      const st = Stock.lire('studio.style', null); if (!st) return toast('Copiez d\'abord une mise en forme (Ctrl+Alt+C)');
      const type = c ? c.type : st.type;
      const plans = portee === 'invitation' ? p.plans : [plan()];
      const cibles = []; plans.forEach(pl => (pl.calques || []).forEach(x => { if (x.type === type) cibles.push(x); }));
      appliquerStyle(cibles);
    }
    function basculerPinceau() {
      if (!pinceau) { if (calqueSel()) copierStyle(calqueSel()); else if (!Stock.lire('studio.style', null)) return toast('Choisissez d\'abord le calque dont vous voulez copier la mise en forme'); }
      pinceau = !pinceau; zone.classList.toggle('pinceau', pinceau); rendreBarre();
      if (pinceau) toast('Pinceau actif : cliquez les calques à mettre en forme (Échap pour arrêter)');
    }
    E.copierCalque = copierCalque; E.collerCalque = collerCalque; E.dupliquerCalque = dupliquerCalque; E.supprimerCalque = supprimerCalque; E.ordreCalque = ordreCalque;

    const dansChamp = el => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    ecouter(document, 'keydown', e => {
      if (!$('#cadre') || dansChamp(document.activeElement) || !$('#modale').hidden) return;
      const c = calqueSel(), mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('#refaire') : $('#annuler')).click(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); $('#refaire').click(); return; }
      if (mod && e.altKey && e.code === 'KeyC' && c) { e.preventDefault(); copierStyle(c); return; }
      if (mod && e.altKey && e.code === 'KeyV' && c) { e.preventDefault(); collerStyle(c); return; }
      if (e.key === 'Escape' && pinceau) { pinceau = false; zone.classList.remove('pinceau'); rendreBarre(); return; }
      if (mod && e.key.toLowerCase() === 'd' && c) { e.preventDefault(); dupliquerCalque(c); return; }
      if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft') && c) { e.preventDefault(); ordreCalque(c, e.code === 'BracketRight' ? (e.shiftKey ? 'avant' : 'avance') : (e.shiftKey ? 'arriere' : 'recule')); return; }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); E.zoomer(1.2); return; }
      if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); E.zoomer(1 / 1.2); return; }
      if (mod && e.key === '0') { e.preventDefault(); E.zoomer(0); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); choisirPlusieurs((plan().calques || []).filter(x => !x.masque).map(x => x.id)); toast('Tout est choisi : glissez pour déplacer ensemble'); return; }
      if (e.key === ' ' && (eng.lecture || E.enPause)) { e.preventDefault(); E.basculerPause(); return; }
      if (!c) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); supprimerCalque(c); return; }
      if (e.key === 'Enter' && E.multi.size <= 1 && (c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur')) { e.preventDefault(); editer(c); return; }
      if (e.key === 'Escape') { choisir(null); return; }
      const pas = e.shiftKey ? 2 : 0.5;
      const dep = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] }[e.key];
      if (dep) { e.preventDefault(); E.modif(); const cs = E.multi.size > 1 ? selection() : [c]; cs.forEach(x => { x.x = Math.round(Math.max(0, Math.min(100, Number(x.x) + dep[0])) * 10) / 10; x.y = Math.round(Math.max(0, Math.min(100, Number(x.y) + dep[1])) * 10) / 10; }); if (cs.some(x => I.TYPES_HTML.includes(x.type))) E.rafraichir(); majChamps(c); }
    });
    ecouter(document, 'copy', e => { if (dansChamp(document.activeElement) || !$('#modale').hidden) return; const c = calqueSel(); if (!c) return; e.preventDefault(); const json = jsonSelection(c); e.clipboardData.setData('text/plain', MARQUE + json); Stock.ecrire('studio.presse', json); toast(E.multi.size > 1 ? E.multi.size + ' éléments copiés' : 'Calque copié'); });
    ecouter(document, 'cut', e => { if (dansChamp(document.activeElement) || !$('#modale').hidden) return; const c = calqueSel(); if (!c) return; e.preventDefault(); const json = jsonSelection(c); e.clipboardData.setData('text/plain', MARQUE + json); Stock.ecrire('studio.presse', json); supprimerCalque(c); });
    ecouter(document, 'paste', async e => {
      if (dansChamp(document.activeElement) || !$('#modale').hidden || !$('#cadre')) return;
      const dt = e.clipboardData; if (!dt) return;
      const fichierColle = [...(dt.files || [])].find(f => /^(image|video)\//.test(f.type));
      if (fichierColle) { e.preventDefault(); const m = await importerFichier(fichierColle, null, p.id); sauverMedias(); E.ajouterMedia(m); toast('Image collée'); return; }
      const t = dt.getData('text/plain') || '';
      e.preventDefault();
      if (t.startsWith(MARQUE)) return collerCalque(t.slice(MARQUE.length));
      if (t.trim()) { E.modif(true); const c = { id: uid(), type: 'texte', texte: t.trim().slice(0, 400), x: 50, y: 50, largeur: 62, police: 'Cormorant Garamond', taille: 4, couleur: p.style.couleur || '#7a1f2b', align: 'center', ombre: true, debut: 0.4, animation: 'fondu-montee', sortie: 'aucune' }; plan().calques.push(c); E.sel = c.id; E.rafraichir(); rendreReglages(); rendrePlans(); toast('Texte collé comme nouveau calque'); return; }
      collerCalque(null);
    });

    // Menu du clic droit
    let menu = null;
    function fermerMenu() { if (menu) { menu.remove(); menu = null; } }
    zone.addEventListener('contextmenu', e => {
      e.preventDefault(); fermerMenu();
      const c = calqueA(e); if (c && !(E.multi.size > 1 && E.multi.has(c.id))) choisir(c.id);
      const r = $('.col-apercu').getBoundingClientRect();
      menu = document.createElement('div'); menu.className = 'menu-ctx';
      const it = (a, t, ok) => `<button data-m="${a}" ${ok === false ? 'disabled' : ''}>${t}</button>`;
      const ecr = c && (c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur');
      menu.innerHTML = (c ? it('editer', 'Modifier le texte', ecr) + it('copier', 'Copier  ·  Ctrl+C') + it('couper', 'Couper  ·  Ctrl+X') : '') + it('coller', 'Coller  ·  Ctrl+V', !!Stock.lire('studio.presse', null)) + (c ? '<hr>' + it('style-c', 'Copier la mise en forme  ·  Ctrl+Alt+C') + it('style-v', 'Coller la mise en forme  ·  Ctrl+Alt+V', !!Stock.lire('studio.style', null)) + it('style-plan', 'Coller la mise en forme sur tout le plan', !!Stock.lire('studio.style', null)) + it('style-inv', 'Coller la mise en forme sur toute l\'invitation', !!Stock.lire('studio.style', null)) + '<hr>' : '') + (c ? it('dupliquer', 'Dupliquer  ·  Ctrl+D') + it('avant', 'Mettre au premier plan') + it('arriere', 'Mettre à l\'arrière-plan') + it('centrer', 'Centrer horizontalement') + it('suppr', 'Supprimer  ·  Suppr') : '');
      menu.style.left = (e.clientX - r.left) + 'px'; menu.style.top = (e.clientY - r.top) + 'px';
      $('.col-apercu').appendChild(menu);
      menu.onclick = ev => {
        const a = ev.target.dataset.m; if (!a) return; fermerMenu();
        if (a === 'editer') editer(c); if (a === 'copier') copierCalque(c); if (a === 'couper') copierCalque(c, true); if (a === 'coller') collerCalque(null);
        if (a === 'dupliquer') dupliquerCalque(c); if (a === 'avant' || a === 'arriere' || a === 'avance' || a === 'recule') ordreCalque(c, a); if (a === 'suppr') supprimerCalque(c);
        if (a === 'centrer') { E.modif(true); c.x = 50; E.rafraichir(); majChamps(c); }
        if (a === 'style-c') copierStyle(c); if (a === 'style-v') collerStyle(c);
        if (a === 'style-plan') collerStylePartout(c, 'plan'); if (a === 'style-inv') { if (confirm('Appliquer cette mise en forme à tous les calques du même type dans toute l\'invitation ?')) collerStylePartout(c, 'invitation'); }
      };
    });
    ecouter(document, 'pointerdown', e => { if (menu && !menu.contains(e.target)) fermerMenu(); });

    // Barre d'outils du calque choisi (au-dessus de l'aperçu)
    function rendreBarre() {
      const bar = $('#barre-sel'); if (!bar) return;
      const c = calqueSel();
      const ALIGN = `<span class="sep"></span><button class="btn petit icone" data-al="gauche" title="Aligner à gauche">⫷</button><button class="btn petit icone" data-al="centre-h" title="Centrer horizontalement">⇔</button><button class="btn petit icone" data-al="droite" title="Aligner à droite">⫸</button><button class="btn petit icone" data-al="haut" title="Aligner en haut">⤒</button><button class="btn petit icone" data-al="centre-v" title="Centrer verticalement">⇕</button><button class="btn petit icone" data-al="bas" title="Aligner en bas">⤓</button>`;
      if (c && E.multi.size > 1) {
        const cs = selection(), ecrits = cs.filter(x => x.type === 'texte' || x.type === 'bouton' || x.type === 'compteur');
        bar.innerHTML = `<b class="type-sel">${cs.length} éléments</b>${ALIGN}<button class="btn petit icone" data-al="repartir-v" title="Répartir verticalement (espaces égaux)" ${cs.length > 2 ? '' : 'disabled'}>☰</button><button class="btn petit icone" data-al="repartir-h" title="Répartir horizontalement" ${cs.length > 2 ? '' : 'disabled'}>⫼</button><button class="btn petit icone" data-al="page" title="Centrer le groupe sur la page">◎</button>
          <span class="sep"></span>${ecrits.length ? `<input type="color" data-b="couleur" value="${ecrits[0].couleur || '#7a1f2b'}" title="Couleur de tous les textes choisis"><button class="btn petit" data-b="police" title="Police de tous les textes choisis">Police</button>` : ''}<button class="btn petit icone" data-b="moins" title="Tout réduire">−</button><button class="btn petit icone" data-b="plus" title="Tout agrandir">+</button>
          <span class="sep"></span><button class="btn petit icone" data-b="copier" title="Copier (Ctrl+C)">⧉</button><button class="btn petit icone" data-b="dupliquer" title="Dupliquer (Ctrl+D)">⊕</button><button class="btn petit icone" data-b="avant" title="Tout devant (premier plan) — Ctrl+Maj+]">⤒</button><button class="btn petit icone" data-b="avance" title="Avancer d'un cran — Ctrl+]">↑</button><button class="btn petit icone" data-b="recule" title="Reculer d'un cran — Ctrl+[">↓</button><button class="btn petit icone" data-b="arriere" title="Tout derrière (arrière-plan) — Ctrl+Maj+[">⤓</button><button class="btn petit icone danger" data-b="suppr" title="Supprimer (Suppr)">🗑</button>`;
        lierBarre(bar, c); return;
      }
      if (!c) { bar.innerHTML = pinceau ? `<span class="muet">🖌 Pinceau actif : cliquez les calques à mettre en forme</span><button class="btn petit" data-b="pinceau">Arrêter</button>` : `<span class="muet">Cliquez un élément de l'aperçu pour le modifier</span>${Stock.lire('studio.presse', null) ? '<button class="btn petit" data-b="coller">Coller</button>' : ''}`; lierBarre(bar, c); return; }
      const ecr = c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur';
      bar.innerHTML = `<b class="type-sel">${esc(nomType(c))}</b>
        ${ecr ? '<button class="btn petit" data-b="editer" title="Modifier le texte (double-clic)">✎ Écrire</button>' : '<button class="btn petit" data-b="remplacer">Remplacer</button>'}
        ${!aHauteur(c) ? `<button class="btn petit icone" data-b="moins" title="Plus petit">A−</button><button class="btn petit icone" data-b="plus" title="Plus grand">A+</button>` : `<button class="btn petit icone" data-b="moins" title="Plus petit">−</button><button class="btn petit icone" data-b="plus" title="Plus grand">+</button>`}
        ${c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur' || c.type === 'forme' ? `<input type="color" data-b="couleur" value="${c.couleur || '#7a1f2b'}" title="Couleur">` : ''}
        ${c.type === 'texte' ? `<button class="btn petit icone ${c.gras ? 'on' : ''}" data-b="gras" title="Gras"><b>G</b></button><button class="btn petit icone ${c.italique ? 'on' : ''}" data-b="italique" title="Italique"><i>I</i></button><span class="groupe-align">${[['left', 'Aligner le texte à gauche', '<svg viewBox="0 0 16 16"><path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h7"/></svg>'], ['center', 'Centrer le texte', '<svg viewBox="0 0 16 16"><path d="M2 3h12M4 6.5h8M2 10h12M4.5 13.5h7"/></svg>'], ['right', 'Aligner le texte à droite', '<svg viewBox="0 0 16 16"><path d="M2 3h12M6 6.5h8M2 10h12M7 13.5h7"/></svg>'], ['justify', 'Justifier le texte', '<svg viewBox="0 0 16 16"><path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h7"/></svg>']].map(([k, t, ic]) => `<button class="btn petit icone ${(c.align || 'center') === k ? 'on' : ''}" data-talign="${k}" title="${t}">${ic}</button>`).join('')}</span>` : ''}
        ${ecr ? `<button class="btn petit police-btn" data-b="police" title="Choisir la police" style="font-family:'${esc(c.police || 'Cormorant Garamond')}'">${esc((c.police || 'Cormorant Garamond').slice(0, 16))} ▾</button>` : ''}${c.type === 'texte' ? '<button class="btn petit icone" data-b="emoji" title="Ajouter un emoji">😊</button>' : ''}
        ${aHauteur(c) ? `<button class="btn petit" data-b="forme" title="Forme du cadre : rond, cœur, arche, étoile… ou forme libre">◇ Forme${c.forme ? ' : ' + esc(((MoteurInfo.FORMES.find(x => x[0] === c.forme) || [0, ''])[1]).replace(/ \(.*\)$/, '')) : ''}</button><button class="btn petit" data-b="recadrer" title="Rogner : garder une partie de la photo ou de la vidéo">⬚ Rogner</button>` : ''}
        <span class="sep"></span><button class="btn petit icone" data-al="centre-h" title="Centrer sur la page (horizontal)">⇔</button><button class="btn petit icone" data-al="centre-v" title="Centrer sur la page (vertical)">⇕</button>
        <span class="sep"></span>
        <button class="btn petit icone ${pinceau ? 'on' : ''}" data-b="pinceau" title="Pinceau : copier la mise en forme puis cliquer les calques à mettre en forme">🖌</button><button class="btn petit icone" data-b="style-v" title="Coller la mise en forme (Ctrl+Alt+V)" ${Stock.lire('studio.style', null) ? '' : 'disabled'}>🎨</button>
        <span class="sep"></span>
        <button class="btn petit icone" data-b="copier" title="Copier (Ctrl+C)">⧉</button><button class="btn petit icone" data-b="coller" title="Coller (Ctrl+V)">📋</button><button class="btn petit icone" data-b="dupliquer" title="Dupliquer (Ctrl+D)">⊕</button>
        <button class="btn petit icone" data-b="avant" title="Premier plan">⬆</button><button class="btn petit icone" data-b="arriere" title="Arrière-plan">⬇</button>
        <button class="btn petit icone danger" data-b="suppr" title="Supprimer (Suppr)">🗑</button>`;
      lierBarre(bar, c);
    }
    function lierBarre(bar, c) {
      $$('[data-al]', bar).forEach(el => el.onclick = () => aligner(el.dataset.al));
      $$('[data-talign]', bar).forEach(el => el.onclick = () => { E.modif(true); (E.multi.size > 1 ? selection() : [c]).filter(x => x.type === 'texte').forEach(x => { x.align = el.dataset.talign; }); E.rafraichir(); rendreReglages(); });
      const groupe = () => E.multi.size > 1 ? selection() : (c ? [c] : []);
      $$('[data-b]', bar).forEach(el => {
        const a = el.dataset.b;
        if (a === 'couleur') { el.oninput = () => { E.modif(); groupe().filter(x => x.type !== 'image' && x.type !== 'video').forEach(x => { x.couleur = el.value; }); if (groupe().some(x => I.TYPES_HTML.includes(x.type))) E.rafraichir(); const i = $('#props [data-k="couleur"]'); if (i) i.value = el.value; }; return; }
        if (a === 'police') { el.onclick = () => ouvrirPolices(el, c.police, nom => { E.modif(true); groupe().filter(x => x.type === 'texte' || x.type === 'bouton' || x.type === 'compteur').forEach(x => { x.police = nom; }); appliquerPolice(nom); }); return; }
        if (a === 'emoji') { el.onclick = () => ouvrirEmojis(el, em => { E.modif(true); c.texte = (c.texte || '') + (c.texte && !/\s$/.test(c.texte) ? ' ' : '') + em; E.rafraichir(); rendreReglages(); }); return; }
        if (a === 'recadrer') { el.onclick = () => recadrerCalque(c); return; }
        if (a === 'forme') { el.onclick = () => ouvrirFormes(el, c); return; }
        el.onclick = () => {
          if (a === 'coller') return collerCalque(null);
          if (a === 'pinceau' && !c) return basculerPinceau();
          if (!c) return;
          if (a === 'editer') editer(c);
          if (a === 'remplacer') { const inp = $('#props [data-remplacer]'); if (inp) inp.click(); }
          if (a === 'plus' || a === 'moins') {
            E.modif(); const f = a === 'plus' ? 1.1 : 1 / 1.1;
            groupe().forEach(x => {
              if (aHauteur(x)) { x.largeur = Math.round(Math.min(100, (Number(x.largeur) || 40) * f) * 10) / 10; x.hauteur = Math.round(Math.min(100, (Number(x.hauteur) || 22) * f) * 10) / 10; }
              else x.taille = Math.round(Math.max(1, Math.min(15, (Number(x.taille) || 3) * f)) * 10) / 10;
            });
            if (groupe().some(x => I.TYPES_HTML.includes(x.type))) E.rafraichir(); majChamps(c);
          }
          if (a === 'gras' || a === 'italique') { E.modif(true); c[a] = !c[a]; rendreReglages(); }
          if (a === 'align') { E.modif(true); c.align = { center: 'left', left: 'right', right: 'center' }[c.align || 'center']; rendreReglages(); }
          if (a === 'copier') copierCalque(c);
          if (a === 'pinceau') return basculerPinceau();
          if (a === 'style-v') return collerStyle(c);
          if (a === 'dupliquer') dupliquerCalque(c);
          if (a === 'avant' || a === 'arriere') ordreCalque(c, a);
          if (a === 'suppr') supprimerCalque(c);
        };
      });
    }
    E.rendreBarre = rendreBarre;

    /* Liste des plans */
    function rendrePlans() {
      const col = $('#col-plans');
      col.innerHTML = `<div class="section-titre entete-plans" style="margin-top:0">Plans <span class="muet">${p.plans.length}</span></div>` + p.plans.map((pl, k) => {
        const textes = (pl.calques || []).filter(c => c.type === 'texte').map(c => c.texte).join(' · ');
        const mobile = pl.role === 'intermediaire';
        return `<div class="plan-carte ${k === E.i ? 'actif' : ''}" data-k="${k}">
          <img src="${esc(vignettePlan(pl))}" alt="">
          <div style="min-width:0"><div class="role ${mobile ? '' : 'fixe'}">${k + 1}. ${ROLES[pl.role] || pl.role}</div><div class="resume">${esc(textes || '—')}</div><div class="muet">${Number(pl.duree) ? Number(pl.duree).toFixed(1) + ' s' : 'interactif'}</div></div>
          <div class="actions">${mobile ? `<button data-a="haut" title="Monter">▲</button><button data-a="bas" title="Descendre">▼</button><button data-a="dup" title="Dupliquer">⧉</button><button data-a="suppr" title="Supprimer">✕</button>` : ''}</div>
        </div>`;
      }).join('') + `<div class="pile" style="margin-top:6px"><button class="btn petit" id="ajout-plan">+ Plan intermédiaire</button><button class="btn petit ia" id="finaliser-tout">✨ Composer tous les plans avec l'IA</button></div>`;
      $$('.plan-carte', col).forEach(c => c.onclick = e => {
        const k = Number(c.dataset.k), a = e.target.dataset.a;
        if (a) {
          e.stopPropagation();
          const inter = p.plans.map((x, j) => x.role === 'intermediaire' ? j : -1).filter(j => j >= 0);
          if (a === 'haut' && k > 0 && p.plans[k - 1].role === 'intermediaire') { snapshot(); [p.plans[k - 1], p.plans[k]] = [p.plans[k], p.plans[k - 1]]; E.i = k - 1; }
          if (a === 'bas' && p.plans[k + 1] && p.plans[k + 1].role === 'intermediaire') { snapshot(); [p.plans[k + 1], p.plans[k]] = [p.plans[k], p.plans[k + 1]]; E.i = k + 1; }
          if (a === 'dup') { snapshot(); const cp = JSON.parse(JSON.stringify(p.plans[k])); cp.id = uid(); cp.calques.forEach(c => c.id = uid()); p.plans.splice(k + 1, 0, cp); E.i = k + 1; }
          if (a === 'suppr') { if (inter.length <= 1) return toast('Il faut au moins un plan intermédiaire'); if (!confirm('Supprimer ce plan ?')) return; snapshot(); p.plans.splice(k, 1); E.i = Math.max(0, k - 1); }
          E.sel = null; enregistrer(p); afficher(); return;
        }
        E.i = k; E.sel = null; E.t = 0; eng.pause(); eng.mode = 'edition'; afficher();
      });
      $('#ajout-plan').onclick = () => {
        snapshot();
        const pos = p.plans[E.i].role === 'intermediaire' || p.plans[E.i].role === 'ouverture' ? E.i + 1 : p.plans.findIndex(x => x.role === 'confirmation');
        const f = fondsDe(p).find(x => x.usage === 'programme') || fondsDe(p)[0];
        p.plans.splice(pos, 0, { id: uid(), role: 'intermediaire', duree: 6, fond: { media: f.src, boucle: true, assombrir: 0, eclaircir: 0 }, transition: { type: 'fondu', duree: 0.8 }, calques: [{ id: uid(), type: 'texte', texte: 'Nouveau texte', x: f.zone ? f.zone.x : 50, y: 50, largeur: 60, police: 'Cormorant Garamond', taille: 4.4, couleur: p.style.couleur, ombre: true, align: 'center', debut: 0.4, animation: 'fondu-montee' }] });
        E.i = pos; E.sel = null; enregistrer(p); eng.precharger().then(afficher);
      };
      $('#finaliser-tout').onclick = () => modaleComposerTout(E);
    }

    /* Réglages du plan et des calques */
    function rendreReglages() {
      const pl = plan();
      const col = $('#col-reglages');
      const fonds = fondsDe(p, pl.fond.media);
      const c = (pl.calques || []).find(x => x.id === E.sel);
      const fondActuel = fonds.find(f => f.src === pl.fond.media);
      const nbMemeFond = p.plans.filter(x => x.fond && x.fond.media === pl.fond.media).length;
      const typeF = MoteurInfo.typeFond(pl.fond);
      const photosFond = medias.filter(m => m.type === 'image' && (pourEvt(m, p.id) || m.src === pl.fond.media)).concat(Equipe.medias().filter(m => m.type === 'image'));
      $('#cadre').classList.toggle('sans-fond', typeF === 'aucun');
      col.innerHTML = `
        <div class="section-titre" style="margin-top:0">Plan ${E.i + 1} · ${ROLES[pl.role]}</div>
        <details class="bloc" open><summary>Fond</summary>
          <div class="seg fond-types">${[['video', '🎬 Vidéo'], ['image', '🖼 Photo'], ['couleur', '🎨 Couleur'], ['aucun', '▦ Sans fond']].map(([k, n]) => `<button data-ftype="${k}" class="${typeF === k || (k === 'video' && typeF === 'defaut') ? 'on' : ''}">${n}</button>`).join('')}</div>
          ${typeF === 'video' || typeF === 'defaut' ? `
          <div class="fond-actuel"><img src="${esc(vignetteDe(pl.fond.media))}" alt=""><div style="min-width:0"><b>${esc(fondActuel ? fondActuel.nom : '—')}</b>
            <div class="muet">${nbMemeFond > 1 ? `Utilisé par ${nbMemeFond} plans` : 'Utilisé par ce plan seulement'}</div></div></div>
          <button class="btn plein" id="p-fond-choisir" data-kind="video" style="width:100%;margin:4px 0 8px" title="Recherche, par événement, par plan">🔍 Choisir un fond…</button>

          <div class="ligne" style="margin-top:8px"><label class="btn petit">Importer un fond<input type="file" id="imp-fond-plan" accept="video/*" hidden></label><button class="btn petit ia" id="fond-ia" title="S'ouvre dans la Bibliothèque">✨ Créer avec l'IA (Bibliothèque)</button><button class="btn petit" id="fond-couper">✂ Couper${MoteurInfo.plage(pl.fond) ? ' (' + MoteurInfo.plage(pl.fond).map(x => x.toFixed(1)).join(' → ') + ' s)' : ''}</button><button class="btn petit" id="fond-rogner">⬚ Rogner${pl.fond.recadrage ? ' ✓' : ''}</button></div>
          <label class="champ" style="margin-top:8px">Vitesse de la vidéo<select id="p-vitesse">${optsVitesse(pl.fond.vitesse)}</select></label>` : ''}
          ${typeF === 'image' ? `
          <div class="fond-actuel"><img src="${esc(vignettePlan(pl))}" alt=""><div style="min-width:0"><b>${esc(nomMedia(pl.fond.media) || 'Photo')}</b><div class="muet">Photo en fond d'écran (remplit tout l'écran)</div></div></div>
          <button class="btn plein" id="p-fond-choisir" data-kind="image" style="width:100%;margin:4px 0 8px" title="Recherche, par événement, par plan">🔍 Choisir une photo…</button>

          <div class="ligne" style="margin-top:8px"><label class="btn petit plein">Importer une photo<input type="file" id="imp-fond-img" accept="image/*" hidden></label><button class="btn petit" id="fond-rogner">⬚ Rogner${pl.fond.recadrage ? ' ✓' : ''}</button></div>
          <label class="champ" style="margin-top:8px">Flou<input type="range" id="p-flou" min="0" max="20" step="1" value="${pl.fond.flou || 0}"></label>` : ''}
          ${typeF === 'couleur' ? `
          <div class="pastilles">${PALETTE_FONDS.map(([c1, c2]) => `<button class="pastille" data-c1="${c1}" data-c2="${c2 || ''}" title="${c2 ? 'Dégradé' : 'Couleur unie'}" style="background:${c2 ? `linear-gradient(${c1},${c2})` : c1}"></button>`).join('')}</div>
          <div class="deux" style="margin-top:8px"><label class="champ">Couleur<input type="color" id="p-c1" value="${pl.fond.couleur || '#f4ede2'}"></label>
            <label class="champ"><span><input type="checkbox" id="p-degrade" ${pl.fond.couleur2 ? 'checked' : ''}> Dégradé vers</span><input type="color" id="p-c2" value="${pl.fond.couleur2 || '#e8d6bd'}" ${pl.fond.couleur2 ? '' : 'disabled'}></label></div>
          ${pl.fond.couleur2 ? `<div class="deux"><label class="champ">Forme<select id="p-deg-type">${opts([['lineaire', 'Linéaire'], ['radial', 'Rond (depuis le centre)']], pl.fond.degrade === 'radial' ? 'radial' : 'lineaire')}</select></label>${pl.fond.degrade === 'radial' ? '' : `<label class="champ">Direction<input type="range" id="p-angle" min="0" max="360" step="15" value="${Number(pl.fond.angle) || 180}"></label>`}</div>` : ''}` : ''}
          ${typeF === 'aucun' ? `<div class="alerte-boite" style="background:#f3f6fb;border-color:#c9d6ea;color:#33445c">Plan sans fond (transparent, en damier dans l'aperçu). Sur la page de l'invitation, la couleur crème apparaît derrière. Pour une vidéo transparente, à poser par-dessus une autre vidéo (CapCut, Premiere…) : onglet <b>Film et publication → Vidéo sans fond</b>. Le film MP4 met un fond crème.</div>` : ''}
          ${typeF !== 'aucun' ? `<div class="deux" style="margin-top:8px">
            <label class="champ">Éclaircir<input type="range" id="p-ecl" min="0" max="0.7" step="0.05" value="${pl.fond.eclaircir || 0}"></label>
            <label class="champ">Assombrir<input type="range" id="p-asb" min="0" max="0.7" step="0.05" value="${pl.fond.assombrir || 0}"></label>
          </div>` : ''}
          <button class="btn petit" id="fond-tous" style="margin-top:8px" title="Mettre ce fond sur tous les plans">Appliquer ce fond à tous les plans</button>
        </details>
        <details class="bloc" open><summary>Durée et transition</summary>
          <div class="deux">
            <label class="champ">Durée (s)${pl.role === 'confirmation' ? ' — 0 = attend l\'invité' : ''}<input type="number" id="p-duree" min="0" max="30" step="0.5" value="${pl.duree}"></label>
            <label class="champ">Transition d'arrivée<select id="p-trans">${opts([['aucune', 'Aucune'], ['fondu', 'Fondu enchaîné'], ['fondu-blanc', 'Fondu au blanc'], ['fondu-noir', 'Fondu au noir'], ['glissement', 'Glissement (côté)'], ['glissement-haut', 'Glissement (vers le haut)'], ['zoom', 'Zoom'], ['flou', 'Flou'], ['volet', 'Volet'], ['rideau', 'Rideau (depuis le centre)'], ['cercle', 'Cercle']], (pl.transition && pl.transition.type) || 'fondu')}</select></label>
          </div>
          <div class="ligne"><label class="champ" style="flex:1">Durée de la transition (s)<input type="number" id="p-trans-d" min="0.2" max="3" step="0.1" value="${(pl.transition && pl.transition.duree) || 0.8}"></label><button class="btn petit" id="p-trans-voir" style="align-self:flex-end">▶ Voir la transition</button></div>
          <button class="btn petit" id="empiler" style="margin-top:8px">Éviter les chevauchements de textes</button>
        </details>
        <details class="bloc" open><summary>Calques <span class="muet">${(pl.calques || []).length}</span></summary>
          <div class="ligne" style="gap:4px;margin-bottom:8px"><button class="btn petit" data-ajout="texte">+ Texte</button><button class="btn petit" data-ajout="bouton">+ Bouton</button><button class="btn petit" data-ajout="compteur">+ Compteur</button><label class="btn petit">+ Photo / vidéo<input type="file" id="imp-calque" accept="image/*,video/*" hidden></label><button class="btn petit" id="ajout-illu">+ Illustration</button><button class="btn petit" id="ajout-emoji">+ Emoji</button><button class="btn petit" id="ajout-forme">+ Forme</button></div>
          <div class="muet" style="font-size:11.5px;margin:-2px 0 6px">En haut de la liste = devant · glisser ▲▼ pour changer l'ordre</div>
          <div id="liste-calques">${(pl.calques || []).slice().reverse().map(x => `
            <div class="calque-ligne ${x.id === E.sel || (E.multi.size > 1 && E.multi.has(x.id)) ? 'actif' : ''}" data-id="${x.id}" title="Maj+clic : choisir plusieurs">
              <span class="type">${NOMS_TYPE[x.type] || x.type}</span><span class="t">${esc(x.texte || (x.illu && window.Illustrations ? '✿ ' + Illustrations.nom(x.illu.id) : '') || nomMedia(x.media) || '(vide)')}</span>
              <button data-a="vis" title="Afficher / masquer">${x.masque ? '○' : '●'}</button><button data-a="avance" title="Avancer (devant)">▲</button><button data-a="recule" title="Reculer (derrière)">▼</button><button data-a="suppr" title="Supprimer">✕</button>
            </div>`).join('') || '<p class="muet">Aucun calque.</p>'}</div>
        </details>
        <div id="props">${E.multi.size > 1 ? formulaireMulti() : c ? formulaireCalque(c) : '<p class="muet" style="margin-top:12px">Cliquez un calque dans la liste ou sur l\'aperçu pour le modifier. Glissez-le sur l\'aperçu pour le déplacer.</p>'}</div>`;
      const surFond = (id, ev, fn) => { const el = $('#' + id, col); if (el) el[ev] = fn; };
      const majFond = (fort) => { E.modif(fort); eng.precharger().then(() => { eng._entrerPlan(); afficher(); }); };
      $$('[data-ftype]', col).forEach(b => b.onclick = () => {
        const t = b.dataset.ftype; E.modif(true);
        if (t === 'video') { delete pl.fond.type; if (!pl.fond.media || MoteurInfo.typeFond({ media: pl.fond.media }) !== 'video') { const f = fonds[0]; pl.fond.media = f ? f.src : ''; } delete pl.fond.recadrage; }
        if (t === 'image') { pl.fond.type = 'image'; if (MoteurInfo.typeFond({ media: pl.fond.media }) !== 'image') { pl.fond.media = photosFond[0] ? photosFond[0].src : ''; delete pl.fond.recadrage; } }
        if (t === 'couleur') { pl.fond.type = 'couleur'; pl.fond.couleur = pl.fond.couleur || '#f4ede2'; }
        if (t === 'aucun') pl.fond.type = 'aucun';
        majFond(true);
      });
      surFond('p-fond-img', 'onchange', e => { pl.fond.type = 'image'; pl.fond.media = e.target.value; delete pl.fond.recadrage; majFond(true); });
      surFond('imp-fond-img', 'onchange', async e => { const f = e.target.files[0]; if (!f) return; const m = await importerFichier(f, 'image', p.id); sauverMedias(); pl.fond.type = 'image'; pl.fond.media = m.src; delete pl.fond.recadrage; majFond(true); toast('Photo mise en fond'); });
      surFond('p-flou', 'oninput', e => { E.modif(); pl.fond.flou = Number(e.target.value) || 0; });
      surFond('fond-rogner', 'onclick', () => modaleRecadrer(pl.fond, pl.fond.media, 9 / 16, () => majFond(true), { fond: true }));
      $$('.pastille', col).forEach(b => b.onclick = () => { E.modif(true); pl.fond.type = 'couleur'; pl.fond.couleur = b.dataset.c1; if (b.dataset.c2) pl.fond.couleur2 = b.dataset.c2; else delete pl.fond.couleur2; afficher(); });
      surFond('p-c1', 'oninput', e => { E.modif(); pl.fond.couleur = e.target.value; });
      surFond('p-c1', 'onchange', () => rendrePlans());
      surFond('p-degrade', 'onchange', e => { E.modif(true); if (e.target.checked) pl.fond.couleur2 = $('#p-c2').value || '#e8d6bd'; else delete pl.fond.couleur2; afficher(); });
      surFond('p-c2', 'oninput', e => { E.modif(); pl.fond.couleur2 = e.target.value; });
      surFond('p-deg-type', 'onchange', e => { E.modif(true); if (e.target.value === 'radial') pl.fond.degrade = 'radial'; else delete pl.fond.degrade; afficher(); });
      surFond('p-angle', 'oninput', e => { E.modif(); pl.fond.angle = Number(e.target.value); });
      surFond('p-fond-choisir', 'onclick', e => choisirFond(e.currentTarget.dataset.kind));
      surFond('fond-tous', 'onclick', () => { if (!confirm('Mettre ce fond (et ses réglages) sur tous les plans de l\'invitation ?')) return; E.modif(true); const modele = JSON.stringify(pl.fond); p.plans.forEach(x => { x.fond = JSON.parse(modele); }); majFond(true); toast('Fond appliqué à tous les plans (↶ pour annuler)'); });
      surFond('p-fond', 'onchange', e => { E.modif(true); pl.fond.media = e.target.value; eng.precharger().then(() => { eng._entrerPlan(); afficher(); }); });
      if ($('#imp-fond-plan', col)) $('#imp-fond-plan').onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        const m = await importerFichier(f, 'fond', p.id); sauverMedias(); Equipe.apresAjout(m, p);
        E.modif(true); pl.fond.media = m.src; eng.precharger().then(() => { eng._entrerPlan(); afficher(); }); toast('Fond importé et appliqué à ce plan');
      };
      surFond('fond-ia', 'onclick', () => allerCreateur(p, E.i, {}));
      if ($('#fond-couper', col)) $('#fond-couper').onclick = () => modaleCouper(pl.fond, pl.fond.media, () => { E.modif(true); eng.precharger().then(() => { eng._entrerPlan(); afficher(); }); });
      $('#empiler').onclick = () => { E.modif(true); if (eng.empilerTextes(pl)) { E.rafraichir(); rendreReglages(); toast('Textes réorganisés (↶ pour annuler)'); } else toast('Rien à réorganiser'); };
      $('#p-duree').oninput = e => { E.modif(); pl.duree = Math.max(0, Number(e.target.value) || 0); $('#t-curseur').max = Number(pl.duree) || 6; rendrePlans(); };
      $('#p-trans').onchange = e => { E.modif(true); pl.transition = pl.transition || {}; pl.transition.type = e.target.value; pl.transition.duree = pl.transition.duree || 0.8; voirTransition(); };
      $('#p-trans-d').onchange = e => { E.modif(true); pl.transition = pl.transition || { type: 'fondu' }; pl.transition.duree = Math.max(0.2, Math.min(3, Number(e.target.value) || 0.8)); };
      // montre la fin du plan précédent puis l'arrivée de ce plan
      const voirTransition = () => { if (E.i < 1) return toast('Le premier plan n\'a pas de transition d\'arrivée'); const av = p.plans[E.i - 1]; eng.mode = 'invitation'; $('#cadre').classList.add('en-lecture'); eng.jouer([E.i - 1, E.i], 0); eng.t = Math.max(0, (Number(av.duree) || 4) - 1); };
      $('#p-trans-voir').onclick = voirTransition;
      if ($('#p-vitesse', col)) $('#p-vitesse').onchange = e => { E.modif(true); const v = Number(e.target.value) || 1; if (v === 1) delete pl.fond.vitesse; else pl.fond.vitesse = v; const el = eng.medias[pl.fond.media]; if (el && el.tagName === 'VIDEO') el.playbackRate = v; eng._entrerPlan(); afficher(); toast(v === 1 ? 'Vitesse normale' : 'Vitesse ×' + String(v).replace('.', ',') + (v < 1 ? ' (ralenti)' : ' (accéléré)')); };
      surFond('p-ecl', 'oninput', e => { E.modif(); pl.fond.eclaircir = Number(e.target.value); });
      surFond('p-asb', 'oninput', e => { E.modif(); pl.fond.assombrir = Number(e.target.value); });
      $$('[data-ajout]', col).forEach(b => b.onclick = () => ajouterCalque(b.dataset.ajout));
      $('#imp-calque').onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        const m = await importerFichier(f, null, p.id); sauverMedias();
        ajouterCalque(m.type === 'video' ? 'video' : 'image', m);
      };
      $$('.calque-ligne', col).forEach(l => l.onclick = e => {
        const id = l.dataset.id, a = e.target.dataset.a, k = pl.calques.findIndex(x => x.id === id);
        if (a === 'vis') { E.modif(true); pl.calques[k].masque = !pl.calques[k].masque; E.rafraichir(); rendreReglages(); return; }
        if (a === 'avance' && k < pl.calques.length - 1) { E.modif(true); [pl.calques[k + 1], pl.calques[k]] = [pl.calques[k], pl.calques[k + 1]]; E.rafraichir(); rendreReglages(); return; }
        if (a === 'recule' && k > 0) { E.modif(true); [pl.calques[k - 1], pl.calques[k]] = [pl.calques[k], pl.calques[k - 1]]; E.rafraichir(); rendreReglages(); return; }
        if (a === 'suppr') { E.modif(true); pl.calques.splice(k, 1); if (E.sel === id) E.sel = null; E.rafraichir(); rendreReglages(); rendrePlans(); return; }
        if (e.shiftKey || e.ctrlKey || e.metaKey) { E.choisir(id, true); return; }
        E.choisir(id);
      });
      const ai = $('#ajout-illu', col); if (ai) ai.onclick = () => ouvrirIllustrations();
      const af = $('#ajout-forme', col); if (af) af.onclick = () => choisirNouvelleForme(af);
      const ae = $('#ajout-emoji', col); if (ae) ae.onclick = () => ouvrirEmojis(ae, em => { E.modif(true); const n = { id: uid(), type: 'texte', texte: em, x: 50, y: 40, largeur: 30, police: 'Cormorant Garamond', taille: 9, align: 'center', couleur: '#000000', debut: 0.4, animation: 'rebond', sortie: 'aucune' }; plan().calques.push(n); fermerPop(); E.choisir(n.id); E.rafraichir(); rendreReglages(); rendrePlans(); toast('Emoji ajouté : agrandissez-le par les coins'); });
      if (E.multi.size > 1) lierMulti();
      else if (c) lierFormulaire(c);
      accordeon(col, E.multi.size > 1 ? 'multi' : c ? c.type : 'plan');
      if (E.rendreBarre) E.rendreBarre();
    }
    E.rendreReglages = rendreReglages;
    // Panneau façon Photoshop : une seule rubrique ouverte à la fois (la dernière utilisée), « Calques » toujours visible
    const titreBloc = d => { const sm = d.querySelector('summary'); return sm ? (sm.childNodes[0] && sm.childNodes[0].textContent || sm.textContent).trim() : ''; };
    const ICONES_PANNEAU = [[/^Fond/, '▦'], [/^Durée/, '⏱'], [/^Calques/, '☰'], [/^Texte/, 'T'], [/^Style|^Arrière|^Ombre|^Contour/, '🎨'], [/^⏱|^Compte/, '⏳'], [/^Traduction/, '🌐'], [/^Animation/, '✦'], [/^Position/, '✥'], [/^Ordre/, '⇅'], [/^Bouton/, '⏺'], [/^Compteur/, '±'], [/^▭/, '▭'], [/^◇/, '◇'], [/^Photo/, '🖼'], [/^Alignement|^Plusieurs|^Sélection/, '⊞']];
    const iconePanneau = t => (ICONES_PANNEAU.find(([r]) => r.test(t)) || [0, '•'])[1];
    // Panneaux façon Photoshop : liste d'icônes à droite, un seul panneau ouvert à la fois ; « Calques » toujours visible en bas
    function accordeon(col, quoi) {
      const blocs = $$('details.bloc', col).filter(d => !/^Calques/.test(titreBloc(d)));
      const calques = $$('details.bloc', col).find(d => /^Calques/.test(titreBloc(d)));
      if (calques) { calques.open = true; calques.classList.add('ps-calques'); const sm = calques.querySelector('summary'); if (sm) sm.onclick = e => e.preventDefault(); }
      if (!blocs.length) return;
      const cle = 'studio.panneau.' + quoi;
      let ouvert = Stock.lire(cle, null);
      if (!blocs.some(d => titreBloc(d) === ouvert)) ouvert = titreBloc(blocs.find(d => !/^Fond$|^Durée/.test(titreBloc(d))) || blocs[0]);
      const montrer = t => {
        ouvert = t;
        blocs.forEach(d => { const on = titreBloc(d) === t; d.open = true; d.hidden = !on; d.classList.add('ps-panneau'); });
        $$('.ps-liste button', col).forEach(b => b.classList.toggle('on', b.dataset.p === t));
        if (Stock.lire(cle, null) !== t) Stock.ecrire(cle, t);
      };
      blocs.forEach(d => { const sm = d.querySelector('summary'); if (sm) sm.onclick = e => e.preventDefault(); });
      const liste = document.createElement('div'); liste.className = 'ps-liste';
      liste.innerHTML = blocs.map(d => { const t = titreBloc(d); return `<button type="button" data-p="${esc(t)}" title="${esc(t)}"><span class="ps-ic">${iconePanneau(t)}</span><span class="ps-nom">${esc(t.replace(/^[^\wÀ-ÿ]+\s*/, ''))}</span></button>`; }).join('');
      col.classList.add('ps-col'); col.appendChild(liste);
      $$('button', liste).forEach(b => b.onclick = () => montrer(b.dataset.p));
      montrer(ouvert);
    }
    E.ouvrirSection = nom => { const b = $$('#col-reglages .ps-liste button').find(x => x.dataset.p.startsWith(nom)); if (b) b.click(); const d = $$('#col-reglages details.bloc').find(x => titreBloc(x).startsWith(nom)); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };

    // Police choisie : on la charge puis on redessine (le canvas a besoin de la vraie police)
    ouvrirPolices.projet = p;
    function appliquerPolice(nom) {
      const duSite = policesSite.find(x => x.nom === nom);
      const perso = duSite ? { src: duSite.fichier } : mesPolices.find(x => x.nom === nom);
      if (perso) { p.polices_perso = (p.polices_perso || []).filter(x => x.nom !== nom).concat({ nom, src: perso.src }); enregistrer(p); }
      MoteurInfo.chargerPolices([nom]).then(() => document.fonts.load(`40px "${nom}"`)).catch(() => {}).then(() => { E.rafraichir(); rendreReglages(); });
    }
    function recadrerCalque(c) {
      if (!c || !c.media) return toast('Choisissez d\'abord une photo ou une vidéo');
      const ratioCadre = ((Number(c.largeur) || 46) / 100 * 720) / ((Number(c.hauteur) || 22) / 100 * 1280);
      modaleRecadrer(c, c.media, ratioCadre, (rec, info) => {
        E.modif(true);
        if (rec && info && info.adapter) { const px = rec.w * info.iw, py = rec.h * info.ih; c.hauteur = Math.round(Math.min(100, (Number(c.largeur) || 46) * 720 / 1280 * py / px) * 10) / 10; }
        E.rafraichir(); rendreReglages(); toast(rec ? 'Rognage appliqué' : 'Rognage annulé : tout est gardé');
      }, { adapter: true });
    }
    E.recadrerCalque = recadrerCalque;
    // Forme du cadre
    const ratioCalque = c => ((Number(c.largeur) || 46) * 720) / ((Number(c.hauteur) || 22) * 1280);
    function choisirForme(c, id) {
      E.modif(true);
      (E.multi.size > 1 ? selection() : [c]).filter(aHauteur).forEach(x => { if (id) x.forme = id; else if (x.type === 'forme') x.forme = 'rect'; else delete x.forme; });
      if (id === 'libre' && !Array.isArray(c.forme_points)) { formeLibre(c); }
      E.rafraichir(); rendreReglages();
    }
    function formeLibre(c) {
      modaleFormeLibre(c, ratioCalque(c), (pts, lisse) => { E.modif(true); c.forme = 'libre'; c.forme_points = pts; if (lisse) c.forme_lisse = true; else delete c.forme_lisse; E.rafraichir(); rendreReglages(); toast('Forme appliquée'); });
    }
    /* Choisir un fond : recherche + classement par événement ou par plan */
    const NOMS_USAGE = { ouverture: 'Ouverture', titre: 'Plan titre', programme: 'Plans intermédiaires', confirmation: 'Confirmation', remerciement: 'Remerciement' };
    function choisirFond(kind) {
      const pl = plan(), estVideo = kind !== 'image';
      const items = (estVideo
        ? Fabrique.FONDS.map(f => Object.assign({ base: true }, f)).concat(medias.filter(m => m.type === 'fond'), Equipe.medias().filter(m => m.type === 'fond'))
        : medias.filter(m => m.type === 'image').concat(Equipe.medias().filter(m => m.type === 'image')))
        .filter((m, i, l) => m.src && l.findIndex(x => x.src === m.src) === i);
      // où chaque fond est déjà utilisé : dans quels événements, sur quels plans
      const usages = {};
      Object.values(projets).forEach(x => (x.plans || []).forEach((q, k) => { const src = q.fond && q.fond.media; if (!src) return; const u = usages[src] = usages[src] || { evts: new Set(), roles: new Set(), ici: [] }; u.evts.add(x.id); u.roles.add(q.role); if (x.id === p.id) u.ici.push(k + 1); }));
      const titreEvt = id => (projets[id] && projets[id].fiche && projets[id].fiche.titre) || 'Événement supprimé';
      // fonds déjà posés sur des plans mais absents de la bibliothèque (fichiers publiés, anciens projets…)
      Object.values(projets).forEach(x => (x.plans || []).forEach((q, k) => {
        const f = q.fond || {}, t = MoteurInfo.typeFond(f), src = f.media;
        if (!src || /^data:/.test(src) || items.some(m => m.src === src)) return;
        const texte = ((q.calques || []).find(c => c.type === 'texte' && c.texte) || {}).texte || '';
        if (estVideo ? (t === 'video' || t === 'defaut') : t === 'image') items.push({ src, nom: nomMedia(src) || ((ROLES[q.role] || 'Plan') + (texte ? ' · ' + texte.replace(/\s+/g, ' ').slice(0, 24) : ' ' + (k + 1))), evt: x.id, description: (x.fiche && x.fiche.titre) || '' });
      }));
      let mode = Stock.lire('studio.choixfond.mode', 'evenement'), q = '', portee = 'plan';
      const groupes = liste => {
        const g = new Map(), mettre = (k, m) => { if (!g.has(k)) g.set(k, []); if (!g.get(k).includes(m)) g.get(k).push(m); };
        if (mode === 'tout') { liste.forEach(m => mettre('Tous les ' + (estVideo ? 'fonds' : 'photos') + ' (' + liste.length + ')', m)); return g; }
        if (mode === 'evenement') {
          liste.forEach(m => { const u = usages[m.src]; if ((u && u.evts.has(p.id)) || m.evt === p.id) mettre('★ Cet événement — ' + titreEvt(p.id), m); });
          liste.forEach(m => { const u = usages[m.src]; const evts = new Set([...(u ? u.evts : []), ...(m.evt ? [m.evt] : [])]); evts.delete(p.id); evts.forEach(id => mettre(titreEvt(id), m)); });
          liste.forEach(m => { if (m.base) mettre('Fonds de base du studio', m); else if (m.equipe) mettre('Bibliothèque de l\'équipe', m); else if (!(usages[m.src] || m.evt)) mettre('Pas encore utilisés', m); });
        } else {
          liste.forEach(m => { const u = usages[m.src]; const roles = new Set([...(u ? u.roles : [])].map(r => r === 'intermediaire' ? 'programme' : r)); if (m.usage) roles.add(m.usage); if (!roles.size) roles.add(''); roles.forEach(r => mettre(r ? (NOMS_USAGE[r] || r) : 'Pour tous les plans', m)); });
          const ordre = ['Ouverture', 'Plan titre', 'Plans intermédiaires', 'Confirmation', 'Remerciement', 'Pour tous les plans'];
          return new Map([...g.entries()].sort((a, b) => (ordre.indexOf(a[0]) + 99) % 99 - (ordre.indexOf(b[0]) + 99) % 99));
        }
        return g;
      };
      const carte = m => { const u = usages[m.src]; return `<button class="cf-carte ${pl.fond.media === m.src ? 'on' : ''}" data-src="${esc(m.src)}" title="${esc(m.nom || '')}"><img src="${esc(m.vignette && !/^idb:/.test(m.vignette) ? m.vignette : vignetteDe(m.src))}" alt="" loading="lazy"><span class="cf-nom">${esc(m.nom || 'Sans nom')}</span>${u && u.ici.length ? `<span class="cf-ici">plan ${u.ici.join(', ')}</span>` : ''}${m.equipe ? '<span class="cf-eq">équipe</span>' : ''}</button>`; };
      modale(`<h2>${estVideo ? 'Choisir un fond' : 'Choisir une photo de fond'} <span class="muet" style="font-size:14px">— plan ${E.i + 1} · ${esc(ROLES[pl.role] || '')}</span></h2>
        <div class="ligne" style="gap:8px;flex-wrap:wrap;margin:6px 0 10px"><input type="search" id="cf-q" placeholder="🔍 Rechercher (nom, événement, membre…)" style="flex:1;min-width:200px">
          <div class="seg" id="cf-mode">${[['evenement', 'Par événement'], ['plan', 'Par plan'], ['tout', 'Tous']].map(([k, n]) => `<button data-m="${k}" class="${mode === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="ligne muet" style="gap:12px;flex-wrap:wrap;margin-bottom:8px">Appliquer à :<label class="cases" style="margin:0"><input type="radio" name="cf-p" value="plan" checked> ce plan</label><label class="cases" style="margin:0"><input type="radio" name="cf-p" value="role"> tous les plans « ${esc(ROLES[pl.role] || '')} »</label><label class="cases" style="margin:0"><input type="radio" name="cf-p" value="tous"> tous les plans</label></div>
        <div id="cf-liste" class="cf-liste"></div>`, (box, fermer) => {
        const rendre = () => {
          const mots = q.toLowerCase().split(/\s+/).filter(Boolean);
          const liste = items.filter(m => { if (!mots.length) return true; const u = usages[m.src]; const txt = [m.nom, m.description, m.auteur, m.usage && NOMS_USAGE[m.usage], ...(u ? [...u.evts].map(titreEvt) : []), m.evt && titreEvt(m.evt)].join(' ').toLowerCase(); return mots.every(w => txt.includes(w)); });
          const g = groupes(liste);
          $('#cf-liste', box).innerHTML = [...g.entries()].map(([t, l]) => `<h3 class="cf-titre">${esc(t)} <span class="muet">${l.length}</span></h3><div class="cf-grille">${l.map(carte).join('')}</div>`).join('') || '<p class="muet">Aucun résultat.</p>';
          $$('.cf-carte', box).forEach(b => b.onclick = () => appliquer(b.dataset.src));
        };
        const appliquer = src => {
          E.modif(true);
          const cibles = portee === 'tous' ? p.plans : portee === 'role' ? p.plans.filter(x => x.role === pl.role) : [pl];
          cibles.forEach(x => { x.fond = x.fond || {}; if (estVideo) { if (x.fond.type === 'image' || x.fond.type === 'couleur' || x.fond.type === 'aucun') delete x.fond.type; x.fond.media = src; } else { x.fond.type = 'image'; x.fond.media = src; delete x.fond.recadrage; } });
          fermer(); toast(cibles.length > 1 ? 'Fond mis sur ' + cibles.length + ' plans' : 'Fond changé');
          eng.precharger().then(() => { eng._entrerPlan(); afficher(); });
        };
        $('#cf-q', box).oninput = e => { q = e.target.value; rendre(); };
        $$('#cf-mode [data-m]', box).forEach(b => b.onclick = () => { mode = b.dataset.m; Stock.ecrire('studio.choixfond.mode', mode); $$('#cf-mode [data-m]', box).forEach(x => x.classList.toggle('on', x === b)); rendre(); });
        $$('input[name=cf-p]', box).forEach(r => r.onchange = () => { portee = r.value; });
        rendre(); setTimeout(() => $('#cf-q', box).focus(), 50);
      });
    }
    E.choisirFond = choisirFond;
    // + Forme : rectangle, rond, cœur, étoile… (calque de couleur)
    function choisirNouvelleForme(ancre) {
      const d = pop(ancre, `<b style="display:block;margin:2px 4px 8px">▭ Ajouter une forme</b><div class="formes-grille">${I.FORMES.filter(([id]) => id && id !== 'libre').map(([id, nom]) => `<button class="forme-btn" data-nf="${id}" title="${esc(nom)}">${iconeForme(id, {}, 1)}<span>${esc(nom.replace(/ \(.*\)$/, ''))}</span></button>`).join('')}</div>`);
      $$('[data-nf]', d).forEach(b => b.onclick = () => { fermerPop(); ajouterCalque('forme', b.dataset.nf); });
    }
    E.choisirNouvelleForme = choisirNouvelleForme;
    E.ajouterCalque = (t, m) => ajouterCalque(t, m);
    function ouvrirFormes(ancre, c) {
      const d = pop(ancre, `<b style="display:block;margin:2px 4px 8px">◇ Forme du cadre</b>${grilleFormes(c, ratioCalque(c))}<button class="btn petit" data-pf-libre style="margin-top:8px;width:100%">✎ Modifier librement la forme (points)</button>`, 'pop-formes');
      $$('[data-forme]', d).forEach(b => b.onclick = () => { choisirForme(c, b.dataset.forme); $$('[data-forme]', d).forEach(x => x.classList.toggle('on', x === b)); });
      $('[data-pf-libre]', d).onclick = () => { fermerPop(); formeLibre(c); };
    }
    function ouvrirIllustrations() {
      const c1 = p.style.couleur || '#7a1f2b', c2 = '#b08a4f';
      let cat = Stock.lire('studio.illu.cat', Illustrations.CATEGORIES[0]);
      modale(`<h2>Illustrations</h2><p class="muet">Dessins à poser sur le plan, aux couleurs de l'invitation (modifiables ensuite).</p>
        <div class="deux" style="max-width:420px"><label class="champ">Couleur principale<input type="color" id="il-c" value="${c1}"></label><label class="champ">Couleur d'accent<input type="color" id="il-a" value="${c2}"></label></div>
        <div class="seg il-cats" style="margin:10px 0">${Illustrations.CATEGORIES.map(k => `<button data-cat="${esc(k)}">${esc(k)}</button>`).join('')}</div>
        <div class="il-grille"></div>`, (racine, fermer) => {
        const grille = $('.il-grille', racine);
        const montrer = () => {
          $$('[data-cat]', racine).forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
          const cc = $('#il-c', racine).value, ca = $('#il-a', racine).value;
          grille.innerHTML = Illustrations.LISTE.filter(x => x.cat === cat).map(x => `<button class="il-item" data-il="${x.id}"><img src="${Illustrations.dataUrl(x.id, cc, ca)}" alt=""><span>${esc(x.nom)}</span></button>`).join('');
        };
        $$('[data-cat]', racine).forEach(b => b.onclick = () => { cat = b.dataset.cat; Stock.ecrire('studio.illu.cat', cat); montrer(); });
        ['#il-c', '#il-a'].forEach(id => $(id, racine).oninput = montrer);
        grille.onclick = e => {
          const b = e.target.closest('[data-il]'); if (!b) return;
          const id = b.dataset.il, cc = $('#il-c', racine).value, ca = $('#il-a', racine).value, ratio = Illustrations.ratio(id);
          const cadre = /^cadre|^coins/.test(id);
          const largeur = cadre ? 92 : /^sep|bandeau|etiquette|fanions|branche/.test(id) ? 70 : 34;
          E.modif(true);
          const n = { id: uid(), type: 'image', media: Illustrations.dataUrl(id, cc, ca), illu: { id, c: cc, a: ca }, x: 50, y: cadre ? 50 : 30, largeur, hauteur: Math.round(Math.min(96, largeur * 720 / 1280 * ratio) * 10) / 10, forme: '', animation: 'fondu', sortie: 'aucune', debut: 0.2 };
          if (cadre) plan().calques.unshift(n); else plan().calques.push(n);
          fermer(); eng.precharger().then(() => { E.choisir(n.id); E.rafraichir(); rendreReglages(); rendrePlans(); });
          toast('Illustration ajoutée : déplacez-la, agrandissez-la par les coins, changez ses couleurs à droite');
        };
        montrer();
      });
    }
    // Panneau quand plusieurs éléments sont choisis
    function formulaireMulti() {
      const cs = selection(), ecrits = cs.filter(x => x.type === 'texte' || x.type === 'bouton' || x.type === 'compteur');
      const nb = {}; cs.forEach(x => { nb[NOMS_TYPE[x.type] || x.type] = (nb[NOMS_TYPE[x.type] || x.type] || 0) + 1; });
      return `<div class="section-titre">${cs.length} éléments choisis</div><div class="bloc pile" style="padding:10px">
        <p class="muet" style="margin:0">${Object.entries(nb).map(([k, n]) => n + ' × ' + k.toLowerCase()).join(' · ')}. Glissez l'un d'eux sur l'aperçu : tout le groupe bouge. Flèches du clavier pour ajuster, Suppr pour tout effacer.</p>
        <b style="font-size:12.5px">Aligner</b>
        <div class="ligne grille-align">${[['gauche', '⫷ Gauche'], ['centre-h', '⇔ Centre'], ['droite', '⫸ Droite'], ['haut', '⤒ Haut'], ['centre-v', '⇕ Milieu'], ['bas', '⤓ Bas']].map(([k, n]) => `<button class="btn petit" data-mal="${k}">${n}</button>`).join('')}</div>
        <div class="ligne grille-align"><button class="btn petit" data-mal="repartir-v" ${cs.length > 2 ? '' : 'disabled'}>☰ Répartir en hauteur</button><button class="btn petit" data-mal="repartir-h" ${cs.length > 2 ? '' : 'disabled'}>⫼ Répartir en largeur</button><button class="btn petit" data-mal="page">◎ Centrer sur la page</button></div>
        ${ecrits.length ? `<b style="font-size:12.5px">Textes et boutons choisis</b><div class="ligne" style="gap:6px"><label class="champ" style="flex:0 0 auto">Couleur<input type="color" data-mk="couleur" value="${ecrits[0].couleur || '#7a1f2b'}"></label><label class="champ" style="flex:1">Police<button class="btn police-btn" data-mpolice>${esc(ecrits[0].police || 'Cormorant Garamond')} ▾</button></label></div>` : ''}
        <div class="ligne" style="gap:6px"><button class="btn petit" data-mact="dupliquer">⊕ Dupliquer</button><button class="btn petit" data-mact="copier">⧉ Copier</button><button class="btn petit danger" data-mact="suppr">🗑 Supprimer</button><button class="btn petit" data-mact="aucun">Ne plus rien choisir</button></div>
      </div>`;
    }
    function lierMulti() {
      const cs = selection();
      $$('#props [data-mal]').forEach(b => b.onclick = () => aligner(b.dataset.mal));
      const mk = $('#props [data-mk="couleur"]'); if (mk) mk.oninput = () => { E.modif(); cs.filter(x => x.type !== 'image' && x.type !== 'video').forEach(x => { x.couleur = mk.value; }); if (cs.some(x => I.TYPES_HTML.includes(x.type))) E.rafraichir(); };
      const mp = $('#props [data-mpolice]'); if (mp) mp.onclick = () => ouvrirPolices(mp, null, nom => { E.modif(true); cs.filter(x => x.type === 'texte' || x.type === 'bouton' || x.type === 'compteur').forEach(x => { x.police = nom; }); appliquerPolice(nom); });
      $$('#props [data-mact]').forEach(b => b.onclick = () => { const a = b.dataset.mact, c = calqueSel() || cs[0]; if (a === 'dupliquer') dupliquerCalque(c); if (a === 'copier') copierCalque(c); if (a === 'suppr') supprimerCalque(c); if (a === 'aucun') E.choisir(null); });
    }
    E.ajouterMedia = m => ajouterCalque(m.type === 'video' ? 'video' : 'image', m);
    function ajouterCalque(type, media) {
      const pl = plan();
      E.modif(true);
      const base = { id: uid(), x: 50, y: 50, largeur: 60, debut: 0.4, couleur: p.style.couleur || '#7a1f2b' };
      let c;
      const L = Fabrique.LIB[p.fiche.langue] || Fabrique.LIB.en;
      if (type === 'texte') c = Object.assign(base, { type, texte: 'Nouveau texte', police: 'Cormorant Garamond', taille: 4.4, align: 'center', ombre: true, animation: 'fondu-montee', sortie: 'aucune' });
      if (type === 'bouton') c = Object.assign(base, { type, texte: L.confirmer, action: 'suivant', style: 'plein', taille: 2.4, debut: 0 });
      if (type === 'compteur') c = Object.assign(base, { type, texte: L.adultes, champ: 'adultes', min: 0, defaut: 1, taille: 2.3, largeur: 66 });
      if (type === 'forme') c = Object.assign(base, { type, forme: media || 'rect', largeur: 40, hauteur: Math.round(40 * 720 / 1280 * 10) / 10, couleur: p.style.couleur || '#7a1f2b', opacite: 1, animation: 'fondu', sortie: 'aucune' });
      if (type === 'image' || type === 'video') {
        const ratio = media && media.l && media.h ? media.h / media.l : 1;
        c = Object.assign(base, { type, media: media ? media.src : '', largeur: 46, hauteur: Math.round(Math.min(40, 46 * ratio * 720 / 1280)), y: 32, forme: 'arrondi', animation: 'fondu', sortie: 'aucune', bordure: '' });
      }
      if (type === 'forme') pl.calques.unshift(c);   // derrière les textes : à avancer ensuite si besoin
      else if (type === 'image' || type === 'video') {
        // sous les textes, au-dessus du reste du plan, puis réorganisation sans chevauchement
        pl.calques.unshift(c);
        eng.empilerTextes(pl, 3);
      } else pl.calques.push(c);
      E.sel = c.id;
      eng.precharger().then(() => { E.rafraichir(); rendreReglages(); rendrePlans(); });
    }

    function optsVitesse(v) { return opts([['0.25', '×0,25 (très lent)'], ['0.5', '×0,5 (ralenti)'], ['0.75', '×0,75'], ['1', 'Normale'], ['1.25', '×1,25'], ['1.5', '×1,5'], ['2', '×2 (rapide)'], ['3', '×3']], String(Number(v) || 1)); }
    function opts(liste, val) { return liste.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(t)}</option>`; }).join(''); }
    const effets = liste => liste.map(v => [v, I.NOMS_EFFETS[v] || v]);
    function blocAnimation(c) {
      return `<details class="bloc" open><summary>Animation</summary>
        <div class="anim-grille">
          <div class="anim-col"><b>Entrée</b>
            <label class="champ">Effet<select data-k="animation">${opts(effets(I.ANIMATIONS), c.animation || 'fondu')}</select></label>
            <div class="deux"><label class="champ">Début (s)<input type="number" data-k="debut" step="0.1" min="0" value="${c.debut || 0}"></label><label class="champ">Durée (s)<input type="number" data-k="duree_animation" step="0.1" min="0.1" max="5" value="${c.duree_animation || ''}" placeholder="auto"></label></div>
          </div>
          <div class="anim-col"><b>Sortie</b>
            <label class="champ">Effet<select data-k="sortie">${opts(effets(I.SORTIES), c.sortie || 'aucune')}</select></label>
            <div class="deux"><label class="champ">Fin (s)<input type="number" data-k="fin" step="0.1" min="0" value="${c.fin || ''}" placeholder="fin du plan"></label><label class="champ">Durée (s)<input type="number" data-k="duree_sortie" step="0.1" min="0.1" max="5" value="${c.duree_sortie || ''}" placeholder="0,6"></label></div>
          </div>
        </div>
        <button class="btn petit" data-voir-anim style="margin-top:8px">▶ Voir l'animation</button>
      </details>`;
    }
    // Arrière-plan, ombre et contour d'un texte
    // Compte à rebours : visible quand le texte contient {compte_a_rebours}
    function blocCompte(c) {
      if (!String(c.texte || '').includes('{compte_a_rebours}')) return '';
      const fiche = E.p.fiche || {};
      return `<details class="bloc" open><summary>⏱ Compte à rebours</summary><div class="pile">
        <label class="champ">Affichage<select data-k="compte_format">${opts([['complet', 'Jours, heures, minutes, secondes'], ['jhm', 'Jours, heures, minutes'], ['jh', 'Jours et heures'], ['j', 'Jours seulement'], ['horloge', 'Horloge  12 : 05 : 33 : 10']], c.compte_format || 'complet')}</select></label>
        <div class="quatre" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
          <label class="champ">Jours<input type="text" data-k="compte_j" placeholder="${fiche.langue === 'mg' ? 'andro' : 'jours'}" value="${esc(c.compte_j || '')}"></label>
          <label class="champ">Heures<input type="text" data-k="compte_h" placeholder="${fiche.langue === 'mg' ? 'ora' : 'h'}" value="${esc(c.compte_h || '')}"></label>
          <label class="champ">Minutes<input type="text" data-k="compte_m" placeholder="min" value="${esc(c.compte_m || '')}"></label>
          <label class="champ">Secondes<input type="text" data-k="compte_s" placeholder="s" value="${esc(c.compte_s || '')}"></label></div>
        <div class="deux"><label class="champ">Jusqu'au<input type="date" data-k="compte_date" value="${esc(c.compte_date || '')}"></label><label class="champ">À<input type="time" data-k="compte_heure" value="${esc(c.compte_heure || '')}"></label></div>
        <span class="muet">Vide = date et heure de l'événement (${esc(fiche.date || 'à remplir dans Informations')}${fiche.heure ? ' à ' + esc(fiche.heure) : ''}).</span>
        <label class="champ">Texte le jour J<input type="text" data-k="compte_fini" placeholder="${fiche.langue === 'mg' ? 'Androany ny andro lehibe !' : 'C\'est aujourd\'hui !'}" value="${esc(c.compte_fini || '')}"></label>
        <span class="muet">Le texte autour reste modifiable au-dessus (ex. « Plus que {compte_a_rebours} ! »).</span>
      </div></details>`;
    }
    function blocStyleTexte(c) {
      const v = (k, d) => c[k] != null && c[k] !== '' ? c[k] : d;
      const typeOmbre = !c.ombre ? 'aucune' : Number(c.ombre_decalage) ? 'portee' : 'halo';
      const coulOmbre = /^#/.test(c.ombre_couleur || '') ? c.ombre_couleur : (typeOmbre === 'portee' ? '#000000' : '#ffffff');
      return `<details class="bloc" open><summary>Fond, ombre, contour</summary><div class="pile style-texte">
        <div class="st-ligne"><label class="st-case"><input type="checkbox" data-st="fond" ${c.fond_couleur ? 'checked' : ''}> <b>Arrière-plan</b></label>
          ${c.fond_couleur ? `<input type="color" data-k="fond_couleur" value="${esc(c.fond_couleur)}" title="Couleur du fond">` : ''}</div>
        ${c.fond_couleur ? `<div class="trois"><label class="champ">Opacité<input type="range" data-k="fond_opacite" min="0.05" max="1" step="0.05" value="${v('fond_opacite', 0.6)}"></label><label class="champ">Marge<input type="range" data-k="fond_marge" min="0" max="1.5" step="0.05" value="${v('fond_marge', 0.4)}"></label><label class="champ">Arrondi<input type="range" data-k="fond_arrondi" min="0" max="3" step="0.1" value="${v('fond_arrondi', 0.4)}"></label></div>` : ''}
        <div class="st-ligne"><label class="champ" style="flex:1"><b>Ombre</b><select data-st="ombre">${opts([['aucune', 'Aucune'], ['halo', 'Halo (lueur autour)'], ['portee', 'Ombre portée (décalée)']], typeOmbre)}</select></label>
          ${c.ombre ? `<input type="color" data-st="ombre_couleur" value="${esc(coulOmbre)}" title="Couleur de l'ombre">` : ''}</div>
        ${c.ombre ? `<div class="trois"><label class="champ">Flou<input type="range" data-k="ombre_force" min="0" max="4" step="0.1" value="${v('ombre_force', 1)}"></label><label class="champ">Intensité<input type="range" data-k="ombre_opacite" min="0.1" max="1" step="0.05" value="${v('ombre_opacite', 0.85)}"></label>${typeOmbre === 'portee' ? `<label class="champ">Décalage<input type="range" data-k="ombre_decalage" min="0.5" max="6" step="0.25" value="${v('ombre_decalage', 1.5)}"></label>` : '<span></span>'}</div>` : ''}
        <div class="st-ligne"><label class="st-case"><input type="checkbox" data-st="contour" ${c.contour ? 'checked' : ''}> <b>Contour</b></label>
          ${c.contour ? `<input type="color" data-k="contour" value="${esc(c.contour)}" title="Couleur du contour"><label class="champ" style="flex:1">Épaisseur<input type="range" data-k="contour_epaisseur" min="1" max="16" step="0.5" value="${v('contour_epaisseur', 3)}"></label>` : ''}</div>
        <div class="ligne st-presets"><span class="muet">Styles rapides :</span>
          <button class="btn petit" data-st-preset="lisible">Lisible sur fond chargé</button><button class="btn petit" data-st-preset="bandeau">Bandeau</button><button class="btn petit" data-st-preset="neon">Néon</button><button class="btn petit" data-st-preset="rien">Aucun</button></div>
      </div></details>`;
    }
    function blocTraductions(c) {
      const ls = (p.langues || []).filter(l => l !== p.fiche.langue);
      if (!ls.length) return '';
      return `<details class="bloc" ${ls.some(l => !(c.trad && c.trad[l])) ? 'open' : ''}><summary>Traductions</summary><div class="pile">
        ${ls.map(l => `<label class="champ">${esc(MoteurInfo.LANGUES[l] || l)}${c.trad && c.trad[l] ? '' : ' <span class="badge alerte">à traduire</span>'}<textarea data-trad="${l}" rows="2">${esc((c.trad && c.trad[l]) || '')}</textarea></label>`).join('')}
        <span class="muet">Vide = le texte d'origine s'affiche. Pour tout traduire d'un coup : 🌐 Traduire sous l'aperçu.</span></div></details>`;
    }
    // Ce que fait chaque bouton, et ce qu'il faut régler
    function champsAction(c) {
      const a = c.action || 'suivant', f = p.fiche || {}, lieux = f.lieux || [], contacts = f.contacts || [];
      const t = TYPES_BOUTON.find(x => x.a === a) || TYPES_BOUTON[0];
      let h = `<div class="aide-bouton">${t.i} ${esc(t.aide)}</div>`;
      if (a === 'map') h += `<label class="champ">Lieu<select data-k="cible">${lieux.map((l, i) => `<option value="${i}" ${Number(c.cible || 0) === i ? 'selected' : ''}>${esc(l.nom || 'Lieu ' + (i + 1))}</option>`).join('') || '<option value="0">— aucun lieu dans la Fiche —</option>'}</select></label>
        <label class="champ">Ou une autre adresse / un lien Google Maps<input type="text" data-k="lien" placeholder="ex. Hôtel Colbert Antananarivo, ou https://maps.app.goo.gl/…" value="${esc(c.lien || '')}"></label>
        <button class="btn petit" data-tester-bouton>Ouvrir pour tester ↗</button>`;
      if (a === 'appeler' || a === 'whatsapp') h += `<label class="champ">Contact<select data-k="cible">${contacts.map((k, i) => `<option value="${i}" ${Number(c.cible || 0) === i ? 'selected' : ''}>${esc((k.nom || 'Contact ' + (i + 1)) + ' — ' + (k.telephone || ''))}</option>`).join('') || '<option value="0">— aucun contact dans la Fiche —</option>'}</select></label>
        <label class="champ">Ou un autre numéro<input type="tel" data-k="tel" placeholder="ex. 034 12 345 67" value="${esc(c.tel || '')}"></label>
        <button class="btn petit" data-tester-bouton>${a === 'whatsapp' ? 'Ouvrir WhatsApp pour tester ↗' : 'Tester le numéro'}</button>`;
      if (a === 'lien' || a === 'messenger') h += `<label class="champ">${a === 'messenger' ? 'Lien Messenger (m.me/…)' : 'Adresse du lien'}<input type="url" data-k="lien" placeholder="https://…" value="${esc(c.lien || '')}"></label><button class="btn petit" data-tester-bouton>Ouvrir pour tester ↗</button>`;
      if (a === 'confirmer' || a === 'refuser') {
        const base = reglages.supabase && reglages.supabase.url;
        h += `<div class="alerte-boite" style="background:${base ? '#eef7ee;border-color:#bfe0bf;color:#245a24' : '#fdecec;border-color:#efc2c2;color:#7a1f2b'}">${base ? '✓ Relié à la base : la réponse ' + (a === 'confirmer' ? '(avec le nombre d\'adultes et d\'enfants) ' : '') + 'arrive tout de suite dans l\'espace de l\'organisateur, puis l\'invité voit le plan Remerciement.' : '⚠ Base non reliée : Réglages → Supabase. Sans elle, la réponse ne peut pas être enregistrée.'}</div>`;
      }
      if (a === 'calendrier') h += `<div class="muet">Utilise la date, l'heure et le premier lieu de la Fiche (${esc(f.date || 'date à remplir')}${f.heure ? ' à ' + esc(f.heure) : ''}).</div>`;
      return h;
    }
    function formulaireCalque(c) {
      const position = `<details class="bloc" open><summary>Position</summary>
        <div class="trois"><label class="champ">X (%)<input type="number" id="cx" data-k="x" step="0.5" value="${c.x}"></label><label class="champ">Y (%)<input type="number" id="cy" data-k="y" step="0.5" value="${c.y}"></label><label class="champ">Largeur (%)<input type="number" data-k="largeur" step="1" value="${c.largeur || 60}"></label></div>
        <div class="ligne" style="gap:6px;align-items:flex-end;margin-top:8px"><label class="champ" style="flex:1">Rotation (°)<input type="range" data-k="rotation" min="-180" max="180" step="1" value="${Number(c.rotation) || 0}"></label><input type="number" data-k="rotation" min="-180" max="180" step="1" value="${Number(c.rotation) || 0}" style="width:70px"><button class="btn petit" data-rot="-15" title="−15°">⟲</button><button class="btn petit" data-rot="15" title="+15°">⟳</button><button class="btn petit" data-rot="0" title="Remettre droit">0°</button></div>
        <label class="champ" style="margin-top:8px">Visible pour<select data-k="condition">${opts([['', 'Tous'], ['famille', 'Lien personnel'], ['general', 'Lien général']], c.condition || '')}</select></label></details>`;
      let s = `<div class="section-titre">${nomType(c)} choisi${c.illu ? 'e' : ''}</div>`;
      if (c.type === 'texte') s += `<details class="bloc" open><summary>Texte</summary><div class="pile">
        <label class="champ">Texte <span class="muet">— variables : {famille} {places} {date} {heure} {date_limite} {compte_a_rebours}</span><textarea data-k="texte" rows="3">${esc(c.texte)}</textarea></label>
        <div class="ligne" style="gap:6px"><button class="btn petit" data-emoji-texte>😊 Ajouter un emoji</button>${String(c.texte || '').includes('{compte_a_rebours}') ? '' : '<button class="btn petit" data-ajout-compte>⏱ Ajouter le compte à rebours</button>'}</div>
        <div class="deux"><label class="champ">Police<button class="btn police-btn" data-police style="font-family:'${esc(c.police || 'Cormorant Garamond')}',serif">${esc(c.police || 'Cormorant Garamond')} ▾</button></label><label class="champ">Taille<input type="range" data-k="taille" min="1.5" max="12" step="0.1" value="${c.taille || 4}"></label></div>
        <div class="trois"><label class="champ">Couleur<input type="color" data-k="couleur" value="${c.couleur || '#7a1f2b'}"></label><label class="champ">Alignement<select data-k="align">${opts([['center', 'Centré'], ['left', 'Gauche'], ['right', 'Droite'], ['justify', 'Justifié']], c.align || 'center')}</select></label><label class="champ">Interligne<input type="number" data-k="interligne" step="0.05" min="0.8" max="2" value="${c.interligne || 1.25}"></label></div>
        <div class="cases"><label><input type="checkbox" data-k="gras" ${c.gras ? 'checked' : ''}> Gras</label><label><input type="checkbox" data-k="italique" ${c.italique ? 'checked' : ''}> Italique</label><label><input type="checkbox" data-k="majuscules" ${c.majuscules ? 'checked' : ''}> Majuscules</label></div>
        <label class="champ">Épaisseur des lettres<select data-k="graisse">${opts([['', c.gras ? 'Gras (auto)' : 'Normale (auto)'], ['100', 'Très fine (100)'], ['300', 'Fine (300)'], ['400', 'Normale (400)'], ['500', 'Moyenne (500)'], ['600', 'Demi-grasse (600)'], ['700', 'Grasse (700)'], ['800', 'Extra-grasse (800)'], ['900', 'Noire (900)']], c.graisse || '')}</select></label>
        <label class="champ">Superposition (mode de fusion)<select data-k="fusion">${opts(I.FUSIONS, c.fusion || 'normal')}</select></label>
        </div></details>` + blocCompte(c) + blocStyleTexte(c) + blocTraductions(c) + blocAnimation(c);
      if (c.type === 'bouton') s += `<details class="bloc" open><summary>Bouton : ce qu'il fait</summary><div class="pile">
        <div class="types-bouton">${TYPES_BOUTON.map(t => `<button class="${(c.action || 'suivant') === t.a ? 'on' : ''}" data-tbouton="${t.a}" title="${esc(t.aide)}"><span>${t.i}</span>${esc(t.n)}</button>`).join('')}</div>
        <label class="champ">Texte du bouton<input type="text" data-k="texte" value="${esc(c.texte)}"></label>
        ${champsAction(c)}
        <div class="trois"><label class="champ">Style<select data-k="style">${opts([['plein', 'Plein'], ['contour', 'Contour'], ['lien', 'Lien']], c.style || 'plein')}</select></label><label class="champ">Taille<input type="number" data-k="taille" step="0.1" min="1" max="6" value="${c.taille || 2.4}"></label><label class="champ">Couleur<input type="color" data-k="couleur" value="${c.couleur || '#7a1f2b'}"></label></div>
        <label class="champ">Police<button class="btn police-btn" data-police style="font-family:'${esc(c.police || 'Cormorant Garamond')}',serif">${esc(c.police || 'Cormorant Garamond')} ▾</button></label>
        <label class="champ">Apparaît à (s)<input type="number" data-k="debut" step="0.1" min="0" value="${c.debut || 0}"></label></div></details>` + blocTraductions(c);
      if (c.type === 'compteur') s += `<details class="bloc" open><summary>Compteur</summary><div class="pile">
        <label class="champ">Libellé<input type="text" data-k="texte" value="${esc(c.texte)}"></label>
        <div class="trois"><label class="champ">Champ<select data-k="champ">${opts(['adultes', 'enfants', 'places_transport'], c.champ)}</select></label><label class="champ">Min<input type="number" data-k="min" value="${c.min || 0}"></label><label class="champ">Max<input type="number" data-k="max" value="${c.max || ''}" placeholder="places"></label></div>
        <div class="deux"><label class="champ">Taille<input type="number" data-k="taille" step="0.1" min="1" max="6" value="${c.taille || 2.3}"></label><label class="champ">Couleur<input type="color" data-k="couleur" value="${c.couleur || '#7a1f2b'}"></label></div></div></details>`;
      if (c.type === 'compteur') s += blocTraductions(c);
      if (c.type === 'forme') s += `<details class="bloc" open><summary>▭ Forme</summary><div class="pile">
        ${grilleFormes(c, ratioCalque(c)).replace(/<button class="forme-btn[^"]*" data-forme=""[\s\S]*?<\/button>/, '')}
        ${c.forme === 'arrondi' ? `<label class="champ">Arrondi des coins<input type="range" data-k="arrondi" min="0" max="100" step="1" value="${c.arrondi != null && c.arrondi !== '' ? c.arrondi : 16}"></label>` : ''}
        <button class="btn petit ${c.forme === 'libre' ? 'plein' : ''}" data-forme-libre>✎ ${c.forme === 'libre' ? 'Modifier les points' : 'Dessiner une forme libre'}</button>
        <div class="trois"><label class="champ">Couleur<input type="color" data-k="couleur" value="${esc(c.couleur || '#7a1f2b')}"></label><label class="champ">Hauteur (%)<input type="number" data-k="hauteur" step="0.5" value="${c.hauteur || 22}"></label><label class="champ">Opacité<input type="range" data-k="opacite" min="0" max="1" step="0.05" value="${c.opacite != null && c.opacite !== '' ? c.opacite : 1}"></label></div>
        <label class="cases"><input type="checkbox" data-forme-deg ${c.couleur2 ? 'checked' : ''}> Dégradé</label>
        ${c.couleur2 ? `<div class="trois"><label class="champ">Vers<input type="color" data-k="couleur2" value="${esc(c.couleur2)}"></label><label class="champ">Type<select data-k="degrade">${opts([['lineaire', 'Linéaire'], ['radial', 'Rond']], c.degrade || 'lineaire')}</select></label>${c.degrade === 'radial' ? '' : `<label class="champ">Angle<input type="range" data-k="degrade_angle" min="0" max="360" step="5" value="${Number(c.degrade_angle) || 90}"></label>`}</div>` : ''}
        <div class="ligne" style="gap:8px;flex-wrap:wrap;align-items:center"><label class="cases"><input type="checkbox" data-k="remplissage" ${c.remplissage !== false ? 'checked' : ''}> Remplie</label><label class="cases"><input type="checkbox" data-bordure-on ${c.bordure ? 'checked' : ''}> Contour</label>${c.bordure ? `<input type="color" data-k="bordure" value="${esc(c.bordure)}"><label class="champ" style="flex:1;min-width:110px">Épaisseur<input type="range" data-k="bordure_epaisseur" min="1" max="30" step="1" value="${Number(c.bordure_epaisseur) || 3}"></label>` : ''}<label class="cases"><input type="checkbox" data-k="ombre_cadre" ${c.ombre_cadre ? 'checked' : ''}> Ombre</label></div>
        <label class="champ">Superposition (mode de fusion)<select data-k="fusion">${opts(I.FUSIONS, c.fusion || 'normal')}</select></label>
        </div></details>` + blocAnimation(c);
      if (c.type === 'image' || c.type === 'video') s += `<details class="bloc" open><summary>Photo / vidéo</summary><div class="pile">
        ${c.media ? '' : '<div class="alerte-boite">Ce calque est vide : importez une photo ou une vidéo.</div>'}
        <div class="ligne"><label class="btn petit plein">${c.media ? 'Remplacer le fichier' : 'Importer une photo ou une vidéo'}<input type="file" data-remplacer accept="image/*,video/*" hidden></label></div>
        <label class="champ">Ou choisir dans la bibliothèque<select data-k="media">${opts([['', '—']].concat(medias.filter(m => (m.type === 'image' || m.type === 'video') && (pourEvt(m, p.id) || m.src === c.media)).concat(Equipe.medias().filter(m => m.type === 'video' || m.type === 'image')).map(m => [m.src, m.nom + (m.anime ? ' (animée)' : '') + (m.equipe ? ' — équipe' : '')])), c.media)}</select></label>
        ${c.illu ? `<div class="deux"><label class="champ">Couleur principale<input type="color" data-illu="c" value="${esc(c.illu.c)}"></label><label class="champ">Couleur d'accent<input type="color" data-illu="a" value="${esc(c.illu.a)}"></label></div>` : ''}
        ${c.type === 'image' && c.media && !c.illu ? '<button class="btn petit ia" data-animer>✨ Animer cette photo (Wan 2.2)</button>' : ''}
        ${c.media && !c.illu ? `<button class="btn petit" data-rogner>⬚ Rogner${c.recadrage ? ' ✓ (modifier)' : ''}</button>` : ''}
        <div class="trois"><label class="champ">Hauteur (%)<input type="number" data-k="hauteur" value="${c.hauteur || 22}"></label><label class="champ">Forme<button class="btn" data-ouvrir-formes>${esc(((MoteurInfo.FORMES.find(x => x[0] === (c.forme || '')) || [0, 'Normale'])[1]).replace(/ \(.*\)$/, ''))} ▾</button></label><label class="champ">Opacité<input type="number" data-k="opacite" min="0" max="1" step="0.05" value="${c.opacite != null ? c.opacite : 1}"></label></div>
        <label class="champ">Superposition (mode de fusion avec le fond)<select data-k="fusion">${opts(I.FUSIONS, c.fusion || 'normal')}</select></label>
        ${c.type === 'video' && c.media ? `<label class="champ">Vitesse de la vidéo<select data-vitesse>${optsVitesse(c.vitesse)}</select></label>` : ''}
        ${c.type === 'video' && c.media ? `<button class="btn petit" data-couper>✂ Couper la vidéo${MoteurInfo.plage(c) ? ' (' + MoteurInfo.plage(c).map(x => x.toFixed(1)).join(' → ') + ' s)' : ''}</button>` : ''}
        <div class="cases">${c.forme ? '' : `<label><input type="checkbox" data-k="remplir" ${c.remplir ? 'checked' : ''}> Remplir le cadre (recadrer)</label>`}</div>
        </div></details>
        <details class="bloc" open><summary>◇ Forme du cadre</summary><div class="pile">
        ${grilleFormes(c, ((Number(c.largeur) || 46) * 720) / ((Number(c.hauteur) || 22) * 1280))}
        ${c.forme === 'arrondi' ? `<label class="champ">Arrondi des coins<input type="range" data-k="arrondi" min="0" max="100" step="1" value="${c.arrondi != null && c.arrondi !== '' ? c.arrondi : 16}"></label>` : ''}
        <div class="ligne" style="gap:6px;flex-wrap:wrap"><button class="btn petit ${c.forme === 'libre' ? 'plein' : ''}" data-forme-libre>✎ ${c.forme === 'libre' ? 'Modifier les points de la forme' : 'Modifier librement cette forme'}</button></div>
        <div class="ligne" style="gap:8px;flex-wrap:wrap;align-items:center"><label class="cases"><input type="checkbox" data-bordure-on ${c.bordure ? 'checked' : ''}> Bordure</label>${c.bordure ? `<input type="color" data-k="bordure" value="${esc(c.bordure)}"><label class="champ" style="flex:1;min-width:120px">Épaisseur<input type="range" data-k="bordure_epaisseur" min="1" max="30" step="1" value="${c.bordure_epaisseur || 3}"></label>` : ''}<label class="cases"><input type="checkbox" data-k="ombre_cadre" ${c.ombre_cadre ? 'checked' : ''}> Ombre</label></div>
        </div></details>` + blocAnimation(c);
      const ordre = `<details class="bloc" open><summary>Ordre (devant / derrière)</summary><div class="ligne" style="gap:6px;flex-wrap:wrap">
        <button class="btn petit" data-ordre="avant">⤒ Tout devant</button><button class="btn petit" data-ordre="avance">↑ Avancer</button><button class="btn petit" data-ordre="recule">↓ Reculer</button><button class="btn petit" data-ordre="arriere">⤓ Tout derrière</button>
        ${(c.type === 'image' || c.type === 'video') && c.media ? '<button class="btn petit" data-en-fond title="Cette photo / vidéo devient le fond du plan (derrière tout)">▣ Mettre en fond du plan</button>' : ''}</div>
        <div class="muet" style="font-size:11.5px;margin-top:4px">Le fond du plan est toujours tout derrière. Ctrl+] / Ctrl+[ : avancer / reculer.</div></details>`;
      return s + ordre + position;
    }
    function lierFormulaire(c) {
      $$('#props [data-tbouton]').forEach(b => b.onclick = () => {
        const t = TYPES_BOUTON.find(x => x.a === b.dataset.tbouton), lang = (p.fiche || {}).langue || 'fr';
        E.modif(true);
        const ancien = TYPES_BOUTON.some(x => [x.fr, x.mg, x.en].includes(c.texte)) || !c.texte || c.texte === (Fabrique.LIB[lang] || {}).confirmer;
        c.action = t.a; if (ancien) c.texte = t[lang] || t.fr;
        E.rafraichir(); rendreReglages(); E.ouvrirSection('Bouton');
      });
      const tb = $('#props [data-tester-bouton]'); if (tb) tb.onclick = () => {
        const f = p.fiche || {}, a = c.action, k = Number(c.cible) || 0;
        const tel = String(c.tel || ((f.contacts || [])[k] || {}).telephone || '').replace(/[^\d+]/g, '');
        if (a === 'map') { const l = (f.lieux || [])[k] || {}; const u = c.lien ? (/^https?:/.test(c.lien) ? c.lien : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.lien)) : (l.maps || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l.nom || '')); window.open(u, '_blank'); }
        else if (a === 'whatsapp') { if (!tel) return toast('Aucun numéro'); window.open('https://wa.me/' + tel.replace(/^0/, '261').replace(/^\+/, ''), '_blank'); }
        else if (a === 'appeler') { if (!tel) return toast('Aucun numéro'); toast('Le bouton appellera : ' + tel); }
        else if (c.lien) window.open(c.lien, '_blank'); else toast('Mettez d\'abord l\'adresse du lien');
      };
      $$('#props [data-ordre]').forEach(b => b.onclick = () => ordreCalque(c, b.dataset.ordre));
      const ef = $('#props [data-en-fond]'); if (ef) ef.onclick = () => {
        const pl = plan(); E.modif(true);
        pl.fond = Object.assign({}, pl.fond, { type: c.type === 'video' ? 'video' : 'image', media: c.media, boucle: true });
        if (c.recadrage) pl.fond.recadrage = c.recadrage; else delete pl.fond.recadrage;
        pl.calques = pl.calques.filter(x => x !== c); E.sel = null;
        eng.precharger().then(() => { E.rafraichir(); rendreReglages(); rendrePlans(); toast('C\'est maintenant le fond du plan'); });
      };
      const fd = $('#props [data-forme-deg]'); if (fd) fd.onchange = () => { E.modif(true); if (fd.checked) c.couleur2 = '#ffffff'; else delete c.couleur2; E.rafraichir(); rendreReglages(); };
      $$('#props [data-trad]').forEach(t => t.oninput = () => { c.trad = c.trad || {}; if (t.value.trim()) c.trad[t.dataset.trad] = t.value; else delete c.trad[t.dataset.trad]; E.modif(); E.rafraichir(); });
      const rp = $('#props [data-remplacer]');
      if (rp) rp.onchange = async e => { const f = e.target.files[0]; if (!f) return; const m = await importerFichier(f, null, p.id); sauverMedias(); E.modif(true); c.media = m.src; c.type = m.type === 'video' ? 'video' : 'image'; eng.precharger().then(() => { E.rafraichir(); rendreReglages(); }); };
      const vi = $('#props [data-vitesse]'); if (vi) vi.onchange = () => { E.modif(true); const v = Number(vi.value) || 1; if (v === 1) delete c.vitesse; else c.vitesse = v; const el = eng.medias[c.media]; if (el && el.tagName === 'VIDEO') el.playbackRate = v; E.rafraichir(); };
      $$('#props [data-rot]').forEach(b => b.onclick = () => { E.modif(true); const d = Number(b.dataset.rot); c.rotation = d ? (((Number(c.rotation) || 0) + d + 540) % 360) - 180 : 0; if (!c.rotation) delete c.rotation; if (I.TYPES_HTML.includes(c.type)) E.rafraichir(); rendreReglages(); });
      $$('#props [data-k="rotation"]').forEach(inp => inp.addEventListener('input', () => { $$('#props [data-k="rotation"]').forEach(o => { if (o !== inp) o.value = inp.value; }); zone._html = ''; }));
      const pb = $('#props [data-police]'); if (pb) pb.onclick = () => ouvrirPolices(pb, c.police, nom => { E.modif(true); c.police = nom; appliquerPolice(nom); });
      const et = $('#props [data-emoji-texte]'); if (et) et.onclick = () => ouvrirEmojis(et, em => { const ta = $('#props [data-k="texte"]'); E.modif(true); if (ta && document.activeElement === ta) { const a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + em + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + em.length; c.texte = ta.value; } else { c.texte = (c.texte || '') + (c.texte && !/\s$/.test(c.texte) ? ' ' : '') + em; if (ta) ta.value = c.texte; } E.rafraichir(); const l = $(`.calque-ligne[data-id="${c.id}"] .t`); if (l) l.textContent = c.texte; });
      const rg = $('#props [data-rogner]'); if (rg) rg.onclick = () => recadrerCalque(c);
      $$('#props [data-forme]').forEach(b => b.onclick = () => choisirForme(c, b.dataset.forme));
      const of = $('#props [data-ouvrir-formes]'); if (of) of.onclick = () => ouvrirFormes(of, c);
      const fl = $('#props [data-forme-libre]'); if (fl) fl.onclick = () => formeLibre(c);
      const bo = $('#props [data-bordure-on]'); if (bo) bo.onchange = () => { E.modif(true); if (bo.checked) { c.bordure = c.bordure || p.style.couleur || '#b08a4f'; c.bordure_epaisseur = c.bordure_epaisseur || 4; } else delete c.bordure; E.rafraichir(); rendreReglages(); };
      $$('#props [data-illu]').forEach(inp => inp.addEventListener('input', () => { c.illu[inp.dataset.illu] = inp.value; clearTimeout(inp._t); inp._t = setTimeout(() => { E.modif(); c.media = Illustrations.dataUrl(c.illu.id, c.illu.c, c.illu.a); eng.precharger().then(E.rafraichir); }, 120); }));
      const cp = $('#props [data-couper]'); if (cp) cp.onclick = () => modaleCouper(c, c.media, () => { E.modif(true); eng.precharger().then(() => { E.rafraichir(); rendreReglages(); }); });
      const an = $('#props [data-animer]'); if (an) an.onclick = () => allerCreateur(p, E.i, { methode: 'animer', calque: c.id });
      // Fond / ombre / contour du texte
      const majStyle = () => { E.modif(true); E.rafraichir(); rendreReglages(); };
      $$('#props [data-st]').forEach(inp => inp.addEventListener('change', () => {
        const k = inp.dataset.st;
        if (k === 'fond') { if (inp.checked) { c.fond_couleur = c.fond_couleur || '#ffffff'; if (c.fond_opacite == null || c.fond_opacite === '') c.fond_opacite = 0.6; } else delete c.fond_couleur; }
        if (k === 'contour') { if (inp.checked) { c.contour = c.contour || '#ffffff'; c.contour_epaisseur = c.contour_epaisseur || 3; } else delete c.contour; }
        if (k === 'ombre') {
          c.ombre = inp.value !== 'aucune';
          if (inp.value === 'halo') { c.ombre_decalage = 0; if (!/^#/.test(c.ombre_couleur || '')) c.ombre_couleur = '#ffffff'; }
          if (inp.value === 'portee') { c.ombre_decalage = Number(c.ombre_decalage) || 1.5; if (!/^#/.test(c.ombre_couleur || '') || c.ombre_couleur === '#ffffff') c.ombre_couleur = '#000000'; if (c.ombre_opacite == null || c.ombre_opacite === '') c.ombre_opacite = 0.6; }
        }
        if (k === 'ombre_couleur') { c.ombre_couleur = inp.value; E.modif(true); return; }
        majStyle();
      }));
      $$('#props [data-st-preset]').forEach(b => b.onclick = () => {
        const t = b.dataset.stPreset;
        ['fond_couleur', 'fond_opacite', 'fond_marge', 'fond_arrondi', 'contour', 'contour_epaisseur', 'ombre_couleur', 'ombre_force', 'ombre_opacite', 'ombre_decalage'].forEach(k => delete c[k]); c.ombre = false;
        if (t === 'lisible') Object.assign(c, { ombre: true, ombre_couleur: '#000000', ombre_opacite: 0.7, ombre_force: 1.6, ombre_decalage: 1, contour: '#ffffff', contour_epaisseur: 2 });
        if (t === 'bandeau') Object.assign(c, { fond_couleur: '#ffffff', fond_opacite: 0.75, fond_marge: 0.6, fond_arrondi: 0.5 });
        if (t === 'neon') Object.assign(c, { ombre: true, ombre_couleur: c.couleur || '#ff4fa0', ombre_opacite: 1, ombre_force: 2.5, ombre_decalage: 0 });
        majStyle();
      });
      const ac = $('#props [data-ajout-compte]');
      if (ac) ac.onclick = () => { E.modif(true); c.texte = (c.texte ? c.texte + '\n' : '') + '{compte_a_rebours}'; E.rafraichir(); rendreReglages(); };
      const va = $('#props [data-voir-anim]');
      if (va) va.onclick = () => { eng.mode = 'invitation'; eng.jouerPlan(E.i); };
      $$('#props [data-k]').forEach(inp => {
        const k = inp.dataset.k;
        const ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' || inp.type === 'color' ? 'change' : 'input';
        inp.addEventListener(ev, () => {
          E.modif(inp.tagName === 'SELECT' || inp.type === 'checkbox');
          let v = inp.type === 'checkbox' ? inp.checked : inp.value;
          if (inp.type === 'number' || inp.type === 'range') v = inp.value === '' ? '' : Number(inp.value);
          c[k] = v;
          if (k === 'type' || k === 'media') { if (k === 'media') { const m = medias.find(x => x.src === v); if (m) c.type = m.type === 'video' || m.type === 'fond' ? 'video' : 'image'; } eng.precharger().then(E.rafraichir); }
          if (I.TYPES_HTML.includes(c.type) || k === 'condition') E.rafraichir();
          if (k === 'action') rendreReglages();
          if (k === 'texte') { const l = $(`.calque-ligne[data-id="${c.id}"] .t`); if (l) l.textContent = v; }
        });
      });
    }
  }

  /* ---------- Finaliser un plan avec l'IA ---------- */
  function modaleFinaliser(E) {
    const p = E.p, k = E.i;
    const prompt = Fabrique.prompt4(p, k, tousFonds());
    modale(`<h2>Finaliser le plan ${k + 1} avec l'IA</h2>
      <p class="muet">Le studio a préparé le prompt avec tout le contexte du plan. Envoyez-le à ChatGPT ou Claude avec l'image, puis collez la réponse.</p>
      <div class="ia-grille">
        <div class="pile">
          <p class="ia-etape">1. Copier le prompt</p>
          <textarea class="prompt-zone" readonly id="ia-prompt">${esc(prompt)}</textarea>
          <div class="ligne"><button class="btn plein" id="ia-copier">Copier le prompt</button><button class="btn" id="ia-image">2. Télécharger l'image du plan</button></div>
          <details><summary class="muet" style="cursor:pointer">Corriger un détail plutôt (prompt de retouche)</summary>
            <div class="pile" style="margin-top:8px"><input type="text" id="ia-remarques" placeholder="Ex. : le nom est coupé, texte trop bas, couleur peu lisible" style="width:100%"><button class="btn" id="ia-copier3">Copier le prompt de retouche</button></div></details>
        </div>
        <div class="pile">
          <p class="ia-etape">3. Coller la réponse de l'IA</p>
          <textarea class="prompt-zone" id="ia-rep" placeholder='{ "role": "...", "calques": [ ... ] }'></textarea>
          <button class="btn plein" id="ia-verifier">Vérifier la réponse</button>
          <div id="ia-resultat"></div>
        </div>
      </div>`, (box, fermer) => {
      $('#ia-copier', box).onclick = () => copier(prompt);
      $('#ia-copier3', box).onclick = () => copier(Fabrique.prompt3(p, k, $('#ia-remarques', box).value));
      $('#ia-image', box).onclick = () => { E.eng.afficherPlan(k, Math.max(E.t, Math.min(3, Number(p.plans[k].duree) || 3))); requestAnimationFrame(() => requestAnimationFrame(() => { try { telecharger(`plan-${k + 1}.jpg`, dataURLversBlob(E.eng.imageTest())); } catch (e) { toast(e.message); } })); };
      let mini = [];
      modale._fermer = () => mini.forEach(m => m.detruire());
      $('#ia-verifier', box).onclick = async () => {
        mini.forEach(m => m.detruire()); mini = [];
        const v = Fabrique.validerPlan($('#ia-rep', box).value, tousFonds().map(f => f.src).concat(medias.map(m => m.src)));
        const res = $('#ia-resultat', box);
        if (!v.plan || !v.ok) { res.innerHTML = `<div class="erreur-boite"><b>La réponse ne peut pas être appliquée :</b><ul class="liste-mini">${v.erreurs.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`; return; }
        const nouveau = Object.assign({}, p.plans[k], v.plan, { id: p.plans[k].id, role: p.plans[k].role });
        nouveau.fond = Object.assign({}, p.plans[k].fond, v.plan.fond || {});
        const clone = JSON.parse(JSON.stringify(p)); clone.plans[k] = nouveau;
        res.innerHTML = `${v.erreurs.length ? `<div class="alerte-boite"><ul class="liste-mini">${v.erreurs.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '<div class="ok-boite">Réponse valide.</div>'}
          <div class="comparer" style="margin-top:10px"><div><div class="mini-apercu" id="avant"></div>Avant</div><div><div class="mini-apercu" id="apres"></div>Après</div></div>
          <div class="ligne" style="justify-content:center;margin-top:10px"><button class="btn plein" id="ia-appliquer">Appliquer</button><button class="btn" id="ia-refuser">Garder l'ancien</button></div>`;
        const t = Math.min(3, Number(nouveau.duree) || 3);
        const a = new Moteur($('#avant', box), { mode: 'edition', resolveur: resoudre, famille: E.eng.famille });
        const b = new Moteur($('#apres', box), { mode: 'edition', resolveur: resoudre, famille: E.eng.famille });
        mini = [a, b];
        await a.setProjet(p); a.afficherPlan(k, t);
        await b.setProjet(clone); b.afficherPlan(k, t);
        $('#ia-appliquer', box).onclick = () => {
          E.modif(true);
          p.plans[k] = nouveau;
          p.historique_ia = (p.historique_ia || []).concat({ date: new Date().toISOString(), plan: k + 1, type: 'finalisation', reponse: $('#ia-rep', box).value.slice(0, 20000) }).slice(-100);
          enregistrer(p); fermer(); E.sel = null; E.eng.precharger().then(E.afficher); toast('Plan mis à jour (↶ pour revenir en arrière)');
        };
        $('#ia-refuser', box).onclick = fermer;
      };
    });
  }

  /* ---------- Créer un fond vidéo sur mesure pour un plan ---------- */
  const ANIM_MVT = [
    ['Mouvement naturel', 'gentle natural motion: soft breathing, a slight smile, hair and fabric moving lightly'],
    ['Zoom lent', 'a very slow, smooth camera push-in (slow zoom), the scene almost still'],
    ['Léger vent', 'a light breeze moving hair, veil, fabric and leaves softly'],
    ['Pétales qui tombent', 'a few rose petals gently falling in the foreground, people almost still'],
    ['Lumière qui passe', 'a soft warm light slowly sweeping across the image, gentle glow'],
  ];
  const IDEES = {
    ouverture: ['Enveloppe qui s\'ouvre lentement sur un fond de roses', 'Rideau de fleurs qui s\'écarte', 'Lumière dorée qui traverse un voile'],
    intermediaire: ['Église éclairée par une lumière dorée, vitraux doux', 'Salle de réception décorée, lustres et bougies', 'Berceau, petits nuages et colombes pour le baptême', 'Alliances posées sur des pétales de roses', 'Ciel doré avec deux colombes qui volent'],
    confirmation: ['Cadre floral calme, beaucoup d\'espace au centre pour les boutons', 'Papier ivoire avec quelques pétales qui tombent sur les côtés'],
    remerciement: ['Pluie douce de pétales et lumière chaude', 'Bouquet de roses au bas de l\'image, colombes en haut']
  };
  /* ---------- Brouillons : chaque vidéo créée est gardée tout de suite ---------- */
  // Les générations Wan en cours sont notées : si l'ordinateur s'éteint ou si la connexion coupe,
  // la vidéo est récupérée sur le pod au prochain démarrage du studio et rangée en brouillon.
  const Travaux = {
    liste() { return Stock.lire('studio.travaux', []); },
    ajouter(t) { const l = this.liste().filter(x => x.id !== t.id); l.push(Object.assign({ date: Date.now() }, t)); Stock.ecrire('studio.travaux', l); },
    retirer(id) { Stock.ecrire('studio.travaux', this.liste().filter(x => x.id !== id)); }
  };
  async function sauverBrouillon(f, type, evt, nom) {
    const m = await importerFichier(f, type, evt);
    Object.assign(m, { brouillon: true, nom: nom || m.nom }, type === 'video' ? { anime: true } : { origine: 'ia', usage: 'programme' });
    sauverMedias();
    return m;
  }
  async function reprendreTravaux() {
    for (const t of Travaux.liste()) {
      if (Date.now() - t.date > 48 * 3600e3) { Travaux.retirer(t.id); continue; }
      try {
        const r = await Comfy.recuperer(t.base, t.id);
        if (!r) continue;
        await sauverBrouillon(new File([r.blob], r.nom.split('/').pop(), { type: r.blob.type || 'video/mp4' }), t.type, t.evt, (t.nom || 'Vidéo') + ' (récupérée)');
        Travaux.retirer(t.id);
        toast('Une vidéo créée pendant la coupure a été récupérée : Bibliothèque → brouillons');
        if (/bibliotheque/.test(location.hash)) vueBibliotheque();
      } catch (e) { if (e.definitif) Travaux.retirer(t.id); }
    }
  }
  setTimeout(reprendreTravaux, 3000); setInterval(() => { if (Travaux.liste().length) reprendreTravaux(); }, 60000);

  /* ---------- Chanson : tout format → fichier lisible partout ---------- */
  // MP3 et M4A/AAC sont gardés tels quels. Les autres (WAV, FLAC, OGG, OPUS, AIFF, vidéo…) sont décodés
  // par le navigateur puis réencodés en MP3 (lisible sur tous les téléphones).
  async function chargerScript(url) { return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = () => ko(new Error('Encodeur MP3 indisponible (connexion ?)')); document.head.appendChild(s); }); }
  async function preparerChanson(f, suivi) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (['mp3', 'm4a', 'aac', 'mpga'].includes(ext) || /^audio\/(mpeg|mp3|mp4|aac|x-m4a)$/.test(f.type)) return f;
    suivi && suivi('Lecture du fichier…');
    let audio;
    try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); audio = await ctx.decodeAudioData(await f.arrayBuffer()); ctx.close(); }
    catch (e) { throw new Error('Ce format (' + ext.toUpperCase() + ') ne peut pas être lu par le navigateur. Convertissez-le d\'abord en MP3 (par exemple avec l\'app Musique ou un convertisseur en ligne).'); }
    if (!window.lamejs) { suivi && suivi('Préparation de l\'encodeur…'); await chargerScript('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js'); }
    const can = Math.min(2, audio.numberOfChannels), taux = audio.sampleRate;
    const enc = new lamejs.Mp3Encoder(can, taux, 160);
    const versInt = d => { const o = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const v = Math.max(-1, Math.min(1, d[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7FFF; } return o; };
    const g = versInt(audio.getChannelData(0)), dr = can > 1 ? versInt(audio.getChannelData(1)) : null;
    const morceaux = [], pas = 1152 * 20;
    for (let i = 0; i < g.length; i += pas) {
      const b = dr ? enc.encodeBuffer(g.subarray(i, i + pas), dr.subarray(i, i + pas)) : enc.encodeBuffer(g.subarray(i, i + pas));
      if (b.length) morceaux.push(new Uint8Array(b));
      if (i % (pas * 40) === 0) { suivi && suivi('Conversion en MP3… ' + Math.round(i / g.length * 100) + ' %'); await new Promise(r => setTimeout(r, 0)); }
    }
    const fin = enc.flush(); if (fin.length) morceaux.push(new Uint8Array(fin));
    return new File(morceaux, f.name.replace(/\.\w+$/, '') + '.mp3', { type: 'audio/mpeg' });
  }

  /* ---------- ✂ Couper une vidéo (fond ou calque) : garder seulement un passage ---------- */
  function modaleCouper(conf, src, apres) {
    modale(`<h2>✂ Couper la vidéo</h2>
      <p class="muet">Choisissez le passage à garder : la vidéo jouera seulement de « Début » à « Fin » (et recommencera au début du passage si elle tourne en boucle). Le fichier d'origine n'est pas modifié.</p>
      <video id="cp-v" controls muted playsinline style="width:100%;max-height:52vh;background:#000;border-radius:10px"></video>
      <div class="cp-barre"><div id="cp-zone"></div></div>
      <div class="deux"><label class="champ">Début (s)<div class="ligne"><input type="number" id="cp-deb" step="0.1" min="0" style="width:100px"><button class="btn petit" id="cp-ici-deb">Position actuelle</button></div></label>
        <label class="champ">Fin (s)<div class="ligne"><input type="number" id="cp-fin" step="0.1" min="0" style="width:100px"><button class="btn petit" id="cp-ici-fin">Position actuelle</button></div></label></div>
      <div class="ligne"><button class="btn" id="cp-voir">▶ Voir le passage</button><button class="btn danger" id="cp-annuler">Garder toute la vidéo</button><button class="btn plein" id="cp-ok">Appliquer</button><span class="muet" id="cp-info"></span></div>`, async (box, fermer) => {
      const v = $('#cp-v', box), deb = $('#cp-deb', box), fin = $('#cp-fin', box);
      v.src = await resoudre(src);
      await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; });
      const D = v.duration || 0, pl = MoteurInfo.plage(conf) || [0, D];
      deb.value = pl[0].toFixed(1); fin.value = Math.min(pl[1], D).toFixed(1); deb.max = fin.max = D.toFixed(1);
      const maj = () => { const a = Number(deb.value) || 0, b = Number(fin.value) || D; $('#cp-zone', box).style.cssText = `left:${a / D * 100}%;width:${Math.max(0, b - a) / D * 100}%`; $('#cp-info', box).textContent = 'Passage : ' + Math.max(0, b - a).toFixed(1) + ' s sur ' + D.toFixed(1) + ' s'; };
      maj(); deb.oninput = fin.oninput = maj;
      $('#cp-ici-deb', box).onclick = () => { deb.value = v.currentTime.toFixed(1); maj(); };
      $('#cp-ici-fin', box).onclick = () => { fin.value = v.currentTime.toFixed(1); maj(); };
      let boucle = null;
      $('#cp-voir', box).onclick = () => { v.currentTime = Number(deb.value) || 0; v.play(); clearInterval(boucle); boucle = setInterval(() => { if (v.currentTime >= (Number(fin.value) || D)) v.currentTime = Number(deb.value) || 0; }, 50); };
      modale._fermer = () => { clearInterval(boucle); v.pause(); };
      $('#cp-annuler', box).onclick = () => { delete conf.coupe; fermer(); toast('Toute la vidéo est gardée'); apres && apres(); };
      $('#cp-ok', box).onclick = () => {
        const a = Math.max(0, Number(deb.value) || 0), b = Math.min(D, Number(fin.value) || D);
        if (b - a < 0.3) return toast('Le passage doit durer au moins 0,3 s');
        if (a <= 0.05 && b >= D - 0.05) delete conf.coupe; else conf.coupe = { debut: Math.round(a * 10) / 10, fin: Math.round(b * 10) / 10 };
        fermer(); toast(conf.coupe ? 'Vidéo coupée : ' + conf.coupe.debut + ' → ' + conf.coupe.fin + ' s' : 'Toute la vidéo est gardée'); apres && apres();
      };
    });
  }

  /* ---------- Traduction de toute l'invitation ---------- */
  function modaleTraduction(p, apres) {
    const N = MoteurInfo.LANGUES;
    const calques = () => p.plans.flatMap(x => (x.calques || []).filter(c => c.texte && String(c.texte).trim()));
    const manque = l => calques().filter(c => !(c.trad && c.trad[l])).length;
    modale(`<h2>🌐 Langues de l'invitation</h2>
      <p class="muet">Langue principale : <b>${esc(N[p.fiche.langue] || p.fiche.langue)}</b>. Cochez les langues à proposer aux invités : dans l'invitation, un bouton 🌐 leur permet de changer de langue d'un clic.</p>
      <div class="cases" style="flex-wrap:wrap" id="tr-langues">${Object.entries(N).filter(([k]) => k !== p.fiche.langue).map(([k, n]) => `<label><input type="checkbox" value="${k}" ${(p.langues || []).includes(k) ? 'checked' : ''}> ${n}${(p.langues || []).includes(k) ? ` <span class="muet">(${manque(k) ? manque(k) + ' texte(s) à traduire' : '✓ traduite'})</span>` : ''}</label>`).join('')}</div>
      <div class="ia-grille" style="margin-top:12px">
        <div class="pile"><p class="ia-etape">1. Copier le prompt</p>
          <p class="muet" style="margin:0">Il contient tous les textes de l'invitation (${calques().length}) et les règles (ton de faire-part, variables {famille}, {date}… gardées).</p>
          <div class="ligne"><button class="btn plein" id="tr-copier">Copier le prompt</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Ouvrir Claude ↗</a><a class="btn" href="https://chatgpt.com/" target="_blank" rel="noopener">Ouvrir ChatGPT ↗</a></div>
          <label class="cases"><input type="checkbox" id="tr-tout"> Retraduire aussi les textes déjà traduits</label></div>
        <div class="pile"><p class="ia-etape">2. Coller la réponse</p>
          <textarea id="tr-rep" rows="8" placeholder='{ "fr": { "…": "…" }, "en": { … } }' style="width:100%;font:12.5px ui-monospace,monospace"></textarea>
          <div class="ligne"><button class="btn plein" id="tr-ok">Appliquer les traductions</button><span class="muet" id="tr-etat"></span></div></div>
      </div>`, (box, fermer) => {
      const choisies = () => $$('#tr-langues input:checked', box).map(i => i.value);
      $$('#tr-langues input', box).forEach(i => i.onchange = () => { p.langues = choisies(); enregistrer(p); });
      $('#tr-copier', box).onclick = () => {
        const ls = choisies(); if (!ls.length) return toast('Cochez d\'abord au moins une langue');
        let proj = p;
        if (!$('#tr-tout', box).checked) { proj = JSON.parse(JSON.stringify(p)); proj.plans.forEach(x => x.calques = (x.calques || []).filter(c => ls.some(l => !(c.trad && c.trad[l])))); }
        copier(Fabrique.promptTraduction(proj, ls, N));
      };
      $('#tr-ok', box).onclick = () => {
        let j; try { j = Fabrique.lireJSON($('#tr-rep', box).value); } catch (e) { $('#tr-etat', box).textContent = 'Réponse illisible : collez tout le bloc de code JSON.'; return; }
        const parId = {}; calques().forEach(c => { parId[c.id] = c; });
        let n = 0;
        Object.entries(j || {}).forEach(([l, textes]) => {
          if (!N[l] || l === p.fiche.langue || typeof textes !== 'object') return;
          Object.entries(textes).forEach(([id, t]) => { const c = parId[id]; if (c && typeof t === 'string' && t.trim()) { c.trad = c.trad || {}; c.trad[l] = t; n++; } });
          if (!(p.langues || []).includes(l)) p.langues = (p.langues || []).concat(l);
        });
        enregistrer(p);
        if (!n) { $('#tr-etat', box).textContent = 'Aucun texte reconnu dans la réponse.'; return; }
        fermer(); toast(n + ' traductions appliquées'); if (apres) apres();
      };
    });
  }

  /* ---------- Chanson de l'invitation ---------- */
  function modaleMusique(p, apres) {
    const fin = () => { enregistrer(p); if (apres) apres(); };
    modale(`<h2>♪ Chanson de l'invitation</h2>
      <p class="muet">Elle démarre quand l'invité ouvre l'invitation, tourne en boucle, et l'invité peut la couper (bouton ♪). Elle est aussi dans le film exporté. Utilisez une chanson dont vous avez les droits.</p>
      <div class="pile" id="mu-corps"></div>`, (box, fermer) => {
      const rendre = async () => {
        const m = p.musique;
        const c = $('#mu-corps', box);
        if (!m) { c.innerHTML = `<label class="btn plein" style="align-self:flex-start">Choisir une chanson (tous formats, ou une vidéo)<input type="file" id="mu-f" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.wave,.ogg,.oga,.opus,.flac,.wma,.aif,.aiff,.aifc,.caf,.amr,.3gp,.3ga,.webm,.weba,.mka,.mp2,.mpga,.ac3,.mp4,.m4v,.mov,.mkv,.avi" hidden></label>`; }
        else {
          c.innerHTML = `<b>${esc(m.nom || 'Chanson')}</b>
            <audio id="mu-a" controls preload="metadata" style="width:100%"></audio>
            <div class="deux"><label class="champ">Commencer à (secondes)<div class="ligne"><input type="number" id="mu-debut" min="0" step="0.5" value="${Number(m.debut) || 0}" style="width:110px"><button class="btn petit" id="mu-ici">Position actuelle</button></div></label>
            <label class="champ">Volume<input type="range" id="mu-vol" min="0" max="1" step="0.05" value="${m.volume != null ? m.volume : 0.8}"></label></div>
            <p class="muet" style="margin:0">Astuce : écoutez, mettez en pause au bon moment (après l'introduction par exemple), puis « Position actuelle ».</p>
            <div class="ligne"><button class="btn petit" id="mu-test">▶ Écouter depuis le début choisi</button><label class="btn petit">Changer de chanson<input type="file" id="mu-f" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.wave,.ogg,.oga,.opus,.flac,.wma,.aif,.aiff,.aifc,.caf,.amr,.3gp,.3ga,.webm,.weba,.mka,.mp2,.mpga,.ac3,.mp4,.m4v,.mov,.mkv,.avi" hidden></label><button class="btn petit danger" id="mu-suppr">Retirer</button><button class="btn plein" id="mu-ok">Terminé</button></div>`;
          const a = $('#mu-a', box); a.src = await resoudre(m.src); a.volume = m.volume != null ? m.volume : 0.8;
          modale._fermer = () => a.pause();
          $('#mu-debut', box).onchange = e => { m.debut = Math.max(0, Number(e.target.value) || 0); fin(); };
          $('#mu-ici', box).onclick = () => { m.debut = Math.round(a.currentTime * 2) / 2; $('#mu-debut', box).value = m.debut; fin(); toast('La chanson commencera à ' + m.debut + ' s'); };
          $('#mu-vol', box).oninput = e => { m.volume = Number(e.target.value); a.volume = m.volume; fin(); };
          $('#mu-test', box).onclick = () => { a.currentTime = Number(m.debut) || 0; a.play(); };
          $('#mu-suppr', box).onclick = () => { a.pause(); p.musique = null; fin(); rendre(); };
          $('#mu-ok', box).onclick = () => { a.pause(); fermer(); };
        }
        $('#mu-f', box).onchange = async e => {
          const brut = e.target.files[0]; if (!brut) return;
          const etat = document.createElement('div'); etat.className = 'muet'; $('#mu-corps', box).appendChild(etat);
          try {
            const f = await preparerChanson(brut, t => { etat.textContent = t; });
            const id = 'idb:' + uid() + '.' + (f.name.split('.').pop() || 'mp3').toLowerCase();
            await IDB.mettre(id, f); p.musique = { src: id, nom: brut.name, volume: 0.8, debut: 0 }; fin(); rendre();
            if (f !== brut) toast('Chanson convertie en MP3 pour être lue sur tous les téléphones');
          } catch (err) { etat.textContent = err.message; etat.style.color = '#a3242b'; }
        };
      };
      rendre();
    });
  }

  // Ouvre « Créer avec l'IA » hors de l'éditeur (Bibliothèque) : mesure la place des calques avec un moteur caché
  let createurEnAttente = null;
  function allerCreateur(p, k, ouv) { Stock.ecrire('studio.bib.evt', p.id); createurEnAttente = { id: p.id, k, ouv: ouv || {} }; location.hash = '#/bibliotheque'; }
  async function ouvrirCreateur(p, k, ouv) {
    const div = document.createElement('div'); div.style.cssText = 'position:fixed;left:-9999px;top:0;width:360px;height:640px';
    document.body.appendChild(div);
    const eng = new Moteur(div, { mode: 'edition', resolveur: resoudre, famille: FAMILLE_TEST });
    try { await eng.setProjet(p); eng.afficherPlan(k, Math.min(3, Number(p.plans[k].duree) || 3)); } catch (e) {}
    const bbox = Object.assign({}, eng.bbox);
    eng.detruire(); div.remove();
    const E = { p, i: k, eng: { bbox, precharger: () => Promise.resolve(), _entrerPlan() {} }, modif() {}, rafraichir() {}, afficher() {},
      ajouterMedia(m) {
        const pl = p.plans[k]; const ratio = m.l && m.h ? m.h / m.l : 1;
        pl.calques.unshift({ id: uid(), type: m.type === 'video' ? 'video' : 'image', media: m.src, x: 50, y: 32, largeur: 46, hauteur: Math.round(Math.min(40, 46 * ratio * 720 / 1280)), debut: 0.4, forme: 'arrondi', animation: 'fondu', sortie: 'aucune', bordure: '' });
        enregistrer(p);
      } };
    modaleFondIA(E, ouv || {});
  }

  function modaleFondIA(E, ouv) {
    ouv = ouv || {};
    const p = E.p, k = E.i, pl = p.plans[k];
    const h = pl.fond_ia || {};
    const role = pl.role;
    const usage = { ouverture: 'ouverture', confirmation: 'confirmation', remerciement: 'remerciement' }[role] || 'programme';
    const exclus = new Set(h.exclus || []);
    const wanOk = !!(reglages.comfy && reglages.comfy.url);
    let methode = ouv.methode || (['recolorer', 'wan', 'animer'].includes(h.methode) ? h.methode : 'recolorer');
    const photos = (pl.calques || []).filter(c => c.type === 'image' && c.media);
    const autresPlans = p.plans.filter((x, i) => i !== k && x.fond && x.fond.media === pl.fond.media).length;
    const nomRef = () => { const f = tousFonds().find(x => x.src === pl.fond.media); return ((f && f.nom) || 'fond').replace(/[^\w\-]+/g, '-').toLowerCase() + '-reference-plan-' + (k + 1) + '.mp4'; };
    const calquesVisibles = (pl.calques || []).filter(c => !c.masque);
    const lignesCalques = () => calquesVisibles.map(c => {
      const b = E.eng.bbox[c.id];
      const editable = c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur';
      const zone = b ? `${Math.round(b.y)}–${Math.round(b.y + b.h)} %` : '';
      return `<div class="calque-ia ${exclus.has(c.id) ? 'off' : ''}" data-id="${c.id}">
        <input type="checkbox" ${exclus.has(c.id) ? '' : 'checked'} title="Laisser de la place pour ce calque">
        <span class="badge">${esc(NOMS_TYPE[c.type] || c.type)}</span>
        ${editable ? `<textarea class="ci-texte" rows="${String(c.texte || '').split('\n').length > 1 ? 2 : 1}">${esc(c.texte || '')}</textarea>` : `<span class="ci-nom">${esc(nomMedia(c.media) || '(photo ou vidéo)')}</span>`}
        <span class="muet ci-zone">${esc(zone)}</span></div>`;
    }).join('');
    modale(`<h2 style="margin-bottom:6px">✨ Créer avec l'IA</h2>
      <div class="nf-contexte"><span>Événement : <b>${esc(p.fiche.titre || '')}</b></span>
        <label>Plan de référence <select id="fi-plan">${p.plans.map((x, i) => `<option value="${i}" ${i === k ? 'selected' : ''}>${i + 1}. ${esc(ROLES[x.role] || x.role)}${x.calques && x.calques[0] && x.calques[0].texte ? ' — ' + esc(String(x.calques[0].texte).replace(/\s+/g, ' ').slice(0, 28)) : ''}</option>`).join('')}</select></label>
        <span class="muet">Son fond sert de modèle (couleurs, décor) et ses ${calquesVisibles.length} calque${calquesVisibles.length > 1 ? 's' : ''} gardent leur place.</span></div>
      <div class="nf-grille">
        <div class="pile">
          <div class="pile nf-bloc">
            <p class="ia-etape">1. Comment le créer ?</p>
            <div class="nf-methodes">
              <button data-m="recolorer"><b>Recolorer</b><span>Une vidéo déjà prête, aux couleurs du fond actuel</span></button>
              <button data-m="wan"><b>Fond Wan 2.2</b><span>Créer un nouveau fond vidéo sur votre pod</span></button>
              <button data-m="animer"><b>Animer une image</b><span>Une photo posée sur le fond prend vie (5 s, Wan 2.2)</span></button>
            </div>
            <div data-panneau="recolorer" class="pile">
              <p class="muet" style="margin:0">Gardez la composition et le mouvement d'une vidéo, et donnez-lui les couleurs du fond actuel. Gratuit, directement ici.</p>
              <div class="ligne"><label class="btn petit plein">Choisir la vidéo<input type="file" id="fi-v2" accept="video/*" hidden></label><span class="muet" id="fi-v2-nom">aucune vidéo</span></div>
              <div id="fi-palette" class="muet"></div>
              <label class="champ">Intensité<input type="range" id="fi-force" min="0.3" max="1" step="0.05" value="0.9"></label>
              <div class="comparer" id="fi-comp"></div>
              <div class="ligne"><button class="btn petit" id="fi-voir">Aperçu avant / après</button><button class="btn petit plein" id="fi-auto">Recolorer</button></div>
              <div class="progres"><div id="fi-barre"></div></div>
              <details><summary class="muet">Ou avec Claude (plus précis, élément par élément)</summary>
                <ol class="nf-faire" style="margin-top:8px">
                  <li><button class="btn petit plein" id="fi-copier-etal">Copier le prompt</button> <span class="muet">(les couleurs du thème y sont déjà)</span></li>
                  <li class="muet">Dans Claude, collez le prompt et joignez <b>votre vidéo à recolorer</b>.</li>
                  <li class="muet">Récupérez la vidéo recolorée, puis « Importer une vidéo de l'ordinateur » à droite.</li>
                </ol>
                <label class="champ">Correspondances particulières <span class="muet">(facultatif)</span><input type="text" id="fi-corr" value="${esc(h.correspondances || '')}" placeholder="Ex. : les roses blanches deviennent bordeaux"></label></details>
            </div>
            <div data-panneau="wan" class="pile">
              <div class="ligne"><span class="muet">Partir de</span><div class="segment" id="fi-depart"><button data-v="actuel" class="${h.depart_wan !== 'fichier' ? 'actif' : ''}">l'image du fond actuel</button><button data-v="fichier" class="${h.depart_wan === 'fichier' ? 'actif' : ''}">ma photo ou vidéo</button></div></div>
              <div id="fi-depart-fichier" class="pile" style="gap:6px;${h.depart_wan === 'fichier' ? '' : 'display:none'}">
                <div class="ligne"><label class="btn petit plein">Choisir la photo ou la vidéo<input type="file" id="fi-wan-src" accept="image/*,video/*" hidden></label><span class="muet" id="fi-wan-src-nom">aucun fichier</span></div>
                <div class="comparer" id="fi-wan-comp"></div>
                <p class="muet" style="margin:0">Le studio la recadre en vertical et la passe aux couleurs du fond actuel avant de l'envoyer ; Wan 2.2 l'anime et l'adapte au thème.</p>
              </div>
              <p class="muet" style="margin:0" id="fi-wan-expl">Environ 5 minutes. Si le pod est éteint, le studio vous guide pour l'allumer.</p>
<div id="fi-bloc-idee" class="pile" style="gap:8px">
            <b style="font-size:14px">Votre idée <span class="muet" style="font-weight:400">(facultatif)</span></b>
            <textarea id="fi-idee" rows="2" placeholder="Ex. : plus de lumière dorée, des bougies sur les côtés…">${esc(h.idee || '')}</textarea>
            <div class="nf-puces">${(IDEES[role] || IDEES.intermediaire).map(t => `<button class="puce" data-idee="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>
            <div class="ligne"><label class="muet">Mouvement</label><div class="segment" id="fi-mvt">${['calme', 'moyen', 'vivant'].map(m => `<button data-v="${m}" class="${(h.mouvement || 'calme') === m ? 'actif' : ''}">${m}</button>`).join('')}</div></div>
            <details><summary class="muet">Calques pris en compte (${calquesVisibles.length})</summary>
              <p class="muet" style="margin:6px 0">Le fond laissera de la place pour chacun. Décochez-en un s'il ne compte pas.</p>
              <div id="fi-calques" class="pile">${lignesCalques() || '<p class="muet">Aucun calque sur ce plan.</p>'}</div></details>
              </div>
              <button class="btn ia" id="fi-wan">▶ Générer avec Wan 2.2</button>
              <span class="muet" id="fi-wan-etat">${wanOk ? '' : 'Ajoutez d\'abord l\'adresse de votre pod dans <a href="#/reglages">Réglages</a>.'}</span>
            </div>
            <div data-panneau="animer" class="pile">
              <div><b style="font-size:14px">Image à animer</b></div>
              <div class="nf-photos">${photos.map(c => `<button class="nf-photo ${c.id === ouv.calque ? 'actif' : ''}" data-photo="${c.id}" title="Photo du plan"><img src="${esc((medias.find(m => m.src === c.media) || {}).vignette || '')}" alt=""></button>`).join('')}
                <label class="nf-photo nf-photo-plus" title="Choisir une autre image">＋<input type="file" id="fi-anim-src" accept="image/*" hidden></label></div>
              <div class="muet" id="fi-anim-nom">${photos.length ? 'Choisissez une photo du plan, ou ＋ pour une autre image.' : 'Choisissez une image (＋) : elle sera posée sur le fond.'}</div>
              <div><b style="font-size:14px">Mouvement</b></div>
              <div class="nf-puces" id="fi-anim-mvt">${ANIM_MVT.map((x, i) => `<button class="puce ${i === 0 ? 'actif' : ''}" data-v="${i}">${esc(x[0])}</button>`).join('')}</div>
              <input type="text" id="fi-anim-idee" style="width:100%" placeholder="Précision facultative : ex. le voile de la mariée bouge au vent">
              <label class="cases"><input type="checkbox" id="fi-anim-theme"> Passer l'image aux couleurs du thème</label>
              <p class="muet" style="margin:0">Les visages et les personnes restent identiques. Environ 4 à 5 minutes ; si le pod est éteint, le studio vous guide.</p>
              <button class="btn ia" id="fi-animer">▶ Animer avec Wan 2.2</button>
              <span class="muet" id="fi-anim-etat"></span>
            </div>
          </div>
        </div>
        <div class="pile nf-bloc nf-resultat">
          <p class="ia-etape">2. Résultat</p>
          <div class="nf-ecran" id="fi-apercu"><span class="muet">La nouvelle vidéo s'affichera ici.</span></div>
          <label class="btn petit" style="align-self:center">Importer une vidéo de l'ordinateur<input type="file" id="fi-fichier" accept="video/*" hidden></label>
          <button class="btn petit" id="fi-harmo" hidden>Harmoniser ses couleurs avec le fond actuel</button>
          ${autresPlans ? `<label class="cases"><input type="checkbox" id="fi-autres"> Aussi pour les ${autresPlans} autre${autresPlans > 1 ? 's' : ''} plan${autresPlans > 1 ? 's' : ''} qui ont ce fond</label>` : ''}
          <label class="cases"><input type="checkbox" id="fi-surplan" checked> <span id="fi-surplan-txt">Mettre aussi sur le plan ${k + 1}</span></label>
          <button class="btn plein" id="fi-utiliser" disabled>Ranger dans la bibliothèque</button>
          <p class="muet" style="margin:0;font-size:12.5px">Tout ce qui est créé est rangé dans la bibliothèque de « ${esc((p.fiche.titre || '').slice(0, 40))} ».</p>
        </div>
      </div>`, (box, fermer) => {
      let fichier = null, video2 = null, paletteRef = null, statsRef = null;
      let mouvement = h.mouvement || 'calme';
      const duree = Math.max(5, Math.min(15, Math.ceil(Number(pl.duree) || 8)));
      let photoSel = ouv.calque || null, srcAnim = null, mvtAnim = 0;
      const majSurPlan = () => { const t = $('#fi-surplan-txt', box); if (!t) return; t.textContent = methode === 'animer' ? (photoSel ? 'Remplacer la photo sur le plan ' + (k + 1) : 'Poser aussi sur le plan ' + (k + 1)) : 'Mettre aussi ce fond sur le plan ' + (k + 1); };
      $('#fi-plan', box).onchange = e => { fermer(); ouvrirCreateur(p, Number(e.target.value), { methode, apres: ouv.apres }); };
      let departWan = h.depart_wan === 'fichier' ? 'fichier' : 'actuel', srcWan = null, imageWan = null;
      const lire = () => ({ idee: $('#fi-idee', box).value.trim(), mouvement, duree, mode: methode === 'recolorer' ? 'recolorer' : 'actuel', methode, depart_wan: departWan });
      const calquesPris = () => (pl.calques || []).filter(c => !c.masque && !exclus.has(c.id)).map(c => ({ c, b: E.eng.bbox[c.id] }));
      const promptEtal = () => { const zs = calquesPris().map(x => x.b).filter(Boolean);
        return Fabrique.promptEtalonnage({ video: video2 ? video2.name : '', palette: paletteRef, ambiance: Fabrique.ambiance(p, tousFonds()), correspondances: $('#fi-corr', box).value.trim(), zone: zs.length ? { haut: Math.round(Math.min(...zs.map(b => b.y))), bas: Math.round(Math.max(...zs.map(b => b.y + b.h))) } : null }); };
      const promptWan = () => {
        let t = Fabrique.promptFond(p, k, Object.assign({ calques: calquesPris(), fonds: tousFonds(), reference: '' }, lire(), { mode: 'actuel', cible: 'video', inspiration: '' })).replace(/^Use the attached reference video.*\n/, '').replace(/1080x1920, \d+ seconds/, '704x1280, 5 seconds');
        if (departWan === 'fichier') t = 'Animate this image into an elegant invitation background. Keep its main subject and composition, and blend it fully into the invitation theme below: same colors first of all, same kind of decoration, textures and light.\n' + t;
        return t;
      };
      const generer = () => {
        const o = lire();
        const texte = promptWan();
        pl.fond_ia = Object.assign({}, pl.fond_ia || {}, o, { correspondances: $('#fi-corr', box).value.trim(), exclus: [...exclus], prompt: texte, date: new Date().toISOString() });
        enregistrer(p);
      };
      const choisirMethode = m => {
        methode = m;
        $$('[data-m]', box).forEach(b => b.classList.toggle('actif', b.dataset.m === m));
        $$('[data-panneau]', box).forEach(d => d.style.display = d.dataset.panneau === m ? '' : 'none');
        majSurPlan();
        const ca = $('#fi-autres', box); if (ca) ca.closest('label').style.display = m === 'animer' ? 'none' : '';
        if (fichier && (fichier._m || 'fond') !== (m === 'animer' ? 'animer' : 'fond')) { fichier = null; $('#fi-apercu', box).innerHTML = '<span class="muet">La nouvelle vidéo s\'affichera ici.</span>'; $('#fi-utiliser', box).disabled = true; $('#fi-harmo', box).hidden = true; }
        if (m === 'recolorer') mesurer();
        generer();
      };
      const urlFond = async () => { const src = pl.fond.media; if (/^idb:/.test(src)) { const b = await IDB.lire(src); return URL.createObjectURL(b); } return resoudre(src); };
      const mesurer = async () => {
        if (paletteRef) return;
        try {
          $('#fi-palette', box).textContent = 'Mesure des couleurs du fond actuel…';
          const r = await Etalonnage.palette(await urlFond(), 6);
          paletteRef = r.palette; statsRef = r.stats;
          $('#fi-palette', box).innerHTML = 'Couleurs visées : ' + paletteRef.map(x => `<span class="pastille" style="background:${x.hex}" title="${esc(x.role)} · ${x.part} %"></span>`).join('');
        } catch (e) { $('#fi-palette', box).textContent = e.message; }
      };
      const montrer = (f, note) => {
        f._m = methode === 'animer' ? 'animer' : 'fond';
        fichier = f;
        const u = URL.createObjectURL(f);
        $('#fi-apercu', box).innerHTML = `<video src="${u}" autoplay muted loop playsinline></video><div class="muet">${esc(note || f.name)} · <a href="${u}" download="${esc(f.name)}">télécharger</a></div>`;
        $('#fi-utiliser', box).disabled = false;
        $('#fi-harmo', box).hidden = false;
      };
      // ----- 1. idée, mouvement, calques -----
      $$('[data-idee]', box).forEach(b => b.onclick = () => { const t = $('#fi-idee', box); t.value = (t.value ? t.value.replace(/[.\s]*$/, '') + '. ' : '') + b.dataset.idee; generer(); });
      $('#fi-idee', box).oninput = () => { clearTimeout(box._t); box._t = setTimeout(generer, 400); };
      $$('#fi-mvt button', box).forEach(b => b.onclick = () => { mouvement = b.dataset.v; $$('#fi-mvt button', box).forEach(x => x.classList.toggle('actif', x === b)); generer(); });
      $$('.calque-ia', box).forEach(l => {
        const id = l.dataset.id, c = pl.calques.find(x => x.id === id);
        $('input[type=checkbox]', l).onchange = e => { if (e.target.checked) exclus.delete(id); else exclus.add(id); l.classList.toggle('off', !e.target.checked); generer(); };
        const t = $('.ci-texte', l);
        if (t) t.oninput = () => { E.modif(); c.texte = t.value; E.rafraichir(); generer(); };
      });
      // ----- 2. méthodes -----
      $$('[data-m]', box).forEach(b => b.onclick = () => choisirMethode(b.dataset.m));
      $('#fi-copier-etal', box).onclick = async () => { await mesurer(); copier(promptEtal()); };
      const imageFondSeul = async () => {
        const u = await urlFond();
        const v = document.createElement('video'); v.muted = true; v.src = u;
        await new Promise((ok, ko) => { v.onloadeddata = ok; v.onerror = () => ko(new Error('vidéo illisible')); });
        await new Promise(ok => { v.onseeked = ok; v.currentTime = Math.min(1, (v.duration || 2) / 2); });
        const c = document.createElement('canvas'); c.width = 704; c.height = 1280;
        const g = c.getContext('2d'); const r = Math.max(704 / v.videoWidth, 1280 / v.videoHeight);
        g.drawImage(v, (704 - v.videoWidth * r) / 2, (1280 - v.videoHeight * r) / 2, v.videoWidth * r, v.videoHeight * r);
        return dataURLversBlob(c.toDataURL('image/jpeg', 0.92));
      };
      // Photo ou vidéo de l'utilisateur : recadrée en 704×1280, puis passée aux couleurs du fond actuel
      const cadrer = async f => {
        const u = URL.createObjectURL(f);
        let el, w, hh;
        if (/^video/.test(f.type)) {
          el = document.createElement('video'); el.muted = true; el.src = u;
          await new Promise((ok, ko) => { el.onloadeddata = ok; el.onerror = () => ko(new Error('vidéo illisible')); });
          await new Promise(ok => { el.onseeked = ok; el.currentTime = Math.min(1, (el.duration || 2) / 2); });
          w = el.videoWidth; hh = el.videoHeight;
        } else {
          el = new Image(); el.src = u; await el.decode().catch(() => { throw new Error('image illisible'); }); w = el.naturalWidth; hh = el.naturalHeight;
        }
        const c = document.createElement('canvas'); c.width = 704; c.height = 1280;
        const r = Math.max(704 / w, 1280 / hh);
        c.getContext('2d').drawImage(el, (704 - w * r) / 2, (1280 - hh * r) / 2, w * r, hh * r);
        return c;
      };
      const preparerSrcWan = async () => {
        if (!srcWan) throw new Error('Choisissez d\'abord votre photo ou vidéo');
        const c = await cadrer(srcWan);
        const avant = c.toDataURL('image/jpeg', 0.8);
        await mesurer();
        if (statsRef) Etalonnage.recolorerCanvas(c, Etalonnage.construireLUT(Etalonnage.statsCanvas(c), statsRef, 0.9));
        $('#fi-wan-comp', box).innerHTML = `<div><img src="${avant}" style="width:72px;border-radius:6px"><br>Votre fichier</div><div><img src="${c.toDataURL('image/jpeg', 0.8)}" style="width:72px;border-radius:6px"><br>Aux couleurs du thème</div>`;
        imageWan = dataURLversBlob(c.toDataURL('image/jpeg', 0.92));
      };
      // ----- Animer une image -----
      const majPhotos = () => { $$('[data-photo]', box).forEach(b => b.classList.toggle('actif', b.dataset.photo === photoSel)); $('.nf-photo-plus', box).classList.toggle('actif', !photoSel && !!srcAnim); $('#fi-anim-nom', box).textContent = photoSel ? 'Photo du plan choisie.' : srcAnim ? srcAnim.name : 'Choisissez une photo du plan, ou ＋ pour une autre image.'; majSurPlan(); };
      $$('[data-photo]', box).forEach(b => b.onclick = () => { photoSel = b.dataset.photo; srcAnim = null; majPhotos(); });
      $('#fi-anim-src', box).onchange = e => { const f = e.target.files[0]; if (!f) return; srcAnim = f; photoSel = null; majPhotos(); };
      $$('#fi-anim-mvt .puce', box).forEach(b => b.onclick = () => { mvtAnim = Number(b.dataset.v); $$('#fi-anim-mvt .puce', box).forEach(x => x.classList.toggle('actif', x === b)); });
      if (ouv.calque) majPhotos();
      $('#fi-animer', box).onclick = async () => {
        const cf = reglages.comfy || {};
        if (!cf.url) { location.hash = '#/reglages'; fermer(); toast('Collez d\'abord l\'adresse de votre pod'); return; }
        let blob = srcAnim;
        if (photoSel) { const c = pl.calques.find(x => x.id === photoSel); blob = c && /^idb:/.test(c.media) ? await IDB.lire(c.media) : c ? await (await fetch(await resoudre(c.media))).blob() : null; }
        if (!blob) { toast('Choisissez d\'abord l\'image à animer'); return; }
        const b = $('#fi-animer', box), etat = $('#fi-anim-etat', box); b.disabled = true;
        etat.textContent = 'Vérification du pod…';
        if (!(await podPret())) { b.disabled = false; etat.textContent = 'Pod pas prêt : recliquez quand vous voulez.'; return; }
        try {
          // taille proche de l'image, multiple de 16, même nombre de pixels qu'un fond 704×1280
          const u = URL.createObjectURL(blob); const im = new Image(); im.src = u; await im.decode();
          const r = im.naturalWidth / im.naturalHeight, aire = 704 * 1280;
          const H = Math.round(Math.sqrt(aire / r) / 16) * 16, W = Math.round(H * r / 16) * 16;
          const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(im, 0, 0, W, H);
          if ($('#fi-anim-theme', box).checked) { await mesurer(); if (statsRef) Etalonnage.recolorerCanvas(c, Etalonnage.construireLUT(Etalonnage.statsCanvas(c), statsRef, 0.8)); }
          const imageBlob = dataURLversBlob(c.toDataURL('image/jpeg', 0.93));
          const idee = $('#fi-anim-idee', box).value.trim();
          const prompt = `Bring this photo to life with ${ANIM_MVT[mvtAnim][1]}. ${idee ? 'Detail: ' + idee + '. ' : ''}Keep everything identical to the photo: same people, same faces and expressions, same clothes, same hands, same background and colors; only natural, subtle, realistic motion. Static framing, smooth, no flicker, no cuts, no new objects, no text.`;
          let wf = Comfy.WORKFLOWS[cf.modele || '14b'] || Comfy.WORKFLOW_14B;
          if (cf.modele === 'perso') { try { wf = Fabrique.lireJSON(cf.workflow); } catch (e) { throw new Error('Le workflow collé dans Réglages est illisible'); } }
          let idTravail = null; const nomB = 'Image animée — plan ' + (k + 1); const t0 = Date.now();
          const res = await Comfy.generer(cf.url, wf, { imageBlob, prompt, negatif: 'deformed face, distorted face, morphing, extra fingers, deformed hands, blurry, text, watermark, flicker', secondes: 5, maxImages: (cf.modele || '14b') === '14b' ? 81 : 121, largeur: W, hauteur: H, surLance: id => { idTravail = id; Travaux.ajouter({ id, base: cf.url, evt: p.id, type: 'video', nom: nomB }); } }, t => { etat.textContent = t; });
          const fa = new File([res.blob], 'anime-plan-' + (k + 1) + '-' + res.nom.split('/').pop(), { type: res.blob.type || 'video/mp4' });
          const sec = (Date.now() - t0) / 1000;
          fa._media = await sauverBrouillon(fa, 'video', p.id, nomB); fa._media.secondes_creation = sec; sauverMedias(); if (idTravail) Travaux.retirer(idTravail);
          Equipe.noter('animer', nomB, sec, p);
          montrer(fa, 'Image animée par Wan 2.2 en ' + dureeTexte(sec) + ' · déjà gardée en brouillon');
          etat.textContent = 'Vidéo reçue en ' + dureeTexte(sec) + ', voir à droite.';
        } catch (e) { etat.textContent = e.message; }
        b.disabled = false;
      };
      $$('#fi-depart button', box).forEach(b => b.onclick = () => { departWan = b.dataset.v; $$('#fi-depart button', box).forEach(x => x.classList.toggle('actif', x === b)); $('#fi-depart-fichier', box).style.display = departWan === 'fichier' ? '' : 'none'; generer(); });
      $('#fi-wan-src', box).onchange = async e => { srcWan = e.target.files[0]; imageWan = null; if (!srcWan) return; $('#fi-wan-src-nom', box).textContent = srcWan.name; try { await preparerSrcWan(); } catch (err) { toast(err.message); } };
      $('#fi-wan', box).onclick = async () => {
        if (departWan === 'fichier' && !srcWan) { toast('Choisissez d\'abord votre photo ou vidéo'); return; }
        const cf = reglages.comfy || {};
        if (!cf.url) { location.hash = '#/reglages'; fermer(); toast('Collez d\'abord l\'adresse de votre pod'); return; }
        const b = $('#fi-wan', box), etat = $('#fi-wan-etat', box); b.disabled = true;
        etat.textContent = 'Vérification du pod…';
        if (!(await podPret())) { b.disabled = false; etat.textContent = 'Pod pas prêt : recliquez sur Générer quand vous voulez.'; return; }
        try {
          const prompt = promptWan();
          if (departWan === 'fichier' && !imageWan) await preparerSrcWan();
          const imageBlob = departWan === 'fichier' ? imageWan : await imageFondSeul();
          let wf = Comfy.WORKFLOWS[cf.modele || '14b'] || Comfy.WORKFLOW_14B;
          if (cf.modele === 'perso') { try { wf = Fabrique.lireJSON(cf.workflow); } catch (e) { throw new Error('Le workflow collé dans Réglages est illisible'); } }
          let idTravail = null; const nomB = 'Fond Wan — plan ' + (k + 1); const t0 = Date.now();
          const r = await Comfy.generer(cf.url, wf, { imageBlob, prompt, negatif: 'text, letters, words, numbers, watermark, logo, people, faces', secondes: 5, maxImages: (cf.modele || '14b') === '14b' ? 81 : 121, surLance: id => { idTravail = id; Travaux.ajouter({ id, base: cf.url, evt: p.id, type: 'fond', nom: nomB }); } }, t => { etat.textContent = t; });
          const fw = new File([r.blob], 'wan-plan-' + (k + 1) + '-' + r.nom.split('/').pop(), { type: r.blob.type || 'video/mp4' });
          const sec = (Date.now() - t0) / 1000;
          fw._media = await sauverBrouillon(fw, 'fond', p.id, nomB); fw._media.secondes_creation = sec; sauverMedias(); if (idTravail) Travaux.retirer(idTravail);
          Equipe.noter('wan', nomB, sec, p);
          montrer(fw, 'Créée par Wan 2.2 en ' + dureeTexte(sec) + ' · déjà gardée en brouillon');
          etat.textContent = 'Vidéo reçue en ' + dureeTexte(sec) + ', voir à droite.';
        } catch (e) { etat.textContent = e.message; }
        b.disabled = false;
      };
      // ----- recoloration (gratuite, dans le navigateur) -----
      let statsV2 = null, urlV2 = null;
      $('#fi-v2', box).onchange = e => { video2 = e.target.files[0]; if (!video2) return; $('#fi-v2-nom', box).textContent = video2.name; $('#fi-comp', box).innerHTML = ''; };
      const preparer = async () => {
        if (!video2) throw new Error('Choisissez d\'abord la vidéo à recolorer');
        await mesurer(); if (!statsRef) throw new Error('Couleurs du fond actuel indisponibles');
        if (!urlV2 || urlV2.f !== video2) { urlV2 = { u: URL.createObjectURL(video2), f: video2 }; statsV2 = (await Etalonnage.palette(urlV2.u, 6)).stats; }
        return Etalonnage.construireLUT(statsV2, statsRef, Number($('#fi-force', box).value));
      };
      $('#fi-voir', box).onclick = async () => {
        try { const lut = await preparer(); const a = await Etalonnage.apercu(urlV2.u, lut); $('#fi-comp', box).innerHTML = `<div><img src="${a.avant}" style="width:96px;border-radius:8px"><br>Avant</div><div><img src="${a.apres}" style="width:96px;border-radius:8px"><br>Après</div>`; }
        catch (e) { toast(e.message); }
      };
      $('#fi-force', box).oninput = () => { clearTimeout(box._f); box._f = setTimeout(() => { if ($('#fi-comp', box).innerHTML) $('#fi-voir', box).click(); }, 300); };
      const recolorer = async (b, libelle) => {
        b.disabled = true; const t0 = Date.now();
        try {
          const lut = await preparer();
          b.textContent = 'Recoloration…';
          const r = await Etalonnage.recolorer(urlV2.u, lut, { progres: v => { $('#fi-barre', box).style.width = Math.round(v * 100) + '%'; b.textContent = 'Recoloration… ' + Math.round(v * 100) + ' %'; } });
          const fr = new File([r.blob], video2.name.replace(/\.\w+$/, '') + '-recolore.' + r.extension, { type: r.blob.type });
          const sec = (Date.now() - t0) / 1000;
          fr._media = await sauverBrouillon(fr, methode === 'animer' ? 'video' : 'fond', p.id, 'Recolorée — plan ' + (k + 1)); fr._media.secondes_creation = sec; sauverMedias();
          Equipe.noter('recolorer', 'Recolorée — plan ' + (k + 1), sec, p);
          montrer(fr, 'Recolorée en ' + dureeTexte(sec) + ' · déjà gardée en brouillon');
        } catch (e) { toast(e.message); }
        b.disabled = false; b.textContent = libelle;
      };
      $('#fi-auto', box).onclick = () => recolorer($('#fi-auto', box), 'Recolorer');
      $('#fi-harmo', box).onclick = () => { if (!fichier) return; video2 = fichier; $('#fi-v2-nom', box).textContent = fichier.name; recolorer($('#fi-harmo', box), 'Harmoniser ses couleurs avec le fond actuel'); };
      // ----- 3. résultat -----
      $('#fi-fichier', box).onchange = e => { const f = e.target.files[0]; if (f) montrer(f); };
      $('#fi-utiliser', box).onclick = async () => {
        if (!fichier) return;
        const anime = methode === 'animer';
        const surPlan = $('#fi-surplan', box).checked;
        const m = fichier._media && medias.includes(fichier._media) ? fichier._media : await importerFichier(fichier, anime ? 'video' : 'fond', p.id);
        delete m.brouillon;
        Equipe.apresAjout(m, p);
        const finir = t => { fermer(); toast(t); if (ouv.apres) ouv.apres(); };
        if (anime) {
          m.anime = true; m.nom = 'Image animée — plan ' + (k + 1); sauverMedias(); Equipe.apresAjout(m, p);
          if (!surPlan) return finir('Image animée rangée dans la bibliothèque de l\'événement');
          const c = photoSel && pl.calques.find(x => x.id === photoSel);
          if (c) { E.modif(true); c.media = m.src; c.type = 'video'; enregistrer(p); E.eng.precharger().then(() => { E.rafraichir(); E.afficher(); }); }
          else E.ajouterMedia(m);
          return finir('Image animée rangée dans la bibliothèque et posée sur le plan ' + (k + 1));
        }
        const o = lire();
        Object.assign(m, { nom: 'Fond plan ' + (k + 1) + ' — ' + (p.fiche.titre || '').slice(0, 30), usage, description: o.idee || 'Fond créé pour le plan ' + (k + 1), description_en: '', zone_texte: 'voir la mise en page du plan ' + (k + 1), origine: 'ia' });
        sauverMedias();
        if (!surPlan) return finir('Nouveau fond rangé dans la bibliothèque de l\'événement');
        E.modif(true);
        const ancien = pl.fond.media;
        if ($('#fi-autres', box) && $('#fi-autres', box).checked) p.plans.forEach(x => { if (x.fond && x.fond.media === ancien) x.fond.media = m.src; });
        pl.fond.media = m.src;
        pl.fond_ia = Object.assign(pl.fond_ia || {}, { fichier: m.src });
        enregistrer(p);
        E.eng.precharger().then(() => { E.eng._entrerPlan(); E.afficher(); });
        finir('Nouveau fond rangé dans la bibliothèque et mis sur le plan ' + (k + 1));
      };
      choisirMethode(methode);
    });
  }

  function modaleComposerTout(E) {
    const p = E.p;
    const prompt = Fabrique.prompt1(p, tousFonds());
    modale(`<h2>Composer toute l'invitation avec l'IA</h2>
      <p class="muet">Un seul prompt pour toute la séquence, pour garder le même style d'un plan à l'autre. La réponse remplace tous les plans (vous pourrez annuler).</p>
      <div class="ia-grille"><div class="pile"><textarea class="prompt-zone" readonly>${esc(prompt)}</textarea><button class="btn plein" id="c-copier">Copier le prompt</button></div>
      <div class="pile"><textarea class="prompt-zone" id="c-rep" placeholder='{ "plans": [ ... ] }'></textarea><button class="btn plein" id="c-ok">Vérifier et appliquer</button><div id="c-res"></div></div></div>`, (box, fermer) => {
      $('#c-copier', box).onclick = () => copier(prompt);
      $('#c-ok', box).onclick = () => {
        let j;
        try { j = Fabrique.lireJSON($('#c-rep', box).value); } catch (e) { $('#c-res', box).innerHTML = `<div class="erreur-boite">${esc(e.message)}</div>`; return; }
        const liste = Array.isArray(j) ? j : j.plans;
        if (!Array.isArray(liste) || !liste.length) { $('#c-res', box).innerHTML = '<div class="erreur-boite">Aucune liste « plans » trouvée.</div>'; return; }
        const srcs = tousFonds().map(f => f.src).concat(medias.map(m => m.src));
        const erreurs = []; const plans = [];
        liste.forEach((pl, n) => { const v = Fabrique.validerPlan(pl, srcs); v.erreurs.forEach(e => erreurs.push(`Plan ${n + 1} : ${e}`)); if (v.ok) plans.push(Object.assign({ id: uid(), transition: { type: 'fondu', duree: 0.8 } }, v.plan)); });
        const roles = plans.map(x => x.role);
        if (!roles.includes('confirmation')) erreurs.push('Il manque le plan de confirmation');
        if (!roles.includes('remerciement')) erreurs.push('Il manque le plan de remerciement');
        if (plans.length !== liste.length || erreurs.some(e => !/attention/.test(e))) { $('#c-res', box).innerHTML = `<div class="erreur-boite"><ul class="liste-mini">${erreurs.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`; return; }
        E.modif(true); p.plans = plans; E.i = 0; E.sel = null; enregistrer(p); fermer(); E.eng.precharger().then(E.afficher); toast('Plans remplacés (↶ pour annuler)');
      };
    });
  }

  /* ---------- Invités ---------- */
  /* ---------- Synchronisation avec la base des invités (espace organisateur) ---------- */
  const lienHote = p => urlSite() + 'hote/?p=' + encodeURIComponent(p.slug) + '#' + (p.cle_hote || '');
  const enBase = f => ({ code: f.code, nom: f.nom || '', categorie: f.categorie || '', places: Number(f.places) || 1, telephone: f.telephone || '', table: f.table || '', statut: f.statut || 'attente', adultes: Number(f.adultes) || 0, enfants: Number(f.enfants) || 0 });
  async function syncInvites(p, pousserTout) {
    const sb = reglages.supabase; if (!sb || !p.cle_hote) return false;
    p.familles = p.familles || [];
    p.familles.forEach(f => { if (!f.code) f.code = codeFamille(); });
    for (const c of p.supprimes || []) { try { await Base.rpc(sb, 'inv_hote_supprimer', { p_evt: p.id, p_cle: p.cle_hote, p_code: c }); } catch (e) {} }
    p.supprimes = [];
    const d = await Base.rpc(sb, 'inv_hote_lire', { p_evt: p.id, p_cle: p.cle_hote });
    const distant = new Map((d.familles || []).map(f => [f.code, f]));
    // La base fait foi (réponses des invités, ajouts de l'organisateur) ; les familles créées dans le studio et absentes de la base y sont envoyées
    const locales = p.familles.filter(f => !distant.has(f.code));
    const fusion = (d.familles || []).map(r => Object.assign({}, p.familles.find(f => f.code === r.code) || { id: uid() }, r));
    p.familles = fusion.concat(locales);
    p.reponses_generales = (d.reponses || []).filter(r => !r.code);
    const aEnvoyer = pousserTout ? p.familles : locales;
    if (aEnvoyer.length) await Base.rpc(sb, 'inv_hote_familles', { p_evt: p.id, p_cle: p.cle_hote, p_familles: aEnvoyer.map(enBase) });
    enregistrer(p);
    return true;
  }
  let syncT = null;
  function pousserFamille(p, f) {
    const sb = reglages.supabase; if (!sb || !p.cle_hote || !p.publie) return;
    clearTimeout(syncT); syncT = setTimeout(() => Base.rpc(sb, 'inv_hote_familles', { p_evt: p.id, p_cle: p.cle_hote, p_familles: [enBase(f)] }).catch(e => toast('Base des invités : ' + e.message)), 600);
  }

  function ongletInvites(p, dejaSync) {
    p.familles = p.familles || [];
    const fs = p.familles;
    const somme = (l, k) => l.reduce((s, f) => s + (Number(f[k]) || 0), 0);
    const vient = fs.filter(f => f.statut === 'vient'), non = fs.filter(f => f.statut === 'non'), att = fs.filter(f => !f.statut || f.statut === 'attente');
    const L = p.fiche.langue === 'mg';
    p.message_envoi = p.message_envoi || (L ? 'Salama {famille}! Faly manasa anareo izahay. Ity ny fanasana: {lien}' : 'Bonjour {famille} ! Nous avons le plaisir de vous inviter. Voici votre invitation : {lien}');
    $('#onglet').innerHTML = `
      <div class="stats">
        <div class="stat"><b>${fs.length}</b><span>familles</span></div><div class="stat"><b>${somme(fs, 'places')}</b><span>places invitées</span></div>
        <div class="stat"><b>${vient.length}</b><span>confirmées · ${somme(vient, 'adultes') + somme(vient, 'enfants')} pers.</span></div>
        <div class="stat"><b>${non.length}</b><span>ne viennent pas</span></div><div class="stat"><b>${att.length}</b><span>en attente</span></div>
      </div>
      <div class="ligne" style="margin-bottom:10px">
        <button class="btn plein" id="add-fam">+ Famille</button>
        <label class="btn">Importer Excel<input type="file" id="imp-xls" accept=".xlsx,.xls,.csv" hidden></label>
        <button class="btn" id="exp-xls">Exporter Excel</button>
        <button class="btn" id="modele-xls">Modèle Excel vide</button>
        ${reglages.firebase ? '<button class="btn" id="charger-rep">Charger les réponses (Firebase)</button>' : ''}
      </div>
      <datalist id="cats-invites">${[...new Set((p.fiche.langue === 'mg' ? ["Fianakaviana avy amin'ny ray", "Fianakaviana avy amin'ny reny", 'Namana', 'Mpiara-miasa', 'Mpiray fiangonana', 'Mpifanolobodirindrina'] : ['Famille du père', 'Famille de la mère', 'Amis', 'Collègues', 'Église', 'Voisins']).concat(fs.map(f => f.categorie).filter(Boolean)))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="carte" style="padding:10px"><div class="tableau-boite"><table class="tableau">
        <thead><tr><th>Famille</th><th>Catégorie</th><th>Places</th><th>Adultes</th><th>Enfants</th><th>Téléphone</th><th>Statut</th><th>Table</th><th>Lien</th><th></th></tr></thead>
        <tbody>${fs.map((f, k) => `<tr data-k="${k}">
          <td><input type="text" data-k="nom" value="${esc(f.nom)}"></td><td><input type="text" data-k="categorie" list="cats-invites" value="${esc(f.categorie || '')}" style="width:150px" placeholder="Choisir…"></td>
          <td><input type="number" data-k="places" min="1" value="${f.places || 1}" style="width:64px"></td><td><input type="number" data-k="adultes" min="0" value="${f.adultes || 0}" style="width:64px"></td><td><input type="number" data-k="enfants" min="0" value="${f.enfants || 0}" style="width:64px"></td>
          <td><input type="text" data-k="telephone" value="${esc(f.telephone || '')}" style="width:130px"></td>
          <td><select data-k="statut"><option value="attente" ${!f.statut || f.statut === 'attente' ? 'selected' : ''}>En attente</option><option value="vient" ${f.statut === 'vient' ? 'selected' : ''}>Vient</option><option value="non" ${f.statut === 'non' ? 'selected' : ''}>Ne vient pas</option></select></td>
          <td><input type="text" data-k="table" value="${esc(f.table || '')}" style="width:60px"></td>
          <td class="ligne" style="flex-wrap:nowrap"><button class="btn petit" data-a="copier">Copier</button><button class="btn petit" data-a="wa">WhatsApp</button><button class="btn petit" data-a="voir">Voir</button></td>
          <td><button class="btn petit danger" data-a="suppr">✕</button></td></tr>`).join('') || '<tr><td colspan="10" class="muet" style="padding:16px">Aucune famille. Ajoutez-en ou importez un fichier Excel (colonnes : Famille, Catégorie, Adultes, Enfants, Téléphone).</td></tr>'}</tbody>
      </table></div></div>
      ${planTables(p)}
      <div class="carte pile" style="margin-top:14px;max-width:760px">
        <h3>Message d'envoi WhatsApp</h3>
        <textarea id="msg-envoi" rows="3" style="width:100%">${esc(p.message_envoi)}</textarea>
        <p class="muet">{famille} et {lien} sont remplacés pour chaque famille. Lien général à partager en groupe : <a href="${esc(lienGeneral(p))}" target="_blank">${esc(lienGeneral(p))}</a> <button class="btn petit" id="copier-gen">Copier</button></p>
        <p class="muet">Les liens fonctionnent une fois l'invitation publiée (onglet Film et publication). Après chaque ajout de famille, republiez.</p>
      </div>`;
    $('#msg-envoi').oninput = e => { p.message_envoi = e.target.value; enregistrer(p); };
    $$('[data-cap]').forEach(i => i.onchange = () => { p.tables = p.tables || {}; p.tables[i.dataset.cap] = Number(i.value) || 0; enregistrer(p); ongletInvites(p); });
    $('#copier-gen').onclick = () => copier(lienGeneral(p));
    if (!dejaSync && reglages.supabase && p.cle_hote && p.publie) syncInvites(p).then(ok => { if (ok && $('#add-fam')) ongletInvites(p, true); }).catch(e => toast('Base des invités : ' + e.message));
    $('#add-fam').onclick = () => { const f = { id: uid(), code: codeFamille(), nom: 'Nouvelle famille', categorie: '', places: 2, adultes: 2, enfants: 0, telephone: '', statut: 'attente' }; fs.push(f); enregistrer(p); pousserFamille(p, f); ongletInvites(p, true); };
    $$('.tableau tbody tr[data-k]').forEach(tr => {
      const f = fs[Number(tr.dataset.k)];
      $$('[data-k]', tr).forEach(inp => inp.onchange = () => {
        f[inp.dataset.k] = inp.type === 'number' ? Number(inp.value) : inp.value;
        if (inp.dataset.k === 'adultes' || inp.dataset.k === 'enfants') { f.places = Math.max(Number(f.places) || 0, (Number(f.adultes) || 0) + (Number(f.enfants) || 0)); }
        enregistrer(p); pousserFamille(p, f); if (inp.dataset.k === 'statut' || inp.dataset.k === 'adultes' || inp.dataset.k === 'enfants') ongletInvites(p, true);
      });
      $$('[data-a]', tr).forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (!f.code) f.code = codeFamille();
        if (a === 'copier') copier(lienFamille(p, f));
        if (a === 'wa') { const msg = p.message_envoi.replace(/\{famille\}/g, f.nom).replace(/\{lien\}/g, lienFamille(p, f)); window.open((f.telephone ? 'https://wa.me/' + telWa(f.telephone) : 'https://wa.me/') + '?text=' + encodeURIComponent(msg), '_blank'); }
        if (a === 'voir') { Stock.ecrire('studio.apercu', publication(p, true)); window.open('../i/?apercu=1&f=' + encodeURIComponent(f.code), '_blank'); }
        if (a === 'suppr') { if (confirm('Supprimer ' + f.nom + ' ?')) { fs.splice(Number(tr.dataset.k), 1); if (f.code && p.cle_hote) { p.supprimes = (p.supprimes || []).concat(f.code); if (reglages.supabase && p.publie) syncInvites(p).catch(() => {}); } enregistrer(p); ongletInvites(p, true); } }
      });
    });
    $('#modele-xls').onclick = () => {
      if (!window.XLSX) return toast('Chargement de l\'outil Excel…');
      const ws = XLSX.utils.aoa_to_sheet([['Famille', 'Catégorie', 'Adultes', 'Enfants', 'Téléphone', 'Table'], ['Fianakaviana Rakoto', 'Fianakaviana', 2, 2, '034 00 000 00', '1']]);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Invités'); XLSX.writeFile(wb, 'modele-invites.xlsx');
    };
    $('#exp-xls').onclick = () => {
      if (!window.XLSX) return toast('Chargement de l\'outil Excel…');
      const lignes = fs.map(f => ({ Famille: f.nom, Catégorie: f.categorie || '', Places: f.places, Adultes: f.adultes, Enfants: f.enfants, Téléphone: f.telephone || '', Statut: f.statut === 'vient' ? 'Vient' : f.statut === 'non' ? 'Ne vient pas' : 'En attente', Table: f.table || '', Lien: lienFamille(p, f) }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lignes), 'Invités'); XLSX.writeFile(wb, (p.slug || 'invites') + '-invites.xlsx');
    };
    $('#imp-xls').onchange = async e => {
      if (!window.XLSX) return toast('Chargement de l\'outil Excel…');
      const wb = XLSX.read(await e.target.files[0].arrayBuffer());
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const cle = (r, noms) => { const k = Object.keys(r).find(x => noms.some(n => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(n))); return k ? r[k] : ''; };
      const vus = {}; fs.forEach(f => vus[f.nom] = true);
      let ajout = 0; const sansNom = [];
      rows.forEach((r, n) => {
        let nom = String(cle(r, ['famille', 'nom', 'anarana'])).trim();
        const ad = Number(cle(r, ['adulte', 'olon'])) || 0, en = Number(cle(r, ['enfant', 'ankizy'])) || 0;
        if (!nom) { if (ad || en) sansNom.push(n + 2); return; }
        if (vus[nom]) { let i = 2; while (vus[`${nom} (${i})`]) i++; nom = `${nom} (${i})`; }
        vus[nom] = true;
        fs.push({ id: uid(), code: codeFamille(), nom, categorie: String(cle(r, ['categ', 'sokajy'])), adultes: ad, enfants: en, places: Number(cle(r, ['place'])) || ad + en || 1, telephone: String(cle(r, ['tel', 'phone', 'finday'])), table: String(cle(r, ['table'])), statut: 'attente' });
        ajout++;
      });
      enregistrer(p); ongletInvites(p);
      toast(`${ajout} familles importées` + (sansNom.length ? ` · lignes sans nom : ${sansNom.join(', ')}` : ''));
    };
    const cr = $('#charger-rep');
    if (cr) cr.onclick = () => chargerReponses(p);
  }

  function planTables(p) {
    const fs = p.familles || [];
    const groupes = {};
    fs.forEach(f => { const t = String(f.table || '').trim(); if (!t) return; (groupes[t] = groupes[t] || []).push(f); });
    const noms = Object.keys(groupes).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    const sans = fs.filter(f => !String(f.table || '').trim() && f.statut !== 'non');
    if (!noms.length) return `<div class="carte" style="margin-top:14px"><h3>Plan de tables</h3><p class="muet">Écrivez un numéro ou un nom de table dans la colonne « Table » : les tables apparaîtront ici avec leur remplissage.</p></div>`;
    return `<div class="carte" style="margin-top:14px"><h3>Plan de tables</h3>
      <div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:8px">${noms.map(t => {
        const l = groupes[t].filter(f => f.statut !== 'non');
        const pers = l.reduce((s, f) => s + ((Number(f.adultes) || 0) + (Number(f.enfants) || 0) || Number(f.places) || 0), 0);
        const cap = (p.tables || {})[t] || 10;
        return `<div class="stat"><div class="ligne" style="justify-content:space-between"><b style="font-size:20px">Table ${esc(t)}</b><span class="badge ${pers > cap ? 'alerte' : 'ok'}">${pers} / ${cap}</span></div>
          <div class="muet" style="margin:4px 0">${l.map(f => esc(f.nom)).join(', ') || '—'}</div>
          <label class="champ">Capacité<input type="number" min="1" data-cap="${esc(t)}" value="${cap}" style="width:80px"></label></div>`;
      }).join('')}</div>
      ${sans.length ? `<p class="muet" style="margin-top:10px">Sans table : ${sans.map(f => esc(f.nom)).join(', ')}</p>` : ''}</div>`;
  }

  async function chargerScript(src) { if ($$(`script[src="${src}"]`).length) return; return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }); }
  async function firebasePret() {
    if (!reglages.firebase) throw new Error('Firebase non configuré');
    await chargerScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
    await chargerScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js');
    await chargerScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js');
    if (!firebase.apps.length) firebase.initializeApp(reglages.firebase);
    if (!firebase.auth().currentUser) await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
    return firebase.firestore();
  }
  async function chargerReponses(p) {
    try {
      const db = await firebasePret();
      const snap = await db.collection('evenements').doc(p.id).collection('reponses').orderBy('date').get();
      let n = 0;
      snap.forEach(d => { const r = d.data(); const f = p.familles.find(x => x.code === r.fid); if (f) { f.statut = r.presence === 'oui' ? 'vient' : 'non'; f.adultes = r.adultes; f.enfants = r.enfants; n++; } });
      enregistrer(p); ongletInvites(p); toast(n + ' réponses appliquées');
    } catch (e) { toast('Impossible de lire les réponses : ' + e.message); }
  }

  /* ---------- Publication ---------- */
  function publication(p, apercu) {
    const pub = JSON.parse(JSON.stringify(p));
    pub.liens = {};
    (p.familles || []).forEach(f => { if (!f.code) f.code = codeFamille(); pub.liens[f.code] = { nom: f.nom, places: f.places, prevus_adultes: f.prevus_adultes, prevus_enfants: f.prevus_enfants, adultes: f.adultes, enfants: f.enfants }; });
    delete pub.familles; delete pub.historique_ia; delete pub.message_envoi;
    if (pub.fiche) delete pub.fiche.texte_source;
    pub.publication = { date: new Date().toISOString(), firebase: reglages.firebase || null, supabase: reglages.supabase || null };
    delete pub.cle_hote; delete pub.supprimes;
    pub.langues = [p.fiche.langue].concat((p.langues || []).filter(l => l !== p.fiche.langue));
    if (!apercu) pub.plans.forEach(pl => { (pl.calques || []).forEach(c => { if (c.media && /^idb:/.test(c.media)) c.media = 'medias/' + c.media.slice(4); }); if (pl.fond && /^idb:/.test(pl.fond.media)) pl.fond.media = 'medias/' + pl.fond.media.slice(4); });
    if (!apercu && pub.musique && /^idb:/.test(pub.musique.src)) pub.musique.src = 'medias/' + pub.musique.src.slice(4);
    if (!apercu) (pub.polices_perso || []).forEach(x => { if (/^idb:/.test(x.src || '')) x.src = 'medias/' + x.src.slice(4); });
    // fichiers de la bibliothèque d'équipe : copiés à côté de l'invitation (l'adresse de l'équipe ne sort pas)
    if (!apercu) { const loc = src => Equipe.estUrl(src) ? 'medias/eq-' + src.split('/').pop() : src; pub.plans.forEach(pl => { if (pl.fond) pl.fond.media = loc(pl.fond.media); (pl.calques || []).forEach(c => { if (c.media) c.media = loc(c.media); }); }); if (pub.musique && pub.musique.src) pub.musique.src = loc(pub.musique.src); }
    return pub;
  }
  const enJS = (slug, obj) => 'window.PROJETS = window.PROJETS || {};\nwindow.PROJETS[' + JSON.stringify(slug) + '] = ' + JSON.stringify(obj) + ';\n';
  function anonymiser(pub, garderNoms) {
    const d = JSON.parse(JSON.stringify(pub));
    if (garderNoms) { d.liens = { DEMO: { nom: 'Fianakaviana Rakoto', places: 4, adultes: 2, enfants: 2 } }; d.publication.firebase = null; d.publication.supabase = null; d.demo = true; return d; }
    const faux = ['Hery', 'Fanja', 'Toky', 'Lova'];
    const remp = [];
    (d.fiche.hotes || []).forEach((h, i) => { remp.push([h.nom_complet, faux[i] || 'Ami']); remp.push([h.surnom, faux[i] || 'Ami']); h.nom_complet = faux[i]; h.surnom = faux[i]; });
    (d.fiche.celebres || []).forEach(h => { remp.push([h.nom_complet, 'Kanto']); h.nom_complet = 'Kanto'; });
    (d.fiche.contacts || []).forEach((c, i) => { remp.push([c.nom, faux[i] || 'Ami']); c.nom = faux[i] || 'Ami'; c.telephone = '034 00 000 0' + i; });
    const r = t => remp.filter(x => x[0] && x[0].trim()).reduce((s, [a, b]) => s.split(a).join(b), t);
    d.plans.forEach(pl => pl.calques.forEach(c => { if (c.texte) c.texte = r(c.texte); }));
    d.fiche.phrases = (d.fiche.phrases || []).map(r);
    d.liens = { DEMO: { nom: 'Fianakaviana Rakoto', places: 4, adultes: 2, enfants: 2 } };
    d.publication.firebase = null; d.demo = true;
    return d;
  }

  /* ---------- Publication : outils communs (invitation, vitrine, page Équipe) ---------- */
  const srcsEquipe = p => [...new Set(p.plans.flatMap(pl => [pl.fond && pl.fond.media].concat((pl.calques || []).map(c => c.media))).concat(p.musique ? [p.musique.src] : []).filter(src => Equipe.estUrl(src)))];
  async function copierFichiersEquipe(srcs, suivi) {
    for (const src of srcs) {
      suivi && suivi('Copie du fichier d\'équipe ' + src.split('/').pop() + '…');
      const nom = 'medias/eq-' + src.split('/').pop();
      let existe = false; try { existe = !!(await GitHub.sha(nom)); } catch (e) {}
      if (!existe) { const r = await fetch(src); if (!r.ok) throw new Error('Fichier d\'équipe introuvable (' + r.status + ')'); await GitHub.envoyer(nom, await r.blob(), 'Fichier d\'équipe ' + src.split('/').pop()); }
    }
  }
  // Ne renvoie une liste vide que si le fichier n'existe pas encore (sinon on effacerait la vitrine)
  // Met un film de l'équipe sur la vitrine du site
  async function publierFilmVitrine(f) {
    const r = await fetch(Equipe.url(f.chemin)); if (!r.ok) throw new Error('film introuvable (' + r.status + ')');
    const ext = (f.chemin.split('.').pop() || 'mp4').toLowerCase(), chemin = 'medias/films/' + f.id + '.' + ext;
    await GitHub.envoyer(chemin, await r.blob(), 'Film ' + f.nom);
    let vignette = 'fonds/fond_2.jpg';
    if (/^data:/.test(f.vignette || '')) { vignette = 'medias/films/' + f.id + '.jpg'; await GitHub.envoyer(vignette, dataURLversBlob(f.vignette), 'Vignette ' + f.nom); }
    const index = (await lireVitrine()).filter(x => x.slug !== 'film-' + f.id);
    index.unshift({ slug: 'film-' + f.id, film: true, video: chemin, titre: (f.evenement || f.nom.replace(/^Film — /, '')), type: 'Film vidéo', vignette, auteur: f.auteur || '', date: new Date().toISOString().slice(0, 10) });
    await ecrireVitrine(index, 'Vitrine : film ' + f.nom);
  }
  // Met une invitation de l'équipe sur la vitrine (noms remplacés par des exemples)
  async function publierInvitationEquipe(t, suivi) {
    const pr = await Equipe.rpc('equipe_projet', { p_projet: t.projet });
    if (!pr) throw new Error('invitation introuvable');
    await copierFichiersEquipe(srcsEquipe(pr), suivi);
    await publierVitrine(pr, publication(pr), false, t.auteur);
  }
  async function lireVitrine() { try { return JSON.parse(await GitHub.lireTexte('vitrine/index.json')) || []; } catch (e) { if (e.message === 'absent') return []; throw e; } }
  async function ecrireVitrine(index, message) {
    await GitHub.envoyer('vitrine/index.json', JSON.stringify(index, null, 1), message);
    await GitHub.envoyer('vitrine/index.js', 'window.VITRINE = ' + JSON.stringify(index, null, 1) + ';\n', message + ' (js)');
  }
  // Met une invitation sur la vitrine du site (démo anonymisée, ou telle quelle avec l'accord du client)
  async function publierVitrine(p, pub, garderNoms, auteur) {
    const demo = anonymiser(pub, garderNoms);
    await GitHub.envoyer('projets/demo-' + p.slug + '.json', JSON.stringify(demo, null, 1), 'Démo ' + p.fiche.titre);
    await GitHub.envoyer('projets/demo-' + p.slug + '.js', enJS('demo-' + p.slug, demo), 'Démo ' + p.fiche.titre + ' (js)');
    const plV = p.plans.find(x => x.role !== 'ouverture' && MoteurInfo.fondMedia(x)) || p.plans.find(x => MoteurInfo.fondMedia(x));
    const fondV = (plV && MoteurInfo.fondMedia(plV)) || 'fonds/fond_2.jpg';
    let vignette = /^idb:/.test(fondV) ? 'medias/' + fondV.slice(4).replace(/\.\w+$/, '.jpg') : /^data:/.test(fondV) ? 'fonds/fond_2.jpg' : fondV.replace(/\.mp4$/, '.jpg');
    if (Equipe.estUrl(fondV)) { const it = Equipe.medias().find(x => x.src === fondV); vignette = 'medias/eq-' + fondV.split('/').pop().replace(/\.\w+$/, '.jpg'); if (it && /^data:/.test(it.vignette || '')) await GitHub.envoyer(vignette, dataURLversBlob(it.vignette), 'Vignette ' + p.fiche.titre); else vignette = 'fonds/fond_2.jpg'; }
    else if (/^idb:/.test(fondV)) { const mv = medias.find(x => x.src === fondV); if (mv && /^data:/.test(mv.vignette || '')) await GitHub.envoyer(vignette, dataURLversBlob(mv.vignette), 'Vignette ' + p.fiche.titre); else vignette = 'fonds/fond_2.jpg'; }
    let index = (await lireVitrine()).filter(x => x.slug !== 'demo-' + p.slug);
    index.unshift({ slug: 'demo-' + p.slug, titre: demo.fiche.titre, type: demo.fiche.type, langue: demo.fiche.langue, vignette, auteur: auteur || '', date: new Date().toISOString().slice(0, 10) });
    await ecrireVitrine(index, 'Vitrine : ' + p.fiche.titre);
  }
  async function retirerVitrine(slug, titre) {
    const index = (await lireVitrine()).filter(x => x.slug !== 'demo-' + slug);
    await ecrireVitrine(index, 'Vitrine : retrait ' + (titre || slug));
  }

  function ongletPublier(p) {
    const g = reglages.github || {};
    const pret = g.owner && g.repo && g.token;
    const fichiersIdb = [];
    p.plans.forEach(pl => { if (/^idb:/.test(pl.fond.media)) fichiersIdb.push(pl.fond.media); pl.calques.forEach(c => { if (/^idb:/.test(c.media || '')) fichiersIdb.push(c.media); }); });
    if (p.musique && /^idb:/.test(p.musique.src)) fichiersIdb.push(p.musique.src);
    (p.polices_perso || []).forEach(x => { if (/^idb:/.test(x.src || '')) fichiersIdb.push(x.src); });
    const fichiersEquipe = srcsEquipe(p);
    $('#onglet').innerHTML = `<div class="ia-grille">
      <div class="pile">
        <div class="carte pile"><h3>Aperçu</h3>
          <p class="muet">Ouvre l'invitation telle que la verront les invités (sur cet appareil).</p>
          <div class="ligne"><button class="btn" id="ap-gen">Lien général</button><button class="btn" id="ap-fam">Lien personnel (famille test)</button></div></div>
        <div class="carte pile"><h3>Musique du film</h3>
          <p class="muet">${p.musique ? 'Musique : ' + esc(p.musique.nom || p.musique.src) : 'Aucune musique. Utilisez une piste dont vous avez les droits.'}</p>
          <div class="ligne"><label class="btn">${p.musique ? 'Changer' : 'Ajouter une musique'}<input type="file" id="musique" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.wave,.ogg,.oga,.opus,.flac,.wma,.aif,.aiff,.aifc,.caf,.amr,.3gp,.3ga,.webm,.weba,.mka,.mp2,.mpga,.ac3,.mp4,.m4v,.mov,.mkv,.avi" hidden></label>${p.musique ? '<button class="btn danger" id="musique-suppr">Retirer</button>' : ''}</div>
          ${p.musique ? `<label class="champ">Volume<input type="range" id="volume" min="0" max="1" step="0.05" value="${p.musique.volume != null ? p.musique.volume : 0.8}"></label>` : ''}</div>
        <div class="carte pile"><h3>Film vidéo</h3>
          <p class="muet">Fabrique le film MP4 (ouverture, plans intermédiaires, remerciement) avec la chanson, image par image : le fichier est complet, avec les transitions et les boutons, et se lit partout (téléphone, WhatsApp, Facebook, QuickTime). Comptez environ 1 à 2 minutes ; vous pouvez changer d'onglet pendant ce temps. Tous les plans y sont, confirmation comprise (7 s).</p>
          <div class="apercu-cadre" style="height:340px;margin:0 auto" id="cadre-film"><div id="scene-film"></div></div>
          <div class="progres"><div id="barre"></div></div>
          <label class="champ">Film pour<select id="film-pour"><option value="">Tout le monde (comme le lien général)</option>${(p.familles || []).filter(f => f.nom).map(f => `<option value="${esc(f.code)}">${esc(f.nom)} (film personnalisé)</option>`).join('')}</select></label>
          ${p.plans.some(pl => (pl.calques || []).some(c => c.condition === 'famille' && c.type === 'texte' && !c.masque)) ? `<div class="pile" id="film-tous" style="gap:6px"><span class="muet">Textes du lien personnel (« Pour {famille} », « {places} personnes »…) : dans le film pour tout le monde, ils s'affichent avec :</span>
            <div class="deux"><label class="champ">{famille} devient<input type="text" id="film-nom" value="${esc((p.film || {}).nom != null ? p.film.nom : nomFilmDefaut(p))}"></label><label class="champ">{places} devient<input type="text" id="film-places" placeholder="vide = phrase sans nombre" value="${esc((p.film || {}).places || '')}"></label></div></div>` : ''}
          <div class="ligne"><button class="btn plein" id="film">Enregistrer le film</button><button class="btn" id="film-transparent" title="Vidéo WebM avec transparence : les plans « Sans fond » restent transparents, pour la poser sur une autre vidéo">▦ Vidéo sans fond (WebM)</button><span class="muet" id="film-etat"></span></div></div>
      </div>
      <div class="pile">
        ${p.commande || p.client || Equipe.admin() ? carteLivraison(p) : ''}
        <div class="carte pile carte-client"><h3>🔗 Les 2 liens à donner au client</h3>
          <ol class="etat-liste">
            <li class="${reglages.github && reglages.github.token ? 'fait' : ''}">Publication reliée (GitHub) ${reglages.github && reglages.github.token ? '✓' : '— <a href="#/reglages">à faire dans Réglages</a>'}</li>
            <li class="${reglages.supabase ? 'fait' : ''}">Base des invités (pour le lien organisateur) ${reglages.supabase ? '✓' : '— <a href="#/reglages">à faire dans Réglages</a>'}</li>
            <li class="${p.publie ? 'fait' : ''}">Invitation publiée ${p.publie ? '✓ le ' + esc(new Date(p.publie).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : '— bouton « Publier l\'invitation » ci-dessous'}</li>
          </ol>
          <div class="lien-client">
            <b>1. Lien des invités</b> <span class="muet">— l'invitation : les invités la regardent et confirment</span>
            <div class="ligne"><input type="text" readonly value="${esc(lienGeneral(p))}" style="flex:1"><button class="btn petit" id="cp-gen" ${p.publie ? '' : 'disabled'}>Copier</button></div>
            <div class="ligne"><a class="btn petit" target="_blank" href="https://wa.me/?text=${encodeURIComponent(lienGeneral(p))}">Partager sur WhatsApp</a><a class="btn petit" target="_blank" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(lienGeneral(p))}">Partager sur Facebook</a><a class="btn petit" href="#/p/${p.id}/invites">Liens personnels par famille →</a></div>
          </div>
          <div class="lien-client">
            <b>2. Lien organisateur</b> <span class="muet">— privé : le client ajoute ses invités et voit qui vient, combien</span>
            ${!reglages.supabase ? `<p class="muet" style="margin:0">Activez d'abord la <a href="#/reglages">base des invités</a> (Réglages, une seule fois), puis publiez.</p>`
              : !p.cle_hote || !p.publie ? `<p class="muet" style="margin:0">Il apparaîtra ici dès que vous aurez publié.</p>`
              : `<div class="ligne"><input type="text" readonly value="${esc(lienHote(p))}" style="flex:1"><button class="btn petit" id="cp-hote">Copier</button><a class="btn petit" target="_blank" href="${esc(lienHote(p))}">Ouvrir</a></div>
                <div class="ligne"><a class="btn petit" target="_blank" href="https://wa.me/?text=${encodeURIComponent((p.fiche.langue === 'mg' ? 'Ity ny rohy hitantananao ny vahiny (aza zaraina): ' : 'Voici votre lien pour gérer vos invités (à garder pour vous) : ') + lienHote(p))}">Envoyer au client sur WhatsApp</a></div>`}
          </div>
          ${p.publie ? '' : '<div class="alerte-boite">Tant que l\'invitation n\'est pas publiée, ces liens affichent « Invitation introuvable ».</div>'}
          ${p.fiche.date_limite && Date.now() > Date.parse(p.fiche.date_limite + 'T23:59:59+03:00') ? `<div class="alerte-boite"><b>Date limite des réponses dépassée</b> (${esc(MoteurInfo.dateLisible(p.fiche.date_limite, 'fr'))}) : les invités ne peuvent plus confirmer, l'invitation affiche « réponses closes ». Pour rouvrir, changez la date limite dans l'onglet <a href="#/p/${p.id}/fiche">Fiche</a>, puis republiez.</div>` : ''}
        </div>
        <div class="carte pile"><h3>Publier en ligne</h3>
          ${pret ? `<p class="muet">Dépôt : <b>${esc(g.owner)}/${esc(g.repo)}</b>. La publication envoie l'invitation${fichiersIdb.length ? ` et ${fichiersIdb.length} fichier(s) importé(s)` : ''} sur GitHub Pages (1 à 10 minutes avant d'être visible).</p>
            <div class="carte pile" style="padding:10px;background:#fbf7f1;margin:0">
              <label class="cases"><input type="checkbox" id="demo" ${p.vitrine ? 'checked' : ''}> <b>Montrer aussi sur la vitrine du site</b> (page d'accueil, pour les visiteurs)</label>
              <div class="pile" id="demo-opts" style="gap:4px;margin-left:24px;${p.vitrine ? '' : 'display:none'}">
                <label class="cases"><input type="radio" name="demo-mode" value="anonyme" ${p.vitrine_noms ? '' : 'checked'}> Noms et téléphones remplacés par des exemples (recommandé)</label>
                <label class="cases"><input type="radio" name="demo-mode" value="noms" ${p.vitrine_noms ? 'checked' : ''}> Telle quelle, avec les vrais noms (seulement avec l'accord du client)</label>
                <span class="muet">Les visiteurs voient le film et peuvent la parcourir ; leurs réponses ne sont jamais enregistrées.</span>
              </div>
              ${p.vitrine_publiee ? '<button class="btn petit danger" id="demo-retirer" style="align-self:flex-start">Retirer de la vitrine</button>' : ''}
            </div>
            <button class="btn plein" id="publier">Publier l'invitation</button><div id="pub-etat" class="muet"></div>`
            : `<div class="alerte-boite">Publication automatique non configurée. Allez dans <a href="#/reglages">Réglages</a> pour relier votre dépôt GitHub (une seule fois).</div>
            <p class="muet">En attendant, vous pouvez télécharger le fichier de publication et l'envoyer à Claude.</p>`}
          <button class="btn" id="tele-pub">Télécharger le fichier de publication</button>
          <button class="btn" id="tele-projet">Sauvegarder le projet complet (.json)</button>
        </div>
      </div></div>`;
    $('#ap-gen').onclick = () => { Stock.ecrire('studio.apercu', publication(p, true)); window.open('../i/?apercu=1', '_blank'); };
    $('#ap-fam').onclick = () => { Stock.ecrire('studio.apercu', publication(p, true)); window.open('../i/?apercu=1&test=1', '_blank'); };
    $('#cp-gen').onclick = () => copier(lienGeneral(p));
    const ch = $('#cp-hote'); if (ch) ch.onclick = () => copier(lienHote(p));
    $('#tele-pub').onclick = () => telecharger(p.slug + '.json', JSON.stringify(publication(p), null, 1));
    $('#tele-projet').onclick = () => telecharger(p.slug + '-projet.json', JSON.stringify(p, null, 1));
    $('#musique').onchange = async e => {
      const brut = e.target.files[0]; if (!brut) return;
      try {
        const f = await preparerChanson(brut, t => toast(t));
        const id = 'idb:' + uid() + '.' + (f.name.split('.').pop() || 'mp3').toLowerCase();
        await IDB.mettre(id, f); p.musique = { src: id, nom: brut.name, volume: 0.8, debut: 0 }; enregistrer(p); ongletPublier(p);
      } catch (err) { toast(err.message); }
    };
    const ms = $('#musique-suppr'); if (ms) ms.onclick = () => { p.musique = null; enregistrer(p); ongletPublier(p); };
    const vol = $('#volume'); if (vol) vol.oninput = e => { p.musique.volume = Number(e.target.value); enregistrer(p); };
    const eng = new Moteur($('#scene-film'), { mode: 'rendu', resolveur: resoudre });
    moteurCourant = eng;
    // Le film est une vidéo : les boutons de réponse y sont toujours montrés (comme sur le lien général avec réponses en ligne)
    const projetFilm = () => textesPourTous(Fabrique.confirmationPourTous(p), p);
    const fn = $('#film-nom'), fpl = $('#film-places');
    [fn, fpl].forEach(x => x && x.addEventListener('change', () => { p.film = { nom: fn.value, places: fpl.value }; enregistrer(p); if (!eng.famille) eng.setProjet(projetFilm()).then(() => eng.afficherPlan(Math.max(0, p.plans.findIndex(x => x.role === 'confirmation')), 1.5)); }));
    if ($('#lv-etat')) lierLivraison(p, eng);
    eng.setProjet(projetFilm()).then(() => eng.afficherPlan(0, 0.5));
    const fp = $('#film-pour');
    if (fp) fp.onchange = () => { const f = (p.familles || []).find(x => x.code === fp.value) || null; eng.famille = f ? Object.assign({}, f) : null; eng.form = Object.assign(eng.form, { adultes: f ? Number(f.adultes) || Number(f.places) || 1 : null, enfants: f ? Number(f.enfants) || 0 : null }); eng.setProjet(f ? p : projetFilm()).then(() => eng.afficherPlan(Math.max(0, p.plans.findIndex(x => x.role !== 'ouverture')), 0.8)); };
    const ft = $('#film-transparent');
    if (ft) ft.onclick = async () => {
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return toast('Ce navigateur ne sait pas enregistrer : utilisez Chrome sur ordinateur');
      if (!p.plans.some(x => MoteurInfo.typeFond(x.fond) === 'aucun') && !confirm('Aucun plan n\'est « Sans fond » : la vidéo ne sera pas transparente. Continuer quand même ?')) return;
      ft.disabled = true; $('#film').disabled = true; $('#film-etat').textContent = 'Enregistrement en direct (laissez cet onglet ouvert)…';
      try {
        const mus = p.musique ? await resoudre(p.musique.src) : null;
        const r = await eng.exporterFilm({ transparent: true, musique: mus, debut: p.musique ? Number(p.musique.debut) || 0 : 0, volume: p.musique ? p.musique.volume : 0.8, progres: v => { $('#barre').style.width = Math.round(v * 100) + '%'; $('#film-etat').textContent = 'Vidéo sans fond… ' + Math.round(v * 100) + ' %'; } });
        telecharger(`${p.slug}-sans-fond.webm`, r.blob);
        $('#film-etat').textContent = `Vidéo sans fond prête (${Math.round(r.duree)} s, ${(r.blob.size / 1e6).toFixed(1)} Mo, WebM transparent)`;
      } catch (e) { console.error(e); $('#film-etat').textContent = 'Erreur : ' + e.message; }
      ft.disabled = false; $('#film').disabled = false;
    };
    $('#film').onclick = async () => {
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return toast('Ce navigateur ne sait pas enregistrer : utilisez Chrome sur ordinateur');
      const b = $('#film'); b.disabled = true; $('#film-etat').textContent = 'Fabrication du film…'; const t0 = Date.now();
      try {
        const mus = p.musique ? await resoudre(p.musique.src) : null;
        const r = await eng.exporterFilm({ musique: mus, debut: p.musique ? Number(p.musique.debut) || 0 : 0, volume: p.musique ? p.musique.volume : 0.8, etape: t => { $('#film-etat').textContent = t; }, progres: v => { $('#barre').style.width = Math.round(v * 100) + '%'; $('#film-etat').textContent = 'Fabrication du film… ' + Math.round(v * 100) + ' %'; } });
        telecharger(`${p.slug}-film.${r.extension}`, r.blob);
        const sec = (Date.now() - t0) / 1000;
        $('#film-etat').textContent = `Film prêt en ${dureeTexte(sec)} (film de ${Math.round(r.duree)} s, ${(r.blob.size / 1e6).toFixed(1)} Mo, ${r.extension.toUpperCase()})`;
        Equipe.noter('film', 'Film — ' + (p.fiche.titre || ''), sec, p);
        if (Equipe.actif()) {
          if (r.blob.size > 50e6) toast('Film trop lourd (plus de 50 Mo) pour être partagé avec l\'équipe');
          else {
            const envoyer = () => {
              const et = $('#film-etat'); if (!et) return; et.textContent = et.textContent.replace(/ · (envoi à l'équipe…|non partagé.*)$/, '') + ' · envoi à l\'équipe…';
              Equipe.partagerFilm(r.blob, p, sec).then(() => { const e2 = $('#film-etat'); if (e2) e2.textContent = e2.textContent.replace(' · envoi à l\'équipe…', ' · visible par toute l\'équipe ✓'); toast('Film visible par toute l\'équipe (page Équipe)'); })
                .catch(e => { const e2 = $('#film-etat'); if (!e2) return; e2.textContent = e2.textContent.replace(' · envoi à l\'équipe…', ' · non partagé (' + e.message + ') '); const bt = document.createElement('button'); bt.className = 'btn petit'; bt.textContent = 'Réessayer l\'envoi à l\'équipe'; bt.onclick = () => { bt.remove(); envoyer(); }; e2.appendChild(bt); });
            };
            envoyer();
          }
        }
      } catch (e) { console.error(e); $('#film-etat').textContent = 'Erreur : ' + e.message; }
      b.disabled = false;
    };
    const dm = $('#demo'); if (dm) dm.onchange = () => { $('#demo-opts').style.display = dm.checked ? '' : 'none'; };
    const dr = $('#demo-retirer'); if (dr) dr.onclick = async () => {
      if (!confirm('Retirer cette invitation de la vitrine du site ?')) return;
      try {
        await retirerVitrine(p.slug, p.fiche.titre);
        p.vitrine = false; p.vitrine_publiee = false; enregistrer(p); ongletPublier(p); toast('Retirée de la vitrine (visible dans quelques minutes)');
      } catch (e) { toast('Échec : ' + e.message); }
    };
    const pb = $('#publier');
    if (pb) pb.onclick = async () => {
      pb.disabled = true;
      const etat = $('#pub-etat');
      try {
        p.vitrine = $('#demo').checked;
        p.vitrine_noms = ($('input[name=demo-mode]:checked') || {}).value === 'noms';
        for (const id of [...new Set(fichiersIdb)]) {
          etat.textContent = 'Envoi de ' + id.slice(4) + '…';
          const blob = await IDB.lire(id);
          if (blob) await GitHub.envoyer('medias/' + id.slice(4), blob, 'Média ' + id.slice(4));
        }
        if (reglages.supabase) {
          etat.textContent = 'Base des invités…';
          if (!p.cle_hote) p.cle_hote = Base.cle();
          await Base.rpc(reglages.supabase, 'inv_studio_publier', { p_evt: p.id, p_cle: p.cle_hote, p_titre: p.fiche.titre || '', p_slug: p.slug, p_langue: p.fiche.langue || 'fr' });
          await syncInvites(p);
        }
        await copierFichiersEquipe(fichiersEquipe, t => { etat.textContent = t; });
        etat.textContent = 'Envoi de l\'invitation…';
        const pub = publication(p);
        await GitHub.envoyer('projets/' + p.slug + '.json', JSON.stringify(pub, null, 1), 'Invitation ' + p.fiche.titre);
        await GitHub.envoyer('projets/' + p.slug + '.js', enJS(p.slug, pub), 'Invitation ' + p.fiche.titre + ' (js)');
        if (p.vitrine) { etat.textContent = 'Mise à jour de la vitrine…'; await publierVitrine(p, pub, p.vitrine_noms, Equipe.actif() ? Equipe.membre() : ''); }
        if (p.vitrine) p.vitrine_publiee = true;
        p.publie = new Date().toISOString(); enregistrer(p);
        ongletPublier(p);
        $('#pub-etat').innerHTML = `<div class="ok-boite">Publié. Visible dans quelques minutes : <a target="_blank" href="${esc(lienGeneral(p))}">${esc(lienGeneral(p))}</a>${p.cle_hote && reglages.supabase ? '<br>Le lien organisateur est prêt (carte Liens).' : ''}</div>`;
        return;
      } catch (e) { console.error(e); etat.innerHTML = `<div class="erreur-boite">Échec : ${esc(e.message)}</div>`; }
      pb.disabled = false;
    };
  }

  /* ================= Commandes de la vitrine, démo et version finale avec licence ================= */
  const STATUTS_CMD = { nouvelle: 'Nouvelle', en_creation: 'En création', demo_envoyee: 'Démo envoyée', corrections: 'Corrections demandées', payee: 'Payée', livree: 'Livrée', annulee: 'Annulée' };
  const COULEUR_STATUT = { nouvelle: 'alerte', en_creation: '', demo_envoyee: '', corrections: 'alerte', payee: 'ok', livree: 'ok', annulee: '' };
  const CONDITIONS_DEFAUT = {
    actif: true, studio: "Studio d'invitations", whatsapp: '',
    intro: 'Choisissez un modèle, lisez les conditions, puis envoyez-nous toutes les informations : nous adaptons le modèle à votre événement et à vos couleurs.',
    formules: [
      { nom: 'Film', prix: '', contenu: 'Film vertical avec musique\nFormat WhatsApp, Facebook, TikTok' },
      { nom: 'Film + invitation', prix: '', contenu: 'Tout le film\nPage interactive : confirmation, nombre de personnes, plan, appel\nLien personnel par famille' },
      { nom: 'Complète', prix: '', contenu: 'Tout le reste\nGestion des invités et des réponses\nPlan de tables, export Excel' }
    ],
    delai: '3 à 5 jours après réception de toutes les informations et des photos',
    paiement: '50 % à la commande, le solde avant la livraison de la version finale',
    conditions: [
      'Vous recevez d\'abord une version de démonstration (marquée « DÉMO ») pour la vérifier.',
      'Deux séries de corrections sont comprises ; au-delà, sur devis.',
      'La version finale est livrée après paiement du solde, avec un code licence personnel.',
      'Licence personnelle : l\'invitation est réservée à votre événement. Elle ne peut être ni revendue, ni réutilisée pour un autre événement, ni modifiée par un tiers. En cas d\'abus, la licence est désactivée.',
      'Vous garantissez avoir les droits sur les photos et la musique que vous nous envoyez.'
    ]
  };
  let conditionsVitrine = Stock.lire('studio.vitrine.conditions', null);
  const urlSiteAbs = () => new URL(urlSite(), location.href).href;
  const lienDemo = p => urlSiteAbs() + 'i/?p=' + encodeURIComponent(p.slug + '-demo');

  // Publication d'une invitation (version finale, ou démo filigranée sans réponses)
  async function publierProjet(p, opts, etat) {
    opts = opts || {}; etat = etat || (() => {});
    const fichiersIdb = [];
    p.plans.forEach(pl => { if (/^idb:/.test((pl.fond || {}).media || '')) fichiersIdb.push(pl.fond.media); (pl.calques || []).forEach(c => { if (/^idb:/.test(c.media || '')) fichiersIdb.push(c.media); }); });
    if (p.musique && /^idb:/.test(p.musique.src)) fichiersIdb.push(p.musique.src);
    (p.polices_perso || []).forEach(x => { if (/^idb:/.test(x.src || '')) fichiersIdb.push(x.src); });
    for (const id of [...new Set(fichiersIdb)]) { etat('Envoi de ' + id.slice(4) + '…'); const blob = await IDB.lire(id); if (blob) await GitHub.envoyer('medias/' + id.slice(4), blob, 'Média ' + id.slice(4)); }
    if (!opts.demo && reglages.supabase) {
      etat('Base des invités…');
      if (!p.cle_hote) p.cle_hote = Base.cle();
      await Base.rpc(reglages.supabase, 'inv_studio_publier', { p_evt: p.id, p_cle: p.cle_hote, p_titre: p.fiche.titre || '', p_slug: p.slug, p_langue: p.fiche.langue || 'fr' });
      await syncInvites(p);
    }
    await copierFichiersEquipe(srcsEquipe(p), etat);
    etat('Envoi de l\'invitation…');
    const pub = publication(p);
    let slug = p.slug;
    if (opts.demo) {
      slug = p.slug + '-demo';
      pub.demo = { date: new Date().toISOString(), studio: (conditionsVitrine || CONDITIONS_DEFAUT).studio || '' };
      pub.liens = {}; delete pub.licence; pub.publication = Object.assign({}, pub.publication, { supabase: null, firebase: null });
    }
    await GitHub.envoyer('projets/' + slug + '.json', JSON.stringify(pub, null, 1), (opts.demo ? 'Démo ' : 'Invitation ') + p.fiche.titre);
    await GitHub.envoyer('projets/' + slug + '.js', enJS(slug, pub), (opts.demo ? 'Démo ' : 'Invitation ') + p.fiche.titre + ' (js)');
    return pub;
  }

  // Badge du menu : nombre de nouvelles commandes
  async function majBadgeCommandes() {
    const a = $('.barre nav a[data-nav="commandes"]'); if (!a) return;
    if (!Equipe.actif() || !Equipe.admin() || !reglages.supabase) { a.removeAttribute('data-n'); return; }
    try { const l = await Equipe.rpc('commandes_lire'); const n = (l || []).filter(c => c.statut === 'nouvelle').length; if (n) a.setAttribute('data-n', n); else a.removeAttribute('data-n'); } catch (e) {}
  }
  setTimeout(majBadgeCommandes, 2500); setInterval(majBadgeCommandes, 3 * 60 * 1000);

  async function vueCommandes(onglet) {
    onglet = onglet || 'liste';
    const tete = `<div class="entete"><div><h1>Commandes</h1><p>Les commandes envoyées depuis la vitrine du site, la démo puis la version finale avec licence.</p></div><div class="ligne"><a class="btn" target="_blank" href="${esc(urlSiteAbs())}#modeles">Voir la vitrine ↗</a></div></div>
      <div class="onglets">${[['liste', 'Commandes'], ['conditions', 'Conditions de la vitrine'], ['licences', 'Licences']].map(([k, n]) => `<a href="#/commandes/${k}" class="${onglet === k ? 'actif' : ''}">${n}</a>`).join('')}</div>`;
    if (!Equipe.actif() || !Equipe.admin() || !reglages.supabase) {
      $('#app').innerHTML = tete + `<div class="carte pile" style="max-width:640px"><p>Cette page est réservée à l'<b>admin de l'équipe</b> (avec la base Supabase reliée dans Réglages).</p></div>`; return;
    }
    if (onglet === 'conditions') return vueConditionsVitrine(tete);
    if (onglet === 'licences') return vueLicences(tete);
    $('#app').innerHTML = tete + `<div id="cmd-zone" class="muet">Chargement…</div>`;
    let liste = [];
    try { liste = await Equipe.rpc('commandes_lire') || []; }
    catch (err) { $('#cmd-zone').innerHTML = /function|schema cache|Could not find/i.test(err.message) ? `<div class="alerte-boite">La base des commandes n'est pas encore installée. Copiez le script et lancez-le une fois dans Supabase → SQL Editor → Run.<div class="ligne" style="margin-top:8px"><button class="btn plein" id="cmd-sql">Copier le script des commandes</button></div></div>` : 'Impossible de lire les commandes : ' + esc(err.message); const b = $('#cmd-sql'); if (b) b.onclick = async () => { copier(await (await fetch('../outils/commandes.sql?v=' + Date.now())).text()); toast('Script copié : Supabase → SQL Editor → coller → Run'); }; return; }
    const filtre = Stock.lire('studio.cmd.filtre', 'actives');
    const visibles = liste.filter(c => filtre === 'toutes' || (filtre === 'actives' ? !['livree', 'annulee'].includes(c.statut) : c.statut === filtre));
    const date = x => x ? new Date(x).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    $('#cmd-zone').classList.remove('muet');
    $('#cmd-zone').innerHTML = `<div class="ligne" style="gap:6px;flex-wrap:wrap;margin-bottom:12px"><div class="seg">${[['actives', 'En cours'], ['nouvelle', 'Nouvelles'], ['livree', 'Livrées'], ['toutes', 'Toutes']].map(([k, n]) => `<button data-cf="${k}" class="${filtre === k ? 'on' : ''}">${n} (${k === 'toutes' ? liste.length : k === 'actives' ? liste.filter(c => !['livree', 'annulee'].includes(c.statut)).length : liste.filter(c => c.statut === k).length})</button>`).join('')}</div><button class="btn petit" id="cmd-maj">Actualiser</button></div>
      ${visibles.length ? `<div class="pile">${visibles.map(c => { const d = c.details || {}, cl = c.client || {}; return `<div class="carte cmd-ligne" data-num="${esc(c.numero)}">
        <div><b>${esc(c.numero)}</b> · <span class="badge ${COULEUR_STATUT[c.statut] || ''}">${esc(STATUTS_CMD[c.statut] || c.statut)}</span><div class="muet" style="font-size:12.5px">${date(c.cree)}</div></div>
        <div><b>${esc(cl.nom || '—')}</b><div class="muet">${esc(cl.telephone || '')}</div></div>
        <div><b>${esc(d.type || '')}</b> ${esc(d.titre || '')}<div class="muet">${esc(d.date || '')} · modèle « ${esc(c.modele_titre || c.modele || '—')} » · ${esc(d.formule || '')}</div></div>
        <div class="muet">${(c.photos || []).length} fichier(s)${c.projet && projets[c.projet] ? ' · ✓ invitation créée' : ''}${c.licence ? ' · 🔑 ' + esc(c.licence) : ''}</div>
        <button class="btn petit plein" data-ouvrir="${esc(c.numero)}">Ouvrir</button></div>`; }).join('')}</div>` : '<p class="muet">Aucune commande ici. Les commandes arrivent quand un visiteur clique « Commander ce modèle » sur la vitrine.</p>'}`;
    $$('[data-cf]').forEach(b => b.onclick = () => { Stock.ecrire('studio.cmd.filtre', b.dataset.cf); vueCommandes('liste'); });
    $('#cmd-maj').onclick = () => vueCommandes('liste');
    $$('[data-ouvrir]').forEach(b => b.onclick = () => ouvrirCommande(liste.find(c => c.numero === b.dataset.ouvrir)));
    majBadgeCommandes();
  }

  function ouvrirCommande(c) {
    const d = c.details || {}, cl = c.client || {};
    const ligne = (n, v) => v ? `<tr><th>${esc(n)}</th><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>` : '';
    const urlFichier = f => reglages.supabase.url.replace(/\/+$/, '') + '/storage/v1/object/public/commandes/' + f.chemin;
    const p = c.projet && projets[c.projet];
    modale(`<h2>Commande ${esc(c.numero)}</h2>
      <div class="ligne" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><label class="champ" style="flex:0 0 220px">Statut<select id="cm-statut">${Object.entries(STATUTS_CMD).map(([k, n]) => `<option value="${k}" ${c.statut === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${cl.telephone ? `<a class="btn" target="_blank" href="https://wa.me/${telWa(cl.telephone)}?text=${encodeURIComponent('Bonjour ' + (cl.nom || '') + ', merci pour votre commande ' + c.numero + '. ')}">💬 Écrire au client (WhatsApp)</a>` : ''}</div>
      <div class="cmd-grille">
        <div><h3>Client</h3><table class="tableau cmd-table">${ligne('Nom', cl.nom)}${ligne('Téléphone / WhatsApp', cl.telephone)}${ligne('E-mail', cl.email)}</table>
          <h3>Commande</h3><table class="tableau cmd-table">${ligne('Modèle', c.modele_titre || c.modele)}${ligne('Formule', d.formule)}${ligne('Livraison souhaitée', d.livraison)}${ligne('Conditions acceptées', d.conditions_acceptees ? 'Oui, le ' + new Date(d.conditions_acceptees).toLocaleString('fr-FR') : '')}</table>
          <h3>Thème</h3><div class="ligne" style="gap:8px">${(d.couleurs || []).map(x => `<span class="pastille-cmd" style="background:${esc(x)}" title="${esc(x)}"></span>`).join('')}<span class="muet">${esc(d.ambiance || '')}</span></div></div>
        <div><h3>Événement</h3><table class="tableau cmd-table">${ligne('Type', d.type)}${ligne('Titre (Sary)', d.titre)}${ligne('Personnes célébrées', d.celebres)}${ligne('Hôtes / parents', d.hotes)}${ligne('Date', d.date)}${ligne('Heure', d.heure)}${ligne('Lieux', d.lieux)}${ligne('Date limite de réponse', d.date_limite)}${ligne('Contacts', d.contacts)}${ligne('Nombre d\'invités', d.invites)}${ligne('Langue(s)', d.langues)}${ligne('Musique', d.musique)}${ligne('Message', d.message)}</table></div>
      </div>
      ${d.texte ? `<h3>Texte de l'invitation</h3><div class="cmd-texte">${esc(d.texte).replace(/\n/g, '<br>')}</div>` : ''}
      <h3>Photos et fichiers (${(c.photos || []).length})</h3>
      <div class="cmd-photos">${(c.photos || []).map(f => /^image/.test(f.type || '') ? `<a href="${esc(urlFichier(f))}" target="_blank" download><img src="${esc(urlFichier(f))}" alt=""><span>${esc(f.nom || '')}</span></a>` : `<a href="${esc(urlFichier(f))}" target="_blank" download class="cmd-fichier">📎 ${esc(f.nom || f.chemin)}</a>`).join('') || '<p class="muet">Aucun fichier.</p>'}</div>
      <label class="champ" style="margin-top:10px">Notes internes<textarea id="cm-notes" rows="3">${esc(c.notes || '')}</textarea></label>
      <div class="cmd-actions">
        ${p ? `<a class="btn plein" href="#/p/${p.id}/plans" id="cm-aller">✎ Ouvrir l'invitation</a><a class="btn" href="#/p/${p.id}/publier" id="cm-livrer">📦 Démo et livraison</a>` : `<button class="btn plein" id="cm-creer">1. Créer l'invitation depuis le modèle « ${esc(c.modele_titre || c.modele || '')} »</button>`}
        <button class="btn" id="cm-ok">Enregistrer statut et notes</button>
      </div>`, (box, fermer) => {
      $('#cm-ok', box).onclick = async () => { try { await Equipe.rpc('commande_maj', { p_numero: c.numero, p_champs: { statut: $('#cm-statut', box).value, notes: $('#cm-notes', box).value } }); toast('Commande mise à jour'); fermer(); vueCommandes('liste'); } catch (err) { toast(err.message); } };
      const cr = $('#cm-creer', box); if (cr) cr.onclick = async () => { cr.disabled = true; cr.textContent = 'Création…'; try { const np = await creerDepuisCommande(c, t => { cr.textContent = t; }); fermer(); location.hash = '#/p/' + np.id + '/plans'; } catch (err) { toast('Échec : ' + err.message); cr.disabled = false; cr.textContent = 'Réessayer'; } };
      ['#cm-aller', '#cm-livrer'].forEach(id => { const a = $(id, box); if (a) a.addEventListener('click', () => fermer()); });
    });
  }

  // Le modèle commandé : projet de l'équipe (de préférence) ou démo publiée sur le site
  async function modeleDeCommande(c) {
    const slug = String(c.modele || '').replace(/^demo-/, '');
    const local = Object.values(projets).find(x => x.slug === slug);
    if (local) return JSON.parse(JSON.stringify(local));
    if (Equipe.actif()) {
      try { const l = await Equipe.rpc('equipe_modeles'); const t = (l || []).find(x => x.slug === slug); if (t) { const src = await Equipe.rpc('equipe_modele', { p_projet: t.projet }); if (src) return JSON.parse(JSON.stringify(src)); } } catch (e) {}
    }
    if (/^demo-/.test(c.modele || '')) {
      for (const base of [BASE, urlSite()]) { try { const r = await fetch(base + 'projets/' + encodeURIComponent(c.modele) + '.json?v=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) {} }
    }
    return null;
  }
  // Crée l'invitation du client à partir du modèle : textes, couleurs et photos du client
  async function creerDepuisCommande(c, etat) {
    etat = etat || (() => {});
    const d = c.details || {}, cl = c.client || {};
    etat('Lecture du modèle…');
    const modele = await modeleDeCommande(c);
    const texte = d.texte || [d.titre, d.celebres, d.hotes, d.date && ('Date : ' + d.date + (d.heure ? ' à ' + d.heure : '')), d.lieux, d.date_limite && ('Réponse avant le ' + d.date_limite), d.contacts].filter(Boolean).join('\n');
    const fiche = Fabrique.analyserTexte(texte);
    if (d.titre) fiche.titre = d.titre;
    if (d.type) fiche.type = d.type;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) fiche.date = d.date;
    if (/^\d{1,2}:\d{2}$/.test(d.heure || '')) fiche.heure = d.heure;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date_limite || '')) fiche.date_limite = d.date_limite;
    if (d.langues && /malgache|malagasy|mg/i.test(d.langues) && !/fran/i.test(d.langues)) fiche.langue = 'mg';
    fiche.texte_source = texte;
    // champs du formulaire : noms (« RAKOTO Hery et RASOA Fanja »), lieux (une ligne chacun), contacts (nom + numéro)
    const personne = n => { n = n.trim(); const mots = n.split(/\s+/), prenoms = mots.filter(m => !(m.length > 1 && m === m.toUpperCase())); return { nom_complet: n, surnom: (prenoms.length ? prenoms : mots).join(' ') }; };
    const noms = String(d.celebres || '').split(/\s+(?:et|sy|and)\s+|\s*[&,;\n]\s*/i).map(x => x.trim()).filter(Boolean).map(personne);
    const lieux = String(d.lieux || '').split('\n').map(x => x.replace(/^\s*(cérémonie|ceremonie|réception|reception|fiangonana|fety|lieu)\s*:\s*/i, '').trim()).filter(Boolean).map((nom, i) => ({ nom, role: i ? 'reception' : 'ceremonie', adresse: '', maps: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(nom) }));
    const contacts = (String(d.contacts || '').match(/[^\d,;\n]+[\d\s+]{8,}/g) || []).map(x => { const m = x.match(/^(.*?)([\d\s+]{8,})$/); return { nom: m[1].replace(/[:\-–]+\s*$/, '').trim(), telephone: m[2].trim() }; }).filter(k => k.nom || k.telephone);
    if (noms.length && !(fiche.hotes || []).length) fiche.hotes = noms;
    if (noms.length && /bapt|anniv|communion/i.test(d.type || '')) fiche.celebres = noms.map(n => ({ nom_complet: n.nom_complet, occasion: d.type }));
    if (lieux.length) fiche.lieux = lieux;
    if (contacts.length) fiche.contacts = contacts;
    let p;
    if (modele && modele.plans) {
      p = modele; p.id = uid(); p.slug = (fiche.titre || 'invitation').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + Math.random().toString(36).slice(2, 6);
      ['publie', 'cle_hote', 'vitrine', 'vitrine_publiee', 'vitrine_noms', 'reponses_generales', 'liens', 'publication', 'demo', 'licence', 'livraison'].forEach(k => delete p[k]);
      p.familles = []; p.historique_ia = []; p.cree = p.modifie = new Date().toISOString();
      // remplacer les informations du modèle par celles du client, dans tous les textes
      etat('Textes du client…');
      const ancien = modele.fiche || {}, L = fiche.langue || ancien.langue || 'fr', paires = [];
      const ajout = (a, b) => { a = String(a || '').trim(); b = String(b || '').trim(); if (a.length > 1 && b && a !== b) paires.push([a, b]); };
      ajout(ancien.titre, fiche.titre);
      (ancien.hotes || []).forEach((h, i) => { const n = (fiche.hotes || [])[i]; if (n) { ajout(h.nom_complet, n.nom_complet); ajout(h.surnom, n.surnom || n.nom_complet); } });
      const celebresVus = new Set();
      (ancien.celebres || []).forEach((h, i) => { if (celebresVus.has(h.nom_complet)) return; celebresVus.add(h.nom_complet); const n = (fiche.celebres || [])[i] || ((ancien.hotes || []).length ? null : noms[i]); if (n) ajout(h.nom_complet, n.nom_complet); });
      (ancien.lieux || []).forEach((l, i) => { const n = (fiche.lieux || [])[i]; if (n) ajout(l.nom, n.nom); });
      (ancien.contacts || []).forEach((k, i) => { const n = (fiche.contacts || [])[i]; if (n) { ajout(k.nom, n.nom); ajout(k.telephone, n.telephone); } });
      if (ancien.date && fiche.date) { ajout(MoteurInfo.dateLisible(ancien.date, L), MoteurInfo.dateLisible(fiche.date, L)); ajout(MoteurInfo.dateLisible(ancien.date, 'fr'), MoteurInfo.dateLisible(fiche.date, 'fr')); }
      if (ancien.date_limite && fiche.date_limite) ajout(MoteurInfo.dateLisible(ancien.date_limite, L), MoteurInfo.dateLisible(fiche.date_limite, L));
      if (ancien.heure && fiche.heure) ajout(ancien.heure, fiche.heure);
      paires.sort((a, b) => b[0].length - a[0].length);
      const remplacer = t => paires.reduce((s, [a, b]) => s.split(a).join(b), String(t || ''));
      let nb = 0;
      p.plans.forEach(pl => (pl.calques || []).forEach(x => { if (typeof x.texte === 'string') { const n = remplacer(x.texte); if (n !== x.texte) nb++; x.texte = n; } if (x.trad) Object.keys(x.trad).forEach(k => { x.trad[k] = remplacer(x.trad[k]); }); }));
      p.fiche = Object.assign({}, ancien, fiche, { phrases: fiche.phrases && fiche.phrases.length ? fiche.phrases : ancien.phrases });
      p.adaptation = { remplacements: paires.length, textes: nb };
    } else {
      p = Fabrique.nouveauProjet(fiche, tousFonds());
    }
    // couleurs du client : la couleur principale et l'accent du modèle prennent les siennes
    const [c1, c2] = (d.couleurs || []).filter(x => /^#[0-9a-f]{6}$/i.test(x));
    if (c1) {
      etat('Couleurs du client…');
      const vieux1 = String((p.style && p.style.couleur) || '#7a1f2b').toLowerCase(), vieux2 = String((p.style && p.style.couleur2) || '').toLowerCase();
      const map = { [vieux1]: c1 }; if (c2 && vieux2) map[vieux2] = c2;
      const conv = v => (typeof v === 'string' && map[v.toLowerCase()]) || v;
      p.plans.forEach(pl => (pl.calques || []).forEach(x => { ['couleur', 'bordure', 'contour', 'fond_couleur', 'ombre_couleur'].forEach(k => { if (x[k]) x[k] = conv(x[k]); }); if (x.illu) { x.illu.c = conv(x.illu.c); x.illu.a = conv(x.illu.a); if (window.Illustrations) x.media = Illustrations.dataUrl(x.illu.id, x.illu.c, x.illu.a); } }));
      p.style = Object.assign({}, p.style, { couleur: c1 }, c2 ? { couleur2: c2 } : {});
    }
    // photos du client : rangées dans la bibliothèque de l'événement, et posées à la place des photos du modèle
    const photos = (c.photos || []).filter(f => /^image/.test(f.type || ''));
    const importees = [];
    for (const [k, f] of photos.entries()) {
      etat(`Photo ${k + 1}/${photos.length}…`);
      try { const r = await fetch(reglages.supabase.url.replace(/\/+$/, '') + '/storage/v1/object/public/commandes/' + f.chemin); if (!r.ok) continue; const b = await r.blob(); const fi = new File([b], f.nom || ('photo-' + (k + 1) + '.jpg'), { type: b.type || f.type }); importees.push(await importerFichier(fi, 'image', p.id)); } catch (e) {}
    }
    if (importees.length) sauverMedias();
    let posees = 0;
    p.plans.forEach(pl => (pl.calques || []).forEach(x => { if (x.type === 'image' && !x.illu && importees[posees]) { x.media = importees[posees].src; delete x.recadrage; posees++; } }));
    p.commande = c.numero; p.client = { nom: cl.nom || '', telephone: cl.telephone || '', email: cl.email || '' };
    p.livraison = { etape: 'creation' };
    projets[p.id] = p; sauverProjets();
    try { await Equipe.rpc('commande_maj', { p_numero: c.numero, p_champs: { statut: 'en_creation', projet: p.id } }); } catch (e) {}
    toast(`Invitation créée depuis le modèle : ${p.adaptation ? p.adaptation.textes + ' texte(s) adapté(s), ' : ''}${importees.length} photo(s) dans la bibliothèque${posees ? ' (' + posees + ' posée(s))' : ''}${c1 ? ', couleurs du client appliquées' : ''}. Vérifiez chaque plan.`);
    return p;
  }

  // Carte « Livraison au client » (onglet Film et publication)
  function carteLivraison(p) {
    const L = p.livraison || {};
    const pret = reglages.github && reglages.github.token;
    return `<div class="carte pile carte-livraison"><h3>📦 Livraison au client${p.commande ? ' · commande ' + esc(p.commande) : ''}</h3>
      <div class="deux"><label class="champ">Client<input type="text" id="lv-nom" value="${esc((p.client || {}).nom || '')}" placeholder="Nom du client"></label><label class="champ">WhatsApp du client<input type="text" id="lv-tel" value="${esc((p.client || {}).telephone || '')}" placeholder="034 00 000 00"></label></div>
      <ol class="etat-liste">
        <li class="${L.demo ? 'fait' : ''}"><b>Démo</b> : invitation marquée « DÉMO », réponses désactivées, pour validation. ${L.demo ? '✓ envoyée le ' + esc(new Date(L.demo).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : ''}
          <div class="ligne" style="gap:6px;margin-top:6px;flex-wrap:wrap"><button class="btn petit plein" id="lv-demo" ${pret ? '' : 'disabled'}>${L.demo ? 'Republier la démo' : 'Publier la démo'}</button><button class="btn petit" id="lv-film-demo">🎬 Film démo (filigrane)</button>${L.demo ? `<a class="btn petit" target="_blank" href="${esc(lienDemo(p))}">Voir la démo ↗</a><button class="btn petit" id="lv-wa-demo">💬 Envoyer la démo au client</button>` : ''}</div></li>
        <li class="${L.finale ? 'fait' : ''}"><b>Version finale</b> : sans filigrane, réponses enregistrées dans la base, avec un <b>code licence</b> personnel (l'invitation ne marche que pour cet événement ; la licence peut être désactivée). ${p.licence ? '🔑 ' + esc(p.licence.code) : ''}
          <label class="cases" style="margin-top:6px"><input type="checkbox" id="lv-paye" ${L.paye ? 'checked' : ''}> Paiement reçu</label>
          <div class="ligne" style="gap:6px;margin-top:6px;flex-wrap:wrap"><button class="btn petit plein" id="lv-finale" ${pret && reglages.supabase && Equipe.admin() ? '' : 'disabled'}>${L.finale ? 'Republier la version finale' : 'Livrer la version finale'}</button>${L.finale ? '<button class="btn petit" id="lv-wa-finale">💬 Envoyer la version finale au client</button>' : ''}</div>
          ${Equipe.admin() ? '' : '<div class="muet">La licence est créée par l\'admin de l\'équipe.</div>'}</li>
      </ol><div class="muet" id="lv-etat"></div></div>`;
  }
  function lierLivraison(p, eng) {
    const etat = t => { const e = $('#lv-etat'); if (e) e.textContent = t; };
    const client = () => { p.client = Object.assign({}, p.client, { nom: $('#lv-nom').value.trim(), telephone: $('#lv-tel').value.trim() }); enregistrer(p); return p.client; };
    ['#lv-nom', '#lv-tel'].forEach(id => { const e = $(id); if (e) e.onchange = client; });
    const statut = s => { if (p.commande && Equipe.admin()) Equipe.rpc('commande_maj', { p_numero: p.commande, p_champs: Object.assign({ statut: s, projet: p.id }, p.licence ? { licence: p.licence.code } : {}) }).catch(() => {}); };
    const wa = (msg) => { const cl = client(); if (!cl.telephone) return toast('Indiquez le WhatsApp du client'); window.open('https://wa.me/' + telWa(cl.telephone) + '?text=' + encodeURIComponent(msg), '_blank'); };
    const b1 = $('#lv-demo'); if (b1) b1.onclick = async () => { b1.disabled = true; try { await publierProjet(p, { demo: true }, etat); p.livraison = Object.assign({}, p.livraison, { demo: new Date().toISOString() }); enregistrer(p); statut('demo_envoyee'); etat('Démo publiée (visible dans quelques minutes) : ' + lienDemo(p)); ongletPublier(p); toast('Démo publiée'); } catch (err) { etat('Échec : ' + err.message); b1.disabled = false; } };
    const bf = $('#lv-film-demo'); if (bf) bf.onclick = async () => {
      bf.disabled = true; etat('Film démo…');
      try { eng.filigrane = 'DÉMO'; const mus = p.musique ? await resoudre(p.musique.src) : null; const r = await eng.exporterFilm({ musique: mus, debut: p.musique ? Number(p.musique.debut) || 0 : 0, volume: p.musique ? p.musique.volume : 0.8, etape: etat, progres: v => etat('Film démo… ' + Math.round(v * 100) + ' %') }); telecharger(p.slug + '-DEMO.' + r.extension, r.blob); etat('Film démo prêt (marqué DÉMO), à envoyer au client pour validation.'); }
      catch (err) { etat('Erreur : ' + err.message); } eng.filigrane = null; bf.disabled = false;
    };
    const w1 = $('#lv-wa-demo'); if (w1) w1.onclick = () => wa(`Bonjour ${client().nom || ''}, voici la version de démonstration de votre invitation « ${p.fiche.titre} » : ${lienDemo(p)}\nElle est marquée « DÉMO » et les réponses n'y sont pas enregistrées. Dites-nous si tout vous convient ou ce qu'il faut corriger. La version finale vous sera envoyée après le paiement du solde.`);
    const pa = $('#lv-paye'); if (pa) pa.onchange = () => { p.livraison = Object.assign({}, p.livraison, { paye: pa.checked }); enregistrer(p); if (pa.checked) statut('payee'); };
    const b2 = $('#lv-finale'); if (b2) b2.onclick = async () => {
      if (!$('#lv-paye').checked && !confirm('Le paiement n\'est pas coché comme reçu. Livrer quand même la version finale ?')) return;
      const cl = client(); b2.disabled = true;
      try {
        etat('Création de la licence…');
        const code = await Equipe.rpc('licence_creer', { p_evt: p.id, p_client: cl.nom || p.fiche.titre || '', p_commande: p.commande || '' });
        p.licence = { code, client: cl.nom || '', date: new Date().toISOString() };
        await publierProjet(p, {}, etat);
        p.publie = new Date().toISOString(); p.livraison = Object.assign({}, p.livraison, { finale: new Date().toISOString() }); enregistrer(p); statut('livree');
        etat('Version finale publiée avec la licence ' + code + '.'); ongletPublier(p); toast('Version finale livrée · licence ' + code);
      } catch (err) { etat('Échec : ' + err.message); b2.disabled = false; }
    };
    const w2 = $('#lv-wa-finale'); if (w2) w2.onclick = () => wa(`Bonjour ${client().nom || ''}, voici la version finale de votre invitation « ${p.fiche.titre} ».\n\n• Lien à envoyer à vos invités : ${lienGeneral(p)}\n• Votre espace organisateur (gardez-le pour vous) : ${lienHote(p) || '—'}\n\nCode licence : ${p.licence ? p.licence.code : ''}\nLicence personnelle : cette invitation est réservée à votre événement ; elle ne peut être ni revendue, ni réutilisée pour un autre événement. Merci pour votre confiance !`);
  }

  // Conditions et formules affichées sur la vitrine (fichier vitrine/conditions.json du site)
  async function vueConditionsVitrine(tete) {
    if (!conditionsVitrine) { try { const r = await fetch(urlSite() + 'vitrine/conditions.json?v=' + Date.now(), { cache: 'no-store' }); if (r.ok) conditionsVitrine = await r.json(); } catch (e) {} }
    const c = Object.assign({}, CONDITIONS_DEFAUT, conditionsVitrine || {});
    $('#app').innerHTML = tete + `<div class="ia-grille"><div class="carte pile">
      <label class="cases"><input type="checkbox" id="cv-actif" ${c.actif !== false ? 'checked' : ''}> Commandes ouvertes sur la vitrine (bouton « Commander ce modèle »)</label>
      <div class="deux"><label class="champ">Nom du studio<input type="text" id="cv-studio" value="${esc(c.studio || '')}"></label><label class="champ">WhatsApp du studio<input type="text" id="cv-wa" value="${esc(c.whatsapp || '')}" placeholder="034 00 000 00"></label></div>
      <label class="champ">Présentation<textarea id="cv-intro" rows="2">${esc(c.intro || '')}</textarea></label>
      <b>Formules et prix</b>${(c.formules || []).map((f, i) => `<div class="cv-formule"><div class="deux"><label class="champ">Nom<input type="text" data-fn="${i}" value="${esc(f.nom)}"></label><label class="champ">Prix (vide = sur devis)<input type="text" data-fp="${i}" value="${esc(f.prix || '')}" placeholder="ex. 150 000 Ar"></label></div><label class="champ">Contenu (une ligne par point)<textarea data-fc="${i}" rows="3">${esc(f.contenu || '')}</textarea></label></div>`).join('')}
      <label class="champ">Délai de réalisation<input type="text" id="cv-delai" value="${esc(c.delai || '')}"></label>
      <label class="champ">Paiement<input type="text" id="cv-paiement" value="${esc(c.paiement || '')}"></label>
      <label class="champ">Conditions (une par ligne) — le client doit les accepter avant de commander<textarea id="cv-cond" rows="8">${esc((c.conditions || []).join('\n'))}</textarea></label>
      <div class="ligne"><button class="btn plein" id="cv-pub">Publier sur la vitrine</button><span class="muet" id="cv-etat"></span></div>
    </div><div class="carte pile"><h3>Comment ça marche</h3><ol class="muet">
      <li>Le visiteur regarde un modèle sur la vitrine, clique « Commander ce modèle ».</li>
      <li>Il lit ces conditions et les accepte, puis remplit le formulaire (événement, texte, couleurs, photos…).</li>
      <li>La commande arrive ici (onglet Commandes) avec un numéro ; le client reçoit le numéro et peut vous écrire sur WhatsApp.</li>
      <li>Vous créez l'invitation depuis le modèle, vous l'adaptez, vous envoyez la <b>démo</b>, puis la <b>version finale</b> avec sa licence.</li></ol>
      <p class="muet">La base des commandes doit être installée une fois : <button class="btn petit" id="cv-sql">Copier le script des commandes</button> → Supabase → SQL Editor → Run.</p></div></div>`;
    $('#cv-sql').onclick = async () => { copier(await (await fetch('../outils/commandes.sql?v=' + Date.now())).text()); toast('Script copié : Supabase → SQL Editor → coller → Run'); };
    $('#cv-pub').onclick = async () => {
      const n = {
        actif: $('#cv-actif').checked, studio: $('#cv-studio').value.trim(), whatsapp: $('#cv-wa').value.trim(), intro: $('#cv-intro').value.trim(),
        formules: (c.formules || []).map((f, i) => ({ nom: $(`[data-fn="${i}"]`).value.trim(), prix: $(`[data-fp="${i}"]`).value.trim(), contenu: $(`[data-fc="${i}"]`).value.trim() })).filter(f => f.nom),
        delai: $('#cv-delai').value.trim(), paiement: $('#cv-paiement').value.trim(), conditions: $('#cv-cond').value.split('\n').map(x => x.trim()).filter(Boolean),
        supabase: reglages.supabase ? { url: reglages.supabase.url, anon: reglages.supabase.anon } : null, maj: new Date().toISOString()
      };
      conditionsVitrine = n; Stock.ecrire('studio.vitrine.conditions', n);
      const g = reglages.github || {}; if (!(g.owner && g.repo && g.token)) return toast('Enregistré ici ; reliez GitHub dans Réglages pour publier sur le site');
      $('#cv-etat').textContent = 'Publication…';
      try { await GitHub.envoyer('vitrine/conditions.json', JSON.stringify(n, null, 1), 'Vitrine : conditions et formules'); $('#cv-etat').textContent = 'Publié : visible sur la vitrine dans quelques minutes.'; } catch (err) { $('#cv-etat').textContent = 'Échec : ' + err.message; }
    };
  }

  async function vueLicences(tete) {
    $('#app').innerHTML = tete + '<div id="lic-zone" class="muet">Chargement…</div>';
    let l = []; try { l = await Equipe.rpc('licences_lire') || []; } catch (err) { $('#lic-zone').textContent = 'Impossible de lire les licences : ' + err.message; return; }
    const nomEvt = id => projets[id] ? projets[id].fiche.titre : id;
    $('#lic-zone').classList.remove('muet');
    $('#lic-zone').innerHTML = `<p class="muet">Une licence par invitation livrée. Désactivée, l'invitation affiche « invitation non active » à la place du film.</p>
      <div class="tableau-boite"><table class="tableau"><thead><tr><th>Code</th><th>Client</th><th>Invitation</th><th>Commande</th><th>Créée</th><th>Statut</th><th></th></tr></thead><tbody>${l.map(x => `<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.client)}</td><td>${esc(nomEvt(x.evt))}</td><td>${esc(x.commande || '')}</td><td>${esc(new Date(x.cree).toLocaleDateString('fr-FR'))}</td><td><span class="badge ${x.statut === 'active' ? 'ok' : 'alerte'}">${esc(x.statut)}</span></td><td>${x.statut === 'active' ? `<button class="btn petit danger" data-lic="${esc(x.code)}" data-st="suspendue">Désactiver</button>` : `<button class="btn petit" data-lic="${esc(x.code)}" data-st="active">Réactiver</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="muet">Aucune licence pour l\'instant.</td></tr>'}</tbody></table></div>`;
    $$('[data-lic]').forEach(b => b.onclick = async () => { if (b.dataset.st !== 'active' && !confirm('Désactiver la licence ' + b.dataset.lic + ' ? L\'invitation ne s\'affichera plus.')) return; try { await Equipe.rpc('licence_changer', { p_code: b.dataset.lic, p_statut: b.dataset.st }); toast('Licence mise à jour'); vueLicences(tete); } catch (err) { toast(err.message); } });
  }

  // Jeton GitHub expiré ou supprimé : petite fenêtre pour coller le nouveau, sans quitter ce qu'on fait
  let demandeJeton = null;
  // Film pour tout le monde : les textes réservés au lien personnel s'affichent avec un nom et un nombre généraux
  function nomFilmDefaut(p) { const l = (p.fiche || {}).langue; return l === 'mg' ? 'havana sy namana' : l === 'en' ? 'our guests' : 'nos invités'; }
  function textesPourTous(d, p) {
    const nom = ((p.film || {}).nom != null ? p.film.nom : nomFilmDefaut(p)).trim(), places = String((p.film || {}).places || '').trim();
    const general = { fr: 'Nous avons la joie de vous inviter', mg: 'Manasa anao am-pitiavana', en: 'We are delighted to invite you' };
    const adapter = t => {
      if (!t) return t;
      if (nom && /^[a-zà-ÿ]/.test(nom)) t = t.replace(/an'i \{famille\}/gi, "an'ny {famille}").replace(/Ho an'i\s*$/i, "Ho an'ny");
      t = t.replace(/\{famille\}/g, nom);
      if (t.includes('{places}')) {
        if (places) t = t.replace(/\{places\}/g, places);
        else if (/^Nous invitons \{places\} personnes$/i.test(t.trim())) t = general.fr;
        else if (/^Manasa olona \{places\}$/i.test(t.trim())) t = general.mg;
        else if (/^We are inviting \{places\} people$/i.test(t.trim())) t = general.en;
        else t = t.replace(/\s*\{places\}\s*/g, ' ').trim();
      }
      return t;
    };
    (d.plans || []).forEach(pl => (pl.calques || []).forEach(c => {
      if (c.condition !== 'famille' || c.type !== 'texte' || c.masque) return;
      c.condition = ''; c.texte = adapter(c.texte);
      if (c.trad) Object.keys(c.trad).forEach(k => { c.trad[k] = adapter(c.trad[k]); });
    }));
    return d;
  }
  function demanderJeton() {
    if (demandeJeton) return demandeJeton;
    demandeJeton = new Promise(fin => {
      const b = document.createElement('div'); b.id = 'boite-jeton';
      b.innerHTML = `<div class="bj-carte"><h3>Jeton GitHub refusé</h3><p class="muet">GitHub n'accepte plus le jeton enregistré (il a expiré ou a été supprimé). Créez-en un nouveau : <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">page de création du jeton ↗</a> (dépôt <b>${esc((reglages.github || {}).repo || 'STUDIO')}</b>, droit « Contents : Read and write », expiration longue), puis collez-le ici.</p>
        <input type="password" id="bj-jeton" placeholder="github_pat_…" autocomplete="off"><div class="ligne" style="margin-top:10px;justify-content:space-between"><button class="btn" id="bj-non">Annuler</button><span class="muet" id="bj-etat"></span><button class="btn plein" id="bj-ok">Enregistrer et continuer</button></div></div>`;
      document.body.appendChild(b); setTimeout(() => $('#bj-jeton').focus(), 50);
      const finir = ok => { b.remove(); demandeJeton = null; fin(ok); };
      $('#bj-non').onclick = () => finir(false);
      $('#bj-ok').onclick = async () => {
        const t = $('#bj-jeton').value.trim(); if (!t) return;
        $('#bj-etat').textContent = 'Vérification…';
        try {
          const g = reglages.github || {};
          const r = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}`, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' } });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { $('#bj-etat').textContent = 'Refusé : ' + (j.message || r.status); return; }
          if (j.permissions && !j.permissions.push) { $('#bj-etat').textContent = 'Ce jeton ne peut pas écrire dans le dépôt'; return; }
          reglages.github = Object.assign({}, g, { token: t }); sauverReglages(); toast('Nouveau jeton enregistré'); finir(true);
        } catch (err) { $('#bj-etat').textContent = 'Échec : ' + err.message; }
      };
    });
    return demandeJeton;
  }

  /* ================= GitHub (publication sans serveur) ================= */
  const GitHub = {
    // Toujours relire le jeton enregistré (il a pu être changé dans un autre onglet)
    frais() { const r = Stock.lire('studio.reglages', null); if (r && r.github && r.github.token) reglages.github = r.github; return reglages.github || {}; },
    erreur(statut, texte) {
      if (statut === 401) return new Error('Jeton GitHub refusé (expiré ou supprimé). Allez dans Réglages → GitHub, collez un nouveau jeton puis « Tester ». ');
      if (statut === 403 || statut === 404) return new Error('GitHub ' + statut + ' : le jeton n\'a pas le droit d\'écrire dans ' + (reglages.github.owner || '') + '/' + (reglages.github.repo || '') + ' (droit « Contents : Read and write » nécessaire).');
      return new Error('GitHub ' + statut + ' : ' + texte.slice(0, 160));
    },
    api(chemin) { const g = this.frais(); return `https://api.github.com/repos/${g.owner}/${g.repo}/contents/${chemin.split('/').map(encodeURIComponent).join('/')}`; },
    entetes() { return { Authorization: 'Bearer ' + (this.frais().token || '').trim(), Accept: 'application/vnd.github+json' }; },
    // appel à GitHub ; jeton refusé (401) → on demande le nouveau jeton sur place, puis on réessaie
    async appel(url, opts) {
      let r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, this.entetes(), (opts || {}).headers) }));
      if (r.status === 401 && await demanderJeton()) r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, this.entetes(), (opts || {}).headers) }));
      return r;
    },
    async sha(chemin) {
      const r = await this.appel(this.api(chemin) + '?ref=' + encodeURIComponent(reglages.github.branche || 'main') + '&t=' + Date.now(), { cache: 'no-store' });
      if (r.status === 404) return null;
      if (!r.ok) throw this.erreur(r.status, await r.text());
      return (await r.json()).sha;
    },
    async lireTexte(chemin) {
      const r = await this.appel(this.api(chemin) + '?ref=' + encodeURIComponent(reglages.github.branche || 'main') + '&t=' + Date.now(), { headers: { Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
      if (r.status === 404) throw new Error('absent');
      if (!r.ok) throw this.erreur(r.status, await r.text());
      return r.text();
    },
    async base64(contenu) {
      const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: 'text/plain' });
      return new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
    },
    async envoyer(chemin, contenu, message) {
      const content = await this.base64(contenu);
      // GitHub peut répondre avec un temps de retard : on réessaie (avec le bon « sha ») si besoin
      for (let essai = 0; ; essai++) {
        const sha = await this.sha(chemin);
        const corps = { message, content, branch: reglages.github.branche || 'main' };
        if (sha) corps.sha = sha;
        const r = await this.appel(this.api(chemin), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
        if (r.ok) return r.json();
        const texte = await r.text();
        if ((r.status === 409 || r.status === 422) && essai < 4) { await new Promise(ok => setTimeout(ok, 1500 * (essai + 1))); continue; }
        throw this.erreur(r.status, texte);
      }
    }
  };

  /* ================= Bibliothèque ================= */
  function vueBibliotheque() {
    // Choix de l'événement : chaque événement a ses propres fonds, photos et vidéos
    const liste = Object.values(projets).sort((x, y) => (y.maj || '').localeCompare(x.maj || ''));
    let evt = Stock.lire('studio.bib.evt', liste[0] ? liste[0].id : '');
    if (evt && evt !== '*' && !projets[evt]) evt = liste[0] ? liste[0].id : '';
    const titre = id => id ? ((projets[id] && projets[id].fiche && projets[id].fiche.titre) || 'Événement supprimé') : 'Commun à tous les événements';
    const garde = m => evt === '*' || (m.evt || '') === evt;
    const fondsEvt = medias.filter(m => m.type === 'fond' && garde(m));
    const autres = medias.filter(m => m.type !== 'fond' && garde(m));
    const choixEvt = m => `<label class="champ">Événement<select data-k="evt">${[['', 'Commun à tous']].concat(liste.map(x => [x.id, (x.fiche && x.fiche.titre) || x.id])).map(([v, t]) => `<option value="${esc(v)}" ${(m.evt || '') === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    const carteFond = f => `
        <div class="carte pile" data-id="${f.id}" style="padding:12px">
          <video src="" data-src="${esc(f.src)}" muted loop playsinline style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;background:#eee" poster="${esc(/^data:/.test(f.vignette) ? f.vignette : BASE + f.vignette)}"></video>
          <button class="btn petit" data-dl="${esc(f.src)}" data-dl-nom="${esc(f.nom)}" title="Enregistrer le fichier sur cet ordinateur">⬇ Télécharger</button>
          ${f.src.startsWith('idb:') ? `
            <input type="text" data-k="nom" value="${esc(f.nom)}">
            ${f.brouillon ? `<div class="ligne"><span class="badge alerte">Brouillon</span><button class="btn petit plein" data-garder="${f.id}">Garder</button></div>` : ''}
            ${f.secondes_creation ? `<span class="badge">⏱ créé en ${dureeTexte(f.secondes_creation)}</span>` : ''}
            ${Equipe.actif() ? (f.equipe_id ? '<span class="badge ok">👥 partagé avec l\'équipe</span>' : f.brouillon ? '' : `<button class="btn petit" data-partager="${f.id}">Partager avec l'équipe</button>`) : ''}
            ${evt === '*' ? `<span class="badge">${esc(titre(f.evt))}</span>` : ''}
            <details><summary class="muet" style="cursor:pointer">Réglages</summary><div class="pile" style="margin-top:6px">
            ${choixEvt(f)}
            <label class="champ">Usage conseillé<select data-k="usage">${['ouverture', 'titre', 'programme', 'confirmation', 'remerciement'].map(u => `<option ${f.usage === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
            <label class="champ">Description (pour l'IA)<input type="text" data-k="description" value="${esc(f.description || '')}"></label>
            <button class="btn petit danger" data-suppr="${f.id}">Supprimer</button></div></details>`
            : `<b>${esc(f.nom)}</b><div class="muet">${esc(f.usage)} · ${f.duree} s · fond de base</div>`}
        </div>`;
    $('#app').innerHTML = `<div class="entete"><div><h1>Bibliothèque</h1><p>Chaque événement a ses fonds, ses photos et ses vidéos animées. Les fonds de base servent à tous.</p></div>
      <div class="ligne"><button class="btn ia" id="bib-creer">✨ Créer avec l'IA</button><label class="btn plein">+ Importer un fond vidéo<input type="file" id="imp-fond" accept="video/*" multiple hidden></label><label class="btn">+ Photo ou vidéo<input type="file" id="imp-media" accept="image/*,video/*" multiple hidden></label></div></div>
      <div class="ligne bib-evt"><b>Événement</b><select id="bib-evt">
        ${liste.map(x => `<option value="${x.id}" ${evt === x.id ? 'selected' : ''}>${esc((x.fiche && x.fiche.titre) || x.id)}</option>`).join('')}
        <option value="" ${evt === '' ? 'selected' : ''}>Commun à tous les événements</option>
        <option value="*" ${evt === '*' ? 'selected' : ''}>Tout afficher</option></select>
        <span class="muet">Les fichiers importés ici sont rangés dans ${evt === '*' ? 'les fichiers communs' : esc(evt ? '« ' + titre(evt) + ' »' : 'les fichiers communs')}. Ceux créés dans un plan (fond IA, image animée) vont dans leur événement.</span></div>
      <h3>Fonds vidéo ${evt === '*' ? '' : evt ? 'de cet événement' : 'communs'} <span class="muet" style="font-weight:400">(${fondsEvt.length})</span></h3>
      ${fondsEvt.length ? `<div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">${fondsEvt.map(carteFond).join('')}</div>` : '<p class="muet">Aucun fond ici pour l\'instant. Créez-en un depuis un plan (✨ Créer un fond sur mesure) ou importez-en un.</p>'}
      <h3 style="margin-top:24px">Photos et vidéos ${evt === '*' ? '' : evt ? 'de cet événement' : 'communes'} <span class="muet" style="font-weight:400">(${autres.length})</span></h3>
      ${autres.length ? `<div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">${autres.map(m => `<div class="carte pile" data-id="${m.id}" style="padding:10px">
        ${m.type === 'video' ? `<video src="" data-src="${esc(m.src)}" muted loop playsinline poster="${esc(m.vignette)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:#eee"></video>` : `<img src="${esc(m.vignette)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px">`}
        <b style="font-size:13px">${esc(m.nom)}</b><button class="btn petit" data-dl="${esc(m.src)}" data-dl-nom="${esc(m.nom)}" title="Enregistrer le fichier sur cet ordinateur">⬇ Télécharger</button>${m.anime ? '<span class="badge">image animée</span>' : ''}${m.secondes_creation ? `<span class="badge">⏱ ${dureeTexte(m.secondes_creation)}</span>` : ''}${Equipe.actif() && m.anime && !m.brouillon ? (m.equipe_id ? '<span class="badge ok">👥 partagé</span>' : `<button class="btn petit" data-partager="${m.id}">Partager avec l'équipe</button>`) : ''}${m.brouillon ? `<div class="ligne"><span class="badge alerte">Brouillon</span><button class="btn petit plein" data-garder="${m.id}">Garder</button></div>` : ''}${evt === '*' ? `<span class="badge">${esc(titre(m.evt))}</span>` : ''}
        <details><summary class="muet" style="cursor:pointer">Réglages</summary><div class="pile" style="margin-top:6px">${choixEvt(m)}<button class="btn petit danger" data-suppr="${m.id}">Supprimer</button></div></details></div>`).join('')}</div>` : '<p class="muet">Aucune photo ou vidéo ici.</p>'}
      ${Equipe.actif() ? `<h3 style="margin-top:24px">👥 Bibliothèque de l'équipe « ${esc(reglages.equipe.nom)} » <span class="muet" style="font-weight:400">(${Equipe.items.length} · visible et utilisable par tous)</span> <button class="btn petit" id="eq-actualiser">Actualiser</button></h3>
        ${Equipe.items.filter(x => x.type !== 'film').length ? `<div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${Equipe.items.filter(x => x.type !== 'film').map(x => `<div class="carte pile" style="padding:10px">
          ${x.type === 'image' ? `<img src="${esc(Equipe.url(x.chemin))}" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px">` : `<video src="" data-src="${esc(Equipe.url(x.chemin))}" muted loop playsinline poster="${esc(x.vignette || '')}" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;background:#eee"></video>`}
          <b style="font-size:13px">${esc(x.nom)}</b><div class="muet" style="font-size:12px">par <b>${esc(x.auteur || '—')}</b>${x.evenement ? ' · ' + esc(x.evenement) : ''}</div>
          ${x.secondes_creation ? `<span class="badge">⏱ créé en ${dureeTexte(x.secondes_creation)}</span>` : ''}
          ${x.type === 'fond' ? '' : '<span class="badge">' + (x.type === 'video' ? 'image animée' : x.type) + '</span>'}
          <button class="btn petit" data-dl="${esc(Equipe.url(x.chemin))}" data-dl-nom="${esc(x.nom)}" title="Enregistrer le fichier sur cet ordinateur">⬇ Télécharger</button>
          ${Equipe.admin() || x.auteur === Equipe.membre() ? `<button class="btn petit danger" data-eq-suppr="${esc(x.id)}">Retirer de l'équipe</button>` : ''}</div>`).join('')}</div>` : '<p class="muet">Encore rien de partagé. Vos nouveaux fonds le seront automatiquement ; « Partager » sur un fond existant, ou Réglages → « Partager tous mes fonds existants ».</p>'}` : ''}
      <h3 style="margin-top:24px">Fonds de base <span class="muet" style="font-weight:400">(pour tous les événements)</span></h3>
      <div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${Fabrique.FONDS.map(carteFond).join('')}</div>
      <p class="muet" style="margin-top:20px">Les fichiers importés restent dans ce navigateur jusqu'à la publication, qui les envoie sur GitHub.</p>`;
    // Télécharger un fond / une photo / une vidéo de la bibliothèque
    $$('[data-dl]').forEach(b => b.onclick = async () => {
      const src = b.dataset.dl, nom = (b.dataset.dlNom || 'fond').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'fond';
      const t = b.textContent; b.disabled = true; b.textContent = 'Téléchargement…';
      try {
        const u = await resoudre(src); const r = await fetch(u); if (!r.ok) throw new Error('fichier introuvable (' + r.status + ')');
        const blob = await r.blob();
        const ext = (src.split('?')[0].match(/\.(\w{2,4})$/) || [])[1] || (/webm/.test(blob.type) ? 'webm' : /quicktime/.test(blob.type) ? 'mov' : /png/.test(blob.type) ? 'png' : /jpe?g/.test(blob.type) ? 'jpg' : /webp/.test(blob.type) ? 'webp' : 'mp4');
        telecharger(nom + '.' + ext.toLowerCase(), blob); toast('« ' + nom + ' » téléchargé');
      } catch (err) { toast('Téléchargement impossible : ' + err.message); }
      b.disabled = false; b.textContent = t;
    });
    $$('[data-garder]').forEach(b => b.onclick = () => { const m = medias.find(x => x.id === b.dataset.garder); if (m) { delete m.brouillon; sauverMedias(); toast('Gardé dans la bibliothèque'); Equipe.apresAjout(m, projets[m.evt]); vueBibliotheque(); } });
    const eqa2 = $('#eq-actualiser'); if (eqa2) eqa2.onclick = async () => { try { await Equipe.charger(); vueBibliotheque(); } catch (e) { toast(e.message); } };
    $$('[data-eq-suppr]').forEach(b => b.onclick = async () => { if (!confirm('Retirer ce fichier de la bibliothèque de l\'équipe ? (Les invitations déjà publiées ne changent pas.)')) return; try { await Equipe.rpc('equipe_biblio_supprimer', { p_id: b.dataset.eqSuppr }); medias.forEach(m => { if (m.equipe_id === b.dataset.eqSuppr) delete m.equipe_id; }); sauverMedias(); await Equipe.charger(); vueBibliotheque(); } catch (e) { toast(e.message); } });
    $$('[data-partager]').forEach(b => b.onclick = async () => { const m = medias.find(x => x.id === b.dataset.partager); b.disabled = true; b.textContent = 'Partage…'; try { await Equipe.partager(m, projets[m.evt] && projets[m.evt].fiche.titre); toast('Partagé avec l\'équipe'); vueBibliotheque(); } catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Partager avec l\'équipe'; } });
    if (Equipe.actif() && !vueBibliotheque._charge) { vueBibliotheque._charge = true; Equipe.charger().then(() => { if (/bibliotheque/.test(location.hash)) vueBibliotheque(); }).catch(() => {}).finally(() => setTimeout(() => { vueBibliotheque._charge = false; }, 60000)); }
    const nbB = medias.filter(m => m.brouillon && garde(m)).length;
    if (nbB) $('.bib-evt').insertAdjacentHTML('beforeend', `<div class="muet" style="flex-basis:100%">${nbB} brouillon${nbB > 1 ? 's' : ''} : les vidéos créées sont gardées automatiquement dès qu'elles arrivent (même si l'ordinateur s'éteint ensuite). « Garder » les range définitivement ; sinon supprimez-les.</div>`);
    $('#bib-evt').onchange = e => { Stock.ecrire('studio.bib.evt', e.target.value); vueBibliotheque(); };
    $$('video[data-src]').forEach(v => { resoudre(v.dataset.src).then(u => { v.src = u; }); v.onmouseenter = () => v.play(); v.onmouseleave = () => v.pause(); v.onclick = () => v.paused ? v.play() : v.pause(); });
    $$('[data-k]').forEach(i => i.onchange = () => { const id = i.closest('[data-id]').dataset.id; const m = medias.find(x => x.id === id); if (m) { m[i.dataset.k] = i.value; sauverMedias(); if (i.dataset.k === 'evt') { toast('Déplacé vers ' + titre(i.value)); vueBibliotheque(); } } });
    $$('[data-suppr]').forEach(b => b.onclick = async () => { if (!confirm('Supprimer ce fichier ?')) return; const m = medias.find(x => x.id === b.dataset.suppr); medias = medias.filter(x => x !== m); sauverMedias(); if (m) await IDB.suppr(m.src); vueBibliotheque(); });
    const cibleImport = evt === '*' ? '' : evt;
    const ouvrirIci = (id, k, ouv) => ouvrirCreateur(projets[id], k, Object.assign({}, ouv, { apres: () => vueBibliotheque() }));
    $('#bib-creer').onclick = () => {
      if (!evt || evt === '*' || !projets[evt]) { toast('Choisissez d\'abord l\'événement (en haut) : le fond prendra son thème et ses couleurs'); $('#bib-evt').focus(); return; }
      const pr = projets[evt]; const k = Math.max(0, pr.plans.findIndex(x => x.role === 'intermediaire'));
      ouvrirIci(evt, k, {});
    };
    if (createurEnAttente && projets[createurEnAttente.id]) { const a = createurEnAttente; createurEnAttente = null; ouvrirIci(a.id, a.k, a.ouv); }
    $('#imp-fond').onchange = e => importer([...e.target.files], 'fond', cibleImport);
    $('#imp-media').onchange = e => importer([...e.target.files], null, cibleImport);
  }
  async function vignetteVideo(url) {
    return new Promise(ok => {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = url;
      v.onloadeddata = () => { v.currentTime = Math.min(1.5, (v.duration || 2) / 2); };
      v.onseeked = () => { const c = document.createElement('canvas'); const r = 240 / (v.videoWidth || 240); c.width = 240; c.height = Math.round((v.videoHeight || 426) * r); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); let im = ''; try { im = c.toDataURL('image/jpeg', 0.75); } catch (e) {} ok({ vignette: im, duree: v.duration, l: v.videoWidth, h: v.videoHeight }); };
      v.onerror = () => ok({ vignette: '', duree: 0 });
    });
  }
  async function vignetteImage(url) {
    return new Promise(ok => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); const r = 240 / im.width; c.width = 240; c.height = Math.round(im.height * r); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); let v = ''; try { v = c.toDataURL('image/jpeg', 0.75); } catch (e) {} ok({ vignette: v, l: im.width, h: im.height }); }; im.onerror = () => ok({ vignette: '' }); im.src = url; });
  }
  function nomMedia(src) { const m = medias.find(x => x.src === src) || Equipe.medias().find(x => x.src === src); return m ? m.nom : ''; }
  async function importerFichier(f, type, evt) {
    const video = /^video/.test(f.type);
    const ext = (f.name.split('.').pop() || (video ? 'mp4' : 'jpg')).toLowerCase();
    const id = 'm' + uid();
    const src = 'idb:' + id + '.' + ext;
    await IDB.mettre(src, f);
    const url = URL.createObjectURL(f);
    const info = video ? await vignetteVideo(url) : await vignetteImage(url);
    const m = { id, evt: evt || '', nom: f.name.replace(/\.\w+$/, ''), src, type: type || (video ? 'video' : 'image'), vignette: info.vignette, duree: info.duree ? Math.round(info.duree * 10) / 10 : 0, l: info.l, h: info.h };
    if (m.type === 'fond') {
      Object.assign(m, { usage: 'programme', description: '', zone: { x: 50, y: 50, largeur: 66 }, zone_texte: 'centre' });
      if (info.l && info.h && Math.abs(info.l / info.h - 9 / 16) > 0.03) toast(`${f.name} n'est pas au format vertical 9:16 : il sera recadré`);
      else if (info.duree && info.duree < 4) toast(`${f.name} dure moins de 4 s : il bouclera souvent`);
    }
    medias.push(m);
    return m;
  }
  async function importer(fichiers, type, evt) {
    for (const f of fichiers) { const m = await importerFichier(f, type, evt); if (type === 'fond') Equipe.apresAjout(m, projets[evt]); }
    sauverMedias(); vueBibliotheque(); toast(fichiers.length + ' fichier(s) importé(s)');
  }

  /* ================= Réglages ================= */
  /* ---------- Équipe : lien unique, rejoindre, admin ---------- */
  const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const deB64 = t => JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g, '+').replace(/_/g, '/')))));
  const lienEquipe = cle => location.href.replace(/#.*$/, '').replace(/\?.*$/, '') + '#/rejoindre/' + cle + '/' + b64({ u: reglages.supabase.url, a: reglages.supabase.anon });
  function demanderNom(titre, valeur) {
    return new Promise(res => modale(`<h2>${esc(titre)}</h2><p class="muet">Votre nom apparaît sur ce que vous créez, pour que l'équipe et l'admin sachent qui a fait quoi.</p>
      <label class="champ">Votre nom<input type="text" id="eq-nom" value="${esc(valeur || '')}" placeholder="Ex. : Tsidy"></label><div class="ligne"><button class="btn plein" id="eq-ok">Valider</button></div>`, (box, fermer) => {
      const ok = () => { const v = $('#eq-nom', box).value.trim(); if (!v) return $('#eq-nom', box).focus(); modale._fermer = null; fermer(); res(v); };
      $('#eq-ok', box).onclick = ok; $('#eq-nom', box).onkeydown = e => { if (e.key === 'Enter') ok(); }; setTimeout(() => $('#eq-nom', box).focus(), 50);
      modale._fermer = () => res(null);
    }));
  }
  async function vueRejoindre(cle, conf) {
    $('#app').innerHTML = '<div class="carte" style="max-width:560px;margin:40px auto"><h2>Rejoindre l\'équipe…</h2><p class="muet" id="rj-etat">Vérification du lien…</p></div>';
    try {
      const c = conf ? deB64(conf) : (reglages.supabase ? { u: reglages.supabase.url, a: reglages.supabase.anon } : {});
      if (!c.u || !c.a) throw new Error('lien incomplet');
      if (!reglages.supabase || reglages.supabase.url !== c.u) { reglages.supabase = { url: c.u, anon: c.a }; sauverReglages(); }
      const info = await Base.rpc(reglages.supabase, 'equipe_info', { p_cle: cle });
      const deja = reglages.equipe && reglages.equipe.id === info.id ? reglages.equipe : null;
      // déjà dans cette équipe : on garde son nom et son accès admin (rouvrir le lien d'équipe ne le fait plus perdre)
      const nom = deja && deja.membre ? deja.membre : await demanderNom('Bienvenue dans l\'équipe « ' + info.nom + ' »', (reglages.equipe && reglages.equipe.membre) || '');
      if (!nom) { location.hash = '#/'; return; }
      reglages.equipe = { id: info.id, nom: info.nom, cle: info.cle, cle_admin: info.admin ? cle : (deja && deja.cle_admin) || '', membre: nom, auto: deja ? deja.auto !== false : true };
      sauverReglages();
      await Equipe.charger();
      toast(info.admin ? 'Vous êtes l\'admin de l\'équipe « ' + info.nom + ' »' : 'Vous avez rejoint l\'équipe « ' + info.nom + ' »');
      location.hash = info.admin ? '#/equipe' : '#/bibliotheque';
    } catch (e) { $('#rj-etat').textContent = 'Lien d\'équipe invalide : ' + e.message + '. Demandez le lien à jour à votre admin.'; }
  }
  // Modèles (invitations) et films de l'équipe : tout le monde les voit ; l'admin publie les films sur la vitrine
  const vidFiltre = Object.assign({ type: 'tout', membre: '' }, Stock.lire('studio.vid.filtre', {}));
  async function modelesEtFilms(zone, admin, filmsSeuls) {
    let modeles = [], films = [], videos = [], surVitrine = new Set();
    try {
      if (!filmsSeuls) modeles = await Equipe.rpc('equipe_modeles');
      await Equipe.charger(); films = Equipe.items.filter(x => x.type === 'film');
      videos = Equipe.items.filter(x => x.type === 'film' || x.type === 'fond' || x.type === 'video');
      try { const r = await fetch(urlSite() + 'vitrine/index.json?v=' + Date.now(), { cache: 'no-store' }); if (r.ok) surVitrine = new Set((await r.json()).map(x => x.slug)); } catch (e) {}
    } catch (err) { zone.textContent = /function|schema cache|Could not find/i.test(err.message) ? 'Mise à jour de la base à installer (Réglages → Équipe).' : 'Impossible de lire l\'équipe : ' + err.message; return; }
    const date = x => x ? new Date(x).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    zone.classList.remove('muet');
    zone.innerHTML = `${filmsSeuls ? '' : `<div class="carte" style="padding:10px"><h3 style="margin:4px 6px 10px">Tous les modèles de l'équipe (${modeles.length})</h3>
      <div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">${modeles.map(t => `<div class="carte pile" style="padding:10px">${t.vignette ? `<img src="${esc(t.vignette)}" alt="" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px">` : ''}
        <b>${esc(t.titre || 'Sans titre')}</b><div class="muet">par <b>${esc(t.auteur || '—')}</b> · ${t.plans} plans · ${date(t.maj)}</div>
        <div class="ligne">${t.publie && t.slug ? `<a class="btn petit" target="_blank" href="${esc(urlSite() + 'i/?p=' + encodeURIComponent(t.slug))}">Voir ↗</a>` : ''}<button class="btn petit plein" data-modele="${esc(t.projet)}">Utiliser ce modèle</button></div></div>`).join('') || '<p class="muet">Aucun modèle pour l\'instant.</p>'}</div></div>`}
      <div class="carte" style="padding:10px;margin-top:14px" id="vid-equipe">
        <div class="ligne" style="justify-content:space-between;margin:4px 6px 10px"><h3 style="margin:0">🎬 Toutes les vidéos de l'équipe (${videos.length})</h3>
          <label class="btn petit plein">+ Ajouter un film terminé<input type="file" id="vid-ajout" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm" multiple hidden></label></div>
        <div class="ligne vid-filtres" style="margin:0 6px 10px;gap:6px;flex-wrap:wrap">
          ${[['tout', 'Tout', videos.length], ['film', 'Films terminés', films.length], ['fond', 'Fonds vidéo', videos.filter(x => x.type !== 'film').length]].map(([k, n, c]) => `<button class="btn petit ${vidFiltre.type === k ? 'plein' : ''}" data-vf="${k}">${n} (${c})</button>`).join('')}
          <select id="vid-membre" style="margin-left:auto"><option value="">Tous les membres</option>${[...new Set(videos.map(x => x.auteur || '—'))].sort().map(m => `<option ${vidFiltre.membre === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
        <div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${videos.filter(x => (vidFiltre.type === 'tout' || (vidFiltre.type === 'film' ? x.type === 'film' : x.type !== 'film')) && (!vidFiltre.membre || (x.auteur || '—') === vidFiltre.membre)).map(f => { const u = Equipe.url(f.chemin), estFilm = f.type === 'film', sv = estFilm && surVitrine.has('film-' + f.id); return `<div class="carte pile" style="padding:10px">
        <video src="${esc(u)}" poster="${esc(f.vignette || '')}" controls preload="none" playsinline style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;background:#000"></video>
        <div><span class="badge ${estFilm ? 'ok' : ''}">${estFilm ? 'Film' : 'Fond vidéo'}</span></div>
        <b style="font-size:13px">${esc(f.nom)}</b><div class="muet" style="font-size:12px">par <b>${esc(f.auteur || '—')}</b> · ${date(f.cree)}${f.duree ? ' · ' + Math.round(f.duree) + ' s' : ''}${f.secondes_creation ? ' · ⏱ fabriqué en ' + dureeTexte(f.secondes_creation) : ''}</div>
        <div class="ligne"><a class="btn petit" href="${esc(u)}" download target="_blank">Télécharger</a>${estFilm ? (admin ? (sv ? `<span class="badge ok">sur la vitrine</span><button class="btn petit danger" data-film-retirer="${esc(f.id)}">Retirer</button>` : `<button class="btn petit plein" data-film-vitrine="${esc(f.id)}">Publier sur la vitrine</button>`) : (sv ? '<span class="badge ok">sur la vitrine</span>' : '')) : ''}</div></div>`; }).join('') || '<p class="muet">Aucune vidéo ici pour l\'instant. Chaque film fabriqué (Film et publication → Enregistrer le film) arrive tout seul ; un film déjà fait s\'ajoute avec « + Ajouter un film terminé ».</p>'}</div></div>`;
    $$('[data-vf]', zone).forEach(b => b.onclick = () => { vidFiltre.type = b.dataset.vf; Stock.ecrire('studio.vid.filtre', vidFiltre); modelesEtFilms(zone, admin, filmsSeuls); });
    const vm = $('#vid-membre', zone); if (vm) vm.onchange = () => { vidFiltre.membre = vm.value; Stock.ecrire('studio.vid.filtre', vidFiltre); modelesEtFilms(zone, admin, filmsSeuls); };
    const va = $('#vid-ajout', zone); if (va) va.onchange = async () => {
      const fs = [...va.files]; if (!fs.length) return;
      for (const f of fs) {
        const titre = f.name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').replace(/\s*film\s*$/i, '').trim();
        toast('Envoi de « ' + titre + ' » à l\'équipe…');
        try { await Equipe.ajouterFilm(f, { titre }); toast('« ' + titre + ' » est visible par toute l\'équipe'); }
        catch (err) { toast('« ' + titre + ' » non envoyé : ' + err.message); }
      }
      modelesEtFilms(zone, admin, filmsSeuls);
    };
    $$('[data-modele]', zone).forEach(b => b.onclick = async () => {
      try {
        const src = await Equipe.rpc('equipe_modele', { p_projet: b.dataset.modele }); if (!src) return toast('Modèle introuvable');
        const c = JSON.parse(JSON.stringify(src)); c.id = uid(); c.slug = (c.slug || 'modele') + '-' + c.id.slice(0, 4);
        ['publie', 'cle_hote', 'familles', 'vitrine', 'vitrine_publiee', 'reponses_generales'].forEach(k => delete c[k]); c.familles = [];
        c.fiche.titre = (c.fiche.titre || 'Modèle') + ' (copie)';
        await recevoirPolices(c);
        projets[c.id] = c; sauverProjets(); toast('Nouvel événement créé à partir du modèle'); location.hash = '#/p/' + c.id + '/plans';
      } catch (err) { toast(err.message); }
    });
    const githubPret = () => { const g = reglages.github || {}; if (g.owner && g.repo && g.token) return true; toast('Reliez d\'abord GitHub dans Réglages (pour publier sur le site)'); return false; };
    $$('[data-film-vitrine]', zone).forEach(b => b.onclick = async () => {
      if (!githubPret()) return;
      const f = films.find(x => x.id === b.dataset.filmVitrine); b.disabled = true; b.textContent = 'Publication…';
      try {
        await publierFilmVitrine(f);
        toast('Film publié sur la vitrine (visible dans quelques minutes)'); modelesEtFilms(zone, admin, filmsSeuls);
      } catch (err) { toast('Échec : ' + err.message); b.disabled = false; b.textContent = 'Publier sur la vitrine'; }
    });
    $$('[data-film-retirer]', zone).forEach(b => b.onclick = async () => {
      if (!githubPret() || !confirm('Retirer ce film de la vitrine du site ?')) return;
      try { const index = (await lireVitrine()).filter(x => x.slug !== 'film-' + b.dataset.filmRetirer); await ecrireVitrine(index, 'Vitrine : retrait film'); toast('Film retiré de la vitrine'); modelesEtFilms(zone, admin, filmsSeuls); } catch (err) { toast(err.message); }
    });
  }

  /* ---------- Rubrique « Vidéos » : tous les films terminés de l'équipe, à publier sur le site ---------- */
  const vpFiltre = Object.assign({ etat: 'tout', membre: '', type: 'film' }, Stock.lire('studio.vp.filtre', {}));
  async function vueVideos() {
    const app = $('#app');
    app.innerHTML = `<div class="entete"><div><h1>🎬 Vidéos de l'équipe</h1><p>Tous les films terminés de l'équipe, au même endroit : regardez-les, téléchargez-les et publiez-les sur le site, dans la rubrique « Nos vidéos réalisées ».</p></div>
      <div class="ligne"><a class="btn" target="_blank" href="${esc(urlSite())}#films">Voir la rubrique sur le site ↗</a><label class="btn plein">+ Ajouter un film terminé<input type="file" id="vp-ajout" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm" multiple hidden></label></div></div>
      <div id="vp-zone" class="muet">Chargement des vidéos de l'équipe…</div>`;
    if (!Equipe.actif()) { $('#vp-zone').innerHTML = `<div class="carte pile" style="max-width:640px"><p>Les vidéos de l'équipe apparaissent ici quand vous êtes dans une équipe. Ouvrez le lien d'équipe reçu, ou créez l'équipe dans <a href="#/reglages">Réglages</a>.</p></div>`; return; }
    const zone = $('#vp-zone');
    const va = $('#vp-ajout'); va.onchange = async () => {
      for (const f of [...va.files]) {
        const titre = f.name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').replace(/\s*film\s*$/i, '').trim();
        toast('Envoi de « ' + titre + ' » à l\'équipe…');
        try { await Equipe.ajouterFilm(f, { titre }); toast('« ' + titre + ' » ajouté aux vidéos de l\'équipe'); } catch (err) { toast('« ' + titre + ' » non envoyé : ' + err.message); }
      }
      vueVideos();
    };
    let films = [], surSite = new Set(), horsLigne = '';
    try { await Equipe.charger(); } catch (err) { horsLigne = err.message; Equipe.items = Stock.lire('studio.equipe.biblio', []); }
    const tout = (Equipe.items || []).filter(x => x.type === 'film' || x.type === 'fond' || x.type === 'video').sort((a, b) => String(b.cree || '').localeCompare(String(a.cree || '')));
    films = tout.filter(x => x.type === 'film');
    const fondsEq = tout.filter(x => x.type !== 'film');
    const aPartager = medias.filter(m => (m.type === 'fond' || m.type === 'video' || m.anime) && !m.equipe_id && !m.brouillon && /^idb:/.test(m.src || '')).length;
    try { const r = await fetch(urlSite() + 'vitrine/index.json?v=' + Date.now(), { cache: 'no-store' }); if (r.ok) surSite = new Set((await r.json()).map(x => x.slug)); } catch (e) {}
    if (horsLigne && !films.length) { zone.textContent = 'Impossible de lire les vidéos de l\'équipe : ' + horsLigne; return; }
    const pub = f => surSite.has('film-' + f.id);
    const g = reglages.github || {}, peutPublier = !!(g.owner && g.repo && g.token);
    const membres = [...new Set(tout.map(x => x.auteur || '—'))].sort();
    const base = vpFiltre.type === 'fond' ? fondsEq : vpFiltre.type === 'tout' ? tout : films;
    const visibles = base.filter(f => (f.type !== 'film' || vpFiltre.etat === 'tout' || (vpFiltre.etat === 'oui' ? pub(f) : !pub(f))) && (!vpFiltre.membre || (f.auteur || '—') === vpFiltre.membre));
    const date = x => x ? new Date(x).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const nPub = films.filter(pub).length;
    zone.classList.remove('muet');
    zone.innerHTML = `<div class="seg" style="margin-bottom:12px">${[['film', '🎬 Films terminés', films.length], ['fond', '🎞 Fonds vidéo de l\'équipe', fondsEq.length], ['tout', 'Tout', tout.length]].map(([k, n, c]) => `<button data-vpt="${k}" class="${vpFiltre.type === k ? 'on' : ''}">${n} (${c})</button>`).join('')}</div>
      ${aPartager ? `<div class="carte ligne" style="padding:10px 12px;margin-bottom:10px;background:#fbf4ec;justify-content:space-between"><span><b>${aPartager}</b> de vos vidéos / fonds ne sont pas encore visibles par l'équipe.</span><button class="btn petit plein" id="vp-rattraper">Les partager maintenant</button></div>` : ''}
      <div class="stats"><div class="stat"><b>${films.length}</b><span>films terminés</span></div><div class="stat"><b>${fondsEq.length}</b><span>fonds vidéo partagés</span></div><div class="stat"><b>${nPub}</b><span>sur le site</span></div><div class="stat"><b>${films.length - nPub}</b><span>pas encore publiés</span></div><div class="stat"><b>${membres.length}</b><span>membres</span></div></div>
      ${horsLigne ? `<div class="carte" style="padding:10px 12px;margin-top:10px;background:#fdecec">Serveur de l'équipe injoignable (${esc(horsLigne)}) : dernière liste connue. Les vidéos se liront et se publieront de nouveau quand il répondra.</div>` : ''}
      ${peutPublier ? '' : '<div class="carte" style="padding:10px 12px;margin-top:10px;background:#fbf4ec">La publication sur le site se fait depuis le studio relié à GitHub (Réglages → GitHub), en général celui de l\'admin. Vous pouvez quand même regarder et télécharger toutes les vidéos.</div>'}
      <div class="ligne" style="margin:14px 0 10px;gap:6px;flex-wrap:wrap">
        ${[['tout', 'Toutes', films.length], ['non', 'Pas encore sur le site', films.length - nPub], ['oui', 'Sur le site', nPub]].map(([k, n, c]) => `<button class="btn petit ${vpFiltre.etat === k ? 'plein' : ''}" data-vpf="${k}">${n} (${c})</button>`).join('')}
        <select id="vp-membre"><option value="">Tous les membres</option>${membres.map(m => `<option ${vpFiltre.membre === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
        ${peutPublier ? `<span style="margin-left:auto" class="ligne"><label class="cases" style="margin:0"><input type="checkbox" id="vp-tous"> Tout cocher</label><button class="btn petit plein" id="vp-pub-sel" disabled>Publier la sélection</button><button class="btn petit" id="vp-pub-tout">Publier tout ce qui manque (${films.length - nPub})</button></span>` : ''}</div>
      <div class="muet" id="vp-etat" style="margin:0 0 8px"></div>
      <div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">${visibles.map(f => { const u = Equipe.url(f.chemin), sv = pub(f), estFilm = f.type === 'film'; return `<div class="carte pile" style="padding:10px">
        <video src="${esc(u)}" poster="${esc(f.vignette || '')}" controls preload="none" playsinline style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;background:#000"></video>
        <div class="ligne" style="justify-content:space-between">${!estFilm ? '<span class="badge">🎞 fond vidéo</span>' : sv ? '<span class="badge ok">✓ sur le site</span>' : '<span class="badge">pas encore publié</span>'}${peutPublier && estFilm && !sv ? `<input type="checkbox" data-vp-sel="${esc(f.id)}" title="Sélectionner">` : ''}</div>
        <b style="font-size:13px">${esc((f.evenement || f.nom || '').replace(/^Film — /, ''))}</b><div class="muet" style="font-size:12px">par <b>${esc(f.auteur || '—')}</b> · ${date(f.cree)}${f.duree ? ' · ' + Math.round(f.duree) + ' s' : ''}</div>
        <div class="ligne"><a class="btn petit" href="${esc(u)}" download target="_blank">Télécharger</a>${!estFilm ? '<a class="btn petit" href="#/bibliotheque">Dans la bibliothèque</a>' : peutPublier ? (sv ? `<button class="btn petit danger" data-vp-retirer="${esc(f.id)}">Retirer du site</button>` : `<button class="btn petit plein" data-vp-pub="${esc(f.id)}">Publier sur le site</button>`) : ''}</div></div>`; }).join('') || '<p class="muet">Aucune vidéo ici. Les films fabriqués par l\'équipe arrivent tout seuls ; on peut aussi en ajouter avec « + Ajouter un film terminé ».</p>'}</div>`;
    $$('[data-vpf]', zone).forEach(b => b.onclick = () => { vpFiltre.etat = b.dataset.vpf; Stock.ecrire('studio.vp.filtre', vpFiltre); vueVideos(); });
    $$('[data-vpt]', zone).forEach(b => b.onclick = () => { vpFiltre.type = b.dataset.vpt; Stock.ecrire('studio.vp.filtre', vpFiltre); vueVideos(); });
    const vr = $('#vp-rattraper', zone); if (vr) vr.onclick = async () => { vr.disabled = true; vr.textContent = 'Partage en cours…'; await Equipe.rattraper(); vueVideos(); };
    $('#vp-membre', zone).onchange = e => { vpFiltre.membre = e.target.value; Stock.ecrire('studio.vp.filtre', vpFiltre); vueVideos(); };
    if (!peutPublier) return;
    const etat = $('#vp-etat', zone);
    const publierListe = async liste => {
      if (!liste.length) return toast('Rien à publier');
      $$('button', zone).forEach(b => b.disabled = true); let ok = 0; const rates = [];
      for (const [k, f] of liste.entries()) { etat.textContent = `Publication ${k + 1}/${liste.length} : ${f.evenement || f.nom}…`; try { await publierFilmVitrine(f); ok++; } catch (err) { rates.push((f.evenement || f.nom) + ' (' + err.message + ')'); } }
      toast(ok + ' vidéo(s) publiée(s) sur le site (visibles dans quelques minutes)');
      etat.innerHTML = `${ok} publiée(s).${rates.length ? ' Non publiées : ' + esc(rates.join(' · ')) : ''}`;
      setTimeout(vueVideos, rates.length ? 4000 : 1200);
    };
    const sel = () => $$('[data-vp-sel]', zone).filter(c => c.checked).map(c => films.find(f => f.id === c.dataset.vpSel));
    const majSel = () => { const n = sel().length, b = $('#vp-pub-sel', zone); b.disabled = !n; b.textContent = n ? `Publier la sélection (${n})` : 'Publier la sélection'; };
    $$('[data-vp-sel]', zone).forEach(c => c.onchange = majSel);
    $('#vp-tous', zone).onchange = e => { $$('[data-vp-sel]', zone).forEach(c => c.checked = e.target.checked); majSel(); };
    $('#vp-pub-sel', zone).onclick = () => publierListe(sel());
    $('#vp-pub-tout', zone).onclick = () => { const l = films.filter(f => !pub(f)); if (l.length && confirm(`Publier sur le site les ${l.length} vidéo(s) de l'équipe qui n'y sont pas encore ?`)) publierListe(l); };
    $$('[data-vp-pub]', zone).forEach(b => b.onclick = () => publierListe([films.find(f => f.id === b.dataset.vpPub)]));
    $$('[data-vp-retirer]', zone).forEach(b => b.onclick = async () => {
      if (!confirm('Retirer cette vidéo du site ?')) return;
      b.disabled = true;
      try { const index = (await lireVitrine()).filter(x => x.slug !== 'film-' + b.dataset.vpRetirer); await ecrireVitrine(index, 'Vitrine : retrait film'); toast('Vidéo retirée du site (dans quelques minutes)'); setTimeout(vueVideos, 800); } catch (err) { toast(err.message); b.disabled = false; }
    });
  }

  async function vueEquipe() {
    if (!Equipe.actif()) { $('#app').innerHTML = `<div class="entete"><div><h1>Équipe</h1><p>Travaillez à plusieurs : bibliothèque de fonds commune, et l'admin voit le travail de chacun.</p></div></div><div class="carte pile" style="max-width:640px"><p>Vous n'êtes dans aucune équipe. Ouvrez le lien d'équipe reçu, ou créez l'équipe dans <a href="#/reglages">Réglages</a> (vous en serez l'admin).</p></div>`; return; }
    const e = reglages.equipe;
    if (!Equipe.admin()) {
      $('#app').innerHTML = `<div class="entete"><div><h1>Équipe « ${esc(e.nom)} »</h1><p>Vous : <b>${esc(e.membre)}</b>. Les fonds de l'équipe sont dans la <a href="#/bibliotheque">Bibliothèque</a> ; ici, tous les modèles et les films de l'équipe.</p></div><div class="ligne"><button class="btn" id="eq-maj">Actualiser</button></div></div>
        <div id="eq-modeles" class="muet">Chargement…</div>
        <div class="carte pile" style="max-width:640px;margin-top:14px"><h3>Lien de l'équipe</h3><p class="muet">Pour faire entrer un nouveau membre.</p><div class="ligne"><input type="text" readonly value="${esc(lienEquipe(e.cle))}" style="flex:1"><button class="btn petit" id="eq-cp">Copier</button></div></div>`;
      $('#eq-cp').onclick = () => copier(lienEquipe(e.cle));
      const charger = () => modelesEtFilms($('#eq-modeles'), false);
      $('#eq-maj').onclick = charger; charger(); return;
    }
    $('#app').innerHTML = `<div class="entete"><div><h1>Équipe « ${esc(e.nom)} » <span class="badge ok">admin</span></h1><p>Le travail de chacun, ses invitations et le temps de fabrication des vidéos.</p></div><div class="ligne"><button class="btn" id="eq-maj">Actualiser</button></div></div><div id="eq-vue" class="muet">Chargement…</div>`;
    const rendre = async () => {
      let d; try { d = await Equipe.rpc('equipe_admin'); } catch (err) {
        // serveur indisponible : les liens restent visibles (ils sont gardés sur cet ordinateur)
        $('#eq-vue').innerHTML = `<p class="muet">Impossible de lire l'équipe : ${esc(err.message)}</p><div class="ia-grille" style="margin-top:14px"><div class="carte pile"><h3>Lien de l'équipe</h3><p class="muet">Le même lien pour tous les membres.</p>
          <div class="ligne"><input type="text" readonly value="${esc(lienEquipe(e.cle))}" style="flex:1"><button class="btn petit" id="eq-cp">Copier</button></div></div>
          <div class="carte pile"><h3>Votre lien admin (privé)</h3><p class="muet">Ne le donnez pas à l'équipe.</p>
          <div class="ligne"><input type="text" readonly value="${esc(lienEquipe(e.cle_admin))}" style="flex:1"><button class="btn petit" id="eq-cpa">Copier</button></div></div></div>`;
        $('#eq-cp').onclick = () => copier(lienEquipe(e.cle)); $('#eq-cpa').onclick = () => copier(lienEquipe(e.cle_admin));
        return;
      }
      let surVitrine = new Set(); try { const r = await fetch(urlSite() + 'vitrine/index.json?v=' + Date.now(), { cache: 'no-store' }); if (r.ok) surVitrine = new Set((await r.json()).map(x => x.slug)); } catch (e) {}
      const membres = {};
      const ajouter = (n) => (membres[n || '—'] = membres[n || '—'] || { nom: n || '—', evts: 0, publies: 0, videos: 0, secondes: 0, derniere: '' });
      d.travaux.forEach(t => { const m = ajouter(t.auteur); m.evts++; if (t.publie) m.publies++; if (t.maj > m.derniere) m.derniere = t.maj; });
      d.creations.forEach(c => { const m = ajouter(c.auteur); m.videos++; m.secondes += Number(c.secondes) || 0; if (c.date > m.derniere) m.derniere = c.date; });
      const parType = {}; d.creations.forEach(c => { const t = parType[c.type] = parType[c.type] || { n: 0, s: 0 }; t.n++; t.s += Number(c.secondes) || 0; });
      const NOMS = { wan: 'Fond Wan 2.2', animer: 'Image animée', recolorer: 'Recoloration', film: 'Film MP4' };
      const date = x => x ? new Date(x).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      $('#eq-vue').innerHTML = `
        <div class="stats"><div class="stat"><b>${Object.keys(membres).length}</b><span>membres actifs</span></div><div class="stat"><b>${d.travaux.length}</b><span>invitations (modèles)</span></div>
          <div class="stat"><b>${d.creations.length}</b><span>vidéos fabriquées</span></div><div class="stat"><b>${d.biblio}</b><span>fichiers dans la bibliothèque commune</span></div>
          ${Object.entries(parType).map(([k, t]) => `<div class="stat"><b>${dureeTexte(t.s / t.n)}</b><span>en moyenne par ${esc(NOMS[k] || k)} (${t.n})</span></div>`).join('')}</div>
        <div class="carte" style="padding:10px;margin-top:14px"><h3 style="margin:4px 6px 10px">Membres</h3><div class="tableau-boite"><table class="tableau"><thead><tr><th>Membre</th><th>Invitations</th><th>Publiées</th><th>Vidéos</th><th>Temps total de fabrication</th><th>Dernière activité</th></tr></thead>
          <tbody>${Object.values(membres).sort((a, b) => b.derniere.localeCompare(a.derniere)).map(m => `<tr><td><b>${esc(m.nom)}</b></td><td>${m.evts}</td><td>${m.publies}</td><td>${m.videos}</td><td>${dureeTexte(m.secondes)}</td><td>${date(m.derniere)}</td></tr>`).join('') || '<tr><td colspan="6" class="muet">Personne n\'a encore travaillé.</td></tr>'}</tbody></table></div></div>
        <div class="carte pile" style="padding:12px;margin-top:14px;background:#fbf4ec"><div class="ligne" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div><b>📢 Vitrine du site</b><div class="muet">Publiez d'un coup toutes les invitations et tous les films de l'équipe qui n'y sont pas encore (noms remplacés par des exemples).</div></div><button class="btn plein" id="vit-tout">Tout publier sur la vitrine</button></div><div class="muet" id="vit-tout-etat"></div></div>
        <div class="carte" style="padding:10px;margin-top:14px"><h3 style="margin:4px 6px 10px">Toutes les invitations de l'équipe</h3>
          <div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${d.travaux.map(t => `<div class="carte pile" style="padding:10px">${t.vignette ? `<img src="${esc(t.vignette)}" alt="" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px">` : ''}
            <b>${esc(t.titre || 'Sans titre')}</b><div class="muet">par <b>${esc(t.auteur || '—')}</b> · ${t.plans} plans · modifiée le ${date(t.maj)}</div>
            <div class="ligne">${t.publie && t.slug ? `<a class="btn petit" target="_blank" href="${esc(urlSite() + 'i/?p=' + encodeURIComponent(t.slug))}">Voir l'invitation ↗</a>` : '<span class="badge alerte">non publiée</span>'}<button class="btn petit" data-copie="${esc(t.projet)}">Ouvrir une copie</button></div>
            ${surVitrine.has('demo-' + t.slug) ? `<div class="ligne"><span class="badge ok">sur la vitrine</span><a class="btn petit" target="_blank" href="${esc(urlSite() + 'i/?p=' + encodeURIComponent('demo-' + t.slug))}">Voir la démo ↗</a><button class="btn petit danger" data-vit-retirer="${esc(t.projet)}">Retirer</button></div>`
              : `<button class="btn petit plein" data-vitrine="${esc(t.projet)}">Publier sur la vitrine</button>`}</div>`).join('') || '<p class="muet">Aucune invitation pour l\'instant.</p>'}</div></div>
        <div id="eq-films"></div>
        <div class="carte" style="padding:10px;margin-top:14px"><h3 style="margin:4px 6px 10px">Vidéos fabriquées (temps de chacune)</h3><div class="tableau-boite"><table class="tableau"><thead><tr><th>Date</th><th>Membre</th><th>Type</th><th>Vidéo</th><th>Invitation</th><th>Temps</th></tr></thead>
          <tbody>${d.creations.slice(0, 300).map(c => `<tr><td>${date(c.date)}</td><td>${esc(c.auteur)}</td><td>${esc(NOMS[c.type] || c.type)}</td><td>${esc(c.nom)}</td><td>${esc(c.titre_projet)}</td><td><b>${dureeTexte(c.secondes)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="muet">Aucune vidéo fabriquée depuis l\'activation de l\'équipe.</td></tr>'}</tbody></table></div></div>
        <div class="ia-grille" style="margin-top:14px"><div class="carte pile"><h3>Lien de l'équipe</h3><p class="muet">Le même lien pour tous les membres : ils y entrent leur nom, puis partagent la bibliothèque.</p>
          <div class="ligne"><input type="text" readonly value="${esc(lienEquipe(e.cle))}" style="flex:1"><button class="btn petit" id="eq-cp">Copier</button><a class="btn petit" target="_blank" href="https://wa.me/?text=${encodeURIComponent('Lien du studio pour l\'équipe : ' + lienEquipe(e.cle))}">WhatsApp</a></div></div>
          <div class="carte pile"><h3>Votre lien admin (privé)</h3><p class="muet">Pour ouvrir cette page sur un autre ordinateur. Ne le donnez pas à l'équipe.</p>
          <div class="ligne"><input type="text" readonly value="${esc(lienEquipe(e.cle_admin))}" style="flex:1"><button class="btn petit" id="eq-cpa">Copier</button></div></div></div>`;
      $('#eq-cp').onclick = () => copier(lienEquipe(e.cle)); $('#eq-cpa').onclick = () => copier(lienEquipe(e.cle_admin));
      modelesEtFilms($('#eq-films'), true, true);
      const githubPret = () => { const g = reglages.github || {}; if (g.owner && g.repo && g.token) return true; toast('Reliez d\'abord GitHub dans Réglages (pour publier sur le site)'); return false; };
      $$('[data-vitrine]').forEach(b => b.onclick = () => {
        if (!githubPret()) return;
        const t = d.travaux.find(x => x.projet === b.dataset.vitrine);
        modale(`<h2>Publier sur la vitrine du site</h2><p class="muet">« ${esc(t.titre)} », par ${esc(t.auteur || '—')}. Les visiteurs du site pourront la regarder ; leurs réponses ne sont jamais enregistrées.</p>
          <label class="cases"><input type="radio" name="vt-mode" value="anonyme" checked> Noms et téléphones remplacés par des exemples (recommandé)</label>
          <label class="cases"><input type="radio" name="vt-mode" value="noms"> Telle quelle, avec les vrais noms (seulement avec l'accord du client)</label>
          <div class="ligne" style="margin-top:10px"><button class="btn plein" id="vt-ok">Publier sur la vitrine</button><span class="muet" id="vt-etat"></span></div>`, (box, fermer) => {
          $('#vt-ok', box).onclick = async () => {
            const etat = $('#vt-etat', box), ok = $('#vt-ok', box); ok.disabled = true;
            try {
              etat.textContent = 'Lecture de l\'invitation…';
              const pr = await Equipe.rpc('equipe_projet', { p_projet: t.projet });
              if (!pr) throw new Error('invitation introuvable');
              const manquants = [...new Set(pr.plans.flatMap(pl => [pl.fond && pl.fond.media].concat((pl.calques || []).map(c => c.media))).concat(pr.musique ? [pr.musique.src] : []).filter(x => /^idb:/.test(x || '')))];
              if (manquants.length && !confirm(manquants.length + ' fichier(s) de cette invitation ne sont pas encore arrivés dans l\'espace d\'équipe (' + (t.auteur || 'le membre') + ' doit ouvrir son studio, connecté à Internet). Publier quand même, sans eux ?')) { ok.disabled = false; etat.textContent = ''; return; }
              await copierFichiersEquipe(srcsEquipe(pr), x => { etat.textContent = x; });
              etat.textContent = 'Publication sur la vitrine…';
              const pub = publication(pr);
              await publierVitrine(pr, pub, ($('input[name=vt-mode]:checked', box) || {}).value === 'noms', t.auteur);
              fermer(); toast('Publiée sur la vitrine (visible dans quelques minutes)'); rendre();
            } catch (err) { etat.textContent = 'Échec : ' + err.message; ok.disabled = false; }
          };
        });
      });
      $('#vit-tout').onclick = async () => {
        if (!githubPret()) return;
        await Equipe.charger().catch(() => {});
        const invits = d.travaux.filter(t => t.slug && !surVitrine.has('demo-' + t.slug));
        const films = Equipe.items.filter(x => x.type === 'film' && !surVitrine.has('film-' + x.id));
        if (!invits.length && !films.length) return toast('Tout est déjà sur la vitrine');
        if (!confirm(`Publier sur la vitrine ${invits.length} invitation(s) et ${films.length} film(s) ? (noms et téléphones remplacés par des exemples)`)) return;
        const etat = $('#vit-tout-etat'), b = $('#vit-tout'); b.disabled = true; let ok = 0; const rates = [];
        for (const [k, t] of invits.entries()) { etat.textContent = `Invitation ${k + 1}/${invits.length} : ${t.titre}…`; try { await publierInvitationEquipe(t, x => { etat.textContent = `Invitation ${k + 1}/${invits.length} : ${x}`; }); ok++; } catch (err) { rates.push(t.titre + ' (' + err.message + ')'); } }
        for (const [k, f] of films.entries()) { etat.textContent = `Film ${k + 1}/${films.length} : ${f.nom}…`; try { await publierFilmVitrine(f); ok++; } catch (err) { rates.push(f.nom + ' (' + err.message + ')'); } }
        etat.innerHTML = `${ok} publié(s) sur la vitrine (visible dans quelques minutes).${rates.length ? '<br>Non publiés : ' + esc(rates.join(' · ')) : ''}`; b.disabled = false;
        toast(ok + ' publié(s) sur la vitrine'); setTimeout(rendre, 1500);
      };
      $$('[data-vit-retirer]').forEach(b => b.onclick = async () => {
        if (!githubPret()) return;
        const t = d.travaux.find(x => x.projet === b.dataset.vitRetirer);
        if (!confirm('Retirer « ' + t.titre + ' » de la vitrine du site ?')) return;
        try { await retirerVitrine(t.slug, t.titre); toast('Retirée de la vitrine (dans quelques minutes)'); rendre(); } catch (err) { toast(err.message); }
      });
      $$('[data-copie]').forEach(b => b.onclick = async () => {
        try {
          const src = await Equipe.rpc('equipe_projet', { p_projet: b.dataset.copie });
          if (!src) return toast('Projet introuvable');
          const c = JSON.parse(JSON.stringify(src)); c.id = uid(); c.slug = (c.slug || 'copie') + '-' + c.id.slice(0, 4); delete c.publie; delete c.cle_hote; c.fiche.titre = (c.fiche.titre || '') + ' (copie)';
          await recevoirPolices(c);
          projets[c.id] = c; sauverProjets();
          const manque = c.plans.some(pl => /^idb:/.test((pl.fond || {}).media || '') || (pl.calques || []).some(x => /^idb:/.test(x.media || '')));
          toast(manque ? 'Copie ouverte. Certains fichiers non partagés par le membre ne sont pas sur cet ordinateur.' : 'Copie ouverte');
          location.hash = '#/p/' + c.id + '/plans';
        } catch (err) { toast(err.message); }
      });
    };
    $('#eq-maj').onclick = rendre; rendre();
  }

  function vueReglages() {
    const g = reglages.github || {};
    $('#app').innerHTML = `<div class="entete"><div><h1>Réglages</h1><p>À faire une seule fois.</p></div></div>
      <div class="ia-grille">
        <div class="carte pile"><h3>Publication sur GitHub Pages</h3>
          <p class="muet">Permet au bouton « Publier » d'envoyer les invitations en ligne, gratuitement. Le jeton reste uniquement dans ce navigateur.</p>
          <div class="deux"><label class="champ">Compte GitHub<input type="text" id="g-owner" value="${esc(g.owner || depotDuSite().owner)}" placeholder="votre-compte"></label><label class="champ">Dépôt<input type="text" id="g-repo" value="${esc(g.repo || depotDuSite().repo)}" placeholder="STUDIO"></label></div>
          <label class="champ">Jeton d'accès (fine-grained token, droit « Contents : Read and write » sur ce dépôt)<input type="password" id="g-token" value="${esc(g.token)}" placeholder="github_pat_…"></label>
          <div class="ligne"><button class="btn plein" id="g-ok">Enregistrer</button><button class="btn" id="g-test">Tester</button><span class="muet" id="g-etat"></span></div>
          <details><summary class="muet" style="cursor:pointer">Comment obtenir le jeton ?</summary><ol class="muet">
            <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Ouvrir la page de création du jeton ↗</a> (connecté au compte <b>${esc(depotDuSite().owner || 'du site')}</b>), ou sur github.com : photo de profil → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.</li>
            <li>Repository access : Only select repositories → choisir le dépôt du studio (<b>${esc(depotDuSite().repo || 'STUDIO')}</b>).</li>
            <li>Permissions → Repository permissions → Contents : Read and write.</li>
            <li>Generate token, copier le jeton et le coller ici.</li></ol></details>
        </div>
        <div class="carte pile carte-client"><h3>👥 Équipe</h3>
          ${!reglages.supabase ? '<p class="muet">Activez d\'abord la base des invités (Supabase) ci-dessous : l\'équipe l\'utilise aussi.</p>'
            : !Equipe.actif() ? `<p class="muet">Un seul lien pour toute l'équipe : bibliothèque de fonds commune, et vous (admin) voyez le travail de chacun et le temps de fabrication de chaque vidéo.</p>
              <label class="champ">Nom de l'équipe<input type="text" id="eq-nom-equipe" value="Ampandranna"></label><button class="btn plein" id="eq-creer" style="align-self:flex-start">Créer l'équipe (je serai l'admin)</button>
              <p class="muet" style="margin:0">Le script « équipe » doit être installé une fois dans Supabase (bouton ci-dessous).</p><button class="btn petit" id="eq-sql" style="align-self:flex-start">Copier le script SQL de l'équipe</button>`
            : `<p style="margin:0">Équipe <b>« ${esc(reglages.equipe.nom)} »</b>${Equipe.admin() ? ' <span class="badge ok">admin</span>' : ''} · vous : <b>${esc(reglages.equipe.membre)}</b> <button class="btn petit" id="eq-renom">Changer mon nom</button></p>
              <label class="cases"><input type="checkbox" id="eq-auto" ${reglages.equipe.auto !== false ? 'checked' : ''}> Partager automatiquement mes nouveaux fonds et images animées avec l'équipe</label>
              <div class="ligne"><button class="btn petit" id="eq-sql2">Copier la mise à jour SQL n° 2</button><span class="muet">(à installer une fois dans Supabase pour les modèles partagés)</span></div>
              <div class="ligne"><a class="btn plein petit" href="#/equipe">${Equipe.admin() ? 'Voir le travail de l\'équipe' : 'Lien de l\'équipe'}</a><button class="btn petit" id="eq-tout">Partager tous mes fonds existants</button><button class="btn petit danger" id="eq-quitter">Quitter l'équipe</button></div>`}
        </div>
        <div class="carte pile"><h3>Base des invités et espace organisateur (Supabase, gratuit)</h3>
          <p class="muet">Active le <b>lien organisateur</b> : votre client y ajoute ses invités, voit qui vient et combien. Les réponses des invités y arrivent directement.</p>
          <label class="champ">Adresse du projet (Project URL)<input type="url" id="sb-url" value="${esc((reglages.supabase || {}).url || '')}" placeholder="https://xxxxxxxx.supabase.co"></label>
          <label class="champ">Clé publique (anon / publishable key)<input type="text" id="sb-anon" value="${esc((reglages.supabase || {}).anon || '')}" placeholder="eyJhbGciOi… ou sb_publishable_…"></label>
          <div class="ligne"><button class="btn plein" id="sb-ok">Enregistrer</button><button class="btn" id="sb-test">Tester</button><span class="muet" id="sb-etat"></span></div>
          <details><summary class="muet" style="cursor:pointer">Installation (une seule fois, 5 minutes)</summary><ol class="muet">
            <li>Créez un compte gratuit sur <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com ↗</a>, puis <b>New project</b> (région la plus proche : par exemple Europe).</li>
            <li>Dans le projet : <b>SQL Editor</b> → <b>New query</b> → collez le script (bouton ci-dessous) → <b>Run</b>.</li>
            <li><b>Project Settings → API</b> (ou <b>Connect</b>) : copiez la <b>Project URL</b> et la clé <b>anon public</b> (ou « publishable ») dans les deux champs ci-dessus, puis Enregistrer et Tester.</li>
            <li>Republiez vos invitations : le lien organisateur apparaît dans l'onglet Film et publication.</li></ol>
            <button class="btn petit" id="sb-sql">Copier le script SQL</button> <button class="btn petit" id="sb-sql2" title="Adultes et enfants invités séparément, par famille">Mise à jour adultes / enfants</button> <button class="btn petit" id="sb-sql3" title="Chaque membre peut récupérer ses invitations depuis la copie en ligne">Mise à jour sauvegarde en ligne</button>
            <p class="muet">La formule gratuite se met en pause après 7 jours sans aucune visite ; une invitation en cours reçoit des visites, sinon réactivez-la d'un clic dans Supabase.</p></details>
        </div>
        <div class="carte pile"><h3>Réponses des invités (Firebase, facultatif)</h3>
          <p class="muet">Sans Firebase, les invités envoient leur réponse par WhatsApp (message prérempli). Avec Firebase, les réponses arrivent directement dans l'onglet Invités.</p>
          <label class="champ">Configuration web Firebase (JSON)<textarea id="fb" rows="7" placeholder='{"apiKey":"...","authDomain":"...","projectId":"..."}'>${reglages.firebase ? esc(JSON.stringify(reglages.firebase, null, 1)) : ''}</textarea></label>
          <button class="btn plein" id="fb-ok">Enregistrer</button>
        </div>
        <div class="carte pile"><h3>Wan 2.2 sur RunPod (ComfyUI)</h3>
          <p class="muet">Pour que le bouton « Générer avec Wan 2.2 » du fond sur mesure envoie la demande à votre pod et récupère la vidéo tout seul.</p>
          <div class="ligne"><button class="btn plein" id="cf-assistant">▶ Démarrer le pod (étapes guidées)</button><span class="muet">Les liens à cliquer, pas à pas.</span></div>
          <label class="champ">Adresse de votre pod ComfyUI<input type="url" id="cf-url" value="${esc((reglages.comfy || {}).url || '')}" placeholder="https://xxxxxxxx-8188.proxy.runpod.net"></label>
          <div class="ligne"><button class="btn plein" id="cf-ok">Enregistrer</button><button class="btn" id="cf-test">Tester</button><span class="muet" id="cf-etat"></span></div>
          <label class="champ">Modèle utilisé<select id="cf-modele">
            <option value="14b" ${((reglages.comfy || {}).modele || '14b') === '14b' ? 'selected' : ''}>Wan 2.2 14B image vers vidéo + lightx2v (pod « One Click - ComfyUI Wan 2.2 », A40)</option>
            <option value="5b" ${(reglages.comfy || {}).modele === '5b' ? 'selected' : ''}>Wan 2.2 5B (modèle officiel ComfyUI, carte 24 Go)</option>
            <option value="perso" ${(reglages.comfy || {}).modele === 'perso' ? 'selected' : ''}>Mon propre workflow (collé ci-dessous)</option></select></label>
          <details><summary class="muet" style="cursor:pointer">Votre propre workflow (facultatif)</summary>
            <p class="muet">Par défaut, le studio utilise le modèle officiel « Wan 2.2 5B image vers vidéo » de ComfyUI. Si vos fichiers de modèle portent d'autres noms ou si vous utilisez le 14B : ouvrez votre workflow image vers vidéo qui marche dans ComfyUI, puis menu <b>Workflow → Export (API)</b>, et collez le contenu du fichier ici. Il doit contenir un nœud « Load Image » et un « Save Video ».</p>
            <textarea id="cf-wf" rows="6" style="width:100%" placeholder='{"1": {"class_type": "UNETLoader", ...}}'>${esc((reglages.comfy || {}).workflow || '')}</textarea></details>
          <div class="carte pile" style="padding:10px;background:#fbf7f1">
            <b>Arrêt automatique du pod (pour ne pas payer pour rien)</b>
            <p class="muet" style="margin:0">Quand le pod ne travaille plus depuis 1 minute, le studio vous demande « Arrêter ou continuer ? ». Sans réponse dans les 30 secondes, le pod s'arrête tout seul, même si le studio est fermé.</p>
            <div class="muet" id="cf-veille">État : vérification…</div>
            <p class="muet" style="margin:0">À faire <b>après chaque démarrage du pod</b> : ouvrez JupyterLab (Connect → port 8888) → Terminal, collez cette commande et appuyez sur Entrée :</p>
            <div class="ligne"><input type="text" readonly value="${esc(Comfy.COMMANDE_VEILLE)}" style="flex:1;font-family:ui-monospace,monospace;font-size:12.5px"><button class="btn petit" id="cf-copier-veille">Copier</button></div>
            <div class="cases"><label><input type="checkbox" id="cf-notif"> Recevoir aussi une notification du navigateur</label></div>
          </div>
          <details><summary class="muet" style="cursor:pointer">Comment trouver l'adresse et autoriser le studio ?</summary><ol class="muet">
            <li>Sur console.runpod.io → <b>Pods</b> → votre pod ComfyUI → <b>Connect</b> → <b>Connect to HTTP Service [Port 8188]</b>. Copiez l'adresse qui s'ouvre (elle finit par <b>-8188.proxy.runpod.net</b>).</li>
            <li>ComfyUI doit accepter les demandes venant du studio : il faut le lancer avec l'option <b>--enable-cors-header</b>. Selon votre modèle de pod, ajoutez-la aux arguments de lancement de ComfyUI (variable d'environnement ou commande de démarrage du template), puis redémarrez le pod.</li>
            <li>Cliquez <b>Tester</b> : le studio affiche la carte graphique du pod si tout va bien.</li>
            <li>Arrêtez le pod quand vous ne vous en servez pas : RunPod facture le temps où il tourne.</li></ol></details>
        </div>
        <div class="carte pile"><h3>Sauvegarde</h3>
          <p class="muet">Vos projets sont gardés dans ce navigateur. Exportez-les régulièrement, ou pour passer sur un autre appareil.</p>
          <div class="ligne"><button class="btn" id="exp-tout">Exporter tous les projets</button><label class="btn">Importer une sauvegarde<input type="file" id="imp-tout" accept=".json" hidden></label></div>
        </div>
      </div>`;
    $('#g-ok').onclick = () => { reglages.github = { owner: $('#g-owner').value.trim(), repo: $('#g-repo').value.trim(), token: $('#g-token').value.trim(), branche: 'main' }; sauverReglages(); toast('Enregistré'); };
    $('#g-test').onclick = async () => {
      reglages.github = { owner: $('#g-owner').value.trim(), repo: $('#g-repo').value.trim(), token: $('#g-token').value.trim(), branche: 'main' };
      sauverReglages();
      try { const r = await fetch(`https://api.github.com/repos/${reglages.github.owner}/${reglages.github.repo}`, { headers: GitHub.entetes() }); const j = await r.json(); $('#g-etat').textContent = r.ok ? (j.permissions && j.permissions.push ? 'Connexion réussie' : 'Connecté, mais sans droit d\'écriture') : 'Échec : ' + (j.message || r.status); }
      catch (e) { $('#g-etat').textContent = 'Échec : ' + e.message; }
    };
    const lireCf = () => { const wf = $('#cf-wf').value.trim(); let modele = $('#cf-modele').value; if (wf && modele !== 'perso' && lireCf.change) modele = 'perso'; reglages.comfy = { url: Comfy.nettoyerUrl($('#cf-url').value), workflow: wf, modele }; sauverReglages(); };
    $('#cf-wf').oninput = () => { if ($('#cf-wf').value.trim()) $('#cf-modele').value = 'perso'; };
    $('#cf-ok').onclick = () => { lireCf(); toast('Enregistré'); };
    $('#cf-assistant').onclick = async () => { lireCf(); if (!(reglages.comfy || {}).url) { toast('Collez d\'abord l\'adresse de votre pod'); return; } if (await assistantPod({ raison: 'Préparons le pod.' })) route(); };
    $('#cf-copier-veille').onclick = () => copier(Comfy.COMMANDE_VEILLE);
    $('#cf-notif').checked = !!(window.Notification && Notification.permission === 'granted');
    $('#cf-notif').onchange = e => { if (e.target.checked && window.Notification) Notification.requestPermission().then(p => { e.target.checked = p === 'granted'; }); };
    (async () => { const el = $('#cf-veille'); const cf = reglages.comfy || {}; if (!cf.url) { el.textContent = 'État : renseignez d\'abord l\'adresse du pod.'; return; }
      try { const e = await Comfy.etatVeille(cf.url); el.innerHTML = e.etat === 'arret' ? 'État : le pod s\'est arrêté (' + esc(e.raison) + ').' : '<span class="badge ok">Surveillance active</span> ' + (e.etat === 'actif' ? 'le pod travaille' : e.etat === 'telechargement' ? 'le pod télécharge les modèles' : 'inactif depuis ' + e.inactif + ' s'); }
      catch (err) { el.innerHTML = '<span class="badge alerte">Surveillance non installée</span> ou pod arrêté : collez la commande ci-dessous dans le terminal du pod.'; } })();
    $('#cf-test').onclick = async () => { lireCf(); $('#cf-etat').textContent = 'Test…'; try { $('#cf-etat').textContent = 'Connexion réussie : ' + await Comfy.tester(reglages.comfy.url); } catch (e) { $('#cf-etat').textContent = e.message; } };
    const lireSb = () => { const u = $('#sb-url').value.trim().replace(/\/+$/, ''), a = $('#sb-anon').value.trim(); reglages.supabase = u && a ? { url: u, anon: a } : null; sauverReglages(); };
    const eqc = $('#eq-creer'); if (eqc) eqc.onclick = async () => {
      const nom = await demanderNom('Votre nom dans l\'équipe', ''); if (!nom) return;
      try { const r = await Base.rpc(reglages.supabase, 'equipe_creer', { p_nom: $('#eq-nom-equipe') ? $('#eq-nom-equipe').value.trim() : 'Équipe' });
        reglages.equipe = { id: r.id, nom: r.nom, cle: r.cle, cle_admin: r.cle_admin, membre: nom, auto: true }; sauverReglages(); toast('Équipe créée : envoyez le lien d\'équipe à vos membres'); location.hash = '#/equipe'; }
      catch (e) { toast(/function|schema cache|Could not find/i.test(e.message) ? 'Installez d\'abord le script SQL de l\'équipe dans Supabase' : e.message); }
    };
    const sbs3 = $('#sb-sql3'); if (sbs3) sbs3.onclick = async () => { try { copier(await (await fetch('../outils/sauvegarde.sql?v=' + Date.now())).text()); toast('Script copié : Supabase → SQL Editor → coller → Run'); } catch (e) { toast('Script introuvable'); } };
    const sbs2 = $('#sb-sql2'); if (sbs2) sbs2.onclick = async () => { try { copier(await (await fetch('../outils/invites-2.sql?v=' + Date.now())).text()); toast('Script copié : Supabase → SQL Editor → coller → Run'); } catch (e) { toast('Script introuvable'); } };
    const eqs2 = $('#eq-sql2'); if (eqs2) eqs2.onclick = async () => { try { copier(await (await fetch('../outils/equipe-2.sql?v=' + Date.now())).text()); toast('Script copié : Supabase → SQL Editor → coller → Run'); } catch (e) { toast('Script introuvable'); } };
    const eqs = $('#eq-sql'); if (eqs) eqs.onclick = async () => { try { copier(await (await fetch('../outils/equipe.sql?v=' + Date.now())).text()); toast('Script copié : Supabase → SQL Editor → coller → Run'); } catch (e) { toast('Script introuvable'); } };
    const eqr = $('#eq-renom'); if (eqr) eqr.onclick = async () => { const n = await demanderNom('Votre nom dans l\'équipe', reglages.equipe.membre); if (n) { reglages.equipe.membre = n; sauverReglages(); vueReglages(); } };
    const eqa = $('#eq-auto'); if (eqa) eqa.onchange = () => { reglages.equipe.auto = eqa.checked; sauverReglages(); };
    const eqt = $('#eq-tout'); if (eqt) eqt.onclick = async () => {
      const l = medias.filter(m => (m.type === 'fond' || m.anime) && !m.equipe_id && !m.brouillon && /^idb:/.test(m.src));
      if (!l.length) return toast('Tous vos fonds sont déjà partagés');
      eqt.disabled = true; let n = 0;
      for (const m of l) { eqt.textContent = 'Partage… ' + (n + 1) + ' / ' + l.length; try { await Equipe.partager(m, projets[m.evt] && projets[m.evt].fiche.titre); n++; } catch (e) { toast(m.nom + ' : ' + e.message); } }
      eqt.disabled = false; eqt.textContent = 'Partager tous mes fonds existants'; toast(n + ' fichier(s) partagé(s) avec l\'équipe');
    };
    const eqq = $('#eq-quitter'); if (eqq) eqq.onclick = () => { if (!confirm('Quitter l\'équipe sur cet ordinateur ? (Vos fichiers restent ici ; vous pourrez revenir avec le lien.)')) return; reglages.equipe = null; sauverReglages(); vueReglages(); };
    $('#sb-ok').onclick = () => { lireSb(); toast(reglages.supabase ? 'Base des invités enregistrée' : 'Base des invités désactivée'); };
    $('#sb-test').onclick = async () => {
      lireSb(); const e = $('#sb-etat');
      if (!reglages.supabase) { e.textContent = 'Renseignez l\'adresse et la clé.'; return; }
      e.textContent = 'Test…';
      try { await Base.rpc(reglages.supabase, 'inv_famille', { p_evt: 'test', p_code: 'test' }); e.innerHTML = '<span class="badge ok">Connexion réussie</span> le script est bien installé.'; }
      catch (err) { e.textContent = /function|schema cache|Could not find/i.test(err.message) ? 'Connecté, mais le script SQL n\'est pas encore installé (étape 2).' : 'Échec : ' + err.message; }
    };
    $('#sb-sql').onclick = async () => { try { copier(await (await fetch('../outils/supabase.sql?v=' + Date.now())).text()); toast('Script copié : collez-le dans Supabase → SQL Editor'); } catch (e) { toast('Script introuvable'); } };
    $('#fb-ok').onclick = () => { const v = $('#fb').value.trim(); if (!v) { reglages.firebase = null; sauverReglages(); return toast('Firebase désactivé'); } try { const t = v.replace(/^[^{]*/, '').replace(/[^}]*$/, ''); reglages.firebase = JSON.parse(t.replace(/(\w+)\s*:/g, '"$1":').replace(/""/g, '"').replace(/'/g, '"')); sauverReglages(); toast('Firebase enregistré'); } catch (e) { toast('Configuration illisible'); } };
    $('#exp-tout').onclick = () => telecharger('studio-sauvegarde.json', JSON.stringify({ projets, medias: medias.map(m => Object.assign({}, m)) }, null, 1));
    $('#imp-tout').onchange = async e => { try { const j = JSON.parse(await e.target.files[0].text()); Object.assign(projets, j.projets || {}); sauverProjets(); toast('Sauvegarde importée'); } catch (err) { toast('Fichier invalide'); } };
  }

  /* ================= Mode d'emploi ================= */
  function vueGuide() {
    const etape = (n, titre, corps) => `<div class="carte pile" id="g${n}"><h2 style="display:flex;gap:12px;align-items:center"><span class="logo-sceau" style="font-family:Inter;font-size:16px;font-weight:700">${n}</span>${titre}</h2>${corps}</div>`;
    $('#app').innerHTML = `<div class="entete"><div><h1>Mode d'emploi</h1><p>De la réception du texte du client à l'envoi des liens et du film.</p></div></div>
      <div class="pile" style="max-width:900px">
      ${etape(0, 'Une seule fois : mettre le site en ligne', `
        <ol><li>Sur <b>github.com</b>, créez un dépôt public nommé <b>STUDIO</b>.</li>
        <li>Dans ce dépôt : <b>Add file → Upload files</b>, glissez tout le contenu du dossier du site (index.html, studio, i, moteur, fonds…), puis <b>Commit changes</b>.</li>
        <li><b>Settings → Pages</b> → Branch : <b>main</b> → <b>Save</b>. Après 1 à 10 minutes, le site est à l'adresse <b>https://votre-compte.github.io/STUDIO/</b>.</li>
        <li>Ouvrez toujours le studio depuis cette adresse : <b>https://votre-compte.github.io/STUDIO/studio/</b>. Ouvert depuis un dossier de l'ordinateur, l'image test et l'enregistrement du film ne marchent pas.</li>
        <li>Dans <a href="#/reglages">Réglages</a>, collez un jeton GitHub (la marche à suivre y est expliquée) : le bouton « Publier » enverra ensuite les invitations en ligne tout seul.</li></ol>`)}
      ${etape(1, 'Préparer les fonds vidéo', `
        <p>Les 4 fonds de base sont déjà là. Pour en ajouter : <a href="#/bibliotheque">Bibliothèque</a> → <b>Importer un fond vidéo</b> (format vertical 9:16, 1080 × 1920 si possible, au moins 6 secondes).</p>
        <p>Pour chaque fond importé, choisissez son <b>usage</b> (ouverture, titre, programme, confirmation, remerciement) et décrivez-le en une phrase : l'IA s'en sert pour placer les textes.</p>
        <p>Photos et vidéos du client : <b>+ Photo ou vidéo</b>, puis dans un plan <b>+ Média</b>.</p>`)}
      ${etape(2, 'Créer l\'événement à partir du texte', `
        <ol><li><a href="#/nouveau">Événements → + Nouvel événement</a>.</li>
        <li>Collez le texte du client tel quel (malgache ou français). Mettez des pointillés « ……… » à la place du nombre d'invités et une ligne « Sary : titre ».</li>
        <li><b>Analyser le texte</b>. Si le résultat est mauvais, utilisez plutôt <b>Copier le prompt 0</b>, collez-le dans ChatGPT ou Claude, puis recollez sa réponse et cliquez <b>Utiliser cette réponse</b>.</li>
        <li>Relisez la <b>fiche</b> : noms, date, heure, date limite, lieux, contacts, phrase de remerciement. Corrigez ce qui est faux.</li>
        <li>Cochez les <b>fonds</b> à utiliser, puis <b>Créer les plans</b>. Le studio fabrique l'ouverture, un plan par idée, la confirmation et le remerciement.</li></ol>`)}
      ${etape(3, 'Monter les plans', `
        <ul><li><b>À gauche</b>, la liste des plans. ▲ ▼ pour déplacer un plan intermédiaire, ⧉ pour le dupliquer, ✕ pour le supprimer, <b>+ Plan intermédiaire</b> pour en ajouter. L'ouverture, la confirmation et le remerciement restent à leur place.</li>
        <li><b>Au centre</b>, l'aperçu. Cliquez un texte ou un bouton pour le choisir, glissez-le pour le déplacer. Le curseur sous l'aperçu montre un instant précis du plan.</li>
        <li><b>Directement sur l'aperçu</b>, comme dans Canva : <b>double-clic</b> sur un texte ou un bouton pour écrire dedans (Échap ou clic ailleurs pour valider) ; <b>coins</b> pour agrandir ou réduire, <b>côtés</b> pour élargir ; glisser pour déplacer (le centre est aimanté) ; <b>flèches</b> pour ajuster finement (Maj = plus grand pas) ; <b>Ctrl+C / Ctrl+V</b> pour copier-coller un calque, aussi vers un autre plan ou un autre événement ; Ctrl+X couper, <b>Ctrl+D</b> dupliquer, <b>Suppr</b> supprimer, Ctrl+Z annuler ; coller une image ou un texte copié ailleurs le pose sur le plan ; <b>clic droit</b> pour le menu (premier plan, arrière-plan, centrer…). <b>Mise en forme</b> : <b>Ctrl+Alt+C</b> copie le style d'un calque (police, taille, couleur, gras, ombre, animations…) et <b>Ctrl+Alt+V</b> le colle sur un autre ; le <b>pinceau 🖌</b> de la barre copie le style puis l'applique à chaque calque cliqué (Échap pour arrêter) ; le clic droit permet aussi de coller le style sur tous les textes du plan ou de toute l'invitation. La barre au-dessus de l'aperçu donne les réglages rapides : taille, couleur, gras, italique, alignement.</li>
        <li><b>À droite</b>, les réglages : fond, durée, transition, puis les calques (+ Texte, + Bouton, + Compteur, + Média) et leurs propriétés : police, taille, couleur, animation, moment d'entrée.</li>
        <li><b>▶ Plan</b> joue le plan, <b>▶ Toute l'invitation</b> joue tout. « Voir : lien personnel / lien général » montre ce que voit une famille ou un groupe.</li>
        <li><b>↶</b> annule, <b>↷</b> rétablit. Tout s'enregistre seul.</li></ul>
        <p class="muet">Textes variables : {famille}, {places}, {date}, {heure}, {date_limite}, {compte_a_rebours} sont remplacés automatiquement.</p>`)}
      ${etape('3b', 'Fond, photos et animations d\'un plan', `
        <ul><li><b>Fond vidéo</b> (en haut à droite) : choisissez un fond de la bibliothèque, ou <b>Importer un fond</b> directement depuis le plan. Le studio indique combien de plans utilisent déjà ce fond.</li>
        <li><b>✨ Créer un fond sur mesure (IA)</b> : quand il vous manque un fond, ou qu'un même fond revient trop souvent. Deux façons : <b>Recolorer</b> une vidéo déjà prête aux couleurs du fond actuel (gratuit, ici même ; ou avec Claude pour plus de précision), ou <b>Wan 2.2</b>, qui crée une nouvelle vidéo sur votre pod, en partant soit de l'image du fond actuel, soit de <b>votre propre photo ou vidéo</b> (le studio la recadre et la passe d'abord aux couleurs du fond actuel, puis Wan l'anime dans le thème). Pour Wan, ajoutez si vous voulez une idée et le mouvement : le studio ajoute tout seul le thème, les couleurs et la place à laisser à chaque calque (liste dans « Calques pris en compte »). La vidéo s'affiche à droite ; « Harmoniser ses couleurs » la rapproche du fond actuel si besoin, puis <b>Utiliser ce fond</b>.</li>
        <li><b>✨ Créer avec l'IA</b> se trouve dans la <a href="#/bibliotheque">Bibliothèque</a> : choisissez l'événement en haut, puis « ✨ Créer avec l'IA ». Choisissez le plan de référence (son fond sert de modèle, ses calques gardent leur place), créez, puis « Ranger dans la bibliothèque » ; cochez « Mettre aussi sur le plan » pour l'y poser directement. Depuis un plan, le bouton « ✨ Créer avec l'IA (Bibliothèque) » vous y emmène avec le bon événement et le bon plan.</li>
        <li><b>Animer une image</b> : dans « ✨ Créer avec l'IA », choix <b>Animer une image</b>, ou bouton « ✨ Animer cette photo » dans le panneau d'une photo. Choisissez la photo du plan (ou ＋ une autre image) et le mouvement (naturel, zoom lent, léger vent, pétales, lumière). Wan 2.2 en fait une vidéo de 5 s en gardant les visages identiques ; elle remplace la photo sur le plan (ou s'y ajoute), au-dessus du fond.</li>
        <li><b>🌐 Plusieurs langues</b> : onglet Fiche → « Langues de l'invitation », cochez les langues à proposer (English, Français…). Sous l'aperçu, <b>🌐 Traduire</b> : copiez le prompt, collez-le dans Claude ou ChatGPT, collez la réponse, « Appliquer ». Chaque texte a aussi ses traductions modifiables à la main (panneau du calque → Traductions). « Voir en : … » montre l'aperçu dans une autre langue. Dans l'invitation, l'invité choisit sa langue à l'ouverture ou avec le bouton 🌐 : tout bascule d'un clic.</li>
        <li><b>♪ Chanson</b> : bouton « ♪ Ajouter une chanson » sous l'aperçu. Choisissez le fichier (tous les formats : MP3, M4A, WAV, FLAC, OGG, AIFF… et même une vidéo, dont on garde le son ; les formats moins courants sont convertis en MP3 tout seuls), réglez le volume et le moment où elle commence (« Position actuelle » pour sauter l'introduction). Elle joue avec « ▶ Toute l'invitation », chez l'invité et dans le film exporté.</li>
        <li><b>📏 Règles et repères</b> : bouton « Règles » sous l'aperçu, puis tirez depuis une règle. Les éléments s'aimantent au centre, aux repères et aux autres éléments (Maj = sans aimant). <b>Plusieurs éléments</b> : Maj+clic, cadre de sélection ou Ctrl+A, puis glisser, flèches ou boutons d'alignement. <b>⏸ Pause</b> : bouton ou barre d'espace pendant la lecture.</li>
        <li><b>Polices, emojis, illustrations</b> : bouton de police (aperçu de chaque police), 😊 pour un emoji, « + Illustration » pour un dessin recolorable. <b>Fond</b> : Vidéo, Photo, Couleur (dégradé possible) ou Sans fond. <b>⬚ Rogner</b> : garder une partie d'une vidéo ou d'une photo.</li>
        <li><b>✂ Couper</b> : sur le fond d'un plan (panneau Fond vidéo) ou sur une vidéo posée, « ✂ Couper » : réglez Début et Fin (ou « Position actuelle » pendant la lecture), « ▶ Voir le passage », puis Appliquer. <b>Superposition</b> : dans le panneau d'une photo, d'une vidéo ou d'un texte, choisissez comment il se mélange au fond (Produit pour garder les ombres, Écran pour les lumières, Superposition…).</li>
        <li><b>👥 Équipe</b> : l'admin crée l'équipe dans Réglages et envoie <b>le lien d'équipe</b> (un seul pour tous). Chaque membre l'ouvre et entre son nom. Les nouveaux fonds et images animées sont partagés tout seuls dans la <b>bibliothèque de l'équipe</b> (Bibliothèque, en bas), que tout le monde peut utiliser dans ses plans. L'admin voit dans <a href="#/equipe">Équipe</a> le travail de chacun, toutes les invitations, et le temps de fabrication de chaque vidéo.</li>
        <li><b>Bibliothèque par événement</b> : tout ce que vous créez ou importez dans un événement (fonds IA, images animées, photos) est rangé dans sa bibliothèque, et seuls ses fichiers sont proposés dans ses plans (avec les fonds de base et les fichiers communs). Dans <a href="#/bibliotheque">Bibliothèque</a>, choisissez l'événement en haut ; « Réglages » d'un fichier permet de le déplacer vers un autre événement.</li>
        <li><b>Wan 2.2</b> (gratuit, open source) : il tourne sur votre pod RunPod (ComfyUI). Le studio lui envoie l'image du fond actuel et le prompt, puis récupère la vidéo (5 s, environ 5 minutes) : vous n'avez rien à copier ni à télécharger. L'adresse du pod se règle une seule fois dans Réglages.</li>
        <li><b>Démarrer le pod</b> : cliquez simplement sur « ▶ Générer avec Wan 2.2 ». Si le pod est éteint, le studio ouvre un assistant avec les liens à cliquer (Start sur RunPod, puis le terminal pour l'arrêt automatique) et coche chaque étape tout seul ; la génération démarre d'elle-même quand Wan 2.2 est prêt (5 à 20 min après Start). Le même assistant est dans Réglages → « Démarrer le pod ».</li>
        <li><b>Arrêt automatique du pod RunPod</b> : après chaque démarrage du pod, collez dans son terminal JupyterLab la commande donnée par l'assistant (ou dans Réglages). Ensuite, si le pod ne travaille plus depuis 1 minute, le studio affiche « Arrêter ou continuer ? ». Sans réponse dans les 30 secondes, le pod s'arrête tout seul (même studio fermé). Pour le relancer : RunPod → Pods → ▶ Start.</li>
        <li><b>+ Photo / vidéo</b> : choisissez un fichier sur l'ordinateur ou le téléphone ; il est posé tout de suite sur le plan. Réglez sa taille, sa forme (ronde, arrondie), sa bordure.</li>
        <li><b>Animation</b> d'un texte ou d'une photo : un effet d'<b>entrée</b> (fondu, lettre par lettre, mot par mot, zoom, rebond, flou, glissement…) et un effet de <b>sortie</b>, chacun avec son moment et sa durée. <b>▶ Voir l'animation</b> pour vérifier.</li>
        <li><b>Éviter les chevauchements de textes</b> : remet les textes du plan les uns sous les autres, sans qu'ils se touchent.</li></ul>`)}
      ${etape(4, 'Finaliser un plan avec ChatGPT ou Claude', `
        <ol><li>Sur le plan choisi : <b>✨ Finaliser ce plan avec l'IA</b>.</li>
        <li><b>Copier le prompt</b>, puis <b>Télécharger l'image du plan</b>.</li>
        <li>Dans ChatGPT ou Claude : collez le prompt et joignez l'image, envoyez.</li>
        <li>Dans la réponse, cliquez sur <b>« Copier »</b> en haut du bloc de code (le petit bouton du bloc), puis collez dans le studio.</li>
        <li><b>Vérifier la réponse</b> : le studio montre <b>Avant / Après</b>. <b>Appliquer</b> ou <b>Garder l'ancien</b>.</li></ol>
        <p>Pour une retouche précise : « Corriger un détail plutôt », écrivez le problème (« le nom est coupé »), copiez ce prompt de retouche.</p>
        <p><b>✨ Composer tous les plans avec l'IA</b> (sous la liste des plans) refait toute l'invitation d'un coup avec un style commun.</p>`)}
      ${etape(5, 'Les invités', `
        <ol><li>Onglet <b>Invités</b> → <b>Modèle Excel vide</b>, remplissez-le (Famille, Catégorie, Adultes, Enfants, Téléphone, Table), puis <b>Importer Excel</b>. Ou <b>+ Famille</b> une par une.</li>
        <li>Chaque famille reçoit un lien personnel : <b>Copier</b>, <b>WhatsApp</b> (message prérempli, modifiable en bas de page) ou <b>Voir</b>.</li>
        <li>Avec la <b>base des invités</b> (Réglages, une seule fois) : les réponses arrivent toutes seules, et la liste se synchronise avec l'espace organisateur du client. Sans elle, les familles répondent par WhatsApp : changez alors leur <b>Statut</b> à la main.</li>
        <li>Écrivez un numéro dans la colonne <b>Table</b> : le plan de tables affiche le remplissage de chaque table.</li></ol>`)}
      ${etape(6, 'Film, publication et envoi', `
        <ol><li>Onglet <b>Film et publication</b> → <b>Ajouter une musique</b> (dont vous avez les droits).</li>
        <li><b>Enregistrer le film</b> : laissez l'onglet ouvert pendant toute la durée du film ; le MP4 se télécharge à la fin. Utilisez Chrome sur ordinateur.</li>
        <li><b>Aperçu</b> : vérifiez le lien général et le lien personnel.</li>
        <li><b>Publier l'invitation</b> (GitHub relié dans Réglages, une seule fois). Tant que ce n'est pas fait, les liens affichent « Invitation introuvable ». Les liens marchent 1 à 10 minutes après la publication.</li>
        <li><b>Deux liens pour le client</b> (carte Liens) :
          <ul><li><b>Lien des invités</b> : le lien général (groupes, réseaux sociaux) et les liens personnels de chaque famille. Les invités y voient l'invitation et confirment.</li>
          <li><b>Lien organisateur</b> (privé, base des invités activée) : le client y ajoute ses invités ou importe son Excel, envoie chaque lien par WhatsApp, et voit en direct qui vient, combien d'adultes et d'enfants, et les messages. Pas besoin de republier quand il ajoute des invités.</li></ul></li>
        <li><b>Vitrine du site</b> : cochez « Montrer aussi sur la vitrine » avant de publier. Par défaut les noms et téléphones sont remplacés par des exemples ; « telle quelle » seulement avec l'accord du client. « Retirer de la vitrine » l'enlève.</li>
        <li>Envoyez le film et le lien général dans les groupes, et le lien personnel à chaque famille.</li></ol>`)}
      ${etape('6b', 'Enregistrement automatique', `
        <ul><li>Tout ce que vous faites dans un événement est enregistré au fur et à mesure dans ce navigateur (« Enregistré » en haut à droite).</li>
        <li>Chaque vidéo créée (Wan 2.2, image animée, recoloration) est gardée en <b>brouillon</b> dans la bibliothèque de l'événement dès qu'elle arrive.</li>
        <li>Si l'ordinateur s'éteint ou si la connexion coupe pendant une génération Wan 2.2, le pod continue : au prochain démarrage du studio, la vidéo est récupérée toute seule et rangée en brouillon (si le pod est encore allumé, dans les 48 h).</li>
        <li>Dans la Bibliothèque, « Garder » range un brouillon définitivement. Pensez aussi à <b>Réglages → Exporter une sauvegarde</b> de temps en temps.</li></ul>`)}
      ${etape(7, 'En cas de problème', `
        <table class="tableau"><thead><tr><th>Ce que vous voyez</th><th>Que faire</th></tr></thead><tbody>
        <tr><td>« La réponse collée est incomplète ou abîmée »</td><td>Dans ChatGPT, utilisez le bouton « Copier » du bloc de code, pas la sélection à la souris. Vérifiez que la réponse est complète (elle finit par } ).</td></tr>
        <tr><td>« Invitation introuvable »</td><td>L'invitation n'est pas encore publiée, ou la publication n'est pas encore visible : attendez 10 minutes.</td></tr>
        <tr><td>Image test ou film impossible</td><td>Ouvrez le studio depuis son adresse en ligne (github.io), pas depuis un dossier.</td></tr>
        <tr><td>Les modifications n'apparaissent pas sur le téléphone</td><td>Attendez 10 minutes après la publication, puis rouvrez le lien en navigation privée.</td></tr>
        <tr><td>Changement d'ordinateur</td><td>Réglages → Exporter tous les projets, puis Importer une sauvegarde sur l'autre ordinateur.</td></tr>
        </tbody></table>`)}
      </div>`;
  }

  /* ================= Assistant « Démarrer le pod » ================= */
  // Guide pas à pas avec les liens à cliquer ; chaque étape se coche toute seule.
  // Renvoie une promesse : true quand tout est prêt, false si l'utilisateur ferme.
  function assistantPod(opts) {
    opts = opts || {};
    const cf = reglages.comfy || {};
    const base = cf.url, id = Comfy.idPod(base);
    const wf = cf.modele === 'perso' ? null : (Comfy.WORKFLOWS[cf.modele || '14b'] || Comfy.WORKFLOW_14B);
    const lienPod = id ? 'https://console.runpod.io/pods?id=' + id : 'https://console.runpod.io/pods';
    const lienJup = id ? 'https://' + id + '-8888.proxy.runpod.net/lab' : '';
    if (assistantPod.ouvert) assistantPod.ouvert.remove();
    const d = document.createElement('div'); d.className = 'assistant-pod'; assistantPod.ouvert = d;
    d.innerHTML = `<div class="ap-boite">
      <button class="modale-fermer ap-fermer" aria-label="Fermer">×</button>
      <h3 style="margin:0">Démarrer le pod Wan 2.2</h3>
      <p class="muet" style="margin:0">${esc(opts.raison || 'Le pod est éteint.')} Suivez les étapes : chacune se coche toute seule dès qu'elle est faite.</p>
      <ol class="ap-etapes">
        <li data-e="1"><span class="ap-coche"></span><div><b>Allumer le pod</b>
          <div>${id ? '' : 'Ouvrez votre pod sur RunPod. '}<a class="btn petit plein" href="${lienPod}" target="_blank" rel="noopener">Ouvrir mon pod sur RunPod ↗</a></div>
          <div class="muet">Dans la page qui s'ouvre, cliquez sur le bouton violet <b>▶ Start</b>. Revenez ensuite ici (ne fermez pas cette fenêtre).
          Si RunPod dit qu'aucune carte n'est libre, réessayez quelques minutes plus tard.</div>
          <div class="ap-etat muet"></div></div></li>
        ${id ? `<li data-e="2"><span class="ap-coche"></span><div><b>Activer l'arrêt automatique</b> <span class="muet">(pendant que le pod démarre)</span>
          <div class="muet">1. <a href="${lienJup}" target="_blank" rel="noopener">Ouvrir le terminal du pod (JupyterLab) ↗</a> — disponible 1 à 2 minutes après Start.<br>
          2. Dans JupyterLab, cliquez sur la tuile <b>Terminal</b> (ou menu File → New → Terminal).<br>
          3. Copiez cette commande, collez-la dans le terminal (clic droit → Coller, ou Ctrl+V) et appuyez sur <b>Entrée</b> :</div>
          <div class="ligne"><input type="text" readonly value="${esc(Comfy.COMMANDE_VEILLE)}" style="flex:1;font-family:ui-monospace,monospace;font-size:12px"><button class="btn petit" data-copier>Copier</button></div>
          <div class="ap-etat muet"></div></div></li>` : ''}
        <li data-e="3"><span class="ap-coche"></span><div><b>Attendre que Wan 2.2 soit prêt</b>
          <div class="muet">Le pod télécharge les modèles à chaque démarrage : comptez <b>5 à 20 minutes</b>. Rien à faire, le studio vérifie tout seul.</div>
          <div class="ap-etat muet"></div></div></li>
      </ol>
      <div class="ap-fin muet"></div>
      <div class="ligne"><button class="btn" data-fermer>${opts.suite ? 'Annuler' : 'Fermer'}</button><span class="muet ap-chrono"></span></div>
    </div>`;
    document.body.appendChild(d);
    const $e = n => $('[data-e="' + n + '"]', d);
    const marquer = (n, ok, texte) => { const li = $e(n); if (!li) return; li.classList.toggle('fait', !!ok); if (texte != null) $('.ap-etat', li).textContent = texte; };
    const copie = $('[data-copier]', d); if (copie) copie.onclick = () => copier(Comfy.COMMANDE_VEILLE);
    const debut = Date.now();
    let fini = false, minuterie;
    return new Promise(resoudre => {
      const fermer = ok => { if (fini) return; fini = true; clearTimeout(minuterie); d.remove(); if (assistantPod.ouvert === d) assistantPod.ouvert = null; resoudre(ok); };
      $('.ap-fermer', d).onclick = () => fermer(false); $('[data-fermer]', d).onclick = () => fermer(false);
      const tour = async () => {
        if (fini) return;
        const s = Math.round((Date.now() - debut) / 1000);
        $('.ap-chrono', d).textContent = 'Vérification automatique… ' + Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0');
        const up = await Comfy.joignable(base);
        marquer(1, up, up ? 'Pod allumé.' : 'En attente : le pod ne répond pas encore.');
        let veille = !id;
        if (id) {
          if (up) { try { const e = await Comfy.etatVeille(base); veille = e.etat !== 'arret'; } catch (e) { veille = false; } }
          marquer(2, veille, veille ? 'Arrêt automatique activé.' : (up ? 'Pas encore activé : collez la commande dans le terminal.' : ''));
        }
        let modeles = false;
        if (up) {
          if (!wf) modeles = true;
          else { try { const m = await Comfy.modelesPrets(base, wf); modeles = !m.length; marquer(3, modeles, modeles ? 'Wan 2.2 est prêt.' : 'Téléchargement en cours (' + m.length + ' fichier' + (m.length > 1 ? 's' : '') + ' encore manquant' + (m.length > 1 ? 's' : '') + ')…'); } catch (e) { marquer(3, false, 'ComfyUI démarre…'); } }
          if (!wf) marquer(3, true, 'ComfyUI répond.');
        } else marquer(3, false, '');
        if (up && modeles && veille) {
          $('.ap-fin', d).innerHTML = '<b style="color:#2e7d32">✓ Tout est prêt.</b> ' + (opts.suite ? 'La génération démarre…' : 'Vous pouvez générer vos fonds.');
          setTimeout(() => fermer(true), opts.suite ? 1200 : 2500); return;
        }
        if (up && modeles && !veille) $('.ap-fin', d).innerHTML = 'Wan 2.2 est prêt. Activez l\'arrêt automatique (étape 2) pour ne pas payer un pod qui ne fait rien. <button class="btn petit" data-sans>Continuer sans</button>';
        const sans = $('[data-sans]', d); if (sans) sans.onclick = () => fermer(true);
        minuterie = setTimeout(tour, 5000);
      };
      tour();
    });
  }
  // Avant toute génération : si le pod n'est pas prêt, ouvrir l'assistant.
  async function podPret() {
    const cf = reglages.comfy || {};
    if (!cf.url) { toast('Collez d\'abord l\'adresse de votre pod dans Réglages'); location.hash = '#/reglages'; return false; }
    const up = await Comfy.joignable(cf.url);
    if (up) {
      const wf = cf.modele === 'perso' ? null : (Comfy.WORKFLOWS[cf.modele || '14b'] || Comfy.WORKFLOW_14B);
      let manque = [];
      if (wf) { try { manque = await Comfy.modelesPrets(cf.url, wf); } catch (e) {} }
      if (!manque.length) return true;
      return assistantPod({ suite: true, raison: 'Le pod est allumé mais Wan 2.2 n\'est pas encore prêt.' });
    }
    return assistantPod({ suite: true, raison: 'Le pod est éteint.' });
  }

  /* ================= Veille du pod RunPod ================= */
  // Toutes les 10 s : si le pod ne travaille plus depuis 1 min, on demande « Arrêter ou continuer ? ».
  // Sans réponse, le pod s'arrête lui-même 30 s plus tard (script de veille installé sur le pod).
  const Veille = { etat: null, boite: null, titre: document.title, cligne: null };
  function boiteVeille(e) {
    const reste = Math.max(0, Math.round((e.arret || 90) - (e.inactif || 0)));
    if (!Veille.boite) {
      Veille.boite = document.createElement('div');
      Veille.boite.className = 'veille-alerte';
      Veille.boite.innerHTML = `<b>Le pod RunPod ne travaille plus depuis 1 minute.</b><div>Il est facturé tant qu'il tourne. Sans réponse, il s'arrêtera tout seul dans <b class="veille-reste"></b> s.</div>
        <div class="ligne"><button class="btn plein" data-v="continuer">Continuer</button><button class="btn danger" data-v="arreter">Arrêter maintenant</button></div>`;
      document.body.appendChild(Veille.boite);
      Veille.boite.onclick = async ev => {
        const quoi = ev.target.dataset.v; if (!quoi) return;
        try { await Comfy.signalVeille(reglages.comfy.url, quoi); toast(quoi === 'continuer' ? 'Le pod continue : nouvelle alerte après 1 minute sans travail' : 'Arrêt du pod demandé'); }
        catch (e) { toast(e.message); }
        Veille.pause = Date.now() + 15000; Veille.etat = null; fermerVeille();
      };
      Veille.cligne = setInterval(() => { document.title = document.title === Veille.titre ? '⚠ Pod inactif — arrêter ?' : Veille.titre; }, 1000);
      try { if (window.Notification && Notification.permission === 'granted') new Notification('Pod RunPod inactif', { body: 'Arrêter ou continuer ? Arrêt automatique dans ' + reste + ' s.' }); } catch (e) {}
    }
    $('.veille-reste', Veille.boite).textContent = reste;
  }
  function fermerVeille() { if (Veille.boite) { Veille.boite.remove(); Veille.boite = null; } clearInterval(Veille.cligne); Veille.cligne = null; document.title = Veille.titre; }
  async function surveiller() {
    const cf = reglages.comfy || {};
    if (!cf.url || cf.veille === false) { fermerVeille(); Veille.etat = null; return; }
    if (Veille.pause && Date.now() < Veille.pause) return;
    try {
      const e = await Comfy.etatVeille(cf.url);
      if (Veille.pause && Date.now() < Veille.pause) return;
      Veille.etat = e;
      if (e.etat === 'arret') { fermerVeille(); return; }
      if (e.etat === 'inactif' && e.inactif >= (e.alerte || 60)) boiteVeille(e); else fermerVeille();
    } catch (err) { Veille.etat = null; fermerVeille(); }
  }
  setInterval(surveiller, 10000); setTimeout(surveiller, 2000);
  // le compte à rebours avance entre deux vérifications
  setInterval(() => { if (Veille.boite && Veille.etat) { Veille.etat.inactif += 1; boiteVeille(Veille.etat); } }, 1000);

  route();
  // reprise après coupure : la copie de secours est-elle plus récente ?
  Sauve.reprendreTout().then(n => { if (n) { toast('Bibliothèque et réglages repris depuis la sauvegarde automatique'); setTimeout(() => location.reload(), 1200); } else Sauve.toutMaintenant(); });
  if (Sauve.accAttente) setTimeout(() => Sauve.accEnLigne(0), 6000);
  else if (Equipe.actif()) { const der = Stock.lire('studio.sauve.acc.date', 0); if (Date.now() - der > 24 * 3600e3) setTimeout(() => Sauve.accEnLigne(0), 20000); }
  if (Equipe.actif()) setTimeout(() => Equipe.rattraper(), 25000);
  window.addEventListener('online', () => setTimeout(() => Equipe.rattraper(), 8000));
  Sauve.reprendre().then(n => { if (n) { toast(n + ' invitation(s) reprise(s) depuis la sauvegarde automatique'); route(); } });
})();
