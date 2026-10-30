/* Liaison avec ComfyUI (par exemple sur un pod RunPod) pour générer un fond vidéo avec Wan 2.2.
 * Le studio envoie l'image de départ et le prompt, lance le workflow, attend, puis récupère la vidéo.
 * ComfyUI doit être lancé avec l'option --enable-cors-header pour accepter les demandes du studio. */
(function (global) {
  'use strict';

  // Workflow par défaut : modèle officiel ComfyUI « Wan 2.2 5B image vers vidéo » (format API).
  // Si vos fichiers de modèle ont d'autres noms, collez votre propre workflow (File → Export (API)) dans les Réglages.
  const WORKFLOW_5B = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_ti2v_5B_fp16.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'wan2.2_vae.safetensors' } },
    '4': { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8 } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: 'text, letters, words, numbers, watermark, logo, people, faces, blurry, flicker, low quality' } },
    '7': { class_type: 'LoadImage', inputs: { image: 'depart.jpg' } },
    '8': { class_type: 'Wan22ImageToVideoLatent', inputs: { vae: ['3', 0], width: 704, height: 1280, length: 121, batch_size: 1, start_image: ['7', 0] } },
    '9': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['8', 0], seed: 1, steps: 30, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1 } },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    '11': { class_type: 'CreateVideo', inputs: { images: ['10', 0], fps: 24 } },
    '12': { class_type: 'SaveVideo', inputs: { video: ['11', 0], filename_prefix: 'studio/fond', format: 'auto', codec: 'auto' } }
  };

  // Workflow « Wan 2.2 14B image vers vidéo + lightx2v 4 étapes » : modèles du template RunPod
  // « One Click - ComfyUI Wan2.1 - Wan 2.2 » (hearmeman). Testé sur A40 48 Go.
  const WORKFLOW_14B = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_i2v_high_noise_14B_fp16.safetensors', weight_dtype: 'fp8_e4m3fn' } },
    '2': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_i2v_low_noise_14B_fp16.safetensors', weight_dtype: 'fp8_e4m3fn' } },
    '3': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'i2v_lightx2v_high_noise_model.safetensors', strength_model: 1 } },
    '4': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['2', 0], lora_name: 'i2v_lightx2v_low_noise_model.safetensors', strength_model: 1 } },
    '5': { class_type: 'ModelSamplingSD3', inputs: { model: ['3', 0], shift: 5 } },
    '6': { class_type: 'ModelSamplingSD3', inputs: { model: ['4', 0], shift: 5 } },
    '7': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' } },
    '8': { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
    '9': { class_type: 'CLIPTextEncode', inputs: { clip: ['7', 0], text: '' } },
    '10': { class_type: 'CLIPTextEncode', inputs: { clip: ['7', 0], text: 'text, letters, words, numbers, watermark, logo, people, faces, blurry, flicker, low quality, distorted' } },
    '11': { class_type: 'LoadImage', inputs: { image: 'depart.jpg' } },
    '12': { class_type: 'WanImageToVideo', inputs: { positive: ['9', 0], negative: ['10', 0], vae: ['8', 0], start_image: ['11', 0], width: 704, height: 1280, length: 81, batch_size: 1 } },
    '13': { class_type: 'KSamplerAdvanced', inputs: { model: ['5', 0], add_noise: 'enable', noise_seed: 1, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['12', 0], negative: ['12', 1], latent_image: ['12', 2], start_at_step: 0, end_at_step: 2, return_with_leftover_noise: 'enable' } },
    '14': { class_type: 'KSamplerAdvanced', inputs: { model: ['6', 0], add_noise: 'disable', noise_seed: 1, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['12', 0], negative: ['12', 1], latent_image: ['13', 0], start_at_step: 2, end_at_step: 4, return_with_leftover_noise: 'disable' } },
    '15': { class_type: 'VAEDecode', inputs: { samples: ['14', 0], vae: ['8', 0] } },
    '16': { class_type: 'CreateVideo', inputs: { images: ['15', 0], fps: 16 } },
    '17': { class_type: 'SaveVideo', inputs: { video: ['16', 0], filename_prefix: 'studio/fond', format: 'auto' } }
  };
  const WORKFLOWS = { '14b': WORKFLOW_14B, '5b': WORKFLOW_5B };

  const nettoyerUrl = u => String(u || '').trim().replace(/\/+$/, '').replace(/\/(api)?$/, '');
  function erreurReseau(e) {
    return new Error('Le pod ne répond pas ou refuse le studio. Vérifiez : 1) le pod est démarré (Running) ; 2) l\'adresse se termine par -8188.proxy.runpod.net ; 3) ComfyUI est lancé avec l\'option --enable-cors-header. (' + e.message + ')');
  }
  async function appel(base, chemin, opts) {
    let r;
    try { r = await fetch(nettoyerUrl(base) + chemin, opts); } catch (e) { throw erreurReseau(e); }
    if (r.status === 403) throw new Error('ComfyUI refuse la demande (403) : relancez-le avec l\'option --enable-cors-header.');
    return r;
  }

  async function tester(base) {
    const r = await appel(base, '/system_stats');
    if (!r.ok) throw new Error('Réponse ' + r.status);
    const j = await r.json();
    const gpu = (j.devices || [])[0];
    return gpu ? `${gpu.name} · ${Math.round((gpu.vram_total || 0) / 1e9)} Go` : 'ComfyUI joignable';
  }

  // Suit un lien [id, sortie] jusqu'au nœud CLIPTextEncode d'origine
  function remonterTexte(wf, lien, cle, vus) {
    vus = vus || new Set();
    if (!Array.isArray(lien)) return null;
    const id = String(lien[0]); if (vus.has(id)) return null; vus.add(id);
    const n = wf[id]; if (!n) return null;
    if (/CLIPTextEncode|TextEncode/.test(n.class_type) && typeof n.inputs.text === 'string') return id;
    for (const k of [cle, 'conditioning', 'positive', 'negative', 'conditioning_1']) { const r = remonterTexte(wf, n.inputs[k], cle, vus); if (r) return r; }
    return null;
  }

  function preparer(workflow, o) {
    const wf = JSON.parse(JSON.stringify(workflow));
    const ids = Object.keys(wf);
    let fps = 24;
    ids.forEach(id => { const n = wf[id]; if (n.inputs && typeof n.inputs.fps === 'number') fps = n.inputs.fps; if (n.inputs && typeof n.inputs.frame_rate === 'number') fps = n.inputs.frame_rate; });
    const longueur = Math.min(o.maxImages || 121, Math.round((o.secondes || 5) * fps / 4) * 4 + 1);
    let image = 0, positif = 0;
    ids.forEach(id => {
      const n = wf[id], i = n.inputs || {};
      if (n.class_type === 'LoadImage') { i.image = o.image; image++; }
      if ('positive' in i && 'negative' in i && Array.isArray(i.positive)) {
        const p = remonterTexte(wf, i.positive, 'positive'); if (p) { wf[p].inputs.text = o.prompt; positif++; }
        const m = remonterTexte(wf, i.negative, 'negative'); if (m && o.negatif && !wf[m].inputs.text.includes('letters')) wf[m].inputs.text = (wf[m].inputs.text ? wf[m].inputs.text + ', ' : '') + o.negatif;
      }
      if (/ImageToVideo|TextToVideo|EmptyHunyuanLatentVideo|EmptyLatent/.test(n.class_type)) {
        if ('width' in i && 'height' in i) { i.width = o.largeur || 704; i.height = o.hauteur || 1280; }
        if ('length' in i) i.length = longueur;
      }
      ['seed', 'noise_seed'].forEach(k => { if (k in i && typeof i[k] === 'number') i[k] = Math.floor(Math.random() * 1e12); });
    });
    if (!image) throw new Error('Le workflow n\'a pas de nœud « Load Image » : utilisez un workflow Wan 2.2 « image vers vidéo ».');
    if (!positif) throw new Error('Impossible de trouver le prompt positif dans le workflow.');
    return wf;
  }

  async function envoyerImage(base, blob, nom) {
    const fd = new FormData(); fd.append('image', blob, nom); fd.append('overwrite', 'true'); fd.append('type', 'input');
    const r = await appel(base, '/upload/image', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('Envoi de l\'image refusé (' + r.status + ')');
    const j = await r.json();
    return j.subfolder ? j.subfolder + '/' + j.name : j.name;
  }

  async function generer(base, workflow, o, suivi) {
    suivi = suivi || (() => {});
    suivi('Envoi de l\'image de départ…');
    const image = await envoyerImage(base, o.imageBlob, 'studio-depart-' + Date.now() + '.jpg');
    const wf = preparer(workflow || WORKFLOW_5B, Object.assign({}, o, { image }));
    suivi('Lancement de Wan 2.2…');
    const r = await appel(base, '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'studio-' + Math.random().toString(36).slice(2) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.prompt_id) {
      const ne = j.node_errors ? Object.values(j.node_errors).map(x => (x.errors || []).map(e => `${x.class_type} : ${e.message} ${e.details || ''}`).join(' ; ')).join(' | ') : '';
      throw new Error('ComfyUI a refusé le workflow : ' + ((j.error && j.error.message) || r.status) + (ne ? ' — ' + ne : '') + '. Vérifiez les noms des fichiers de modèle, ou collez votre propre workflow dans les Réglages.');
    }
    const id = j.prompt_id, debut = Date.now();
    for (;;) {
      await new Promise(res => setTimeout(res, 4000));
      const min = Math.floor((Date.now() - debut) / 60000), s = Math.floor((Date.now() - debut) / 1000) % 60;
      suivi(`Wan 2.2 travaille… ${min} min ${String(s).padStart(2, '0')} s (souvent 3 à 10 minutes)`);
      if (Date.now() - debut > 45 * 60000) throw new Error('Trop long (plus de 45 minutes) : regardez la file d\'attente dans ComfyUI.');
      const h = await appel(base, '/history/' + id);
      if (!h.ok) continue;
      const hist = (await h.json())[id];
      if (!hist) continue;
      if (hist.status && hist.status.status_str === 'error') {
        const m = (hist.status.messages || []).find(x => x[0] === 'execution_error');
        throw new Error('Erreur dans ComfyUI : ' + (m ? m[1].exception_message : 'voir ComfyUI'));
      }
      const fichiers = [];
      Object.values(hist.outputs || {}).forEach(out => ['videos', 'gifs', 'images', 'animated'].forEach(k => (Array.isArray(out[k]) ? out[k] : []).forEach(f => { if (f && f.filename) fichiers.push(f); })));
      const video = fichiers.find(f => /\.(mp4|webm|mov)$/i.test(f.filename)) || fichiers.find(f => /\.(webp|gif)$/i.test(f.filename));
      if (!video) { if (hist.status && hist.status.completed) throw new Error('Terminé, mais aucune vidéo trouvée : ajoutez un nœud « Save Video » au workflow.'); continue; }
      suivi('Téléchargement de la vidéo…');
      const q = new URLSearchParams({ filename: video.filename, subfolder: video.subfolder || '', type: video.type || 'output' });
      const v = await appel(base, '/view?' + q.toString());
      if (!v.ok) throw new Error('Téléchargement impossible (' + v.status + ')');
      const blob = await v.blob();
      return { blob, nom: video.filename };
    }
  }

  global.Comfy = { WORKFLOW_5B, WORKFLOW_14B, WORKFLOWS, tester, generer, preparer, nettoyerUrl };
})(window);
