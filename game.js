(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const titleEl = document.getElementById('title');
  const finalScoreEl = document.getElementById('finalScore');
  const hud = document.getElementById('hud');
  const scoreVal = document.getElementById('scoreVal');
  const livesVal = document.getElementById('livesVal');
  const muteBtn = document.getElementById('muteBtn');

  // ----- Audio (Web Audio API procedural SFX) -----
  const AudioSys = {
    ctx: null,
    muted: false,
    unlocked: false,

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    },

    unlock() {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.unlocked = true;
      try {
        const buf = this.ctx.createBuffer(1, 1, 22050);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.ctx.destination);
        src.start(0);
      } catch (_) {}
    },

    toggleMute() {
      this.muted = !this.muted;
      muteBtn.textContent = this.muted ? '🔇' : '🔊';
      muteBtn.setAttribute('aria-label', this.muted ? '取消静音' : '静音');
      if (!this.muted) this.unlock();
    },

    tone(freq, dur, type, vol, slide) {
      if (this.muted || !this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
      gain.gain.setValueAtTime(vol || 0.08, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    noise(dur, vol) {
      if (this.muted || !this.ctx) return;
      const t0 = this.ctx.currentTime;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      gain.gain.setValueAtTime(vol || 0.12, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    },

    shoot() { this.tone(880, 0.06, 'square', 0.05, 220); },
    hit() { this.tone(180, 0.1, 'sawtooth', 0.07, 60); },
    explosion() { this.noise(0.28, 0.18); this.tone(120, 0.25, 'sawtooth', 0.1, 40); },
    powerup() {
      this.tone(440, 0.08, 'sine', 0.08);
      setTimeout(() => this.tone(660, 0.08, 'sine', 0.08), 70);
      setTimeout(() => this.tone(880, 0.12, 'sine', 0.09), 140);
    },
    start() {
      this.tone(330, 0.1, 'triangle', 0.08);
      setTimeout(() => this.tone(440, 0.1, 'triangle', 0.08), 90);
      setTimeout(() => this.tone(550, 0.15, 'triangle', 0.09), 180);
    },
    gameOver() {
      this.tone(300, 0.2, 'sawtooth', 0.1, 150);
      setTimeout(() => this.tone(200, 0.35, 'sawtooth', 0.1, 80), 180);
    },
  };

  // ----- Canvas size -----
  let W = 0, H = 0, dpr = 1;

  function resize() {
    const app = document.getElementById('app');
    const rect = app.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.floor(rect.width));
    H = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', () => {
    const wasPlaying = state === STATE.PLAY;
    const px = player ? player.x / (W || 1) : 0.5;
    const py = player ? player.y / (H || 1) : 0.85;
    resize();
    if (stars) makeStars();
    if (player && wasPlaying) {
      player.x = clamp(px * W, player.w, W - player.w);
      player.y = clamp(py * H, player.h, H - player.h);
    }
  });
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  // ----- Input -----
  const keys = Object.create(null);
  let pointerActive = false;
  let pointerX = 0, pointerY = 0;
  let pointerOffX = 0, pointerOffY = 0;

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'KeyM') AudioSys.toggleMute();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  function bindPointer(el) {
    el.addEventListener('pointerdown', (e) => {
      if (e.target === muteBtn || e.target === startBtn) return;
      pointerActive = true;
      const r = canvas.getBoundingClientRect();
      pointerX = e.clientX - r.left;
      pointerY = e.clientY - r.top;
      // Keep the initial finger→plane offset so the ship never jumps under the finger
      if (typeof state !== 'undefined' && state === STATE.PLAY && player) {
        pointerOffX = player.x - pointerX;
        pointerOffY = player.y - pointerY;
      } else {
        pointerOffX = 0;
        pointerOffY = 0;
      }
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      if (!pointerActive) return;
      const r = canvas.getBoundingClientRect();
      pointerX = e.clientX - r.left;
      pointerY = e.clientY - r.top;
      e.preventDefault();
    }, { passive: false });

    const end = (e) => {
      pointerActive = false;
      e.preventDefault();
    };
    el.addEventListener('pointerup', end, { passive: false });
    el.addEventListener('pointercancel', end, { passive: false });
  }

  bindPointer(canvas);
  document.getElementById('app').addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ----- Game state -----
  const STATE = { MENU: 0, PLAY: 1, OVER: 2 };
  let state = STATE.MENU;

  let player, bullets, enemies, particles, powerups, stars;
  let score = 0, lives = 3, elapsed = 0, spawnTimer = 0, powerSpawnTimer = 0;
  let lastTime = 0, fireCool = 0, shake = 0;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function chance(p) { return Math.random() < p; }

  function makeStars() {
    stars = [];
    const n = Math.floor((W * H) / 9000) + 40;
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: rand(0.3, 1.5),
        tw: Math.random() * Math.PI * 2,
      });
    }
  }

  function updateHud() {
    scoreVal.textContent = String(score);
    livesVal.textContent = String(lives);
  }

  function resetGame() {
    score = 0;
    lives = 3;
    elapsed = 0;
    spawnTimer = 0.4;
    powerSpawnTimer = 8;
    fireCool = 0;
    shake = 0;
    bullets = [];
    enemies = [];
    particles = [];
    powerups = [];
    player = {
      x: W / 2,
      y: H - 140,
      w: 28,
      h: 34,
      speed: 320,
      invuln: 0,
      rapid: 0,
      shield: 0,
    };
    makeStars();
    updateHud();
  }

  function spawnEnemy() {
    const difficulty = 1 + elapsed / 45;
    const kinds = ['scout', 'scout', 'fighter', 'bomber'];
    if (difficulty > 2) kinds.push('fighter', 'bomber');
    if (difficulty > 3.5) kinds.push('elite');
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    let w = 26, h = 26, hp = 1, speed = 80 + difficulty * 25, pts = 100, color = '#ff6b6b';

    if (kind === 'fighter') {
      w = 32; h = 30; hp = 2; speed = 70 + difficulty * 20; pts = 200; color = '#ff9f43';
    } else if (kind === 'bomber') {
      w = 40; h = 34; hp = 4; speed = 50 + difficulty * 12; pts = 350; color = '#a55eea';
    } else if (kind === 'elite') {
      w = 36; h = 36; hp = 6; speed = 90 + difficulty * 18; pts = 500; color = '#fd79a8';
    }

    enemies.push({
      x: rand(w, W - w),
      y: -h,
      w, h, hp, maxHp: hp, speed, pts, color, kind,
      sway: rand(0, Math.PI * 2),
      swayAmp: kind === 'scout' ? rand(20, 60) : rand(10, 35),
      shootCool: rand(1.2, 2.5),
    });
  }

  function spawnPowerup(x, y) {
    const type = chance(0.5) ? 'rapid' : 'shield';
    powerups.push({ x, y, r: 12, type, vy: 70, life: 0 });
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(speed * 0.3, speed);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.3, 0.8),
        max: 0.8,
        r: rand(1.5, 4),
        color,
      });
    }
  }

  function rectsOverlap(a, b) {
    return Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h);
  }

  // ----- Draw helpers -----
  function drawPlayer() {
    const p = player;
    if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) return;

    ctx.save();
    ctx.translate(p.x, p.y);

    const glow = ctx.createRadialGradient(0, p.h * 0.45, 0, 0, p.h * 0.55, 18);
    glow.addColorStop(0, 'rgba(100,200,255,0.7)');
    glow.addColorStop(1, 'rgba(100,200,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, p.h * 0.5, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath();
    ctx.moveTo(0, -p.h / 2);
    ctx.lineTo(p.w / 2, p.h / 2 * 0.3);
    ctx.lineTo(p.w * 0.25, p.h / 2);
    ctx.lineTo(-p.w * 0.25, p.h / 2);
    ctx.lineTo(-p.w / 2, p.h / 2 * 0.3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#e3f2fd';
    ctx.beginPath();
    ctx.ellipse(0, -p.h * 0.1, 5, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0288d1';
    ctx.fillRect(-p.w / 2, p.h * 0.05, p.w, 4);

    if (p.shield > 0) {
      ctx.strokeStyle = `rgba(100,255,200,${0.4 + 0.4 * Math.sin(elapsed * 8)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(p.w, p.h) * 0.75, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (p.rapid > 0) {
      ctx.fillStyle = 'rgba(255,220,80,0.85)';
      ctx.beginPath();
      ctx.arc(-10, p.h * 0.35, 2.5, 0, Math.PI * 2);
      ctx.arc(10, p.h * 0.35, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = e.color;
    ctx.beginPath();
    if (e.kind === 'bomber') {
      ctx.moveTo(0, e.h / 2);
      ctx.lineTo(e.w / 2, -e.h / 4);
      ctx.lineTo(e.w * 0.3, -e.h / 2);
      ctx.lineTo(-e.w * 0.3, -e.h / 2);
      ctx.lineTo(-e.w / 2, -e.h / 4);
      ctx.closePath();
    } else if (e.kind === 'elite') {
      ctx.moveTo(0, e.h / 2);
      ctx.lineTo(e.w / 2, 0);
      ctx.lineTo(e.w / 3, -e.h / 2);
      ctx.lineTo(-e.w / 3, -e.h / 2);
      ctx.lineTo(-e.w / 2, 0);
      ctx.closePath();
    } else {
      ctx.moveTo(0, e.h / 2);
      ctx.lineTo(e.w / 2, -e.h / 2);
      ctx.lineTo(0, -e.h / 4);
      ctx.lineTo(-e.w / 2, -e.h / 2);
      ctx.closePath();
    }
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();

    if (e.maxHp > 1) {
      const bw = e.w;
      const ratio = e.hp / e.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-bw / 2, -e.h / 2 - 8, bw, 3);
      ctx.fillStyle = ratio > 0.5 ? '#7CFC00' : '#ff5252';
      ctx.fillRect(-bw / 2, -e.h / 2 - 8, bw * ratio, 3);
    }
    ctx.restore();
  }

  function drawBullet(b) {
    ctx.save();
    if (b.from === 'player') {
      ctx.fillStyle = b.power ? '#ffe066' : '#7ec8ff';
      ctx.shadowColor = b.power ? '#ffc107' : '#4fc3f7';
      ctx.shadowBlur = 8;
      ctx.fillRect(b.x - 2, b.y - 8, 4, 14);
    } else {
      ctx.fillStyle = '#ff5252';
      ctx.shadowColor = '#ff1744';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPowerup(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.life * 2);
    const isRapid = p.type === 'rapid';
    ctx.fillStyle = isRapid ? '#ffd54f' : '#69f0ae';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isRapid ? 'R' : 'S', 0, 1);
    ctx.restore();
  }

  // ----- Combat -----
  function firePlayer() {
    const coolNeed = player.rapid > 0 ? 0.1 : 0.22;
    if (fireCool > 0) return;
    fireCool = coolNeed;
    AudioSys.shoot();
    if (player.rapid > 0) {
      bullets.push({ x: player.x - 10, y: player.y - player.h / 2, vy: -520, from: 'player', power: true });
      bullets.push({ x: player.x + 10, y: player.y - player.h / 2, vy: -520, from: 'player', power: true });
    } else {
      bullets.push({ x: player.x, y: player.y - player.h / 2, vy: -480, from: 'player', power: false });
    }
  }

  function hurtPlayer() {
    if (player.invuln > 0) return;
    if (player.shield > 0) {
      player.shield = 0;
      player.invuln = 1.2;
      AudioSys.hit();
      burst(player.x, player.y, '#69f0ae', 12, 180);
      shake = 0.2;
      return;
    }
    lives -= 1;
    updateHud();
    player.invuln = 2;
    AudioSys.hit();
    burst(player.x, player.y, '#4fc3f7', 18, 220);
    shake = 0.35;
    if (lives <= 0) gameOver();
  }

  function gameOver() {
    state = STATE.OVER;
    AudioSys.gameOver();
    burst(player.x, player.y, '#ff6b6b', 30, 280);
    hud.classList.add('hidden');
    titleEl.textContent = '游戏结束';
    startBtn.textContent = '再来一局';
    finalScoreEl.textContent = `分数：${score}`;
    finalScoreEl.classList.remove('hidden');
    overlay.classList.remove('hidden');
  }

  // ----- Update / Render -----
  function update(dt) {
    if (state !== STATE.PLAY) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      return;
    }

    elapsed += dt;
    if (shake > 0) shake = Math.max(0, shake - dt);

    const spawnRate = Math.max(0.35, 1.4 - elapsed * 0.02);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnTimer = spawnRate * rand(0.7, 1.1);
      if (elapsed > 30 && chance(0.25)) spawnEnemy();
    }

    powerSpawnTimer -= dt;
    if (powerSpawnTimer <= 0) {
      powerSpawnTimer = rand(12, 20);
      spawnPowerup(rand(40, W - 40), -20);
    }

    let mx = 0, my = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) mx -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) mx += 1;
    if (keys['ArrowUp'] || keys['KeyW']) my -= 1;
    if (keys['ArrowDown'] || keys['KeyS']) my += 1;

    if (pointerActive) {
      const targetX = pointerX + pointerOffX;
      const targetY = pointerY + pointerOffY;
      const dx = targetX - player.x;
      const dy = targetY - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1) {
        const step = Math.min(dist, player.speed * dt * 2.2);
        player.x += (dx / dist) * step;
        player.y += (dy / dist) * step;
      }
    } else if (mx || my) {
      const len = Math.hypot(mx, my) || 1;
      player.x += (mx / len) * player.speed * dt;
      player.y += (my / len) * player.speed * dt;
    }

    player.x = clamp(player.x, player.w / 2 + 4, W - player.w / 2 - 4);
    // Leave bottom margin so on touch the plane stays above typical finger area
    player.y = clamp(player.y, player.h / 2 + 40, H - player.h / 2 - 100);

    if (player.invuln > 0) player.invuln -= dt;
    if (player.rapid > 0) player.rapid -= dt;
    if (player.shield > 0) player.shield -= dt;

    fireCool -= dt;
    firePlayer();

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y += b.vy * dt;
      if (b.vx) b.x += b.vx * dt;
      if (b.y < -20 || b.y > H + 20 || b.x < -20 || b.x > W + 20) bullets.splice(i, 1);
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.y += e.speed * dt;
      e.sway += dt * 2;
      e.x += Math.sin(e.sway) * e.swayAmp * dt * 0.5;
      e.x = clamp(e.x, e.w / 2, W - e.w / 2);

      if (e.kind !== 'scout') {
        e.shootCool -= dt;
        if (e.shootCool <= 0 && e.y > 0 && e.y < H * 0.7) {
          e.shootCool = e.kind === 'elite' ? rand(0.8, 1.4) : rand(1.5, 2.8);
          const aim = Math.atan2(player.y - e.y, player.x - e.x);
          const spd = 180 + elapsed * 2;
          bullets.push({
            x: e.x, y: e.y + e.h / 2,
            vx: Math.cos(aim) * spd * 0.35,
            vy: Math.sin(aim) * spd * 0.55 + 120,
            from: 'enemy',
          });
        }
      }

      if (e.y > H + e.h) {
        enemies.splice(i, 1);
        continue;
      }

      if (rectsOverlap(
        { x: player.x, y: player.y, w: player.w * 0.7, h: player.h * 0.7 },
        { x: e.x, y: e.y, w: e.w * 0.8, h: e.h * 0.8 }
      )) {
        enemies.splice(i, 1);
        burst(e.x, e.y, e.color, 14, 200);
        AudioSys.explosion();
        hurtPlayer();
      }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.from === 'player') {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (Math.abs(b.x - e.x) < e.w / 2 + 4 && Math.abs(b.y - e.y) < e.h / 2 + 8) {
            bullets.splice(i, 1);
            e.hp -= b.power ? 2 : 1;
            burst(b.x, b.y, '#fff', 4, 80);
            if (e.hp <= 0) {
              score += e.pts;
              updateHud();
              AudioSys.explosion();
              burst(e.x, e.y, e.color, 20, 240);
              shake = Math.max(shake, 0.15);
              if (chance(0.12)) spawnPowerup(e.x, e.y);
              enemies.splice(j, 1);
            } else {
              AudioSys.hit();
            }
            break;
          }
        }
      } else if (player.invuln <= 0 &&
          Math.abs(b.x - player.x) < player.w * 0.35 &&
          Math.abs(b.y - player.y) < player.h * 0.4) {
        bullets.splice(i, 1);
        hurtPlayer();
      }
    }

    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy * dt;
      p.life += dt;
      if (p.y > H + 30) { powerups.splice(i, 1); continue; }
      if (Math.hypot(p.x - player.x, p.y - player.y) < p.r + 16) {
        AudioSys.powerup();
        if (p.type === 'rapid') player.rapid = Math.max(player.rapid, 8);
        else player.shield = Math.max(player.shield, 10);
        burst(p.x, p.y, p.type === 'rapid' ? '#ffd54f' : '#69f0ae', 14, 160);
        powerups.splice(i, 1);
      }
    }
  }

  function render(dt) {
    ctx.save();
    if (shake > 0 && state === STATE.PLAY) {
      const mag = shake * 8;
      ctx.translate((Math.random() - 0.5) * 2 * mag, (Math.random() - 0.5) * 2 * mag);
    }

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#050814');
    g.addColorStop(0.5, '#0a1530');
    g.addColorStop(1, '#0d1b3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    for (const s of stars) {
      s.y += (40 + s.z * 90) * dt;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
      s.tw += dt * 3;
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.tw));
      ctx.globalAlpha = a * Math.min(1, s.z);
      ctx.fillStyle = '#cfe8ff';
      const sz = s.z * 1.6;
      ctx.fillRect(s.x, s.y, sz, sz);
    }
    ctx.globalAlpha = 1;

    if (state === STATE.PLAY || state === STATE.OVER) {
      for (const b of bullets) drawBullet(b);
      for (const e of enemies) drawEnemy(e);
      for (const p of powerups) drawPowerup(p);
      if (state === STATE.PLAY || lives > 0) drawPlayer();
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (state === STATE.PLAY) {
        // particles already moved in update when not play; during play move here once
      }
      if (state === STATE.PLAY) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 40 * dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
      }
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * Math.max(0.2, p.life / p.max), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (state === STATE.PLAY) {
      let chipY = 48;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      if (player.rapid > 0) {
        ctx.fillStyle = 'rgba(255,213,79,0.85)';
        ctx.fillText(`连射 ${player.rapid.toFixed(1)}s`, 12, chipY);
        chipY += 16;
      }
      if (player.shield > 0) {
        ctx.fillStyle = 'rgba(105,240,174,0.85)';
        ctx.fillText(`护盾 ${player.shield.toFixed(1)}s`, 12, chipY);
      }
    }

    ctx.restore();
  }

  function loop(ts) {
    if (!lastTime) lastTime = ts;
    let dt = (ts - lastTime) / 1000;
    lastTime = ts;
    dt = Math.min(dt, 0.05);
    update(dt);
    render(dt);
    requestAnimationFrame(loop);
  }

  function startGame() {
    AudioSys.unlock();
    AudioSys.start();
    resize();
    resetGame();
    state = STATE.PLAY;
    overlay.classList.add('hidden');
    hud.classList.remove('hidden');
    finalScoreEl.classList.add('hidden');
  }

  startBtn.addEventListener('click', (e) => {
    e.preventDefault();
    AudioSys.unlock();
    startGame();
  });

  muteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    AudioSys.unlock();
    AudioSys.toggleMute();
  });

  const unlockOnce = () => {
    AudioSys.unlock();
    window.removeEventListener('pointerdown', unlockOnce);
    window.removeEventListener('keydown', unlockOnce);
  };
  window.addEventListener('pointerdown', unlockOnce);
  window.addEventListener('keydown', unlockOnce);

  resize();
  resetGame();
  state = STATE.MENU;
  particles = [];
  enemies = [];
  bullets = [];
  powerups = [];
  requestAnimationFrame(loop);
})();
