class LobbyScene extends Phaser.Scene {
    constructor() {
        super({ key: 'LobbyScene' });
    }

    init() {
        this.socket = this.registry.get('socket');
        this.nickname = this.registry.get('nickname');
        this.rooms = [];
        this.currentRoom = null;
    }

    create() {
        // Retro CRT-style background
        this.add.rectangle(0, 0, 640, 480, 0x071215).setOrigin(0);
        // scanlines overlay
        const scan = this.add.graphics({ x: 0, y: 0 });
        scan.fillStyle(0x000000, 0.06);
        for (let y = 0; y < 480; y += 4) {
            scan.fillRect(0, y, 640, 1);
        }

        // Vignette border
        const vignette = this.add.graphics();
        vignette.lineStyle(4, 0x224422, 1);
        vignette.strokeRect(6, 6, 628, 468);

        // Titolo nello stile terminale
        this.add.text(24, 18, 'TERMINAL LOBBY', { fill: '#7CFF7C', fontSize: '28px', fontFamily: 'VT323, monospace' });

        // Pannello stanze pubbliche
        this.add.text(24, 64, 'STANZE PUBBLICHE', { fill: '#7CFF7C', fontSize: '14px', fontFamily: 'VT323, monospace' });
        this.roomsContainer = this.add.container(24, 92);

        // Selezione personaggio (mini PC retro)
        this.availableChars = [
            { id: 'pc_blue', color: 0x3366ff },
            { id: 'pc_red', color: 0xff3333 },
            { id: 'pc_green', color: 0x33ff99 },
            { id: 'pc_yellow', color: 0xffcc33 }
        ];
        this.selectedChar = localStorage.getItem('selectedChar') || this.availableChars[0].id;
        const charsX = 24; let cx = charsX, cy = 320;
        this.add.text(cx, cy-18, 'Scegli personaggio:', { fill: '#7CFF7C', fontFamily: 'VT323, monospace' });
        this.charIcons = {};
        this.charContainer = this.add.container(0,0);
        for (let ch of this.availableChars) {
            const box = this.add.rectangle(cx, cy, 40, 32, 0x001000).setOrigin(0,0).setInteractive({ useHandCursor: true });
            const screen = this.add.rectangle(cx+6, cy+6, 28, 20, ch.color).setOrigin(0,0);
            const label = this.add.text(cx+46, cy+8, ch.id.replace('pc_',''), { fill: '#7CFF7C', fontFamily: 'VT323, monospace' });
            box.on('pointerdown', () => { this.selectCharacter(ch.id); });
            this.charContainer.add([box, screen, label]);
            this.charIcons[ch.id] = { box, screen };
            cx += 160;
        }
        this.updateCharSelectionVisual();

        // Pulsante crea stanza (retro button)
        const createBtn = this.add.rectangle(24 + 6, 400, 180, 28, 0x112211).setOrigin(0);
        const createBtnText = this.add.text(24 + 12, 404, 'CREA NUOVA STANZA', { fill: '#7CFF7C', fontSize: '14px', fontFamily: 'VT323, monospace' });
        createBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.showCreateRoomModal());

        // Join by code input
        this.add.text(24, 360, 'Entra con codice stanza:', { fill: '#7CFF7C', fontFamily: 'VT323, monospace' });
        const joinInput = this.add.dom(220, 368).createFromHTML('<input id="joinCode" placeholder="XXXXXX" style="width:120px;font-family:VT323,monospace;background:#001;color:#7CFF7C;border:1px solid #224;padding:6px">');
        const joinBtn = this.add.text(360, 364, 'JOIN', { fill: '#7CFF7C', fontFamily: 'VT323, monospace' }).setInteractive({ useHandCursor: true });
        joinBtn.on('pointerdown', () => {
            const code = joinInput.node.querySelector('#joinCode').value.trim().toUpperCase();
            if (!code) { this.showToast('Inserisci codice stanza', 1500); return; }
            this.socket.emit('joinRoomByCode', code);
        });

        // Pannello stanza corrente (se dentro una stanza)
        this.roomPanel = this.add.container(320, 92);
        this.roomPanel.setVisible(false);

        // Ascoltatori socket
        this.socket.on('init', (data) => {
            this.registry.set('playerId', data.playerId);
        });

        this.socket.on('roomList', (rooms) => {
            this.rooms = rooms;
            this.updateRoomsList();
        });

        this.socket.on('nickRejected', (msg) => {
            this.showToast(msg, 3000);
            // reopen nickname modal
            this.showNicknameModal();
        });

        this.socket.on('roomJoined', (roomInfo) => {
            this.currentRoom = roomInfo;
            this.roomPanel.setVisible(true);
            this.updateRoomPanel();
        });

        this.socket.on('roomUpdated', (roomInfo) => {
            this.currentRoom = roomInfo;
            this.updateRoomPanel();
        });

        this.socket.on('roomLeft', (data) => {
            const myId = this.registry.get('playerId');
            if (data.playerId === myId) {
                this.currentRoom = null;
                this.roomPanel.setVisible(false);
            } else {
                // Aggiorna lista stanze quando un altro player lascia
                this.socket.emit('getRooms');
            }
        });

        // Evento per il giocatore che ha lasciato (risposta diretta del server)
        this.socket.on('leftRoom', () => {
            this.currentRoom = null;
            this.roomPanel.setVisible(false);
            this.socket.emit('getRooms');
        });

        this.socket.on('gameStarting', (data) => {
            // Passa i dati alla scena di gioco
            this.registry.set('gameData', data);
            this.scene.start('GameScene');
        });

        this.socket.on('error', (msg) => {
            this.showToast('Errore: ' + msg, 3000);
        });

        // Se non abbiamo nickname, chiedilo in schermata, altrimenti invia subito al server
        if (!this.nickname) {
            this.showNicknameModal();
        } else {
            this.socket.emit('setNickname', this.nickname);
            this.socket.emit('getRooms');
        }

        // piccolo container per toast
        this.toastGroup = this.add.group();

        // Pulsante logout top-right
        const logoutRect = this.add.rectangle(620, 12, 36, 18, 0x112211).setOrigin(1,0);
        const logoutText = this.add.text(612, 14, 'EXIT', { fontFamily: 'VT323, monospace', fontSize: '12px', color: '#FFAA88' }).setOrigin(1,0);
        logoutRect.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.doLogout());
    }

    updateRoomsList() {
        this.roomsContainer.removeAll(true);
        let y = 0;
        for (let room of this.rooms) {
            const text = `${room.name} (${room.mode}) - ${room.playerCount}/${room.maxPlayers}`;
            const btn = this.add.text(0, y, text, { fill: '#fff', backgroundColor: '#444', padding: { x: 5, y: 2 } })
                .setInteractive()
                .on('pointerdown', () => {
                    this.socket.emit('joinRoom', room.id);
                });
            this.roomsContainer.add(btn);
            y += 30;
        }
    }

    updateRoomPanel() {
        this.roomPanel.removeAll(true);
        const room = this.currentRoom;
        if (!room) return;

        // Titolo stanza
        this.roomPanel.add(this.add.text(0, 0, `Stanza: ${room.name} (${room.mode})`, { fill: '#ff0' }));

        // Lista giocatori
        let y = 30;
        for (let p of room.players) {
            const readyText = p.ready ? 'Pronto' : 'Non pronto';
            const color = p.ready ? '#0f0' : '#f00';
            const text = `${p.nickname} - ${readyText}`;
            this.roomPanel.add(this.add.text(10, y, text, { fill: color }));
            y += 20;
        }

        // Pulsante ready (se non già pronto)
        myId = this.registry.get('playerId');
        const me = room.players.find(p => p.id === myId);
        if (me && !me.ready) {
            const readyBtn = this.add.text(10, y + 10, 'Pronto', { fill: '#0f0', backgroundColor: '#333', padding: { x: 10, y: 5 } })
                .setInteractive()
                .on('pointerdown', () => {
                    this.socket.emit('playerReady');
                });
            this.roomPanel.add(readyBtn);
        }

        // Pulsante esci
        const leaveBtn = this.add.text(10, y + 50, 'Esci', { fill: '#f00', backgroundColor: '#333', padding: { x: 10, y: 5 } })
            .setInteractive()
            .on('pointerdown', () => {
                this.socket.emit('leaveRoom');
            });
        this.roomPanel.add(leaveBtn);

        // If owner and private, show join code with copy button
        if (room.isPrivate && room.ownerId === myId) {
            const codeText = this.add.text(10, y + 80, `Codice stanza: ${room.joinCode || '---'}`, { fill: '#7CFF7C', fontFamily: 'VT323, monospace' });
            const copyBtn = this.add.text(10, y + 100, 'Copia codice', { fill: '#0ff', backgroundColor: '#002', padding: { x:8, y:4 } }).setInteractive({ useHandCursor: true });
            copyBtn.on('pointerdown', () => {
                try { navigator.clipboard.writeText(room.joinCode || ''); this.showToast('Codice copiato negli appunti', 1500); } catch (e) { this.showToast('Copia non supportata', 1500); }
            });
            this.roomPanel.add([codeText, copyBtn]);
            y += 40;
        }
    }

        showCreateRoomModal() {
                const html = `
                <div style="font-family: VT323, monospace; color: #7CFF7C; background:#04110b; padding:12px; border:2px solid #133; width:360px">
                    <form id="createRoomForm">
                        <div style="margin-bottom:8px">Nome stanza:<br><input name="roomName" style="width:100%; font-family: VT323, monospace; background:#001; color:#7CFF7C; border:1px solid #224; padding:4px" /></div>
                        <div style="margin-bottom:8px">Modalità:<br>
                            <select name="mode" id="modeSel" style="width:100%; font-family: VT323, monospace; background:#001; color:#7CFF7C; border:1px solid #224; padding:4px">
                                <option value="teamDM">Team DM</option>
                                <option value="ffa">FFA</option>
                            </select>
                        </div>
                        <div style="margin-bottom:8px">Max giocatori:<br><input type="number" name="maxPlayers" min="2" max="12" value="4" style="width:100%; font-family:VT323,monospace;background:#001;color:#7CFF7C;border:1px solid #224;padding:4px" /></div>
                        <div style="margin-bottom:8px">Numero squadre (solo teamDM):<br><input type="number" name="numTeams" min="2" max="4" value="2" style="width:100%; font-family:VT323,monospace;background:#001;color:#7CFF7C;border:1px solid #224;padding:4px" /></div>
                        <div style="margin-bottom:8px"><label><input type="checkbox" name="isPrivate" /> Stanza privata</label></div>
                        <div style="text-align:right"><button type="submit" style="font-family: VT323, monospace; background:#133; color:#7CFF7C; border:1px solid #224; padding:6px">Crea</button>
                        <button type="button" id="cancelBtn" style="font-family: VT323, monospace; background:#331; color:#ffcccc; border:1px solid #224; padding:6px; margin-left:6px">Annulla</button></div>
                    </form>
                </div>
                `;
                const dom = this.add.dom(320, 240).createFromHTML(html);
                const form = dom.node.querySelector('#createRoomForm');
                const cancel = dom.node.querySelector('#cancelBtn');
                const cleanup = () => { dom.destroy(); };
                cancel.addEventListener('click', () => cleanup());
                form.addEventListener('submit', (e) => {
                        e.preventDefault();
                        const roomName = form.elements['roomName'].value.trim();
                        const mode = form.elements['mode'].value;
                        const isPrivate = form.elements['isPrivate'].checked;
                        const maxPlayers = parseInt(form.elements['maxPlayers'].value) || null;
                        const numTeams = parseInt(form.elements['numTeams'].value) || 2;
                        if (!roomName) { this.showToast('Inserisci un nome stanza', 2000); return; }
                        this.socket.emit('createRoom', { roomName, mode, isPrivate, maxPlayers, numTeams });
                        cleanup();
                });
        }

        showNicknameModal() {
                const html = `
                <div style="font-family: VT323, monospace; color: #7CFF7C; background:#04110b; padding:12px; border:2px solid #133; width:360px">
                    <form id="nickForm">
                        <div style="margin-bottom:8px">Scegli il tuo nickname:<br><input name="nickname" placeholder="Player01" style="width:100%; font-family: VT323, monospace; background:#001; color:#7CFF7C; border:1px solid #224; padding:6px" /></div>
                        <div style="text-align:right"><button type="submit" style="font-family: VT323, monospace; background:#133; color:#7CFF7C; border:1px solid #224; padding:6px">Entra</button></div>
                    </form>
                </div>
                `;
                const dom = this.add.dom(320, 220).createFromHTML(html);
                const form = dom.node.querySelector('#nickForm');
                form.addEventListener('submit', (e) => {
                        e.preventDefault();
                        const nick = form.elements['nickname'].value.trim() || 'Guest';
                        this.registry.set('nickname', nick);
                        this.nickname = nick;
                        localStorage.setItem('nickname', nick);
                        dom.destroy();
                    // include selected character
                    const payload = { nickname: nick, character: this.selectedChar };
                    this.socket.emit('setNickname', payload);
                        this.socket.emit('getRooms');
                        this.showToast('Benvenuto ' + nick, 2000);
                });
        }

        showToast(text, ms = 2000) {
                const x = 520, y = 20;
                const t = this.add.text(x, y, text, { fontFamily: 'VT323, monospace', fontSize: '14px', color: '#7CFF7C', backgroundColor: '#001', padding: { x:8, y:6 } }).setOrigin(1,0);
                this.tweens.add({ targets: t, alpha: { from: 0, to: 1 }, duration: 150, yoyo: false });
                this.time.delayedCall(ms, () => { this.tweens.add({ targets: t, alpha: 0, duration: 300, onComplete: () => t.destroy() }); });
        }

    preload() {
        const g = this.make.graphics({ x:0, y:0, add:false });
        
        // Texture giocatori (solo per riferimento, ma useremo grafica vettoriale)
        // Non strettamente necessario perché usiamo cerchi, ma per i muri/erba serve.
        g.fillStyle(0x44aa44);
        g.fillRect(0,0,32,32);
        g.generateTexture('grass', 32,32);
        g.clear();

        g.fillStyle(0x884422);
        g.fillRect(0,0,32,32);
        g.lineStyle(2,0x331100);
        for (let i=0;i<32;i+=8) { g.moveTo(i,0); g.lineTo(i,32); g.moveTo(0,i); g.lineTo(32,i); }
        g.strokePath();
        g.generateTexture('wall', 32,32);
        g.clear();

        g.fillStyle(0xffaa00);
        g.fillRect(12,14,8,4);
        g.generateTexture('laser', 32,32);
    }

    selectCharacter(id) {
        this.selectedChar = id;
        localStorage.setItem('selectedChar', id);
        this.updateCharSelectionVisual();
    }

    updateCharSelectionVisual() {
        for (let ch of this.availableChars) {
            const icons = this.charIcons && this.charIcons[ch.id];
            if (!icons) continue;
            if (this.selectedChar === ch.id) {
                icons.box.setStrokeStyle(2, 0x7CFF7C);
            } else {
                icons.box.setStrokeStyle(0);
            }
        }
    }

    doLogout() {
        try { this.socket.emit('logout'); } catch (e) {}
        try { this.socket.disconnect(); } catch (e) {}
        localStorage.removeItem('nickname');
        // ricarica la pagina per mostrare il modal nickname
        window.location.reload();
    }
}