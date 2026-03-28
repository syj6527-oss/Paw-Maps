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
    debugMode:false, autoRegister:true,
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
        if (np) {
            dbg(`🆕 New: "${np}"`);
            // 항상 자동 등록 + 이동
            if (!lm.currentChatId) await lm.loadChat();
            if (lm.currentChatId) {
                const loc = await lm.addLocation(np);
                if (loc) {
                    await lm.moveTo(loc.id);
                    pi.inject(); if (ui.panelVisible) ui.refresh();
                    ui.showAutoToast(loc);
                }
            }
            return true;
        }
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
    // Event Hooks — 3중 이벤트 (데스크탑+모바일 호환)
    // ============================================================
    let lastHandledId = null;

    async function handleMessage(idx) {
        try {
            const ctx = getContext(); if (!ctx?.chat?.length) return;
            const msg = typeof idx === 'number' ? ctx.chat[idx] : ctx.chat[ctx.chat.length - 1];
            if (!msg || msg.is_user) return;

            // 중복 실행 방지
            const msgId = `${ctx.chat.length}_${(msg.mes||'').length}`;
            if (msgId === lastHandledId) return;
            lastHandledId = msgId;

            // 직전 유저 메시지 찾기
            const aiIdx = typeof idx === 'number' ? idx : ctx.chat.length - 1;
            let userMsg = null;
            for (let i = aiIdx - 1; i >= Math.max(0, aiIdx - 3); i--) {
                if (ctx.chat[i]?.is_user) { userMsg = ctx.chat[i]; break; }
            }

            dbg(`📨 RECV — AI:${(msg.mes||'').length}c User:${(userMsg?.mes||'').length}c`);

            if (userMsg?.mes?.trim()) await scanMessage(userMsg.mes, 'USER');
            if (msg.mes?.trim()) await scanMessage(msg.mes, 'AI');
        } catch(e) { console.error(`[${EXTENSION_NAME}] Handle error:`, e); }
    }

    // 3개 이벤트 모두 등록 — 데스크탑/모바일 어디서든 최소 하나는 발동
    eventSource.on(event_types.MESSAGE_RECEIVED, handleMessage);

    // MESSAGE_RENDERED — 모바일에서 안정적
    if (event_types.MESSAGE_RENDERED) {
        eventSource.on(event_types.MESSAGE_RENDERED, handleMessage);
        dbg('✅ MESSAGE_RENDERED registered');
    }

    // GENERATION_ENDED — 안전장치
    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, handleMessage);
        dbg('✅ GENERATION_ENDED registered');
    }

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        pi.clear(); lastHandledId = null;
        if(ui.panelVisible) await ui.refresh();
        await lm.loadChat(); pi.inject();
    });

    eventSource.on(event_types.MESSAGE_SENDING, () => {
        const s=extension_settings[EXTENSION_NAME];
        if(s?.enabled&&s?.aiInjection) pi.inject();
    });

    console.log(`[${EXTENSION_NAME}] Ready! 🗺️`);
}

jQuery(async()=>{try{await init()}catch(e){console.error(`[${EXTENSION_NAME}] Init fail:`,e)}});