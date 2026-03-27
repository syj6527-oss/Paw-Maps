// 🗺️ RP World Tracker — prompt-injector.js
// AI 프롬프트에 현재 위치 데이터 주입 (Selective Injection)

import { extension_settings, setExtensionPrompt } from '../../../extensions.js';
import { EXTENSION_NAME, PROMPT_KEY } from './index.js';

export class PromptInjector {
    constructor(locationManager) {
        this.lm = locationManager;
    }

    /**
     * 프롬프트 텍스트 생성 + 주입
     */
    inject() {
        const text = this.generate();
        try {
            setExtensionPrompt(PROMPT_KEY, text || '', 1, 0);
            if (text) console.log(`[${EXTENSION_NAME}] Prompt injected (${text.length} chars)`);
        } catch (e) {
            console.warn(`[${EXTENSION_NAME}] Prompt injection unavailable:`, e.message);
        }
    }

    clear() {
        try { setExtensionPrompt(PROMPT_KEY, '', 1, 0); } catch (_) { /* silent */ }
    }

    /**
     * 현재 위치 기반 프롬프트 생성
     */
    generate() {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.aiInjection) return '';
        if (!this.lm.currentLocationId || this.lm.locations.length === 0) return '';

        const cur = this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        if (!cur) return '';

        const lines = ['[🗺️ World Tracker — Location Context]'];

        // 현재 위치
        lines.push(`📍 Current: ${cur.name}`);

        // 상태
        if (cur.status) lines.push(`🌤️ Status: ${cur.status}`);

        // 방문 횟수
        if (cur.visitCount > 0) {
            const suffix = cur.visitCount === 1 ? 'first visit' : `visited ${cur.visitCount} times`;
            lines.push(`📊 ${suffix}`);
        }

        // 메모 (기억 모드 적용)
        if (cur.memo) {
            lines.push(`💭 Memory: ${this._processMemory(cur)}`);
        }

        // 마지막 이동
        const lastMove = this._lastMove();
        if (lastMove) lines.push(`🚶 Moved from: ${lastMove}`);

        // 근처 장소
        const nearby = this._nearby(cur);
        if (nearby) lines.push(`📌 Nearby: ${nearby}`);

        lines.push('[/World Tracker]');
        return lines.join('\n');
    }

    _processMemory(loc) {
        const s = extension_settings[EXTENSION_NAME];
        const memo = loc.memo || '';

        if (s.memoryMode === 'perfect') return memo;

        // 자연스러운 기억: 오래된 건 요약
        if (!loc.lastVisited) return memo;
        const days = (Date.now() - loc.lastVisited) / 86400000;
        const threshold = s.memorySummaryDays || 7;

        if (days <= threshold) return memo;

        // 오래된 메모 축약
        if (memo.length > 50) return memo.substring(0, 50) + '... (faded memory)';
        return memo + ' (faded memory)';
    }

    _lastMove() {
        if (this.lm.movements.length === 0) return null;
        const last = [...this.lm.movements].sort((a, b) => b.timestamp - a.timestamp)[0];
        const from = this.lm.locations.find(l => l.id === last.fromId);
        const to = this.lm.locations.find(l => l.id === last.toId);
        if (!from || !to) return null;
        let info = `${from.name} → ${to.name}`;
        if (last.distance) info += ` (${last.distance})`;
        if (last.walkTime) info += ` ${last.walkTime}`;
        return info;
    }

    _nearby(cur) {
        const near = [];
        for (const d of (this.lm.distances || [])) {
            let otherId = null;
            if (d.fromId === cur.id) otherId = d.toId;
            else if (d.toId === cur.id) otherId = d.fromId;
            else continue;
            const other = this.lm.locations.find(l => l.id === otherId);
            if (other) near.push(`${other.name}(${d.distanceText})`);
        }
        return near.length > 0 ? near.slice(0, 3).join(', ') : null;
    }
}
