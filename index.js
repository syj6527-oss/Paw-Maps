// 🗺️ RP World Tracker - Phase 1
// SillyTavern Extension for tracking RP locations on a map

import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

const EXTENSION_NAME = 'rp-world-tracker';
const DB_NAME = 'RPWorldTracker';
const DB_VERSION = 1;

// ============================================================
// Default Settings
// ============================================================
const defaultSettings = {
    enabled: true,
    mapMode: 'auto', // 'auto' | 'preset'
    autoDetect: false, // Phase 2에서 활성화
    panelWidth: 380,
};

// ============================================================
// IndexedDB Manager
// ============================================================
class WorldTrackerDB {
    constructor() {
        this.db = null;
    }

    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // 장소 저장소
                if (!db.objectStoreNames.contains('locations')) {
                    const locStore = db.createObjectStore('locations', { keyPath: 'id' });
                    locStore.createIndex('chatId', 'chatId', { unique: false });
                    locStore.createIndex('chatId_name', ['chatId', 'name'], { unique: true });
                }

                // 이동 히스토리
                if (!db.objectStoreNames.contains('movements')) {
                    const movStore = db.createObjectStore('movements', { keyPath: 'id', autoIncrement: true });
                    movStore.createIndex('chatId', 'chatId', { unique: false });
                    movStore.createIndex('chatId_timestamp', ['chatId', 'timestamp'], { unique: false });
                }

                // 맵 설정 (채팅방별)
                if (!db.objectStoreNames.contains('mapConfig')) {
                    db.createObjectStore('mapConfig', { keyPath: 'chatId' });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                console.log(`[${EXTENSION_NAME}] IndexedDB opened`);
                resolve(this.db);
            };

            request.onerror = (e) => {
                console.error(`[${EXTENSION_NAME}] IndexedDB error:`, e.target.error);
                reject(e.target.error);
            };
        });
    }

    // Generic transaction helper
    _tx(storeName, mode = 'readonly') {
        const tx = this.db.transaction(storeName, mode);
        return tx.objectStore(storeName);
    }

    // ---- Location CRUD ----

    async addLocation(location) {
        return new Promise((resolve, reject) => {
            const store = this._tx('locations', 'readwrite');
            const request = store.put(location);
            request.onsuccess = () => resolve(location);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getLocation(id) {
        return new Promise((resolve, reject) => {
            const store = this._tx('locations');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getLocationsByChatId(chatId) {
        return new Promise((resolve, reject) => {
            const store = this._tx('locations');
            const index = store.index('chatId');
            const request = index.getAll(chatId);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async deleteLocation(id) {
        return new Promise((resolve, reject) => {
            const store = this._tx('locations', 'readwrite');
            const request = store.delete(id);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // ---- Movement CRUD ----

    async addMovement(movement) {
        return new Promise((resolve, reject) => {
            const store = this._tx('movements', 'readwrite');
            const request = store.add(movement);
            request.onsuccess = () => resolve(movement);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getMovementsByChatId(chatId) {
        return new Promise((resolve, reject) => {
            const store = this._tx('movements');
            const index = store.index('chatId');
            const request = index.getAll(chatId);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // ---- Map Config ----

    async getMapConfig(chatId) {
        return new Promise((resolve, reject) => {
            const store = this._tx('mapConfig');
            const request = store.get(chatId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async saveMapConfig(config) {
        return new Promise((resolve, reject) => {
            const store = this._tx('mapConfig', 'readwrite');
            const request = store.put(config);
            request.onsuccess = () => resolve(config);
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

// ============================================================
// Location Manager
// ============================================================
class LocationManager {
    constructor(db) {
        this.db = db;
        this.currentChatId = null;
        this.currentLocationId = null;
        this.locations = [];
        this.movements = [];
    }

    getChatId() {
        const context = getContext();
        if (!context || !context.chatId) return null;
        return String(context.chatId);
    }

    generateId() {
        return `loc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    async loadChat() {
        this.currentChatId = this.getChatId();
        if (!this.currentChatId) {
            this.locations = [];
            this.movements = [];
            this.currentLocationId = null;
            return;
        }

        this.locations = await this.db.getLocationsByChatId(this.currentChatId);
        this.movements = await this.db.getMovementsByChatId(this.currentChatId);

        // 맵 설정 로드
        const config = await this.db.getMapConfig(this.currentChatId);
        if (config) {
            this.currentLocationId = config.currentLocationId || null;
        }

        console.log(`[${EXTENSION_NAME}] Loaded ${this.locations.length} locations, ${this.movements.length} movements`);
    }

    async addLocation(name, memo = '', aliases = []) {
        if (!this.currentChatId) return null;

        const location = {
            id: this.generateId(),
            chatId: this.currentChatId,
            name: name.trim(),
            aliases: aliases.map(a => a.trim()).filter(Boolean),
            x: 0,
            y: 0,
            visitCount: 0,
            firstVisited: null,
            lastVisited: null,
            memo: memo.trim(),
            discovered: true,
            color: this._randomColor(),
            createdAt: Date.now(),
        };

        // 자동 배치 좌표 계산
        const pos = this._calculateAutoPosition();
        location.x = pos.x;
        location.y = pos.y;

        await this.db.addLocation(location);
        this.locations.push(location);
        return location;
    }

    async updateLocation(id, updates) {
        const loc = this.locations.find(l => l.id === id);
        if (!loc) return null;

        Object.assign(loc, updates);
        await this.db.addLocation(loc); // put 으로 덮어쓰기
        return loc;
    }

    async deleteLocation(id) {
        await this.db.deleteLocation(id);
        this.locations = this.locations.filter(l => l.id !== id);

        if (this.currentLocationId === id) {
            this.currentLocationId = null;
            await this._saveCurrentLocation();
        }
    }

    async moveTo(locationId) {
        const loc = this.locations.find(l => l.id === locationId);
        if (!loc) return;

        const prevLocationId = this.currentLocationId;

        // 방문 기록 업데이트
        loc.visitCount = (loc.visitCount || 0) + 1;
        loc.lastVisited = Date.now();
        if (!loc.firstVisited) loc.firstVisited = Date.now();
        await this.db.addLocation(loc);

        // 이동 기록 추가
        if (prevLocationId && prevLocationId !== locationId) {
            const movement = {
                chatId: this.currentChatId,
                fromId: prevLocationId,
                toId: locationId,
                timestamp: Date.now(),
            };
            await this.db.addMovement(movement);
            this.movements.push(movement);
        }

        this.currentLocationId = locationId;
        await this._saveCurrentLocation();
    }

    async _saveCurrentLocation() {
        if (!this.currentChatId) return;
        await this.db.saveMapConfig({
            chatId: this.currentChatId,
            currentLocationId: this.currentLocationId,
        });
    }

    _calculateAutoPosition() {
        const count = this.locations.length;
        if (count === 0) return { x: 300, y: 250 };

        // 나선형 배치
        const angle = count * 0.8;
        const radius = 80 + count * 25;
        const centerX = 300;
        const centerY = 250;

        return {
            x: Math.round(centerX + radius * Math.cos(angle)),
            y: Math.round(centerY + radius * Math.sin(angle)),
        };
    }

    _randomColor() {
        const colors = [
            '#e8a87c', '#d4a574', '#c49a6c',
            '#b8926a', '#a68b6b', '#d4c5a9',
            '#c2b280', '#b5a882', '#a89f91',
            '#8b7355', '#7d6b5d', '#6b5b4d',
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
}

// ============================================================
// Map Renderer (Auto-generated Node Graph)
// ============================================================
class MapRenderer {
    constructor(container, locationManager) {
        this.container = container;
        this.lm = locationManager;
        this.svg = null;
        this.dragState = null;
        this.onLocationClick = null; // 콜백

        this._initSVG();
    }

    _initSVG() {
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'wt-map-svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.setAttribute('viewBox', '0 0 600 500');
        this.container.appendChild(this.svg);

        // 드래그 이벤트
        this.svg.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.svg.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.svg.addEventListener('mouseup', () => this._onMouseUp());
        this.svg.addEventListener('mouseleave', () => this._onMouseUp());
    }

    render() {
        if (!this.svg) return;
        this.svg.innerHTML = '';

        const locations = this.lm.locations;
        const movements = this.lm.movements;
        const currentId = this.lm.currentLocationId;

        // 데프 — 발자국 마커 & 글로우 필터
        this.svg.innerHTML += `
            <defs>
                <filter id="wt-glow">
                    <feGaussianBlur stdDeviation="3" result="blur"/>
                    <feMerge>
                        <feMergeNode in="blur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
                <filter id="wt-shadow">
                    <feDropShadow dx="1" dy="1" stdDeviation="2" flood-color="rgba(0,0,0,0.3)"/>
                </filter>
            </defs>
        `;

        // 이동 경로선 (발자국 스타일 점선)
        const drawnPaths = new Set();
        for (const m of movements) {
            const from = locations.find(l => l.id === m.fromId);
            const to = locations.find(l => l.id === m.toId);
            if (!from || !to) continue;

            const pathKey = `${m.fromId}-${m.toId}`;
            if (drawnPaths.has(pathKey)) continue;
            drawnPaths.add(pathKey);

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', from.x);
            line.setAttribute('y1', from.y);
            line.setAttribute('x2', to.x);
            line.setAttribute('y2', to.y);
            line.setAttribute('class', 'wt-path-line');
            this.svg.appendChild(line);
        }

        // 장소 노드
        for (const loc of locations) {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'wt-location-node');
            g.setAttribute('data-id', loc.id);
            g.setAttribute('transform', `translate(${loc.x}, ${loc.y})`);

            const isCurrent = loc.id === currentId;

            // 노드 원
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', isCurrent ? 18 : 14);
            circle.setAttribute('fill', loc.color);
            circle.setAttribute('class', isCurrent ? 'wt-node-circle wt-node-current' : 'wt-node-circle');
            if (isCurrent) circle.setAttribute('filter', 'url(#wt-glow)');
            g.appendChild(circle);

            // 방문 횟수 뱃지
            if (loc.visitCount > 0) {
                const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                badge.setAttribute('class', 'wt-visit-badge');
                badge.setAttribute('y', 4);
                badge.textContent = loc.visitCount;
                g.appendChild(badge);
            }

            // 장소명
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('class', 'wt-location-label');
            text.setAttribute('y', isCurrent ? 32 : 28);
            text.textContent = loc.name;
            g.appendChild(text);

            // 현재 위치 마커 (발자국 이모지)
            if (isCurrent) {
                const foot = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                foot.setAttribute('class', 'wt-footprint-marker');
                foot.setAttribute('y', -24);
                foot.textContent = '👣';
                g.appendChild(foot);
            }

            // 클릭 이벤트
            g.addEventListener('click', (e) => {
                if (!this._wasDragging) {
                    this.onLocationClick?.(loc.id);
                }
            });

            this.svg.appendChild(g);
        }

        // 빈 상태 메시지
        if (locations.length === 0) {
            const empty = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            empty.setAttribute('x', '300');
            empty.setAttribute('y', '250');
            empty.setAttribute('class', 'wt-empty-text');
            empty.textContent = '장소를 추가해서 세계를 만들어보세요!';
            this.svg.appendChild(empty);
        }
    }

    // ---- 노드 드래그 ----

    _getPoint(e) {
        const rect = this.svg.getBoundingClientRect();
        const viewBox = this.svg.viewBox.baseVal;
        return {
            x: (e.clientX - rect.left) / rect.width * viewBox.width,
            y: (e.clientY - rect.top) / rect.height * viewBox.height,
        };
    }

    _onMouseDown(e) {
        const node = e.target.closest('.wt-location-node');
        if (!node) return;

        const id = node.getAttribute('data-id');
        const pt = this._getPoint(e);
        const loc = this.lm.locations.find(l => l.id === id);
        if (!loc) return;

        this._wasDragging = false;
        this.dragState = {
            id,
            startX: pt.x,
            startY: pt.y,
            origX: loc.x,
            origY: loc.y,
        };
    }

    _onMouseMove(e) {
        if (!this.dragState) return;

        const pt = this._getPoint(e);
        const dx = pt.x - this.dragState.startX;
        const dy = pt.y - this.dragState.startY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            this._wasDragging = true;
        }

        const loc = this.lm.locations.find(l => l.id === this.dragState.id);
        if (!loc) return;

        loc.x = Math.round(this.dragState.origX + dx);
        loc.y = Math.round(this.dragState.origY + dy);

        this.render();
    }

    async _onMouseUp() {
        if (this.dragState && this._wasDragging) {
            const loc = this.lm.locations.find(l => l.id === this.dragState.id);
            if (loc) {
                await this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
            }
        }
        this.dragState = null;
    }
}

// ============================================================
// UI Manager
// ============================================================
class UIManager {
    constructor(locationManager) {
        this.lm = locationManager;
        this.mapRenderer = null;
        this.panelVisible = false;
    }

    // 설정 패널 (SillyTavern 확장 설정 영역)
    createSettingsPanel() {
        const html = `
        <div id="wt-settings" class="wt-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🗺️ RP World Tracker</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="wt-settings-row">
                        <label>
                            <input type="checkbox" id="wt-enabled" />
                            확장 활성화
                        </label>
                    </div>
                    <div class="wt-settings-row">
                        <button id="wt-open-panel" class="menu_button">
                            🗺️ 월드 맵 열기
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        $('#extensions_settings2').append(html);

        // 이벤트 바인딩
        $('#wt-enabled').prop('checked', extension_settings[EXTENSION_NAME]?.enabled ?? true);
        $('#wt-enabled').on('change', function () {
            extension_settings[EXTENSION_NAME].enabled = $(this).is(':checked');
            saveSettingsDebounced();
        });

        $('#wt-open-panel').on('click', () => this.togglePanel());
    }

    // 사이드 패널
    createSidePanel() {
        const panelHtml = `
        <div id="wt-panel" class="wt-panel">
            <div class="wt-panel-header">
                <div class="wt-panel-title">
                    <span class="wt-title-icon">🗺️</span>
                    <span>World Tracker</span>
                </div>
                <button id="wt-panel-close" class="wt-btn-icon" title="닫기">✕</button>
            </div>

            <div class="wt-panel-body">
                <!-- 맵 영역 -->
                <div id="wt-map-container" class="wt-map-container">
                    <div class="wt-map-parchment"></div>
                </div>

                <!-- 현재 위치 표시 -->
                <div id="wt-current-location" class="wt-current-location">
                    <span class="wt-current-label">📍 현재 위치</span>
                    <span id="wt-current-name" class="wt-current-name">— 없음 —</span>
                </div>

                <!-- 장소 추가 폼 -->
                <div class="wt-add-form">
                    <div class="wt-form-title">새 장소 추가</div>
                    <input type="text" id="wt-input-name" class="wt-input" placeholder="장소 이름" />
                    <input type="text" id="wt-input-aliases" class="wt-input" placeholder="별칭 (쉼표로 구분)" />
                    <textarea id="wt-input-memo" class="wt-input wt-textarea" placeholder="메모 (선택)" rows="2"></textarea>
                    <button id="wt-btn-add" class="wt-btn-primary">✚ 장소 추가</button>
                </div>

                <!-- 장소 목록 -->
                <div class="wt-location-list-header">
                    <span>장소 목록</span>
                    <span id="wt-location-count" class="wt-count-badge">0</span>
                </div>
                <div id="wt-location-list" class="wt-location-list"></div>

                <!-- 이동 히스토리 -->
                <div class="wt-history-header">
                    <span>🚶 이동 히스토리</span>
                </div>
                <div id="wt-movement-list" class="wt-movement-list"></div>
            </div>
        </div>

        <!-- 장소 상세 팝오버 -->
        <div id="wt-popover" class="wt-popover" style="display:none;">
            <div class="wt-popover-header">
                <span id="wt-popover-title"></span>
                <button id="wt-popover-close" class="wt-btn-icon">✕</button>
            </div>
            <div class="wt-popover-body">
                <div class="wt-popover-stats">
                    <div><span class="wt-stat-label">방문</span> <span id="wt-popover-visits">0</span>회</div>
                    <div><span class="wt-stat-label">첫 방문</span> <span id="wt-popover-first">—</span></div>
                    <div><span class="wt-stat-label">최근 방문</span> <span id="wt-popover-last">—</span></div>
                </div>
                <textarea id="wt-popover-memo" class="wt-input wt-textarea" placeholder="메모를 남겨보세요..." rows="3"></textarea>
                <div class="wt-popover-actions">
                    <button id="wt-popover-move" class="wt-btn-secondary">📍 여기로 이동</button>
                    <button id="wt-popover-save" class="wt-btn-primary">💾 저장</button>
                    <button id="wt-popover-delete" class="wt-btn-danger">🗑️ 삭제</button>
                </div>
            </div>
        </div>`;

        $('body').append(panelHtml);
        this._bindPanelEvents();
    }

    _bindPanelEvents() {
        // 패널 닫기
        $('#wt-panel-close').on('click', () => this.togglePanel(false));

        // 장소 추가
        $('#wt-btn-add').on('click', () => this._handleAddLocation());
        $('#wt-input-name').on('keydown', (e) => {
            if (e.key === 'Enter') this._handleAddLocation();
        });

        // 팝오버 닫기
        $('#wt-popover-close').on('click', () => this.hidePopover());

        // 팝오버 액션
        $('#wt-popover-save').on('click', () => this._handlePopoverSave());
        $('#wt-popover-delete').on('click', () => this._handlePopoverDelete());
        $('#wt-popover-move').on('click', () => this._handlePopoverMove());
    }

    async _handleAddLocation() {
        const name = $('#wt-input-name').val().trim();
        if (!name) {
            $('#wt-input-name').addClass('wt-input-error');
            setTimeout(() => $('#wt-input-name').removeClass('wt-input-error'), 600);
            return;
        }

        // 중복 체크
        const existing = this.lm.locations.find(
            l => l.name.toLowerCase() === name.toLowerCase()
        );
        if (existing) {
            toastr.warning(`"${name}" 은(는) 이미 존재하는 장소입니다.`);
            return;
        }

        const aliases = $('#wt-input-aliases').val().split(',').map(a => a.trim()).filter(Boolean);
        const memo = $('#wt-input-memo').val().trim();

        const loc = await this.lm.addLocation(name, memo, aliases);
        if (loc) {
            toastr.success(`"${name}" 장소가 추가되었습니다.`);
            $('#wt-input-name').val('');
            $('#wt-input-aliases').val('');
            $('#wt-input-memo').val('');
            this.refresh();
        }
    }

    // 패널 토글
    togglePanel(show) {
        if (show === undefined) show = !this.panelVisible;
        this.panelVisible = show;

        if (show) {
            $('#wt-panel').addClass('wt-panel-open');
            this.refresh();
        } else {
            $('#wt-panel').removeClass('wt-panel-open');
            this.hidePopover();
        }
    }

    // 전체 UI 갱신
    async refresh() {
        await this.lm.loadChat();

        // 맵 렌더링
        if (!this.mapRenderer) {
            this.mapRenderer = new MapRenderer(
                document.querySelector('#wt-map-container'),
                this.lm
            );
            this.mapRenderer.onLocationClick = (id) => this.showPopover(id);
        }
        this.mapRenderer.render();

        // 현재 위치 표시
        this._updateCurrentLocation();

        // 장소 목록
        this._renderLocationList();

        // 이동 히스토리
        this._renderMovementList();
    }

    _updateCurrentLocation() {
        const loc = this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        if (loc) {
            $('#wt-current-name').text(loc.name).css('color', loc.color);
        } else {
            $('#wt-current-name').text('— 없음 —').css('color', '');
        }
    }

    _renderLocationList() {
        const list = $('#wt-location-list');
        list.empty();
        $('#wt-location-count').text(this.lm.locations.length);

        if (this.lm.locations.length === 0) {
            list.html('<div class="wt-empty-hint">아직 등록된 장소가 없습니다</div>');
            return;
        }

        // 방문 횟수 순 정렬
        const sorted = [...this.lm.locations].sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));

        for (const loc of sorted) {
            const isCurrent = loc.id === this.lm.currentLocationId;
            const item = $(`
                <div class="wt-location-item ${isCurrent ? 'wt-location-current' : ''}" data-id="${loc.id}">
                    <div class="wt-loc-color" style="background:${loc.color}"></div>
                    <div class="wt-loc-info">
                        <div class="wt-loc-name">${loc.name}${isCurrent ? ' 👣' : ''}</div>
                        ${loc.memo ? `<div class="wt-loc-memo">${loc.memo}</div>` : ''}
                    </div>
                    <div class="wt-loc-visits">${loc.visitCount || 0}회</div>
                </div>
            `);

            item.on('click', () => this.showPopover(loc.id));
            list.append(item);
        }
    }

    _renderMovementList() {
        const list = $('#wt-movement-list');
        list.empty();

        if (this.lm.movements.length === 0) {
            list.html('<div class="wt-empty-hint">아직 이동 기록이 없습니다</div>');
            return;
        }

        // 최근 순으로 최대 20개
        const recent = [...this.lm.movements]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 20);

        for (const m of recent) {
            const from = this.lm.locations.find(l => l.id === m.fromId);
            const to = this.lm.locations.find(l => l.id === m.toId);
            if (!from || !to) continue;

            const time = new Date(m.timestamp).toLocaleTimeString('ko-KR', {
                hour: '2-digit', minute: '2-digit'
            });

            list.append(`
                <div class="wt-movement-item">
                    <span class="wt-move-time">${time}</span>
                    <span class="wt-move-from">${from.name}</span>
                    <span class="wt-move-arrow">→</span>
                    <span class="wt-move-to">${to.name}</span>
                </div>
            `);
        }
    }

    // ---- 팝오버 ----

    showPopover(locationId) {
        const loc = this.lm.locations.find(l => l.id === locationId);
        if (!loc) return;

        const popover = $('#wt-popover');
        popover.attr('data-id', locationId);
        $('#wt-popover-title').text(loc.name);
        $('#wt-popover-visits').text(loc.visitCount || 0);
        $('#wt-popover-first').text(loc.firstVisited ? this._formatDate(loc.firstVisited) : '—');
        $('#wt-popover-last').text(loc.lastVisited ? this._formatDate(loc.lastVisited) : '—');
        $('#wt-popover-memo').val(loc.memo || '');

        popover.fadeIn(150);
    }

    hidePopover() {
        $('#wt-popover').fadeOut(100);
    }

    async _handlePopoverSave() {
        const id = $('#wt-popover').attr('data-id');
        const memo = $('#wt-popover-memo').val().trim();
        await this.lm.updateLocation(id, { memo });
        toastr.success('메모가 저장되었습니다.');
        this.refresh();
    }

    async _handlePopoverDelete() {
        const id = $('#wt-popover').attr('data-id');
        const loc = this.lm.locations.find(l => l.id === id);
        if (!loc) return;

        if (!confirm(`"${loc.name}" 장소를 삭제하시겠습니까?`)) return;

        await this.lm.deleteLocation(id);
        this.hidePopover();
        toastr.info(`"${loc.name}" 장소가 삭제되었습니다.`);
        this.refresh();
    }

    async _handlePopoverMove() {
        const id = $('#wt-popover').attr('data-id');
        await this.lm.moveTo(id);
        this.hidePopover();
        this.refresh();
    }

    _formatDate(ts) {
        return new Date(ts).toLocaleDateString('ko-KR', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }
}

// ============================================================
// Extension Entry Point
// ============================================================
let db = null;
let locationManager = null;
let uiManager = null;

async function init() {
    console.log(`[${EXTENSION_NAME}] Initializing...`);

    // 기본 설정
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = { ...defaultSettings };
        saveSettingsDebounced();
    }

    // DB 초기화
    db = new WorldTrackerDB();
    await db.open();

    // 매니저 초기화
    locationManager = new LocationManager(db);
    uiManager = new UIManager(locationManager);

    // UI 생성
    uiManager.createSettingsPanel();
    uiManager.createSidePanel();

    // 이벤트 훅
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        console.log(`[${EXTENSION_NAME}] Chat changed`);
        if (uiManager.panelVisible) {
            await uiManager.refresh();
        }
    });

    console.log(`[${EXTENSION_NAME}] Ready! 🗺️`);
}

// jQuery ready
jQuery(async () => {
    try {
        await init();
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] Init failed:`, err);
    }
});
