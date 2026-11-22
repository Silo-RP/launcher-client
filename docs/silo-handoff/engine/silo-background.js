/*
 * SiloBackground — un seul fond 3D derrière toute l'interface du launcher.
 *
 * - Une scène du moteur par menu (table MENUS ci-dessous). Chaque scène est construite à sa
 *   première visite, puis gardée en mémoire et mise en pause quand elle n'est pas affichée :
 *   revenir sur un menu est instantané.
 * - Changement de scène ou de point de vue par un fondu au noir. La construction d'une scène
 *   (~0,3 s pour l'escalier) se fait pendant le noir, l'utilisateur ne voit pas d'à-coup.
 * - Accueil → Lancement garde la même scène : pas de fondu, seule la vitesse change.
 * - Pause automatique quand la fenêtre est cachée ; pause manuelle quand Minecraft tourne.
 *
 * Dépend de engine/silo-ps1.js (window.SiloPS1), à charger avant ce fichier.
 *
 * Usage :
 *   var bg = SiloBackground(document.getElementById('bg'));   // conteneur en position absolue, plein cadre
 *   bg.show('accueil');                                         // clés de MENUS
 *   bg.setSpeed(1 + progression * 5);                           // pendant le lancement
 *   bg.pause();  bg.resume();                                   // jeu lancé / jeu fermé
 *   bg.setLook({ grain: 1, cold: 0.35 });                       // aspect du béton
 */
(function () {
  'use strict';

  var MENUS = {
    connexion:  { scene: 'stairs', mode: 'void' },   // vue plongeante dans le vide central
    accueil:    { scene: 'stairs', mode: 'walk' },   // descente de l'escalier à la première personne
    lancement:  { scene: 'stairs', mode: 'walk' },   // même descente, la vitesse suit la progression
    bulletin:   { scene: 'cafeteria' },              // la cantine et son écran sur l'extérieur
    parametres: { scene: 'control' }                 // la salle de contrôle
  };

  function SiloBackground(container, options) {
    options = options || {};
    var look = { grain: options.grain == null ? 1 : options.grain, cold: options.cold == null ? 0.35 : options.cold };
    var fadeMs = options.fadeMs || 260;
    var layers = {};
    var current = null, manualPause = false, queue = Promise.resolve();

    var veil = document.createElement('div');
    veil.setAttribute('aria-hidden', 'true');
    veil.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0;background:#000;opacity:1;pointer-events:none;transition:opacity ' + fadeMs + 'ms ease;';
    container.appendChild(veil);

    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function layer(scene) {
      if (layers[scene]) return layers[scene];
      var cv = document.createElement('canvas');
      cv.setAttribute('aria-hidden', 'true');
      cv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none;image-rendering:pixelated;';
      container.insertBefore(cv, veil);
      var h = window.SiloPS1.mount(cv, { scene: scene, grain: look.grain, cold: look.cold });
      h.pause();
      layers[scene] = { canvas: cv, handle: h };
      return layers[scene];
    }

    function running() { return !manualPause && !document.hidden; }

    function show(key) {
      var def = MENUS[key];
      if (!def) return queue;
      queue = queue.then(function () {
        var mode = def.mode || 'walk';
        if (current && current.scene === def.scene && current.mode === mode) { current.key = key; current.layer.handle.setSpeed(1); return; }
        veil.style.opacity = '1';
        return wait(current ? fadeMs : 0).then(function () {
          var L = layer(def.scene);
          if (current && current.scene !== def.scene) {
            current.layer.handle.pause();
            current.layer.canvas.style.display = 'none';
          }
          L.canvas.style.display = 'block';
          L.handle.setMode(mode);
          L.handle.setSpeed(1);
          if (running()) L.handle.resume();
          current = { key: key, scene: def.scene, mode: mode, layer: L };
          return wait(40);
        }).then(function () { veil.style.opacity = '0'; });
      });
      return queue;
    }

    function onVisibility() {
      if (!current) return;
      if (running()) current.layer.handle.resume(); else current.layer.handle.pause();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return {
      show: show,
      setSpeed: function (v) { if (current) current.layer.handle.setSpeed(v); },
      setLook: function (o) {
        if (o.grain != null) look.grain = o.grain;
        if (o.cold != null) look.cold = o.cold;
        Object.keys(layers).forEach(function (k) { layers[k].handle.setLook(look); });
      },
      pause: function () { manualPause = true; onVisibility(); },
      resume: function () { manualPause = false; onVisibility(); },
      destroy: function () {
        document.removeEventListener('visibilitychange', onVisibility);
        Object.keys(layers).forEach(function (k) { layers[k].handle.destroy(); layers[k].canvas.remove(); });
        layers = {}; current = null; veil.remove();
      }
    };
  }

  SiloBackground.MENUS = MENUS;
  window.SiloBackground = SiloBackground;
})();
