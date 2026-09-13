# ID01 — packet de préparation Buy (démo, non admis)

Audience: both · Diátaxis: none · Kind: dated documentary preparation

2026-09-13. Worktree isolé `cdt-id01-sourcing-20260913`. Lecture des baselines d’audit
et des autorités Buy. Aucun runtime, provider, ERP, achat, MRTR, commit ou push. Schéma
propre `id01-buy-preparation/1.0` : **ce n’est pas** `buy-configuration/1.0`.

Démo : drone civil non armé `inspection-drone-id01`. Brief r7 exclut le vol réel,
l’achat et la fabrication physique. Objectif : dossier sourcé d’intégration numérique,
pas une qualification de vol.

## Bases exactes

| Identité       | Valeur                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Projet         | `inspection-drone-id01` r892 `inspection-drone-id01:project:r892:5d6ef81cf812c6f1` (généré 2026-09-12T14:59:27.513Z)                             |
| Brief approuvé | r7, 40 items, `inspection-drone-id01:brief:r7:22fb5d1b598dbd41`                                                                                  |
| Thread         | r119, 220 artefacts, `project:inspection-drone-id01:r119:industrialize-run-dfm-checks-run:id01-yolo-queue-dfm-r118-authority-retry-jit-20260912` |
| Item coût      | `cost-later` (`manufacturing-evidence`) : fabrication, achats, devis et chiffrage restent une étape ultérieure                                   |
| Buy ID01       | zéro artefact, zéro run, zéro qualifieur de site                                                                                                 |

Workbench `engineering-workbench/0.6` : projection publique, pas des octets canoniques.
Captures courantes rouvertes depuis les copies SHA-vérifiées de l’audit (octets **non**
recopiés sous `docs/`) :

- `architecture-capture/4.0` SHA-256
  `1782bbb8e7e3a3fdf97ccec9613d243214a946b525d83e6714e95c2b68d8cdd9` (19
  PartDefinitions)
- `part-definitions-capture/1.0` SHA-256
  `879ac8a5d892ded7ffe325fcde36d81ce41b4655dbfaf9b472140c5643ebae9c` (19
  PartDefinitions)
- reçu `id01-architecture-cas-reopen.json`

## Architecture reconstruite

Racine `InspectionDrone` `f58ee456-a69f-4835-a6f4-e15503c528a1` = `semanticRoot` de
`architecture-capture/4.0`. Architecture **courante** Thread r119 :
`architecture-1782bbb8e7e3a3fdf97ccec9613d243214a946b525d83e6714e95c2b68d8cdd9` (trous
caméra, 2026-09-11T04:16:50.078Z). Quatre têtes historiques inchangées. Capture
structure courante
`part-definitions-879ac8a5d892ded7ffe325fcde36d81ce41b4655dbfaf9b472140c5643ebae9c`.

Six modules, identités parent/usage/cible **issues de la capture** (label usage ≠
nécessairement le nom de définition) :

| Définition       | PartDefinition                         | PartUsage                              | label usage       |
| ---------------- | -------------------------------------- | -------------------------------------- | ----------------- |
| Airframe         | `aed8a774-ae7e-4253-976f-fa79cdcb7b6d` | `682ab9c1-a59f-4419-bced-db434a9e99e9` | `airframe`        |
| PropulsionSystem | `ce5021a0-9e1c-4c58-a2dc-7e4b4dda8de7` | `40728220-ecd8-46d5-85d2-bd24259dedf4` | `propulsion`      |
| CameraPayload    | `ed1a741f-4c24-4166-8e90-745c9211d6cf` | `aada756e-3ba9-4089-ab6c-c00252007218` | `cameraPayload`   |
| ElectricalPower  | `8a55a273-884c-486d-b336-00662d5c4107` | `1a748d4f-733d-475a-b8ab-919fd5fe8ea1` | `electricalPower` |
| FlightAvionics   | `9cac605e-5d64-4451-9421-7852a34a4223` | `5a905cf3-43e2-4c2d-b9aa-277b82ce3005` | `avionics`        |
| LandingGear      | `1f63469d-9b5b-4693-8aef-42066e3bdf5d` | `78e6c567-3d38-4e35-a3f8-40d8d23bd883` | `landingGear`     |

Douze feuilles, 22 PartUsage. Compte d’usages = structure de capture, **pas** une
quantité Buy canonique (`buyStatus: unresolved`). Les propositions de placement sont
conservées comme propositions (`canonical: false`). UOM `Nos`. Processus de fabrication
des pièces propres : `unresolved`. Les JSON de placement restent des preuves de pose,
pas l’autorité de nommage.

| Classe                        | Pièces                                                                                | Usages capture (non BOM) |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------ |
| Candidats imprimés/custom     | CentralDeck, RadialArm, BatteryTray, AvionicsCarrier, LandingSkid, CameraMountBracket | 1+4+1+1+2+1              |
| Enveloppes COTS               | AutopilotEnvelope, CompanionComputerEnvelope, MotorEnvelope, CameraBoardEnvelope      | 1+1+4+1                  |
| Placeholders non sélectionnés | BatteryReservedVolume, StaticPropellerEnvelope                                        | 1+4                      |

Slots absents de l’architecture : batterie réelle, ESC, PM/PDB, hélice commerciale,
liaison RC, visserie/faisceaux.

## Géométrie / STEP applicable (courant vs historique)

Parent Buy ultérieur, si un humain l’admet : module **courant** `InspectionDrone`
`design.write-geometry@1`

- capture `geometry-2c93a4b804641c2ebfc99c78adef30954c400fd41de85591b79d63f71c7d2358`
- STEP `f62028c3f1df56a50d2b551edb4d140f547710672dc3a99b1f752b9be33c57b8`
  (2026-09-11T06:32:58.838Z)
- URI préparatoire
  `thread-artifact://inspection-drone-id01/cad-asset-2c93a4b804641c2ebfc99c78adef30954c400fd41de85591b79d63f71c7d2358-module-step-f62028c3f1df56a50d2b551edb4d140f547710672dc3a99b1f752b9be33c57b8`
  (forme attendue par le validateur Buy ; la projection snapshot est
  `/api/thread/assets/f62028c3f1df56a50d2b551edb4d140f547710672dc3a99b1f752b9be33c57b8.step`)

STEP feuilles **courants** inchangés sauf CentralDeck (`9213a54a…`, 2026-09-07,
interface caméra) et CameraBoardEnvelope (`2572f73d…`, 2026-09-11, trous). Historiques
conservés dans `architecture-reconstruction.json`. 25 STEP Thread r119 au total.

FDM printabilité / print-estimate : **non jouées** sur ID01. DFM mesurée = enveloppe
caméra MK4s, pas une autorisation de fabrication des pièces structurelles. Banc FEA =
6082-T6 théorique, pas un stock acheté.

## Propositions d’articles (5 COTS/matière, pas une sélection)

Statut uniforme : `proposal-not-selected`. Aucun devis fournisseur.

| Code ERP proposé                    | Lien architecture                     | Item Price ?                                                                                                                                 |
| ----------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEMO-ID01-PIXHAWK-6C-MINI-A-11088` | AutopilotEnvelope (candidate)         | oui, 130.99 USD / Nos (SKU 11088 None, variant 44511517540541 ; distinct du bundle 149.98)                                                   |
| `DEMO-ID01-THOBBY-F1404-KV4600`     | MotorEnvelope (candidate)             | oui, 16.90 USD / Nos (KV4600)                                                                                                                |
| `DEMO-ID01-RPI-ZERO-2-W`            | CompanionComputerEnvelope (candidate) | non — headline 15 USD, pas de checkout                                                                                                       |
| `DEMO-ID01-RPI-CAM-MOD3-STD`        | CameraBoardEnvelope (candidate)       | non — « from 25 USD », pas de checkout                                                                                                       |
| `DEMO-ID01-PRUSAMENT-PETG-JB-1KG`   | aucune PartDefinition (`unknown`)     | non — Item seulement. Quote session 25.49 USD conservée au manifeste, root-unverified (GET 403) ; UOM Kg = bobine vendue, pas masse imprimée |

Entrée planner : `erp-demo-catalogue.json` (`demo-catalogue/1.0`). Price List
`DEMO-ID01-PUBLIC-CATALOGUE`. Pas de `valid_from` / `valid_upto` dans les payloads.
Pièces make : pas d’Item Price. Filament : pas d’Item Price.

Plan offline accepté (`demo-catalogue-plan/1.0`, `grants: none`) : 8 appels proposés (1
Price List, 5 Item, 2 Item Price), UOM `Kg`/`Nos`, groupe `DEMO-ID01`, 10 prérequis
`unresolved`. Rien n’a été créé.

Relevés : `price-source-manifest.json` (digest lié dans le catalogue). UTC canonique
2026-09-13T07:19:33.000Z (Holybro, LIGPOWER, Raspberry Pi) et 2026-09-13T07:21:33.000Z
(Prusa). Taxe, validité, stock réservable : inconnus. Pas de total drone.

## Fabrication vs catalogue

Le sélecteur Buy actuel n’évalue que Item Price (`catalogue`) ou Supplier Quotation
(`quotation`). `external-documentary` / `estimate` restent non chiffrés. Feuille de
production : `production-estimate-worksheet.md` — formules sans sortie numérique faute
d’entrées sourcées (masse, temps, énergie, MO, taux machine).

## Prochaines étapes minimales (hors ce writer)

1. Dépôt propriétaire `mcp-erpnext` : appliquer plus tard le plan
   `demo-catalogue-plan/1.0` (5 Item, 2 Item Price) sur un site autorisé. La préparation
   offline n'appelle aucun serveur. L'import réel utilise les outils existants du
   propriétaire ; aucune Supplier Quotation, aucun `modified` ou `siteId` inventé, aucun
   secret dans le paquet.
2. Après import autorisé : collecter `name` / `modified` réels.
3. Profil `local-erpnext-buy-installation-profile/1.0` + fixture de qualification, puis
   lier `commerce.read-erpnext-buy-source@1` (humain / runtime). Tant que ce n’est pas
   `qualified`, Buy ID01 reste `unresolved`.
4. Ingress `project_resource_capture` d’une vraie `buy-configuration/1.0` (occurrences +
   STEP courant ci-dessus + sources URI+SHA après capture). JSON de ce dossier =
   brouillon.
5. Revue capture → MRTR → `buy.capture-configuration-cost@1` → scellement. Couverture
   `partial`, dimensions taxe/transport nommées. Aucun achat.

## Fichiers

- `architecture-reconstruction.json`
- `article-proposals.json`
- `price-source-manifest.json`
- `erp-demo-catalogue.json`
- `production-estimate-worksheet.md`
- `validate-buy-preparation.py` (lecture seule)

## Limites

CAS rouvert ; les captures complètes restent hors `docs/`. Quantités Buy `unresolved`.
Compatibilité moteur/hélice/ESC/caméra/câble Zero : `unresolved`. Prix Raspberry Pi :
copie constructeur. Quote Prusa 25.49 documentary / non ItemPrice-ready. PDF Camera
Module 3 non téléchargé. Aucune masse imprimée, temps machine ou total véhicule.
