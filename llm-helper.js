// 🐶 World Tracker — llm-helper.js (Direct LLM Call)
// generateQuietPrompt 우회 — 채팅 컨텍스트 없이 직접 API 호출

import { getContext, extension_settings } from '../../../extensions.js';
import { EXTENSION_NAME } from './index.js';

const dbg = (...a) => console.log(`[${EXTENSION_NAME}]`, ...a);

// ========== ST API 설정 읽기 ==========
function _getApiConfig() {
    try {
        // ★ 1순위: 우리 확장 설정에 저장된 API 키
        const s = extension_settings?.[EXTENSION_NAME];
        // ★ Vertex AI: SA JSON 또는 API 키 (자동 판별) — provider=vertex(레거시) 또는 Gemini+useVertex
        if (s?.llmProvider === 'vertex' || (s?.llmProvider === 'google' && s?.useVertex)) {
            const model = s.llmModel || 'gemini-2.0-flash';
            // 우선 SA JSON 체크 (풀 권한)
            if (s?.vertexSaJson) {
                const sa = _parseServiceAccount(s.vertexSaJson);
                if (sa) {
                    const region = s.vertexRegion || 'us-central1';
                    dbg('🔧 LLM using Vertex AI (SA):', sa.project_id, region, model);
                    return { type: 'vertex', sa, region, model };
                }
            }
            // SA JSON 없거나 파싱 실패 → API 키 방식으로 폴백
            if (s?.llmApiKey) {
                dbg('🔧 LLM using Vertex AI (API key):', model);
                return { type: 'vertex_key', key: s.llmApiKey, model };
            }
            dbg('⚠️ Vertex: neither SA JSON nor API key set');
            return null;
        }
        if (s?.llmApiKey) {
            const provider = s.llmProvider || 'google';
            const model = s.llmModel || (provider === 'google' ? 'gemini-2.0-flash' : provider === 'openai' ? 'gpt-4o-mini' : '');
            let type = provider, url = null;
            if (provider === 'openrouter') { type = 'openai'; url = 'https://openrouter.ai/api/v1'; }
            else if (provider === 'openai') { url = 'https://api.openai.com/v1'; }
            dbg('🔧 LLM using extension key:', provider, model);
            return { type, key: s.llmApiKey, model, url };
        }

        let type = null, key = null, model = null, url = null;

        // ★ 여러 경로에서 API 키 탐색 (window.oai 등 안전 접근)
        const _oai = (typeof window !== 'undefined' && window.oai) || {};
        const _chatCompletion = (typeof window !== 'undefined' && window.chat_completion_source) || (typeof window !== 'undefined' && window.chatCompletion) || null;
        const _mainApi = (typeof window !== 'undefined' && window.main_api) || null;

        // Google (Gemini)
        const gKey = _oai.api_key_makersuite
            || (typeof window !== 'undefined' && window.api_key_makersuite)
            || document.getElementById('api_key_makersuite')?.value
            || '';
        const gModel = _oai.google_model
            || (typeof window !== 'undefined' && window.google_model)
            || document.getElementById('model_google_select')?.value
            || 'gemini-2.0-flash';

        // OpenAI
        const oKey = _oai.api_key_openai
            || (typeof window !== 'undefined' && window.api_key_openai)
            || document.getElementById('api_key_openai')?.value
            || '';

        // OpenRouter
        const orKey = _oai.api_key_openrouter
            || (typeof window !== 'undefined' && window.api_key_openrouter)
            || document.getElementById('api_key_openrouter')?.value
            || '';

        dbg('🔧 LLM keys found:', {
            google: gKey ? '✅ (' + gKey.substring(0, 8) + '...)' : '❌',
            openai: oKey ? '✅' : '❌',
            openrouter: orKey ? '✅' : '❌',
            gModel,
        });

        // Google 우선 (유저가 Gemini 사용)
        if (gKey && (_chatCompletion === 'makersuite' || _mainApi === 'openai')) {
            type = 'google'; key = gKey; model = gModel;
        }
        // 명시적 Google 체크 (chatCompletion 없어도)
        else if (gKey) {
            type = 'google'; key = gKey; model = gModel;
        }
        // OpenAI
        else if (oKey && (_chatCompletion === 'openai' || !_chatCompletion)) {
            type = 'openai'; key = oKey;
            model = _oai.openai_model || 'gpt-4o-mini';
            url = _oai.openai_reverse_proxy || 'https://api.openai.com/v1';
        }
        // OpenRouter
        else if (orKey) {
            type = 'openai'; key = orKey;
            model = _oai.openrouter_model || '';
            url = 'https://openrouter.ai/api/v1';
        }

        if (!type || !key) {
            dbg('⚠️ LLM: no API key found, fallback');
            return null;
        }
        dbg('🔧 LLM selected:', type, model);
        return { type, key, model, url };
    } catch(e) {
        dbg('⚠️ LLM config error:', e.message);
        return null;
    }
}

// ========== Google Gemini 직접 호출 ==========
async function _callGoogle(key, model, prompt) {
    // v0.8.0: Grounding 모드 — 전역 플래그로 전달
    const useGrounding = !!window._wtUseGrounding;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const _fetch = (body) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), window._wtUseGrounding ? 90000 : 60000); // v0.8.6: 동적 타임아웃 — Grounding 90초, 일반 60초
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }).finally(() => clearTimeout(timer));
    };

    // ★ 1차 시도: JSON 강제 모드 (grounding 비활성 시만)
    if (!useGrounding) {
        try {
            const genCfg = {
                temperature: (window._wtTempOverride ?? 0.7),
                maxOutputTokens: (window._wtMaxTokensOverride ?? 4096),
                responseMimeType: 'application/json',
            };
            // v0.8.18: thinking 비활성화 (요약 같이 간단한 작업용, 출력 토큰 한도 초과 방지)
            if (window._wtDisableThinking) {
                genCfg.thinkingConfig = { thinkingBudget: 0 };
            }
            const res = await _fetch({
                systemInstruction: { parts: [{ text: 'You are a JSON-only assistant. Respond with valid JSON only.' }] },
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: genCfg,
            });
            if (res.ok) {
                const data = await res.json();
                dbg('🔧 Google raw:', JSON.stringify(data).substring(0, 300));
                const parts = data?.candidates?.[0]?.content?.parts || [];
                // ★ JSON으로 시작하는 part 우선 선택 (RP 텍스트 part 거부)
                for (const part of parts) {
                    if (part.text && part.text.trim().startsWith('{')) {
                        dbg(`🔧 Google OK (JSON mode, ${part.text.length}c, starts with {)`);
                        return part.text;
                    }
                }
                // JSON으로 시작하는 게 없으면 { 포함하는 걸로 fallback
                for (const part of parts) {
                    if (part.text && part.text.includes('{')) {
                        const jsonStart = part.text.indexOf('{');
                        dbg(`🔧 Google OK (JSON mode, ${part.text.length}c, { at ${jsonStart})`);
                        return part.text.substring(jsonStart);
                    }
                }
                dbg(`⚠️ Google JSON mode: no JSON found in ${parts.length} parts`);
                // v0.8.5: 응답 받았지만 JSON 없음 — finish_reason 체크 (MAX_TOKENS, SAFETY 등)
                const finishReason = data?.candidates?.[0]?.finishReason || 'UNKNOWN';
                window._wtLastLLMError = `Google 1st: no JSON (finish_reason=${finishReason})${finishReason === 'MAX_TOKENS' ? ' — 토큰 부족! 📏 생성 분량 → 🌱 가벼움 시도' : ''}`;
            } else {
                const errBody = await res.text().catch(() => '');
                dbg(`⚠️ Google JSON mode: ${res.status} ${errBody.substring(0, 200)}`);
                window._wtLastLLMError = `Google HTTP ${res.status}: ${errBody.substring(0, 300)}`;
            }
        } catch(e) {
            dbg(`⚠️ Google JSON mode error: ${e.message}`);
            window._wtLastLLMError = `Google 1st fetch error: ${e.message}`;
        }
    }

    // ★ 2차 시도: JSON 강제 없이 (grounding 켜지면 여기로 바로 옴)
    try {
        const gcfg2 = {
            temperature: (window._wtTempOverride ?? 0.7),
            maxOutputTokens: (window._wtMaxTokensOverride ?? 4096),
        };
        if (window._wtDisableThinking) {
            gcfg2.thinkingConfig = { thinkingBudget: 0 };
        }
        const body2 = {
            contents: [{ parts: [{ text: prompt + '\n\nCRITICAL: Respond with ONLY valid JSON. Start with { and end with }. No markdown, no explanation.' }] }],
            generationConfig: gcfg2,
        };
        // v0.8.0: Grounding with Google Search — 실시간 웹 검색 기반 답변
        if (useGrounding) {
            body2.tools = [{ google_search: {} }];
            dbg('🔍 Google Search Grounding enabled');
        }
        const res2 = await _fetch(body2);
        if (!res2.ok) {
            const errBody2 = await res2.text().catch(() => '');
            window._wtLastLLMError = `Google 2nd HTTP ${res2.status}: ${errBody2.substring(0, 300)}`;
            throw new Error(`Google API ${res2.status}: ${res2.statusText}`);
        }
        const data2 = await res2.json();
        const parts2 = data2?.candidates?.[0]?.content?.parts || [];
        // ★ JSON으로 시작하는 part 우선
        for (const part of parts2) {
            if (part.text && part.text.trim().startsWith('{')) {
                dbg(`🔧 Google API OK (fallback, ${part.text.length}c)`);
                return part.text;
            }
        }
        for (const part of parts2) {
            if (part.text && part.text.includes('{')) {
                const jsonStart = part.text.indexOf('{');
                dbg(`🔧 Google API OK (fallback, { at ${jsonStart})`);
                return part.text.substring(jsonStart);
            }
        }
        dbg(`⚠️ Google fallback: no JSON in parts either`);
        // v0.8.5: 2차도 JSON 없음 — finish_reason 체크
        const finishReason2 = data2?.candidates?.[0]?.finishReason || 'UNKNOWN';
        if (!window._wtLastLLMError || !/HTTP/i.test(window._wtLastLLMError)) {
            window._wtLastLLMError = `Google 2nd: no JSON (finish_reason=${finishReason2})${finishReason2 === 'MAX_TOKENS' ? ' — 토큰 부족!' : ''}`;
        }
        return parts2[0]?.text || '';
    } catch(e) {
        throw new Error(`Google API both attempts failed: ${e.message}`);
    }
}

// ========== Vertex AI (Gemini) 직접 호출 ==========
// Service Account JSON → JWT (RS256) → OAuth access token → Vertex API

// base64url 인코딩 (일반 base64에서 +/= 치환)
function _base64UrlEncode(input) {
    let b64;
    if (typeof input === 'string') {
        b64 = btoa(unescape(encodeURIComponent(input)));
    } else {
        // ArrayBuffer / Uint8Array
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        b64 = btoa(binary);
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// PEM 형식의 private key를 Web Crypto CryptoKey로 임포트
async function _importPrivateKey(pem) {
    // PEM 헤더/푸터 제거 + 개행 제거
    const pemContents = pem
        .replace(/-----BEGIN [^-]+-----/, '')
        .replace(/-----END [^-]+-----/, '')
        .replace(/\s+/g, '');
    // base64 → ArrayBuffer
    const binaryString = atob(pemContents);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    // PKCS#8 ("BEGIN PRIVATE KEY") — Google SA 키는 PKCS#8
    return crypto.subtle.importKey(
        'pkcs8',
        bytes.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
}

// Service Account JSON으로부터 access token 받기 (1시간 유효)
// 메모리 캐시로 5분 여유 두고 재사용
const _vertexTokenCache = new Map(); // key: client_email, value: {token, exp}

async function _getVertexAccessToken(sa) {
    const cacheKey = sa.client_email;
    const cached = _vertexTokenCache.get(cacheKey);
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.exp > now + 300) {
        dbg('🔧 Vertex token cache hit (exp in ' + (cached.exp - now) + 's)');
        return cached.token;
    }

    // JWT payload
    const iat = now;
    const exp = iat + 3600;
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
        exp: exp,
        iat: iat,
    };

    const headerB64 = _base64UrlEncode(JSON.stringify(header));
    const payloadB64 = _base64UrlEncode(JSON.stringify(payload));
    const toSign = `${headerB64}.${payloadB64}`;

    // RS256 서명
    const key = await _importPrivateKey(sa.private_key);
    const sigBuffer = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        new TextEncoder().encode(toSign)
    );
    const sigB64 = _base64UrlEncode(new Uint8Array(sigBuffer));
    const jwt = `${toSign}.${sigB64}`;

    // OAuth 토큰 교환
    const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
    const res = await fetch(tokenUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`OAuth token exchange failed (${res.status}): ${errText.substring(0, 200)}`);
    }
    const data = await res.json();
    if (!data.access_token) throw new Error('OAuth response missing access_token');

    _vertexTokenCache.set(cacheKey, { token: data.access_token, exp });
    dbg('🔧 Vertex token obtained (valid 1hr)');
    return data.access_token;
}

async function _callVertex(sa, region, model, prompt) {
    if (!sa?.client_email || !sa?.private_key || !sa?.project_id) {
        throw new Error('Invalid service account: missing client_email/private_key/project_id');
    }
    const projectId = sa.project_id;
    const loc = region || 'us-central1';
    const token = await _getVertexAccessToken(sa);
    // global은 prefix 없는 엔드포인트 사용, 나머지는 regional
    const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
    const endpoint = `https://${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${model}:generateContent`;

    const _fetch = (body) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), window._wtUseGrounding ? 90000 : 60000);
        return fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
    };

    // 1차: JSON 강제
    try {
        const res = await _fetch({
            systemInstruction: { parts: [{ text: 'You are a JSON-only assistant. Respond with valid JSON only.' }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: (window._wtTempOverride ?? 0.7), maxOutputTokens: (window._wtMaxTokensOverride ?? 4096), responseMimeType: 'application/json' },
        });
        if (res.ok) {
            const data = await res.json();
            dbg('🔧 Vertex raw:', JSON.stringify(data).substring(0, 300));
            const parts = data?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                if (part.text && part.text.trim().startsWith('{')) {
                    dbg(`🔧 Vertex OK (JSON mode, ${part.text.length}c)`);
                    return part.text;
                }
            }
            for (const part of parts) {
                if (part.text && part.text.includes('{')) {
                    const jsonStart = part.text.indexOf('{');
                    dbg(`🔧 Vertex OK (JSON mode, { at ${jsonStart})`);
                    return part.text.substring(jsonStart);
                }
            }
            dbg(`⚠️ Vertex JSON mode: no JSON found in ${parts.length} parts`);
        } else {
            const errBody = await res.text().catch(() => '');
            dbg(`⚠️ Vertex JSON mode: ${res.status} ${errBody.substring(0, 200)}`);
            // 401은 토큰 만료 가능성 — 캐시 무효화
            if (res.status === 401) _vertexTokenCache.delete(sa.client_email);
        }
    } catch(e) {
        dbg(`⚠️ Vertex JSON mode error: ${e.message}`);
    }

    // 2차: fallback
    try {
        const res2 = await _fetch({
            contents: [{ role: 'user', parts: [{ text: prompt + '\n\nCRITICAL: Respond with ONLY valid JSON. Start with { and end with }. No markdown, no explanation.' }] }],
            generationConfig: { temperature: (window._wtTempOverride ?? 0.7), maxOutputTokens: (window._wtMaxTokensOverride ?? 4096) },
        });
        if (!res2.ok) throw new Error(`Vertex API ${res2.status}: ${res2.statusText}`);
        const data2 = await res2.json();
        const parts2 = data2?.candidates?.[0]?.content?.parts || [];
        for (const part of parts2) {
            if (part.text && part.text.trim().startsWith('{')) return part.text;
        }
        for (const part of parts2) {
            if (part.text && part.text.includes('{')) return part.text.substring(part.text.indexOf('{'));
        }
        return parts2[0]?.text || '';
    } catch(e) {
        throw new Error(`Vertex API both attempts failed: ${e.message}`);
    }
}

// Service Account JSON 파싱 (문자열 → 객체)
function _parseServiceAccount(jsonStr) {
    if (!jsonStr) return null;
    try {
        const sa = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        if (sa.type !== 'service_account') return null;
        if (!sa.client_email || !sa.private_key || !sa.project_id) return null;
        return sa;
    } catch(e) {
        dbg('⚠️ Service account JSON parse failed:', e.message);
        return null;
    }
}

// ========== Vertex AI Express (API 키 방식) ==========
// 서비스 계정 JSON 없이 짧은 API 키로 호출 — 2026년 정식 지원
// 엔드포인트는 AI Studio와 달리 project/location 없음, 헤더로 인증
async function _callVertexApiKey(apiKey, model, prompt) {
    // v0.9.15: Vertex Express는 ?key= 쿼리 인증이 안정적 (x-goog-api-key 헤더로는 막히는 경우 있음)
    const endpoint = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const _fetch = (body) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), window._wtUseGrounding ? 90000 : 60000);
        return fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
    };

    // 1차: JSON 강제
    try {
        const res = await _fetch({
            systemInstruction: { parts: [{ text: 'You are a JSON-only assistant. Respond with valid JSON only.' }] },
            contents: [{ parts: [{ text: prompt }] }],  // v0.8.2: role 제거 (Vertex Express 호환)
            generationConfig: { temperature: (window._wtTempOverride ?? 0.7), maxOutputTokens: (window._wtMaxTokensOverride ?? 4096), responseMimeType: 'application/json' },
        });
        if (res.ok) {
            const data = await res.json();
            dbg('🔧 Vertex(key) raw:', JSON.stringify(data).substring(0, 300));
            const parts = data?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                if (part.text && part.text.trim().startsWith('{')) {
                    dbg(`🔧 Vertex(key) OK (JSON mode, ${part.text.length}c)`);
                    return part.text;
                }
            }
            for (const part of parts) {
                if (part.text && part.text.includes('{')) {
                    return part.text.substring(part.text.indexOf('{'));
                }
            }
            // v0.8.2: 응답은 왔는데 JSON 없음 — 에러로 저장
            window._wtLastLLMError = `Vertex(key): Response OK but no JSON. finish_reason=${data?.candidates?.[0]?.finishReason || '?'}`;
            dbg(`⚠️ Vertex(key) JSON mode: response OK but no JSON parts (${parts.length} parts)`);
        } else {
            const errBody = await res.text().catch(() => '');
            // v0.8.2: HTTP 에러 전체 보존 — 디버그 모달에 표시
            window._wtLastLLMError = `Vertex(key) HTTP ${res.status}: ${errBody.substring(0, 400)}`;
            dbg(`⚠️ Vertex(key) JSON mode: ${res.status} ${errBody.substring(0, 300)}`);
        }
    } catch(e) {
        window._wtLastLLMError = `Vertex(key) fetch error: ${e.message}`;
        dbg(`⚠️ Vertex(key) JSON mode error: ${e.message}`);
    }

    // 2차: fallback
    try {
        const body2 = {
            contents: [{ parts: [{ text: prompt + '\n\nCRITICAL: Respond with ONLY valid JSON. Start with { and end with }. No markdown, no explanation.' }] }],
            generationConfig: { temperature: (window._wtTempOverride ?? 0.7), maxOutputTokens: (window._wtMaxTokensOverride ?? 4096) },
        };
        // v0.8.2: Grounding 지원 (Vertex AI)
        if (window._wtUseGrounding) {
            body2.tools = [{ googleSearch: {} }];  // Vertex는 googleSearch (Gemini API와 다름)
            dbg('🔍 Vertex(key) Grounding enabled');
        }
        const res2 = await _fetch(body2);
        if (!res2.ok) {
            const errBody2 = await res2.text().catch(() => '');
            window._wtLastLLMError = `Vertex(key) 2nd attempt HTTP ${res2.status}: ${errBody2.substring(0, 400)}`;
            throw new Error(`Vertex(key) API ${res2.status}: ${res2.statusText}`);
        }
        const data2 = await res2.json();
        const parts2 = data2?.candidates?.[0]?.content?.parts || [];
        for (const part of parts2) {
            if (part.text && part.text.trim().startsWith('{')) return part.text;
        }
        for (const part of parts2) {
            if (part.text && part.text.includes('{')) return part.text.substring(part.text.indexOf('{'));
        }
        return parts2[0]?.text || '';
    } catch(e) {
        throw new Error(`Vertex(key) API both attempts failed: ${e.message}`);
    }
}

// ========== OpenAI / OpenRouter 직접 호출 ==========
async function _callOpenAI(key, model, prompt, url) {
    const endpoint = `${url}/chat/completions`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 4096,
        }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
}

// ========== Claude 직접 호출 ==========
async function _callClaude(key, model, prompt, url) {
    const endpoint = `${url}/messages`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4096,
        }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data?.content?.[0]?.text || '';
}

// r27: Google API 503/과부하 때 다른 Gemini 모델로 자동 폴백
async function _callGoogleWithFallback(key, primaryModel, prompt) {
    try {
        return await _callGoogle(key, primaryModel, prompt);
    } catch(e) {
        const msg = e?.message || '';
        // v0.8.6: Grounding 모드 + 타임아웃/abort → Grounding 끄고 재시도
        //   이유: Grounding이 웹 검색 느려서 타임아웃 나면, 검색 없이라도 응답 받는 게 나음
        if (window._wtUseGrounding && /AbortError|aborted|timeout|signal/i.test(msg)) {
            dbg('🔁 Grounding timeout → Grounding OFF로 재시도');
            window._wtUseGrounding = false;
            try {
                const r = await _callGoogle(key, primaryModel, prompt);
                window._wtUseGrounding = true; // 복원 (다음 호출 위해)
                if (r) {
                    dbg('✅ Grounding 없이 성공!');
                    return r;
                }
            } catch(e3) {
                window._wtUseGrounding = true; // 복원
                dbg(`⚠️ Grounding 없이도 실패: ${e3.message?.substring(0, 60)}`);
                // 계속해서 모델 폴백 시도
            }
        }
        // 서버 과부하/타임아웃 계열 에러만 모델 폴백 시도
        if (/\b(503|429|500|502|504)\b|AbortError|aborted|timeout|overload|signal/i.test(msg)) {
            const fallbacks = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash']
                .filter(m => m !== primaryModel);
            for (const fm of fallbacks) {
                try {
                    dbg(`🔁 ${primaryModel} 과부하 → ${fm} 시도`);
                    const r = await _callGoogle(key, fm, prompt);
                    if (r) { dbg(`✅ ${fm} 성공!`); return r; }
                } catch(e2) {
                    dbg(`⚠️ ${fm} 도 실패: ${e2.message?.substring(0, 60)}`);
                    continue;
                }
            }
            throw new Error(`Google 서버 과부하 — 모든 Gemini 모델 폴백 실패. 1~2분 후 다시 시도해주세요. (마지막: ${msg.substring(0, 80)})`);
        }
        throw e;
    }
}

// ========== 메인 호출 함수 ==========
// v0.9.16: SillyTavern 연결 프로필 경유 생성 (ConnectionManagerRequestService)
//   ST 버전에 따라 없을 수 있으므로 방어적으로 접근 + 다양한 응답 형태 대응
async function _callViaConnectionProfile(profileId, prompt) {
    const ctx = getContext();
    let svc = ctx?.ConnectionManagerRequestService
        || (typeof window !== 'undefined' && window.ConnectionManagerRequestService);
    if (!svc || typeof svc.sendRequest !== 'function') {
        // shared.js에서 직접 가져오기 (ST 버전에 따라 위치/존재 다를 수 있어 방어적)
        try { const mod = await import('../../shared.js'); svc = mod.ConnectionManagerRequestService; } catch (_) {}
    }
    if (!svc || typeof svc.sendRequest !== 'function') {
        throw new Error('ConnectionManagerRequestService 사용 불가 (ST 업데이트 필요할 수 있음)');
    }
    const maxTokens = window._wtMaxTokensOverride ?? 4096;
    dbg(`🔧 연결 프로필 생성 시도 (profile=${profileId}, max=${maxTokens})`);
    const res = await svc.sendRequest(profileId, prompt, maxTokens);
    if (res == null) return '';
    if (typeof res === 'string') return res;
    // 응답 형태 편차 대응 (content / text / message.content / choices[].message.content)
    return res.content
        || res.text
        || res.message?.content
        || res.choices?.[0]?.message?.content
        || res.choices?.[0]?.text
        || '';
}

export async function callLLM(prompt, options = {}) {
    // v0.7.9: options.temperature 지원 (기본 0.7, 커뮤니티는 0.95 권장)
    const temp = options.temperature ?? 0.7;
    if (temp !== 0.7) {
        // 전역 오버라이드 플래그로 임시 적용 — 이번 호출만
        window._wtTempOverride = temp;
    }
    // ★ 마지막 에러 저장 (디버깅용)
    window._wtLastLLMError = null;

    // ★ v0.9.16: 방법 0 — 연결 프로필 (선택 시 우선). ConnectionManagerRequestService 경유.
    //   실패하면 아래 기존 직접-API / 폴백 경로로 자연스럽게 넘어감 (회귀 방지)
    const _s = extension_settings?.[EXTENSION_NAME];
    if (_s?.selectedProfile) {
        try {
            const out = await _callViaConnectionProfile(_s.selectedProfile, prompt);
            if (out && out.trim()) {
                window._wtLastApiStatus = `Connection profile: ${_s.selectedProfile}`;
                dbg('🔧 LLM via connection profile OK');
                return out;
            }
            dbg('⚠️ 연결 프로필 응답 비어있음 → 기존 경로로 폴백');
        } catch (e) {
            dbg('⚠️ 연결 프로필 경로 실패 → 폴백:', e.message);
            window._wtLastLLMError = `Profile gen failed: ${e.message}`;
        }
    }

    // ★ 방법 1: 직접 API 호출 (확장 설정 키 또는 ST 변수)
    const cfg = _getApiConfig();
    // v0.8.1: 디버그 정보 저장 (API 설정 상태 추적)
    window._wtLastApiStatus = cfg
        ? `Direct API used: type=${cfg.type}, model=${cfg.model}${cfg.region ? `, region=${cfg.region}` : ''}, key=${cfg.key ? `***${cfg.key.slice(-4)}` : (cfg.sa ? `SA:${cfg.sa.project_id}` : 'none')}`
        : 'NO API CONFIG — using fallback (generateQuietPrompt)';
    dbg('🔧 API status:', window._wtLastApiStatus);

    if (cfg) {
        try {
            dbg(`🔧 LLM calling ${cfg.type} (${cfg.model}), prompt ${prompt.length}c`);
            let result = '';
            if (cfg.type === 'google') result = await _callGoogleWithFallback(cfg.key, cfg.model, prompt);
            else if (cfg.type === 'vertex') result = await _callVertex(cfg.sa, cfg.region, cfg.model, prompt);
            else if (cfg.type === 'vertex_key') result = await _callVertexApiKey(cfg.key, cfg.model, prompt);
            else if (cfg.type === 'openai') result = await _callOpenAI(cfg.key, cfg.model, prompt, cfg.url);
            else if (cfg.type === 'claude') result = await _callClaude(cfg.key, cfg.model, prompt, cfg.url);

            if (result) {
                dbg(`🔧 LLM direct OK (${result.length}c)`);
                return result;
            }
            // v0.8.5: 개별 API 함수가 이미 구체 에러 저장했으면 그대로 두고, 없을 때만 기본 메시지
            if (!window._wtLastLLMError || window._wtLastLLMError === 'No API config detected — check 설정 → 🔑 LLM API 키 입력') {
                window._wtLastLLMError = 'Direct API returned empty (key? quota? thinking overflow?)';
            }
            dbg('⚠️ LLM direct returned empty, lastErr:', window._wtLastLLMError);
        } catch(e) {
            window._wtLastLLMError = `Direct API error: ${e.message}`;
            dbg('⚠️ LLM direct failed:', e.message);
        }
    } else {
        window._wtLastLLMError = 'No API config detected — check 설정 → 🔑 LLM API 키 입력';
    }

    // ★ 방법 2: Fallback — generateQuietPrompt (본체 모델, 컨텍스트 포함)
    try {
        const ctx = getContext();
        const gen = ctx?.generateQuietPrompt;
        if (gen) {
            const { runWithoutAutoDetect } = await import('./index.js');
            const result = await runWithoutAutoDetect(() => gen({ prompt }), 2500);
            if (result) {
                // v0.7.11: RP 마커 감지 — <memo>, OOC, yaml 캐릭터카드 등 있으면 즉시 거부
                if (_isRpContinuation(result)) {
                    window._wtLastLLMError = 'Fallback returned RP story (API 키 설정 권장)';
                    dbg('🚫 Fallback returned RP continuation — rejecting and asking user to set API key');
                    return null;
                }
                if (result.includes('{') && result.includes('}')) {
                    dbg('🔧 LLM fallback (generateQuietPrompt) OK');
                    return result;
                } else {
                    // v0.7.7: JSON 아니면 한번 더 재시도 — 프롬프트 앞에 강한 지시 추가
                    dbg('⚠️ LLM fallback returned non-JSON, retrying with stricter instruction...');
                    try {
                        const strictPrompt = `[SYSTEM: Output raw JSON only. No prose, no narration, no story. Start with { and end with }. Nothing else. DO NOT continue the roleplay. DO NOT generate <memo>, <phone_trigger>, OOC, or any story text.]\n\n${prompt}`;
                        const retry = await runWithoutAutoDetect(() => gen({ prompt: strictPrompt }), 2500);
                        // v0.7.11: 재시도 결과도 RP 마커 체크
                        if (retry && _isRpContinuation(retry)) {
                            window._wtLastLLMError = 'Fallback retry also returned RP story';
                            dbg('🚫 Fallback retry also RP — giving up');
                            return null;
                        }
                        if (retry && retry.includes('{') && retry.includes('}')) {
                            dbg('🔧 LLM fallback retry OK');
                            return retry;
                        }
                        window._wtLastLLMError = 'Fallback retry also returned non-JSON';
                        dbg('⚠️ LLM fallback retry also non-JSON');
                    } catch(e2) {
                        window._wtLastLLMError = 'Fallback retry: ' + e2.message;
                        dbg('⚠️ LLM fallback retry failed:', e2.message);
                    }
                    return null;
                }
            }
            window._wtLastLLMError = 'Fallback returned null';
        }
    } catch(e) {
        window._wtLastLLMError = 'Fallback: ' + e.message;
        dbg('⚠️ LLM fallback failed:', e.message);
    }

    return null;
}

// ========== 최근 채팅 맥락 추출 ==========
export function getRecentChatContext(maxChars = 2000) {
    try {
        const ctx = getContext();
        const chat = ctx?.chat;
        if (!Array.isArray(chat) || !chat.length) return '';
        let result = '';
        // 최근 메시지부터 역순으로 모아서 maxChars까지
        for (let i = chat.length - 1; i >= 0 && result.length < maxChars; i--) {
            const msg = chat[i];
            if (!msg?.mes) continue;
            // HTML 태그 + 메타데이터 + 코드블록 제거
            const clean = msg.mes
                .replace(/<[^>]*>/g, '')
                .replace(/```[\s\S]*?```/g, '')
                .replace(/<memo>[\s\S]*?<\/memo>/g, '')
                .trim();
            if (!clean || clean.length < 10) continue;
            const role = msg.is_user ? '👤' : '🤖';
            const line = `${role} ${clean}\n---\n`;
            result = line + result;
        }
        const trimmed = result.substring(0, maxChars).trim();
        if (trimmed) dbg(`📋 Chat context: ${trimmed.length}c from recent messages`);
        return trimmed;
    } catch(e) {
        dbg('⚠️ getRecentChatContext error:', e.message);
        return '';
    }
}

// v0.8.7: 그룹챗 대응 — 최근 N개 메시지에서 발화한 AI 캐릭터들을 빈도순 반환
// 반환: { recentSpeaker: '가장 최근에 말한 캐릭터', allSpeakers: ['이름1','이름2'] }
export function getRecentSpeakers(lookback = 8) {
    try {
        const ctx = getContext();
        const chat = ctx?.chat;
        if (!Array.isArray(chat) || !chat.length) return { recentSpeaker: null, allSpeakers: [] };
        const speakers = []; // [{name, index}]
        const seen = new Set();
        // 최근 메시지부터 역순
        for (let i = chat.length - 1; i >= 0 && speakers.length < lookback; i--) {
            const msg = chat[i];
            if (!msg || msg.is_user) continue; // 유저 발화 제외
            if (msg.is_system) continue;
            const name = msg.name || msg.original_name;
            if (!name || name === 'System') continue;
            if (!seen.has(name)) {
                seen.add(name);
                speakers.push({ name, index: i });
            }
        }
        const recentSpeaker = speakers[0]?.name || null;
        const allSpeakers = speakers.map(s => s.name);
        if (recentSpeaker) dbg(`🎭 Recent speakers: ${allSpeakers.join(', ')} (latest: ${recentSpeaker})`);
        return { recentSpeaker, allSpeakers };
    } catch(e) {
        dbg('⚠️ getRecentSpeakers error:', e.message);
        return { recentSpeaker: null, allSpeakers: [] };
    }
}

// ========== JSON 파싱 헬퍼 ==========

// v0.7.11: Fallback 응답이 RP 이어쓰기인지 감지 (JSON 생성 실패 시 자동 거부용)
// 반환: true면 RP 응답 (거부해야 함), false면 정상 응답
function _isRpContinuation(text) {
    if (!text || text.length < 100) return false;

    // 1. 명확한 RP/ST 시스템 마커 — 하나라도 있으면 확실히 RP
    const hardMarkers = [
        /<memo\b/i,              // <memo> 태그
        /<\/memo>/i,
        /<phone_trigger\b/i,      // <phone_trigger> 태그
        /<world_info\b/i,
        /<char_sheet\b/i,
        /\bOOC\s*[:：]/i,         // OOC: 표시
        /\(OOC\s*[:：]/i,         // (OOC:
        /```yaml\s*\n[\s\S]*?(Time|Characters|Location)\s*[:：]/i, // ```yaml 블록에 캐릭터 카드
        /\*\*\*\s*\n/,            // *** 구분선 (RP 장면 전환)
    ];
    for (const m of hardMarkers) {
        if (m.test(text)) {
            dbg('🚫 RP marker detected:', m.source.substring(0, 40));
            return true;
        }
    }

    // 2. JSON이 전혀 없는데 긴 서술형 문장들 — RP 가능성 높음
    const hasJsonStart = /^\s*(```\s*json\s*\n?)?[\s\n]*\{/.test(text);
    if (!hasJsonStart) {
        // JSON으로 시작 안 함 + 긴 서술 문장들이면 RP 판정
        const longNarrativeSentences = (text.match(/[.!?]\s+[A-Z가-힣]/g) || []).length;
        if (longNarrativeSentences > 5) {
            dbg('🚫 RP-style narrative detected: ' + longNarrativeSentences + ' long sentences without JSON');
            return true;
        }
    }

    return false;
}

// HTML 태그 속성의 큰따옴표를 작은따옴표로 변환 (LLM이 JSON 이스케이프 실수 보완)
// 예: "text":"... <img src=\"url\" style=\"...\"> ..." → "text":"... <img src='url' style='...'> ..."
// 단, JSON 구조의 "는 건드리지 않음 — text 필드 값 내부의 HTML 태그 부분만 처리
function _repairHtmlQuotes(jsonStr) {
    // "text":"..." 필드 값 내부만 타겟. 이스케이프된 \" 또는 raw "를 태그 속성 자리에서 치환
    // 패턴: <tag attr="value">  또는 <tag attr=\"value\"> → '로 변환
    return jsonStr.replace(
        /"(text|body|content)"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
        (match, key, value) => {
            // value 내부에서 HTML 태그 속성의 큰따옴표 치환
            // 패턴1: 이스케이프된 \" (JSON 내부에서 표기되는 방식)
            let fixed = value.replace(/\\"/g, "'");
            return `"${key}":"${fixed}"`;
        }
    );
}

export function parseLLMJson(raw) {
    if (!raw) return null;
    let text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    // 마크다운 코드블록 제거
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    // 트레일링 콤마 제거
    text = text.replace(/,\s*([}\]])/g, '$1');

    // ★ 1차: 완전한 JSON 매칭
    let match = text.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch(e) {
            dbg('⚠️ 1차 파싱 실패, HTML 따옴표 복구 시도:', e.message.substring(0, 100));
            // ★ 1.5차: HTML 속성의 잘못된 큰따옴표를 작은따옴표로 복구 후 재시도
            // 예: "text":"... <img src="url" style="..."> ..."  →  "text":"... <img src='url' style='...'> ..."
            const repaired = _repairHtmlQuotes(match[0]);
            if (repaired !== match[0]) {
                try {
                    const parsed = JSON.parse(repaired);
                    dbg('🔧 HTML 따옴표 복구 성공');
                    return parsed;
                } catch(e2) {
                    dbg('⚠️ HTML 따옴표 복구 후에도 실패:', e2.message.substring(0, 100));
                }
            }
        }
    }

    // ★ 2차: 잘린 JSON 복구 (닫는 } 없는 경우 포함)
    const startIdx = text.indexOf('{');
    if (startIdx < 0) return null;
    let json = text.substring(startIdx);

    // 잘린 문자열/값 정리
    json = json
        .replace(/,\s*$/, '')           // 끝 콤마 제거
        .replace(/"[^"]*$/g, '"')       // 잘린 문자열 닫기
        .replace(/:\s*$/, ': null');     // 잘린 값 → null

    // 열린 괄호 수만큼 닫기
    const opens = (json.match(/\[/g) || []).length - (json.match(/\]/g) || []).length;
    const braces = (json.match(/\{/g) || []).length - (json.match(/\}/g) || []).length;
    for (let i = 0; i < opens; i++) json += ']';
    for (let i = 0; i < braces; i++) json += '}';

    // 닫기 전 마지막 쉼표 정리
    json = json.replace(/,\s*([}\]])/g, '$1');

    try {
        const parsed = JSON.parse(json);
        dbg('🔧 JSON repaired successfully');
        return parsed;
    } catch(e) {
        dbg('⚠️ JSON parse fail (repair failed):', e.message, '\nRaw:', json.substring(0, 200));
        return null;
    }
}
