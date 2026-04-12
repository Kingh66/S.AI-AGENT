/* ═══════════════════════════════════════
   CONNECTION — LLM API calls, streaming
   Handles both regular and reasoning models
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { FILE_SYSTEM_INSTRUCTIONS } from './config.js';
import { getFileContext } from './filesystem.js';
import {
    removeWelcome, addUserMessage, addBotMessageStart,
    appendStreamChunk, finalizeStream, updateSendButton
} from './messages.js';
import { setConnectionStatus, toast } from './ui.js';

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

export function buildPayload(messages) {
    var model = state.settings.model || 'gpt-3.5-turbo';
    var temperature = state.settings.temperature;
    var maxTokens = state.settings.maxTokens;

    if (isOllamaProvider()) {
        return { model: model, messages: messages, stream: true, options: { temperature: temperature, num_predict: maxTokens } };
    }

    var isReasoning = model.indexOf('deepseek-r1') > -1 || model.indexOf('qwq') > -1 || model.indexOf('o1') > -1 || model.indexOf('reasoner') > -1;

    // Force massive output limit for OpenRouter top tier models if user left it at default 4096
    var baseModel = model.replace(':free', '');
    if (state.settings.provider === 'openrouter' && maxTokens <= 4096) {
        if (baseModel.indexOf('step-3.5') > -1 || baseModel.indexOf('mimo') > -1 || baseModel.indexOf('minimax') > -1 || baseModel.indexOf('hunter-alpha') > -1 || baseModel.indexOf('glm-5') > -1 || baseModel.indexOf('qwen') > -1 || baseModel.indexOf('nemotron') > -1) {
            maxTokens = 16384; // Let these massive models actually output full files
        }
    }

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

export async function sendMessage(userText, isAutoContinue) {
    if (state.isStreaming) {
        if (state.abortController) state.abortController.abort();
        state.abortController = null;
        finalizeStream();
        return;
    }
    
    // Skip UI/API checks for silent auto-continues
    if (!isAutoContinue) {
        if (!userText.trim()) return;
        if (!state.settings.apiKey) { toast('No API key set. Open Settings.', 'error'); return; }
        if (!state.settings.model) { toast('No model selected. Open Settings and click Fetch Models.', 'error'); return; }

        addUserMessage(userText);
        state.conversationHistory.push({ role: 'user', content: userText });
        
        // Initialize agentic task loop for new user requests
        state.activeTask.isRunning = true;
        state.activeTask.loopCount = 0;
    }

    var sys = state.settings.systemPrompt;
    var ctx = document.getElementById('project-context').value.trim();
    if (ctx) sys += '\n\n--- PROJECT CONTEXT ---\n' + ctx + '\n--- END CONTEXT ---';
    var fileCtx = getFileContext();
    if (fileCtx) sys += '\n\n' + fileCtx + '\n\n' + FILE_SYSTEM_INSTRUCTIONS;

    var messages = [{ role: 'system', content: sys }].concat(state.conversationHistory.slice(-20));

    state.isStreaming = true;
    state.abortController = new AbortController();
    updateSendButton();
    
    if (!isAutoContinue) {
        addBotMessageStart();
    } else {
        // SEAMLESS CONTINUE: Re-attach to the exact same message bubble so text flows without splitting
        var existingBubble = document.querySelector('.message.bot:last-child .msg-content');
        if (existingBubble) {
            state.streamElement = existingBubble;
            state.streamBuffer = existingBubble.textContent; // Preserve what was already typed
        } else {
            addBotMessageStart(); // Fallback just in case
        }
    }
    
    setConnectionStatus('connecting', isAutoContinue ? 'Task loop ' + (state.activeTask.loopCount + 1) + '/' + state.activeTask.maxLoops + '...' : 'Generating...');

    if (voiceState.isVoiceChat) {
        import('./voice.js').then(function(m) { m.setVoiceMode('thinking'); });
    }

    var thinkingContent = '';
    var isThinkingPhase = false;
    var lastChunkTime = Date.now();
    var INACTIVE_TIMEOUT = 60000;
    var finishReason = null;

    var stallWatchdog = setInterval(function() {
        if (state.isStreaming && (Date.now() - lastChunkTime > INACTIVE_TIMEOUT)) {
            console.warn('Stream stalled (no data for 60s). Force-finalizing...');
            if (state.abortController) state.abortController.abort();
        }
    }, 5000);

    try {
        var res = await fetch(getApiUrl(), {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(buildPayload(messages)),
            signal: state.abortController.signal
        });

        if (!res.ok) {
            var errText = await res.text().catch(function() { return ''; });
            throw new Error('HTTP ' + res.status + ': ' + errText.substring(0, 300));
        }

        var reader = res.body.getReader();
        var decoder = new TextDecoder();

        while (true) {
            var result = await reader.read();
            if (result.done) break;
            
            lastChunkTime = Date.now();
            var chunk = decoder.decode(result.value, { stream: true });

            if (isOllamaProvider()) {
                var lines = chunk.split('\n').filter(function(l) { return l.trim(); });
                for (var i = 0; i < lines.length; i++) {
                    try {
                        var d = JSON.parse(lines[i]);
                        if (d.message && d.message.content) appendStreamChunk(d.message.content);
                        if (d.done) finishReason = 'stop';
                    } catch(e) {}
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
                    } catch(e) {}
                }
            }
        }

        if (isThinkingPhase) closeThinkingBlock();
        finalizeStream();
        clearInterval(stallWatchdog);

        // 🧠 ADVANCED AUTO-CONTINUE BRAIN
        var hitLimit = (finishReason === 'length');
        
        // Check for secret tag overriding the API finish state
        var lastResponse = state.conversationHistory[state.conversationHistory.length - 1];
        var hasContinueTag = lastResponse && lastResponse.content.includes('<|CONTINUE_TASK|>');
        
        if (hasContinueTag) {
            lastResponse.content = lastResponse.content.replace('<|CONTINUE_TASK|>', '');
            hitLimit = true; 
        }

        if (hitLimit && state.activeTask.loopCount < state.activeTask.maxLoops) {
            state.activeTask.loopCount++;
            toast('Task loop ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + '...', 'info');
            
            state.conversationHistory.push({ 
                role: 'user', 
                content: 'SYSTEM OVERRIDE: Continue your work. If you created new files, you MUST now output the files that import them to complete the integration. Do not repeat finished code.' 
            });
            
            setTimeout(function() { sendMessage('', true); }, 1000);
        } else {
            // TASK RESOLVED: Guarantee state returns to idle
            state.activeTask.isRunning = false;
            state.activeTask.loopCount = 0;
            setConnectionStatus('connected', 'Connected — ' + state.settings.model);
            if (state.conversationHistory.length > 30) {
                state.conversationHistory = state.conversationHistory.slice(-20);
            }
        }

    } catch (error) {
        closeThinkingBlock();
        clearInterval(stallWatchdog);
        
        if (error.name === 'AbortError') { 
            if (Date.now() - lastChunkTime >= INACTIVE_TIMEOUT - 100) {
                finalizeStream(); 
                
                // Stall fallback also respects task limits and tags
                var stallLastResponse = state.conversationHistory[state.conversationHistory.length - 1];
                var stallTag = stallLastResponse && stallLastResponse.content.includes('<|CONTINUE_TASK|>');
                if (stallTag) stallLastResponse.content = stallLastResponse.content.replace('<|CONTINUE_TASK|>', '');

                if ((finishReason === 'length' || stallTag) && state.activeTask.loopCount < state.activeTask.maxLoops) {
                    state.activeTask.loopCount++;
                    toast('Model stalled. Auto-continuing (' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + ')...', 'error'); 
                    state.conversationHistory.push({ role: 'user', content: 'SYSTEM OVERRIDE: Continue your work. If you created new files, you MUST now output the files that import them to complete the integration. Do not repeat finished code.' });
                    setTimeout(function() { sendMessage('', true); }, 1500);
                } else {
                    state.activeTask.isRunning = false;
                    state.activeTask.loopCount = 0;
                    toast('Task stopped or completed.', 'info');
                    setConnectionStatus('connected', 'Connected — ' + state.settings.model);
                }
            } else {
                state.activeTask.isRunning = false; // User manually stopped it
                finalizeStream(); 
                toast('Response stopped', 'info'); 
            }
            return; 
        }
        
        // Standard API errors
        state.activeTask.isRunning = false;
        finalizeStream();
        var msg = error.message.indexOf('Failed to fetch') > -1 || error.message.indexOf('NetworkError') > -1
            ? 'Cannot reach the LLM endpoint.' : error.message;
        toast(msg, 'error');
        setConnectionStatus('disconnected', 'Connection Error');
        if (voiceState.isVoiceChat) import('./voice.js').then(function(m) { m.setVoiceMode('idle'); });
    } finally {
        clearInterval(stallWatchdog);
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

window.toggleThinkingBlock = function() {
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
        if (!r.ok) { var e = await r.text().catch(function() { return ''; }); throw new Error('HTTP ' + r.status + ': ' + e.substring(0, 200)); }
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

/* ── Fetch Models — live from API, no hardcoded lists ── */
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
            ? (d.models || []).map(function(m) { return m.name; })
            : (d.data || []).map(function(m) { return m.id; });
        if (!models.length) {
            toast('No models found.', 'error');
            listEl.style.display = 'none';
        } else {
            listEl.innerHTML = models.map(function(m) {
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
            var errBody = await r.text().catch(function() { return ''; });
            throw new Error('HTTP ' + r.status + ': ' + errBody.substring(0, 200));
        }
        var d = await r.json();
        var allModels = d.data || [];

        // Store context limits for every model
        for (var x = 0; x < allModels.length; x++) {
            var ctx = allModels[x].context_length;
            if (ctx) {
                state.modelContextLimits[allModels[x].id] = Math.floor(ctx * 3.5);
            }
        }

        /* ── 1. OPENCLAW TOP TIER MODELS (Pulled to the very top) ── */
        var topTierIds = [
            'stepfun/step-3.5-flash', 'z-ai/glm-5-turbo', 'xiaomi/mimo-v2-pro', 
            'minimax/minimax-m2.7', 'anthropic/claude-sonnet-4.6', 'qwen/qwen-3.6-plus', 
            'openrouter/hunter-alpha', 'minimax/minimax-m2.5', 'anthropic/claude-opus-4.6', 
            'nvidia/nemotron-3-super'
        ];
        
        var topTierModels = [];
        for (var t = 0; t < topTierIds.length; t++) {
            var found = allModels.find(function(m) { return m.id === topTierIds[t] || m.id === topTierIds[t] + ':free'; });
            if (found) topTierModels.push(found);
        }

        /* ── 2. OTHER FREE MODELS ── */
        var freeModels = allModels.filter(function(m) {
            return m.id.indexOf(':free') > -1 && !topTierIds.some(function(id) { return m.id.startsWith(id); });
        }).sort(function(a, b) { return a.id.localeCompare(b.id); });

        /* ── 3. REASONING MODELS ── */
        var reasoningModels = allModels.filter(function(m) {
            var id = m.id.toLowerCase();
            return (id.indexOf('deepseek-r1') > -1 || id.indexOf('qwq') > -1 || id.indexOf('o1') > -1 || id.indexOf('reasoner') > -1) && !topTierIds.some(function(id) { return m.id.startsWith(id); });
        }).sort(function(a, b) { return a.id.localeCompare(b.id); });

        var html = '';

        if (topTierModels.length > 0) {
            html += '<option disabled style="color:var(--accent);font-weight:700">── 🔥 OpenClaw Top Tier (Massive Context) ──</option>';
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

        // Auto-select Step 3.5 Flash if no model is set
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