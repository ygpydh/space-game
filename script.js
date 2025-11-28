/**
 * Neon Apex v4.0 (Hitbox & Performance Overhaul)
 * Refactored by ygpydh - 2025
 * Optimization: Expanded Enemy Hitbox, Shrunk Player Hitbox, Normalized Movement
 */

const CONFIG = {
    PLAYER_SPEED: 2.0,        // 略微提升速度以匹配手感
    PLAYER_FOCUS_SPEED: 2.5,
    PLAYER_FRICTION: 0.85,
    BULLET_SPEED: 10.0,       // 子弹更快，减少延迟感
    ENEMY_BASE_SPEED: 1.5,
    SPAWN_RATE: 60,
    
    // --- 核心优化配置 ---
    HITBOX_EXPAND_ENEMY: 10,  // 敌人判定扩大 10px (更容易打中)
    HITBOX_SHRINK_PLAYER: 8   // 玩家判定缩小 8px (更难撞死)
};

// --- 音频系统 (保持不变) ---
class SoundSynth {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.2; 
        this.masterGain.connect(this.ctx.destination);
    }
    resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }

    playTone(freq, type, duration) {
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playShoot() {
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(900, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }
    playExplosion() { this.playTone(100, 'sawtooth', 0.15); }
    playPowerup() { 
        this.playTone(600, 'sine', 0.1);
        setTimeout(() => this.playTone(1200, 'sine', 0.2), 100);
    }
}

// --- 输入处理 ---
class InputHandler {
    constructor(game) {
        this.game = game;
        this.keys = new Set();
        this.inputType = 'KEYBOARD'; 
        this.mouseX = 0;
        this.mouseY = 0;
        this.mouseDown = false;

        // 键盘监听
        window.addEventListener('keydown', e => {
            const key = e.key.toLowerCase();
            const preventKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift'];
            
            if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)) {
                this.inputType = 'KEYBOARD';
            }

            if (preventKeys.includes(key) || e.code === 'Space') e.preventDefault();

            if (key === 'arrowup' || key === 'w') this.keys.add('up');
            else if (key === 'arrowdown' || key === 's') this.keys.add('down');
            else if (key === 'arrowleft' || key === 'a') this.keys.add('left');
            else if (key === 'arrowright' || key === 'd') this.keys.add('right');
            else if (key === ' ' || e.code === 'Space') this.keys.add('shoot');
            else if (key === 'shift') this.keys.add('focus');
            else if (key === 'escape') this.game.togglePause();
        });

        window.addEventListener('keyup', e => {
            const key = e.key.toLowerCase();
            if (key === 'arrowup' || key === 'w') this.keys.delete('up');
            else if (key === 'arrowdown' || key === 's') this.keys.delete('down');
            else if (key === 'arrowleft' || key === 'a') this.keys.delete('left');
            else if (key === 'arrowright' || key === 'd') this.keys.delete('right');
            else if (key === ' ' || e.code === 'Space') this.keys.delete('shoot');
            else if (key === 'shift') this.keys.delete('focus');
        });

        window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

        // 鼠标监听
        const canvas = game.canvas;
        canvas.style.cursor = 'crosshair';

        canvas.addEventListener('mousemove', e => {
            if (this.game.paused || this.game.gameOver) return;
            if (Math.abs(e.movementX) > 0 || Math.abs(e.movementY) > 0) {
                this.inputType = 'MOUSE';
                this.updateMousePos(e);
            }
        });

        canvas.addEventListener('mousedown', e => {
            this.inputType = 'MOUSE';
            this.mouseDown = true;
            this.updateMousePos(e);
        });
        
        canvas.addEventListener('mouseup', () => { this.mouseDown = false; });
    }

    updateMousePos(e) {
        const rect = this.game.canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
    }
    has(action) { return this.keys.has(action); }
}

// --- 游戏主类 ---
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false }); // 优化 Canvas 性能
        this.audio = new SoundSynth();
        
        this.score = 0;
        this.difficulty = 1;
        this.gameOver = true;
        this.paused = false;

        this.player = new Player(this);
        // 使用单个数组管理，减少切换开销，但为了逻辑清晰还是分开，但在更新时优化循环
        this.bullets = [];
        this.enemies = [];
        this.items = [];
        this.particles = [];
        this.stars = [];

        this.ui = {
            score: document.getElementById('score'),
            weaponLv: document.getElementById('weapon-level'),
            finalScore: document.getElementById('final-score'),
            startScreen: document.getElementById('start-screen'),
            pauseScreen: document.getElementById('pause-screen'),
            gameOverScreen: document.getElementById('game-over-screen'),
            startBtn: document.getElementById('start-btn'),
            restartBtn: document.getElementById('restart-btn'),
            resumeBtn: document.getElementById('resume-btn')
        };

        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.input = new InputHandler(this);
        this.bindEvents();
        this.initStars();
        this.loop();
    }

    resize() {
        this.width = this.canvas.width = this.canvas.parentElement.clientWidth;
        this.height = this.canvas.height = this.canvas.parentElement.clientHeight;
        if(this.stars) this.initStars();
    }

    initStars() {
        this.stars = [];
        for(let i=0; i<80; i++) {
            this.stars.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                size: Math.random() * 2,
                speed: Math.random() * 0.5 + 0.1
            });
        }
    }

    bindEvents() {
        const startGame = () => { this.audio.resume(); this.start(); };
        this.ui.startBtn.addEventListener('click', startGame);
        this.ui.restartBtn.addEventListener('click', startGame);
        this.ui.resumeBtn.addEventListener('click', () => this.togglePause());
    }

    start() {
        this.score = 0;
        this.difficulty = 1;
        this.gameOver = false;
        this.paused = false;
        this.player.reset();
        this.bullets = [];
        this.enemies = [];
        this.items = [];
        this.particles = [];
        
        this.ui.startScreen.classList.add('hidden');
        this.ui.gameOverScreen.classList.add('hidden');
        this.ui.pauseScreen.classList.add('hidden');
        this.updateUI();
        
        this.spawnTimer = 0;
        requestAnimationFrame(ts => this.animate(ts));
    }

    togglePause() {
        if(this.gameOver) return;
        this.paused = !this.paused;
        if(this.paused) this.ui.pauseScreen.classList.remove('hidden');
        else {
            this.ui.pauseScreen.classList.add('hidden');
            requestAnimationFrame(ts => this.animate(ts));
        }
    }

    endGame() {
        this.gameOver = true;
        this.audio.playExplosion();
        this.ui.finalScore.innerText = this.score;
        this.ui.gameOverScreen.classList.remove('hidden');
    }

    updateUI() {
        this.ui.score.innerText = this.score;
        const lv = this.player.weaponLevel;
        this.ui.weaponLv.innerText = lv >= 4 ? 'MAX' : 'LV.' + lv;
        this.ui.weaponLv.style.color = lv === 1 ? '#fff' : (lv === 4 ? '#d0f' : '#0ff');
    }

    shakeScreen(intensity) {
        const x = (Math.random() - 0.5) * intensity;
        const y = (Math.random() - 0.5) * intensity;
        this.canvas.style.transform = `translate(${x}px, ${y}px)`;
        setTimeout(() => this.canvas.style.transform = 'none', 50);
    }

    spawnSystem() {
        const rate = Math.max(25, CONFIG.SPAWN_RATE - (this.difficulty * 2));
        if (this.spawnTimer > rate) {
            const x = Math.random() * (this.width - 30);
            if (Math.random() < 0.9) this.enemies.push(new Enemy(this, x));
            else this.items.push(new Item(this, x, true));
            this.spawnTimer = 0;
        }
        this.spawnTimer++;
    }

    animate(timestamp) {
        if (this.gameOver || this.paused) return;
        this.difficulty += 0.0003;

        // 背景清理 (降低透明度制造拖尾效果，如果不想要拖尾，改 Alpha 为 1.0)
        this.ctx.fillStyle = 'rgba(5, 5, 5, 0.5)';
        this.ctx.fillRect(0, 0, this.width, this.height);
        
        // 星空
        this.ctx.fillStyle = '#fff';
        this.stars.forEach(star => {
            this.ctx.fillRect(star.x, star.y, star.size, star.size);
            star.y += star.speed * (this.difficulty + 2);
            if(star.y > this.height) { star.y = 0; star.x = Math.random() * this.width; }
        });

        this.spawnSystem();
        this.player.update();
        this.player.draw(this.ctx);

        // --- 核心性能优化：循环处理 ---
        
        // 1. 子弹更新
        for(let i = this.bullets.length - 1; i >= 0; i--) {
            let b = this.bullets[i];
            b.update();
            if(b.markedForDeletion) { this.bullets.splice(i, 1); continue; }
            b.draw(this.ctx);
        }

        // 2. 敌人更新 + 碰撞检测
        for(let i = this.enemies.length - 1; i >= 0; i--) {
            let e = this.enemies[i];
            e.update();
            if(e.markedForDeletion) { this.enemies.splice(i, 1); continue; }
            
            // 检测子弹 -> 敌人 (使用 expand 宽松判定)
            for (let j = 0; j < this.bullets.length; j++) {
                let b = this.bullets[j];
                if (!b.markedForDeletion && this.checkCollision(b, e, CONFIG.HITBOX_EXPAND_ENEMY)) {
                    b.markedForDeletion = true;
                    e.hp--;
                    if(e.hp <= 0) {
                        e.markedForDeletion = true;
                        this.createParticles(e.x+15, e.y+15, 8, e.color);
                        this.audio.playExplosion();
                        this.score += 10;
                        this.updateUI();
                        if(Math.random()<0.2) this.items.push(new Item(this, e.x, false));
                    } else {
                        this.createParticles(b.x, b.y, 2, '#fff');
                    }
                    break; // 子弹消失，不需要继续检测这个子弹
                }
            }

            // 检测 敌人 -> 玩家 (使用 shrink 严格判定)
            if(!e.markedForDeletion && this.checkCollision(e, this.player, -CONFIG.HITBOX_SHRINK_PLAYER)) {
                if(this.player.isShielded) {
                    e.markedForDeletion = true;
                    this.player.deactivateShield();
                    this.createParticles(e.x, e.y, 10, '#fff');
                    this.shakeScreen(5);
                } else {
                    this.createParticles(this.player.x, this.player.y, 40, '#0ff');
                    this.endGame();
                }
            }
            
            if(!e.markedForDeletion) e.draw(this.ctx);
        }

        // 3. 道具更新
        for(let i = this.items.length - 1; i >= 0; i--) {
            let item = this.items[i];
            item.update();
            if(item.markedForDeletion) { this.items.splice(i, 1); continue; }
            
            // 道具碰撞判定也宽松一点 (+5px)
            if(this.checkCollision(this.player, item, 5)) {
                item.applyEffect(this.player);
                item.markedForDeletion = true;
                this.createParticles(item.x, item.y, 6, item.color);
                this.score += 5;
                this.updateUI();
                this.audio.playPowerup();
            }
            item.draw(this.ctx);
        }

        // 4. 粒子更新
        for(let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.update();
            if(p.markedForDeletion) { this.particles.splice(i, 1); continue; }
            p.draw(this.ctx);
        }

        requestAnimationFrame(ts => this.animate(ts));
    }

    /**
     * 超级优化的碰撞检测
     * @param {Object} r1 实体1
     * @param {Object} r2 实体2
     * @param {Number} expand 扩大判定值 (正数=更容易打中，负数=更难被打中)
     */
    checkCollision(r1, r2, expand = 0) {
        return (
            r1.x < r2.x + r2.width + expand &&
            r1.x + r1.width > r2.x - expand &&
            r1.y < r2.y + r2.height + expand &&
            r1.y + r1.height > r2.y - expand
        );
    }

    createParticles(x, y, count, color) {
        for(let i=0; i<count; i++) this.particles.push(new Particle(this, x, y, color));
    }
}

// --- 实体类 (优化移动算法) ---
class Player {
    constructor(game) {
        this.game = game;
        this.width = 36; this.height = 36;
        this.x = 0; this.y = 0;
        this.speedX = 0; this.speedY = 0;
        this.weaponLevel = 1;
        this.shootTimer = 0;
        this.isShielded = false;
        this.shieldTimer = 0;
    }
    
    reset() {
        this.x = this.game.width/2 - this.width/2;
        this.y = this.game.height - 100;
        this.weaponLevel = 1;
        this.isShielded = false;
        this.speedX = 0; this.speedY = 0;
    }

    update() {
        const input = this.game.input;

        if (input.inputType === 'MOUSE') {
            const targetX = input.mouseX - this.width / 2;
            const targetY = input.mouseY - this.height / 2;
            this.x = targetX;
            this.y = targetY;
            this.speedX = 0; this.speedY = 0;
        } 
        else {
            const maxSpeed = input.has('focus') ? CONFIG.PLAYER_FOCUS_SPEED : CONFIG.PLAYER_SPEED;
            let dx = 0; let dy = 0;

            if (input.has('left')) dx -= 1;
            if (input.has('right')) dx += 1;
            if (input.has('up')) dy -= 1;
            if (input.has('down')) dy += 1;

            // 归一化向量 (解决斜着走更快的问题)
            if (dx !== 0 || dy !== 0) {
                const length = Math.sqrt(dx*dx + dy*dy);
                dx /= length;
                dy /= length;
                
                this.speedX = dx * maxSpeed;
                this.speedY = dy * maxSpeed;
            } else {
                this.speedX *= CONFIG.PLAYER_FRICTION;
                this.speedY *= CONFIG.PLAYER_FRICTION;
            }

            if (Math.abs(this.speedX) < 0.1) this.speedX = 0;
            if (Math.abs(this.speedY) < 0.1) this.speedY = 0;

            this.x += this.speedX;
            this.y += this.speedY;
        }

        // 边界限制
        this.x = Math.max(0, Math.min(this.game.width - this.width, this.x));
        this.y = Math.max(0, Math.min(this.game.height - this.height, this.y));

        const isShooting = input.has('shoot') || (input.inputType === 'MOUSE' && input.mouseDown);
        if (isShooting) {
            if (this.shootTimer <= 0) {
                this.fire();
                this.shootTimer = 10;
            }
        }
        if (this.shootTimer > 0) this.shootTimer--;
        if (this.isShielded) {
            this.shieldTimer--;
            if (this.shieldTimer <= 0) this.isShielded = false;
        }
    }

    fire() {
        this.game.audio.playShoot();
        const cx = this.x + this.width/2; const cy = this.y;
        this.game.bullets.push(new Bullet(this.game, cx, cy, 0));
        if (this.weaponLevel >= 2) {
             this.game.bullets.push(new Bullet(this.game, cx-12, cy+5, 0));
             this.game.bullets.push(new Bullet(this.game, cx+12, cy+5, 0));
        }
        if (this.weaponLevel >= 3) {
            this.game.bullets.push(new Bullet(this.game, cx, cy, -0.3));
            this.game.bullets.push(new Bullet(this.game, cx, cy, 0.3));
        }
        if (this.weaponLevel >= 4) {
             this.game.bullets.push(new Bullet(this.game, cx, cy, -0.6)); 
             this.game.bullets.push(new Bullet(this.game, cx, cy, 0.6)); 
        }
    }
    upgradeWeapon() {
        if(this.weaponLevel < 4) {
            this.weaponLevel++;
            this.game.createParticles(this.x+this.width/2, this.y, 15, '#d0f');
        } else this.game.score += 100;
    }
    activateShield() { this.isShielded = true; this.shieldTimer = 300; }
    deactivateShield() { this.isShielded = false; }
    draw(ctx) {
        ctx.save();
        ctx.shadowBlur = 10; ctx.shadowColor = '#0ff'; ctx.fillStyle = '#0ff';
        if(this.game.input.inputType === 'KEYBOARD' && this.game.input.has('focus')) {
            ctx.beginPath(); ctx.arc(this.x+this.width/2, this.y+this.height/2, 4, 0, Math.PI*2);
            ctx.fillStyle='#f00'; ctx.fill(); ctx.fillStyle='#0ff';
        }
        ctx.beginPath();
        ctx.moveTo(this.x+this.width/2, this.y);
        ctx.lineTo(this.x, this.y+this.height);
        ctx.lineTo(this.x+this.width/2, this.y+this.height-8);
        ctx.lineTo(this.x+this.width, this.y+this.height);
        ctx.closePath(); ctx.fill();
        if(this.isShielded) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${Math.abs(Math.sin(Date.now()/100))})`;
            ctx.lineWidth = 2; ctx.beginPath();
            ctx.arc(this.x+this.width/2, this.y+this.height/2, 32, 0, Math.PI*2); ctx.stroke();
        }
        ctx.restore();
    }
}

class Bullet {
    constructor(game, x, y, angle) {
        this.game = game; this.x = x-2; this.y = y;
        this.width = 6; // 稍微加宽子弹碰撞判定 (视觉可以保留4，但逻辑上宽一点)
        this.height = 14;
        this.speed = CONFIG.BULLET_SPEED; this.vx = angle * 4;
        this.markedForDeletion = false;
    }
    update() { this.y -= this.speed; this.x += this.vx; if(this.y < 0) this.markedForDeletion = true; }
    draw(ctx) { ctx.fillStyle = '#ff0'; ctx.fillRect(this.x, this.y, 4, this.height); } // 绘制时稍微细一点，看起来更锋利
}

class Enemy {
    constructor(game, x) {
        this.game = game; this.x = x; this.y = -40;
        this.width = 30; this.height = 30;
        this.speed = (Math.random()*0.5 + CONFIG.ENEMY_BASE_SPEED) * game.difficulty;
        this.color = '#f03'; this.markedForDeletion = false;
        this.hp = 2 + Math.floor(game.difficulty);
    }
    update() { this.y += this.speed; if(this.y > this.game.height) this.markedForDeletion = true; }
    draw(ctx) {
        ctx.shadowBlur = 8; ctx.shadowColor = this.color; ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.fillStyle = `rgba(0,0,0, ${0.5/this.hp})`;
        ctx.fillRect(this.x+5, this.y+5, this.width-10, this.height-10);
        ctx.shadowBlur = 0;
    }
}

class Item {
    constructor(game, x, random) {
        this.game = game; this.x = x; this.y = random ? -30 : game.player.y-50;
        if(!random) { this.x = Math.max(20, Math.min(game.width-20, x)); this.y = Math.max(20, y); }
        this.width = 18; this.height = 18;
        this.speed = 1.5;
        this.markedForDeletion = false;
        const r = Math.random();
        if(r<0.15) { this.type='SHIELD'; this.color='#fff'; }
        else if(r<0.4) { this.type='UPGRADE'; this.color='#d0f'; }
        else { this.type='SCORE'; this.color='#0aa'; }
    }
    update() { this.y += this.speed; this.x += Math.sin(this.y*0.05)*0.5; if(this.y > this.game.height) this.markedForDeletion = true; }
    draw(ctx) {
        ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = this.color; ctx.fillStyle = this.color;
        ctx.translate(this.x+this.width/2, this.y+this.height/2); ctx.rotate(Date.now()/150);
        if(this.type === 'UPGRADE') { ctx.fillRect(-8,-8,16,16); ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.strokeRect(-8,-8,16,16); }
        else if(this.type === 'SHIELD') { ctx.beginPath(); ctx.arc(0,0,9,0,Math.PI*2); ctx.fill(); }
        else { ctx.rotate(Math.PI/4); ctx.fillRect(-7,-7,14,14); }
        ctx.restore();
    }
    applyEffect(p) { if(this.type === 'UPGRADE') p.upgradeWeapon(); else if(this.type === 'SHIELD') p.activateShield(); }
}

class Particle {
    constructor(game, x, y, color) {
        this.game = game; this.x = x; this.y = y; this.size = Math.random()*3+2;
        this.speedX = Math.random()*6-3; this.speedY = Math.random()*6-3;
        this.color = color; this.markedForDeletion = false; this.life = 1.0;
    }
    update() { this.x += this.speedX; this.y += this.speedY; this.life -= 0.04; if(this.life<=0) this.markedForDeletion = true; }
    draw(ctx) { ctx.globalAlpha = this.life; ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha = 1.0; }
}

window.onload = () => { const game = new Game(); };