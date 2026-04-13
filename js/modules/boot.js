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

        /* Remove cursor from all previous lines */
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
    
    /* Hide boot screen and show main app */
    document.getElementById('boot-screen').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    /* Initialize the futuristic neural wave background from effects.js */
    try {
        const { initBackground } = await import('./effects.js');
        initBackground();
    } catch (e) {
        console.warn('Background effects failed to load:', e);
    }

    /* Initialize voice after app is visible */
    import('./voice.js').then(({ initVoice }) => initVoice());
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}