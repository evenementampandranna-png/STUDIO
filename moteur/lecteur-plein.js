/* Lecteur plein écran des films (vidéos .mp4 / .webm) — studio et site.
   Remplace le plein écran du navigateur (où l'on ne peut pas cacher les contrôles) :
   en pause, un clic sur l'écran cache la barre et tous les boutons (image seule) ; un 2e clic les fait revenir, sans relancer. */
(function (global) {
  'use strict';
  if (global.LecteurPlein) return;
  const css = `
.lpv { position: fixed; inset: 0; z-index: 10000; background: #0d0a0a; display: flex; align-items: center; justify-content: center; }
.lpv video { max-width: 100vw; max-height: 100vh; width: auto; height: 100vh; object-fit: contain; background: #000; display: block; }
.lpv-btns { position: absolute; top: 14px; right: 14px; display: flex; gap: 8px; z-index: 5; opacity: .35; transition: opacity .2s; }
.lpv:hover .lpv-btns { opacity: 1; }
.lpv-b { width: 42px; height: 42px; border-radius: 50%; border: 0; background: rgba(255,255,255,.18); color: #fff; font-size: 18px; cursor: pointer; backdrop-filter: blur(6px); }
.lpv-b:hover { background: rgba(255,255,255,.35); }
.lpv-barre { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(680px, 94vw); background: rgba(20,14,14,.62); backdrop-filter: blur(10px); border-radius: 18px; padding: 10px 14px 8px; display: flex; flex-direction: column; gap: 6px; z-index: 6; opacity: .25; transition: opacity .25s; box-sizing: border-box; }
.lpv:hover .lpv-barre, .lpv-barre:focus-within, .lpv.pause .lpv-barre { opacity: 1; }
.lpv-temps { width: 100%; -webkit-appearance: none; appearance: none; height: 6px; border-radius: 999px; background: linear-gradient(to right, #e7c38b var(--pc, 0%), rgba(255,255,255,.25) var(--pc, 0%)); cursor: pointer; margin: 0; }
.lpv-temps::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.4); }
.lpv-temps::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 0; }
.lpv-cmd { display: flex; align-items: center; justify-content: center; gap: 8px; }
.lpv-cmd .lpv-b { width: 38px; height: 38px; font-size: 15px; }
.lpv-cmd .lpv-b.gros { width: 48px; height: 48px; font-size: 19px; background: rgba(255,255,255,.28); }
.lpv-heure { color: #fff; font: 600 12.5px Inter, system-ui, sans-serif; margin-left: 8px; font-variant-numeric: tabular-nums; min-width: 82px; }
.lpv.sans-controles .lpv-barre, .lpv.sans-controles .lpv-btns { opacity: 0 !important; visibility: hidden; pointer-events: none; transition: opacity .25s, visibility 0s .25s; }
.lpv.sans-controles { cursor: none; }
.lpv-ouvrir { position: fixed; z-index: 9990; width: 36px; height: 36px; border-radius: 10px; border: 0; background: rgba(20,14,14,.7); color: #fff; font-size: 17px; cursor: pointer; display: none; align-items: center; justify-content: center; backdrop-filter: blur(6px); }
.lpv-ouvrir.vu { display: flex; }
.lpv-ouvrir:hover { background: rgba(20,14,14,.9); }`;
  const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);
  const fmt = x => { x = Math.max(0, x || 0); return Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0'); };

  function ouvrir(source) {
    const src = source.currentSrc || source.src; if (!src) return;
    const ov = document.createElement('div'); ov.className = 'lpv';
    ov.innerHTML = `<video playsinline preload="auto"></video>
      <div class="lpv-btns"><button class="lpv-b" data-v="fermer" title="Fermer (Échap)">✕</button></div>
      <div class="lpv-barre"><input type="range" class="lpv-temps" min="0" max="100" step="0.05" value="0" title="Glisser pour avancer ou reculer">
        <div class="lpv-cmd"><button class="lpv-b" data-v="debut" title="Revoir depuis le début">↺</button><button class="lpv-b" data-v="recul" title="Reculer de 5 s (←)">⏪</button>
        <button class="lpv-b gros" data-v="pause" title="Pause / lecture (espace)">⏸</button><button class="lpv-b" data-v="avance" title="Avancer de 5 s (→)">⏩</button><span class="lpv-heure">0:00 / 0:00</span></div></div>`;
    document.body.appendChild(ov);
    const v = ov.querySelector('video'), barre = ov.querySelector('.lpv-temps'), heure = ov.querySelector('.lpv-heure'), pb = ov.querySelector('[data-v="pause"]');
    if (source.poster) v.poster = source.poster;
    v.muted = false; v.src = src;
    const t0 = source.currentTime || 0, enPauseAvant = source.paused;
    try { source.pause(); } catch (e) {}
    v.addEventListener('loadedmetadata', () => { try { v.currentTime = t0; } catch (e) {} if (!enPauseAvant || !t0) v.play().catch(() => {}); }, { once: true });
    let glisse = false, ferme = false;
    const maj = () => {
      const d = v.duration || 0; barre.max = d || 100; if (!glisse) barre.value = v.currentTime || 0;
      barre.style.setProperty('--pc', (d ? v.currentTime / d * 100 : 0) + '%'); heure.textContent = fmt(v.currentTime) + ' / ' + fmt(d);
      pb.textContent = v.paused ? '▶' : '⏸'; ov.classList.toggle('pause', v.paused);
      if (!v.paused) ov.classList.remove('sans-controles');
    };
    ['timeupdate', 'play', 'pause', 'durationchange', 'ended'].forEach(n => v.addEventListener(n, maj));
    barre.addEventListener('input', () => { glisse = true; v.currentTime = Number(barre.value); maj(); });
    barre.addEventListener('change', () => { glisse = false; });
    const basculer = () => { if (v.paused) v.play().catch(() => {}); else v.pause(); };
    const fermer = () => {
      if (ferme) return; ferme = true;
      try { source.currentTime = v.currentTime; } catch (e) {}
      v.pause(); v.removeAttribute('src'); v.load(); ov.remove();
      document.removeEventListener('keydown', clavier, true);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    const clavier = e => {
      if (e.key === 'Escape') { e.preventDefault(); fermer(); }
      else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); basculer(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
    };
    document.addEventListener('keydown', clavier, true);
    ov.querySelectorAll('.lpv-b').forEach(b => b.onclick = e => {
      e.stopPropagation(); const a = b.dataset.v;
      if (a === 'fermer') fermer();
      if (a === 'debut') { v.currentTime = 0; v.play().catch(() => {}); }
      if (a === 'recul') v.currentTime = Math.max(0, v.currentTime - 5);
      if (a === 'avance') v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      if (a === 'pause') basculer();
    });
    // clic sur l'écran : en lecture → pause ; en pause → cache / montre tous les contrôles (sans relancer)
    ov.addEventListener('click', e => {
      if (e.target.closest('.lpv-barre, .lpv-btns')) return;
      if (ov.classList.contains('sans-controles')) { ov.classList.remove('sans-controles'); return; }
      if (v.paused) ov.classList.add('sans-controles'); else v.pause();
    });
    ov.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) fermer(); });
    if (ov.requestFullscreen) ov.requestFullscreen().catch(() => {});
    maj();
    return { fermer, video: v };
  }

  // Les vidéos avec contrôles : le bouton « plein écran » du navigateur est remplacé par ⛶ (même design que le studio)
  const bouton = document.createElement('button'); bouton.className = 'lpv-ouvrir'; bouton.type = 'button'; bouton.title = 'Plein écran'; bouton.textContent = '⛶';
  let cible = null, tCache = null;
  const placer = () => { if (!cible || !cible.isConnected) { bouton.classList.remove('vu'); return; } const r = cible.getBoundingClientRect(); if (r.width < 80 || r.height < 60) { bouton.classList.remove('vu'); return; } bouton.style.left = (r.right - 44) + 'px'; bouton.style.top = (r.top + 8) + 'px'; bouton.classList.add('vu'); };
  bouton.onclick = e => { e.preventDefault(); e.stopPropagation(); if (cible) ouvrir(cible); bouton.classList.remove('vu'); };
  bouton.addEventListener('mouseenter', () => clearTimeout(tCache));
  bouton.addEventListener('mouseleave', () => { tCache = setTimeout(() => bouton.classList.remove('vu'), 300); });
  const equiper = v => {
    if (v._lpv || v.closest('.lpv')) return; v._lpv = true;
    try { v.setAttribute('controlslist', ((v.getAttribute('controlslist') || '') + ' nofullscreen').trim()); } catch (e) {}
    v.addEventListener('mouseenter', () => { clearTimeout(tCache); cible = v; placer(); });
    v.addEventListener('mouseleave', () => { tCache = setTimeout(() => bouton.classList.remove('vu'), 300); });
    v.addEventListener('dblclick', e => { e.preventDefault(); ouvrir(v); });
  };
  const tout = () => document.querySelectorAll('video[controls]').forEach(equiper);
  const demarrer = () => {
    document.body.appendChild(bouton); tout();
    new MutationObserver(() => tout()).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['controls'] });
    addEventListener('scroll', () => { if (bouton.classList.contains('vu')) placer(); }, true);
  };
  if (document.body) demarrer(); else document.addEventListener('DOMContentLoaded', demarrer);
  global.LecteurPlein = { ouvrir };
})(window);
