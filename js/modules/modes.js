/* ═══════════════════════════════════════
   MODES — Agent mode switching
   ═══════════════════════════════════════ */
import { state } from './state.js';
import { SYSTEM_PROMPTS, MODE_INFO } from './config.js';
import { saveSettings } from './storage.js';
import { updateMultiAgentVisibility } from './ui.js';

export function setMode(mode) {
    state.currentMode = mode;
    state.settings.systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.custom;

    document.querySelectorAll('.mode-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    /* Guard: if MODE_INFO doesn't have this key, use a safe fallback instead of crashing */
    var info = MODE_INFO[mode] || { title: mode.charAt(0).toUpperCase() + mode.slice(1), desc: '' };
    document.getElementById('header-mode-title').textContent = info.title;
    document.getElementById('header-mode-desc').textContent = info.desc;

    document.getElementById('s-prompt').value = state.settings.systemPrompt;

    document.querySelectorAll('.preset-chip').forEach(function(chip) {
        chip.classList.toggle('active', chip.dataset.preset === mode);
    });

    /* Toggle multi-agent settings panel visibility in sidebar */
    updateMultiAgentVisibility(mode === 'multiagent');

    saveSettings();
}