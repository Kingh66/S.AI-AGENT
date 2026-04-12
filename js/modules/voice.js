/* ═══════════════════════════════════════
   VOICE — Speech Recognition & TTS
   Female voice, no feedback loop
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

function loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    /* Priority: female voice matching the selected language */
    const lang = voiceState.lang.split('-')[0];
    const femaleKeywords = ['female', 'woman', 'girl', 'samantha', 'karen', 'moira', 'tessa', 'fiona', 'veena', 'zira', 'hazel', 'susan', 'linda', 'heather', 'catherine', 'allison', 'paulina', 'alice', 'ana', 'maria', 'elena', 'sofia', 'google.*female'];

    /* First pass: exact language match + female keyword in name */
    femaleVoice = voices.find(v =>
        v.lang.startsWith(lang) &&
        femaleKeywords.some(kw => v.name.toLowerCase().includes(kw))
    );

    /* Second pass: any female-sounding name matching language */
    if (!femaleVoice) {
        femaleVoice = voices.find(v =>
            v.lang.startsWith(lang) &&
            !v.name.toLowerCase().includes('male') &&
            (v.name.toLowerCase().includes('female') ||
             ['samantha', 'karen', 'moira', 'tessa', 'fiona', 'veena', 'zira', 'hazel', 'susan', 'linda', 'heather', 'catherine', 'allison', 'paulina', 'alice', 'ana', 'maria', 'elena', 'sofia', 'nicky', 'filiz', 'amelie', 'charlotte', 'mathieu'].some(n => v.name.toLowerCase().includes(n)))
        );
    }

    /* Third pass: any voice for the language (better than nothing) */
    if (!femaleVoice) {
        femaleVoice = voices.find(v => v.lang.startsWith(lang));
    }

    /* Fourth pass: any English female voice as fallback */
    if (!femaleVoice) {
        femaleVoice = voices.find(v =>
            v.lang.startsWith('en') &&
            femaleKeywords.some(kw => v.name.toLowerCase().includes(kw))
        );
    }

    /* Last resort: first available voice */
    if (!femaleVoice && voices.length > 0) {
        femaleVoice = voices[0];
    }
}

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
        }, 2000);
    }
}

function handleVoiceError(event) {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    setVoiceMode('idle');
    if (event.error === 'not-allowed') toast('Microphone access denied. Allow mic in browser settings.', 'error');
    else toast('Voice error: ' + event.error, 'error');
}

function handleVoiceEnd() {
    /* Only restart if we're still supposed to be listening AND not speaking */
    if (voiceState.mode === 'listening' && voiceState.recognition) {
        try { voiceState.recognition.start(); } catch(e) {}
    }
}

export function startListening() {
    if (!voiceState.isSupported || !voiceState.recognition) { toast('Voice recognition not supported', 'error'); return false; }
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

export function speakText(text, onDone) {
    if (!('speechSynthesis' in window)) { if (onDone) onDone(); return; }

    /* CRITICAL: Kill recognition while speaking to prevent feedback loop */
    if (voiceState.recognition) {
        try { voiceState.recognition.abort(); } catch(e) {}
    }

    stopSpeaking();
    const clean = text
        .replace(/```[\s\S]*?```/g, ' code block omitted. ')
        .replace(/`[^`]+`/g, '')
        .replace(/#{1,6}\s/g, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[-*+]\s/g, '')
        .replace(/\d+\.\s/g, '')
        .replace(/>\s/g, '')
        .replace(/---+/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, '. ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (!clean) { if (onDone) onDone(); return; }
    const chunks = splitIntoChunks(clean, 3000);

    function speakChunk(i) {
        if (i >= chunks.length) { voiceState.isSpeaking = false; if (onDone) onDone(); return; }
        const u = new SpeechSynthesisUtterance(chunks[i]);
        u.rate = voiceState.rate;
        u.lang = voiceState.lang;
        if (femaleVoice) u.voice = femaleVoice;
        u.pitch = 1.15;
        u.onend = () => speakChunk(i + 1);
        u.onerror = () => { voiceState.isSpeaking = false; if (onDone) onDone(); };
        voiceState.currentUtterance = u;
        voiceState.isSpeaking = true;
        window.speechSynthesis.speak(u);
    }
    speakChunk(0);
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
    if (voiceState.isVoiceChat && voiceState.mode === 'idle' && !state.isStreaming) { startListening(); return; }

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