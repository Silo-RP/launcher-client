# Brief — refonte de l'interface du Silo Launcher

Ce dossier contient la nouvelle direction visuelle du launcher, validée sur maquette.
Ta mission : l'intégrer dans le launcher existant (Electron), en gardant le code, la logique et les données actuels (compte Microsoft, téléchargements, backend, fichier de langue).

**La référence absolue est `demo.html`** : ouvre-la dans un navigateur pour voir le résultat attendu (les 5 écrans, la navigation, les fonds 3D qui changent selon le menu, le lancement). Les aperçus de `preview/` montrent chaque scène.

---

## 1. Contenu du dossier

| Fichier | Rôle |
|---|---|
| `demo.html` | Démo autonome du launcher (980 × 552) : implémentation de référence de toute l'interface. |
| `engine/silo-ps1.js` | Moteur 3D WebGL « façon PS1 », sans dépendance. Trois scènes : `stairs`, `control`, `cafeteria`. |
| `engine/silo-background.js` | Gestionnaire du fond : une scène par menu, fondu au noir entre deux scènes, pause. |
| `ui/tokens.css` | Couleurs, polices, dimensions. |
| `preview/*.png` | Aperçus des scènes (rendus logiciels : sans tramage ni tremblement PS1). |

Les fichiers `engine/` se copient tels quels dans le projet : ne les réécris pas, ne les convertis pas en Three.js.

## 2. Architecture à mettre en place

1. **Un seul fond 3D**, monté une fois dans la fenêtre principale, derrière toute l'interface, et jamais démonté pendant la navigation :
   ```html
   <div id="bg" style="position:absolute; inset:0"></div>  <!-- premier enfant de la fenêtre -->
   ```
   ```js
   const bg = SiloBackground(document.getElementById('bg'));
   ```
   Charge `engine/silo-ps1.js` puis `engine/silo-background.js` (scripts classiques, ils exposent `window.SiloPS1` et `window.SiloBackground`). Si le projet utilise un bundler, importe-les comme scripts globaux ou ajoute un `export` minimal, sans toucher au reste.

2. **Une scène par menu** : à chaque changement de route, appelle `bg.show(nomDuMenu)`. Correspondance (déjà dans `SiloBackground.MENUS`) :
   | Menu | Scène | Point de vue |
   |---|---|---|
   | `connexion` | escalier | vue plongeante dans le vide central |
   | `accueil` | escalier | descente à la première personne |
   | `lancement` | escalier | même descente, vitesse pilotée par la progression |
   | `bulletin` | cantine | travelling depuis la grande porte vers l'écran extérieur |
   | `parametres` | salle de contrôle | murs d'écrans, ambiance oppressante |
   Si les routes du projet portent d'autres noms, fais la correspondance dans le routeur, pas dans le moteur.

3. **Lancement** : pendant le téléchargement/démarrage, `bg.setSpeed(1 + progression * 5)` (progression de 0 à 1). Quand le processus Minecraft démarre : `bg.pause()`. Quand il se termine : `bg.resume()`.

4. **Paramètres** : ajoute l'option « Fond animé » (cochée par défaut, persistée avec les autres réglages). Décochée → `bg.pause()`.

5. **Performances** (à respecter) :
   - le moteur calcule en 384 × 216, à 30 images/s, et se met en pause tout seul quand la fenêtre est cachée (`visibilitychange`) ; garde `backgroundThrottling` activé dans Electron ;
   - une scène se construit à sa première visite (≈ 0,3 s pour l'escalier, 0,1 s pour les autres), pendant le fondu au noir ; elle reste ensuite en mémoire (≈ 12 Mo pour l'escalier) ;
   - l'accélération matérielle doit rester active. Si WebGL est indisponible, le moteur ne plante pas : le fond reste sombre (couleur `--silo-bg`), l'interface fonctionne.

6. **Polices** : Barlow et Barlow Condensed (licence SIL OFL). Embarque-les en local (`.woff2` + `@font-face`), pas de chargement depuis Google Fonts dans le launcher.

7. **Textes** : tous les textes visibles viennent du fichier de langue existant. Ceux de la démo sont des exemples (bulletins, statut serveur, journal, versions).

## 3. Règles d'interface (non négociables)

En cas de doute, **enlève plutôt qu'ajouter**. C'est la scène 3D qui porte l'ambiance, l'interface reste sobre.

- **Un seul élément fort par écran** : le bouton JOUER sur l'accueil, la progression pendant le lancement.
- **Accueil** = fond + nom du serveur + une ligne de statut + bouton JOUER + compte en haut à droite + une seule ligne d'accroche vers le dernier bulletin. Rien d'autre.
- Le **journal** ne s'affiche qu'à la demande pendant le lancement. La **version**, **Discord** et **YouTube** sont dans Paramètres. Les statuts **Mojang/backend** n'apparaissent qu'en cas de panne (bandeau d'erreur).
- **Couleurs** (`ui/tokens.css`) : fond `#0F0E0C`, texte `#ECE4D6`, texte secondaire `#A39B8E`. L'ambre `#E3A341` est réservé au bouton principal, à la progression et à l'onglet actif. Vert et rouge : uniquement pour les points de statut et les erreurs.
- **Polices** : Barlow Condensed en capitales espacées pour le titre et les boutons, Barlow pour tout le reste. Monospace uniquement dans le journal.
- **Interdits** : numérotation « 01 // », crochets d'angle décoratifs, libellés en capitales espacées partout, double barre d'état, cadre autour de chaque bloc, plus de deux filets visibles par écran.
- **Lisibilité** : un dégradé sombre sous chaque zone de texte (voir `.shade` dans la démo), contraste d'au moins 4,5:1. Le panneau Paramètres est translucide (≈ 74 % + flou de 8 px) : vérifie que les textes restent lisibles.
- **Fenêtre** : 980 × 552, barre du haut de 52 px intégrée (zone de déplacement `-webkit-app-region: drag`, boutons en `no-drag`), réduire + fermer (pas d'agrandir), marges de 40 px.
- **Accessibilité** : vrais `<button>` et `<a>`, `aria-label` sur les boutons-icônes, focus visible, `prefers-reduced-motion` respecté (le moteur ralentit déjà fortement le mouvement).

## 4. Écrans (détail dans `demo.html`)

- **Connexion** : emblème, « SILO », une phrase, bouton « CONNEXION MICROSOFT » (ambre), mention de la fenêtre Microsoft. Pas de navigation ni de compte.
- **Accueil** : en bas à gauche, l'accroche du dernier bulletin (lien vers Bulletin), « SILO » en grand, l'accroche du serveur, la ligne de statut (en ligne · joueurs · version). En bas à droite, JOUER et une mention « À jour · Java · mémoire ».
- **Lancement** : même mise en page. L'étape en cours et le pourcentage (ligne du Pacte et compteur « Niveau 087 / 144 » retirés à la demande du porteur du projet), une barre fine graduée en 12 paliers, le nombre de fichiers et un bouton « Voir le journal ». À droite : ANNULER (contour) puis EN JEU (désactivé) une fois prêt.
- **Bulletin** : liste des derniers bulletins en bas à gauche (point ambre sur le sélectionné), article à droite dans un panneau de 480 px.
- **Paramètres** : panneau de 400 px à droite, translucide : mémoire (curseur), résolution + plein écran, Java, dossier du jeu, fond animé, fermer au démarrage du jeu ; pied avec version, Discord, YouTube.

## 5. Ordre de travail proposé

1. Lis `demo.html` et les fichiers `engine/`, puis cartographie l'interface actuelle (fichiers CSS, composants, routes, fichier de langue).
2. Propose un plan (fichiers créés / modifiés / supprimés) **avant de coder**.
3. Copie `engine/` et `ui/tokens.css`, embarque les polices.
4. Monte le fond unique et branche `bg.show()` sur le routeur.
5. Refais les écrans un par un d'après la démo, en reliant les vraies données.
6. Branche le lancement (`setSpeed`, `pause` / `resume` sur le processus du jeu) et l'option « Fond animé ».
7. Supprime les éléments de l'ancienne interface qui n'existent plus (sidebar numérotée, double barre d'état, journal permanent, cadres décoratifs…).

## 6. Critères d'acceptation

- [ ] Chaque menu affiche sa scène ; passer d'un menu à l'autre fait un fondu au noir court, sans saccade visible.
- [ ] Accueil → Lancement : pas de fondu, la descente accélère avec la progression.
- [ ] Le fond est en pause pendant que Minecraft tourne, quand la fenêtre est réduite, et quand « Fond animé » est décoché.
- [ ] Aucun élément d'interface en dehors de ceux listés au §4.
- [ ] L'ambre n'apparaît que sur JOUER, la progression, l'onglet actif et la valeur de mémoire.
- [ ] Tous les textes viennent du fichier de langue.
- [ ] Polices chargées en local ; l'application fonctionne hors ligne (hors fonctions réseau).
- [ ] Aucune régression sur la connexion, les téléchargements et le lancement.

## 7. Notes

- Création de fans : aucun logo, visuel ou fichier officiel de la série n'est utilisé. Les décors sont modélisés et texturés en code (béton procédural, écran extérieur peint en dégradés).
- Pour retoucher une salle, modifie `buildStairs`, `buildControl` ou `buildCafeteria` dans `engine/silo-ps1.js` ; les réglages d'aspect se font sans toucher au code via `bg.setLook({ grain, cold })` (grain 0–1,5, béton froid 0–1).
