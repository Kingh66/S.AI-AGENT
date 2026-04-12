/* ═══════════════════════════════════════
   MODES — Agent mode switching
   ═══════════════════════════════════════ */
import { state } from './state.js';
import { SYSTEM_PROMPTS, MODE_INFO } from './config.js';
import { saveSettings } from './storage.js';

export function setMode(mode) {
    state.currentMode = mode;
    state.settings.systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.custom;

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const info = MODE_INFO[mode];
    document.getElementById('header-mode-title').textContent = info.title;
    document.getElementById('header-mode-desc').textContent = info.desc;

    document.getElementById('s-prompt').value = state.settings.systemPrompt;

    document.querySelectorAll('.preset-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.preset === mode);
    });

    saveSettings();
}