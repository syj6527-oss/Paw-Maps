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

// Safe toastr (모바일에서 없을 수 있음)
export function toast(msg, title, opts) {
    try { if (typeof toastr !== 'undefined') toastr.info(msg, title, opts); } catch(_) {}
}
export function toastWarn(msg) {
    try { if (typeof toastr !== 'undefined') toastr.warning(msg); } catch(_) {}
}
export function toastSuccess(msg) {
    try { if (typeof toastr !== 'undefined') toastr.success(msg); } catch(_) {}
}

const defaults = {
    enabled:true, mapMode:'auto', autoDetect:true, showDetectToast:true,
    aiInjection:true, memoryMode:'natural', memorySummaryDays:7, panelOpacity:100,
    debugMode:false,
};

let db, lm, det, pi, ui;

function dbg(msg) {
    const s = extension_settings[EXTENSION_NAME];
    if (s?.debugMode) toast(msg, '🔧 Debug', {timeOut:4000, positionClass:'toast-top-right'});
    console.log(`[${EXTENSION_NAME}] ${msg}`);
}

async function scanMessage(text, label='') {
    try {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !text?.trim()) return;
        if (!lm.currentChatId) await lm.loadChat();
        if (!lm.currentChatId) { dbg('❌ No chatId'); return; }

        dbg(`🔍 Scan ${label} (${text.length}c)`);

        const result = det.detect(text);
        if (result) {
            const { location, type, confidence } = result;
            dbg(`✅ Known: "${location.name}" (${type},${confidence})`);
            if (lm.currentLocationId !== location.id) {
                await lm.moveTo(location.id);
                if (s.showDetectToast) toast(`👣 ${location.name} ${type==='move'?'이동':'위치'}`, '🗺️', {timeOut:3000,positionClass:'toast-bottom-right'});
                pi.inject(); if (ui.panelVisible) ui.refresh();
            } else { dbg('⏭️ Already here'); }
            return true;
        }

        const np = det.detectNewPlace(text);
        if (np) { dbg(`🆕 New: "${np}"`); ui.showNewPlaceToast(np); return true; }
        dbg('❌ No location found');
        return false;
    } catch(e) { dbg(`💥 Error: ${e.message}`); return false; }
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

    // ============================================================
    // Event Registration (Primary: eventSource, Fallback: MutationObserver)
    // ============================================================
    let eventsWorking = false;
    let lastProcessedCount = 0;

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        pi.clear(); if(ui.panelVisible) await ui.refresh(); await lm.loadChat(); pi.inject();
        lastProcessedCount = getContext()?.chat?.length || 0;
    });

    // Primary: eventSource
    eventSource.on(event_types.MESSAGE_RECEIVED, async (idx) => {
        eventsWorking = true;
        const ctx = getContext(); if (!ctx?.chat?.length) return;
        let aiMsg = typeof idx==='number' ? ctx.chat[idx] : ctx.chat[ctx.chat.length-1];
        if (!aiMsg || aiMsg.is_user) return;

        const aiIdx = typeof idx==='number' ? idx : ctx.chat.length-1;
        let userMsg = null;
        for (let i=aiIdx-1; i>=Math.max(0,aiIdx-3); i--) {
            if (ctx.chat[i]?.is_user) { userMsg = ctx.chat[i]; break; }
        }

        dbg(`📨 RECV — AI:${(aiMsg.mes||'').length}c User:${(userMsg?.mes||'').length}c`);

        if (userMsg?.mes?.trim()) await scanMessage(userMsg.mes, 'USER');
        if (aiMsg.mes?.trim()) await scanMessage(aiMsg.mes, 'AI');
        lastProcessedCount = ctx.chat.length;
    });

    // Fallback: MutationObserver (모바일에서 eventSource 안 될 때)
    function setupFallbackObserver() {
        const chatEl = document.querySelector('#chat');
        if (!chatEl) { setTimeout(setupFallbackObserver, 3000); return; }

        let checkTimer = null;
        const observer = new MutationObserver(() => {
            if (eventsWorking) return; // eventSource 작동 중이면 스킵
            clearTimeout(checkTimer);
            checkTimer = setTimeout(async () => {
                try {
                    const ctx = getContext();
                    if (!ctx?.chat?.length) return;
                    if (ctx.chat.length <= lastProcessedCount) return;

                    const s = extension_settings[EXTENSION_NAME];
                    if (!s?.enabled || !s?.autoDetect) return;

                    dbg(`🔄 Fallback scan (${ctx.chat.length} msgs, last:${lastProcessedCount})`);

                    // 마지막 AI 메시지 찾기
                    let aiMsg = null, userMsg = null;
                    for (let i = ctx.chat.length - 1; i >= Math.max(0, ctx.chat.length - 3); i--) {
                        if (!ctx.chat[i].is_user && !aiMsg) aiMsg = ctx.chat[i];
                        if (ctx.chat[i].is_user && !userMsg) userMsg = ctx.chat[i];
                        if (aiMsg && userMsg) break;
                    }

                    if (userMsg?.mes?.trim()) await scanMessage(userMsg.mes, 'USER(fb)');
                    if (aiMsg?.mes?.trim()) await scanMessage(aiMsg.mes, 'AI(fb)');
                    lastProcessedCount = ctx.chat.length;
                } catch(e) { console.error(`[${EXTENSION_NAME}] Fallback error:`, e); }
            }, 2000); // 2초 딜레이 (AI 응답 완료 대기)
        });
        observer.observe(chatEl, { childList: true, subtree: true });
        dbg('👀 Fallback observer active');
    }
    setTimeout(setupFallbackObserver, 2000);

    eventSource.on(event_types.MESSAGE_SENDING, () => {
        const s=extension_settings[EXTENSION_NAME];
        if(s?.enabled&&s?.aiInjection) pi.inject();
    });

    console.log(`[${EXTENSION_NAME}] Ready! 🗺️`);
}

jQuery(async()=>{try{await init()}catch(e){console.error(`[${EXTENSION_NAME}] Init fail:`,e)}});
