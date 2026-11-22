# Silo Launcher — dossier de passation

## Transmettre à Claude Code

1. **Dézippe** ce dossier à la racine de ton projet de launcher, par exemple dans `docs/silo-handoff/`.
2. **Vérifie la démo** : ouvre `demo.html` dans Chrome ou Edge. Tu dois voir l'écran de connexion sur la vue plongeante ; clique pour naviguer entre les menus.
3. **Dans Claude Code**, depuis le dossier du projet, colle ce message :

   > Lis `docs/silo-handoff/CLAUDE_CODE_BRIEF.md` et ouvre `docs/silo-handoff/demo.html` : c'est la nouvelle interface du launcher, à intégrer dans le projet. Commence par cartographier l'interface actuelle et propose-moi un plan (fichiers créés, modifiés, supprimés) avant d'écrire du code.

   Passe Claude Code en mode plan (Maj + Tab) pour cette première étape : il proposera le plan sans rien modifier, et tu valideras avant qu'il code.

4. **Commite le dossier** avec le projet, pour que l'agent le retrouve dans les sessions suivantes. Tu peux aussi ajouter cette ligne au `CLAUDE.md` du projet :

   > Direction visuelle et règles d'interface : voir `docs/silo-handoff/CLAUDE_CODE_BRIEF.md` (référence : `demo.html`).

## Contenu

- `CLAUDE_CODE_BRIEF.md` : le brief pour l'agent (architecture, règles d'interface, écrans, étapes, critères d'acceptation).
- `demo.html` : la démo autonome, implémentation de référence.
- `engine/silo-ps1.js` : le moteur 3D (escalier, salle de contrôle, cantine).
- `engine/silo-background.js` : le fond unique qui change de salle selon le menu.
- `ui/tokens.css` : couleurs, polices, dimensions.
- `preview/` : aperçus des quatre vues.

La maquette d'origine reste consultable sur le canevas : https://claude.ai/artifact/Y2R32dNpJemSKzwGvEtscW
