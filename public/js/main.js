// Configurazione Phaser e avvio del gioco
const config = {
    type: Phaser.AUTO,
    width: 640,
    height: 480,
    parent: 'game-container',
    pixelArt: true,
    dom: { createContainer: true },
    scene: [ LobbyScene, GameScene ]
};

const game = new Phaser.Game(config);

// Variabile globale per nickname (verrà chiesta all'avvio)
// Non usare prompt; lasciare che la `LobbyScene` gestisca il nickname via DOM
let playerNickname = localStorage.getItem('nickname') || null;
if (playerNickname) game?.registry?.set && game.registry.set('nickname', playerNickname);

// Connessione socket
const socket = io();

// Passa il socket e il nickname alle scene
game.registry.set('socket', socket);
game.registry.set('nickname', playerNickname);
game.registry.set('playerId', null);