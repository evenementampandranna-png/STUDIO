#!/bin/sh
# Met un numéro de version sur les fichiers du site pour que les navigateurs prennent toujours la dernière version.
V=$(date +%Y%m%d%H%M)
for f in index.html studio/index.html i/index.html; do
  sed -i -E "s#((src|href)=\"(\.\./)?(config\.js|moteur/[a-z]+\.js|vitrine/index\.js|studio\.css|studio\.js))(\?v=[0-9]+)?\"#\1?v=$V\"#g" "$f"
done
echo "version $V"
