/* ═══════════════════════════════════════
   EVENTS — All DOM event listeners
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import {
    openModal, closeModal, autoResize,
    bindQuickActions, toast, updateProviderHint
} from './ui.js';
import { setMode } from './modes.js';
import { handleSlashCommand, clearChat, exportChat } from './commands.js';
import { sendMessage, testConnection, fetchModels } from './connection.js';
import { toggleMic, toggleVoiceChat, stopVoiceChatCompletely } from './voice.js';
import { saveSettings, saveFromSettingsUI } from './storage.js';
import { connectFolder, refreshFolder } from './filesystem.js';

export function initEventListeners() {
    const input = document.getElementById('msg-input');
    const sendBtn = document.getElementById('send-btn');

    sendBtn.addEventListener('click', () => {
        if (state.isStreaming) {
            sendMessage('');
            return;
        }

        const text = input.value.trim();
        if (!text) return;

        /* Route to multi-agent pipeline when in multiagent mode */
        if (state.currentMode === 'multiagent') {
            import('./multiagent.js').then(function(m) { m.startMultiAgentMode(); });
        } else {
            sendMessage(text);
            input.value = '';
            input.style.height = 'auto';
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = input.value.trim();
            if (text.startsWith('/')) {
                /* Route multi-agent slash commands directly */
                if (text === '/multiagent' || text === '/team') {
                    import('./multiagent.js').then(function(m) { m.startMultiAgentMode(); });
                    input.value = '';
                    return;
                }
                handleSlashCommand(text);
                input.value = '';
                return;
            }
            sendBtn.click();
        }
    });
    input.addEventListener('input', () => autoResize(input));

    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('mobile-overlay');
        sidebar.classList.toggle('collapsed');
        overlay.classList.toggle('active', !sidebar.classList.contains('collapsed') && window.innerWidth <= 768);
    });
    document.getElementById('mobile-overlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('collapsed');
        document.getElementById('mobile-overlay').classList.remove('active');
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    /* Bind standard quick actions first */
    bindQuickActions();

    /* Override quick actions for multi-agent commands — onclick replaces
       the handler set by bindQuickActions since it's a property, not addEventListener */
    document.querySelectorAll('.quick-action[data-cmd="/multiagent"], .quick-action[data-cmd="/team"]').forEach(function(btn) {
        btn.onclick = function() {
            import('./multiagent.js').then(function(m) { m.startMultiAgentMode(); });
        };
    });

    document.getElementById('qa-settings').addEventListener('click', () => openModal('settings-modal'));

    document.getElementById('btn-settings').addEventListener('click', () => openModal('settings-modal'));
    document.getElementById('btn-prompt').addEventListener('click', () => openModal('prompt-modal'));
    document.getElementById('btn-export').addEventListener('click', exportChat);
    document.getElementById('btn-clear').addEventListener('click', clearChat);

    document.getElementById('btn-voice-chat').addEventListener('click', toggleVoiceChat);
    document.getElementById('mic-btn').addEventListener('click', toggleMic);
    document.getElementById('voice-stop-btn').addEventListener('click', stopVoiceChatCompletely);

    document.getElementById('s-provider').addEventListener('change', function () {
        state.settings.provider = document.getElementById('s-provider').value;
        updateProviderHint();
    });
    document.getElementById('s-fetch-models').addEventListener('click', fetchModels);
    document.getElementById('s-models-list').addEventListener('change', (e) => {
        document.getElementById('s-model').value = e.target.value;
    });
    document.getElementById('s-test-conn').addEventListener('click', async () => {
        saveFromSettingsUI();
        await testConnection();
    });
    document.getElementById('s-save').addEventListener('click', async () => {
        saveFromSettingsUI();
        closeModal('settings-modal');
        if (state.settings.model) await testConnection();
        else toast('Settings saved. Set a model to connect.', 'info');
    });

    document.querySelectorAll('.preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const preset = chip.dataset.preset;
            document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            if (preset) setMode(preset);
        });
    });
    document.getElementById('s-prompt-save').addEventListener('click', () => {
        state.settings.systemPrompt = document.getElementById('s-prompt').value;
        saveSettings();
        closeModal('prompt-modal');
        toast('System prompt updated', 'success');
    });

    document.getElementById('q-temp').addEventListener('input', (e) => {
        document.getElementById('q-temp-val').textContent = e.target.value;
        state.settings.temperature = parseFloat(e.target.value);
        saveSettings();
    });
    document.getElementById('q-tokens').addEventListener('change', (e) => {
        state.settings.maxTokens = parseInt(e.target.value) || 4096;
        saveSettings();
    });

    document.getElementById('q-voice-rate').addEventListener('input', (e) => {
        document.getElementById('q-voice-rate-val').textContent = parseFloat(e.target.value).toFixed(1);
        voiceState.rate = parseFloat(e.target.value);
        saveSettings();
    });

    document.getElementById('project-context').addEventListener('input', () => {
        localStorage.setItem('sai_context', document.getElementById('project-context').value);
    });

    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    document.getElementById('btn-connect-folder').addEventListener('click', connectFolder);
    document.getElementById('btn-refresh-folder').addEventListener('click', refreshFolder);
    document.getElementById('btn-reset-settings').addEventListener('click', function() {
        import('./storage.js').then(function(s) { s.resetAllSettings(); });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
        }
    });

    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.add('collapsed');
    }
}