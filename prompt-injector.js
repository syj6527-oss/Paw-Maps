// 🗺️ RP World Tracker — prompt-injector.js

import { extension_settings } from '../../../extensions.js';
import { EXTENSION_NAME, PROMPT_KEY } from './index.js';

function getSetExtPrompt() {
    try {
        if (typeof window.setExtensionPrompt === 'function') return window.setExtensionPrompt;
        if (typeof globalThis.setExtensionPrompt === 'function') return globalThis.setExtensionPrompt;
    } catch (_) {}
    return null;
}

export class PromptInjector {
    constructor(lm) { this.lm = lm; this._lastPrompt = ''; }

    inject() {
        const text = this.generate();
        const fn = getSetExtPrompt();
        try {
            if (fn) { fn(PROMPT_KEY, text || '', 1, 0); if (text) console.log(`[${EXTENSION_NAME}] Prompt injected (${text.length}c)`); }
            else { this._lastPrompt = text; }
        } catch (e) { console.warn(`[${EXTENSION_NAME}] Prompt error:`, e.message); }
    }

    clear() { const fn = getSetExtPrompt(); try { if (fn) fn(PROMPT_KEY, '', 1, 0); } catch (_) {} this._lastPrompt = ''; }

    generate() {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.aiInjection || this.lm.locations.length === 0) return '';

        const uLoc = this.lm.locations.find(l => l.id === this.lm.userLocationId);
        const cLoc = this.lm.locations.find(l => l.id === this.lm.charLocationId);
        const main = cLoc || uLoc || this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        if (!main) return '';

        const L = ['[🗺️ World Tracker — Location Context]'];

        // 위치
        if (uLoc && cLoc && uLoc.id !== cLoc.id) {
            L.push(`👤 User: ${uLoc.name}`);
            L.push(`🎭 Character: ${cLoc.name}`);
        } else {
            L.push(`📍 Current: ${main.name}`);
        }

        if (main.status) L.push(`🌤️ Status: ${main.status}`);
        if (main.visitCount > 0) L.push(`📊 ${main.visitCount === 1 ? 'First visit' : `Visited ${main.visitCount} times`}`);
        if (main.memo) L.push(`💭 Memory: ${this._mem(main)}`);

        const last = this._lastMove();
        if (last) L.push(`🚶 Last: ${last}`);
        const near = this._near(main);
        if (near) L.push(`📌 Nearby: ${near}`);

        L.push('[/World Tracker]');
        return L.join('\n');
    }

    _mem(loc) {
        const s = extension_settings[EXTENSION_NAME];
        const m = loc.memo || '';
        if (s.memoryMode === 'perfect') return m;
        if (!loc.lastVisited) return m;
        const days = (Date.now() - loc.lastVisited) / 86400000;
        if (days <= (s.memorySummaryDays || 7)) return m;
        return m.length > 50 ? m.substring(0, 50) + '... (faded)' : m + ' (faded)';
    }

    _lastMove() {
        if (!this.lm.movements.length) return null;
        const last = [...this.lm.movements].sort((a, b) => b.timestamp - a.timestamp)[0];
        const f = this.lm.locations.find(l => l.id === last.fromId);
        const t = this.lm.locations.find(l => l.id === last.toId);
        if (!f || !t) return null;
        let r = `${f.name} → ${t.name}`;
        if (last.distance) r += ` (${last.distance})`;
        return r;
    }

    _near(cur) {
        const n = [];
        for (const d of this.lm.distances || []) {
            let oid = d.fromId === cur.id ? d.toId : d.toId === cur.id ? d.fromId : null;
            if (!oid) continue;
            const o = this.lm.locations.find(l => l.id === oid);
            if (o) n.push(`${o.name}(${d.distanceText})`);
        }
        return n.length ? n.slice(0, 3).join(', ') : null;
    }
}
