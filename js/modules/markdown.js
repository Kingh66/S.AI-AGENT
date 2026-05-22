/* ═══════════════════════════════════════
   MARKDOWN — Advanced parser for bot responses
   Handles: code blocks, file blocks, plans,
   progress markers, tables, and more
   
   FIX: Replaced regex-based code block extraction
   with a line-by-line state machine that correctly
   handles fenced code blocks containing ``` inside
   the content (e.g. README.md with code examples).
   ═══════════════════════════════════════ */

export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Lazy snippet detection ── */
var LAZY_SNIPPETS = ['// ...', '/* ...', '# ...', '// rest', '// unchanged', '// existing', '... rest of', '// remaining', '... more'];

/* ═══════════════════════════════════════════════════════════════
   PHASE 1: Extract code blocks first
   (they must not be processed by inline rules)
   
   FIX: Line-by-line state machine instead of regex.
   
   The old regex /```([^\n]*)\n([\s\S]*?)```/g used a
   LAZY quantifier (*?) which closed the code block at
   the FIRST ``` found inside the content. If a file
   (like README.md) contained ``` in its body, the
   block would break open and the rest would render as
   markdown text.
   
   The new parser:
   1. Scans line-by-line
   2. When it finds N backticks opening a fence, it
      only closes when it finds >= N backticks at the
      start of a line followed by only whitespace
   3. This means ``` inside a ```` block is treated
      as literal content, not a fence closer
   ═══════════════════════════════════════════════════════════════ */
export function parseMarkdown(text) {
    if (!text) return '';

    var segments = [];
    var lines = text.split('\n');
    var i = 0;

    while (i < lines.length) {
        var line = lines[i];

        /* Check for opening fence: 3+ backticks at the start of a line */
        var openMatch = line.match(/^(`{3,})([^`]*)$/);

        if (openMatch) {
            var fenceLen = openMatch[1].length;
            var lang = openMatch[2].trim();
            var codeLines = [];
            i++; /* Move past the opening fence line */

            /* Read until closing fence:
               - Must be at the start of a line
               - Must have >= fenceLen backticks
               - Must have only whitespace after the backticks
               This means ``` inside a ```` block is content, not a closer. */
            var foundClose = false;
            while (i < lines.length) {
                var closeMatch = lines[i].match(/^(`{3,})\s*$/);
                if (closeMatch && closeMatch[1].length >= fenceLen) {
                    i++; /* Move past the closing fence line */
                    foundClose = true;
                    break;
                }
                codeLines.push(lines[i]);
                i++;
            }

            /* Even if no closing fence found (truncated response),
               still create the code block with whatever we have */
            var code = codeLines.join('\n').trimEnd();
            segments.push({ type: 'code', lang: lang, code: code });
        } else {
            /* Accumulate text lines until we hit a code block opening */
            var textLines = [];
            while (i < lines.length) {
                /* Stop if this line opens a code fence */
                if (lines[i].match(/^`{3,}[^`]*$/)) break;
                textLines.push(lines[i]);
                i++;
            }
            var textContent = textLines.join('\n');
            if (textContent) {
                segments.push({ type: 'text', content: textContent });
            }
        }
    }

    return segments.map(function(seg) {
        if (seg.type === 'code') return renderCodeBlock(seg.lang, seg.code);
        return processText(seg.content);
    }).join('');
}

/* ═══════════════════════════════════════
   CODE BLOCK RENDERING
   ═══════════════════════════════════════ */
function renderCodeBlock(lang, code) {
    var escaped = escapeHtml(code);
    var isFile = lang.toLowerCase().startsWith('file:');
    var filePath = '';
    var syntaxLang = 'text';
    var snippetWarning = '';

    if (isFile) {
        filePath = lang.substring(5).trim().replace(/^\.\//, '');
        var dotIndex = filePath.lastIndexOf('.');
        if (dotIndex > -1) syntaxLang = filePath.substring(dotIndex + 1).toLowerCase();

        var langMap = {
            'js':'javascript','mjs':'javascript','cjs':'javascript',
            'ts':'typescript','tsx':'typescript','jsx':'javascript',
            'py':'python','rb':'ruby','rs':'rust',
            'sh':'bash','bash':'bash','zsh':'bash',
            'yml':'yaml','yaml':'yaml',
            'md':'markdown','css':'css','html':'markup','htm':'markup',
            'sql':'sql','json':'json','xml':'markup',
            'java':'java','kt':'kotlin','dart':'dart',
            'go':'go','c':'c','h':'c','cpp':'cpp',
            'cs':'csharp','php':'php','swift':'swift'
        };
        syntaxLang = langMap[syntaxLang] || syntaxLang;

        var isLazy = LAZY_SNIPPETS.some(function(marker) { return code.indexOf(marker) !== -1; });
        if (isLazy) {
            snippetWarning = '<div class="snippet-warning"><i class="fas fa-exclamation-triangle"></i> <strong>Warning:</strong> AI omitted code (contains &quot;...&quot;). Clicking Apply will DELETE missing lines!</div>';
        }

        return '<div class="code-block file-block" data-file-path="' + escapeHtml(filePath) + '">' +
            '<div class="code-header">' +
            '<span class="code-lang"><i class="fas fa-file-pen" style="margin-right:6px"></i>' + escapeHtml(filePath) + '</span>' +
            '<div class="code-actions">' +
            '<button class="apply-btn" onclick="applyFileChange(this)" title="Write this file to disk"><i class="fas fa-check"></i> Apply</button>' +
            '<button class="edit-btn" onclick="editFileCode(this)" title="Edit code before applying"><i class="fas fa-pen"></i> Edit</button>' +
            '</div></div>' +
            snippetWarning +
            '<pre><code class="language-' + syntaxLang + '">' + escaped + '</code></pre>' +
            '</div>';
    }

    /* Regular code block */
    var langAlias = {
        'html':'markup','htm':'markup',
        'js':'javascript','mjs':'javascript','cjs':'javascript',
        'ts':'typescript','tsx':'typescript','jsx':'javascript',
        'py':'python','rb':'ruby','rs':'rust',
        'sh':'bash','zsh':'bash','shell':'bash',
        'yml':'yaml','md':'markdown','sql':'sql',
        'java':'java','kt':'kotlin','dart':'dart',
        'go':'go','c':'c','h':'c','cpp':'cpp',
        'cs':'csharp','php':'php','json':'json',
        'xml':'markup'
    };
    var prismLang = langAlias[(lang || 'text').toLowerCase()] || (lang || 'text');

    return '<div class="code-block">' +
        '<div class="code-header">' +
        '<span class="code-lang">' + escapeHtml(lang || 'code') + '</span>' +
        '<div class="code-actions">' +
        '<button class="use-btn" onclick="useAsInput(this)" title="Use as input"><i class="fas fa-arrow-turn-up"></i> Use</button>' +
        '<button class="copy-btn" onclick="copyCode(this)" title="Copy code"><i class="fas fa-copy"></i> Copy</button>' +
        '</div></div>' +
        '<pre><code class="language-' + escapeHtml(prismLang) + '">' + escaped + '</code></pre>' +
        '</div>';
}

/* ═══════════════════════════════════════
   TEXT PROCESSING — Inline markdown + structured elements
   ═══════════════════════════════════════ */
function processText(text) {
    /* ── Step 1: Extract and protect special structured blocks ── */
    var protectedBlocks = [];
    var idx = 0;

    /* Protect plan sections: 📋 PLAN: ... until next header or double newline+non-checklist */
    text = text.replace(/(📋\s*PLAN[:\s]*\n)((?:☐\s*.*\n?)+)/gi, function(m, header, items) {
        var placeholder = '\x00PLAN' + idx + '\x00';
        protectedBlocks.push({ placeholder: placeholder, html: renderPlanCard(header, items) });
        idx++;
        return placeholder;
    });

    /* Protect status lines: 📁 WORKING ON, ✅ DONE, ☐ NEXT, 📊 SUMMARY, 📦 FILES */
    text = text.replace(/^(📁|✅|⚠️|📊|📦)\s*(.+)$/gm, function(m, emoji, content) {
        var placeholder = '\x00STATUS' + idx + '\x00';
        protectedBlocks.push({ placeholder: placeholder, html: renderStatusLine(emoji, content) });
        idx++;
        return placeholder;
    });

    /* Protect checkbox lines: ☐ and ✓ */
    text = text.replace(/^(☐|☑|✓|✅)\s*(.+)$/gm, function(m, check, label) {
        var placeholder = '\x00CHECK' + idx + '\x00';
        var isChecked = check !== '☐';
        protectedBlocks.push({ placeholder: placeholder, html: renderCheckItem(label, isChecked) });
        idx++;
        return placeholder;
    });

    /* ── Step 2: Inline formatting ── */
    /* Inline code (must be before bold/italic to avoid conflicts) */
    text = text.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

    /* Headers */
    text = text.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    /* Bold + Italic */
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

    /* Blockquote */
    text = text.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    /* Horizontal rule */
    text = text.replace(/^---+$/gm, '<hr>');

    /* Links */
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    /* ── Step 3: Tables ── */
    text = renderTables(text);

    /* ── Step 4: Lists ── */
    text = text.replace(/^(\s*)[-*]\s+(.+)$/gm, '$1<li>$2</li>');
    text = text.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>');
    text = text.replace(/^(\s*)\d+\.\s+(.+)$/gm, '$1<li>$2</li>');

    /* ── Step 5: Paragraphs ── */
    var lines = text.split('\n');
    var result = [];
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var isTag = /^<(h[1-6]|ul|ol|li|blockquote|hr|pre|div|p|table|thead|tbody|tr|th|td)/.test(line.trim());
        var isEmpty = line.trim() === '';
        var isPlaceholder = line.indexOf('\x00') > -1;
        if (isTag || isEmpty || isPlaceholder) {
            inList = line.trim().startsWith('<li') || line.trim().startsWith('<ul') || line.trim().startsWith('<ol');
            result.push(line);
        } else if (inList) {
            result.push(line);
        } else {
            result.push('<p>' + line + '</p>');
        }
    }
    text = result.join('\n');

    /* ── Step 6: Restore protected blocks ── */
    for (var p = 0; p < protectedBlocks.length; p++) {
        text = text.replace(protectedBlocks[p].placeholder, protectedBlocks[p].html);
    }

    /* ── Step 7: Clean up excessive newlines ── */
    text = text.replace(/<p>\s*<\/p>/g, '');
    text = text.replace(/\n{3,}/g, '\n\n');

    return text;
}

/* ═══════════════════════════════════════
   STRUCTURED ELEMENT RENDERERS
   ═══════════════════════════════════════ */

function renderPlanCard(header, items) {
    var itemLines = items.trim().split('\n');
    var checkItems = '';
    for (var i = 0; i < itemLines.length; i++) {
        var line = itemLines[i].trim();
        if (!line) continue;
        line = line.replace(/^☐\s*/, '');
        checkItems += renderCheckItem(line, false);
    }
    return '<div class="plan-card">' +
        '<div class="plan-card-title"><span class="plan-emoji">📋</span> Execution Plan</div>' +
        checkItems +
        '</div>';
}

function renderCheckItem(label, isChecked) {
    var cls = isChecked ? 'check-item checked' : 'check-item';
    var checkIcon = isChecked ? '✓' : '';
    return '<div class="' + cls + '">' +
        '<span class="check-box">' + checkIcon + '</span>' +
        '<span class="check-text">' + label + '</span>' +
        '</div>';
}

function renderStatusLine(emoji, content) {
    var statusClass = 'status-working';
    var extra = '';

    if (emoji === '✅') {
        statusClass = 'status-done';
    } else if (emoji === '⚠️') {
        statusClass = 'status-error';
    } else if (emoji === '📊' || emoji === '📦') {
        statusClass = 'status-done';
    } else if (content.indexOf('NEXT') > -1) {
        statusClass = 'status-next';
    } else if (content.indexOf('WORKING ON') > -1 || content.indexOf('In Progress') > -1) {
        extra = '<span class="status-spinner"></span>';
    }

    return '<div class="status-line ' + statusClass + '">' +
        '<span class="status-emoji">' + emoji + '</span>' +
        '<span>' + content.trim() + '</span>' +
        extra +
        '</div>';
}

/* ═══════════════════════════════════════
   TABLE RENDERING
   ═══════════════════════════════════════ */
function renderTables(text) {
    var tableRegex = /((?:^\|.+\|$)\n)+/gm;
    return text.replace(tableRegex, function(tableBlock) {
        var rows = tableBlock.trim().split('\n');
        if (rows.length < 2) return tableBlock;

        var headerCells = parseTableRow(rows[0]);
        var isSeparator = /^\|[\s\-:]+\|/.test(rows[1]);
        var dataStartIdx = isSeparator ? 2 : 1;

        var html = '<table><thead><tr>';
        for (var h = 0; h < headerCells.length; h++) {
            html += '<th>' + headerCells[h].trim() + '</th>';
        }
        html += '</tr></thead><tbody>';

        for (var r = dataStartIdx; r < rows.length; r++) {
            var cells = parseTableRow(rows[r]);
            if (cells.length === 0) continue;
            html += '<tr>';
            for (var c = 0; c < cells.length; c++) {
                html += '<td>' + cells[c].trim() + '</td>';
            }
            html += '</tr>';
        }

        html += '</tbody></table>';
        return html;
    });
}

function parseTableRow(row) {
    if (!row || row.indexOf('|') === -1) return [];
    return row.split('|').slice(1, -1);
}