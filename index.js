// 🗺️ RP World Tracker v0.2.0-beta
// SillyTavern Extension — RP 속 세계를 지도로 기록하세요

import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

import { WorldTrackerDB } from './db.js';
import { LocationManager } from './location-manager.js';
import { LocationDetector } from './detector.js';
import { PromptInjector } from './prompt-injector.js';
import { UIManager } from './ui-manager.js';

export const EXTENSION_NAME = 'rp-world-tracker';
export const PROMPT_KEY = 'rp-world-tracker-prompt';

const defaultSettings = {
    enabled: true,
    mapMode: 'auto',
    autoDetect: true,
    showDetectToast: true,
    aiInjection: true,
    memoryMode: 'natural',
    memorySummaryDays: 7,
    panelWidth: 380,
    panelOpacity: 100,
};

let db, locationManager, detector, promptInjector, uiManager;

async function init() {
    console.log(`[${EXTENSION_NAME}] Initializing v0.2.0-beta...`);

    // 설정 초기화
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = { ...defaultSettings };
        saveSettingsDebounced();
    }
    // 누락 키 보충
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (extension_settings[EXTENSION_NAME][k] === undefined) {
            extension_settings[EXTENSION_NAME][k] = v;
        }
    }

    // DB
    db = new WorldTrackerDB();
    await db.open();
    console.log(`[${EXTENSION_NAME}] DB opened`);

    // 모듈 초기화
    locationManager = new LocationManager(db);
    detector = new LocationDetector(locationManager);
    promptInjector = new PromptInjector(locationManager);
    uiManager = new UIManager(locationManager, promptInjector);

    // UI 생성
    uiManager.createSettingsPanel();
    uiManager.createSidePanel();

    // ============================================================
    // Event Hooks
    // ============================================================

    // 채팅방 변경
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        console.log(`[${EXTENSION_NAME}] Chat changed`);
        promptInjector.clear();
        if (uiManager.panelVisible) await uiManager.refresh();

        // 채팅 로드 후 프롬프트 주입
        await locationManager.loadChat();
        promptInjector.inject();
    });

    // ============================================================
    // 장소 감지 공통 함수
    // ============================================================
    async function scanMessage(text, source = 'ai') {
        try {
            const s = extension_settings[EXTENSION_NAME];
            if (!s?.enabled || !s?.autoDetect) return;
            if (!text?.trim()) return;

            // chatId 확보
            if (!locationManager.currentChatId) await locationManager.loadChat();
            if (!locationManager.currentChatId) return;

            console.log(`[${EXTENSION_NAME}] Scanning ${source} message (${text.length} chars)...`);

            // 1. 등록된 장소 감지
            const result = detector.detect(text);
            if (result) {
                const { location, type, confidence } = result;
                console.log(`[${EXTENSION_NAME}] ✅ Detected: "${location.name}" (${type}, ${confidence})`);

                if (locationManager.currentLocationId !== location.id) {
                    await locationManager.moveTo(location.id);

                    if (s.showDetectToast) {
                        toastr.info(
                            `👣 ${location.name}${type === 'move' ? '(으)로 이동' : '에 위치'}`,
                            '🗺️ World Tracker',
                            { timeOut: 3000, positionClass: 'toast-bottom-right' }
                        );
                    }

                    promptInjector.inject();
                    if (uiManager.panelVisible) uiManager.refresh();
                }
                return;
            }

            // 2. 미등록 장소 발견
            const newPlace = detector.detectNewPlace(text);
            if (newPlace) {
                console.log(`[${EXTENSION_NAME}] 🆕 New place found: "${newPlace}"`);
                uiManager.showNewPlaceToast(newPlace);
            } else {
                console.log(`[${EXTENSION_NAME}] ❌ No location detected`);
            }

        } catch (err) {
            console.error(`[${EXTENSION_NAME}] Detection error:`, err);
        }
    }

    // ============================================================
    // Event Hooks
    // ============================================================

    // AI 메시지 수신
    eventSource.on(event_types.MESSAGE_RECEIVED, async (messageIndex) => {
        const context = getContext();
        if (!context?.chat?.length) return;

        // messageIndex가 숫자가 아닐 수 있음 (SillyTavern 버전 차이)
        let msg;
        if (typeof messageIndex === 'number') {
            msg = context.chat[messageIndex];
        } else {
            // 최신 메시지 사용
            msg = context.chat[context.chat.length - 1];
        }

        if (!msg) return;
        console.log(`[${EXTENSION_NAME}] MESSAGE_RECEIVED — is_user: ${msg.is_user}, length: ${(msg.mes || '').length}`);

        // AI 메시지만 처리
        if (msg.is_user) return;
        await scanMessage(msg.mes || '', 'ai');
    });

    // 유저 메시지 전송 후 — 인풋 감지
    eventSource.on(event_types.MESSAGE_SENT, async (messageIndex) => {
        const context = getContext();
        if (!context?.chat?.length) return;

        let msg;
        if (typeof messageIndex === 'number') {
            msg = context.chat[messageIndex];
        } else {
            // 최신 유저 메시지 찾기
            for (let i = context.chat.length - 1; i >= 0; i--) {
                if (context.chat[i].is_user) { msg = context.chat[i]; break; }
            }
        }

        if (!msg || !msg.is_user) return;
        console.log(`[${EXTENSION_NAME}] MESSAGE_SENT — length: ${(msg.mes || '').length}`);
        await scanMessage(msg.mes || '', 'user');
    });

    // 메시지 전송 전 — 프롬프트 갱신
    eventSource.on(event_types.MESSAGE_SENDING, () => {
        const s = extension_settings[EXTENSION_NAME];
        if (s?.enabled && s?.aiInjection) {
            promptInjector.inject();
        }
    });

    console.log(`[${EXTENSION_NAME}] Ready! 🗺️`);
}

jQuery(async () => {
    try { await init(); }
    catch (err) { console.error(`[${EXTENSION_NAME}] Init failed:`, err); }
});
