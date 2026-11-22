/*
 * Silo PS1 — mini moteur WebGL low-poly façon PlayStation 1 (prototype de fond animé).
 * Effets : rendu basse résolution agrandi sans lissage, sommets aimantés à la grille de pixels
 * (tremblement), couleurs interpolées en affine, éclairage précalculé par sommet, béton procédural
 * en gros texels, brouillard, tramage Bayer + couleurs 15 bits, 30 images/s.
 * API : window.SiloPS1.mount(canvas, { scene: 'stairs'|'control'|'cafeteria', mode: 'walk'|'orbit'|'void', speed, grain, cold })
 *       → { setSpeed(v), setMode(m), setLook({ grain, cold }), pause(), resume(), destroy() }
 */
(function () {
  'use strict';
  var TAU = Math.PI * 2;

  // ---------- utilitaires ----------
  function hexc(h) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function tint(c, s, amt) { var k = 1 + (hash(s) - 0.5) * 2 * amt; return [c[0] * k, c[1] * k, c[2] * k]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mod(a, n) { return ((a % n) + n) % n; }
  function cyl(r, a, y) { return [Math.cos(a) * r, y, Math.sin(a) * r]; }

  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(eye, target, up) {
    var z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }

  // ---------- construction de géométrie (couleurs éclairées par sommet) ----------
  // fx = 0 : surface éclairée ; fx > 0 : émissive qui grésille (valeur = graine) ; fx < 0 : émissive fixe.
  // bucketH : range les lumières par tranche de hauteur pour n'évaluer que les plus proches
  // layer : 0 = structure ; 1 et 2 = décors posés sur une surface (cadres, vitres, écrans…),
  // dessinés après coup avec un décalage de profondeur pour ne jamais scintiller dans le mur.
  function Mesh(lights, ambient, bucketH) {
    this.L = [{ p: [], c: [], f: [] }, { p: [], c: [], f: [] }, { p: [], c: [], f: [] }];
    this.layer = 0;
    this.p = this.L[0].p; this.c = this.L[0].c; this.f = this.L[0].f;
    this.lights = lights || [];
    this.amb = ambient || [0.12, 0.12, 0.12];
    this.bh = bucketH || 0;
    if (this.bh) {
      this.buckets = {};
      for (var i = 0; i < this.lights.length; i++) {
        var kb = Math.round(-this.lights[i].p[1] / this.bh);
        (this.buckets[kb] = this.buckets[kb] || []).push(this.lights[i]);
      }
    }
  }
  Mesh.prototype.light = function (v, n) {
    var acc = [this.amb[0], this.amb[1], this.amb[2]];
    if (!this.bh) { this.acc(acc, this.lights, v, n); return acc; }
    var kv = Math.round(-v[1] / this.bh);
    for (var q = kv - 1; q <= kv + 1; q++) if (this.buckets[q]) this.acc(acc, this.buckets[q], v, n);
    return acc;
  };
  Mesh.prototype.acc = function (acc, ls, v, n) {
    for (var i = 0; i < ls.length; i++) {
      var L = ls[i];
      var dx = L.p[0] - v[0], dy = L.p[1] - v[1], dz = L.p[2] - v[2];
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= L.r * L.r) continue;
      var d = Math.sqrt(d2);
      var nd = Math.abs((n[0] * dx + n[1] * dy + n[2] * dz) / (d || 1));
      var att = 1 - d / L.r; att = att * att;
      var k = (0.3 + 0.7 * nd) * att * L.i;
      acc[0] += L.c[0] * k; acc[1] += L.c[1] * k; acc[2] += L.c[2] * k;
    }
  };
  Mesh.prototype.vert = function (v, col, fx) {
    var t = this.L[this.layer];
    t.p.push(v[0], v[1], v[2]);
    t.c.push(col[0], col[1], col[2]);
    t.f.push(fx);
  };
  Mesh.prototype.tri = function (a, b, c, col, fx) {
    fx = fx || 0;
    var vs = [a, b, c], n = fx ? null : norm(cross(sub(b, a), sub(c, a)));
    for (var i = 0; i < 3; i++) {
      var cc = col;
      if (!fx) { var l = this.light(vs[i], n); cc = [col[0] * l[0], col[1] * l[1], col[2] * l[2]]; }
      this.vert(vs[i], cc, fx);
    }
  };
  // base : une couleur, ou un tableau de 4 couleurs (une par coin)
  Mesh.prototype.quad = function (a, b, c, d, base, fx) {
    fx = fx || 0;
    var vs = [a, b, c, d];
    var cols = base.length === 4 ? base : [base, base, base, base];
    // normale par les diagonales : reste juste même si deux coins sont confondus (quads au centre d'un disque)
    var n = fx ? null : norm(cross(sub(c, a), sub(d, b)));
    var out = [];
    for (var i = 0; i < 4; i++) {
      var col = cols[i];
      if (!fx) { var l = this.light(vs[i], n); col = [col[0] * l[0], col[1] * l[1], col[2] * l[2]]; }
      out.push(col);
    }
    var idx = [0, 1, 2, 0, 2, 3];
    for (var j = 0; j < 6; j++) this.vert(vs[idx[j]], out[idx[j]], fx);
  };
  // 8 coins : 4 du bas puis 4 du haut, dans le même ordre
  Mesh.prototype.hexa = function (c, base, fx) {
    this.quad(c[4], c[5], c[6], c[7], base, fx);
    this.quad(c[0], c[1], c[2], c[3], base, fx);
    for (var i = 0; i < 4; i++) {
      var j = (i + 1) % 4;
      this.quad(c[i], c[j], c[j + 4], c[i + 4], base, fx);
    }
  };
  Mesh.prototype.box = function (x0, y0, z0, x1, y1, z1, base, fx) {
    this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], base, fx);
  };
  Mesh.prototype.beam = function (p0, p1, w, base, fx) {
    var d = norm(sub(p1, p0));
    var up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    var u = norm(cross(d, up)), v = cross(u, d), h = w / 2;
    var s = [[-1, -1], [1, -1], [1, 1], [-1, 1]], c = [], i;
    for (i = 0; i < 4; i++) c.push(add(p0, [(u[0] * s[i][0] + v[0] * s[i][1]) * h, (u[1] * s[i][0] + v[1] * s[i][1]) * h, (u[2] * s[i][0] + v[2] * s[i][1]) * h]));
    for (i = 0; i < 4; i++) c.push(add(p1, [(u[0] * s[i][0] + v[0] * s[i][1]) * h, (u[1] * s[i][0] + v[1] * s[i][1]) * h, (u[2] * s[i][0] + v[2] * s[i][1]) * h]));
    this.hexa(c, base, fx);
  };
  Mesh.prototype.tube = function (p0, p1, r, sides, base, fx, segs) {
    segs = segs || 1;
    var d = norm(sub(p1, p0));
    var up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    var u = norm(cross(d, up)), v = cross(u, d);
    function ring(a) { var ca = Math.cos(a) * r, sa = Math.sin(a) * r; return [u[0] * ca + v[0] * sa, u[1] * ca + v[1] * sa, u[2] * ca + v[2] * sa]; }
    for (var s = 0; s < segs; s++) {
      var q0 = mix(p0, p1, s / segs), q1 = mix(p0, p1, (s + 1) / segs);
      for (var k = 0; k < sides; k++) {
        var o0 = ring(k / sides * TAU), o1 = ring((k + 1) / sides * TAU);
        this.quad(add(q0, o0), add(q0, o1), add(q1, o1), add(q1, o0), base, fx);
      }
    }
  };

  // ---------- scène 1 : l'atrium et l'escalier central (boucle infinie) ----------
  // D'après la série : fût central en béton avec appliques verticales, marches rayonnantes,
  // parapet plein + main courante, passerelles vers chaque niveau, colonnes devant les
  // parapets avec appliques côtelées en demi-tonneau côté escalier, coursives à parapet en boudin de béton et main
  // courante bleu-vert, façades de logements en modules (avancées, retraits), fenêtres aux
  // coins arrondis, portes encadrées, appliques, descentes de tuyaux, conduites et câbles au
  // plafond, néons.
  function buildStairs() {
    var PI = Math.PI;
    var Hl = 4.76;                      // hauteur d'un niveau
    var L = 0.5104;                     // palier = 2·asin(1,3 / rOut) : le ruban s'arrête pile au nu du parapet de la passerelle
    // Direction de la passerelle de chaque niveau, en quarts de tour (0 = est, 1 = nord, 2 = ouest,
    // 3 = sud) : les 4 points cardinaux dans un ordre erratique, jamais deux fois de suite la même.
    // L'escalier tourne d'un demi-tour ou de trois quarts de tour entre deux paliers pour tomber
    // sur la direction suivante. La suite se répète tous les 8 niveaux (5 tours complets) :
    // les boucles de caméra restent sans raccord.
    var DIRS = [0, 2, 1, 3, 2, 0, 3, 1], PER = DIRS.length;
    var DS0 = (PI - L) / 27;            // pas angulaire d'une marche (même giron sur toutes les volées)
    var rCol = 1.5, rIn = 1.42, rP = 4.9, rOut = 5.15;   // fût central (Ø 3 m), départ des marches (noyé dans le fût), parapet, face extérieure
    var rG = 13.0, rF = 16.6, rE = 17.2;            // coursives : bord de dalle, façade, fond
    var rC = 12.5, NC = 12;                         // colonnes, juste devant le parapet des coursives
    var NG = 48, dG = TAU / NG;                     // segments de coursive (~2,2 m de façade chacun)
    var K0 = -2, K1 = 18;                           // niveaux construits (boucles de caméra sur 8 niveaux + brouillard)
    var warm = [1.0, 0.9, 0.74];
    var bright = [1.0, 0.95, 0.84], dim = [0.6, 0.55, 0.46];
    var k, j, y;

    // angle cumulé du palier de chaque niveau (l'escalier tourne toujours dans le même sens)
    function turns(kk) { var q = mod(DIRS[mod(kk + 1, PER)] - DIRS[mod(kk, PER)], 4); return q === 1 ? 5 : q; }
    var KMIN = K0 - 2, KMAX = K1 + 2, THL = [0];
    for (k = 0; k < KMAX; k++) THL[k + 1] = THL[k] + turns(k) * PI / 2;
    for (k = -1; k >= KMIN; k--) THL[k] = THL[k + 1] - turns(k) * PI / 2;
    function TH(kk) { return THL[kk] + DIRS[0] * PI / 2; }
    var ROT = TH(PER) - TH(0);          // rotation sur une période (multiple de 2π)
    function levelAt(a) {
      var kk = KMIN;
      while (kk < KMAX - 1 && TH(kk + 1) - L / 2 <= a) kk++;
      return kk;
    }
    function smoothY(a) {
      var kk = levelAt(a), u = a - (TH(kk) - L / 2), span = TH(kk + 1) - TH(kk);
      if (u <= L) return -kk * Hl;
      return -kk * Hl - Math.min(1, (u - L) / (span - L)) * Hl;
    }
    function sAvg(a) {
      return (smoothY(a - 0.24) + smoothY(a - 0.12) + smoothY(a) + smoothY(a + 0.12) + smoothY(a + 0.24)) / 5;
    }
    function colA(n) { return (n + 0.5) * TAU / NC; }   // décalées des passerelles (points cardinaux)

    var lights = [];
    for (k = K0; k < K1; k++) {
      y = -k * Hl;
      for (j = 0; j < NC; j++) lights.push({ p: cyl(rC - 0.9, colA(j), y + 0.32), c: warm, r: 6.5, i: 1.0 });
      for (j = 0; j < 4; j++) lights.push({ p: cyl(6.8, PI / 4 + j * PI / 2, y + 2.0), c: warm, r: 7, i: 0.6 });
      // appliques du fût le long de la volée, environ tous les 70°
      for (var t = 1.0; t < TH(k + 1) - TH(k) - 0.5; t += 1.2) {
        var sa = TH(k) + t;
        lights.push({ p: cyl(rCol + 0.25, sa, smoothY(sa) + 2.2), c: warm, r: 6, i: 0.9, a: sa });
      }
      for (j = 0; j < 8; j++) lights.push({ p: cyl(15.4, PI / 8 + j * PI / 4, y + Hl - 1.0), c: [0.95, 0.93, 0.86], r: 6.5, i: 1.15 });
    }
    var m = new Mesh(lights, [0.2, 0.185, 0.16], Hl);

    var conc = hexc('#8a8273'), concD = hexc('#6e675b'), concS = hexc('#857d6f');
    var colC = hexc('#7c7568'), black = hexc('#161514');
    var wallC = hexc('#8b867c'), unitC = hexc('#827c71'), teal = hexc('#2b4644'), tealL = hexc('#41625f');
    var doorW = hexc('#6a5442'), rust = hexc('#5e4636'), pipeC = hexc('#4f524c'), cableC = hexc('#1a1918');
    var boxC = hexc('#59605a'), housing = hexc('#3a3a36');
    var glassW = [0.98, 0.78, 0.48], glassD = [0.55, 0.42, 0.3], glassO = [0.09, 0.085, 0.08];
    var neon = [0.92, 0.95, 0.93];
    var yTop = -K0 * Hl, yBot = -K1 * Hl, rows = 2 * (K1 - K0);

    // ---- petits outils de modélisation ----
    // point du plan tangent au cylindre r à l'angle a, décalé de du mètres le long de la façade
    function TP(r, a, du, yy) { var c = Math.cos(a), sn = Math.sin(a); return [c * r - sn * du, yy, sn * r + c * du]; }
    // rectangle aux coins cassés (l'« arrondi » PS1) face au vide ; ct/cb = pan coupé haut/bas
    function shape(r, a, du0, y0, w, h, ct, cb, col, fx, ly) {
      m.layer = ly || 0;
      var x0 = du0 - w / 2, x1 = du0 + w / 2, y1 = y0 + h;
      var pts = [TP(r, a, x0 + cb, y0), TP(r, a, x1 - cb, y0), TP(r, a, x1, y0 + cb), TP(r, a, x1, y1 - ct),
                 TP(r, a, x1 - ct, y1), TP(r, a, x0 + ct, y1), TP(r, a, x0, y1 - ct), TP(r, a, x0, y0 + cb)];
      for (var q = 1; q < 7; q++) m.tri(pts[0], pts[q], pts[q + 1], col, fx);
      m.layer = 0;
    }
    // bloc entre deux rayons et deux angles
    function block(r0, r1, a0, a1, ya, yb, col, fx) {
      m.hexa([cyl(r0, a0, ya), cyl(r1, a0, ya), cyl(r1, a1, ya), cyl(r0, a1, ya),
              cyl(r0, a0, yb), cyl(r1, a0, yb), cyl(r1, a1, yb), cyl(r0, a1, yb)], col, fx);
    }
    // câble qui pend entre deux points
    function sag(p0, p1, drop, w, col) {
      var prev = p0;
      for (var q = 1; q <= 4; q++) {
        var t = q / 4, p = mix(p0, p1, t);
        p[1] -= drop * 4 * t * (1 - t);
        m.beam(prev, p, w, col, 0);
        prev = p;
      }
    }
    // applique en demi-tonneau côtelé (lamelles claires/sombres), fixée sur la face de la colonne
    // tournée vers l'escalier, à hauteur du parapet ; couvercles et joues en métal sombre
    var lampMetal = hexc('#3b3a36');
    function lantern(c, ca, y0) {
      var face = ca + PI, NSL = 10, span = 3.4, R = [0.55, 0.67, 0.55], Y = [0, 0.4, 0.8], RC = 0.42;
      var P3 = function (r, ang, yy) { return [c[0] + Math.cos(ang) * r, yy, c[2] + Math.sin(ang) * r]; };
      for (var q = 0; q < NSL; q++) {
        var q0 = face - span / 2 + q * span / NSL, q1 = q0 + span / NSL, col = q % 2 ? dim : bright;
        for (var rr = 0; rr < 2; rr++) {
          m.quad(P3(R[rr], q0, y0 + Y[rr]), P3(R[rr], q1, y0 + Y[rr]), P3(R[rr + 1], q1, y0 + Y[rr + 1]), P3(R[rr + 1], q0, y0 + Y[rr + 1]), col, -1);
        }
        m.quad(P3(RC, q0, y0), P3(R[0], q0, y0), P3(R[0], q1, y0), P3(RC, q1, y0), lampMetal, 0);
        m.quad(P3(RC, q0, y0 + 0.8), P3(R[2], q0, y0 + 0.8), P3(R[2], q1, y0 + 0.8), P3(RC, q1, y0 + 0.8), lampMetal, 0);
      }
      [face - span / 2, face + span / 2].forEach(function (ang) {
        m.quad(P3(RC, ang, y0), P3(R[0], ang, y0), P3(R[1], ang, y0 + 0.4), P3(RC, ang, y0 + 0.4), lampMetal, 0);
        m.quad(P3(RC, ang, y0 + 0.4), P3(R[1], ang, y0 + 0.4), P3(R[2], ang, y0 + 0.8), P3(RC, ang, y0 + 0.8), lampMetal, 0);
      });
    }
    // profil du parapet en boudin (dr, dy) depuis le bord de dalle : dos, dessus arrondi, ventre côté vide, dessous
    var PROF = [[0.45, 0], [0.45, 1.0], [0.3, 1.1], [0.05, 1.08], [-0.1, 0.95], [-0.17, 0.7], [-0.19, 0.35],
                [-0.16, 0], [-0.08, -0.3], [0.1, -0.45], [0.45, -0.45]];
    var OPEN = [[0.45, 0], [-0.16, 0], [-0.08, -0.3], [0.1, -0.45], [0.45, -0.45]];   // au droit d'une passerelle
    function sweep(prof, c0, c1, yy, col) {
      for (var q = 0; q < prof.length - 1; q++) {
        var p0 = prof[q], p1 = prof[q + 1];
        m.quad(cyl(rG + p0[0], c0, yy + p0[1]), cyl(rG + p1[0], c0, yy + p1[1]),
               cyl(rG + p1[0], c1, yy + p1[1]), cyl(rG + p0[0], c1, yy + p0[1]), col, 0);
      }
    }
    function cap(c, yy) {
      var pts = PROF.map(function (p) { return cyl(rG + p[0], c, yy + p[1]); });
      for (var q = 1; q < pts.length - 1; q++) m.tri(pts[0], pts[q], pts[q + 1], conc, 0);
    }

    // fût central et ses appliques verticales
    m.tube([0, yBot, 0], [0, yTop, 0], rCol, 12, colC, 0, rows);
    for (var li = 0; li < lights.length; li++) {
      var Lg = lights[li];
      if (Lg.a == null) continue;
      var sy0 = Lg.p[1] - 0.45, sy1 = Lg.p[1] + 0.45, sa0 = Lg.a - 0.13, sa1 = Lg.a + 0.13;
      m.hexa([cyl(rCol - 0.05, sa0, sy0), cyl(rCol + 0.13, sa0, sy0), cyl(rCol + 0.13, sa1, sy0), cyl(rCol - 0.05, sa1, sy0),
              cyl(rCol - 0.05, sa0, sy1), cyl(rCol + 0.13, sa0, sy1), cyl(rCol + 0.13, sa1, sy1), cyl(rCol - 0.05, sa1, sy1)], bright, -1);
    }

    for (k = K0; k < K1; k++) {
      y = -k * Hl;
      var th = TH(k), span = TH(k + 1) - th;
      var NS = Math.round((span - L) / DS0), ds = (span - L) / NS, rise = Hl / (NS + 1);

      // palier
      for (j = 0; j < 2; j++) {
        var la0 = th - L / 2 + j * L / 2, la1 = la0 + L / 2;
        m.quad(cyl(rIn, la0, y), cyl(rOut, la0, y), cyl(rOut, la1, y), cyl(rIn, la1, y), tint(concS, 3 + j, 0.05), 0);
        m.quad(cyl(rIn, la0, y - 0.55), cyl(rOut, la0, y - 0.55), cyl(rOut, la1, y - 0.55), cyl(rIn, la1, y - 0.55), concD, 0);
      }

      // volée de marches, sous-face lisse, ruban extérieur, parapet, main courante
      var fa = th + L / 2;
      for (j = 0; j < NS; j++) {
        var a0 = fa + j * ds, a1 = a0 + ds, yT = y - (j + 1) * rise, s0 = smoothY(a0), s1 = smoothY(a1);
        m.quad(cyl(rIn, a0, yT), cyl(rP, a0, yT), cyl(rP, a1, yT), cyl(rIn, a1, yT), tint(concS, j * 3 + 1, 0.06), 0);
        m.quad(cyl(rIn, a0, yT), cyl(rP, a0, yT), cyl(rP, a0, yT + rise), cyl(rIn, a0, yT + rise), concD, 0);
        m.quad(cyl(rIn, a0, s0 - 0.55), cyl(rOut, a0, s0 - 0.55), cyl(rOut, a1, s1 - 0.55), cyl(rIn, a1, s1 - 0.55), concD, 0);
        m.quad(cyl(rOut, a0, s0 - 0.55), cyl(rOut, a1, s1 - 0.55), cyl(rOut, a1, s1 + 1.05), cyl(rOut, a0, s0 + 1.05), tint(conc, j, 0.04), 0);
        m.quad(cyl(rP, a0, s0 + 1.05), cyl(rOut, a0, s0 + 1.05), cyl(rOut, a1, s1 + 1.05), cyl(rP, a1, s1 + 1.05), conc, 0);
        m.quad(cyl(rP, a0, yT), cyl(rP, a1, yT), cyl(rP, a1, s1 + 1.05), cyl(rP, a0, s0 + 1.05), conc, 0);
        m.beam(cyl(rP + 0.03, a0, s0 + 1.2), cyl(rP + 0.03, a1, s1 + 1.2), 0.05, black, 0);
        if (j % 3 === 0) m.beam(cyl(rP + 0.03, a0, s0 + 1.05), cyl(rP + 0.03, a0, s0 + 1.2), 0.03, black, 0);
      }
      var fe = th + span - L / 2, yn = y - Hl;
      m.quad(cyl(rIn, fe, yn), cyl(rP, fe, yn), cyl(rP, fe, yn + rise), cyl(rIn, fe, yn + rise), concD, 0);
      m.quad(cyl(rP, fa, y - 0.55), cyl(rOut, fa, y - 0.55), cyl(rOut, fa, y + 1.05), cyl(rP, fa, y + 1.05), conc, 0);
      m.quad(cyl(rP, fe, yn - 0.55), cyl(rOut, fe, yn - 0.55), cyl(rOut, fe, yn + 1.05), cyl(rP, fe, yn + 1.05), conc, 0);

      // passerelle vers la coursive (point cardinal du niveau, jamais le même qu'au niveau précédent).
      // Ses parapets prolongent le ruban de l'escalier et rejoignent le parapet de la coursive : aucun jour aux raccords.
      var ux = Math.cos(th), uz = Math.sin(th), tx = -Math.sin(th), tz = Math.cos(th);
      var P = function (r, sv, yy) { return [ux * r + tx * sv, yy, uz * r + tz * sv]; };
      var bx = [rP - 0.15, 7.8, 10.5, 13.5], pb = y - 0.05, dt = y - 0.01, db = y - 0.56;
      for (j = 0; j < 3; j++) {
        var r0 = bx[j], r1 = bx[j + 1];
        m.hexa([P(r0, -1.3, db), P(r1, -1.3, db), P(r1, 1.3, db), P(r0, 1.3, db),
                P(r0, -1.3, dt), P(r1, -1.3, dt), P(r1, 1.3, dt), P(r0, 1.3, dt)], tint(concS, 11 + j, 0.05), 0);
        m.hexa([P(r0, -1.3, pb), P(r1, -1.3, pb), P(r1, -1.08, pb), P(r0, -1.08, pb),
                P(r0, -1.3, y + 1.05), P(r1, -1.3, y + 1.05), P(r1, -1.08, y + 1.05), P(r0, -1.08, y + 1.05)], conc, 0);
        m.hexa([P(r0, 1.08, pb), P(r1, 1.08, pb), P(r1, 1.3, pb), P(r0, 1.3, pb),
                P(r0, 1.08, y + 1.05), P(r1, 1.08, y + 1.05), P(r1, 1.3, y + 1.05), P(r0, 1.3, y + 1.05)], conc, 0);
      }
      var hr0 = rP - 0.13;
      m.beam(P(hr0, -1.17, y + 1.2), P(13.4, -1.17, y + 1.2), 0.05, black, 0);
      m.beam(P(hr0, 1.17, y + 1.2), P(13.4, 1.17, y + 1.2), 0.05, black, 0);
      // les mains courantes de la passerelle se raccordent à celles de l'escalier
      m.beam(cyl(rP + 0.03, th + L / 2, y + 1.2), P(hr0, 1.17, y + 1.2), 0.05, black, 0);
      m.beam(cyl(rP + 0.03, th - L / 2, y + 1.2), P(hr0, -1.17, y + 1.2), 0.05, black, 0);

      // ---- coursive en anneau et façades ----
      // parapet ouvert face à la passerelle du niveau
      var dK = DIRS[mod(k, PER)], sOpen = dK * NG / 4, bA = dK * PI / 2, wb = Math.asin(1.3 / rG);
      var fh = y + Hl - 0.45, yMid = y + 2.85;
      for (var s = 0; s < NG; s++) {
        var b0 = s * dG, b1 = b0 + dG, mid = b0 + dG / 2, gs = s * 13 + mod(k, 2) * 7;
        var h1 = hash(gs + 0.5), h2 = hash(gs + 1.7), h3 = hash(gs + 2.9), h4 = hash(gs + 4.1), hp = hash(s * 7.3 + 0.2);

        // parapet en boudin, ouvert pile à la largeur de la passerelle (bouchons aux extrémités)
        var open = s === mod(sOpen, NG) || s === mod(sOpen - 1, NG);
        if (!open) {
          sweep(PROF, b0, b1, y, tint(conc, gs, 0.05));
          m.beam(cyl(rG + 0.15, b0, y + 1.24), cyl(rG + 0.15, b1, y + 1.24), 0.05, teal, 0);
          m.beam(cyl(rG + 0.15, mid, y + 1.08), cyl(rG + 0.15, mid, y + 1.24), 0.035, teal, 0);
        } else if (Math.abs(mod(b0 - bA + PI, TAU) - PI) < 1e-6) {
          sweep(OPEN, b0, b0 + wb, y, conc); sweep(PROF, b0 + wb, b1, y, conc); cap(b0 + wb, y);
        } else {
          sweep(PROF, b0, b1 - wb, y, conc); sweep(OPEN, b1 - wb, b1, y, conc); cap(b1 - wb, y);
        }

        // dalle (dessus = sol de la coursive, dessous = plafond du niveau inférieur) et mur de fond
        m.quad(cyl(rG + 0.45, b0, y), cyl(rE, b0, y), cyl(rE, b1, y), cyl(rG + 0.45, b1, y), tint(concD, gs, 0.06), 0);
        m.quad(cyl(rG + 0.45, b0, y - 0.45), cyl(rE, b0, y - 0.45), cyl(rE, b1, y - 0.45), cyl(rG + 0.45, b1, y - 0.45), concD, 0);
        m.quad(cyl(rF, b0, y), cyl(rF, b1, y), cyl(rF, b1, fh), cyl(rF, b0, fh), tint(wallC, gs + 5, 0.08), 0);

        // modules de logement : rez en avancée variable, étage aligné, en encorbellement ou en retrait
        var e = 0.006, u0 = b0 + e, u1 = b1 - e, cosU = Math.cos((u1 - u0) / 2), cosG = Math.cos(dG / 2);
        var dLow = h1 < 0.3 ? 0 : (h1 < 0.7 ? 0.35 : 0.7);
        var dUp = h2 < 0.35 ? dLow : (h2 < 0.7 ? dLow + 0.3 : Math.max(0, dLow - 0.35));
        if (dLow > 0) block(rF - dLow, rF, u0, u1, y, yMid, tint(unitC, gs + 11, 0.1), 0);
        if (dUp > 0) block(rF - dUp, rF, u0, u1, yMid, fh, tint(unitC, gs + 17, 0.1), 0);
        var fLow = (rF - dLow) * (dLow > 0 ? cosU : cosG), fUp = (rF - dUp) * (dUp > 0 ? cosU : cosG);

        if (h3 < 0.42) {
          // porte encadrée, applique, boîtier
          var dd = (h4 - 0.5) * 0.5, side = h4 < 0.5 ? 1 : -1;
          shape(fLow - 0.02, mid, dd, y, 1.08, 2.28, 0.2, 0, teal, 0, 1);
          shape(fLow - 0.04, mid, dd, y, 0.86, 2.14, 0.16, 0, h4 < 0.55 ? doorW : tealL, 0, 2);
          var lp = TP(fLow - 0.1, mid, dd + side * 0.74, y + 2.05);
          m.box(lp[0] - 0.07, lp[1] - 0.09, lp[2] - 0.07, lp[0] + 0.07, lp[1] + 0.09, lp[2] + 0.07, [1.0, 0.82, 0.55], -1);
          if (h1 > 0.5) {
            var bp = TP(fLow - 0.09, mid, dd - side * 0.76, y + 1.35);
            m.box(bp[0] - 0.12, bp[1] - 0.17, bp[2] - 0.12, bp[0] + 0.12, bp[1] + 0.17, bp[2] + 0.12, boxC, 0);
          }
        } else {
          // une grande ou deux petites fenêtres aux coins arrondis, cadre bleu-vert
          var nW = h4 < 0.45 ? 1 : 2;
          for (var wi = 0; wi < nW; wi++) {
            var du = nW === 1 ? (h2 - 0.5) * 0.4 : (wi === 0 ? -0.5 : 0.5), ww = nW === 1 ? 1.25 : 0.68, wh = nW === 1 ? 0.95 : 1.05;
            var wy = y + 0.9 + h3 * 0.3;
            var gh = hash(gs * 3 + wi), gcol = gh < 0.15 ? glassO : (gh < 0.35 ? glassD : glassW);
            shape(fLow - 0.02, mid, du, wy - 0.07, ww + 0.14, wh + 0.14, 0.12, 0.12, teal, 0, 1);
            shape(fLow - 0.04, mid, du, wy, ww, wh, 0.08, 0.08, gcol, -1, 2);
          }
        }
        if (h2 > 0.25) {
          // petites fenêtres de l'étage
          var nU = h1 < 0.5 ? 2 : 1;
          for (var ui = 0; ui < nU; ui++) {
            var duu = nU === 1 ? 0 : (ui === 0 ? -0.45 : 0.45), gh2 = hash(gs * 5 + ui);
            shape(fUp - 0.02, mid, duu, yMid + 0.36, 0.6, 0.66, 0.09, 0.09, teal, 0, 1);
            shape(fUp - 0.04, mid, duu, yMid + 0.42, 0.48, 0.54, 0.06, 0.06, gh2 < 0.25 ? glassO : (gh2 < 0.45 ? glassD : glassW), -1, 2);
          }
        }

        // descentes de tuyaux entre deux logements (continues d'un niveau à l'autre)
        if (hp > 0.45) {
          m.tube(cyl(rF - 0.12, b0, y - 0.45), cyl(rF - 0.12, b0, fh), 0.09, 6, hp > 0.75 ? rust : pipeC, 0, 2);
          if (hp > 0.65) m.tube(cyl(rF - 0.3, b0, y - 0.45), cyl(rF - 0.3, b0, fh), 0.045, 5, hp > 0.85 ? pipeC : rust, 0, 2);
        }
        // conduites qui courent sous le plafond de la coursive
        m.tube(cyl(14.25, b0, fh - 0.18), cyl(14.25, b1, fh - 0.18), 0.1, 6, tint(pipeC, s, 0.08), 0, 1);
        m.tube(cyl(14.5, b0, fh - 0.12), cyl(14.5, b1, fh - 0.12), 0.06, 5, rust, 0, 1);
        // néons au plafond (boîtier + tube allumé)
        if (s % 2 === 0) {
          var na0 = mid - 0.55 / 15.2, na1 = mid + 0.55 / 15.2;
          block(15.05, 15.35, na0, na1, fh - 0.12, fh, housing, 0);
          m.layer = 1;
          m.quad(cyl(15.08, na0, fh - 0.13), cyl(15.32, na0, fh - 0.13), cyl(15.32, na1, fh - 0.13), cyl(15.08, na1, fh - 0.13), neon, -1);
          m.layer = 0;
        }
        // câbles qui pendent du plafond
        if (h4 > 0.6) sag(cyl(14.9, b0, fh - 0.05), cyl(14.9, b0 + 2 * dG, fh - 0.05), 0.6, 0.045, cableC);
      }
    }

    // colonnes devant les parapets, une applique par niveau à hauteur du parapet, côté escalier
    for (j = 0; j < NC; j++) {
      var cc = cyl(rC, colA(j), 0);
      m.tube([cc[0], yBot, cc[2]], [cc[0], yTop, cc[2]], 0.45, 10, tint(colC, j, 0.06), 0, rows);
      for (k = K0; k < K1; k++) lantern(cc, colA(j), -k * Hl - 0.08);
    }

    return {
      mesh: m, fog: [0.075, 0.066, 0.055], fogRange: [8, 38], fov: 58, flick: 0.25, texPeriod: 2 * Hl,
      cam: function (ph, mode) {
        if (mode === 'void') {
          // plongée dans le vide central depuis la diagonale nord-est (loin de l'axe des passerelles),
          // inclinée vers le fût : les passerelles partent vers les quatre points cardinaux, niveau
          // après niveau, sous une lente rotation. Boucle sur une période (8 niveaux).
          var yv = -2 * Hl + 6 - mod(ph * 0.5, PER * Hl), rot = ph * 0.04;
          var ev = cyl(8.6, PI / 4, yv);
          return { eye: ev, target: cyl(3.0, PI / 4, yv - 12), up: [Math.cos(rot), 0, Math.sin(rot)], fog: [4, 44] };
        }
        if (mode === 'orbit') {
          // on tourne autour de l'escalier en descendant, au rythme de sa spirale (3,4 m au-dessus des marches)
          var phi = TH(2) + mod(ph * 0.06, ROT), yc = sAvg(phi) + 3.4;
          var eo = cyl(8.2, phi, yc + Math.sin(ph * 0.5) * 0.06);
          return { eye: eo, target: [-Math.sin(phi) * 2.0, yc - 2.6, Math.cos(phi) * 2.0], up: [0, 1, 0], fov: 58 };
        }
        // vue subjective : on descend les marches, pilier à droite, le vide de l'atrium à gauche.
        // La hauteur suit une moyenne glissante de la pente : pas d'à-coup aux paliers.
        // Trajectoire à 1,5 m du parapet et 1,9 m du pilier, rien ne traverse la caméra.
        // Regard naturel : ~22° vers le bas, dans l'axe des marches.
        var a = TH(2) + mod(ph * 0.12, ROT);   // boucle sur une période : 8 niveaux, raccord invisible
        var eye = cyl(3.4, a, sAvg(a) + 1.65 + Math.sin(ph * 4.2) * 0.018);
        // cap = tangente tournée vers le pilier pour suivre la courbe des marches (~0,5 rad),
        // avec une lente dérive vers le vide de l'atrium
        var h = a + PI / 2 + 0.5 - 0.14 * Math.sin(ph * 0.23);
        return { eye: eye, target: [eye[0] + Math.cos(h) * 3, eye[1] - 1.2, eye[2] + Math.sin(h) * 3], up: [0, 1, 0], fov: 70 };
      }
    };
  }

  // ---------- scène 2 : salle de contrôle / surveillance ----------
  // D'après les concepts de la série : salle circulaire en béton sous lumière bleue, grand
  // luminaire annulaire au plafond, baies d'écrans de surveillance inclinées (flux sépia,
  // écrans cyan, terminal bleu) avec liserés lumineux, pupitres à voyants, bureau en arc et
  // fauteuils, garde-corps tubulaires, plateforme d'entrée, porte arrondie et hublot
  // lumineux, ligne peinte au sol, câbles au plafond et au sol.
  function buildControl() {
    var PI = Math.PI, R = 7.5, H = 4.2, NW = 32, dW = TAU / NW;
    var far = -PI / 2;                                   // le mur d'écrans fait face à l'entrée
    var NCL = 5;
    function clA(n) { return far + (n - 2) * 0.45; }
    var aD = 17.5 * dW;                                  // porte : centre d'un pan de mur (décors devant la corde)
    var q, s, i, j;

    var lights = [];
    // Ambiance oppressante mais lisible, comme sur les concepts : la salle est sombre, les écrans
    // éclairent leurs abords et lèchent le béton du mur derrière eux, le luminaire du plafond
    // donne une lueur bleue qui laisse deviner les murs, les câbles et le plafond.
    for (j = 0; j < 8; j++) lights.push({ p: cyl(2.35, j * PI / 4, H - 0.15), c: [0.55, 0.7, 1.0], r: 7.5, i: 0.35 });
    for (i = 0; i < NCL; i++) {
      lights.push({ p: cyl(R - 1.3, clA(i), 2.0), c: [0.5, 0.75, 0.98], r: 3.4, i: 1.2 });
      lights.push({ p: cyl(R - 1.1, clA(i), 1.2), c: [0.45, 0.7, 0.95], r: 2.2, i: 0.8 });
      lights.push({ p: cyl(R - 0.75, clA(i), 3.4), c: [0.45, 0.66, 0.95], r: 3.6, i: 0.75 });   // halo sur le mur au-dessus des écrans
    }
    lights.push({ p: cyl(R - 0.9, aD, 2.8), c: [1.0, 0.92, 0.8], r: 3.5, i: 0.55 });
    [-0.62, -0.22, 0.22, 0.62].forEach(function (da) { lights.push({ p: cyl(3.55, far + da, 1.05), c: [0.45, 0.75, 1.0], r: 1.8, i: 0.7 }); });
    var m = new Mesh(lights, [0.03, 0.04, 0.06]);

    var conc = hexc('#7d8084'), concD = hexc('#5c5f63'), floorC = hexc('#5f6165'), ceilC = hexc('#4e5155');
    var steel = hexc('#8a939c'), dark = hexc('#1f2226'), bezel = hexc('#16181b'), rack = hexc('#2a2e33');
    var deskC = hexc('#2c3035'), panelC = hexc('#1d2024'), chairC = hexc('#18191b'), chrome = hexc('#9aa3ab');
    var cableC = hexc('#0e0f10'), lineC = hexc('#b8782c'), platC = hexc('#4b4f55');
    var led = [0.35, 0.8, 1.0];
    var PAL = {
      warm: { t: [0.8, 0.66, 0.48], b: [0.34, 0.26, 0.18], k: [0.2, 0.15, 0.1], hi: [0.95, 0.85, 0.65] },
      cyan: { t: [0.5, 0.88, 0.96], b: [0.12, 0.38, 0.5], k: [0.06, 0.2, 0.28], hi: [0.8, 0.98, 1.0] },
      term: { t: [0.22, 0.38, 0.9], b: [0.12, 0.2, 0.6], k: [0.1, 0.16, 0.45], hi: [0.7, 0.8, 1.0] }
    };

    // ---- outils : repère local d'un panneau (u le long du mur, v vers le haut, n vers la salle) ----
    function frameAt(r, a, du, yc, tilt, yaw) {
      var n0 = [-Math.cos(a), 0, -Math.sin(a)], t0 = [-Math.sin(a), 0, Math.cos(a)];
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var n1 = [n0[0] * cy + t0[0] * sy, 0, n0[2] * cy + t0[2] * sy];
      var u = [t0[0] * cy - n0[0] * sy, 0, t0[2] * cy - n0[2] * sy];
      var ct = Math.cos(tilt), st = Math.sin(tilt);
      var o = cyl(r, a, yc);
      return { o: [o[0] + t0[0] * du, yc, o[2] + t0[2] * du], u: u, v: [n1[0] * st, ct, n1[2] * st], n: [n1[0] * ct, -st, n1[2] * ct] };
    }
    function fpt(F, x, y, z) {
      return [F.o[0] + F.u[0] * x + F.v[0] * y + F.n[0] * z, F.o[1] + F.u[1] * x + F.v[1] * y + F.n[1] * z, F.o[2] + F.u[2] * x + F.v[2] * y + F.n[2] * z];
    }
    function fbox(F, x0, x1, y0, y1, z0, z1, col, fx) {
      m.hexa([fpt(F, x0, y0, z0), fpt(F, x1, y0, z0), fpt(F, x1, y0, z1), fpt(F, x0, y0, z1),
              fpt(F, x0, y1, z0), fpt(F, x1, y1, z0), fpt(F, x1, y1, z1), fpt(F, x0, y1, z1)], col, fx);
    }
    function fquad(F, x0, x1, y0, y1, z, col, fx) {
      m.quad(fpt(F, x0, y0, z), fpt(F, x1, y0, z), fpt(F, x1, y1, z), fpt(F, x0, y1, z), col, fx);
    }
    // rectangle aux coins cassés dans le plan du panneau
    function fshape(F, cx, cy2, w, h, ch, col, fx) {
      var x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy2 - h / 2, y1 = cy2 + h / 2;
      var pts = [[x0 + ch, y0], [x1 - ch, y0], [x1, y0 + ch], [x1, y1 - ch], [x1 - ch, y1], [x0 + ch, y1], [x0, y1 - ch], [x0, y0 + ch]]
        .map(function (p) { return fpt(F, p[0], p[1], 0); });
      for (var k2 = 1; k2 < 7; k2++) m.tri(pts[0], pts[k2], pts[k2 + 1], col, fx);
    }
    function block(r0, r1, a0, a1, ya, yb, col, fx) {
      m.hexa([cyl(r0, a0, ya), cyl(r1, a0, ya), cyl(r1, a1, ya), cyl(r0, a1, ya),
              cyl(r0, a0, yb), cyl(r1, a0, yb), cyl(r1, a1, yb), cyl(r0, a1, yb)], col, fx);
    }
    function sag(p0, p1, drop, w, col) {
      var prev = p0;
      for (var k2 = 1; k2 <= 5; k2++) {
        var t = k2 / 5, p = mix(p0, p1, t);
        p[1] -= drop * 4 * t * (1 - t);
        m.beam(prev, p, w, col, 0);
        prev = p;
      }
    }
    function rail(p0, p1, r) { m.tube(p0, p1, r, 6, steel, 0, 1); }
    // écran : boîtier, dalle lumineuse, liseré LED, contenu sans recouvrement (aucun scintillement)
    function screen(F, w, h, kind, seed) {
      var Pl = PAL[kind], k2;
      fbox(F, -w / 2 - 0.05, w / 2 + 0.05, -h / 2 - 0.06, h / 2 + 0.05, -0.08, 0, bezel, 0);
      m.layer = 1;
      fquad(F, -w / 2, w / 2, -h / 2, h / 2, 0.004, [Pl.b, Pl.b, Pl.t, Pl.t], seed);
      fquad(F, -w / 2 + 0.04, w / 2 - 0.04, -h / 2 - 0.05, -h / 2 - 0.03, 0.004, led, -1);
      m.layer = 2;
      if (kind === 'term') {
        for (k2 = 0; k2 < 6; k2++) {
          var lw = (0.35 + 0.55 * hash(seed + k2)) * (w - 0.12), ly = h / 2 - 0.07 - k2 * (h - 0.12) / 6;
          fquad(F, -w / 2 + 0.06, -w / 2 + 0.06 + lw, ly - 0.02, ly, 0.008, Pl.hi, seed);
        }
      } else {
        for (k2 = 0; k2 < 3; k2++) {
          var cx0 = -w / 2 + k2 * w / 3, bw = (w / 3) * (0.45 + 0.4 * hash(seed * 7 + k2));
          var bx0 = cx0 + 0.02 + (w / 3 - 0.04 - bw) * hash(seed * 11 + k2);
          var by0 = -h / 2 + 0.07 + 0.2 * h * hash(seed * 13 + k2), bh = (h / 2 - 0.03 - by0) * (0.45 + 0.5 * hash(seed * 17 + k2));
          fquad(F, bx0, bx0 + bw, by0, by0 + bh, 0.008, k2 === 1 ? Pl.hi : Pl.k, seed);
        }
        fquad(F, -w / 2 + 0.02, w / 2 - 0.02, -h / 2 + 0.012, -h / 2 + 0.05, 0.008, kind === 'warm' ? [0.35, 0.75, 0.95] : Pl.hi, seed);
      }
      m.layer = 0;
    }
    function kindOf(seed) { var h = hash(seed); return h < 0.55 ? 'warm' : (h < 0.9 ? 'cyan' : 'term'); }

    // ---- murs, sol, plafond, luminaire annulaire ----
    var RRf = [0, 1.5, 3, 4.5, 6, R], RRc = [2.6, 4.2, 5.8, R];
    for (s = 0; s < NW; s++) {
      var a0 = s * dW, a1 = a0 + dW;
      for (q = 0; q < RRf.length - 1; q++) m.quad(cyl(RRf[q], a0, 0), cyl(RRf[q + 1], a0, 0), cyl(RRf[q + 1], a1, 0), cyl(RRf[q], a1, 0), tint(floorC, s * 5 + q, 0.05), 0);
      for (q = 0; q < 4; q++) m.quad(cyl(R, a0, q * H / 4), cyl(R, a1, q * H / 4), cyl(R, a1, (q + 1) * H / 4), cyl(R, a0, (q + 1) * H / 4), tint(q === 0 ? concD : conc, s * 7 + q, 0.06), 0);
      for (q = 0; q < RRc.length - 1; q++) m.quad(cyl(RRc[q], a0, H), cyl(RRc[q + 1], a0, H), cyl(RRc[q + 1], a1, H), cyl(RRc[q], a1, H), tint(ceilC, s * 3 + q, 0.05), 0);
      m.quad(cyl(2.6, a0, H), cyl(2.6, a1, H), cyl(2.6, a1, H + 0.35), cyl(2.6, a0, H + 0.35), concD, 0);
      m.quad(cyl(1.55, a0, H + 0.35), cyl(2.6, a0, H + 0.35), cyl(2.6, a1, H + 0.35), cyl(1.55, a1, H + 0.35), ceilC, 0);
      m.quad(cyl(1.55, a0, H + 0.1), cyl(1.55, a1, H + 0.1), cyl(1.55, a1, H + 0.35), cyl(1.55, a0, H + 0.35), dark, 0);
      m.quad(cyl(0, a0, H + 0.1), cyl(1.55, a0, H + 0.1), cyl(1.55, a1, H + 0.1), cyl(0, a1, H + 0.1), hexc('#2a2d31'), 0);
      m.layer = 1;
      m.quad(cyl(2.2, a0, H + 0.345), cyl(2.5, a0, H + 0.345), cyl(2.5, a1, H + 0.345), cyl(2.2, a1, H + 0.345), [0.48, 0.58, 0.78], -1);
      m.quad(cyl(1.32, a0, H + 0.095), cyl(1.52, a0, H + 0.095), cyl(1.52, a1, H + 0.095), cyl(1.32, a1, H + 0.095), [0.36, 0.45, 0.62], -1);
      m.quad(cyl(4.96, a0, 0.003), cyl(5.04, a0, 0.003), cyl(5.04, a1, 0.003), cyl(4.96, a1, 0.003), lineC, 0);
      m.layer = 0;
    }

    // ---- baies d'écrans avec leur pupitre, câbles au plafond et au sol ----
    for (i = 0; i < NCL; i++) {
      var a = clA(i), off = 0.4, sd = i * 37 + 3;
      var Fr = frameAt(R - 0.3, a, 0, 0, 0, 0);
      fbox(Fr, -1.62, -1.54, -0.02, 3.3, -0.06, 0.02, rack, 0);
      fbox(Fr, 1.54, 1.62, -0.02, 3.3, -0.06, 0.02, rack, 0);
      fbox(Fr, -1.54, 1.54, 1.48, 1.54, -0.06, 0, rack, 0);
      fbox(Fr, -1.54, 1.54, 2.47, 2.53, -0.06, 0, rack, 0);
      // pupitre et plan incliné à voyants
      fbox(Fr, -1.1, 1.1, -0.02, 0.92, 0.08, 0.78, deskC, 0);
      m.hexa([fpt(Fr, -1.1, 0.9, 0.33), fpt(Fr, 1.1, 0.9, 0.33), fpt(Fr, 1.1, 0.9, 0.78), fpt(Fr, -1.1, 0.9, 0.78),
              fpt(Fr, -1.1, 1.12, 0.33), fpt(Fr, 1.1, 1.12, 0.33), fpt(Fr, 1.1, 0.935, 0.78), fpt(Fr, -1.1, 0.935, 0.78)], panelC, 0);
      var SP = function (x, sv) { return fpt(Fr, x, 1.12 - 0.185 * sv, 0.33 + 0.45 * sv); };
      m.layer = 1;
      for (var row = 0; row < 2; row++) {
        for (var b = 0; b < 12; b++) {
          var bx = -0.95 + b * 0.16, s0 = 0.25 + row * 0.3, hb = hash(sd + row * 13 + b);
          var bc = hb < 0.6 ? [0.3, 0.85, 0.95] : (hb < 0.8 ? [0.95, 0.7, 0.3] : (hb < 0.9 ? [0.9, 0.3, 0.25] : [0.15, 0.2, 0.22]));
          m.quad(SP(bx, s0), SP(bx + 0.08, s0), SP(bx + 0.08, s0 + 0.12), SP(bx, s0 + 0.12), bc, sd + b + row * 20);
        }
      }
      m.layer = 0;
      // écrans : un grand, deux latéraux tournés vers lui, trois en haut penchés, deux petits au pupitre
      screen(frameAt(R - off, a, 0, 2.05, 0.12, 0), 1.3, 0.8, kindOf(sd + 0.1), sd + 1);
      screen(frameAt(R - off, a, -1.15, 2.05, 0.1, 0.3), 0.75, 0.5, kindOf(sd + 0.2), sd + 2);
      screen(frameAt(R - off, a, 1.15, 2.05, 0.1, -0.3), 0.75, 0.5, kindOf(sd + 0.3), sd + 3);
      for (q = 0; q < 3; q++) screen(frameAt(R - off, a, (q - 1) * 0.8, 2.86, 0.38, (1 - q) * 0.12), 0.66, 0.42, kindOf(sd + 0.4 + q), sd + 4 + q);
      screen(frameAt(R - off - 0.05, a, -0.38, 1.36, -0.15, 0.08), 0.44, 0.28, kindOf(sd + 0.8), sd + 8);
      screen(frameAt(R - off - 0.05, a, 0.38, 1.36, -0.15, -0.08), 0.44, 0.28, kindOf(sd + 0.9), sd + 9);
      // câbles : en boucles sous le plafond, du haut de la baie au plafond, et au sol jusqu'au bureau
      for (q = -1; q <= 1; q += 2) sag(cyl(R - 0.45, a + q * 0.12, H - 0.04), cyl(2.75, a + q * 0.3, H - 0.04), 0.7 + 0.4 * hash(sd + q), 0.04, cableC);
      sag(cyl(R - 0.1, a - 0.27, 3.95), cyl(R - 0.1, a + 0.2, 3.7), 0.45 + 0.3 * hash(sd + 5), 0.035, cableC);
      sag(cyl(R - 0.12, a - 0.1, 4.05), cyl(R - 0.12, a + 0.3, 4.0), 0.25 + 0.25 * hash(sd + 6), 0.03, cableC);
      m.beam(fpt(Fr, -1.3, 3.3, -0.02), cyl(R - 0.25, a - 0.15, H), 0.035, cableC, 0);
      m.beam(fpt(Fr, 1.3, 3.3, -0.02), cyl(R - 0.25, a + 0.15, H), 0.035, cableC, 0);
      var c0 = cyl(4.15, a + 0.05, 0.025), c1 = cyl(R - 1.25, a - 0.02, 0.025), prev = c0;
      for (q = 1; q <= 4; q++) {
        var p = q === 4 ? c1 : mix(c0, c1, q / 4), wv = (hash(sd + q * 3) - 0.5) * 0.5;
        if (q < 4) { p[0] += -Math.sin(a) * wv; p[2] += Math.cos(a) * wv; }
        m.beam(prev, p, 0.045, cableC, 0);
        prev = p;
      }
    }

    // ---- bureau en arc, écrans de bureau, claviers, fauteuils, garde-corps ----
    var D0 = far - 0.9, ND = 14, dD = 1.8 / ND;
    for (q = 0; q < ND; q++) {
      var e0 = D0 + q * dD, e1 = e0 + dD;
      block(3.4, 4.1, e0, e1, 0.72, 0.77, deskC, 0);
      block(4.02, 4.1, e0, e1, -0.02, 0.72, panelC, 0);
    }
    [-0.62, -0.22, 0.22, 0.62].forEach(function (da, k2) {
      var am = far + da;
      m.beam(cyl(3.97, am, 0.77), cyl(3.97, am, 0.86), 0.05, dark, 0);
      screen(frameAt(3.92, am, 0, 1.05, -0.06, 0), 0.55, 0.32, kindOf(200 + k2), 200 + k2);
      block(3.5, 3.64, am - 0.07, am + 0.07, 0.77, 0.795, dark, 0);
    });
    function chair(ac) {
      var c = cyl(2.85, ac, 0), ro = [Math.cos(ac), 0, Math.sin(ac)], tg = [-Math.sin(ac), 0, Math.cos(ac)];
      var Lp = function (dr, dt, yy) { return [c[0] + ro[0] * dr + tg[0] * dt, yy, c[2] + ro[2] * dr + tg[2] * dt]; };
      m.hexa([Lp(-0.24, -0.24, 0.44), Lp(0.24, -0.24, 0.44), Lp(0.24, 0.24, 0.44), Lp(-0.24, 0.24, 0.44),
              Lp(-0.24, -0.24, 0.52), Lp(0.24, -0.24, 0.52), Lp(0.24, 0.24, 0.52), Lp(-0.24, 0.24, 0.52)], chairC, 0);
      m.hexa([Lp(-0.3, -0.23, 0.56), Lp(-0.25, -0.23, 0.56), Lp(-0.25, 0.23, 0.56), Lp(-0.3, 0.23, 0.56),
              Lp(-0.34, -0.23, 1.1), Lp(-0.29, -0.23, 1.1), Lp(-0.29, 0.23, 1.1), Lp(-0.34, 0.23, 1.1)], chairC, 0);
      m.beam(Lp(-0.24, 0, 0.5), Lp(-0.28, 0, 0.62), 0.04, chrome, 0);
      m.beam(Lp(0, 0, 0.1), Lp(0, 0, 0.44), 0.05, chrome, 0);
      for (var k2 = 0; k2 < 5; k2++) {
        var aa = k2 / 5 * TAU;
        m.beam(Lp(0, 0, 0.08), Lp(Math.cos(aa) * 0.3, Math.sin(aa) * 0.3, 0.05), 0.035, chrome, 0);
      }
    }
    for (q = 0; q < 6; q++) chair(far + (q - 2.5) * 0.3);
    var RA0 = far - 0.8, NR = 8, dR = 1.6 / NR;
    for (q = 0; q <= NR; q++) rail(cyl(2.15, RA0 + q * dR, 0), cyl(2.15, RA0 + q * dR, 1.0), 0.028);
    for (q = 0; q < NR; q++) {
      rail(cyl(2.15, RA0 + q * dR, 1.0), cyl(2.15, RA0 + (q + 1) * dR, 1.0), 0.03);
      rail(cyl(2.15, RA0 + q * dR, 0.5), cyl(2.15, RA0 + (q + 1) * dR, 0.5), 0.022);
    }

    // ---- plateforme d'entrée, marches, garde-corps raccordés ----
    m.box(-1.7, -0.02, 4.0, 1.7, 0.45, 7.25, platC, 0);
    m.box(-0.62, -0.02, 3.7, 0.62, 0.3, 4.0, platC, 0);
    m.box(-0.62, -0.02, 3.4, 0.62, 0.15, 3.7, platC, 0);
    m.layer = 1;
    m.quad([-1.7, 0.452, 4.0], [1.7, 0.452, 4.0], [1.7, 0.452, 4.08], [-1.7, 0.452, 4.08], lineC, 0);
    m.layer = 0;
    var Y0 = 0.45;
    [-1.65, 1.65].forEach(function (x) {
      [7.1, 6.1, 5.1, 4.05].forEach(function (z) { rail([x, Y0, z], [x, Y0 + 1.0, z], 0.028); });
      rail([x, Y0 + 1.0, 7.1], [x, Y0 + 1.0, 4.05], 0.03);
      rail([x, Y0 + 0.5, 7.1], [x, Y0 + 0.5, 4.05], 0.022);
      var xs = x < 0 ? -0.62 : 0.62;
      rail([xs, Y0, 4.05], [xs, Y0 + 1.0, 4.05], 0.028);
      rail([x, Y0 + 1.0, 4.05], [xs, Y0 + 1.0, 4.05], 0.03);
      rail([x, Y0 + 0.5, 4.05], [xs, Y0 + 0.5, 4.05], 0.022);
      rail([xs, 0, 3.45], [xs, 1.0, 3.45], 0.028);
      rail([xs, Y0 + 1.0, 4.05], [xs, 1.0, 3.45], 0.03);
      rail([xs, Y0 + 0.5, 4.05], [xs, 0.5, 3.45], 0.022);
    });

    // ---- porte arrondie (grille en bas) et hublot lumineux, faisceau de câbles le long du mur ----
    var Fd = frameAt(R * Math.cos(dW / 2) - 0.02, aD, 0, 0, 0, 0);
    m.layer = 1;
    fshape(Fd, 0, 1.19, 1.35, 2.38, 0.3, dark, 0);
    fshape(Fd, -0.45, 2.95, 0.5, 0.5, 0.16, dark, 0);
    m.layer = 2;
    fshape(Fd, 0, 1.48, 1.15, 1.6, 0.26, hexc('#3a3f44'), 0);
    for (q = 0; q < 7; q++) fquad(Fd, -0.575, 0.575, 0.1 + q * 0.08, 0.18 + q * 0.08, 0, q % 2 ? hexc('#565d64') : hexc('#16181b'), 0);
    fshape(Fd, -0.45, 2.95, 0.36, 0.36, 0.11, [0.8, 0.76, 0.66], -1);
    m.layer = 0;
    for (q = 0; q < 3; q++) {
      var ca = 3.56 + q * 0.012, pv = cyl(R - 0.08, ca, H);
      for (var t2 = 1; t2 <= 4; t2++) {
        var pc = cyl(R - 0.08 - 0.05 * hash(q * 9 + t2), ca + (hash(q * 5 + t2) - 0.5) * 0.02, H * (1 - t2 / 4));
        m.beam(pv, pc, 0.03, cableC, 0);
        pv = pc;
      }
    }

    return {
      mesh: m, fog: [0.012, 0.017, 0.028], fogRange: [5, 22], emFog: 0.3, fov: 46, flick: 0.12,
      cam: function (ph) {
        // depuis le centre de la salle, derrière les fauteuils : les baies d'écrans remplissent la
        // moitié gauche de l'image (la droite est couverte par le panneau des paramètres) ;
        // les fauteuils, le garde-corps et le bureau ne sont plus que des silhouettes à contre-jour.
        return {
          eye: [-0.6 + Math.sin(ph * 0.07) * 0.25, 1.75 + Math.sin(ph * 0.9) * 0.006, 1.2 + Math.sin(ph * 0.05) * 0.3],
          target: [0.95 + Math.sin(ph * 0.08) * 0.9, 1.85, -6.9], up: [0, 1, 0], fov: 46
        };
      }
    };
  }

  // ---------- scène 3 : la cafétéria et son écran sur l'extérieur ----------
  // D'après la série : grande salle sombre et brumeuse, plafond à caissons avec la rosace de
  // pétales lumineux autour d'un disque, néons rectangulaires en périphérie, immense écran
  // panoramique aux bouts arrondis dans un cadre épais (ciel brumeux, colline, arbre mort),
  // appliques et pilastres sombres, tables gris-bleu et chaises en bois à pieds fins, vue depuis
  // la grande porte arrondie qui donne sur la salle.
  function buildCafeteria() {
    var PI = Math.PI;
    var X0 = -12, X1 = 12, Z0 = -14, Z1 = 8, H = 4.2;
    var CZ = -3;                                        // centre de la rosace
    var DX = 2.4, DY = 1.77, DW = 2.5, DH = 1.75, DR = 1.2;   // porte : centre, demi-largeur, demi-hauteur, rayon des coins
    var BX0 = -1.1, BX1 = 5.9;                          // emprise du cadre de porte dans le mur du fond de salle
    var SCY = 2.05, SR = 1.3, SL = 6.2, SZ = -13.97;    // écran : centre vertical, rayon des bouts, demi-longueur droite, plan
    var i, j, q, x, z;

    var warm = [1.0, 0.86, 0.65], sconceC = [1.0, 0.78, 0.5], cool = [0.62, 0.68, 0.68], neonC = [0.85, 0.88, 0.85];
    var lights = [];
    for (j = 0; j < 8; j++) lights.push({ p: [Math.cos(j * PI / 4) * 3.2, 3.9, CZ + Math.sin(j * PI / 4) * 3.2], c: warm, r: 9, i: 0.75 });
    [-5, 0, 5].forEach(function (lx) { lights.push({ p: [lx, 2.0, -12.4], c: cool, r: 9, i: 0.9 }); });
    var sconces = [[-9.2, -13.75], [9.2, -13.75]];
    for (z = -11; z <= 5; z += 4) { sconces.push([-11.7, z]); sconces.push([11.7, z]); }
    sconces.forEach(function (sc2) { lights.push({ p: [sc2[0] * 0.96, 2.6, sc2[1] + (sc2[1] < -13 ? 0.5 : 0)], c: sconceC, r: 3.5, i: 0.7 }); });
    var neons = [[-9, -11], [9, -11], [-9, -2], [9, -2], [-9, 5], [9, 5]];
    neons.forEach(function (n2) { lights.push({ p: [n2[0], 3.9, n2[1]], c: neonC, r: 6, i: 0.4 }); });
    var m = new Mesh(lights, [0.06, 0.055, 0.05]);

    var floorC = hexc('#7d7468'), wallC = hexc('#4d443a'), pilC = hexc('#3a332b'), ceilC = hexc('#5a5146'), beamC = hexc('#3f382f');
    var frameC = hexc('#5c554b'), tableC = hexc('#5e676d'), woodC = hexc('#9a7650'), metal = hexc('#262628'), corrC = hexc('#3a352f');

    // ---- outils ----
    function quadXY(x0, y0, x1, y1, zz, col, fx) { m.quad([x0, y0, zz], [x1, y0, zz], [x1, y1, zz], [x0, y1, zz], col, fx); }
    function wallGridZ(xa, xb, zz, col) {              // mur plan en z, découpé pour l'éclairage par sommet
      var nx = Math.max(1, Math.round((xb - xa) / 1.5));
      for (var a2 = 0; a2 < nx; a2++) for (var b2 = 0; b2 < 4; b2++) {
        var xa2 = xa + (xb - xa) * a2 / nx, xb2 = xa + (xb - xa) * (a2 + 1) / nx;
        quadXY(xa2, b2 * H / 4, xb2, (b2 + 1) * H / 4, zz, tint(col, a2 * 7 + b2 + zz, 0.06), 0);
      }
    }
    function wallGridX(xx, za, zb, col) {
      var nz = Math.max(1, Math.round((zb - za) / 1.5));
      for (var a2 = 0; a2 < nz; a2++) for (var b2 = 0; b2 < 4; b2++) {
        var za2 = za + (zb - za) * a2 / nz, zb2 = za + (zb - za) * (a2 + 1) / nz;
        m.quad([xx, b2 * H / 4, za2], [xx, b2 * H / 4, zb2], [xx, (b2 + 1) * H / 4, zb2], [xx, (b2 + 1) * H / 4, za2], tint(col, a2 * 5 + b2 + xx, 0.06), 0);
      }
    }
    // boîte orientée (lacet autour de la verticale), pour tables et chaises un peu de travers
    function obox(cx, cz, yaw, x0, x1, y0, y1, z0, z1, col) {
      var c = Math.cos(yaw), sn = Math.sin(yaw);
      var P = function (lx, ly, lz) { return [cx + lx * c - lz * sn, ly, cz + lx * sn + lz * c]; };
      m.hexa([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], col, 0);
      return P;
    }
    // anneau entre un contour intérieur et un contour extérieur appariés point à point
    function ring(inner, outer, zz, col, fx) {
      for (var a2 = 0; a2 < inner.length - 1; a2++) {
        m.quad([inner[a2][0], inner[a2][1], zz], [outer[a2][0], outer[a2][1], zz], [outer[a2 + 1][0], outer[a2 + 1][1], zz], [inner[a2 + 1][0], inner[a2 + 1][1], zz], col, fx);
      }
    }
    function lip(pts, za, zb, col) {
      for (var a2 = 0; a2 < pts.length - 1; a2++) {
        m.quad([pts[a2][0], pts[a2][1], za], [pts[a2 + 1][0], pts[a2 + 1][1], za], [pts[a2 + 1][0], pts[a2 + 1][1], zb], [pts[a2][0], pts[a2][1], zb], col, 0);
      }
    }
    // contour d'un stade (écran) : bouts en demi-cercles de rayon rr, partie droite de demi-longueur SL
    function stadium(rr) {
      var pts = [], a2, k2;
      for (k2 = 0; k2 <= 12; k2++) { a2 = -PI / 2 + k2 * PI / 12; pts.push([SL + Math.cos(a2) * rr, SCY + Math.sin(a2) * rr]); }
      for (k2 = 1; k2 < 8; k2++) pts.push([SL - 2 * SL * k2 / 8, SCY + rr]);
      for (k2 = 0; k2 <= 12; k2++) { a2 = PI / 2 + k2 * PI / 12; pts.push([-SL + Math.cos(a2) * rr, SCY + Math.sin(a2) * rr]); }
      for (k2 = 1; k2 <= 8; k2++) pts.push([-SL + 2 * SL * k2 / 8, SCY - rr]);
      return pts;
    }
    // contour arrondi de la porte, et son pendant sur le rectangle du cadre (coins → angles du cadre)
    function doorOutlines() {
      var inner = [], outer = [], k2, a2;
      var cxr = DX + DW - DR, cxl = DX - DW + DR, cyt = DY + DH - DR, cyb = DY - DH + DR;
      var push = function (p, o) { inner.push(p); outer.push(o); };
      for (k2 = 0; k2 <= 6; k2++) { a2 = -PI / 2 + k2 * PI / 12; push([cxr + Math.cos(a2) * DR, cyb + Math.sin(a2) * DR], [BX1, 0]); }
      for (k2 = 1; k2 < 4; k2++) { var yr = cyb + (cyt - cyb) * k2 / 4; push([DX + DW, yr], [BX1, yr]); }
      for (k2 = 0; k2 <= 6; k2++) { a2 = k2 * PI / 12; push([cxr + Math.cos(a2) * DR, cyt + Math.sin(a2) * DR], [BX1, H]); }
      for (k2 = 1; k2 < 6; k2++) { var xt = cxr - (cxr - cxl) * k2 / 6; push([xt, DY + DH], [xt, H]); }
      for (k2 = 0; k2 <= 6; k2++) { a2 = PI / 2 + k2 * PI / 12; push([cxl + Math.cos(a2) * DR, cyt + Math.sin(a2) * DR], [BX0, H]); }
      for (k2 = 1; k2 < 4; k2++) { var yl = cyt - (cyt - cyb) * k2 / 4; push([DX - DW, yl], [BX0, yl]); }
      for (k2 = 0; k2 <= 6; k2++) { a2 = PI + k2 * PI / 12; push([cxl + Math.cos(a2) * DR, cyb + Math.sin(a2) * DR], [BX0, 0]); }
      for (k2 = 1; k2 <= 6; k2++) { var xb = cxl + (cxr - cxl) * k2 / 6; push([xb, DY - DH], [xb, 0]); }
      inner.push(inner[0]); outer.push(outer[0]);
      return { inner: inner, outer: outer };
    }

    // ---- sol, murs, pilastres ----
    for (x = X0; x < X1; x += 2) for (z = Z0; z < Z1; z += 2) {
      m.quad([x, 0, z], [x + 2, 0, z], [x + 2, 0, z + 2], [x, 0, z + 2], tint(floorC, x * 3 + z * 7, 0.05), 0);
    }
    wallGridZ(X0, X1, Z0, wallC);
    wallGridX(X0, Z0, Z1, wallC);
    wallGridX(X1, Z0, Z1, wallC);
    wallGridZ(X0, BX0, Z1, wallC);
    wallGridZ(BX1, X1, Z1, wallC);
    for (z = -12.5; z <= 6.5; z += 2) {
      m.box(X0, -0.02, z - 0.3, X0 + 0.25, H - 0.01, z + 0.3, pilC, 0);
      m.box(X1 - 0.25, -0.02, z - 0.3, X1, H - 0.01, z + 0.3, pilC, 0);
    }
    [-11, -9.9, 9.9, 11].forEach(function (px) { m.box(px - 0.3, -0.02, Z0, px + 0.3, H - 0.01, Z0 + 0.25, pilC, 0); });
    // appliques en sablier, chaudes
    sconces.forEach(function (sc2) {
      var sx = sc2[0], sz = sc2[1], onFar = sz < -13;
      var cx2 = onFar ? sx : (sx < 0 ? X0 + 0.32 : X1 - 0.32), cz2 = onFar ? Z0 + 0.32 : sz;
      m.box(cx2 - 0.14, 2.42, cz2 - 0.14, cx2 + 0.14, 2.5, cz2 + 0.14, metal, 0);
      m.box(cx2 - 0.1, 2.5, cz2 - 0.1, cx2 + 0.1, 2.72, cz2 + 0.1, [1.0, 0.8, 0.55], -1);
      m.box(cx2 - 0.14, 2.72, cz2 - 0.14, cx2 + 0.14, 2.8, cz2 + 0.14, metal, 0);
    });

    // ---- plafond à caissons et rosace de pétales lumineux ----
    var RRc = [5.5, 6.2, 7.5, 9.5, 12, 15, 18], NSg = 48, dS = TAU / NSg;
    for (j = 0; j < NSg; j++) {
      var a0 = j * dS, a1 = a0 + dS;
      var C = function (r, a2, yy) { return [Math.cos(a2) * r, yy, CZ + Math.sin(a2) * r]; };
      for (q = 0; q < RRc.length - 1; q++) m.quad(C(RRc[q], a0, H), C(RRc[q + 1], a0, H), C(RRc[q + 1], a1, H), C(RRc[q], a1, H), tint(ceilC, j * 3 + q, 0.05), 0);
      m.quad(C(5.5, a0, H), C(5.5, a1, H), C(5.5, a1, H + 0.35), C(5.5, a0, H + 0.35), beamC, 0);
      m.quad(C(1.45, a0, H + 0.35), C(5.5, a0, H + 0.35), C(5.5, a1, H + 0.35), C(1.45, a1, H + 0.35), tint(ceilC, j, 0.04), 0);
      m.quad(C(1.45, a0, H + 0.2), C(1.45, a1, H + 0.2), C(1.45, a1, H + 0.35), C(1.45, a0, H + 0.35), beamC, 0);
      m.quad(C(1.2, a0, H + 0.2), C(1.45, a0, H + 0.2), C(1.45, a1, H + 0.2), C(1.2, a1, H + 0.2), beamC, 0);
      [6.2, 7.5].forEach(function (rb) {
        m.hexa([C(rb - 0.13, a0, H - 0.14), C(rb + 0.13, a0, H - 0.14), C(rb + 0.13, a1, H - 0.14), C(rb - 0.13, a1, H - 0.14),
                C(rb - 0.13, a0, H - 0.01), C(rb + 0.13, a0, H - 0.01), C(rb + 0.13, a1, H - 0.01), C(rb - 0.13, a1, H - 0.01)], beamC, 0);
      });
      m.layer = 1;
      m.quad(C(0, a0, H + 0.195), C(1.2, a0, H + 0.195), C(1.2, a1, H + 0.195), C(0, a1, H + 0.195), [0.86, 0.8, 0.66], -1);
      m.layer = 0;
    }
    for (j = 0; j < 8; j++) {   // nervures rayonnantes du caisson
      var ab = j * PI / 4 + PI / 8, ca = Math.cos(ab), sa2 = Math.sin(ab);
      m.beam([ca * 7.6, H - 0.08, CZ + sa2 * 7.6], [ca * 14, H - 0.08, CZ + sa2 * 14], 0.24, beamC, 0);
    }
    m.layer = 1;
    for (j = 0; j < 16; j++) {   // pétales : fins au centre, larges au milieu, effilés au bord
      var ap = j * PI / 8, ux = Math.cos(ap), uz = Math.sin(ap), tx2 = -uz, tz2 = ux;
      var PP = function (r, w) { return [ux * r + tx2 * w, H + 0.345, CZ + uz * r + tz2 * w]; };
      var pts = [PP(1.6, 0), PP(2.4, 0.2), PP(3.5, 0.3), PP(4.8, 0.07), PP(4.8, -0.07), PP(3.5, -0.3), PP(2.4, -0.2)];
      for (q = 1; q < pts.length - 1; q++) m.tri(pts[0], pts[q], pts[q + 1], [0.98, 0.9, 0.74], -1);
    }
    m.layer = 0;
    neons.forEach(function (n2) {
      m.box(n2[0] - 0.7, H - 0.1, n2[1] - 0.2, n2[0] + 0.7, H - 0.01, n2[1] + 0.2, beamC, 0);
      m.layer = 1;
      m.quad([n2[0] - 0.62, H - 0.105, n2[1] - 0.13], [n2[0] + 0.62, H - 0.105, n2[1] - 0.13], [n2[0] + 0.62, H - 0.105, n2[1] + 0.13], [n2[0] - 0.62, H - 0.105, n2[1] + 0.13], [0.92, 0.95, 0.9], -1);
      m.layer = 0;
    });

    // ---- l'écran panoramique : ciel brumeux, colline, arbre mort ----
    function outside(xx, v) {
      var ridge = 0.42 + 0.05 * Math.sin(xx * 0.55 + 1.3) + 0.025 * Math.sin(xx * 1.7 + 0.4);
      var n = hash(Math.floor(xx * 1.5) * 7 + Math.floor(v * 5) * 13) - 0.5;
      if (v > ridge) {
        var t = (v - ridge) / (1 - ridge);
        return mix([0.68, 0.68, 0.6], [0.48, 0.57, 0.58], t).map(function (c2) { return c2 + n * 0.05; });
      }
      return mix([0.3, 0.26, 0.2], [0.52, 0.45, 0.34], v / ridge).map(function (c2) { return c2 + n * 0.03; });
    }
    var xExt = function (yw) { var d = yw - SCY; return SL + Math.sqrt(Math.max(0, (SR + 0.04) * (SR + 0.04) - d * d)); };
    var ROWS = 14, COLS = 40, yA = SCY - SR - 0.03, yB = SCY + SR + 0.03;
    m.layer = 1;
    for (i = 0; i < ROWS; i++) {
      var y0 = yA + (yB - yA) * i / ROWS, y1 = yA + (yB - yA) * (i + 1) / ROWS, e0 = xExt(y0), e1 = xExt(y1);
      for (j = 0; j < COLS; j++) {
        var u0 = -1 + 2 * j / COLS, u1 = -1 + 2 * (j + 1) / COLS;
        var p00 = [u0 * e0, y0], p10 = [u1 * e0, y0], p11 = [u1 * e1, y1], p01 = [u0 * e1, y1];
        var col = function (p) { return outside(p[0], (p[1] - yA) / (yB - yA)); };
        m.quad([p00[0], p00[1], SZ], [p10[0], p10[1], SZ], [p11[0], p11[1], SZ], [p01[0], p01[1], SZ], [col(p00), col(p10), col(p11), col(p01)], 77);
      }
    }
    m.layer = 2;
    var ridgeY = yA + (yB - yA) * (0.42 + 0.05 * Math.sin(1.3) + 0.025 * Math.sin(0.4));
    var tree = [[0, -0.05, 0, 0.62, 0.07], [0, 0.35, -0.32, 0.6, 0.035], [0, 0.42, 0.28, 0.72, 0.035], [-0.2, 0.5, -0.42, 0.7, 0.02],
                [0.17, 0.6, 0.36, 0.85, 0.02], [0, 0.6, 0.06, 0.82, 0.025], [-0.32, 0.6, -0.48, 0.66, 0.015]];
    tree.forEach(function (b2) {
      var ax = b2[0], ay = ridgeY + b2[1], bxx = b2[2], byy = ridgeY + b2[3], w = b2[4];
      var dx = bxx - ax, dy = byy - ay, l = Math.sqrt(dx * dx + dy * dy), nx = -dy / l * w, ny = dx / l * w;
      m.quad([ax - nx, ay - ny, SZ], [ax + nx, ay + ny, SZ], [bxx + nx * 0.5, byy + ny * 0.5, SZ], [bxx - nx * 0.5, byy - ny * 0.5, SZ], [0.16, 0.14, 0.12], 77);
    });
    m.layer = 0;
    // cadre épais de l'écran
    var sIn = stadium(SR), sOut = stadium(SR + 0.38);
    ring(sIn, sOut, -13.8, frameC, 0);
    lip(sIn, SZ - 0.01, -13.8, tint(frameC, 3, 0.1));
    lip(sOut, -13.8, Z0, tint(frameC, 5, 0.1));

    // ---- grande porte arrondie sur la salle, et le couloir derrière ----
    var D = doorOutlines();
    ring(D.inner, D.outer, 7.6, frameC, 0);
    ring(D.inner, D.outer, 8.4, frameC, 0);
    lip(D.inner, 7.6, 8.4, tint(frameC, 9, 0.08));
    m.quad([BX0, 0, 7.6], [BX0, 0, Z1], [BX0, H, Z1], [BX0, H, 7.6], frameC, 0);
    m.quad([BX1, 0, 7.6], [BX1, 0, Z1], [BX1, H, Z1], [BX1, H, 7.6], frameC, 0);
    var cw0 = DX - DW - 0.05, cw1 = DX + DW + 0.05, cz0 = 8.4, cz1 = 11, ch = DY + DH + 0.03;
    m.quad([cw0, 0, cz0], [cw1, 0, cz0], [cw1, 0, cz1], [cw0, 0, cz1], corrC, 0);
    m.quad([cw0, ch, cz0], [cw1, ch, cz0], [cw1, ch, cz1], [cw0, ch, cz1], corrC, 0);
    m.quad([cw0, 0, cz0], [cw0, 0, cz1], [cw0, ch, cz1], [cw0, ch, cz0], corrC, 0);
    m.quad([cw1, 0, cz0], [cw1, 0, cz1], [cw1, ch, cz1], [cw1, ch, cz0], corrC, 0);
    m.quad([cw0, 0, cz1], [cw1, 0, cz1], [cw1, ch, cz1], [cw0, ch, cz1], corrC, 0);

    // ---- tables gris-bleu et chaises en bois, un peu de désordre ----
    function chair(cx, cz, yaw) {
      var P = obox(cx, cz, yaw, -0.21, 0.21, 0.43, 0.47, -0.21, 0.21, woodC);
      obox(cx, cz, yaw, -0.2, 0.2, 0.47, 0.49, 0.18, 0.21, woodC);
      m.hexa([P(-0.2, 0.49, 0.18), P(0.2, 0.49, 0.18), P(0.2, 0.49, 0.21), P(-0.2, 0.49, 0.21),
              P(-0.2, 0.9, 0.24), P(0.2, 0.9, 0.24), P(0.2, 0.9, 0.27), P(-0.2, 0.9, 0.27)], tint(woodC, cx * 3 + cz, 0.08), 0);
      [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]].forEach(function (l2) {
        m.beam(P(l2[0], 0.01, l2[1]), P(l2[0] * 1.08, 0.43, l2[1] * 1.04), 0.025, metal, 0);
      });
    }
    function table(cx, cz, yaw) {
      var P = obox(cx, cz, yaw, -0.8, 0.8, 0.74, 0.78, -0.45, 0.45, tableC);
      [[-0.7, -0.36], [0.7, -0.36], [-0.7, 0.36], [0.7, 0.36]].forEach(function (l2) { m.beam(P(l2[0], 0.01, l2[1]), P(l2[0], 0.74, l2[1]), 0.04, metal, 0); });
      obox(cx, cz, yaw, -0.09, 0.09, 0.78, 0.84, -0.05, 0.05, metal);
      obox(cx, cz, yaw, -0.07, -0.02, 0.84, 0.93, -0.03, 0.02, hexc('#b9b2a4'));
      obox(cx, cz, yaw, 0.02, 0.07, 0.84, 0.93, -0.03, 0.02, hexc('#8f877a'));
    }
    for (i = 0; i < 5; i++) {
      for (j = 0; j < 7; j++) {
        var tx = -9 + j * 3 + (hash(i * 7 + j) - 0.5) * 0.4, tz = -10.5 + i * 3.1 + (hash(i * 11 + j) - 0.5) * 0.3, ty = (hash(i * 5 + j * 3) - 0.5) * 0.12;
        table(tx, tz, ty);
        for (q = 0; q < 4; q++) {
          var side = q < 2 ? -1 : 1, along = q % 2 ? 0.4 : -0.4, hq = hash(i * 31 + j * 7 + q);
          var pull = 0.62 + hq * 0.25, yaw = ty + (side < 0 ? PI : 0) + (hq - 0.5) * 0.5;
          var c = Math.cos(ty), sn = Math.sin(ty);
          chair(tx + along * c - side * pull * sn, tz + along * sn + side * pull * c, yaw);
        }
      }
    }

    return {
      mesh: m, fog: [0.07, 0.066, 0.06], fogRange: [8, 32], emFog: 0.4, fov: 58, flick: 0.06,
      cam: function (ph) {
        // depuis le couloir, on passe lentement la grande porte arrondie et on revient ;
        // l'écran est cadré dans la moitié gauche de l'image (la droite porte le texte du bulletin)
        // Le regard est calculé pour garder le centre de l'écran ~24° à gauche de l'axe, où qu'on soit.
        var k = 0.5 + 0.5 * Math.sin(ph * 0.04);
        var ex = DX + Math.sin(ph * 0.05) * 0.35, ez = 4.6 + k * 4.4, dist = ez - Z0;
        var look = Math.atan(-ex / dist) + 0.42 + Math.sin(ph * 0.06) * 0.04;
        return {
          eye: [ex, 1.65 + Math.sin(ph * 0.8) * 0.008, ez],
          target: [ex + Math.tan(look) * dist, 2.0, Z0], up: [0, 1, 0], fov: 58
        };
      }
    };
  }

  var BUILDERS = { stairs: buildStairs, control: buildControl, cafeteria: buildCafeteria };

  // ---------- rendu ----------
  var VS = [
    'attribute vec3 aPos;',
    'attribute vec3 aCol;',
    'attribute float aFx;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform vec2 uSnap;',
    'uniform float uTime;',
    'uniform float uFlick;',
    'uniform float uLamp;',
    'varying vec4 vCol;',
    'varying float vDepth;',
    'varying vec3 vPos;',
    'varying float vTex;',
    'void main() {',
    '  vPos = aPos;',
    '  vTex = aFx == 0.0 ? 1.0 : 0.0;',
    '  vec4 v = uView * vec4(aPos, 1.0);',
    '  vDepth = -v.z;',
    '  vec4 p = uProj * v;',
    '  if (p.w > 0.0) { vec2 s = p.xy / p.w; s = floor(s * uSnap + 0.5) / uSnap; p.xy = s * p.w; }',
    '  float k = uLamp;',
    '  if (aFx > 0.0) {',
    '    float n = fract(sin(floor(uTime * 12.0) * 12.9898 + aFx * 78.233) * 43758.5453);',
    '    k = 1.0 - uFlick * n * n;',
    '  } else if (aFx < 0.0) {',
    '    k = 1.0;',
    '  }',
    '  vCol = vec4(aCol * k * p.w, p.w);',
    '  gl_Position = p;',
    '}'
  ].join('\n');

  // Béton procédural : taches, moucheture, coulures verticales et grain, en texels de ~4 cm
  // (position figée sur une grille = échantillonnage « au plus proche » façon PS1).
  // Le bruit est périodique en hauteur (uPer) pour que la boucle de l'escalier reste invisible.
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec4 vCol;',
    'varying float vDepth;',
    'varying vec3 vPos;',
    'varying float vTex;',
    'uniform vec3 uFog;',
    'uniform vec2 uFogRange;',
    'uniform float uPer;',
    'uniform float uGrain;',
    'uniform float uCold;',
    'uniform float uEmFog;',
    'float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }',
    'float vn(vec3 p, float n) {',
    '  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  float y0 = mod(i.y, n), y1 = mod(i.y + 1.0, n);',
    '  float a = mix(h3(vec3(i.x, y0, i.z)), h3(vec3(i.x + 1.0, y0, i.z)), f.x);',
    '  float b = mix(h3(vec3(i.x, y1, i.z)), h3(vec3(i.x + 1.0, y1, i.z)), f.x);',
    '  float c = mix(h3(vec3(i.x, y0, i.z + 1.0)), h3(vec3(i.x + 1.0, y0, i.z + 1.0)), f.x);',
    '  float d = mix(h3(vec3(i.x, y1, i.z + 1.0)), h3(vec3(i.x + 1.0, y1, i.z + 1.0)), f.x);',
    '  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);',
    '}',
    'float layer(vec3 w, float cxz, float cy) {',
    '  float n = floor(uPer / cy + 0.5);',
    '  return vn(vec3(w.x / cxz, w.y * n / uPer, w.z / cxz), n);',
    '}',
    'float beton(vec3 w, float depth) {',
    '  float nt = floor(uPer / 0.04 + 0.5), T = uPer / nt;',
    '  vec3 cell = floor(w / T);',
    '  vec3 q = (cell + 0.5) * T;',
    '  float tach = layer(q, 1.3, 1.2);',
    '  float mou = layer(q, 0.28, 0.28);',
    '  float cou = layer(q, 0.45, 2.4);',
    '  float gr = h3(vec3(cell.x, mod(cell.y, nt), cell.z));',
    '  float fade = 1.0 - smoothstep(5.0, 16.0, depth);',
    '  float t = 0.97 + 0.28 * (tach - 0.5) + 0.16 * (mou - 0.5) * (0.5 + 0.5 * fade) + 0.15 * (gr - 0.5) * fade;',
    '  t -= 0.13 * smoothstep(0.6, 0.85, cou);',
    '  return mix(1.0, t, uGrain);',
    '}',
    'float b2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }',
    'float b4(vec2 a) { return b2(0.5 * a) * 0.25 + b2(a); }',
    'void main() {',
    '  vec3 c = vCol.rgb / vCol.w;',
    '  if (vTex > 0.5) {',
    '    c *= beton(vPos, vDepth);',
    '    float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '    c = mix(c, vec3(l) * vec3(0.95, 1.0, 1.08), uCold);',
    '  }',
    '  float f = clamp((vDepth - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);',
    '  c = mix(c, uFog, f * (vTex > 0.5 ? 1.0 : uEmFog));',
    '  c += (b4(gl_FragCoord.xy) - 0.5) / 31.0;',
    '  c = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5) / 31.0;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  function shader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl) {
    var pr = gl.createProgram();
    gl.attachShader(pr, shader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, shader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    return pr;
  }
  function buffer(gl, data) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return b;
  }
  // les néons du silo grésillent de temps en temps
  function lampLevel(t) {
    var period = Math.floor(t / 6.5), local = t - period * 6.5;
    if (hash(period + 3.1) > 0.55 && local < 0.45) return 0.7 + 0.3 * hash(Math.floor(t * 24));
    return 1.0;
  }

  var NOOP = { setSpeed: function () {}, setMode: function () {}, setLook: function () {}, pause: function () {}, resume: function () {}, destroy: function () {} };

  function mount(canvas, opts) {
    opts = opts || {};
    try {
      var W = opts.width || 384, Hh = opts.height || 216;
      canvas.width = W; canvas.height = Hh;
      var gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: true, powerPreference: 'low-power' });
      if (!gl) return NOOP;
      var prog = program(gl);
      var sc = (BUILDERS[opts.scene] || buildStairs)();
      var LOCS = ['aPos', 'aCol', 'aFx'].map(function (n) { return gl.getAttribLocation(prog, n); });
      var passes = [];
      for (var li = 0; li < sc.mesh.L.length; li++) {
        var Ly = sc.mesh.L[li];
        if (Ly.p.length) passes.push({ layer: li, n: Ly.p.length / 3, b: [buffer(gl, Ly.p), buffer(gl, Ly.c), buffer(gl, Ly.f)] });
      }
      sc.mesh = null;
      gl.useProgram(prog);
      for (var i = 0; i < 3; i++) gl.enableVertexAttribArray(LOCS[i]);
      var U = {};
      ['uProj', 'uView', 'uSnap', 'uTime', 'uFlick', 'uLamp', 'uFog', 'uFogRange', 'uPer', 'uGrain', 'uCold', 'uEmFog'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
      gl.enable(gl.DEPTH_TEST);
      var curFov = sc.fov;
      gl.uniformMatrix4fv(U.uProj, false, perspective(curFov * Math.PI / 180, W / Hh, 0.15, 60));
      gl.uniform2f(U.uSnap, W / 2, Hh / 2);
      gl.uniform1f(U.uFlick, sc.flick);
      gl.uniform1f(U.uPer, sc.texPeriod || 952);
      gl.uniform1f(U.uEmFog, sc.emFog == null ? 1 : sc.emFog);
      gl.uniform1f(U.uGrain, opts.grain == null ? 1 : opts.grain);
      gl.uniform1f(U.uCold, opts.cold == null ? 0.35 : opts.cold);
      gl.uniform3f(U.uFog, sc.fog[0], sc.fog[1], sc.fog[2]);
      gl.clearColor(sc.fog[0], sc.fog[1], sc.fog[2], 1);

      var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      var speed = opts.speed == null ? 1 : opts.speed, target = speed, mode = opts.mode || 'walk';
      var phase = opts.phase || 0, time = 0, last = 0, acc = 0, raf = 0, alive = true, paused = false;

      var draw = function () {
        var cam = sc.cam(phase, mode), fr = cam.fog || sc.fogRange;
        if (cam.fov && cam.fov !== curFov) {
          curFov = cam.fov;
          gl.uniformMatrix4fv(U.uProj, false, perspective(curFov * Math.PI / 180, W / Hh, 0.15, 60));
        }
        gl.viewport(0, 0, W, Hh);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix4fv(U.uView, false, lookAt(cam.eye, cam.target, cam.up));
        gl.uniform1f(U.uTime, time % 1000);
        gl.uniform1f(U.uLamp, lampLevel(time));
        gl.uniform2f(U.uFogRange, fr[0], fr[1]);
        // structure, puis décors avec un décalage de profondeur proportionnel à la pente (aucun scintillement)
        for (var pi = 0; pi < passes.length; pi++) {
          var ps = passes[pi];
          for (var ai = 0; ai < 3; ai++) {
            gl.bindBuffer(gl.ARRAY_BUFFER, ps.b[ai]);
            gl.vertexAttribPointer(LOCS[ai], ai === 2 ? 1 : 3, gl.FLOAT, false, 0, 0);
          }
          if (ps.layer) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1 * ps.layer, -2 * ps.layer); }
          else gl.disable(gl.POLYGON_OFFSET_FILL);
          gl.drawArrays(gl.TRIANGLES, 0, ps.n);
        }
      };
      var frame = function (now) {
        if (!alive) return;
        if (paused) { raf = 0; return; }
        raf = requestAnimationFrame(frame);
        if (!last) last = now;
        var dt = Math.min(0.1, (now - last) / 1000);
        last = now; acc += dt;
        if (acc < 1 / 30) return; // 30 images/s, comme à l'époque (et moins de GPU)
        var st = acc; acc = 0;
        speed += (target - speed) * Math.min(1, st * 1.5);
        time += st;
        phase += st * speed * (reduce ? 0.15 : 1);
        draw();
      };
      draw();
      raf = requestAnimationFrame(frame);
      return {
        setSpeed: function (v) { target = v; },
        // pause complète (aucune image calculée) : jeu lancé, menu caché…
        pause: function () { paused = true; },
        resume: function () {
          if (!alive || !paused) return;
          paused = false; last = 0; acc = 0;
          if (!raf) raf = requestAnimationFrame(frame);
        },
        setMode: function (m) { mode = m; },
        // aspect du béton : grain 0–1,5 (intensité de la texture), cold 0–1 (béton plus froid)
        setLook: function (o) {
          gl.useProgram(prog);
          if (o.grain != null) gl.uniform1f(U.uGrain, o.grain);
          if (o.cold != null) gl.uniform1f(U.uCold, o.cold);
        },
        destroy: function () {
          alive = false;
          cancelAnimationFrame(raf);
          var ext = gl.getExtension('WEBGL_lose_context');
          if (ext) ext.loseContext();
        }
      };
    } catch (e) {
      if (window.console) console.warn('SiloPS1 :', e);
      return NOOP;
    }
  }

  window.SiloPS1 = { mount: mount, build: BUILDERS };
})();
