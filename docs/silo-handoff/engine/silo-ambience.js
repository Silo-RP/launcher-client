/*
 * SiloAmbience — ambiance sonore du silo, synthétisée en direct (Web Audio), sans aucun fichier :
 * ventilation et bourdonnement électrique en fond ; dans l'escalier, des pas lointains et une
 * porte métallique avec un écho de cage d'escalier ; à la cantine, la rumeur des conversations et
 * des couverts ; en salle de contrôle, des bips et des relais. Volume bas, désactivée par défaut.
 *
 * Usage :
 *   var amb = SiloAmbience();
 *   amb.setScene('stairs' | 'cafeteria' | 'control' | null);
 *   amb.setEnabled(true | false);      // option « Ambiance sonore »
 *   amb.setSuspended(true | false);    // jeu lancé, fenêtre cachée…
 * Quand rien ne doit jouer, le contexte audio est suspendu : aucun calcul.
 */
(function () {
  'use strict';

  var LEVEL = { stairs: 1, cafeteria: 0.9, control: 0.85 };

  function SiloAmbience(options) {
    options = options || {};
    var volume = options.volume == null ? 0.45 : options.volume;
    var ctx = null, master = null, echoIn = null, noiseBuf = null;
    var scene = null, enabled = false, suspended = false;
    var beds = [], timers = [], stopTimer = 0;

    function rand(a, b) { return a + Math.random() * (b - a); }

    function ensure() {
      if (ctx) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // écho de cage d'escalier : retard bouclé, assourdi à chaque passage
      echoIn = ctx.createDelay(1.0);
      echoIn.delayTime.value = 0.23;
      var fb = ctx.createGain(), lp = ctx.createBiquadFilter(), wet = ctx.createGain();
      fb.gain.value = 0.4; lp.type = 'lowpass'; lp.frequency.value = 1600; wet.gain.value = 0.55;
      echoIn.connect(lp); lp.connect(fb); fb.connect(echoIn); lp.connect(wet); wet.connect(master);
      return true;
    }

    function noise(loop, rate) {
      var s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = !!loop;
      s.playbackRate.value = rate || 1;
      return s;
    }
    function filter(type, freq, q) {
      var f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; if (q != null) f.Q.value = q;
      return f;
    }
    function gain(v) { var g = ctx.createGain(); g.gain.value = v; return g; }
    function pan(v) {
      if (!ctx.createStereoPanner) return gain(1);
      var p = ctx.createStereoPanner(); p.pan.value = v; return p;
    }

    // ---- fonds continus ----
    function bed(parts) { beds.push(parts); }
    function startBeds(sc) {
      var t = ctx.currentTime, k = LEVEL[sc] || 1;
      // ventilation : souffle grave
      var vent = noise(true, 0.6), vf = filter('lowpass', sc === 'cafeteria' ? 320 : 240, 0.6), vg = gain(0.2 * k);
      vent.connect(vf); vf.connect(vg); vg.connect(master); vent.start(t);
      // bourdonnement électrique du secteur
      var hum = ctx.createOscillator(), hg = gain(sc === 'control' ? 0.03 : 0.014);
      hum.type = 'sine'; hum.frequency.value = 50; hum.connect(hg); hg.connect(master); hum.start(t);
      var hum2 = ctx.createOscillator(), hg2 = gain(sc === 'control' ? 0.016 : 0.006);
      hum2.type = 'triangle'; hum2.frequency.value = 100; hum2.connect(hg2); hg2.connect(master); hum2.start(t);
      bed([vent, hum, hum2]);
      if (sc === 'cafeteria') {
        // rumeur des conversations : bruit filtré dans la bande de la voix, qui ondule
        var mur = noise(true, 0.9), mf = filter('bandpass', 520, 0.8), mg = gain(0.05);
        var lfo = ctx.createOscillator(), lg = gain(0.03);
        lfo.frequency.value = 0.21; lfo.connect(lg); lg.connect(mg.gain);
        mur.connect(mf); mf.connect(mg); mg.connect(master); mur.start(t); lfo.start(t);
        bed([mur, lfo]);
      }
    }
    function stopBeds() {
      beds.forEach(function (parts) { parts.forEach(function (n) { try { n.stop(); } catch (e) { /* déjà arrêté */ } }); });
      beds = [];
    }

    // ---- sons ponctuels ----
    function burst(opts2) {
      var t = ctx.currentTime + (opts2.delay || 0);
      var src = noise(false, opts2.rate || 1), f = filter(opts2.type || 'bandpass', opts2.freq, opts2.q), g = gain(0), p = pan(opts2.pan || 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(opts2.level, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + opts2.dur);
      src.connect(f); f.connect(g); g.connect(p); p.connect(master);
      if (opts2.echo) p.connect(echoIn);
      src.start(t, Math.random() * 1.5);
      src.stop(t + opts2.dur + 0.05);
    }
    function tone(freq, dur, level, delay, panV, type) {
      var t = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator(), g = gain(0), p = pan(panV || 0);
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(p); p.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }
    var EVENTS = {
      stairs: [
        { every: [6, 18], play: function () {   // quelqu'un descend ou monte, plus loin
          var n = 4 + Math.floor(rand(0, 6)), side = rand(-0.8, 0.8), step = rand(0.42, 0.6), lvl = rand(0.08, 0.16);
          for (var i = 0; i < n; i++) burst({ freq: rand(260, 420), q: 2.2, dur: 0.09, level: lvl * rand(0.7, 1), delay: i * step, pan: side, echo: true, rate: 0.7 });
        } },
        { every: [25, 60], play: function () {  // porte métallique qui claque, quelque part
          var side = rand(-0.9, 0.9);
          burst({ freq: rand(900, 1300), q: 14, dur: 0.9, level: 0.09, pan: side, echo: true });
          burst({ freq: 180, q: 3, dur: 0.35, level: 0.12, pan: side, echo: true, type: 'lowpass' });
        } }
      ],
      cafeteria: [
        { every: [1.5, 5], play: function () {  // couverts
          var side = rand(-0.9, 0.9), f = rand(2400, 3800);
          tone(f, 0.16, 0.022, 0, side); tone(f * 1.48, 0.1, 0.012, 0.01, side);
        } },
        { every: [12, 30], play: function () {  // chaise qu'on tire
          burst({ freq: rand(300, 520), q: 6, dur: 0.45, level: 0.06, pan: rand(-0.8, 0.8), rate: 0.5 });
        } }
      ],
      control: [
        { every: [4, 12], play: function () {   // bips des consoles
          var f = Math.random() < 0.5 ? 880 : 1320, side = rand(-0.7, 0.7);
          tone(f, 0.09, 0.02, 0, side, 'square');
          if (Math.random() < 0.4) tone(f, 0.09, 0.02, 0.16, side, 'square');
        } },
        { every: [6, 20], play: function () {   // relais
          burst({ freq: 3000, q: 1, dur: 0.03, level: 0.08, pan: rand(-0.8, 0.8), type: 'highpass' });
        } }
      ]
    };
    function startEvents(sc) {
      (EVENTS[sc] || []).forEach(function (ev) {
        var loop = function () {
          ev.play();
          timers.push(setTimeout(loop, rand(ev.every[0], ev.every[1]) * 1000));
        };
        timers.push(setTimeout(loop, rand(ev.every[0], ev.every[1]) * 1000));
      });
    }
    function stopEvents() { timers.forEach(clearTimeout); timers = []; }

    // ---- état : jouer ou non ----
    function wanted() { return enabled && !suspended && scene != null; }
    function apply() {
      if (!wanted()) {
        if (!ctx) return;
        stopEvents();
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
        clearTimeout(stopTimer);
        stopTimer = setTimeout(function () { stopBeds(); if (ctx.state === 'running') ctx.suspend(); }, 1500);
        return;
      }
      if (!ensure()) return;
      clearTimeout(stopTimer);
      if (ctx.state !== 'running') ctx.resume();
      stopEvents();
      stopBeds();
      startBeds(scene);
      startEvents(scene);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.6);
    }

    return {
      setScene: function (sc) { if (sc === scene) return; scene = sc; apply(); },
      setEnabled: function (v) { v = !!v; if (v === enabled) return; enabled = v; apply(); },
      setSuspended: function (v) { v = !!v; if (v === suspended) return; suspended = v; apply(); },
      destroy: function () { stopEvents(); stopBeds(); if (ctx) ctx.close(); ctx = null; }
    };
  }

  window.SiloAmbience = SiloAmbience;
})();
