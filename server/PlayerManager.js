class PlayerManager {
    constructor() {
        this.players = new Map(); // id -> { id, nickname, stats }
    }

    addPlayer(id, nickname, character = null) {
        const player = { id, nickname, currentRoom: null, character, stats: { kills: 0, deaths: 0 } };
        this.players.set(id, player);
        return player;
    }

    getPlayer(id) {
        return this.players.get(id);
    }

    removePlayer(id) {
        this.players.delete(id);
    }

    getAllPlayers() {
        return Array.from(this.players.values());
    }

    incrementKills(id, n = 1) {
        const p = this.players.get(id);
        if (p) p.stats.kills = (p.stats.kills || 0) + n;
    }

    incrementDeaths(id, n = 1) {
        const p = this.players.get(id);
        if (p) p.stats.deaths = (p.stats.deaths || 0) + n;
    }

    getStats(id) {
        const p = this.players.get(id);
        return p ? p.stats : { kills: 0, deaths: 0 };
    }
}

module.exports = PlayerManager;