// 🗺️ RP World Tracker — detector.js (All Fixes)

import { EXTENSION_NAME } from './index.js';

export class LocationDetector {
    constructor(lm) {
        this.lm = lm;

        this.suffixPat = [
            /(?:으로|로)\s*(?:향하|가|갔|걸어|이동|달려|뛰어|들어|나서|떠나|돌아|출발)/,
            /에\s*(?:도착|당도|다다|들어서|들어섰|왔다|갔다)/,
            /에서\s*(?:나와|나왔|나서|나섰|벗어나)/,
            /(?:을|를)\s*(?:나서|나섰|떠나|떠났|빠져나)/,
        ];
        this.presSuffix = [/에\s*(?:서 있|앉아|앉았|기대|서서)/, /에서\s*(?:앉|서|기다|머무)/];

        this.moveKw = [
            '향했','향해','걸어갔','걸어간','걸어가','성큼성큼','도착했','도착한','이동했',
            '들어갔','들어간','들어서','들어섰','나왔','나섰','떠났','돌아왔','돌아간','돌아오',
            '찾아갔','찾아왔','달려갔','뛰어갔','올라갔','내려갔','내려왔','건너갔',
            '문을 열','자리를 떠',
            'headed to','walked to','went to','arrived at','entered','moved to',
            'returned to','reached','walked into','headed home','went home','got home','came home',
        ];
        this.presKw = ['에서 앉','에서 서 있','에 앉아','에 서서','안에 있','안에서'];
        this.futureKw = ['갈래','갈까','가자','가볼까','어때','가고 싶','가보자','갈 거','갈게','shall we',"let's go",'want to go','how about'];

        // 경유지 (장소로 안 잡음)
        this.transitKo = ['복도','계단','통로','현관','로비','엘리베이터','에스컬레이터','출입구','입구','출구','문','문앞','문간','현관문','골목','길','건널목','횡단보도','주차장','차도'];
        this.transitEn = ['corridor','hallway','staircase','stairs','stairwell','elevator','escalator','passage','passageway','entrance','exit','doorway','door','gate','sidewalk','pathway','driveway'];

        this.skipKo = [
            ...this.transitKo,
            '그곳','여기','저기','거기','이곳','저곳','어디',
            '그녀','그는','그가','나는','우리','너는',
            '자신','상대','서로','모두','누군',
            '이쪽','저쪽','그쪽','앞쪽','뒤쪽','양쪽','한쪽',
            '바닥','천장','벽면','구석','가장','순간','갑자','아까','지금','오늘','내일',
            '이중문','출입문','철문','나무문','유리문',
        ];
        this.singleKo = ['집','방','숲','강','산','역','관','점','원','장'];

        // 영어 장소 단어 (경유지 제외, mart 추가!)
        this.placeWords = [
            'hall','room','house','home','office','station','tower','castle',
            'church','temple','school','academy','library','museum','hospital',
            'shop','store','market','mart','supermarket','grocery',
            'cafe','restaurant','bar','pub','tavern','inn','hotel',
            'park','garden','forest','beach','lake',
            'plaza','square','palace','manor','mansion','apartment','building',
            'kitchen','bedroom','bathroom','basement','attic','garage',
            'gym','arena','stadium','court','field','ground',
            'base','camp','bunker','barracks','armory','quarters',
            'lab','laboratory','workshop','warehouse','prison','dungeon','cave',
            'dock','port','harbor','airport','terminal',
            'lounge','lobby','chamber','cafeteria','canteen',
        ];

        this.engMoveVerbs = [
            'headed to','walked to','went to','arrived at','moved to',
            'returned to','ran to','rushed to','hurried to',
            'entered','reached','left','marched to',
            'stepped into','burst into','bang open into',
            'headed home','went home','got home','came home',
        ];

        this.skipMods = [
            'the','a','an','this','that','its','his','her','their','my','our',
            'old','new','big','small','dark','bright','lit','large','little',
            'metal','wooden','stone','steel','stainless','plastic','heavy',
            'entered','reached','left','to','at','into','from','of','in','on',
            'toward','towards','inside','through','open',
        ];

        // 인명 호칭 (bug 21)
        this.namePrefix = ['mr','mrs','ms','miss','dr','captain','colonel','sergeant','general','professor','officer','sir','madam','lady','lord'];

        // placeWord 뒤에 이게 오면 장소 아님 (bug 18: "apartment door lock")
        this.notPlaceSuffix = ['door','key','wall','window','floor','lock','roof','ceiling','gate','sign','number','building','complex'];
    }

    // ========== 등록된 장소 감지 (case-insensitive!) ==========
    detect(text) {
        if (!text || this.lm.locations.length === 0) return null;
        const clean = this._strip(text).toLowerCase(); // 소문자로!
        const hasFut = this.futureKw.some(k => clean.includes(k));
        let best = null;

        for (const loc of this.lm.locations) {
            for (const name of [loc.name, ...(loc.aliases || [])]) {
                if (!name || name.length < 1) continue;
                const nameLo = name.toLowerCase();
                for (const idx of this._findAll(clean, nameLo)) {
                    const inDlg = this._inDlg(clean, idx);
                    const after = clean.substring(idx + nameLo.length, idx + nameLo.length + 40);
                    const para = this._para(clean, idx);

                    if (!inDlg && this.suffixPat.some(p => p.test(after)) && !hasFut) {
                        const c = 0.95; if (!best || c > best.confidence) best = { location: loc, type: 'move', confidence: c }; continue;
                    }
                    if (!inDlg && this.presSuffix.some(p => p.test(after))) {
                        const c = 0.7; if (!best || c > best.confidence) best = { location: loc, type: 'present', confidence: c }; continue;
                    }
                    if (this.moveKw.some(k => para.includes(k)) && !hasFut) {
                        const c = inDlg ? 0.6 : 0.85; if (!best || c > best.confidence) best = { location: loc, type: 'move', confidence: c }; continue;
                    }
                    if (this.presKw.some(k => para.includes(k))) {
                        const c = inDlg ? 0.4 : 0.6; if (!best || c > best.confidence) best = { location: loc, type: 'present', confidence: c }; continue;
                    }
                    if (inDlg) {
                        const dl = this._getDlg(clean, idx);
                        if (dl && dl.trim().length < nameLo.length + 15 && !hasFut) {
                            const c = 0.55; if (!best || c > best.confidence) best = { location: loc, type: 'move', confidence: c };
                        }
                    }
                }
            }
        }
        return (best && (best.type === 'move' || best.type === 'present')) ? best : null;
    }

    // ========== 미등록 장소 발견 ==========
    detectNewPlace(text) {
        if (!text) return null;
        const clean = this._strip(text);
        if (this.futureKw.some(k => clean.toLowerCase().includes(k))) return null;
        const nar = clean.replace(/"[^"]*"/g,' ').replace(/「[^」]*」/g,' ').replace(/"[^"]*"/g,' ');

        // 한국어 방법 1: 조사 패턴
        const pPat = /([가-힣]{2,8})(?:의|에서|에|으로|로)\s/g;
        const moveRx = /걸어[가간갔]|돌아[가간왔옴]|들어[가간서섰]|나[서섰왔]|향[하해했]/;
        for (const para of nar.split(/\n+/)) {
            const hasM = this.moveKw.some(k => para.includes(k)) || moveRx.test(para);
            if (!hasM) continue;
            pPat.lastIndex = 0; let m;
            while ((m = pPat.exec(para)) !== null) {
                let c = m[1].trim().replace(/으$/, '');
                if (this._validKo(c)) { console.log(`[${EXTENSION_NAME}] 🆕 (ko): "${c}"`); return c; }
            }
        }

        // 한국어 방법 2: 직접 패턴
        const dPat = [
            /([가-힣]{2,8})(?:으로|로)\s*(?:향하|가|갔|간다|걸어|이동|달려|돌아|출발)/g,
            /([가-힣]{2,8})에\s*(?:도착|당도|들어서|들어섰|왔다|갔다|간다)/g,
            /([가-힣]{2,8})(?:을|를)\s*(?:나서|나섰|떠나|떠났)/g,
            /([가-힣])(?:으로|로)\s*(?:향하|가|갔|간다|걸어|이동|돌아|출발)/g,
            /([가-힣])에\s*(?:도착|왔다|갔다|간다|들어)/g,
        ];
        for (const p of dPat) { p.lastIndex=0; const m=p.exec(nar); if (m?.[1]&&this._validKo(m[1])) { console.log(`[${EXTENSION_NAME}] 🆕 (ko2): "${m[1]}"`); return m[1]; } }

        // 영어: "headed home" 특수 처리
        if (/\b(?:headed|went|got|came|arrived)\s+home\b/i.test(nar)) {
            if (!this.lm.findByName('Home')) { console.log(`[${EXTENSION_NAME}] 🆕 (home)`); return 'Home'; }
        }

        // 영어 방법 3: 이동 동사 + 장소 단어
        const lo = nar.toLowerCase();
        if (this.engMoveVerbs.some(v => lo.includes(v)) || /\b(?:into|inside|toward|towards)\b/.test(lo)) {
            const r = this._engDet(nar, true); if (r) return r;
        }

        // 영어 방법 4: 존재/묘사
        const r2 = this._engDet(nar, false); if (r2) return r2;
        return null;
    }

    _engDet(nar, moveOnly) {
        const sents = nar.split(/[.!?]+/).filter(s => s.trim());
        for (const sent of sents) {
            const lo = sent.toLowerCase();
            const hasM = this.engMoveVerbs.some(v => lo.includes(v)) || /\b(?:into|toward|towards)\b/.test(lo);
            if (moveOnly && !hasM) continue;
            if (!moveOnly && hasM) continue;
            if (!moveOnly && !/\b(?:in|inside|within|at|of|around)\s+(?:the|a)\b/.test(lo) && !/\bthe\s+/.test(lo)) continue;

            for (const pw of this.placeWords) {
                if (this.transitEn.includes(pw)) continue;
                const rx = new RegExp('\\b' + pw + '(?:s)?\\b', 'i');
                const m = lo.match(rx); if (!m) continue;
                const idx = m.index;

                // Bug 21: 인명 체크 — "Mrs. Park" 스킵
                const beforeFull = sent.substring(Math.max(0, idx - 15), idx).trim().toLowerCase();
                if (this.namePrefix.some(np => beforeFull.endsWith(np) || beforeFull.endsWith(np + '.'))) continue;

                // Bug 18: 뒤에 비장소 명사 오면 스킵 — "apartment door lock"
                const afterWord = lo.substring(idx + m[0].length).trim().split(/\s+/)[0] || '';
                if (this.notPlaceSuffix.includes(afterWord)) continue;

                const before = sent.substring(0, idx).trim().split(/\s+/).filter(Boolean);
                const actual = sent.substring(idx, idx + m[0].length).trim();
                let name = actual;
                const mods = before.slice(-2).filter(w => !this.skipMods.includes(w.toLowerCase()) && !w.includes('-') && w.length > 1);
                if (mods.length) name = mods.join(' ') + ' ' + actual;
                name = name.charAt(0).toUpperCase() + name.slice(1);
                if (name.length >= 3 && name.length <= 30 && !this.lm.findByName(name)) {
                    console.log(`[${EXTENSION_NAME}] 🆕 (en): "${name}"`); return name;
                }
            }
        }
        return null;
    }

    _validKo(c) {
        if (!c) return false;
        if (c.length === 1) return this.singleKo.includes(c);
        if (c.length > 8) return false;
        if (this.lm.findByName(c)) return false;
        if (this.skipKo.includes(c)) return false;
        if (c.length === 2 && /[을를이가에]$/.test(c)) return false;
        return true;
    }

    _strip(t) { return t.replace(/<[^>]+>/g,'').replace(/\*{1,2}([^*]+)\*{1,2}/g,'$1').replace(/_{1,2}([^_]+)_{1,2}/g,'$1'); }
    _findAll(t,n) { const r=[]; let p=0; while(true){ const i=t.indexOf(n,p); if(i===-1)break; r.push(i); p=i+1; } return r; }
    _inDlg(t,pos) { const b=t.substring(0,pos); for(const[o,c]of[['"','"'],['"','"'],['「','」']]){const lo=b.lastIndexOf(o);if(lo>-1&&lo>b.lastIndexOf(c))return true;} return false; }
    _getDlg(t,pos) { for(const[o,c]of[['"','"'],['"','"'],['「','」']]){const s=t.lastIndexOf(o,pos);if(s===-1)continue;const e=t.indexOf(c,s+1);if(e>-1&&e>=pos)return t.substring(s+1,e);} return null; }
    _para(t,pos) { const b=t.substring(Math.max(0,pos-200),pos); const a=t.substring(pos,Math.min(t.length,pos+200)); return b.substring(Math.max(b.lastIndexOf('\n'),0))+(a.indexOf('\n')!==-1?a.substring(0,a.indexOf('\n')):a); }
}
