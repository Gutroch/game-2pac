const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const PlayerManager = require('./PlayerManager');
const RoomManager = require('./RoomManager');
const GameEngine = require('./GameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '../public')));

const playerManager = new PlayerManager();
const roomManager = new RoomManager(io, playerManager);

io.on('connection', (socket) => {
    console.log(`Nuova connessione: ${socket.id}`);

    // Step 1: ricevi il nickname (e opzionale character) dal client
    socket.on('setNickname', (payload) => {
        let nickname = null, character = null;
        if (typeof payload === 'string') nickname = payload;
        else if (payload && typeof payload === 'object') { nickname = payload.nickname; character = payload.character; }
        nickname = (nickname || '').trim();

        // Validazione severa del nickname
        const isValid = (n) => {
            if (!n) return false;
            if (n.length < 3 || n.length > 16) return false;
            if (!/^[a-zA-Z0-9_\-]+$/.test(n)) return false;
            return true;
        };
        if (!isValid(nickname)) {
            socket.emit('nickRejected', 'Nickname non valido. Usa 3-16 caratteri alfanumerici/underscore.');
            return;
        }

        const player = playerManager.addPlayer(socket.id, nickname, character);
        socket.emit('init', { playerId: socket.id, nickname: player.nickname, character: player.character });

        // Invia la lista delle stanze pubbliche
        socket.emit('roomList', roomManager.getPublicRoomsInfo());

        // Notifica agli altri (se serve)
        socket.broadcast.emit('playerJoined', { id: socket.id, nickname, character });
    });

    // Richiesta lista stanze
    socket.on('getRooms', () => {
        socket.emit('roomList', roomManager.getPublicRoomsInfo());
    });

    // Creazione stanza
    socket.on('createRoom', (data) => {
        const { roomName, mode, isPrivate, maxPlayers, numTeams } = data || {};
        const player = playerManager.getPlayer(socket.id);
        if (!player) return;

        // basic validation
        if (!roomName || typeof roomName !== 'string' || roomName.trim().length === 0) {
            socket.emit('error', 'Nome stanza non valido');
            return;
        }

        // create with options
        const room = roomManager.createRoomWithOptions(roomName.trim(), player, mode || 'teamDM', !!isPrivate, parseInt(maxPlayers) || null, parseInt(numTeams) || 2);
        if (room) {
            // Il giocatore entra automaticamente nella stanza
            socket.join(room.id);
            player.currentRoom = room.id;
            io.to(room.id).emit('roomJoined', room.getInfo());
        } else {
            socket.emit('error', 'Impossibile creare la stanza');
        }
    });

    // Entrare in una stanza
    socket.on('joinRoom', (roomId) => {
        const player = playerManager.getPlayer(socket.id);
        if (!player) return;

        const room = roomManager.getRoom(roomId);
        if (!room) {
            socket.emit('error', 'Stanza non trovata');
            return;
        }

        if (room.isPrivate) {
            // Per semplicità non gestiamo password, si potrebbe estendere
            socket.emit('error', 'Stanza privata (password non implementata)');
            return;
        }

        const success = room.addPlayer(player);
        if (success) {
            socket.join(room.id);
            player.currentRoom = room.id;
            io.to(room.id).emit('roomJoined', room.getInfo());
            // Aggiorna la lista stanze per tutti
            io.emit('roomList', roomManager.getPublicRoomsInfo());
        } else {
            socket.emit('error', 'Impossibile entrare nella stanza (piena?)');
        }
    });

    // Join tramite codice stanza (per stanze private)
    socket.on('joinRoomByCode', (code) => {
        if (!code) { socket.emit('error', 'Codice stanza mancante'); return; }
        const player = playerManager.getPlayer(socket.id);
        if (!player) return;
        const room = roomManager.getRoomByCode(code);
        if (!room) { socket.emit('error', 'Codice stanza non valido'); return; }

        const success = room.addPlayer(player);
        if (success) {
            socket.join(room.id);
            player.currentRoom = room.id;
            socket.emit('roomJoined', room.getInfo());
            io.emit('roomList', roomManager.getPublicRoomsInfo());
        } else {
            socket.emit('error', 'Impossibile entrare nella stanza (piena?)');
        }
    });

    // Uscire da una stanza
    socket.on('leaveRoom', () => {
        const player = playerManager.getPlayer(socket.id);
        if (!player || !player.currentRoom) return;

        const room = roomManager.getRoom(player.currentRoom);
        if (room) {
            room.removePlayer(socket.id);
            socket.leave(room.id);
            io.to(room.id).emit('roomLeft', { playerId: socket.id });
            if (room.players.length === 0) {
                roomManager.deleteRoom(room.id);
            } else {
                io.to(room.id).emit('roomUpdated', room.getInfo());
            }
        }
        player.currentRoom = null;
        socket.emit('leftRoom');
    });

    // Giocatore pronto (in attesa nella stanza)
    socket.on('playerReady', () => {
        const player = playerManager.getPlayer(socket.id);
        if (!player || !player.currentRoom) return;

        const room = roomManager.getRoom(player.currentRoom);
        if (!room) return;

        room.setPlayerReady(socket.id, true);
        io.to(room.id).emit('roomUpdated', room.getInfo());

        // Avvia il gioco se le condizioni sono soddisfatte
        if (room.canStartGame() && !room.gameEngine) {
            room.gameEngine = new GameEngine(io, room, playerManager);
            room.gameEngine.startGame();
        }
    });

    // Input di gioco (movimento, sparo)
    socket.on('gameInput', (data) => {
        const player = playerManager.getPlayer(socket.id);
        if (!player || !player.currentRoom) return;

        const room = roomManager.getRoom(player.currentRoom);
        if (!room || !room.gameEngine) return;

        room.gameEngine.handleInput(socket.id, data);
    });

    // Sparo dal client
    socket.on('shoot', (dir) => {
        const player = playerManager.getPlayer(socket.id);
        if (!player || !player.currentRoom) return;

        const room = roomManager.getRoom(player.currentRoom);
        if (!room || !room.gameEngine) return;

        // Delegare al game engine
        room.gameEngine.handleShoot(socket.id, dir);
    });

    socket.on('reload', () => {
        const player = playerManager.getPlayer(socket.id);
        if (!player || !player.currentRoom) return;
        const room = roomManager.getRoom(player.currentRoom);
        if (!room || !room.gameEngine) return;
        room.gameEngine.handleReload(socket.id);
    });

    // Disconnessione
    socket.on('disconnect', () => {
        const player = playerManager.getPlayer(socket.id);
        if (player && player.currentRoom) {
            const room = roomManager.getRoom(player.currentRoom);
            if (room) {
                room.removePlayer(socket.id);
                socket.leave(room.id);
                if (room.players.length === 0) {
                    roomManager.deleteRoom(room.id);
                } else {
                    io.to(room.id).emit('roomLeft', { playerId: socket.id });
                    io.to(room.id).emit('roomUpdated', room.getInfo());
                }
            }
        }
        playerManager.removePlayer(socket.id);
        socket.broadcast.emit('playerLeft', { id: socket.id });
    });

    // Logout esplicito dal client
    socket.on('logout', () => {
        // semplicemente disconnetti il socket, il handler 'disconnect' farà il cleanup
        try { socket.disconnect(true); } catch (e) {}
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server in esecuzione su http://localhost:${PORT}`);
});