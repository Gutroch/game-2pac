const { v4: uuidv4 } = require('uuid');

class Room {
    constructor(id, name, owner, mode, isPrivate) {
        this.id = id;
        this.name = name;
        this.ownerId = owner.id;
        this.mode = mode;          // 'teamDM' o 'ffa'
        this.isPrivate = isPrivate;
        this.players = [owner];     // array di oggetti player (con ready flag)
        this.readyStates = new Map(); // playerId -> boolean
        this.readyStates.set(owner.id, false);
        this.gameEngine = null;
        this.maxPlayers = mode === 'teamDM' ? 4 : 6; // esempio
        // Rounds / punteggi
        this.roundsToWin = 3;
        if (this.mode === 'teamDM') {
            this.scores = { blue: 0, red: 0 };
        } else {
            // FFA: punteggio per player id
            this.scores = {};
            for (let p of this.players) {
                this.scores[p.id] = 0;
            }
        }
    }

    addPlayer(player) {
        if (this.players.length >= this.maxPlayers) return false;
        this.players.push(player);
        this.readyStates.set(player.id, false);
        if (this.mode !== 'teamDM') {
            // FFA: track score per player
            this.scores[player.id] = 0;
        }
        return true;
    }

    removePlayer(playerId) {
        this.players = this.players.filter(p => p.id !== playerId);
        this.readyStates.delete(playerId);
        if (this.ownerId === playerId && this.players.length > 0) {
            // Assegna nuovo proprietario
            this.ownerId = this.players[0].id;
        }
        if (this.mode !== 'teamDM') {
            delete this.scores[playerId];
        }
    }

    setPlayerReady(playerId, ready) {
        this.readyStates.set(playerId, ready);
    }

    canStartGame() {
        if (this.players.length < 2) return false; // almeno 2 giocatori
        // Tutti i giocatori devono essere pronti
        for (let p of this.players) {
            if (!this.readyStates.get(p.id)) return false;
        }
        // Per teamDM deve esserci almeno un giocatore per squadra (squadre alternate)
        if (this.mode === 'teamDM') {
            const teamCount = this.players.reduce((acc, p, index) => {
                const team = index % 2 === 0 ? 'blue' : 'red';
                acc[team] = (acc[team] || 0) + 1;
                return acc;
            }, {});
            return teamCount['blue'] > 0 && teamCount['red'] > 0;
        }
        // FFA sempre ok
        return true;
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            mode: this.mode,
            isPrivate: this.isPrivate,
            players: this.players.map(p => ({
                id: p.id,
                nickname: p.nickname,
                ready: this.readyStates.get(p.id) || false,
                character: p.character || null
            })),
            ownerId: this.ownerId
            , roundsToWin: this.roundsToWin,
            scores: this.scores
        };
    }
}

class RoomManager {
    constructor(io, playerManager) {
        this.io = io;
        this.playerManager = playerManager;
        this.rooms = new Map(); // id -> Room
    }

    createRoom(roomName, owner, mode, isPrivate) {
        const id = uuidv4();
        const room = new Room(id, roomName, owner, mode, isPrivate);
        this.rooms.set(id, room);
        // Notifica a tutti i client l'aggiornamento della lista stanze pubbliche
        this.io.emit('roomList', this.getPublicRoomsInfo());
        return room;
    }

    getRoom(roomId) {
        return this.rooms.get(roomId);
    }

    deleteRoom(roomId) {
        this.rooms.delete(roomId);
        this.io.emit('roomList', this.getPublicRoomsInfo());
    }

    getPublicRoomsInfo() {
        const list = [];
        for (let room of this.rooms.values()) {
            if (!room.isPrivate) {
                list.push({
                    id: room.id,
                    name: room.name,
                    mode: room.mode,
                    playerCount: room.players.length,
                    maxPlayers: room.maxPlayers
                });
            }
        }
        return list;
    }
}

module.exports = RoomManager;