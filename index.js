// 🐶 World Tracker v0.2.1-beta

import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { WorldTrackerDB } from './db.js';
import { LocationManager } from './location-manager.js';
import { LocationDetector } from './detector.js';
import { PromptInjector } from './prompt-injector.js';
import { UIManager } from './ui-manager.js';

export const EXTENSION_NAME = 'rp-world-tracker';
export const PROMPT_KEY = 'rp-world-tracker-prompt';

// ========== 커스텀 알림 (번역기 스타일) ==========
let _notiEl = null, _notiTimer = null;
export function wtNotify(msg, type = 'move', duration = 3000) {
    if (!_notiEl) {
        _notiEl = document.createElement('div');
        _notiEl.className = 'wt-notification';
        document.body.appendChild(_notiEl);
    }
    clearTimeout(_notiTimer);
    _notiEl.className = `wt-notification wt-noti-${type}`;
    _notiEl.textContent = msg;
    _notiEl.style.top = '12px';
    _notiTimer = setTimeout(() => { _notiEl.style.top = '-60px'; }, duration);
}
export function toastWarn(msg) { wtNotify(msg, 'warn', 3000); }
export function toastSuccess(msg) { wtNotify(msg, 'move', 2000); }

const defaults = {
    enabled:true, autoDetect:true, showDetectToast:true,
    aiInjection:true, memoryMode:'natural', memorySummaryDays:7, panelOpacity:100,
    debugMode:false, mapMode:'node',
};

let db, lm, det, pi, ui;

export async function loadLeaflet() {
    if (window.L) return true;
    try {
        if (!document.querySelector('link[href*="leaflet"]')) {
            const link = document.createElement('link'); link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }
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
    if (s?.debugMode) wtNotify(`🔧 ${msg}`, 'info', 3000);
    console.log(`[${EXTENSION_NAME}] ${msg}`);
}

// ========== 메시지 스캔 (USER/AI 감도 분리) ==========
async function scanMessage(text, source = 'USER') {
    try {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !text?.trim()) return false;
        if (!lm.currentChatId) await lm.loadChat();
        if (!lm.currentChatId) return false;

        const mode = source === 'AI' ? 'ai' : 'user';
        dbg(`🔍 ${source} (${text.length}c) mode=${mode}`);

        // 이미 등록된 장소 감지 (USER/AI 동일)
        const result = det.detect(text);
        if (result) {
            const { location, type, confidence } = result;
            dbg(`✅ "${location.name}" (${type} c=${confidence})`);
            if (lm.currentLocationId !== location.id) {
                await lm.moveTo(location.id);
                if (s.showDetectToast) wtNotify(`🐶 🐾 ${location.name}`, 'move');
                pi.inject(); if (ui.panelVisible) ui.refresh();
            }
            return true;
        }

        // 새 장소 발견 (mode 전달 → AI는 엄격)
        const np = det.detectNewPlace(text, mode);
        if (np) {
            dbg(`🆕 "${np}" (${source})`);
            if (!lm.currentChatId) await lm.loadChat();
            if (lm.currentChatId) {
                const loc = await lm.addLocation(np);
                if (loc) {
                    await lm.moveTo(loc.id);
                    if (s.showDetectToast) wtNotify(`🐶 🆕 ${loc.name}`, 'new', 3500);
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
    if (!extension_settings[EXTENSION_NAME]) extension_settings[EXTENSION_NAME] = { ...defaults };
    for (const [k,v] of Object.entries(defaults)) {
        if (extension_settings[EXTENSION_NAME][k] === undefined) extension_settings[EXTENSION_NAME][k] = v;
    }
    extension_settings[EXTENSION_NAME].debugMode = false;
    saveSettingsDebounced();

    db = new WorldTrackerDB(); await db.open();
    lm = new LocationManager(db);
    det = new LocationDetector(lm);
    pi = new PromptInjector(lm);
    ui = new UIManager(lm, pi);
    ui.createSettingsPanel(); ui.createSidePanel(); ui.registerWandButton();

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
        // 타이밍: SillyTavern이 chatId 갱신할 때까지 대기
        await new Promise(r => setTimeout(r, 200));
        const newId = lm.getChatId();
        dbg(`🔄 CHAT_CHANGED → ${newId}`);
        await lm.loadChat();
        pi.inject();
        if (ui.panelVisible) ui.refresh();
        await scanContext();
    });

    if (event_types.MESSAGE_SENDING) {
        eventSource.on(event_types.MESSAGE_SENDING, () => {
            if (extension_settings[EXTENSION_NAME]?.enabled && extension_settings[EXTENSION_NAME]?.aiInjection) pi.inject();
        });
    }

    console.log(`[${EXTENSION_NAME}] Ready! 🐶`);

    // 초기 데이터 로드 + 렌더링
    await lm.loadChat();
    ui.refresh();
}

async function scanContext() {
    try {
        const s = extension_settings[EXTENSION_NAME];
        if (!s?.enabled || !s?.autoDetect || !lm.currentChatId) return;
        const ctx = getContext();
        if (!ctx?.characterId) return;

        // 이미 장소 있으면 스킵
        if (lm.locations.length > 0 && lm.currentLocationId) return;

        // 1차: 기존 채팅 히스토리 전체 스캔 (진행 중인 채팅에 확장 설치 시)
        if (ctx.chat?.length > 1) {
            const found = await scanChatHistory(ctx);
            if (found) return;
        }

        // 2차: 캐릭터 설명/시나리오에서 추출
        const char = ctx.characters?.[ctx.characterId];
        if (!char) return;
        const sources = [];
        if (char.description) sources.push(char.description);
        if (char.scenario) sources.push(char.scenario);
        if (char.first_mes) sources.push(char.first_mes);
        if (char.personality) sources.push(char.personality);
        try { const dp = document.querySelector('#depth_prompt_prompt'); if (dp?.value?.trim()) sources.push(dp.value); } catch(_){}
        try { const meta = ctx.chat_metadata; if (meta?.note_prompt) sources.push(meta.note_prompt); if (meta?.depth_prompt?.prompt) sources.push(meta.depth_prompt.prompt); } catch(_){}
        if (!sources.length) return;

        for (const text of sources) {
            const desc = det.detectFromDescription(text);
            if (desc) {
                dbg(`📋 Desc: "${desc}"`);
                const loc = await lm.addLocation(desc);
                if (loc) { await lm.moveTo(loc.id); pi.inject(); if (ui.panelVisible) ui.refresh(); }
                return;
            }
        }
        for (const text of sources) {
            const result = det.detect(text);
            if (result) { dbg(`📋 Context: "${result.location.name}"`); await lm.moveTo(result.location.id); pi.inject(); if (ui.panelVisible) ui.refresh(); return; }
            const np = det.detectNewPlace(text, 'user');
            if (np) { dbg(`📋 Context new: "${np}"`); const loc = await lm.addLocation(np); if (loc) { await lm.moveTo(loc.id); pi.inject(); if (ui.panelVisible) ui.refresh(); } return; }
        }
    } catch(e) { console.error(`[${EXTENSION_NAME}] Context scan:`, e); }
}

// ========== 최근 메시지 스캔 (승인 플로우) ==========
async function scanChatHistory(ctx) {
    if (!ctx?.chat?.length) return false;
    const recent = ctx.chat.slice(-4); // 최근 4개
    dbg(`📜 최근 ${recent.length}개 메시지 스캔`);

    const candidates = [];
    for (const msg of recent) {
        if (!msg?.mes?.trim()) continue;
        const text = msg.mes;

        const result = det.detect(text);
        if (result && !candidates.some(c => c.name === result.location.name)) {
            candidates.push({ name: result.location.name, existing: true, locId: result.location.id, checked: true });
            continue;
        }

        const np = det.detectNewPlace(text, 'ai');
        if (np && !lm.findByName(np) && !candidates.some(c => c.name === np)) {
            candidates.push({ name: np, existing: false, checked: true });
        }
    }

    if (!candidates.length) return false;

    // 승인 UI 표시
    dbg(`📜 ${candidates.length}개 장소 감지 → 승인 대기`);
    ui.showScanApproval(candidates);
    return true;
}

jQuery(async () => { try { await init(); } catch(e) { console.error(`[${EXTENSION_NAME}] Init:`, e); } });
