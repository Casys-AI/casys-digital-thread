# ID01 — feuille d’estimation de production (documentaire)

Audience: both · Diátaxis: none · Kind: dated documentary worksheet

2026-09-13. Hors sélecteur Buy. `industrialize.observe-print-estimate@1` n’a pas été
joué sur ID01. Aucune sortie numérique n’est calculée ici.

Schéma : `id01-buy-preparation/1.0`. Ce n’est pas un `print-estimate-case/1.0`, ni un
Item Price, ni une Supplier Quotation.

## Séparation d’autorité

| Entrée                           | Où elle peut vivre                                                 | État ID01                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Prix catalogue composant         | Item Price ERP, après import autorisé                              | 2 observations prêtes (Holybro, LIGPOWER) ; Prusa documentaire non prête ; 2 copies constructeur Raspberry Pi non prêtes |
| Devis fournisseur                | Supplier Quotation réelle                                          | absente — ne pas forger                                                                                                  |
| Matière consommée, temps machine | print-estimate scellé                                              | `unavailable`                                                                                                            |
| Coût de production intégré       | pas d’entrée Buy actuelle pour `external-documentary` / `estimate` | ne pas copier un Item Price filament sur une ligne make                                                                  |

## Symboles

Unités explicites (g, kg, h et kWh). Toute grandeur sans source reste `unresolved`.

- `m_part,g` — masse nette pièce, g
- `k_scrap` — surconsommation rapportée à la masse nette (0 ≤ k), incluant le rebut
- `m_filament,kg` — masse achetée
- `p_filament` — prix matière / kg, devise du relevé
- `t_machine,h`, `r_machine` — temps et taux machine
- `E_kWh`, `r_energy` — énergie et tarif
- `t_labor,h`, `r_labor` — temps et taux main-d’œuvre
- `n_occ` — occurrences proposées (placements), pas une BOM choisie

## Formules (sans évaluation)

```
m_filament,kg = (m_part,g / 1000) * (1 + k_scrap)
C_material     = m_filament,kg * p_filament
C_machine      = t_machine,h * r_machine
C_energy       = E_kWh * r_energy
C_labor        = t_labor,h * r_labor
C_part         = C_material + C_machine + C_energy + C_labor
C_line         = n_occ * C_part
```

Conditions : mêmes unités, même devise, pas de conversion FX inventée. Si un terme est
`unresolved`, `C_part` et `C_line` restent `unresolved`. Interdit : substituer 0.

## Entrées par pièce make

`n_occ` vient des placements (proposé). Tout le reste est vide.

| Pièce              | n_occ proposé | m_part,g   | k_scrap    | t_machine,h | E_kWh      | t_labor,h  | procédé    |
| ------------------ | ------------- | ---------- | ---------- | ----------- | ---------- | ---------- | ---------- |
| CentralDeck        | 1             | unresolved | unresolved | unresolved  | unresolved | unresolved | unresolved |
| RadialArm          | 4             | unresolved | unresolved | unresolved  | unresolved | unresolved | unresolved |
| BatteryTray        | 1             | unresolved | unresolved | unresolved  | unresolved | unresolved | unresolved |
| AvionicsCarrier    | 1             | unresolved | unresolved | unresolved  | unresolved | unresolved | unresolved |
| LandingSkid        | 2             | unresolved | unresolved | unresolved  | unresolved | unresolved | unresolved |
| CameraMountBracket | 1             | unresolved | unresolved | unresolved  | unresolved | unresolved | unresolved |

Volumes CAD documentés ailleurs (worksheet masse 2026-09-08) ne sont pas des masses
imprimées : densité et procédé manquent. Ne pas les multiplier ici.

## Matière candidate

Observation `obs.prusa-petg-jet-black-1kg` : 25.49 USD pour 1 kg de Prusament PETG Jet
Black NFC, relevé 2026-09-13T07:21:33.000Z, **conservée en documentaire**. Pas de reçu
primaire retenu dans ce worktree ; le GET indépendant root n’a pas lu ce montant (403).
Donc **pas** un Item Price et **pas** un `p_filament` utilisable. UOM Kg = bobine
vendue, pas masse imprimée. `m_part,g` reste `unresolved`.

Le banc FEA 6082-T6 n’a pas de prix matière sourcé. Ne pas le mélanger au PETG.

Taux machine, énergie, main-d’œuvre : non sourcés.

## Sorties

Aucune. `C_material`, `C_machine`, `C_energy`, `C_labor`, `C_part`, `C_line` et tout
total véhicule restent `unresolved`.
