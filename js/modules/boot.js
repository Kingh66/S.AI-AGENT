/* ═══════════════════════════════════════
   BOOT — Boot sequence & background canvas
   ═══════════════════════════════════════ */
import { bootLines } from './config.js';

export async function runBoot() {
    const body = document.getElementById('boot-body');

    for (const line of bootLines) {
        await delay(line.delay);
        const div = document.createElement('div');
        div.className = 'boot-line';
        div.innerHTML = line.text + '<span class="boot-cursor"></span>';
        body.appendChild(div);

        const allLines = body.querySelectorAll('.boot-line');
        allLines.forEach((el, i) => {
            if (i < allLines.length - 1) {
                const c = el.querySelector('.boot-cursor');
                if (c) c.remove();
            }
        });

        requestAnimationFrame(() => div.classList.add('visible'));
    }

    await delay(800);
    
    document.getElementById('boot-screen').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    /* ── Skip heavy canvas animation for Ollama (saves CPU for inference) ── */
    var isOllama = false;
    try {
        var saved = localStorage.getItem('sai_settings');
        if (saved) {
            var parsed = JSON.parse(saved);
            isOllama = parsed.provider === 'ollama';
        }
    } catch (e) {}

    if (isOllama) {
        /* Lightweight static background instead of animated canvas */
        var appEl = document.getElementById('app');
        if (appEl) {
            appEl.style.background = 'radial-gradient(ellipse at 20% 50%, rgba(0,212,170,0.03) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(0,150,255,0.02) 0%, transparent 50%), var(--bg)';
        }
        console.log('[Boot] Ollama detected — skipped canvas animation to save CPU');
    } else {
        try {
            const { initBackground } = await import('./effects.js');
            initBackground();
        } catch (e) {
            console.warn('Background effects failed to load:', e);
        }
    }

    import('./voice.js').then(({ initVoice }) => initVoice());
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}