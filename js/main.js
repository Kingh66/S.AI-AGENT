/* ═══════════════════════════════════════
   S.ai — Main Entry Point
   ═══════════════════════════════════════ */
import { loadSettings } from './modules/storage.js';
import { initEventListeners } from './modules/events.js';
import { runBoot } from './modules/boot.js';
import { speakLastResponse } from './modules/voice.js';
import { copyCode, useAsInput, editFileCode } from './modules/messages.js';
import { applyFileChange } from './modules/filesystem.js';
import { continueResponse } from './modules/connection.js';

/* Expose to window for inline onclick in dynamically generated HTML */
window.speakLastResponse = speakLastResponse;
window.copyCode = copyCode;
window.useAsInput = useAsInput;
window.editFileCode = editFileCode;
window.applyFileChange = applyFileChange;
window.saiContinueResponse = continueResponse;

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initEventListeners();
    runBoot();
});