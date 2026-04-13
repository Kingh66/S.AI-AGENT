/* ═══════════════════════════════════════
   MULTI-AGENT ORCHESTRATION
   Planner → Coder → Critic → Tester flow
   Self-contained payload — does NOT depend
   on connection.js buildPayload to prevent
   token-boost credit errors
   ═══════════════════════════════════════ */
import { state } from './state.js';
import { toast, setConnectionStatus, autoResize } from './ui.js';

/* ── Agent definitions ── */
export var AGENTS = {
    planner: {
        name: 'Planner',
        description: 'Task decomposition and architecture design',
        defaultModel: 'stepfun/step-3.5-flash',
        fallbackModels: ['xiaomi/mimo-v2-pro', 'minimax/minimax-m2.7'],
        maxTokens: 4096,
        prompt: 'You are S.ai\'s Planner agent. Your ONLY responsibility is to understand the task and create a detailed, step-by-step implementation plan.\n\nCRITICAL RULES:\n1. Analyze the task thoroughly before planning\n2. Break complex tasks into 3-7 actionable steps\n3. Each step must be specific, testable, and independent\n4. Consider file structure, dependencies, and integration points\n5. Identify potential risks and edge cases\n6. Output format: EXACTLY this structure:\n\n## PLAN\n**Objective:** [Clear one-sentence goal]\n\n**Steps:**\n1. [Step 1 description - specific action]\n2. [Step 2 description]\n3. ...\n\n**Files to create/modify:**\n- file1.ext (purpose)\n- file2.ext (purpose)\n\n**Dependencies:**\n- [List any external requirements]\n\n**Risks:**\n- [Potential issues and mitigation]\n\nNEVER write code. NEVER review code. ONLY plan.',

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
        prompt: 'You are S.ai\'s Coder agent. Your ONLY responsibility is to write complete, production-ready code based on the Planner\'s plan.\n\nCRITICAL RULES:\n1. Follow the plan EXACTLY - do not deviate\n2. Write COMPLETE files - never use "...", "// rest unchanged", or "// existing code"\n3. Every file must be self-contained and runnable\n4. Include all necessary imports, error handling, and edge cases\n5. Add clear comments for complex logic\n6. Use modern best practices and patterns\n7. For each file, output:\n\nfile:path/to/filename.ext\n// FULL FILE CONTENT - NO OMISSIONS\n[complete code]\n\n8. If modifying existing files, read the provided context and integrate seamlessly\n9. NEVER hallucinate imports - only use imports that exist in the context\n10. After writing ALL files, add: <|INTEGRATION_CHECK|>\n\nOutput format: One or more file blocks, then <|INTEGRATION_CHECK|>',

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
        prompt: 'You are S.ai\'s Critic agent - the FINAL quality gate. Your approval is REQUIRED before code is accepted.\n\nCRITICAL RULES:\n1. You have ABSOLUTE AUTHORITY - your decision cannot be overridden\n2. Be STRICT - reject if ANY of these exist:\n   - Missing error handling\n   - Race conditions\n   - Memory leaks (unclosed resources, event listeners not cleaned)\n   - Security vulnerabilities\n   - Broken imports or dependencies\n   - Incomplete implementations ("..." or "// rest")\n   - Poor naming or unclear logic\n   - Missing edge case handling\n3. Review ALL files as a complete system\n4. Check integration between files\n5. Verify the plan was followed exactly\n\nOutput format: EXACTLY one of these:\n\nAPPROVED\n[Brief validation: "All files complete, integration correct, no issues"]\n\nREJECTED\n[Detailed reasons, numbered]\n1. [Issue with file X]\n2. [Integration problem]\n3. ...\n\nIf rejected, the code goes back to Coder with your feedback.\n\nREMEMBER: Your job is to prevent broken code from being accepted. If in doubt, REJECT.',

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
        defaultModel: 'stepfun/step-3.5-flash',
        fallbackModels: ['xiaomi/mimo-v2-pro', 'minimax/minimax-m2.7'],
        maxTokens: 4096,
        prompt: 'You are S.ai\'s Tester agent. Your job is to validate the code works correctly.\n\nCRITICAL RULES:\n1. Generate unit tests for all major functions\n2. Test edge cases and error conditions\n3. Verify integration points\n4. Check for performance issues\n5. Output format:\n\n## TEST PLAN\n[Brief test strategy]\n\n## TEST FILES\nfile:tests/test_<component>.ext\n// COMPLETE test code with assertions\n[test code]\n\n## VALIDATION RESULT\nPASS | FAIL | NEEDS_REVIEW\n\n[Reasoning]\n\nIf tests fail, output FAIL with specific failures.',

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

/* ═════════════════════════════════════════
   SELF-CONTAINED API HELPERS
   These do NOT import connection.js at all.
   They build their own payload to guarantee
   max_tokens is NEVER auto-boosted to 16384.
   ═══════════════════════════════════════ */

function getApiUrl() {
    var endpoint = (state.settings.endpoint || '').replace(/\/+$/, '');
    var provider = state.settings.provider;
    if (provider === 'ollama') return endpoint + '/api/chat';
    if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
    return endpoint.replace(/\/v1$/, '') + '/v1/chat/completions';
}

function isOllamaProvider() {
    return state.settings.provider === 'ollama';
}

function buildAgentPayload(messages, model, maxTokens) {
    /* NEVER auto-boost. Use exactly what the caller passes. */
    if (isOllamaProvider()) {
        return {
            model: model,
            messages: messages,
            stream: true,
            options: { temperature: 0.7, num_predict: maxTokens }
        };
    }
    return {
        model: model,
        messages: messages,
        stream: true,
        temperature: 0.7,
        max_tokens: maxTokens
    };
}

function buildAgentHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (!isOllamaProvider() && state.settings.apiKey) {
        h['Authorization'] = 'Bearer ' + state.settings.apiKey;
    }
    if (state.settings.provider === 'openrouter') {
        h['HTTP-Referer'] = window.location.href;
        h['X-Title'] = 'S.ai Coding Agent';
    }
    return h;
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

    while (attempts < maxAttempts && !(result && result.success)) {
        attempts++;
        lastError = 'Attempt ' + attempts + ' failed';

        try {
            result = await this.executeAgentCall(agentName, model, prompt);

            if (!result.success && !result.error) {
                result.error = agentName + ' returned failure with no details';
            }
            lastError = result.error || lastError;

            /* Coder fallback on failure */
            if (agentName === 'coder' && !result.success && attempts < maxAttempts) {
                model = this.getNextCoderFallback(agent, model);
                if (model) {
                    toast('Coder failed, switching to fallback: ' + model, 'info');
                    continue;
                }
            }

            /* Critic rejection handling */
            if (agentName === 'critic' && result.decision === 'REJECTED') {
                multiAgentState.criticRejections++;
                var maxRejections = state.settings.maxCriticRejections || multiAgentState.maxCriticRejections;

                if (multiAgentState.criticRejections >= maxRejections) {
                    toast('Critic rejected ' + maxRejections + ' times — task failed', 'error');
                    return { success: false, error: 'Critic rejected ' + maxRejections + ' times. Last feedback: ' + (result.feedback || 'none') };
                }

                toast('Critic rejected — sending back to Coder with feedback', 'info');
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

            /* ── 402: Insufficient credits — FAIL FAST, never retry ── */
            if (lastError.indexOf('HTTP 402') > -1 || lastError.indexOf('credits') > -1 || lastError.indexOf('afford') > -1) {
                var affordMatch = lastError.match(/can only afford (\d+)/);
                var reqMatch = lastError.match(/requested up to (\d+)/);
                var detail = 'Insufficient OpenRouter credits.';
                if (affordMatch) detail += ' You can afford ' + affordMatch[1] + ' tokens.';
                if (reqMatch) detail += ' Requested: ' + reqMatch[1] + '.';
                detail += ' Set Max Tokens to ' + (affordMatch ? Math.floor(parseInt(affordMatch[1]) / 5) : '400') + ' in sidebar Quick Settings, or add credits.';
                toast(detail, 'error');
                return { success: false, error: detail };
            }

            /* Invalid model — skip to fallback */
            if (lastError.indexOf('is not a valid model ID') > -1 || lastError.indexOf('HTTP 404') > -1) {
                toast('Model "' + model + '" is invalid or removed, trying fallback...', 'error');
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
        this.taskContext = this.accumulateContext(agentName, result.content);
    }

    return result;
};

MultiAgentOrchestrator.prototype.selectModelForAgent = function(agent, agentName) {
    if (state.settings.agentModels) {
        var configured = state.settings.agentModels[agentName];
        if (configured) return configured;
    }
    if (agentName === 'coder' && agent.currentModel) {
        return agent.currentModel;
    }
    return agent.defaultModel;
};

MultiAgentOrchestrator.prototype.getNextCoderFallback = function(agent, currentModel) {
    var configuredFallback = (state.settings.agentModels || {}).coderFallback;
    if (configuredFallback && configuredFallback !== currentModel) {
        return configuredFallback;
    }
    var fallbacks = agent.fallbackModels.filter(function(m) { return m !== currentModel; });
    return fallbacks.length > 0 ? fallbacks[0] : null;
};

/* ═══════════════════════════════════════
   SELF-CONTAINED EXECUTE — NO connection.js
   This function builds its own fetch payload.
   It does NOT call conn.buildPayload().
   It does NOT call conn.getApiUrl().
   It does NOT call conn.buildHeaders().
   This is intentional — it guarantees max_tokens
   is NEVER auto-boosted to 16384.
   ═══════════════════════════════════════ */
MultiAgentOrchestrator.prototype.executeAgentCall = async function(agentName, model, prompt) {
    var self = this;
    var agent = AGENTS[agentName];
    var timeoutMs = 120000;

    /* ── Token budget: min of agent default and user setting ──
       Multi-agent makes 4 calls, so each call gets its own budget.
       The user's "Max Tokens" slider caps everything. */
    var userMax = state.settings.maxTokens || 4096;
    var agentBudget = agent.maxTokens || 4096;
    var finalMaxTokens = Math.min(userMax, agentBudget);

    console.log('[MultiAgent] ' + agentName + ' using model=' + model + ' max_tokens=' + finalMaxTokens);

    return new Promise(function(resolve, reject) {
        var timeoutId = setTimeout(function() {
            reject(new Error(agentName + ' timeout after ' + timeoutMs + 'ms'));
        }, timeoutMs);

        var agentMessages = [
            { role: 'system', content: agent.prompt }
        ];

        var recentCtx = multiAgentState.conversationHistory.slice(-6);
        for (var i = 0; i < recentCtx.length; i++) {
            agentMessages.push(recentCtx[i]);
        }
        agentMessages.push({ role: 'user', content: prompt });

        /* Build payload RIGHT HERE — no connection.js dependency */
        var payload = buildAgentPayload(agentMessages, model, finalMaxTokens);
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
                return {
                    success: false,
                    content: content,
                    agent: agentName,
                    error: 'Planner could not extract a valid plan. Response did not contain recognizable plan structure.'
                };
            }
            if (!plan.steps || plan.steps.length === 0) {
                return {
                    success: false,
                    content: content,
                    plan: plan,
                    agent: agentName,
                    error: 'Plan has no actionable steps. Found ' + plan.files.length + ' files but no steps to implement them.'
                };
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
                prompt += '## CRITIC FEEDBACK — YOU MUST FIX THESE ISSUES\n' + criticFeedback + '\n\n';
            }
            if (this.taskContext) {
                prompt += '## WORKSPACE CONTEXT\n' + this.taskContext + '\n\n';
            }
            prompt += 'REMEMBER: Output COMPLETE files with NO omissions. End with <|INTEGRATION_CHECK|>';
            return prompt;

        case 'critic':
            var critiquePrompt = 'Review this code:\n\n';
            if (this.taskContext) {
                critiquePrompt += this.taskContext + '\n\n';
            }
            critiquePrompt += 'Apply strict standards. APPROVE only if code is production-ready. REJECT with specific numbered issues if not.';
            return critiquePrompt;

        case 'tester':
            return 'Validate the implemented code:\n\n' + (this.taskContext || 'No code context available') + '\n\nGenerate tests and report PASS/FAIL.';

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
        } else {
            toast('Multi-agent task failed: ' + (error || 'unknown'), 'error');
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
    if (this.abortController) {
        this.abortController.abort();
    }
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

    /* ── HARD PRE-FLIGHT CHECK ──
       If max_tokens is above a safe threshold, block the task and
       tell the user exactly what to change. This prevents wasting
       credits on a guaranteed 402 failure. */
    var userMax = state.settings.maxTokens || 4096;
    if (state.settings.provider === 'openrouter' && userMax > 1800) {
        toast('Your Max Tokens is set to ' + userMax + '. Multi-agent makes 4 API calls (planner+coder+critic+tester). Lower Max Tokens in the sidebar to 400-1800 to fit your credit balance, or add credits at openrouter.ai/settings/credits', 'error');
        return;
    }

    input.value = '';
    input.style.height = 'auto';
    autoResize(input);

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
        if (!multiAgentState.isActive) {
            clearInterval(updateLoop);
            return;
        }
        var agent = multiAgentState.currentAgent ? AGENTS[multiAgentState.currentAgent] : null;
        var name = agent ? agent.name : 'Initializing';
        statusEl.innerHTML = '<i class="fas fa-network-wired" style="animation:sai-spin 1s linear infinite"></i> <span>Multi-Agent: ' + name + '</span>';
    }, 500);
}

function removeMultiAgentStatus() {
    var el = document.getElementById('multiagent-status');
    if (el) el.remove();
}

/* Spin animation (only add once) */
if (!document.getElementById('sai-spin-style')) {
    var spinStyle = document.createElement('style');
    spinStyle.id = 'sai-spin-style';
    spinStyle.textContent = '@keyframes sai-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
    document.head.appendChild(spinStyle);
}