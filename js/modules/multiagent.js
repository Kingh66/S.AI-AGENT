/* ═══════════════════════════════════════
   MULTI-AGENT ORCHESTRATION
   Planner → Coder → Critic → Tester flow
   Self-contained payload + chat rendering
   + smart file context (truncated per agent)
   + auto-retry on 402 with token reduction
   + DYNAMIC MODEL DISCOVERY (no hardcoded models)
   + 429 rate-limit model switching
   + 404 model pruning from verified list
   ═══════════════════════════════════════ */
import { state } from './state.js';
import { toast, setConnectionStatus, autoResize, getTimeStr, highlightCodeBlocks } from './ui.js';
import { removeWelcome, addUserMessage } from './messages.js';
import { parseMarkdown } from './markdown.js';
import { getFileContext, isConnected } from './filesystem.js';

/* ═══════════════════════════════════════════════════
   DYNAMIC MODEL DISCOVERY
   ═══════════════════════════════════════════════════ */
var _verifiedFreeModels = null;
var _modelFetchPromise = null;

/* Hardcoded fallbacks — ONLY used if dynamic fetch fails completely */
var HARDCODED_FALLBACK_MODELS = [
    'qwen/qwen3-235b-a22b:free',
    'qwen/qwen3-coder:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'meta-llama/llama-4-scout:free',
    'google/gemma-3-27b-it:free',
    'stepfun/step-3.5-flash:free'
];

/* ═══════════════════════════════════════════════════
   RATE-LIMIT TRACKING
   
   When a model returns 429, we record the timestamp.
   Future model selections skip rate-limited models
   until their cooldown expires (default 90 seconds).
   This prevents the death spiral of retrying the same
   rate-limited model.
   ═══════════════════════════════════════════════════ */
var _rateLimitedModels = {}; /* { 'model/id:free': expiryTimestamp } */
var RATE_LIMIT_COOLDOWN_MS = 90000; /* 90 seconds */

function markRateLimited(modelId) {
    if (!modelId) return;
    _rateLimitedModels[modelId] = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    console.log('[MultiAgent] Rate-limited: ' + modelId + ' (cooldown ' + (RATE_LIMIT_COOLDOWN_MS / 1000) + 's)');
}

function isRateLimited(modelId) {
    if (!modelId) return false;
    var expiry = _rateLimitedModels[modelId];
    if (!expiry) return false;
    if (Date.now() > expiry) {
        delete _rateLimitedModels[modelId];
        return false;
    }
    return true;
}

function clearRateLimits() {
    _rateLimitedModels = {};
}

/* ═══════════════════════════════════════════════════
   404 MODEL PRUNING
   
   When a model returns 404, remove it from the
   verified free models list so other agents don't
   try it. OpenRouter sometimes lists models with
   $0 pricing that don't actually have endpoints.
   ═══════════════════════════════════════════════════ */
function pruneDeadModel(modelId) {
    if (!modelId || !_verifiedFreeModels) return;
    var idx = _verifiedFreeModels.indexOf(modelId);
    if (idx > -1) {
        _verifiedFreeModels.splice(idx, 1);
        console.log('[MultiAgent] Pruned 404 model from verified list: ' + modelId + ' (' + _verifiedFreeModels.length + ' remaining)');
    }
    /* Also remove from state and localStorage cache */
    if (state.verifiedFreeModelIds) {
        var sIdx = state.verifiedFreeModelIds.indexOf(modelId);
        if (sIdx > -1) state.verifiedFreeModelIds.splice(sIdx, 1);
    }
    try {
        var cached = localStorage.getItem('sai_verified_free_models');
        if (cached) {
            var parsed = JSON.parse(cached);
            var cIdx = parsed.indexOf(modelId);
            if (cIdx > -1) {
                parsed.splice(cIdx, 1);
                localStorage.setItem('sai_verified_free_models', JSON.stringify(parsed));
            }
        }
    } catch (e) {}
}

/* Preference patterns per agent role — tried in order against available models */
var AGENT_MODEL_PREFERENCES = {
    planner: ['mimo', 'minimax', 'qwen3', 'deepseek', 'nemotron', 'llama-4', 'gemma', 'step', 'glm'],
    coder:   ['minimax', 'qwen3', 'deepseek', 'mimo', 'llama-4', 'gemma', 'nemotron', 'step', 'glm'],
    critic:  ['nemotron', 'minimax', 'mimo', 'qwen3', 'gemma', 'deepseek', 'llama-4', 'step', 'glm'],
    tester:  ['gemma', 'qwen3', 'mimo', 'minimax', 'deepseek', 'llama-4', 'nemotron', 'step', 'glm']
};

async function fetchAvailableFreeModels() {
    if (_verifiedFreeModels && _verifiedFreeModels.length > 0) {
        return _verifiedFreeModels;
    }

    if (state.verifiedFreeModelIds && state.verifiedFreeModelIds.length > 0) {
        _verifiedFreeModels = state.verifiedFreeModelIds.slice();
        return _verifiedFreeModels;
    }

    try {
        var cached = localStorage.getItem('sai_verified_free_models');
        if (cached) {
            var parsed = JSON.parse(cached);
            if (parsed && parsed.length > 0) {
                _verifiedFreeModels = parsed;
                state.verifiedFreeModelIds = parsed;
                return _verifiedFreeModels;
            }
        }
    } catch (e) {}

    if (_modelFetchPromise) return _modelFetchPromise;

    _modelFetchPromise = (async function () {
        try {
            console.log('[MultiAgent] Fetching available free models from OpenRouter...');
            toast('Discovering available free models...', 'info');

            var h = { 'Content-Type': 'application/json' };
            if (state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey;

            var r = await fetch('https://openrouter.ai/api/v1/models', { headers: h });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var d = await r.json();
            var allModels = d.data || [];

            for (var x = 0; x < allModels.length; x++) {
                if (allModels[x].context_length) {
                    state.modelContextLimits[allModels[x].id] = Math.floor(allModels[x].context_length * 3.5);
                }
            }

            var trulyFree = allModels.filter(function (m) {
                if (!m || !m.pricing) return false;
                var p = m.pricing;
                return (p.prompt === '0' || parseFloat(p.prompt) === 0) &&
                       (p.completion === '0' || parseFloat(p.completion) === 0);
            });

            trulyFree.sort(function (a, b) {
                return (b.context_length || 0) - (a.context_length || 0);
            });

            _verifiedFreeModels = trulyFree.map(function (m) { return m.id; });
            state.verifiedFreeModelIds = _verifiedFreeModels;

            try {
                localStorage.setItem('sai_verified_free_models', JSON.stringify(_verifiedFreeModels));
            } catch (e) {}

            console.log('[MultiAgent] Discovered ' + _verifiedFreeModels.length + ' free models');
            if (_verifiedFreeModels.length > 0) {
                toast(_verifiedFreeModels.length + ' free models available', 'success');
            } else {
                toast('No free models found — using fallbacks', 'warning');
                _verifiedFreeModels = HARDCODED_FALLBACK_MODELS.slice();
            }
            return _verifiedFreeModels;

        } catch (e) {
            console.error('[MultiAgent] Failed to fetch free models:', e);
            toast('Could not fetch models — using fallbacks', 'warning');
            _verifiedFreeModels = HARDCODED_FALLBACK_MODELS.slice();
            return _verifiedFreeModels;
        } finally {
            _modelFetchPromise = null;
        }
    })();

    return _modelFetchPromise;
}

/**
 * Pick the best available model for an agent role.
 * Skips models that are:
 *   - In triedModels (already failed with 404/402)
 *   - Currently rate-limited (429 cooldown)
 */
function pickModelForRole(agentName, availableModels) {
    if (!availableModels || availableModels.length === 0) return null;

    var preferences = AGENT_MODEL_PREFERENCES[agentName];
    if (!preferences) preferences = AGENT_MODEL_PREFERENCES.planner;

    /* Try each preference pattern in order */
    for (var p = 0; p < preferences.length; p++) {
        var pattern = preferences[p];
        for (var m = 0; m < availableModels.length; m++) {
            var candidate = availableModels[m];
            /* Skip tried (404'd/402'd) models */
            if (multiAgentState.triedModels && multiAgentState.triedModels.has(candidate)) continue;
            /* Skip rate-limited models */
            if (isRateLimited(candidate)) continue;
            if (candidate.toLowerCase().indexOf(pattern.toLowerCase()) > -1) {
                return candidate;
            }
        }
    }

    /* No preferred model found — use first untried, non-rate-limited available model */
    for (var i = 0; i < availableModels.length; i++) {
        if (multiAgentState.triedModels && multiAgentState.triedModels.has(availableModels[i])) continue;
        if (isRateLimited(availableModels[i])) continue;
        return availableModels[i];
    }

    /* ═══════════════════════════════════════════════════
       ALL models are either tried or rate-limited.
       
       Strategy: clear expired rate limits and try again.
       If still nothing, clear triedModels as last resort
       (the model may work on a fresh attempt).
       ═══════════════════════════════════════════════════ */
    var now = Date.now();
    var hasExpiredLimits = false;
    for (var rlKey in _rateLimitedModels) {
        if (_rateLimitedModels[rlKey] <= now) {
            delete _rateLimitedModels[rlKey];
            hasExpiredLimits = true;
        }
    }

    if (hasExpiredLimits) {
        return pickModelForRole(agentName, availableModels);
    }

    /* Absolute last resort — reset everything and return first model */
    console.warn('[MultiAgent] All models exhausted. Resetting tracking and retrying.');
    if (multiAgentState.triedModels) multiAgentState.triedModels.clear();
    clearRateLimits();
    return availableModels[0];
}

/**
 * Get the next untried, non-rate-limited model for fallback.
 */
function getNextAvailableModel(currentModel, agentName) {
    if (!multiAgentState.triedModels) multiAgentState.triedModels = new Set();
    if (currentModel) multiAgentState.triedModels.add(currentModel);

    if (!_verifiedFreeModels || _verifiedFreeModels.length === 0) return null;

    return pickModelForRole(agentName, _verifiedFreeModels);
}


/* ── Agent definitions ── */
export var AGENTS = {
    planner: {
        name: 'Planner',
        description: 'Task decomposition and architecture design',
        defaultModel: '',
        fallbackModels: [],
        maxTokens: 16384,
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
        defaultModel: '',
        fallbackModels: [],
        maxTokens: 16384,
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
        defaultModel: '',
        fallbackModels: [],
        maxTokens: 8192,
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
        defaultModel: '',
        fallbackModels: [],
        maxTokens: 8192,
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
    activeLoop: null,
    triedModels: new Set()
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
   ═══════════════════════════════════════ */
function getSmartFileContext(agentName) {
    var fullCtx = getFileContext();
    if (!fullCtx) return '';

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

    if (agentName === 'coder') {
        var MAX_CODER_CTX = 30000;
        if (fullCtx.length <= MAX_CODER_CTX) return fullCtx;

        var fileSections = fullCtx.split(/(?=--- FILE: )/);
        var treeSection = '';
        var fileContents = [];

        if (fileSections.length > 0 && fileSections[0].indexOf('--- FILE:') === -1) {
            treeSection = fileSections[0];
            fileSections = fileSections.slice(1);
        }

        var budgetRemaining = MAX_CODER_CTX - treeSection.length - 200;
        var includedFiles = [];
        var omittedFiles = [];

        for (var fi = 0; fi < fileSections.length; fi++) {
            var section = fileSections[fi];
            if (section.length <= budgetRemaining) {
                includedFiles.push(section);
                budgetRemaining -= section.length;
            } else {
                var nameMatch = section.match(/--- FILE: (.+?) ---/);
                omittedFiles.push(nameMatch ? nameMatch[1] : 'file ' + (fi + 1));
            }
        }

        var result = treeSection + includedFiles.join('');
        if (omittedFiles.length > 0) {
            result += '\n\n--- TRUNCATED: ' + omittedFiles.length + ' files omitted to fit context budget ---\n';
            result += 'Omitted files (ask the user to paste if needed):\n' + omittedFiles.join('\n');
        }
        return result;
    }

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

    /* ═══════════════════════════════════════════════════
       DYNAMIC MODEL DISCOVERY
       ═══════════════════════════════════════════════════ */
    if (state.settings.provider === 'openrouter') {
        try {
            await fetchAvailableFreeModels();
            if (_verifiedFreeModels && _verifiedFreeModels.length > 0) {
                console.log('[MultiAgent] Using ' + _verifiedFreeModels.length + ' dynamically discovered models');
            } else {
                console.warn('[MultiAgent] No free models found — will try hardcoded fallbacks');
            }
        } catch (e) {
            console.warn('[MultiAgent] Model discovery failed:', e.message);
        }
    }

    multiAgentState.isActive = true;
    multiAgentState.triedModels = new Set();
    clearRateLimits(); /* Clear any stale rate limits from previous tasks */
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

/* ═══════════════════════════════════════════════════
   MODEL SELECTION — Dynamic, not hardcoded
   ═══════════════════════════════════════════════════ */
MultiAgentOrchestrator.prototype.selectModelForAgent = function(agent, agentName) {
    /* 1. Check if user configured a specific model for this agent */
    if (state.settings.agentModels) {
        var configured = state.settings.agentModels[agentName];
        if (configured) return ensureFreeModel(configured);
    }

    /* 2. For non-OpenRouter providers, use the user's main configured model */
    if (state.settings.provider !== 'openrouter') {
        return state.settings.model;
    }

    /* 3. For OpenRouter, use dynamically discovered models */
    if (_verifiedFreeModels && _verifiedFreeModels.length > 0) {
        var dynamicModel = pickModelForRole(agentName, _verifiedFreeModels);
        if (dynamicModel) {
            console.log('[MultiAgent] Selected dynamic model for ' + agentName + ': ' + dynamicModel);
            return dynamicModel;
        }
    }

    /* 4. Last resort */
    console.warn('[MultiAgent] No dynamic models available for ' + agentName);
    return null;
};

/* ═══════════════════════════════════════════════════
   CODER FALLBACK — Dynamic
   ═══════════════════════════════════════════════════ */
MultiAgentOrchestrator.prototype.getNextCoderFallback = function(agent, currentModel) {
    var configuredFallback = (state.settings.agentModels || {}).coderFallback;
    if (configuredFallback && configuredFallback !== currentModel && !isRateLimited(configuredFallback)) return ensureFreeModel(configuredFallback);

    if (state.settings.provider !== 'openrouter') return null;

    var nextModel = getNextAvailableModel(currentModel, 'coder');
    if (nextModel) {
        console.log('[MultiAgent] Coder fallback: ' + nextModel);
        return nextModel;
    }

    return null;
};

/* ── Ensure model ID has `:free` suffix on OpenRouter ── */
function ensureFreeModel(model) {
    if (!model) return model;
    if (state.settings.provider !== 'openrouter') return model;
    if (model.indexOf(':free') > -1) return model;
    if (model.indexOf('/') === -1) return model;
    return model + ':free';
}

/* ═══════════════════════════════════════════════════
   RUN AGENT — With 429 model switching
   
   KEY FIX: When a model returns 429, we now:
   1. Mark it as rate-limited (90s cooldown)
   2. Switch to the next available non-rate-limited model
   3. Retry immediately with the new model
   
   This prevents the death spiral of retrying the
   same rate-limited model multiple times.
   ═══════════════════════════════════════════════════ */
MultiAgentOrchestrator.prototype.runAgent = async function(agentName, customPrompt) {
    var agent = AGENTS[agentName];
    if (!agent) return { success: false, error: 'Unknown agent: ' + agentName };

    multiAgentState.currentAgent = agentName;
    setConnectionStatus('connecting', 'Multi-Agent: Running ' + agent.name + '...');

    var model = this.selectModelForAgent(agent, agentName);

    /* If no model could be selected at all, fail immediately */
    if (!model) {
        return { success: false, error: 'No available model for ' + agentName + '. All models are rate-limited or unavailable.' };
    }

    var prompt = customPrompt || this.buildAgentPrompt(agentName);

    if (this.taskContext) {
        prompt = this.taskContext + '\n\n' + prompt;
    }

    var result = null;
    var lastError = 'No response received from ' + agentName;
    var attempts = 0;
    /* ═══════════════════════════════════════════════════
       INCREASED MAX ATTEMPTS
       
       Old: 2 for non-coder, 3 for coder
       New: 5 for all agents (with model switching)
       
       Since each attempt now tries a DIFFERENT model
       on 429/404, more attempts = more chances to find
       a working model. We're not spamming the same
       endpoint — we're rotating through the model pool.
       ═══════════════════════════════════════════════════ */
    var maxAttempts = 5;

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

                /* Coder failed validation — try next model */
                if (agentName === 'coder' && !result.success && attempts < maxAttempts) {
                    model = this.getNextCoderFallback(agent, model);
                    if (model) {
                        toast('Coder failed, switching to ' + model, 'info');
                        continue;
                    }
                }

                /* Critic rejected — send back to coder */
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

                /* ═══════════════════════════════════════════════════
                   429 RATE LIMIT — SWITCH MODEL
                   
                   OLD BUG: 429 fell through to generic retry,
                   which retried the SAME model 3 times.
                   
                   NEW: Mark model as rate-limited, pick a
                   DIFFERENT model, and retry immediately.
                   ═══════════════════════════════════════════════════ */
                if (lastError.indexOf('HTTP 429') > -1) {
                    /* Mark current model as rate-limited */
                    markRateLimited(model);

                    /* Prune from verified list if it's consistently failing */
                    /* (don't prune on 429 — it might work later, just switch away) */

                    /* Find next non-rate-limited model */
                    var nextOn429 = getNextAvailableModel(model, agentName);
                    if (nextOn429) {
                        model = nextOn429;
                        toast(agentName + ' rate-limited, switching to ' + model, 'info');
                        continue; /* Retry immediately with new model */
                    }

                    /* ═══════════════════════════════════════════════════
                       ALL MODELS RATE-LIMITED
                       
                       Instead of failing immediately, wait for
                       the shortest cooldown to expire, then retry.
                       This handles the case where the free tier
                       is temporarily overloaded but will recover.
                       ═══════════════════════════════════════════════════ */
                    var shortestWait = findShortestRateLimitWait();
                    if (shortestWait > 0 && attempts < maxAttempts) {
                        var waitSecs = Math.ceil(shortestWait / 1000);
                        toast('All models rate-limited. Waiting ' + waitSecs + 's...', 'info');
                        setConnectionStatus('connecting', 'Rate-limited — waiting ' + waitSecs + 's...');
                        await this.delay(shortestWait);
                        /* Clear expired limits and try again */
                        clearRateLimits();
                        model = this.selectModelForAgent(agent, agentName);
                        if (model) continue;
                    }

                    /* Truly no options */
                    result = { success: false, error: 'All models rate-limited. Please try again in a few minutes.' };
                    break;
                }

                /* ═══════════════════════════════════════════════════
                   402 CREDITS — SWITCH MODEL
                   ═══════════════════════════════════════════════════ */
                if (lastError.indexOf('HTTP 402') > -1 || lastError.indexOf('credits') > -1) {
                    if (model) multiAgentState.triedModels.add(model);
                    var nextOn402 = getNextAvailableModel(model, agentName);
                    if (nextOn402 && attempts < maxAttempts) {
                        model = nextOn402;
                        toast('Credits issue, switching to ' + model, 'info');
                        continue;
                    }
                    return { success: false, error: lastError };
                }

                /* ═══════════════════════════════════════════════════
                   404 NOT FOUND — PRUNE + SWITCH MODEL
                   
                   The model exists in the pricing API but
                   has no actual endpoint. Remove it from
                   the verified list so no other agent tries it.
                   ═══════════════════════════════════════════════════ */
                if (lastError.indexOf('is not a valid model ID') > -1 || lastError.indexOf('HTTP 404') > -1) {
                    /* Mark as tried */
                    if (model) multiAgentState.triedModels.add(model);
                    /* Prune from verified list so other agents don't hit it */
                    pruneDeadModel(model);
                    console.warn('[MultiAgent] Model "' + model + '" unavailable (404), pruned from list. Finding next...');

                    /* Find next model */
                    var nextOn404 = getNextAvailableModel(model, agentName);
                    if (nextOn404) {
                        model = nextOn404;
                        toast(agentName + ' model unavailable, switching to ' + model, 'info');
                        if (attempts < maxAttempts) continue;
                    }

                    /* No more models to try */
                    if (attempts < maxAttempts) {
                        await this.delay(1000 * attempts);
                    } else {
                        result = { success: false, error: lastError };
                    }
                }

                /* Generic error — retry with delay */
                if (attempts < maxAttempts && !result) {
                    toast(agentName + ' attempt ' + attempts + ' failed, retrying...', 'info');
                    await this.delay(1000 * attempts);
                } else if (!result) {
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

/* ── Find shortest wait time among rate-limited models ── */
function findShortestRateLimitWait() {
    var shortest = Infinity;
    var now = Date.now();
    for (var key in _rateLimitedModels) {
        var remaining = _rateLimitedModels[key] - now;
        if (remaining > 0 && remaining < shortest) {
            shortest = remaining;
        }
    }
    /* Cap at 30 seconds — don't wait longer than that */
    return shortest < Infinity ? Math.min(shortest, 30000) : 0;
}

/* ═══════════════════════════════════════
   SELF-CONTAINED EXECUTE
   ═══════════════════════════════════════ */
MultiAgentOrchestrator.prototype.executeAgentCall = async function(agentName, model, prompt) {
    var self = this;
    var agent = AGENTS[agentName];
    var timeoutMs = 120000;

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
    var agentBudget = agent.maxTokens || 8192;
    var startTokens = Math.max(agentBudget, Math.min(userMax, 32768));

    var fileCount = fileCtx ? (fileCtx.match(/--- FILE:/g) || []).length : 0;
    console.log('[MultiAgent] ' + agentName + ' model=' + model + ' startTokens=' + startTokens + ' fileCtx=' + fileCtx.length + ' chars ' + fileCount + ' files');

    /* ── 402 AUTO-RETRY LOOP ── */
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

            throw error;
        }
    }

    throw new Error(agentName + ' failed after ' + MAX_402_RETRIES + ' attempts');
};

/* ── Actual fetch call ── */
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
                    throw new Error('HTTP ' + response.status + ': ' + errText.substring(0, 300));
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
        multiAgentState.triedModels = new Set();
        /* Don't clear rate limits here — they're time-based and may still be valid */
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

    if (!isConnected()) {
        toast('No workspace folder connected. Agents will work without file context.', 'info');
    }

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