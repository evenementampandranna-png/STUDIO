#!/usr/bin/env python3
"""Veille du pod RunPod pour le Studio d'invitations.
Si ComfyUI ne travaille plus depuis 60 s, le studio affiche « Arrêter ou continuer ? ».
Sans réponse 30 s plus tard (90 s d'inactivité au total), le pod s'arrête tout seul.
Le studio répond en envoyant de petits fichiers à ComfyUI :
  input/studio-veille-continuer.png  → on repart pour une minute
  input/studio-veille-arreter.png    → arrêt immédiat
L'état est écrit dans output/studio/veille.json (lu par le studio)."""
import json, os, subprocess, time, urllib.request

COMFY = os.environ.get('VEILLE_COMFY', 'http://127.0.0.1:8188')
RACINE = os.environ.get('VEILLE_RACINE', '/ComfyUI')
ALERTE = int(os.environ.get('VEILLE_ALERTE', '60'))     # secondes d'inactivité avant l'alerte
REPONSE = int(os.environ.get('VEILLE_REPONSE', '30'))   # secondes pour répondre avant l'arrêt
CONTINUER = os.path.join(RACINE, 'input', 'studio-veille-continuer.png')
ARRETER = os.path.join(RACINE, 'input', 'studio-veille-arreter.png')
ETAT = os.path.join(RACINE, 'output', 'studio', 'veille.json')
debut = time.time()
derniere_activite = debut

def mtime(p):
    try: return os.path.getmtime(p)
    except OSError: return 0

def file_active():
    try:
        with urllib.request.urlopen(COMFY + '/queue', timeout=5) as r:
            q = json.load(r)
        return bool(q.get('queue_running') or q.get('queue_pending'))
    except Exception:
        return None   # ComfyUI ne répond pas (démarrage) : on ne compte pas comme inactif

def ecrire(etat):
    os.makedirs(os.path.dirname(ETAT), exist_ok=True)
    tmp = ETAT + '.tmp'
    with open(tmp, 'w') as f: json.dump(etat, f)
    os.replace(tmp, ETAT)

def arreter(raison):
    ecrire({'etat': 'arret', 'raison': raison, 'heure': time.time()})
    pod = os.environ.get('RUNPOD_POD_ID'); cle = os.environ.get('RUNPOD_API_KEY')
    if not pod: return
    if cle: subprocess.run(['runpodctl', 'config', '--apiKey', cle], capture_output=True)
    subprocess.run(['runpodctl', 'stop', 'pod', pod])

while True:
    maintenant = time.time()
    actif = file_active()
    if actif or (actif is None and maintenant - debut < 600):
        derniere_activite = maintenant   # ComfyUI muet pendant les 10 premières minutes : il démarre peut-être
    if mtime(ARRETER) > debut:
        arreter('demande du studio'); break
    base = max(derniere_activite, mtime(CONTINUER))
    inactif = maintenant - base
    ecrire({'etat': 'actif' if actif else 'inactif', 'inactif': round(inactif), 'alerte': ALERTE,
            'arret': ALERTE + REPONSE, 'heure': maintenant})
    if inactif >= ALERTE + REPONSE:
        arreter('aucune réponse'); break
    time.sleep(5)
