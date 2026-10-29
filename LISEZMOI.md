# Studio d'invitations vidéo interactives

Site gratuit (GitHub Pages) pour créer de A à Z des invitations vidéo et électroniques.

| Adresse | Contenu |
| --- | --- |
| `/` | Vitrine pour les clients (modèles à essayer, devis) |
| `/studio/` | Le studio : événements, plans, invités, film, publication |
| `/i/?p=<invitation>` | Invitation, lien général |
| `/i/?p=<invitation>&f=<code>` | Invitation, lien personnel d'une famille |

## Utilisation
1. Studio → **Nouvel événement** : coller le texte de l'invitation, vérifier la fiche, choisir les fonds.
2. Onglet **Plans** : ajuster textes, boutons et fonds ; « Finaliser ce plan avec l'IA » pour ChatGPT ou Claude.
3. Onglet **Invités** : ajouter ou importer les familles (Excel).
4. Onglet **Film et publication** : enregistrer le film MP4, publier en ligne.

Réglages (une seule fois) : relier le dépôt GitHub avec un jeton pour la publication automatique ; Firebase facultatif pour recevoir les réponses directement.

## Dossiers
- `moteur/` : moteur de lecture (`moteur.js`) et fabrique (analyse du texte, plans, prompts IA)
- `fonds/` : fonds vidéo vierges de base
- `projets/` : invitations publiées (une par fichier JSON)
- `medias/` : fichiers importés publiés (fonds, photos, musiques)
- `vitrine/index.json` : modèles affichés sur la vitrine
