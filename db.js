// 🗺️ RP World Tracker — db.js
// IndexedDB Manager

const DB_NAME = 'RPWorldTracker';
const DB_VERSION = 2;

export class WorldTrackerDB {
    constructor() {
        this.db = null;
    }

    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                if (!db.objectStoreNames.contains('locations')) {
                    const locStore = db.createObjectStore('locations', { keyPath: 'id' });
                    locStore.createIndex('chatId', 'chatId', { unique: false });
                    locStore.createIndex('chatId_name', ['chatId', 'name'], { unique: false });
                }

                if (!db.objectStoreNames.contains('movements')) {
                    const movStore = db.createObjectStore('movements', { keyPath: 'id', autoIncrement: true });
                    movStore.createIndex('chatId', 'chatId', { unique: false });
                    movStore.createIndex('chatId_timestamp', ['chatId', 'timestamp'], { unique: false });
                }

                if (!db.objectStoreNames.contains('mapConfig')) {
                    db.createObjectStore('mapConfig', { keyPath: 'chatId' });
                }

                if (!db.objectStoreNames.contains('distances')) {
                    const distStore = db.createObjectStore('distances', { keyPath: 'id' });
                    distStore.createIndex('chatId', 'chatId', { unique: false });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };

            request.onerror = (e) => reject(e.target.error);
        });
    }

    _tx(storeName, mode = 'readonly') {
        return this.db.transaction(storeName, mode).objectStore(storeName);
    }

    // ---- Location ----
    async putLocation(loc) {
        return this._promise(this._tx('locations', 'readwrite').put(loc), loc);
    }

    async getLocationsByChatId(chatId) {
        return this._promiseResult(this._tx('locations').index('chatId').getAll(chatId));
    }

    async deleteLocation(id) {
        return this._promise(this._tx('locations', 'readwrite').delete(id), true);
    }

    // ---- Movement ----
    async addMovement(mov) {
        return this._promise(this._tx('movements', 'readwrite').add(mov), mov);
    }

    async getMovementsByChatId(chatId) {
        return this._promiseResult(this._tx('movements').index('chatId').getAll(chatId));
    }

    // ---- MapConfig ----
    async getMapConfig(chatId) {
        return this._promiseResult(this._tx('mapConfig').get(chatId));
    }

    async saveMapConfig(config) {
        return this._promise(this._tx('mapConfig', 'readwrite').put(config), config);
    }

    // ---- Distance ----
    async saveDistance(data) {
        return this._promise(this._tx('distances', 'readwrite').put(data), data);
    }

    async getDistancesByChatId(chatId) {
        return this._promiseResult(this._tx('distances').index('chatId').getAll(chatId));
    }

    // ---- Helpers ----
    _promise(request, value) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(value);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    _promiseResult(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    }
}
