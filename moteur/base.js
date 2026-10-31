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
  global.Base = { rpc, code, cle };
})(window);
