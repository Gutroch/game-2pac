class GameEngine {
    constructor(io, room, playerManager) {
        this.io = io;
        this.room = room;
        this.playerManager = playerManager;
        this.players = {}; // id -> { x, y, hp, team, input }
        this.bullets = [];
        this.nextBulletId = 0;
        this.mapWidth = 20;
        this.mapHeight = 15;
        this.tileSize = 32;
        this.playerSpeed = 3;
        this.bulletSpeed = 5;
        this.playerRadius = 12;
        this.bulletRadius = 5;
        this.gameInterval = null;
        this.roundActive = false; // IMPORTANTE: flag per controllo input

        this.powerups = []; // { id, x, y, type }
        this.nextPowerupId = 0;
        this.maxPowerups = 3;
        this.powerupTimer = 0;

        this.movingObstacles = []; // { x,y,w,h,vx,vy }

        // Match timing
        this.matchDurationMs = 7 * 60 * 1000; // 7 minutes
        this.matchStart = null;
        this.maxAmmo = 6;
        this.superCooldownSec = 20; // cooldown per super

        this.roundNumber = 1;

        // Genera mappa con muri (bordi e ostacoli casuali)
        this.map = [];
        for (let y = 0; y < this.mapHeight; y++) {
            const row = [];
            for (let x = 0; x < this.mapWidth; x++) {
                if (x === 0 || y === 0 || x === this.mapWidth-1 || y === this.mapHeight-1) {
                    row.push(1); // bordo
                } else {
                    row.push(Math.random() < 0.1 ? 1 : 0);
                }
            }
            this.map.push(row);
        }

        // Posiziona i giocatori nella stanza
        this.initializePlayers();

        // Crea alcuni ostacoli mobili
        this.initializeMovingObstacles();
    }

    initializePlayers() {
        const playersList = this.room.players;
        for (let i = 0; i < playersList.length; i++) {
            const p = playersList[i];
            let team = 'blue';
            if (this.room.mode === 'teamDM') {
                team = i % 2 === 0 ? 'blue' : 'red';
            } else {
                // FFA: tutti squadra a sé, ma per semplicità usiamo colori diversi
                team = i % 2 === 0 ? 'blue' : 'red';
            }
            // Posiziona in punti diversi in base alla squadra
            let x, y;
            if (team === 'blue') {
                x = 5 * this.tileSize;
                y = 7 * this.tileSize;
            } else {
                x = 14 * this.tileSize;
                y = 7 * this.tileSize;
            }
            this.players[p.id] = {
                id: p.id,
                nickname: p.nickname,
                team,
                x,
                y,
                hp: 3,
                input: { left: false, right: false, up: false, down: false },
                ammo: this.maxAmmo,
                reloadTimer: 0,
                superCooldown: 0,
                invulnerable: 0,
                frozen: 0,
                speedModifier: 1,
                doubleDamage: false,
                powerupTimer: 0,
                character: (p.character || null)
            };
        }
        
        console.log(`[GameEngine] Inizializzati ${Object.keys(this.players).length} giocatori`);
    }

    startGame() {
        console.log(`[GameEngine] Avvio partita nella stanza ${this.room.id}`);
        
        // 1. Comunica ai client di caricare la scena di gioco
        this.io.to(this.room.id).emit('gameStarting', {
            map: this.map,
            tileSize: this.tileSize,
            mode: this.room.mode,
            roundNumber: this.roundNumber,
            scores: this.room.scores,
            roundsToWin: this.room.roundsToWin,
            matchDurationMs: this.matchDurationMs
        });

        // 2. Breve pausa per permettere il cambio scena, poi invia intro
        setTimeout(() => {
            const instructions = "Obiettivi: elimina i nemici. Usa P per sparare, N per ricaricare. Raccogli power-up.";
            this.io.to(this.room.id).emit('roundIntro', { 
                instructions, 
                durationMs: 4000 
            });

            // 3. Dopo l'intro, avvia il round
            setTimeout(() => {
                console.log(`[GameEngine] Round ${this.roundNumber} iniziato`);
                
                this.io.to(this.room.id).emit('roundStart', {
                    map: this.map,
                    tileSize: this.tileSize,
                    mode: this.room.mode,
                    roundNumber: this.roundNumber,
                    scores: this.room.scores,
                    roundsToWin: this.room.roundsToWin,
                    matchDurationMs: this.matchDurationMs
                });

                this.matchStart = Date.now();
                this.roundActive = true; // ATTIVA INPUT
                
                // Avvia il loop di gioco
                if (this.gameInterval) clearInterval(this.gameInterval);
                this.gameInterval = setInterval(() => this.update(), 1000 / 60); // 60 tick/s
            }, 4000);
        }, 1500); // 1.5s per il cambio scena
    }

    handleInput(playerId, input) {
        // Ignora input se il round non è attivo
        if (!this.roundActive) {
            // console.log(`[GameEngine] Input ignorato - round non attivo`);
            return;
        }
        
        if (this.players[playerId]) {
            // Valida che l'input sia un oggetto valido
            if (input && typeof input === 'object') {
                this.players[playerId].input = {
                    left: !!input.left,
                    right: !!input.right,
                    up: !!input.up,
                    down: !!input.down
                };
                console.log(`[GameEngine] Input ricevuto da ${playerId}:`, this.players[playerId].input);
            }
        }
    }

    update() {
        // Se il round non è attivo, invia solo lo stato (per countdown)
        if (!this.roundActive) {
            this.io.to(this.room.id).emit('gameState', {
                players: this.players,
                bullets: this.bullets,
                powerups: this.powerups,
                obstacles: this.movingObstacles
            });
            return;
        }

        // ============================================================
        //  MOVIMENTO GIOCATORI
        // ============================================================
        for (let id in this.players) {
            const p = this.players[id];
            if (!p.input) continue;

            // decrement status timers
            if (p.frozen && p.frozen > 0) p.frozen -= 1/60;
            if (p.invulnerable && p.invulnerable > 0) p.invulnerable -= 1/60;
            if (p.superCooldown && p.superCooldown > 0) p.superCooldown -= 1/60;
            
            // if frozen, skip movement
            if (p.frozen && p.frozen > 0) continue;

            let dx = 0, dy = 0;
            if (p.input.left) dx -= 1;
            if (p.input.right) dx += 1;
            if (p.input.up) dy -= 1;
            if (p.input.down) dy += 1;
            
            if (dx !== 0 || dy !== 0) {
                const len = Math.sqrt(dx*dx + dy*dy);
                // Applica speed modifier dai powerup
                const speed = this.playerSpeed * (p.speedModifier || 1);
                dx = (dx/len) * speed;
                dy = (dy/len) * speed;

                // Movimento con collisioni
                let newX = p.x + dx;
                if (!this.collidesWithWall(newX, p.y, this.playerRadius) && !this.collidesWithMovingObstacles(newX, p.y, this.playerRadius)) p.x = newX;

                let newY = p.y + dy;
                if (!this.collidesWithWall(p.x, newY, this.playerRadius) && !this.collidesWithMovingObstacles(p.x, newY, this.playerRadius)) p.y = newY;
            }
        }

        // ============================================================
        //  AGGIORNAMENTO PROIETTILI
        // ============================================================
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.x += b.vx;
            b.y += b.vy;

            // Rimuovi se fuori mappa
            if (b.x < 0 || b.x > this.mapWidth * this.tileSize ||
                b.y < 0 || b.y > this.mapHeight * this.tileSize) {
                this.bullets.splice(i, 1);
                continue;
            }

            // Rimuovi se collide con muro
            if (this.collidesWithWall(b.x, b.y, this.bulletRadius) || this.collidesWithMovingObstacles(b.x, b.y, this.bulletRadius)) {
                this.bullets.splice(i, 1);
                continue;
            }

            // Controlla collisioni con giocatori
            let hit = false;
            for (let id in this.players) {
                const p = this.players[id];
                
                // Salta se stesso? No, permettiamo self-damage? Meglio di no
                if (id === b.ownerId) continue;
                
                // In teamDM, niente friendly fire
                if (this.room.mode === 'teamDM' && p.team === b.ownerTeam) continue;
                
                const dist = Math.hypot(b.x - p.x, b.y - p.y);
                if (dist < this.playerRadius + this.bulletRadius) {
                    // Applica danno
                    // Skip damage if target is invulnerable
                    const damage = b.damage || 1;
                    if (!(p.invulnerable && p.invulnerable > 0)) {
                        p.hp -= damage;
                    }
                    
                    // Rimuovi proiettile
                    this.bullets.splice(i, 1);
                    hit = true;

                    console.log(`[GameEngine] Bullet ${b.id} hit player ${id} (owner ${b.ownerId}) damage=${damage}`);

                    // Notifica hit
                    this.io.to(this.room.id).emit('playerHit', { 
                        playerId: id, 
                        x: p.x, 
                        y: p.y,
                        damage: damage 
                    });

                    // Gestione morte
                    if (p.hp <= 0) {
                        // Aggiorna statistiche
                        if (b.ownerId && this.playerManager) {
                            this.playerManager.incrementKills(b.ownerId, 1);
                            this.playerManager.incrementDeaths(id, 1);
                        }
                        
                        // Rimuovi giocatore (morirà fino al prossimo round)
                        delete this.players[id];
                        
                        // Notifica morte
                        this.io.to(this.room.id).emit('playerDied', { 
                            playerId: id, 
                            killer: b.ownerId 
                        });
                        
                        console.log(`[GameEngine] Giocatore ${id} ucciso da ${b.ownerId}`);
                    }
                    break;
                }
            }
            if (hit) continue;
        }

        // ============================================================
        //  AGGIORNA OSTACOLI MOBILI
        // ============================================================
        this.updateMovingObstacles();

        // ============================================================
        //  GESTIONE POWERUP
        // ============================================================
        this.powerupTimer += 1/60;
        if (this.powerupTimer >= 5) { // ogni 5s
            this.powerupTimer = 0;
            if (this.powerups.length < this.maxPowerups) this.spawnPowerup();
        }

        this.checkPowerupPickups();

        // ============================================================
        //  CONTROLLO FINE ROUND/PARTITA
        // ============================================================
        this.checkGameOver();

        // ============================================================
        //  CONTROLLO DURATA MATCH
        // ============================================================
        if (this.matchStart && this.matchDurationMs) {
            const elapsed = Date.now() - this.matchStart;
            if (elapsed >= this.matchDurationMs) {
                // determina vincitore per punteggio
                let winner = null;
                if (this.room.mode === 'teamDM') {
                    const b = this.room.scores.blue || 0;
                    const r = this.room.scores.red || 0;
                    winner = b > r ? 'blue' : (r > b ? 'red' : null);
                } else {
                    let max = -1; let best = null;
                    for (let pid in this.room.scores) {
                        if (this.room.scores[pid] > max) { 
                            max = this.room.scores[pid]; 
                            best = pid; 
                        }
                    }
                    winner = best;
                }
                this.endMatch(winner);
                return;
            }
        }

        // ============================================================
        //  INVIA STATO AGGIORNATO AI CLIENT
        // ============================================================
        this.io.to(this.room.id).emit('gameState', {
            players: this.players,
            bullets: this.bullets,
            powerups: this.powerups,
            obstacles: this.movingObstacles,
            roundActive: this.roundActive
        });
    }

    collidesWithWall(x, y, radius) {
        const tileX = Math.floor(x / this.tileSize);
        const tileY = Math.floor(y / this.tileSize);
        
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                const checkX = tileX + i;
                const checkY = tileY + j;
                
                if (checkX < 0 || checkX >= this.mapWidth || checkY < 0 || checkY >= this.mapHeight) continue;
                
                if (this.map[checkY][checkX] === 1) {
                    const left = checkX * this.tileSize;
                    const right = (checkX + 1) * this.tileSize;
                    const top = checkY * this.tileSize;
                    const bottom = (checkY + 1) * this.tileSize;
                    
                    const closestX = Math.max(left, Math.min(x, right));
                    const closestY = Math.max(top, Math.min(y, bottom));
                    
                    if (Math.hypot(x - closestX, y - closestY) < radius) return true;
                }
            }
        }
        return false;
    }

    collidesWithMovingObstacles(x, y, radius) {
        for (let obs of this.movingObstacles) {
            // obs.x, obs.y are top-left; w/h are width/height
            const left = obs.x;
            const right = obs.x + obs.w;
            const top = obs.y;
            const bottom = obs.y + obs.h;
            const closestX = Math.max(left, Math.min(x, right));
            const closestY = Math.max(top, Math.min(y, bottom));
            const dist = Math.hypot(x - closestX, y - closestY);
            if (dist < radius) return true;
        }
        return false;
    }

    // Handle player using their super ability
    handleUseSuper(playerId) {
        if (!this.roundActive) return;
        const p = this.players[playerId];
        if (!p) return;
        if (p.superCooldown && p.superCooldown > 0) {
            console.log(`[GameEngine] ${playerId} tried to use super but cooldown=${p.superCooldown.toFixed(2)}`);
            return;
        }

        const character = p.character || 'pc_blue';
        // set cooldown
        p.superCooldown = this.superCooldownSec;

        // Define effects per character
        if (character === 'pc_blue') {
            // freeze all for 1.5s
            const dur = 1.5;
            for (let id in this.players) {
                this.players[id].frozen = Math.max(this.players[id].frozen || 0, dur);
            }
            this.io.to(this.room.id).emit('globalEffect', { type: 'freeze', duration: dur, source: playerId });
            console.log(`[GameEngine] ${playerId} activated FREEZE`);
        } else if (character === 'pc_red') {
            // blind all for 1s
            const dur = 1.0;
            this.io.to(this.room.id).emit('globalEffect', { type: 'blind', duration: dur, source: playerId });
            console.log(`[GameEngine] ${playerId} activated BLIND`);
        } else if (character === 'pc_green') {
            // slow enemies for 3s (reduce speedModifier)
            const dur = 3.0;
            for (let id in this.players) {
                if (id === playerId) continue;
                const other = this.players[id];
                other.speedModifier = (other.speedModifier || 1) * 0.5;
                other.powerupTimer = Math.max(other.powerupTimer || 0, dur);
            }
            this.io.to(this.room.id).emit('globalEffect', { type: 'slow', duration: dur, source: playerId });
            console.log(`[GameEngine] ${playerId} activated SLOW`);
        } else if (character === 'pc_yellow') {
            // self shield for 3s
            const dur = 3.0;
            p.invulnerable = Math.max(p.invulnerable || 0, dur);
            this.io.to(this.room.id).emit('globalEffect', { type: 'shield', duration: dur, source: playerId, target: playerId });
            console.log(`[GameEngine] ${playerId} activated SHIELD`);
        } else {
            // default: small blind
            const dur = 1.0;
            this.io.to(this.room.id).emit('globalEffect', { type: 'blind', duration: dur, source: playerId });
        }
    }

    initializeMovingObstacles() {
        // crea 3 ostacoli mobili con movimento semplice
        for (let i = 0; i < 3; i++) {
            const w = this.tileSize * 2;
            const h = this.tileSize * 1;
            const x = (3 + i * 5) * this.tileSize;
            const y = (3 + i * 3) * this.tileSize;
            const vx = (i % 2 === 0) ? 0.5 : -0.5;
            const vy = 0;
            this.movingObstacles.push({ x, y, w, h, vx, vy });
        }
    }

    updateMovingObstacles() {
        for (let obs of this.movingObstacles) {
            obs.x += obs.vx;
            obs.y += obs.vy;
            
            // rimbalzo entro area
            if (obs.x < this.tileSize*2 || obs.x > (this.mapWidth-4)*this.tileSize) obs.vx *= -1;
            if (obs.y < this.tileSize*2 || obs.y > (this.mapHeight-4)*this.tileSize) obs.vy *= -1;
        }
    }

    spawnPowerup() {
        const types = ['speed', 'heal'];
        const type = types[Math.floor(Math.random() * types.length)];
        let x, y;
        
        // posizioni casuali non su muro
        for (let attempt = 0; attempt < 20; attempt++) {
            x = Math.floor((2 + Math.random() * (this.mapWidth - 4))) * this.tileSize + this.tileSize / 2;
            y = Math.floor((2 + Math.random() * (this.mapHeight - 4))) * this.tileSize + this.tileSize / 2;
            if (!this.collidesWithWall(x, y, this.tileSize / 2)) break;
        }
        
        const powerupId = this.nextPowerupId++;
        this.powerups.push({ id: powerupId, x, y, type });
        
        this.io.to(this.room.id).emit('powerupSpawned', { 
            id: powerupId, 
            x, 
            y, 
            type 
        });
        
        console.log(`[GameEngine] Powerup ${type} spawnato a (${x}, ${y})`);
    }

    checkPowerupPickups() {
        for (let i = this.powerups.length - 1; i >= 0; i--) {
            const pu = this.powerups[i];
            
            for (let id in this.players) {
                const p = this.players[id];
                const dist = Math.hypot(pu.x - p.x, pu.y - p.y);
                
                if (dist < this.playerRadius + 8) {
                    // applica effetto
                    if (pu.type === 'speed') {
                        p.speedModifier = 1.7;
                        p.powerupTimer = 5; // 5 secondi
                    } else if (pu.type === 'heal') {
                        p.hp = Math.min(p.hp + 1, 5);
                    }
                    
                    // Rimuovi powerup
                    this.powerups.splice(i, 1);
                    
                    this.io.to(this.room.id).emit('powerupTaken', { 
                        id: pu.id, 
                        playerId: id, 
                        type: pu.type 
                    });
                    
                    break;
                }
            }
        }

        // Aggiorna timer powerup
        for (let id in this.players) {
            const p = this.players[id];
            
            if (p.powerupTimer && p.powerupTimer > 0) {
                p.powerupTimer -= 1/60;
                if (p.powerupTimer <= 0) {
                    p.speedModifier = 1;
                    p.powerupTimer = 0;
                    console.log(`[GameEngine] Powerup speed scaduto per ${id}`);
                }
            }
            
            // Aggiorna reload timer
            if (p.reloadTimer && p.reloadTimer > 0) {
                p.reloadTimer -= 1/60;
                if (p.reloadTimer <= 0) {
                    p.reloadTimer = 0;
                    p.ammo = this.maxAmmo;
                    console.log(`[GameEngine] Ricarica completata per ${id}`);
                }
            }
        }
    }

    checkGameOver() {
        const alivePlayers = Object.values(this.players);
        
        if (alivePlayers.length === 0) {
            this.handleRoundEnd(null);
            return;
        }

        if (this.room.mode === 'teamDM') {
            const blueAlive = alivePlayers.filter(p => p.team === 'blue').length;
            const redAlive = alivePlayers.filter(p => p.team === 'red').length;
            
            if (blueAlive === 0) {
                this.handleRoundEnd('red');
            } else if (redAlive === 0) {
                this.handleRoundEnd('blue');
            }
        } else {
            // FFA: vince l'ultimo rimasto
            if (alivePlayers.length === 1) {
                this.handleRoundEnd(alivePlayers[0].id);
            }
        }
    }

    handleRoundEnd(winner) {
        console.log(`[GameEngine] Round terminato! Vincitore: ${winner}`);
        
        // Disattiva input
        this.roundActive = false;
        
        // Aggiorna punteggio stanza
        if (this.room.mode === 'teamDM') {
            if (winner === 'blue' || winner === 'red') {
                this.room.scores[winner] = (this.room.scores[winner] || 0) + 1;
            }
        } else {
            if (winner) {
                this.room.scores[winner] = (this.room.scores[winner] || 0) + 1;
            }
        }

        // Notifica round finito
        this.io.to(this.room.id).emit('roundEnded', { 
            winner, 
            scores: this.room.scores 
        });

        // Controlla fine match
        let matchOver = false;
        if (this.room.mode === 'teamDM') {
            if (this.room.scores.blue >= this.room.roundsToWin) matchOver = true;
            if (this.room.scores.red >= this.room.roundsToWin) matchOver = true;
        } else {
            for (let pid in this.room.scores) {
                if (this.room.scores[pid] >= this.room.roundsToWin) matchOver = true;
            }
        }

        if (matchOver) {
            this.endMatch(winner);
            return;
        }

        // Prepara round successivo
        this.roundNumber += 1;
        this.bullets = [];
        this.powerups = [];

        // Ricrea giocatori per il nuovo round
        for (let i = 0; i < this.room.players.length; i++) {
            const p = this.room.players[i];
            
            // Determina squadra
            let team = 'blue';
            if (this.room.mode === 'teamDM') {
                team = i % 2 === 0 ? 'blue' : 'red';
            } else {
                team = i % 2 === 0 ? 'blue' : 'red';
            }
            
            // Posizione base
            let x, y;
            if (team === 'blue') {
                x = 5 * this.tileSize;
                y = 7 * this.tileSize;
            } else {
                x = 14 * this.tileSize;
                y = 7 * this.tileSize;
            }

            if (this.players[p.id]) {
                // Aggiorna giocatore esistente
                this.players[p.id].hp = 3;
                this.players[p.id].x = x;
                this.players[p.id].y = y;
                this.players[p.id].team = team;
                this.players[p.id].speedModifier = 1;
                this.players[p.id].doubleDamage = false;
                this.players[p.id].ammo = this.maxAmmo;
                this.players[p.id].reloadTimer = 0;
                this.players[p.id].input = { left: false, right: false, up: false, down: false };
            } else {
                // Crea nuovo giocatore (era morto)
                this.players[p.id] = {
                    id: p.id,
                    nickname: p.nickname,
                    team,
                    x,
                    y,
                    hp: 3,
                    input: { left: false, right: false, up: false, down: false },
                    ammo: this.maxAmmo,
                    reloadTimer: 0,
                    speedModifier: 1,
                    doubleDamage: false,
                    powerupTimer: 0,
                    character: p.character || null
                };
            }
        }

        // Countdown e prossimo round
        this.io.to(this.room.id).emit('roundCountdown', { 
            seconds: 3, 
            nextRound: this.roundNumber 
        });
        
        setTimeout(() => {
            console.log(`[GameEngine] Round ${this.roundNumber} parte ora`);
            
            this.io.to(this.room.id).emit('roundStart', { 
                roundNumber: this.roundNumber, 
                scores: this.room.scores, 
                roundsToWin: this.room.roundsToWin 
            });
            
            this.matchStart = Date.now();
            this.roundActive = true; // RIATTIVA INPUT
        }, 3000);
    }

    endMatch(winner) {
        console.log(`[GameEngine] Partita terminata! Vincitore: ${winner}`);
        
        clearInterval(this.gameInterval);
        this.roundActive = false;
        
        this.io.to(this.room.id).emit('matchEnd', { 
            winner, 
            scores: this.room.scores 
        });
        
        // Pulisci riferimento al gameEngine nella stanza
        try { this.room.gameEngine = null; } catch (e) {}
        
        // Resetta gli stati "ready" per i giocatori presenti in stanza
        if (this.room && this.room.readyStates) {
            for (let p of this.room.players) {
                this.room.readyStates.set(p.id, false);
            }
        }
        
        // Dopo qualche secondo, torna in lobby
        setTimeout(() => {
            this.io.to(this.room.id).emit('returnToLobby');
        }, 3000);
    }

    // Chiamato dal client quando spara
    handleShoot(playerId, dir) {
        // Ignora se round non attivo
        if (!this.roundActive) {
            console.log(`[GameEngine] Sparo ignorato - round non attivo`);
            return;
        }
        
        const player = this.players[playerId];
        if (!player) {
            console.log(`[GameEngine] Giocatore ${playerId} non trovato`);
            return;
        }
        
        // Inizializza ammo se non esiste
        if (player.ammo === undefined) player.ammo = this.maxAmmo;
        
        // Controlli validi
        if (player.reloadTimer && player.reloadTimer > 0) {
            console.log(`[GameEngine] ${playerId} sta ricaricando`);
            return;
        }
        
        if (player.ammo <= 0) {
            console.log(`[GameEngine] ${playerId} non ha munizioni`);
            return;
        }
        
        // Consuma munizione
        player.ammo -= 1;
        
        // Valida direzione
        if (!dir || (dir.x === 0 && dir.y === 0)) {
            console.log(`[GameEngine] Direzione sparo non valida da ${playerId}`);
            return;
        }
        
        // Normalizza direzione se necessario
        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
        const normX = dir.x / len;
        const normY = dir.y / len;

        // Crea proiettile
        const bullet = {
            id: this.nextBulletId++,
            x: player.x,
            y: player.y,
            vx: normX * this.bulletSpeed,
            vy: normY * this.bulletSpeed,
            ownerTeam: player.team,
            ownerId: playerId,
            damage: (player.doubleDamage ? 2 : 1),
            type: 'laser'
        };
        
        this.bullets.push(bullet);
        
        console.log(`[GameEngine] ${playerId} ha sparato. Munizioni rimaste: ${player.ammo}`);
    }

    handleReload(playerId) {
        // Ignora se round non attivo
        if (!this.roundActive) {
            console.log(`[GameEngine] Ricarica ignorata - round non attivo`);
            return;
        }
        
        const player = this.players[playerId];
        if (!player) {
            console.log(`[GameEngine] Giocatore ${playerId} non trovato`);
            return;
        }
        
        // Inizializza ammo se non esiste
        if (player.ammo === undefined) player.ammo = this.maxAmmo;
        
        // Controlla se già in ricarica
        if (player.reloadTimer && player.reloadTimer > 0) {
            console.log(`[GameEngine] ${playerId} sta già ricaricando`);
            return;
        }
        
        // Controlla se già al massimo
        if (player.ammo >= this.maxAmmo) {
            console.log(`[GameEngine] ${playerId} ha già munizioni al massimo`);
            return;
        }
        
        // Avvia ricarica
        player.reloadTimer = 1.5; // 1.5 secondi
        console.log(`[GameEngine] ${playerId} inizia ricarica`);
    }
}

module.exports = GameEngine;