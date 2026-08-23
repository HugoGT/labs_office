/* Oficina Virtual — Prototipo Fase 0 (PRD sección 12)
   Mapa 2D top-down pixel art estilo Gather: movimiento, proximidad, salas, interacción por clic. */
(function () {
  'use strict';

  var T = 32, MW = 64, MH = 44;                 // tile size y dimensiones del mapa (en tiles)
  var WORLD_W = MW * T, WORLD_H = MH * T;
  var PROX_RADIUS = 170;                        // radio de audio por proximidad (px)

  // Códigos de suelo
  var G = 0, GD = 1, WATER = 2, BRIDGE = 3, FLOOR = 4, WOODF = 5, WALL = 6, CORR = 7;
  var GROUND_TEX = ['grassA', 'grassDark', 'water', 'bridge', 'floor', 'woodf', 'wall', 'corridor'];

  // ---------- Datos del mapa ----------
  // Filas de escritorios: [tileX, tileY, cantidad] (cada escritorio ocupa 2x1 tiles)
  var DESK_ROWS = [
    [3, 5, 3], [13, 4, 2], [20, 4, 3], [27, 4, 2],
    [3, 14, 3], [12, 15, 3], [25, 15, 3], [33, 14, 3],
    [4, 24, 2], [16, 24, 3], [27, 24, 3],
    [4, 36, 3], [16, 36, 3], [28, 36, 3]
  ];

  var TREES = [
    [2, 2], [9, 2], [18, 2], [30, 2], [40, 2], [46, 4],
    [2, 9], [46, 12], [2, 26], [46, 26], [2, 34], [44, 34],
    [12, 41], [24, 41], [36, 41], [44, 41],
    [52, 34], [56, 36], [60, 34]
  ];

  var ZONE_LABELS = [
    { t: 'C R E A T I V I T Y', x: 9, y: 1.4 },
    { t: 'B U S I N E S S', x: 2.5, y: 11.2 },
    { t: 'P R O D U C T', x: 30, y: 11.2 },
    { t: 'T E C H N O L O G Y', x: 12, y: 32.2 }
  ];

  // NPCs: nombre, tileX, tileY, estado (g=disponible, y=ausente, r=en reunión), wander
  var NPCS = [
    ['Franklin Ga', 4, 7, 'g'], ['Dennis ZR', 6, 7, 'g'], ['Ariana Colan', 14, 6, 'g'],
    ['Christopher', 21, 6, 'g'], ['Alejandro', 23, 6, 'y'], ['Dario Calero', 4, 16, 'g'],
    ['paulotijero', 6, 16, 'y'], ['Mili', 13, 17, 'r'], ['Sebastian Rios', 15, 17, 'g'],
    ['Angélica', 26, 17, 'g'], ['Alvaro Torres', 34, 16, 'g'], ['Jimmy Loloy', 36, 16, 'g'],
    ['Anderson', 4, 26, 'r'], ['Pablo', 6, 26, 'g', true], ['Nimer Cerna', 5, 27, 'g'],
    ['Jean', 7, 27, 'g'], ['Milko', 17, 26, 'g'], ['DiegoLopez', 19, 26, 'g'],
    ['Jordan Távara', 20, 28, 'g', true], ['Alberto', 28, 26, 'g'], ['Fernando.Aquino', 30, 26, 'g'],
    ['Paul Llanque', 31, 27, 'g'], ['Mike Vera', 33, 26, 'g'],
    ['Junior Ange', 5, 38, 'g'], ['Paul Tijero', 7, 38, 'g'], ['Iberson Silva', 5, 40, 'g'],
    ['Kendry Soto', 8, 40, 'g'], ['kevin', 17, 38, 'g', true], ['ivan herbas', 18, 39, 'g'],
    ['Joaquin', 20, 38, 'g'], ['Jeraldine', 29, 38, 'g'], ['Alexis Perdomo', 31, 38, 'g'],
    ['Luis', 33, 38, 'r']
  ];

  var STATUS_COLOR = { g: 0x22c55e, y: 0xeab308, r: 0xef4444 };
  var STATUS_TXT = { g: 'Disponible', y: 'Ausente', r: 'En reunión' };

  var ROOMS = [
    { x: 50 * T, y: 2 * T, w: 13 * T, h: 14 * T, name: 'Sala de Juntas' },
    { x: 50 * T, y: 18 * T, w: 13 * T, h: 14 * T, name: 'Cafetería' }
  ];

  var SKINS = [0xf2c49b, 0xd9a066, 0x8d5524];
  var HAIRS = [0x2b2b2b, 0x5a3825, 0xd8b23c, 0x8a2f2f, 0x394a8a];
  var SHIRTS = [0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6, 0x374151, 0xec4899];
  var PANTS = [0x1f2937, 0x334155, 0x5a3825];

  // ---------- Escena ----------
  var OfficeScene = new Phaser.Class({
    Extends: Phaser.Scene,

    initialize: function OfficeScene() {
      Phaser.Scene.call(this, { key: 'office' });
    },

    create: function () {
      this.ground = [];
      this.solid = [];
      this.npcs = [];
      this.lastNearbyKey = '';
      this.currentRoom = null;

      this.makeTextures();
      this.buildGrid();
      this.renderGround();
      this.placeFurniture();
      this.placeNature();
      this.placeZoneLabels();
      this.spawnNPCs();
      this.spawnPlayer();
      this.buildColliders();
      this.setupCameras();
      this.setupInput();

      this.time.addEvent({ delay: 250, loop: true, callback: this.proximityTick, callbackScope: this });

      window.officeAPI = { scene: this };
    },

    // ---- Texturas pixel-art generadas por código ----
    makeTextures: function () {
      var g = this.make.graphics({ x: 0, y: 0, add: false });

      function tex(key, w, h, draw) {
        g.clear(); draw(g); g.generateTexture(key, w, h);
      }
      function speckle(g, color, w, h, n, seed) {
        g.fillStyle(color, 1);
        for (var i = 0; i < n; i++) {
          var x = (i * 13 + seed * 7) % w, y = (i * 29 + seed * 11) % h;
          g.fillRect(x, y, 2, 1);
        }
      }

      tex('grassA', T, T, function (g) { g.fillStyle(0x55a24f); g.fillRect(0, 0, T, T); speckle(g, 0x4a9145, T, T, 6, 1); });
      tex('grassB', T, T, function (g) { g.fillStyle(0x5dab56); g.fillRect(0, 0, T, T); speckle(g, 0x50994b, T, T, 6, 2); });
      tex('grassDark', T, T, function (g) { g.fillStyle(0x3c7a3a); g.fillRect(0, 0, T, T); speckle(g, 0x336831, T, T, 8, 3); });
      tex('water', T, T, function (g) {
        g.fillStyle(0x3e78c8); g.fillRect(0, 0, T, T);
        g.fillStyle(0x5b93dd); g.fillRect(4, 8, 10, 2); g.fillRect(18, 20, 10, 2); g.fillRect(10, 27, 8, 2);
      });
      tex('bridge', T, T, function (g) {
        g.fillStyle(0x8a5a33); g.fillRect(0, 0, T, T);
        g.fillStyle(0x6e4626); for (var i = 0; i < 4; i++) g.fillRect(0, i * 8, T, 2);
        g.fillStyle(0x9c6a3f); g.fillRect(0, 0, 2, T); g.fillRect(T - 2, 0, 2, T);
      });
      tex('floor', T, T, function (g) {
        g.fillStyle(0x9aa0a8); g.fillRect(0, 0, T, T);
        g.lineStyle(1, 0x878d96); g.strokeRect(0, 0, T, T);
        g.fillStyle(0x90969e); g.fillRect(0, 0, 16, 16); g.fillRect(16, 16, 16, 16);
      });
      tex('woodf', T, T, function (g) {
        g.fillStyle(0x9a6b42); g.fillRect(0, 0, T, T);
        g.fillStyle(0x8a5d38); for (var i = 0; i < 4; i++) g.fillRect(0, i * 8, T, 1);
        g.fillStyle(0xa87a4d); g.fillRect(6, 3, 12, 2); g.fillRect(18, 19, 10, 2);
      });
      tex('wall', T, T, function (g) {
        g.fillStyle(0x2f3542); g.fillRect(0, 0, T, T);
        g.fillStyle(0x3d4456); g.fillRect(0, 0, T, 8);
        g.fillStyle(0x262b36); g.fillRect(0, T - 4, T, 4);
      });
      tex('corridor', T, T, function (g) { g.fillStyle(0xcbb083); g.fillRect(0, 0, T, T); speckle(g, 0xbda276, T, T, 6, 4); });

      tex('desk', T * 2, T, function (g) {
        g.fillStyle(0x6f4a2e); g.fillRect(0, 6, 64, 26);            // frente
        g.fillStyle(0x8b5e3c); g.fillRect(0, 0, 64, 10);            // tapa
        g.fillStyle(0x1f2937); g.fillRect(8, 0, 20, 3);             // base monitor 1
        g.fillStyle(0x0f2b4a); g.fillRect(9, 10, 18, 12);           // pantalla 1
        g.fillStyle(0x1e5f8a); g.fillRect(11, 12, 14, 8);
        g.fillStyle(0x0f2b4a); g.fillRect(38, 10, 18, 12);          // pantalla 2
        g.fillStyle(0x1e5f8a); g.fillRect(40, 12, 14, 8);
        g.fillStyle(0x374151); g.fillRect(14, 25, 12, 4);           // teclado
      });
      tex('chairB', 16, 16, function (g) {
        g.fillStyle(0x2563eb); g.fillRect(2, 0, 12, 5);
        g.fillStyle(0x3b82f6); g.fillRect(2, 5, 12, 8);
        g.fillStyle(0x1f2937); g.fillRect(4, 13, 2, 3); g.fillRect(10, 13, 2, 3);
      });
      tex('stool', 14, 12, function (g) {
        g.fillStyle(0x8b5e3c); g.fillRect(1, 0, 12, 6);
        g.fillStyle(0x6e4626); g.fillRect(3, 6, 2, 6); g.fillRect(9, 6, 2, 6);
      });
      tex('barrel', 20, 24, function (g) {
        g.fillStyle(0x8a5a33); g.fillRect(2, 0, 16, 24);
        g.fillStyle(0x6e4626); g.fillRect(2, 4, 16, 2); g.fillRect(2, 17, 16, 2);
        g.fillStyle(0x9c6a3f); g.fillRect(4, 0, 3, 24);
      });
      tex('tableGray', 7 * T, 5 * T, function (g) {
        g.fillStyle(0x565e6a); g.fillRect(0, 0, 224, 160);
        g.fillStyle(0x6b7280); g.fillRect(4, 4, 216, 152);
        g.fillStyle(0x0f2b4a); g.fillRect(62, 50, 100, 60);          // pantalla central
        g.fillStyle(0x1e5f8a); g.fillRect(68, 56, 88, 48);
        g.fillStyle(0x35c26a); g.fillRect(74, 62, 30, 4); g.fillRect(74, 72, 50, 4); g.fillRect(74, 82, 40, 4);
      });
      tex('tableWood', 5 * T, 3 * T, function (g) {
        g.fillStyle(0x6e4626); g.fillRect(0, 0, 160, 96);
        g.fillStyle(0x8b5e3c); g.fillRect(4, 4, 152, 88);
        g.fillStyle(0x9c6a3f); g.fillRect(10, 10, 140, 3); g.fillRect(10, 50, 140, 3);
      });
      tex('tree', T * 2, 80, function (g) {
        g.fillStyle(0x6e4626); g.fillRect(28, 56, 8, 22);           // tronco
        g.fillStyle(0x2e6b34); g.fillEllipse(32, 32, 58, 52);       // copa
        g.fillStyle(0x3f8a42); g.fillEllipse(28, 26, 40, 34);
        g.fillStyle(0x55a24f); g.fillEllipse(22, 20, 18, 14); g.fillEllipse(40, 30, 14, 10);
      });
      tex('bush', 24, 16, function (g) {
        g.fillStyle(0x3f8a42); g.fillEllipse(12, 9, 22, 13);
        g.fillStyle(0x55a24f); g.fillEllipse(9, 6, 10, 7);
      });
      tex('flower', 10, 10, function (g) {
        g.fillStyle(0x55a24f); g.fillRect(4, 5, 2, 4);
        g.fillStyle(0xf472b6); g.fillRect(2, 1, 6, 4);
        g.fillStyle(0xfde68a); g.fillRect(4, 2, 2, 2);
      });

      // Avatares (16x20, se escalan x2)
      function avatar(key, skin, hair, shirt, pants) {
        tex(key, 16, 20, function (g) {
          g.fillStyle(hair); g.fillRect(4, 0, 8, 2); g.fillRect(3, 1, 10, 3);
          g.fillStyle(skin); g.fillRect(4, 3, 8, 5);
          g.fillStyle(0x222222); g.fillRect(6, 5, 1, 1); g.fillRect(9, 5, 1, 1);
          g.fillStyle(shirt); g.fillRect(3, 8, 10, 6);
          g.fillStyle(skin); g.fillRect(2, 9, 1, 4); g.fillRect(13, 9, 1, 4);
          g.fillStyle(pants); g.fillRect(4, 14, 8, 3); g.fillRect(4, 17, 3, 2); g.fillRect(9, 17, 3, 2);
          g.fillStyle(0x222222); g.fillRect(4, 19, 3, 1); g.fillRect(9, 19, 3, 1);
        });
      }
      for (var i = 0; i < 10; i++) {
        avatar('av' + i, SKINS[i % 3], HAIRS[(i * 3 + 1) % 5], SHIRTS[(i * 5 + 2) % 7], PANTS[i % 3]);
      }
      avatar('avP', SKINS[0], 0x2b2b2b, 0xfacc15, 0x1f2937);  // jugador: camisa amarilla

      g.destroy();
    },

    // ---- Grid lógico: suelo + colisiones ----
    buildGrid: function () {
      var x, y;
      for (y = 0; y < MH; y++) {
        this.ground[y] = [];
        this.solid[y] = [];
        for (x = 0; x < MW; x++) { this.ground[y][x] = G; this.solid[y][x] = false; }
      }
      var self = this;
      function set(x, y, code, isSolid) { self.ground[y][x] = code; self.solid[y][x] = !!isSolid; }
      this.setSolid = function (x, y, w, h) {
        for (var j = y; j < y + h; j++) for (var i = x; i < x + w; i++) self.solid[j][i] = true;
      };

      // Borde de seto (oscuro, sólido)
      for (y = 0; y < MH; y++) for (x = 0; x < MW; x++) {
        if (x === 0 || y === 0 || x === MW - 1 || y === MH - 1) set(x, y, GD, true);
      }
      // Pasillo que conecta el césped con las salas
      for (y = 1; y < MH - 1; y++) { set(48, y, CORR); set(49, y, CORR); }
      // Río con dos puentes
      for (y = 19; y <= 21; y++) for (x = 1; x <= 47; x++) {
        var isBridge = (x >= 13 && x <= 15) || (x >= 32 && x <= 34);
        set(x, y, isBridge ? BRIDGE : WATER, !isBridge);
      }
      // Salas a la derecha (paredes con puerta al pasillo)
      ROOMS.forEach(function (room, ri) {
        var x0 = room.x / T, y0 = room.y / T, x1 = x0 + room.w / T - 1, y1 = y0 + room.h / T - 1;
        var doorY = ri === 0 ? [8, 9] : [24, 25];
        var floorCode = ri === 0 ? FLOOR : WOODF;
        for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
          var isWall = (x === x0 || x === x1 || y === y0 || y === y1);
          if (isWall && x === x0 && doorY.indexOf(y) >= 0) { set(x, y, floorCode, false); }
          else if (isWall) { set(x, y, WALL, true); }
          else { set(x, y, floorCode, false); }
        }
      });
      // Jardín trasero de las salas
      for (y = 33; y <= 42; y++) for (x = 50; x <= 62; x++) set(x, y, GD, false);
    },

    renderGround: function () {
      for (var y = 0; y < MH; y++) for (var x = 0; x < MW; x++) {
        var code = this.ground[y][x];
        var key = GROUND_TEX[code];
        if (code === G) key = (y % 2 === 0) ? 'grassA' : 'grassB';  // franjas de césped cortado
        this.add.image(x * T, y * T, key).setOrigin(0).setDepth(0);
      }
    },

    placeFurniture: function () {
      var self = this;
      // Escritorios
      DESK_ROWS.forEach(function (row) {
        var x = row[0], y = row[1], n = row[2];
        for (var i = 0; i < n; i++) {
          var tx = x + i * 2;
          self.add.image(tx * T, y * T, 'desk').setOrigin(0).setDepth((y + 1) * T);
          self.setSolid(tx, y, 2, 1);
        }
      });
      // Sala de Juntas: mesa gris + sillas azules
      this.add.image(53 * T, 6 * T, 'tableGray').setOrigin(0).setDepth(11 * T);
      this.setSolid(53, 6, 7, 5);
      for (var i = 0; i < 7; i++) {
        this.add.image((53 + i) * T + 16, 5 * T + 16, 'chairB').setScale(1.5).setDepth(6 * T);
        this.add.image((53 + i) * T + 16, 11 * T + 16, 'chairB').setScale(1.5).setDepth(12 * T);
      }
      for (var j = 0; j < 5; j++) {
        this.add.image(52 * T + 16, (6 + j) * T + 16, 'chairB').setScale(1.5).setDepth((7 + j) * T);
        this.add.image(60 * T + 16, (6 + j) * T + 16, 'chairB').setScale(1.5).setDepth((7 + j) * T);
      }
      // Cafetería: mesa de madera + bancos + barriles
      this.add.image(53 * T, 23 * T, 'tableWood').setOrigin(0).setDepth(26 * T);
      this.setSolid(53, 23, 5, 3);
      for (i = 0; i < 5; i++) {
        this.add.image((53 + i) * T + 16, 22 * T + 16, 'stool').setScale(1.6).setDepth(23 * T);
        this.add.image((53 + i) * T + 16, 26 * T + 16, 'stool').setScale(1.6).setDepth(27 * T);
      }
      [[51, 19], [61, 19], [51, 30], [61, 30]].forEach(function (p) {
        self.add.image(p[0] * T + 16, (p[1] + 1) * T, 'barrel').setOrigin(0.5, 1).setScale(1.4).setDepth((p[1] + 1) * T);
        self.setSolid(p[0], p[1], 1, 1);
      });
    },

    placeNature: function () {
      var self = this;
      TREES.forEach(function (p) {
        var x = p[0], y = p[1];
        self.add.image((x + 0.5) * T, (y + 1) * T + 4, 'tree').setOrigin(0.5, 1).setDepth((y + 1) * T);
        self.setSolid(x, y, 1, 1);
      });
      // Arbustos y flores dispersos (determinista, evita zonas sólidas y agua)
      for (var i = 0; i < 90; i++) {
        var x = 1 + ((i * 13 + 5) % 46), y = 1 + ((i * 29 + 11) % 41);
        if (this.solid[y][x] || this.ground[y][x] !== G) continue;
        var key = (i % 3 === 0) ? 'bush' : 'flower';
        this.add.image(x * T + 16, y * T + 24, key).setDepth(1);
      }
    },

    placeZoneLabels: function () {
      var self = this;
      ZONE_LABELS.forEach(function (z) {
        self.add.text(z.x * T, z.y * T, z.t, {
          fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#ffffff'
        }).setAlpha(0.4).setDepth(2);
      });
    },

    // ---- Personajes ----
    makeCharacter: function (name, tx, ty, texKey, statusColor) {
      var px = tx * T + 16, py = ty * T + 16;
      var ring = this.add.ellipse(0, 18, 34, 14).setStrokeStyle(2.5, 0x22c55e).setVisible(false);
      ring.isFilled = false;
      var spr = this.add.sprite(0, 0, texKey).setScale(2);

      var label = this.add.text(0, 0, name, {
        fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif', fontSize: '11px', fontStyle: '600', color: '#f3f4f6'
      }).setOrigin(0, 0.5);
      var pillW = label.width + 24;
      var pill = this.add.graphics();
      pill.fillStyle(0x111827, 0.85);
      pill.fillRoundedRect(-pillW / 2, -34 - 9, pillW, 18, 9);
      var dot = this.add.circle(-pillW / 2 + 11, -34, 3.5, statusColor);
      label.setPosition(-pillW / 2 + 19, -34);

      var c = this.add.container(px, py, [ring, spr, pill, dot, label]);
      c.setDepth(py);
      c.setSize(32, 44);
      c.ring = ring;
      c.nameText = name;
      return c;
    },

    spawnNPCs: function () {
      var self = this;
      NPCS.forEach(function (d, i) {
        var name = d[0], tx = d[1], ty = d[2], st = d[3], wander = !!d[4];
        var c = self.makeCharacter(name, tx, ty, 'av' + (i % 10), STATUS_COLOR[st]);
        c.npcId = i;
        c.status = st;
        c.homeTx = tx; c.homeTy = ty;
        c.phase = (i * 777) % 4000;
        c.setInteractive(new Phaser.Geom.Rectangle(-16, -22, 32, 44), Phaser.Geom.Rectangle.Contains);
        c.on('pointerdown', function (pointer) {
          pointer.event.stopPropagation();
          document.dispatchEvent(new CustomEvent('office:npcmenu', {
            detail: { id: i, name: name, status: STATUS_TXT[st], statusColor: st, x: pointer.event.clientX, y: pointer.event.clientY }
          }));
        });
        self.npcs.push(c);
        if (wander) self.scheduleWander(c);
      });
    },

    scheduleWander: function (c) {
      var self = this;
      this.time.addEvent({
        delay: Phaser.Math.Between(2500, 6000), loop: true,
        callback: function () {
          var dx = Phaser.Math.Between(-2, 2), dy = Phaser.Math.Between(-2, 2);
          var nx = c.homeTx + dx, ny = c.homeTy + dy;
          if (nx < 1 || ny < 1 || nx >= MW - 1 || ny >= MH - 1) return;
          if (self.solid[ny][nx] || self.ground[ny][nx] === WATER) return;
          self.tweens.add({ targets: c, x: nx * T + 16, y: ny * T + 16, duration: 900, ease: 'Sine.inOut' });
        }
      });
    },

    spawnPlayer: function () {
      this.player = this.makeCharacter('HugoGT', 22, 28, 'avP', STATUS_COLOR.g);
      this.physics.add.existing(this.player);
      this.player.body.setSize(22, 14).setOffset(-11, 6);
      this.player.body.setCollideWorldBounds(true);
      this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    },

    buildColliders: function () {
      // Fusiona tramos horizontales de tiles sólidos en rectángulos estáticos
      var rects = [];
      for (var y = 0; y < MH; y++) {
        var x = 0;
        while (x < MW) {
          if (!this.solid[y][x]) { x++; continue; }
          var x0 = x;
          while (x < MW && this.solid[y][x]) x++;
          var w = (x - x0) * T;
          var r = this.add.rectangle(x0 * T + w / 2, y * T + T / 2, w, T);
          this.physics.add.existing(r, true);
          rects.push(r);
        }
      }
      this.physics.add.collider(this.player, rects);
    },

    setupCameras: function () {
      var cam = this.cameras.main;
      cam.setBounds(0, 0, WORLD_W, WORLD_H);
      cam.startFollow(this.player, true, 0.12, 0.12);
      cam.setBackgroundColor('#0d1117');

      // Minimapa (esquina superior derecha)
      var mm = this.cameras.add(this.scale.width - 216, 14, 200, 140);
      mm.setZoom(Math.min(200 / WORLD_W, 140 / WORLD_H));
      mm.centerOn(WORLD_W / 2, WORLD_H / 2);
      mm.setBackgroundColor(0x0d1117);
      this.minimap = mm;

      // Marcador del jugador visible solo en el minimapa
      this.mmMarker = this.add.circle(0, 0, 42, 0xffffff, 0.45).setDepth(99999);
      cam.ignore(this.mmMarker);

      var self = this;
      this.scale.on('resize', function (gameSize) {
        mm.setPosition(gameSize.width - 216, 14);
      });
    },

    setupInput: function () {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D');
      this.input.keyboard.addCapture('UP,DOWN,LEFT,RIGHT,SPACE');
      this.input.on('pointerdown', function (pointer, currentlyOver) {
        if (!currentlyOver || currentlyOver.length === 0) {
          document.dispatchEvent(new CustomEvent('office:closemenu'));
        }
      });
    },

    // ---- Proximidad + salas (cada 250 ms) ----
    proximityTick: function () {
      var p = this.player, now = this.time.now;
      var names = [];
      for (var i = 0; i < this.npcs.length; i++) {
        var c = this.npcs[i];
        var d = Phaser.Math.Distance.Between(p.x, p.y, c.x, c.y);
        var near = d < PROX_RADIUS;
        var speaking = near && ((now + c.phase) % 4000) < 1800;
        c.ring.setVisible(speaking);
        if (near) names.push(c.nameText);
      }
      var key = names.join('|');
      if (key !== this.lastNearbyKey) {
        this.lastNearbyKey = key;
        document.dispatchEvent(new CustomEvent('office:nearby', { detail: names }));
      }

      var room = null;
      for (i = 0; i < ROOMS.length; i++) {
        var r = ROOMS[i];
        if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) { room = r.name; break; }
      }
      if (room !== this.currentRoom) {
        this.currentRoom = room;
        document.dispatchEvent(new CustomEvent('office:room', { detail: room }));
      }
    },

    // ---- Acciones desde el menú contextual ----
    teleportTo: function (npcId) {
      var c = this.npcs[npcId];
      var tx = Math.floor(c.x / T), ty = Math.floor(c.y / T);
      var opts = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]];
      for (var i = 0; i < opts.length; i++) {
        var nx = tx + opts[i][0], ny = ty + opts[i][1];
        if (nx > 0 && ny > 0 && nx < MW - 1 && ny < MH - 1 && !this.solid[ny][nx] && this.ground[ny][nx] !== WATER) {
          this.player.setPosition(nx * T + 16, ny * T + 16);
          this.cameras.main.flash(200, 255, 255, 255, false);
          return;
        }
      }
    },

    update: function () {
      var speed = 230;
      var vx = 0, vy = 0;
      if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -1;
      else if (this.cursors.right.isDown || this.wasd.D.isDown) vx = 1;
      if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -1;
      else if (this.cursors.down.isDown || this.wasd.S.isDown) vy = 1;
      var v = new Phaser.Math.Vector2(vx, vy).normalize().scale(speed);
      this.player.body.setVelocity(v.x, v.y);
      this.player.setDepth(this.player.y);

      for (var i = 0; i < this.npcs.length; i++) this.npcs[i].setDepth(this.npcs[i].y);
      if (this.mmMarker) this.mmMarker.setPosition(this.player.x, this.player.y);
    }
  });

  // ---------- Juego ----------
  var game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0d1117',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [OfficeScene]
  });

  // ---------- UI (DOM) ----------
  var $ = function (id) { return document.getElementById(id); };
  var toastTimer = null;

  function toast(msg, ms) {
    var t = $('toast');
    t.innerHTML = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.opacity = '0'; }, ms || 3200);
  }

  // Mic / cámara (visual, la media real llegará con LiveKit — PRD 6.3)
  var micOn = true, camOn = true, recording = false, currentRoom = null;
  $('btnMic').addEventListener('click', function () {
    micOn = !micOn;
    this.classList.toggle('off', !micOn);
    this.textContent = micOn ? '🎙️ Mic' : '🔇 Mic';
  });
  $('btnCam').addEventListener('click', function () {
    camOn = !camOn;
    this.classList.toggle('off', !camOn);
    this.textContent = camOn ? '📷 Cámara' : '🚫 Cámara';
  });

  // Grabación (PRD 4.9): solo dentro de una sala delimitada
  function stopRecording() {
    recording = false;
    $('btnRec').classList.remove('rec-on');
    $('btnRec').textContent = '⏺ Grabar';
    $('recbadge').style.display = 'none';
  }
  $('btnRec').addEventListener('click', function () {
    if (!currentRoom) return;
    recording = !recording;
    if (recording) {
      this.classList.add('rec-on');
      this.textContent = '⏹ Detener';
      $('recbadge').style.display = 'flex';
      toast('⚠️ Aviso enviado: la sala <b>' + currentRoom + '</b> se está grabando (prototipo — la grabación real usará LiveKit Egress → MinIO)');
    } else {
      stopRecording();
      toast('💾 Grabación finalizada (prototipo)');
    }
  });

  document.addEventListener('office:nearby', function (e) {
    var el = $('nearby');
    el.innerHTML = e.detail.slice(0, 6).map(function (n) { return '<span class="p">🔊 ' + n + '</span>'; }).join('');
    if (e.detail.length > 6) el.innerHTML += '<span class="p">+' + (e.detail.length - 6) + '</span>';
  });

  document.addEventListener('office:room', function (e) {
    currentRoom = e.detail;
    var st = $('status');
    if (currentRoom) {
      st.innerHTML = '🔒 Sala privada: <b>' + currentRoom + '</b> — audio aislado';
      $('btnRec').disabled = false;
      toast('Entraste a <b>' + currentRoom + '</b>: solo escuchas a quienes están dentro');
    } else {
      st.innerHTML = 'Audio por <b>proximidad</b>';
      $('btnRec').disabled = true;
      if (recording) { stopRecording(); toast('💾 Saliste de la sala: grabación detenida'); }
    }
  });

  // Menú contextual al hacer clic en un avatar (PRD 4.3)
  var menu = $('ctxmenu');
  var dotColor = { g: '#22c55e', y: '#eab308', r: '#ef4444' };

  document.addEventListener('office:npcmenu', function (e) {
    var d = e.detail;
    menu.innerHTML =
      '<div class="hd"><span class="st" style="background:' + dotColor[d.statusColor] + '"></span>' + d.name + '</div>' +
      '<button data-a="call">📞 Llamar</button>' +
      '<button data-a="goto">🚶 Ir a su escritorio</button>' +
      '<button data-a="profile">👤 Ver perfil</button>';
    menu.style.display = 'block';
    var mw = 200, mh = 150;
    menu.style.left = Math.min(d.x, window.innerWidth - mw - 10) + 'px';
    menu.style.top = Math.min(d.y, window.innerHeight - mh - 10) + 'px';

    menu.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        menu.style.display = 'none';
        var a = b.getAttribute('data-a');
        if (a === 'call') toast('📞 Llamando a <b>' + d.name + '</b>… (prototipo: la videollamada 1:1 llegará con LiveKit)');
        if (a === 'goto') { window.officeAPI.scene.teleportTo(d.id); toast('🚶 Te teletransportaste junto a <b>' + d.name + '</b>'); }
        if (a === 'profile') toast('👤 <b>' + d.name + '</b> · Empleado · ' + d.status);
      });
    });
  });

  document.addEventListener('office:closemenu', function () { menu.style.display = 'none'; });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') menu.style.display = 'none'; });
})();
