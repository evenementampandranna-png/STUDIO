/* Base partagée (Supabase) : invités, réponses, espace organisateur.
   Appels directs aux fonctions SQL (RPC) avec la clé publique « anon » : aucune donnée n'est lisible sans passer par elles. */
(function (global) {
  async function rpc(conf, fn, args) {
    if (!conf || !conf.url || !conf.anon) throw new Error('Base non configurée');
    const r = await fetch(conf.url.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      // clé « anon » (JWT, commence par eyJ) : aussi en Authorization ; clé « publishable » (sb_publishable_…) : apikey seulement
      headers: Object.assign({ 'Content-Type': 'application/json', apikey: conf.anon }, /^eyJ/.test(conf.anon) ? { Authorization: 'Bearer ' + conf.anon } : {}),
      body: JSON.stringify(args || {})
    });
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
    if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('Base : erreur ' + r.status));
    return j;
  }
  const code = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; const b = crypto.getRandomValues(new Uint8Array(8)); for (let i = 0; i < 8; i++) s += a[b[i] % a.length]; return s; };
  const cle = () => { const b = crypto.getRandomValues(new Uint8Array(24)); return Array.from(b, x => x.toString(36).padStart(2, '0')).join('').slice(0, 32); };
  // Menu « Partager » : WhatsApp, Facebook, Messenger, Instagram, Telegram, TikTok, SMS, e-mail, copier, partage du téléphone
  function partager(ancre, url, texte) {
    const vieux = document.getElementById('menu-partage'); if (vieux) { vieux.remove(); if (vieux._ancre === ancre) return; }
    const t = (texte ? texte + ' ' : '') + url, e = encodeURIComponent;
    const copier = async (msg) => { try { await navigator.clipboard.writeText(t); } catch (er) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); } note(msg || 'Lien copié'); };
    const note = m => { const n = d.querySelector('.mp-note'); if (n) n.textContent = m; };
    const choix = [
      ['💬', 'WhatsApp', () => window.open('https://wa.me/?text=' + e(t), '_blank')],
      ['📘', 'Facebook', () => window.open('https://www.facebook.com/sharer/sharer.php?u=' + e(url) + (texte ? '&quote=' + e(texte) : ''), '_blank')],
      ['💭', 'Messenger', () => { if (/Android|iPhone|iPad/i.test(navigator.userAgent)) location.href = 'fb-messenger://share/?link=' + e(url); else { copier('Lien copié : collez-le dans Messenger'); window.open('https://www.messenger.com/', '_blank'); } }],
      ['📸', 'Instagram', () => { copier('Lien copié : collez-le dans votre message ou story Instagram'); window.open(/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'instagram://direct-inbox' : 'https://www.instagram.com/direct/inbox/', '_blank'); }],
      ['🎵', 'TikTok', () => { copier('Lien copié : collez-le dans TikTok (message ou bio)'); window.open('https://www.tiktok.com/messages', '_blank'); }],
      ['✈️', 'Telegram', () => window.open('https://t.me/share/url?url=' + e(url) + (texte ? '&text=' + e(texte) : ''), '_blank')],
      ['🟣', 'Viber', () => { location.href = 'viber://forward?text=' + e(t); }],
      ['✉️', 'SMS', () => { location.href = 'sms:?&body=' + e(t); }],
      ['📧', 'E-mail', () => { location.href = 'mailto:?subject=' + e(texte || 'Invitation') + '&body=' + e(t); }],
      ['🔗', 'Copier le lien', () => copier()]
    ];
    if (navigator.share) choix.unshift(['📱', 'Partager…', () => navigator.share({ title: texte || '', text: texte || '', url }).catch(() => {})]);
    const d = document.createElement('div'); d.id = 'menu-partage'; d._ancre = ancre;
    d.style.cssText = 'position:fixed;z-index:5000;background:#fff;border:1px solid #e3d6c8;border-radius:14px;box-shadow:0 14px 40px rgba(40,10,10,.22);padding:8px;display:grid;grid-template-columns:repeat(2,minmax(130px,1fr));gap:4px;font:500 14px Inter,system-ui,sans-serif;color:#3a2a2a;max-width:94vw';
    d.innerHTML = choix.map((c, i) => `<button type="button" data-i="${i}" style="display:flex;gap:8px;align-items:center;border:0;background:#faf5ef;border-radius:9px;padding:9px 10px;cursor:pointer;font:inherit;color:inherit;text-align:left"><span style="font-size:17px">${c[0]}</span>${c[1]}</button>`).join('') + '<div class="mp-note" style="grid-column:1/-1;font-size:12px;color:#7a6a64;padding:2px 4px;min-height:14px"></div>';
    document.body.appendChild(d);
    const r = ancre.getBoundingClientRect(), w = d.offsetWidth, h = d.offsetHeight;
    d.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px';
    d.style.top = (r.bottom + h + 8 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
    d.querySelectorAll('[data-i]').forEach(b => b.onclick = ev => { ev.stopPropagation(); choix[Number(b.dataset.i)][2](); if (!/Copier|Instagram|TikTok|Messenger/.test(choix[Number(b.dataset.i)][1])) d.remove(); });
    setTimeout(() => document.addEventListener('click', function f(ev) { if (!d.contains(ev.target)) { d.remove(); document.removeEventListener('click', f); } }), 0);
  }
  global.Base = { rpc, code, cle, partager };
})(window);
