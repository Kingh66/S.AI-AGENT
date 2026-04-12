/* ═══════════════════════════════════════
   MESSAGES — Rendering, streaming, actions
   Ultra-fast native bypass (Zero lag)
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { parseMarkdown } from './markdown.js';
import { highlightCodeBlocks, getTimeStr } from './ui.js';

let isInCodeBlock = false;
let streamPre = null;

export function removeWelcome() {
    const w = document.getElementById('welcome-state');
    if (w) w.remove();
}

export function addUserMessage(text) {
    removeWelcome();
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message user';
    div.innerHTML = `
        <div class="msg-avatar"><i class="fas fa-user"></i></div>
        <div class="msg-body">
            <div class="msg-meta"><span class="msg-name">You</span><span class="msg-time">${getTimeStr()}</span></div>
            <div class="msg-content"><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p></div>
        </div>`;
    msgs.appendChild(div);
    fastScroll();
}

export function addBotMessageStart() {
    removeWelcome();
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message bot';
    div.id = 'streaming-msg';
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    div.innerHTML = `
        <div class="msg-avatar">S</div>
        <div class="msg-body">
            <div class="msg-meta">
                <span class="msg-name">S.ai</span>
                <span class="msg-time">${getTimeStr()}</span>
                <button class="speak-btn" onclick="speakLastResponse()" title="Read aloud"><i class="fas fa-volume-high"></i> Speak</button>
            </div>
        </div>`;
    div.querySelector('.msg-body').appendChild(content);
    msgs.appendChild(div);
    fastScroll();
    state.streamElement = content;
    state.streamBuffer = '';
    state.isRenderScheduled = false;
    
    // Reset fast-stream state
    isInCodeBlock = false;
    streamPre = null;
}

export function appendStreamChunk(chunk) {
    state.streamBuffer += chunk;
    
    // ULTRA-OPTIMIZED CHECK:
    // 99% of chunks are just normal text/code lines and don't contain ```.
    // We completely skip regex for those and use the cached boolean.
    // Only if ``` is in the new chunk do we recount the whole buffer.
    if (chunk.indexOf('```') !== -1) {
        isInCodeBlock = ((state.streamBuffer.match(/```/g) || []).length % 2 !== 0);
    }
    
    if (!state.isRenderScheduled) {
        state.isRenderScheduled = true;
        requestAnimationFrame(() => {
            if (state.streamElement) {
                if (isInCodeBlock) {
                    // ⚡ ULTRA-FAST PATH: Native browser text dump.
                    // Bypasses ALL JS parsing. Zero lag on massive files.
                    if (!streamPre) {
                        state.streamElement.innerHTML = '';
                        streamPre = document.createElement('pre');
                        streamPre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-family:var(--mono, monospace);font-size:0.85rem;line-height:1.5;background:var(--bg-secondary, #1e1e2e);padding:12px;border-radius:8px;color:var(--text-primary, #e2e8f0);margin:0;';
                        state.streamElement.appendChild(streamPre);
                    }
                    streamPre.textContent = state.streamBuffer;
                } else {
                    // NORMAL PATH: Full markdown + safe Prism masking
                    streamPre = null;
                    var html = parseMarkdown(state.streamBuffer)
                        .replace(/class="language-/g, 'class="stream-lang-');
                    state.streamElement.innerHTML = html;
                }
                
                document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
            }
            state.isRenderScheduled = false;
        });
    }
}

export function finalizeStream() {
    state.isRenderScheduled = false;
    
    // Reset bypass state safely
    isInCodeBlock = false;
    streamPre = null;
    
    if (state.streamElement) {
        // Final render: Full markdown + real syntax highlighting
        state.streamElement.innerHTML = parseMarkdown(state.streamBuffer);
        highlightCodeBlocks(state.streamElement);
        state.conversationHistory.push({ role: 'assistant', content: state.streamBuffer });

        if (voiceState.isVoiceChat) {
            const resp = state.streamBuffer;
            import('./voice.js').then(({ speakText, startListening, setVoiceMode, stopListening }) => {
                stopListening();
                voiceState.mode = 'speaking';
                setVoiceMode('speaking');
                speakText(resp, () => {
                    if (voiceState.isVoiceChat && !state.isStreaming) {
                        setTimeout(() => startListening(), 1500);
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

function fastScroll() {
    var msgs = document.getElementById('messages');
    msgs.scrollTop = msgs.scrollHeight;
}

export function updateSendButton() {
    const btn = document.getElementById('send-btn');
    if (state.isStreaming) { btn.classList.add('stop'); btn.innerHTML = '<i class="fas fa-stop"></i>'; }
    else { btn.classList.remove('stop'); btn.innerHTML = '<i class="fas fa-arrow-up"></i>'; }
}

export function copyCode(btn) {
    const code = btn.closest('.code-block').querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i> Copied';
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
    });
}

export function useAsInput(btn) {
    const code = btn.closest('.code-block').querySelector('code').textContent;
    const input = document.getElementById('msg-input');
    input.value = code;
    import('./ui.js').then(({ autoResize }) => autoResize(input));
    input.focus();
    import('./ui.js').then(({ toast }) => toast('Code loaded into input', 'success'));
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}