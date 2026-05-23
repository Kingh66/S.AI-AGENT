/* ═══════════════════════════════════════════════════
   MESSAGES — Rendering, streaming, actions
   Advanced rendering with collapsible phases
   
   PERF: Fast path for simple responses.
   ═══════════════════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { parseMarkdown } from './markdown.js';
import { highlightCodeBlocks, getTimeStr } from './ui.js';

let backtickCount = 0;
let streamPre = null;
let streamTextNode = null;
let renderTimer = null;

function getRenderThrottle() {
    if (state.settings && state.settings.provider === 'ollama') return 80;
    return 16;
}

let lastRenderTime = 0;
let receivedAnyRealText = false;

let scrollRaf = null;
function fastScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
        scrollRaf = null;
        var msgs = document.getElementById('messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
    });
}

let _isOllama = null;
function isOllamaSession() {
    if (_isOllama !== null) return _isOllama;
    _isOllama = (state.settings && state.settings.provider === 'ollama');
    return _isOllama;
}

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

    backtickCount = 0;
    var buf = state.streamBuffer;
    for (var bi = 0; bi < buf.length - 2; bi++) {
        if (buf[bi] === '`' && buf[bi + 1] === '`' && buf[bi + 2] === '`') {
            backtickCount++;
            bi += 2;
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
        if (!children[i].classList.contains('thinking-block') && !children[i].classList.contains('thinking-phase')) {
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

function simpleTextToHtml(text) {
    var html = escapeHtml(text);
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\n/g, '<br>');
    return '<p>' + html + '</p>';
}

function needsFullParse(text) {
    if (text.length > 2000) return true;
    if (text.indexOf('```') > -1) return true;
    if (text.indexOf('file:') > -1) return true;
    if (text.indexOf('|') > -1 && text.indexOf('---') > -1) return true;
    if (/^#{1,6}\s/m.test(text)) return true;
    if (text.indexOf('📋') > -1 || text.indexOf('📁') > -1 || text.indexOf('☐') > -1) return true;
    if (text.indexOf('📊') > -1 || text.indexOf('📦') > -1 || text.indexOf('✅') > -1) return true;
    if (text.indexOf('<|CONTINUE_TASK|>') > -1) return true;
    return false;
}

/* ═══════════════════════════════════════════════════
   FINALIZE — Render the complete message
   
   ═══════════════════════════════════════════════════ */
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
            clean = state.thinkingContent && state.thinkingContent.length > 10
                ? '⚠️ The model returned only reasoning with no visible response. Try again or switch models.'
                : '⚠️ Empty response received. Try again.';
        }
        if (clean.length === 0 && !receivedAnyRealText) {
            clean = '⚠️ No response received. Connection may have been interrupted.';
        }

        var thinkHtml = '';
        if (state.thinkingContent && state.thinkingContent.length > 10 && !isOllamaSession()) {
            thinkHtml = buildFinalThinkingBlock(state.thinkingContent);
        }
        state.thinkingContent = '';

        var renderedContent;
        var hasCodeBlocks = clean.indexOf('```') > -1;

        if (!needsFullParse(clean)) {
            renderedContent = simpleTextToHtml(clean);
        } else {
            renderedContent = parseMarkdown(clean);
            renderedContent = wrapThinkingPhases(renderedContent, clean);
        }

        state.streamElement.innerHTML = thinkHtml + renderedContent;

        if (hasCodeBlocks) {
            var el = state.streamElement;
            requestAnimationFrame(function () { highlightCodeBlocks(el); });
        }

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

    state.isStreaming = false;
    updateSendButton();
}

function wrapThinkingPhases(html, rawText) {
    var hasPlan = rawText.indexOf('📋') > -1 || /\bPLAN\b/i.test(rawText.substring(0, 500));
    var hasReading = rawText.indexOf('📁') > -1 || /\bWORKING ON\b/i.test(rawText.substring(0, 500));
    var hasChecklist = rawText.indexOf('☐') > -1;

    if (!hasPlan && !hasReading && !hasChecklist) return html;

    var phaseEndMarker = null;
    var markers = [
        '📊 SUMMARY', '📦 FILES READY', 'REVIEW BEFORE APPLYING',
        'FILES READY TO APPLY', '## Findings', '## Bugs Found',
        '## Issues', '## Results', '🐛', '🔴', 'Bug #', 'Issue #', '```file:'
    ];

    for (var m = 0; m < markers.length; m++) {
        var idx = rawText.indexOf(markers[m]);
        if (idx > -1 && (phaseEndMarker === null || idx < phaseEndMarker)) {
            phaseEndMarker = idx;
        }
    }

    if (phaseEndMarker === null || phaseEndMarker < 100) return html;

    var phaseText = rawText.substring(0, phaseEndMarker);
    var outputText = rawText.substring(phaseEndMarker);

    var stepCount = (phaseText.match(/☐/g) || []).length;
    var fileCount = (phaseText.match(/📁/g) || []).length;
    var doneCount = (phaseText.match(/✅/g) || []).length;

    var phaseLabel = 'Reading & Planning';
    if (stepCount > 0) phaseLabel = stepCount + ' steps planned';
    if (fileCount > 0) phaseLabel += ' · ' + fileCount + ' files read';
    if (doneCount > 0) phaseLabel += ' · ' + doneCount + ' complete';

    var uid = 'phase-' + Date.now();

    var phaseHtml = '<div class="thinking-phase" id="' + uid + '">' +
        '<div class="thinking-phase-header" onclick="toggleThinkingPhase(\'' + uid + '\')">' +
        '<span class="phase-icon"><i class="fas fa-route"></i></span>' +
        '<span class="phase-label">' + phaseLabel + '</span>' +
        '<span class="phase-toggle collapsed"><i class="fas fa-chevron-down"></i></span>' +
        '</div>' +
        '<div class="thinking-phase-body collapsed">' +
        simpleTextToHtml(phaseText) +
        '</div></div>';

    var outputHtml = parseMarkdown(outputText);

    return phaseHtml + outputHtml;
}

function buildFinalThinkingBlock(text) {
    if (!text || text.length < 10) return '';
    if (isOllamaSession()) return '';
    var display = text.length > 1200 ? '...' + text.slice(-1200) : text;
    display = escapeHtml(display).replace(/\n/g, '<br>');
    var secs = Math.max(1, Math.round(text.length / 15));
    var timeStr = secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
    var uid = 'think-' + Date.now();

    return '<div class="thinking-phase" id="' + uid + '">' +
        '<div class="thinking-phase-header" onclick="toggleThinkingPhase(\'' + uid + '\')">' +
        '<span class="phase-icon"><i class="fas fa-brain"></i></span>' +
        '<span class="phase-label">Thought for ' + timeStr + '</span>' +
        '<span class="phase-toggle collapsed"><i class="fas fa-chevron-down"></i></span>' +
        '</div>' +
        '<div class="thinking-phase-body collapsed">' + display + '</div>' +
        '</div>';
}

window.toggleThinkingPhase = function (uid) {
    var block = document.getElementById(uid);
    if (!block) return;
    var body = block.querySelector('.thinking-phase-body');
    var toggle = block.querySelector('.phase-toggle');
    if (!body || !toggle) return;

    if (body.classList.contains('collapsed')) {
        body.classList.remove('collapsed');
        toggle.classList.remove('collapsed');
        var phaseBody = body;
        var currentHtml = phaseBody.innerHTML;
        if (currentHtml.indexOf('language-') === -1 && currentHtml.indexOf('<table') === -1) {
            var rawText = phaseBody.textContent || '';
            if (rawText.length > 50) {
                phaseBody.innerHTML = parseMarkdown(rawText);
                highlightCodeBlocks(phaseBody);
            }
        }
    } else {
        body.classList.add('collapsed');
        toggle.classList.add('collapsed');
    }
};

window.toggleThinkingBlock = function (el) {
    var block;
    if (el && el.closest) block = el.closest('.thinking-phase') || el.closest('.thinking-block');
    else block = document.getElementById('sai-thinking-block');
    if (!block) return;

    var body = block.querySelector('.thinking-phase-body') || block.querySelector('.thinking-text');
    var toggle = block.querySelector('.phase-toggle') || block.querySelector('.thinking-toggle i');
    if (!body) return;

    if (body.style.display === 'none' || body.classList.contains('collapsed')) {
        body.style.display = '';
        body.classList.remove('collapsed');
        if (toggle) { toggle.classList.remove('collapsed'); toggle.className = 'fas fa-chevron-down'; }
    } else {
        body.style.display = 'none';
        body.classList.add('collapsed');
        if (toggle) { toggle.classList.add('collapsed'); toggle.className = 'fas fa-chevron-right'; }
    }
};

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
    if (!btn) return;
    if (state.isStreaming) {
        btn.classList.add('stop');
        btn.innerHTML = '<i class="fas fa-stop"></i>';
        btn.title = state.activeTask.loopCount > 0
            ? 'Stop task (loop ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + ')'
            : 'Stop generating';
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

export function editFileCode(btn) {
    var block = btn.closest('.file-block');
    if (!block) return;

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
        var el = block.querySelector('code');
        if (el) {
            el.classList.remove('prism-highlighted');
            requestAnimationFrame(function () { highlightCodeBlocks(block); });
        }
        return;
    }

    block.classList.add('editing');
    var pre = block.querySelector('pre');
    var currentCode = pre ? (pre.querySelector('code') ? pre.querySelector('code').textContent : '') : '';

    var textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.value = currentCode;
    textarea.spellcheck = false;

    if (pre) pre.style.display = 'none';
    if (pre && pre.parentNode) pre.parentNode.insertBefore(textarea, pre);

    btn.innerHTML = '<i class="fas fa-eye"></i> Preview';
    btn.style.color = 'var(--accent)';

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