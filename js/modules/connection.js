/* ═══════════════════════════════════════════════════
   CONNECTION — LLM API calls, streaming
   ═══════════════════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { FILE_SYSTEM_INSTRUCTIONS, FREE_MODEL_FALLBACKS, MODE_MAX_TOKENS_FLOOR } from './config.js';
import {
    removeWelcome, addUserMessage, addBotMessageStart,
    appendStreamChunk, finalizeStream, updateSendButton, showContinueButton, removeContinueButton
} from './messages.js';
import { setConnectionStatus, toast } from './ui.js';

var RATE_LIMIT_CONFIG = {
    'google-ai':   { baseDelay: 15000, maxRetries: 5, backoffFactor: 2.0, minInterval: 5000, continueDelay: 8000, cooldownMs: 60000 },
    'openrouter':  { baseDelay: 8000,  maxRetries: 2, backoffFactor: 2.0, minInterval: 3500, continueDelay: 4000, cooldownMs: 45000 },
    'ollama':      { baseDelay: 2000,  maxRetries: 2, backoffFactor: 1.5, minInterval: 500,  continueDelay: 1000, cooldownMs: 10000 },
    'lmstudio':    { baseDelay: 2000,  maxRetries: 2, backoffFactor: 1.5, minInterval: 500,  continueDelay: 1000, cooldownMs: 10000 },
    'openai':      { baseDelay: 5000,  maxRetries: 3, backoffFactor: 2.0, minInterval: 2000, continueDelay: 3000, cooldownMs: 30000 },
    'openai-compat': { baseDelay: 5000, maxRetries: 3, backoffFactor: 2.0, minInterval: 2000, continueDelay: 3000, cooldownMs: 30000 },
    'default':     { baseDelay: 8000,  maxRetries: 3, backoffFactor: 2.0, minInterval: 3000, continueDelay: 3000, cooldownMs: 30000 }
};

var FETCH_TIMEOUT = 120000;
var STREAM_STALL_TIMEOUT = 60000;
var MIN_MAX_TOKENS = 32;
var MAX_MAX_TOKENS = 32768;
var DEFAULT_MAX_TOKENS = 8192;
var TOKEN_402_SAFETY_MARGIN = 150;
var MIN_RETRY_TOKENS = 32;

var CONTINUATION_MODES = ['custom', 'selfimprove', 'multiagent'];

var CONTINUE_TAG_REGEX = /<\|CONTINUE_TASK\|>\s*$|\|CONTINUE_TASK\|\s*$/;

var CONTINUE_MSG_FILE = 'CONTINUE your previous response EXACTLY where you left off. If you were in the middle of a code file, continue that SAME file from the exact cutoff point. Do NOT start a new file unless the previous one was complete. <|CONTINUE_TASK|> if more files remain, end normally if last. No commentary.';

var CONTINUE_MSG_STALL = 'Your output was cut off. CONTINUE from the exact point where you stopped. If mid-code, continue the SAME code block. Do NOT restart or summarize. <|CONTINUE_TASK|> if more remain, end normally if last. No commentary.';

var _lastRequestTime = 0;

/* Track the ORIGINAL user message so auto-continue can maintain file context and intent */
var _originalUserMessage = '';

function getNextFallbackModel(currentModel) {
    if (state.settings.provider !== 'openrouter') return null;
    var fallbackPool = [];
    if (state.verifiedFreeModelIds && state.verifiedFreeModelIds.length > 0) {
        fallbackPool = state.verifiedFreeModelIds.slice();
    } else {
        try { var cached = localStorage.getItem('sai_verified_free_models'); if (cached) fallbackPool = JSON.parse(cached); } catch (e) { }
    }
    if (fallbackPool.length === 0 && FREE_MODEL_FALLBACKS && FREE_MODEL_FALLBACKS.length > 0) {
        fallbackPool = FREE_MODEL_FALLBACKS.slice();
    }
    if (fallbackPool.length === 0) return null;
    if (state.fallbackModelsTried.indexOf(currentModel) === -1) {
        state.fallbackModelsTried = [currentModel];
    }
    for (var i = 0; i < fallbackPool.length; i++) {
        var candidate = fallbackPool[i];
        if (state.fallbackModelsTried.indexOf(candidate) === -1) {
            state.fallbackModelsTried.push(candidate);
            return candidate;
        }
    }
    return null;
}

function resetFallbackTracking() {
    if (state.fallbackModelsTried.length > 1) {
        toast('Switched to ' + state.settings.model, 'success');
        import('./storage.js').then(function (s) { s.saveSettings(); });
        var modelInput = document.getElementById('s-model');
        if (modelInput) modelInput.value = state.settings.model;
    }
    state.fallbackModelsTried = [];
}

function startCooldown(reason) {
    var cfg = getRLConfig();
    var duration = cfg.cooldownMs || 30000;
    state.cooldownUntil = Date.now() + duration;
    var secs = Math.ceil(duration / 1000);
    if (state.cooldownTimer) { clearInterval(state.cooldownTimer); state.cooldownTimer = null; }
    setConnectionStatus('disconnected', 'Cooldown ' + secs + 's');
    setSendButtonCooldown(secs);
    var remaining = secs;
    state.cooldownTimer = setInterval(function() {
        remaining--;
        if (remaining <= 0) {
            clearInterval(state.cooldownTimer); state.cooldownTimer = null; state.cooldownUntil = 0;
            setConnectionStatus('connected', 'Connected — ' + state.settings.model);
            clearSendButtonCooldown();
            if (state.pendingRequest) {
                var pending = state.pendingRequest; state.pendingRequest = null;
                if (pending.type === 'continue') continueResponse();
                else sendMessage(pending.text, false);
            }
        } else {
            setConnectionStatus('disconnected', 'Cooldown ' + remaining + 's');
            setSendButtonCooldown(remaining);
        }
    }, 1000);
}

function isInCooldown() { return state.cooldownUntil > Date.now(); }

function setSendButtonCooldown(secs) {
    var btn = document.getElementById('send-btn');
    if (btn) { btn.classList.add('cooldown'); btn.innerHTML = '<i class="fas fa-hourglass-half"></i> ' + secs + 's'; btn.style.pointerEvents = 'none'; btn.style.opacity = '0.5'; }
    var input = document.getElementById('msg-input');
    if (input) input.setAttribute('readonly', true);
}

function clearSendButtonCooldown() {
    var btn = document.getElementById('send-btn');
    if (btn) { btn.classList.remove('cooldown'); btn.style.pointerEvents = ''; btn.style.opacity = ''; }
    var input = document.getElementById('msg-input');
    if (input) input.removeAttribute('readonly');
    updateSendButton();
}

function getRLConfig() { return RATE_LIMIT_CONFIG[state.settings.provider] || RATE_LIMIT_CONFIG['default']; }

function getFetchTimeout() {
    var cfg = getRLConfig();
    var retryOverhead = 0;
    for (var i = 0; i < cfg.maxRetries; i++) retryOverhead += cfg.baseDelay * Math.pow(cfg.backoffFactor, i);
    return FETCH_TIMEOUT + Math.round(retryOverhead);
}

async function throttleRequest() {
    var cfg = getRLConfig();
    var elapsed = Date.now() - _lastRequestTime;
    var wait = cfg.minInterval - elapsed;
    if (wait > 0) await new Promise(function(r) { setTimeout(r, wait); });
}

async function fetchWithRetry(url, options) {
    var cfg = getRLConfig();
    var lastResponse = null;
    var last429Body = '';
    for (var attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
            var fetchOpts = Object.assign({}, options);
            if (attempt > 0 && state.abortController) fetchOpts.signal = state.abortController.signal;
            var res = await fetch(url, fetchOpts);
            _lastRequestTime = Date.now();
            if (res.status !== 429) return res;
            lastResponse = res;
            last429Body = await res.text().catch(function() { return ''; });
            if (attempt >= cfg.maxRetries) return res;
            var delay = cfg.baseDelay * Math.pow(cfg.backoffFactor, attempt);
            delay += Math.round(Math.random() * delay * 0.3);
            delay = Math.round(delay);
            var retryAfter = res.headers.get('retry-after');
            if (retryAfter) { var serverDelay = parseInt(retryAfter, 10) * 1000; if (serverDelay > 0 && serverDelay < 300000) delay = Math.max(delay, serverDelay); }
            try {
                var parsed429 = JSON.parse(last429Body);
                if (parsed429.error && parsed429.error.details) {
                    for (var d = 0; d < parsed429.error.details.length; d++) {
                        if (parsed429.error.details[d].retryDelay) { var gd = parseInt(parsed429.error.details[d].retryDelay, 10) * 1000; if (gd > 0) delay = Math.max(delay, gd); }
                    }
                }
            } catch (e) { }
            var delaySec = (delay / 1000).toFixed(1);
            console.log('[Connection] 429. Retry #' + (attempt + 1) + '/' + cfg.maxRetries + ' in ' + delaySec + 's');
            toast('Rate limited. Retrying in ' + delaySec + 's...', 'info');
            await new Promise(function(r) { setTimeout(r, delay); });
        } catch (fetchErr) {
            if (fetchErr.name === 'AbortError') throw fetchErr;
            throw fetchErr;
        }
    }
    return lastResponse;
}

function estimateTokens(text) { if (!text) return 0; return Math.ceil(text.length / 3.5); }

function clampMaxTokens(val) {
    if (typeof val !== 'number' || isNaN(val) || val < MIN_MAX_TOKENS) return DEFAULT_MAX_TOKENS;
    if (val > MAX_MAX_TOKENS) return MAX_MAX_TOKENS;
    return val;
}

function getEffectiveMaxTokens(requestedTokens) {
    var clamped = clampMaxTokens(requestedTokens);
    var mode = state.currentMode || '';
    var modeFloor = (MODE_MAX_TOKENS_FLOOR && MODE_MAX_TOKENS_FLOOR[mode]) || 2048;
    if (clamped < modeFloor) return modeFloor;
    return clamped;
}

function parse402Affordable(errText) {
    if (!errText) return null;
    try { var parsed = JSON.parse(errText); var msg = parsed.error && parsed.error.message ? parsed.error.message : ''; if (msg) errText = msg; } catch (e) { }
    var patterns = [/can only afford\s+([\d,]+)/i, /afford\s+up to\s+([\d,]+)/i, /maximum\s+([\d,]+)\s*tokens.*allowed/i, /limit.*?([\d,]+)\s*tokens/i, /quota.*?(\d+)\s*tokens?/i, /exceeded.*?(\d+)\s*tokens?/i, /allow.*?(\d+)\s*tokens?/i, /max.*?(\d{2,})\s*tokens/i];
    for (var i = 0; i < patterns.length; i++) { var match = errText.match(patterns[i]); if (match) { var num = parseInt(match[1].replace(/,/g, ''), 10); if (num && num > 0) return num; } }
    return null;
}

var FALLBACK_RETRY_TOKENS = 128;

function resolveRetryTokens(errText, actualMaxTokens, isRetry) {
    var extracted = parse402Affordable(errText);
    var retryAmount = extracted != null ? Math.max(extracted - TOKEN_402_SAFETY_MARGIN, MIN_RETRY_TOKENS) : FALLBACK_RETRY_TOKENS;
    if (!isRetry && retryAmount < actualMaxTokens) return retryAmount;
    if (isRetry) {
        var safeRetry = Math.max(retryAmount, MIN_RETRY_TOKENS);
        state.settings.maxTokens = safeRetry;
        import('./storage.js').then(function (s) { s.saveSettings(); });
        if (safeRetry <= MIN_RETRY_TOKENS && retryAmount <= MIN_RETRY_TOKENS && extracted == null) return null;
        return safeRetry;
    }
    if (retryAmount >= MIN_MAX_TOKENS) {
        state.settings.maxTokens = retryAmount;
        import('./storage.js').then(function (s) { s.saveSettings(); });
    }
    return null;
}

export function getApiUrl() {
    var endpoint = state.settings.endpoint.replace(/\/+$/, '');
    if (state.settings.provider === 'ollama') return endpoint + '/api/chat';
    if (state.settings.provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
    if (state.settings.provider === 'google-ai') return endpoint + '/chat/completions';
    endpoint = endpoint.replace(/\/v1$/, '');
    return endpoint + '/v1/chat/completions';
}

export function isOllamaProvider() { return state.settings.provider === 'ollama'; }

export function buildPayload(messages, overrideModel, overrideMaxTokens) {
    var model = overrideModel || state.settings.model || 'gpt-3.5-turbo';
    var temperature = state.settings.temperature;
    var maxTokens = getEffectiveMaxTokens(overrideMaxTokens != null ? overrideMaxTokens : state.settings.maxTokens);
    if (isOllamaProvider()) return { model: model, messages: messages, stream: true, options: { temperature: temperature, num_predict: maxTokens } };
    var isReasoning = model.indexOf('deepseek-r1') > -1 || model.indexOf('qwq') > -1 || model.indexOf('o1') > -1 || model.indexOf('reasoner') > -1;
    return { model: model, messages: messages, stream: true, temperature: isReasoning ? 0 : temperature, max_tokens: maxTokens };
}

export function buildHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (state.settings.provider === 'google-ai') { if (state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey; }
    else if (!isOllamaProvider() && state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey;
    if (state.settings.provider === 'openrouter') { h['HTTP-Referer'] = window.location.href; h['X-Title'] = 'S.ai Coding Agent'; }
    return h;
}

function isTrivialMessage(text) {
    var t = text.trim().toLowerCase();
    var greetings = ['hi','hello','hey','hola','yo','sup','howdy','thanks','thank you','thx','ty','cheers','ok','okay','sure','yeah','yep','yes','bye','goodbye','see ya','later','cya','lol','lmao','haha','nice','cool','great'];
    for (var i = 0; i < greetings.length; i++) { if (t === greetings[i]) return true; }
    return false;
}

function isNewProjectRequest(text) {
    var t = text.toLowerCase();
    if (/\bfix\b/.test(t) && /\b(error|bugs?|issues?|broken)\b/.test(t)) return false;
    if (/\b(modify|update|change|refactor|improve)\b/.test(t) && /\b(this|the|existing|current)\b/.test(t)) return false;
    if (/\.js\b|\.py\b|\.html\b|\.css\b|\.ts\b/.test(t) && /\b(file|in|from)\b/.test(t)) return false;
    /* Only match "simple" and "basic" at the START of the message to avoid false positives */
    if (/^(simple|basic)\s+/.test(t)) return true;
    var newWords = ['code a ','code simple ','create a ','build a ','make a ','write a ','design a ','develop a ','new project','new app','new website','new page','new system','landing page'];
    for (var i = 0; i < newWords.length; i++) { if (t.indexOf(newWords[i]) > -1) return true; }
    return false;
}

async function buildSafeSystemPrompt(userText) {
    var sys = state.settings.systemPrompt;
    var ctx = document.getElementById('project-context').value.trim();
    if (ctx) sys += '\n\n--- PROJECT CONTEXT ---\n' + ctx + '\n--- END CONTEXT ---';
    if (isTrivialMessage(userText)) return 'You are S.ai, a helpful assistant. Respond briefly and conversationally.';
    if (isNewProjectRequest(userText)) return sys;
    try {
        var budget = state.settings.contextBudget || 25000;
        var fileCtx = '';
        if (isOllamaProvider()) { var { getFileContext } = await import('./filesystem.js'); fileCtx = getFileContext(); }
        else { var { getSmartFileContext } = await import('./smart-context.js'); fileCtx = await getSmartFileContext(userText, budget); }
        if (fileCtx) { console.log('[Connection] File context: ' + fileCtx.length + ' chars'); sys += '\n\n' + FILE_SYSTEM_INSTRUCTIONS + '\n\n' + fileCtx; }
        else console.log('[Connection] No file context');
    } catch (fsError) { console.warn('[Connection] File context failed:', fsError.message); }
    return sys;
}

function buildSafeMessages(userText, systemPrompt) {
    var sysTokens = estimateTokens(systemPrompt);
    var modelCtxTokens = 128000;
    var modelId = state.settings.model || '';
    if (state.modelContextLimits[modelId]) {
        modelCtxTokens = Math.max(Math.floor(state.modelContextLimits[modelId] / 3.5), 128000);
    } else if (modelId.indexOf(':free') > -1 || modelId.indexOf('/') > -1) {
        modelCtxTokens = 128000;
    } else if (modelId.indexOf('gemini') > -1) {
        modelCtxTokens = 1000000;
    }
    var maxOutputTokens = getEffectiveMaxTokens(state.settings.maxTokens);
    var maxInputTokens = modelCtxTokens - maxOutputTokens;
    var safeLimit = Math.floor(maxInputTokens * 0.85);
    console.log('[Connection] buildSafeMessages: sysTokens=' + sysTokens + ' safeLimit=' + safeLimit + ' modelCtx=' + modelCtxTokens);

    if (sysTokens > safeLimit) {
        console.warn('[Connection] System prompt exceeds limit. Stripping file context.');
        var sys = state.settings.systemPrompt;
        var ctx = document.getElementById('project-context').value.trim();
        if (ctx) sys += '\n\n--- PROJECT CONTEXT ---\n' + ctx + '\n--- END CONTEXT ---';
        if (estimateTokens(sys) <= safeLimit) { systemPrompt = sys; toast('File context stripped.', 'info'); }
        else { systemPrompt = state.settings.systemPrompt; if (estimateTokens(systemPrompt) > safeLimit) { systemPrompt = systemPrompt.substring(0, Math.floor(safeLimit * 3.5)) + '\n\n[Truncated]'; } }
    }

    var remainingTokens = safeLimit - estimateTokens(systemPrompt);
    var historySlice = [];
    for (var i = state.conversationHistory.length - 1; i >= 0; i--) {
        var msgTokens = estimateTokens(state.conversationHistory[i].content);
        if (historySlice.length > 0 && (remainingTokens - msgTokens) < 500) break;
        historySlice.unshift(state.conversationHistory[i]);
        remainingTokens -= msgTokens;
    }
    return [{ role: 'system', content: systemPrompt }].concat(historySlice);
}

/* ═══════════════════════════════════════════════════
   responseSeemsIncomplete — Conservative detection
   
   Only flags STRONG evidence of truncation:
   1. Unclosed code block
   2. Ends with comma/colon in long responses
   3. Ends with a connector/conjunction word
   4. Incomplete conditional paragraph
   5. Last word appears cut off mid-phrase
   
   Does NOT flag just because there's no period.
   ═══════════════════════════════════════════════════ */
function responseSeemsIncomplete(text) {
    if (!text || text.length < 200) return false;

    /* Completion markers — definitely NOT incomplete */
    var completionMarkers = [
        'FILES READY TO APPLY', 'SUMMARY', 'REVIEW BEFORE APPLYING',
        'All files completed', 'Task Complete', 'Task Failed', 'END FILE',
        'Would you like me to', 'Let me know if', 'I hope this helps',
        'Feel free to ask', 'Hope that helps', 'Let me know'
    ];
    for (var i = 0; i < completionMarkers.length; i++) {
        if (text.indexOf(completionMarkers[i]) > -1) return false;
    }

    var trimmed = text.trimEnd();

    /* 1. Unclosed code block */
    var codeBlockCount = 0;
    var codeRe = /```/g;
    while (codeRe.exec(text) !== null) codeBlockCount++;
    if (codeBlockCount % 2 !== 0) {
        console.log('[Connection] Incomplete: unclosed code block');
        return true;
    }

    /* 2. Ends with comma or colon in a long response */
    if (/[,:]\s*$/.test(trimmed) && trimmed.length > 1000) {
        console.log('[Connection] Incomplete: ends with comma/colon');
        return true;
    }

    /* 3. Ends with a connector/conjunction word — anchored to END of full trimmed text */
    if (/\b(and|or|then|also|further|additionally|like|if|when|while|because|since|although|though|unless|until|whether|before|after|between|through|during|without|within|about|into|onto|upon|across|along|around|behind|below|beneath|beside|beyond|despite|except|inside|near|toward|towards|under|unlike|via|with)\s*$/i.test(trimmed)) {
        console.log('[Connection] Incomplete: ends with connector word');
        return true;
    }

    /* 4. Last paragraph is an incomplete conditional — starts with
       "If/When/For/The..." and doesn't end with sentence punctuation */
    if (trimmed.length > 500) {
        var lastNewline = trimmed.lastIndexOf('\n');
        var lastPara = lastNewline > -1 ? trimmed.substring(lastNewline + 1).trim() : trimmed.slice(-150);
        if (lastPara.length > 15 && lastPara.length < 300) {
            var startsConditional = /^(If|When|For|The|This|That|These|Those|Each|Every|Any|All|Some|Most|Both|Neither|Either|Whether|Unless|Until|Although|Though|Because|Since|While|In|On|At|By|From|With|As|To|Note|Remember|Important|Warning|Caution|Tip|Example|Bug|Issue|Problem|Fix|Solution|Result)\b/i.test(lastPara);
            if (startsConditional && !/[.!?]\s*$/.test(lastPara)) {
                console.log('[Connection] Incomplete: last paragraph is an incomplete conditional');
                return true;
            }
        }
    }

    /* 5. Last word appears cut off mid-phrase — the word before it is a
       determiner, preposition, or verb suggesting more was coming */
    if (trimmed.length > 1000) {
        var lastWord = trimmed.split(/\s+/).pop();
        if (lastWord && /^[a-z]+$/.test(lastWord) && lastWord.length >= 2) {
            var validEndWords = ['yes','no','ok','done','thanks','please','here','there','now','today','always','never','sometimes','often','already','enough','too','more','less','much','many','some','all','none','both','either','neither','each','every','first','last','next','previous','true','false','null','undefined','zero','one','fine','right','left','up','down','out','off','over','under','again','away','back','else','home','soon','late','early','hard','easy','fast','slow','well','else','away','together','apart','instead','however','therefore','otherwise','meanwhile','furthermore','moreover','nevertheless','nonetheless','regardless','certainly','definitely','probably','possibly','usually','normally','generally','simply','clearly','obviously','naturally','basically','essentially','ultimately','finally','originally','initially','eventually','recently','previously','currently','immediately','directly','exactly','specifically','particularly','especially','generally','commonly','frequently','rarely','seldom','hardly','scarcely','merely','only','just','also','too','quite','very','rather','fairly','pretty','somewhat','slightly','extremely','incredibly','absolutely','completely','totally','entirely','perfectly','nearly','almost','about','around','approximately','roughly','exactly'];
            var isLastWordValid = validEndWords.indexOf(lastWord.toLowerCase()) > -1;
            if (!isLastWordValid) {
                var words = trimmed.split(/\s+/);
                if (words.length >= 2) {
                    var prevWord = words[words.length - 2];
                    if (/\b(a|an|the|this|that|these|those|my|your|his|her|its|our|their|some|any|no|every|each|all|both|few|many|much|more|most|several|such|what|which|who|whose|than|like|with|without|from|into|about|for|of|in|on|at|to|by|as|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|can|shall|must|need|contains|includes|requires|supports|provides|allows|enables|prevents|avoids|handles|processes|returns|accepts|checks|validates|ensures)\b$/i.test(prevWord)) {
                        console.log('[Connection] Incomplete: ends mid-phrase after "' + prevWord + ' ' + lastWord + '"');
                        return true;
                    }
                }
            }
        }
    }

    return false;
}

async function executeStream(messages, overrideMaxTokens, isAutoContinue) {
    var model = state.settings.model || 'gpt-3.5-turbo';
    var actualMaxTokens = getEffectiveMaxTokens(overrideMaxTokens != null ? overrideMaxTokens : state.settings.maxTokens);

    var totalEstTokens = 0;
    for (var m = 0; m < messages.length; m++) totalEstTokens += estimateTokens(messages[m].content);
    console.log('[Connection] Sending ~' + totalEstTokens + ' input + ' + actualMaxTokens + ' output tokens');

    await throttleRequest();

    state.isStreaming = true;
    state.abortController = new AbortController();
    updateSendButton();

    if (!isAutoContinue) addBotMessageStart();
    else {
        var existingBubble = document.querySelector('.message.bot:last-child .msg-content');
        if (existingBubble) { state.streamElement = existingBubble; state.streamBuffer = existingBubble.textContent; }
        else addBotMessageStart();
    }

    setConnectionStatus('connecting', isAutoContinue ? 'Continuing...' : 'Generating...');
    if (voiceState.isVoiceChat) import('./voice.js').then(function (m) { m.setVoiceMode('thinking'); });

    var thinkingContent = '';
    var isThinkingPhase = false;
    var lastChunkTime = Date.now();
    var finishReason = null;
    var firstTokenReceived = false;
    var abortSource = null;

    var thinkStartTime = Date.now();
    var thinkInterval = isOllamaProvider() ? 2000 : 500;
    var thinkTimer = setInterval(function () {
        if (!firstTokenReceived && state.isStreaming) {
            var elapsed = ((Date.now() - thinkStartTime) / 1000).toFixed(0);
            setConnectionStatus('connecting', isAutoContinue ? 'Continuing... ' + elapsed + 's' : 'Thinking... ' + elapsed + 's');
        }
    }, thinkInterval);

    var currentFetchTimeout = getFetchTimeout();
    var fetchTimeoutId = setTimeout(function () {
        if (state.isStreaming && state.abortController) { abortSource = 'timeout'; state.abortController.abort(); }
    }, currentFetchTimeout);

    var stallWatchdog = setInterval(function () {
        if (state.isStreaming && firstTokenReceived && (Date.now() - lastChunkTime > STREAM_STALL_TIMEOUT)) {
            abortSource = 'stall'; if (state.abortController) state.abortController.abort();
        }
    }, isOllamaProvider() ? 10000 : 5000);

    var originalAbort = state.abortController.abort.bind(state.abortController);
    state.abortController.abort = function () { if (!abortSource) abortSource = 'user'; originalAbort(); };

    try {
        var res = await fetchWithRetry(getApiUrl(), { method: 'POST', headers: buildHeaders(), body: JSON.stringify(buildPayload(messages, null, actualMaxTokens)), signal: state.abortController.signal });
        clearTimeout(fetchTimeoutId); fetchTimeoutId = null;

        /* ── 402 ── */
        if (res.status === 402) {
            var err402Text = await res.text().catch(function () { return ''; });
            var retryTokens = resolveRetryTokens(err402Text, actualMaxTokens, overrideMaxTokens != null);
            if (retryTokens != null) {
                clearInterval(stallWatchdog); if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
                var sm402 = document.getElementById('streaming-msg'); if (sm402 && !isAutoContinue) sm402.remove();
                state.isStreaming = false; state.streamElement = null; state.streamBuffer = ''; state.thinkingContent = '';
                toast('Tier limit. Retrying with ' + retryTokens + ' tokens...', 'info');
                await new Promise(function (r) { setTimeout(r, 800); });
                return executeStream(messages, retryTokens, isAutoContinue);
            }
            throw new Error('INSUFFICIENT_CREDITS: Balance too low.');
        }

        /* ── 429 ── */
        if (res.status === 429) {
            var err429Text = await res.text().catch(function () { return ''; });
            if (state.settings.provider === 'openrouter') {
                var fallbackModel = getNextFallbackModel(state.settings.model);
                if (fallbackModel) {
                    clearInterval(stallWatchdog); if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
                    var sm429 = document.getElementById('streaming-msg'); if (sm429 && !isAutoContinue) sm429.remove();
                    state.isStreaming = false; state.streamElement = null; state.streamBuffer = ''; state.thinkingContent = '';
                    var originalModel = state.settings.model; state.settings.model = fallbackModel;
                    await new Promise(function (r) { setTimeout(r, 1500); });
                    try { return executeStream(messages, overrideMaxTokens, isAutoContinue); }
                    catch (fallbackErr) {
                        state.settings.model = originalModel;
                        var fbErrMsg = (fallbackErr.message || '').toLowerCase();
                        if (fbErrMsg.indexOf('404') > -1) {
                            var nextFb = getNextFallbackModel(fallbackModel);
                            if (nextFb) { state.settings.model = nextFb; await new Promise(function (r) { setTimeout(r, 2000); }); try { return executeStream(messages, overrideMaxTokens, isAutoContinue); } catch (e2) { state.settings.model = originalModel; } }
                        }
                        throw new Error('RATE_LIMIT: Fallback failed.');
                    }
                }
            }
            state.activeTask.isRunning = false; state.activeTask.loopCount = 0; state.isStreaming = false; state.streamElement = null; state.streamBuffer = '';
            updateSendButton(); startCooldown('429 exhausted');
            if (!isAutoContinue) state.pendingRequest = { type: 'message', text: _originalUserMessage };
            return;
        }

        /* ── Other HTTP errors ── */
        if (!res.ok) {
            var errText = await res.text().catch(function () { return ''; }); var status = res.status;
            if (status === 401 || status === 403) throw new Error('AUTH_ERROR:' + status);
            if (status === 502 || status === 503 || status === 504) throw new Error('SERVER_OVERLOAD:' + status);
            if (status >= 500) throw new Error('SERVER_ERROR:' + status);
            throw new Error('HTTP ' + status + ': ' + errText.substring(0, 300));
        }

        /* ═════════════════════════
           STREAM READING
           ═════════════════════════ */
        resetFallbackTracking();
        var reader = res.body.getReader();
        var decoder = new TextDecoder();

        while (true) {
            var result = await reader.read();
            if (result.done) break;
            if (!firstTokenReceived) { firstTokenReceived = true; clearInterval(thinkTimer); thinkTimer = null; }
            lastChunkTime = Date.now();
            var chunk = decoder.decode(result.value, { stream: true });

            if (isOllamaProvider()) {
                var lines = chunk.split('\n').filter(function (l) { return l.trim(); });
                for (var i = 0; i < lines.length; i++) { try { var d = JSON.parse(lines[i]); if (d.message && d.message.content) appendStreamChunk(d.message.content); if (d.done) finishReason = 'stop'; } catch (e) { } }
            } else {
                var sseLines = chunk.split('\n');
                for (var j = 0; j < sseLines.length; j++) {
                    if (!sseLines[j].startsWith('data: ')) continue;
                    var data = sseLines[j].slice(6).trim();
                    if (data === '[DONE]') continue;
                    try {
                        var parsed = JSON.parse(data);
                        if (!parsed.choices || !parsed.choices[0]) continue;
                        var delta = parsed.choices[0].delta;
                        if (parsed.choices[0].finish_reason) finishReason = parsed.choices[0].finish_reason;
                        var reasoning = delta.reasoning_content || delta.reasoning || delta.thinking || null;
                        var content = delta.content || null;
                        if (reasoning) { if (!isThinkingPhase) isThinkingPhase = true; thinkingContent += reasoning; showThinkingBlock(thinkingContent); }
                        if (content) appendStreamChunk(content);
                    } catch (e) { }
                }
            }
        }

        state.thinkingContent = thinkingContent;
        if (isThinkingPhase) closeThinkingBlock();
        finalizeStream();
        clearInterval(stallWatchdog); if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }

        /* ═══════════════════════════════════════════════════
           TRUNCATION DETECTION
           ═══════════════════════════════════════════════════ */
        var hitLimit = (finishReason === 'length');
        var lastResponse = state.conversationHistory[state.conversationHistory.length - 1];
        var hasContinueTag = lastResponse && CONTINUE_TAG_REGEX.test(lastResponse.content);

        if (hasContinueTag) {
            lastResponse.content = lastResponse.content.replace(/<\|CONTINUE_TASK\|>\s*$|\|CONTINUE_TASK\|\s*$/, '').trimEnd();
            hitLimit = true;
            console.log('[Connection] <|CONTINUE_TASK|> detected — auto-continuing');
        }

        var seemsIncomplete = false;
        if (!hitLimit && lastResponse && responseSeemsIncomplete(lastResponse.content)) {
            seemsIncomplete = true;
            hitLimit = true;
        }

        /* Auto-continue: only for finish_reason='length' or <|CONTINUE_TASK|>,
           NOT for "seemsIncomplete" (that just shows the Continue button).
           Cap at 3 loops to prevent 429 death spirals on free tier. */
        var shouldAutoContinue = (hitLimit && !seemsIncomplete) && state.activeTask.isRunning && state.activeTask.loopCount < 3;

        if (shouldAutoContinue) {
            state.activeTask.loopCount++;
            toast('Continuing (' + state.activeTask.loopCount + '/3)...', 'info');
            setConnectionStatus('connecting', 'Continuing...');

            state.conversationHistory.push({ role: 'user', content: CONTINUE_MSG_FILE });

            /* Trim conversation history to prevent unbounded growth */
            if (state.conversationHistory.length > 16) {
                var sysMsg = state.conversationHistory[0];
                var recent = state.conversationHistory.slice(-14);
                state.conversationHistory = [sysMsg].concat(recent);
                console.log('[Connection] Trimmed conversation to ' + state.conversationHistory.length + ' messages');
            }

            var continueDelay = getRLConfig().continueDelay;
            setTimeout(function () { sendMessage('', true); }, continueDelay);
        } else {
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            updateSendButton();
            setConnectionStatus('connected', 'Connected — ' + state.settings.model);

            if (hitLimit) {
                state.responseTruncated = true;
                if (seemsIncomplete) {
                    toast('Response may be incomplete. Click Continue to resume.', 'info');
                } else {
                    toast('Response truncated. Click Continue or type /continue', 'info');
                }
                showContinueButton();
            }
            if (state.conversationHistory.length > 30) state.conversationHistory = state.conversationHistory.slice(-20);
        }

    } catch (error) {
        state.thinkingContent = thinkingContent;
        closeThinkingBlock();
        clearInterval(stallWatchdog); if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }

        if (error.name === 'AbortError') {
            finalizeStream();
            if (abortSource === 'timeout') {
                state.activeTask.isRunning = false; state.activeTask.loopCount = 0; state.isStreaming = false; updateSendButton();
                toast('Request timed out.', 'error'); setConnectionStatus('disconnected', 'Timeout');
            } else if (abortSource === 'stall') {
                var stallLast = state.conversationHistory[state.conversationHistory.length - 1];
                var stallTag = stallLast && CONTINUE_TAG_REGEX.test(stallLast.content);
                if (stallTag) stallLast.content = stallLast.content.replace(/<\|CONTINUE_TASK\|>\s*$|\|CONTINUE_TASK\|\s*$/, '').trimEnd();
                state.activeTask.isRunning = false; state.activeTask.loopCount = 0; state.isStreaming = false; updateSendButton();
                toast('Stream stalled.', 'error'); setConnectionStatus('connected', 'Connected — ' + state.settings.model);
            } else {
                state.activeTask.isRunning = false; state.activeTask.loopCount = 0; state.isStreaming = false; updateSendButton();
                toast('Stopped', 'info'); setConnectionStatus('connected', 'Connected — ' + state.settings.model);
            }
            return;
        }

        var errMsg = error.message || '';
        if (errMsg.indexOf('INSUFFICIENT_CREDITS:') === 0) { state.activeTask.isRunning = false; state.isStreaming = false; updateSendButton(); toast('Insufficient credits.', 'error'); setConnectionStatus('disconnected', 'No Credits'); }
        else if (errMsg.indexOf('RATE_LIMIT:') === 0) { state.activeTask.isRunning = false; state.isStreaming = false; updateSendButton(); startCooldown('rate limit'); toast('Rate limited. Cooling down.', 'error'); }
        else if (errMsg.indexOf('AUTH_ERROR:') === 0) { state.activeTask.isRunning = false; state.isStreaming = false; updateSendButton(); toast('Auth failed.', 'error'); setConnectionStatus('disconnected', 'Auth Error'); }
        else if (errMsg.indexOf('SERVER_OVERLOAD:') === 0) { state.activeTask.isRunning = false; state.isStreaming = false; updateSendButton(); toast('Server overloaded.', 'error'); }
        else if (errMsg.indexOf('SERVER_ERROR:') === 0) { state.activeTask.isRunning = false; state.isStreaming = false; updateSendButton(); toast('Server error.', 'error'); }
        else { state.activeTask.isRunning = false; state.isStreaming = false; updateSendButton(); toast(errMsg.indexOf('Failed to fetch') > -1 ? 'Cannot reach endpoint.' : errMsg.substring(0, 100), 'error'); setConnectionStatus('disconnected', 'Error'); }
        if (voiceState.isVoiceChat) import('./voice.js').then(function (m) { m.setVoiceMode('idle'); });

    } finally {
        clearInterval(stallWatchdog); if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
        if (fetchTimeoutId) { clearTimeout(fetchTimeoutId); fetchTimeoutId = null; }
        if (state.isStreaming && !state.activeTask.isRunning) { state.isStreaming = false; updateSendButton(); }
    }
}

export async function sendMessage(userText, isAutoContinue) {
    try {
        if (state.isStreaming && !isAutoContinue) {
            if (state.abortController) state.abortController.abort();
            state.abortController = null; state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
            return;
        }
        if (!isAutoContinue && isInCooldown()) {
            var remainingSecs = Math.ceil((state.cooldownUntil - Date.now()) / 1000);
            toast('Rate limited. Auto-sending in ' + remainingSecs + 's...', 'info');
            state.pendingRequest = { type: 'message', text: userText };
            return;
        }
        if (!isAutoContinue) {
            if (!userText.trim()) return;
            if (state.responseTruncated && /^continue$/i.test(userText.trim())) { continueResponse(); return; }
            if (state.settings.provider !== 'ollama' && !state.settings.apiKey) { toast('No API key.', 'error'); return; }
            if (!state.settings.model) { toast('No model.', 'error'); return; }

            _originalUserMessage = userText;

            addUserMessage(userText);
            state.conversationHistory.push({ role: 'user', content: userText });
            state.responseTruncated = false;
            removeContinueButton();
            state.activeTask.isRunning = CONTINUATION_MODES.indexOf(state.currentMode) !== -1;
            state.activeTask.loopCount = 0;
        }

        var contextMessage = isAutoContinue ? _originalUserMessage : userText;
        var systemPrompt = await buildSafeSystemPrompt(contextMessage || '');
        var messages = buildSafeMessages(contextMessage || '', systemPrompt);
        return executeStream(messages, null, isAutoContinue);
    } catch (fatalError) {
        console.error('[Connection] FATAL:', fatalError);
        state.isStreaming = false; state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
        state.streamElement = null; state.streamBuffer = '';
        updateSendButton(); setConnectionStatus('connected', 'Connected — ' + (state.settings.model || ''));
        toast('Error: ' + (fatalError.message || '').substring(0, 100), 'error');
    }
}

export async function continueResponse() {
    if (state.isStreaming) { toast('Wait for current response.', 'info'); return; }
    if (!state.responseTruncated) { toast('Nothing to continue.', 'info'); return; }
    state.responseTruncated = false;
    removeContinueButton();

    if (CONTINUATION_MODES.indexOf(state.currentMode) !== -1) {
        state.activeTask.isRunning = true;
        if (state.activeTask.loopCount === 0) state.activeTask.loopCount = 1;
    }

    state.conversationHistory.push({ role: 'user', content: 'Continue exactly where you left off. Do not repeat anything already said.' });
    toast('Continuing...', 'info');

    try {
        var systemPrompt = await buildSafeSystemPrompt(_originalUserMessage || '');
        var messages = buildSafeMessages(_originalUserMessage || '', systemPrompt);
        return executeStream(messages, null, true);
    } catch (err) {
        state.isStreaming = false; state.activeTask.isRunning = false; updateSendButton();
        toast('Continue failed: ' + (err.message || '').substring(0, 100), 'error');
    }
}

function showThinkingBlock(text) {
    if (!state.streamElement) return;
    var display = text.length > 800 ? '...' + text.slice(-800) : text;
    display = display.replace(/\n/g, '<br>');
    var existing = document.getElementById('sai-thinking-block');
    if (existing) { existing.querySelector('.thinking-text').innerHTML = display; }
    else {
        var block = document.createElement('div'); block.id = 'sai-thinking-block'; block.className = 'thinking-block';
        block.innerHTML = '<div class="thinking-header"><span class="thinking-label"><i class="fas fa-brain"></i> Thinking...</span></div><div class="thinking-text">' + display + '</div>';
        state.streamElement.insertBefore(block, state.streamElement.firstChild);
    }
}

function closeThinkingBlock() {
    var existing = document.getElementById('sai-thinking-block');
    if (existing) {
        var label = existing.querySelector('.thinking-label');
        if (label) { var secs = Math.max(1, Math.round((state.thinkingContent || '').length / 15)); label.innerHTML = '<i class="fas fa-brain"></i> Thought for ' + (secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm'); }
    }
}

export async function testConnection() {
    var provider = state.settings.provider; var apiKey = state.settings.apiKey; var model = state.settings.model;
    if (provider !== 'ollama' && !apiKey) { toast('Enter API key.', 'error'); return false; }
    if (!model) { toast('Select a model.', 'error'); return false; }
    setConnectionStatus('connecting', 'Testing...'); toast('Testing...', 'info');
    try {
        var h = { 'Content-Type': 'application/json' };
        if (provider === 'google-ai') { if (apiKey) h['Authorization'] = 'Bearer ' + apiKey; } else if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
        if (provider === 'openrouter') { h['HTTP-Referer'] = window.location.href; h['X-Title'] = 'S.ai Coding Agent'; }
        var body = provider === 'ollama' ? JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Hi' }], stream: false }) : JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 });
        var r = await fetchWithRetry(getApiUrl(), { method: 'POST', headers: h, body: body });
        if (r.status === 429) { setConnectionStatus('connected', 'Connected — ' + model + ' (rate limited)'); toast('Works but rate limited.', 'info'); return true; }
        if (!r.ok) { var e = await r.text().catch(function () { return ''; }); if (r.status === 401 || r.status === 403) throw new Error('Auth failed.'); throw new Error('HTTP ' + r.status); }
        var d = await r.json();
        if ((provider === 'ollama' && d.message && d.message.content) || (d.choices && d.choices[0] && d.choices[0].message)) { setConnectionStatus('connected', 'Connected — ' + model); toast('Connected!', 'success'); return true; }
        throw new Error('Unexpected response');
    } catch (error) { toast(error.message.indexOf('Failed to fetch') > -1 ? 'Cannot reach endpoint.' : error.message, 'error'); setConnectionStatus('disconnected', 'Failed'); return false; }
}

export async function fetchModels() {
    var provider = state.settings.provider; var listEl = document.getElementById('s-models-list'); var btn = document.getElementById('s-fetch-models');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true;
    try {
        if (provider === 'openrouter') { await fetchOpenRouterModels(); return; }
        if (provider === 'google-ai') { await fetchGoogleAIModels(); return; }
        var url, h = {};
        if (provider === 'ollama') url = state.settings.endpoint + '/api/tags';
        else { url = state.settings.endpoint.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/models'; if (state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey; }
        var r = await fetch(url, { headers: h }); if (!r.ok) throw new Error('HTTP ' + r.status);
        var d = await r.json(); var models = provider === 'ollama' ? (d.models || []).map(function (m) { return m.name; }) : (d.data || []).map(function (m) { return m.id; });
        if (!models.length) { toast('No models found.', 'error'); listEl.style.display = 'none'; }
        else { listEl.innerHTML = models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join(''); listEl.style.display = 'block'; toast(models.length + ' models found', 'success'); }
    } catch (e) { toast('Failed: ' + e.message, 'error'); listEl.style.display = 'none'; }
    finally { btn.innerHTML = '<i class="fas fa-refresh"></i> Fetch Models'; btn.disabled = false; }
}

async function fetchGoogleAIModels() {
    var listEl = document.getElementById('s-models-list');
    var geminiModels = [
        { id: 'models/gemini-2.0-flash', name: 'Gemini 2.0 Flash [FREE]', ctx: 1048576 },
        { id: 'models/gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash [FREE]', ctx: 1048576 },
        { id: 'models/gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro [FREE]', ctx: 2097152 }
    ];
    var html = '<option disabled style="color:var(--accent);font-weight:700">── 🌐 Gemini ──</option>';
    for (var i = 0; i < geminiModels.length; i++) { html += '<option value="' + geminiModels[i].id + '">' + geminiModels[i].name + '</option>'; state.modelContextLimits[geminiModels[i].id] = Math.floor(geminiModels[i].ctx * 3.5); }
    listEl.innerHTML = html; listEl.style.display = 'block';
    toast(geminiModels.length + ' Gemini models', 'success');
}

function isModelFree(m) { if (!m || !m.pricing) return false; var p = m.pricing; return (p.prompt === '0' || parseFloat(p.prompt) === 0) && (p.completion === '0' || parseFloat(p.completion) === 0); }

async function fetchOpenRouterModels() {
    var listEl = document.getElementById('s-models-list'); var h = { 'Content-Type': 'application/json' }; if (state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey;
    try {
        var r = await fetch('https://openrouter.ai/api/v1/models', { headers: h });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var d = await r.json(); var allModels = d.data || [];
        for (var x = 0; x < allModels.length; x++) { if (allModels[x].context_length) state.modelContextLimits[allModels[x].id] = Math.floor(allModels[x].context_length * 3.5); }
        var trulyFree = allModels.filter(isModelFree);
        state.verifiedFreeModelIds = trulyFree.map(function (m) { return m.id; });
        try { localStorage.setItem('sai_verified_free_models', JSON.stringify(state.verifiedFreeModelIds)); } catch (e) { }
        var topTierIds = ['xiaomi/mimo-v2-pro:free','minimax/minimax-m2.7:free','minimax/minimax-m2.5:free','nvidia/nemotron-3-super:free','google/gemma-3-27b-it:free','meta-llama/llama-4-scout:free','deepseek/deepseek-chat-v3-0324:free','qwen/qwen3-235b-a22b:free','qwen/qwen3-coder:free'];
        var topTierModels = [];
        for (var t = 0; t < topTierIds.length; t++) { var found = trulyFree.find(function (m) { return m.id === topTierIds[t]; }); if (!found) found = trulyFree.find(function (m) { return m.id === topTierIds[t].replace(':free',''); }); if (found) topTierModels.push(found); }
        var topTierIdSet = {}; topTierModels.forEach(function(m) { topTierIdSet[m.id] = true; });
        var freeModels = trulyFree.filter(function (m) { return !topTierIdSet[m.id]; }).sort(function (a, b) { return a.id.localeCompare(b.id); });
        var html = '';
        if (topTierModels.length > 0) { html += '<option disabled style="color:var(--accent);font-weight:700">── 🔥 Top Free ──</option>'; topTierModels.forEach(function(m) { html += '<option value="' + m.id + '">' + m.id + '</option>'; }); }
        if (freeModels.length > 0) { html += '<option disabled style="color:var(--green);font-weight:700">── Other Free ──</option>'; freeModels.forEach(function(m) { html += '<option value="' + m.id + '">' + m.id + '</option>'; }); }
        listEl.innerHTML = html; listEl.style.display = 'block';
        toast(topTierModels.length + ' top + ' + freeModels.length + ' free models', 'success');
    } catch (e) { toast('Failed: ' + e.message, 'error'); listEl.style.display = 'none'; }
}

function formatCtx(n) { if (!n) return ''; if (n >= 1000000) return ' ~' + (n/1000000).toFixed(0) + 'M'; if (n >= 1000) return ' ~' + (n/1000).toFixed(0) + 'K'; return ''; }

export function showOpenRouterModels() { fetchOpenRouterModels(); }