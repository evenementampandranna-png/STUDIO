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
  const Stock = {
    lire(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Mémoire du navigateur pleine : exportez vos projets.'); return false; } }
  };
  let projets = Stock.lire('studio.projets', {});
  let medias = Stock.lire('studio.medias', []);
  let reglages = Stock.lire('studio.reglages', { github: { owner: '', repo: '', branche: 'main', token: '' }, firebase: null });
  const sauverProjets = () => Stock.ecrire('studio.projets', projets);
  const sauverMedias = () => Stock.ecrire('studio.medias', medias);
  const sauverReglages = () => Stock.ecrire('studio.reglages', reglages);

  const IDB = {
    _db: null,
    ouvrir() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((ok, ko) => { const r = indexedDB.open('studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('fichiers'); r.onsuccess = () => { this._db = r.result; ok(r.result); }; r.onerror = () => ko(r.error); });
    },
    async mettre(cle, blob) { const db = await this.ouvrir(); return new Promise((ok, ko) => { const t = db.transaction('fichiers', 'readwrite'); t.objectStore('fichiers').put(blob, cle); t.oncomplete = ok; t.onerror = () => ko(t.error); }); },
    async lire(cle) { const db = await this.ouvrir(); return new Promise((ok, ko) => { const r = db.transaction('fichiers').objectStore('fichiers').get(cle); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); },
    async suppr(cle) { const db = await this.ouvrir(); return new Promise(ok => { const t = db.transaction('fichiers', 'readwrite'); t.objectStore('fichiers').delete(cle); t.oncomplete = ok; }); }
  };
  const urlsIdb = {};
  async function resoudre(src) {
    if (!src) return null;
    if (/^idb:/.test(src)) {
      if (urlsIdb[src]) return urlsIdb[src];
      const b = await IDB.lire(src);
      if (!b) return null;
      return (urlsIdb[src] = URL.createObjectURL(b));
    }
    if (/^(https?:|blob:|data:)/.test(src)) return src;
    return BASE + src;
  }
  function tousFonds() {
    return Fabrique.FONDS.concat(medias.filter(m => m.type === 'fond'));
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
  async function copier(t) { try { await navigator.clipboard.writeText(t); toast('Copié'); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copié'); } }
  function telecharger(nom, contenu, type) {
    const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: type || 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function dataURLversBlob(d) { const [t, b] = d.split(','); const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: t.match(/:(.*?);/)[1] }); }
  const codeFamille = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
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
  function route() {
    nettoyer();
    const h = location.hash.replace(/^#\/?/, '').split('/');
    $$('.barre nav a').forEach(a => a.classList.toggle('actif', a.dataset.nav === (h[0] || 'accueil') || (h[0] === 'p' && a.dataset.nav === 'accueil')));
    window.scrollTo(0, 0);
    if (h[0] === 'nouveau') return vueNouveau();
    if (h[0] === 'bibliotheque') return vueBibliotheque();
    if (h[0] === 'reglages') return vueReglages();
    if (h[0] === 'guide') return vueGuide();
    if (h[0] === 'p' && projets[h[1]]) return vueProjet(projets[h[1]], h[2] || 'plans');
    return vueAccueil();
  }
  window.addEventListener('hashchange', route);

  /* ================= Accueil ================= */
  function vueAccueil() {
    const liste = Object.values(projets).sort((a, b) => (b.modifie || '').localeCompare(a.modifie || ''));
    $('#app').innerHTML = `
      <div class="entete"><div><h1>Vos événements</h1><p>Chaque invitation part d'un texte et de quelques fonds vidéo vierges.</p></div>
        <div class="ligne"><label class="btn">Importer un projet<input type="file" accept=".json" id="imp-projet" hidden></label><a class="btn plein" href="#/nouveau">+ Nouvel événement</a></div></div>
      ${liste.length ? `<div class="grille">${liste.map(p => `
        <div class="carte projet-carte" data-id="${p.id}">
          <img src="${esc(vignetteDe((p.plans.find(x => x.role !== 'ouverture') || p.plans[0] || {}).fond ? (p.plans.find(x => x.role !== 'ouverture') || p.plans[0]).fond.media : ''))}" alt="">
          <div><h3>${esc(p.fiche.titre)}</h3>
            <div class="muet">${esc(MoteurInfo.dateLisible(p.fiche.date, p.fiche.langue))}</div>
            <div class="muet">${p.plans.length} plans · ${(p.familles || []).length} familles</div>
            <div style="margin-top:6px">${p.publie ? '<span class="badge ok">Publié</span>' : '<span class="badge">Brouillon</span>'}</div></div>
        </div>`).join('')}</div>` : `
        <div class="carte vide"><h2>Aucun événement pour l'instant</h2><p class="muet">Collez le texte d'une invitation : le studio en tire les informations et propose les plans.</p><a class="btn plein" href="#/nouveau">Créer le premier événement</a>
        <p style="margin-top:14px"><button class="btn" id="demo">Charger l'exemple « Jobily faha-10 taona mariazy — Batemy »</button></p></div>`}`;
    $$('.projet-carte').forEach(c => c.onclick = () => { location.hash = '#/p/' + c.dataset.id + '/plans'; });
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
    const etapes = `<div class="etapes"><span class="${e === 1 ? 'actif' : ''}">1. Texte de l'invitation</span><span class="${e === 2 ? 'actif' : ''}">2. Fiche événement</span><span class="${e === 3 ? 'actif' : ''}">3. Fonds vidéo</span></div>`;
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
    // Étape 3 : fonds
    const fonds = tousFonds();
    $('#app').innerHTML = `<div class="entete"><div><h1>Fonds vidéo</h1><p>Cochez les fonds à utiliser. Le studio répartit les plans selon l'usage de chaque fond.</p></div><a class="btn" href="#/bibliotheque">Importer d'autres fonds</a></div>${etapes}
      <div class="carte"><div class="fonds-choix">${fonds.map(f => `
        <div class="fond-choix ${brouillon.fonds.includes(f.id) ? 'actif' : ''}" data-id="${f.id}"><img src="${esc(/^data:/.test(f.vignette) ? f.vignette : BASE + f.vignette)}" alt=""><b>${esc(f.nom)}</b><div class="muet">${esc(f.usage)} · ${f.duree ? f.duree.toFixed(1) + ' s' : ''}</div></div>`).join('')}</div></div>
      <div class="ligne" style="margin-top:16px;justify-content:space-between"><button class="btn" id="retour">‹ Fiche</button><button class="btn plein" id="creer">Créer les plans ›</button></div>`;
    $$('.fond-choix').forEach(c => c.onclick = () => { const id = c.dataset.id; brouillon.fonds = brouillon.fonds.includes(id) ? brouillon.fonds.filter(x => x !== id) : brouillon.fonds.concat(id); c.classList.toggle('actif'); });
    $('#retour').onclick = () => { brouillon.etape = 2; vueNouveau(); };
    $('#creer').onclick = () => {
      const choisis = fonds.filter(f => brouillon.fonds.includes(f.id));
      if (!choisis.length) return toast('Choisissez au moins un fond');
      const p = Fabrique.nouveauProjet(brouillon.fiche, choisis);
      projets[p.id] = p; sauverProjets(); brouillon = null;
      location.hash = '#/p/' + p.id + '/plans';
    };
  }

  /* ================= Projet ================= */
  let boucleUI = null;
  function vueProjet(p, onglet) {
    $('#app').innerHTML = `
      <div class="entete"><div><a href="#/" class="muet" style="text-decoration:none">‹ Événements</a><h1 style="margin-top:4px">${esc(p.fiche.titre)}</h1><p>${esc(MoteurInfo.dateLisible(p.fiche.date, p.fiche.langue))}${p.fiche.heure ? ' · ' + esc(p.fiche.heure) : ''}</p></div>
        <div class="ligne"><span class="muet" id="etat-sauve">Enregistré</span></div></div>
      <div class="onglets">
        <a href="#/p/${p.id}/plans" class="${onglet === 'plans' ? 'actif' : ''}">Plans</a>
        <a href="#/p/${p.id}/fiche" class="${onglet === 'fiche' ? 'actif' : ''}">Fiche</a>
        <a href="#/p/${p.id}/invites" class="${onglet === 'invites' ? 'actif' : ''}">Invités</a>
        <a href="#/p/${p.id}/publier" class="${onglet === 'publier' ? 'actif' : ''}">Film et publication</a>
      </div><div id="onglet"></div>`;
    if (onglet === 'invites') return ongletInvites(p);
    if (onglet === 'publier') return ongletPublier(p);
    if (onglet === 'fiche') return ongletFiche(p);
    return ongletPlans(p);
  }
  let tSauve;
  function enregistrer(p) {
    p.modifie = new Date().toISOString();
    const e = $('#etat-sauve'); if (e) e.textContent = 'Enregistrement…';
    clearTimeout(tSauve); tSauve = setTimeout(() => { sauverProjets(); const e2 = $('#etat-sauve'); if (e2) e2.textContent = 'Enregistré'; }, 400);
  }

  /* ---------- Fiche ---------- */
  function ongletFiche(p) {
    const f = p.fiche;
    $('#onglet').innerHTML = `<div class="carte pile" style="max-width:760px">
      <p class="muet">Ces informations alimentent les textes variables ({date}, {date_limite}, {compte_a_rebours}…), les boutons Map et Appeler, et le message WhatsApp.</p>
      <label class="champ">Titre<input type="text" data-f="titre" value="${esc(f.titre)}"></label>
      <div class="trois"><label class="champ">Date<input type="date" data-f="date" value="${esc(f.date)}"></label><label class="champ">Heure<input type="time" data-f="heure" value="${esc(f.heure)}"></label><label class="champ">Date limite<input type="date" data-f="date_limite" value="${esc(f.date_limite)}"></label></div>
      <label class="champ">Langue des boutons<select data-f="langue"><option value="mg" ${f.langue === 'mg' ? 'selected' : ''}>Malgache</option><option value="fr" ${f.langue === 'fr' ? 'selected' : ''}>Français</option></select></label>
      <div class="section-titre">Lieux (n° pour les boutons Map : 0, 1…)</div>
      ${f.lieux.map((l, i) => `<div class="deux"><input type="text" data-l="${i}" data-k="nom" value="${esc(l.nom)}"><input type="url" data-l="${i}" data-k="maps" value="${esc(l.maps)}"></div>`).join('')}
      <div class="section-titre">Contacts (n° pour les boutons Appeler : 0, 1…)</div>
      ${f.contacts.map((c, i) => `<div class="deux"><input type="text" data-c="${i}" data-k="nom" value="${esc(c.nom)}"><input type="text" data-c="${i}" data-k="telephone" value="${esc(c.telephone)}"></div>`).join('')}
      <label class="champ">Texte source<textarea rows="8" readonly>${esc(f.texte_source || '')}</textarea></label>
    </div>`;
    $$('[data-f]').forEach(i => i.oninput = () => { f[i.dataset.f] = i.value; enregistrer(p); });
    $$('[data-l]').forEach(i => i.oninput = () => { f.lieux[i.dataset.l][i.dataset.k] = i.value; enregistrer(p); });
    $$('[data-c]').forEach(i => i.oninput = () => { f.contacts[i.dataset.c][i.dataset.k] = i.value; enregistrer(p); });
  }

  /* ---------- Plans (éditeur) ---------- */
  const ROLES = { ouverture: 'Ouverture', intermediaire: 'Plan intermédiaire', confirmation: 'Confirmation', remerciement: 'Remerciement' };
  const NOMS_TYPE = { texte: 'Texte', bouton: 'Bouton', compteur: 'Compteur', champ: 'Champ', image: 'Image', video: 'Vidéo' };
  const FAMILLE_TEST = { code: 'TEST', nom: 'Fianakaviana Rakoto', places: 4, adultes: 2, enfants: 2 };

  function ongletPlans(p) {
    const E = { p, i: 0, sel: null, t: 0, vue: 'famille', annuler: [], refaire: [] };
    $('#onglet').innerHTML = `<div class="editeur">
        <div class="col-plans" id="col-plans"></div>
        <div class="col-apercu">
          <div class="barre-sel" id="barre-sel"></div>
          <div class="apercu-cadre" id="cadre" tabindex="0"><div id="scene"></div><div class="poignees" id="poignees"></div></div>
          <div class="astuce">Double-clic : écrire dans le texte · Coins : agrandir · Côtés : élargir · Ctrl+C / Ctrl+V : copier-coller (aussi entre plans) · Ctrl+Alt+C / Ctrl+Alt+V : copier-coller la mise en forme · 🖌 : pinceau · Ctrl+D : dupliquer · Suppr : supprimer · Flèches : déplacer · Clic droit : menu</div>
          <div class="temps"><span id="t-aff">0,0 s</span><input type="range" id="t-curseur" min="0" max="6" step="0.05" value="0"><span id="t-dur"></span></div>
          <div class="commandes">
            <button class="btn petit" id="jouer-plan">▶ Plan</button><button class="btn petit" id="jouer-tout">▶ Toute l'invitation</button><button class="btn petit" id="stop">■</button>
            <select id="vue" class="btn petit"><option value="famille">Voir : lien personnel</option><option value="general">Voir : lien général</option></select>
            <button class="btn petit icone" id="annuler" title="Annuler">↶</button><button class="btn petit icone" id="refaire" title="Rétablir">↷</button>
          </div>
          <div class="commandes"><button class="btn petit" id="img-test">Image test</button><button class="btn ia" id="finaliser">✨ Finaliser ce plan avec l'IA</button></div>
        </div>
        <div class="col-reglages carte" id="col-reglages"></div>
      </div>`;
    const eng = new Moteur($('#scene'), { mode: 'edition', resolveur: resoudre, famille: FAMILLE_TEST });
    moteurCourant = eng;
    E.eng = eng;
    eng.setProjet(p).then(() => { enregistrer(p); afficher(); });

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
    $('#jouer-plan').onclick = () => { eng.mode = 'invitation'; eng.jouerPlan(E.i); };
    $('#jouer-tout').onclick = () => { eng.mode = 'invitation'; eng.jouer(eng.plansInvitation(), 0); };
    $('#stop').onclick = () => { eng.pause(); eng.mode = 'edition'; afficher(); };
    eng.onTemps = (t) => { $('#t-aff').textContent = t.toFixed(1).replace('.', ',') + ' s'; if (eng.planFixe != null) $('#t-curseur').value = t; };
    eng.onFin = () => { eng.mode = 'edition'; afficher(); };
    eng.onAction = (a) => toast('Action « ' + a + ' » (active sur la page d\'invitation)');
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
    function rendrePoignees() {
      if (eng.lecture) { if (zone._html) { zone.innerHTML = ''; zone._html = ''; } return; }
      const pl = plan();
      const html = (pl.calques || []).filter(c => eng.bbox[c.id] && !c.masque && !c._edition).map(c => {
        const b = eng.bbox[c.id], actif = E.sel === c.id;
        const hs = actif ? (POIGNEES[c.type] || []).map(h => `<i class="h h-${h}" data-h="${h}"></i>`).join('') : '';
        return `<div class="poignee ${actif ? 'actif' : ''}" data-id="${c.id}" style="left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%"><span class="nom">${esc(NOMS_TYPE[c.type])}</span>${hs}</div>`;
      }).join('');
      if (zone._html !== html) { zone.innerHTML = html; zone._html = html; }
    }
    function tick() { rendrePoignees(); boucleUI = requestAnimationFrame(tick); }
    boucleUI = requestAnimationFrame(tick);
    // calque sous le pointeur (le plus haut d'abord), par coordonnées : robuste aux redessins
    function calqueA(e) {
      const r = zone.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
      const cs = (plan().calques || []).filter(c => eng.bbox[c.id] && !c.masque);
      for (let i = cs.length - 1; i >= 0; i--) { const b = eng.bbox[cs[i].id]; if (x >= b.x - 0.8 && x <= b.x + b.w + 0.8 && y >= b.y - 0.8 && y <= b.y + b.h + 0.8) return cs[i]; }
      return null;
    }
    function choisir(id) { if (E.sel !== id) { E.sel = id; rendreReglages(); zone._html = ''; } }
    zone.addEventListener('pointerdown', e => {
      if (e.button === 2) return;
      fermerMenu();
      if (editeur) terminerEdition();
      cadre.focus({ preventScroll: true });
      const r = zone.getBoundingClientRect();
      const h = e.target.closest('.h');
      if (h && calqueSel()) {
        const c = calqueSel(), b = eng.bbox[c.id];
        drag = { mode: 'taille', h: h.dataset.h, c, x0: e.clientX, y0: e.clientY, w: r.width, hz: r.height, b: Object.assign({}, b), v: { largeur: Number(c.largeur) || 60, taille: Number(c.taille) || 4, hauteur: Number(c.hauteur) || 22, x: Number(c.x), y: Number(c.y) }, bouge: false };
        zone.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      const c = calqueA(e);
      if (pinceau) { if (c) { appliquerStyle([c]); } else { pinceau = false; zone.classList.remove('pinceau'); rendreBarre(); } return; }
      if (!c) { choisir(null); return; }
      choisir(c.id);
      drag = { mode: 'deplacer', c, x0: e.clientX, y0: e.clientY, cx: Number(c.x), cy: Number(c.y), w: r.width, h: r.height, bouge: false };
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', e => {
      if (!drag) return;
      const dxp = e.clientX - drag.x0, dyp = e.clientY - drag.y0;
      if (!drag.bouge && Math.abs(dxp) + Math.abs(dyp) < 3) return;
      if (!drag.bouge) { snapshot(); drag.bouge = true; }
      const c = drag.c;
      if (drag.mode === 'deplacer') {
        let nx = drag.cx + dxp / drag.w * 100, ny = drag.cy + dyp / drag.h * 100;
        // aimant au centre horizontal
        if (Math.abs(nx - 50) < 1.2 && !e.shiftKey) nx = 50;
        c.x = Math.round(Math.max(0, Math.min(100, nx)) * 10) / 10;
        c.y = Math.round(Math.max(0, Math.min(100, ny)) * 10) / 10;
        zone.classList.toggle('aimant', c.x === 50);
      } else {
        const H = drag.h, v = drag.v, b = drag.b;
        const dx = dxp / drag.w * 100, dy = dyp / drag.hz * 100;
        const sx = H.includes('e') ? 1 : H.includes('w') ? -1 : 0, sy = H.includes('s') ? 1 : H.includes('n') ? -1 : 0;
        const coin = sx && sy;
        if (coin) {
          // agrandir proportionnellement depuis le centre
          const f = Math.max(0.2, Math.min(5, (b.w + 2 * sx * dx) / b.w));
          if (c.type === 'image' || c.type === 'video') { c.largeur = Math.round(Math.min(100, v.largeur * f) * 10) / 10; c.hauteur = Math.round(Math.min(100, v.hauteur * f) * 10) / 10; }
          else { c.taille = Math.round(Math.max(1, Math.min(15, v.taille * f)) * 10) / 10; c.largeur = Math.round(Math.max(8, Math.min(100, v.largeur * f)) * 10) / 10; }
        } else if (sx) {
          c.largeur = Math.round(Math.max(8, Math.min(100, v.largeur + 2 * sx * dx)) * 10) / 10;
        } else if (sy) {
          c.hauteur = Math.round(Math.max(4, Math.min(100, v.hauteur + 2 * sy * dy)) * 10) / 10;
        }
      }
      if (I.TYPES_HTML.includes(c.type)) E.rafraichir();
      majChamps(c);
    });
    zone.addEventListener('pointerup', () => { if (drag && drag.bouge) { enregistrer(p); if (drag.mode === 'taille') rendreReglages(); } drag = null; zone.classList.remove('aimant'); });
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
    function copierCalque(c, couper) {
      if (!c) return;
      const json = JSON.stringify(c, (k, v) => k === '_edition' ? undefined : v);
      Stock.ecrire('studio.presse', json);
      try { navigator.clipboard && navigator.clipboard.writeText(MARQUE + json).catch(() => {}); } catch (e) {}
      if (couper) supprimerCalque(c); else toast('Calque copié');
    }
    function collerCalque(json) {
      let c;
      try { c = JSON.parse(json || Stock.lire('studio.presse', null)); if (typeof c === 'string') c = JSON.parse(c); } catch (e) { c = null; }
      if (!c || !c.type) return toast('Rien à coller : copiez d\'abord un calque (Ctrl+C)');
      E.modif(true);
      c.id = uid();
      const memePlan = plan().calques.some(x => Math.abs(Number(x.x) - Number(c.x)) < 0.5 && Math.abs(Number(x.y) - Number(c.y)) < 0.5);
      if (memePlan) { c.x = Math.min(95, Number(c.x) + 2); c.y = Math.min(95, Number(c.y) + 2); }
      plan().calques.push(c); E.sel = c.id;
      eng.precharger().then(() => { E.rafraichir(); rendreReglages(); rendrePlans(); });
      toast('Calque collé');
    }
    function dupliquerCalque(c) { if (!c) return; const d = JSON.parse(JSON.stringify(c)); delete d._edition; E.modif(true); d.id = uid(); d.x = Math.min(95, Number(d.x) + 2); d.y = Math.min(95, Number(d.y) + 2); plan().calques.push(d); E.sel = d.id; E.rafraichir(); rendreReglages(); rendrePlans(); }
    function supprimerCalque(c) { if (!c) return; E.modif(true); const pl = plan(); pl.calques = pl.calques.filter(x => x.id !== c.id); E.sel = null; E.rafraichir(); rendreReglages(); rendrePlans(); }
    function ordreCalque(c, sens) { if (!c) return; const pl = plan(); const k = pl.calques.indexOf(c); E.modif(true); pl.calques.splice(k, 1); if (sens === 'avant') pl.calques.push(c); else pl.calques.unshift(c); E.rafraichir(); rendreReglages(); }
    // Mise en forme : copier / coller le style d'un calque sur un autre (pinceau)
    const STYLE_TEXTE = ['police', 'taille', 'couleur', 'gras', 'italique', 'majuscules', 'align', 'interligne', 'ombre', 'ombre_couleur', 'contour', 'contour_epaisseur', 'fond_couleur', 'fond_opacite', 'opacite', 'animation', 'duree_animation', 'sortie', 'duree_sortie'];
    const STYLE_BOUTON = ['police', 'taille', 'couleur', 'style'];
    const STYLE_MEDIA = ['forme', 'bordure', 'opacite', 'remplir', 'animation', 'duree_animation', 'sortie', 'duree_sortie'];
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
      if (!c) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); supprimerCalque(c); return; }
      if (e.key === 'Enter' && (c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur')) { e.preventDefault(); editer(c); return; }
      if (e.key === 'Escape') { choisir(null); return; }
      const pas = e.shiftKey ? 2 : 0.5;
      const dep = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] }[e.key];
      if (dep) { e.preventDefault(); E.modif(); c.x = Math.round(Math.max(0, Math.min(100, Number(c.x) + dep[0])) * 10) / 10; c.y = Math.round(Math.max(0, Math.min(100, Number(c.y) + dep[1])) * 10) / 10; if (I.TYPES_HTML.includes(c.type)) E.rafraichir(); majChamps(c); }
    });
    ecouter(document, 'copy', e => { if (dansChamp(document.activeElement) || !$('#modale').hidden) return; const c = calqueSel(); if (!c) return; e.preventDefault(); const json = JSON.stringify(c, (k, v) => k === '_edition' ? undefined : v); e.clipboardData.setData('text/plain', MARQUE + json); Stock.ecrire('studio.presse', json); toast('Calque copié'); });
    ecouter(document, 'cut', e => { if (dansChamp(document.activeElement) || !$('#modale').hidden) return; const c = calqueSel(); if (!c) return; e.preventDefault(); const json = JSON.stringify(c, (k, v) => k === '_edition' ? undefined : v); e.clipboardData.setData('text/plain', MARQUE + json); Stock.ecrire('studio.presse', json); supprimerCalque(c); });
    ecouter(document, 'paste', async e => {
      if (dansChamp(document.activeElement) || !$('#modale').hidden || !$('#cadre')) return;
      const dt = e.clipboardData; if (!dt) return;
      const fichierColle = [...(dt.files || [])].find(f => /^(image|video)\//.test(f.type));
      if (fichierColle) { e.preventDefault(); const m = await importerFichier(fichierColle, null); sauverMedias(); E.ajouterMedia(m); toast('Image collée'); return; }
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
      const c = calqueA(e); if (c) choisir(c.id);
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
        if (a === 'dupliquer') dupliquerCalque(c); if (a === 'avant' || a === 'arriere') ordreCalque(c, a); if (a === 'suppr') supprimerCalque(c);
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
      if (!c) { bar.innerHTML = pinceau ? `<span class="muet">🖌 Pinceau actif : cliquez les calques à mettre en forme</span><button class="btn petit" data-b="pinceau">Arrêter</button>` : `<span class="muet">Cliquez un élément de l'aperçu pour le modifier</span>${Stock.lire('studio.presse', null) ? '<button class="btn petit" data-b="coller">Coller</button>' : ''}`; lierBarre(bar, c); return; }
      const ecr = c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur';
      bar.innerHTML = `<b class="type-sel">${esc(NOMS_TYPE[c.type])}</b>
        ${ecr ? '<button class="btn petit" data-b="editer" title="Modifier le texte (double-clic)">✎ Écrire</button>' : '<button class="btn petit" data-b="remplacer">Remplacer</button>'}
        ${c.type !== 'image' && c.type !== 'video' ? `<button class="btn petit icone" data-b="moins" title="Plus petit">A−</button><button class="btn petit icone" data-b="plus" title="Plus grand">A+</button>` : `<button class="btn petit icone" data-b="moins" title="Plus petit">−</button><button class="btn petit icone" data-b="plus" title="Plus grand">+</button>`}
        ${c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur' ? `<input type="color" data-b="couleur" value="${c.couleur || '#7a1f2b'}" title="Couleur">` : ''}
        ${c.type === 'texte' ? `<button class="btn petit icone ${c.gras ? 'on' : ''}" data-b="gras" title="Gras"><b>G</b></button><button class="btn petit icone ${c.italique ? 'on' : ''}" data-b="italique" title="Italique"><i>I</i></button><button class="btn petit icone" data-b="align" title="Alignement">${{ left: '⇤', right: '⇥' }[c.align] || '↔'}</button>` : ''}
        <span class="sep"></span>
        <button class="btn petit icone ${pinceau ? 'on' : ''}" data-b="pinceau" title="Pinceau : copier la mise en forme puis cliquer les calques à mettre en forme">🖌</button><button class="btn petit icone" data-b="style-v" title="Coller la mise en forme (Ctrl+Alt+V)" ${Stock.lire('studio.style', null) ? '' : 'disabled'}>🎨</button>
        <span class="sep"></span>
        <button class="btn petit icone" data-b="copier" title="Copier (Ctrl+C)">⧉</button><button class="btn petit icone" data-b="coller" title="Coller (Ctrl+V)">📋</button><button class="btn petit icone" data-b="dupliquer" title="Dupliquer (Ctrl+D)">⊕</button>
        <button class="btn petit icone" data-b="avant" title="Premier plan">⬆</button><button class="btn petit icone" data-b="arriere" title="Arrière-plan">⬇</button>
        <button class="btn petit icone danger" data-b="suppr" title="Supprimer (Suppr)">🗑</button>`;
      lierBarre(bar, c);
    }
    function lierBarre(bar, c) {
      $$('[data-b]', bar).forEach(el => {
        const a = el.dataset.b;
        if (a === 'couleur') { el.oninput = () => { E.modif(); c.couleur = el.value; if (I.TYPES_HTML.includes(c.type)) E.rafraichir(); const i = $('#props [data-k="couleur"]'); if (i) i.value = el.value; }; return; }
        el.onclick = () => {
          if (a === 'coller') return collerCalque(null);
          if (a === 'pinceau' && !c) return basculerPinceau();
          if (!c) return;
          if (a === 'editer') editer(c);
          if (a === 'remplacer') { const inp = $('#props [data-remplacer]'); if (inp) inp.click(); }
          if (a === 'plus' || a === 'moins') {
            E.modif(); const f = a === 'plus' ? 1.1 : 1 / 1.1;
            if (c.type === 'image' || c.type === 'video') { c.largeur = Math.round(Math.min(100, (Number(c.largeur) || 40) * f) * 10) / 10; c.hauteur = Math.round(Math.min(100, (Number(c.hauteur) || 22) * f) * 10) / 10; }
            else c.taille = Math.round(Math.max(1, Math.min(15, (Number(c.taille) || 3) * f)) * 10) / 10;
            if (I.TYPES_HTML.includes(c.type)) E.rafraichir(); majChamps(c);
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
          <img src="${esc(vignetteDe(pl.fond && pl.fond.media))}" alt="">
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
        const f = tousFonds().find(x => x.usage === 'programme') || tousFonds()[0];
        p.plans.splice(pos, 0, { id: uid(), role: 'intermediaire', duree: 6, fond: { media: f.src, boucle: true, assombrir: 0, eclaircir: 0 }, transition: { type: 'fondu', duree: 0.8 }, calques: [{ id: uid(), type: 'texte', texte: 'Nouveau texte', x: f.zone ? f.zone.x : 50, y: 50, largeur: 60, police: 'Cormorant Garamond', taille: 4.4, couleur: p.style.couleur, ombre: true, align: 'center', debut: 0.4, animation: 'fondu-montee' }] });
        E.i = pos; E.sel = null; enregistrer(p); eng.precharger().then(afficher);
      };
      $('#finaliser-tout').onclick = () => modaleComposerTout(E);
    }

    /* Réglages du plan et des calques */
    function rendreReglages() {
      const pl = plan();
      const col = $('#col-reglages');
      const fonds = tousFonds();
      const c = (pl.calques || []).find(x => x.id === E.sel);
      const fondActuel = fonds.find(f => f.src === pl.fond.media);
      const nbMemeFond = p.plans.filter(x => x.fond && x.fond.media === pl.fond.media).length;
      col.innerHTML = `
        <div class="section-titre" style="margin-top:0">Plan ${E.i + 1} · ${ROLES[pl.role]}</div>
        <details class="bloc" open><summary>Fond vidéo</summary>
          <div class="fond-actuel"><img src="${esc(vignetteDe(pl.fond.media))}" alt=""><div style="min-width:0"><b>${esc(fondActuel ? fondActuel.nom : '—')}</b>
            <div class="muet">${nbMemeFond > 1 ? `Utilisé par ${nbMemeFond} plans` : 'Utilisé par ce plan seulement'}</div></div></div>
          <label class="champ">Choisir dans la bibliothèque<select id="p-fond">${fonds.map(f => `<option value="${esc(f.src)}" ${pl.fond.media === f.src ? 'selected' : ''}>${esc(f.nom)} (${esc(f.usage)})</option>`).join('')}</select></label>
          <div class="ligne" style="margin-top:8px"><label class="btn petit">Importer un fond<input type="file" id="imp-fond-plan" accept="video/*" hidden></label><button class="btn petit ia" id="fond-ia">✨ Créer un fond sur mesure (IA)</button></div>
          <div class="deux" style="margin-top:8px">
            <label class="champ">Éclaircir<input type="range" id="p-ecl" min="0" max="0.7" step="0.05" value="${pl.fond.eclaircir || 0}"></label>
            <label class="champ">Assombrir<input type="range" id="p-asb" min="0" max="0.7" step="0.05" value="${pl.fond.assombrir || 0}"></label>
          </div>
        </details>
        <details class="bloc" open><summary>Durée et transition</summary>
          <div class="deux">
            <label class="champ">Durée (s)${pl.role === 'confirmation' ? ' — 0 = attend l\'invité' : ''}<input type="number" id="p-duree" min="0" max="30" step="0.5" value="${pl.duree}"></label>
            <label class="champ">Transition d'arrivée<select id="p-trans">${opts([['aucune', 'Aucune'], ['fondu', 'Fondu enchaîné'], ['fondu-blanc', 'Fondu au blanc'], ['fondu-noir', 'Fondu au noir'], ['glissement', 'Glissement']], (pl.transition && pl.transition.type) || 'fondu')}</select></label>
          </div>
          <button class="btn petit" id="empiler" style="margin-top:8px">Éviter les chevauchements de textes</button>
        </details>
        <details class="bloc" open><summary>Calques <span class="muet">${(pl.calques || []).length}</span></summary>
          <div class="ligne" style="gap:4px;margin-bottom:8px"><button class="btn petit" data-ajout="texte">+ Texte</button><button class="btn petit" data-ajout="bouton">+ Bouton</button><button class="btn petit" data-ajout="compteur">+ Compteur</button><label class="btn petit">+ Photo / vidéo<input type="file" id="imp-calque" accept="image/*,video/*" hidden></label></div>
          <div id="liste-calques">${(pl.calques || []).map(x => `
            <div class="calque-ligne ${x.id === E.sel ? 'actif' : ''}" data-id="${x.id}">
              <span class="type">${NOMS_TYPE[x.type] || x.type}</span><span class="t">${esc(x.texte || nomMedia(x.media) || '(vide)')}</span>
              <button data-a="vis" title="Afficher / masquer">${x.masque ? '○' : '●'}</button><button data-a="haut" title="Monter">▲</button><button data-a="bas" title="Descendre">▼</button><button data-a="suppr" title="Supprimer">✕</button>
            </div>`).join('') || '<p class="muet">Aucun calque.</p>'}</div>
        </details>
        <div id="props">${c ? formulaireCalque(c) : '<p class="muet" style="margin-top:12px">Cliquez un calque dans la liste ou sur l\'aperçu pour le modifier. Glissez-le sur l\'aperçu pour le déplacer.</p>'}</div>`;
      $('#p-fond').onchange = e => { E.modif(true); pl.fond.media = e.target.value; eng.precharger().then(() => { eng._entrerPlan(); afficher(); }); };
      $('#imp-fond-plan').onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        const m = await importerFichier(f, 'fond'); sauverMedias();
        E.modif(true); pl.fond.media = m.src; eng.precharger().then(() => { eng._entrerPlan(); afficher(); }); toast('Fond importé et appliqué à ce plan');
      };
      $('#fond-ia').onclick = () => modaleFondIA(E);
      $('#empiler').onclick = () => { E.modif(true); if (eng.empilerTextes(pl)) { E.rafraichir(); rendreReglages(); toast('Textes réorganisés (↶ pour annuler)'); } else toast('Rien à réorganiser'); };
      $('#p-duree').oninput = e => { E.modif(); pl.duree = Math.max(0, Number(e.target.value) || 0); $('#t-curseur').max = Number(pl.duree) || 6; rendrePlans(); };
      $('#p-trans').onchange = e => { E.modif(true); pl.transition = pl.transition || {}; pl.transition.type = e.target.value; pl.transition.duree = pl.transition.duree || 0.8; };
      $('#p-ecl').oninput = e => { E.modif(); pl.fond.eclaircir = Number(e.target.value); };
      $('#p-asb').oninput = e => { E.modif(); pl.fond.assombrir = Number(e.target.value); };
      $$('[data-ajout]', col).forEach(b => b.onclick = () => ajouterCalque(b.dataset.ajout));
      $('#imp-calque').onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        const m = await importerFichier(f, null); sauverMedias();
        ajouterCalque(m.type === 'video' ? 'video' : 'image', m);
      };
      $$('.calque-ligne', col).forEach(l => l.onclick = e => {
        const id = l.dataset.id, a = e.target.dataset.a, k = pl.calques.findIndex(x => x.id === id);
        if (a === 'vis') { E.modif(true); pl.calques[k].masque = !pl.calques[k].masque; E.rafraichir(); rendreReglages(); return; }
        if (a === 'haut' && k > 0) { E.modif(true); [pl.calques[k - 1], pl.calques[k]] = [pl.calques[k], pl.calques[k - 1]]; E.rafraichir(); rendreReglages(); return; }
        if (a === 'bas' && k < pl.calques.length - 1) { E.modif(true); [pl.calques[k + 1], pl.calques[k]] = [pl.calques[k], pl.calques[k + 1]]; E.rafraichir(); rendreReglages(); return; }
        if (a === 'suppr') { E.modif(true); pl.calques.splice(k, 1); if (E.sel === id) E.sel = null; E.rafraichir(); rendreReglages(); rendrePlans(); return; }
        E.sel = id; rendreReglages();
      });
      if (c) lierFormulaire(c);
      if (E.rendreBarre) E.rendreBarre();
    }
    E.rendreReglages = rendreReglages;

    E.ajouterMedia = m => ajouterCalque(m.type === 'video' ? 'video' : 'image', m);
    function ajouterCalque(type, media) {
      const pl = plan();
      E.modif(true);
      const base = { id: uid(), x: 50, y: 50, largeur: 60, debut: 0.4, couleur: p.style.couleur || '#7a1f2b' };
      let c;
      const L = Fabrique.LIB[p.fiche.langue] || Fabrique.LIB.fr;
      if (type === 'texte') c = Object.assign(base, { type, texte: 'Nouveau texte', police: 'Cormorant Garamond', taille: 4.4, align: 'center', ombre: true, animation: 'fondu-montee', sortie: 'aucune' });
      if (type === 'bouton') c = Object.assign(base, { type, texte: L.confirmer, action: 'suivant', style: 'plein', taille: 2.4, debut: 0 });
      if (type === 'compteur') c = Object.assign(base, { type, texte: L.adultes, champ: 'adultes', min: 0, defaut: 1, taille: 2.3, largeur: 66 });
      if (type === 'image' || type === 'video') {
        const ratio = media && media.l && media.h ? media.h / media.l : 1;
        c = Object.assign(base, { type, media: media ? media.src : '', largeur: 46, hauteur: Math.round(Math.min(40, 46 * ratio * 720 / 1280)), y: 32, forme: 'arrondi', animation: 'fondu', sortie: 'aucune', bordure: '' });
      }
      if (type === 'image' || type === 'video') {
        // sous les textes, au-dessus du reste du plan, puis réorganisation sans chevauchement
        pl.calques.unshift(c);
        eng.empilerTextes(pl, 3);
      } else pl.calques.push(c);
      E.sel = c.id;
      eng.precharger().then(() => { E.rafraichir(); rendreReglages(); rendrePlans(); });
    }

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
    function formulaireCalque(c) {
      const position = `<details class="bloc" open><summary>Position</summary>
        <div class="trois"><label class="champ">X (%)<input type="number" id="cx" data-k="x" step="0.5" value="${c.x}"></label><label class="champ">Y (%)<input type="number" id="cy" data-k="y" step="0.5" value="${c.y}"></label><label class="champ">Largeur (%)<input type="number" data-k="largeur" step="1" value="${c.largeur || 60}"></label></div>
        <label class="champ" style="margin-top:8px">Visible pour<select data-k="condition">${opts([['', 'Tous'], ['famille', 'Lien personnel'], ['general', 'Lien général']], c.condition || '')}</select></label></details>`;
      let s = `<div class="section-titre">${NOMS_TYPE[c.type]} choisi</div>`;
      if (c.type === 'texte') s += `<details class="bloc" open><summary>Texte</summary><div class="pile">
        <label class="champ">Texte <span class="muet">— variables : {famille} {places} {date} {heure} {date_limite} {compte_a_rebours}</span><textarea data-k="texte" rows="3">${esc(c.texte)}</textarea></label>
        <div class="deux"><label class="champ">Police<select data-k="police">${opts(I.POLICES, c.police)}</select></label><label class="champ">Taille<input type="range" data-k="taille" min="1.5" max="12" step="0.1" value="${c.taille || 4}"></label></div>
        <div class="trois"><label class="champ">Couleur<input type="color" data-k="couleur" value="${c.couleur || '#7a1f2b'}"></label><label class="champ">Alignement<select data-k="align">${opts([['center', 'Centré'], ['left', 'Gauche'], ['right', 'Droite']], c.align || 'center')}</select></label><label class="champ">Interligne<input type="number" data-k="interligne" step="0.05" min="0.8" max="2" value="${c.interligne || 1.25}"></label></div>
        <div class="cases"><label><input type="checkbox" data-k="gras" ${c.gras ? 'checked' : ''}> Gras</label><label><input type="checkbox" data-k="italique" ${c.italique ? 'checked' : ''}> Italique</label><label><input type="checkbox" data-k="majuscules" ${c.majuscules ? 'checked' : ''}> Majuscules</label><label><input type="checkbox" data-k="ombre" ${c.ombre ? 'checked' : ''}> Halo clair</label></div>
        </div></details>` + blocAnimation(c);
      if (c.type === 'bouton') s += `<details class="bloc" open><summary>Bouton</summary><div class="pile">
        <label class="champ">Libellé<input type="text" data-k="texte" value="${esc(c.texte)}"></label>
        <div class="deux"><label class="champ">Action<select data-k="action">${opts(I.ACTIONS, c.action)}</select></label><label class="champ">N° du lieu / contact<input type="number" data-k="cible" min="0" value="${c.cible || 0}"></label></div>
        ${c.action === 'lien' || c.action === 'messenger' ? `<label class="champ">Adresse du lien<input type="url" data-k="lien" value="${esc(c.lien || '')}"></label>` : ''}
        <div class="trois"><label class="champ">Style<select data-k="style">${opts([['plein', 'Plein'], ['contour', 'Contour'], ['lien', 'Lien']], c.style || 'plein')}</select></label><label class="champ">Taille<input type="number" data-k="taille" step="0.1" min="1" max="6" value="${c.taille || 2.4}"></label><label class="champ">Couleur<input type="color" data-k="couleur" value="${c.couleur || '#7a1f2b'}"></label></div>
        <label class="champ">Apparaît à (s)<input type="number" data-k="debut" step="0.1" min="0" value="${c.debut || 0}"></label></div></details>`;
      if (c.type === 'compteur') s += `<details class="bloc" open><summary>Compteur</summary><div class="pile">
        <label class="champ">Libellé<input type="text" data-k="texte" value="${esc(c.texte)}"></label>
        <div class="trois"><label class="champ">Champ<select data-k="champ">${opts(['adultes', 'enfants', 'places_transport'], c.champ)}</select></label><label class="champ">Min<input type="number" data-k="min" value="${c.min || 0}"></label><label class="champ">Max<input type="number" data-k="max" value="${c.max || ''}" placeholder="places"></label></div>
        <div class="deux"><label class="champ">Taille<input type="number" data-k="taille" step="0.1" min="1" max="6" value="${c.taille || 2.3}"></label><label class="champ">Couleur<input type="color" data-k="couleur" value="${c.couleur || '#7a1f2b'}"></label></div></div></details>`;
      if (c.type === 'image' || c.type === 'video') s += `<details class="bloc" open><summary>Photo / vidéo</summary><div class="pile">
        ${c.media ? '' : '<div class="alerte-boite">Ce calque est vide : importez une photo ou une vidéo.</div>'}
        <div class="ligne"><label class="btn petit plein">${c.media ? 'Remplacer le fichier' : 'Importer une photo ou une vidéo'}<input type="file" data-remplacer accept="image/*,video/*" hidden></label></div>
        <label class="champ">Ou choisir dans la bibliothèque<select data-k="media">${opts([['', '—']].concat(medias.filter(m => m.type === 'image' || m.type === 'video').map(m => [m.src, m.nom])), c.media)}</select></label>
        <div class="trois"><label class="champ">Hauteur (%)<input type="number" data-k="hauteur" value="${c.hauteur || 22}"></label><label class="champ">Forme<select data-k="forme">${opts([['', 'Normale'], ['arrondi', 'Arrondie'], ['rond', 'Ronde']], c.forme || '')}</select></label><label class="champ">Opacité<input type="number" data-k="opacite" min="0" max="1" step="0.05" value="${c.opacite != null ? c.opacite : 1}"></label></div>
        <div class="cases"><label><input type="checkbox" data-k="remplir" ${c.remplir ? 'checked' : ''}> Remplir le cadre (recadrer)</label><label>Bordure <input type="color" data-k="bordure" value="${c.bordure || '#b08a4f'}"></label></div>
        </div></details>` + blocAnimation(c);
      return s + position;
    }
    function lierFormulaire(c) {
      const rp = $('#props [data-remplacer]');
      if (rp) rp.onchange = async e => { const f = e.target.files[0]; if (!f) return; const m = await importerFichier(f, null); sauverMedias(); E.modif(true); c.media = m.src; c.type = m.type === 'video' ? 'video' : 'image'; eng.precharger().then(() => { E.rafraichir(); rendreReglages(); }); };
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
  const IDEES = {
    ouverture: ['Enveloppe qui s\'ouvre lentement sur un fond de roses', 'Rideau de fleurs qui s\'écarte', 'Lumière dorée qui traverse un voile'],
    intermediaire: ['Église éclairée par une lumière dorée, vitraux doux', 'Salle de réception décorée, lustres et bougies', 'Berceau, petits nuages et colombes pour le baptême', 'Alliances posées sur des pétales de roses', 'Ciel doré avec deux colombes qui volent'],
    confirmation: ['Cadre floral calme, beaucoup d\'espace au centre pour les boutons', 'Papier ivoire avec quelques pétales qui tombent sur les côtés'],
    remerciement: ['Pluie douce de pétales et lumière chaude', 'Bouquet de roses au bas de l\'image, colombes en haut']
  };
  function modaleFondIA(E) {
    const p = E.p, k = E.i, pl = p.plans[k];
    const h = pl.fond_ia || {};
    const role = pl.role;
    const usage = { ouverture: 'ouverture', confirmation: 'confirmation', remerciement: 'remerciement' }[role] || 'programme';
    const exclus = new Set(h.exclus || []);
    const nomRef = () => { const f = tousFonds().find(x => x.src === pl.fond.media); return ((f && f.nom) || 'fond').replace(/[^\w\-]+/g, '-').toLowerCase() + '-reference-plan-' + (k + 1) + '.mp4'; };
    const lignesCalques = () => (pl.calques || []).filter(c => !c.masque).map(c => {
      const b = E.eng.bbox[c.id];
      const editable = c.type === 'texte' || c.type === 'bouton' || c.type === 'compteur';
      const zone = b ? `${Math.round(b.y)}–${Math.round(b.y + b.h)} % de la hauteur` : 'non visible sur ce lien';
      return `<div class="calque-ia ${exclus.has(c.id) ? 'off' : ''}" data-id="${c.id}">
        <input type="checkbox" ${exclus.has(c.id) ? '' : 'checked'} title="Inclure dans le prompt">
        <span class="badge">${esc(NOMS_TYPE[c.type] || c.type)}</span>
        ${editable ? `<textarea class="ci-texte" rows="${String(c.texte || '').split('\n').length > 1 ? 3 : 1}">${esc(c.texte || '')}</textarea>` : `<span class="ci-nom">${esc(nomMedia(c.media) || '(photo ou vidéo)')}</span>`}
        <span class="muet ci-zone">${esc(zone)}</span></div>`;
    }).join('');
    modale(`<h2>Créer un fond vidéo sur mesure — plan ${k + 1}</h2>
      <p class="muet">Le prompt part des calques de ce plan et de son fond actuel. Le studio y ajoute le thème de l'invitation (couleurs, décor des autres fonds) et la zone à laisser libre.</p>
      <div class="ia-grille">
        <div class="pile">
          <p class="ia-etape">1. Les calques de ce plan</p>
          <p class="muet" style="margin:0">Ce que le nouveau fond doit accueillir. Corrigez un texte ici si besoin, ou décochez un calque à ne pas mentionner. Pour en ajouter ou en déplacer, fermez cette fenêtre et utilisez le panneau du plan.</p>
          <div id="fi-calques" class="pile">${lignesCalques() || '<p class="muet">Aucun calque sur ce plan.</p>'}</div>
          <p class="ia-etape" style="margin-top:6px">2. Point de départ du nouveau fond</p>
          <div class="pile depart">
            <label class="cases"><input type="radio" name="fi-mode" value="actuel" ${h.mode !== 'autre' ? 'checked' : ''}> <span><b>Le fond actuel du plan</b> — un autre fond du même thème, proche de son décor</span></label>
            <label class="cases"><input type="radio" name="fi-mode" value="autre" ${h.mode === 'autre' ? 'checked' : ''}> <span><b>Une autre vidéo ou image d'inspiration</b>, même sans rapport avec le thème : l'IA la transformera aux couleurs de l'invitation</span></label>
            <label class="cases"><input type="radio" name="fi-mode" value="recolorer" ${h.mode === 'recolorer' ? 'checked' : ''}> <span><b>Recolorer une vidéo déjà prête</b> aux couleurs du fond actuel (étalonnage) : sa composition et son mouvement restent identiques</span></label>
            <div id="fi-recol" class="pile" style="margin-left:24px;${h.mode === 'recolorer' ? '' : 'display:none'}">
              <div class="ligne"><label class="btn petit">Choisir la vidéo à recolorer<input type="file" id="fi-v2" accept="video/*" hidden></label><span class="muet" id="fi-v2-nom">aucune vidéo choisie</span></div>
              <label class="champ">Correspondances particulières <span class="muet">(facultatif)</span><input type="text" id="fi-corr" value="${esc(h.correspondances || '')}" placeholder="Ex. : les roses blanches deviennent bordeaux #7a1f2b, le filet doré reste doré"></label>
              <div id="fi-palette" class="muet">La palette du fond actuel sera mesurée automatiquement.</div>
              <div class="carte pile" style="padding:10px;background:#fbf7f1">
                <b>Recolorer ici, automatiquement et gratuitement</b>
                <label class="champ">Intensité<input type="range" id="fi-force" min="0.3" max="1" step="0.05" value="0.9"></label>
                <div class="comparer" id="fi-comp"></div>
                <div class="ligne"><button class="btn petit" id="fi-voir">Aperçu avant / après</button><button class="btn petit plein" id="fi-auto">Recolorer toute la vidéo</button></div>
                <div class="progres"><div id="fi-barre"></div></div>
                <span class="muet">Plus simple et plus rapide que l'IA, mais moins précis élément par élément. Sinon, utilisez le prompt ci-contre avec Claude.</span>
              </div>
            </div>
            <div id="fi-autre" class="pile" style="margin-left:24px;${h.mode === 'autre' ? '' : 'display:none'}">
              <div class="ligne"><label class="btn petit">Choisir le fichier d'inspiration<input type="file" id="fi-insp" accept="video/*,image/*" hidden></label><span class="muet" id="fi-insp-nom">${esc(h.inspiration || 'aucun fichier choisi')}</span></div>
              <label class="champ">La transformer pour suivre<select id="fi-suivre"><option value="fond" ${h.suivre !== 'invitation' ? 'selected' : ''}>le style du fond actuel de ce plan</option><option value="invitation" ${h.suivre === 'invitation' ? 'selected' : ''}>le thème de toute l'invitation</option></select></label>
            </div>
          </div>
          <div id="fi-bloc-idee" class="pile" style="${h.mode === 'recolorer' ? 'display:none' : ''}">
          <p class="ia-etape" style="margin-top:6px">3. Votre idée <span class="muet" style="font-weight:400">(facultatif)</span></p>
          <textarea id="fi-idee" rows="2" style="width:100%" placeholder="Ex. : plus de lumière dorée, des bougies sur les côtés…">${esc(h.idee || '')}</textarea>
          <div class="ligne" style="gap:6px">${(IDEES[role] || IDEES.intermediaire).map(t => `<button class="btn petit" data-idee="${esc(t)}">${esc(t)}</button>`).join('')}</div>
          <div class="deux"><label class="champ">Mouvement<select id="fi-mvt">${['calme', 'moyen', 'vivant'].map(m => `<option ${h.mouvement === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
            <label class="champ">Durée de la vidéo (s)<input type="number" id="fi-duree" min="5" max="15" value="${h.duree || Math.max(8, Math.ceil(Number(pl.duree) || 8))}"></label></div>
          </div>
          <button class="btn plein" id="fi-generer">Régénérer le prompt</button>
        </div>
        <div class="pile">
          <p class="ia-etape">4. Copier le prompt et joindre les fichiers</p>
          <div class="onglets" id="fi-onglets" style="margin:0"><a href="#" data-cible="ia" class="actif">Pour ChatGPT ou Claude</a><a href="#" data-cible="video">Directement pour Sora, Veo, Kling, Runway, Wan 2.2</a></div>
          <textarea class="prompt-zone" id="fi-prompt" readonly></textarea>
          <div class="ligne"><button class="btn plein" id="fi-copier">Copier le prompt</button><button class="btn plein" id="fi-video">Télécharger la vidéo de fond actuelle</button><button class="btn petit" id="fi-image">ou l'image</button><button class="btn petit" id="fi-fondseul" title="Première image du fond, sans les textes : point de départ pour Wan 2.2 (image vers vidéo)">Image du fond seul (Wan 2.2)</button></div>
          <p class="muet" style="margin:0" id="fi-joindre">Envoyez le prompt avec la vidéo de fond actuelle jointe : l'IA s'en sert comme modèle pour créer la nouvelle vidéo.</p><p class="muet" style="margin:0" id="fi-note"> ChatGPT peut créer la vidéo s'il a accès à la génération vidéo ; sinon il rend un prompt anglais amélioré pour un générateur de vidéo. Claude écrit le prompt mais ne crée pas de vidéo.</p>
          <p class="ia-etape" style="margin-top:6px">5. Importer la nouvelle vidéo <span class="muet" style="font-weight:400">(ou celle recolorée ici)</span></p>
          <div class="ligne"><label class="btn plein">Choisir la vidéo<input type="file" id="fi-fichier" accept="video/*" hidden></label><span id="fi-apercu" class="muet">Verticale 9:16, de préférence 1080 × 1920, sans texte.</span></div>
          <div class="deux"><label class="champ">Nom du fond<input type="text" id="fi-nom" value="${esc('Fond plan ' + (k + 1) + ' — ' + (p.fiche.titre || '').slice(0, 30))}"></label>
          <label class="champ">Usage<select id="fi-usage">${['ouverture', 'titre', 'programme', 'confirmation', 'remerciement'].map(u => `<option ${u === usage ? 'selected' : ''}>${u}</option>`).join('')}</select></label></div>
          <div class="cases"><label><input type="checkbox" id="fi-autres"> Remplacer aussi dans les autres plans qui utilisent le fond actuel</label></div>
          <button class="btn plein" id="fi-utiliser" disabled>Utiliser ce fond pour le plan ${k + 1}</button>
        </div>
      </div>`, (box, fermer) => {
      let cible = 'ia', fichier = null;
      let inspiration = h.inspiration || '';
      const mode = () => ($('input[name=fi-mode]:checked', box) || {}).value || 'actuel';
      const lire = () => ({ idee: $('#fi-idee', box).value.trim(), mouvement: $('#fi-mvt', box).value, duree: Number($('#fi-duree', box).value) || 8, mode: mode(), inspiration, suivre: $('#fi-suivre', box).value });
      let video2 = null, paletteRef = null, statsRef = null;
      const majJoindre = () => {
        const j = $('#fi-joindre', box);
        const rec = mode() === 'recolorer';
        $('#fi-onglets', box).style.display = rec ? 'none' : '';
        $('#fi-note', box).textContent = rec ? ' Claude sait faire cette recoloration (il mesure la palette, puis recolore la vidéo 2 et vous rend le MP4) ; ChatGPT aussi s\'il peut traiter des vidéos.' : ' ChatGPT peut créer la vidéo s\'il a accès à la génération vidéo ; sinon il rend un prompt anglais amélioré pour un générateur de vidéo. Claude écrit le prompt mais ne crée pas de vidéo.';
        if (rec) { j.innerHTML = video2 ? `Joignez au prompt <b>la vidéo 1</b> (fond actuel, bouton ci-dessus) <b>et la vidéo 2</b> (${esc(video2.name)}).` : '<b>Choisissez d\'abord la vidéo à recolorer</b> (étape 2).'; return; }
        if (mode() === 'autre') j.innerHTML = inspiration ? `Joignez au prompt <b>votre fichier d'inspiration</b> (${esc(inspiration)})${$('#fi-suivre', box).value === 'fond' ? ' <b>et la vidéo de fond actuelle</b>' : ''}.` : '<b>Choisissez d\'abord le fichier d\'inspiration</b> (étape 2).';
        else j.textContent = 'Joignez au prompt la vidéo de fond actuelle : l\'IA s\'en sert comme modèle pour créer un autre fond du même thème.';
      };
      const generer = () => {
        const o = lire();
        const calques = (pl.calques || []).filter(c => !c.masque && !exclus.has(c.id)).map(c => ({ c, b: E.eng.bbox[c.id] }));
        const zs = calques.map(x => x.b).filter(Boolean);
        const texte = o.mode === 'recolorer'
          ? Fabrique.promptEtalonnage({ video1: nomRef(), video2: video2 ? video2.name : '', palette: paletteRef, correspondances: $('#fi-corr', box).value.trim(), zone: zs.length ? { haut: Math.round(Math.min(...zs.map(b => b.y))), bas: Math.round(Math.max(...zs.map(b => b.y + b.h))) } : null })
          : Fabrique.promptFond(p, k, Object.assign({ calques, fonds: tousFonds(), cible, reference: nomRef() }, o, { inspiration: o.mode === 'autre' ? (o.inspiration || 'inspiration') : '' }));
        o.correspondances = $('#fi-corr', box).value.trim();
        $('#fi-prompt', box).value = texte;
        pl.fond_ia = Object.assign({}, pl.fond_ia || {}, o, { exclus: [...exclus], prompt: texte, date: new Date().toISOString() });
        enregistrer(p);
      };
      generer(); majJoindre();
      const urlFond = async () => { const src = pl.fond.media; if (/^idb:/.test(src)) { const b = await IDB.lire(src); return URL.createObjectURL(b); } return resoudre(src); };
      const mesurer = async () => {
        if (paletteRef) return;
        try {
          $('#fi-palette', box).textContent = 'Mesure de la palette du fond actuel…';
          const r = await Etalonnage.palette(await urlFond(), 6);
          paletteRef = r.palette; statsRef = r.stats;
          $('#fi-palette', box).innerHTML = 'Palette du fond actuel : ' + paletteRef.map(x => `<span class="pastille" style="background:${x.hex}" title="${esc(x.role)} · ${x.part} %"></span>`).join('') + ' <span class="muet">(ajoutée au prompt)</span>';
          generer();
        } catch (e) { $('#fi-palette', box).textContent = e.message; }
      };
      $$('input[name=fi-mode]', box).forEach(r => r.onchange = () => {
        $('#fi-autre', box).style.display = mode() === 'autre' ? '' : 'none';
        $('#fi-recol', box).style.display = mode() === 'recolorer' ? '' : 'none';
        $('#fi-bloc-idee', box).style.display = mode() === 'recolorer' ? 'none' : '';
        if (mode() === 'recolorer') mesurer();
        generer(); majJoindre();
      });
      if (mode() === 'recolorer') mesurer();
      $('#fi-corr', box).oninput = () => { clearTimeout(box._t); box._t = setTimeout(generer, 400); };
      $('#fi-v2', box).onchange = e => { video2 = e.target.files[0]; if (!video2) return; $('#fi-v2-nom', box).textContent = video2.name; $('#fi-comp', box).innerHTML = ''; generer(); majJoindre(); };
      let statsV2 = null, urlV2 = null;
      const preparer = async () => {
        if (!video2) throw new Error('Choisissez d\'abord la vidéo à recolorer');
        await mesurer(); if (!statsRef) throw new Error('Palette du fond actuel indisponible');
        if (!urlV2 || urlV2.nom !== video2.name) { urlV2 = { u: URL.createObjectURL(video2), nom: video2.name }; statsV2 = (await Etalonnage.palette(urlV2.u, 6)).stats; }
        return Etalonnage.construireLUT(statsV2, statsRef, Number($('#fi-force', box).value));
      };
      $('#fi-voir', box).onclick = async () => {
        try { const lut = await preparer(); const a = await Etalonnage.apercu(urlV2.u, lut); $('#fi-comp', box).innerHTML = `<div><img src="${a.avant}" style="width:110px;border-radius:8px"><br>Avant</div><div><img src="${a.apres}" style="width:110px;border-radius:8px"><br>Après</div>`; }
        catch (e) { toast(e.message); }
      };
      $('#fi-force', box).oninput = () => { clearTimeout(box._f); box._f = setTimeout(() => { if ($('#fi-comp', box).innerHTML) $('#fi-voir', box).click(); }, 300); };
      $('#fi-auto', box).onclick = async () => {
        const b = $('#fi-auto', box); b.disabled = true;
        try {
          const lut = await preparer();
          b.textContent = 'Recoloration en cours…';
          const r = await Etalonnage.recolorer(urlV2.u, lut, { progres: v => { $('#fi-barre', box).style.width = Math.round(v * 100) + '%'; } });
          fichier = new File([r.blob], video2.name.replace(/\.\w+$/, '') + '-recolore.' + r.extension, { type: r.blob.type });
          const u = URL.createObjectURL(fichier);
          $('#fi-apercu', box).innerHTML = `<video src="${u}" autoplay muted loop playsinline style="width:90px;aspect-ratio:9/16;object-fit:cover;border-radius:8px;vertical-align:middle"></video> ${esc(fichier.name)} <a href="${u}" download="${esc(fichier.name)}">télécharger</a>`;
          $('#fi-utiliser', box).disabled = false;
          toast('Vidéo recolorée : vérifiez-la à l\'étape 5, puis « Utiliser ce fond »');
        } catch (e) { toast(e.message); }
        b.disabled = false; b.textContent = 'Recolorer toute la vidéo';
      };
      $('#fi-suivre', box).onchange = () => { generer(); majJoindre(); };
      $('#fi-insp', box).onchange = e => { const f = e.target.files[0]; if (!f) return; inspiration = f.name; $('#fi-insp-nom', box).textContent = f.name; generer(); majJoindre(); };
      $$('.calque-ia', box).forEach(l => {
        const id = l.dataset.id, c = pl.calques.find(x => x.id === id);
        $('input[type=checkbox]', l).onchange = e => { if (e.target.checked) exclus.delete(id); else exclus.add(id); l.classList.toggle('off', !e.target.checked); generer(); };
        const t = $('.ci-texte', l);
        if (t) t.oninput = () => { E.modif(); c.texte = t.value; E.rafraichir(); generer(); };
      });
      $$('[data-idee]', box).forEach(b => b.onclick = () => { const t = $('#fi-idee', box); t.value = (t.value ? t.value.replace(/[.\s]*$/, '') + '. ' : '') + b.dataset.idee; generer(); });
      $('#fi-idee', box).oninput = () => { clearTimeout(box._t); box._t = setTimeout(generer, 500); };
      $('#fi-mvt', box).onchange = generer; $('#fi-duree', box).oninput = generer;
      $('#fi-generer', box).onclick = () => { generer(); toast('Prompt régénéré'); };
      $$('[data-cible]', box).forEach(a => a.onclick = e => { e.preventDefault(); cible = a.dataset.cible; $$('[data-cible]', box).forEach(x => x.classList.toggle('actif', x === a)); generer(); });
      $('#fi-copier', box).onclick = () => copier($('#fi-prompt', box).value);
      $('#fi-video', box).onclick = async () => {
        try {
          const src = pl.fond.media;
          let blob = /^idb:/.test(src) ? await IDB.lire(src) : await (await fetch(await resoudre(src))).blob();
          if (!blob) throw new Error('fichier introuvable');
          telecharger(nomRef(), blob);
        } catch (e) { toast('Téléchargement impossible : ' + e.message); }
      };
      $('#fi-fondseul', box).onclick = async () => {
        try {
          const u = await urlFond();
          const v = document.createElement('video'); v.muted = true; v.src = u;
          await new Promise((ok, ko) => { v.onloadeddata = ok; v.onerror = () => ko(new Error('vidéo illisible')); });
          await new Promise(ok => { v.onseeked = ok; v.currentTime = Math.min(1, (v.duration || 2) / 2); });
          const c = document.createElement('canvas'); c.width = 704; c.height = 1280;
          const g = c.getContext('2d'); const r = Math.max(704 / v.videoWidth, 1280 / v.videoHeight);
          g.drawImage(v, (704 - v.videoWidth * r) / 2, (1280 - v.videoHeight * r) / 2, v.videoWidth * r, v.videoHeight * r);
          telecharger(nomRef().replace(/\.mp4$/, '') + '-704x1280.jpg', dataURLversBlob(c.toDataURL('image/jpeg', 0.92)));
        } catch (e) { toast('Image impossible : ' + e.message); }
      };
      $('#fi-image', box).onclick = () => { try { telecharger(`mise-en-page-plan-${k + 1}.jpg`, dataURLversBlob(E.eng.imageTest())); } catch (e) { toast(e.message); } };
      $('#fi-fichier', box).onchange = e => {
        fichier = e.target.files[0]; if (!fichier) return;
        const u = URL.createObjectURL(fichier);
        $('#fi-apercu', box).innerHTML = `<video src="${u}" autoplay muted loop playsinline style="width:90px;aspect-ratio:9/16;object-fit:cover;border-radius:8px;vertical-align:middle"></video> ${esc(fichier.name)}`;
        $('#fi-utiliser', box).disabled = false;
      };
      $('#fi-utiliser', box).onclick = async () => {
        if (!fichier) return;
        const m = await importerFichier(fichier, 'fond');
        const o = lire();
        Object.assign(m, { nom: $('#fi-nom', box).value.trim() || m.nom, usage: $('#fi-usage', box).value, description: o.idee || 'Fond créé avec l\'IA pour le plan ' + (k + 1), description_en: '', zone_texte: 'voir la mise en page du plan ' + (k + 1), origine: 'ia' });
        sauverMedias();
        E.modif(true);
        const ancien = pl.fond.media;
        if ($('#fi-autres', box).checked) p.plans.forEach(x => { if (x.fond && x.fond.media === ancien) x.fond.media = m.src; });
        pl.fond.media = m.src;
        pl.fond_ia = Object.assign(pl.fond_ia || {}, { fichier: m.src });
        enregistrer(p); fermer();
        E.eng.precharger().then(() => { E.eng._entrerPlan(); E.afficher(); });
        toast('Nouveau fond appliqué (↶ pour revenir en arrière)');
      };
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
  function ongletInvites(p) {
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
      <div class="carte" style="padding:10px"><div class="tableau-boite"><table class="tableau">
        <thead><tr><th>Famille</th><th>Catégorie</th><th>Places</th><th>Adultes</th><th>Enfants</th><th>Téléphone</th><th>Statut</th><th>Table</th><th>Lien</th><th></th></tr></thead>
        <tbody>${fs.map((f, k) => `<tr data-k="${k}">
          <td><input type="text" data-k="nom" value="${esc(f.nom)}"></td><td><input type="text" data-k="categorie" value="${esc(f.categorie || '')}" style="width:100px"></td>
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
    $('#add-fam').onclick = () => { fs.push({ id: uid(), code: codeFamille(), nom: 'Nouvelle famille', categorie: '', places: 2, adultes: 2, enfants: 0, telephone: '', statut: 'attente' }); enregistrer(p); ongletInvites(p); };
    $$('.tableau tbody tr[data-k]').forEach(tr => {
      const f = fs[Number(tr.dataset.k)];
      $$('[data-k]', tr).forEach(inp => inp.onchange = () => {
        f[inp.dataset.k] = inp.type === 'number' ? Number(inp.value) : inp.value;
        if (inp.dataset.k === 'adultes' || inp.dataset.k === 'enfants') { f.places = Math.max(Number(f.places) || 0, (Number(f.adultes) || 0) + (Number(f.enfants) || 0)); }
        enregistrer(p); if (inp.dataset.k === 'statut' || inp.dataset.k === 'adultes' || inp.dataset.k === 'enfants') ongletInvites(p);
      });
      $$('[data-a]', tr).forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (!f.code) f.code = codeFamille();
        if (a === 'copier') copier(lienFamille(p, f));
        if (a === 'wa') { const msg = p.message_envoi.replace(/\{famille\}/g, f.nom).replace(/\{lien\}/g, lienFamille(p, f)); window.open((f.telephone ? 'https://wa.me/' + telWa(f.telephone) : 'https://wa.me/') + '?text=' + encodeURIComponent(msg), '_blank'); }
        if (a === 'voir') { Stock.ecrire('studio.apercu', publication(p, true)); window.open('../i/?apercu=1&f=' + encodeURIComponent(f.code), '_blank'); }
        if (a === 'suppr') { if (confirm('Supprimer ' + f.nom + ' ?')) { fs.splice(Number(tr.dataset.k), 1); enregistrer(p); ongletInvites(p); } }
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
    (p.familles || []).forEach(f => { if (!f.code) f.code = codeFamille(); pub.liens[f.code] = { nom: f.nom, places: f.places, adultes: f.adultes, enfants: f.enfants }; });
    delete pub.familles; delete pub.historique_ia; delete pub.message_envoi;
    if (pub.fiche) delete pub.fiche.texte_source;
    pub.publication = { date: new Date().toISOString(), firebase: reglages.firebase || null };
    if (!apercu) pub.plans.forEach(pl => { (pl.calques || []).forEach(c => { if (c.media && /^idb:/.test(c.media)) c.media = 'medias/' + c.media.slice(4); }); if (pl.fond && /^idb:/.test(pl.fond.media)) pl.fond.media = 'medias/' + pl.fond.media.slice(4); });
    if (!apercu && pub.musique && /^idb:/.test(pub.musique.src)) pub.musique.src = 'medias/' + pub.musique.src.slice(4);
    return pub;
  }
  const enJS = (slug, obj) => 'window.PROJETS = window.PROJETS || {};\nwindow.PROJETS[' + JSON.stringify(slug) + '] = ' + JSON.stringify(obj) + ';\n';
  function anonymiser(pub) {
    const d = JSON.parse(JSON.stringify(pub));
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

  function ongletPublier(p) {
    const g = reglages.github || {};
    const pret = g.owner && g.repo && g.token;
    const fichiersIdb = [];
    p.plans.forEach(pl => { if (/^idb:/.test(pl.fond.media)) fichiersIdb.push(pl.fond.media); pl.calques.forEach(c => { if (/^idb:/.test(c.media || '')) fichiersIdb.push(c.media); }); });
    if (p.musique && /^idb:/.test(p.musique.src)) fichiersIdb.push(p.musique.src);
    $('#onglet').innerHTML = `<div class="ia-grille">
      <div class="pile">
        <div class="carte pile"><h3>Aperçu</h3>
          <p class="muet">Ouvre l'invitation telle que la verront les invités (sur cet appareil).</p>
          <div class="ligne"><button class="btn" id="ap-gen">Lien général</button><button class="btn" id="ap-fam">Lien personnel (famille test)</button></div></div>
        <div class="carte pile"><h3>Musique du film</h3>
          <p class="muet">${p.musique ? 'Musique : ' + esc(p.musique.nom || p.musique.src) : 'Aucune musique. Utilisez une piste dont vous avez les droits.'}</p>
          <div class="ligne"><label class="btn">${p.musique ? 'Changer' : 'Ajouter une musique'}<input type="file" id="musique" accept="audio/*" hidden></label>${p.musique ? '<button class="btn danger" id="musique-suppr">Retirer</button>' : ''}</div>
          ${p.musique ? `<label class="champ">Volume<input type="range" id="volume" min="0" max="1" step="0.05" value="${p.musique.volume != null ? p.musique.volume : 0.8}"></label>` : ''}</div>
        <div class="carte pile"><h3>Film vidéo</h3>
          <p class="muet">Enregistre le film (ouverture, plans intermédiaires, remerciement) directement dans le navigateur, en temps réel. Gardez cet onglet ouvert pendant l'enregistrement. Format MP4 sur Chrome récent, sinon WebM.</p>
          <div class="apercu-cadre" style="height:340px;margin:0 auto" id="cadre-film"><div id="scene-film"></div></div>
          <div class="progres"><div id="barre"></div></div>
          <div class="ligne"><button class="btn plein" id="film">Enregistrer le film</button><span class="muet" id="film-etat"></span></div></div>
      </div>
      <div class="pile">
        <div class="carte pile"><h3>Publier en ligne</h3>
          ${pret ? `<p class="muet">Dépôt : <b>${esc(g.owner)}/${esc(g.repo)}</b>. La publication envoie l'invitation${fichiersIdb.length ? ` et ${fichiersIdb.length} fichier(s) importé(s)` : ''} sur GitHub Pages (1 à 10 minutes avant d'être visible).</p>
            <label class="cases"><label><input type="checkbox" id="demo" ${p.vitrine ? 'checked' : ''}> Publier aussi en démo anonymisée sur la vitrine</label></label>
            <button class="btn plein" id="publier">Publier l'invitation</button><div id="pub-etat" class="muet"></div>`
            : `<div class="alerte-boite">Publication automatique non configurée. Allez dans <a href="#/reglages">Réglages</a> pour relier votre dépôt GitHub (une seule fois).</div>
            <p class="muet">En attendant, vous pouvez télécharger le fichier de publication et l'envoyer à Claude.</p>`}
          <button class="btn" id="tele-pub">Télécharger le fichier de publication</button>
          <button class="btn" id="tele-projet">Sauvegarder le projet complet (.json)</button>
        </div>
        <div class="carte pile"><h3>Liens</h3>
          <p class="muet">Lien général (groupes, réseaux sociaux) :</p>
          <div class="ligne"><input type="text" readonly value="${esc(lienGeneral(p))}" style="flex:1"><button class="btn petit" id="cp-gen">Copier</button></div>
          <div class="ligne"><a class="btn petit" target="_blank" href="https://wa.me/?text=${encodeURIComponent(lienGeneral(p))}">Partager sur WhatsApp</a><a class="btn petit" target="_blank" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(lienGeneral(p))}">Partager sur Facebook</a></div>
          <p class="muet">Liens personnels : onglet Invités.</p></div>
      </div></div>`;
    $('#ap-gen').onclick = () => { Stock.ecrire('studio.apercu', publication(p, true)); window.open('../i/?apercu=1', '_blank'); };
    $('#ap-fam').onclick = () => { Stock.ecrire('studio.apercu', publication(p, true)); window.open('../i/?apercu=1&test=1', '_blank'); };
    $('#cp-gen').onclick = () => copier(lienGeneral(p));
    $('#tele-pub').onclick = () => telecharger(p.slug + '.json', JSON.stringify(publication(p), null, 1));
    $('#tele-projet').onclick = () => telecharger(p.slug + '-projet.json', JSON.stringify(p, null, 1));
    $('#musique').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const id = 'idb:' + uid() + '.' + (f.name.split('.').pop() || 'mp3').toLowerCase();
      await IDB.mettre(id, f); p.musique = { src: id, nom: f.name, volume: 0.8 }; enregistrer(p); ongletPublier(p);
    };
    const ms = $('#musique-suppr'); if (ms) ms.onclick = () => { p.musique = null; enregistrer(p); ongletPublier(p); };
    const vol = $('#volume'); if (vol) vol.oninput = e => { p.musique.volume = Number(e.target.value); enregistrer(p); };
    const eng = new Moteur($('#scene-film'), { mode: 'rendu', resolveur: resoudre });
    moteurCourant = eng;
    eng.setProjet(p).then(() => eng.afficherPlan(0, 0.5));
    $('#film').onclick = async () => {
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return toast('Ce navigateur ne sait pas enregistrer : utilisez Chrome sur ordinateur');
      const b = $('#film'); b.disabled = true; $('#film-etat').textContent = 'Enregistrement…';
      try {
        const mus = p.musique ? await resoudre(p.musique.src) : null;
        const r = await eng.exporterFilm({ musique: mus, volume: p.musique ? p.musique.volume : 0.8, progres: v => { $('#barre').style.width = Math.round(v * 100) + '%'; } });
        telecharger(`${p.slug}-film.${r.extension}`, r.blob);
        $('#film-etat').textContent = `Film prêt (${Math.round(r.duree)} s, ${(r.blob.size / 1e6).toFixed(1)} Mo, ${r.extension.toUpperCase()})`;
      } catch (e) { console.error(e); $('#film-etat').textContent = 'Erreur : ' + e.message; }
      b.disabled = false;
    };
    const pb = $('#publier');
    if (pb) pb.onclick = async () => {
      pb.disabled = true;
      const etat = $('#pub-etat');
      try {
        p.vitrine = $('#demo').checked;
        for (const id of [...new Set(fichiersIdb)]) {
          etat.textContent = 'Envoi de ' + id.slice(4) + '…';
          const blob = await IDB.lire(id);
          if (blob) await GitHub.envoyer('medias/' + id.slice(4), blob, 'Média ' + id.slice(4));
        }
        etat.textContent = 'Envoi de l\'invitation…';
        const pub = publication(p);
        await GitHub.envoyer('projets/' + p.slug + '.json', JSON.stringify(pub, null, 1), 'Invitation ' + p.fiche.titre);
        await GitHub.envoyer('projets/' + p.slug + '.js', enJS(p.slug, pub), 'Invitation ' + p.fiche.titre + ' (js)');
        if (p.vitrine) {
          etat.textContent = 'Mise à jour de la vitrine…';
          const demo = anonymiser(pub);
          await GitHub.envoyer('projets/demo-' + p.slug + '.json', JSON.stringify(demo, null, 1), 'Démo ' + p.fiche.titre);
          await GitHub.envoyer('projets/demo-' + p.slug + '.js', enJS('demo-' + p.slug, demo), 'Démo ' + p.fiche.titre + ' (js)');
          let index = [];
          try { index = JSON.parse(await GitHub.lireTexte('vitrine/index.json')) || []; } catch (e) { index = []; }
          index = index.filter(x => x.slug !== 'demo-' + p.slug);
          const fondV = (p.plans.find(x => x.role !== 'ouverture') || p.plans[0]).fond.media;
          index.unshift({ slug: 'demo-' + p.slug, titre: demo.fiche.titre, type: demo.fiche.type, langue: demo.fiche.langue, vignette: /^idb:/.test(fondV) ? 'medias/' + fondV.slice(4).replace(/\.\w+$/, '.jpg') : fondV.replace(/\.mp4$/, '.jpg'), date: new Date().toISOString().slice(0, 10) });
          await GitHub.envoyer('vitrine/index.json', JSON.stringify(index, null, 1), 'Vitrine : ' + p.fiche.titre);
          await GitHub.envoyer('vitrine/index.js', 'window.VITRINE = ' + JSON.stringify(index, null, 1) + ';\n', 'Vitrine : ' + p.fiche.titre + ' (js)');
        }
        p.publie = new Date().toISOString(); enregistrer(p);
        etat.innerHTML = `<div class="ok-boite">Publié. Visible dans quelques minutes : <a target="_blank" href="${esc(lienGeneral(p))}">${esc(lienGeneral(p))}</a></div>`;
      } catch (e) { console.error(e); etat.innerHTML = `<div class="erreur-boite">Échec : ${esc(e.message)}</div>`; }
      pb.disabled = false;
    };
  }

  /* ================= GitHub (publication sans serveur) ================= */
  const GitHub = {
    api(chemin) { const g = reglages.github; return `https://api.github.com/repos/${g.owner}/${g.repo}/contents/${chemin.split('/').map(encodeURIComponent).join('/')}`; },
    entetes() { return { Authorization: 'Bearer ' + reglages.github.token, Accept: 'application/vnd.github+json' }; },
    async sha(chemin) {
      const r = await fetch(this.api(chemin) + '?ref=' + encodeURIComponent(reglages.github.branche || 'main'), { headers: this.entetes() });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('GitHub ' + r.status + ' : ' + (await r.text()).slice(0, 120));
      return (await r.json()).sha;
    },
    async lireTexte(chemin) {
      const r = await fetch(this.api(chemin) + '?ref=' + encodeURIComponent(reglages.github.branche || 'main'), { headers: Object.assign(this.entetes(), { Accept: 'application/vnd.github.raw' }) });
      if (!r.ok) throw new Error('absent');
      return r.text();
    },
    async base64(contenu) {
      const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: 'text/plain' });
      return new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
    },
    async envoyer(chemin, contenu, message) {
      const sha = await this.sha(chemin);
      const corps = { message, content: await this.base64(contenu), branch: reglages.github.branche || 'main' };
      if (sha) corps.sha = sha;
      const r = await fetch(this.api(chemin), { method: 'PUT', headers: Object.assign(this.entetes(), { 'Content-Type': 'application/json' }), body: JSON.stringify(corps) });
      if (!r.ok) throw new Error('GitHub ' + r.status + ' : ' + (await r.text()).slice(0, 160));
      return r.json();
    }
  };

  /* ================= Bibliothèque ================= */
  function vueBibliotheque() {
    const fonds = tousFonds();
    const autres = medias.filter(m => m.type !== 'fond');
    $('#app').innerHTML = `<div class="entete"><div><h1>Bibliothèque</h1><p>Fonds vidéo vierges (vertical 9:16), photos, vidéos du client et décors.</p></div>
      <div class="ligne"><label class="btn plein">+ Importer un fond vidéo<input type="file" id="imp-fond" accept="video/*" multiple hidden></label><label class="btn">+ Photo ou vidéo<input type="file" id="imp-media" accept="image/*,video/*" multiple hidden></label></div></div>
      <h3>Fonds vidéo</h3>
      <div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">${fonds.map(f => `
        <div class="carte pile" data-id="${f.id}" style="padding:12px">
          <video src="" data-src="${esc(f.src)}" muted loop playsinline style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;background:#eee" poster="${esc(/^data:/.test(f.vignette) ? f.vignette : BASE + f.vignette)}"></video>
          ${f.src.startsWith('idb:') ? `
            <input type="text" data-k="nom" value="${esc(f.nom)}">
            <label class="champ">Usage conseillé<select data-k="usage">${['ouverture', 'titre', 'programme', 'confirmation', 'remerciement'].map(u => `<option ${f.usage === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
            <label class="champ">Description (pour l'IA)<input type="text" data-k="description" value="${esc(f.description || '')}"></label>
            <label class="champ">Zone de texte libre<input type="text" data-k="zone_texte" value="${esc(f.zone_texte || '')}"></label>
            <button class="btn petit danger" data-suppr="${f.id}">Supprimer</button>`
            : `<b>${esc(f.nom)}</b><div class="muet">${esc(f.usage)} · ${f.duree} s · fond de base</div><div class="muet">${esc(f.description)}</div>`}
        </div>`).join('')}</div>
      <h3 style="margin-top:24px">Photos et vidéos</h3>
      ${autres.length ? `<div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">${autres.map(m => `<div class="carte pile" style="padding:10px"><img src="${esc(m.vignette)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px"><b style="font-size:13px">${esc(m.nom)}</b><button class="btn petit danger" data-suppr="${m.id}">Supprimer</button></div>`).join('')}</div>` : '<p class="muet">Aucune photo ou vidéo importée.</p>'}
      <p class="muet" style="margin-top:20px">Les fichiers importés restent dans ce navigateur jusqu'à la publication, qui les envoie sur GitHub.</p>`;
    $$('video[data-src]').forEach(v => { resoudre(v.dataset.src).then(u => { v.src = u; }); v.onmouseenter = () => v.play(); v.onmouseleave = () => v.pause(); v.onclick = () => v.paused ? v.play() : v.pause(); });
    $$('[data-k]').forEach(i => i.onchange = () => { const id = i.closest('[data-id]').dataset.id; const m = medias.find(x => x.id === id); if (m) { m[i.dataset.k] = i.value; sauverMedias(); } });
    $$('[data-suppr]').forEach(b => b.onclick = async () => { if (!confirm('Supprimer ce fichier ?')) return; const m = medias.find(x => x.id === b.dataset.suppr); medias = medias.filter(x => x !== m); sauverMedias(); if (m) await IDB.suppr(m.src); vueBibliotheque(); });
    $('#imp-fond').onchange = e => importer([...e.target.files], 'fond');
    $('#imp-media').onchange = e => importer([...e.target.files], null);
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
  function nomMedia(src) { const m = medias.find(x => x.src === src); return m ? m.nom : ''; }
  async function importerFichier(f, type) {
    const video = /^video/.test(f.type);
    const ext = (f.name.split('.').pop() || (video ? 'mp4' : 'jpg')).toLowerCase();
    const id = 'm' + uid();
    const src = 'idb:' + id + '.' + ext;
    await IDB.mettre(src, f);
    const url = URL.createObjectURL(f);
    const info = video ? await vignetteVideo(url) : await vignetteImage(url);
    const m = { id, nom: f.name.replace(/\.\w+$/, ''), src, type: type || (video ? 'video' : 'image'), vignette: info.vignette, duree: info.duree ? Math.round(info.duree * 10) / 10 : 0, l: info.l, h: info.h };
    if (m.type === 'fond') {
      Object.assign(m, { usage: 'programme', description: '', zone: { x: 50, y: 50, largeur: 66 }, zone_texte: 'centre' });
      if (info.l && info.h && Math.abs(info.l / info.h - 9 / 16) > 0.03) toast(`${f.name} n'est pas au format vertical 9:16 : il sera recadré`);
      else if (info.duree && info.duree < 4) toast(`${f.name} dure moins de 4 s : il bouclera souvent`);
    }
    medias.push(m);
    return m;
  }
  async function importer(fichiers, type) {
    for (const f of fichiers) { await importerFichier(f, type); }
    sauverMedias(); vueBibliotheque(); toast(fichiers.length + ' fichier(s) importé(s)');
  }

  /* ================= Réglages ================= */
  function vueReglages() {
    const g = reglages.github || {};
    $('#app').innerHTML = `<div class="entete"><div><h1>Réglages</h1><p>À faire une seule fois.</p></div></div>
      <div class="ia-grille">
        <div class="carte pile"><h3>Publication sur GitHub Pages</h3>
          <p class="muet">Permet au bouton « Publier » d'envoyer les invitations en ligne, gratuitement. Le jeton reste uniquement dans ce navigateur.</p>
          <div class="deux"><label class="champ">Compte GitHub<input type="text" id="g-owner" value="${esc(g.owner)}" placeholder="randnjara"></label><label class="champ">Dépôt<input type="text" id="g-repo" value="${esc(g.repo)}" placeholder="STUDIO"></label></div>
          <label class="champ">Jeton d'accès (fine-grained token, droit « Contents : Read and write » sur ce dépôt)<input type="password" id="g-token" value="${esc(g.token)}" placeholder="github_pat_…"></label>
          <div class="ligne"><button class="btn plein" id="g-ok">Enregistrer</button><button class="btn" id="g-test">Tester</button><span class="muet" id="g-etat"></span></div>
          <details><summary class="muet" style="cursor:pointer">Comment obtenir le jeton ?</summary><ol class="muet">
            <li>Sur github.com : photo de profil → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.</li>
            <li>Repository access : Only select repositories → choisir le dépôt du studio.</li>
            <li>Permissions → Repository permissions → Contents : Read and write.</li>
            <li>Generate token, copier le jeton et le coller ici.</li></ol></details>
        </div>
        <div class="carte pile"><h3>Réponses des invités (Firebase, facultatif)</h3>
          <p class="muet">Sans Firebase, les invités envoient leur réponse par WhatsApp (message prérempli). Avec Firebase, les réponses arrivent directement dans l'onglet Invités.</p>
          <label class="champ">Configuration web Firebase (JSON)<textarea id="fb" rows="7" placeholder='{"apiKey":"...","authDomain":"...","projectId":"..."}'>${reglages.firebase ? esc(JSON.stringify(reglages.firebase, null, 1)) : ''}</textarea></label>
          <button class="btn plein" id="fb-ok">Enregistrer</button>
        </div>
        <div class="carte pile"><h3>Sauvegarde</h3>
          <p class="muet">Vos projets sont gardés dans ce navigateur. Exportez-les régulièrement, ou pour passer sur un autre appareil.</p>
          <div class="ligne"><button class="btn" id="exp-tout">Exporter tous les projets</button><label class="btn">Importer une sauvegarde<input type="file" id="imp-tout" accept=".json" hidden></label></div>
        </div>
      </div>`;
    $('#g-ok').onclick = () => { reglages.github = { owner: $('#g-owner').value.trim(), repo: $('#g-repo').value.trim(), token: $('#g-token').value.trim(), branche: 'main' }; sauverReglages(); toast('Enregistré'); };
    $('#g-test').onclick = async () => {
      reglages.github = { owner: $('#g-owner').value.trim(), repo: $('#g-repo').value.trim(), token: $('#g-token').value.trim(), branche: 'main' };
      try { const r = await fetch(`https://api.github.com/repos/${reglages.github.owner}/${reglages.github.repo}`, { headers: GitHub.entetes() }); const j = await r.json(); $('#g-etat').textContent = r.ok ? (j.permissions && j.permissions.push ? 'Connexion réussie' : 'Connecté, mais sans droit d\'écriture') : 'Échec : ' + (j.message || r.status); }
      catch (e) { $('#g-etat').textContent = 'Échec : ' + e.message; }
    };
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
        <li><b>✨ Créer un fond sur mesure (IA)</b> : quand il vous manque un fond, ou qu'un même fond revient trop souvent. La fenêtre montre d'abord <b>les calques du plan</b> (textes, boutons, photos) avec leur contenu et leur place : ils sont décrits un par un dans le prompt, pour que le nouveau fond leur laisse de l'espace. Corrigez un texte ou décochez un calque si besoin. Choisissez ensuite le <b>point de départ</b> : le fond actuel (l'IA crée un autre fond du même thème, proche de son décor), ou <b>une autre vidéo ou image d'inspiration</b>, même sans rapport avec le thème, que l'IA transforme aux couleurs du fond actuel ou de toute l'invitation. Votre idée est <b>facultative</b>. Troisième choix : <b>Recolorer une vidéo déjà prête</b> (étalonnage). Le studio mesure la palette du fond actuel et prépare le prompt pour Claude, qui recolore la vidéo élément par élément et vous rend le MP4. Ou bien cliquez <b>Recolorer toute la vidéo</b> pour le faire directement dans le studio, gratuitement (réglez l'intensité, vérifiez avec Aperçu avant / après). Copiez le prompt, cliquez <b>Télécharger la vidéo de fond actuelle</b> et joignez-la au prompt dans ChatGPT (ou Sora, Veo, Kling, Runway) : l'IA s'en sert comme modèle. Importez ensuite la nouvelle vidéo : elle remplace le fond du plan et rejoint la bibliothèque. Le prompt se régénère à chaque changement.</li>
        <li><b>Wan 2.2</b> (gratuit, open source) : il crée des vidéos à partir d'un texte ou d'une image, mais il tourne sur un ordinateur avec une bonne carte graphique (ComfyUI), pas dans le navigateur. Dans « Créer un fond sur mesure », choisissez « Le fond actuel du plan », copiez le prompt de l'onglet <b>Directement pour … Wan 2.2</b> et téléchargez <b>l'image du fond seul</b> (704 × 1280) comme image de départ. Wan 2.2 rend des vidéos de 5 secondes : le studio les fait boucler. Il ne sait pas recolorer une vidéo existante : pour cela, utilisez « Recolorer toute la vidéo » dans le studio.</li>
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
        <li>Quand une famille répond (WhatsApp), changez son <b>Statut</b> : Vient / Ne vient pas. Les chiffres en haut se mettent à jour.</li>
        <li>Écrivez un numéro dans la colonne <b>Table</b> : le plan de tables affiche le remplissage de chaque table.</li></ol>`)}
      ${etape(6, 'Film, publication et envoi', `
        <ol><li>Onglet <b>Film et publication</b> → <b>Ajouter une musique</b> (dont vous avez les droits).</li>
        <li><b>Enregistrer le film</b> : laissez l'onglet ouvert pendant toute la durée du film ; le MP4 se télécharge à la fin. Utilisez Chrome sur ordinateur.</li>
        <li><b>Aperçu</b> : vérifiez le lien général et le lien personnel.</li>
        <li><b>Publier l'invitation</b> (si GitHub est relié dans Réglages). Cochez « démo anonymisée » pour l'ajouter à la vitrine. Les liens marchent quelques minutes après.</li>
        <li>Envoyez le film et le lien général dans les groupes, et le lien personnel à chaque famille depuis l'onglet Invités. Republiez après chaque ajout de famille.</li></ol>`)}
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

  route();
})();
