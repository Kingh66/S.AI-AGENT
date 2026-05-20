/* ═══════════════════════════════════════════════════
   MESSAGES — Rendering, streaming, actions
   Optimized for Ollama: slower throttle, debounced scroll,
   no thinking block overhead
   ═══════════════════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { parseMarkdown } from './markdown.js';
import { highlightCodeBlocks, getTimeStr } from './ui.js';

let backtickCount = 0;
let streamPre = null;
let streamTextNode = null;
let renderTimer = null;

/* ── Dynamic throttle: 25ms for cloud, 100ms for Ollama ── */
function getRenderThrottle() {
    if (state.settings && state.settings.provider === 'ollama') return 100;
    return 25;
}

let lastRenderTime = 0;
let receivedAnyRealText = false;

/* ── Debounced scroll — max 1 scroll per 80ms instead of every render ── */
let scrollRaf = null;
function fastScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
        scrollRaf = null;
        var msgs = document.getElementById('messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
    });
}

/* ── Detect Ollama once per session, not every chunk ── */
let _isOllama = null;
function isOllamaSession() {
    if (_isOllama !== null) return _isOllama;
    _isOllama = (state.settings && state.settings.provider === 'ollama');
    return _isOllama;
}

/* Reset cached Ollama flag when provider changes */
export function invalidateOllamaCache() {
    _isOllama = null;
}

export function removeWelcome() {
    const w = document.getElementById('welcome-state');
    if (w) w.remove();
}

export function addUserMessage(text) {
    removeWelcome();
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message user';
    div.innerHTML =
        '<div class="msg-avatar"><i class="fas fa-user"></i></div>' +
        '<div class="msg-body">' +
        '<div class="msg-meta"><span class="msg-name">You</span><span class="msg-time">' + getTimeStr() + '</span></div>' +
        '<div class="msg-content"><p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p></div>' +
        '</div>';
    msgs.appendChild(div);
    fastScroll();
}

export function addBotMessageStart() {
    removeWelcome();
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message bot';
    div.id = 'streaming-msg';

    div.innerHTML =
        '<div class="msg-avatar">S</div>' +
        '<div class="msg-body">' +
        '<div class="msg-meta">' +
        '<span class="msg-name">S.ai</span>' +
        '<span class="msg-time">' + getTimeStr() + '</span>' +
        '<button class="speak-btn" onclick="speakLastResponse()" title="Read aloud"><i class="fas fa-volume-high"></i> Speak</button>' +
        '</div>' +
        '<div class="msg-content streaming-active">' +
        '<div class="typing-indicator"><span></span><span></span><span></span></div>' +
        '</div>' +
        '</div>';

    msgs.appendChild(div);

    state.streamElement = div.querySelector('.msg-content');
    state.streamBuffer = '';
    state.isRenderScheduled = false;
    state.thinkingContent = '';

    backtickCount = 0;
    streamPre = null;
    streamTextNode = null;
    lastRenderTime = 0;
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }

    receivedAnyRealText = false;

    fastScroll();
}

export function appendStreamChunk(chunk) {
    if (typeof chunk !== 'string') chunk = String(chunk);
    chunk = chunk.replace(/^[\u0000-\u001F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFFD]+/, '');
    if (chunk.length === 0) return;

    receivedAnyRealText = true;

    state.streamBuffer += chunk;

    for (let i = 0; i < chunk.length - 2; i++) {
        if (chunk[i] === '`' && chunk[i + 1] === '`' && chunk[i + 2] === '`') {
            backtickCount++;
            i += 2;
        }
    }
    var inCode = (backtickCount % 2 !== 0);

    if (!state.isRenderScheduled) {
        state.isRenderScheduled = true;

        var now = performance.now();
        var throttle = getRenderThrottle();
        var delay = Math.max(0, throttle - (now - lastRenderTime));

        renderTimer = setTimeout(function () {
            lastRenderTime = performance.now();
            state.isRenderScheduled = false;
            renderTimer = null;

            if (!state.streamElement) return;

            /* Ollama qwen2.5-coder never produces reasoning_content — skip thinking block check entirely */
            if (!isOllamaSession()) {
                var thinkBlock = state.streamElement.querySelector('.thinking-block');
                if (thinkBlock) thinkBlock.remove();
            }

            if (inCode) {
                if (!streamPre) {
                    streamPre = document.createElement('pre');
                    streamPre.className = 'streaming-code-pre';
                    clearNonThinkingChildren(state.streamElement);
                    state.streamElement.appendChild(streamPre);
                    streamTextNode = null;
                }
                streamPre.textContent = state.streamBuffer;
            } else {
                streamPre = null;
                if (!streamTextNode) {
                    streamTextNode = document.createElement('span');
                    clearNonThinkingChildren(state.streamElement);
                    state.streamElement.appendChild(streamTextNode);
                }
                streamTextNode.textContent = state.streamBuffer;
            }

            appendCursor(state.streamElement);
            fastScroll();
        }, delay);
    }
}

function clearNonThinkingChildren(container) {
    var children = Array.from(container.children);
    for (var i = 0; i < children.length; i++) {
        if (!children[i].classList.contains('thinking-block')) {
            children[i].remove();
        }
    }
}

function appendCursor(container) {
    var cursor = container.querySelector('.streaming-cursor');
    if (!cursor) {
        cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        container.appendChild(cursor);
    }
}

function removeCursor(container) {
    var cursor = container.querySelector('.streaming-cursor');
    if (cursor) cursor.remove();
}

function buildFinalThinkingBlock(text) {
    if (!text || text.length < 10) return '';
    /* Skip thinking block for Ollama — these models don't produce it */
    if (isOllamaSession()) return '';
    var display = text.length > 1200 ? '...' + text.slice(-1200) : text;
    display = escapeHtml(display).replace(/\n/g, '<br>');
    var timeStr = formatThinkTimeChars(text.length);
    var uid = 'think-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);

    return '<div class="thinking-block" id="' + uid + '">' +
        '<div class="thinking-header">' +
        '<span class="thinking-label"><i class="fas fa-brain"></i> Thought for ' + timeStr + '</span>' +
        '<button class="thinking-toggle" onclick="toggleThinkingBlock(this)" title="Toggle thinking"><i class="fas fa-chevron-right"></i></button>' +
        '</div>' +
        '<div class="thinking-text" style="display:none;max-height:300px;overflow-y:auto">' + display + '</div>' +
        '</div>';
}

function formatThinkTimeChars(charCount) {
    var secs = Math.max(1, Math.round(charCount / 15));
    if (secs < 60) return secs + 's';
    var mins = Math.floor(secs / 60);
    var remSecs = secs % 60;
    return mins + 'm ' + remSecs + 's';
}

export function finalizeStream() {
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    state.isRenderScheduled = false;

    backtickCount = 0;
    streamPre = null;
    streamTextNode = null;

    if (state.streamElement) {
        removeCursor(state.streamElement);
        state.streamElement.classList.remove('streaming-active');

        var clean = state.streamBuffer.replace(/^[\u0000-\u001F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFFD]+/, '');

        if (clean.length === 0 && receivedAnyRealText) {
            console.warn('[Messages] Buffer empty but data was received. Recovery...');
            if (state.thinkingContent && state.thinkingContent.length > 10) {
                clean = '⚠️ The model returned only internal reasoning with no response. Try again or switch models.';
            } else {
                clean = '⚠️ The model returned an empty response. Try again or switch models.';
            }
        }

        var thinkHtml = '';
        if (state.thinkingContent && state.thinkingContent.length > 10) {
            thinkHtml = buildFinalThinkingBlock(state.thinkingContent);
        }
        state.thinkingContent = '';

        state.streamElement.innerHTML = thinkHtml + parseMarkdown(clean);

        /* Defer code highlighting to next frame so finalizeStream returns fast */
        var el = state.streamElement;
        requestAnimationFrame(function () {
            highlightCodeBlocks(el);
        });

        state.conversationHistory.push({ role: 'assistant', content: clean });

        if (voiceState.isVoiceChat) {
            import('./voice.js').then(function (m) {
                m.stopListening();
                voiceState.mode = 'speaking';
                m.setVoiceMode('speaking');
                m.speakText(clean, function () {
                    if (voiceState.isVoiceChat && !state.isStreaming) {
                        setTimeout(function () { m.startListening(); }, 1500);
                    }
                });
            });
        }

        state.streamBuffer = '';
        state.streamElement = null;
        fastScroll();
    }

    if (!state.activeTask.isRunning) {
        state.isStreaming = false;
        updateSendButton();
    }
}

window.toggleThinkingBlock = function (el) {
    var block;
    if (el && el.closest) {
        block = el.closest('.thinking-block');
    } else {
        block = document.getElementById('sai-thinking-block');
    }
    if (!block) return;
    var textEl = block.querySelector('.thinking-text');
    var icon = block.querySelector('.thinking-toggle i');
    if (!textEl || !icon) return;
    if (textEl.style.display === 'none') {
        textEl.style.display = 'block';
        icon.className = 'fas fa-chevron-down';
    } else {
        textEl.style.display = 'none';
        icon.className = 'fas fa-chevron-right';
    }
};

/* ═══════════════════════════════════════════════════
   CONTINUE BUTTON — Shown when response is truncated
   ═══════════════════════════════════════════════════ */
export function showContinueButton() {
    removeContinueButton();
    var lastBotMsg = document.querySelector('.message.bot:last-child .msg-content');
    if (!lastBotMsg) return;

    var wrapper = document.createElement('div');
    wrapper.className = 'continue-response-wrapper';
    wrapper.id = 'continue-response-btn';
    wrapper.innerHTML =
        '<button class="continue-response-btn" onclick="window.saiContinueResponse()" title="Continue the truncated response">' +
        '<i class="fas fa-forward"></i> Continue' +
        '</button>';
    lastBotMsg.appendChild(wrapper);
    fastScroll();
}

export function removeContinueButton() {
    var el = document.getElementById('continue-response-btn');
    if (el) el.remove();
}

export function updateSendButton() {
    var btn = document.getElementById('send-btn');
    if (state.isStreaming) {
        btn.classList.add('stop');
        btn.innerHTML = '<i class="fas fa-stop"></i>';
        if (state.activeTask.loopCount > 0) {
            btn.title = 'Stop task (loop ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + ')';
        } else {
            btn.title = 'Stop generating';
        }
    } else {
        btn.classList.remove('stop');
        btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        btn.title = 'Send message';
    }
}

export function copyCode(btn) {
    var code = btn.closest('.code-block').querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(function () {
        btn.innerHTML = '<i class="fas fa-check"></i> Copied';
        setTimeout(function () { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
    });
}

export function useAsInput(btn) {
    var code = btn.closest('.code-block').querySelector('code').textContent;
    var input = document.getElementById('msg-input');
    input.value = code;
    import('./ui.js').then(function (m) { m.autoResize(input); });
    input.focus();
    import('./ui.js').then(function (m) { m.toast('Code loaded into input', 'success'); });
}

/* ── Edit file code inline before applying ── */
export function editFileCode(btn) {
    var block = btn.closest('.file-block');
    if (!block) return;

    /* If already editing, sync textarea → code and exit edit mode */
    if (block.classList.contains('editing')) {
        var textarea = block.querySelector('.edit-textarea');
        if (textarea) {
            var codeEl = block.querySelector('code');
            if (codeEl) codeEl.textContent = textarea.value;
            textarea.remove();
        }
        block.classList.remove('editing');
        var pre = block.querySelector('pre');
        if (pre) pre.style.display = '';
        btn.innerHTML = '<i class="fas fa-pen"></i> Edit';
        btn.style.color = '';
        /* Re-highlight after sync */
        var el = block.querySelector('code');
        if (el) {
            el.classList.remove('prism-highlighted');
            requestAnimationFrame(function () { highlightCodeBlocks(block); });
        }
        return;
    }

    /* Enter edit mode: overlay textarea on the code block */
    block.classList.add('editing');
    var pre = block.querySelector('pre');
    var currentCode = pre ? (pre.querySelector('code') ? pre.querySelector('code').textContent : '') : '';

    var textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.value = currentCode;
    textarea.spellcheck = false;
    textarea.style.cssText = 'width:100%;min-height:200px;background:var(--bg-secondary,#1a1a2e);color:var(--text,#e0e0e0);border:1px solid var(--accent,#00d4aa);border-radius:6px;padding:12px;font-family:"JetBrains Mono",monospace;font-size:0.85rem;resize:vertical;tab-size:4;box-sizing:border-box;outline:none;';

    if (pre) pre.style.display = 'none';
    if (pre && pre.parentNode) {
        pre.parentNode.insertBefore(textarea, pre);
    }

    btn.innerHTML = '<i class="fas fa-eye"></i> Preview';
    btn.style.color = 'var(--accent,#00d4aa)';

    /* Tab key inserts spaces instead of changing focus */
    textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            var start = this.selectionStart;
            var end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 4;
        }
    });
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}