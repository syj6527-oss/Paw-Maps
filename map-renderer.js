// 🗺️ RP World Tracker — map-renderer.js
// SVG 기반 노드 그래프 맵 렌더러

export class MapRenderer {
    constructor(container, locationManager) {
        this.container = container;
        this.lm = locationManager;
        this.svg = null;
        this.dragState = null;
        this._wasDragging = false;
        this.onLocationClick = null;
        this._initSVG();
    }

    _initSVG() {
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'wt-map-svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.setAttribute('viewBox', '0 0 600 500');
        this.container.appendChild(this.svg);

        this.svg.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.svg.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.svg.addEventListener('mouseup', () => this._onMouseUp());
        this.svg.addEventListener('mouseleave', () => this._onMouseUp());
    }

    render() {
        if (!this.svg) return;
        this.svg.innerHTML = '';

        const { locations, movements, currentLocationId } = this.lm;

        // Defs
        this.svg.innerHTML = `
            <defs>
                <filter id="wt-glow"><feGaussianBlur stdDeviation="3" result="b"/>
                    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
            </defs>`;

        // 경로선
        const drawn = new Set();
        for (const m of movements) {
            const from = locations.find(l => l.id === m.fromId);
            const to = locations.find(l => l.id === m.toId);
            if (!from || !to) continue;
            const key = `${m.fromId}-${m.toId}`;
            if (drawn.has(key)) continue;
            drawn.add(key);

            const line = this._svgEl('line', {
                x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: 'wt-path-line',
            });
            this.svg.appendChild(line);
        }

        // 장소 노드
        for (const loc of locations) {
            const g = this._svgEl('g', {
                class: 'wt-location-node', 'data-id': loc.id,
                transform: `translate(${loc.x}, ${loc.y})`,
            });

            const isCurrent = loc.id === currentLocationId;

            // 원
            const circle = this._svgEl('circle', {
                r: isCurrent ? 20 : 15,
                fill: loc.color,
                class: isCurrent ? 'wt-node-circle wt-node-current' : 'wt-node-circle',
                stroke: isCurrent ? '#775537' : '#9e8e7e',
                'stroke-width': isCurrent ? 3 : 1.5,
            });
            if (isCurrent) circle.setAttribute('filter', 'url(#wt-glow)');
            g.appendChild(circle);

            // 방문 횟수
            if (loc.visitCount > 0) {
                g.appendChild(this._svgEl('text', {
                    class: 'wt-visit-badge', y: 4,
                }, loc.visitCount));
            }

            // 이름
            g.appendChild(this._svgEl('text', {
                class: 'wt-location-label', y: isCurrent ? 34 : 30,
            }, loc.name));

            // 현재 위치 발자국
            if (isCurrent) {
                g.appendChild(this._svgEl('text', {
                    class: 'wt-footprint-marker', y: -28,
                }, '👣'));
            }

            g.addEventListener('click', () => {
                if (!this._wasDragging) this.onLocationClick?.(loc.id);
            });

            this.svg.appendChild(g);
        }

        // 빈 상태
        if (locations.length === 0) {
            this.svg.appendChild(this._svgEl('text', {
                x: 300, y: 250, class: 'wt-empty-text',
            }, '장소를 추가하거나 RP를 시작해보세요! 🗺️'));
        }
    }

    // ---- SVG Helper ----

    _svgEl(tag, attrs, text) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
        if (text !== undefined) el.textContent = text;
        return el;
    }

    // ---- Drag ----

    _getPoint(e) {
        const rect = this.svg.getBoundingClientRect();
        const vb = this.svg.viewBox.baseVal;
        return { x: (e.clientX - rect.left) / rect.width * vb.width, y: (e.clientY - rect.top) / rect.height * vb.height };
    }

    _onMouseDown(e) {
        const node = e.target.closest('.wt-location-node');
        if (!node) return;
        const id = node.getAttribute('data-id');
        const pt = this._getPoint(e);
        const loc = this.lm.locations.find(l => l.id === id);
        if (!loc) return;
        this._wasDragging = false;
        this.dragState = { id, startX: pt.x, startY: pt.y, origX: loc.x, origY: loc.y };
    }

    _onMouseMove(e) {
        if (!this.dragState) return;
        const pt = this._getPoint(e);
        const dx = pt.x - this.dragState.startX;
        const dy = pt.y - this.dragState.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._wasDragging = true;

        const loc = this.lm.locations.find(l => l.id === this.dragState.id);
        if (!loc) return;
        loc.x = Math.round(this.dragState.origX + dx);
        loc.y = Math.round(this.dragState.origY + dy);
        this.render();
    }

    async _onMouseUp() {
        if (this.dragState && this._wasDragging) {
            const loc = this.lm.locations.find(l => l.id === this.dragState.id);
            if (loc) await this.lm.updateLocation(loc.id, { x: loc.x, y: loc.y });
        }
        this.dragState = null;
    }
}
