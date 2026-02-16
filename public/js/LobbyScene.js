// ============================================================
//  LOBBY SCENE — CYBERPUNK TERMINAL (Enhanced Edition)
// ============================================================
class LobbyScene extends Phaser.Scene {
    constructor() { super({ key: 'LobbyScene' }); }

    init() {
        this.socket      = this.registry.get('socket');
        this.nickname    = this.registry.get('nickname');
        this.rooms       = [];
        this.currentRoom = null;
    }

    preload() {
        // Reuse textures from GameScene if available, otherwise generate
        if (!this.textures.exists('floor_tile')) this._genBasicTextures();
    }

    _genBasicTextures() {
        const g = this.make.graphics({ add: false });
        g.fillStyle(0x04090f); g.fillRect(0,0,32,32);
        g.lineStyle(1,0x0d2040,1); g.strokeRect(0,0,32,32);
        g.generateTexture('floor_tile',32,32); g.clear();
        g.destroy();
    }

    create() {
        this._drawBackground();
        this._drawUI();
        this._setupCharPreviews();
        this._setupSocketListeners();

        if (!this.nickname) {
            this.showNicknameModal();
        } else {
            this.socket.emit('setNickname', this.nickname);
            this.socket.emit('getRooms');
        }
    }

    // ── BACKGROUND ───────────────────────────────────────────
    _drawBackground() {
        // Dark base
        this.add.rectangle(0,0,640,480,0x020810).setOrigin(0);

        // Scrolling floor tiles
        this.floorBg = this.add.tileSprite(0,0,640,480,'floor_tile').setOrigin(0).setAlpha(0.7);

        // Horizontal glow bars (decorative)
        for (let i = 0; i < 4; i++) {
            const y = 80 + i * 110;
            this.add.rectangle(0, y, 640, 1, 0x0a2040, 0.6).setOrigin(0);
        }

        // Top & bottom neon borders
        const topGlow = this.add.graphics();
        topGlow.lineStyle(2, 0x00ddff, 0.8);
        topGlow.lineBetween(0, 44, 640, 44);
        topGlow.lineStyle(1, 0x00ddff, 0.3);
        topGlow.lineBetween(0, 46, 640, 46);

        const botGlow = this.add.graphics();
        botGlow.lineStyle(2, 0x00ddff, 0.8);
        botGlow.lineBetween(0, 436, 640, 436);
        botGlow.lineStyle(1, 0x00ddff, 0.3);
        botGlow.lineBetween(0, 434, 640, 434);

        // Left panel border
        const panelBorder = this.add.graphics();
        panelBorder.lineStyle(1, 0x1a4488, 0.7);
        panelBorder.strokeRect(8, 52, 310, 375);

        // Right panel border
        panelBorder.strokeRect(322, 52, 310, 375);

        // Scanlines
        const scan = this.make.graphics({ add: false });
        scan.fillStyle(0x000000, 0.035);
        for (let y = 0; y < 480; y += 3) scan.fillRect(0, y, 640, 1);
        scan.generateTexture('scanlines_lobby', 640, 480);
        scan.destroy();
        this.add.image(0,0,'scanlines_lobby').setOrigin(0).setAlpha(0.8).setDepth(200);

        // Vignette
        const vg = this.add.graphics().setDepth(198);
        for (let i = 0; i < 25; i++) {
            vg.fillStyle(0x000000, i/25*0.5);
            vg.fillRect(i,i,640-i*2,2); vg.fillRect(i,478-i,640-i*2,2);
            vg.fillRect(i,i,2,480-i*2); vg.fillRect(638-i,i,2,480-i*2);
        }

        // Title
        const title = this.add.text(320, 12, '⚡ CYBER ARENA ⚡', {
            fontFamily: 'VT323, monospace', fontSize: '32px',
            color: '#00ddff', stroke: '#003355', strokeThickness: 3
        }).setOrigin(0.5, 0);

        // Pulsing title glow
        this.tweens.add({ targets: title, alpha: { from: 0.8, to: 1 }, scaleX: { from: 0.98, to: 1.01 }, scaleY: { from: 0.98, to: 1.01 }, duration: 1500, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

        // Player nickname display (top right)
        this.nickDisplay = this.add.text(620, 12, this.nickname ? `USER: ${this.nickname}` : '', {
            fontFamily: 'VT323, monospace', fontSize: '14px', color: '#44ff88'
        }).setOrigin(1, 0);
    }

    // ── MAIN UI ───────────────────────────────────────────────
    _drawUI() {
        // Left panel: room list
        this.add.text(14, 56, 'BATTLE ROOMS', {
            fontFamily: 'VT323, monospace', fontSize: '16px', color: '#00ddff'
        });
        this.add.graphics().lineStyle(1, 0x00ddff, 0.4).lineBetween(14, 72, 312, 72);

        this.roomsContainer = this.add.container(14, 78);

        // Create room button
        const cBtn = this.add.text(14, 405, '[ + CREATE NEW ROOM ]', {
            fontFamily: 'VT323, monospace', fontSize: '15px', color: '#00ff77',
            backgroundColor: '#001a0d', padding: { x: 8, y: 5 }
        }).setInteractive({ useHandCursor: true });
        cBtn.on('pointerover', () => cBtn.setColor('#88ffcc'));
        cBtn.on('pointerout',  () => cBtn.setColor('#00ff77'));
        cBtn.on('pointerdown', () => this.showCreateRoomModal());

        // Join by code
        this.add.text(14, 430, 'JOIN CODE:', { fontFamily: 'VT323, monospace', fontSize: '13px', color: '#88aacc' });
        const joinDom = this.add.dom(170, 438).createFromHTML(
            '<input id="joinCode" maxlength="6" placeholder="XXXXXX" style="width:90px;font-family:VT323,monospace;font-size:14px;background:#001122;color:#00ddff;border:1px solid #224466;padding:4px;letter-spacing:2px;text-transform:uppercase">'
        );
        const joinBtn = this.add.text(250, 430, '[JOIN]', {
            fontFamily: 'VT323, monospace', fontSize: '14px', color: '#ffdd22'
        }).setInteractive({ useHandCursor: true });
        joinBtn.on('pointerdown', () => {
            const code = joinDom.node.querySelector('#joinCode').value.trim().toUpperCase();
            if (!code) { this.showToast('Enter room code', 1500); return; }
            this.socket.emit('joinRoomByCode', code);
        });

        // Right panel: current room
        this.add.text(328, 56, 'CURRENT ROOM', {
            fontFamily: 'VT323, monospace', fontSize: '16px', color: '#00ddff'
        });
        this.add.graphics().lineStyle(1, 0x00ddff, 0.4).lineBetween(328, 72, 626, 72);

        this.roomPanel = this.add.container(328, 78);
        this.roomPanel.setVisible(false);

        // Logout
        const logBtn = this.add.text(620, 445, '[EXIT]', {
            fontFamily: 'VT323, monospace', fontSize: '13px', color: '#ff6644',
            backgroundColor: '#110500', padding: { x: 6, y: 4 }
        }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
        logBtn.on('pointerdown', () => this.doLogout());
    }

    // ── CHARACTER SELECTION WITH ANIMATED PREVIEWS ───────────
    _setupCharPreviews() {
        this.add.text(14, 340, 'SELECT UNIT:', {
            fontFamily: 'VT323, monospace', fontSize: '14px', color: '#88aacc'
        });

        this.availableChars = [
            { id: 'pc_blue',   primary: 0x22aaff, secondary: 0x0055aa, label: 'BYTE' },
            { id: 'pc_red',    primary: 0xff3344, secondary: 0xaa0011, label: 'CORE' },
            { id: 'pc_green',  primary: 0x22ffaa, secondary: 0x008844, label: 'HACK' },
            { id: 'pc_yellow', primary: 0xffdd22, secondary: 0xaa8800, label: 'ZOLT' },
        ];
        this.selectedChar = localStorage.getItem('selectedChar') || this.availableChars[0].id;

        this.charSelections = {};
        let cx = 20;

        for (const ch of this.availableChars) {
            const x = cx, y = 380;
            // Card background
            const cardBg = this.add.rectangle(x+32, y, 64, 52, 0x030c16).setOrigin(0.5);
            const cardBorder = this.add.graphics();
            cardBorder.lineStyle(1, ch.primary, 0.5);
            cardBorder.strokeRect(x, y-26, 64, 52);

            // Mini robot preview (simplified, using shapes)
            const previewContainer = this._createMiniRobotPreview(x + 32, y - 4, ch.primary, ch.secondary);

            // Label
            const label = this.add.text(x+32, y+24, ch.label, {
                fontFamily: 'VT323, monospace', fontSize: '12px', color: '#'+ch.primary.toString(16).padStart(6,'0')
            }).setOrigin(0.5, 0);

            // Clickable area
            const hitArea = this.add.rectangle(x+32, y, 64, 52, 0x000000, 0)
                .setOrigin(0.5).setInteractive({ useHandCursor: true });

            hitArea.on('pointerdown', () => this._selectChar(ch.id));
            hitArea.on('pointerover', () => { cardBg.setFillStyle(0x0a1e30); });
            hitArea.on('pointerout',  () => { cardBg.setFillStyle(0x030c16); });

            this.charSelections[ch.id] = { cardBg, cardBorder, label, previewContainer };
            cx += 70;
        }

        this._updateCharVisual();
    }

    _createMiniRobotPreview(x, y, pColor, sColor) {
        // Antenna
        const antS = this.add.rectangle(x, y-20, 1, 5, 0x445566);
        const antT = this.add.ellipse(x, y-23, 4, 4, pColor, 0.9);
        antT.setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: antT, alpha: { from: 0.4, to: 1 }, scale: { from: 0.7, to: 1.2 }, duration: 900, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

        // Head
        const head = this.add.rectangle(x, y-12, 12, 8, 0x0d1525);
        head.setStrokeStyle(1, sColor, 0.7);
        const visor = this.add.rectangle(x, y-12, 9, 5, pColor, 0.8);
        visor.setBlendMode(Phaser.BlendModes.ADD);

        // Body
        const body = this.add.rectangle(x, y-3, 14, 9, 0x0d1525);
        body.setStrokeStyle(1, sColor, 0.6);
        const chest = this.add.ellipse(x, y-3, 7, 7, pColor, 0.35);
        chest.setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: chest, alpha: { from: 0.15, to: 0.5 }, duration: 1100, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

        // Legs (animated walk)
        const legL = this.add.rectangle(x-3, y+5, 4, 7, 0x1a1a2e);
        const legR = this.add.rectangle(x+3, y+5, 4, 7, 0x1a1a2e);
        this.tweens.add({ targets: legL, y: y+5+3, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: legR, y: y+5-3, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 150 });

        return [antS, antT, body, chest, head, visor, legL, legR];
    }

    _selectChar(id) {
        this.selectedChar = id;
        localStorage.setItem('selectedChar', id);
        this._updateCharVisual();
        const ch = this.availableChars.find(c => c.id === id);
        if (ch) this.socket.emit('setCharacter', id);
    }

    _updateCharVisual() {
        for (const ch of this.availableChars) {
            const s = this.charSelections?.[ch.id];
            if (!s) continue;
            if (this.selectedChar === ch.id) {
                s.cardBorder.clear();
                s.cardBorder.lineStyle(2, ch.primary, 1);
                s.cardBorder.strokeRect(
                    this.charSelections[ch.id].cardBg.x - 32,
                    this.charSelections[ch.id].cardBg.y - 26,
                    64, 52
                );
                s.cardBg.setFillStyle(0x081828);
            } else {
                s.cardBorder.clear();
                s.cardBorder.lineStyle(1, ch.primary, 0.4);
                s.cardBorder.strokeRect(
                    this.charSelections[ch.id].cardBg.x - 32,
                    this.charSelections[ch.id].cardBg.y - 26,
                    64, 52
                );
                s.cardBg.setFillStyle(0x030c16);
            }
        }
    }

    // ── ROOM LIST ─────────────────────────────────────────────
    updateRoomsList() {
        this.roomsContainer.removeAll(true);
        if (this.rooms.length === 0) {
            this.roomsContainer.add(this.add.text(0, 0, 'No rooms. Create one!', {
                fontFamily: 'VT323, monospace', fontSize: '13px', color: '#446677'
            }));
            return;
        }
        let y = 0;
        for (const room of this.rooms) {
            const isFull = room.playerCount >= room.maxPlayers;
            const modeIcon = room.mode === 'teamDM' ? '⚔' : '☠';
            const txt = `${modeIcon} ${room.name}  [${room.mode.toUpperCase()}]  ${room.playerCount}/${room.maxPlayers}`;
            const bg = this.add.rectangle(0, y, 296, 24, 0x050f1a).setOrigin(0, 0);
            const btn = this.add.text(6, y + 3, txt, {
                fontFamily: 'VT323, monospace',
                fontSize: '13px',
                color: isFull ? '#446677' : '#aaddff'
            });
            if (!isFull) {
                bg.setInteractive({ useHandCursor: true });
                bg.on('pointerover', () => { bg.setFillStyle(0x0a2035); btn.setColor('#00ddff'); });
                bg.on('pointerout',  () => { bg.setFillStyle(0x050f1a); btn.setColor('#aaddff'); });
                bg.on('pointerdown', () => this.socket.emit('joinRoom', room.id));
            }
            // Accent line
            const accent = this.add.graphics();
            accent.lineStyle(1, isFull ? 0x224444 : 0x224466, 0.8);
            accent.lineBetween(0, y + 24, 296, y + 24);

            this.roomsContainer.add([bg, btn, accent]);
            y += 26;
        }
    }

    updateRoomPanel() {
        this.roomPanel.removeAll(true);
        const room = this.currentRoom;
        if (!room) return;

        const myId = this.registry.get('playerId');

        // Room title
        this.roomPanel.add(this.add.text(0, 0, room.name, {
            fontFamily: 'VT323, monospace', fontSize: '18px', color: '#ffdd22'
        }));
        this.roomPanel.add(this.add.text(0, 20, `MODE: ${room.mode.toUpperCase()}  |  ${room.playerCount}/${room.maxPlayers} PLAYERS`, {
            fontFamily: 'VT323, monospace', fontSize: '12px', color: '#88aacc'
        }));

        // Separator
        const sep = this.add.graphics();
        sep.lineStyle(1, 0x224466, 0.7);
        sep.lineBetween(0, 36, 296, 36);
        this.roomPanel.add(sep);

        // Player list
        let y = 44;
        for (const p of room.players) {
            const col = p.ready ? '#00ff77' : '#ff4444';
            const icon = p.ready ? '✓' : '○';
            const isMe = p.id === myId;
            const playerLine = this.add.text(0, y, `${icon} ${p.nickname}${isMe ? ' (YOU)' : ''}`, {
                fontFamily: 'VT323, monospace', fontSize: '14px', color: col
            });
            this.roomPanel.add(playerLine);
            y += 22;
        }

        // Ready button
        const me = room.players.find(p => p.id === myId);
        if (me && !me.ready) {
            const readyBtn = this.add.text(0, y + 8, '[ READY TO FIGHT ]', {
                fontFamily: 'VT323, monospace', fontSize: '15px', color: '#00ff77',
                backgroundColor: '#001a0d', padding: { x: 8, y: 5 }
            }).setInteractive({ useHandCursor: true });
            readyBtn.on('pointerover', () => readyBtn.setColor('#88ffcc'));
            readyBtn.on('pointerout',  () => readyBtn.setColor('#00ff77'));
            readyBtn.on('pointerdown', () => this.socket.emit('playerReady'));
            this.roomPanel.add(readyBtn);
            y += 32;
        }

        // Leave button
        const leaveBtn = this.add.text(0, y + 16, '[ LEAVE ROOM ]', {
            fontFamily: 'VT323, monospace', fontSize: '13px', color: '#ff4444',
            backgroundColor: '#160000', padding: { x: 8, y: 4 }
        }).setInteractive({ useHandCursor: true });
        leaveBtn.on('pointerdown', () => this.socket.emit('leaveRoom'));
        this.roomPanel.add(leaveBtn);
        y += 28;

        // Private room code
        if (room.isPrivate && room.ownerId === myId && room.joinCode) {
            this.roomPanel.add(this.add.text(0, y + 16, `ROOM CODE: ${room.joinCode}`, {
                fontFamily: 'VT323, monospace', fontSize: '13px', color: '#ffdd22'
            }));
            const copyBtn = this.add.text(0, y + 36, '[ COPY CODE ]', {
                fontFamily: 'VT323, monospace', fontSize: '12px', color: '#00ddff',
                backgroundColor: '#001122', padding: { x: 6, y: 3 }
            }).setInteractive({ useHandCursor: true });
            copyBtn.on('pointerdown', () => {
                try { navigator.clipboard.writeText(room.joinCode); this.showToast('Code copied!', 1500); } catch(e) {}
            });
            this.roomPanel.add(copyBtn);
        }
    }

    // ── SOCKET LISTENERS ──────────────────────────────────────
    _setupSocketListeners() {
        this.socket.on('init', (data) => this.registry.set('playerId', data.playerId));

        this.socket.on('roomList', (rooms) => {
            this.rooms = rooms;
            this.updateRoomsList();
        });

        this.socket.on('nickRejected', (msg) => {
            this.showToast(msg, 3000);
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
            if (data.playerId === this.registry.get('playerId')) {
                this.currentRoom = null;
                this.roomPanel.setVisible(false);
            } else {
                this.socket.emit('getRooms');
            }
        });

        this.socket.on('leftRoom', () => {
            this.currentRoom = null;
            this.roomPanel.setVisible(false);
            this.socket.emit('getRooms');
        });

        this.socket.on('gameStarting', (data) => {
            this.registry.set('gameData', data);
            this._showCountdownAndStart(data);
        });

        this.socket.on('error', (msg) => this.showToast('ERROR: ' + msg, 3000));
    }

    _showCountdownAndStart(data) {
        // Dramatic countdown overlay
        const overlay = this.add.rectangle(0,0,640,480,0x000000,0).setOrigin(0).setDepth(300);
        this.tweens.add({ targets: overlay, alpha: 0.7, duration: 200 });

        const msg = this.add.text(320, 200, 'MATCH STARTING', {
            fontFamily: 'VT323, monospace', fontSize: '36px', color: '#00ddff',
            stroke: '#003355', strokeThickness: 3
        }).setOrigin(0.5).setDepth(301).setAlpha(0);

        this.tweens.add({ targets: msg, alpha: 1, scaleX: { from: 0.5, to: 1 }, scaleY: { from: 0.5, to: 1 }, duration: 400, ease: 'Back.easeOut' });

        let count = 3;
        const countTxt = this.add.text(320, 280, String(count), {
            fontFamily: 'VT323, monospace', fontSize: '72px', color: '#ffdd22'
        }).setOrigin(0.5).setDepth(301);

        const tick = this.time.addEvent({
            delay: 800, repeat: 2, callback: () => {
                count--;
                if (count <= 0) {
                    this.scene.start('GameScene');
                } else {
                    countTxt.setText(String(count));
                    this.tweens.add({ targets: countTxt, scaleX: { from: 1.5, to: 1 }, scaleY: { from: 1.5, to: 1 }, duration: 200 });
                }
            }
        });
    }

    // ── MODALS ────────────────────────────────────────────────
    showCreateRoomModal() {
        const html = `
<div style="font-family:VT323,monospace;color:#00ddff;background:#020c1a;padding:16px;border:2px solid #224466;width:340px;box-shadow:0 0 20px rgba(0,150,255,0.3)">
    <div style="font-size:20px;color:#00ddff;margin-bottom:12px;border-bottom:1px solid #224466;padding-bottom:6px">CREATE BATTLE ROOM</div>
    <form id="createRoomForm">
        <div style="margin-bottom:10px"><label style="color:#88aacc;font-size:14px">ROOM NAME</label><br>
            <input name="roomName" style="width:100%;font-family:VT323,monospace;font-size:15px;background:#010a14;color:#00ddff;border:1px solid #224466;padding:6px;margin-top:3px"></div>
        <div style="margin-bottom:10px"><label style="color:#88aacc;font-size:14px">GAME MODE</label><br>
            <select name="mode" style="width:100%;font-family:VT323,monospace;font-size:15px;background:#010a14;color:#00ddff;border:1px solid #224466;padding:6px;margin-top:3px">
                <option value="teamDM">TEAM DEATHMATCH</option>
                <option value="ffa">FREE FOR ALL</option>
            </select></div>
        <div style="display:flex;gap:12px;margin-bottom:10px">
            <div style="flex:1"><label style="color:#88aacc;font-size:14px">MAX PLAYERS</label><br>
                <input type="number" name="maxPlayers" min="2" max="12" value="4" style="width:100%;font-family:VT323,monospace;font-size:15px;background:#010a14;color:#00ddff;border:1px solid #224466;padding:6px;margin-top:3px"></div>
            <div style="flex:1"><label style="color:#88aacc;font-size:14px">TEAMS</label><br>
                <input type="number" name="numTeams" min="2" max="4" value="2" style="width:100%;font-family:VT323,monospace;font-size:15px;background:#010a14;color:#00ddff;border:1px solid #224466;padding:6px;margin-top:3px"></div>
        </div>
        <div style="margin-bottom:14px"><label style="color:#88aacc;font-size:14px"><input type="checkbox" name="isPrivate" style="margin-right:6px"> PRIVATE ROOM</label></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
            <button type="button" id="cancelCreate" style="font-family:VT323,monospace;font-size:15px;background:#160000;color:#ff6644;border:1px solid #442200;padding:8px 16px;cursor:pointer">CANCEL</button>
            <button type="submit" style="font-family:VT323,monospace;font-size:15px;background:#001a0d;color:#00ff77;border:1px solid #004422;padding:8px 16px;cursor:pointer">CREATE</button>
        </div>
    </form>
</div>`;
        const dom = this.add.dom(320, 240).createFromHTML(html).setDepth(250);
        dom.node.querySelector('#cancelCreate').onclick = () => dom.destroy();
        dom.node.querySelector('#createRoomForm').onsubmit = (e) => {
            e.preventDefault();
            const f = e.target;
            const roomName = f.elements['roomName'].value.trim();
            if (!roomName) { this.showToast('Enter a room name', 1500); return; }
            this.socket.emit('createRoom', {
                roomName, mode: f.elements['mode'].value,
                isPrivate: f.elements['isPrivate'].checked,
                maxPlayers: parseInt(f.elements['maxPlayers'].value) || null,
                numTeams: parseInt(f.elements['numTeams'].value) || 2
            });
            dom.destroy();
        };
    }

    showNicknameModal() {
        const html = `
<div style="font-family:VT323,monospace;color:#00ddff;background:#020c1a;padding:20px;border:2px solid #224466;width:320px;box-shadow:0 0 20px rgba(0,150,255,0.4)">
    <div style="font-size:24px;color:#00ddff;margin-bottom:6px">⚡ ENTER THE ARENA</div>
    <div style="font-size:13px;color:#446688;margin-bottom:14px">Choose your pilot designation</div>
    <form id="nickForm">
        <input name="nickname" placeholder="PILOT_NAME" maxlength="18" style="width:100%;font-family:VT323,monospace;font-size:20px;background:#010a14;color:#00ddff;border:1px solid #224466;padding:8px;margin-bottom:12px;text-transform:uppercase;letter-spacing:2px">
        <button type="submit" style="width:100%;font-family:VT323,monospace;font-size:18px;background:#001a0d;color:#00ff77;border:1px solid #004422;padding:10px;cursor:pointer">JACK IN</button>
    </form>
</div>`;
        const dom = this.add.dom(320, 220).createFromHTML(html).setDepth(250);
        dom.node.querySelector('#nickForm').onsubmit = (e) => {
            e.preventDefault();
            const nick = e.target.elements['nickname'].value.trim() || 'GHOST';
            this.registry.set('nickname', nick);
            this.nickname = nick;
            localStorage.setItem('nickname', nick);
            if (this.nickDisplay) this.nickDisplay.setText('USER: ' + nick);
            dom.destroy();
            this.socket.emit('setNickname', { nickname: nick, character: this.selectedChar });
            this.socket.emit('getRooms');
            this.showToast('Welcome, ' + nick + '!', 2000);
        };
    }

    showToast(text, ms = 2000) {
        if (this._toast?.active) this._toast.destroy();
        this._toast = this.add.text(320, 460, text, {
            fontFamily: 'VT323, monospace', fontSize: '15px', color: '#00ddff',
            backgroundColor: '#000811', padding: { x: 12, y: 6 },
            stroke: '#00ddff', strokeThickness: 1
        }).setOrigin(0.5, 0).setDepth(300).setAlpha(0);
        this.tweens.add({ targets: this._toast, alpha: 1, duration: 150 });
        this.time.delayedCall(ms - 250, () => {
            if (this._toast?.active)
                this.tweens.add({ targets: this._toast, alpha: 0, duration: 250, onComplete: () => this._toast?.destroy() });
        });
    }

    doLogout() {
        try { this.socket.emit('logout'); this.socket.disconnect(); } catch(e) {}
        localStorage.removeItem('nickname');
        window.location.reload();
    }

    update() {
        if (this.floorBg) { this.floorBg.tilePositionX += 0.06; this.floorBg.tilePositionY += 0.03; }
    }
}
