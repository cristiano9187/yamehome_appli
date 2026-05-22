# WhatsApp — lookup prospects (Firestore, lecture seule)

## Rôle

La fonction HTTPS `whatsappProspectLookup` (codebase Firebase `archive`) expose une recherche **sans écriture** dans la collection `prospects`, pour enrichir l’assistant n8n / WhatsApp.

## Déploiement

1. Créer le secret (une longue chaîne aléatoire, ex. `openssl rand -hex 32`) :

   ```bash
   firebase functions:secrets:set WHATSAPP_PROSPECT_LOOKUP_KEY
   ```

2. Déployer la fonction :

   ```bash
   npm run deploy:functions-whatsapp-prospect-lookup
   ```

3. Côté **n8n** (recommandé) : credential **Header Auth** avec :
   - **Name** : `X-Yamehome-Key`
   - **Value** : la même valeur que le secret Firebase  
   Puis, sur le nœud **WhatsApp Prospect Lookup**, choisir **Authentication → Header Auth** et cette credential (pas besoin de variable d’environnement).

Alternative : variable d’environnement `YAMEHOME_WHATSAPP_LOOKUP_KEY` uniquement si tu préfères l’expression `$env` dans le nœud HTTP.

## API

- **URL** : `GET https://europe-west1-<PROJECT_ID>.cloudfunctions.net/whatsappProspectLookup`
- **Auth** : header `X-Yamehome-Key` = valeur du secret (éviter `?key=` en prod).
- **Comportement (défaut)** : recherche sur ce que le client **dit** dans le message (transmis par n8n), **pas** sur le numéro WhatsApp de l’expéditeur.
  - `usePhone=false` (défaut) : ignorer le match par téléphone sauf si tu passes explicitement `usePhone=true` + `phone`.
- **Query courantes** :
  - `startDate`, `endDate` (format `YYYY-MM-DD`)
  - `lastName`, `firstName`
  - `source` (optionnel) : `BOOKING` | `SITE_WEB` | `AIRBNB` | `FACEBOOK` | `WHATSAPP` | `TELEPHONE` | `AUTRE` — si présent, les résultats sont **filtrés** sur ce champ (exact, comme en base).

Réponse JSON : `ok`, `matchCount`, `prospects[]`, `query` (dont `source`).

## Sécurité

Sans clé valide → `401`. Ne partagez jamais la clé dans le dépôt ; utilisez Secret Manager + env n8n.

---

## Flux complet : `whatsappProspectFeed`

Pour l’assistant WhatsApp (n8n), le workflow peut appeler **`whatsappProspectFeed`** : liste récente des fiches `prospects` (même auth `X-Yamehome-Key`), injectée dans le prompt sous forme de JSON.

- **Déploiement** : `npm run deploy:functions-whatsapp-prospect-feed`
- **Champs exposés** : identité, logement, slug, `source`, dates, **`totalStayPrice`**, capacité, budget, horodatages — sans `notes` ni `status` (évite le bruit / données fragiles dans le prompt).
- **Côté prompt** : quand une ligne CRM a **`totalStayPrice` > 0**, c’est le montant total du séjour en FCFA (notamment pour BOOKING / OTA) ; le modèle ne doit pas le remplacer par le tarif catalogue.
