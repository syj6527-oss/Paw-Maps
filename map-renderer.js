// 🗺️ RP World Tracker — map-renderer.js (Zoom + Pan + Touch)

export class MapRenderer {
    constructor(container, lm) {
        this.container = container; this.lm = lm;
        this.svg = null; this.dragState = null; this._wasDrag = false;
        this.onLocationClick = null;
        // ViewBox state for zoom/pan
        this.vb = { x: 0, y: 0, w: 600, h: 500 };
        this._pinch = null; this._pan = null;
        this._init();
    }

    _init() {
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'wt-map-svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this._applyVB();
        this.container.appendChild(this.svg);

        // Mouse
        this.svg.addEventListener('mousedown', e => this._onDown(e));
        this.svg.addEventListener('mousemove', e => this._onMove(e));
        this.svg.addEventListener('mouseup', () => this._onUp());
        this.svg.addEventListener('mouseleave', () => this._onUp());
        // Mouse wheel zoom
        this.svg.addEventListener('wheel', e => { e.preventDefault(); this._zoom(e.deltaY > 0 ? 1.1 : 0.9, e); }, { passive: false });

        // Touch
        this.svg.addEventListener('touchstart', e => this._touchStart(e), { passive: false });
        this.svg.addEventListener('touchmove', e => this._touchMove(e), { passive: false });
        this.svg.addEventListener('touchend', e => this._touchEnd(e));
    }

    _applyVB() { this.svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`); }

    // ========== Render ==========
    render() {
        if (!this.svg) return;
        this.svg.innerHTML = '<defs><filter id="wt-glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
        const { locations, movements, currentLocationId } = this.lm;

        const drawn = new Set();
        for (const m of movements) {
            const f = locations.find(l => l.id === m.fromId), t = locations.find(l => l.id === m.toId);
            if (!f || !t) continue;
            const k = [m.fromId, m.toId].sort().join('-'); if (drawn.has(k)) continue; drawn.add(k);
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, class: 'wt-path-line' }));
        }

        for (const loc of locations) {
            const cur = loc.id === currentLocationId;
            const g = this._el('g', { class: 'wt-location-node', 'data-id': loc.id, transform: `translate(${loc.x},${loc.y})` });
            g.appendChild(this._el('circle', {
                r: cur ? 20 : 15, fill: loc.color,
                class: cur ? 'wt-node-circle wt-node-current' : 'wt-node-circle',
                stroke: cur ? '#775537' : '#9e8e7e', 'stroke-width': cur ? 3 : 1.5,
                ...(cur ? { filter: 'url(#wt-glow)' } : {}),
            }));
            if (loc.visitCount > 0) g.appendChild(this._el('text', { class: 'wt-visit-badge', y: 4 }, loc.visitCount));
            g.appendChild(this._el('text', { class: 'wt-location-label', y: cur ? 34 : 30 }, loc.name));
            if (cur) g.appendChild(this._el('text', { class: 'wt-footprint-marker', y: -28 }, '👣'));
            this.svg.appendChild(g);
        }

        if (!locations.length) this.svg.appendChild(this._el('text', { x: 300, y: 250, class: 'wt-empty-text' }, 'RP를 시작해보세요! 🗺️'));
    }

    // ========== Touch Handling ==========
    _touchStart(e) {
        if (e.touches.length === 2) {
            // 핀치 줌 시작
            e.preventDefault();
            this._pinch = this._pinchDist(e);
            this._pan = null; this.dragState = null;
            return;
        }
        if (e.touches.length === 1) {
            const t = e.touches[0];
            const pt = this._svgPt(t);
            const hitId = this._hitTest(pt);
            this._touchInfo = { x: t.clientX, y: t.clientY, time: Date.now(), nodeId: hitId, pt };
            this._wasDrag = false;

            if (hitId) {
                // 노드 드래그 시작
                e.preventDefault();
                const loc = this.lm.locations.find(l => l.id === hitId);
                if (loc) this.dragState = { id: hitId, sx: pt.x, sy: pt.y, ox: loc.x, oy: loc.y };
            } else {
                // 맵 팬 시작
                this._pan = { sx: t.clientX, sy: t.clientY, vx: this.vb.x, vy: this.vb.y };
            }
        }
    }

    _touchMove(e) {
        if (e.touches.length === 2 && this._pinch) {
            // 핀치 줌
            e.preventDefault();
            const dist = this._pinchDist(e);
            const scale = this._pinch / dist;
            const cx = this.vb.x + this.vb.w / 2, cy = this.vb.y + this.vb.h / 2;
            const nw = Math.max(200, Math.min(1200, this.vb.w * scale));
            const nh = nw * (500 / 600);
            this.vb = { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
            this._applyVB();
            this._pinch = dist;
            return;
        }
        if (e.touches.length === 1) {
            const t = e.touches[0];
            if (this.dragState) {
                // 노드 드래그
                e.preventDefault();
                const pt = this._svgPt(t);
                const dx = pt.x - this.dragState.sx, dy = pt.y - this.dragState.sy;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._wasDrag = true;
                const loc = this.lm.locations.find(l => l.id === this.dragState.id);
                if (loc) { loc.x = Math.round(this.dragState.ox + dx); loc.y = Math.round(this.dragState.oy + dy); this.render(); }
            } else if (this._pan) {
                // 맵 팬
                e.preventDefault();
                const dx = (t.clientX - this._pan.sx) * (this.vb.w / this.svg.getBoundingClientRect().width);
                const dy = (t.clientY - this._pan.sy) * (this.vb.h / this.svg.getBoundingClientRect().height);
                this.vb.x = this._pan.vx - dx;
                this.vb.y = this._pan.vy - dy;
                this._applyVB();
                this._wasDrag = true;
            }
        }
    }

    _touchEnd(e) {
        if (this._touchInfo && !this._wasDrag && this._touchInfo.nodeId) {
            const dt = Date.now() - this._touchInfo.time;
            if (dt < 400) this.onLocationClick?.(this._touchInfo.nodeId);
        }
        if (this.dragState && this._wasDrag) {
            const loc = this.lm.locations.find(l => l.id === this.dragState.id);
            if (loc) this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
        }
        this.dragState = null; this._pinch = null; this._pan = null; this._touchInfo = null;
    }

    // ========== Mouse Handling ==========
    _onDown(e) {
        const pt = this._svgPt(e);
        const hitId = this._hitTest(pt);
        this._wasDrag = false;
        if (hitId) {
            const loc = this.lm.locations.find(l => l.id === hitId);
            if (loc) this.dragState = { id: hitId, sx: pt.x, sy: pt.y, ox: loc.x, oy: loc.y };
        } else {
            this._pan = { sx: e.clientX, sy: e.clientY, vx: this.vb.x, vy: this.vb.y };
        }
    }

    _onMove(e) {
        if (this.dragState) {
            const pt = this._svgPt(e);
            const dx = pt.x - this.dragState.sx, dy = pt.y - this.dragState.sy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._wasDrag = true;
            const loc = this.lm.locations.find(l => l.id === this.dragState.id);
            if (loc) { loc.x = Math.round(this.dragState.ox + dx); loc.y = Math.round(this.dragState.oy + dy); this.render(); }
        } else if (this._pan) {
            const dx = (e.clientX - this._pan.sx) * (this.vb.w / this.svg.getBoundingClientRect().width);
            const dy = (e.clientY - this._pan.sy) * (this.vb.h / this.svg.getBoundingClientRect().height);
            this.vb.x = this._pan.vx - dx; this.vb.y = this._pan.vy - dy;
            this._applyVB(); this._wasDrag = true;
        }
    }

    _onUp() {
        if (this.dragState && this._wasDrag) {
            const loc = this.lm.locations.find(l => l.id === this.dragState.id);
            if (loc) this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
        }
        if (!this._wasDrag && !this.dragState && !this._pan) {
            // click on empty space — do nothing
        }
        this.dragState = null; this._pan = null;
    }

    _zoom(factor, e) {
        const rect = this.svg.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width, my = (e.clientY - rect.top) / rect.height;
        const nw = Math.max(200, Math.min(1200, this.vb.w * factor));
        const nh = nw * (500 / 600);
        this.vb.x += (this.vb.w - nw) * mx;
        this.vb.y += (this.vb.h - nh) * my;
        this.vb.w = nw; this.vb.h = nh;
        this._applyVB();
    }

    // ========== Helpers ==========
    _el(tag, attrs, text) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
        if (text !== undefined) el.textContent = text; return el;
    }

    _svgPt(e) {
        const r = this.svg.getBoundingClientRect();
        return { x: this.vb.x + (e.clientX - r.left) / r.width * this.vb.w, y: this.vb.y + (e.clientY - r.top) / r.height * this.vb.h };
    }

    _hitTest(pt) {
        for (const loc of this.lm.locations) {
            const dx = pt.x - loc.x, dy = pt.y - loc.y;
            if (Math.sqrt(dx * dx + dy * dy) < 30) return loc.id;
        }
        return null;
    }

    _pinchDist(e) {
        const a = e.touches[0], b = e.touches[1];
        return Math.sqrt((a.clientX - b.clientX) ** 2 + (a.clientY - b.clientY) ** 2);
    }
}
