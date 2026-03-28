// 🗺️ RP World Tracker v0.2.0-beta (Single Scene)

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
    enabled:true, mapMode:'auto', autoDetect:true, showDetectToast:true,
    aiInjection:true, memoryMode:'natural', memorySummaryDays:7, panelOpacity:100,
};

let db, lm, det, pi, ui;

async function scanMessage(text) {
    try {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !text?.trim()) return;
        if (!lm.currentChatId) await lm.loadChat();
        if (!lm.currentChatId) return;

        console.log(`[${EXTENSION_NAME}] Scan (${text.length}c)...`);

        // 등록된 장소 감지
        const result = det.detect(text);
        if (result) {
            const { location, type, confidence } = result;
            console.log(`[${EXTENSION_NAME}] ✅ "${location.name}" (${type},${confidence})`);
            if (lm.currentLocationId !== location.id) {
                await lm.moveTo(location.id);
                if (s.showDetectToast) toastr.info(`👣 ${location.name} ${type==='move'?'이동':'위치'}`, '🗺️', {timeOut:3000,positionClass:'toast-bottom-right'});
                pi.inject(); if (ui.panelVisible) ui.refresh();
            }
            return true; // 감지됨
        }

        // 미등록 장소 발견
        const np = det.detectNewPlace(text);
        if (np) { console.log(`[${EXTENSION_NAME}] 🆕 "${np}"`); ui.showNewPlaceToast(np); return true; }
        return false;
    } catch(e) { console.error(`[${EXTENSION_NAME}] Scan error:`, e); return false; }
}

async function init() {
    console.log(`[${EXTENSION_NAME}] Init v0.2.0-beta...`);
    if (!extension_settings[EXTENSION_NAME]) { extension_settings[EXTENSION_NAME]={...defaults}; saveSettingsDebounced(); }
    for (const[k,v] of Object.entries(defaults)) { if(extension_settings[EXTENSION_NAME][k]===undefined) extension_settings[EXTENSION_NAME][k]=v; }

    db = new WorldTrackerDB(); await db.open();
    lm = new LocationManager(db);
    det = new LocationDetector(lm);
    pi = new PromptInjector(lm);
    ui = new UIManager(lm, pi);
    ui.createSettingsPanel(); ui.createSidePanel(); ui.registerWandButton();

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        pi.clear(); if(ui.panelVisible) await ui.refresh(); await lm.loadChat(); pi.inject();
    });

    // AI 응답 수신 → AI 아웃풋 먼저, 안 잡히면 직전 유저 인풋 스캔
    eventSource.on(event_types.MESSAGE_RECEIVED, async (idx) => {
        const ctx = getContext(); if (!ctx?.chat?.length) return;
        let aiMsg = typeof idx==='number' ? ctx.chat[idx] : ctx.chat[ctx.chat.length-1];
        if (!aiMsg || aiMsg.is_user) return;

        console.log(`[${EXTENSION_NAME}] RECV — AI:${(aiMsg.mes||'').length}c`);

        // AI 아웃풋 스캔
        let found = false;
        if (aiMsg.mes?.trim()) found = await scanMessage(aiMsg.mes);

        // AI에서 못 잡았으면 직전 유저 인풋도 스캔
        if (!found) {
            const aiIdx = typeof idx==='number' ? idx : ctx.chat.length-1;
            for (let i=aiIdx-1; i>=Math.max(0,aiIdx-3); i--) {
                if (ctx.chat[i]?.is_user && ctx.chat[i].mes?.trim()) {
                    console.log(`[${EXTENSION_NAME}] Fallback → user msg (${ctx.chat[i].mes.length}c)`);
                    await scanMessage(ctx.chat[i].mes);
                    break;
                }
            }
        }
    });

    eventSource.on(event_types.MESSAGE_SENDING, () => {
        const s=extension_settings[EXTENSION_NAME];
        if(s?.enabled&&s?.aiInjection) pi.inject();
    });

    console.log(`[${EXTENSION_NAME}] Ready! 🗺️`);
}

jQuery(async()=>{try{await init()}catch(e){console.error(`[${EXTENSION_NAME}] Init fail:`,e)}});
