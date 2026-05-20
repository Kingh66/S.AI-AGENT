/* ═══════════════════════════════════════
   MULTI-AGENT ORCHESTRATION
   Planner → Coder → Critic → Tester flow
   Self-contained payload + chat rendering
   + smart file context (truncated per agent)
   + auto-retry on 402 with token reduction
   ═══════════════════════════════════════ */
import { state } from './state.js';
import { toast, setConnectionStatus, autoResize, getTimeStr, highlightCodeBlocks } from './ui.js';
import { removeWelcome, addUserMessage } from './messages.js';
import { parseMarkdown } from './markdown.js';
import { getFileContext, isConnected } from './filesystem.js';

/* ── Agent definitions ── */
export var AGENTS = {
    planner: {
        name: 'Planner',
        description: 'Task decomposition and architecture design',
        defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
        fallbackModels: ['xiaomi/mimo-v2-pro', 'minimax/minimax-m2.7'],
        maxTokens: 8192,
        prompt: 'You are S.ai\'s Planner agent. Your ONLY responsibility is to understand the task and create a detailed, step-by-step implementation plan.\n\nCRITICAL RULES:\n1. If a workspace file tree is provided, use it to understand the project structure\n2. Reference specific file paths in your plan\n3. Break complex tasks into 3-7 actionable steps\n4. Each step must be specific, testable, and independent\n5. Consider file structure, dependencies, and integration points\n6. Output format: EXACTLY this structure:\n\n## PLAN\n**Objective:** [Clear one-sentence goal]\n\n**Steps:**\n1. [Step 1 description - specific action, referencing actual files]\n2. [Step 2 description]\n3. ...\n\n**Files to create/modify:**\n- path/to/file.ext (purpose)\n- path/to/file.ext (purpose)\n\n**Dependencies:**\n- [List any external requirements]\n\n**Risks:**\n- [Potential issues and mitigation]\n\nNEVER write code. NEVER review code. ONLY plan.',

        parsePlan: function(text) {
            var planMatch = text.match(/##\s*PLAN([\s\S]*?)(?=##\s*(?!PLAN)|$)/i);
            if (!planMatch) planMatch = text.match(/#\s*PLAN([\s\S]*?)(?=#[^#]|$)/i);
            if (!planMatch) {
                if (text && text.length > 50) {
                    planMatch = [null, '\n' + text];
                } else {
                    return null;
                }
            }

            var planText = planMatch[1];
            var objectiveMatch = planText.match(/(?:Objective|Goal|Summary|Purpose|Task)\s*[:\-]\s*(.+)/i);
            var stepsMatch = planText.match(/(?:Steps|Tasks|Actions|Implementation)\s*[:\-]?\s*([\s\S]*?)(?=Files|Dependencies|Risks|Notes|##|$)/i);
            var filesMatch = planText.match(/Files?\s*(?:to\s*)?(?:create|modify|touch|generate|output)?\s*[:\-]?\s*([\s\S]*?)(?=Dependencies|Risks|Notes|##|$)/i);
            var depsMatch = planText.match(/Dependencies?\s*[:\-]\s*([\s\S]*?)(?=Risks|Notes|##|$)/i);
            var risksMatch = planText.match(/Risks?\s*[:\-]\s*([\s\S]*?)$/i);

            var steps = [];
            if (stepsMatch) {
                steps = stepsMatch[1].split('\n')
                    .filter(function(l) { return l.trim().match(/^\d+[\.\)]\s*/); })
                    .map(function(l) { return l.replace(/^\d+[\.\)]\s*/, '').trim(); })
                    .filter(function(l) { return l.length > 0; });
            }
            if (steps.length === 0 && stepsMatch) {
                steps = stepsMatch[1].split('\n')
                    .filter(function(l) { return l.trim().match(/^[-*]\s*/); })
                    .map(function(l) { return l.replace(/^[-*\s]+/, '').trim(); })
                    .filter(function(l) { return l.length > 0; });
            }
            if (steps.length === 0) {
                steps = planText.split('\n')
                    .filter(function(l) { return l.trim().match(/^\d+[\.\)]\s+\S/); })
                    .map(function(l) { return l.replace(/^\d+[\.\)]\s*/, '').trim(); })
                    .filter(function(l) { return l.length > 10; });
            }
            if (steps.length === 0) {
                steps = planText.split('\n')
                    .filter(function(l) { return l.trim().match(/^[-*]\s+\S/); })
                    .map(function(l) { return l.replace(/^[-*\s]+/, '').trim(); })
                    .filter(function(l) { return l.length > 10; });
            }

            var files = [];
            if (filesMatch) {
                files = filesMatch[1].split('\n')
                    .map(function(l) {
                        var cleaned = l.replace(/^[-*\d\.\)]+\s*/, '').trim();
                        cleaned = cleaned.replace(/\s*\(.*\)\s*$/, '').trim();
                        return cleaned;
                    })
                    .filter(function(l) { return l.length > 0 && l.indexOf(':') === -1 && l.length < 120; });
            }
            if (files.length === 0) {
                var filePattern = planText.match(/[\w\-./]+\.(js|ts|jsx|tsx|py|java|html|css|json|md|yaml|yml|sh|sql|go|rs|cpp|c|h|rb|php|dart|kt)/gi);
                if (filePattern) {
                    var seen = {};
                    for (var fi = 0; fi < filePattern.length; fi++) {
                        var fname = filePattern[fi].trim();
                        if (!seen[fname] && fname.indexOf('.') > 0) {
                            seen[fname] = true;
                            files.push(fname);
                        }
                    }
                }
            }

            return {
                objective: objectiveMatch ? objectiveMatch[1].trim() : (multiAgentState.currentTask ? multiAgentState.currentTask.userPrompt.substring(0, 120) : 'Task implementation'),
                steps: steps,
                files: files,
                dependencies: depsMatch ? depsMatch[1].trim() : 'None specified',
                risks: risksMatch ? risksMatch[1].trim() : 'None identified'
            };
        }
    },

    coder: {
        name: 'Coder',
        description: 'Implementation based on plan',
        defaultModel: 'xiaomi/mimo-v2-pro',
        fallbackModels: ['stepfun/step-3.5-flash', 'minimax/minimax-m2.7', 'z-ai/glm-5-turbo'],
        maxTokens: 4096,
        currentModel: null,
        prompt: 'You are S.ai\'s Coder agent. Your ONLY responsibility is to write complete, production-ready code based on the Planner\'s plan.\n\nCRITICAL RULES:\n1. Follow the plan EXACTLY - do not deviate\n2. If workspace files are provided, READ THEM to understand existing code\n3. When modifying existing files, output the COMPLETE file — never "...", "// rest unchanged"\n4. Every file must be self-contained and runnable\n5. Include all necessary imports, error handling, and edge cases\n6. For each file, output:\n\nfile:path/to/filename.ext\n// FULL FILE CONTENT - NO OMISSIONS\n[complete code]\n\n7. NEVER hallucinate imports\n8. After writing ALL files, add: <|INTEGRATION_CHECK|>',

        validateOutput: function(text) {
            var lazyPatterns = [/\.\.\.[\s\S]*?\.\.\./, /\/\/\s*\.\.\.[\s\S]*?\/\/\s*\.\.\./, /\/\*\s*\.\.\.[\s\S]*?\*\//, /#\s*\.\.\.[\s\S]*?#\s*\.\.\./];
            for (var i = 0; i < lazyPatterns.length; i++) {
                if (lazyPatterns[i].test(text)) {
                    return { valid: false, error: 'Lazy code snippet detected (contains "...")' };
                }
            }
            if (text.indexOf('<|INTEGRATION_CHECK|>') === -1) {
                return { valid: false, error: 'Missing integration check marker' };
            }
            var fileBlocks = text.match(/file:([^\n]+)\n([\s\S]*?)(?=\nfile:|<\|INTEGRATION_CHECK\|>|$)/g) || [];
            if (fileBlocks.length === 0) {
                return { valid: false, error: 'No file blocks found' };
            }
            return { valid: true, fileCount: fileBlocks.length };
        }
    },

    critic: {
        name: 'Critic',
        description: 'Code review and quality gate',
        defaultModel: 'minimax/minimax-m2.7',
        fallbackModels: ['stepfun/step-3.5-flash', 'xiaomi/mimo-v2-pro'],
        maxTokens: 2048,
        prompt: 'You are S.ai\'s Critic agent - the FINAL quality gate.\n\nOutput format: EXACTLY one of these:\n\nAPPROVED\n[Brief validation]\n\nREJECTED\n[Detailed reasons, numbered]\n\nIf in doubt, REJECT.',

        parseDecision: function(text) {
            var isApproved = text.trim().toUpperCase().indexOf('APPROVED') === 0;
            var reasons = text.replace(/^(APPROVED|REJECTED)\s*/i, '').trim();
            return {
                approved: isApproved,
                feedback: reasons || (isApproved ? 'Code approved' : 'Code rejected')
            };
        }
    },

    tester: {
        name: 'Tester',
        description: 'Validation and testing',
        defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
        fallbackModels: ['xiaomi/mimo-v2-pro', 'minimax/minimax-m2.7'],
        maxTokens: 4096,
        prompt: 'You are S.ai\'s Tester agent.\n\nOutput format:\n\n## VALIDATION RESULT\nPASS | FAIL | NEEDS_REVIEW\n\n[Reasoning]',

        parseResult: function(text) {
            var resultMatch = text.match(/## VALIDATION RESULT\s+(PASS|FAIL|NEEDS_REVIEW)/i);
            return {
                status: resultMatch ? resultMatch[1].toUpperCase() : 'UNKNOWN',
                details: text.replace(/## VALIDATION RESULT[\s\S]*/, '').trim()
            };
        }
    }
};

/* ── Multi-agent state ── */
export var multiAgentState = {
    isActive: false,
    currentAgent: null,
    currentTask: null,
    plan: null,
    coderAttempts: 0,
    maxCoderAttempts: 3,
    criticRejections: 0,
    maxCriticRejections: 2,
    conversationHistory: [],
    taskQueue: [],
    activeLoop: null
};

/* ═══════════════════════════════════════
   SELF-CONTAINED API HELPERS
   ═══════════════════════════════════════ */
function getApiUrl() {
    var endpoint = (state.settings.endpoint || '').replace(/\/+$/, '');
    var provider = state.settings.provider;
    if (provider === 'ollama') return endpoint + '/api/chat';
    if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
    if (provider === 'google-ai') return endpoint + '/chat/completions';
    return endpoint.replace(/\/v1$/, '') + '/v1/chat/completions';
}

function isOllamaProvider() {
    return state.settings.provider === 'ollama';
}

function buildAgentPayload(messages, model, maxTokens) {
    if (isOllamaProvider()) {
        return { model: model, messages: messages, stream: true, options: { temperature: 0.7, num_predict: maxTokens } };
    }
    return { model: model, messages: messages, stream: true, temperature: 0.7, max_tokens: maxTokens };
}

function buildAgentHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (state.settings.provider === 'google-ai') {
        if (state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey;
    } else if (!isOllamaProvider() && state.settings.apiKey) {
        h['Authorization'] = 'Bearer ' + state.settings.apiKey;
    }
    if (state.settings.provider === 'openrouter') {
        h['HTTP-Referer'] = window.location.href;
        h['X-Title'] = 'S.ai Coding Agent';
    }
    return h;
}

/* ═══════════════════════════════════════
   SMART FILE CONTEXT — Per-agent truncation
   Regular chat sends ALL files (223KB).
   Multi-agent CANNOT afford that — 4 sequential
   calls would blow any credit budget.
   
   Planner: file tree only (~1KB)
   Coder:   file tree + most relevant files (~15KB cap)
   Critic:  only the code the coder produced (via taskContext, not raw files)
   Tester:  only the code the coder produced (via taskContext, not raw files)
   ═══════════════════════════════════════ */
function getSmartFileContext(agentName) {
    var fullCtx = getFileContext();
    if (!fullCtx) return '';

    /* ── Planner: just the file tree, no file contents ──
       The tree ends at the first "--- FILE:" line */
    if (agentName === 'planner') {
        var lines = fullCtx.split('\n');
        var treeLines = [];
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('--- FILE:') > -1) break;
            treeLines.push(lines[i]);
        }
        var tree = treeLines.join('\n').trim();
        if (tree.length < 50) return '';
        return tree + '\n\nNote: Full file contents will be provided to the Coder agent. Plan based on the file tree and task description.';
    }

    /* ── Coder: file tree + truncated file contents ──
       Cap at 15KB to keep input tokens manageable */
    if (agentName === 'coder') {
        var MAX_CODER_CTX = 15000;
        if (fullCtx.length <= MAX_CODER_CTX) return fullCtx;
        /* Find a good truncation point — don't cut mid-file */
        var truncated = fullCtx.substring(0, MAX_CODER_CTX);
        var lastFileEnd = truncated.lastIndexOf('--- END FILE ---');
        if (lastFileEnd > 5000) {
            truncated = truncated.substring(0, lastFileEnd + '--- END FILE ---'.length);
        }
        return truncated + '\n\n[... ' + (fullCtx.length - truncated.length) + ' more characters truncated to fit token budget. Ask the user to paste specific files if you need them.]';
    }

    /* ── Critic and Tester: NO raw file context ──
       They receive the coder's output via taskContext,
       which is much smaller and only contains the files
       that were actually created/modified. */
    return '';
}

/* ═══════════════════════════════════════
   CHAT RENDERING
   ═══════════════════════════════════════ */
var AGENT_ICONS = {
    planner: 'fa-map',
    coder: 'fa-code',
    critic: 'fa-gavel',
    tester: 'fa-flask-vial',
    system: 'fa-flag-checkered'
};

var AGENT_NAMES = {
    planner: 'Planner',
    coder: 'Coder',
    critic: 'Critic',
    tester: 'Tester',
    system: 'Result'
};

var STATUS_HTML = {
    success: '<span style="color:#00d4aa;font-size:0.75rem;font-weight:700"><i class="fas fa-check-circle"></i> Done</span>',
    warning: '<span style="color:#f0c040;font-size:0.75rem;font-weight:700"><i class="fas fa-triangle-exclamation"></i> Rejected</span>',
    error:   '<span style="color:#ff4757;font-size:0.75rem;font-weight:700"><i class="fas fa-circle-xmark"></i> Failed</span>'
};

function scrollMessages() {
    var msgs = document.getElementById('messages');
    msgs.scrollTop = msgs.scrollHeight;
}

function showAgentWorking(agentName) {
    removeWelcome();
    var msgs = document.getElementById('messages');
    var div = document.createElement('div');
    div.className = 'message bot';
    var uid = 'aw-' + agentName + '-' + Date.now();
    div.id = uid;
    div.innerHTML =
        '<div class="msg-avatar" style="background:rgba(0,212,170,0.12)"><i class="fas ' + (AGENT_ICONS[agentName] || 'fa-robot') + '"></i></div>' +
        '<div class="msg-body"><div class="msg-meta">' +
        '<span class="msg-name" style="color:var(--accent)">' + (AGENT_NAMES[agentName] || agentName) + ' Agent</span>' +
        '<span style="color:var(--yellow);font-size:0.75rem;font-weight:600"><i class="fas fa-spinner fa-spin"></i> Working...</span>' +
        '<span class="msg-time">' + getTimeStr() + '</span>' +
        '</div><div class="msg-content"><div class="typing-indicator"><span></span><span></span><span></span></div></div></div>';
    msgs.appendChild(div);
    scrollMessages();
    return uid;
}

function removeWorking(uid) {
    if (!uid) return;
    var el = document.getElementById(uid);
    if (el) el.remove();
}

function renderAgentMessage(agentName, content, status) {
    removeWelcome();
    var msgs = document.getElementById('messages');
    var div = document.createElement('div');
    div.className = 'message bot';
    div.innerHTML =
        '<div class="msg-avatar" style="background:rgba(0,212,170,0.12)"><i class="fas ' + (AGENT_ICONS[agentName] || 'fa-robot') + '"></i></div>' +
        '<div class="msg-body"><div class="msg-meta">' +
        '<span class="msg-name" style="color:var(--accent)">' + (AGENT_NAMES[agentName] || agentName) + ' Agent</span>' +
        (STATUS_HTML[status] || '') +
        '<span class="msg-time">' + getTimeStr() + '</span>' +
        '</div><div class="msg-content">' + parseMarkdown(content) + '</div></div>';
    msgs.appendChild(div);
    highlightCodeBlocks(div);
    scrollMessages();
}

/* ── Orchestrator ── */
export function MultiAgentOrchestrator() {
    this.agentOrder = ['planner', 'coder', 'critic', 'tester'];
    this.currentAgentIndex = 0;
    this.taskContext = null;
    this.abortController = null;
}

MultiAgentOrchestrator.prototype.startMultiAgentTask = async function(userPrompt) {
    if (multiAgentState.isActive) {
        toast('Multi-agent task already running', 'error');
        return false;
    }

    multiAgentState.isActive = true;
    multiAgentState.currentTask = {
        id: Date.now(),
        userPrompt: userPrompt,
        startTime: Date.now(),
        status: 'initializing',
        logs: [],
        agentsUsed: [],
        coderModelsUsed: []
    };

    this.abortController = new AbortController();
    this.currentAgentIndex = 0;
    this.taskContext = null;
    multiAgentState.criticRejections = 0;
    multiAgentState.coderAttempts = 0;

    setConnectionStatus('connecting', 'Multi-Agent: Starting...');

    try {
        while (multiAgentState.isActive && this.currentAgentIndex < this.agentOrder.length) {
            var agentName = this.agentOrder[this.currentAgentIndex];
            var prompt = (this.currentAgentIndex === 0) ? userPrompt : null;
            var result = await this.runAgent(agentName, prompt);

            if (!result) {
                throw new Error('Agent ' + agentName + ' returned no result (null)');
            }
            if (!result.success) {
                throw new Error('Agent ' + agentName + ' failed: ' + (result.error || 'no error details provided'));
            }

            this.currentAgentIndex++;
        }

        this.completeTask('success');
        return true;

    } catch (error) {
        console.error('Multi-agent task failed:', error);
        this.completeTask('failed', error.message);
        return false;
    }
};

MultiAgentOrchestrator.prototype.runAgent = async function(agentName, customPrompt) {
    var agent = AGENTS[agentName];
    if (!agent) return { success: false, error: 'Unknown agent: ' + agentName };

    multiAgentState.currentAgent = agentName;
    setConnectionStatus('connecting', 'Multi-Agent: Running ' + agent.name + '...');

    var model = this.selectModelForAgent(agent, agentName);
    var prompt = customPrompt || this.buildAgentPrompt(agentName);

    if (this.taskContext) {
        prompt = this.taskContext + '\n\n' + prompt;
    }

    var result = null;
    var lastError = 'No response received from ' + agentName;
    var attempts = 0;
    var maxAttempts = agentName === 'coder'
        ? (state.settings.maxCoderAttempts || multiAgentState.maxCoderAttempts)
        : 2;

    var workingId = showAgentWorking(agentName);

    try {
        while (attempts < maxAttempts && !(result && result.success)) {
            attempts++;
            lastError = 'Attempt ' + attempts + ' failed';

            try {
                result = await this.executeAgentCall(agentName, model, prompt);

                if (!result.success && !result.error) {
                    result.error = agentName + ' returned failure with no details';
                }
                lastError = result.error || lastError;

                if (agentName === 'coder' && !result.success && attempts < maxAttempts) {
                    model = this.getNextCoderFallback(agent, model);
                    if (model) {
                        toast('Coder failed, switching to fallback: ' + model, 'info');
                        continue;
                    }
                }

                if (agentName === 'critic' && result.decision === 'REJECTED') {
                    removeWorking(workingId);
                    workingId = null;
                    renderAgentMessage('critic', result.content, 'warning');

                    multiAgentState.criticRejections++;
                    var maxRejections = state.settings.maxCriticRejections || multiAgentState.maxCriticRejections;

                    if (multiAgentState.criticRejections >= maxRejections) {
                        toast('Critic rejected ' + maxRejections + ' times — task failed', 'error');
                        return { success: false, error: 'Critic rejected ' + maxRejections + ' times.' };
                    }

                    toast('Critic rejected — sending back to Coder', 'info');
                    this.currentAgentIndex = 1;
                    var coderPrompt = this.buildAgentPrompt('coder', null, result.feedback);
                    return await this.runAgent('coder', coderPrompt);
                }

            } catch (error) {
                lastError = error.message || error.name || String(error);
                console.warn('Agent ' + agentName + ' attempt ' + attempts + ' error:', lastError);

                if (error.name === 'AbortError') {
                    return { success: false, error: 'Task aborted by user' };
                }

                /* 402 is now handled INSIDE executeAgentCall with auto-retry.
                   If it still reaches here, it means all retries exhausted. */
                if (lastError.indexOf('HTTP 402') > -1 || lastError.indexOf('credits') > -1) {
                    return { success: false, error: lastError };
                }

                if (lastError.indexOf('is not a valid model ID') > -1 || lastError.indexOf('HTTP 404') > -1) {
                    toast('Model "' + model + '" invalid, trying fallback...', 'error');
                    if (agentName === 'coder') {
                        model = this.getNextCoderFallback(agent, model);
                        if (model && attempts < maxAttempts) continue;
                    } else {
                        var fallbacks = agent.fallbackModels || [];
                        if (fallbacks.length > 0) {
                            model = fallbacks[0];
                            if (attempts < maxAttempts) continue;
                        }
                    }
                }

                if (attempts < maxAttempts) {
                    toast(agentName + ' attempt ' + attempts + ' failed, retrying...', 'info');
                    await this.delay(1000 * attempts);
                } else {
                    result = { success: false, error: lastError };
                }
            }
        }

        if (!result) {
            result = { success: false, error: lastError };
        }

        if (result.success) {
            removeWorking(workingId);
            workingId = null;
            renderAgentMessage(agentName, result.content, 'success');
            this.taskContext = this.accumulateContext(agentName, result.content);
        }

    } finally {
        removeWorking(workingId);
    }

    return result;
};

MultiAgentOrchestrator.prototype.selectModelForAgent = function(agent, agentName) {
    if (state.settings.agentModels) {
        var configured = state.settings.agentModels[agentName];
        if (configured) return configured;
    }
    if (agentName === 'coder' && agent.currentModel) return agent.currentModel;
    return agent.defaultModel;
};

MultiAgentOrchestrator.prototype.getNextCoderFallback = function(agent, currentModel) {
    var configuredFallback = (state.settings.agentModels || {}).coderFallback;
    if (configuredFallback && configuredFallback !== currentModel) return configuredFallback;
    var fallbacks = agent.fallbackModels.filter(function(m) { return m !== currentModel; });
    return fallbacks.length > 0 ? fallbacks[0] : null;
};

/* ═══════════════════════════════════════
   SELF-CONTAINED EXECUTE
   - NO connection.js dependency
   - Smart per-agent file context
   - AUTO-RETRY on 402 with token reduction
     (1800 → 900 → 450 → 200)
   ═══════════════════════════════════════ */
MultiAgentOrchestrator.prototype.executeAgentCall = async function(agentName, model, prompt) {
    var self = this;
    var agent = AGENTS[agentName];
    var timeoutMs = 120000;

    /* Build system message with SMART file context */
    var systemContent = agent.prompt;

    var projectCtx = document.getElementById('project-context');
    if (projectCtx && projectCtx.value.trim()) {
        systemContent += '\n\n--- PROJECT CONTEXT ---\n' + projectCtx.value.trim() + '\n--- END CONTEXT ---';
    }

    var fileCtx = getSmartFileContext(agentName);
    if (fileCtx) {
        systemContent += '\n\n' + fileCtx;
    }

    var userMax = state.settings.maxTokens || 4096;
    var agentBudget = agent.maxTokens || 4096;
    var startTokens = Math.min(userMax, agentBudget);

    var fileCount = fileCtx ? (fileCtx.match(/--- FILE:/g) || []).length : 0;
    console.log('[MultiAgent] ' + agentName + ' model=' + model + ' startTokens=' + startTokens + ' fileCtx=' + fileCtx.length + ' chars ' + fileCount + ' files');

    /* ── 402 AUTO-RETRY LOOP ──
       If we get a 402, halve the tokens and try again.
       This adapts to whatever credit balance the user has. */
    var MAX_402_RETRIES = 4;
    var currentTokens = startTokens;

    for (var retry402 = 0; retry402 < MAX_402_RETRIES; retry402++) {
        try {
            var result = await this._doFetch(agentName, model, systemContent, prompt, currentTokens, timeoutMs);

            if (retry402 > 0) {
                toast(agentName + ' succeeded with ' + currentTokens + ' tokens (reduced from ' + startTokens + ')', 'success');
            }
            return result;

        } catch (error) {
            var errMsg = error.message || '';

            /* Only auto-retry on 402 */
            if (errMsg.indexOf('HTTP 402') > -1 && retry402 < MAX_402_RETRIES - 1) {
                currentTokens = Math.max(100, Math.floor(currentTokens / 2));
                toast('Credits low — reducing tokens to ' + currentTokens + ' and retrying...', 'info');
                await this.delay(500);
                continue;
            }

            /* All retries exhausted or different error — throw */
            throw error;
        }
    }

    /* Should not reach here, but safety net */
    throw new Error(agentName + ' failed after ' + MAX_402_RETRIES + ' attempts');
};

/* ── Actual fetch call (extracted for 402 retry loop) ── */
MultiAgentOrchestrator.prototype._doFetch = function(agentName, model, systemContent, prompt, maxTokens, timeoutMs) {
    var self = this;

    return new Promise(function(resolve, reject) {
        var timeoutId = setTimeout(function() {
            reject(new Error(agentName + ' timeout after ' + timeoutMs + 'ms'));
        }, timeoutMs);

        var agentMessages = [
            { role: 'system', content: systemContent }
        ];

        var recentCtx = multiAgentState.conversationHistory.slice(-6);
        for (var i = 0; i < recentCtx.length; i++) {
            agentMessages.push(recentCtx[i]);
        }
        agentMessages.push({ role: 'user', content: prompt });

        var payload = buildAgentPayload(agentMessages, model, maxTokens);
        var headers = buildAgentHeaders();
        var url = getApiUrl();
        var useOllama = isOllamaProvider();

        var controller = new AbortController();
        var fetchTimeout = setTimeout(function() { controller.abort(); }, 110000);

        fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        }).then(function(response) {
            clearTimeout(fetchTimeout);
            clearTimeout(timeoutId);

            if (!response.ok) {
                return response.text().then(function(errText) {
                    throw new Error('HTTP ' + response.status + ': ' + errText.substring(0, 200));
                });
            }

            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var fullContent = '';

            function readChunk() {
                return reader.read().then(function(result) {
                    if (result.done) {
                        multiAgentState.conversationHistory.push(
                            { role: 'user', content: prompt },
                            { role: 'assistant', content: fullContent }
                        );
                        if (multiAgentState.conversationHistory.length > 20) {
                            multiAgentState.conversationHistory = multiAgentState.conversationHistory.slice(-10);
                        }
                        resolve(self.parseAgentResult(agentName, fullContent));
                        return;
                    }

                    var chunk = decoder.decode(result.value, { stream: true });

                    if (useOllama) {
                        var lines = chunk.split('\n').filter(function(l) { return l.trim(); });
                        for (var i = 0; i < lines.length; i++) {
                            try {
                                var d = JSON.parse(lines[i]);
                                if (d.message && d.message.content) fullContent += d.message.content;
                            } catch (e) {}
                        }
                    } else {
                        var sseLines = chunk.split('\n');
                        for (var j = 0; j < sseLines.length; j++) {
                            if (!sseLines[j].startsWith('data: ')) continue;
                            var data = sseLines[j].slice(6).trim();
                            if (data === '[DONE]') continue;
                            try {
                                var parsed = JSON.parse(data);
                                var content = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
                                if (content) fullContent += content;
                            } catch (e) {}
                        }
                    }

                    readChunk();
                });
            }

            readChunk();

        }).catch(function(error) {
            clearTimeout(fetchTimeout);
            clearTimeout(timeoutId);
            reject(error);
        });
    });
};

MultiAgentOrchestrator.prototype.parseAgentResult = function(agentName, content) {
    switch (agentName) {
        case 'planner':
            var plan = AGENTS.planner.parsePlan(content);
            if (!plan) {
                return { success: false, content: content, agent: agentName, error: 'Planner could not extract a valid plan.' };
            }
            if (!plan.steps || plan.steps.length === 0) {
                return { success: false, content: content, plan: plan, agent: agentName, error: 'Plan has no actionable steps. Found ' + plan.files.length + ' files but no steps.' };
            }
            return { success: true, content: content, plan: plan, agent: agentName };

        case 'coder':
            var validation = AGENTS.coder.validateOutput(content);
            return {
                success: validation.valid,
                content: content,
                fileCount: validation.fileCount,
                agent: agentName,
                error: validation.error || 'Coder validation failed'
            };

        case 'critic':
            var decision = AGENTS.critic.parseDecision(content);
            return {
                success: true,
                content: content,
                decision: decision.approved ? 'APPROVED' : 'REJECTED',
                feedback: decision.feedback,
                agent: agentName
            };

        case 'tester':
            var testResult = AGENTS.tester.parseResult(content);
            return {
                success: testResult.status === 'PASS',
                content: content,
                testStatus: testResult.status,
                agent: agentName,
                error: testResult.status !== 'PASS' ? 'Tests ' + testResult.status : null
            };

        default:
            return { success: true, content: content, agent: agentName };
    }
};

MultiAgentOrchestrator.prototype.buildAgentPrompt = function(agentName, plan, criticFeedback) {
    switch (agentName) {
        case 'planner':
            return 'Create an implementation plan for this task:\n\n' + (multiAgentState.currentTask ? multiAgentState.currentTask.userPrompt : 'No task provided');

        case 'coder':
            var prompt = 'Implement the code according to this plan:\n\n';
            if (plan) {
                prompt += '## PLAN\nObjective: ' + plan.objective + '\n\nSteps:\n';
                for (var i = 0; i < plan.steps.length; i++) {
                    prompt += (i + 1) + '. ' + plan.steps[i] + '\n';
                }
                prompt += '\n';
                if (plan.files.length) {
                    prompt += 'Files to create/modify:\n' + plan.files.join('\n') + '\n\n';
                }
            }
            if (criticFeedback) {
                prompt += '## CRITIC FEEDBACK — FIX THESE ISSUES\n' + criticFeedback + '\n\n';
            }
            if (this.taskContext) {
                prompt += '## WORKSPACE CONTEXT\n' + this.taskContext + '\n\n';
            }
            prompt += 'REMEMBER: Output COMPLETE files with NO omissions. End with <|INTEGRATION_CHECK|>';
            return prompt;

        case 'critic':
            var critiquePrompt = 'Review this code:\n\n';
            if (this.taskContext) critiquePrompt += this.taskContext + '\n\n';
            critiquePrompt += 'APPROVE only if production-ready. REJECT with numbered issues if not.';
            return critiquePrompt;

        case 'tester':
            return 'Validate the implemented code:\n\n' + (this.taskContext || 'No code context available') + '\n\nReport PASS/FAIL.';

        default:
            return multiAgentState.currentTask ? multiAgentState.currentTask.userPrompt : 'No task';
    }
};

MultiAgentOrchestrator.prototype.accumulateContext = function(agentName, content) {
    if (agentName === 'coder') {
        var fileBlocks = content.match(/file:([^\n]+)\n([\s\S]*?)(?=\nfile:|<\|INTEGRATION_CHECK\|>|$)/g) || [];
        var filesContext = fileBlocks.map(function(block) {
            var lines = block.split('\n');
            var filePath = lines[0].replace('file:', '').trim();
            var code = lines.slice(1).join('\n');
            return 'file:' + filePath + '\n' + code;
        }).join('\n\n');
        return '## IMPLEMENTED CODE\n' + filesContext + '\n\n';
    }
    return '## ' + agentName.toUpperCase() + ' OUTPUT\n' + content + '\n\n';
};

MultiAgentOrchestrator.prototype.completeTask = function(status, error) {
    multiAgentState.isActive = false;
    if (multiAgentState.currentTask) {
        multiAgentState.currentTask.status = status;
        multiAgentState.currentTask.endTime = Date.now();
        multiAgentState.currentTask.error = error || null;

        var duration = multiAgentState.currentTask.endTime - multiAgentState.currentTask.startTime;

        if (status === 'success') {
            toast('Multi-agent task completed in ' + (duration / 1000).toFixed(1) + 's', 'success');
            renderAgentMessage('system', '**Task Complete**\n\nAll agents finished in ' + (duration / 1000).toFixed(1) + 's.', 'success');
        } else {
            toast('Multi-agent task failed: ' + (error || 'unknown'), 'error');
            renderAgentMessage('system', '**Task Failed**\n\n' + (error || 'Unknown error'), 'error');
        }
    }

    setConnectionStatus('connected', 'Connected — ' + state.settings.model);
    removeMultiAgentStatus();

    setTimeout(function() {
        multiAgentState.currentTask = null;
        multiAgentState.conversationHistory = [];
        multiAgentState.criticRejections = 0;
        multiAgentState.coderAttempts = 0;
    }, 1000);
};

MultiAgentOrchestrator.prototype.abort = function() {
    if (this.abortController) this.abortController.abort();
    this.completeTask('aborted', 'Task aborted by user');
};

MultiAgentOrchestrator.prototype.delay = function(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
};

/* ── Singleton ── */
export var multiAgentOrchestrator = new MultiAgentOrchestrator();

/* ── UI Integration ── */
export function startMultiAgentMode() {
    var input = document.getElementById('msg-input');
    var prompt = input.value.trim();

    if (!prompt) {
        toast('Enter a task description for the multi-agent team', 'error');
        input.focus();
        return;
    }

    /* Soft warning if no workspace — don't block */
    if (!isConnected()) {
        toast('No workspace folder connected. Agents will work without file context.', 'info');
    }

    /* NO hard block on max tokens anymore — the 402 auto-retry handles it */

    input.value = '';
    input.style.height = 'auto';
    autoResize(input);

    addUserMessage(prompt);

    showMultiAgentStatus();

    multiAgentOrchestrator.startMultiAgentTask(prompt);
}

function showMultiAgentStatus() {
    var header = document.getElementById('chat-header');
    var existing = document.getElementById('multiagent-status');
    if (existing) existing.remove();

    var actionsEl = header.querySelector('.header-actions');
    if (!actionsEl) return;

    var statusEl = document.createElement('div');
    statusEl.id = 'multiagent-status';
    statusEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(0,212,170,0.1);border:1px solid rgba(0,212,170,0.2);border-radius:6px;font-size:0.75rem;color:var(--accent);font-weight:600;';
    actionsEl.insertAdjacentElement('beforebegin', statusEl);

    var updateLoop = setInterval(function() {
        if (!multiAgentState.isActive) { clearInterval(updateLoop); return; }
        var agent = multiAgentState.currentAgent ? AGENTS[multiAgentState.currentAgent] : null;
        var name = agent ? agent.name : 'Initializing';
        statusEl.innerHTML = '<i class="fas fa-network-wired" style="animation:sai-spin 1s linear infinite"></i> <span>Multi-Agent: ' + name + '</span>';
    }, 500);
}

function removeMultiAgentStatus() {
    var el = document.getElementById('multiagent-status');
    if (el) el.remove();
}

if (!document.getElementById('sai-spin-style')) {
    var spinStyle = document.createElement('style');
    spinStyle.id = 'sai-spin-style';
    spinStyle.textContent = '@keyframes sai-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
    document.head.appendChild(spinStyle);
}