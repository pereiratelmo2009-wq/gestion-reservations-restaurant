# Gestion des réservations — version de démarrage

Application web en français : import d'une photo de note, extraction des réservations par IA, vérification/modification, partage avec l'équipe et impression en PDF A4 depuis le navigateur.

## Ce qui est inclus
- Connexion par mot de passe commun à l'équipe.
- Données partagées entre les membres connectés.
- Import photo depuis téléphone (appareil photo) ou ordinateur.
- Lecture manuscrite via l'API OpenAI Responses avec sortie JSON.
- Ajout, modification, présence, suppression et tri par table.
- Impression A4 avec cases de présence.

## Prérequis
- Node.js 20+
- Une base PostgreSQL persistante
- Une clé API OpenAI avec accès à un modèle acceptant les images
- Un hébergeur Node.js (le fichier `render.yaml` prépare un déploiement Render)

## Configuration locale
1. Décompresser le projet.
2. Copier `.env.example` en `.env` et renseigner `SESSION_SECRET`, `TEAM_PASSWORD`, `OPENAI_API_KEY`, `DATABASE_URL`.
3. `npm install`
4. `npm start`
5. Ouvrir `http://localhost:3000`

Ne publie jamais le fichier `.env` et ne mets jamais la clé OpenAI dans le code du navigateur.

## Déploiement en ligne sur Render
1. Crée un compte Render et un dépôt GitHub contenant ces fichiers.
2. Dans Render, choisis **New > Blueprint** et relie le dépôt. Render lira `render.yaml` et préparera le serveur et PostgreSQL.
3. Dans les variables du service, renseigne `TEAM_PASSWORD` avec un mot de passe solide et `OPENAI_API_KEY` avec ta clé API.
4. Vérifie `OPENAI_MODEL` : le modèle choisi doit être disponible dans ton compte API et accepter les images.
5. Déploie. L'adresse HTTPS fournie par Render sera le lien à partager avec le personnel.

Les tarifs et disponibilités des offres d'hébergement et d'API peuvent évoluer. Le déploiement et les clés doivent être configurés dans tes propres comptes.

## Utilisation
- Connecte-toi avec le mot de passe commun.
- Choisis la date du service.
- Importe la photo.
- Relis soigneusement les résultats : l'écriture manuscrite peut être ambiguë.
- Modifie les champs si nécessaire.
- Clique sur **Imprimer / créer le PDF** puis choisis « Enregistrer au format PDF » ou ton imprimante.

## Limites de cette première version
- Connexion par mot de passe commun, pas de comptes individuels ni de rôles.
- Pas encore de sauvegarde de la photo d'origine.
- Pas de gestion des plans de salle ni des tables libres.
- Les réservations sont enregistrées dans PostgreSQL et visibles par toute l'équipe.
- Pour un service réel, vérifie toujours les données extraites avant impression.
