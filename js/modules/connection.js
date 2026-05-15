/* ═══════════════════════════════════════════════════
   CONNECTION — LLM API calls, streaming
   ═══════════════════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { FILE_SYSTEM_INSTRUCTIONS } from './config.js';
import { getSmartFileContext } from './smart-context.js';
import {
    removeWelcome, addUserMessage, addBotMessageStart,
    appendStreamChunk, finalizeStream, updateSendButton
} from './messages.js';
import { setConnectionStatus, toast } from './ui.js';

var FETCH_TIMEOUT = 110000;
var STREAM_STALL_TIMEOUT = 60000;
var MIN_MAX_TOKENS = 256;
var MAX_MAX_TOKENS = 32768;
var DEFAULT_MAX_TOKENS = 4096;
var TOKEN_402_SAFETY_MARGIN = 150;
var MIN_RETRY_TOKENS = 32;

var CONTINUATION_MODES = ['custom', 'selfimprove', 'multiagent'];

var CONTINUE_MSG_FILE = 'OUTPUT NEXT FILE: One file block only. <|CONTINUE_TASK|> if more files remain, end normally if last. No commentary.';

var CONTINUE_MSG_STALL = 'OUTPUT NEXT FILE: Previous output cut off. One file block only. <|CONTINUE_TASK|> if more remain, end normally if last. No commentary.';

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
        /limit.*?([\d,]+)\s*tokens/i
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

    if (!isRetry && retryAmount < actualMaxTokens) {
        return retryAmount;
    }

    if (retryAmount >= MIN_MAX_TOKENS) {
        state.settings.maxTokens = retryAmount;
        import('./storage.js').then(function (s) { s.saveSettings(); });
        var tokensInput = document.getElementById('q-tokens');
        if (tokensInput) tokensInput.value = retryAmount;
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
        /* Google AI Studio supports both x-goog-api-key and Bearer — prefer Bearer for OpenAI compat */
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
        /* Continue without file context rather than crashing */
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
    /* Ollama: update status every 2s instead of 500ms to reduce DOM writes */
    var thinkInterval = isOllamaProvider() ? 2000 : 500;
    var thinkTimer = setInterval(function () {
        if (!firstTokenReceived && state.isStreaming) {
            var elapsed = ((Date.now() - thinkStartTime) / 1000).toFixed(0);
            setConnectionStatus('connecting', isAutoContinue ? 'File ' + (state.activeTask.loopCount + 1) + '... ' + elapsed + 's' : 'Thinking... ' + elapsed + 's');
        }
    }, thinkInterval);

    var fetchTimeoutId = setTimeout(function () {
        if (state.isStreaming && state.abortController) { abortSource = 'timeout'; state.abortController.abort(); }
    }, FETCH_TIMEOUT);

        /* Ollama: check stall every 10s instead of 5s — local models can have natural pauses */
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
        var res = await fetch(getApiUrl(), {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(buildPayload(messages, null, actualMaxTokens)),
            signal: state.abortController.signal
        });

        clearTimeout(fetchTimeoutId);
        fetchTimeoutId = null;

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

                toast('Free tier limit hit. Auto-adjusting to ' + retryTokens + ' tokens...', 'info');
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

        if (!res.ok) {
            var errText = await res.text().catch(function () { return ''; });
            var status = res.status;
            /* Auto-retry on 429 (rate limit) — Gemini free tier recovers in a few seconds */
            if (status === 429) {
                var retryAfter = res.headers.get('retry-after');
                var waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
                console.log('[Connection] 429 rate limited. Waiting ' + waitMs + 'ms before retry...');
                setConnectionStatus('disconnected', 'Rate limited — retrying...');
                toast('Rate limited. Retrying in ' + (waitMs / 1000) + 's...', 'info');
                await new Promise(function (r) { setTimeout(r, waitMs); });
                /* Retry once */
                try {
                    var retryRes = await fetch(getApiUrl(), {
                        method: 'POST', headers: buildHeaders(),
                        body: JSON.stringify(buildPayload(messages, null, actualMaxTokens)),
                        signal: state.abortController.signal
                    });
                    if (retryRes.ok) {
                        /* Fall through — let the main streaming loop handle this response */
                        res = retryRes;
                        /* Clear the error so we don't throw */
                        errText = '';
                        status = 0;
                    } else {
                        throw new Error('RATE_LIMIT:' + errText.substring(0, 300));
                    }
                } catch (retryErr) {
                    if (retryErr.message && retryErr.message.indexOf('RATE_LIMIT') > -1) throw retryErr;
                    throw retryErr;
                }
            }
            if (status === 402) throw new Error('INSUFFICIENT_CREDITS: ' + errText.substring(0, 300));
            else if (status === 401 || status === 403) throw new Error('AUTH_ERROR:' + status + ': ' + errText.substring(0, 200));
            else if (status === 502 || status === 503 || status === 504) throw new Error('SERVER_OVERLOAD:' + status + ': ' + errText.substring(0, 200));
            else if (status >= 500) throw new Error('SERVER_ERROR:' + status + ': ' + errText.substring(0, 300));
            else if (status !== 0) throw new Error('HTTP ' + status + ': ' + errText.substring(0, 300));
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
            setTimeout(function () { sendMessage('', true); }, 1000);
        } else {
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            state.isStreaming = false;
            updateSendButton();
            setConnectionStatus('connected', 'Connected — ' + state.settings.model);
            if (hitLimit && !isAutoContinue) toast('Response truncated. Type "continue" to get the rest.', 'info');
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
                    setTimeout(function () { sendMessage('', true); }, 1500);
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
            toast('Rate limited. Wait or switch models.', 'error');
            setConnectionStatus('disconnected', 'Rate Limited');
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
        /* Safety: always clean up streaming state if no auto-continue is pending.
           Check setTimeout pending state by verifying activeTask + isStreaming combo. */
        if (state.isStreaming) {
            if (!state.activeTask.isRunning) {
                state.isStreaming = false;
                updateSendButton();
            } else if (!state.isRenderScheduled) {
                /* Auto-continue was set but something went wrong —
                   the setTimeout should handle it, but add a safety net */
                if (!state.streamElement) {
                    state.isStreaming = false;
                    state.activeTask.isRunning = false;
                    state.activeTask.loopCount = 0;
                    updateSendButton();
                }
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

        if (!isAutoContinue) {
            if (!userText.trim()) return;
            if (state.settings.provider !== 'ollama' && !state.settings.apiKey) { toast('No API key set. Open Settings.', 'error'); return; }
            if (!state.settings.model) { toast('No model selected. Open Settings.', 'error'); return; }

            addUserMessage(userText);
            state.conversationHistory.push({ role: 'user', content: userText });

            state.activeTask.isRunning = CONTINUATION_MODES.indexOf(state.currentMode) !== -1;
            state.activeTask.loopCount = 0;
        }

        var systemPrompt = await buildSafeSystemPrompt(userText || '');
        var messages = buildSafeMessages(userText || '', systemPrompt);
        return executeStream(messages, null, isAutoContinue);
    } catch (fatalError) {
        /* Safety net: catch anything that slips through (filesystem errors, etc.)
           Without this, the UI gets permanently stuck in "Generating..." */
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

        var r = await fetch(getApiUrl(), { method: 'POST', headers: h, body: body });
        if (!r.ok) {
            var e = await r.text().catch(function () { return ''; });
            if (r.status === 402) {
                var retryTokens = resolveRetryTokens(e, null, false);
                if (retryTokens != null) {
                    var tokensInput = document.getElementById('q-tokens');
                    if (tokensInput) tokensInput.value = retryTokens;
                    toast('Credits low — test passed with ' + retryTokens + ' tokens. Consider setting Max Tokens to ' + retryTokens + ' in Settings.', 'info');
                    setConnectionStatus('connected', 'Connected — ' + model + ' (' + retryTokens + ' tok limit)');
                    return true;
                }
            }
            if (r.status === 429) throw new Error('Rate limited.');
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
    var h = { 'Content-Type': 'application/json' };
    if (apiKey) h['x-goog-api-key'] = apiKey;

    /* Known Gemini models — hardcoded so Fetch Models works even without the list endpoint */
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