// 🐶 월드맵 — ui-manager.js (Inline Toast + Popover)

import { getContext, extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { EXTENSION_NAME, wtNotify, toastWarn, toastSuccess, loadLeaflet } from './index.js';
import { MapRenderer } from './map-renderer.js';
import { LeafletRenderer } from './leaflet-renderer.js';

const catGroups = [
    ['hall','room','chamber','lounge'],['dining','mess','cafeteria','restaurant','kitchen','cafe','canteen'],
    ['office','study','workshop','lab'],['bedroom','quarters','dorm','bunk','dormitory'],
    ['gym','arena','court','field','ground','training','range'],['armory','arsenal','weapons'],
    ['garden','park','yard','plaza','square'],['shop','store','market','mall','mart','grocery','supermarket','convenience'],
    ['library','archive','bookstore'],['bar','pub','tavern','inn'],
    ['식당','카페','음식점','레스토랑','매점','구내식당'],['숙소','기숙사','침실','방','객실'],
    ['사무실','연구실','작업실'],['도서관','서점','서재'],['공원','정원','광장'],['체육관','운동장','훈련장','사격장'],
];

export class UIManager {
    constructor(lm, pi) { this.lm=lm; this.pi=pi; this.mapRenderer=null; this.leafletRenderer=null; this.panelVisible=false; }

    createSettingsPanel() {
        const html = `<div id="wt-settings" class="wt-settings"><div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🐶 월드맵 <span class="wt-version">v0.2.1</span></b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div><div class="inline-drawer-content">
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-enabled"/> 활성화</label></div>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-detect"/> 🔍 자동 감지</label></div>
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-toast"/> 📍 이동 알림</label></div>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label><input type="checkbox" id="wt-s-inject"/> 🤖 AI 프롬프트 주입</label></div>
                <div class="wt-s-row"><label><span id="wt-secret" style="cursor:default">💭</span> 기억</label>
                    <select id="wt-s-mem" class="text_pole wt-select"><option value="natural">🌿 자연</option><option value="perfect">💎 완벽</option></select>
                </div>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><label>🧠 감지 모델</label></div>
                <div class="wt-s-row"><select id="wt-s-profile" class="text_pole wt-select wt-select-full"><option value="">없음 (regex만)</option></select></div>
                <div class="wt-s-row"><button id="wt-s-profile-save" class="menu_button" style="font-size:12px;padding:4px 12px">💾 모델 저장</button><span id="wt-s-profile-status" style="font-size:11px;color:#9A8A7A;margin-left:6px"></span></div>
                <div class="wt-divider"></div>
                <div class="wt-s-row"><button id="wt-open-panel" class="menu_button wt-open-btn">🐶 월드맵</button></div>
            </div></div></div>`;
        const containers = ['#extensions_settings2','#extensions_settings','.extensions_block'];
        let target = null;
        for (const sel of containers) { target = $(sel); if (target.length) break; }
        if (!target?.length) { setTimeout(() => this.createSettingsPanel(), 3000); return; }
        target.append(html);
        this._bindSettings();
    }

    _bindSettings() {
        const s = extension_settings[EXTENSION_NAME];
        const bind = (sel, key, def) => $(sel).prop('checked', s?.[key] ?? def).on('change', function(){ s[key]=$(this).is(':checked'); saveSettingsDebounced(); });
        bind('#wt-s-enabled','enabled',true); bind('#wt-s-detect','autoDetect',true); bind('#wt-s-toast','showDetectToast',true); bind('#wt-s-inject','aiInjection',true);
        $('#wt-s-inject').on('change', () => { s.aiInjection ? this.pi?.inject() : this.pi?.clear(); });
        $('#wt-s-mem').val(s?.memoryMode||'natural').on('change', () => { s.memoryMode=$('#wt-s-mem').val(); saveSettingsDebounced(); this.pi?.inject(); });
        // 🧠 감지 모델 프로필 로드
        this._loadProfiles();
        $('#wt-s-profile').on('change', () => { $('#wt-s-profile-status').text('⚠️ 미저장').css('color','#F5A8A8'); });
        $('#wt-s-profile-save').on('click', () => {
            s.selectedProfile = $('#wt-s-profile').val();
            saveSettingsDebounced();
            const name = $('#wt-s-profile option:selected').text() || '없음';
            $('#wt-s-profile-status').text(`✅ "${name}" 저장됨`).css('color','#5E84E2');
            toastSuccess(`🧠 감지 모델: ${name}`);
            setTimeout(() => $('#wt-s-profile-status').text(''), 3000);
        });
        $('#wt-open-panel').on('click', () => this.togglePanel());
        // 🔧 비밀 디버그: 💭 5번 탭
        let _t=0, _tm=null;
        $(document).on('click','#wt-secret', e => { e.stopPropagation(); _t++; clearTimeout(_tm);
            if(_t>=5){_t=0;s.debugMode=!s.debugMode;saveSettingsDebounced();wtNotify(s.debugMode?'🔧 Debug ON':'🔧 Debug OFF','info',2000);}
            _tm=setTimeout(()=>{_t=0},2000);
        });
    }

    _loadProfiles() {
        const sel = $('#wt-s-profile');
        const s = extension_settings[EXTENSION_NAME];
        sel.find('option:not(:first)').remove();

        try {
            // SillyTavern Connection Manager 프로필 (번역기와 동일 방식)
            const ctx = getContext();
            const profiles = ctx?.extensionSettings?.connectionManager?.profiles || [];
            for (const p of profiles) {
                if (p.id && p.name) sel.append(`<option value="${p.id}">${p.name}</option>`);
            }

            // 프로필 없으면 3초 후 재시도 (비동기 로드 대기)
            if (!profiles.length && !this._profileRetried) {
                this._profileRetried = true;
                setTimeout(() => { this._profileRetried = false; this._loadProfiles(); }, 3000);
            }
        } catch(e) { console.warn(`[${EXTENSION_NAME}] Profile load:`, e); }

        if (s?.selectedProfile) sel.val(s.selectedProfile);
    }

    registerWandButton() {
        try { const b=document.createElement('div'); b.id='wt-wand-btn'; b.className='list-group-item flex-container flexGap5';
            b.innerHTML='<span>🐶</span> 월드맵'; b.addEventListener('click',()=>this.togglePanel());
            const m=document.getElementById('extensionsMenu'); if(m)m.appendChild(b); } catch(e){}
    }

    createSidePanel() {
        const html = `
        <div id="wt-panel" class="wt-panel">
            <div class="wt-panel-header">
                <div class="wt-panel-title"><span>🐶</span> 월드맵</div>
                <button id="wt-panel-close" class="wt-btn-icon">✕</button>
            </div>
            <div class="wt-panel-body" id="wt-panel-body">
                <!-- 자동 등록 알림 (인라인!) -->
                <div id="wt-auto-toast" class="wt-auto-toast" style="display:none">
                    <div class="wt-at-row"><span>🐶</span><strong id="wt-at-name"></strong><span>등록됨!</span></div>
                    <div id="wt-at-similar" style="display:none">
                        <div class="wt-at-sim-label">혹시 같은 장소?</div>
                        <div id="wt-at-sim-list"></div>
                    </div>
                    <div class="wt-at-actions">
                        <button id="wt-at-ok" class="wt-btn-accent wt-btn-s">✅ 추가</button>
                        <button id="wt-at-edit" class="wt-btn-primary wt-btn-s">✏️ 수정</button>
                        <button id="wt-at-undo" class="wt-btn-danger wt-btn-s">↩️ 취소</button>
                    </div>
                </div>

                <div class="wt-opacity-row"><span>🔮</span><input type="range" id="wt-opacity" min="30" max="100" value="100"/><span id="wt-op-val">100%</span></div>

                <div class="wt-map-toggle" id="wt-map-toggle">🗺️ 지도 ▾</div>
                <div id="wt-map-section" style="display:none">
                    <div class="wt-map-mode-bar">
                        <button id="wt-mode-node" class="wt-mode-btn wt-mode-active">📊 노드</button>
                        <button id="wt-mode-leaflet" class="wt-mode-btn">🌍 실제 지도</button>
                        <button id="wt-btn-layout" class="wt-mode-btn" style="font-size:11px;flex:0.6">🗺️ 약도</button>
                    </div>
                    <div id="wt-search-bar" class="wt-search-bar" style="display:none">
                        <input type="search" id="wt-search-input" class="wt-input" placeholder="🔍 장소 검색..." autocomplete="off" inputmode="search"/>
                        <div id="wt-search-results" class="wt-search-results" style="display:none"></div>
                    </div>
                    <div id="wt-map-wrap" class="wt-map-wrap">
                        <div id="wt-map-container" class="wt-map-container"></div>
                        <div class="wt-compass-overlay">
                            <svg width="44" height="44" viewBox="0 0 44 44">
                                <circle cx="22" cy="22" r="18" stroke="#A08060" stroke-width="1.5" fill="none"/>
                                <circle cx="22" cy="22" r="2.5" fill="#A08060"/>
                                <polygon points="22,6 19,16 25,16" fill="#F5A8A8" stroke="#A08060" stroke-width="0.5"/>
                                <polygon points="22,38 19,28 25,28" fill="#A8D8EA" stroke="#A08060" stroke-width="0.5"/>
                                <polygon points="6,22 16,19 16,25" fill="#FCE7AE" stroke="#A08060" stroke-width="0.5"/>
                                <polygon points="38,22 28,19 28,25" fill="#FCE7AE" stroke="#A08060" stroke-width="0.5"/>
                                <text x="22" y="4" text-anchor="middle" font-weight="700" font-size="7" fill="#F5A8A8">N</text>
                                <text x="22" y="44" text-anchor="middle" font-weight="700" font-size="7" fill="#A8D8EA">S</text>
                                <text x="3" y="24" text-anchor="middle" font-weight="700" font-size="7" fill="#C4A882">W</text>
                                <text x="41" y="24" text-anchor="middle" font-weight="700" font-size="7" fill="#C4A882">E</text>
                            </svg>
                        </div>
                    </div>
                    <div id="wt-leaflet-wrap" class="wt-map-wrap" style="display:none">
                        <div id="wt-leaflet-container" class="wt-map-container wt-leaflet-map"></div>
                    </div>
                </div>

                <!-- 팝오버 (인라인!) -->
                <div id="wt-popover" class="wt-popover-inline" style="display:none">
                    <div class="wt-pop-header"><span id="wt-pop-title"></span><button id="wt-pop-close" class="wt-btn-icon">✕</button></div>
                    <div class="wt-pop-body">
                        <div class="wt-pop-stats">
                            <div><span class="wt-stat-l">방문</span><span id="wt-pop-visits">0</span>회</div>
                            <div><span class="wt-stat-l">첫</span><span id="wt-pop-first">—</span></div>
                            <div><span class="wt-stat-l">최근</span><span id="wt-pop-last">—</span></div>
                        </div>
                        <div id="wt-pop-dist-section" style="display:none">
                            <div style="font-size:12px;color:#9A8A7A;margin-bottom:4px">📏 주요 장소와의 거리</div>
                            <div id="wt-pop-dist-list" style="display:flex;flex-direction:column;gap:4px"></div>
                            <div style="display:flex;gap:4px;margin-top:4px;align-items:center">
                                <select id="wt-pop-dist-target" class="wt-input wt-select-full" style="flex:1;font-size:12px;padding:6px 8px"></select>
                                <input type="text" id="wt-pop-dist-value" class="wt-input" placeholder="도보 10분" style="width:80px;font-size:12px;padding:6px 8px"/>
                                <button id="wt-pop-dist-add" class="wt-btn-accent wt-btn-s">+</button>
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;color:#9A8A7A">
                                <span>가까움</span>
                                <input type="range" id="wt-pop-dist-level" min="1" max="5" value="3" style="flex:1;height:4px"/>
                                <span>멀음</span>
                                <span id="wt-pop-dist-lvl-val" style="font-weight:600;color:var(--wt-brown);min-width:16px">3</span>
                            </div>
                        </div>
                        <textarea id="wt-pop-memo" class="wt-input wt-textarea" placeholder="메모..." rows="2"></textarea>
                        <input type="text" id="wt-pop-status" class="wt-input" placeholder="상태 (붐빔, 한산...)"/>
                        <div style="font-size:12px;color:#9A8A7A;margin-top:2px">🏷️ 별칭 (쉼표 구분)</div>
                        <input type="text" id="wt-pop-aliases" class="wt-input" placeholder="예: 사격장, Shooting range" style="font-size:12px"/>
                        <div class="wt-pop-actions"><button id="wt-pop-save" class="wt-btn-primary">💾 저장</button><button id="wt-pop-del" class="wt-btn-danger">🗑️</button></div>
                        <button id="wt-pop-move" class="wt-btn-ghost wt-btn-sm">📍 위치 수정</button>
                        <button id="wt-pop-moveto" class="wt-btn-accent wt-btn-sm" style="opacity:1;font-size:12px">🐾 여기로 이동</button>
                        <div id="wt-pop-geo-section" style="margin-top:6px">
                            <div style="font-size:12px;color:#9A8A7A;margin-bottom:4px">🔍 주소 검색 (Leaflet 핀)</div>
                            <div style="display:flex;gap:4px">
                                <input type="text" id="wt-pop-geo-input" class="wt-input" placeholder="주소 또는 랜드마크..." style="flex:1;font-size:12px;padding:6px 8px"/>
                                <button id="wt-pop-geo-btn" class="wt-btn-accent wt-btn-s">🔍</button>
                            </div>
                            <div id="wt-pop-geo-results" style="display:none;margin-top:4px;max-height:100px;overflow-y:auto;font-size:11px"></div>
                        </div>
                    </div>
                </div>

                <div class="wt-scene-loc">
                    <span class="wt-scene-icon">🐾</span>
                    <div class="wt-scene-info"><span class="wt-scene-label">현재 씬</span><span id="wt-scene-name" class="wt-scene-name">—</span></div>
                </div>

                <div class="wt-add-toggle" id="wt-add-toggle">✚ 장소 추가 <span id="wt-add-arrow">▾</span></div>
                <div class="wt-add-form" id="wt-add-form" style="display:none">
                    <input type="text" id="wt-input-name" class="wt-input" placeholder="장소 이름"/>
                    <input type="text" id="wt-input-aliases" class="wt-input" placeholder="별칭 (쉼표)"/>
                    <button id="wt-btn-add" class="wt-btn-primary">✚ 추가</button>
                </div>

                <div class="wt-section-toggle" id="wt-loc-toggle">📍 장소 목록 <span id="wt-loc-count" class="wt-badge">0</span> <span id="wt-loc-arrow">▾</span></div>
                <div id="wt-loc-wrap" style="display:none"><div id="wt-loc-list" class="wt-loc-list"></div></div>
                <div class="wt-section-toggle" id="wt-move-toggle">🚶 이동 히스토리 <span id="wt-move-arrow">▾</span></div>
                <div id="wt-move-wrap" style="display:none"><div id="wt-move-list" class="wt-move-list"></div></div>
            </div>
        </div>`;
        $('body').append(html);
        this._bind();
    }

    _bind() {
        $('#wt-panel-close').on('click', () => this.togglePanel(false));
        $('#wt-map-toggle').on('click', () => { $('#wt-map-section').slideToggle(200); const t=$('#wt-map-toggle').text(); $('#wt-map-toggle').text(t.includes('▾')?'🗺️ 지도 ▴':'🗺️ 지도 ▾'); });
        $('#wt-add-toggle').on('click', () => { $('#wt-add-form').slideToggle(200); const a=$('#wt-add-arrow'); a.text(a.text()==='▾'?'▴':'▾'); });
        $('#wt-btn-add').on('click', () => this._addLoc());
        $('#wt-input-name').on('keydown', e => { if(e.key==='Enter') this._addLoc(); });
        $('#wt-pop-close').on('click', () => this.hidePop());
        $('#wt-loc-toggle').on('click', () => { $('#wt-loc-wrap').slideToggle(200); const a=$('#wt-loc-arrow'); a.text(a.text()==='▾'?'▴':'▾'); });
        $('#wt-move-toggle').on('click', () => { $('#wt-move-wrap').slideToggle(200); const a=$('#wt-move-arrow'); a.text(a.text()==='▾'?'▴':'▾'); });
        $('#wt-pop-save').on('click', () => this._popSave());
        $('#wt-pop-del').on('click', () => this._popDel());
        $('#wt-pop-move').on('click', () => this._popMove());
        $('#wt-pop-moveto').on('click', async () => {
            const locId = $('#wt-popover').attr('data-id');
            if (!locId) return;
            await this.lm.moveTo(locId);
            this.pi?.inject();
            this.refresh();
            this.hidePop();
            toastSuccess('🐾 이동 완료!');
        });
        $('#wt-pop-geo-btn').on('click', () => this._geoSearch());
        $('#wt-pop-geo-input').on('keydown', (e) => { if (e.key === 'Enter') this._geoSearch(); });
        $('#wt-pop-dist-add').on('click', () => this._addDist());
        $(document).on('input', '#wt-pop-dist-level', function() { $('#wt-pop-dist-lvl-val').text($(this).val()); });
        // 맵 모드 토글
        $('#wt-mode-node').on('click', () => this._setMapMode('node'));
        $('#wt-mode-leaflet').on('click', () => this._setMapMode('leaflet'));
        $('#wt-btn-layout').on('click', () => {
            if (this.mapRenderer) {
                this.mapRenderer._layoutDirty = true;
                this.mapRenderer.render();
                toastSuccess('🗺️ 약도 재생성!');
            }
        });
        // 검색
        let _searchTimer = null;
        $('#wt-search-input').on('input', () => {
            clearTimeout(_searchTimer);
            _searchTimer = setTimeout(() => this._doSearch(), 500);
        });
        $('#wt-search-input').on('keydown', e => { if(e.key==='Enter') { clearTimeout(_searchTimer); this._doSearch(); } });
        // 모바일: 키보드 열릴 때 검색창 보이게
        $('#wt-search-input').on('focus', () => {
            setTimeout(() => {
                const el = document.getElementById('wt-search-input');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });
        $('#wt-search-input').on('focus', () => {
            setTimeout(() => { document.getElementById('wt-search-input')?.scrollIntoView({behavior:'smooth',block:'center'}); }, 300);
        });
        $('#wt-opacity').on('input', function(){ const v=$(this).val(); $('#wt-op-val').text(v+'%'); $('#wt-panel').css('opacity',v/100); extension_settings[EXTENSION_NAME].panelOpacity=+v; saveSettingsDebounced(); });
        const op = extension_settings[EXTENSION_NAME]?.panelOpacity ?? 100;
        $('#wt-opacity').val(op); $('#wt-op-val').text(op+'%');
    }

    togglePanel(show) {
        this.panelVisible = show ?? !this.panelVisible;
        if (this.panelVisible) {
            $('#wt-panel').addClass('wt-panel-open').css('opacity',(extension_settings[EXTENSION_NAME]?.panelOpacity??100)/100);
            this.refresh();
            // 모바일: 패널 열림 애니메이션 후 강제 렌더 (container height=0 방지)
            setTimeout(() => {
                if (this.mapRenderer) this.mapRenderer.render();
                if (this.leafletRenderer?.map) this.leafletRenderer.invalidateSize();
            }, 350);
        }
        else { $('#wt-panel').removeClass('wt-panel-open'); this.hidePop(); }
    }

    async refresh() {
        await this.lm.loadChat();
        const s = extension_settings[EXTENSION_NAME];
        const mode = s?.mapMode || 'node';

        // 노드 그래프
        if (mode === 'node') {
            const container = document.querySelector('#wt-map-container');
            // SVG가 DOM에서 분리됐으면 재생성
            if (this.mapRenderer && (!this.mapRenderer.svg || !this.mapRenderer.svg.parentNode)) {
                this.mapRenderer = null;
            }
            if (!this.mapRenderer && container) {
                this.mapRenderer = new MapRenderer(container, this.lm);
                this.mapRenderer.onLocationClick = id => this.showPop(id);
                this.mapRenderer.onMoveRequest = (id, name) => {
                    wtNotify(`📍 "${name}" 이동 모드 — 맵을 터치하세요`, 'info', 3000);
                };
            }
            if (this.mapRenderer) this.mapRenderer.render();
        }

        // Leaflet
        if (mode === 'leaflet' && this.leafletRenderer?.map) {
            this.leafletRenderer.render();
            this.leafletRenderer.invalidateSize();
        }

        const cur = this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        $('#wt-scene-name').text(cur?.name || '—').css('color', cur?.color || '');
        this._updLocList(); this._updMoveList();
    }

    async _setMapMode(mode) {
        const s = extension_settings[EXTENSION_NAME];
        s.mapMode = mode; saveSettingsDebounced();

        // UI 버튼 활성화
        $('.wt-mode-btn').removeClass('wt-mode-active');
        $(`#wt-mode-${mode}`).addClass('wt-mode-active');

        if (mode === 'node') {
            $('#wt-leaflet-wrap').hide();
            $('#wt-search-bar').hide();
            $('#wt-map-wrap').show();
            if (!this.mapRenderer) {
                const container = document.querySelector('#wt-map-container');
                if (container) {
                    this.mapRenderer = new MapRenderer(container, this.lm);
                    this.mapRenderer.onLocationClick = id => this.showPop(id);
                    this.mapRenderer.onMoveRequest = (id, name) => {
                        wtNotify(`📍 "${name}" 이동 모드 — 맵을 터치하세요`, 'info', 3000);
                    };
                }
            }
            this.mapRenderer.render();
        } else if (mode === 'leaflet') {
            $('#wt-map-wrap').hide();
            $('#wt-leaflet-wrap').show();
            $('#wt-search-bar').show();
            if (!this.leafletRenderer) {
                const ok = await loadLeaflet();
                if (!ok) { toastWarn('Leaflet CDN 로드 실패!'); this._setMapMode('node'); return; }
                // #46: 컨테이너가 레이아웃 완료될 때까지 대기
                const container = document.querySelector('#wt-leaflet-container');
                if (container) {
                    container.style.width = '100%';
                    container.style.height = '320px';
                    container.style.minHeight = '320px';
                }
                // rAF 2번 → 브라우저 레이아웃 확정 후 init
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                this.leafletRenderer = new LeafletRenderer(document.querySelector('#wt-leaflet-container'), this.lm);
                await this.leafletRenderer.init();
                this.leafletRenderer.onLocationClick = id => this.showPop(id);
            }
            this.leafletRenderer.render();
            // #46: 모바일 invalidateSize — 레이아웃 안정화 후 여러 번
            await new Promise(r => requestAnimationFrame(r));
            this.leafletRenderer?.invalidateSize();
        }
    }

    _updLocList() {
        const list=$('#wt-loc-list').empty(); $('#wt-loc-count').text(this.lm.locations.length);
        if (!this.lm.locations.length) { list.html('<div class="wt-empty">RP를 시작하면 장소가 자동 추가돼요!</div>'); return; }
        for (const loc of [...this.lm.locations].sort((a,b)=>(b.visitCount||0)-(a.visitCount||0))) {
            const cur = loc.id === this.lm.currentLocationId;
            const item = $(`<div class="wt-loc-item ${cur?'wt-loc-active':''}" data-id="${loc.id}">
                <div class="wt-loc-dot" style="background:${loc.color}"></div>
                <div class="wt-loc-info"><div class="wt-loc-name">${loc.name}${cur?' 🐾':''}</div></div>
                <div class="wt-loc-visits">${loc.visitCount||0}회</div></div>`);
            item.on('click', () => this.showPop(loc.id));
            list.append(item);
        }
    }

    _updMoveList() {
        const list=$('#wt-move-list').empty();
        if (!this.lm.movements.length) { list.html('<div class="wt-empty">아직 이동 기록이 없어요</div>'); return; }
        const self = this;
        for (const m of [...this.lm.movements].sort((a,b)=>a.timestamp-b.timestamp).slice(-20)) {
            const f=this.lm.locations.find(l=>l.id===m.fromId), t=this.lm.locations.find(l=>l.id===m.toId);
            if (!f||!t) continue;
            const time=new Date(m.timestamp).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
            const item = $(`<div class="wt-mv-item" style="position:relative">
                <span class="wt-mv-time">${time}</span>
                <span class="wt-mv-from">${f.name}</span>
                <span class="wt-mv-arrow">→</span>
                <span class="wt-mv-to">${t.name}</span>
                ${m.id ? `<button class="wt-btn-icon" style="font-size:10px;padding:2px 4px;color:var(--wt-pink);opacity:0.5" data-mid="${m.id}">✕</button>` : ''}
            </div>`);
            if (m.id) {
                item.find('button').on('click', async function(e) {
                    e.stopPropagation();
                    const mid = parseInt($(this).attr('data-mid'));
                    await self.lm.removeMovement(mid);
                    self._updMoveList();
                    self.pi?.inject();
                    toastSuccess('🗑️ 이동 기록 삭제!');
                });
            }
            list.append(item);
        }
    }

    async _addLoc() {
        const name=$('#wt-input-name').val().trim(); if(!name) return;
        if (!this.lm.currentChatId) await this.lm.loadChat();
        if (!this.lm.currentChatId) { toastWarn('채팅방 선택'); return; }
        if (this.lm.findByName(name)) { toastWarn(`"${name}" 존재`); return; }
        const aliases=$('#wt-input-aliases').val().split(',').map(a=>a.trim()).filter(Boolean);
        const loc = await this.lm.addLocation(name, '', aliases);
        if (loc) { toastSuccess(`"${name}" 추가!`); $('#wt-input-name,#wt-input-aliases').val(''); $('#wt-add-form').slideUp(200); $('#wt-add-arrow').text('▾'); this.refresh(); }
    }

    // ---- Popover (인라인) ----
    showPop(id) {
        const l = this.lm.locations.find(x=>x.id===id); if(!l) return;
        $('#wt-popover').attr('data-id', id);
        $('#wt-pop-title').text(l.name); $('#wt-pop-visits').text(l.visitCount||0);
        $('#wt-pop-first').text(l.firstVisited?this._fmt(l.firstVisited):'—');
        $('#wt-pop-last').text(l.lastVisited?this._fmt(l.lastVisited):'—');
        $('#wt-pop-memo').val(l.memo||''); $('#wt-pop-status').val(l.status||'');
        $('#wt-pop-aliases').val((l.aliases||[]).join(', '));
        // 거리 섹션
        this._updDistSection(id);
        // 맵 열려있으면 접기
        if ($('#wt-map-section').is(':visible')) {
            $('#wt-map-section').hide();
            $('#wt-map-toggle').text('🗺️ 지도 ▾');
        }
        $('#wt-popover').show();
        const pop = document.getElementById('wt-popover');
        const body = document.getElementById('wt-panel-body');
        if (pop && body) body.scrollTop = pop.offsetTop - 10;
    }
    hidePop() { $('#wt-popover').hide(); }

    async _popSave() {
        const id=$('#wt-popover').attr('data-id');
        const aliases = $('#wt-pop-aliases').val().split(',').map(a=>a.trim()).filter(Boolean);
        await this.lm.updateLocation(id,{
            memo:$('#wt-pop-memo').val().trim(),
            status:$('#wt-pop-status').val().trim(),
            aliases: aliases,
        });
        toastSuccess('저장!'); this.pi?.inject(); this.refresh();
    }
    async _popDel() { const id=$('#wt-popover').attr('data-id'); const l=this.lm.locations.find(x=>x.id===id); if(!confirm(`"${l?.name}" 삭제?`))return; await this.lm.deleteLocation(id); this.hidePop(); this.pi?.inject(); this.refresh(); }
    async _popMove() { const id=$('#wt-popover').attr('data-id'); await this.lm.moveTo(id); this.hidePop(); this.pi?.inject(); this.refresh(); }

    // ---- 자동 등록 토스트 (인라인) ----
    showAutoToast(loc) {
        $('#wt-auto-toast').hide(); // 이전 토스트 제거
        $('#wt-at-name').text(loc.name);
        const sim = this._findSim(loc.name);
        const sl = $('#wt-at-sim-list').empty();
        if (sim.length) {
            for (const s of sim) {
                if (s.id === loc.id) continue;
                const btn=$(`<button class="wt-btn-accent wt-btn-s">📎 "${s.name}"에 병합</button>`);
                btn.on('click', async()=>{
                    await this.lm.deleteLocation(loc.id);
                    await this.lm.updateLocation(s.id,{aliases:[...(s.aliases||[]),loc.name]});
                    await this.lm.moveTo(s.id);
                    toastSuccess(`병합!`); this.pi?.inject(); this.refresh(); $('#wt-auto-toast').slideUp(200);
                });
                sl.append(btn);
            }
            $('#wt-at-similar').show();
        } else { $('#wt-at-similar').hide(); }

        // ✅ 추가 (확인) — 토스트만 닫기
        $('#wt-at-ok').off('click').on('click', () => {
            $('#wt-auto-toast').slideUp(200);
        });

        // ✏️ 수정
        $('#wt-at-edit').off('click').on('click', ()=>{
            $('#wt-auto-toast').slideUp(200);
            $('#wt-add-form').slideDown(200); $('#wt-add-arrow').text('▴');
            $('#wt-input-name').val(loc.name).focus();
            this.lm.deleteLocation(loc.id).then(()=>{ this.pi?.inject(); this.refresh(); });
        });

        $('#wt-at-undo').off('click').on('click', async()=>{
            await this.lm.deleteLocation(loc.id);
            this.pi?.inject(); this.refresh(); $('#wt-auto-toast').slideUp(200);
        });

        $('#wt-auto-toast').slideDown(200);
        // 자동 사라짐 없음 — 유저가 버튼 누를 때까지 유지!
    }

    _findSim(name) {
        if(!this.lm.locations.length)return[]; const lo=name.toLowerCase();
        const mg=catGroups.filter(g=>g.some(w=>lo.includes(w))); if(!mg.length)return[];
        const r=[]; for(const loc of this.lm.locations){ const ns=[loc.name.toLowerCase(),...(loc.aliases||[]).map(a=>a.toLowerCase())];
        for(const g of mg){if(ns.some(n=>g.some(w=>n.includes(w)))){r.push(loc);break;}}} return r.slice(0,3);
    }

    // ---- Nominatim 검색 ----
    async _doSearch() {
        const q = $('#wt-search-input').val().trim();
        if (!q || q.length < 2) { $('#wt-search-results').hide(); return; }
        if (!this.leafletRenderer) return;

        const results = await this.leafletRenderer.search(q);
        const list = $('#wt-search-results').empty();
        if (!results.length) { list.html('<div class="wt-search-empty">결과 없음</div>').show(); return; }

        for (const r of results) {
            const item = $(`<div class="wt-search-item"><span class="wt-search-name">${r.name}</span></div>`);
            item.on('click', () => {
                // 지도 이동 + 임시 마커
                this.leafletRenderer.showSearchResult(r.lat, r.lng, r.name);
                $('#wt-search-results').hide();
                // 좌표 없는 장소 중 이름 비슷한 거 있으면 자동 매칭
                const match = this.lm.locations.find(l => !l.lat && l.name.toLowerCase().includes(q.toLowerCase()));
                if (match) {
                    if (confirm(`"${match.name}"에 이 좌표를 배치할까요?`)) {
                        this.lm.updateLocation(match.id, { lat: r.lat, lng: r.lng }).then(() => {
                            this.leafletRenderer.clearSearchMarker();
                            this.leafletRenderer.render();
                            toastSuccess(`📍 ${match.name} 배치!`);
                        });
                    }
                }
            });
            list.append(item);
        }
        list.show();
    }

    // ---- 거리 입력 섹션 ----
    _updDistSection(locId) {
        const others = this.lm.locations.filter(l => l.id !== locId);
        if (!others.length) { $('#wt-pop-dist-section').hide(); return; }
        $('#wt-pop-dist-section').show();

        const list = $('#wt-pop-dist-list').empty();
        const self = this;
        for (const d of this.lm.distances || []) {
            let otherId = d.fromId === locId ? d.toId : d.toId === locId ? d.fromId : null;
            if (!otherId) continue;
            const other = this.lm.locations.find(l => l.id === otherId);
            if (!other) continue;
            const item = $(`<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#5A4030;background:#FAFAF5;padding:4px 8px;border-radius:6px">
                <span style="flex:1">${other.name}</span><span style="color:#9A8A7A">${d.distanceText||'—'}</span>
                <button class="wt-btn-icon" style="font-size:12px;padding:2px 4px;color:#F5A8A8" data-did="${d.id}">✕</button>
            </div>`);
            item.find('button').on('click', function() {
                const did = $(this).attr('data-did');
                const idx = self.lm.distances.findIndex(x => x.id === did);
                if (idx >= 0) self.lm.distances.splice(idx, 1);
                $(this).closest('div').remove();
                self.pi?.inject();
                toastSuccess('📏 거리 삭제!');
            });
            list.append(item);
        }

        const sel = $('#wt-pop-dist-target').empty();
        for (const o of others) {
            const existing = (this.lm.distances || []).find(d =>
                (d.fromId === locId && d.toId === o.id) || (d.toId === locId && d.fromId === o.id));
            if (!existing) sel.append(`<option value="${o.id}">${o.name}</option>`);
        }
        if (!sel.find('option').length) sel.append('<option value="" disabled>모든 장소에 거리 설정됨</option>');
    }

    async _geoSearch() {
        const locId = $('#wt-popover').attr('data-id');
        const query = $('#wt-pop-geo-input').val().trim();
        if (!locId || !query) return;

        const resultsDiv = $('#wt-pop-geo-results').show().html('<div style="padding:4px;color:#9A8A7A">검색 중...</div>');

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&accept-language=ko`;
            const res = await fetch(url, { headers: { 'User-Agent': 'RP-World-Tracker/0.2' } });
            if (!res.ok) { resultsDiv.html('<div style="padding:4px;color:#F5A8A8">검색 실패</div>'); return; }
            const data = await res.json();

            if (!data.length) { resultsDiv.html('<div style="padding:4px;color:#9A8A7A">결과 없음</div>'); return; }

            resultsDiv.empty();
            const self = this;
            for (const r of data.slice(0, 5)) {
                const name = r.display_name.split(',').slice(0, 3).join(', ');
                const item = $(`<div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid #E8E4D8" data-lat="${r.lat}" data-lng="${r.lon}">📍 ${name}</div>`);
                item.on('click', async function() {
                    const lat = parseFloat($(this).attr('data-lat'));
                    const lng = parseFloat($(this).attr('data-lng'));
                    await self.lm.updateLocation(locId, { lat, lng });
                    resultsDiv.hide();
                    toastSuccess(`📍 좌표 저장! (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
                    // Leaflet 모드면 렌더
                    if (self.leafletRenderer?.map) self.leafletRenderer.render();
                });
                resultsDiv.append(item);
            }
        } catch(e) {
            resultsDiv.html('<div style="padding:4px;color:#F5A8A8">검색 오류</div>');
            console.error(`[rp-world-tracker] Geo:`, e);
        }
    }

    async _addDist() {
        const locId = $('#wt-popover').attr('data-id');
        const targetId = $('#wt-pop-dist-target').val();
        const value = $('#wt-pop-dist-value').val().trim();
        const level = parseInt($('#wt-pop-dist-level').val()) || 3;
        if (!locId || !targetId) return;
        const text = value || `거리 ${level}`;

        await this.lm.setDistance(locId, targetId, text, null, level);
        $('#wt-pop-dist-value').val(''); $('#wt-pop-dist-level').val(3); $('#wt-pop-dist-lvl-val').text('3');
        this._updDistSection(locId);
        this.pi?.inject();
        toastSuccess(`📏 거리 저장!`);
    }

    _fmt(ts) { return new Date(ts).toLocaleDateString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
}
