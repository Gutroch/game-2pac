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

        this.powerups = []; // { id, x, y, type }
        this.nextPowerupId = 0;
        this.maxPowerups = 3;
        this.powerupTimer = 0;

        this.movingObstacles = []; // { x,y,w,h,vx,vy }

        // Match timing
        this.matchDurationMs = 7 * 60 * 1000; // 7 minutes
        this.matchStart = null;
        this.maxAmmo = 6;

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
                speedModifier: 1,
                doubleDamage: false,
                character: (p.character || null)
            };
        }
    }

    startGame() {
        // Inizio match: manda breve introduzione/instructions prima del round
        const instructions = "Obiettivi: elimina i nemici. Usa P per sparare, N per ricaricare. Raccogli power-up.";
        this.io.to(this.room.id).emit('roundIntro', { instructions, durationMs: 4000 });

        // Imposta start match timer
        this.matchStart = Date.now();

        // Dopo una breve intro, avvia il round
        setTimeout(() => {
            this.io.to(this.room.id).emit('roundStart', {
                map: this.map,
                tileSize: this.tileSize,
                mode: this.room.mode,
                roundNumber: this.roundNumber,
                scores: this.room.scores,
                roundsToWin: this.room.roundsToWin,
                matchDurationMs: this.matchDurationMs
            });

            // Avvia il loop di gioco
            this.gameInterval = setInterval(() => this.update(), 1000 / 60); // 60 tick/s
        }, 4000);
    }

    handleInput(playerId, input) {
        if (this.players[playerId]) {
            this.players[playerId].input = input;
        }
    }

    update() {
        // Movimento
        for (let id in this.players) {
            const p = this.players[id];
            if (!p.input) continue;
            let dx = 0, dy = 0;
            if (p.input.left) dx -= 1;
            if (p.input.right) dx += 1;
            if (p.input.up) dy -= 1;
            if (p.input.down) dy += 1;
            if (dx !== 0 || dy !== 0) {
                const len = Math.sqrt(dx*dx + dy*dy);
                dx = (dx/len) * this.playerSpeed;
                dy = (dy/len) * this.playerSpeed;

                let newX = p.x + dx;
                if (!this.collidesWithWall(newX, p.y, this.playerRadius)) p.x = newX;

                let newY = p.y + dy;
                if (!this.collidesWithWall(p.x, newY, this.playerRadius)) p.y = newY;
            }
        }

        // Aggiornamento proiettili
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.x += b.vx;
            b.y += b.vy;

            if (b.x < 0 || b.x > this.mapWidth * this.tileSize ||
                b.y < 0 || b.y > this.mapHeight * this.tileSize) {
                this.bullets.splice(i, 1);
                continue;
            }

            if (this.collidesWithWall(b.x, b.y, this.bulletRadius)) {
                this.bullets.splice(i, 1);
                continue;
            }

            let hit = false;
            for (let id in this.players) {
                const p = this.players[id];
                if (p.team === b.ownerTeam && this.room.mode === 'teamDM') continue; // no friendly fire in teamDM
                const dist = Math.hypot(b.x - p.x, b.y - p.y);
                if (dist < this.playerRadius + this.bulletRadius) {
                    p.hp -= (b.damage || 1);
                    this.bullets.splice(i, 1);
                    hit = true;

                    if (p.hp <= 0) {
                        // Gestione morte: rimuovi giocatore
                        delete this.players[id];
                        // Aggiorna statistiche
                        if (b.ownerId && this.playerManager) {
                            this.playerManager.incrementKills(b.ownerId, 1);
                            this.playerManager.incrementDeaths(id, 1);
                        }
                        // Notifica morte
                        this.io.to(this.room.id).emit('playerDied', { playerId: id, killer: b.ownerId });
                    } else {
                        // Notifica hit per effetti sonori/particelle
                        this.io.to(this.room.id).emit('playerHit', { playerId: id, x: p.x, y: p.y });
                    }
                    break;
                }
            }
            if (hit) continue;
        }

        // Aggiorna ostacoli mobili
        this.updateMovingObstacles();

        // Gestione spawn powerups
        this.powerupTimer += 1/60;
        if (this.powerupTimer >= 5) { // ogni 5s
            this.powerupTimer = 0;
            if (this.powerups.length < this.maxPowerups) this.spawnPowerup();
        }

        // Controlla raccolta powerup
        this.checkPowerupPickups();

        // Controllo fine round/partita
        this.checkGameOver();

        // Controlla durata match
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
                        if (this.room.scores[pid] > max) { max = this.room.scores[pid]; best = pid; }
                    }
                    winner = best;
                }
                this.endMatch(winner);
            }
        }

        // Invia stato aggiornato a tutti i client nella stanza
        this.io.to(this.room.id).emit('gameState', {
            players: this.players,
            bullets: this.bullets,
            powerups: this.powerups,
            obstacles: this.movingObstacles
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
        const types = ['speed','heal'];
        const type = types[Math.floor(Math.random()*types.length)];
        let x,y;
        // posizioni casuali non su muro
        for (let attempt=0; attempt<20; attempt++) {
            x = Math.floor((2 + Math.random()*(this.mapWidth-4))) * this.tileSize + this.tileSize/2;
            y = Math.floor((2 + Math.random()*(this.mapHeight-4))) * this.tileSize + this.tileSize/2;
            if (!this.collidesWithWall(x,y, this.tileSize/2)) break;
        }
        this.powerups.push({ id: this.nextPowerupId++, x, y, type });
        this.io.to(this.room.id).emit('powerupSpawned', { id: this.nextPowerupId-1, x, y, type });
    }

    checkPowerupPickups() {
        for (let i = this.powerups.length-1; i>=0; i--) {
            const pu = this.powerups[i];
            for (let id in this.players) {
                const p = this.players[id];
                const dist = Math.hypot(pu.x - p.x, pu.y - p.y);
                if (dist < this.playerRadius + 8) {
                    // applica effetto
                    if (pu.type === 'speed') {
                        p.speedModifier = 1.7;
                        p.powerupTimer = 5; // 5s
                    } else if (pu.type === 'heal') {
                        p.hp = Math.min(p.hp + 1, 5);
                    }
                    this.powerups.splice(i,1);
                    this.io.to(this.room.id).emit('powerupTaken', { id: pu.id, playerId: id, type: pu.type });
                    break;
                }
            }
        }

        // aggiorna timers dei powerup sui giocatori
        for (let id in this.players) {
            const p = this.players[id];
            if (p.powerupTimer && p.powerupTimer > 0) {
                p.powerupTimer -= 1/60;
                if (p.powerupTimer <= 0) {
                    p.speedModifier = 1;
                    p.powerupTimer = 0;
                }
            }
            // aggiorna reload timer
            if (p.reloadTimer && p.reloadTimer > 0) {
                p.reloadTimer -= 1/60;
                if (p.reloadTimer <= 0) {
                    p.reloadTimer = 0;
                    p.ammo = this.maxAmmo;
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
            if (blueAlive === 0) this.handleRoundEnd('red');
            else if (redAlive === 0) this.handleRoundEnd('blue');
        } else {
            // FFA: vince l'ultimo rimasto
            if (alivePlayers.length === 1) {
                this.handleRoundEnd(alivePlayers[0].id);
            }
        }
    }

    handleRoundEnd(winner) {
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
        this.io.to(this.room.id).emit('roundEnded', { winner, scores: this.room.scores });

        // Controlla match end
        let matchOver = false;
        if (this.room.mode === 'teamDM') {
            if (this.room.scores.blue >= this.room.roundsToWin) matchOver = true;
            if (this.room.scores.red >= this.room.roundsToWin) matchOver = true;
        } else {
            // FFA: se qualcuno raggiunge roundsToWin
            for (let pid in this.room.scores) {
                if (this.room.scores[pid] >= this.room.roundsToWin) matchOver = true;
            }
        }

        if (matchOver) {
            // fine match
            this.endMatch(winner);
            return;
        }

        // Altrimenti prepara round successivo: reset posizioni e stati ma mantieni scores
        this.roundNumber += 1;
        // Pulisci proiettili e powerups
        this.bullets = [];
        this.powerups = [];

        // Ripristina giocatori (hp e posizioni)
        for (let idx = 0; idx < this.room.players.length; idx++) {
            const p = this.room.players[idx];
            if (this.players[p.id]) {
                this.players[p.id].hp = 3;
                // riposiziona come in initializePlayers: semplice logica
                const team = this.players[p.id].team;
                if (team === 'blue') { this.players[p.id].x = 5 * this.tileSize; this.players[p.id].y = 7 * this.tileSize; }
                else { this.players[p.id].x = 14 * this.tileSize; this.players[p.id].y = 7 * this.tileSize; }
            }
        }

        // Invia evento di countdown e poi roundStart
        this.io.to(this.room.id).emit('roundCountdown', { seconds: 3, nextRound: this.roundNumber });
        setTimeout(() => {
            this.io.to(this.room.id).emit('roundStart', { roundNumber: this.roundNumber, scores: this.room.scores, roundsToWin: this.room.roundsToWin });
        }, 3000);
    }

    endMatch(winner) {
        clearInterval(this.gameInterval);
        this.io.to(this.room.id).emit('matchEnd', { winner, scores: this.room.scores });
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
        const player = this.players[playerId];
        if (!player) return;
        // check ammo and reload
        if (!player.ammo) player.ammo = this.maxAmmo;
        if (player.reloadTimer && player.reloadTimer > 0) return; // reloading
        if (player.ammo <= 0) return;
        player.ammo -= 1;

        // Crea proiettile (laser)
        this.bullets.push({
            id: this.nextBulletId++,
            x: player.x,
            y: player.y,
            vx: dir.x * this.bulletSpeed,
            vy: dir.y * this.bulletSpeed,
            ownerTeam: player.team,
            ownerId: playerId,
            damage: (player.doubleDamage ? 2 : 1),
            type: 'laser'
        });
    }

    handleReload(playerId) {
        const player = this.players[playerId];
        if (!player) return;
        if (player.reloadTimer && player.reloadTimer > 0) return; // already reloading
        player.reloadTimer = 1.5; // seconds to reload
    }
}

module.exports = GameEngine;