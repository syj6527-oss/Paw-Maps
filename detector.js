// 🗺️ RP World Tracker — detector.js
// AI 응답에서 장소 감지 + 미등록 장소 발견

import { EXTENSION_NAME } from './index.js';

export class LocationDetector {
    constructor(locationManager) {
        this.lm = locationManager;

        // 장소명 뒤 조사+동사 (고신뢰)
        this.suffixPatterns = [
            /(?:으로|로)\s*(?:향하|가|갔|걸어|이동|달려|뛰어|들어|나서|떠나|돌아|출발)/,
            /에\s*(?:도착|당도|다다|들어서|들어섰|왔다|갔다)/,
            /에\s*(?:발을\s*(?:들여|내딛))/,
            /에서\s*(?:나와|나왔|나서|나섰|벗어나)/,
            /(?:을|를)\s*(?:나서|나섰|떠나|떠났|빠져나)/,
            /까지\s*(?:걸어|달려|이동|갔|왔|도착)/,
        ];

        // 현재 위치 접미사
        this.presenceSuffix = [
            /\s*문간/, /\s*입구/, /\s*앞에/, /\s*안에/,
            /에\s*(?:서 있|앉아|앉았|기대|서서)/,
            /에서\s*(?:앉|서|기다|머무)/,
        ];

        // 이동 키워드 (같은 문단)
        this.moveKw = [
            '향했', '향해', '걸어갔', '걸어간', '걸어가', '걸음을 옮', '성큼성큼',
            '도착했', '도착한', '이동했', '들어갔', '들어간', '들어서', '들어섰',
            '나왔', '나섰', '떠났', '돌아왔', '돌아간', '돌아오',
            '찾아갔', '찾아왔', '달려갔', '뛰어갔', '올라갔', '내려갔', '내려왔',
            '건너갔', '다가갔', '문을 열', '문을 밀', '자리를 떠', '자리에서 일어',
            'headed to', 'walked to', 'went to', 'arrived at', 'entered',
            'moved to', 'returned to', 'reached', 'walked into',
        ];

        // 현재 위치 키워드
        this.presentKw = [
            '에서 앉', '에서 서 있', '에 앉아', '에 서서', '안에 있', '안에서',
            '앞에 서', '문간에', '입구에',
        ];

        // 미래/제안 표현 (이동으로 처리 안 함)
        this.futureKw = [
            '갈래', '갈까', '가자', '가볼까', '어때', '가고 싶', '가보자',
            '갈 거', '갈게', '가줄', '가는 게',
            'shall we', 'let\'s go', 'want to go', 'how about',
        ];

        // 미등록 장소 추출용 패턴
        this.newPlacePatterns = [
            /(.{2,10})(?:으로|로)\s*(?:향했|갔다|걸어갔|이동했|달려갔|들어갔|돌아왔|출발)/,
            /(.{2,10})에\s*(?:도착했|당도했|들어섰)/,
            /(.{2,10})(?:을|를)\s*(?:나서|나섰|떠났)/,
        ];
    }

    /**
     * 등록된 장소 감지
     */
    detect(text) {
        if (!text || this.lm.locations.length === 0) return null;

        const clean = this._strip(text);

        // 미래/제안 표현 체크 — 전체 텍스트에 있으면 신뢰도 낮춤
        const hasFuture = this.futureKw.some(kw => clean.includes(kw));

        let best = null;

        for (const loc of this.lm.locations) {
            const names = [loc.name, ...(loc.aliases || [])];
            for (const name of names) {
                if (!name || name.length < 2) continue;
                const matches = this._findAll(clean, name);
                if (matches.length === 0) continue;

                for (const idx of matches) {
                    const inDialog = this._inDialog(clean, idx);
                    const after = clean.substring(idx + name.length, idx + name.length + 40);
                    const para = this._getPara(clean, idx);

                    // 1: 접미사 이동 패턴
                    if (!inDialog && this.suffixPatterns.some(p => p.test(after))) {
                        if (!hasFuture) {
                            const c = 0.95;
                            if (!best || c > best.confidence) best = { location: loc, type: 'move', confidence: c };
                        }
                        continue;
                    }

                    // 2: 접미사 현재 위치
                    if (!inDialog && this.presenceSuffix.some(p => p.test(after))) {
                        const c = 0.7;
                        if (!best || c > best.confidence) best = { location: loc, type: 'present', confidence: c };
                        continue;
                    }

                    // 3: 같은 문단 이동 키워드
                    if (this.moveKw.some(kw => para.includes(kw)) && !hasFuture) {
                        const c = inDialog ? 0.6 : 0.85;
                        if (!best || c > best.confidence) best = { location: loc, type: 'move', confidence: c };
                        continue;
                    }

                    // 4: 현재 위치 키워드
                    if (this.presentKw.some(kw => para.includes(kw))) {
                        const c = inDialog ? 0.4 : 0.6;
                        if (!best || c > best.confidence) best = { location: loc, type: 'present', confidence: c };
                        continue;
                    }

                    // 5: 짧은 대사 속 장소명 = 목적지
                    if (inDialog) {
                        const dl = this._getDialog(clean, idx);
                        if (dl && dl.trim().length < name.length + 15 && !hasFuture) {
                            const c = 0.55;
                            if (!best || c > best.confidence) best = { location: loc, type: 'move', confidence: c };
                        }
                    }
                }
            }
        }

        if (best && (best.type === 'move' || best.type === 'present')) return best;
        return null;
    }

    /**
     * 미등록 장소 발견 시도
     * @returns {string|null} 발견된 장소명 후보
     */
    detectNewPlace(text) {
        if (!text) return null;
        const clean = this._strip(text);

        // 미래 표현이면 스킵
        if (this.futureKw.some(kw => clean.includes(kw))) return null;

        // 서술문만 (대사 제거)
        const narrative = clean
            .replace(/"[^"]*"/g, ' ')
            .replace(/「[^」]*」/g, ' ')
            .replace(/"[^"]*"/g, ' ');

        for (const pattern of this.newPlacePatterns) {
            const match = narrative.match(pattern);
            if (match && match[1]) {
                let candidate = match[1].trim();
                // 불필요한 접두사 제거
                candidate = candidate.replace(/^[,.\s그리고그러나하지만그래서]+/, '').trim();
                if (candidate.length < 2 || candidate.length > 10) continue;
                // 이미 등록된 장소면 스킵
                if (this.lm.findByName(candidate)) continue;
                // 일반 단어 필터 (대명사, 접속사 등)
                const skipWords = ['그곳', '여기', '저기', '거기', '이곳', '저곳', '그녀', '그는', '그가', '나는'];
                if (skipWords.includes(candidate)) continue;

                console.log(`[${EXTENSION_NAME}] New place candidate: "${candidate}"`);
                return candidate;
            }
        }
        return null;
    }

    // ---- Helpers ----

    _strip(t) {
        return t.replace(/<[^>]+>/g, '').replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').replace(/_{1,2}([^_]+)_{1,2}/g, '$1');
    }

    _findAll(text, name) {
        const r = []; let p = 0;
        while (true) { const i = text.indexOf(name, p); if (i === -1) break; r.push(i); p = i + 1; }
        return r;
    }

    _inDialog(text, pos) {
        const before = text.substring(0, pos);
        for (const [o, c] of [['"', '"'], ['"', '"'], ['「', '」']]) {
            const lo = before.lastIndexOf(o);
            if (lo === -1) continue;
            if (lo > before.lastIndexOf(c)) return true;
        }
        return false;
    }

    _getDialog(text, pos) {
        for (const [o, c] of [['"', '"'], ['"', '"'], ['「', '」']]) {
            const start = text.lastIndexOf(o, pos);
            if (start === -1) continue;
            const end = text.indexOf(c, start + 1);
            if (end === -1 || end < pos) continue;
            return text.substring(start + 1, end);
        }
        return null;
    }

    _getPara(text, pos) {
        const b = text.substring(Math.max(0, pos - 200), pos);
        const a = text.substring(pos, Math.min(text.length, pos + 200));
        const ps = Math.max(b.lastIndexOf('\n'), 0);
        const pe = a.indexOf('\n');
        return b.substring(ps) + (pe !== -1 ? a.substring(0, pe) : a);
    }
}
