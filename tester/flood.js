const axios = require('axios');
const io = require('socket.io-client');
const { randomBytes } = require('crypto');

// CONFIGURATION
const TARGET_HOST = 'canvas.budd.codes'; // Backend URL (Direct or via Ingress)
const CONCURRENCY = 20; // Number of "Artists"
const CANVAS_ID = 'default';

// Color Palette (Vibrant)
const COLORS = [
  '#FF5733', '#33FF57', '#3357FF', '#FF33A1', '#33FFF5',
  '#F533FF', '#FFFF33', '#FF8C33', '#8C33FF', '#33FF8C',
  '#00d2ff', '#3a7bd5', '#f12711', '#f5af19', '#654ea3'
];

// Helper: Random string
const randStr = (len = 8) => randomBytes(len).toString('hex');

// Helper: Random int
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

class ArtBot {
  constructor(id) {
    this.id = id;
    this.username = `artist_${randStr(4)}`;
    this.password = 'password123';
    this.token = null;
    this.socket = null;
    this.color = COLORS[randInt(0, COLORS.length - 1)];
    this.mode = randInt(0, 3); // 0: Spiral, 1: Wave, 2: Random Walk, 3: Burst
    this.x = randInt(100, 700);
    this.y = randInt(100, 500);
    this.angle = 0;
    this.radius = 0;
  }

  async start() {
    try {
      console.log(`[Bot ${this.id}] Registering as ${this.username}...`);

      // 1. Register
      try {
        await axios.post(`${TARGET_HOST}/api/auth/register`, {
          username: this.username,
          password: this.password
        });
      } catch (e) {
        // Ignore if exists
      }

      // 2. Login
      const res = await axios.post(`${TARGET_HOST}/api/auth/login`, {
        username: this.username,
        password: this.password
      });

      this.token = res.data.token;
      console.log(`[Bot ${this.id}] Logged in. Connecting socket...`);

      // 3. Connect Socket
      this.socket = io(TARGET_HOST, {
        auth: { token: this.token },
        transports: ['websocket']
      });

      this.socket.on('connect', () => {
        console.log(`[Bot ${this.id}] Connected! Joining canvas...`);
        this.socket.emit('join_canvas', CANVAS_ID);
        this.startPainting();
      });

      this.socket.on('error', (err) => {
        console.error(`[Bot ${this.id}] Socket Error:`, err);
      });

      this.socket.on('disconnect', () => {
        console.log(`[Bot ${this.id}] Disconnected.`);
      });

    } catch (err) {
      console.error(`[Bot ${this.id}] Setup Failed:`, err.message);
    }
  }

  startPainting() {
    // Paint loop
    const interval = randInt(100, 500); // Speed variation

    setInterval(() => {
      if (!this.socket || !this.socket.connected) return;

      const stroke = this.generateStroke();
      if (stroke) {
        this.socket.emit('draw_stroke', {
          canvasId: CANVAS_ID,
          stroke: stroke
        });
      }
    }, interval);
  }

  generateStroke() {
    let nextX, nextY;

    // Algorithmic Movement
    switch (this.mode) {
      case 0: // Spiral
        this.angle += 0.2;
        this.radius += 0.5;
        nextX = 400 + Math.cos(this.angle) * this.radius;
        nextY = 300 + Math.sin(this.angle) * this.radius;
        break;

      case 1: // Sine Wave
        this.x += 5;
        if (this.x > 800) this.x = 0;
        nextX = this.x;
        nextY = 300 + Math.sin(this.x * 0.05) * 100 + (this.id * 10);
        break;

      case 2: // Random Walk
        nextX = this.x + randInt(-20, 20);
        nextY = this.y + randInt(-20, 20);
        break;

      case 3: // Burst / Star
        nextX = 400 + randInt(-300, 300);
        nextY = 300 + randInt(-300, 300);
        // Reset to center periodically
        if (Math.random() > 0.9) { this.x = 400; this.y = 300; }
        break;
    }

    // Keep bounds roughly
    nextX = Math.max(0, Math.min(800, nextX));
    nextY = Math.max(0, Math.min(600, nextY));

    // Construct Fabric-like path object (simulating a line segment)
    // Real fabric uses "M x y L x y"
    const pathData = `M ${this.x} ${this.y} L ${nextX} ${nextY}`;

    const strokeObj = {
      type: 'path',
      path: [['M', this.x, this.y], ['L', nextX, nextY]], // Simplified fabric path array
      stroke: this.color,
      strokeWidth: randInt(2, 5),
      fill: null,
      selectable: false,
      evented: false,
      originX: 'left',
      originY: 'top',
      left: Math.min(this.x, nextX), // Bounding box approx
      top: Math.min(this.y, nextY),
      width: Math.abs(nextX - this.x),
      height: Math.abs(nextY - this.y)
    };

    // Update state
    this.x = nextX;
    this.y = nextY;

    return strokeObj;
  }
}

// --- MAIN ---
console.log(`🎨 Starting Art Attack with ${CONCURRENCY} bots...`);
for (let i = 0; i < CONCURRENCY; i++) {
  setTimeout(() => {
    new ArtBot(i).start();
  }, i * 100); // Stagger start
}
