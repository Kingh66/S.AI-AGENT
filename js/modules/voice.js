/* ═══════════════════════════════════════
   VOICE — Speech Recognition & TTS
   Natural conversation flow, high-quality
   voice selection, smart text cleanup
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { toast } from './ui.js';

let femaleVoice = null;

export function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceState.isSupported = !!SR;
    if (!voiceState.isSupported) {
        document.getElementById('mic-btn').classList.add('unavailable');
        document.getElementById('mic-btn').title = 'Voice not supported in this browser';
    } else {
        voiceState.recognition = new SR();
        voiceState.recognition.continuous = true;
        voiceState.recognition.interimResults = true;
        voiceState.recognition.lang = voiceState.lang;
        voiceState.recognition.maxAlternatives = 1;
        voiceState.recognition.onresult = handleVoiceResult;
        voiceState.recognition.onerror = handleVoiceError;
        voiceState.recognition.onend = handleVoiceEnd;
    }

    /* Pre-load voices — they load asynchronously */
    if ('speechSynthesis' in window) {
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }
}

/* ═══════════════════════════════════════════════════
   VOICE SELECTION — Prioritize natural-sounding voices
   
   Priority order:
   1. Google network voices (most natural in Chrome)
   2. Microsoft Enhanced/Neural voices (very natural)
   3. Female-identified voices matching the language
   4. Any voice matching the language
   5. English female voice as fallback
   6. First available voice as last resort
   ═══════════════════════════════════════════════════ */
function loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    const lang = voiceState.lang.split('-')[0];
    
    const femaleKeywords = ['female', 'woman', 'samantha', 'karen', 'moira', 'tessa', 'fiona', 'veena', 'zira', 'hazel', 'susan', 'linda', 'heather', 'catherine', 'allison', 'paulina', 'alice', 'ana', 'maria', 'elena', 'sofia', 'nicky', 'filiz', 'amelie', 'charlotte'];
    
    /* 1. Google network voices (most natural) */
    femaleVoice = voices.find(v =>
        v.lang.startsWith(lang) &&
        v.name.toLowerCase().includes('google')
    );
    if (femaleVoice) return;
    
    /* 2. Microsoft Enhanced/Neural voices (very natural) */
    femaleVoice = voices.find(v =>
        v.lang.startsWith(lang) &&
        v.name.toLowerCase().includes('microsoft') &&
        (v.name.toLowerCase().includes('enhanced') || v.name.toLowerCase().includes('neural') || v.name.toLowerCase().includes('online'))
    );
    if (femaleVoice) return;
    
    /* 3. Female-identified voices matching language */
    femaleVoice = voices.find(v =>
        v.lang.startsWith(lang) &&
        femaleKeywords.some(kw => v.name.toLowerCase().includes(kw))
    );
    if (femaleVoice) return;
    
    /* 4. Any non-male voice matching language */
    femaleVoice = voices.find(v =>
        v.lang.startsWith(lang) &&
        !v.name.toLowerCase().includes('male') &&
        !v.name.toLowerCase().includes('david') &&
        !v.name.toLowerCase().includes('mark') &&
        !v.name.toLowerCase().includes('james') &&
        !v.name.toLowerCase().includes('daniel') &&
        !v.name.toLowerCase().includes('thomas')
    );
    if (femaleVoice) return;
    
    /* 5. Any voice for the language */
    femaleVoice = voices.find(v => v.lang.startsWith(lang));
    if (femaleVoice) return;
    
    /* 6. English female voice as fallback */
    femaleVoice = voices.find(v =>
        v.lang.startsWith('en') &&
        femaleKeywords.some(kw => v.name.toLowerCase().includes(kw))
    );
    
    /* 7. Last resort */
    if (!femaleVoice && voices.length > 0) {
        femaleVoice = voices[0];
    }
}

/* ═══════════════════════════════════════════════════
   VOICE RESULT HANDLING
   
   FIX: Increased auto-send timeout from 2s to 2.8s
   to allow for natural speech pauses (thinking,
   breathing) without prematurely cutting off the user.
   ═══════════════════════════════════════════════════ */
function handleVoiceResult(event) {
    if (voiceState.isVoiceChat) clearTimeout(voiceState.autoSendTimeout);
    let finalT = '', interimT = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalT += t; else interimT += t;
    }
    const input = document.getElementById('msg-input');
    if (voiceState.isVoiceChat) {
        voiceState.accumulatedText += finalT;
        input.value = voiceState.accumulatedText + interimT;
    } else {
        input.value = finalT + interimT;
    }
    import('./ui.js').then(({ autoResize }) => autoResize(input));

    /* Auto-send after a natural pause (2.8s) in voice chat mode */
    if (voiceState.isVoiceChat && finalT.trim()) {
        voiceState.autoSendTimeout = setTimeout(() => {
            const text = input.value.trim();
            if (text && !state.isStreaming) {
                voiceState.accumulatedText = '';
                stopListening();
                import('./connection.js').then(({ sendMessage }) => sendMessage(text));
                input.value = '';
                input.style.height = 'auto';
            }
        }, 2800);
    }
}

function handleVoiceError(event) {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    setVoiceMode('idle');
    if (event.error === 'not-allowed') toast('Microphone access denied. Allow mic in browser settings.', 'error');
    else if (event.error !== 'network') toast('Voice error: ' + event.error, 'error');
}

function handleVoiceEnd() {
    /* Restart if we're still supposed to be listening AND not speaking */
    if (voiceState.mode === 'listening' && voiceState.recognition) {
        try { voiceState.recognition.start(); } catch(e) {}
    }
}

export function startListening() {
    if (!voiceState.isSupported || !voiceState.recognition) { toast('Voice recognition not supported', 'error'); return false; }
    
    /* Don't start if AI is currently speaking */
    if (voiceState.isSpeaking) return false;
    
    voiceState.accumulatedText = '';
    voiceState.mode = 'listening';
    try { voiceState.recognition.start(); } catch(e) {}
    updateMicButton();
    updateVoiceStatusBar();
    return true;
}

export function stopListening() {
    voiceState.mode = 'idle';
    if (voiceState.recognition) {
        try { voiceState.recognition.abort(); } catch(e) {}
        try { voiceState.recognition.stop(); } catch(e) {}
    }
    clearTimeout(voiceState.autoSendTimeout);
    updateMicButton();
    updateVoiceStatusBar();
}

export function toggleMic() {
    if (voiceState.mode === 'listening') stopListening();
    else { if (state.isStreaming) { toast('Wait for the response to finish', 'info'); return; } startListening(); }
}

export function toggleVoiceChat() {
    voiceState.isVoiceChat = !voiceState.isVoiceChat;
    document.getElementById('btn-voice-chat').classList.toggle('active', voiceState.isVoiceChat);
    if (voiceState.isVoiceChat) {
        toast('Voice chat enabled — speak naturally', 'success');
        if (!voiceState.isSupported) {
            toast('Voice not supported in this browser', 'error');
            voiceState.isVoiceChat = false;
            document.getElementById('btn-voice-chat').classList.remove('active');
            return;
        }
        if (voiceState.mode === 'idle' && !state.isStreaming) startListening();
    } else {
        toast('Voice chat disabled', 'info');
        stopListening();
        stopSpeaking();
        document.getElementById('voice-status-bar').classList.remove('active');
    }
}

export function stopVoiceChatCompletely() {
    voiceState.isVoiceChat = false;
    document.getElementById('btn-voice-chat').classList.remove('active');
    stopListening();
    stopSpeaking();
    document.getElementById('voice-status-bar').classList.remove('active');
    toast('Voice chat stopped', 'info');
}

/* ═══════════════════════════════════════════════════
   TEXT-TO-SPEECH — Natural voice output
   
   Improvements:
   1. Better text cleanup for TTS (strips code, markdown,
      emojis, URLs, and file paths that sound robotic)
   2. Slightly higher pitch (1.12) for a warmer tone
   3. Auto-resume listening after speaking in voice chat
   4. Chrome 15-second bug workaround via chunking
   ═══════════════════════════════════════════════════ */
export function speakText(text, onDone) {
    if (!('speechSynthesis' in window)) { if (onDone) onDone(); return; }

    /* CRITICAL: Kill recognition while speaking to prevent feedback loop */
    if (voiceState.recognition) {
        try { voiceState.recognition.abort(); } catch(e) {}
    }

    stopSpeaking();
    const clean = cleanTextForTTS(text);
    if (!clean) { if (onDone) onDone(); return; }
    const chunks = splitIntoChunks(clean, 2800);

    function speakChunk(i) {
        if (i >= chunks.length) {
            voiceState.isSpeaking = false;
            if (onDone) onDone();
            /* Auto-resume listening after speaking in voice chat mode */
            if (voiceState.isVoiceChat && !state.isStreaming) {
                setTimeout(() => {
                    if (voiceState.isVoiceChat && voiceState.mode === 'idle') {
                        startListening();
                    }
                }, 800);
            }
            return;
        }
        const u = new SpeechSynthesisUtterance(chunks[i]);
        u.rate = voiceState.rate;
        u.lang = voiceState.lang;
        if (femaleVoice) u.voice = femaleVoice;
        u.pitch = 1.12;
        u.onend = () => speakChunk(i + 1);
        u.onerror = () => { voiceState.isSpeaking = false; if (onDone) onDone(); };
        voiceState.currentUtterance = u;
        voiceState.isSpeaking = true;
        window.speechSynthesis.speak(u);
    }
    speakChunk(0);
}

/* ═══════════════════════════════════════════════════
   CLEAN TEXT FOR TTS
   
   Strips everything that sounds robotic when read aloud:
   - Code blocks and inline code
   - Markdown formatting (headers, bold, italic, links)
   - Emojis (replaced with descriptions or removed)
   - URLs (replaced with "link")
   - File paths (cleaned up)
   - Excessive punctuation
   ═══════════════════════════════════════════════════ */
function cleanTextForTTS(text) {
    return text
        /* Remove entire code blocks */
        .replace(/```[\s\S]*?```/g, '. Code omitted. ')
        .replace(/```[\s\S]*$/g, '. Code omitted. ')
        
        /* Remove inline code */
        .replace(/`([^`]+)`/g, '$1')
        
        /* Replace emojis with natural descriptions */
        .replace(/✅/g, 'done')
        .replace(/❌/g, 'failed')
        .replace(/⚠️/g, 'warning')
        .replace(/🐛/g, 'bug')
        .replace(/🔒/g, 'locked')
        .replace(/📦/g, '')
        .replace(/📋/g, '')
        .replace(/📁/g, '')
        .replace(/📊/g, '')
        .replace(/🤖/g, '')
        .replace(/👤/g, '')
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') /* Remove most other emojis */
        
        /* Remove markdown headers */
        .replace(/^#{1,6}\s/gm, '')
        
        /* Remove bold/italic markers */
        .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        
        /* Remove links, keep text */
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        
        /* Remove raw URLs */
        .replace(/https?:\/\/[^\s)\]]+/g, 'link')
        
        /* Remove file paths (they sound terrible spoken aloud) */
        .replace(/(?:\/[\w.-]+){2,}/g, match => match.split('/').pop())
        
        /* Clean up list markers */
        .replace(/^[-*+]\s/gm, '')
        .replace(/^\d+\.\s/gm, '')
        .replace(/^>\s/gm, '')
        
        /* Remove horizontal rules */
        .replace(/^---+$/gm, '')
        
        /* Remove HTML tags */
        .replace(/<[^>]+>/g, '')
        
        /* Clean up excessive punctuation */
        .replace(/\.{4,}/g, '...')
        .replace(/\.\.\./g, ', pause, ')
        .replace(/—/g, ', ')
        .replace(/–/g, ', ')
        
        /* Convert line breaks to sentences */
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, '. ')
        
        /* Clean up spacing */
        .replace(/\s{2,}/g, ' ')
        
        /* Remove empty parentheses */
        .replace(/\(\s*\)/g, '')
        
        /* Clean up trailing/leading dots and spaces */
        .replace(/\.\s*\./g, '.')
        .replace(/^\s*\.\s*/g, '')
        .trim();
}

function splitIntoChunks(text, maxLen) {
    const chunks = [], sentences = text.split(/(?<=[.!?])\s+/);
    let cur = '';
    for (const s of sentences) {
        if ((cur + ' ' + s).length > maxLen && cur) { chunks.push(cur.trim()); cur = s; }
        else cur = cur ? cur + ' ' + s : s;
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.length ? chunks : [text.substring(0, maxLen)];
}

export function stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    voiceState.isSpeaking = false;
    voiceState.currentUtterance = null;
}

export function speakLastResponse() {
    const last = [...state.conversationHistory].reverse().find(m => m.role === 'assistant');
    if (!last) { toast('No response to speak', 'info'); return; }
    if (voiceState.isSpeaking) { stopSpeaking(); toast('Speech stopped', 'info'); }
    else speakText(last.content);
}

function updateMicButton() {
    const btn = document.getElementById('mic-btn');
    if (voiceState.mode === 'listening') {
        btn.classList.add('recording');
        btn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        btn.title = 'Click to stop recording';
    } else {
        btn.classList.remove('recording');
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
        btn.title = 'Click to speak';
    }
}

function updateVoiceStatusBar() {
    const bar = document.getElementById('voice-status-bar');
    const dot = document.getElementById('voice-status-dot');
    const text = document.getElementById('voice-status-text');

    if (!voiceState.isVoiceChat && voiceState.mode === 'idle') { bar.classList.remove('active'); return; }
    if (voiceState.isVoiceChat && voiceState.mode === 'idle' && !state.isStreaming && !voiceState.isSpeaking) {
        startListening();
        return;
    }

    bar.classList.add('active');
    dot.className = 'voice-status-dot';
    switch (voiceState.mode) {
        case 'listening': text.textContent = 'Listening...'; break;
        case 'thinking': text.textContent = 'Thinking...'; dot.classList.add('thinking'); break;
        case 'speaking': text.textContent = 'Speaking...'; dot.classList.add('speaking'); break;
        default: bar.classList.remove('active');
    }
}

export function setVoiceMode(mode) {
    voiceState.mode = mode;
    updateMicButton();
    updateVoiceStatusBar();

    /* When entering speaking mode, aggressively kill the mic to prevent feedback */
    if (mode === 'speaking' && voiceState.recognition) {
        try { voiceState.recognition.abort(); } catch(e) {}
    }
}