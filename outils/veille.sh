#!/bin/sh
# Installe et lance la veille du pod (à refaire après chaque démarrage du pod).
curl -fsSL https://evenementampandranna-png.github.io/STUDIO/outils/veille.py -o /root/veille.py || exit 1
pkill -f /root/veille.py 2>/dev/null
nohup python3 /root/veille.py > /root/veille.log 2>&1 &
echo "Veille du studio active : arrêt automatique après 1 min 30 sans travail (alerte dans le studio à 1 min)."
