/* ═══════════════════════════════════════
   STORAGE — LocalStorage save/load
   Auto-repairs broken endpoints on load
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';   
import { SYSTEM_PROMPTS, PROVIDER_DEFAULTS } from './config.js';
import { toast } from './ui.js';

var BAD_ENDPOINTS = [
    'http://localhost:8000/v1',
    'http://localhost:8080/v1',
    ''
];

function repairEndpoint() {
    var ep = state.settings.endpoint;
    var provider = state.settings.provider;
    var defaults = PROVIDER_DEFAULTS[provider];
    var needsFix = false;
    if (!ep) needsFix = true;
    else {
        for (var i = 0; i < BAD_ENDPOINTS.length; i++) {
            if (ep === BAD_ENDPOINTS[i]) { needsFix = true; break; }
        }
        if (ep.indexOf('/v1/v1') > -1) needsFix = true;
    }
    if (needsFix && defaults) {
        state.settings.endpoint = defaults.endpoint;
        return true;
    }
    return false;
}

export function resetAllSettings() {
    localStorage.removeItem('sai_settings');
    localStorage.removeItem('sai_context');
    localStorage.removeItem('sai_mode');
    localStorage.removeItem('sai_voice_lang');
    localStorage.removeItem('sai_voice_rate');
    state.settings.provider = 'openrouter';
    state.settings.endpoint = PROVIDER_DEFAULTS.openrouter.endpoint;
    state.settings.apiKey = '';
    state.settings.model = '';
    state.settings.temperature = 0.7;
    state.settings.maxTokens = 4096;
    state.settings.systemPrompt = SYSTEM_PROMPTS[state.currentMode];
    document.getElementById('project-context').value = '';
    toast('All settings reset to defaults', 'success');
}

export function saveSettings() {
    var toSave = {
        provider: state.settings.provider,
        endpoint: state.settings.endpoint,
        apiKey: state.settings.apiKey,
        model: state.settings.model,
        temperature: state.settings.temperature,
        maxTokens: state.settings.maxTokens,
        systemPrompt: SYSTEM_PROMPTS[state.currentMode] || state.settings.systemPrompt
    };
    localStorage.setItem('sai_settings', JSON.stringify(toSave));
    localStorage.setItem('sai_context', document.getElementById('project-context').value);
    localStorage.setItem('sai_mode', state.currentMode);
    localStorage.setItem('sai_voice_lang', voiceState.lang);
    localStorage.setItem('sai_voice_rate', voiceState.rate.toString());
}

export function loadSettings() {
    var repaired = false;
    try {
        var saved = localStorage.getItem('sai_settings');
        if (saved) {
            var parsed = JSON.parse(saved);
            Object.assign(state.settings, parsed);
        }
    } catch (e) {
        localStorage.removeItem('sai_settings');
    }
    repaired = repairEndpoint();
    var defaults = PROVIDER_DEFAULTS[state.settings.provider];
    if (defaults) {
        var allEndpoints = [];
        for (var key in PROVIDER_DEFAULTS) { allEndpoints.push(PROVIDER_DEFAULTS[key].endpoint); }
        if (allEndpoints.indexOf(state.settings.endpoint) === -1) {
            state.settings.endpoint = defaults.endpoint;
            repaired = true;
        }
    }
    if (state.settings.model) {
        var modelIsOk = false;
        if (state.settings.model.indexOf(':free') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('/') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('codellama') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('llama') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('gpt') > -1) modelIsOk = true;
        if (!modelIsOk) { state.settings.model = ''; repaired = true; }
    }
    if (repaired) saveSettings();

    var context = localStorage.getItem('sai_context');
    if (context) document.getElementById('project-context').value = context;
    var mode = localStorage.getItem('sai_mode');
    if (mode && SYSTEM_PROMPTS[mode]) {
        import('./modes.js').then(function(m) { m.setMode(mode); });
    } else {
        state.settings.systemPrompt = SYSTEM_PROMPTS[state.currentMode];
    }
    var voiceLang = localStorage.getItem('sai_voice_lang');
    if (voiceLang) {
        voiceState.lang = voiceLang;
        var langSelect = document.getElementById('q-voice-lang');
        if (langSelect) langSelect.value = voiceLang;
    }
    var voiceRate = localStorage.getItem('sai_voice_rate');
    if (voiceRate) {
        voiceState.rate = parseFloat(voiceRate);
        var rateInput = document.getElementById('q-voice-rate');
        var rateVal = document.getElementById('q-voice-rate-val');
        if (rateInput) rateInput.value = voiceState.rate;
        if (rateVal) rateVal.textContent = voiceState.rate.toFixed(1);
    }
}

export function saveFromSettingsUI() {
    state.settings.provider = document.getElementById('s-provider').value;
    state.settings.endpoint = document.getElementById('s-endpoint').value.replace(/\/+$/, '');
    state.settings.apiKey = document.getElementById('s-apikey').value.trim();
    state.settings.model = document.getElementById('s-model').value.trim();
    state.settings.temperature = parseFloat(document.getElementById('q-temp').value);
    state.settings.maxTokens = parseInt(document.getElementById('q-tokens').value) || 4096;
    voiceState.lang = document.getElementById('q-voice-lang').value;
    voiceState.rate = parseFloat(document.getElementById('q-voice-rate').value);
    if (voiceState.recognition) voiceState.recognition.lang = voiceState.lang;
    repairEndpoint();
    saveSettings();
}