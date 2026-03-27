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

        // 방법 1: [장소]의/에/에서/으로 + 같은 문단에 이동 동사
        const placeParticlePatterns = [
            // "식당의", "카페에", "도서관에서", "교실로"
            /([가-힣]{2,8})(?:의|에서|에|으로|로)\s/g,
        ];

        const paragraphs = narrative.split(/\n+/);
        for (const para of paragraphs) {
            // 문단에 이동 키워드가 있는지 먼저 체크
            const hasMove = this.moveKw.some(kw => para.includes(kw)) ||
                /걸어[가간갔]|돌아[가간왔옴]|들어[가간서섰]|나[서섰왔]|향[하해했]/.test(para);
            if (!hasMove) continue;

            for (const pattern of placeParticlePatterns) {
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(para)) !== null) {
                    let candidate = match[1].trim();
                    // "으로" 조사 분리 보정: "축으" + "로" → "축"으로 클리닝
                    candidate = candidate.replace(/으$/, '');
                    if (this._isValidPlace(candidate)) {
                        console.log(`[${EXTENSION_NAME}] New place candidate (particle): "${candidate}"`);
                        return candidate;
                    }
                }
            }
        }

        // 방법 2: 직접 패턴 — [장소]+이동동사 (과거/현재/진행형 모두)
        const directPatterns = [
            /([가-힣]{2,8})(?:으로|로)\s*(?:향하|가|갔|간다|걸어|이동|달려|뛰어|들어|나서|떠나|돌아|출발)/g,
            /([가-힣]{2,8})에\s*(?:도착|당도|들어서|들어섰|왔다|갔다|간다|온다)/g,
            /([가-힣]{2,8})(?:을|를)\s*(?:나서|나섰|떠나|떠났|빠져나)/g,
            // 1글자 장소 (집으로, 방에 등)
            /([가-힣])(?:으로|로)\s*(?:향하|가|갔|간다|걸어|이동|돌아|출발)/g,
            /([가-힣])에\s*(?:도착|왔다|갔다|간다|들어)/g,
        ];

        for (const pattern of directPatterns) {
            pattern.lastIndex = 0;
            const match = pattern.exec(narrative);
            if (match && match[1]) {
                const candidate = match[1].trim();
                if (this._isValidPlace(candidate)) {
                    console.log(`[${EXTENSION_NAME}] New place candidate (direct): "${candidate}"`);
                    return candidate;
                }
            }
        }

        // 방법 3: 영어 패턴 — 2단계 감지
        // Step A: 이동 동사 + "the" + (형용사 무시) + 장소 명사 추출
        // Step B: 장소성 단어(hall, room, station 등)로 필터

        // 장소성 단어 목록 — 이 단어가 포함되면 장소로 인정
        const placeWords = [
            'hall', 'room', 'house', 'home', 'office', 'station', 'tower', 'castle',
            'church', 'temple', 'shrine', 'school', 'academy', 'university', 'college',
            'library', 'museum', 'hospital', 'clinic', 'shop', 'store', 'market',
            'cafe', 'restaurant', 'bar', 'pub', 'tavern', 'inn', 'hotel',
            'park', 'garden', 'forest', 'beach', 'lake', 'river', 'mountain',
            'street', 'road', 'alley', 'bridge', 'gate', 'plaza', 'square',
            'palace', 'manor', 'mansion', 'apartment', 'building', 'floor',
            'kitchen', 'bedroom', 'bathroom', 'basement', 'attic', 'garage',
            'gym', 'arena', 'stadium', 'court', 'field', 'ground',
            'base', 'camp', 'bunker', 'barracks', 'armory', 'quarters',
            'lab', 'laboratory', 'workshop', 'studio', 'warehouse',
            'prison', 'cell', 'dungeon', 'cave', 'ruins',
            'dock', 'port', 'harbor', 'airport', 'terminal',
            'lounge', 'lobby', 'corridor', 'chamber',
        ];

        // 이동 동사 패턴 (동사 + the/a + ... + 장소 후보)
        const engMoveVerbs = [
            'headed to', 'walked to', 'went to', 'arrived at', 'moved to',
            'returned to', 'ran to', 'rushed to', 'hurried to',
            'entered', 'reached', 'left', 'marched to', 'marches to',
            'stepped into', 'burst into', 'barged into',
            'bang open into', 'open into',
        ];

        // 이동 동사가 문단에 있는지 + "into/inside/toward" 포함
        const hasEngMove = engMoveVerbs.some(v => narrative.toLowerCase().includes(v)) ||
            /\b(?:into|inside|toward|towards)\b/i.test(narrative);

        if (hasEngMove) {
            // 문장 단위로 쪼개서 검색
            const sentences = narrative.split(/[.!?]+/).filter(s => s.trim());
            for (const sent of sentences) {
                const lower = sent.toLowerCase();

                // 이 문장에 이동 표현이 있는지
                const sentHasMove = engMoveVerbs.some(v => lower.includes(v)) ||
                    /\b(?:into|inside|toward|towards)\b/.test(lower);
                if (!sentHasMove) continue;

                // 장소성 단어 찾기 (whole word 매칭)
                for (const pw of placeWords) {
                    const pwRegex = new RegExp('\\b' + pw + '(?:s)?\\b', 'i');
                    const pwMatch = lower.match(pwRegex);
                    if (!pwMatch) continue;
                    const pwIdx = pwMatch.index;

                    // pw 앞쪽에서 장소 전체 이름 추출 (최대 3단어)
                    const beforePw = sent.substring(0, pwIdx).trim();
                    const words = beforePw.split(/\s+/).filter(Boolean);

                    // 실제 매칭된 단어 사용 (barracks 등 복수형 보존)
                    const actualPw = sent.substring(pwIdx, pwIdx + pwMatch[0].length).trim();
                    let placeName = actualPw;
                    const modifiers = words.slice(-2);
                    // 형용사/관사/동사/전치사 제거
                    const skipMods = ['the', 'a', 'an', 'this', 'that', 'its', 'his', 'her', 'their', 'my', 'our',
                        'old', 'new', 'big', 'small', 'dark', 'bright', 'lit', 'large', 'little',
                        'metal', 'wooden', 'stone', 'steel', 'stainless', 'plastic', 'heavy',
                        'entered', 'reached', 'left', 'to', 'at', 'into', 'from', 'of', 'in', 'on',
                        'toward', 'towards', 'inside', 'through', 'open'];
                    const goodMods = modifiers.filter(m =>
                        !skipMods.includes(m.toLowerCase()) &&
                        !m.includes('-') &&
                        m.length > 1
                    );

                    if (goodMods.length > 0) {
                        placeName = goodMods.join(' ') + ' ' + actualPw;
                    }

                    // 첫 글자 대문자
                    placeName = placeName.charAt(0).toUpperCase() + placeName.slice(1);

                    if (placeName.length >= 3 && placeName.length <= 30) {
                        if (!this.lm.findByName(placeName)) {
                            console.log(`[${EXTENSION_NAME}] New place candidate (eng): "${placeName}"`);
                            return placeName;
                        }
                    }
                }
            }
        }

        // 방법 4: 영어 존재/묘사 표현 — 이미 장소 안에 있는 경우
        // "in the mess hall", "the smell of the kitchen", "sitting in the library"
        const engPresencePatterns = [
            /\b(?:in|inside|within|at)\s+(?:the\s+)?(?:[a-z-]+\s+)?/gi,  // "in the fluorescent-lit mess hall"
            /\b(?:of|around)\s+(?:the\s+)?(?:[a-z-]+\s+)?/gi,            // "smell of the mess hall"
        ];

        // 장소성 단어가 텍스트에 하나라도 있으면 존재 감지 시도
        const allSentences = narrative.split(/[.!?]+/).filter(s => s.trim());
        for (const sent of allSentences) {
            const lower = sent.toLowerCase();

            // 이미 이동 감지에서 처리된 문장이면 스킵
            const sentHasMove = engMoveVerbs.some(v => lower.includes(v)) ||
                /\b(?:into|toward|towards)\b/.test(lower);
            if (sentHasMove) continue;

            // 존재 표현이 있는지 — 넓은 범위: "the [place]" 자체도 존재로 판단
            const hasPresence = /\b(?:in|inside|within|at|of|around)\s+(?:the|a)\b/i.test(lower) ||
                /\bthe\s+(?:[a-z-]+\s+)?/.test(lower);
            if (!hasPresence) continue;

            for (const pw of placeWords) {
                const pwRegex = new RegExp('\\b' + pw + '(?:s)?\\b', 'i');
                const pwMatch = lower.match(pwRegex);
                if (!pwMatch) continue;
                const pwIdx = pwMatch.index;

                const beforePw = sent.substring(0, pwIdx).trim();
                const words = beforePw.split(/\s+/).filter(Boolean);
                const actualPw = sent.substring(pwIdx, pwIdx + pwMatch[0].length).trim();
                let placeName = actualPw;
                const modifiers = words.slice(-2);
                const skipMods2 = ['the', 'a', 'an', 'this', 'that', 'its', 'his', 'her', 'their', 'my', 'our',
                    'old', 'new', 'big', 'small', 'dark', 'bright', 'lit', 'large', 'little',
                    'metal', 'wooden', 'stone', 'steel', 'stainless', 'plastic', 'heavy',
                    'in', 'at', 'of', 'on', 'inside', 'within', 'around', 'from', 'through'];
                const goodMods2 = modifiers.filter(m =>
                    !skipMods2.includes(m.toLowerCase()) && !m.includes('-') && m.length > 1
                );
                if (goodMods2.length > 0) placeName = goodMods2.join(' ') + ' ' + actualPw;
                placeName = placeName.charAt(0).toUpperCase() + placeName.slice(1);

                if (placeName.length >= 3 && placeName.length <= 30) {
                    if (!this.lm.findByName(placeName)) {
                        console.log(`[${EXTENSION_NAME}] New place candidate (eng-presence): "${placeName}"`);
                        return placeName;
                    }
                }
            }
        }

        return null;
    }

    /**
     * 장소명 후보 유효성 검사
     */
    _isValidPlace(candidate) {
        if (!candidate) return false;
        // 1글자 장소 허용 목록
        const singleCharPlaces = ['집', '방', '숲', '강', '산', '역', '관', '점', '원', '장'];
        if (candidate.length === 1) return singleCharPlaces.includes(candidate);
        if (candidate.length > 8) return false;
        // 이미 등록된 장소면 스킵
        if (this.lm.findByName(candidate)) return false;
        // 일반 단어 / 대명사 / 관형어 필터
        const skipWords = [
            '그곳', '여기', '저기', '거기', '이곳', '저곳', '어디',
            '그녀', '그는', '그가', '나는', '우리', '너는',
            '자신', '상대', '서로', '모두', '누군',
            '이쪽', '저쪽', '그쪽', '앞쪽', '뒤쪽', '양쪽',
            '한쪽', '바닥', '천장', '벽면', '구석', '가장',
            '순간', '갑자', '아까', '지금', '오늘', '내일',
            '이중문', '출입문', '철문', '나무문', '유리문',
            '계단', '복도', '통로', '모퉁이',
        ];
        if (skipWords.includes(candidate)) return false;
        // 한 글자 받침 없는 단어 제외 (조사 오탐 방지)
        if (candidate.length === 2 && /[을를이가에]$/.test(candidate)) return false;
        return true;
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
