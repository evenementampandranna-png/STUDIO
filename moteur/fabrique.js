/* Fabrique : du texte de l'invitation à la fiche, de la fiche aux plans, et les prompts IA. */
(function (global) {
  'use strict';
  const uid = () => Math.random().toString(36).slice(2, 10);

  const FONDS = [
    { id: 'fond_1', description_en: 'Ivory envelope with a satin ribbon, a heart wax seal and burgundy rose patterns, full frame', nom: 'Enveloppe au sceau', src: 'fonds/fond_1.mp4', vignette: 'fonds/fond_1.jpg', duree: 4.5, usage: 'ouverture', description: 'Enveloppe ivoire, ruban, sceau de cire cœur, motif de roses, plein cadre', zone: { x: 50, y: 50, largeur: 70 }, zone_texte: 'aucune (plein cadre)' },
    { id: 'fond_2', description_en: 'Classical stone columns on the left and right, burgundy rose garlands, two white doves at the top, aged ivory paper', nom: 'Colonnes et colombes', src: 'fonds/fond_2.mp4', vignette: 'fonds/fond_2.jpg', duree: 5.9, usage: 'titre', description: 'Colonnes classiques à gauche et à droite, guirlandes de roses, deux colombes en haut', zone: { x: 50, y: 50, largeur: 60 }, zone_texte: 'centre, de 18 % à 82 % en largeur, de 15 % à 80 % en hauteur' },
    { id: 'fond_3', description_en: 'A classical column on the left, a frame of burgundy roses, dark petals gently falling', nom: 'Pétales qui tombent', src: 'fonds/fond_3.mp4', vignette: 'fonds/fond_3.jpg', duree: 6.5, usage: 'programme', description: 'Colonne à gauche, cadre de roses, pétales qui tombent au centre gauche', zone: { x: 56, y: 50, largeur: 60 }, zone_texte: 'centre droit, de 26 % à 88 % en largeur, de 10 % à 85 % en hauteur' },
    { id: 'fond_4', description_en: 'A frame of burgundy roses and leaves on cream paper, a small stone fountain at the bottom left', nom: 'Cadre et fontaine', src: 'fonds/fond_4.mp4', vignette: 'fonds/fond_4.jpg', duree: 6.1, usage: 'confirmation', description: 'Cadre de roses sur fond crème, fontaine en bas à gauche', zone: { x: 52, y: 44, largeur: 70 }, zone_texte: 'centre, de 12 % à 88 % en largeur, de 8 % à 75 % en hauteur' }
  ];

  const MOIS = {
    janoary: 1, febroary: 2, martsa: 3, aprily: 4, mey: 5, jona: 6, jolay: 7, aogositra: 8, septambra: 9, oktobra: 10, novambra: 11, desambra: 12,
    janvier: 1, fevrier: 2, 'février': 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, 'août': 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, 'décembre': 12
  };
  const reMois = Object.keys(MOIS).join('|');

  function normaliser(t) { return String(t || '').replace(/[’‘`]/g, "'").replace(/\r/g, '').replace(/[ \t]+/g, ' '); }
  const pad = n => String(n).padStart(2, '0');

  /* ---------- 1. Texte → fiche ---------- */
  function analyserTexte(brut) {
    const texte = normaliser(brut);
    const fiche = {
      titre: '', type: '', langue: 'fr', hotes: [], celebres: [], date: '', heure: '', lieux: [],
      date_limite: '', contacts: [], phrases: [], remerciement: '', texte_source: brut, a_verifier: []
    };
    const motsMg = (texte.match(/\b(dia|ny|amin'ny|sy|ao|aminareo|hatao|izahay|anay)\b/gi) || []).length;
    fiche.langue = motsMg >= 4 ? 'mg' : 'fr';

    // Titre
    const mT = texte.match(/^\s*(?:sary|titre|titra)\s*:\s*(.+)$/im);
    if (mT) fiche.titre = mT[1].trim();

    // Contacts
    const blocContact = texte.split(/fifandraisana|contacts?\s*:|contact/i);
    const zoneContacts = blocContact.length > 1 ? blocContact.slice(1).join(' ') : texte;
    const reTel = /([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .-]{1,30}?)\s*[:\-–]\s*((?:\+?261|0)\s?\d{2}[\s.]?\d{2}[\s.]?\d{3}[\s.]?\d{2})/g;
    let m;
    while ((m = reTel.exec(zoneContacts))) {
      const nom = m[1].replace(/^[*•\-\s]+/, '').trim();
      if (/^(sary|titre)$/i.test(nom)) continue;
      fiche.contacts.push({ nom, telephone: m[2].replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim() });
    }

    // Dates
    const reDate = new RegExp(`(\\d{1,2})\\s+(${reMois})\\s+(\\d{4})`, 'gi');
    const dates = [];
    while ((m = reDate.exec(texte))) {
      const avant = texte.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
      const iso = `${m[3]}-${pad(MOIS[m[2].toLowerCase()])}-${pad(m[1])}`;
      dates.push({ iso, limite: /(mialoha|alohan|avant|au plus tard|d'ici)/.test(avant) });
    }
    const evt = dates.find(d => !d.limite) || dates[0];
    const lim = dates.find(d => d.limite);
    if (evt) fiche.date = evt.iso; else fiche.a_verifier.push('date de l\'événement introuvable');
    if (lim) fiche.date_limite = lim.iso; else fiche.a_verifier.push('date limite de réponse introuvable');

    // Heure
    const mH = texte.match(/(\d{1,2})\s*(?:ora|h|heures?)\s*(\d{2})?\s*(maraina|antoandro|tolakandro|hariva|alina|du matin|de l'après-midi|du soir)?/i);
    if (mH) {
      let h = Number(mH[1]);
      const per = (mH[3] || '').toLowerCase();
      if (/(tolakandro|hariva|alina|après-midi|soir)/.test(per) && h < 12) h += 12;
      fiche.heure = `${pad(h)}:${mH[2] || '00'}`;
    }

    // Lieux
    const reLieuMg = /ao\s+amin'ny\s+([^.,\n]+(?:,\s*[A-Z][^.,\n]*)?)/g;
    const reLieuFr = /(?:à l'|à la |au |à )((?:Église|Eglise|Salle|Espace|Hôtel|Hotel|Restaurant|Paroisse|Cathédrale|Temple|Mairie|Villa|Jardin)[^.,\n]*(?:,\s*[A-Z][^.,\n]*)?)/g;
    const re = fiche.langue === 'mg' ? reLieuMg : reLieuFr;
    while ((m = re.exec(texte))) {
      const nom = m[1].trim().replace(/\s+/g, ' ');
      if (!fiche.lieux.find(l => l.nom === nom)) fiche.lieux.push({ nom, adresse: '', role: fiche.lieux.length ? 'reception' : 'ceremonie', maps: '' });
    }
    fiche.lieux.forEach(l => { l.maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l.nom + ' Antananarivo'); });

    // Corps : phrases
    let corps = blocContact[0];
    corps = corps.replace(/^\s*(?:sary|titre|titra)\s*:.*$/gim, '');
    corps = corps.replace(/(…{2,}|\.{4,}|_{3,})/g, '{places}');
    const phrases = corps.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 2);
    fiche.phrases = phrases;

    // Hôtes
    const p0 = phrases[0] || '';
    let mHo = p0.match(/^(.+?)\s+sy\s+(.+?)\s+dia\s+(?:faly|mahafaly|manasa)/i) || p0.match(/^(.+?)\s+et\s+(.+?)\s+(?:ont|sont|vous|seraient|seront)\b/i);
    if (mHo) {
      fiche.hotes = [mHo[1], mHo[2]].map((n, i) => ({ nom_complet: n.trim(), surnom: fiche.contacts[i] ? fiche.contacts[i].nom : n.trim().split(' ').pop() }));
    } else fiche.a_verifier.push('noms des hôtes à compléter');

    // Personnes célébrées
    const mC = texte.match(/zanakay\s+([A-ZÀ-Ü][^.,\n]+)/) || texte.match(/(?:baptême|anniversaire|communion)\s+de\s+(?:notre\s+(?:fils|fille|enfant)\s+)?([A-ZÀ-Ü][^.,\n]+)/i);
    if (mC) fiche.celebres.push({ nom_complet: mC[1].trim(), occasion: /batem|baptême/i.test(texte) ? (fiche.langue === 'mg' ? 'Batemy' : 'Baptême') : '' });

    // Type
    const types = [];
    if (/jobily|noces|anniversaire de mariage/i.test(texte)) types.push(fiche.langue === 'mg' ? 'Jobily mariazy' : 'Anniversaire de mariage');
    else if (/mariazy|mariage/i.test(texte)) types.push(fiche.langue === 'mg' ? 'Mariazy' : 'Mariage');
    if (/batem|baptême/i.test(texte)) types.push(fiche.langue === 'mg' ? 'Batemy' : 'Baptême');
    if (/fitsingerenana|anniversaire/i.test(texte) && !types.length) types.push('Anniversaire');
    fiche.type = types.join(' + ');
    if (!fiche.titre) fiche.titre = fiche.type || 'Invitation';

    const mMerci = texte.match(/(misaotra[^.\n]*|merci[^.\n]*)/i);
    if (mMerci) { fiche.remerciement = mMerci[1].trim().replace(/[.!]+$/, ''); fiche.phrases = fiche.phrases.filter(ph => !/^(misaotra|merci)/i.test(ph)); }
    if (!fiche.remerciement) fiche.a_verifier.push('phrase de remerciement à fournir');
    return fiche;
  }

  /* ---------- 2. Fiche → plans ---------- */
  const STYLE = { police_titre: 'Great Vibes', police_texte: 'Cormorant Garamond', couleur: '#7a1f2b', couleur2: '#9c6b3f' };
  const LIB = {
    mg: { confirmer: 'Ho tonga izahay', refuser: 'Tsy ho afaka izahay', adultes: 'Olon-dehibe', enfants: 'Ankizy', map: 'Sarintany', appeler: 'Antsoy', partager: 'Zarao', revoir: 'Jereo indray', passer: 'Dingano ›', whatsapp: 'Hamaly amin\'ny WhatsApp', pour: 'Ho an\'i', merci: 'Misaotra betsaka', inviter: 'Manasa olona {places}', compte: 'Andro sisa' },
    fr: { confirmer: 'Je confirme ma présence', refuser: 'Je ne pourrai pas venir', adultes: 'Adultes', enfants: 'Enfants', map: 'Plan', appeler: 'Appeler', partager: 'Partager', revoir: 'Revoir le film', passer: 'Passer ›', whatsapp: 'Répondre sur WhatsApp', pour: 'Pour', merci: 'Merci', inviter: 'Nous invitons {places} personnes', compte: 'Le grand jour dans' }
  };

  function taillePour(t) { const n = String(t).split(/\s+/).length; return n > 22 ? 3.1 : n > 15 ? 3.5 : n > 9 ? 4 : n > 5 ? 4.8 : 5.6; }
  function texte(t, x, y, o) { return Object.assign({ id: uid(), type: 'texte', texte: t, x, y, largeur: 62, police: STYLE.police_texte, taille: taillePour(t), couleur: STYLE.couleur, gras: false, align: 'center', ombre: true, debut: 0.4, fin: '', animation: 'fondu-montee' }, o || {}); }
  function bouton(t, action, x, y, o) { return Object.assign({ id: uid(), type: 'bouton', texte: t, action, x, y, largeur: 62, taille: 2.4, couleur: STYLE.couleur, style: 'plein', debut: 0 }, o || {}); }

  // Hauteur estimée d'un texte (en % de l'écran) pour empiler les calques sans chevauchement
  function hauteurTexte(c) {
    const fs = (Number(c.taille) || 4) / 100 * 1280, larg = (Number(c.largeur) || 62) / 100 * 720;
    const facteur = /Great Vibes|Parisienne|Dancing/.test(c.police || '') ? 0.42 : (c.gras || c.majuscules ? 0.56 : 0.5);
    const n = String(c.texte || '').split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length * facteur * fs / larg)), 0);
    return n * (Number(c.taille) || 4) * (Number(c.interligne) || 1.25);
  }
  function empiler(cs, centre, ecart, debut) {
    ecart = ecart == null ? 3 : ecart;
    const hs = cs.map(hauteurTexte);
    const total = hs.reduce((a, b) => a + b, 0) + ecart * (cs.length - 1);
    let y = debut != null ? debut : centre - total / 2;
    cs.forEach((c, i) => { c.y = Math.round((y + hs[i] / 2) * 10) / 10; y += hs[i] + ecart; });
    return y;
  }

  function decouper(phrase) {
    const mots = phrase.split(/\s+/);
    if (mots.length <= 20) return [phrase];
    const idx = []; let re = /,\s+/g, m;
    while ((m = re.exec(phrase))) idx.push(m.index);
    if (!idx.length) return [phrase];
    const ok = idx.filter(i => phrase.slice(0, i).split(/\s+/).length >= 6 && phrase.slice(i + 1).split(/\s+/).length >= 6);
    if (!ok.length) return [phrase];
    const milieu = phrase.length / 2;
    const c = ok.reduce((a, b) => Math.abs(b - milieu) < Math.abs(a - milieu) ? b : a);
    return [phrase.slice(0, c + 1).trim(), phrase.slice(c + 1).trim()].filter(Boolean);
  }

  function fondPour(fonds, usage, k) {
    const f = fonds.find(f => f.usage === usage);
    if (f) return f;
    const autres = fonds.filter(f => f.usage !== 'ouverture');
    return autres[k % (autres.length || 1)] || fonds[0];
  }

  function plan(role, fond, duree, calques, o) {
    return Object.assign({ id: uid(), role, duree, fond: { media: fond ? fond.src : '', boucle: true, assombrir: 0, eclaircir: 0 }, transition: { type: role === 'ouverture' ? 'aucune' : 'fondu', duree: 0.8 }, calques: calques || [] }, o || {});
  }

  function genererPlans(fiche, fonds) {
    fonds = fonds && fonds.length ? fonds : FONDS;
    const L = LIB[fiche.langue] || LIB.fr;
    const plans = [];
    const zone = f => (f && f.zone) || { x: 50, y: 50, largeur: 66 };

    // Ouverture
    const fOuv = fonds.find(f => f.usage === 'ouverture') || fonds[0];
    plans.push(plan('ouverture', fOuv, Math.max(3, fOuv.duree || 4.5), [
      bouton(L.passer, 'passer', 84, 4, { largeur: 26, style: 'lien', taille: 2 })
    ]));

    // Titre
    const fTit = fondPour(fonds, 'titre', 0);
    const zT = zone(fTit);
    if (fiche.titre) {
      const morceaux = fiche.titre.split(/\s+[—–-]\s+/);
      const cs = [texte(morceaux[0], zT.x, zT.y - (morceaux[1] ? 5 : 0), { police: STYLE.police_titre, taille: 5.2, largeur: zT.largeur + 8, animation: 'ecriture', debut: 0.3 })];
      if (morceaux[1]) cs.push(texte(morceaux.slice(1).join(' — '), zT.x, zT.y + 9, { police: STYLE.police_texte, majuscules: true, taille: 3.4, largeur: zT.largeur, debut: 2.2, couleur: STYLE.couleur2 }));
      empiler(cs, zT.y, 2.5);
      plans.push(plan('intermediaire', fTit, 6, cs));
    }

    // Une idée par plan
    const reLimite = /(mialoha|alohan|avant le|répondre|confirmer|tsy fahafahana|hampandre)/i;
    const phrasesLimite = [];
    let k = 1;
    (fiche.phrases || []).forEach(ph => {
      if (reLimite.test(ph) && /\d{4}/.test(ph)) { phrasesLimite.push(ph); return; }
      decouper(ph).forEach(bout => {
        const cycle = fonds.filter(x => x.usage !== 'ouverture');
        const fz = cycle[Math.floor(k / 2) % (cycle.length || 1)] || fonds[0];
        const z = zone(fz);
        const cs = [];
        const hote = bout.match(/^(.+?\s+sy\s+.+?)\s+(dia\s+.+)$/i) || bout.match(/^(.+?\s+et\s+.+?)\s+((?:ont|sont|vous)\s+.+)$/i);
        const celebre = bout.match(/^(.*?(?:zanakay|de notre fils|de notre fille|de))\s+([A-ZÀ-Ü][A-ZÀ-Ü]+(?:\s+[A-ZÀ-Üa-zà-ÿ]+)+)\.?$/);
        if (hote) {
          const noms = hote[1].replace(/\s+sy\s+/i, '\nsy\n').replace(/\s+et\s+/i, '\net\n');
          cs.push(texte(noms, z.x, z.y, { police: STYLE.police_texte, gras: true, taille: 3, largeur: z.largeur, animation: 'fondu-montee', debut: 0.3, interligne: 1.3 }));
          cs.push(texte(hote[2], z.x, z.y, { largeur: z.largeur, debut: 1.6, taille: Math.min(3.8, taillePour(hote[2])) }));
        } else if (celebre) {
          cs.push(texte(celebre[1], z.x, z.y - 8, { largeur: z.largeur, debut: 0.3, taille: 4 }));
          cs.push(texte(celebre[2], z.x, z.y + 4, { police: STYLE.police_titre, taille: 6, largeur: z.largeur + 6, debut: 1.3, animation: 'ecriture' }));
        } else {
          cs.push(texte(bout, z.x, z.y, { largeur: z.largeur, debut: 0.4 }));
        }
        empiler(cs, z.y, 3.5);
        const mots = bout.split(/\s+/).length;
        plans.push(plan('intermediaire', fz, Math.round(Math.max(4.5, Math.min(9, 3 + mots * 0.22)) * 2) / 2, cs));
        k++;
      });
    });

    // Confirmation
    const fConf = fonds.find(f => f.usage === 'confirmation') || fondPour(fonds, 'x', 3);
    const zc = zone(fConf);
    const cc = [];
    cc.push(texte(L.pour + ' {famille}', zc.x, 9, { police: STYLE.police_titre, taille: 4.2, condition: 'famille', debut: 0.2, largeur: 78 }));
    cc.push(texte(L.inviter, zc.x, 15, { taille: 3, condition: 'famille', debut: 0.4, largeur: 72, gras: true }));
    cc.push(texte(phrasesLimite[0] || (fiche.langue === 'mg' ? 'Iangaviana hampandre mialohan\'ny {date_limite}' : 'Merci de répondre avant le {date_limite}'), zc.x, 23, { taille: 2.7, largeur: 70, debut: 0.6 }));
    cc.push(texte(L.compte, zc.x, 31, { taille: 2.4, largeur: 70, debut: 0.8, couleur: STYLE.couleur2, majuscules: true }));
    cc.push(texte('{compte_a_rebours}', zc.x, 35, { taille: 2.6, largeur: 78, debut: 0.8, gras: true, animation: 'fondu' }));
    const hautTextes = cc.slice();
    hautTextes[0].texte = L.pour + ' Fianakaviana Rakotomalala';
    const finTextes = empiler(hautTextes, 0, 1.6, 6);
    hautTextes[0].texte = L.pour + ' {famille}';
    const yC = Math.max(42, finTextes + 4);
    cc.push(Object.assign(bouton(L.adultes, '', zc.x, yC, { largeur: 66, taille: 2.3, condition: 'famille' }), { type: 'compteur', champ: 'adultes', min: 0, defaut: 1 }));
    cc.push(Object.assign(bouton(L.enfants, '', zc.x, yC + 6.5, { largeur: 66, taille: 2.3, condition: 'famille' }), { type: 'compteur', champ: 'enfants', min: 0, defaut: 0 }));
    cc.push(bouton(L.confirmer, 'confirmer', zc.x, yC + 14, { condition: 'famille', largeur: 66 }));
    cc.push(bouton(L.refuser, 'refuser', zc.x, yC + 20.5, { condition: 'famille', style: 'contour', largeur: 66, taille: 2.1 }));
    cc.push(bouton(L.whatsapp, 'whatsapp', zc.x, yC + 5, { condition: 'general', largeur: 66, cible: 0 }));
    const yM = Math.max(71, yC + 28);
    (fiche.lieux || []).slice(0, 2).forEach((l, i, arr) => {
      cc.push(bouton(L.map + ' · ' + l.nom.split(',')[0].split(' ').slice(0, 2).join(' '), 'map', arr.length === 1 ? zc.x : (i ? zc.x + 17 : zc.x - 17), yM, { largeur: arr.length === 1 ? 60 : 33, style: 'contour', taille: 1.8, cible: i }));
    });
    (fiche.contacts || []).slice(0, 2).forEach((c, i, arr) => {
      cc.push(bouton(L.appeler + ' ' + c.nom, 'appeler', arr.length === 1 ? zc.x : (i ? zc.x + 17 : zc.x - 17), yM + 6.5, { largeur: arr.length === 1 ? 60 : 33, style: 'contour', taille: 1.8, cible: i }));
    });
    plans.push(plan('confirmation', fConf, 0, cc));

    // Remerciement
    const fM = fondPour(fonds, 'titre', 0);
    const zm = zone(fM);
    const surnoms = (fiche.hotes || []).map(h => h.surnom).filter(Boolean).join(fiche.langue === 'mg' ? ' sy ' : ' & ');
    const cm = [
      texte(L.merci, zm.x, zm.y - 12, { police: STYLE.police_titre, taille: 7, largeur: zm.largeur + 4, animation: 'ecriture', debut: 0.3 }),
      texte(fiche.remerciement || (fiche.langue === 'mg' ? 'Voninahitra ho anay ny fahatongavanareo' : 'Votre présence sera pour nous un grand honneur'), zm.x, zm.y, { largeur: zm.largeur, debut: 1.6, taille: 3.6 }),
      texte(surnoms || ' ', zm.x, zm.y + 9, { police: STYLE.police_titre, taille: 5, largeur: zm.largeur, debut: 2.6 }),
      bouton(L.partager, 'partager', zm.x, 74, { largeur: 52, debut: 0 }),
      bouton(L.revoir, 'revoir', zm.x, 81, { largeur: 52, style: 'contour', taille: 2.1 })
    ];
    empiler(cm.slice(0, 3), zm.y - 4, 2.5);
    plans.push(plan('remerciement', fM, 6, cm));
    return plans;
  }

  function nouveauProjet(fiche, fonds) {
    const slug = (fiche.titre || 'invitation').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + Math.random().toString(36).slice(2, 6);
    return { id: uid(), slug, version: 1, cree: new Date().toISOString(), modifie: new Date().toISOString(), fiche, style: Object.assign({}, STYLE), musique: null, mise_en_page: false, plans: genererPlans(fiche, fonds), familles: [], historique_ia: [] };
  }

  /* ---------- Lecture tolérante d'une réponse d'IA ----------
   * Les réponses copiées depuis ChatGPT / Claude arrivent parfois avec des codes HTML (&#x20;),
   * des barres obliques en fin de ligne, des guillemets typographiques, des blocs ``` ou du texte autour. */
  function nettoyerJSON(t) {
    let s = String(t || '');
    s = s.replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');
    s = s.replace(/[\u00a0\u2007\u202f\u200b]/g, ' ');
    s = s.replace(/\\[ \t]*$/gm, '');                 // « \ » en fin de ligne
    s = s.replace(/\\([_*\[\]#>`~])/g, '$1');         // caractères échappés par le Markdown
    s = s.replace(/```[a-zA-Z]*/g, '');
    s = s.replace(/[“”„]/g, '"');
    const i = s.search(/[\[{]/), j = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
    s = s.replace(/^\s*\/\/.*$/gm, '');                // lignes de commentaire
    s = s.replace(/,(\s*[}\]])/g, '$1');              // virgules en trop
    return s.trim();
  }
  function lireJSON(t) {
    const s = nettoyerJSON(t);
    if (!s) throw new Error('Rien à lire : collez la réponse de l\'IA.');
    try { return JSON.parse(s); }
    catch (e) {
      const err = new Error('La réponse collée est incomplète ou abîmée. Dans ChatGPT ou Claude, cliquez sur « Copier » en haut du bloc de code, puis collez ici. (Détail : ' + e.message + ')');
      throw err;
    }
  }

  /* ---------- 3. Contrôle d'un plan importé ---------- */
  function validerPlan(obj, medias) {
    const erreurs = [];
    let p = obj;
    if (typeof obj === 'string') {
      try { p = lireJSON(obj); } catch (e) { return { ok: false, erreurs: [e.message] }; }
    }
    if (p && p.plan) p = p.plan;
    if (!p || typeof p !== 'object') return { ok: false, erreurs: ['Aucun plan trouvé'] };
    if (!Array.isArray(p.calques)) erreurs.push('Le champ "calques" doit être une liste');
    const A = global.MoteurInfo;
    (p.calques || []).forEach((c, i) => {
      const n = `Calque ${i + 1}`;
      if (!['texte', 'image', 'video', 'bouton', 'compteur', 'champ'].includes(c.type)) erreurs.push(`${n} : type inconnu « ${c.type} »`);
      ['x', 'y'].forEach(k => { if (c[k] == null || isNaN(Number(c[k])) || Number(c[k]) < 0 || Number(c[k]) > 100) erreurs.push(`${n} : ${k} doit être entre 0 et 100`); });
      if (c.taille != null && (Number(c.taille) < 1 || Number(c.taille) > 15)) erreurs.push(`${n} : taille hors limites (1 à 15)`);
      if (c.animation && A && !A.ANIMATIONS.includes(c.animation)) erreurs.push(`${n} : animation d'entrée inconnue « ${c.animation} »`);
      if (c.sortie && A && A.SORTIES && !A.SORTIES.includes(c.sortie)) erreurs.push(`${n} : animation de sortie inconnue « ${c.sortie} »`);
      if (c.type === 'bouton' && c.action && A && !A.ACTIONS.includes(c.action)) erreurs.push(`${n} : action inconnue « ${c.action} »`);
      if ((c.type === 'image' || c.type === 'video') && medias && c.media && !medias.includes(c.media)) erreurs.push(`${n} : média introuvable « ${c.media} »`);
      if (!c.id) c.id = uid();
      if (c.type === 'texte' && (Number(c.x) - (Number(c.largeur) || 60) / 2 < 3 || Number(c.x) + (Number(c.largeur) || 60) / 2 > 97)) erreurs.push(`${n} : le texte dépasse le bord de l'écran (attention)`);
    });
    if (p.fond && p.fond.media && medias && !medias.includes(p.fond.media)) erreurs.push(`Fond introuvable « ${p.fond.media} »`);
    const bloquantes = erreurs.filter(e => !/attention/.test(e));
    return { ok: bloquantes.length === 0, erreurs, plan: p };
  }

  /* ---------- 4. Prompts ---------- */
  const FORMAT = `Format JSON d'un plan :
{
  "role": "ouverture | intermediaire | confirmation | remerciement",
  "duree": 6,                      // secondes ; 0 = plan interactif qui attend l'invité
  "fond": { "media": "fonds/fond_2.mp4", "boucle": true, "assombrir": 0, "eclaircir": 0 },
  "transition": { "type": "aucune | fondu | fondu-blanc | fondu-noir | glissement", "duree": 0.8 },
  "calques": [
    { "type": "texte", "texte": "...", "x": 50, "y": 40, "largeur": 62, "police": "Great Vibes", "taille": 6,
      "couleur": "#7a1f2b", "gras": false, "italique": false, "majuscules": false, "align": "center",
      "ombre": true, "interligne": 1.25, "debut": 0.4, "fin": "", "animation": "fondu-montee", "duree_animation": 0.9,
      "sortie": "fondu", "duree_sortie": 0.6, "condition": "" },
    { "type": "bouton", "texte": "...", "action": "confirmer", "cible": 0, "x": 50, "y": 60, "largeur": 62, "taille": 2.4,
      "couleur": "#7a1f2b", "style": "plein | contour | lien", "condition": "famille | general | (vide)" },
    { "type": "compteur", "texte": "Olon-dehibe", "champ": "adultes | enfants | places_transport", "min": 0, "x": 50, "y": 45, "largeur": 66, "taille": 2.3 },
    { "type": "image | video", "media": "...", "x": 50, "y": 30, "largeur": 40, "hauteur": 22, "forme": "rond | arrondi | (vide)" }
  ]
}
- x et y = centre du calque, en % de l'écran ; largeur et hauteur en % ; taille du texte en % de la hauteur de l'écran (1 à 15).
- Polices disponibles : ${['Cormorant Garamond', 'Great Vibes', 'Playfair Display', 'Dancing Script', 'Montserrat', 'Parisienne', 'Cinzel'].join(', ')}.
- Animations d'entrée ("animation") : aucune, fondu, fondu-montee, fondu-descente, ecriture (lettre par lettre), mot-par-mot, zoom, zoom-arriere, rebond, flou, glissement-gauche, glissement-droite.
- Animations de sortie ("sortie", jouée juste avant "fin" ou la fin du plan) : aucune, fondu, fondu-montee, fondu-descente, zoom, zoom-arriere, flou, glissement-gauche, glissement-droite.
- Actions de bouton : suivant, precedent, passer, confirmer, refuser, map (cible = n° du lieu), appeler (cible = n° du contact), whatsapp, messenger, partager, calendrier, revoir, lien.
- Textes variables : {famille}, {places}, {adultes}, {enfants}, {date}, {heure}, {date_limite}, {compte_a_rebours}, {titre}.
- Les boutons et compteurs n'apparaissent pas dans le film MP4, seulement dans la page interactive.`;

  function prompt0(texteSource) {
    return `Voici le texte d'une invitation écrit par un client (en malgache ou en français).
Extrais-en une fiche événement au format JSON avec exactement ces champs :
titre, type, langue ("mg" ou "fr"), hotes [{nom_complet, surnom}], celebres [{nom_complet, occasion}],
date (AAAA-MM-JJ), heure (HH:MM), lieux [{nom, adresse, role: "ceremonie" | "reception"}],
date_limite (AAAA-MM-JJ), contacts [{nom, telephone}], phrases [liste des phrases du texte, dans l'ordre], remerciement.

Règles :
- Recopie les noms et les lieux exactement, sans corriger l'orthographe.
- Remplace les pointillés du nombre d'invités par {places} dans les phrases.
- N'inclus pas la ligne "Sary" ni les contacts dans "phrases".
- Un champ absent du texte = null ; ne l'invente pas.
- Ajoute un champ "a_verifier" listant tout ce qui est ambigu.
Rends uniquement le JSON, dans un seul bloc de code.

Texte :
${texteSource || '[coller ici le texte de l\'invitation]'}`;
  }

  function nettoyerPlan(p) {
    const q = JSON.parse(JSON.stringify(p));
    delete q.id;
    (q.calques || []).forEach(c => { delete c.id; Object.keys(c).forEach(k => { if (c[k] === '' || c[k] == null) delete c[k]; }); });
    return q;
  }

  function stylesValides(projet, sauf) {
    const polices = new Set(), couleurs = new Set();
    (projet.plans || []).forEach((p, i) => { if (i === sauf) return; (p.calques || []).forEach(c => { if (c.type === 'texte') { if (c.police) polices.add(c.police); if (c.couleur) couleurs.add(c.couleur); } }); });
    return `polices ${[...polices].join(', ') || '—'} ; couleurs ${[...couleurs].join(', ') || '—'}`;
  }

  function prompt4(projet, index, fonds) {
    const p = projet.plans[index];
    const f = (fonds || FONDS).find(x => x.src === (p.fond && p.fond.media)) || {};
    const ficheCourte = Object.assign({}, projet.fiche); delete ficheCourte.texte_source; delete ficheCourte.phrases; delete ficheCourte.a_verifier;
    const textes = (p.calques || []).filter(c => c.type === 'texte').map(c => `"${c.texte}"`).join(' ; ');
    const boutons = (p.calques || []).filter(c => c.type !== 'texte' && c.type !== 'image' && c.type !== 'video').map(c => `${c.type} « ${c.texte} »${c.action ? ' → ' + c.action : ''}${c.condition ? ' (' + c.condition + ')' : ''}`).join(' ; ') || 'aucun';
    return `Tu es directeur artistique d'invitations vidéo verticales (9:16) pour des événements à Madagascar.
Finalise le plan ${index + 1} / ${projet.plans.length} de l'invitation « ${projet.fiche.titre} » pour un rendu final élégant et lisible sur téléphone.

Contexte de l'événement : ${JSON.stringify(ficheCourte)}
Rôle du plan : ${p.role}
Durée : ${p.duree} s${Number(p.duree) === 0 ? ' (plan interactif qui attend l\'invité)' : ''}
Fond : ${p.fond && p.fond.media} — ${f.description || 'voir image jointe'} — zone de texte libre : ${f.zone_texte || 'voir image jointe'}. Image du plan actuel jointe.
Textes à poser, mot pour mot : ${textes || 'aucun'}
Boutons et compteurs à poser : ${boutons}
Style déjà utilisé sur les autres plans : ${stylesValides(projet, index)}
JSON actuel du plan :
${JSON.stringify(nettoyerPlan(p), null, 1)}

Règles :
- Ne change aucun mot des textes, ni les noms, dates, lieux et numéros. Garde les textes variables entre accolades.
- Tout texte et tout bouton reste dans la zone de texte libre et à au moins 6 % des bords.
- Lisibilité d'abord : taille de texte d'au moins 2,4 (boutons) et 2,8 (textes), contraste suffisant avec le fond (ombre légère si besoin).
- Hiérarchie : un élément principal par plan, les autres plus petits.
- Garde le style des autres plans (mêmes polices et couleurs).
- Entrées décalées de 0,3 à 0,8 s entre calques ; tout est visible au moins 2 s avant la fin du plan.
- Les calques ne se chevauchent pas.
- Utilise uniquement les champs, animations et actions du format ci-dessous.

Rends uniquement le JSON complet du plan, valide, sans commentaire, dans un seul bloc de code.

${FORMAT}`;
  }

  function prompt3(projet, index, remarques) {
    return `Voici l'image test du plan ${index + 1} de l'invitation « ${projet.fiche.titre} » (jointe) et son JSON.
Problèmes vus : ${remarques || '[décrire : texte trop bas, nom coupé, couleur peu lisible…]'}
Corrige uniquement les champs nécessaires (x, y, largeur, taille, couleur, ombre, debut) et rends le JSON complet corrigé, sans commentaire, dans un seul bloc de code.
Ne change aucun mot des textes.

${JSON.stringify(nettoyerPlan(projet.plans[index]), null, 1)}

${FORMAT}`;
  }

  function prompt1(projet, fonds) {
    const lignesFonds = (fonds || FONDS).map(f => `${f.src} | ${f.duree} s | ${f.description} | zone : ${f.zone_texte} | usage : ${f.usage}`).join('\n');
    return `Tu es réalisateur d'invitations vidéo verticales (9:16) pour des événements à Madagascar.
Voici la fiche de l'événement et les fonds vidéo disponibles.

Fiche : ${JSON.stringify(projet.fiche)}

Fonds :
${lignesFonds}

Propose la suite complète des plans : 1 plan d'ouverture, autant de plans intermédiaires que nécessaire (une idée par plan), 1 plan de confirmation (interactif, duree 0) et 1 plan de remerciement.
Règles :
- Pas plus de 15 mots par texte ; 3 textes maximum par plan intermédiaire.
- Reprends les phrases du texte mot pour mot (tu peux les couper en morceaux, pas les reformuler).
- Les textes restent dans la zone de texte du fond.
- N'utilise que les informations de la fiche ; si une information manque, écris [À COMPLÉTER].
Rends uniquement un JSON { "plans": [ ... ] } au format ci-dessous, dans un seul bloc de code, sans commentaire.

${FORMAT}`;
  }

  /* ---------- 5. Prompt : fond vidéo sur mesure pour un plan ---------- */
  const NOMS_ROLE = { ouverture: 'opening scene', intermediaire: 'story scene', confirmation: 'RSVP scene with buttons', remerciement: 'closing thank-you scene' };
  function palette(projet) {
    const cs = new Set([projet.style && projet.style.couleur || '#7a1f2b']);
    (projet.plans || []).forEach(p => (p.calques || []).forEach(c => { if (c.type === 'texte' && c.couleur) cs.add(c.couleur); }));
    return [...cs].slice(0, 4);
  }
  function decorDe(projet, fonds) {
    const srcs = new Set((projet.plans || []).map(p => p.fond && p.fond.media));
    return (fonds || FONDS).filter(f => srcs.has(f.src) && (f.description_en || f.description)).map(f => f.description_en || f.description);
  }
  function promptFond(projet, index, o) {
    o = o || {};
    const p = projet.plans[index];
    const f = projet.fiche || {};
    const zones = o.zones || [];
    const occupe = zones.length ? { haut: Math.round(Math.min(...zones.map(z => z.y))), bas: Math.round(Math.max(...zones.map(z => z.y + z.h))), gauche: Math.round(Math.min(...zones.map(z => z.x))), droite: Math.round(Math.max(...zones.map(z => z.x + z.w))) } : null;
    const textes = (p.calques || []).filter(c => c.type === 'texte').map(c => c.texte).join(' / ');
    const boutons = (p.calques || []).filter(c => c.type === 'bouton' || c.type === 'compteur').length;
    const medias = (p.calques || []).filter(c => c.type === 'image' || c.type === 'video').length;
    const pal = palette(projet).join(', ');
    const decor = decorDe(projet, o.fonds);
    const duree = o.duree || Math.max(8, Math.ceil(Number(p.duree) || 8));
    const mouvement = { calme: 'very slow, subtle, almost still motion', moyen: 'gentle, graceful motion', vivant: 'lively but elegant motion' }[o.mouvement || 'calme'];
    const zoneTxt = occupe ? `Keep a clean, soft, low-detail empty area from ${Math.max(0, occupe.haut - 3)}% to ${Math.min(100, occupe.bas + 3)}% of the frame height and from ${Math.max(0, occupe.gauche - 3)}% to ${Math.min(100, occupe.droite + 3)}% of the width: text${boutons ? ', buttons' : ''}${medias ? ' and photos' : ''} will be added there later.` : 'Keep the central area (20% to 75% of the height) clean, soft and empty: text will be added there later.';
    const video = `Vertical 9:16 video background, 1080x1920, ${duree} seconds, seamless loop (the last frame matches the first).
Event: ${f.type || 'celebration'} — "${f.titre || ''}". This is the ${NOMS_ROLE[p.role] || 'scene'} (${index + 1} of ${projet.plans.length}) of an animated digital invitation.
Scene idea: ${o.idee ? o.idee : 'an elegant decorative background in the same style as the other scenes.'}
Visual identity to match exactly: ${decor.length ? decor.join('; ') : 'romantic vintage style, ivory paper, burgundy roses, soft gold accents'}. Color palette: warm ivory and cream background, ${pal} accents, soft antique gold. Romantic, refined, luxurious, soft natural light, delicate paper and floral textures, painterly illustration quality.
Composition: decoration placed on the edges and corners only. ${zoneTxt}
Motion: ${mouvement}; static camera${o.mouvement === 'vivant' ? ' or very slow push-in' : ''}; elements such as petals, leaves, light, birds or water move softly in the decoration only.
Strictly no text, no letters, no numbers, no logo, no watermark, no people, no faces. High detail, no flicker, no cuts.`;
    if (o.cible === 'video') return video;
    return `Tu es directeur artistique et expert en génération de vidéos par IA (Sora, Veo, Kling, Runway, Hailuo, Pika).
J'ai besoin d'un fond vidéo vierge (sans texte) pour un plan d'une invitation vidéo verticale. Le studio y ajoutera ensuite les textes et les boutons.

Plan ${index + 1} / ${projet.plans.length} — rôle : ${p.role}.
Ce que je veux pour ce plan : ${o.idee || '(rien de plus : reste dans le style des autres plans)'}
Textes qui seront posés sur ce fond : ${textes || 'aucun'}
Boutons ou compteurs posés sur ce fond : ${boutons} ; photos ou vidéos posées : ${medias}.
Zone à laisser libre : ${occupe ? `de ${occupe.haut} % à ${occupe.bas} % de la hauteur, de ${occupe.gauche} % à ${occupe.droite} % de la largeur` : 'le centre de l\'image'}.
Style des autres plans (à respecter) : ${decor.join(' ; ') || 'roses bordeaux, papier ivoire, touches dorées'}. Couleurs : ${pal}, ivoire, or ancien.
L'image jointe montre la mise en page actuelle du plan (textes et boutons sur l'ancien fond).

1. Si tu sais générer des vidéos, génère directement la vidéo : verticale 9:16, ${duree} secondes, en boucle parfaite, mouvement ${o.mouvement || 'calme'}, aucune lettre ni texte, aucun personnage.
2. Sinon, écris-moi le meilleur prompt en anglais pour un générateur de vidéo, en partant de celui-ci et en l'améliorant :

${video}`;
  }

  global.Fabrique = { promptFond, nettoyerJSON, lireJSON, FONDS, analyserTexte, genererPlans, nouveauProjet, validerPlan, prompt0, prompt1, prompt3, prompt4, LIB, STYLE, uid };
})(window);
