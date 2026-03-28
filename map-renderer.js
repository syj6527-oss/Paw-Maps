// 🗺️ RP World Tracker — map-renderer.js

export class MapRenderer {
    constructor(container, lm) {
        this.container = container;
        this.lm = lm;
        this.svg = null;
        this.dragState = null;
        this._wasDrag = false;
        this.onLocationClick = null;
        this._init();
    }

    _init() {
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'wt-map-svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.setAttribute('viewBox', '0 0 600 500');
        this.container.appendChild(this.svg);
        this.svg.addEventListener('mousedown', e => this._down(e));
        this.svg.addEventListener('mousemove', e => this._move(e));
        this.svg.addEventListener('mouseup', () => this._up());
        this.svg.addEventListener('mouseleave', () => this._up());
        // Touch support for mobile
        this.svg.addEventListener('touchstart', e => this._down(e.touches[0]), { passive: true });
        this.svg.addEventListener('touchmove', e => this._move(e.touches[0]), { passive: true });
        this.svg.addEventListener('touchend', () => this._up());
    }

    render() {
        if (!this.svg) return;
        this.svg.innerHTML = '';
        const { locations, movements, userLocationId, charLocationId, currentLocationId } = this.lm;

        this.svg.innerHTML = `<defs>
            <filter id="wt-glow"><feGaussianBlur stdDeviation="3" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter></defs>`;

        // 경로선
        const drawn = new Set();
        for (const m of movements) {
            const f = locations.find(l => l.id === m.fromId);
            const t = locations.find(l => l.id === m.toId);
            if (!f || !t) continue;
            const k = `${m.fromId}-${m.toId}`;
            if (drawn.has(k)) continue; drawn.add(k);
            this.svg.appendChild(this._el('line', { x1: f.x, y1: f.y, x2: t.x, y2: t.y, class: 'wt-path-line' }));
        }

        // 노드
        for (const loc of locations) {
            const isUser = loc.id === userLocationId;
            const isChar = loc.id === charLocationId;
            const isCurrent = loc.id === currentLocationId;
            const isActive = isUser || isChar || isCurrent;

            const g = this._el('g', {
                class: 'wt-location-node', 'data-id': loc.id,
                transform: `translate(${loc.x}, ${loc.y})`,
            });

            const circle = this._el('circle', {
                r: isActive ? 20 : 15, fill: loc.color,
                class: isActive ? 'wt-node-circle wt-node-current' : 'wt-node-circle',
                stroke: isActive ? '#775537' : '#9e8e7e', 'stroke-width': isActive ? 3 : 1.5,
            });
            if (isActive) circle.setAttribute('filter', 'url(#wt-glow)');
            g.appendChild(circle);

            if (loc.visitCount > 0)
                g.appendChild(this._el('text', { class: 'wt-visit-badge', y: 4 }, loc.visitCount));

            g.appendChild(this._el('text', { class: 'wt-location-label', y: isActive ? 34 : 30 }, loc.name));

            // 듀얼 마커
            if (isUser && isChar) {
                g.appendChild(this._el('text', { class: 'wt-footprint-marker', y: -28, x: -10 }, '👤'));
                g.appendChild(this._el('text', { class: 'wt-footprint-marker', y: -28, x: 10 }, '🎭'));
            } else if (isUser) {
                g.appendChild(this._el('text', { class: 'wt-footprint-marker', y: -28 }, '👤'));
            } else if (isChar) {
                g.appendChild(this._el('text', { class: 'wt-footprint-marker', y: -28 }, '🎭'));
            } else if (isCurrent) {
                g.appendChild(this._el('text', { class: 'wt-footprint-marker', y: -28 }, '👣'));
            }

            g.addEventListener('click', () => { if (!this._wasDrag) this.onLocationClick?.(loc.id); });
            this.svg.appendChild(g);
        }

        if (locations.length === 0)
            this.svg.appendChild(this._el('text', { x: 300, y: 250, class: 'wt-empty-text' }, 'RP를 시작해보세요! 🗺️'));
    }

    _el(tag, attrs, text) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
        if (text !== undefined) el.textContent = text;
        return el;
    }

    _pt(e) {
        const r = this.svg.getBoundingClientRect();
        const vb = this.svg.viewBox.baseVal;
        return { x: (e.clientX - r.left) / r.width * vb.width, y: (e.clientY - r.top) / r.height * vb.height };
    }

    _down(e) {
        const node = e.target?.closest?.('.wt-location-node');
        if (!node) return;
        const id = node.getAttribute('data-id');
        const pt = this._pt(e);
        const loc = this.lm.locations.find(l => l.id === id);
        if (!loc) return;
        this._wasDrag = false;
        this.dragState = { id, sx: pt.x, sy: pt.y, ox: loc.x, oy: loc.y };
    }

    _move(e) {
        if (!this.dragState) return;
        const pt = this._pt(e);
        const dx = pt.x - this.dragState.sx, dy = pt.y - this.dragState.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._wasDrag = true;
        const loc = this.lm.locations.find(l => l.id === this.dragState.id);
        if (!loc) return;
        loc.x = Math.round(this.dragState.ox + dx);
        loc.y = Math.round(this.dragState.oy + dy);
        this.render();
    }

    async _up() {
        if (this.dragState && this._wasDrag) {
            const loc = this.lm.locations.find(l => l.id === this.dragState.id);
            if (loc) await this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
        }
        this.dragState = null;
    }
}
