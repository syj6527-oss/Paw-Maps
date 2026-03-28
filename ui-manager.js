// 🗺️ RP World Tracker — ui-manager.js

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { EXTENSION_NAME } from './index.js';
import { MapRenderer } from './map-renderer.js';

const categoryGroups = [
    ['hall', 'room', 'chamber', 'lounge'],
    ['dining', 'mess', 'cafeteria', 'restaurant', 'kitchen', 'cafe', 'canteen'],
    ['office', 'study', 'workshop', 'lab'],
    ['bedroom', 'quarters', 'dorm', 'bunk'],
    ['gym', 'arena', 'court', 'field', 'ground', 'training'],
    ['armory', 'arsenal', 'weapons'],
    ['garden', 'park', 'yard', 'plaza', 'square'],
    ['shop', 'store', 'market', 'mall'],
    ['library', 'archive', 'bookstore'],
    ['bar', 'pub', 'tavern', 'inn'],
    ['식당', '카페', '음식점', '레스토랑', '매점', '구내식당', '배식'],
    ['숙소', '기숙사', '침실', '방', '객실'],
    ['사무실', '연구실', '작업실'],
    ['도서관', '서점', '서재'],
    ['공원', '정원', '광장', '마당'],
    ['체육관', '운동장', '훈련장', '사격장'],
];

export class UIManager {
    constructor(lm, pi) {
        this.lm = lm;
        this.pi = pi;
        this.mapRenderer = null;
        this.panelVisible = false;
    }

    // ===================== Settings Panel =====================
    createSettingsPanel() {
        const html = `
        <div id="wt-settings" class="wt-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🗺️ RP World Tracker <span class="wt-version">v0.2.0-beta</span></b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="wt-s-row"><label><input type="checkbox" id="wt-s-enabled"/> 확장 활성화</label></div>
                    <div class="wt-divider"></div>
                    <div class="wt-s-row"><label><input type="checkbox" id="wt-s-detect"/> 🔍 장소 자동 감지</label></div>
                    <div class="wt-s-row"><label><input type="checkbox" id="wt-s-toast"/> 📍 이동 알림 표시</label></div>
                    <div class="wt-divider"></div>
                    <div class="wt-s-row"><label><input type="checkbox" id="wt-s-inject"/> 🤖 AI 프롬프트 주입</label></div>
                    <div class="wt-s-row">
                        <label>💭 기억 모드</label>
                        <select id="wt-s-memory" class="text_pole wt-select">
                            <option value="natural">🌿 자연스러운 기억</option>
                            <option value="perfect">💎 완벽한 기억</option>
                        </select>
                    </div>
                    <div class="wt-divider"></div>
                    <div class="wt-s-row"><button id="wt-open-panel" class="menu_button wt-open-btn">🗺️ 월드 맵 열기</button></div>
                </div>
            </div>
        </div>`;
        $('#extensions_settings2').append(html);
        this._bindSettings();
    }

    _bindSettings() {
        const s = extension_settings[EXTENSION_NAME];
        const bind = (sel, key, def) => {
            $(sel).prop('checked', s?.[key] ?? def).on('change', function () { s[key] = $(this).is(':checked'); saveSettingsDebounced(); });
        };
        bind('#wt-s-enabled', 'enabled', true);
        bind('#wt-s-detect', 'autoDetect', true);
        bind('#wt-s-toast', 'showDetectToast', true);
        bind('#wt-s-inject', 'aiInjection', true);
        $('#wt-s-inject').on('change', () => { s.aiInjection ? this.pi?.inject() : this.pi?.clear(); });
        $('#wt-s-memory').val(s?.memoryMode || 'natural').on('change', () => { s.memoryMode = $('#wt-s-memory').val(); saveSettingsDebounced(); this.pi?.inject(); });
        $('#wt-open-panel').on('click', () => this.togglePanel());
    }

    // ===================== Wand Menu Button =====================
    registerWandButton() {
        try {
            const btn = document.createElement('div');
            btn.id = 'wt-wand-btn';
            btn.className = 'list-group-item flex-container flexGap5';
            btn.innerHTML = '<span>🗺️</span> World Tracker';
            btn.addEventListener('click', () => this.togglePanel());
            const wandContainer = document.getElementById('extensionsMenu');
            if (wandContainer) wandContainer.appendChild(btn);
            else console.warn(`[${EXTENSION_NAME}] Wand menu not found`);
        } catch (e) {
            console.warn(`[${EXTENSION_NAME}] Wand button error:`, e.message);
        }
    }

    // ===================== Side Panel =====================
    createSidePanel() {
        const html = `
        <div id="wt-panel" class="wt-panel">
            <div class="wt-panel-header">
                <div class="wt-panel-title"><span>🗺️</span> World Tracker <span id="wt-detect-badge" class="wt-detect-badge">🔍</span></div>
                <button id="wt-panel-close" class="wt-btn-icon">✕</button>
            </div>
            <div class="wt-panel-body">
                <!-- 투명도 슬라이더 -->
                <div class="wt-opacity-row">
                    <span>🔮 투명도</span>
                    <input type="range" id="wt-opacity" min="30" max="100" value="100" />
                    <span id="wt-opacity-val">100%</span>
                </div>

                <!-- 맵 -->
                <div id="wt-map-container" class="wt-map-container"></div>

                <!-- 듀얼 위치 -->
                <div class="wt-dual-loc">
                    <div class="wt-dual-row"><span class="wt-dual-icon">👤</span><span class="wt-dual-label">유저</span><span id="wt-user-loc" class="wt-dual-name">—</span></div>
                    <div class="wt-dual-row"><span class="wt-dual-icon">🎭</span><span class="wt-dual-label">캐릭터</span><span id="wt-char-loc" class="wt-dual-name">—</span></div>
                </div>

                <!-- AI 프롬프트 미리보기 -->
                <div id="wt-prompt-preview" class="wt-prompt-preview" style="display:none">
                    <div class="wt-prompt-header">🤖 AI에게 전달 중</div>
                    <pre id="wt-prompt-text" class="wt-prompt-text"></pre>
                </div>

                <!-- 장소 추가 -->
                <div class="wt-add-form">
                    <input type="text" id="wt-input-name" class="wt-input" placeholder="장소 이름" />
                    <input type="text" id="wt-input-aliases" class="wt-input" placeholder="별칭 (쉼표 구분, 선택)" />
                    <textarea id="wt-input-memo" class="wt-input wt-textarea" placeholder="메모 (선택)" rows="2"></textarea>
                    <button id="wt-btn-add" class="wt-btn-primary">✚ 장소 추가</button>
                </div>

                <!-- 장소 목록 -->
                <div class="wt-section-title"><span>장소 목록</span><span id="wt-loc-count" class="wt-badge">0</span></div>
                <div id="wt-loc-list" class="wt-loc-list"></div>

                <!-- 이동 히스토리 -->
                <div class="wt-section-title"><span>🚶 이동 히스토리</span></div>
                <div id="wt-move-list" class="wt-move-list"></div>
            </div>
        </div>

        <!-- 팝오버 -->
        <div id="wt-popover" class="wt-popover" style="display:none;">
            <div class="wt-pop-header"><span id="wt-pop-title"></span><button id="wt-pop-close" class="wt-btn-icon">✕</button></div>
            <div class="wt-pop-body">
                <div class="wt-pop-stats">
                    <div><span class="wt-stat-l">방문</span> <span id="wt-pop-visits">0</span>회</div>
                    <div><span class="wt-stat-l">첫 방문</span> <span id="wt-pop-first">—</span></div>
                    <div><span class="wt-stat-l">최근</span> <span id="wt-pop-last">—</span></div>
                </div>
                <textarea id="wt-pop-memo" class="wt-input wt-textarea" placeholder="메모를 남겨보세요..." rows="3"></textarea>
                <input type="text" id="wt-pop-status" class="wt-input" placeholder="상태 (붐빔, 한산, 비 오는 날...)" />
                <div class="wt-pop-actions">
                    <button id="wt-pop-save" class="wt-btn-primary">💾 저장</button>
                    <button id="wt-pop-del" class="wt-btn-danger">🗑️</button>
                </div>
                <button id="wt-pop-move" class="wt-btn-ghost wt-btn-sm">📍 위치 수정</button>
            </div>
        </div>

        <!-- 미등록 장소 토스트 -->
        <div id="wt-npt" class="wt-npt" style="display:none;">
            <div class="wt-npt-text"><span>🗺️ 새 장소 발견!</span><strong id="wt-npt-name"></strong></div>
            <div id="wt-npt-similar" class="wt-npt-similar" style="display:none;">
                <span class="wt-npt-sim-label">혹시 같은 장소?</span>
                <div id="wt-npt-sim-list" class="wt-npt-sim-list"></div>
            </div>
            <div class="wt-npt-actions">
                <button id="wt-npt-add" class="wt-btn-primary">새로 등록</button>
                <button id="wt-npt-dismiss" class="wt-btn-ghost">무시</button>
            </div>
        </div>`;

        $('body').append(html);
        this._bindPanel();
    }

    _bindPanel() {
        $('#wt-panel-close').on('click', () => this.togglePanel(false));
        $('#wt-btn-add').on('click', () => this._addLoc());
        $('#wt-input-name').on('keydown', e => { if (e.key === 'Enter') this._addLoc(); });
        $('#wt-pop-close').on('click', () => this.hidePop());
        $('#wt-pop-save').on('click', () => this._popSave());
        $('#wt-pop-del').on('click', () => this._popDel());
        $('#wt-pop-move').on('click', () => this._popMove());
        $('#wt-npt-dismiss').on('click', () => $('#wt-npt').fadeOut(200));
        // 투명도
        $('#wt-opacity').on('input', function () {
            const v = $(this).val();
            $('#wt-opacity-val').text(v + '%');
            $('#wt-panel').css('opacity', v / 100);
            extension_settings[EXTENSION_NAME].panelOpacity = parseInt(v);
            saveSettingsDebounced();
        });
        const savedOp = extension_settings[EXTENSION_NAME]?.panelOpacity ?? 100;
        $('#wt-opacity').val(savedOp);
        $('#wt-opacity-val').text(savedOp + '%');
    }

    togglePanel(show) {
        this.panelVisible = show ?? !this.panelVisible;
        if (this.panelVisible) {
            $('#wt-panel').addClass('wt-panel-open');
            const op = extension_settings[EXTENSION_NAME]?.panelOpacity ?? 100;
            $('#wt-panel').css('opacity', op / 100);
            this.refresh();
        } else {
            $('#wt-panel').removeClass('wt-panel-open');
            this.hidePop();
        }
    }

    async refresh() {
        await this.lm.loadChat();
        $('#wt-detect-badge').toggleClass('wt-detect-active', !!extension_settings[EXTENSION_NAME]?.autoDetect);
        if (!this.mapRenderer) {
            this.mapRenderer = new MapRenderer(document.querySelector('#wt-map-container'), this.lm);
            this.mapRenderer.onLocationClick = id => this.showPop(id);
        }
        this.mapRenderer.render();
        this._updateDualLoc();
        this._renderLocList();
        this._renderMoveList();
        this._updatePrompt();
    }

    _updateDualLoc() {
        const u = this.lm.locations.find(l => l.id === this.lm.userLocationId);
        const c = this.lm.locations.find(l => l.id === this.lm.charLocationId);
        $('#wt-user-loc').text(u?.name || '—').css('color', u?.color || '');
        $('#wt-char-loc').text(c?.name || '—').css('color', c?.color || '');
    }

    _updatePrompt() {
        const s = extension_settings[EXTENSION_NAME];
        if (s?.aiInjection && this.pi) {
            const t = this.pi.generate();
            if (t) { $('#wt-prompt-text').text(t); $('#wt-prompt-preview').slideDown(150); return; }
        }
        $('#wt-prompt-preview').slideUp(150);
    }

    _renderLocList() {
        const list = $('#wt-loc-list').empty();
        $('#wt-loc-count').text(this.lm.locations.length);
        if (!this.lm.locations.length) { list.html('<div class="wt-empty">RP를 시작하면 자동으로 장소가 추가돼요! ✨</div>'); return; }
        const sorted = [...this.lm.locations].sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
        for (const loc of sorted) {
            const isU = loc.id === this.lm.userLocationId, isC = loc.id === this.lm.charLocationId;
            const marker = isU && isC ? ' 👤🎭' : isU ? ' 👤' : isC ? ' 🎭' : '';
            const active = isU || isC ? 'wt-loc-active' : '';
            const item = $(`<div class="wt-loc-item ${active}" data-id="${loc.id}">
                <div class="wt-loc-dot" style="background:${loc.color}"></div>
                <div class="wt-loc-info"><div class="wt-loc-name">${loc.name}${marker}</div>
                ${loc.memo ? `<div class="wt-loc-memo">${loc.memo}</div>` : ''}</div>
                <div class="wt-loc-visits">${loc.visitCount || 0}회</div></div>`);
            item.on('click', () => this.showPop(loc.id));
            list.append(item);
        }
    }

    _renderMoveList() {
        const list = $('#wt-move-list').empty();
        if (!this.lm.movements.length) { list.html('<div class="wt-empty">아직 이동 기록이 없어요</div>'); return; }
        const recent = [...this.lm.movements].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
        for (const m of recent) {
            const f = this.lm.locations.find(l => l.id === m.fromId);
            const t = this.lm.locations.find(l => l.id === m.toId);
            if (!f || !t) continue;
            const time = new Date(m.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            const icon = m.source === 'user' ? '👤' : m.source === 'char' ? '🎭' : '👣';
            const dist = m.distance ? `<span class="wt-mv-dist">${m.distance}</span>` : '';
            list.append(`<div class="wt-mv-item">
                <span class="wt-mv-icon">${icon}</span>
                <span class="wt-mv-time">${time}</span>
                <span class="wt-mv-from">${f.name}</span>
                <span class="wt-mv-arrow">→</span>
                <span class="wt-mv-to">${t.name}</span>${dist}</div>`);
        }
    }

    // ---- Add Location ----
    async _addLoc() {
        const name = $('#wt-input-name').val().trim();
        if (!name) { $('#wt-input-name').addClass('wt-input-error'); setTimeout(() => $('#wt-input-name').removeClass('wt-input-error'), 600); return; }
        if (!this.lm.currentChatId) await this.lm.loadChat();
        if (!this.lm.currentChatId) { toastr.warning('채팅방을 먼저 선택해주세요.'); return; }
        if (this.lm.findByName(name)) { toastr.warning(`"${name}" 이미 존재합니다.`); return; }
        const aliases = $('#wt-input-aliases').val().split(',').map(a => a.trim()).filter(Boolean);
        const memo = $('#wt-input-memo').val().trim();
        try {
            const loc = await this.lm.addLocation(name, memo, aliases);
            if (loc) { toastr.success(`"${name}" 추가됨! 🗺️`); $('#wt-input-name,#wt-input-aliases,#wt-input-memo').val(''); this.refresh(); }
        } catch (e) { toastr.error('장소 추가 오류'); console.error(e); }
    }

    // ---- Popover ----
    showPop(id) {
        const l = this.lm.locations.find(x => x.id === id); if (!l) return;
        $('#wt-popover').attr('data-id', id);
        $('#wt-pop-title').text(l.name);
        $('#wt-pop-visits').text(l.visitCount || 0);
        $('#wt-pop-first').text(l.firstVisited ? this._fmt(l.firstVisited) : '—');
        $('#wt-pop-last').text(l.lastVisited ? this._fmt(l.lastVisited) : '—');
        $('#wt-pop-memo').val(l.memo || '');
        $('#wt-pop-status').val(l.status || '');
        $('#wt-popover').fadeIn(150);
    }
    hidePop() { $('#wt-popover').fadeOut(100); }

    async _popSave() {
        const id = $('#wt-popover').attr('data-id');
        await this.lm.updateLocation(id, { memo: $('#wt-pop-memo').val().trim(), status: $('#wt-pop-status').val().trim() });
        toastr.success('저장! 💾'); this.pi?.inject(); this.refresh();
    }
    async _popDel() {
        const id = $('#wt-popover').attr('data-id');
        const l = this.lm.locations.find(x => x.id === id);
        if (!confirm(`"${l?.name}" 삭제?`)) return;
        await this.lm.deleteLocation(id); this.hidePop(); toastr.info('삭제됨'); this.pi?.inject(); this.refresh();
    }
    async _popMove() {
        const id = $('#wt-popover').attr('data-id');
        await this.lm.moveTo(id, 'scene'); this.hidePop(); this.pi?.inject(); this.refresh();
    }

    // ---- New Place Toast ----
    showNewPlaceToast(name, source = 'char') {
        $('#wt-npt-name').text(name);
        const similar = this._findSimilar(name);
        const simList = $('#wt-npt-sim-list').empty();
        if (similar.length > 0) {
            for (const loc of similar) {
                const btn = $(`<button class="wt-btn-accent wt-npt-merge">📎 "${loc.name}"에 별칭 추가</button>`);
                btn.on('click', async () => {
                    await this.lm.updateLocation(loc.id, { aliases: [...(loc.aliases || []), name] });
                    await this.lm.moveTo(loc.id, source);
                    toastr.success(`"${name}" → "${loc.name}" 별칭 추가! 🔗`);
                    this.pi?.inject(); if (this.panelVisible) this.refresh();
                    $('#wt-npt').fadeOut(200);
                });
                simList.append(btn);
            }
            $('#wt-npt-similar').show();
        } else { $('#wt-npt-similar').hide(); }

        $('#wt-npt-add').off('click').on('click', async () => {
            if (!this.lm.currentChatId) await this.lm.loadChat();
            const loc = await this.lm.addLocation(name);
            if (loc) { await this.lm.moveTo(loc.id, source); toastr.success(`"${name}" 등록! 🗺️`); this.pi?.inject(); if (this.panelVisible) this.refresh(); }
            $('#wt-npt').fadeOut(200);
        });
        $('#wt-npt').fadeIn(300);
        setTimeout(() => $('#wt-npt').fadeOut(200), 15000);
    }

    _findSimilar(name) {
        if (!this.lm.locations.length) return [];
        const lo = name.toLowerCase();
        const matched = categoryGroups.filter(g => g.some(w => lo.includes(w)));
        if (!matched.length) return [];
        const results = [];
        for (const loc of this.lm.locations) {
            const names = [loc.name.toLowerCase(), ...(loc.aliases || []).map(a => a.toLowerCase())];
            for (const g of matched) {
                if (names.some(n => g.some(w => n.includes(w)))) { results.push(loc); break; }
            }
        }
        return results.slice(0, 3);
    }

    _fmt(ts) { return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
}
