/* Langue de l'interface (français / anglais) pour le studio et le site.
   Le français est la langue d'origine des pages ; en anglais, chaque texte affiché est remplacé :
   1) par le dictionnaire (traductions écrites à la main),
   2) sinon par une traduction automatique (Google), gardée dans ce navigateur.
   Les contenus des clients (textes des invitations, noms…) ne sont jamais traduits. */
(function (global) {
  'use strict';
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  const NUM = /\d+(?:[.,]\d+)?/g;
  const LETTRES = /[A-Za-zÀ-ÿ]{2}/;

  function creer(o) {
    let lang = 'fr';
    try { lang = localStorage.getItem(o.cle) || o.defaut || 'fr'; } catch (e) {}
    if (lang !== 'en') lang = 'fr';
    const api = {
      lang,
      changer(l) { try { localStorage.setItem(o.cle, l); } catch (e) {} location.reload(); },
      t: s => s,
      bouton(cls) {
        const a = document.createElement('a'); a.href = '#'; a.className = cls || 'lang-bascule';
        a.title = lang === 'en' ? 'Passer en français' : 'Switch to English';
        a.innerHTML = lang === 'en' ? '🌐 <b>EN</b> · FR' : '🌐 <b>FR</b> · EN';
        a.setAttribute('data-no-trad', '');
        a.onclick = e => { e.preventDefault(); api.changer(lang === 'en' ? 'fr' : 'en'); };
        return a;
      }
    };
    if (lang !== 'en') return api;
    document.documentElement.lang = 'en';

    const D = new Map(), P = new Map();
    for (const [k, v] of Object.entries(o.dico || {})) { const n = norm(k); D.set(n, v); if (/\d/.test(n)) P.set(n.replace(NUM, '#'), v); }
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(o.cache) || '{}') || {}; } catch (e) {}

    function chercher(s, prof) {
      const n = norm(s); if (!n) return null;
      if (D.has(n)) return D.get(n);
      if (cache[n]) return cache[n];
      if (/\d/.test(n)) {
        const t = P.get(n.replace(NUM, '#'));
        if (t != null) { const nums = n.match(NUM) || []; let k = 0; return t.replace(NUM, m => (k < nums.length ? nums[k++] : m)); }
      }
      if ((prof || 0) > 2) return null;
      // symbole devant (emoji, ✓, +, « 1. »…) ou derrière (▾ … : › ↗)
      const a = n.match(/^([^A-Za-zÀ-ÿ{«"(]+?)\s*([A-Za-zÀ-ÿ{«"(].*)$/);
      if (a && a[1].trim()) { const r = chercher(a[2], (prof || 0) + 1); if (r != null) return a[1].trim() + ' ' + r; }
      const b = n.match(/^(.*?[A-Za-zÀ-ÿ)»}])\s*([▾…:›↗→✓.!?]+)$/);
      if (b) { const r = chercher(b[1], (prof || 0) + 1); if (r != null) return r + (/^[:.!?]/.test(b[2]) ? '' : ' ') + b[2]; }
      return null;
    }
    api.t = s => { const r = chercher(s); return r == null ? s : r; };

    // ----- traduction automatique de ce qui manque au dictionnaire
    const attente = new Set(); let minuteur = null, enCours = false, sauver = null;
    const contenu = () => { try { return o.contenu ? o.contenu() : null; } catch (e) { return null; } };
    function demander(n) {
      if (!o.automatique || n.length > 700 || !LETTRES.test(n) || attente.has(n)) return;
      const c = contenu(); if (c && c.has(n)) return;
      attente.add(n); if (!minuteur) minuteur = setTimeout(envoyer, 350);
    }
    async function lot(liste) {
      const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=fr&tl=en&q=' + encodeURIComponent(liste.join('\n')));
      if (!r.ok) throw new Error('trad ' + r.status);
      const j = await r.json(); const res = (j[0] || []).map(x => x[0] || '').join('').split('\n');
      if (res.length !== liste.length) {
        if (liste.length === 1) return [res.join(' ')];
        const m = Math.ceil(liste.length / 2); return (await lot(liste.slice(0, m))).concat(await lot(liste.slice(m)));
      }
      return res;
    }
    async function envoyer() {
      minuteur = null; if (enCours) { minuteur = setTimeout(envoyer, 500); return; }
      const liste = []; let tot = 0;
      for (const n of attente) { if (tot + n.length > 1500 && liste.length) break; liste.push(n); tot += n.length; if (liste.length >= 25) break; }
      if (!liste.length) return;
      enCours = true;
      try {
        const res = await lot(liste);
        liste.forEach((n, i) => { attente.delete(n); const t = norm(res[i] || ''); if (t) cache[n] = t; });
        clearTimeout(sauver); sauver = setTimeout(() => { try { const k = Object.keys(cache); if (k.length > 4000) k.slice(0, k.length - 4000).forEach(x => delete cache[x]); localStorage.setItem(o.cache, JSON.stringify(cache)); } catch (e) {} }, 800);
        passe(document.body);
      } catch (e) { liste.forEach(n => attente.delete(n)); o.automatique = false; }   // hors ligne : on reste sur le dictionnaire
      enCours = false;
      if (attente.size) minuteur = setTimeout(envoyer, 200);
    }

    // ----- application aux pages
    const fait = new WeakMap(), faitAttr = new WeakMap();
    const exclu = el => !el || !!el.closest('script,style,noscript,[data-no-trad]' + (o.exclure ? ',' + o.exclure : ''));
    function noeud(x) {
      const v = x.nodeValue; if (!v || !LETTRES.test(v)) return;
      if (fait.get(x) === v) return;
      const p = x.parentElement; if (exclu(p)) return;
      const r = chercher(v);
      if (r == null) { demander(norm(v)); return; }
      const deb = v.match(/^\s*/)[0], fin = v.match(/\s*$/)[0], nv = deb + r + fin;
      if (p.tagName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', p.textContent);   // la valeur choisie reste celle d'origine
      fait.set(x, nv); if (nv !== v) x.nodeValue = nv;
    }
    function attrs(el) {
      if (exclu(el)) return;
      for (const a of ['title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(a); if (!v || !LETTRES.test(v)) continue;
        const f = faitAttr.get(el) || {}; if (f[a] === v) continue;
        const r = chercher(v); if (r == null) { demander(norm(v)); continue; }
        f[a] = r; faitAttr.set(el, f); if (r !== v) el.setAttribute(a, r);
      }
    }
    function passe(racine) {
      if (!racine) return;
      if (racine.nodeType === 3) return noeud(racine);
      if (racine.nodeType !== 1) return;
      const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT); let x;
      while ((x = w.nextNode())) noeud(x);
      if (racine.hasAttribute && (racine.hasAttribute('title') || racine.hasAttribute('placeholder') || racine.hasAttribute('aria-label'))) attrs(racine);
      racine.querySelectorAll('[title],[placeholder],[aria-label]').forEach(attrs);
    }
    const obs = new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'childList') m.addedNodes.forEach(passe);
        else if (m.type === 'characterData') noeud(m.target);
        else if (m.type === 'attributes') attrs(m.target);
      }
    });
    const demarrer = () => {
      passe(document.body);
      if (document.title) { const t = chercher(document.title); if (t) document.title = t; }
      obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
    };
    if (document.body) demarrer(); else document.addEventListener('DOMContentLoaded', demarrer);
    // boîtes de dialogue du navigateur
    ['alert', 'confirm', 'prompt'].forEach(f => { const orig = global[f]; if (typeof orig !== 'function') return; global[f] = function (msg, ...r) { return orig.call(global, msg == null ? msg : api.t(String(msg)), ...r); }; });
    return api;
  }
  global.Langue = { creer };
})(typeof window !== 'undefined' ? window : this);
