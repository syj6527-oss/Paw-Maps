// 🗺️ RP World Tracker — ui-manager.js (Inline Toast + Popover)

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { EXTENSION_NAME, toast, toastWarn, toastSuccess } from './index.js';
import { MapRenderer } from './map-renderer.js';

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
    constructor(lm, pi) { this.lm=lm; this.pi=pi; this.mapRenderer=null; this.panelVisible=false; }

    createSettingsPanel() {
        const html = `<div id="wt-settings" class="wt-settings"><div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🗺️ RP World Tracker <span class="wt-version">v0.2.0</span></b>
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
                <div class="wt-s-row"><button id="wt-open-panel" class="menu_button wt-open-btn">🗺️ 월드 맵</button></div>
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
        $('#wt-open-panel').on('click', () => this.togglePanel());
        // 🔧 비밀 디버그: 💭 5번 탭
        let _t=0, _tm=null;
        $(document).on('click','#wt-secret', e => { e.stopPropagation(); _t++; clearTimeout(_tm);
            if(_t>=5){_t=0;s.debugMode=!s.debugMode;saveSettingsDebounced();toast(s.debugMode?'🔧 Debug ON':'🔧 Debug OFF','🗺️',{timeOut:2000});}
            _tm=setTimeout(()=>{_t=0},2000);
        });
    }

    registerWandButton() {
        try { const b=document.createElement('div'); b.id='wt-wand-btn'; b.className='list-group-item flex-container flexGap5';
            b.innerHTML='<span>🗺️</span> World Tracker'; b.addEventListener('click',()=>this.togglePanel());
            const m=document.getElementById('extensionsMenu'); if(m)m.appendChild(b); } catch(e){}
    }

    createSidePanel() {
        const html = `
        <div id="wt-panel" class="wt-panel">
            <div class="wt-panel-header">
                <div class="wt-panel-title"><span>🗺️</span> World Tracker</div>
                <button id="wt-panel-close" class="wt-btn-icon">✕</button>
            </div>
            <div class="wt-panel-body" id="wt-panel-body">
                <!-- 자동 등록 알림 (인라인!) -->
                <div id="wt-auto-toast" class="wt-auto-toast" style="display:none">
                    <div class="wt-at-row"><span>🗺️</span><strong id="wt-at-name"></strong><span>등록됨!</span></div>
                    <div id="wt-at-similar" style="display:none">
                        <div class="wt-at-sim-label">혹시 같은 장소?</div>
                        <div id="wt-at-sim-list"></div>
                    </div>
                    <div class="wt-at-actions">
                        <button id="wt-at-edit" class="wt-btn-primary wt-btn-s">✏️ 수정</button>
                        <button id="wt-at-undo" class="wt-btn-danger wt-btn-s">↩️ 취소</button>
                    </div>
                </div>

                <div class="wt-opacity-row"><span>🔮</span><input type="range" id="wt-opacity" min="30" max="100" value="100"/><span id="wt-op-val">100%</span></div>

                <div class="wt-map-toggle" id="wt-map-toggle">🗺️ 지도 ▾</div>
                <div id="wt-map-wrap"><div id="wt-map-container" class="wt-map-container"></div></div>

                <!-- 팝오버 (인라인!) -->
                <div id="wt-popover" class="wt-popover-inline" style="display:none">
                    <div class="wt-pop-header"><span id="wt-pop-title"></span><button id="wt-pop-close" class="wt-btn-icon">✕</button></div>
                    <div class="wt-pop-body">
                        <div class="wt-pop-stats">
                            <div><span class="wt-stat-l">방문</span><span id="wt-pop-visits">0</span>회</div>
                            <div><span class="wt-stat-l">첫</span><span id="wt-pop-first">—</span></div>
                            <div><span class="wt-stat-l">최근</span><span id="wt-pop-last">—</span></div>
                        </div>
                        <textarea id="wt-pop-memo" class="wt-input wt-textarea" placeholder="메모..." rows="2"></textarea>
                        <input type="text" id="wt-pop-status" class="wt-input" placeholder="상태 (붐빔, 한산...)"/>
                        <div class="wt-pop-actions"><button id="wt-pop-save" class="wt-btn-primary">💾 저장</button><button id="wt-pop-del" class="wt-btn-danger">🗑️</button></div>
                        <button id="wt-pop-move" class="wt-btn-ghost wt-btn-sm">📍 위치 수정</button>
                    </div>
                </div>

                <div class="wt-scene-loc">
                    <span class="wt-scene-icon">👣</span>
                    <div class="wt-scene-info"><span class="wt-scene-label">현재 씬</span><span id="wt-scene-name" class="wt-scene-name">—</span></div>
                </div>

                <div class="wt-add-toggle" id="wt-add-toggle">✚ 장소 추가 <span id="wt-add-arrow">▾</span></div>
                <div class="wt-add-form" id="wt-add-form" style="display:none">
                    <input type="text" id="wt-input-name" class="wt-input" placeholder="장소 이름"/>
                    <input type="text" id="wt-input-aliases" class="wt-input" placeholder="별칭 (쉼표)"/>
                    <button id="wt-btn-add" class="wt-btn-primary">✚ 추가</button>
                </div>

                <div class="wt-section-title"><span>장소 목록</span><span id="wt-loc-count" class="wt-badge">0</span></div>
                <div id="wt-loc-list" class="wt-loc-list"></div>
                <div class="wt-section-title"><span>🚶 이동 히스토리</span></div>
                <div id="wt-move-list" class="wt-move-list"></div>
            </div>
        </div>`;
        $('body').append(html);
        this._bind();
    }

    _bind() {
        $('#wt-panel-close').on('click', () => this.togglePanel(false));
        $('#wt-map-toggle').on('click', () => { $('#wt-map-wrap').slideToggle(200); const t=$('#wt-map-toggle').text(); $('#wt-map-toggle').text(t.includes('▾')?'🗺️ 지도 ▴':'🗺️ 지도 ▾'); });
        $('#wt-add-toggle').on('click', () => { $('#wt-add-form').slideToggle(200); const a=$('#wt-add-arrow'); a.text(a.text()==='▾'?'▴':'▾'); });
        $('#wt-btn-add').on('click', () => this._addLoc());
        $('#wt-input-name').on('keydown', e => { if(e.key==='Enter') this._addLoc(); });
        $('#wt-pop-close').on('click', () => this.hidePop());
        $('#wt-pop-save').on('click', () => this._popSave());
        $('#wt-pop-del').on('click', () => this._popDel());
        $('#wt-pop-move').on('click', () => this._popMove());
        $('#wt-opacity').on('input', function(){ const v=$(this).val(); $('#wt-op-val').text(v+'%'); $('#wt-panel').css('opacity',v/100); extension_settings[EXTENSION_NAME].panelOpacity=+v; saveSettingsDebounced(); });
        const op = extension_settings[EXTENSION_NAME]?.panelOpacity ?? 100;
        $('#wt-opacity').val(op); $('#wt-op-val').text(op+'%');
    }

    togglePanel(show) {
        this.panelVisible = show ?? !this.panelVisible;
        if (this.panelVisible) { $('#wt-panel').addClass('wt-panel-open').css('opacity',(extension_settings[EXTENSION_NAME]?.panelOpacity??100)/100); this.refresh(); }
        else { $('#wt-panel').removeClass('wt-panel-open'); this.hidePop(); }
    }

    async refresh() {
        await this.lm.loadChat();
        if (!this.mapRenderer) { this.mapRenderer = new MapRenderer(document.querySelector('#wt-map-container'), this.lm); this.mapRenderer.onLocationClick = id => this.showPop(id); }
        this.mapRenderer.render();
        const cur = this.lm.locations.find(l => l.id === this.lm.currentLocationId);
        $('#wt-scene-name').text(cur?.name || '—').css('color', cur?.color || '');
        const s = extension_settings[EXTENSION_NAME];
        if (s?.aiInjection && this.pi) { const t=this.pi.generate(); if(t){$('#wt-prompt-text').text(t);$('#wt-prompt-preview').slideDown(150);}else{$('#wt-prompt-preview').slideUp(150);} }
        this._updLocList(); this._updMoveList();
    }

    _updLocList() {
        const list=$('#wt-loc-list').empty(); $('#wt-loc-count').text(this.lm.locations.length);
        if (!this.lm.locations.length) { list.html('<div class="wt-empty">RP를 시작하면 장소가 자동 추가돼요!</div>'); return; }
        for (const loc of [...this.lm.locations].sort((a,b)=>(b.visitCount||0)-(a.visitCount||0))) {
            const cur = loc.id === this.lm.currentLocationId;
            const item = $(`<div class="wt-loc-item ${cur?'wt-loc-active':''}" data-id="${loc.id}">
                <div class="wt-loc-dot" style="background:${loc.color}"></div>
                <div class="wt-loc-info"><div class="wt-loc-name">${loc.name}${cur?' 👣':''}</div></div>
                <div class="wt-loc-visits">${loc.visitCount||0}회</div></div>`);
            item.on('click', () => this.showPop(loc.id));
            list.append(item);
        }
    }

    _updMoveList() {
        const list=$('#wt-move-list').empty();
        if (!this.lm.movements.length) { list.html('<div class="wt-empty">아직 이동 기록이 없어요</div>'); return; }
        for (const m of [...this.lm.movements].sort((a,b)=>a.timestamp-b.timestamp).slice(-20)) {
            const f=this.lm.locations.find(l=>l.id===m.fromId), t=this.lm.locations.find(l=>l.id===m.toId);
            if (!f||!t) continue;
            const time=new Date(m.timestamp).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
            list.append(`<div class="wt-mv-item"><span class="wt-mv-time">${time}</span><span class="wt-mv-from">${f.name}</span><span class="wt-mv-arrow">→</span><span class="wt-mv-to">${t.name}</span></div>`);
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
        $('#wt-popover').attr('data-id', id).slideDown(200);
        $('#wt-pop-title').text(l.name); $('#wt-pop-visits').text(l.visitCount||0);
        $('#wt-pop-first').text(l.firstVisited?this._fmt(l.firstVisited):'—');
        $('#wt-pop-last').text(l.lastVisited?this._fmt(l.lastVisited):'—');
        $('#wt-pop-memo').val(l.memo||''); $('#wt-pop-status').val(l.status||'');
        // 스크롤 이동
        setTimeout(()=>{ document.getElementById('wt-popover')?.scrollIntoView({behavior:'smooth',block:'nearest'}); },250);
    }
    hidePop() { $('#wt-popover').slideUp(150); }

    async _popSave() { const id=$('#wt-popover').attr('data-id'); await this.lm.updateLocation(id,{memo:$('#wt-pop-memo').val().trim(),status:$('#wt-pop-status').val().trim()}); toastSuccess('저장!'); this.pi?.inject(); this.refresh(); }
    async _popDel() { const id=$('#wt-popover').attr('data-id'); const l=this.lm.locations.find(x=>x.id===id); if(!confirm(`"${l?.name}" 삭제?`))return; await this.lm.deleteLocation(id); this.hidePop(); this.pi?.inject(); this.refresh(); }
    async _popMove() { const id=$('#wt-popover').attr('data-id'); await this.lm.moveTo(id); this.hidePop(); this.pi?.inject(); this.refresh(); }

    // ---- 자동 등록 토스트 (인라인) ----
    showAutoToast(loc) {
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
        setTimeout(()=>$('#wt-auto-toast').slideUp(200), 8000);
    }

    _findSim(name) {
        if(!this.lm.locations.length)return[]; const lo=name.toLowerCase();
        const mg=catGroups.filter(g=>g.some(w=>lo.includes(w))); if(!mg.length)return[];
        const r=[]; for(const loc of this.lm.locations){ const ns=[loc.name.toLowerCase(),...(loc.aliases||[]).map(a=>a.toLowerCase())];
        for(const g of mg){if(ns.some(n=>g.some(w=>n.includes(w)))){r.push(loc);break;}}} return r.slice(0,3);
    }

    _fmt(ts) { return new Date(ts).toLocaleDateString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
}
