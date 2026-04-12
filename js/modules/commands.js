/* ═══════════════════════════════════════
   COMMANDS — Slash commands, clear, export
   ═══════════════════════════════════════ */
import { state } from './state.js';
import { MODE_INFO } from './config.js';
import { toast } from './ui.js';

export function handleSlashCommand(cmd) {
    const input = document.getElementById('msg-input');
    const ph = {
        '/doc': 'Paste code — S.ai will generate documentation...',
        '/review': 'Paste code — S.ai will review it...',
        '/improve': 'Paste code — S.ai will improve it...',
        '/debug': 'Paste buggy code or describe the issue...',
        '/explain': 'Paste code you want explained...',
        '/selfimprove': 'Connect your workspace folder, then type this to start...'
    };
    const mm = { '/doc': 'doc', '/review': 'review', '/improve': 'improve', '/debug': 'debug', '/explain': 'explain', '/selfimprove': 'selfimprove' };

    if (mm[cmd]) {
        import('./modes.js').then(({ setMode }) => {
            setMode(mm[cmd]);
            input.value = '';
            input.placeholder = ph[cmd];
            input.focus();
            toast(`Mode: ${MODE_INFO[mm[cmd]].title}`, 'info');
        });
    } else if (cmd === '/clear') {
        clearChat();
    } else if (cmd === '/export') {
        exportChat();
    }
}

export function clearChat() {
    state.conversationHistory = [];
    document.getElementById('messages').innerHTML = `
        <div class="welcome-state" id="welcome-state">
            <div class="welcome-icon">S</div>
            <h2>S.ai, Ready</h2>
            <p>Chat cleared. Paste your code or describe what you need.</p>
            <div class="quick-actions">
                <button class="quick-action" data-cmd="/doc"><i class="fas fa-file-alt"></i> Write Documentation</button>
                <button class="quick-action" data-cmd="/review"><i class="fas fa-search-plus"></i> Review Code</button>
                <button class="quick-action" data-cmd="/improve"><i class="fas fa-wand-magic-sparkles"></i> Improve Code</button>
                <button class="quick-action" data-cmd="/debug"><i class="fas fa-bug"></i> Debug Issue</button>
                <button class="quick-action" data-cmd="/explain"><i class="fas fa-graduation-cap"></i> Explain Code</button>
                <button class="quick-action" data-cmd="/selfimprove"><i class="fas fa-brain"></i> Self-Improve</button>
            </div>
        </div>`;
    import('./ui.js').then(({ bindQuickActions }) => bindQuickActions());
    toast('Chat cleared', 'info');
}

export function exportChat() {
    if (state.conversationHistory.length === 0) { toast('Nothing to export yet', 'error'); return; }
    import('./config.js').then(({ MODE_INFO }) => {
        let md = '# S.ai Session Export\n\n';
        md += '**Date:** ' + new Date().toLocaleString() + '\n';
        md += '**Mode:** ' + MODE_INFO[state.currentMode].title + '\n';
        md += '**Model:** ' + state.settings.model + '\n\n---\n\n';
        for (const msg of state.conversationHistory) {
            md += msg.role === 'user'
                ? '## You\n\n' + msg.content + '\n\n'
                : '## S.ai\n\n' + msg.content + '\n\n---\n\n';
        }
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sai-session-' + Date.now() + '.md';
        a.click();
        URL.revokeObjectURL(url);
        toast('Chat exported as Markdown', 'success');
    });
}