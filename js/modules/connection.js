/* ═══════════════════════════════════════════════════
   CONNECTION — LLM API calls, streaming
   ═══════════════════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { FILE_SYSTEM_INSTRUCTIONS, FREE_MODEL_FALLBACKS } from './config.js';
import {
    removeWelcome, addUserMessage, addBotMessageStart,
    appendStreamChunk, finalizeStream, updateSendButton, showContinueButton, removeContinueButton
} from './messages.js';
import { setConnectionStatus, toast } from './ui.js';

/* ═══════════════════════════════════════════════════
   RATE LIMIT CONFIG — per-provider retry behavior
   ═══════════════════════════════════════════════════ */
var RATE_LIMIT_CONFIG = {
    'google-ai':   { baseDelay: 15000, maxRetries: 5, backoffFactor: 2.0, minInterval: 5000, continueDelay: 8000, cooldownMs: 60000 },
    'openrouter':  { baseDelay: 8000,  maxRetries: 4, backoffFactor: 2.0, minInterval: 3500, continueDelay: 4000, cooldownMs: 45000 },
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
var DEFAULT_MAX_TOKENS = 2048;
var TOKEN_402_SAFETY_MARGIN = 150;
var MIN_RETRY_TOKENS = 32;

var CONTINUATION_MODES = ['custom', 'selfimprove', 'multiagent'];

var CONTINUE_MSG_FILE = 'OUTPUT NEXT FILE: One file block only. <|CONTINUE_TASK|> if more files remain, end normally if last. No commentary.';

var CONTINUE_MSG_STALL = 'OUTPUT NEXT FILE: Previous output cut off. One file block only. <|CONTINUE_TASK|> if more remain, end normally if last. No commentary.';

/* ── Track last request time for client-side throttling ── */
var _lastRequestTime = 0;

/* ═══════════════════════════════════════════════════
   AUTO MODEL FALLBACK — Picks next free model to try
   ═══════════════════════════════════════════════════ */
function getNextFallbackModel(currentModel) {
    if (!FREE_MODEL_FALLBACKS || FREE_MODEL_FALLBACKS.length === 0) return null;
    if (state.settings.provider !== 'openrouter') return null;

    /* Reset fallback tracking if this is a fresh request (not already in fallback chain) */
    if (state.fallbackModelsTried.indexOf(currentModel) === -1) {
        state.fallbackModelsTried = [currentModel];
    }

    for (var i = 0; i < FREE_MODEL_FALLBACKS.length; i++) {
        var candidate = FREE_MODEL_FALLBACKS[i];
        if (state.fallbackModelsTried.indexOf(candidate) === -1) {
            state.fallbackModelsTried.push(candidate);
            console.log('[Connection] Fallback chain: [' + state.fallbackModelsTried.join(', ') + ']');
            return candidate;
        }
    }

    /* All fallbacks exhausted — return null to trigger cooldown */
    console.warn('[Connection] All ' + FREE_MODEL_FALLBACKS.length + ' fallback models exhausted');
    return null;
}

/* Reset fallback tracking when a request succeeds */
function resetFallbackTracking() {
    if (state.fallbackModelsTried.length > 1) {
        console.log('[Connection] Request succeeded with fallback model: ' + state.settings.model);
    }
    state.fallbackModelsTried = [];
}

/* ═══════════════════════════════════════════════════
   COOLDOWN — Locks input after 429 exhaustion
   ═══════════════════════════════════════════════════ */
function startCooldown(reason) {
    var cfg = getRLConfig();
    var duration = cfg.cooldownMs || 30000;
    state.cooldownUntil = Date.now() + duration;
    var secs = Math.ceil(duration / 1000);

    console.log('[Connection] Starting ' + secs + 's cooldown: ' + reason);

    /* Clear any existing timer */
    if (state.cooldownTimer) { clearInterval(state.cooldownTimer); state.cooldownTimer = null; }

    /* Update UI immediately */
    setConnectionStatus('disconnected', 'Cooldown ' + secs + 's');
    setSendButtonCooldown(secs);

    /* Countdown timer — updates every second */
    var remaining = secs;
    state.cooldownTimer = setInterval(function() {
        remaining--;
        if (remaining <= 0) {
            clearInterval(state.cooldownTimer);
            state.cooldownTimer = null;
            state.cooldownUntil = 0;
            console.log('[Connection] Cooldown ended');
            setConnectionStatus('connected', 'Connected — ' + state.settings.model);
            clearSendButtonCooldown();
            /* If there's a queued request, send it now */
            if (state.pendingRequest) {
                var pending = state.pendingRequest;
                state.pendingRequest = null;
                console.log('[Connection] Sending queued request after cooldown');
                if (pending.type === 'continue') {
                    continueResponse();
                } else {
                    sendMessage(pending.text, false);
                }
            }
        } else {
            setConnectionStatus('disconnected', 'Cooldown ' + remaining + 's');
            setSendButtonCooldown(remaining);
        }
    }, 1000);
}

function isInCooldown() {
    return state.cooldownUntil > Date.now();
}

function setSendButtonCooldown(secs) {
    var btn = document.getElementById('send-btn');
    if (btn) {
        btn.classList.add('cooldown');
        btn.innerHTML = '<i class="fas fa-hourglass-half"></i> ' + secs + 's';
        btn.title = 'Rate limited — wait ' + secs + 's';
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.5';
    }
    /* Also disable the input */
    var input = document.getElementById('msg-input');
    if (input) input.setAttribute('readonly', true);
}

function clearSendButtonCooldown() {
    var btn = document.getElementById('send-btn');
    if (btn) {
        btn.classList.remove('cooldown');
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
    }
    var input = document.getElementById('msg-input');
    if (input) input.removeAttribute('readonly');
    /* Let updateSendButton reset the icon */
    updateSendButton();
}

function getRLConfig() {
    return RATE_LIMIT_CONFIG[state.settings.provider] || RATE_LIMIT_CONFIG['default'];
}

function getFetchTimeout() {
    var cfg = getRLConfig();
    /* Add extra time to accommodate retries (each retry can take baseDelay * backoffFactor^attempt) */
    var retryOverhead = 0;
    for (var i = 0; i < cfg.maxRetries; i++) {
        retryOverhead += cfg.baseDelay * Math.pow(cfg.backoffFactor, i);
    }
    return FETCH_TIMEOUT + Math.round(retryOverhead);
}

/* ── Client-side throttle — ensures minimum interval between requests ── */
async function throttleRequest() {
    var cfg = getRLConfig();
    var elapsed = Date.now() - _lastRequestTime;
    var wait = cfg.minInterval - elapsed;
    if (wait > 0) {
        console.log('[Connection] Throttling: waiting ' + wait + 'ms (min interval ' + cfg.minInterval + 'ms)');
        await new Promise(function(r) { setTimeout(r, wait); });
    }
}

/* ═══════════════════════════════════════════════════
   FETCH WITH RATE-LIMIT RETRY
   Exponential backoff with jitter for 429 responses.
   Returns a non-429 response, or the last 429 if
   all retries are exhausted.
   ═══════════════════════════════════════════════════ */
async function fetchWithRetry(url, options) {
    var cfg = getRLConfig();
    var lastResponse = null;
    var last429Body = '';

    for (var attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
            var fetchOpts = Object.assign({}, options);
            /* On retry, create a fresh AbortController if the old one was consumed */
            if (attempt > 0 && state.abortController) {
                /* Keep using the same abort controller so user-cancel still works */
                fetchOpts.signal = state.abortController.signal;
            }

            var res = await fetch(url, fetchOpts);
            _lastRequestTime = Date.now();

            if (res.status !== 429) return res;

            /* ── 429 received ── */
            lastResponse = res;
            last429Body = await res.text().catch(function() { return ''; });

            if (attempt >= cfg.maxRetries) {
                console.warn('[Connection] 429 rate limit: all ' + cfg.maxRetries + ' retries exhausted');
                return res; /* Caller will handle the 429 */
            }

            /* Calculate delay with exponential backoff + jitter */
            var delay = cfg.baseDelay * Math.pow(cfg.backoffFactor, attempt);
            /* Add 0-30% jitter to prevent thundering herd */
            delay += Math.round(Math.random() * delay * 0.3);
            delay = Math.round(delay);

            /* Check Retry-After header — server knows best */
            var retryAfter = res.headers.get('retry-after');
            if (retryAfter) {
                var serverDelay = parseInt(retryAfter, 10) * 1000;
                if (serverDelay > 0 && serverDelay < 300000) { /* Cap at 5 minutes */
                    delay = Math.max(delay, serverDelay);
                }
            }

            /* Try to parse quota reset time from Google AI error body */
            try {
                var parsed429 = JSON.parse(last429Body);
                if (parsed429.error && parsed429.error.details) {
                    for (var d = 0; d < parsed429.error.details.length; d++) {
                        var detail = parsed429.error.details[d];
                        if (detail['@type'] && detail['@type'].indexOf('QuotaFailure') > -1) {
                            /* Google AI often includes retry delay in error details */
                        }
                        if (detail.retryDelay) {
                            var googleDelay = parseInt(detail.retryDelay, 10) * 1000;
                            if (googleDelay > 0) delay = Math.max(delay, googleDelay);
                        }
                    }
                }
            } catch (e) { /* Not JSON or no details — use calculated delay */ }

            var delaySec = (delay / 1000).toFixed(1);
            console.log('[Connection] 429 rate limited. Retry #' + (attempt + 1) + '/' + cfg.maxRetries + ' in ' + delaySec + 's');
            setConnectionStatus('disconnected', 'Rate limited — retry #' + (attempt + 1) + ' in ' + delaySec + 's');
            toast('Rate limited. Retrying in ' + delaySec + 's (attempt ' + (attempt + 1) + '/' + cfg.maxRetries + ')...', 'info');

            await new Promise(function(r) { setTimeout(r, delay); });

        } catch (fetchErr) {
            /* AbortError = user cancelled or timeout — don't retry */
            if (fetchErr.name === 'AbortError') throw fetchErr;
            /* Network error on retry — throw */
            if (attempt > 0) throw fetchErr;
            /* First attempt network error — let caller handle */
            throw fetchErr;
        }
    }

    return lastResponse;
}

function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
}

function clampMaxTokens(val) {
    if (typeof val !== 'number' || isNaN(val) || val < MIN_MAX_TOKENS) return DEFAULT_MAX_TOKENS;
    if (val > MAX_MAX_TOKENS) return MAX_MAX_TOKENS;
    return val;
}

/* ═══════════════════════════════════════
   402 PARSER — Always extracts a number, floors at minimum
   ═══════════════════════════════════════ */
function parse402Affordable(errText) {
    if (!errText) return null;
    try {
        var parsed = JSON.parse(errText);
        var msg = parsed.error && parsed.error.message ? parsed.error.message : '';
        if (msg) errText = msg;
    } catch (e) { }
    var patterns = [
        /can only afford\s+([\d,]+)/i,
        /afford\s+up to\s+([\d,]+)/i,
        /maximum\s+([\d,]+)\s*tokens.*allowed/i,
        /limit.*?([\d,]+)\s*tokens/i,
        /quota.*?(\d+)\s*tokens?/i,
        /exceeded.*?(\d+)\s*tokens?/i,
        /allow.*?(\d+)\s*tokens?/i,
        /max.*?(\d{2,})\s*tokens/i
    ];
    for (var i = 0; i < patterns.length; i++) {
        var match = errText.match(patterns[i]);
        if (match) {
            var num = parseInt(match[1].replace(/,/g, ''), 10);
            if (num && num > 0) return num;
        }
    }
    return null;
}

/* ═══════════════════════════════════════════════════
   402 HANDLER — Always retries at least once
   ═══════════════════════════════════════════════════ */
var FALLBACK_RETRY_TOKENS = 128;

function resolveRetryTokens(errText, actualMaxTokens, isRetry) {
    var extracted = parse402Affordable(errText);
    var retryAmount = extracted != null
        ? Math.max(extracted - TOKEN_402_SAFETY_MARGIN, MIN_RETRY_TOKENS)
        : FALLBACK_RETRY_TOKENS;

    /* First attempt: retry with reduced tokens if possible */
    if (!isRetry && retryAmount < actualMaxTokens) {
        return retryAmount;
    }

    /* Retry attempt: try one more time with a safe free-tier value instead of giving up */
    if (isRetry) {
        var safeRetry = Math.max(retryAmount, MIN_RETRY_TOKENS);
        /* Persist the reduced value so future requests don't hit the same wall */
        state.settings.maxTokens = safeRetry;
        import('./storage.js').then(function (s) { s.saveSettings(); });
        var tokensInput = document.getElementById('q-tokens');
        if (tokensInput) tokensInput.value = safeRetry;
        console.warn('[Connection] 402 retry: persisted maxTokens=' + safeRetry);
        /* Only give up if we're already at the absolute minimum */
        if (safeRetry <= MIN_RETRY_TOKENS && retryAmount <= MIN_RETRY_TOKENS && extracted == null) {
            return null;
        }
        return safeRetry;
    }

    /* Non-retry fallback: persist if reasonable */
    if (retryAmount >= MIN_MAX_TOKENS) {
        state.settings.maxTokens = retryAmount;
        import('./storage.js').then(function (s) { s.saveSettings(); });
        var tokensInput2 = document.getElementById('q-tokens');
        if (tokensInput2) tokensInput2.value = retryAmount;
    }
    return null;
}

export function getApiUrl() {
    var endpoint = state.settings.endpoint.replace(/\/+$/, '');
    if (state.settings.provider === 'ollama') return endpoint + '/api/chat';
    if (state.settings.provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
    /* Google AI Studio endpoint already ends with /openai — just append /chat/completions */
    if (state.settings.provider === 'google-ai') return endpoint + '/chat/completions';
    /* Generic OpenAI-compatible: strip trailing /v1, then append /v1/chat/completions */
    endpoint = endpoint.replace(/\/v1$/, '');
    return endpoint + '/v1/chat/completions';
}

export function isOllamaProvider() {
    return state.settings.provider === 'ollama';
}

export function buildPayload(messages, overrideModel, overrideMaxTokens) {
    var model = overrideModel || state.settings.model || 'gpt-3.5-turbo';
    var temperature = state.settings.temperature;
    var maxTokens = clampMaxTokens(overrideMaxTokens != null ? overrideMaxTokens : state.settings.maxTokens);

    if (isOllamaProvider()) {
        return { model: model, messages: messages, stream: true, options: { temperature: temperature, num_predict: maxTokens } };
    }

    var isReasoning = model.indexOf('deepseek-r1') > -1 || model.indexOf('qwq') > -1 || model.indexOf('o1') > -1 || model.indexOf('reasoner') > -1;

    return {
        model: model,
        messages: messages,
        stream: true,
        temperature: isReasoning ? 0 : temperature,
        max_tokens: maxTokens
    };
}

export function buildHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (state.settings.provider === 'google-ai') {
        if (state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey;
    } else if (!isOllamaProvider() && state.settings.apiKey) {
        h['Authorization'] = 'Bearer ' + state.settings.apiKey;
    }
    if (state.settings.provider === 'openrouter') {
        h['HTTP-Referer'] = window.location.href;
        h['X-Title'] = 'S.ai Coding Agent';
    }
    return h;
}

function isTrivialMessage(text) {
    var t = text.trim().toLowerCase();
    var greetings = ['hi', 'hello', 'hey', 'hola', 'yo', 'sup', 'howdy',
        'thanks', 'thank you', 'thx', 'ty', 'cheers',
        'ok', 'okay', 'sure', 'yeah', 'yep', 'yes',
        'bye', 'goodbye', 'see ya', 'later', 'cya',
        'lol', 'lmao', 'haha', 'nice', 'cool', 'great'];
    for (var i = 0; i < greetings.length; i++) {
        if (t === greetings[i]) return true;
    }
    return false;
}

function isNewProjectRequest(text) {
    var t = text.toLowerCase();
    if (/\bfix\b/.test(t) && /\b(error|bug|issue|broken)\b/.test(t)) return false;
    if (/\b(modify|update|change|refactor|improve)\b/.test(t) && /\b(this|the|existing|current)\b/.test(t)) return false;
    if (/\.js\b|\.py\b|\.html\b|\.css\b|\.ts\b/.test(t) && /\b(file|in|from)\b/.test(t)) return false;
    var newWords = ['code a ', 'code simple ', 'create a ', 'build a ', 'make a ', 'write a ',
        'design a ', 'develop a ', 'simple ', 'basic ', 'new project', 'new app',
        'new website', 'new page', 'new system', 'landing page'];
    for (var i = 0; i < newWords.length; i++) {
        if (t.indexOf(newWords[i]) > -1) return true;
    }
    return false;
}

async function buildSafeSystemPrompt(userText) {
    var sys = state.settings.systemPrompt;
    var ctx = document.getElementById('project-context').value.trim();
    if (ctx) sys += '\n\n--- PROJECT CONTEXT ---\n' + ctx + '\n--- END CONTEXT ---';

    if (isTrivialMessage(userText)) {
        console.log('[Connection] Trivial greeting — using minimal system prompt');
        return 'You are S.ai, a helpful assistant. Respond briefly and conversationally. No code, no markdown, just a friendly reply.';
    }

    if (isNewProjectRequest(userText)) {
        console.log('[Connection] New project request — skipping workspace file context to avoid confusion');
        return sys;
    }

    try {
        var budget = state.settings.contextBudget || 25000;
        var fileCtx = '';
        if (isOllamaProvider()) {
            var { getFileContext } = await import('./filesystem.js');
            fileCtx = getFileContext();
        } else {
            var { getSmartFileContext } = await import('./smart-context.js');
            fileCtx = await getSmartFileContext(userText, budget);
        }
        if (fileCtx) sys += '\n\n' + FILE_SYSTEM_INSTRUCTIONS + '\n\n' + fileCtx;
    } catch (fsError) {
        console.warn('[Connection] File context build failed (non-fatal):', fsError.message);
    }

    return sys;
}

function buildSafeMessages(userText, systemPrompt) {
    var sysTokens = estimateTokens(systemPrompt);
    var maxInputTokens = estimateTokens(state.settings.contextBudget || 25000);
    var safeLimit = Math.floor(maxInputTokens * 0.8);

    if (sysTokens > safeLimit) {
        console.warn('[Connection] System prompt (' + sysTokens + ' tokens) exceeds safe limit (' + safeLimit + '). Stripping file context.');
        var sys = state.settings.systemPrompt;
        var ctx = document.getElementById('project-context').value.trim();
        if (ctx) sys += '\n\n--- PROJECT CONTEXT ---\n' + ctx + '\n--- END CONTEXT ---';
        var strippedTokens = estimateTokens(sys);
        if (strippedTokens <= safeLimit) {
            systemPrompt = sys;
            toast('File context stripped — too large for your budget.', 'info');
        } else {
            systemPrompt = state.settings.systemPrompt;
            var st = estimateTokens(systemPrompt);
            if (st > safeLimit) {
                systemPrompt = systemPrompt.substring(0, Math.floor(safeLimit * 3.5)) + '\n\n[System prompt truncated]';
                toast('System prompt truncated to fit budget.', 'error');
            }
        }
    }

    var remainingTokens = safeLimit - estimateTokens(systemPrompt);
    var historySlice = [];
    for (var i = state.conversationHistory.length - 1; i >= 0; i--) {
        var msgTokens = estimateTokens(state.conversationHistory[i].content);
        if (historySlice.length > 0 && (remainingTokens - msgTokens) < 500) break;
        historySlice.unshift(state.conversationHistory[i]);
        remainingTokens -= msgTokens;
    }
    var trimmedCount = state.conversationHistory.length - historySlice.length;
    if (trimmedCount > 0) console.log('[Connection] Trimmed ' + trimmedCount + ' old messages from history');

    return [{ role: 'system', content: systemPrompt }].concat(historySlice);
}

async function executeStream(messages, overrideMaxTokens, isAutoContinue) {
    var model = state.settings.model || 'gpt-3.5-turbo';
    var actualMaxTokens = clampMaxTokens(overrideMaxTokens != null ? overrideMaxTokens : state.settings.maxTokens);

    var totalEstTokens = 0;
    for (var m = 0; m < messages.length; m++) totalEstTokens += estimateTokens(messages[m].content);
    console.log('[Connection] Sending ~' + totalEstTokens + ' input + ' + actualMaxTokens + ' output tokens');

    /* ── Client-side throttle before any request ── */
    await throttleRequest();

    state.isStreaming = true;
    state.abortController = new AbortController();
    updateSendButton();

    if (!isAutoContinue) {
        addBotMessageStart();
    } else {
        var existingBubble = document.querySelector('.message.bot:last-child .msg-content');
        if (existingBubble) {
            state.streamElement = existingBubble;
            state.streamBuffer = existingBubble.textContent;
        } else {
            addBotMessageStart();
        }
    }

    setConnectionStatus('connecting', isAutoContinue ? 'File ' + (state.activeTask.loopCount + 1) + '...' : 'Generating...');

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
            setConnectionStatus('connecting', isAutoContinue ? 'File ' + (state.activeTask.loopCount + 1) + '... ' + elapsed + 's' : 'Thinking... ' + elapsed + 's');
        }
    }, thinkInterval);

    var currentFetchTimeout = getFetchTimeout();
    var fetchTimeoutId = setTimeout(function () {
        if (state.isStreaming && state.abortController) { abortSource = 'timeout'; state.abortController.abort(); }
    }, currentFetchTimeout);

    var stallInterval = isOllamaProvider() ? 10000 : 5000;
    var stallWatchdog = setInterval(function () {
        if (state.isStreaming && firstTokenReceived && (Date.now() - lastChunkTime > STREAM_STALL_TIMEOUT)) {
            abortSource = 'stall';
            if (state.abortController) state.abortController.abort();
        }
    }, stallInterval);

    var originalAbort = state.abortController.abort.bind(state.abortController);
    state.abortController.abort = function () { if (!abortSource) abortSource = 'user'; originalAbort(); };

    try {
        /* ═══════════════════════════════════════════════════
           FETCH with automatic 429 retry (exponential backoff)
           ═══════════════════════════════════════════════════ */
        var res = await fetchWithRetry(getApiUrl(), {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(buildPayload(messages, null, actualMaxTokens)),
            signal: state.abortController.signal
        });

        clearTimeout(fetchTimeoutId);
        fetchTimeoutId = null;

        /* ── Handle 402 (insufficient credits) ── */
        if (res.status === 402) {
            var err402Text = await res.text().catch(function () { return ''; });
            var retryTokens = resolveRetryTokens(err402Text, actualMaxTokens, overrideMaxTokens != null);

            if (retryTokens != null) {
                clearInterval(stallWatchdog);
                if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
                if (fetchTimeoutId) { clearTimeout(fetchTimeoutId); fetchTimeoutId = null; }

                var streamMsg = document.getElementById('streaming-msg');
                if (streamMsg && !isAutoContinue) streamMsg.remove();

                state.isStreaming = false;
                state.streamElement = null;
                state.streamBuffer = '';
                state.thinkingContent = '';

                toast('Tier limit hit. Auto-adjusting to ' + retryTokens + ' tokens...', 'info');
                setConnectionStatus('connecting', 'Retrying with ' + retryTokens + ' tokens...');
                await new Promise(function (r) { setTimeout(r, 800); });
                return executeStream(messages, retryTokens, isAutoContinue);
            } else {
                var reason = (overrideMaxTokens != null)
                    ? 'Auto-retry failed even at reduced tokens. Balance too low.'
                    : 'Balance too low for any response.';
                throw new Error('INSUFFICIENT_CREDITS: ' + reason + ' Wait for free tier refill (usually ~24h), or reduce Max Tokens in Settings, or add credits at openrouter.ai/settings/credits');
            }
        }

        /* ── Handle 429 (rate limit) after all retries exhausted ── */
        if (res.status === 429) {
            var err429Text = await res.text().catch(function () { return ''; });

            /* ── AUTO MODEL FALLBACK for OpenRouter ── */
            if (state.settings.provider === 'openrouter') {
                var fallbackModel = getNextFallbackModel(state.settings.model);
                if (fallbackModel) {
                    console.log('[Connection] 429 exhausted on ' + state.settings.model + ', switching to fallback: ' + fallbackModel);
                    toast('Rate limited on ' + state.settings.model + '. Switching to ' + fallbackModel + '...', 'info');

                    /* Clean up current stream state */
                    clearInterval(stallWatchdog);
                    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
                    if (fetchTimeoutId) { clearTimeout(fetchTimeoutId); fetchTimeoutId = null; }
                    var streamMsg429 = document.getElementById('streaming-msg');
                    if (streamMsg429 && !isAutoContinue) streamMsg429.remove();
                    state.isStreaming = false;
                    state.streamElement = null;
                    state.streamBuffer = '';
                    state.thinkingContent = '';

                    /* Temporarily switch model and retry */
                    var originalModel = state.settings.model;
                    state.settings.model = fallbackModel;
                    setConnectionStatus('connecting', 'Retrying with ' + fallbackModel + '...');

                    await new Promise(function (r) { setTimeout(r, 1500); });

                    try {
                        return executeStream(messages, overrideMaxTokens, isAutoContinue);
                    } catch (fallbackErr) {
                        /* Fallback also failed — restore original model and go to cooldown */
                        state.settings.model = originalModel;
                        throw new Error('RATE_LIMIT: Fallback ' + fallbackModel + ' also failed. ' + err429Text.substring(0, 150));
                    }
                }
            }

            /* No fallback available — go to cooldown instead of just erroring */
            console.warn('[Connection] 429 rate limit: all retries exhausted, no fallback available');
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            state.streamElement = null;
            state.streamBuffer = '';
            updateSendButton();
            startCooldown('429 exhausted on ' + state.settings.model);
            toast('Rate limited. Cooling down for 45s — your message will auto-send.', 'error');
            /* Queue the current request so it auto-sends after cooldown */
            if (!isAutoContinue) {
                state.pendingRequest = { type: 'message', text: userText || '' };
            }
            return;
        }

        /* ── Handle other HTTP errors ── */
        if (!res.ok) {
            var errText = await res.text().catch(function () { return ''; });
            var status = res.status;

            if (status === 401 || status === 403) throw new Error('AUTH_ERROR:' + status + ': ' + errText.substring(0, 200));
            else if (status === 502 || status === 503 || status === 504) throw new Error('SERVER_OVERLOAD:' + status + ': ' + errText.substring(0, 200));
            else if (status >= 500) throw new Error('SERVER_ERROR:' + status + ': ' + errText.substring(0, 300));
            else throw new Error('HTTP ' + status + ': ' + errText.substring(0, 300));
        }

        /* ═══════════════════════════════════════
           STREAM READING
           ═══════════════════════════════════════ */
        /* Reset fallback tracking — this model works! */
        resetFallbackTracking();
        var reader = res.body.getReader();
        var decoder = new TextDecoder();

        while (true) {
            var result = await reader.read();
            if (result.done) break;

            if (!firstTokenReceived) {
                firstTokenReceived = true;
                clearInterval(thinkTimer);
                thinkTimer = null;
                setConnectionStatus('connecting', isAutoContinue ? 'File ' + (state.activeTask.loopCount + 1) + '...' : 'Generating...');
            }

            lastChunkTime = Date.now();
            var chunk = decoder.decode(result.value, { stream: true });

            if (isOllamaProvider()) {
                var lines = chunk.split('\n').filter(function (l) { return l.trim(); });
                for (var i = 0; i < lines.length; i++) {
                    try {
                        var d = JSON.parse(lines[i]);
                        if (d.message && d.message.content) appendStreamChunk(d.message.content);
                        if (d.done) finishReason = 'stop';
                    } catch (e) { }
                }
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
                        if (reasoning) {
                            if (!isThinkingPhase) isThinkingPhase = true;
                            thinkingContent += reasoning;
                            showThinkingBlock(thinkingContent);
                        }
                        if (content) appendStreamChunk(content);
                    } catch (e) { }
                }
            }
        }

        state.thinkingContent = thinkingContent;
        if (isThinkingPhase) closeThinkingBlock();
        finalizeStream();
        clearInterval(stallWatchdog);
        if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }

        var hitLimit = (finishReason === 'length');
        var lastResponse = state.conversationHistory[state.conversationHistory.length - 1];
        var hasContinueTag = lastResponse && lastResponse.content.match(/\|CONTINUE_TASK\|\s*$/);

        if (hasContinueTag) {
            lastResponse.content = lastResponse.content.replace(/\|CONTINUE_TASK\|\s*$/, '').trimEnd();
            hitLimit = true;
        }

        if (state.activeTask.isRunning && hitLimit && state.activeTask.loopCount < state.activeTask.maxLoops) {
            state.activeTask.loopCount++;
            toast('File ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + '...', 'info');
            setConnectionStatus('connecting', 'Requesting file ' + (state.activeTask.loopCount + 1) + '...');
            state.conversationHistory.push({ role: 'user', content: CONTINUE_MSG_FILE });

            /* ── Provider-aware auto-continue delay ── */
            var continueDelay = getRLConfig().continueDelay;
            setTimeout(function () { sendMessage('', true); }, continueDelay);
        } else {
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            updateSendButton();
            setConnectionStatus('connected', 'Connected — ' + state.settings.model);
            if (hitLimit && !isAutoContinue) {
                state.responseTruncated = true;
                toast('Response truncated. Click Continue or type /continue', 'info');
                showContinueButton();
            }
            if (state.conversationHistory.length > 30) state.conversationHistory = state.conversationHistory.slice(-20);
        }

    } catch (error) {
        state.thinkingContent = thinkingContent;
        closeThinkingBlock();
        clearInterval(stallWatchdog);
        if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }

        if (error.name === 'AbortError') {
            finalizeStream();
            if (abortSource === 'timeout') {
                state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
                state.isStreaming = false; updateSendButton();
                toast('Request timed out. Try again or switch models.', 'error');
                setConnectionStatus('disconnected', 'Timeout');
            } else if (abortSource === 'stall') {
                var stallLastResponse = state.conversationHistory[state.conversationHistory.length - 1];
                var stallTag = stallLastResponse && stallLastResponse.content.match(/\|CONTINUE_TASK\|\s*$/);
                if (stallTag) stallLastResponse.content = stallLastResponse.content.replace(/\|CONTINUE_TASK\|\s*$/, '').trimEnd();
                if (state.activeTask.isRunning && (finishReason === 'length' || stallTag) && state.activeTask.loopCount < state.activeTask.maxLoops) {
                    state.activeTask.loopCount++;
                    toast('Stalled. Requesting next file (' + state.activeTask.loopCount + ')...', 'error');
                    state.conversationHistory.push({ role: 'user', content: CONTINUE_MSG_STALL });
                    var stallContinueDelay = getRLConfig().continueDelay + 2000;
                    setTimeout(function () { sendMessage('', true); }, stallContinueDelay);
                } else {
                    state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
                    state.isStreaming = false; updateSendButton();
                    if (finishReason === 'length' && !isAutoContinue) toast('Response truncated. Type "continue".', 'info');
                    else toast('Stream stalled for 60s.', 'error');
                    setConnectionStatus('connected', 'Connected — ' + state.settings.model);
                }
            } else {
                state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
                state.isStreaming = false; updateSendButton();
                toast('Response stopped', 'info');
                setConnectionStatus('connected', 'Connected — ' + state.settings.model);
            }
            return;
        }

        var errMsg = error.message || '';
        if (errMsg.indexOf('INSUFFICIENT_CREDITS:') === 0) {
            state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
            state.isStreaming = false; updateSendButton();
            toast('Insufficient credits. ' + errMsg.replace('INSUFFICIENT_CREDITS:', '').substring(0, 140), 'error');
            setConnectionStatus('disconnected', 'No Credits');
        } else if (errMsg.indexOf('RATE_LIMIT:') === 0) {
            state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
            state.isStreaming = false; updateSendButton();
            /* Go to cooldown instead of just showing an error */
            startCooldown('rate limit from fallback');
            var provider = state.settings.provider;
            var advice = provider === 'google-ai'
                ? 'Gemini free tier. All models + fallbacks rate limited.'
                : 'All models + fallbacks rate limited on OpenRouter.';
            toast(advice + ' Cooling down — your message will auto-send.', 'error');
        } else if (errMsg.indexOf('AUTH_ERROR:') === 0) {
            state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
            state.isStreaming = false; updateSendButton();
            toast('Auth failed. Check API key.', 'error');
            setConnectionStatus('disconnected', 'Auth Error');
        } else if (errMsg.indexOf('SERVER_OVERLOAD:') === 0) {
            state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
            state.isStreaming = false; updateSendButton();
            toast('Provider overloaded (502/503/504).', 'error');
            setConnectionStatus('disconnected', 'Server Overloaded');
        } else if (errMsg.indexOf('SERVER_ERROR:') === 0) {
            state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
            state.isStreaming = false; updateSendButton();
            toast('Server error: ' + errMsg.replace('SERVER_ERROR:', '').substring(0, 100), 'error');
            setConnectionStatus('disconnected', 'Server Error');
        } else {
            state.activeTask.isRunning = false; state.activeTask.loopCount = 0;
            state.isStreaming = false; updateSendButton();
            var msg = errMsg.indexOf('Failed to fetch') > -1 || errMsg.indexOf('NetworkError') > -1
                ? 'Cannot reach endpoint. Check connection.' : errMsg;
            toast(msg, 'error');
            setConnectionStatus('disconnected', 'Connection Error');
        }
        if (voiceState.isVoiceChat) import('./voice.js').then(function (m) { m.setVoiceMode('idle'); });

    } finally {
        clearInterval(stallWatchdog);
        if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
        if (fetchTimeoutId) { clearTimeout(fetchTimeoutId); fetchTimeoutId = null; }
        if (state.isStreaming) {
            if (!state.activeTask.isRunning) {
                state.isStreaming = false;
                updateSendButton();
            } else if (!state.streamElement) {
                state.isStreaming = false;
                state.activeTask.isRunning = false;
                state.activeTask.loopCount = 0;
                updateSendButton();
            }
        }
    }
}

export async function sendMessage(userText, isAutoContinue) {
    try {
        if (state.isStreaming && !isAutoContinue) {
            if (state.abortController) state.abortController.abort();
            state.abortController = null;
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            return;
        }

        /* ── Cooldown guard: queue the request instead of failing ── */
        if (!isAutoContinue && isInCooldown()) {
            var remainingSecs = Math.ceil((state.cooldownUntil - Date.now()) / 1000);
            toast('Rate limited. Your message will auto-send in ' + remainingSecs + 's...', 'info');
            state.pendingRequest = { type: 'message', text: userText };
            return;
        }

        if (!isAutoContinue) {
            if (!userText.trim()) return;
            /* Intercept plain 'continue' when last response was truncated */
            if (state.responseTruncated && /^continue$/i.test(userText.trim())) {
                continueResponse();
                return;
            }
            if (state.settings.provider !== 'ollama' && !state.settings.apiKey) { toast('No API key set. Open Settings.', 'error'); return; }
            if (!state.settings.model) { toast('No model selected. Open Settings.', 'error'); return; }

            addUserMessage(userText);
            state.conversationHistory.push({ role: 'user', content: userText });

            /* Clear truncated flag and remove button when user sends a new message */
            state.responseTruncated = false;
            removeContinueButton();

            state.activeTask.isRunning = CONTINUATION_MODES.indexOf(state.currentMode) !== -1;
            state.activeTask.loopCount = 0;
        }

        var systemPrompt = await buildSafeSystemPrompt(userText || '');
        var messages = buildSafeMessages(userText || '', systemPrompt);
        return executeStream(messages, null, isAutoContinue);
    } catch (fatalError) {
        console.error('[Connection] FATAL in sendMessage:', fatalError);
        state.isStreaming = false;
        state.activeTask.isRunning = false;
        state.activeTask.loopCount = 0;
        state.streamElement = null;
        state.streamBuffer = '';
        updateSendButton();
        setConnectionStatus('connected', 'Connected — ' + (state.settings.model || 'unknown'));
        toast('Unexpected error: ' + (fatalError.message || 'unknown').substring(0, 100), 'error');
    }
}

/* ═══════════════════════════════════════════════════
   CONTINUE RESPONSE — Resumes a truncated response
   Called by: Continue button, /continue command, or typing "continue"
   ═══════════════════════════════════════════════════ */
export async function continueResponse() {
    if (state.isStreaming) {
        toast('Wait for the current response to finish first.', 'info');
        return;
    }
    if (!state.responseTruncated) {
        toast('No truncated response to continue.', 'info');
        return;
    }

    /* Clear the truncated flag and remove the continue button */
    state.responseTruncated = false;
    removeContinueButton();

    /* Push a continuation prompt without showing it as a user bubble */
    state.conversationHistory.push({ role: 'user', content: 'Continue exactly where you left off. Do not repeat anything already said.' });

    toast('Continuing response...', 'info');

    try {
        var systemPrompt = await buildSafeSystemPrompt('');
        var messages = buildSafeMessages('', systemPrompt);
        return executeStream(messages, null, true);
    } catch (err) {
        console.error('[Connection] FATAL in continueResponse:', err);
        state.isStreaming = false;
        updateSendButton();
        toast('Failed to continue: ' + (err.message || 'unknown').substring(0, 100), 'error');
    }
}

function showThinkingBlock(text) {
    if (!state.streamElement) return;
    var display = text.length > 800 ? '...' + text.slice(-800) : text;
    display = display.replace(/\n/g, '<br>');
    var existing = document.getElementById('sai-thinking-block');
    if (existing) {
        existing.querySelector('.thinking-text').innerHTML = display;
        existing.scrollTop = existing.scrollHeight;
    } else {
        var block = document.createElement('div');
        block.id = 'sai-thinking-block';
        block.className = 'thinking-block';
        block.innerHTML =
            '<div class="thinking-header">' +
            '<span class="thinking-label"><i class="fas fa-brain"></i> Thinking...</span>' +
            '<button class="thinking-toggle" onclick="toggleThinkingBlock(this)" title="Toggle thinking"><i class="fas fa-chevron-down"></i></button>' +
            '</div>' +
            '<div class="thinking-text">' + display + '</div>';
        state.streamElement.insertBefore(block, state.streamElement.firstChild);
    }
}

function closeThinkingBlock() {
    var existing = document.getElementById('sai-thinking-block');
    if (existing) {
        var label = existing.querySelector('.thinking-label');
        if (label) {
            var charCount = state.thinkingContent ? state.thinkingContent.length : 0;
            var secs = Math.max(1, Math.round(charCount / 15));
            var timeStr = secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
            label.innerHTML = '<i class="fas fa-brain"></i> Thought for ' + timeStr;
        }
    }
}

export async function testConnection() {
    var provider = state.settings.provider;
    var apiKey = state.settings.apiKey;
    var model = state.settings.model;
    if (provider !== 'ollama' && !apiKey) { toast('Enter your API key first', 'error'); return false; }
    if (!model) { toast('Select a model first', 'error'); return false; }

    setConnectionStatus('connecting', 'Testing...');
    toast('Testing connection...', 'info');

    try {
        var h = { 'Content-Type': 'application/json' };
        if (provider === 'google-ai') {
            if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
        } else if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
        if (provider === 'openrouter') { h['HTTP-Referer'] = window.location.href; h['X-Title'] = 'S.ai Coding Agent'; }
        var body = provider === 'ollama'
            ? JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Hi' }], stream: false })
            : JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 });

        var r = await fetchWithRetry(getApiUrl(), { method: 'POST', headers: h, body: body });

        if (r.status === 429) {
            toast('Rate limited during test. Connection works but wait before sending messages.', 'info');
            setConnectionStatus('connected', 'Connected — ' + model + ' (rate limited, wait 60s)');
            return true;
        }

        if (!r.ok) {
            var e = await r.text().catch(function () { return ''; });
            if (r.status === 402) {
                var retryTokens = resolveRetryTokens(e, null, false);
                if (retryTokens != null) {
                    var tokensInput = document.getElementById('q-tokens');
                    if (tokensInput) tokensInput.value = retryTokens;
                    toast('Credits low — test passed with ' + retryTokens + ' tokens.', 'info');
                    setConnectionStatus('connected', 'Connected — ' + model + ' (' + retryTokens + ' tok limit)');
                    return true;
                }
            }
            if (r.status === 401 || r.status === 403) throw new Error('Auth failed. Check your API key.');
            throw new Error('HTTP ' + r.status + ': ' + e.substring(0, 200));
        }
        var d = await r.json();
        if (provider === 'ollama') {
            if (d.message && d.message.content) { setConnectionStatus('connected', 'Connected — ' + model); toast('Connected!', 'success'); return true; }
        } else {
            if (d.choices && d.choices[0] && d.choices[0].message) { setConnectionStatus('connected', 'Connected — ' + model); toast('Connected!', 'success'); return true; }
        }
        throw new Error('Unexpected response');
    } catch (error) {
        var msg = error.message.indexOf('Failed to fetch') > -1 ? 'Cannot reach endpoint.' : error.message;
        toast(msg, 'error');
        setConnectionStatus('disconnected', 'Connection Failed');
        return false;
    }
}

export async function fetchModels() {
    var provider = state.settings.provider;
    var endpoint = state.settings.endpoint;
    var apiKey = state.settings.apiKey;
    var listEl = document.getElementById('s-models-list');
    var btn = document.getElementById('s-fetch-models');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
    btn.disabled = true;

    try {
        if (provider === 'openrouter') { await fetchOpenRouterModels(); return; }
        if (provider === 'google-ai') { await fetchGoogleAIModels(); return; }
        var url, h = {};
        if (provider === 'ollama') { url = endpoint + '/api/tags'; }
        else { url = endpoint.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/models'; if (apiKey) h['Authorization'] = 'Bearer ' + apiKey; }
        var r = await fetch(url, { headers: h });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var d = await r.json();
        var models = provider === 'ollama' ? (d.models || []).map(function (m) { return m.name; }) : (d.data || []).map(function (m) { return m.id; });
        if (!models.length) { toast('No models found.', 'error'); listEl.style.display = 'none'; }
        else {
            listEl.innerHTML = models.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
            listEl.style.display = 'block';
            toast('Found ' + models.length + ' model(s)', 'success');
            if (!state.settings.model) { document.getElementById('s-model').value = models[0]; listEl.value = models[0]; }
        }
    } catch (e) { toast('Failed to fetch models: ' + e.message, 'error'); listEl.style.display = 'none'; }
    finally { btn.innerHTML = '<i class="fas fa-refresh"></i> Fetch Models'; btn.disabled = false; }
}

async function fetchGoogleAIModels() {
    var listEl = document.getElementById('s-models-list');
    var apiKey = state.settings.apiKey;
    if (!apiKey) { toast('Enter your Google AI API key first', 'error'); listEl.style.display = 'none'; return; }

    var geminiModels = [
        { id: 'models/gemini-2.0-flash', name: 'Gemini 2.0 Flash [FREE]', ctx: 1048576 },
        { id: 'models/gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash Preview [FREE]', ctx: 1048576 },
        { id: 'models/gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro Preview [FREE]', ctx: 2097152 },
        { id: 'models/gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite [FREE]', ctx: 1048576 },
        { id: 'models/gemini-1.5-flash', name: 'Gemini 1.5 Flash [FREE]', ctx: 1048576 },
        { id: 'models/gemini-1.5-pro', name: 'Gemini 1.5 Pro [FREE]', ctx: 2097152 }
    ];

    var html = '';
    html += '<option disabled style="color:var(--accent);font-weight:700">── 🌐 Google Gemini (Free) ──</option>';
    for (var i = 0; i < geminiModels.length; i++) {
        var m = geminiModels[i];
        html += '<option value="' + m.id + '">' + m.name + formatCtx(m.ctx) + '</option>';
        state.modelContextLimits[m.id] = Math.floor(m.ctx * 3.5);
    }

    listEl.innerHTML = html;
    listEl.style.display = 'block';
    var curModel = document.getElementById('s-model').value;
    if (!curModel) { document.getElementById('s-model').value = geminiModels[0].id; listEl.value = geminiModels[0].id; }
    toast('Loaded ' + geminiModels.length + ' Gemini models', 'success');
}

async function fetchOpenRouterModels() {
    var listEl = document.getElementById('s-models-list');
    var apiKey = state.settings.apiKey;
    var h = { 'Content-Type': 'application/json' };
    if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;

    try {
        var r = await fetch('https://openrouter.ai/api/v1/models', { headers: h });
        if (!r.ok) { var errBody = await r.text().catch(function () { return ''; }); throw new Error('HTTP ' + r.status + ': ' + errBody.substring(0, 200)); }
        var d = await r.json();
        var allModels = d.data || [];

        for (var x = 0; x < allModels.length; x++) { var ctx = allModels[x].context_length; if (ctx) state.modelContextLimits[allModels[x].id] = Math.floor(ctx * 3.5); }

        var topTierIds = ['stepfun/step-3.5-flash', 'z-ai/glm-5-turbo', 'xiaomi/mimo-v2-pro', 'minimax/minimax-m2.7', 'minimax/minimax-m2.5', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.6', 'nvidia/nemotron-3-super'];
        var topTierModels = [];
        for (var t = 0; t < topTierIds.length; t++) { var found = allModels.find(function (m) { return m.id === topTierIds[t] || m.id === topTierIds[t] + ':free'; }); if (found) topTierModels.push(found); }
        var freeModels = allModels.filter(function (m) { return m.id.indexOf(':free') > -1 && !topTierIds.some(function (id) { return m.id.startsWith(id); }); }).sort(function (a, b) { return a.id.localeCompare(b.id); });
        var reasoningModels = allModels.filter(function (m) { var id = m.id.toLowerCase(); return (id.indexOf('deepseek-r1') > -1 || id.indexOf('qwq') > -1 || id.indexOf('o1') > -1 || id.indexOf('reasoner') > -1) && !topTierIds.some(function (id) { return m.id.startsWith(id); }); }).sort(function (a, b) { return a.id.localeCompare(b.id); });

        var html = '';
        if (topTierModels.length > 0) {
            html += '<option disabled style="color:var(--accent);font-weight:700">── 🔥 Top Tier ──</option>';
            for (var i = 0; i < topTierModels.length; i++) { var isFree = topTierModels[i].id.indexOf(':free') > -1; html += '<option value="' + topTierModels[i].id + '">' + topTierModels[i].id + (isFree ? ' [FREE]' : ' [PAID]') + formatCtx(topTierModels[i].context_length) + '</option>'; }
        }
        if (freeModels.length > 0) {
            html += '<option disabled style="color:var(--green);font-weight:700">── Other Free ──</option>';
            for (var j = 0; j < freeModels.length; j++) html += '<option value="' + freeModels[j].id + '">' + freeModels[j].id + formatCtx(freeModels[j].context_length) + '</option>';
        }
        if (reasoningModels.length > 0) {
            html += '<option disabled style="color:var(--cyan);font-weight:700">── Reasoning ──</option>';
            for (var k = 0; k < reasoningModels.length; k++) html += '<option value="' + reasoningModels[k].id + '">' + reasoningModels[k].id + formatCtx(reasoningModels[k].context_length) + '</option>';
        }

        listEl.innerHTML = html;
        listEl.style.display = 'block';
        var curModel = document.getElementById('s-model').value;
        if (!curModel && topTierModels.length > 0) { var defaultModel = topTierModels[0].id; document.getElementById('s-model').value = defaultModel; listEl.value = defaultModel; toast('Auto-selected: ' + defaultModel, 'success'); }
        else toast(topTierModels.length + ' top tier, ' + freeModels.length + ' free loaded', 'success');
    } catch (e) { toast('Failed: ' + e.message, 'error'); listEl.style.display = 'none'; }
}

function formatCtx(n) {
    if (!n) return '';
    if (n >= 1000000000) return ' ~' + (n / 1000000000).toFixed(0) + 'B ctx';
    if (n >= 1000000) return ' ~' + (n / 1000000).toFixed(0) + 'M ctx';
    if (n >= 1000) return ' ~' + (n / 1000).toFixed(0) + 'K ctx';
    return '';
}

export function showOpenRouterModels() { fetchOpenRouterModels(); }