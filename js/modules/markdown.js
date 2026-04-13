/* ═══════════════════════════════════════
   MARKDOWN — Parser for bot responses
   ═══════════════════════════════════════ */
export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseMarkdown(text) {
    const segments = [];
    const codeRegex = /```([^\n]*)\n([\s\S]*?)```/g;
    let remaining = text;
    let match;

    while ((match = codeRegex.exec(remaining)) !== null) {
        if (match.index > 0) {
            segments.push({ type: 'text', content: remaining.substring(0, match.index) });
        }
        segments.push({ type: 'code', lang: match[1].trim(), code: match[2].trimEnd() });
        remaining = remaining.substring(match.index + match[0].length);
        codeRegex.lastIndex = 0;
    }
    if (remaining) segments.push({ type: 'text', content: remaining });

    return segments.map(function(seg) {
        if (seg.type === 'code') {
            return renderCodeBlock(seg.lang, seg.code);
        }
        return processText(seg.content);
    }).join('');
}

var LAZY_SNIPPETS = ['// ...', '/* ...', '# ...', '// rest', '// unchanged', '// existing', '... rest of', '// remaining', '...'];

function renderCodeBlock(lang, code) {
    var escaped = escapeHtml(code);
    var isFile = lang.toLowerCase().startsWith('file:');
    var filePath = '';
    var syntaxLang = 'text';

    var snippetWarning = '';
    if (isFile) {
        var isLazy = LAZY_SNIPPETS.some(function(marker) { return code.indexOf(marker) !== -1; });
        if (isLazy) {
            snippetWarning = '<div style="background:#3b1a1a;color:#ff6b6b;padding:8px 12px;border-bottom:1px solid #ff6b6b;font-size:0.8rem;display:flex;align-items:center;gap:8px;"><i class="fas fa-exclamation-triangle"></i> <strong>Warning:</strong> AI omitted code (contains &quot;...&quot;). Clicking Apply will DELETE missing lines!</div>';
        }
    }

    if (isFile) {
        filePath = lang.substring(5).trim().replace(/^\.\//, '');
        var dotIndex = filePath.lastIndexOf('.');
        if (dotIndex > -1) {
            syntaxLang = filePath.substring(dotIndex + 1).toLowerCase();
        }
        var langMap = {
            'js': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript',
            'ts': 'typescript', 'tsx': 'typescript', 'jsx': 'javascript',
            'py': 'python', 'rb': 'ruby', 'rs': 'rust',
            'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
            'yml': 'yaml', 'yaml': 'yaml',
            'md': 'markdown', 'css': 'css', 'html': 'markup', 'htm': 'markup',
            'sql': 'sql', 'json': 'json', 'xml': 'markup',
            'java': 'java', 'kt': 'kotlin', 'dart': 'dart',
            'go': 'go', 'c': 'c', 'h': 'c', 'cpp': 'cpp',
            'cs': 'csharp', 'php': 'php', 'swift': 'swift'
        };
        syntaxLang = langMap[syntaxLang] || syntaxLang;

        return '<div class="code-block file-block" data-file-path="' + escapeHtml(filePath) + '">' +
            '<div class="code-header">' +
            '<span><i class="fas fa-file-pen" style="margin-right:6px"></i>' + escapeHtml(filePath) + '</span>' +
            '<div class="code-actions">' +
            '<button class="apply-btn" onclick="applyFileChange(this)" title="Write this file to disk">' +
            '<i class="fas fa-check"></i> Apply</button>' +
            '<button class="copy-btn" onclick="copyCode(this)" title="Copy code">' +
            '<i class="fas fa-copy"></i> Copy</button>' +
            '</div></div>' +
            snippetWarning +
            '<pre><code class="language-' + syntaxLang + '">' + escaped + '</code></pre>' +
            '</div>';
    }

    return '<div class="code-block">' +
        '<div class="code-header">' +
        '<span>' + escapeHtml(lang || 'code') + '</span>' +
        '<div class="code-actions">' +
        '<button class="use-btn" onclick="useAsInput(this)" title="Use as input">' +
        '<i class="fas fa-arrow-turn-up"></i> Use</button>' +
        '<button class="copy-btn" onclick="copyCode(this)" title="Copy code">' +
        '<i class="fas fa-copy"></i> Copy</button>' +
        '</div></div>' +
        '<pre><code class="language-' + escapeHtml(lang || 'text') + '">' + escaped + '</code></pre>' +
        '</div>';
}

function processText(text) {
    text = text.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    text = text.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    text = text.replace(/^---+$/gm, '<hr>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/^(\s*)[-*] (.+)$/gm, '$1<li>$2</li>');
    text = text.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>');
    text = text.replace(/^(\s*)\d+\. (.+)$/gm, '$1<li>$2</li>');

    var lines = text.split('\n');
    var result = [];
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var isTag = /^<(h[1-6]|ul|ol|li|blockquote|hr|pre|div|p)/.test(line.trim());
        var isEmpty = line.trim() === '';
        if (isTag || isEmpty) {
            inList = line.trim().startsWith('<li') || line.trim().startsWith('<ul') || line.trim().startsWith('<ol');
            result.push(line);
        } else if (inList) {
            result.push(line);
        } else {
            result.push('<p>' + line + '</p>');
        }
    }
    return result.join('\n');
}