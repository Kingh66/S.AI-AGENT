
/* ═══════════════════════════════════════
   EFFECTS — Neural Wave Background
   ═══════════════════════════════════════ */
import { state } from './state.js';

let canvas, ctx;
let particles = [];
let neuralWaves = [];
let dataStreams = [];
let mouse = { x: 0, y: 0, active: false };
let animationId;
let time = 0;

const CONFIG = {
    particleCount: 80,
    connectionDist: 150,
    waveSpeed: 0.8,
    waveDecay: 0.015,
    colors: {
        primary: '#00f5ff',
        secondary: '#8b5cf6',
        accent: '#06ffa5',
        bg: '#030712'
    }
};

class NeuralNode {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.baseX = x;
        this.baseY = y;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.radius = Math.random() * 2 + 1.5;
        this.pulsePhase = Math.random() * Math.PI * 2;
        this.pulseSpeed = Math.random() * 0.02 + 0.01;
        this.thoughtLevel = Math.random();
        this.connections = [];
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 50 || this.x > canvas.width - 50) this.vx *= -1;
        if (this.y < 50 || this.y > canvas.height - 50) this.vy *= -1;

        if (mouse.active) {
            const dx = mouse.x - this.x;
            const dy = mouse.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 300) {
                const force = (300 - dist) / 300 * 0.5;
                this.vx += (dx / dist) * force;
                this.vy += (dy / dist) * force;
            }
        }

        this.vx *= 0.99;
        this.vy *= 0.99;

        this.pulsePhase += this.pulseSpeed;
        this.thoughtLevel = (Math.sin(this.pulsePhase) + 1) / 2;
    }

    draw() {
        const pulse = 1 + Math.sin(this.pulsePhase) * 0.3;
        const r = this.radius * pulse;

        const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 4);
        gradient.addColorStop(0, this.getColor(0.6));
        gradient.addColorStop(0.5, this.getColor(0.2));
        gradient.addColorStop(1, 'transparent');

        ctx.beginPath();
        ctx.arc(this.x, this.y, r * 4, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.fillStyle = this.getColor(1);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(this.x, this.y, r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }

    getColor(alpha) {
        const t = this.thoughtLevel;
        if (t < 0.33) return `rgba(0, 245, 255, ${alpha})`;
        else if (t < 0.66) return `rgba(139, 92, 246, ${alpha})`;
        else return `rgba(6, 255, 165, ${alpha})`;
    }
}

class NeuralWave {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 0;
        this.maxRadius = 400;
        this.alpha = 0.8;
        this.speed = CONFIG.waveSpeed;
        this.alive = true; /* ── FIX: Track alive state separately ── */
    }

    update() {
        this.radius += this.speed;
        this.alpha -= CONFIG.waveDecay;
        this.alive = this.alpha > 0 && this.radius < this.maxRadius;
        return this.alive;
    }

    draw() {
        if (!this.alive) return;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 245, 255, ${this.alpha * 0.5})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * 0.7, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(139, 92, 246, ${this.alpha * 0.3})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

class DataStream {
    constructor(startNode, endNode) {
        this.start = startNode;
        this.end = endNode;
        this.progress = 0;
        this.speed = Math.random() * 0.02 + 0.01;
        this.packetSize = Math.random() * 3 + 2;
    }

    update() {
        this.progress += this.speed;
        if (this.progress >= 1) {
            this.progress = 0;
            if (Math.random() < 0.3) {
                neuralWaves.push(new NeuralWave(this.end.x, this.end.y));
            }
        }
    }

    draw() {
        const x = this.start.x + (this.end.x - this.start.x) * this.progress;
        const y = this.start.y + (this.end.y - this.start.y) * this.progress;

        const gradient = ctx.createRadialGradient(x, y, 0, x, y, this.packetSize * 3);
        gradient.addColorStop(0, 'rgba(6, 255, 165, 0.9)');
        gradient.addColorStop(0.5, 'rgba(6, 255, 165, 0.3)');
        gradient.addColorStop(1, 'transparent');

        ctx.beginPath();
        ctx.arc(x, y, this.packetSize * 3, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, this.packetSize, 0, Math.PI * 2);
        ctx.fillStyle = '#06ffa5';
        ctx.fill();
    }
}

function initBackground() {
    canvas = document.getElementById('bg-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'bg-canvas';
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;';
        document.body.insertBefore(canvas, document.body.firstChild);
    }

    ctx = canvas.getContext('2d');
    resizeCanvas();

    particles = [];
    for (let i = 0; i < CONFIG.particleCount; i++) {
        particles.push(new NeuralNode(
            Math.random() * canvas.width,
            Math.random() * canvas.height
        ));
    }

    dataStreams = [];
    for (let i = 0; i < 15; i++) {
        const start = particles[Math.floor(Math.random() * particles.length)];
        const end = particles[Math.floor(Math.random() * particles.length)];
        if (start !== end) {
            dataStreams.push(new DataStream(start, end));
        }
    }

    window.addEventListener('resize', resizeCanvas);
    canvas.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
    });
    canvas.addEventListener('mouseleave', () => {
        mouse.active = false;
    });

    animate();
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function drawBackground() {
    const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, canvas.width
    );
    gradient.addColorStop(0, '#0a0f1a');
    gradient.addColorStop(0.5, '#050a10');
    gradient.addColorStop(1, '#020408');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < CONFIG.connectionDist) {
                const alpha = (1 - dist / CONFIG.connectionDist) * 0.4;
                const gradient = ctx.createLinearGradient(
                    particles[i].x, particles[i].y,
                    particles[j].x, particles[j].y
                );

                const t1 = particles[i].thoughtLevel;
                const t2 = particles[j].thoughtLevel;
                const color1 = t1 < 0.5 ? '0, 245, 255' : '139, 92, 246';
                const color2 = t2 < 0.5 ? '0, 245, 255' : '139, 92, 246';

                gradient.addColorStop(0, `rgba(${color1}, ${alpha})`);
                gradient.addColorStop(1, `rgba(${color2}, ${alpha})`);

                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(particles[j].x, particles[j].y);
                ctx.strokeStyle = gradient;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }
}

function drawBrainOutline() {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const scale = Math.min(canvas.width, canvas.height) * 0.35;

    ctx.save();
    ctx.translate(cx, cy);

    ctx.beginPath();
    ctx.moveTo(-scale * 0.3, -scale * 0.5);
    ctx.bezierCurveTo(
        -scale * 0.6, -scale * 0.4,
        -scale * 0.7, scale * 0.2,
        -scale * 0.3, scale * 0.5
    );
    ctx.bezierCurveTo(
        -scale * 0.1, scale * 0.4,
        -scale * 0.1, -scale * 0.2,
        -scale * 0.3, -scale * 0.5
    );

    ctx.moveTo(scale * 0.3, -scale * 0.5);
    ctx.bezierCurveTo(
        scale * 0.1, -scale * 0.2,
        scale * 0.1, scale * 0.4,
        scale * 0.3, scale * 0.5
    );
    ctx.bezierCurveTo(
        scale * 0.7, scale * 0.2,
        scale * 0.6, -scale * 0.4,
        scale * 0.3, -scale * 0.5
    );

    ctx.strokeStyle = 'rgba(0, 245, 255, 0.05)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
}

function animate() {
    time += 0.01;

    drawBackground();
    drawBrainOutline();

    /* ── FIX: Update and draw waves in separate passes, don't call update() twice ── */
    for (let i = neuralWaves.length - 1; i >= 0; i--) {
        neuralWaves[i].draw();
        if (!neuralWaves[i].update()) {
            neuralWaves.splice(i, 1);
        }
    }

    particles.forEach(p => p.update());
    drawConnections();
    particles.forEach(p => p.draw());

    dataStreams.forEach(stream => {
        stream.update();
        stream.draw();
    });

    if (Math.random() < 0.02) {
        const activeNode = particles[Math.floor(Math.random() * particles.length)];
        neuralWaves.push(new NeuralWave(activeNode.x, activeNode.y));
    }

    if (dataStreams.length < 20 && Math.random() < 0.01) {
        const start = particles[Math.floor(Math.random() * particles.length)];
        const end = particles[Math.floor(Math.random() * particles.length)];
        if (start !== end) {
            dataStreams.push(new DataStream(start, end));
        }
    }

    if (neuralWaves.length > 10) {
        neuralWaves.splice(0, neuralWaves.length - 10);
    }

    animationId = requestAnimationFrame(animate);
}

export { initBackground };