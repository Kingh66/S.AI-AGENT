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
    document.getElementById('boot-screen').classList.add('hidden');
    document.getElementById('app').classList.add('active');
    initBackgroundCanvas();

    /* Initialize voice after app is visible */
    import('./voice.js').then(({ initVoice }) => initVoice());
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ── Neural Network Background ── */
function initBackgroundCanvas() {
    const canvas = document.getElementById('bg-canvas');
    const ctx = canvas.getContext('2d');
    let nodes = [];
    let w, h;
    const NODE_COUNT = 50;
    const MAX_DIST = 150;

    function resize() {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < NODE_COUNT; i++) {
        nodes.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            r: 1.5 + Math.random() * 1.5
        });
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);

        /* Move nodes */
        for (const n of nodes) {
            n.x += n.vx;
            n.y += n.vy;
            if (n.x < 0 || n.x > w) n.vx *= -1;
            if (n.y < 0 || n.y > h) n.vy *= -1;
        }

        /* Draw connections */
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < MAX_DIST) {
                    const alpha = (1 - dist / MAX_DIST) * 0.12;
                    ctx.beginPath();
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    ctx.strokeStyle = `rgba(0, 229, 160, ${alpha})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        /* Draw nodes */
        for (const n of nodes) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 229, 160, 0.2)';
            ctx.fill();
        }

        requestAnimationFrame(draw);
    }

    draw();
}