class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    init() {
        this.socket = this.registry.get('socket');
        this.mapData = this.registry.get('gameData').map;
        this.tileSize = this.registry.get('gameData').tileSize;
        this.mode = this.registry.get('gameData').mode;
        this.playerId = this.registry.get('playerId');
        this.players = {}; // id -> sprite
        this.bullets = [];
        this.cursors = null;
        this.powerups = {};
        this.obstacles = [];
    }

    preload() {
        const g = this.make.graphics({ x:0, y:0, add:false });
        g.fillStyle(0xffff00);
        g.fillCircle(8,8,8);
        g.generateTexture('powerup_heal', 16,16);
        g.clear();

        g.fillStyle(0x66ccff);
        g.fillCircle(8,8,8);
        g.generateTexture('powerup_speed', 16,16);
        g.clear();

        g.fillStyle(0x333333);
        g.fillRect(0,0,64,16);
        g.generateTexture('moving_obs', 64,16);
        g.clear();

        g.fillStyle(0xffcc00);
        for (let i=0;i<6;i++) g.fillCircle(6+i*4,8,1);
        g.generateTexture('spark', 24,16);
        g.clear();
    }

    create() {
        // Sfondo erba
        this.add.tileSprite(0, 0, 640, 480, 'grass').setOrigin(0);

        // Disegna muri
        for (let y = 0; y < this.mapData.length; y++) {
            for (let x = 0; x < this.mapData[0].length; x++) {
                if (this.mapData[y][x] === 1) {
                    this.add.image(x * this.tileSize + 16, y * this.tileSize + 16, 'wall');
                }
            }
        }

        // Input
        this.cursors = this.input.keyboard.addKeys('W,A,S,D');
        this.keyP = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
        this.keyN = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.N);

        // Ascoltatori socket
        this.socket.on('gameState', (state) => {
            this.updateGameState(state);
        });

        // Round lifecycle
        this.socket.on('roundStart', (data) => {
            this.currentRound = data.roundNumber || 1;
            this.scores = data.scores || {};
            this.roundsToWin = data.roundsToWin || 3;
            // set match timer
            if (data.matchDurationMs) this.matchEnd = Date.now() + data.matchDurationMs;
            this.showRoundHUD();
            this.showToast(`ROUND ${this.currentRound} INIZIO`, 1500);
        });

        this.socket.on('roundIntro', (data) => {
            // mostra istruzioni al centro per data.durationMs
            const instr = data.instructions || '';
            const duration = data.durationMs || 3000;
            const txt = this.add.text(320, 220, instr, { fontFamily: 'VT323, monospace', fontSize: '14px', color: '#ffeeaa', align: 'center', wordWrap: { width: 560 } }).setOrigin(0.5);
            this.time.delayedCall(duration, () => txt.destroy());
        });

        this.socket.on('roundCountdown', (data) => {
            this.showToast(`ROUND ${data.nextRound} INIZIO TRA ${data.seconds}...`, 3000);
        });

        this.socket.on('roundEnded', (data) => {
            this.scores = data.scores || this.scores;
            const w = data.winner ? `Winner: ${data.winner}` : 'Pareggio';
            this.showToast(`Round finito. ${w}`, 2500);
            this.showRoundHUD();
        });

        this.socket.on('matchEnd', (data) => {
            this.showToast('Match concluso', 3000);
            // mostra finale e torna in lobby
            this.time.delayedCall(3000, () => this.scene.start('LobbyScene'));
        });

        this.socket.on('playerDied', (data) => {
            // Effetto visivo? Per ora rimuove sprite
            const id = data.playerId;
            if (this.players[id]) {
                const sprite = this.players[id];
                // particelle di morte
                const emitter = this.add.particles('spark').createEmitter({ x: sprite.x, y: sprite.y, speed: { min: -100, max: 100 }, lifespan: 400, quantity: 10 });
                this.time.delayedCall(400, () => emitter.stop());
                sprite.destroy();
                delete this.players[id];
            }
        });

        this.socket.on('playerHit', (data) => {
            // piccolo effetto
            const emitter = this.add.particles('spark').createEmitter({ x: data.x, y: data.y, speed: { min: -50, max: 50 }, lifespan: 300, quantity: 6 });
            this.time.delayedCall(300, () => emitter.stop());
        });

        this.socket.on('powerupSpawned', (pu) => {
            if (this.powerups[pu.id]) return;
            const img = this.add.image(pu.x, pu.y, pu.type === 'heal' ? 'powerup_heal' : 'powerup_speed');
            this.powerups[pu.id] = img;
        });

        this.socket.on('powerupTaken', (data) => {
            const id = data.id;
            if (this.powerups[id]) {
                this.powerups[id].destroy();
                delete this.powerups[id];
            }
        });

        this.socket.on('gameState', (state) => {
            this.updateGameState(state);
        });

        this.socket.on('gameOver', (data) => {
            // legacy, map to matchEnd
            this.showToast(`Partita finita! Vincitore: ${data.winner}`, 2500);
            this.time.delayedCall(2500, () => this.scene.start('LobbyScene'));
        });

        this.socket.on('returnToLobby', () => {
            this.scene.start('LobbyScene');
        });

        // Invio input ad ogni frame (tramite update)
    }

    update() {
        if (!this.cursors) return;

        // Invia input al server
        this.socket.emit('gameInput', {
            left: this.cursors.A.isDown,
            right: this.cursors.D.isDown,
            up: this.cursors.W.isDown,
            down: this.cursors.S.isDown
        });

        // Sparo con tasto P (mira con mouse)
        if (Phaser.Input.Keyboard.JustDown(this.keyP)) {
            const mySprite = this.players[this.playerId];
            if (mySprite) {
                const worldPoint = this.input.activePointer.positionToCamera(this.cameras.main);
                const dx = worldPoint.x - mySprite.x;
                const dy = worldPoint.y - mySprite.y;
                const len = Math.sqrt(dx*dx + dy*dy);
                if (len > 0) {
                    this.socket.emit('shoot', { x: dx/len, y: dy/len });
                }
            }
        }

        // Ricarica con tasto N
        if (Phaser.Input.Keyboard.JustDown(this.keyN)) {
            this.socket.emit('reload');
        }

        // Aggiorna timer match HUD
        if (this.matchEnd && this.timerText) {
            const ms = Math.max(0, this.matchEnd - Date.now());
            const sec = Math.floor(ms/1000);
            const mm = Math.floor(sec/60);
            const ss = sec % 60;
            this.timerText.setText(`${mm}:${ss.toString().padStart(2,'0')}`);
        }
    }

    updateGameState(state) {
        // Aggiorna posizione giocatori
        for (let id in state.players) {
            const p = state.players[id];
            if (!this.players[id]) {
                // Crea nuovo sprite
                const sprite = this.createPlayerSprite(p);
                this.players[id] = sprite;
            } else {
                // Smooth interpolation towards server position
                const cont = this.players[id];
                const lerp = 0.25;
                const nx = Phaser.Math.Linear(cont.x, p.x, lerp);
                const ny = Phaser.Math.Linear(cont.y, p.y, lerp);
                cont.setPosition(nx, ny);
                // Aggiorna testo salute (relativo al container)
                const healthText = cont.healthText;
                if (healthText) {
                    healthText.setText(`HP:${p.hp}`);
                }
            }
        }

        // Rimuovi giocatori non più presenti
        for (let id in this.players) {
            if (!state.players[id]) {
                this.players[id].destroy();
                delete this.players[id];
            }
        }

        // Aggiorna proiettili
        // Rimuovi vecchi
        this.bullets.forEach(b => b.destroy());
        this.bullets = [];
        // Crea nuovi
        for (let b of state.bullets) {
            const bullet = this.add.image(b.x, b.y, b.type === 'laser' ? 'laser' : 'bullet');
            bullet.setScale(1, 0.6);
            this.bullets.push(bullet);
        }

        // Aggiorna / crea powerups
        const serverPowerups = state.powerups || [];
        // rimuovi quelli non più presenti
        const present = new Set(serverPowerups.map(p=>p.id));
        for (let id in this.powerups) {
            if (!present.has(parseInt(id))) {
                this.powerups[id].destroy();
                delete this.powerups[id];
            }
        }

        // ostacoli mobili render
        this.obstacles.forEach(o => o.destroy());
        this.obstacles = [];
        for (let obs of (state.obstacles||[])) {
            const img = this.add.image(obs.x + obs.w/2, obs.y + obs.h/2, 'moving_obs');
            img.setDisplaySize(obs.w, obs.h);
            this.obstacles.push(img);
        }

        // Aggiorna HUD ammo per il giocatore locale
        const me = state.players && state.players[this.playerId];
        if (me) {
            const ammo = me.ammo !== undefined ? me.ammo : null;
            const reloading = me.reloadTimer && me.reloadTimer > 0;
            if (!this.ammoText) this.ammoText = this.add.text(520, 380, '', { fontFamily: 'VT323, monospace', fontSize: '14px', color: '#fff' });
            this.ammoText.setText(reloading ? `Ricarica...` : `Ammo: ${ammo}`);
        }
    }

    createPlayerSprite(p) {
        // Corpo principale: mini PC retro
        const container = this.add.container(p.x, p.y);
        const chassis = this.add.rectangle(0, 0, 28, 20, 0x222222).setStrokeStyle(2, 0x444444);
        // screen color based on character or team
        let screenColor = 0x3366ff;
        if (p.character) {
            if (p.character.includes('blue')) screenColor = 0x3366ff;
            else if (p.character.includes('red')) screenColor = 0xff3333;
            else if (p.character.includes('green')) screenColor = 0x33ff99;
            else if (p.character.includes('yellow')) screenColor = 0xffcc33;
        } else {
            screenColor = p.team === 'blue' ? 0x3366ff : 0xff3333;
        }
        const screen = this.add.rectangle(0, -2, 20, 12, screenColor).setStrokeStyle(1, 0x111111);
        const base = this.add.rectangle(0, 8, 22, 4, 0x444444);
        container.add([chassis, screen, base]);

        // Testo salute
        const healthText = this.add.text(-16, -20, `HP:${p.hp}`, { fontFamily: 'VT323, monospace', fontSize: '12px', color: '#fff', stroke: '#000', strokeThickness: 2 });
        container.add(healthText);
        container.healthText = healthText;

        return container;
    }

    showRoundHUD() {
        if (this.roundText) this.roundText.destroy();
        if (this.scoreText) this.scoreText.destroy();
        const roundsToWin = this.roundsToWin || 3;
        this.roundText = this.add.text(320, 8, `Round ${this.currentRound}`, { fontFamily: 'VT323, monospace', fontSize: '16px', color: '#ffffaa' }).setOrigin(0.5,0);
        let scoreStr = '';
        if (this.mode === 'teamDM') {
            const b = (this.scores && this.scores.blue) || 0;
            const r = (this.scores && this.scores.red) || 0;
            scoreStr = `Blue ${b} - ${r} Red (win ${roundsToWin})`;
        } else {
            const parts = [];
            for (let k in this.scores) parts.push(`${k}:${this.scores[k]}`);
            scoreStr = parts.join(' | ');
        }
        this.scoreText = this.add.text(320, 28, scoreStr, { fontFamily: 'VT323, monospace', fontSize: '12px', color: '#aaffaa' }).setOrigin(0.5,0);
        if (this.matchEnd) this.matchEnd = this.matchEnd; // keep
        if (!this.timerText) this.timerText = this.add.text(560, 8, '', { fontFamily: 'VT323, monospace', fontSize: '14px', color: '#ffd' }).setOrigin(0.5,0);
    }

    showToast(text, ms = 2000) {
        if (this._toast) this._toast.destroy();
        this._toast = this.add.text(320, 420, text, { fontFamily: 'VT323, monospace', fontSize: '14px', color: '#fff', backgroundColor: '#000', padding: { x:8, y:6 } }).setOrigin(0.5,0.5);
        this.tweens.add({ targets: this._toast, alpha: { from: 0, to: 1 }, duration: 150 });
        this.time.delayedCall(ms, () => { this.tweens.add({ targets: this._toast, alpha: 0, duration: 300, onComplete: () => this._toast.destroy() }); });
    }
}

// Precarica le texture (in LobbyScene o qui)
// Per semplicità, le texture sono generate nel preload di LobbyScene?
// Aggiungiamo un preload nella LobbyScene per creare le texture.
// Modifichiamo LobbyScene per includere il preload.