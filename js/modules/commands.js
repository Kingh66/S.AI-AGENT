/* ═══════════════════════════════════════
   COMMANDS — Slash commands, clear, export
   ═══════════════════════════════════════ */
import { state } from './state.js';
import { MODE_INFO } from './config.js';
import { toast } from './ui.js';

export function handleSlashCommand(cmd) {
    var input = document.getElementById('msg-input');
    var ph = {
        '/doc': 'Paste code — S.ai will generate documentation...',
        '/review': 'Paste code — S.ai will review it...',
        '/improve': 'Paste code — S.ai will improve it...',
        '/debug': 'Paste buggy code or describe the issue...',
        '/explain': 'Paste code you want explained...',
        '/selfimprove': 'Connect your workspace folder, then type this to start...',
        '/multiagent': 'Describe the task for the multi-agent team...'
    };
    var mm = {
        '/doc': 'doc',
        '/review': 'review',
        '/improve': 'improve',
        '/debug': 'debug',
        '/explain': 'explain',
        '/selfimprove': 'selfimprove'
    };

    /* Multi-agent slash commands — route directly, don't switch modes */
    if (cmd === '/team' || cmd === '/multiagent' || cmd === '/agents') {
        input.value = '';
        input.placeholder = ph['/multiagent'];
        input.focus();
        import('./multiagent.js').then(function(m) { m.startMultiAgentMode(); });
        return;
    }

    if (mm[cmd]) {
        import('./modes.js').then(function(m) {
            m.setMode(mm[cmd]);
            input.value = '';
            input.placeholder = ph[cmd];
            input.focus();
            toast('Mode: ' + MODE_INFO[mm[cmd]].title, 'info');
        });
    } else if (cmd === '/clear') {
        clearChat();
    } else if (cmd === '/export') {
        exportChat();
    } else {
        toast('Unknown command: ' + cmd, 'error');
    }
}

export function clearChat() {
    state.conversationHistory = [];
    document.getElementById('messages').innerHTML =
        '<div class="welcome-state" id="welcome-state">' +
        '<div class="welcome-icon">S</div>' +
        '<h2>S.ai, Ready</h2>' +
        '<p>Chat cleared. Paste your code or describe what you need.</p>' +
        '<div class="quick-actions">' +
        '<button class="quick-action" data-cmd="/doc"><i class="fas fa-file-alt"></i> Write Documentation</button>' +
        '<button class="quick-action" data-cmd="/review"><i class="fas fa-search-plus"></i> Review Code</button>' +
        '<button class="quick-action" data-cmd="/improve"><i class="fas fa-wand-magic-sparkles"></i> Improve Code</button>' +
        '<button class="quick-action" data-cmd="/debug"><i class="fas fa-bug"></i> Debug Issue</button>' +
        '<button class="quick-action" data-cmd="/explain"><i class="fas fa-graduation-cap"></i> Explain Code</button>' +
        '<button class="quick-action" data-cmd="/selfimprove"><i class="fas fa-brain"></i> Self-Improve</button>' +
        '</div></div>';
    import('./ui.js').then(function(m) { m.bindQuickActions(); });
    toast('Chat cleared', 'info');
}

export function exportChat() {
    if (state.conversationHistory.length === 0) { toast('Nothing to export yet', 'error'); return; }
    import('./config.js').then(function(cfg) {
        var md = '# S.ai Session Export\n\n';
        md += '**Date:** ' + new Date().toLocaleString() + '\n';
        md += '**Mode:** ' + cfg.MODE_INFO[state.currentMode].title + '\n';
        md += '**Model:** ' + state.settings.model + '\n\n---\n\n';
        for (var i = 0; i < state.conversationHistory.length; i++) {
            var msg = state.conversationHistory[i];
            md += msg.role === 'user'
                ? '## You\n\n' + msg.content + '\n\n'
                : '## S.ai\n\n' + msg.content + '\n\n---\n\n';
        }
        var blob = new Blob([md], { type: 'text/markdown' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'sai-session-' + Date.now() + '.md';
        a.click();
        URL.revokeObjectURL(url);
        toast('Chat exported as Markdown', 'success');
    });
}