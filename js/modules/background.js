/* ═══════════════════════════════════════
   BACKGROUND — Enhanced Neural Network Canvas
   ═══════════════════════════════════════ */
import { state } from './state.js';

let canvas, ctx, w, h;
const NODE_COUNT = 80;
const MAX_DIST = 180;
const CONNECTION_ALPHA = 0.08;
const NODE_ALPHA = 0.15;

let nodes = [];
let animating = true;

function initBackgroundCanvas() {
    canvas = document.getElementById('bg-canvas');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    // Create nodes with varied properties
    for (let i = 0; i < NODE_COUNT; i++) {
        nodes.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            r: 1.5 + Math.random() * 2,
            color: `rgba(0, 229, 160, ${NODE_ALPHA * (0.8 + Math.random() * 0.4)})`,
            speed: 0.3 + Math.random() * 0.4
        });
    }

    // Start animation
    animate();
}

function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
}

function animate() {
    if (!animating) return;

    ctx.clearRect(0, 0, w, h);

    // Update node positions
    for (const n of nodes) {
        n.x += n.vx * n.speed;
        n.y += n.vy * n.speed;

        // Bounce off edges
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
    }

    // Draw connections with distance-based intensity
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < MAX_DIST) {
                const alpha = (1 - dist / MAX_DIST) * CONNECTION_ALPHA;
                ctx.beginPath();
                ctx.moveTo(nodes[i].x, nodes[i].y);
                ctx.lineTo(nodes[j].x, nodes[j].y);
                ctx.strokeStyle = `rgba(0, 229, 160, ${alpha})`;
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }
        }
    }

    // Draw nodes with varied sizes and colors
    for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
    }

    requestAnimationFrame(animate);
}

// Export for external control
export function pauseBackground() { animating = false; }
export function resumeBackground() { animating = true; animate(); }
export function clearBackground() { nodes = []; }

// Initialize on module load
initBackgroundCanvas();