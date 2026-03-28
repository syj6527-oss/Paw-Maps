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

let db, lm, det, pi, ui;

async function scanMessage(text, source = 'ai') {
    try {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !text?.trim()) return;
        if (!lm.currentChatId) await lm.loadChat();
        if (!lm.currentChatId) return;

        const moveSource = source === 'user' ? 'user' : 'char';
        console.log(`[${EXTENSION_NAME}] Scanning ${source} (${text.length}c)...`);

        const result = det.detect(text);
        if (result) {
            const { location, type, confidence } = result;
            console.log(`[${EXTENSION_NAME}] ✅ "${location.name}" (${type}, ${confidence}, ${moveSource})`);
            const curId = moveSource === 'user' ? lm.userLocationId : lm.charLocationId;
            if (curId !== location.id) {
                await lm.moveTo(location.id, moveSource);
                if (s.showDetectToast) {
                    const icon = moveSource === 'user' ? '👤' : '🎭';
                    toastr.info(`${icon} ${location.name}${type === 'move' ? ' 이동' : ' 위치'}`, '🗺️', { timeOut: 3000, positionClass: 'toast-bottom-right' });
                }
                pi.inject();
                if (ui.panelVisible) ui.refresh();
            }
            return;
        }

        const np = det.detectNewPlace(text);
        if (np) { console.log(`[${EXTENSION_NAME}] 🆕 "${np}" (${moveSource})`); ui.showNewPlaceToast(np, moveSource); }
        else { console.log(`[${EXTENSION_NAME}] ❌ No location`); }
    } catch (e) { console.error(`[${EXTENSION_NAME}] Scan error:`, e); }
}

async function init() {
    console.log(`[${EXTENSION_NAME}] Init v0.2.0-beta...`);

    if (!extension_settings[EXTENSION_NAME]) { extension_settings[EXTENSION_NAME] = { ...defaults }; saveSettingsDebounced(); }
    for (const [k, v] of Object.entries(defaults)) { if (extension_settings[EXTENSION_NAME][k] === undefined) extension_settings[EXTENSION_NAME][k] = v; }

    db = new WorldTrackerDB();
    await db.open();

    lm = new LocationManager(db);
    det = new LocationDetector(lm);
    pi = new PromptInjector(lm);
    ui = new UIManager(lm, pi);

    ui.createSettingsPanel();
    ui.createSidePanel();
    ui.registerWandButton();

    // Chat changed
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        pi.clear();
        if (ui.panelVisible) await ui.refresh();
        await lm.loadChat();
        pi.inject();
    });

    // AI message received
    eventSource.on(event_types.MESSAGE_RECEIVED, async (idx) => {
        const ctx = getContext();
        if (!ctx?.chat?.length) return;
        let msg = typeof idx === 'number' ? ctx.chat[idx] : ctx.chat[ctx.chat.length - 1];
        if (!msg) return;
        console.log(`[${EXTENSION_NAME}] MSG_RECV — user: ${msg.is_user}, len: ${(msg.mes || '').length}`);
        if (msg.is_user) return;
        await scanMessage(msg.mes || '', 'ai');
    });

    // User message sent
    eventSource.on(event_types.MESSAGE_SENT, async (idx) => {
        const ctx = getContext();
        if (!ctx?.chat?.length) return;
        let msg;
        if (typeof idx === 'number') msg = ctx.chat[idx];
        else { for (let i = ctx.chat.length - 1; i >= 0; i--) { if (ctx.chat[i].is_user) { msg = ctx.chat[i]; break; } } }
        if (!msg?.is_user) return;
        console.log(`[${EXTENSION_NAME}] MSG_SENT — len: ${(msg.mes || '').length}`);
        await scanMessage(msg.mes || '', 'user');
    });

    // Before sending — refresh prompt
    eventSource.on(event_types.MESSAGE_SENDING, () => {
        const s = extension_settings[EXTENSION_NAME];
        if (s?.enabled && s?.aiInjection) pi.inject();
    });

    console.log(`[${EXTENSION_NAME}] Ready! 🗺️`);
}

jQuery(async () => { try { await init(); } catch (e) { console.error(`[${EXTENSION_NAME}] Init fail:`, e); } });
