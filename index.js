// 🗺️ RP World Tracker v0.2.0-beta

import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { WorldTrackerDB } from './db.js';
import { LocationManager } from './location-manager.js';
import { LocationDetector } from './detector.js';
import { PromptInjector } from './prompt-injector.js';
import { UIManager } from './ui-manager.js';

export const EXTENSION_NAME = 'rp-world-tracker';
export const PROMPT_KEY = 'rp-world-tracker-prompt';

const defaults = {
    enabled: true, mapMode: 'auto', autoDetect: true, showDetectToast: true,
    aiInjection: true, memoryMode: 'natural', memorySummaryDays: 7,
    panelWidth: 380, panelOpacity: 100,
};

const togetherKw = ['함께', '같이', '둘이', '나란히', '데리고', '끌고', 'together', 'both', 'with her', 'with him', 'side by side'];

let db, lm, det, pi, ui;

async function scanMessage(text, source) {
    try {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !text?.trim()) return;
        if (!lm.currentChatId) await lm.loadChat();
        if (!lm.currentChatId) return;

        console.log(`[${EXTENSION_NAME}] Scan ${source} (${text.length}c)...`);
        const hasTog = togetherKw.some(k => text.toLowerCase().includes(k));

        const result = det.detect(text);
        if (result) {
            const { location, type, confidence } = result;
            console.log(`[${EXTENSION_NAME}] ✅ "${location.name}" (${type},${confidence},${source})`);

            if (hasTog) {
                if (lm.userLocationId !== location.id) await lm.moveTo(location.id, 'user');
                if (lm.charLocationId !== location.id) await lm.moveTo(location.id, 'char');
                if (s.showDetectToast) toastr.info(`👤🎭 ${location.name} 함께 이동`, '🗺️', { timeOut: 3000, positionClass: 'toast-bottom-right' });
            } else {
                const ms = source === 'user' ? 'user' : 'char';
                const cur = ms === 'user' ? lm.userLocationId : lm.charLocationId;
                if (cur !== location.id) {
                    await lm.moveTo(location.id, ms);
                    if (s.showDetectToast) toastr.info(`${ms === 'user' ? '👤' : '🎭'} ${location.name} ${type === 'move' ? '이동' : '위치'}`, '🗺️', { timeOut: 3000, positionClass: 'toast-bottom-right' });
                }
            }
            pi.inject(); if (ui.panelVisible) ui.refresh();
            return;
        }

        const np = det.detectNewPlace(text);
        if (np) {
            console.log(`[${EXTENSION_NAME}] 🆕 "${np}"`);
            ui.showNewPlaceToast(np, hasTog ? 'both' : (source === 'user' ? 'user' : 'char'));
        }
    } catch (e) { console.error(`[${EXTENSION_NAME}] Scan error:`, e); }
}

async function init() {
    console.log(`[${EXTENSION_NAME}] Init v0.2.0-beta...`);
    if (!extension_settings[EXTENSION_NAME]) { extension_settings[EXTENSION_NAME] = { ...defaults }; saveSettingsDebounced(); }
    for (const [k, v] of Object.entries(defaults)) { if (extension_settings[EXTENSION_NAME][k] === undefined) extension_settings[EXTENSION_NAME][k] = v; }

    db = new WorldTrackerDB(); await db.open();
    lm = new LocationManager(db);
    det = new LocationDetector(lm);
    pi = new PromptInjector(lm);
    ui = new UIManager(lm, pi);
    ui.createSettingsPanel(); ui.createSidePanel(); ui.registerWandButton();

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        pi.clear(); if (ui.panelVisible) await ui.refresh(); await lm.loadChat(); pi.inject();
    });

    // AI 응답 수신 시 → 유저 인풋 + AI 아웃풋 동시 스캔
    eventSource.on(event_types.MESSAGE_RECEIVED, async (idx) => {
        const ctx = getContext(); if (!ctx?.chat?.length) return;
        let aiMsg = typeof idx === 'number' ? ctx.chat[idx] : ctx.chat[ctx.chat.length - 1];
        if (!aiMsg || aiMsg.is_user) return;

        const aiIdx = typeof idx === 'number' ? idx : ctx.chat.length - 1;
        let userMsg = null;
        for (let i = aiIdx - 1; i >= Math.max(0, aiIdx - 3); i--) {
            if (ctx.chat[i]?.is_user) { userMsg = ctx.chat[i]; break; }
        }

        console.log(`[${EXTENSION_NAME}] RECV — AI:${(aiMsg.mes||'').length}c User:${(userMsg?.mes||'').length}c`);
        if (userMsg?.mes?.trim()) await scanMessage(userMsg.mes, 'user');
        if (aiMsg.mes?.trim()) await scanMessage(aiMsg.mes, 'ai');
    });

    eventSource.on(event_types.MESSAGE_SENDING, () => {
        const s = extension_settings[EXTENSION_NAME];
        if (s?.enabled && s?.aiInjection) pi.inject();
    });

    console.log(`[${EXTENSION_NAME}] Ready! 🗺️`);
}

jQuery(async () => { try { await init(); } catch (e) { console.error(`[${EXTENSION_NAME}] Init fail:`, e); } });
