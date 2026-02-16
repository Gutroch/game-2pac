// ============================================================
//  GAME SCENE — CYBERPUNK ROBOT ARENA (Enhanced Edition)
// ============================================================
class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    init() {
        this.socket      = this.registry.get('socket');
        this.mapData     = this.registry.get('gameData').map;
        this.tileSize    = this.registry.get('gameData').tileSize;
        this.mode        = this.registry.get('gameData').mode;
        this.playerId    = this.registry.get('playerId');
        this.players     = {};
        this.bullets     = [];
        this.cursors     = null;
        this.powerups    = {};
        this.obstacles   = [];
        this.floatingTexts = [];
        this.maxAmmo = 6;
    }

    preload() { this._genTextures(); }

    _genTextures() {
        const g = this.make.graphics({ add: false });

        // Floor tile
        g.fillStyle(0x04090f); g.fillRect(0,0,32,32);
        g.lineStyle(1,0x0d2040,1); g.strokeRect(0,0,32,32);
        g.fillStyle(0x0a1e35,0.5); g.fillCircle(0,0,1.5); g.fillCircle(32,0,1.5); g.fillCircle(0,32,1.5); g.fillCircle(32,32,1.5);
        g.generateTexture('floor_tile',32,32); g.clear();

        // Wall tile
        g.fillStyle(0x0a0f18); g.fillRect(0,0,32,32);
        g.fillStyle(0x2255aa); g.fillRect(0,0,32,2);
        g.fillStyle(0x1a4488); g.fillRect(0,0,2,32);
        g.fillStyle(0x050810); g.fillRect(3,3,26,26);
        g.lineStyle(1,0x102040,1); g.lineBetween(6,6,26,6); g.lineBetween(6,16,26,16); g.lineBetween(6,26,26,26); g.lineBetween(6,6,6,26);
        g.generateTexture('wall_tile',32,32); g.clear();

        // Bullet
        g.fillStyle(0xff8800); g.fillCircle(5,5,5);
        g.fillStyle(0xffdd44); g.fillCircle(4,4,3);
        g.fillStyle(0xffffff); g.fillCircle(3,3,1.5);
        g.generateTexture('bullet',10,10); g.clear();

        // Laser
        g.fillStyle(0x00ffee); g.fillRect(0,1,18,4);
        g.fillStyle(0xffffff); g.fillRect(4,2,10,2);
        g.generateTexture('laser',18,6); g.clear();

        // Powerup heal
        g.fillStyle(0x003311); g.fillRect(0,0,18,18);
        g.fillStyle(0x00ff88); g.fillRect(7,2,4,14); g.fillRect(2,7,14,4);
        g.generateTexture('powerup_heal',18,18); g.clear();

        // Powerup speed
        g.fillStyle(0x001133); g.fillRect(0,0,18,18);
        g.fillStyle(0x33aaff); g.fillTriangle(10,1,4,10,9,10); g.fillTriangle(3,17,14,8,8,8);
        g.generateTexture('powerup_speed',18,18); g.clear();

        // Moving obstacle
        g.fillStyle(0x222233); g.fillRect(0,0,64,16);
        g.fillStyle(0x334466); g.fillRect(1,1,62,14);
        g.lineStyle(1,0x3366aa,1); for(let x=8;x<64;x+=8) g.lineBetween(x,0,x,16);
        g.generateTexture('moving_obs',64,16); g.clear();

        // Spark
        g.fillStyle(0xffaa00); g.fillRect(0,0,4,4);
        g.generateTexture('spark',4,4); g.clear();

        // Explosion particle
        g.fillStyle(0xff4400); g.fillCircle(3,3,3);
        g.generateTexture('explosion_p',6,6); g.clear();

        g.destroy();
    }

    create() {
        this._createBackground();
        this._createMap();
        this._setupParticles();
        this._setupInput();
        this._createHUD();
        this._setupSocket();
        this._createVignette();
    }

    _createBackground() {
        this.floorBg = this.add.tileSprite(0,0,640,480,'floor_tile').setOrigin(0).setDepth(0);
        const scan = this.make.graphics({ add: false });
        scan.fillStyle(0x000000,0.04);
        for(let y=0;y<480;y+=3) scan.fillRect(0,y,640,1);
        scan.generateTexture('scanlines',640,480); scan.destroy();
        this.add.image(0,0,'scanlines').setOrigin(0).setDepth(200).setAlpha(0.6);
    }

    _createMap() {
        for(let y=0;y<this.mapData.length;y++) {
            for(let x=0;x<this.mapData[0].length;x++) {
                if(this.mapData[y][x]===1) {
                    const wx=x*this.tileSize+16, wy=y*this.tileSize+16;
                    this.add.image(wx,wy,'wall_tile').setDepth(5);
                    this.add.ellipse(wx,wy,38,38,0x2255aa,0.1).setDepth(4);
                }
            }
        }
    }

    _setupParticles() {
        this.particleManager = this.add.particles(0,0,'spark',{
            speed:{min:30,max:140}, angle:{min:0,max:360},
            lifespan:{min:200,max:500}, scale:{start:1,end:0}, alpha:{start:1,end:0}, emitting:false
        }).setDepth(50);
        this.explosionManager = this.add.particles(0,0,'explosion_p',{
            speed:{min:60,max:250}, angle:{min:0,max:360},
            lifespan:{min:300,max:700}, scale:{start:1.5,end:0}, alpha:{start:1,end:0}, emitting:false
        }).setDepth(55);
    }

    _setupInput() {
        // Use explicit key mapping to ensure keys exist across platforms
        this.cursors = this.input.keyboard.addKeys({
            W: Phaser.Input.Keyboard.KeyCodes.W,
            A: Phaser.Input.Keyboard.KeyCodes.A,
            S: Phaser.Input.Keyboard.KeyCodes.S,
            D: Phaser.Input.Keyboard.KeyCodes.D
        });
        this.keyP = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
        this.keyN = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.N);
        this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
        this.input.on('pointerdown', (ptr) => { if(ptr.leftButtonDown()) this._tryShoot(); });
    }

    _tryShoot() {
        const s = this.players[this.playerId];
        if(s) {
            const dx = this.input.activePointer.worldX - s.x;
            const dy = this.input.activePointer.worldY - s.y;
            const len = Math.sqrt(dx*dx+dy*dy);
            if(len>0) this.socket.emit('shoot',{x:dx/len,y:dy/len});
        }
    }

    _createHUD() {
        const d=150;
        this.add.rectangle(0,0,640,36,0x000811,0.88).setOrigin(0,0).setDepth(d);
        this.add.rectangle(0,444,640,36,0x000811,0.88).setOrigin(0,0).setDepth(d);

        this.roundText = this.add.text(320,4,'ROUND 1',{fontFamily:'VT323, monospace',fontSize:'22px',color:'#00ddff'}).setOrigin(0.5,0).setDepth(d+1);
        this.scoreText = this.add.text(320,22,'',{fontFamily:'VT323, monospace',fontSize:'13px',color:'#88ccff'}).setOrigin(0.5,0).setDepth(d+1);
        this.timerText = this.add.text(600,4,'',{fontFamily:'VT323, monospace',fontSize:'20px',color:'#ffdd22'}).setOrigin(1,0).setDepth(d+1);

        this.add.text(12,449,'HP',{fontFamily:'VT323, monospace',fontSize:'16px',color:'#44ff88'}).setDepth(d+1);
        this.hpBarBg = this.add.rectangle(55,462,120,12,0x002211).setDepth(d+1);
        this.hpBar   = this.add.rectangle(55-60,462,120,12,0x00ff77).setOrigin(0,0.5).setDepth(d+2);
        this.hpText  = this.add.text(126,449,'100',{fontFamily:'VT323, monospace',fontSize:'16px',color:'#00ff77'}).setDepth(d+1);

        this.add.text(200,449,'AMMO',{fontFamily:'VT323, monospace',fontSize:'16px',color:'#ffaa33'}).setDepth(d+1);
        this.ammoText = this.add.text(255,449,'---',{fontFamily:'VT323, monospace',fontSize:'16px',color:'#ffdd22'}).setDepth(d+1);

        this.add.text(360,449,'SUPER',{fontFamily:'VT323, monospace',fontSize:'16px',color:'#ff88ff'}).setDepth(d+1);
        this.superText = this.add.text(412,449,'--',{fontFamily:'VT323, monospace',fontSize:'16px',color:'#ff88ff'}).setDepth(d+1);

        this.add.text(628,449,'WASD MOVE  CLICK/P SHOOT  N RELOAD',{fontFamily:'VT323, monospace',fontSize:'11px',color:'#336677'}).setOrigin(1,0).setDepth(d+1);

        // Clickable HUD buttons: Shoot, Reload, Super
        const btnStyle = { fontFamily:'VT323, monospace', fontSize:'12px', color:'#001122', backgroundColor:'#88ddff', padding:{x:8,y:6} };
        this.shootBtn = this.add.text(520,446,'SHOOT',btnStyle).setDepth(d+2).setInteractive({useHandCursor:true});
        this.shootBtn.on('pointerdown', ()=> this._tryShoot());

        this.reloadBtn = this.add.text(580,446,'RELOAD',Object.assign({},btnStyle,{backgroundColor:'#ffcc66',color:'#221100'})).setDepth(d+2).setInteractive({useHandCursor:true});
        this.reloadBtn.on('pointerdown', ()=> this.socket.emit('reload'));

        this.superBtn = this.add.text(640,446,'SUPER (E)',Object.assign({},btnStyle,{backgroundColor:'#ff88ff',color:'#220022'})).setDepth(d+2).setInteractive({useHandCursor:true}).setOrigin(1,0);
        this.superBtn.on('pointerdown', ()=> this.socket.emit('useSuper'));
    }

    _createVignette() {
        const vg=this.add.graphics().setDepth(180);
        const w=640,h=480;
        for(let i=0;i<28;i++) {
            const a=(i/28)*0.55;
            vg.fillStyle(0x000000,a);
            vg.fillRect(i,i,w-i*2,2); vg.fillRect(i,h-i-2,w-i*2,2);
            vg.fillRect(i,i,2,h-i*2); vg.fillRect(w-i-2,i,2,h-i*2);
        }
    }

    _setupSocket() {
        this.socket.on('gameState', (state) => this.updateGameState(state));

        this.socket.on('roundStart', (data) => {
            this.currentRound=data.roundNumber||1; this.scores=data.scores||{}; this.roundsToWin=data.roundsToWin||3;
            if(data.matchDurationMs) this.matchEnd=Date.now()+data.matchDurationMs;
            this._refreshRoundHUD();
            this._showToast('⚡ ROUND '+this.currentRound+' — FIGHT!',1800,'#00ddff');
        });

        this.socket.on('roundIntro', (data) => {
            const txt=this.add.text(320,220,data.instructions||'',{fontFamily:'VT323, monospace',fontSize:'15px',color:'#ffeeaa',align:'center',wordWrap:{width:560}}).setOrigin(0.5).setDepth(160);
            this.time.delayedCall(data.durationMs||3000,()=>txt.destroy());
        });

        this.socket.on('roundCountdown', (data) => {
            this._showToast('Round '+data.nextRound+' starts in '+data.seconds+'...',3000,'#ffdd22');
        });

        this.socket.on('roundEnded', (data) => {
            this.scores=data.scores||this.scores;
            this._showToast('🏆 '+(data.winner?'WINNER: '+data.winner:'DRAW'),2500,'#ffcc00');
            this._refreshRoundHUD();
        });

        this.socket.on('matchEnd', () => {
            this._showToast('MATCH OVER',3000,'#ff4466');
            this.time.delayedCall(3000,()=>this.scene.start('LobbyScene'));
        });

        this.socket.on('playerDied', (data) => {
            const c=this.players[data.playerId];
            if(c) {
                this._spawnDeathExplosion(c.x,c.y,c._primaryColor||0xff4400);
                this.cameras.main.shake(300,0.008);
                c.destroy(); delete this.players[data.playerId];
            }
        });

        this.socket.on('playerHit', (data) => {
            this.particleManager.emitParticleAt(data.x,data.y,8);
            this.cameras.main.shake(80,0.004);
            this._spawnFloatingText(data.x,data.y-10,'-'+(data.damage||''),'#ff4444');
        });

        // Server may send global effect events also handled above

        this.socket.on('powerupSpawned', (pu) => {
            if(this.powerups[pu.id]) return;
            const img=this.add.image(pu.x,pu.y,pu.type==='heal'?'powerup_heal':'powerup_speed').setDepth(8);
            this.tweens.add({targets:img,scaleX:{from:0.9,to:1.1},scaleY:{from:0.9,to:1.1},duration:700,ease:'Sine.easeInOut',yoyo:true,repeat:-1});
            const ring=this.add.ellipse(pu.x,pu.y,28,28,pu.type==='heal'?0x00ff88:0x33aaff,0.3).setDepth(7);
            this.tweens.add({targets:ring,alpha:{from:0.1,to:0.5},scaleX:{from:0.8,to:1.2},scaleY:{from:0.8,to:1.2},duration:900,ease:'Sine.easeInOut',yoyo:true,repeat:-1});
            img._ring=ring; this.powerups[pu.id]=img;
        });

        this.socket.on('powerupTaken', (data) => {
            const id=data.id;
            if(this.powerups[id]) {
                this.particleManager.emitParticleAt(this.powerups[id].x,this.powerups[id].y,10);
                if(this.powerups[id]._ring) this.powerups[id]._ring.destroy();
                this.powerups[id].destroy(); delete this.powerups[id];
            }
        });

        this.socket.on('globalEffect', (ev) => {
            // ev: { type, duration, source, target }
            if (ev.type === 'blind') {
                const overlay = this.add.rectangle(0,0,640,480,0x000000,0.95).setOrigin(0).setDepth(300);
                this.tweens.add({ targets: overlay, alpha: 0, duration: ev.duration*1000, delay: ev.duration*1000, onComplete: ()=>overlay.destroy() });
                // fade out quickly after duration
                this.time.delayedCall(ev.duration*1000, ()=>{
                    if (overlay?.active) this.tweens.add({ targets: overlay, alpha:0, duration:250, onComplete:()=>overlay.destroy() });
                });
            } else if (ev.type === 'freeze') {
                const txt = this.add.text(320,220,'FROZEN',{fontFamily:'VT323, monospace',fontSize:'36px',color:'#88ddff',backgroundColor:'#001022'}).setOrigin(0.5).setDepth(301);
                this.time.delayedCall(ev.duration*1000, ()=>{ if(txt?.active) txt.destroy(); });
                this.cameras.main.shake(200,0.002);
            } else if (ev.type === 'slow') {
                const txt = this.add.text(320,220,'SLOWED',{fontFamily:'VT323, monospace',fontSize:'36px',color:'#aaffee',backgroundColor:'#001022'}).setOrigin(0.5).setDepth(301);
                this.time.delayedCall(ev.duration*1000, ()=>{ if(txt?.active) txt.destroy(); });
            } else if (ev.type === 'shield') {
                const target = this.players[ev.target];
                if (target) {
                    const ring = this.add.ellipse(target.x, target.y, 40,40,0xffff88,0.25).setDepth(70);
                    this.tweens.add({ targets: ring, scaleX:1.2, scaleY:1.2, alpha:0, duration:ev.duration*1000, onComplete:()=>ring.destroy() });
                }
            }
        });

        this.socket.on('gameOver', (data) => {
            this._showToast('VINCITORE: '+data.winner,2500,'#ffcc00');
            this.time.delayedCall(2500,()=>this.scene.start('LobbyScene'));
        });

        this.socket.on('returnToLobby', () => this.scene.start('LobbyScene'));
    }

    update() {
        if(!this.cursors) return;
        if(this.floorBg) { this.floorBg.tilePositionX+=0.08; this.floorBg.tilePositionY+=0.04; }

        const k = this.cursors || {};
        this.socket.emit('gameInput',{
            left: !!(k.A && k.A.isDown), right: !!(k.D && k.D.isDown),
            up: !!(k.W && k.W.isDown),   down: !!(k.S && k.S.isDown)
        });

        if(Phaser.Input.Keyboard.JustDown(this.keyP)) this._tryShoot();
        if(Phaser.Input.Keyboard.JustDown(this.keyN)) this.socket.emit('reload');
        if(Phaser.Input.Keyboard.JustDown(this.keyE)) this.socket.emit('useSuper');

        if(this.matchEnd && this.timerText) {
            const ms=Math.max(0,this.matchEnd-Date.now()), sec=Math.floor(ms/1000);
            this.timerText.setText(Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'));
            this.timerText.setColor(sec<=10?'#ff4444':'#ffdd22');
        }

        this._animatePlayers();
        this.floatingTexts = this.floatingTexts.filter(t=>t.active);
    }

    _animatePlayers() {
        for(const id in this.players) {
            const c=this.players[id];
            if(!c||!c.active) continue;
            const dx=c.x-(c._prevX??c.x), dy=c.y-(c._prevY??c.y);
            const speed=Math.sqrt(dx*dx+dy*dy);
            c._walkT=(c._walkT||0);
            if(speed>0.5) {
                c._walkT+=0.18;
                const swing=Math.sin(c._walkT*6)*5;
                if(c._legL) c._legL.y=10+swing;
                if(c._legR) c._legR.y=10-swing;
                if(c._footL) c._footL.y=15+swing;
                if(c._footR) c._footR.y=15-swing;
                if(Math.random()<0.25) this.particleManager.emitParticleAt(c.x,c.y+12,1);
            } else {
                if(c._legL) c._legL.y=Phaser.Math.Linear(c._legL.y,10,0.15);
                if(c._legR) c._legR.y=Phaser.Math.Linear(c._legR.y,10,0.15);
                if(c._footL) c._footL.y=Phaser.Math.Linear(c._footL.y,15,0.15);
                if(c._footR) c._footR.y=Phaser.Math.Linear(c._footR.y,15,0.15);
            }
            c._prevX=c.x; c._prevY=c.y;
        }
    }

    updateGameState(state) {
        // ============================================================
        //  PLAYER UPDATE
        // ============================================================
        // Create or update players from server state
        for (const id in state.players) {
            const p = state.players[id];
            
            if (!this.players[id]) {
                // Player doesn't exist locally - create new robot
                this.players[id] = this._createRobot(p);
            } else {
                // Player exists - interpolate position and update visuals
                const c = this.players[id];
                
                // Smooth movement interpolation (28% of distance per frame)
                c.x = Phaser.Math.Linear(c.x, p.x, 0.28);
                c.y = Phaser.Math.Linear(c.y, p.y, 0.28);
                
                // Update HP bar (max HP = 5)
                if (c._hpBar) {
                    const pct = Math.max(0, Math.min(1, p.hp / 5));
                    c._hpBar.width = pct * 26;
                    c._hpBar.x = -13; // Keep centered
                    c._hpBar.fillColor = pct > 0.5 ? 0x00ff77 : (pct > 0.25 ? 0xffaa00 : 0xff3300);
                    
                    // Flash visor when taking damage
                    if (c._lastHp !== undefined && p.hp < c._lastHp) {
                        if (c._visor) {
                            this.tweens.add({
                                targets: c._visor,
                                alpha: { from: 1, to: 0.1 },
                                duration: 70,
                                yoyo: true,
                                repeat: 2
                            });
                        }
                        // Spawn hit particles
                        this.particleManager.emitParticleAt(p.x, p.y, 5);
                    }
                    c._lastHp = p.hp;
                }
                // Update shield/frozen visuals
                // Shield (invulnerable)
                if (p.invulnerable && p.invulnerable > 0) {
                    if (!c._shieldRing) {
                        c._shieldRing = this.add.ellipse(0, -4, 48, 48, 0xffff88, 0.25).setDepth(21);
                        c.add(c._shieldRing);
                    }
                    // simple pulse
                    c._shieldRing.alpha = 0.45;
                } else {
                    if (c._shieldRing) { c._shieldRing.destroy(); c._shieldRing = null; }
                }

                // Frost (frozen)
                if (p.frozen && p.frozen > 0) {
                    if (!c._frostOverlay) {
                        c._frostOverlay = this.add.rectangle(0, -4, 48, 48, 0x99ccff, 0.18).setDepth(22);
                        c.add(c._frostOverlay);
                    }
                    // slight tint effect: lower alpha when nearing end
                    // we can't access exact timer here, keep static
                } else {
                    if (c._frostOverlay) { c._frostOverlay.destroy(); c._frostOverlay = null; }
                }
            }
        }
        
        // Remove players that no longer exist on server (died/disconnected)
        for (const id in this.players) {
            if (!state.players[id]) {
                if (this.players[id]?.active) {
                    // Spawn death effect before destroying
                    const player = this.players[id];
                    this._spawnDeathExplosion(player.x, player.y, player._primaryColor || 0xff4400);
                    player.destroy();
                }
                delete this.players[id];
            }
        }

        // ============================================================
        //  BULLETS UPDATE
        // ============================================================
        // Clear old bullets
        this.bullets.forEach(b => b?.destroy());
        this.bullets = [];
        
        // Create new bullets from server state (render below obstacles so moving walls act as cover)
        for (const b of state.bullets) {
            const isLaser = b.type === 'laser';
            
            // Bullet sprite
            const bulletImg = this.add.image(b.x, b.y, isLaser ? 'laser' : 'bullet')
                .setDepth(12)
                .setBlendMode(Phaser.BlendModes.ADD);
            
            // Rotate laser to face direction
            if (isLaser && b.vx !== undefined && b.vy !== undefined) {
                bulletImg.setRotation(Math.atan2(b.vy, b.vx));
            }
            
            // Glow effect
            const glowSize = isLaser ? { w: 20, h: 8 } : { w: 14, h: 14 };
            const glowColor = isLaser ? 0x00ffee : 0xff8800;
            const glow = this.add.ellipse(b.x, b.y, glowSize.w, glowSize.h, glowColor, 0.35)
                .setDepth(11)
                .setBlendMode(Phaser.BlendModes.ADD);
            
            this.bullets.push(bulletImg, glow);
        }

        // ============================================================
        //  POWERUPS UPDATE
        // ============================================================
        // Create a Set of powerup IDs that exist on server
        const serverPowerupIds = new Set((state.powerups || []).map(p => p.id));
        
        // Remove powerups that no longer exist on server
        for (const id in this.powerups) {
            if (!serverPowerupIds.has(parseInt(id))) {
                if (this.powerups[id]?._ring) {
                    this.powerups[id]._ring.destroy();
                }
                this.powerups[id]?.destroy();
                delete this.powerups[id];
            }
        }
        
        // Note: New powerups are created via 'powerupSpawned' event, not here
        // The server sends 'powerupSpawned' separately for visual effects

        // ============================================================
        //  OBSTACLES UPDATE
        // ============================================================
        // Clear old obstacles
        this.obstacles.forEach(o => o?.destroy());
        this.obstacles = [];
        
        // Create new obstacles from server state (render above bullets so they act as cover)
        for (const obs of (state.obstacles || [])) {
            const obstacleImg = this.add.image(
                obs.x + obs.w / 2,
                obs.y + obs.h / 2,
                'moving_obs'
            )
            .setDisplaySize(obs.w, obs.h)
            .setDepth(15);
            
            this.obstacles.push(obstacleImg);
        }

        // ============================================================
        //  PLAYER HUD (MY STATS)
        // ============================================================
        const me = state.players?.[this.playerId];
        
        if (me) {
            // Update HP bar (max HP = 5)
            const hpPercent = Math.max(0, Math.min(1, me.hp / 5));
            if (this.hpBar) {
                this.hpBar.width = 120 * hpPercent;
                this.hpBar.fillColor = hpPercent > 0.5 ? 0x00ff77 : (hpPercent > 0.25 ? 0xffaa00 : 0xff3300);
            }
            if (this.hpText) {
                this.hpText.setText(me.hp);
            }
            
            // Update ammo display
            if (this.ammoText) {
                const isReloading = me.reloadTimer && me.reloadTimer > 0;
                if (isReloading) {
                    this.ammoText.setText('⟳ RELOAD');
                    this.ammoText.setColor('#ff8833');
                } else {
                    this.ammoText.setText(`${me.ammo ?? '─'} / ${this.maxAmmo || 6}`);
                    this.ammoText.setColor('#ffdd22');
                }
            }
            if (this.superText) {
                const cd = Math.max(0, Math.ceil((me.superCooldown || 0)));
                this.superText.setText(cd > 0 ? `${cd}s` : 'READY');
                this.superText.setColor(cd > 0 ? '#ff88ff' : '#88ff88');
            }
        } else {
            // Player is dead or not in game - show empty stats
            if (this.hpBar) this.hpBar.width = 0;
            if (this.hpText) this.hpText.setText('0');
            if (this.ammoText) {
                this.ammoText.setText('──');
                this.ammoText.setColor('#446677');
            }
        }

        // ============================================================
        //  ROUND/TIMER UPDATE (optional, from server)
        // ============================================================
        if (state.roundNumber !== undefined && this.roundText) {
            this.roundText.setText(`ROUND ${state.roundNumber}`);
        }
        
        if (state.scores && this.scoreText) {
            this._refreshRoundHUD(); // This uses this.scores, which should be updated elsewhere
        }
    }

    _createRobot(p) {
        const c=this.add.container(p.x,p.y).setDepth(20);
        const cd=this._getPlayerColor(p);
        const pColor=cd.primary, sColor=cd.secondary;
        c._primaryColor=pColor;

        // Shadow
        const shadow=this.add.ellipse(0,16,26,8,0x000000,0.5);
        // Legs
        const legL=this.add.rectangle(-5,10,6,9,0x1a1a2e);
        const legR=this.add.rectangle(5,10,6,9,0x1a1a2e);
        const jL=this.add.rectangle(-5,9,4,2,pColor); jL.setAlpha(0.6);
        const jR=this.add.rectangle(5,9,4,2,pColor); jR.setAlpha(0.6);
        const footL=this.add.rectangle(-5,15,8,3,0x111122);
        const footR=this.add.rectangle(5,15,8,3,0x111122);
        // Arms
        const armL=this.add.rectangle(-12,0,5,8,0x111122); armL.setStrokeStyle(1,pColor,0.4);
        const armR=this.add.rectangle(12,0,5,8,0x111122); armR.setStrokeStyle(1,pColor,0.4);
        // Body
        const body=this.add.rectangle(0,-1,20,12,0x0d1525); body.setStrokeStyle(1,sColor,0.8);
        const chest=this.add.ellipse(0,-1,10,10,pColor,0.4); chest.setBlendMode(Phaser.BlendModes.ADD);
        // Head
        const head=this.add.rectangle(0,-12,16,10,0x0d1525); head.setStrokeStyle(1,sColor,0.7);
        const visor=this.add.rectangle(0,-12,12,7,pColor); visor.setAlpha(0.85); visor.setBlendMode(Phaser.BlendModes.ADD);
        const eyeL=this.add.rectangle(-3,-13,3,3,0xffffff); eyeL.setAlpha(0.9);
        const eyeR=this.add.rectangle(3,-13,3,3,0xffffff); eyeR.setAlpha(0.9);
        // Antenna
        const antS=this.add.rectangle(0,-19,2,6,0x445566);
        const antT=this.add.ellipse(0,-22,5,5,pColor,0.95); antT.setBlendMode(Phaser.BlendModes.ADD);
        // Name
        const nameTag=this.add.text(0,-32,p.nickname||'',{fontFamily:'VT323, monospace',fontSize:'11px',color:'#'+pColor.toString(16).padStart(6,'0'),stroke:'#000011',strokeThickness:2}).setOrigin(0.5,1);
        // HP bar
        const hpBg=this.add.rectangle(0,-28,28,4,0x001100);
        const hpBar=this.add.rectangle(-13,-28,26,4,0x00ff77).setOrigin(0,0.5);

        c.add([shadow,legL,legR,jL,jR,footL,footR,armL,armR,body,chest,head,visor,eyeL,eyeR,antS,antT,hpBg,hpBar,nameTag]);

        c._legL=legL; c._legR=legR; c._footL=footL; c._footR=footR;
        c._body=body; c._head=head; c._visor=visor; c._hpBar=hpBar; c._lastHp=p.hp;

        // Status overlays (shield/frost)
        c._shieldRing = null;
        c._frostOverlay = null;

        // Antenna pulse
        this.tweens.add({targets:antT,alpha:{from:0.5,to:1},scale:{from:0.7,to:1.3},duration:900+Math.random()*400,ease:'Sine.easeInOut',yoyo:true,repeat:-1});
        // Chest pulse
        this.tweens.add({targets:chest,alpha:{from:0.2,to:0.6},duration:1100+Math.random()*300,ease:'Sine.easeInOut',yoyo:true,repeat:-1});
        // Eye blink
        this.time.addEvent({delay:2500+Math.random()*2000,loop:true,callback:()=>{
            if(!c.active) return;
            this.tweens.add({targets:[eyeL,eyeR],scaleY:{from:1,to:0.05},duration:60,yoyo:true});
        }});

        // Spawn pop
        this.tweens.add({targets:c,scaleX:{from:0,to:1},scaleY:{from:0,to:1},alpha:{from:0,to:1},duration:280,ease:'Back.easeOut'});
        return c;
    }

    _getPlayerColor(p) {
        const COLORS={
            pc_blue:{primary:0x22aaff,secondary:0x0055aa},
            pc_red:{primary:0xff3344,secondary:0xaa0011},
            pc_green:{primary:0x22ffaa,secondary:0x008844},
            pc_yellow:{primary:0xffdd22,secondary:0xaa8800},
        };
        if(p.character && COLORS[p.character]) return COLORS[p.character];
        if(p.team==='blue') return COLORS.pc_blue;
        if(p.team==='red') return COLORS.pc_red;
        if(p.team==='green') return COLORS.pc_green;
        if(p.team==='yellow') return COLORS.pc_yellow;
        return COLORS.pc_blue;
    }

    _spawnDeathExplosion(x,y,color) {
        this.explosionManager.setParticleTint(color);
        this.explosionManager.emitParticleAt(x,y,20);
        this.particleManager.emitParticleAt(x,y,15);
        const ring=this.add.ellipse(x,y,10,10,color,0.9).setDepth(60).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({targets:ring,scaleX:6,scaleY:6,alpha:0,duration:500,ease:'Quad.easeOut',onComplete:()=>ring.destroy()});
        const flash=this.add.rectangle(0,0,640,480,0xffffff,0.12).setOrigin(0).setDepth(190);
        this.tweens.add({targets:flash,alpha:0,duration:200,onComplete:()=>flash.destroy()});
    }

    _spawnFloatingText(x,y,text,color='#ffffff') {
        const t=this.add.text(x,y,text,{fontFamily:'VT323, monospace',fontSize:'16px',color,stroke:'#000000',strokeThickness:3}).setOrigin(0.5,1).setDepth(80);
        this.tweens.add({targets:t,y:y-40,alpha:0,duration:1000,ease:'Quad.easeOut',onComplete:()=>t.destroy()});
        this.floatingTexts.push(t);
    }

    _refreshRoundHUD() {
        if(this.roundText) this.roundText.setText('ROUND '+(this.currentRound||1));
        if(this.scoreText) {
            const rw=this.roundsToWin||3;
            let s='';
            if(this.mode==='teamDM') {
                s='BLUE '+(this.scores?.blue||0)+' vs '+(this.scores?.red||0)+' RED  (first to '+rw+')';
            } else {
                s=Object.entries(this.scores||{}).map(([k,v])=>k+': '+v).join('  |  ');
            }
            this.scoreText.setText(s);
        }
    }

    _showToast(text,ms=2000,color='#ffffff') {
        if(this._toast?.active) this._toast.destroy();
        this._toast=this.add.text(320,430,text,{fontFamily:'VT323, monospace',fontSize:'18px',color,backgroundColor:'#000811',padding:{x:16,y:8},stroke:color,strokeThickness:1}).setOrigin(0.5,0.5).setDepth(170).setAlpha(0);
        this.tweens.add({targets:this._toast,alpha:1,duration:150});
        this.time.delayedCall(ms-300,()=>{
            if(this._toast?.active) this.tweens.add({targets:this._toast,alpha:0,duration:300,onComplete:()=>this._toast?.destroy()});
        });
    }
}
