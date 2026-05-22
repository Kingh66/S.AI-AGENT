/* ═══════════════════════════════════════
   VOICE — Speech Recognition & TTS
   Natural conversation flow, high-quality
   voice selection, smart text cleanup,
   + Tab focus greeting (closest to 
     "welcome back" possible in browser)
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { toast } from './ui.js';

let femaleVoice = null;
let lastVisibleTimestamp = Date.now();
let hasGreetedThisSession = false;

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

    if ('speechSynthesis' in window) {
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    /* ═══════════════════════════════════════════════════
       TAB FOCUS GREETING
       
       When the user switches back to the S.ai tab
       after being away for > 2 minutes, S.ai greets
       them with a time-appropriate welcome.
       
       This is the browser-equivalent of "welcome back
       from lock screen" — it triggers when the user
       clicks back on the Chrome tab.
       ═══════════════════════════════════════════════════ */
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
}

function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        const awayDuration = Date.now() - lastVisibleTimestamp;
        const awayMinutes = Math.floor(awayDuration / 60000);
        
        /* Only greet if away for more than 2 minutes and voice chat is active */
        if (awayMinutes >= 2 && voiceState.isVoiceChat && !state.isStreaming && !voiceState.isSpeaking) {
            const greeting = getTimeAppropriateGreeting(awayMinutes);
            speakText(greeting, () => {
                /* After greeting, auto-start listening for a response */
                if (voiceState.isVoiceChat) {
                    setTimeout(() => startListening(), 500);
                }
            });
        }
        
        /* If voice chat is active and we come back, resume listening */
        if (voiceState.isVoiceChat && voiceState.mode === 'idle' && !state.isStreaming) {
            setTimeout(() => startListening(), 300);
        }
    } else {
        lastVisibleTimestamp = Date.now();
        /* Tab lost focus — pause listening to save resources */
        if (voiceState.mode === 'listening' && voiceState.isVoiceChat) {
            stopListening();
            voiceState.mode = 'idle'; // Keep idle so we can resume later
        }
    }
}

function handleWindowFocus() {
    /* Similar to visibility change but catches alt-tab back */
    if (!hasGreetedThisSession && voiceState.isVoiceChat) {
        hasGreetedThisSession = true;
        // First focus greeting is handled by visibility change
    }
}

/* ═══════════════════════════════════════════════════
   TIME-APPROPRIATE GREETINGS
   
   Generates a natural, time-aware greeting based
   on how long the user was away and current time.
   ═══════════════════════════════════════════════════ */
function getTimeAppropriateGreeting(awayMinutes) {
    const hour = new Date().getHours();
    let timeGreeting;
    
    if (hour >= 5 && hour < 12) timeGreeting = 'Good morning';
    else if (hour >= 12 && hour < 17) timeGreeting = 'Good afternoon';
    else if (hour >= 17 && hour < 21) timeGreeting = 'Good evening';
    else timeGreeting = 'Hello';
    
    if (awayMinutes >= 60) {
        const hours = Math.floor(awayMinutes / 60);
        return timeGreeting + ' sir. Nice to have you back. It\'s been about ' + hours + (hours === 1 ? ' hour' : ' hours') + '. What are we working on today?';
    } else if (awayMinutes >= 10) {
        return timeGreeting + ' sir. Welcome back. What would you like to work on?';
    } else {
        return timeGreeting + '. Ready when you are.';
    }
}

function loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    const lang = voiceState.lang.split('-')[0];
    
    const femaleKeywords = ['female', 'woman', 'samantha', 'karen', 'moira', 'tessa', 'fiona', 'veena', 'zira', 'hazel', 'susan', 'linda', 'heather', 'catherine', 'allison', 'paulina', 'alice', 'ana', 'maria', 'elena', 'sofia', 'nicky', 'filiz', 'amelie', 'charlotte'];
    
    femaleVoice = voices.find(v =>
        v.lang.startsWith(lang) &&
        v.name.toLowerCase().includes('google')
    );
    if (femaleVoice) return;
    
    femaleVoice = voices.find(v =>
        v.lang.startsWith(lang) &&
        v.name.toLowerCase().includes('microsoft') &&
        (v.name.toLowerCase().includes('enhanced') || v.name.toLowerCase().includes('neural') || v.name.toLowerCase().includes('online'))
    );
    if (femaleVoice) return;
    
    femaleVoice = voices.find(v =>
        v.lang.startsWith(lang) &&
        femaleKeywords.some(kw => v.name.toLowerCase().includes(kw))
    );
    if (femaleVoice) return;
    
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
    
    femaleVoice = voices.find(v => v.lang.startsWith(lang));
    if (femaleVoice) return;
    
    femaleVoice = voices.find(v =>
        v.lang.startsWith('en') &&
        femaleKeywords.some(kw => v.name.toLowerCase().includes(kw))
    );
    
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
    if (voiceState.mode === 'listening' && voiceState.recognition) {
        try { voiceState.recognition.start(); } catch(e) {}
    }
}

export function startListening() {
    if (!voiceState.isSupported || !voiceState.recognition) { toast('Voice recognition not supported', 'error'); return false; }
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

export function speakText(text, onDone) {
    if (!('speechSynthesis' in window)) { if (onDone) onDone(); return; }

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

function cleanTextForTTS(text) {
    return text
        .replace(/```[\s\S]*?```/g, '. Code omitted. ')
        .replace(/```[\s\S]*$/g, '. Code omitted. ')
        .replace(/`([^`]+)`/g, '$1')
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
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
        .replace(/^#{1,6}\s/gm, '')
        .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/https?:\/\/[^\s)\]]+/g, 'link')
        .replace(/(?:\/[\w.-]+){2,}/g, match => match.split('/').pop())
        .replace(/^[-*+]\s/gm, '')
        .replace(/^\d+\.\s/gm, '')
        .replace(/^>\s/gm, '')
        .replace(/^---+$/gm, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\.{4,}/g, '...')
        .replace(/\.\.\./g, ', pause, ')
        .replace(/—/g, ', ')
        .replace(/–/g, ', ')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, '. ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\(\s*\)/g, '')
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

    if (mode === 'speaking' && voiceState.recognition) {
        try { voiceState.recognition.abort(); } catch(e) {}
    }
}