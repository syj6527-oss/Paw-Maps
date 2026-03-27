// 🗺️ RP World Tracker — location-manager.js
// Location CRUD + Distance + Movement

import { getContext } from '../../../extensions.js';
import { EXTENSION_NAME } from './index.js';

export class LocationManager {
    constructor(db) {
        this.db = db;
        this.currentChatId = null;
        this.currentLocationId = null;
        this.locations = [];
        this.movements = [];
        this.distances = [];
    }

    getChatId() {
        const context = getContext();
        if (!context?.chatId) return null;
        return String(context.chatId);
    }

    generateId() {
        return `loc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    async loadChat() {
        this.currentChatId = this.getChatId();
        if (!this.currentChatId) {
            this.locations = [];
            this.movements = [];
            this.distances = [];
            this.currentLocationId = null;
            return;
        }

        this.locations = await this.db.getLocationsByChatId(this.currentChatId) || [];
        this.movements = await this.db.getMovementsByChatId(this.currentChatId) || [];
        this.distances = await this.db.getDistancesByChatId(this.currentChatId) || [];

        const config = await this.db.getMapConfig(this.currentChatId);
        if (config) {
            this.currentLocationId = config.currentLocationId || null;
        }

        console.log(`[${EXTENSION_NAME}] Loaded: ${this.locations.length} locs, ${this.movements.length} moves`);
    }

    // ---- Location CRUD ----

    async addLocation(name, memo = '', aliases = []) {
        if (!this.currentChatId) return null;

        const location = {
            id: this.generateId(),
            chatId: this.currentChatId,
            name: name.trim(),
            aliases: aliases.map(a => a.trim()).filter(Boolean),
            x: 0, y: 0,
            visitCount: 0,
            firstVisited: null,
            lastVisited: null,
            memo: memo.trim(),
            status: '',
            discovered: true,
            color: this._randomColor(),
            createdAt: Date.now(),
        };

        const pos = this._autoPosition();
        location.x = pos.x;
        location.y = pos.y;

        await this.db.putLocation(location);
        this.locations.push(location);
        return location;
    }

    async updateLocation(id, updates) {
        const loc = this.locations.find(l => l.id === id);
        if (!loc) return null;
        Object.assign(loc, updates);
        await this.db.putLocation(loc);
        return loc;
    }

    async deleteLocation(id) {
        await this.db.deleteLocation(id);
        this.locations = this.locations.filter(l => l.id !== id);
        if (this.currentLocationId === id) {
            this.currentLocationId = null;
            await this._saveCurrentLocation();
        }
    }

    findByName(name) {
        const lower = name.toLowerCase();
        return this.locations.find(l =>
            l.name.toLowerCase() === lower ||
            (l.aliases || []).some(a => a.toLowerCase() === lower)
        );
    }

    // ---- Movement ----

    async moveTo(locationId) {
        const loc = this.locations.find(l => l.id === locationId);
        if (!loc) return;

        const prevId = this.currentLocationId;

        loc.visitCount = (loc.visitCount || 0) + 1;
        loc.lastVisited = Date.now();
        if (!loc.firstVisited) loc.firstVisited = Date.now();
        await this.db.putLocation(loc);

        if (prevId && prevId !== locationId) {
            const dist = this.getDistanceBetween(prevId, locationId);
            const movement = {
                chatId: this.currentChatId,
                fromId: prevId,
                toId: locationId,
                timestamp: Date.now(),
                distance: dist?.distanceText || null,
                walkTime: dist?.walkTime || null,
            };
            await this.db.addMovement(movement);
            this.movements.push(movement);
        }

        this.currentLocationId = locationId;
        await this._saveCurrentLocation();
    }

    // ---- Distance ----

    async setDistance(fromId, toId, distanceText, walkTime = null) {
        if (!this.currentChatId) return null;
        const id = [fromId, toId].sort().join('_');
        const data = { id, chatId: this.currentChatId, fromId, toId, distanceText, walkTime, updatedAt: Date.now() };
        await this.db.saveDistance(data);
        const idx = this.distances.findIndex(d => d.id === id);
        if (idx >= 0) this.distances[idx] = data;
        else this.distances.push(data);
        return data;
    }

    getDistanceBetween(fromId, toId) {
        const id = [fromId, toId].sort().join('_');
        return this.distances.find(d => d.id === id) || null;
    }

    // ---- Internal ----

    async _saveCurrentLocation() {
        if (!this.currentChatId) return;
        await this.db.saveMapConfig({ chatId: this.currentChatId, currentLocationId: this.currentLocationId });
    }

    _autoPosition() {
        const count = this.locations.length;
        if (count === 0) return { x: 300, y: 250 };
        const angle = count * 0.8;
        const radius = 80 + count * 25;
        return {
            x: Math.round(300 + radius * Math.cos(angle)),
            y: Math.round(250 + radius * Math.sin(angle)),
        };
    }

    _randomColor() {
        const colors = ['#F5A8A8', '#FCE7AE', '#A8E6CF', '#A8D8EA', '#C3B1E1', '#F5C6AA', '#B5EAD7', '#FFD3B6'];
        return colors[Math.floor(Math.random() * colors.length)];
    }
}
