# Reçus multi-logements et séjours split (spécification produit & technique)



Référence pour l’implémentation : **un seul dossier client**, **plusieurs unités** au calendrier, **historique** conservé, **PDF facture** (phase ultérieure ou en parallèle).



---



## 1. Deux objectifs (compatibles)



| Scénario | Description |

|----------|-------------|

| **Multi-logements, même période** | Ex. réservation Booking « chambre + appartement » : mêmes dates (ou chevauchement à trancher métier), plusieurs `calendarSlug`. |

| **Séjour split** | Même client enchaîne dans le temps : logement A puis logement B. |



Les deux se modélisent par une **liste ordonnée de segments** sur le **même** reçu (`receiptId`).



---



## 2. Caution



### Multi-logements **en parallèle**



- **Règle par défaut :** somme des cautions barémiques des logements concernés.

- **Chevauchement partiel des périodes :** politique à afficher clairement à la saisie.



### Séjour **split**



- Choix manuel : montant parmi les **barèmes** des logements du séjour, ou **0**.

- **Égalité de nuitées :** pas d’heuristique implicite ; l’utilisateur choisit.



---



## 3. Encaissements



- Les **paiements restent globaux** sur le reçu (`payments`, soldes, etc.).

- Une **répartition indicative par logement / segment** (`lodgingAllocated` optionnel par segment) peut servir le **PDF**, l’**analyse** ou des exports — sans dupliquer pour autant un deuxième journal de paiements en v1.



---



## 4. Édition



- **Tout modifiable** après création : nom client, prolongation, changement de logement, ajout/suppression/reordonnancement de segments (dans la limite des contrôles métier : conflits de dates, etc.).



---



## 5. UX (création)



- **Liste de segments éditable** sur la fiche reçu : ajouter une ligne (logement + dates + répartition optionnelle), plutôt qu’un assistant pas à pas — cohérent avec une **édition libre** après coup.

- Une bascule ou section « **Un seul logement** » masque la liste et repose sur les champs habituels (compatibilité anciens reçus).



---



## 6. Calendrier applicatif & historique



- **Historique :** une entrée = un reçu ; le détail liste les segments.

- **Calendrier interne :** le client s’affiche sur **chaque** unité pour **chaque** plage segment.

- **Ménage :** un rapport **par segment** (checkout + `calendarSlug` du segment).



---



## 7. `public_calendar` (Firebase, site, n8n)



- **Reçu mono-segment** (comportement historique) : **un seul document** dont l’ID reste **`receiptId`** — les intégrations existantes qui lisent ce document sont **inchangées**.

- **Reçu multi-segments** : **un document par segment**, ID = **`{receiptId}__{segmentId}`**, champ `ref_id` = `receiptId` et `id` (dans le corps) = `calendarSlug` comme aujourd’hui.

- Pour lister toutes les plages d’un client : requêter **`where ref_id == receiptId`** (et `type == reservation`) plutôt que `doc(receiptId)` seul.

- **Suppression / annulation :** supprimer **tous** les documents `public_calendar` avec `ref_id == receiptId` (réservation), puis réécrire si besoin.



---



## 8. Rétrocompatibilité



- Reçus sans `staySegments` : **un segment implicite** dérivé de `calendarSlug`, `apartmentName`, `startDate`, `endDate`.



---



## 9. PDF



- Gabarit **facture** : lignes par segment, total, texte sur la caution.



---



## Implémentation dans le code



- `src/utils/receiptSegments.ts` — `getReceiptSegments`.

- `src/utils/publicCalendar.ts` — `syncReservationPublicCalendar`, `deleteAllReservationEventsForReceipt`.

- `App.tsx` — sync systématique après enregistrement (y compris pour retirer les places publiques si le reçu n’est plus VALIDE) ; rapports ménage **par segment**.

- `CalendarView` — réservations et grille ménage basées sur les segments.

- `archiveManager` / **Cloud Function** archivage — suppression de `public_calendar` par requête **`ref_id` + `type == reservation`**.

- **Index Firestore :** si Firebase le demande, créer un index composite sur `public_calendar` pour `ref_id` + `type`.



**Prochaines itérations :** UI liste de segments sur le formulaire reçu ; chevauchement / dates bloquées **par segment** ; règles caution automatisées ; PDF facture.


