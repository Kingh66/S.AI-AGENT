/* ═══════════════════════════════════════
   CONNECTION — LLM API calls, streaming
   Hard token cap prevents 402 on free tier
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { FILE_SYSTEM_INSTRUCTIONS } from './config.js';
import { getFileContext } from './filesystem.js';
import {
    removeWelcome, addUserMessage, addBotMessageStart,
    appendStreamChunk, finalizeStream, updateSendButton
} from './messages.js';
import { setConnectionStatus, toast } from './ui.js';

/* ── Timeout constants ── */
var FETCH_TIMEOUT = 110000;
var STREAM_STALL_TIMEOUT = 60000;

/* ── Hard limits — nothing outside this range ever leaves this file ── */
var MIN_MAX_TOKENS = 256;
var MAX_MAX_TOKENS = 32768;
var DEFAULT_MAX_TOKENS = 4096;

/* ═══════════════════════════════════════
   TOKEN ESTIMATOR — chars → tokens (safe)
   1 token ≈ 3.5 chars for English/code
   ═══════════════════════════════════════ */
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
}

/* ── Clamp helper — used everywhere maxTokens is read ── */
function clampMaxTokens(val) {
    if (typeof val !== 'number' || isNaN(val) || val < MIN_MAX_TOKENS) return DEFAULT_MAX_TOKENS;
    if (val > MAX_MAX_TOKENS) return MAX_MAX_TOKENS;
    return val;
}

export function getApiUrl() {
    var endpoint = state.settings.endpoint.replace(/\/+$/, '');
    if (state.settings.provider === 'ollama') return endpoint + '/api/chat';
    if (state.settings.provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
    endpoint = endpoint.replace(/\/v1$/, '');
    return endpoint + '/v1/chat/completions';
}

export function isOllamaProvider() {
    return state.settings.provider === 'ollama';
}

export function buildPayload(messages, overrideModel) {
    var model = overrideModel || state.settings.model || 'gpt-3.5-turbo';
    var temperature = state.settings.temperature;
    var maxTokens = clampMaxTokens(state.settings.maxTokens);

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
    if (!isOllamaProvider() && state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey;
    if (state.settings.provider === 'openrouter') {
        h['HTTP-Referer'] = window.location.href;
        h['X-Title'] = 'S.ai Coding Agent';
    }
    return h;
}

/* ═══════════════════════════════════════
   SAFE CONTEXT BUILDER
   Three-stage token reduction:
   1. Skip file context for trivial messages
   2. If over budget, strip file context
   3. If still over, truncate history
   ═══════════════════════════════════════ */
function isTrivialMessage(text) {
    var t = text.trim().toLowerCase();
    var trivial = [
        'hi', 'hello', 'hey', 'hola', 'yo', 'sup', 'howdy',
        'thanks', 'thank you', 'thx', 'ty', 'cheers',
        'ok', 'okay', 'sure', 'yeah', 'yep', 'yes',
        'bye', 'goodbye', 'see ya', 'later', 'cya',
        'lol', 'lmao', 'haha', 'nice', 'cool', 'great',
        'what can you do', 'who are you', 'help'
    ];
    for (var i = 0; i < trivial.length; i++) {
        if (t === trivial[i]) return true;
    }
    if (t.length < 15 && t.indexOf('fix') === -1 && t.indexOf('bug') === -1 &&
        t.indexOf('error') === -1 && t.indexOf('code') === -1 && t.indexOf('file') === -1 &&
        t.indexOf('function') === -1 && t.indexOf('class') === -1 && t.indexOf('```') === -1) {
        return true;
    }
    return false;
}

function buildSafeSystemPrompt(userText) {
    var sys = state.settings.systemPrompt;
    var ctx = document.getElementById('project-context').value.trim();
    if (ctx) sys += '\n\n--- PROJECT CONTEXT ---\n' + ctx + '\n--- END CONTEXT ---';

    if (isTrivialMessage(userText)) {
        console.log('[Connection] Trivial message detected — skipping file context');
        return sys;
    }

    var fileCtx = getFileContext();
    if (fileCtx) sys += '\n\n' + FILE_SYSTEM_INSTRUCTIONS + '\n\n' + fileCtx;

    return sys;
}

function buildSafeMessages(userText, systemPrompt) {
    var sysTokens = estimateTokens(systemPrompt);
    var maxInputTokens = estimateTokens(state.settings.contextBudget || 60000);
    var safeLimit = Math.floor(maxInputTokens * 0.8);

    var stripped = false;
    if (sysTokens > safeLimit) {
        console.warn('[Connection] System prompt (' + sysTokens + ' tokens) exceeds safe limit (' + safeLimit + '). Stripping file context.');

        var sys = state.settings.systemPrompt;
        var ctx = document.getElementById('project-context').value.trim();
        if (ctx) sys += '\n\n--- PROJECT CONTEXT ---\n' + ctx + '\n--- END CONTEXT ---';

        var strippedTokens = estimateTokens(sys);
        if (strippedTokens <= safeLimit) {
            systemPrompt = sys;
            sysTokens = strippedTokens;
            stripped = true;
            toast('File context stripped — too large for your budget. Increase Context Budget in Settings or start a new chat.', 'info');
        } else {
            systemPrompt = state.settings.systemPrompt;
            sysTokens = estimateTokens(systemPrompt);
            if (sysTokens > safeLimit) {
                var maxSysChars = Math.floor(safeLimit * 3.5);
                systemPrompt = systemPrompt.substring(0, maxSysChars) + '\n\n[System prompt truncated to fit token budget]';
                sysTokens = safeLimit;
                toast('System prompt truncated to fit budget.', 'error');
            }
            stripped = true;
        }
    }

    var remainingTokens = safeLimit - sysTokens;
    var historySlice = [];

    for (var i = state.conversationHistory.length - 1; i >= 0; i--) {
        var msgTokens = estimateTokens(state.conversationHistory[i].content);
        if (historySlice.length > 0 && (remainingTokens - msgTokens) < 500) {
            break;
        }
        historySlice.unshift(state.conversationHistory[i]);
        remainingTokens -= msgTokens;
    }

    var trimmedCount = state.conversationHistory.length - historySlice.length;
    if (trimmedCount > 0) {
        console.log('[Connection] Trimmed ' + trimmedCount + ' old messages from history to fit budget');
    }

    return [{ role: 'system', content: systemPrompt }].concat(historySlice);
}

export async function sendMessage(userText, isAutoContinue) {
    /* ── User clicked STOP while streaming ── */
    if (state.isStreaming && !isAutoContinue) {
        if (state.abortController) state.abortController.abort();
        state.abortController = null;
        state.activeTask.isRunning = false;
        state.activeTask.loopCount = 0;
        return;
    }

    if (!isAutoContinue) {
        if (!userText.trim()) return;
        if (!state.settings.apiKey) { toast('No API key set. Open Settings.', 'error'); return; }
        if (!state.settings.model) { toast('No model selected. Open Settings and click Fetch Models.', 'error'); return; }

        addUserMessage(userText);
        state.conversationHistory.push({ role: 'user', content: userText });

        state.activeTask.isRunning = true;
        state.activeTask.loopCount = 0;
    }

    /* ═══════════════════════════════════════
       SAFE CONTEXT BUILDING — prevents 402
       ═══════════════════════════════════════ */
    var systemPrompt = buildSafeSystemPrompt(userText);
    var messages = buildSafeMessages(userText, systemPrompt);

    /* Clamp maxTokens for the log too — shows the REAL value being sent */
    var actualMaxTokens = clampMaxTokens(state.settings.maxTokens);

    var totalEstTokens = 0;
    for (var m = 0; m < messages.length; m++) {
        totalEstTokens += estimateTokens(messages[m].content);
    }
    console.log('[Connection] Sending ~' + totalEstTokens + ' input tokens + ' + actualMaxTokens + ' max output tokens');

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

    setConnectionStatus('connecting', isAutoContinue ? 'Task loop ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + '...' : 'Generating...');

    if (voiceState.isVoiceChat) {
        import('./voice.js').then(function (m) { m.setVoiceMode('thinking'); });
    }

    var thinkingContent = '';
    var isThinkingPhase = false;
    var lastChunkTime = Date.now();
    var finishReason = null;
    var firstTokenReceived = false;
    var abortSource = null;

    var thinkStartTime = Date.now();
    var thinkTimer = setInterval(function () {
        if (!firstTokenReceived && state.isStreaming) {
            var elapsed = ((Date.now() - thinkStartTime) / 1000).toFixed(0);
            setConnectionStatus('connecting', 'Thinking... ' + elapsed + 's');
        }
    }, 500);

    var fetchTimeoutId = setTimeout(function () {
        if (state.isStreaming && state.abortController) {
            abortSource = 'timeout';
            console.warn('Fetch timeout (' + FETCH_TIMEOUT + 'ms). Aborting...');
            state.abortController.abort();
        }
    }, FETCH_TIMEOUT);

    var stallWatchdog = setInterval(function () {
        if (state.isStreaming && firstTokenReceived && (Date.now() - lastChunkTime > STREAM_STALL_TIMEOUT)) {
            abortSource = 'stall';
            console.warn('Stream stalled (no data for ' + STREAM_STALL_TIMEOUT / 1000 + 's). Force-finalizing...');
            if (state.abortController) state.abortController.abort();
        }
    }, 5000);

    var originalAbort = state.abortController.abort.bind(state.abortController);
    state.abortController.abort = function () {
        if (!abortSource) abortSource = 'user';
        originalAbort();
    };

    try {
        var res = await fetch(getApiUrl(), {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(buildPayload(messages)),
            signal: state.abortController.signal
        });

        clearTimeout(fetchTimeoutId);
        fetchTimeoutId = null;

        if (!res.ok) {
            var errText = await res.text().catch(function () { return ''; });
            var status = res.status;

            if (status === 429) {
                throw new Error('RATE_LIMIT:' + errText.substring(0, 300));
            } else if (status === 401 || status === 403) {
                throw new Error('AUTH_ERROR:' + status + ': ' + errText.substring(0, 200));
            } else if (status === 502 || status === 503 || status === 504) {
                throw new Error('SERVER_OVERLOAD:' + status + ': ' + errText.substring(0, 200));
            } else if (status >= 500) {
                throw new Error('SERVER_ERROR:' + status + ': ' + errText.substring(0, 300));
            } else {
                throw new Error('HTTP ' + status + ': ' + errText.substring(0, 300));
            }
        }

        var reader = res.body.getReader();
        var decoder = new TextDecoder();

        while (true) {
            var result = await reader.read();
            if (result.done) break;

            if (!firstTokenReceived) {
                firstTokenReceived = true;
                clearInterval(thinkTimer);
                thinkTimer = null;
                if (isAutoContinue) {
                    setConnectionStatus('connecting', 'Task loop ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + '...');
                } else {
                    setConnectionStatus('connecting', 'Generating...');
                }
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

                        if (parsed.choices[0].finish_reason) {
                            finishReason = parsed.choices[0].finish_reason;
                        }

                        var reasoning = delta.reasoning_content || delta.reasoning || delta.thinking || null;
                        var content = delta.content || null;

                        if (reasoning) {
                            if (!isThinkingPhase) isThinkingPhase = true;
                            thinkingContent += reasoning;
                            showThinkingBlock(thinkingContent);
                        }

                        if (content) {
                            if (isThinkingPhase) {
                                isThinkingPhase = false;
                                closeThinkingBlock();
                            }
                            appendStreamChunk(content);
                        }
                    } catch (e) { }
                }
            }
        }

        if (isThinkingPhase) closeThinkingBlock();
        finalizeStream();
        clearInterval(stallWatchdog);
        if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }

        var hitLimit = (finishReason === 'length');

        var lastResponse = state.conversationHistory[state.conversationHistory.length - 1];
        var hasContinueTag = lastResponse && lastResponse.content.indexOf('<|CONTINUE_TASK|>') !== -1;

        if (hasContinueTag) {
            lastResponse.content = lastResponse.content.replace('<|CONTINUE_TASK|>', '');
            hitLimit = true;
        }

        if (state.activeTask.isRunning && hitLimit && state.activeTask.loopCount < state.activeTask.maxLoops) {
            state.activeTask.loopCount++;
            toast('Task loop ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + '...', 'info');
            setConnectionStatus('connecting', 'Continuing (loop ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + ')...');

            state.conversationHistory.push({
                role: 'user',
                content: 'SYSTEM OVERRIDE: Continue your work. If you created new files, you MUST now output the files that import them to complete the integration. Do not repeat finished code.'
            });

            setTimeout(function () { sendMessage('', true); }, 1000);
        } else {
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            updateSendButton();
            setConnectionStatus('connected', 'Connected — ' + state.settings.model);

            if (state.conversationHistory.length > 30) {
                state.conversationHistory = state.conversationHistory.slice(-20);
            }
        }

    } catch (error) {
        closeThinkingBlock();
        clearInterval(stallWatchdog);
        if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }

        if (error.name === 'AbortError') {
            finalizeStream();

            if (abortSource === 'timeout') {
                state.activeTask.isRunning = false;
                state.activeTask.loopCount = 0;
                state.isStreaming = false;
                updateSendButton();
                toast('Request timed out (' + (FETCH_TIMEOUT / 1000) + 's) — model may be overloaded. Try again or switch models.', 'error');
                setConnectionStatus('disconnected', 'Timeout');

            } else if (abortSource === 'stall') {
                var stallLastResponse = state.conversationHistory[state.conversationHistory.length - 1];
                var stallTag = stallLastResponse && stallLastResponse.content.indexOf('<|CONTINUE_TASK|>') !== -1;
                if (stallTag) stallLastResponse.content = stallLastResponse.content.replace('<|CONTINUE_TASK|>', '');

                if (state.activeTask.isRunning && (finishReason === 'length' || stallTag) && state.activeTask.loopCount < state.activeTask.maxLoops) {
                    state.activeTask.loopCount++;
                    toast('Stream stalled. Auto-continuing (' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + ')...', 'error');
                    setConnectionStatus('connecting', 'Stall recovery (loop ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + ')...');

                    state.conversationHistory.push({
                        role: 'user',
                        content: 'SYSTEM OVERRIDE: Continue your work. If you created new files, you MUST now output the files that import them to complete the integration. Do not repeat finished code.'
                    });
                    setTimeout(function () { sendMessage('', true); }, 1500);
                } else {
                    state.activeTask.isRunning = false;
                    state.activeTask.loopCount = 0;
                    state.isStreaming = false;
                    updateSendButton();
                    toast('Stream stalled — no data for ' + (STREAM_STALL_TIMEOUT / 1000) + 's. Model may be overloaded.', 'error');
                    setConnectionStatus('connected', 'Connected — ' + state.settings.model);
                }

            } else {
                state.activeTask.isRunning = false;
                state.activeTask.loopCount = 0;
                state.isStreaming = false;
                updateSendButton();
                toast('Response stopped', 'info');
                setConnectionStatus('connected', 'Connected — ' + state.settings.model);
            }
            return;
        }

        var errMsg = error.message || '';

        if (errMsg.indexOf('RATE_LIMIT:') === 0) {
            var rateDetail = errMsg.replace('RATE_LIMIT:', '');
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            updateSendButton();
            toast('Rate limited by provider. Wait a moment or switch models.', 'error');
            setConnectionStatus('disconnected', 'Rate Limited');
            state.lastError = { type: 'rate_limit', detail: rateDetail };

        } else if (errMsg.indexOf('AUTH_ERROR:') === 0) {
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            updateSendButton();
            toast('Authentication failed. Check your API key in Settings.', 'error');
            setConnectionStatus('disconnected', 'Auth Error');

        } else if (errMsg.indexOf('SERVER_OVERLOAD:') === 0) {
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            updateSendButton();
            toast('Provider overloaded (502/503/504). Try again in a moment.', 'error');
            setConnectionStatus('disconnected', 'Server Overloaded');
            state.lastError = { type: 'server_overload', detail: errMsg.replace('SERVER_OVERLOAD:', '') };

        } else if (errMsg.indexOf('SERVER_ERROR:') === 0) {
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            updateSendButton();
            var serverDetail = errMsg.replace('SERVER_ERROR:', '');
            toast('Server error: ' + serverDetail.substring(0, 100), 'error');
            setConnectionStatus('disconnected', 'Server Error');

        } else {
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            updateSendButton();

            var msg = errMsg.indexOf('Failed to fetch') > -1 || errMsg.indexOf('NetworkError') > -1
                ? 'Cannot reach the LLM endpoint. Check your connection and endpoint URL.' : errMsg;
            toast(msg, 'error');
            setConnectionStatus('disconnected', 'Connection Error');
        }

        if (voiceState.isVoiceChat) import('./voice.js').then(function (m) { m.setVoiceMode('idle'); });

    } finally {
        clearInterval(stallWatchdog);
        if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
        if (fetchTimeoutId) { clearTimeout(fetchTimeoutId); fetchTimeoutId = null; }

        if (state.isStreaming && !state.activeTask.isRunning && !state.isRenderScheduled) {
            state.isStreaming = false;
            updateSendButton();
        }
    }
}

/* ── Thinking block management ── */
function showThinkingBlock(text) {
    if (!state.streamElement) return;
    var el = state.streamElement;
    var thinkingId = 'sai-thinking-block';
    var display = text.length > 800 ? '...' + text.slice(-800) : text;
    display = display.replace(/\n/g, '<br>');

    var existing = document.getElementById(thinkingId);
    if (existing) {
        existing.querySelector('.thinking-text').innerHTML = display;
        existing.scrollTop = existing.scrollHeight;
    } else {
        var block = document.createElement('div');
        block.id = thinkingId;
        block.className = 'thinking-block';
        block.innerHTML =
            '<div class="thinking-header">' +
            '<span class="thinking-label"><i class="fas fa-brain"></i> Thinking...</span>' +
            '<button class="thinking-toggle" onclick="toggleThinkingBlock()" title="Toggle thinking"><i class="fas fa-chevron-down"></i></button>' +
            '</div>' +
            '<div class="thinking-text">' + display + '</div>';
        el.insertBefore(block, el.firstChild);
    }
}

function closeThinkingBlock() {
    var existing = document.getElementById('sai-thinking-block');
    if (existing) {
        var label = existing.querySelector('.thinking-label');
        if (label) label.innerHTML = '<i class="fas fa-brain"></i> Thought for ' + formatThinkTime(thinkingContent.length);
        var toggle = existing.querySelector('.thinking-toggle');
        if (toggle) toggle.style.display = '';
    }
}

window.toggleThinkingBlock = function () {
    var block = document.getElementById('sai-thinking-block');
    if (!block) return;
    var textEl = block.querySelector('.thinking-text');
    var icon = block.querySelector('.thinking-toggle i');
    if (textEl.style.display === 'none') {
        textEl.style.display = 'block';
        icon.className = 'fas fa-chevron-down';
    } else {
        textEl.style.display = 'none';
        icon.className = 'fas fa-chevron-right';
    }
};

function formatThinkTime(charCount) {
    var secs = Math.max(1, Math.round(charCount / 15));
    if (secs < 60) return secs + 's';
    var mins = Math.floor(secs / 60);
    var remSecs = secs % 60;
    return mins + 'm ' + remSecs + 's';
}

/* ── Test Connection ── */
export async function testConnection() {
    var provider = state.settings.provider;
    var apiKey = state.settings.apiKey;
    var model = state.settings.model;

    if (!apiKey) { toast('Enter your API key first', 'error'); return false; }
    if (!model) { toast('Select a model first', 'error'); return false; }

    setConnectionStatus('connecting', 'Testing...');
    toast('Testing connection...', 'info');

    try {
        var h = { 'Content-Type': 'application/json' };
        if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
        if (provider === 'openrouter') { h['HTTP-Referer'] = window.location.href; h['X-Title'] = 'S.ai Coding Agent'; }

        var body;
        if (provider === 'ollama') {
            body = JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Hi' }], stream: false });
        } else {
            body = JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 });
        }

        var r = await fetch(getApiUrl(), { method: 'POST', headers: h, body: body });
        if (!r.ok) {
            var e = await r.text().catch(function () { return ''; });
            if (r.status === 429) throw new Error('Rate limited. Wait a moment and try again.');
            if (r.status === 401 || r.status === 403) throw new Error('Authentication failed. Check your API key.');
            throw new Error('HTTP ' + r.status + ': ' + e.substring(0, 200));
        }
        var d = await r.json();

        if (provider === 'ollama') {
            if (d.message && d.message.content) { setConnectionStatus('connected', 'Connected — ' + model); toast('Connection successful!', 'success'); return true; }
        } else {
            if (d.choices && d.choices[0] && d.choices[0].message) { setConnectionStatus('connected', 'Connected — ' + model); toast('Connection successful!', 'success'); return true; }
        }
        throw new Error('Unexpected response');
    } catch (error) {
        var msg = error.message.indexOf('Failed to fetch') > -1 ? 'Cannot reach endpoint.' : error.message;
        toast(msg, 'error');
        setConnectionStatus('disconnected', 'Connection Failed');
        return false;
    }
}

/* ── Fetch Models ── */
export async function fetchModels() {
    var provider = state.settings.provider;
    var endpoint = state.settings.endpoint;
    var apiKey = state.settings.apiKey;
    var listEl = document.getElementById('s-models-list');
    var btn = document.getElementById('s-fetch-models');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
    btn.disabled = true;

    try {
        if (provider === 'openrouter') {
            await fetchOpenRouterModels();
            return;
        }
        var url, h = {};
        if (provider === 'ollama') {
            url = endpoint + '/api/tags';
        } else {
            url = endpoint.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/models';
            if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
        }
        var r = await fetch(url, { headers: h });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var d = await r.json();
        var models = provider === 'ollama'
            ? (d.models || []).map(function (m) { return m.name; })
            : (d.data || []).map(function (m) { return m.id; });
        if (!models.length) {
            toast('No models found.', 'error');
            listEl.style.display = 'none';
        } else {
            listEl.innerHTML = models.map(function (m) {
                return '<option value="' + m + '">' + m + '</option>';
            }).join('');
            listEl.style.display = 'block';
            toast('Found ' + models.length + ' model(s)', 'success');
            if (!state.settings.model) {
                document.getElementById('s-model').value = models[0];
                listEl.value = models[0];
            }
        }
    } catch (e) {
        toast('Failed to fetch models: ' + e.message, 'error');
        listEl.style.display = 'none';
    } finally {
        btn.innerHTML = '<i class="fas fa-refresh"></i> Fetch Models';
        btn.disabled = false;
    }
}

async function fetchOpenRouterModels() {
    var listEl = document.getElementById('s-models-list');
    var apiKey = state.settings.apiKey;
    var h = { 'Content-Type': 'application/json' };
    if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;

    try {
        var r = await fetch('https://openrouter.ai/api/v1/models', { headers: h });
        if (!r.ok) {
            var errBody = await r.text().catch(function () { return ''; });
            throw new Error('HTTP ' + r.status + ': ' + errBody.substring(0, 200));
        }
        var d = await r.json();
        var allModels = d.data || [];

        for (var x = 0; x < allModels.length; x++) {
            var ctx = allModels[x].context_length;
            if (ctx) {
                state.modelContextLimits[allModels[x].id] = Math.floor(ctx * 3.5);
            }
        }

        var topTierIds = [
            'stepfun/step-3.5-flash', 'z-ai/glm-5-turbo', 'xiaomi/mimo-v2-pro',
            'minimax/minimax-m2.7', 'minimax/minimax-m2.5',
            'anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.6',
            'nvidia/nemotron-3-super'
        ];

        var topTierModels = [];
        for (var t = 0; t < topTierIds.length; t++) {
            var found = allModels.find(function (m) { return m.id === topTierIds[t] || m.id === topTierIds[t] + ':free'; });
            if (found) topTierModels.push(found);
        }

        var freeModels = allModels.filter(function (m) {
            return m.id.indexOf(':free') > -1 && !topTierIds.some(function (id) { return m.id.startsWith(id); });
        }).sort(function (a, b) { return a.id.localeCompare(b.id); });

        var reasoningModels = allModels.filter(function (m) {
            var id = m.id.toLowerCase();
            return (id.indexOf('deepseek-r1') > -1 || id.indexOf('qwq') > -1 || id.indexOf('o1') > -1 || id.indexOf('reasoner') > -1) && !topTierIds.some(function (id) { return m.id.startsWith(id); });
        }).sort(function (a, b) { return a.id.localeCompare(b.id); });

        var html = '';

        if (topTierModels.length > 0) {
            html += '<option disabled style="color:var(--accent);font-weight:700">── 🔥 Top Tier (Massive Context) ──</option>';
            for (var i = 0; i < topTierModels.length; i++) {
                var isFree = topTierModels[i].id.indexOf(':free') > -1;
                var tag = isFree ? ' [FREE]' : ' [PAID]';
                var ctxLabel = formatCtx(topTierModels[i].context_length);
                html += '<option value="' + topTierModels[i].id + '">' + topTierModels[i].id + tag + ctxLabel + '</option>';
            }
        }

        if (freeModels.length > 0) {
            html += '<option disabled style="color:var(--green);font-weight:700">── Other Free Models ──</option>';
            for (var j = 0; j < freeModels.length; j++) {
                html += '<option value="' + freeModels[j].id + '">' + freeModels[j].id + formatCtx(freeModels[j].context_length) + '</option>';
            }
        }

        if (reasoningModels.length > 0) {
            html += '<option disabled style="color:var(--cyan);font-weight:700">── Reasoning Models ──</option>';
            for (var k = 0; k < reasoningModels.length; k++) {
                html += '<option value="' + reasoningModels[k].id + '">' + reasoningModels[k].id + formatCtx(reasoningModels[k].context_length) + '</option>';
            }
        }

        listEl.innerHTML = html;
        listEl.style.display = 'block';

        var curModel = document.getElementById('s-model').value;
        if (!curModel && topTierModels.length > 0) {
            var defaultModel = topTierModels[0].id;
            document.getElementById('s-model').value = defaultModel;
            listEl.value = defaultModel;
            toast('Auto-selected: ' + defaultModel, 'success');
        } else {
            toast(topTierModels.length + ' top tier, ' + freeModels.length + ' free models loaded', 'success');
        }

    } catch (e) {
        toast('Failed to fetch models: ' + e.message, 'error');
        listEl.style.display = 'none';
    }
}

function formatCtx(n) {
    if (!n) return '';
    if (n >= 1000000000) return ' ~' + (n / 1000000000).toFixed(0) + 'B ctx';
    if (n >= 1000000) return ' ~' + (n / 1000000).toFixed(0) + 'M ctx';
    if (n >= 1000) return ' ~' + (n / 1000).toFixed(0) + 'K ctx';
    return '';
}

export function showOpenRouterModels() {
    fetchOpenRouterModels();
}