# Casys cockpit — décisions validées (maquettes)

Direction générale : Ark UI + Tailwind 4 sur Preact (Ark ne publie que React/Solid/Vue/Svelte : on utilise @ark-ui/react avec react + react-dom aliasés vers preact/compat — cf. overview-ark-tailwind-preact.html) — plus de shadcn/Radix ni de daisyUI. Neutres = échelle zinc Tailwind 4, type = stack system-ui par défaut, accent cyan-700 #0e7490 (l'ancien brand #5e6ad2 est abandonné). Lanes du graphe = violet-600 requirements / blue-600 system model / cyan-700 geometry / yellow-700 physics / green-700 verdicts, red-700 FAIL. Rayons Tailwind (lg cartes, md contrôles). Comportement via les data-* d'Ark, pas de variantes de classe. Densité ops-console ; labels de section en mono uppercase ; le graphe = élément signature.

Versions validées par l'utilisateur (dans dashboard-variants.html) :
- Overview → 2a (thread-first consolidé : bannière review unique, bandeau gates branché au graphe hero, tuiles verdicts à barres de marge, feed Now mono)
- Product → 3b (geometry-first : viewer scellé en grand, rail SysML compact avec AttributeUsage + requirements/constraints ancrés, ERP = ligne de couverture GAP en pied)
- Navigation → 5a (sous-menu dans la sidebar : Product › Structure / Requirements / Sourcing·ERP ; la matrice requirements ex-4a vit sous Product › Requirements)
- Matrice de preuve complète → 4a conservée (vit sous Product › Requirements, version condensée dans 5a ; ligne dépliée = chaîne d'evidence + verdict history)
- Verification → 4b (exploration graphe : pas de toggle full/local — double-clic nœud → local view, clic fond → full map ; minimap full-map en coin ; depth seulement en local ; inspecteur avec version history du nœud)
- Briefing initial → 6b validé (élicitation 2 colonnes : questions du cadrage ↔ brief qui s'assemble, items sourcés). 6a (brief-document) archivé. Lecture seule — confirmation via MRTR dans la conversation appariée.

- Work → 7a (feed chronologique : ruban Agent now / Agent question / Blocker, fil des faits avec eyebrows mono par kind, composer MRTR inline sur la décision en attente)
- Operations → 8a (flotte MCP : cartes santé par serveur — syson/build123d/calculix/modelica/erpnext —, confirmations MRTR en attente, file des runs)

Vocabulaire : "to Behave" actif ; "to Make" / "to Buy" = lanes réservées (GAP).

Versions : la matrice de preuve montre un trail compact du verdict dans la ligne dépliée (@36 FAIL → @41 PASS → @47 CURRENT) + lien "Inspect versions in Verification" ; le browser complet de versions vit dans l'inspecteur de l'exploration (4b).

Portage Ark UI + Tailwind 4 (Preact) : workbench-ark-tailwind-preact.html = les 7 vues validées dans un seul prototype navigable (nav 5a, Product déplié en Structure/Requirements/Sourcing, briefing 6b via le menu du header). overview-ark-tailwind-preact.html reste la page Overview seule ; overview-ark-tailwind.html = même page sur React.

Process : quand deux options sont en balance, demander à l'utilisateur plutôt que trancher seul.

- Kit composants → 9a (kit Ark UI × Tailwind 4 : Tabs, Accordion, Dialog, Select, Tooltip+Toast, Menu, Splitter, TreeView, Progress + socle boutons/chips/champs, avec les parts Ark et les classes Tailwind par spécimen)
