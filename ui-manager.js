// 🗺️ RP World Tracker — ui-manager.js
// UI: 설정 패널, 사이드 패널, 팝오버, 장소 목록, 이동 히스토리

import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { EXTENSION_NAME } from './index.js';
import { MapRenderer } from './map-renderer.js';

export class UIManager {
    constructor(locationManager, promptInjector) {
        this.lm = locationManager;
        this.pi = promptInjector;
        this.mapRenderer = null;
        this.panelVisible = false;
    }

    // ============================================================
    // Settings Panel (SillyTavern 확장 설정 영역)
    // ============================================================
    createSettingsPanel() {
        const html = `
        <div id="wt-settings" class="wt-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🗺️ RP World Tracker <span class="wt-version">v0.2.0-beta</span></b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="wt-settings-row">
                        <label><input type="checkbox" id="wt-enabled" /> 확장 활성화</label>
                    </div>
                    <div class="wt-divider"></div>
                    <div class="wt-settings-row">
                        <label><input type="checkbox" id="wt-auto-detect" /> 🔍 장소 자동 감지</label>
                    </div>
                    <div class="wt-settings-row">
                        <label><input type="checkbox" id="wt-detect-toast" /> 📍 이동 알림 표시</label>
                    </div>
                    <div class="wt-divider"></div>
                    <div class="wt-settings-row">
                        <label><input type="checkbox" id="wt-ai-injection" /> 🤖 AI 프롬프트 주입</label>
                    </div>
                    <div class="wt-settings-row">
                        <label>💭 기억 모드</label>
                        <select id="wt-memory-mode" class="text_pole wt-select">
                            <option value="natural">🌿 자연스러운 기억</option>
                            <option value="perfect">💎 완벽한 기억</option>
                        </select>
                    </div>
                    <div class="wt-divider"></div>
                    <div class="wt-settings-row">
                        <button id="wt-open-panel" class="menu_button wt-open-btn">🗺️ 월드 맵 열기</button>
                    </div>
                </div>
            </div>
        </div>`;

        $('#extensions_settings2').append(html);
        this._bindSettings();
    }

    _bindSettings() {
        const s = extension_settings[EXTENSION_NAME];

        $('#wt-enabled').prop('checked', s?.enabled ?? true)
            .on('change', function () { s.enabled = $(this).is(':checked'); saveSettingsDebounced(); });

        $('#wt-auto-detect').prop('checked', s?.autoDetect ?? true)
            .on('change', function () { s.autoDetect = $(this).is(':checked'); saveSettingsDebounced(); });

        $('#wt-detect-toast').prop('checked', s?.showDetectToast ?? true)
            .on('change', function () { s.showDetectToast = $(this).is(':checked'); saveSettingsDebounced(); });

        $('#wt-ai-injection').prop('checked', s?.aiInjection ?? true)
            .on('change', () => {
                s.aiInjection = $('#wt-ai-injection').is(':checked');
                saveSettingsDebounced();
                s.aiInjection ? this.pi?.inject() : this.pi?.clear();
            });

        $('#wt-memory-mode').val(s?.memoryMode || 'natural')
            .on('change', () => { s.memoryMode = $('#wt-memory-mode').val(); saveSettingsDebounced(); this.pi?.inject(); });

        $('#wt-open-panel').on('click', () => this.togglePanel());
    }

    // ============================================================
    // Side Panel
    // ============================================================
    createSidePanel() {
        const html = `
        <div id="wt-panel" class="wt-panel">
            <div class="wt-panel-header">
                <div class="wt-panel-title">
                    <span>🗺️</span>
                    <span>World Tracker</span>
                    <span id="wt-detect-badge" class="wt-detect-badge">🔍</span>
                </div>
                <button id="wt-panel-close" class="wt-btn-icon">✕</button>
            </div>

            <div class="wt-panel-body">
                <div id="wt-map-container" class="wt-map-container"></div>

                <div id="wt-current-location" class="wt-current-location">
                    <span class="wt-current-emoji">📍</span>
                    <div class="wt-current-info">
                        <span class="wt-current-label">현재 위치</span>
                        <span id="wt-current-name" class="wt-current-name">— 없음 —</span>
                    </div>
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

                <div class="wt-section-title">
                    <span>장소 목록</span>
                    <span id="wt-location-count" class="wt-count-badge">0</span>
                </div>
                <div id="wt-location-list" class="wt-location-list"></div>

                <div class="wt-section-title"><span>🚶 이동 히스토리</span></div>
                <div id="wt-movement-list" class="wt-movement-list"></div>
            </div>
        </div>

        <!-- 팝오버 -->
        <div id="wt-popover" class="wt-popover" style="display:none;">
            <div class="wt-popover-header">
                <span id="wt-popover-title"></span>
                <button id="wt-popover-close" class="wt-btn-icon">✕</button>
            </div>
            <div class="wt-popover-body">
                <div class="wt-popover-stats">
                    <div><span class="wt-stat-label">방문</span> <span id="wt-popover-visits">0</span>회</div>
                    <div><span class="wt-stat-label">첫 방문</span> <span id="wt-popover-first">—</span></div>
                    <div><span class="wt-stat-label">최근</span> <span id="wt-popover-last">—</span></div>
                </div>
                <textarea id="wt-popover-memo" class="wt-input wt-textarea" placeholder="메모를 남겨보세요..." rows="3"></textarea>
                <input type="text" id="wt-popover-status" class="wt-input" placeholder="상태 (붐빔, 한산, 비 오는 날...)" />
                <div class="wt-popover-actions">
                    <button id="wt-popover-move" class="wt-btn-accent">👣 여기로 이동</button>
                    <button id="wt-popover-save" class="wt-btn-primary">💾 저장</button>
                    <button id="wt-popover-delete" class="wt-btn-danger">🗑️</button>
                </div>
            </div>
        </div>

        <!-- 미등록 장소 발견 토스트 -->
        <div id="wt-new-place-toast" class="wt-new-place-toast" style="display:none;">
            <div class="wt-npt-text">
                <span>🗺️ 새 장소 발견!</span>
                <strong id="wt-npt-name"></strong>
            </div>
            <div class="wt-npt-actions">
                <button id="wt-npt-add" class="wt-btn-primary">등록</button>
                <button id="wt-npt-dismiss" class="wt-btn-ghost">무시</button>
            </div>
        </div>`;

        $('body').append(html);
        this._bindPanel();
    }

    _bindPanel() {
        $('#wt-panel-close').on('click', () => this.togglePanel(false));
        $('#wt-btn-add').on('click', () => this._addLocation());
        $('#wt-input-name').on('keydown', (e) => { if (e.key === 'Enter') this._addLocation(); });
        $('#wt-popover-close').on('click', () => this.hidePopover());
        $('#wt-popover-save').on('click', () => this._popoverSave());
        $('#wt-popover-delete').on('click', () => this._popoverDelete());
        $('#wt-popover-move').on('click', () => this._popoverMove());
        $('#wt-npt-dismiss').on('click', () => $('#wt-new-place-toast').fadeOut(200));
    }

    // ---- Panel Toggle ----

    togglePanel(show) {
        this.panelVisible = show ?? !this.panelVisible;
        if (this.panelVisible) {
            $('#wt-panel').addClass('wt-panel-open');
            this.refresh();
        } else {
            $('#wt-panel').removeClass('wt-panel-open');
            this.hidePopover();
        }
    }

    // ---- Refresh ----

    async refresh() {
        await this.lm.loadChat();

        // 감지 뱃지
        const active = extension_settings[EXTENSION_NAME]?.autoDetect;
        $('#wt-detect-badge').toggleClass('wt-detect-active', !!active);

        // 맵
        if (!this.mapRenderer) {
            this.mapRenderer = new MapRenderer(document.querySelector('#wt-map-container'), this.lm);
            this.mapRenderer.onLocationClick = (id) => this.showPopover(id);
        }
        this.mapRenderer.render();

        this._updateCurrentLocation();
        this._renderLocationList();
        this._renderMovementList();
        this._updatePromptPreview();
    }

    _updateCurrentLocation() {
        const loc = this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        if (loc) {
            $('#wt-current-name').text(`${loc.name} ${loc.status ? '· ' + loc.status : ''}`).css('color', loc.color);
        } else {
            $('#wt-current-name').text('— 없음 —').css('color', '');
        }
    }

    _updatePromptPreview() {
        const s = extension_settings[EXTENSION_NAME];
        if (s?.aiInjection && this.pi) {
            const text = this.pi.generate();
            if (text) {
                $('#wt-prompt-text').text(text);
                $('#wt-prompt-preview').slideDown(150);
                return;
            }
        }
        $('#wt-prompt-preview').slideUp(150);
    }

    _renderLocationList() {
        const list = $('#wt-location-list').empty();
        $('#wt-location-count').text(this.lm.locations.length);

        if (this.lm.locations.length === 0) {
            list.html('<div class="wt-empty-hint">RP를 시작하면 자동으로 장소가 추가돼요! ✨</div>');
            return;
        }

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
                </div>`);
            item.on('click', () => this.showPopover(loc.id));
            list.append(item);
        }
    }

    _renderMovementList() {
        const list = $('#wt-movement-list').empty();
        if (this.lm.movements.length === 0) {
            list.html('<div class="wt-empty-hint">아직 이동 기록이 없어요</div>');
            return;
        }

        const recent = [...this.lm.movements].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
        for (const m of recent) {
            const from = this.lm.locations.find(l => l.id === m.fromId);
            const to = this.lm.locations.find(l => l.id === m.toId);
            if (!from || !to) continue;
            const time = new Date(m.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            const dist = m.distance ? `<span class="wt-move-dist">${m.distance}</span>` : '';
            list.append(`
                <div class="wt-movement-item">
                    <span class="wt-move-time">${time}</span>
                    <span class="wt-move-from">${from.name}</span>
                    <span class="wt-move-arrow">→</span>
                    <span class="wt-move-to">${to.name}</span>
                    ${dist}
                </div>`);
        }
    }

    // ---- Add Location ----

    async _addLocation() {
        const name = $('#wt-input-name').val().trim();
        if (!name) {
            $('#wt-input-name').addClass('wt-input-error');
            setTimeout(() => $('#wt-input-name').removeClass('wt-input-error'), 600);
            return;
        }

        if (!this.lm.currentChatId) await this.lm.loadChat();
        if (!this.lm.currentChatId) {
            toastr.warning('채팅방을 먼저 선택해주세요.');
            return;
        }

        if (this.lm.findByName(name)) {
            toastr.warning(`"${name}" 은(는) 이미 존재합니다.`);
            return;
        }

        const aliases = $('#wt-input-aliases').val().split(',').map(a => a.trim()).filter(Boolean);
        const memo = $('#wt-input-memo').val().trim();

        try {
            const loc = await this.lm.addLocation(name, memo, aliases);
            if (loc) {
                toastr.success(`"${name}" 장소가 추가되었습니다! 🗺️`);
                $('#wt-input-name, #wt-input-aliases, #wt-input-memo').val('');
                this.refresh();
            }
        } catch (err) {
            console.error(`[${EXTENSION_NAME}] addLocation error:`, err);
            toastr.error('장소 추가 중 오류가 발생했습니다.');
        }
    }

    // ---- Popover ----

    showPopover(id) {
        const loc = this.lm.locations.find(l => l.id === id);
        if (!loc) return;
        $('#wt-popover').attr('data-id', id);
        $('#wt-popover-title').text(loc.name);
        $('#wt-popover-visits').text(loc.visitCount || 0);
        $('#wt-popover-first').text(loc.firstVisited ? this._fmtDate(loc.firstVisited) : '—');
        $('#wt-popover-last').text(loc.lastVisited ? this._fmtDate(loc.lastVisited) : '—');
        $('#wt-popover-memo').val(loc.memo || '');
        $('#wt-popover-status').val(loc.status || '');
        $('#wt-popover').fadeIn(150);
    }

    hidePopover() { $('#wt-popover').fadeOut(100); }

    async _popoverSave() {
        const id = $('#wt-popover').attr('data-id');
        await this.lm.updateLocation(id, {
            memo: $('#wt-popover-memo').val().trim(),
            status: $('#wt-popover-status').val().trim(),
        });
        toastr.success('저장되었습니다! 💾');
        this.pi?.inject();
        this.refresh();
    }

    async _popoverDelete() {
        const id = $('#wt-popover').attr('data-id');
        const loc = this.lm.locations.find(l => l.id === id);
        if (!confirm(`"${loc?.name}" 장소를 삭제하시겠습니까?`)) return;
        await this.lm.deleteLocation(id);
        this.hidePopover();
        toastr.info(`"${loc?.name}" 삭제됨`);
        this.pi?.inject();
        this.refresh();
    }

    async _popoverMove() {
        const id = $('#wt-popover').attr('data-id');
        await this.lm.moveTo(id);
        this.hidePopover();
        this.pi?.inject();
        this.refresh();
    }

    // ---- New Place Toast (미등록 장소 발견) ----

    showNewPlaceToast(name) {
        $('#wt-npt-name').text(name);
        $('#wt-npt-add').off('click').on('click', async () => {
            if (!this.lm.currentChatId) await this.lm.loadChat();
            const loc = await this.lm.addLocation(name);
            if (loc) {
                await this.lm.moveTo(loc.id);
                toastr.success(`"${name}" 등록 + 이동! 🗺️`);
                this.pi?.inject();
                if (this.panelVisible) this.refresh();
            }
            $('#wt-new-place-toast').fadeOut(200);
        });
        $('#wt-new-place-toast').fadeIn(300);

        // 10초 후 자동 닫기
        setTimeout(() => $('#wt-new-place-toast').fadeOut(200), 10000);
    }

    _fmtDate(ts) {
        return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
}
