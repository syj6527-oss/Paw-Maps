// 🐶 월드맵 v0.2.0-beta

import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { WorldTrackerDB } from './db.js';
import { LocationManager } from './location-manager.js';
import { LocationDetector } from './detector.js';
import { PromptInjector } from './prompt-injector.js';
import { UIManager } from './ui-manager.js';

export const EXTENSION_NAME = 'rp-world-tracker';
export const PROMPT_KEY = 'rp-world-tracker-prompt';

export function toast(msg, title, opts) { try { if (typeof toastr !== 'undefined') toastr.info(msg, title, opts); } catch(_) {} }
export function toastWarn(msg) { try { if (typeof toastr !== 'undefined') toastr.warning(msg); } catch(_) {} }
export function toastSuccess(msg) { try { if (typeof toastr !== 'undefined') toastr.success(msg); } catch(_) {} }

const defaults = {
    enabled:true, autoDetect:true, showDetectToast:true,
    aiInjection:true, memoryMode:'natural', memorySummaryDays:7, panelOpacity:100,
    debugMode:false, mapMode:'node', // 'node' or 'leaflet'
};

let db, lm, det, pi, ui;

// Leaflet CDN 동적 로드
export async function loadLeaflet() {
    if (window.L) return true;
    try {
        // CSS
        if (!document.querySelector('link[href*="leaflet"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }
        // JS
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = () => { console.log(`[${EXTENSION_NAME}] Leaflet loaded!`); resolve(true); };
            script.onerror = () => { console.warn(`[${EXTENSION_NAME}] Leaflet CDN failed`); resolve(false); };
            document.head.appendChild(script);
        });
    } catch(e) { console.warn(`[${EXTENSION_NAME}] Leaflet load error:`, e); return false; }
}

function dbg(msg) {
    const s = extension_settings[EXTENSION_NAME];
    if (s?.debugMode) toast(msg, '🔧', {timeOut:3000, positionClass:'toast-top-right'});
    console.log(`[${EXTENSION_NAME}] ${msg}`);
}

async function scanMessage(text, label='') {
    try {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !text?.trim()) return false;
        if (!lm.currentChatId) await lm.loadChat();
        if (!lm.currentChatId) return false;

        dbg(`🔍 ${label} (${text.length}c)`);

        const result = det.detect(text);
        if (result) {
            const { location, type, confidence } = result;
            dbg(`✅ "${location.name}" (${type})`);
            if (lm.currentLocationId !== location.id) {
                await lm.moveTo(location.id);
                if (s.showDetectToast) {
                    try { toast(`👣 ${location.name}`, '🐶', {timeOut:3000, positionClass:'toast-top-center', preventDuplicates:true}); }
                    catch(_) { console.log(`[${EXTENSION_NAME}] Toast: 👣 ${location.name}`); }
                }
                pi.inject(); if (ui.panelVisible) ui.refresh();
            }
            return true;
        }

        const np = det.detectNewPlace(text);
        if (np) {
            dbg(`🆕 "${np}"`);
            if (!lm.currentChatId) await lm.loadChat();
            if (lm.currentChatId) {
                const loc = await lm.addLocation(np);
                if (loc) {
                    await lm.moveTo(loc.id);
                    if (s.showDetectToast) {
                        try { toast(`🆕 ${loc.name}`, '🐶', {timeOut:3500, positionClass:'toast-top-center', preventDuplicates:true}); }
                        catch(_) { console.log(`[${EXTENSION_NAME}] Toast: 🆕 ${loc.name}`); }
                    }
                    pi.inject(); if (ui.panelVisible) ui.refresh();
                    ui.showAutoToast(loc);
                }
            }
            return true;
        }
        return false;
    } catch(e) { console.error(`[${EXTENSION_NAME}] Scan:`, e); return false; }
}

async function init() {
    // 설정 초기화 (debugMode는 항상 false로 시작!)
    if (!extension_settings[EXTENSION_NAME]) extension_settings[EXTENSION_NAME] = { ...defaults };
    for (const [k,v] of Object.entries(defaults)) {
        if (extension_settings[EXTENSION_NAME][k] === undefined) extension_settings[EXTENSION_NAME][k] = v;
    }
    extension_settings[EXTENSION_NAME].debugMode = false; // 항상 OFF로 시작
    saveSettingsDebounced();

    db = new WorldTrackerDB(); await db.open();
    lm = new LocationManager(db);
    det = new LocationDetector(lm);
    pi = new PromptInjector(lm);
    ui = new UIManager(lm, pi);
    ui.createSettingsPanel(); ui.createSidePanel(); ui.registerWandButton();

    // 3중 이벤트 + dedup
    let lastId = null;
    async function handle(idx) {
        try {
            const ctx = getContext(); if (!ctx?.chat?.length) return;
            const msg = typeof idx === 'number' ? ctx.chat[idx] : ctx.chat[ctx.chat.length - 1];
            if (!msg || msg.is_user) return;
            const mid = `${ctx.chat.length}_${(msg.mes||'').length}`;
            if (mid === lastId) return; lastId = mid;

            const aiIdx = typeof idx === 'number' ? idx : ctx.chat.length - 1;
            let userMsg = null;
            for (let i = aiIdx-1; i >= Math.max(0, aiIdx-3); i--) {
                if (ctx.chat[i]?.is_user) { userMsg = ctx.chat[i]; break; }
            }

            dbg(`📨 AI:${(msg.mes||'').length}c User:${(userMsg?.mes||'').length}c`);
            if (userMsg?.mes?.trim()) await scanMessage(userMsg.mes, 'USER');
            if (msg.mes?.trim()) await scanMessage(msg.mes, 'AI');
        } catch(e) { console.error(`[${EXTENSION_NAME}] Handle:`, e); }
    }

    eventSource.on(event_types.MESSAGE_RECEIVED, handle);
    if (event_types.MESSAGE_RENDERED) eventSource.on(event_types.MESSAGE_RENDERED, handle);
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, handle);

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        pi.clear(); lastId = null;
        if (ui.panelVisible) await ui.refresh();
        await lm.loadChat(); pi.inject();
    });

    eventSource.on(event_types.MESSAGE_SENDING, () => {
        if (extension_settings[EXTENSION_NAME]?.enabled && extension_settings[EXTENSION_NAME]?.aiInjection) pi.inject();
    });

    console.log(`[${EXTENSION_NAME}] Ready! 🐶`);
}

jQuery(async () => { try { await init(); } catch(e) { console.error(`[${EXTENSION_NAME}] Init:`, e); } });
