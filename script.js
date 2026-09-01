/**
 * 雷霆战机 Thunder Fighter
 * 重构自 space-game - 实现经典雷霆战机玩法
 * 特性：自动射击、多类型敌机、Boss战、武器系统、炸弹清屏、弹幕、道具、关卡
 */

// ===== 游戏配置 =====
const CONFIG = {
    // 玩家
    PLAYER_SPEED: 5,
    PLAYER_MAX_HEALTH: 100,
    PLAYER_INVINCIBLE_TIME: 90, // 被击中后无敌帧数

    // 子弹
    BULLET_SPEED: 14,
    ENEMY_BULLET_SPEED: 4,

    // 敌机基础速度
    ENEMY_BASE_SPEED: 1.2,

    // 生成
    SPAWN_INTERVAL_BASE: 55,
    SPAWN_INTERVAL_MIN: 20,

    // 道具掉落率
    DROP_RATE: 0.35,

    // 粒子
    MAX_PARTICLES: 120,

    // 武器类型
    WEAPON_TYPES: {
        STRAIGHT: { name: '直射', color: '#00e5ff', maxLevel: 5 },
        SPREAD: { name: '散射', color: '#d500f9', maxLevel: 5 },
        LASER: { name: '激光', color: '#00e676', maxLevel: 5 },
        MISSILE: { name: '导弹', color: '#ff9100', maxLevel: 5 }
    },

    // 敌机类型配置
    ENEMY_TYPES: {
        small: { width: 28, height: 28, hp: 8, speed: 2.2, score: 50, color: '#ff5252', shoot: false },
        medium: { width: 38, height: 38, hp: 25, speed: 1.4, score: 120, color: '#ff9100', shoot: true, shootInterval: 90 },
        large: { width: 56, height: 56, hp: 80, speed: 0.7, score: 300, color: '#ab47bc', shoot: true, shootInterval: 60 }
    }
};

// ===== 难度配置 =====
const DIFFICULTY_CONFIG = {
    easy: {
        name: '简单',
        desc: '敌机较弱，生命充足，适合新手',
        playerHealth: 150,
        playerBombs: 5,
        spawnIntervalMult: 1.6,   // 生成间隔倍率（越大越慢）
        enemySpeedMult: 0.7,       // 敌机速度倍率
        enemyHpMult: 0.6,          // 敌机血量倍率
        enemyBulletSpeedMult: 0.7, // 敌机子弹速度倍率
        enemyShootIntervalMult: 1.4, // 敌机射击间隔倍率
        dropRateMult: 1.3,         // 道具掉落率倍率
        bossHpMult: 0.7            // Boss血量倍率
    },
    normal: {
        name: '普通',
        desc: '标准挑战，适合大多数玩家',
        playerHealth: 100,
        playerBombs: 3,
        spawnIntervalMult: 1.0,
        enemySpeedMult: 1.0,
        enemyHpMult: 1.0,
        enemyBulletSpeedMult: 1.0,
        enemyShootIntervalMult: 1.0,
        dropRateMult: 1.0,
        bossHpMult: 1.0
    },
    hard: {
        name: '困难',
        desc: '敌机凶猛，弹幕密集，仅限高手',
        playerHealth: 70,
        playerBombs: 2,
        spawnIntervalMult: 0.65,
        enemySpeedMult: 1.4,
        enemyHpMult: 1.6,
        enemyBulletSpeedMult: 1.3,
        enemyShootIntervalMult: 0.7,
        dropRateMult: 0.7,
        bossHpMult: 1.5
    }
};

// ===== 音频系统 =====
class SoundSynth {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.lastShoot = 0;
        this.lastExplosion = 0;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.15;
            this.masterGain.connect(this.ctx.destination);
            this.initialized = true;
        } catch (e) { /* 音频不可用时静默 */ }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    playTone(freq, type, duration, vol = 0.1) {
        if (!this.ctx) return;
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playShoot() {
        const now = Date.now();
        if (now - this.lastShoot < 50) return;
        this.lastShoot = now;
        this.playTone(880, 'square', 0.05, 0.04);
    }

    playExplosion() {
        const now = Date.now();
        if (now - this.lastExplosion < 60) return;
        this.lastExplosion = now;
        this.playTone(120, 'sawtooth', 0.2, 0.12);
        this.playTone(80, 'triangle', 0.3, 0.08);
    }

    playPowerup() {
        this.playTone(523, 'sine', 0.1, 0.1);
        setTimeout(() => this.playTone(659, 'sine', 0.1, 0.1), 80);
        setTimeout(() => this.playTone(784, 'sine', 0.15, 0.1), 160);
    }

    playHit() {
        this.playTone(200, 'sawtooth', 0.1, 0.15);
    }

    playBomb() {
        this.playTone(60, 'sawtooth', 0.5, 0.2);
        this.playTone(100, 'square', 0.4, 0.15);
    }

    playBossWarning() {
        for (let i = 0; i < 3; i++) {
            setTimeout(() => this.playTone(440, 'square', 0.15, 0.12), i * 250);
        }
    }
}

// ===== 输入处理 =====
class InputHandler {
    constructor(game) {
        this.game = game;
        this.keys = new Set();
        this.pointerX = 0;
        this.pointerY = 0;
        this.pointerActive = false;
        this.inputMode = 'keyboard'; // keyboard / pointer
        this._bindEvents();
    }

    _bindEvents() {
        const canvas = this.game.canvas;

        // 键盘
        window.addEventListener('keydown', e => {
            const key = e.key.toLowerCase();
            if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key) || e.code === 'Space') {
                e.preventDefault();
            }
            if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
                this.inputMode = 'keyboard';
            }
            if (key === 'arrowup' || key === 'w') this.keys.add('up');
            else if (key === 'arrowdown' || key === 's') this.keys.add('down');
            else if (key === 'arrowleft' || key === 'a') this.keys.add('left');
            else if (key === 'arrowright' || key === 'd') this.keys.add('right');
            else if (key === 'b' || key === ' ' || e.code === 'Space') this.game.useBomb();
            else if (key === 'escape') this.game.togglePause();
        });

        window.addEventListener('keyup', e => {
            const key = e.key.toLowerCase();
            if (key === 'arrowup' || key === 'w') this.keys.delete('up');
            else if (key === 'arrowdown' || key === 's') this.keys.delete('down');
            else if (key === 'arrowleft' || key === 'a') this.keys.delete('left');
            else if (key === 'arrowright' || key === 'd') this.keys.delete('right');
        });

        window.addEventListener('blur', () => {
            this.keys.clear();
            this.pointerActive = false;
        });

        // 指针（鼠标/触摸）
        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * (canvas.width / rect.width),
                y: (clientY - rect.top) * (canvas.height / rect.height)
            };
        };

        canvas.addEventListener('mousedown', e => {
            this.inputMode = 'pointer';
            this.pointerActive = true;
            const pos = getPos(e);
            this.pointerX = pos.x;
            this.pointerY = pos.y;
        });

        canvas.addEventListener('mousemove', e => {
            if (this.pointerActive) {
                const pos = getPos(e);
                this.pointerX = pos.x;
                this.pointerY = pos.y;
            }
        });

        window.addEventListener('mouseup', () => { this.pointerActive = false; });

        // 触摸
        canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            this.inputMode = 'pointer';
            this.pointerActive = true;
            const pos = getPos(e);
            this.pointerX = pos.x;
            this.pointerY = pos.y;
        }, { passive: false });

        canvas.addEventListener('touchmove', e => {
            e.preventDefault();
            if (this.pointerActive) {
                const pos = getPos(e);
                this.pointerX = pos.x;
                this.pointerY = pos.y;
            }
        }, { passive: false });

        canvas.addEventListener('touchend', e => {
            e.preventDefault();
            this.pointerActive = false;
        }, { passive: false });
    }

    has(action) { return this.keys.has(action); }
}

// ===== 背景星星 =====
class Star {
    constructor(game) {
        this.game = game;
        this.reset(true);
    }

    reset(initial = false) {
        this.x = Math.random() * this.game.width;
        this.y = initial ? Math.random() * this.game.height : -5;
        this.size = Math.random() * 2 + 0.5;
        this.speed = Math.random() * 2 + 0.5;
        this.brightness = Math.random() * 0.5 + 0.3;
    }

    update() {
        this.y += this.speed;
        if (this.y > this.game.height) this.reset();
    }

    draw(ctx) {
        ctx.fillStyle = `rgba(255, 255, 255, ${this.brightness})`;
        ctx.fillRect(this.x, this.y, this.size, this.size);
    }
}

// ===== 粒子特效 =====
class Particle {
    constructor(game, x, y, color, type = 'circle') {
        this.game = game;
        this.x = x;
        this.y = y;
        this.color = color;
        this.type = type;
        this.markedForDeletion = false;
        this.life = 1.0;

        if (type === 'circle') {
            this.size = Math.random() * 4 + 2;
            this.vx = (Math.random() - 0.5) * 8;
            this.vy = (Math.random() - 0.5) * 8;
            this.decay = 0.03 + Math.random() * 0.02;
        } else if (type === 'ring') {
            this.size = 2;
            this.vx = 0;
            this.vy = 0;
            this.growSpeed = 5 + Math.random() * 3;
            this.decay = 0.05;
        } else if (type === 'spark') {
            this.size = Math.random() * 2 + 1;
            this.vx = (Math.random() - 0.5) * 12;
            this.vy = (Math.random() - 0.5) * 12;
            this.decay = 0.04;
        } else if (type === 'smoke') {
            this.size = Math.random() * 8 + 4;
            this.vx = (Math.random() - 0.5) * 2;
            this.vy = -Math.random() * 2 - 1;
            this.decay = 0.015;
        }
    }

    update() {
        if (this.type === 'ring') {
            this.size += this.growSpeed;
        } else {
            this.x += this.vx;
            this.y += this.vy;
            if (this.type === 'circle' || this.type === 'spark') {
                this.vx *= 0.96;
                this.vy *= 0.96;
            }
        }
        this.life -= this.decay;
        if (this.life <= 0) this.markedForDeletion = true;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        if (this.type === 'circle' || this.type === 'spark' || this.type === 'smoke') {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * (this.type === 'smoke' ? (2 - this.life) : 1), 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'ring') {
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 3 * this.life;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }
}

// ===== 玩家子弹 =====
class Bullet {
    constructor(game, x, y, vx, vy, damage, color, type = 'normal') {
        this.game = game;
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.damage = damage;
        this.color = color;
        this.type = type; // normal / laser / missile
        this.width = type === 'laser' ? 8 : 6;
        this.height = type === 'laser' ? 20 : 14;
        this.markedForDeletion = false;
        this.target = null;
        this.trail = [];
    }

    update() {
        // 导弹追踪
        if (this.type === 'missile') {
            if (!this.target || this.target.markedForDeletion) {
                this.target = this._findNearestEnemy();
            }
            if (this.target) {
                const dx = (this.target.x + this.target.width / 2) - this.x;
                const dy = (this.target.y + this.target.height / 2) - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    const turnSpeed = 0.15;
                    this.vx += (dx / dist) * turnSpeed * 2;
                    this.vy += (dy / dist) * turnSpeed * 2;
                    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    const maxSpeed = 10;
                    if (speed > maxSpeed) {
                        this.vx = (this.vx / speed) * maxSpeed;
                        this.vy = (this.vy / speed) * maxSpeed;
                    }
                }
            }
            // 导弹尾迹
            this.trail.push({ x: this.x, y: this.y, life: 1 });
            if (this.trail.length > 8) this.trail.shift();
            this.trail.forEach(t => t.life -= 0.12);
        }

        this.x += this.vx;
        this.y += this.vy;

        if (this.y < -30 || this.y > this.game.height + 30 ||
            this.x < -30 || this.x > this.game.width + 30) {
            this.markedForDeletion = true;
        }
    }

    _findNearestEnemy() {
        let nearest = null;
        let minDist = Infinity;
        for (const e of this.game.enemies) {
            if (e.markedForDeletion) continue;
            const dx = e.x + e.width / 2 - this.x;
            const dy = e.y + e.height / 2 - this.y;
            const dist = dx * dx + dy * dy;
            if (dist < minDist) {
                minDist = dist;
                nearest = e;
            }
        }
        return nearest;
    }

    draw(ctx) {
        ctx.save();

        // 导弹尾迹
        if (this.type === 'missile' && this.trail.length > 0) {
            this.trail.forEach(t => {
                if (t.life > 0) {
                    ctx.globalAlpha = t.life * 0.5;
                    ctx.fillStyle = '#ff9100';
                    ctx.beginPath();
                    ctx.arc(t.x, t.y, 3 * t.life, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
            ctx.globalAlpha = 1;
        }

        // 发光效果
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 8;

        if (this.type === 'laser') {
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x - this.width / 2, this.y, this.width, this.height);
            ctx.fillStyle = '#fff';
            ctx.fillRect(this.x - 2, this.y, 4, this.height);
        } else if (this.type === 'missile') {
            const angle = Math.atan2(this.vy, this.vx);
            ctx.translate(this.x, this.y);
            ctx.rotate(angle + Math.PI / 2);
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.moveTo(0, -8);
            ctx.lineTo(-4, 6);
            ctx.lineTo(4, 6);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0, -2, 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // 普通子弹 - 椭圆形
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.ellipse(this.x, this.y, this.width / 2, this.height / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.beginPath();
            ctx.ellipse(this.x, this.y - 2, this.width / 4, this.height / 3, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

// ===== 敌机子弹 =====
class EnemyBullet {
    constructor(game, x, y, vx, vy, color = '#ff5252', size = 6) {
        this.game = game;
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.size = size;
        this.width = size * 2;
        this.height = size * 2;
        this.markedForDeletion = false;
        this.angle = 0;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.angle += 0.1;
        if (this.y > this.game.height + 20 || this.y < -20 ||
            this.x < -20 || this.x > this.game.width + 20) {
            this.markedForDeletion = true;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // 外发光
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10;

        // 主体
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();

        // 内核
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, this.size * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

// ===== 道具 =====
class Item {
    constructor(game, x, y, type) {
        this.game = game;
        this.x = x;
        this.y = y;
        this.type = type; // powerup / shield / bomb / health / coin / weapon
        this.width = 24;
        this.height = 24;
        this.vy = 1.5;
        this.vx = 0;
        this.markedForDeletion = false;
        this.angle = 0;
        this.bobOffset = Math.random() * Math.PI * 2;

        const configs = {
            powerup: { color: '#d500f9', label: 'P' },
            shield: { color: '#00e5ff', label: 'S' },
            bomb: { color: '#ff9100', label: 'B' },
            health: { color: '#00e676', label: 'H' },
            coin: { color: '#ffd600', label: '$' },
            weapon: { color: '#ff5252', label: 'W' }
        };
        this.config = configs[type] || configs.coin;
    }

    update() {
        this.y += this.vy;
        this.x += Math.sin((this.y + this.bobOffset * 50) * 0.03) * 0.8;
        this.angle += 0.05;

        // 磁吸效果 - 玩家靠近时自动吸引
        const player = this.game.player;
        const dx = (player.x + player.width / 2) - (this.x + this.width / 2);
        const dy = (player.y + player.height / 2) - (this.y + this.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120 && this.type !== 'coin') {
            this.x += (dx / dist) * 3;
            this.y += (dy / dist) * 3;
        } else if (dist < 150 && this.type === 'coin') {
            this.x += (dx / dist) * 5;
            this.y += (dy / dist) * 5;
        }

        if (this.y > this.game.height + 30) this.markedForDeletion = true;
    }

    draw(ctx) {
        ctx.save();
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        // 外发光
        ctx.shadowColor = this.config.color;
        ctx.shadowBlur = 12;

        // 旋转的外框
        ctx.translate(cx, cy);
        ctx.rotate(this.angle);
        ctx.strokeStyle = this.config.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height);

        ctx.rotate(-this.angle);

        // 内部背景
        ctx.fillStyle = this.config.color + '40';
        ctx.fillRect(-this.width / 2 + 3, -this.height / 2 + 3, this.width - 6, this.height - 6);

        // 标签文字
        ctx.fillStyle = this.config.color;
        ctx.font = 'bold 14px Courier New';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.config.label, 0, 1);

        ctx.restore();
    }

    applyEffect(player) {
        switch (this.type) {
            case 'powerup':
                player.upgradeWeapon();
                break;
            case 'shield':
                player.activateShield();
                break;
            case 'bomb':
                player.addBomb();
                break;
            case 'health':
                player.heal(25);
                break;
            case 'coin':
                this.game.addCoins(10);
                break;
            case 'weapon':
                player.switchWeapon();
                break;
        }
    }
}

// ===== 玩家飞机 =====
class Player {
    constructor(game) {
        this.game = game;
        this.width = 40;
        this.height = 44;
        this.x = 0;
        this.y = 0;
        this.health = CONFIG.PLAYER_MAX_HEALTH;
        this.maxHealth = CONFIG.PLAYER_MAX_HEALTH;

        // 武器系统
        this.weaponType = 'STRAIGHT';
        this.weaponLevels = { STRAIGHT: 1, SPREAD: 1, LASER: 1, MISSILE: 1 };
        this.shootTimer = 0;

        // 道具
        this.bombs = 3;
        this.isShielded = false;
        this.shieldTimer = 0;
        this.invincibleTimer = 0;

        // 引擎火焰
        this.flameFrame = 0;
    }

    reset() {
        this.x = this.game.width / 2 - this.width / 2;
        this.y = this.game.height - 120;
        // 根据难度设置生命值和炸弹数
        const diff = this.game.difficultyMult || DIFFICULTY_CONFIG.normal;
        this.maxHealth = diff.playerHealth;
        this.health = this.maxHealth;
        this.weaponType = 'STRAIGHT';
        this.weaponLevels = { STRAIGHT: 1, SPREAD: 1, LASER: 1, MISSILE: 1 };
        this.bombs = diff.playerBombs;
        this.isShielded = false;
        this.shieldTimer = 0;
        this.invincibleTimer = 60;
        this.shootTimer = 0;
    }

    get weaponLevel() {
        return this.weaponLevels[this.weaponType];
    }

    upgradeWeapon() {
        const maxLv = CONFIG.WEAPON_TYPES[this.weaponType].maxLevel;
        if (this.weaponLevels[this.weaponType] < maxLv) {
            this.weaponLevels[this.weaponType]++;
            this.game.createParticles(this.x + this.width / 2, this.y, 12, '#d500f9', 'circle');
        } else {
            // 已满级给分数
            this.game.addScore(200);
        }
        this.game.updateUI();
    }

    switchWeapon() {
        const types = Object.keys(CONFIG.WEAPON_TYPES);
        const idx = types.indexOf(this.weaponType);
        this.weaponType = types[(idx + 1) % types.length];
        this.game.createParticles(this.x + this.width / 2, this.y, 15, CONFIG.WEAPON_TYPES[this.weaponType].color, 'ring');
        this.game.updateUI();
    }

    activateShield() {
        this.isShielded = true;
        this.shieldTimer = 420; // 7秒
    }

    addBomb() {
        if (this.bombs < 9) {
            this.bombs++;
            this.game.updateUI();
        } else {
            this.game.addScore(100);
        }
    }

    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
        this.game.createParticles(this.x + this.width / 2, this.y + this.height / 2, 8, '#00e676', 'circle');
        this.game.updateUI();
    }

    takeDamage(amount) {
        if (this.invincibleTimer > 0) return;
        if (this.isShielded) {
            this.isShielded = false;
            this.shieldTimer = 0;
            this.game.createParticles(this.x + this.width / 2, this.y + this.height / 2, 20, '#00e5ff', 'ring');
            this.game.shakeScreen(8);
            return;
        }
        this.health -= amount;
        this.invincibleTimer = CONFIG.PLAYER_INVINCIBLE_TIME;
        this.game.audio.playHit();
        this.game.shakeScreen(6);
        this.game.createParticles(this.x + this.width / 2, this.y + this.height / 2, 10, '#ff5252', 'spark');

        // 被击中武器降级
        if (this.weaponLevels[this.weaponType] > 1) {
            this.weaponLevels[this.weaponType]--;
        }

        if (this.health <= 0) {
            this.health = 0;
            this.game.endGame();
        }
        this.game.updateUI();
    }

    update() {
        const input = this.game.input;

        // 移动
        if (input.inputMode === 'pointer' && input.pointerActive) {
            const targetX = input.pointerX - this.width / 2;
            const targetY = input.pointerY - this.height / 2;
            const dx = targetX - this.x;
            const dy = targetY - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 2) {
                const speed = Math.min(dist * 0.25, CONFIG.PLAYER_SPEED * 1.5);
                this.x += (dx / dist) * speed;
                this.y += (dy / dist) * speed;
            }
        } else {
            let dx = 0, dy = 0;
            if (input.has('left')) dx -= 1;
            if (input.has('right')) dx += 1;
            if (input.has('up')) dy -= 1;
            if (input.has('down')) dy += 1;
            if (dx !== 0 || dy !== 0) {
                const len = Math.sqrt(dx * dx + dy * dy);
                this.x += (dx / len) * CONFIG.PLAYER_SPEED;
                this.y += (dy / len) * CONFIG.PLAYER_SPEED;
            }
        }

        // 边界限制
        this.x = Math.max(0, Math.min(this.game.width - this.width, this.x));
        this.y = Math.max(60, Math.min(this.game.height - this.height - 10, this.y));

        // 自动射击
        if (this.shootTimer <= 0) {
            this.fire();
            this.shootTimer = this._getShootInterval();
        }
        this.shootTimer--;

        // 计时器
        if (this.invincibleTimer > 0) this.invincibleTimer--;
        if (this.isShielded) {
            this.shieldTimer--;
            if (this.shieldTimer <= 0) this.isShielded = false;
        }

        this.flameFrame = (this.flameFrame + 1) % 6;
    }

    _getShootInterval() {
        const lv = this.weaponLevel;
        switch (this.weaponType) {
            case 'STRAIGHT': return Math.max(5, 12 - lv);
            case 'SPREAD': return Math.max(8, 16 - lv * 1.5);
            case 'LASER': return Math.max(4, 10 - lv);
            case 'MISSILE': return Math.max(15, 30 - lv * 3);
            default: return 10;
        }
    }

    fire() {
        const cx = this.x + this.width / 2;
        const cy = this.y;
        const lv = this.weaponLevel;
        const color = CONFIG.WEAPON_TYPES[this.weaponType].color;

        this.game.audio.playShoot();

        switch (this.weaponType) {
            case 'STRAIGHT': {
                // 直射：等级增加弹道数量
                const streams = Math.min(5, 1 + Math.floor((lv - 1) / 1));
                const spacing = 10;
                for (let i = 0; i < streams; i++) {
                    const offset = (i - (streams - 1) / 2) * spacing;
                    this.game.bullets.push(new Bullet(
                        this.game, cx + offset, cy, 0, -CONFIG.BULLET_SPEED,
                        3 + lv, color, 'normal'
                    ));
                }
                break;
            }
            case 'SPREAD': {
                // 散射：扇形，等级增加子弹数和角度
                const count = 3 + lv * 2;
                const maxAngle = 0.4 + lv * 0.08;
                for (let i = 0; i < count; i++) {
                    const t = count === 1 ? 0.5 : i / (count - 1);
                    const angle = -maxAngle + t * maxAngle * 2;
                    const vx = Math.sin(angle) * CONFIG.BULLET_SPEED * 0.7;
                    const vy = -Math.cos(angle) * CONFIG.BULLET_SPEED;
                    this.game.bullets.push(new Bullet(
                        this.game, cx, cy, vx, vy,
                        2 + lv * 0.5, color, 'normal'
                    ));
                }
                break;
            }
            case 'LASER': {
                // 激光：高速穿透感，等级增加数量和伤害
                const streams = Math.min(3, 1 + Math.floor((lv - 1) / 2));
                const spacing = 14;
                for (let i = 0; i < streams; i++) {
                    const offset = (i - (streams - 1) / 2) * spacing;
                    this.game.bullets.push(new Bullet(
                        this.game, cx + offset, cy, 0, -CONFIG.BULLET_SPEED * 1.5,
                        4 + lv * 1.5, color, 'laser'
                    ));
                }
                break;
            }
            case 'MISSILE': {
                // 导弹：追踪，等级增加数量
                const count = Math.min(4, 1 + Math.floor((lv - 1) / 1));
                for (let i = 0; i < count; i++) {
                    const side = i % 2 === 0 ? -1 : 1;
                    const offsetX = side * (8 + Math.floor(i / 2) * 6);
                    const offsetY = Math.floor(i / 2) * 5;
                    this.game.bullets.push(new Bullet(
                        this.game, cx + offsetX, cy + offsetY,
                        side * 2, -6,
                        8 + lv * 2, color, 'missile'
                    ));
                }
                break;
            }
        }
    }

    draw(ctx) {
        ctx.save();
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        // 无敌闪烁
        if (this.invincibleTimer > 0 && Math.floor(this.invincibleTimer / 4) % 2 === 0) {
            ctx.globalAlpha = 0.4;
        }

        // 引擎火焰
        const flameHeight = 12 + Math.sin(this.flameFrame) * 4;
        const gradient = ctx.createLinearGradient(cx, this.y + this.height, cx, this.y + this.height + flameHeight);
        gradient.addColorStop(0, '#00e5ff');
        gradient.addColorStop(0.5, '#2979ff');
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(cx - 6, this.y + this.height - 2);
        ctx.lineTo(cx, this.y + this.height + flameHeight);
        ctx.lineTo(cx + 6, this.y + this.height - 2);
        ctx.closePath();
        ctx.fill();

        // 两侧小引擎
        ctx.fillStyle = '#ff9100';
        ctx.beginPath();
        ctx.moveTo(cx - 14, this.y + this.height - 6);
        ctx.lineTo(cx - 12, this.y + this.height + 6 + Math.sin(this.flameFrame + 1) * 2);
        ctx.lineTo(cx - 10, this.y + this.height - 6);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + 10, this.y + this.height - 6);
        ctx.lineTo(cx + 12, this.y + this.height + 6 + Math.sin(this.flameFrame + 2) * 2);
        ctx.lineTo(cx + 14, this.y + this.height - 6);
        ctx.closePath();
        ctx.fill();

        // 机身 - 战斗机造型
        ctx.fillStyle = '#1a237e';
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.5;

        // 主机身
        ctx.beginPath();
        ctx.moveTo(cx, this.y);
        ctx.lineTo(cx - 5, this.y + 15);
        ctx.lineTo(cx - 8, this.y + this.height - 8);
        ctx.lineTo(cx + 8, this.y + this.height - 8);
        ctx.lineTo(cx + 5, this.y + 15);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 机翼
        ctx.fillStyle = '#283593';
        ctx.beginPath();
        ctx.moveTo(cx - 8, this.y + 18);
        ctx.lineTo(cx - this.width / 2, this.y + 30);
        ctx.lineTo(cx - this.width / 2, this.y + 36);
        ctx.lineTo(cx - 6, this.y + 32);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx + 8, this.y + 18);
        ctx.lineTo(cx + this.width / 2, this.y + 30);
        ctx.lineTo(cx + this.width / 2, this.y + 36);
        ctx.lineTo(cx + 6, this.y + 32);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 尾翼
        ctx.fillStyle = '#3949ab';
        ctx.beginPath();
        ctx.moveTo(cx - 4, this.y + this.height - 12);
        ctx.lineTo(cx - 12, this.y + this.height - 2);
        ctx.lineTo(cx - 4, this.y + this.height - 4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + 4, this.y + this.height - 12);
        ctx.lineTo(cx + 12, this.y + this.height - 2);
        ctx.lineTo(cx + 4, this.y + this.height - 4);
        ctx.closePath();
        ctx.fill();

        // 驾驶舱
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.ellipse(cx, this.y + 14, 4, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // 武器等级指示
        const weaponColor = CONFIG.WEAPON_TYPES[this.weaponType].color;
        ctx.fillStyle = weaponColor;
        ctx.shadowColor = weaponColor;
        ctx.shadowBlur = 6;
        for (let i = 0; i < this.weaponLevel; i++) {
            ctx.fillRect(cx - 10 + i * 5, this.y + this.height - 14, 3, 3);
        }
        ctx.shadowBlur = 0;

        // 护盾
        if (this.isShielded) {
            const shieldAlpha = 0.3 + Math.sin(Date.now() / 150) * 0.15;
            ctx.strokeStyle = `rgba(0, 229, 255, ${shieldAlpha + 0.3})`;
            ctx.fillStyle = `rgba(0, 229, 255, ${shieldAlpha * 0.3})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 34, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // 护盾六边形纹理
            ctx.strokeStyle = `rgba(0, 229, 255, ${shieldAlpha})`;
            ctx.lineWidth = 1;
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2 + Date.now() / 1000;
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
                ctx.lineTo(cx + Math.cos(a + 0.5) * 30, cy + Math.sin(a + 0.5) * 30);
                ctx.stroke();
            }
        }

        ctx.restore();
    }
}

// ===== 敌机基类 =====
class Enemy {
    constructor(game, x, y, type) {
        this.game = game;
        this.type = type;
        const config = CONFIG.ENEMY_TYPES[type];
        const diff = game.difficultyMult || DIFFICULTY_CONFIG.normal;
        this.width = config.width;
        this.height = config.height;
        this.x = x;
        this.y = y;
        this.maxHp = Math.round((config.hp + game.stage * 5) * diff.enemyHpMult);
        this.hp = this.maxHp;
        this.baseSpeed = config.speed * diff.enemySpeedMult;
        this.speed = this.baseSpeed;
        this.score = config.score;
        this.color = config.color;
        this.canShoot = config.shoot;
        this.shootInterval = Math.round((config.shootInterval || 90) * diff.enemyShootIntervalMult);
        this.shootTimer = Math.random() * this.shootInterval;
        this.markedForDeletion = false;
        this.hitFlash = 0;
        this.movePhase = Math.random() * Math.PI * 2;
        this.initialX = x;
    }

    takeDamage(damage) {
        this.hp -= damage;
        this.hitFlash = 4;
        if (this.hp <= 0) {
            this.markedForDeletion = true;
            this.onDeath();
        }
    }

    onDeath() {
        this.game.addScore(this.score);
        this.game.kills++;
        this.game.audio.playExplosion();
        this.game.createExplosion(this.x + this.width / 2, this.y + this.height / 2, this.color, this.type === 'large' ? 25 : 15);
        this.game.shakeScreen(this.type === 'large' ? 5 : 2);

        // 掉落道具（应用难度倍率）
        const dropMult = this.game.difficultyMult?.dropRateMult || 1;
        if (Math.random() < CONFIG.DROP_RATE * dropMult) {
            this.game.dropItem(this.x + this.width / 2, this.y + this.height / 2);
        }
        // 大型敌机必掉道具
        if (this.type === 'large' && Math.random() < 0.7 * dropMult) {
            this.game.dropItem(this.x + this.width / 2, this.y + this.height / 2);
        }
    }

    update() {
        // 移动模式
        this.movePhase += 0.02;
        if (this.type === 'small') {
            // 小型：直线或轻微摆动
            this.y += this.speed;
            this.x += Math.sin(this.movePhase) * 0.5;
        } else if (this.type === 'medium') {
            // 中型：S型移动
            this.y += this.speed * 0.8;
            this.x = this.initialX + Math.sin(this.movePhase * 1.5) * 60;
        } else if (this.type === 'large') {
            // 大型：慢速前进，到一定位置后悬停
            if (this.y < 80) {
                this.y += this.speed;
            } else {
                this.x += Math.sin(this.movePhase * 0.8) * 1.2;
            }
        }

        // 边界
        this.x = Math.max(0, Math.min(this.game.width - this.width, this.x));

        // 射击
        if (this.canShoot && this.y > 0) {
            this.shootTimer--;
            if (this.shootTimer <= 0) {
                this.shoot();
                this.shootTimer = this.shootInterval - this.game.stage * 3;
            }
        }

        if (this.hitFlash > 0) this.hitFlash--;
        if (this.y > this.game.height + 50) this.markedForDeletion = true;
    }

    shoot() {
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height;
        const bulletSpeed = CONFIG.ENEMY_BULLET_SPEED * (this.game.difficultyMult?.enemyBulletSpeedMult || 1);

        if (this.type === 'medium') {
            // 中型：单发瞄准玩家
            const player = this.game.player;
            const dx = (player.x + player.width / 2) - cx;
            const dy = (player.y + player.height / 2) - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0) {
                this.game.enemyBullets.push(new EnemyBullet(
                    this.game, cx, cy,
                    (dx / dist) * bulletSpeed, (dy / dist) * bulletSpeed,
                    '#ff9100', 5
                ));
            }
        } else if (this.type === 'large') {
            // 大型：三发扇形
            for (let i = -1; i <= 1; i++) {
                const angle = Math.PI / 2 + i * 0.3;
                this.game.enemyBullets.push(new EnemyBullet(
                    this.game, cx, cy,
                    Math.cos(angle) * bulletSpeed,
                    Math.sin(angle) * bulletSpeed,
                    '#ab47bc', 6
                ));
            }
        }
    }

    draw(ctx) {
        ctx.save();
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        // 受击闪白
        if (this.hitFlash > 0) {
            ctx.shadowColor = '#fff';
            ctx.shadowBlur = 20;
        }

        const drawColor = this.hitFlash > 0 ? '#fff' : this.color;

        if (this.type === 'small') {
            // 小型敌机 - 三角形战斗机
            ctx.fillStyle = drawColor;
            ctx.strokeStyle = this.hitFlash > 0 ? '#fff' : '#ff8a80';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx, this.y + this.height);
            ctx.lineTo(this.x, this.y);
            ctx.lineTo(cx, this.y + 8);
            ctx.lineTo(this.x + this.width, this.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            // 驾驶舱
            ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#b71c1c';
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'medium') {
            // 中型敌机 - 菱形攻击机
            ctx.fillStyle = drawColor;
            ctx.strokeStyle = this.hitFlash > 0 ? '#fff' : '#ffcc80';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx, this.y + this.height);
            ctx.lineTo(this.x, cy);
            ctx.lineTo(cx, this.y);
            ctx.lineTo(this.x + this.width, cy);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            // 机翼
            ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#e65100';
            ctx.beginPath();
            ctx.moveTo(this.x - 4, cy);
            ctx.lineTo(this.x + 6, cy - 6);
            ctx.lineTo(this.x + 6, cy + 6);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(this.x + this.width + 4, cy);
            ctx.lineTo(this.x + this.width - 6, cy - 6);
            ctx.lineTo(this.x + this.width - 6, cy + 6);
            ctx.closePath();
            ctx.fill();
            // 核心
            ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#ffeb3b';
            ctx.shadowColor = '#ffeb3b';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(cx, cy, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        } else if (this.type === 'large') {
            // 大型敌机 - 重型轰炸机
            ctx.fillStyle = drawColor;
            ctx.strokeStyle = this.hitFlash > 0 ? '#fff' : '#ce93d8';
            ctx.lineWidth = 2;
            // 主机身
            ctx.beginPath();
            ctx.moveTo(cx, this.y + this.height);
            ctx.lineTo(this.x + 8, this.y + this.height - 10);
            ctx.lineTo(this.x + 5, this.y + 15);
            ctx.lineTo(cx - 8, this.y);
            ctx.lineTo(cx + 8, this.y);
            ctx.lineTo(this.x + this.width - 5, this.y + 15);
            ctx.lineTo(this.x + this.width - 8, this.y + this.height - 10);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            // 机翼
            ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#6a1b9a';
            ctx.beginPath();
            ctx.moveTo(this.x + 5, this.y + 20);
            ctx.lineTo(this.x - 8, this.y + 35);
            ctx.lineTo(this.x + 8, this.y + 40);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(this.x + this.width - 5, this.y + 20);
            ctx.lineTo(this.x + this.width + 8, this.y + 35);
            ctx.lineTo(this.x + this.width - 8, this.y + 40);
            ctx.closePath();
            ctx.fill();
            // 引擎
            ctx.fillStyle = '#ff9100';
            ctx.shadowColor = '#ff9100';
            ctx.shadowBlur = 10;
            ctx.fillRect(cx - 12, this.y + this.height - 6, 6, 8);
            ctx.fillRect(cx + 6, this.y + this.height - 6, 6, 8);
            ctx.shadowBlur = 0;
            // 核心
            ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#e1bee7';
            ctx.shadowColor = '#e1bee7';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(cx, cy - 5, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // 血条（中型和大型）
        if (this.type !== 'small' && this.hp < this.maxHp) {
            const barWidth = this.width;
            const barHeight = 4;
            const barX = this.x;
            const barY = this.y - 8;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            ctx.fillStyle = this.hp / this.maxHp > 0.3 ? '#00e676' : '#ff5252';
            ctx.fillRect(barX, barY, barWidth * (this.hp / this.maxHp), barHeight);
        }

        ctx.restore();
    }
}

// ===== Boss =====
class Boss {
    constructor(game, stage) {
        this.game = game;
        this.stage = stage;
        this.type = 'boss';
        this.width = 140;
        this.height = 110;
        this.x = game.width / 2 - this.width / 2;
        this.y = -this.height - 20;
        this.targetY = 60;
        const bossHpMult = game.difficultyMult?.bossHpMult || 1;
        this.maxHp = Math.round((500 + stage * 300) * bossHpMult);
        this.hp = this.maxHp;
        this.score = 2000 + stage * 500;
        this.color = '#ff1744';
        this.markedForDeletion = false;
        this.hitFlash = 0;
        this.entering = true;

        // 攻击模式
        this.phase = 1; // 1: 正常, 2: 狂暴
        this.attackTimer = 0;
        this.attackPattern = 0;
        this.movePhase = 0;
        this.moveDirection = 1;

        this.names = ['钢铁要塞', '暗影猎鹰', '毁灭者', '虚空领主', '终极兵器'];
        this.name = this.names[Math.min(stage - 1, this.names.length - 1)];
    }

    takeDamage(damage) {
        if (this.entering) return;
        this.hp -= damage;
        this.hitFlash = 3;

        // 阶段转换
        if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
            this.phase = 2;
            this.game.createParticles(this.x + this.width / 2, this.y + this.height / 2, 30, '#ff1744', 'ring');
            this.game.shakeScreen(10);
        }

        if (this.hp <= 0) {
            this.hp = 0;
            this.markedForDeletion = true;
            this.onDeath();
        }
    }

    onDeath() {
        this.game.addScore(this.score);
        this.game.kills++;
        this.game.audio.playExplosion();
        this.game.bossDefeated();

        // 大爆炸
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                this.game.createExplosion(
                    cx + (Math.random() - 0.5) * 80,
                    cy + (Math.random() - 0.5) * 60,
                    ['#ff1744', '#ff9100', '#ffd600'][i % 3],
                    20
                );
            }, i * 150);
        }
        this.game.shakeScreen(15);

        // 掉落大量道具
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                this.game.dropItem(
                    cx + (Math.random() - 0.5) * 100,
                    cy + (Math.random() - 0.5) * 40
                );
            }, i * 100);
        }
    }

    update() {
        // 入场
        if (this.entering) {
            this.y += 1.5;
            if (this.y >= this.targetY) {
                this.y = this.targetY;
                this.entering = false;
            }
            return;
        }

        // 移动 - 左右巡航
        this.movePhase += 0.015;
        this.x += Math.sin(this.movePhase) * 1.5 * (this.phase === 2 ? 1.5 : 1);
        this.x = Math.max(10, Math.min(this.game.width - this.width - 10, this.x));

        // 攻击
        this.attackTimer++;
        const attackInterval = this.phase === 2 ? 40 : 60;
        if (this.attackTimer >= attackInterval) {
            this.attackTimer = 0;
            this.attackPattern = (this.attackPattern + 1) % 4;
            this.executeAttack();
        }

        if (this.hitFlash > 0) this.hitFlash--;
    }

    executeAttack() {
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height;
        const player = this.game.player;
        const px = player.x + player.width / 2;
        const py = player.y + player.height / 2;
        const bulletSpeed = CONFIG.ENEMY_BULLET_SPEED * (this.game.difficultyMult?.enemyBulletSpeedMult || 1);

        switch (this.attackPattern) {
            case 0: // 扇形弹幕
                const count = this.phase === 2 ? 12 : 8;
                for (let i = 0; i < count; i++) {
                    const angle = Math.PI / 2 - 0.6 + (i / (count - 1)) * 1.2;
                    this.game.enemyBullets.push(new EnemyBullet(
                        this.game, cx, cy,
                        Math.cos(angle) * bulletSpeed,
                        Math.sin(angle) * bulletSpeed,
                        '#ff5252', 6
                    ));
                }
                break;

            case 1: // 瞄准连射
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        if (this.markedForDeletion) return;
                        const dx = px - (this.x + this.width / 2);
                        const dy = py - (this.y + this.height);
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist > 0) {
                            this.game.enemyBullets.push(new EnemyBullet(
                                this.game, this.x + this.width / 2, this.y + this.height,
                                (dx / dist) * (bulletSpeed + 1),
                                (dy / dist) * (bulletSpeed + 1),
                                '#ff9100', 7
                            ));
                        }
                    }, i * 120);
                }
                break;

            case 2: // 环形弹幕
                const ringCount = this.phase === 2 ? 16 : 12;
                const ringSpeed = 3 * (this.game.difficultyMult?.enemyBulletSpeedMult || 1);
                for (let i = 0; i < ringCount; i++) {
                    const angle = (i / ringCount) * Math.PI * 2;
                    this.game.enemyBullets.push(new EnemyBullet(
                        this.game, cx, cy - 20,
                        Math.cos(angle) * ringSpeed,
                        Math.sin(angle) * ringSpeed,
                        '#d500f9', 5
                    ));
                }
                break;

            case 3: // 双侧弹幕雨
                for (let i = 0; i < 5; i++) {
                    this.game.enemyBullets.push(new EnemyBullet(
                        this.game, this.x + 15 + i * 25, cy,
                        (Math.random() - 0.5) * 2,
                        bulletSpeed * 0.8,
                        '#ff5252', 5
                    ));
                }
                break;
        }
    }

    draw(ctx) {
        ctx.save();
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        if (this.hitFlash > 0) {
            ctx.shadowColor = '#fff';
            ctx.shadowBlur = 30;
        }

        const mainColor = this.hitFlash > 0 ? '#fff' : (this.phase === 2 ? '#b71c1c' : '#880e4f');
        const accentColor = this.hitFlash > 0 ? '#fff' : '#ff1744';

        // 主体 - 巨型战舰
        ctx.fillStyle = mainColor;
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2;

        // 中央机身
        ctx.beginPath();
        ctx.moveTo(cx, this.y + this.height);
        ctx.lineTo(cx - 25, this.y + this.height - 20);
        ctx.lineTo(cx - 30, this.y + 25);
        ctx.lineTo(cx - 15, this.y);
        ctx.lineTo(cx + 15, this.y);
        ctx.lineTo(cx + 30, this.y + 25);
        ctx.lineTo(cx + 25, this.y + this.height - 20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 左翼
        ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#4a0072';
        ctx.beginPath();
        ctx.moveTo(cx - 30, this.y + 30);
        ctx.lineTo(this.x - 5, this.y + 50);
        ctx.lineTo(this.x, this.y + 75);
        ctx.lineTo(cx - 25, this.y + 70);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 右翼
        ctx.beginPath();
        ctx.moveTo(cx + 30, this.y + 30);
        ctx.lineTo(this.x + this.width + 5, this.y + 50);
        ctx.lineTo(this.x + this.width, this.y + 75);
        ctx.lineTo(cx + 25, this.y + 70);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 武器炮台
        ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#5d4037';
        ctx.fillRect(cx - 40, this.y + this.height - 25, 12, 20);
        ctx.fillRect(cx + 28, this.y + this.height - 25, 12, 20);
        ctx.fillRect(cx - 6, this.y + this.height - 15, 12, 18);

        // 引擎光
        ctx.fillStyle = '#ff9100';
        ctx.shadowColor = '#ff9100';
        ctx.shadowBlur = 15;
        const engineGlow = 8 + Math.sin(Date.now() / 100) * 3;
        ctx.fillRect(cx - 35, this.y + this.height - 5, 10, engineGlow);
        ctx.fillRect(cx + 25, this.y + this.height - 5, 10, engineGlow);
        ctx.fillRect(cx - 5, this.y + this.height, 10, engineGlow * 0.7);
        ctx.shadowBlur = 0;

        // 核心 - 狂暴时变红脉动
        const coreColor = this.phase === 2 ? '#ff1744' : '#ffd600';
        ctx.fillStyle = this.hitFlash > 0 ? '#fff' : coreColor;
        ctx.shadowColor = coreColor;
        ctx.shadowBlur = 20 + Math.sin(Date.now() / 150) * 8;
        ctx.beginPath();
        ctx.arc(cx, cy - 10, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, cy - 10, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // 装甲细节
        ctx.strokeStyle = this.hitFlash > 0 ? '#fff' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 20, this.y + 15);
        ctx.lineTo(cx - 25, this.y + this.height - 25);
        ctx.moveTo(cx + 20, this.y + 15);
        ctx.lineTo(cx + 25, this.y + this.height - 25);
        ctx.stroke();

        ctx.restore();
    }
}

// ===== 游戏主类 =====
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false });

        this.audio = new SoundSynth();
        this.audio.init();

        // 游戏状态
        this.gameOver = true;
        this.paused = false;
        this.score = 0;
        this.coins = 0;
        this.kills = 0;
        this.stage = 1;
        this.stageProgress = 0;
        this.stageTarget = 100;
        this.bossActive = false;
        this.boss = null;

        // 难度设置
        this.currentDifficulty = 'normal';
        this.difficultyMult = DIFFICULTY_CONFIG.normal;

        // 实体
        this.player = new Player(this);
        this.bullets = [];
        this.enemyBullets = [];
        this.enemies = [];
        this.items = [];
        this.particles = [];
        this.stars = [];

        // 生成
        this.spawnTimer = 0;
        this.stageTransition = false;

        // UI引用
        this.ui = {
            score: document.getElementById('score'),
            coins: document.getElementById('coins'),
            stageLabel: document.getElementById('stage-label'),
            stageProgress: document.getElementById('stage-progress'),
            weaponName: document.getElementById('weapon-name'),
            weaponLevel: document.getElementById('weapon-level'),
            bombCount: document.getElementById('bomb-count'),
            healthBar: document.getElementById('health-bar'),
            healthText: document.getElementById('health-text'),
            bossBar: document.getElementById('boss-bar'),
            bossName: document.getElementById('boss-name'),
            bossHealth: document.getElementById('boss-health'),
            startScreen: document.getElementById('start-screen'),
            pauseScreen: document.getElementById('pause-screen'),
            gameOverScreen: document.getElementById('game-over-screen'),
            finalScore: document.getElementById('final-score'),
            finalCoins: document.getElementById('final-coins'),
            finalStage: document.getElementById('final-stage'),
            finalKills: document.getElementById('final-kills'),
            stageBanner: document.getElementById('stage-banner'),
            bannerStage: document.getElementById('banner-stage'),
            bannerSub: document.getElementById('banner-sub'),
            bombFlash: document.getElementById('bomb-flash')
        };

        this._resize();
        window.addEventListener('resize', () => this._resize());

        this.input = new InputHandler(this);
        this._bindEvents();
        this._initStars();

        this._loop();
    }

    _resize() {
        const container = this.canvas.parentElement;
        this.width = this.canvas.width = container.clientWidth;
        this.height = this.canvas.height = container.clientHeight;
        if (this.stars && this.stars.length > 0) this._initStars();
    }

    _initStars() {
        this.stars = [];
        const count = Math.floor(this.width * this.height / 8000);
        for (let i = 0; i < count; i++) {
            this.stars.push(new Star(this));
        }
    }

    _bindEvents() {
        document.getElementById('start-btn').addEventListener('click', () => {
            this.audio.init();
            this.audio.resume();
            this.start();
        });
        document.getElementById('restart-btn').addEventListener('click', () => {
            this.audio.resume();
            this.start();
        });
        document.getElementById('resume-btn').addEventListener('click', () => this.togglePause());
        document.getElementById('quit-btn').addEventListener('click', () => this._quitToMenu());

        // 难度选择按钮
        const diffBtns = document.querySelectorAll('.difficulty-btn');
        const diffDesc = document.getElementById('difficulty-desc');
        diffBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                diffBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const diff = btn.dataset.difficulty;
                this.currentDifficulty = diff;
                if (diffDesc && DIFFICULTY_CONFIG[diff]) {
                    diffDesc.textContent = DIFFICULTY_CONFIG[diff].desc;
                }
            });
        });
    }

    _quitToMenu() {
        this.paused = false;
        this.gameOver = true;
        this.ui.pauseScreen.classList.add('hidden');
        this.ui.startScreen.classList.remove('hidden');
        this.ui.bossBar.classList.add('hidden');
    }

    start() {
        this.score = 0;
        this.coins = 0;
        this.kills = 0;
        this.stage = 1;
        this.stageProgress = 0;
        this.bossActive = false;
        this.boss = null;
        this.gameOver = false;
        this.paused = false;
        this.stageTransition = false;

        // 应用难度设置
        this.difficultyMult = DIFFICULTY_CONFIG[this.currentDifficulty] || DIFFICULTY_CONFIG.normal;

        this.player.reset();
        this.bullets = [];
        this.enemyBullets = [];
        this.enemies = [];
        this.items = [];
        this.particles = [];

        this.spawnTimer = 0;

        this.ui.startScreen.classList.add('hidden');
        this.ui.gameOverScreen.classList.add('hidden');
        this.ui.pauseScreen.classList.add('hidden');
        this.ui.bossBar.classList.add('hidden');

        this._showStageBanner('第 1 关', '准备战斗');
        this.updateUI();

        requestAnimationFrame(ts => this._animate(ts));
    }

    togglePause() {
        if (this.gameOver) return;
        this.paused = !this.paused;
        if (this.paused) {
            this.ui.pauseScreen.classList.remove('hidden');
        } else {
            this.ui.pauseScreen.classList.add('hidden');
            requestAnimationFrame(ts => this._animate(ts));
        }
    }

    endGame() {
        this.gameOver = true;
        this.audio.playExplosion();
        this.createExplosion(this.player.x + this.player.width / 2, this.player.y + this.player.height / 2, '#00e5ff', 40);
        this.shakeScreen(20);

        setTimeout(() => {
            this.ui.finalScore.textContent = this.score;
            this.ui.finalCoins.textContent = this.coins;
            this.ui.finalStage.textContent = `第 ${this.stage} 关`;
            this.ui.finalKills.textContent = this.kills;
            this.ui.gameOverScreen.classList.remove('hidden');
            this.ui.bossBar.classList.add('hidden');
        }, 800);
    }

    useBomb() {
        if (this.gameOver || this.paused) return;
        if (this.player.bombs <= 0) return;

        this.player.bombs--;
        this.audio.playBomb();
        this.shakeScreen(12);

        // 闪光效果
        this.ui.bombFlash.classList.remove('active');
        void this.ui.bombFlash.offsetWidth;
        this.ui.bombFlash.classList.add('active');

        // 清除所有敌机子弹
        for (const b of this.enemyBullets) {
            this.createParticles(b.x, b.y, 3, '#00e5ff', 'spark');
            b.markedForDeletion = true;
        }

        // 对所有敌机造成伤害
        for (const e of this.enemies) {
            e.takeDamage(50);
        }

        // 对Boss造成伤害
        if (this.boss && !this.boss.markedForDeletion) {
            this.boss.takeDamage(80);
        }

        // 爆炸粒子
        for (let i = 0; i < 30; i++) {
            this.createParticles(
                this.width / 2 + (Math.random() - 0.5) * this.width,
                this.height / 2 + (Math.random() - 0.5) * this.height,
                1, ['#00e5ff', '#fff', '#2979ff'][i % 3], 'ring'
            );
        }

        this.updateUI();
    }

    addScore(amount) {
        this.score += amount;
        this.updateUI();
    }

    addCoins(amount) {
        this.coins += amount;
        this.updateUI();
    }

    _showStageBanner(stage, sub) {
        this.ui.bannerStage.textContent = stage;
        this.ui.bannerSub.textContent = sub;
        this.ui.stageBanner.classList.remove('hidden');
        // 重启动画
        this.ui.stageBanner.style.animation = 'none';
        void this.ui.stageBanner.offsetWidth;
        this.ui.stageBanner.style.animation = '';
        setTimeout(() => this.ui.stageBanner.classList.add('hidden'), 2500);
    }

    _nextStage() {
        this.stage++;
        this.stageProgress = 0;
        this.bossActive = false;
        this.boss = null;
        this.stageTransition = false;
        this.ui.bossBar.classList.add('hidden');

        // 清理场上敌机和子弹
        this.enemies = [];
        this.enemyBullets = [];

        // 奖励
        this.player.heal(30);
        this.addScore(500);

        this._showStageBanner(`第 ${this.stage} 关`, this.stage % 3 === 0 ? '危险区域' : '继续前进');
        this.updateUI();
    }

    bossDefeated() {
        this.bossActive = false;
        this.boss = null;
        this.ui.bossBar.classList.add('hidden');
        this.stageTransition = true;
        setTimeout(() => this._nextStage(), 2000);
    }

    _spawnBoss() {
        this.bossActive = true;
        this.boss = new Boss(this, this.stage);
        this.enemies.push(this.boss);
        this.audio.playBossWarning();

        this.ui.bossName.textContent = this.boss.name;
        this.ui.bossBar.classList.remove('hidden');
        this.ui.bossHealth.style.width = '100%';

        this._showStageBanner('WARNING', 'BOSS 来袭');
    }

    _spawnSystem() {
        if (this.bossActive || this.stageTransition) return;

        // 关卡进度推进
        this.stageProgress += 0.08 + this.stage * 0.01;
        if (this.stageProgress >= this.stageTarget) {
            this.stageProgress = this.stageTarget;
            if (!this.bossActive) {
                this._spawnBoss();
            }
            return;
        }

        // 生成敌机（应用难度倍率）
        const diffMult = this.difficultyMult?.spawnIntervalMult || 1;
        const baseInterval = (CONFIG.SPAWN_INTERVAL_BASE - this.stage * 3) * diffMult;
        const interval = Math.max(CONFIG.SPAWN_INTERVAL_MIN, Math.round(baseInterval));

        this.spawnTimer++;
        if (this.spawnTimer >= interval) {
            this.spawnTimer = 0;
            this._spawnEnemy();
        }

        // 随机道具
        if (Math.random() < 0.003) {
            this.dropItem(Math.random() * this.width, -20);
        }
    }

    _spawnEnemy() {
        const rand = Math.random();
        let type;

        // 根据关卡调整敌机类型概率
        const largeChance = Math.min(0.15, 0.05 + this.stage * 0.02);
        const mediumChance = Math.min(0.4, 0.2 + this.stage * 0.03);

        if (rand < largeChance) type = 'large';
        else if (rand < largeChance + mediumChance) type = 'medium';
        else type = 'small';

        const config = CONFIG.ENEMY_TYPES[type];
        const x = Math.random() * (this.width - config.width);
        const y = -config.height - 10;

        this.enemies.push(new Enemy(this, x, y, type));

        // 高关卡时编队生成
        if (this.stage >= 2 && type === 'small' && Math.random() < 0.3) {
            for (let i = 1; i <= 2; i++) {
                const nx = Math.max(0, Math.min(this.width - config.width, x + i * 40));
                this.enemies.push(new Enemy(this, nx, y - i * 30, type));
            }
        }
    }

    dropItem(x, y) {
        const rand = Math.random();
        let type;

        if (rand < 0.3) type = 'coin';
        else if (rand < 0.5) type = 'powerup';
        else if (rand < 0.65) type = 'health';
        else if (rand < 0.78) type = 'shield';
        else if (rand < 0.9) type = 'bomb';
        else type = 'weapon';

        this.items.push(new Item(this, x - 12, y, type));
    }

    createParticles(x, y, count, color, type = 'circle') {
        if (this.particles.length > CONFIG.MAX_PARTICLES) return;
        for (let i = 0; i < count; i++) {
            this.particles.push(new Particle(this, x, y, color, type));
        }
    }

    createExplosion(x, y, color, count = 15) {
        this.createParticles(x, y, count, color, 'circle');
        this.createParticles(x, y, 3, '#fff', 'ring');
        this.createParticles(x, y, Math.floor(count / 2), '#ff9100', 'spark');
        this.createParticles(x, y, 5, 'rgba(100,100,100,0.6)', 'smoke');
    }

    shakeScreen(intensity) {
        if (Math.random() > 0.3) return;
        const x = (Math.random() - 0.5) * intensity;
        const y = (Math.random() - 0.5) * intensity;
        this.canvas.style.transform = `translate(${x}px, ${y}px)`;
        setTimeout(() => { this.canvas.style.transform = 'none'; }, 50);
    }

    _checkCollision(a, b, expand = 0) {
        return (
            a.x < b.x + b.width + expand &&
            a.x + a.width > b.x - expand &&
            a.y < b.y + b.height + expand &&
            a.y + a.height > b.y - expand
        );
    }

    updateUI() {
        this.ui.score.textContent = this.score;
        this.ui.coins.textContent = this.coins;
        this.ui.stageLabel.textContent = `第 ${this.stage} 关`;
        this.ui.stageProgress.style.width = `${(this.stageProgress / this.stageTarget) * 100}%`;

        const weaponConfig = CONFIG.WEAPON_TYPES[this.player.weaponType];
        this.ui.weaponName.textContent = weaponConfig.name;
        this.ui.weaponName.style.color = weaponConfig.color;
        this.ui.weaponLevel.textContent = `LV.${this.player.weaponLevel}`;

        this.ui.bombCount.textContent = this.player.bombs;

        // 生命值
        const healthPercent = (this.player.health / this.player.maxHealth) * 100;
        this.ui.healthBar.style.width = `${healthPercent}%`;
        this.ui.healthText.textContent = `${Math.ceil(this.player.health)} / ${this.player.maxHealth}`;
        this.ui.healthBar.classList.remove('low', 'critical');
        if (healthPercent <= 25) this.ui.healthBar.classList.add('critical');
        else if (healthPercent <= 50) this.ui.healthBar.classList.add('low');

        // Boss血条
        if (this.boss && !this.boss.markedForDeletion) {
            this.ui.bossHealth.style.width = `${(this.boss.hp / this.boss.maxHp) * 100}%`;
        }
    }

    _animate(timestamp) {
        if (this.gameOver || this.paused) return;

        // 背景
        this.ctx.fillStyle = 'rgba(5, 5, 20, 0.35)';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // 星星
        this.stars.forEach(star => {
            star.update();
            star.draw(this.ctx);
        });

        // 生成系统
        this._spawnSystem();

        // 玩家
        this.player.update();
        this.player.draw(this.ctx);

        // 玩家子弹
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.update();
            if (b.markedForDeletion) {
                this.bullets.splice(i, 1);
                continue;
            }
            b.draw(this.ctx);
        }

        // 敌机
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            e.update();
            if (e.markedForDeletion) {
                if (e === this.boss) this.boss = null;
                this.enemies.splice(i, 1);
                continue;
            }

            // 玩家子弹 vs 敌机
            for (let j = this.bullets.length - 1; j >= 0; j--) {
                const b = this.bullets[j];
                if (b.markedForDeletion) continue;
                if (this._checkCollision(b, e, 4)) {
                    b.markedForDeletion = true;
                    e.takeDamage(b.damage);
                    this.createParticles(b.x, b.y, 2, '#fff', 'spark');
                    break;
                }
            }

            // 敌机 vs 玩家
            if (!e.markedForDeletion && this._checkCollision(e, this.player, -5)) {
                this.player.takeDamage(e.type === 'large' ? 30 : (e.type === 'medium' ? 20 : 15));
                if (e.type !== 'boss') {
                    e.takeDamage(999);
                }
            }

            if (!e.markedForDeletion) e.draw(this.ctx);
        }

        // 敌机子弹
        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
            const b = this.enemyBullets[i];
            b.update();
            if (b.markedForDeletion) {
                this.enemyBullets.splice(i, 1);
                continue;
            }
            // 敌机子弹 vs 玩家
            if (this._checkCollision(b, this.player, -3)) {
                b.markedForDeletion = true;
                this.player.takeDamage(10);
                this.createParticles(b.x, b.y, 4, b.color, 'spark');
            }
            b.draw(this.ctx);
        }

        // 道具
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            item.update();
            if (item.markedForDeletion) {
                this.items.splice(i, 1);
                continue;
            }
            if (this._checkCollision(this.player, item, 8)) {
                item.applyEffect(this.player);
                item.markedForDeletion = true;
                this.createParticles(item.x + item.width / 2, item.y + item.height / 2, 6, item.config.color, 'circle');
                this.audio.playPowerup();
                this.addScore(10);
            }
            item.draw(this.ctx);
        }

        // 粒子
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.update();
            if (p.markedForDeletion) {
                this.particles.splice(i, 1);
                continue;
            }
            p.draw(this.ctx);
        }

        // 更新UI（每帧更新血条和Boss血条）
        if (this.boss) {
            this.ui.bossHealth.style.width = `${Math.max(0, (this.boss.hp / this.boss.maxHp) * 100)}%`;
        }

        requestAnimationFrame(ts => this._animate(ts));
    }

    _loop() {
        // 主菜单背景动画
        if (this.gameOver && !this.paused) {
            this.ctx.fillStyle = 'rgba(5, 5, 20, 0.2)';
            this.ctx.fillRect(0, 0, this.width, this.height);
            this.stars.forEach(star => {
                star.update();
                star.draw(this.ctx);
            });
        }
        requestAnimationFrame(() => this._loop());
    }
}

// ===== 启动 =====
window.addEventListener('load', () => {
    new Game();
});
