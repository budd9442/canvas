const axios = require('axios');
const io = require('socket.io-client');
const { randomBytes } = require('crypto');
const { Jimp } = require('jimp');

// CONFIGURATION
const TARGET_HOST = process.env.TARGET_HOST || 'http://k8s-default-painting-4f51e3beb2-618512250.ap-southeast-1.elb.amazonaws.com';
const CONCURRENCY = parseInt(process.env.CONCURRENCY) || 100;
const PAINT_INTERVAL = parseInt(process.env.INTERVAL) || 20;  // 20ms = 50 strokes per second per bot
const CANVAS_ID = 'default';
const IMG_URL = process.argv[2] || 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg';

const randStr = (len = 8) => randomBytes(len).toString('hex');

let SHARED_IMAGE = null;
let IMG_W = 0;
let IMG_H = 0;

// Global Stats
global.totalStrokesSent = 0;
global.totalStrokesAcked = 0;

class ImageBot {
  constructor(id) {
    this.id = id;
    this.username = `painter_${randStr(4)}`;
    this.password = 'password123';
    this.token = null;
    this.socket = null;
    this.pendingStrokes = new Map(); // tempId -> stroke
  }

  async start() {
    try {
      try {
        await axios.post(`${TARGET_HOST}/api/auth/register`, { username: this.username, password: this.password });
      } catch (e) { }

      const res = await axios.post(`${TARGET_HOST}/api/auth/login`, { username: this.username, password: this.password });
      this.token = res.data.token;

      this.socket = io(TARGET_HOST, {
        auth: { token: this.token },
        transports: ['websocket'],
        reconnection: true
      });

      this.socket.on('connect', () => {
        this.socket.emit('join_canvas', CANVAS_ID);
        // RESEND PENDING STROKES (Retry Logic)
        if (this.pendingStrokes.size > 0) {
          console.log(`[Bot ${this.id}] Resending ${this.pendingStrokes.size} pending strokes...`);
          for (const [tempId, stroke] of this.pendingStrokes) {
            this.socket.emit('draw_stroke', { canvasId: CANVAS_ID, stroke: stroke });
          }
        }
        if (!this.paintingStarted) {
          this.startPainting();
          this.paintingStarted = true;
        }
      });

      this.socket.on('stroke_ack', (data) => {
        if (data.tempId) {
          if (this.pendingStrokes.has(data.tempId)) {
            this.pendingStrokes.delete(data.tempId);
            global.totalStrokesAcked++;
          }
        }
      });

    } catch (err) {
      setTimeout(() => this.start(), 5000);
    }
  }

  startPainting() {
    const paint = () => {
      // Check Shutdown Flag
      if (global.isShuttingDown) return;

      if (!this.socket || !this.socket.connected) {
        setTimeout(paint, 100);
        return;
      }

      // Backoff if too many pending (flow control)
      if (this.pendingStrokes.size > 500) {
        setTimeout(paint, 100);
        return;
      }

      const stroke = this.generateStroke();
      if (stroke) {
        // Add to Pending
        this.pendingStrokes.set(stroke.tempId, stroke);

        this.socket.emit('draw_stroke', { canvasId: CANVAS_ID, stroke: stroke });
        global.totalStrokesSent++;
      }
      setTimeout(paint, PAINT_INTERVAL);
    };
    paint();
  }

  generateStroke() {
    if (!SHARED_IMAGE) return null;

    const x = Math.floor(Math.random() * IMG_W);
    const y = Math.floor(Math.random() * IMG_H);

    let color = 'rgba(0,0,0,1)';
    try {
      const hex = SHARED_IMAGE.getPixelColor(x, y);
      const r = (hex >>> 24) & 0xFF; // Jimp hex is usually R G B A? Or 0xRRGGBBAA?
      const g = (hex >>> 16) & 0xFF;
      const b = (hex >>> 8) & 0xFF;
      const a = hex & 0xFF;
      color = `rgba(${r},${g},${b},${a / 255})`;
    } catch (e) {
      // console.error(e);
    }

    const len = 4;
    const angle = Math.random() * Math.PI * 2;
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;

    // Add Client-Side ID for tracking
    const tempId = randStr(12);

    return {
      type: 'path',
      path: [['M', x, y], ['L', x2, y2]],
      stroke: color,
      strokeWidth: 4,
      fill: null,
      selectable: false,
      evented: false,
      originX: 'left',
      originY: 'top',
      left: Math.min(x, x2),
      top: Math.min(y, y2),
      width: Math.abs(x2 - x),
      height: Math.abs(y2 - y),
      senderSocketId: this.socket.id,
      tempId: tempId
    };
  }
}

async function main() {
  console.log(`🖼️  Loading Image: ${IMG_URL}`);
  try {
    const image = await Jimp.read(IMG_URL);
    image.resize({ w: 800, h: 600 });

    SHARED_IMAGE = image;
    IMG_W = 800; // image.bitmap.width;
    IMG_H = 600; // image.bitmap.height;

    // Graceful Exit
    // Graceful Exit with Drain
    let shuttingDown = false;
    process.on('SIGINT', () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n🛑 Stopping generation... Draining pending strokes...`);

      // Stop all bots
      // logic handles itself via shuttingDown check in ImageBot? 
      // Need to expose shuttingDown or update ImageBot.
    });

    // We need to inject shuttingDown into bots or check global
    global.isShuttingDown = false;
    process.on('SIGINT', async () => {
      if (global.isShuttingDown) return;
      global.isShuttingDown = true;
      console.log(`\n🛑 Interrupted! Stopping New Strokes... Waiting for Pending ACKs...`);
      console.log(`Sent: ${global.totalStrokesSent}, Acked: ${global.totalStrokesAcked}, Pending: ${global.totalStrokesSent - global.totalStrokesAcked}`);

      // Wait up to 10 seconds for ACKs/Retries
      let retries = 0;
      const checkDone = setInterval(() => {
        const pending = global.totalStrokesSent - global.totalStrokesAcked;
        if (pending <= 0) {
          console.log(`\n✅ SUCCESS: All strokes ACKed!`);
          console.log(`Total Sent: ${global.totalStrokesSent}`);
          console.log(`Total Acked: ${global.totalStrokesAcked}`);
          clearInterval(checkDone);
          process.exit(0);
        }

        retries++;
        if (retries % 10 === 0) console.log(`Waiting... Pending: ${pending}`);

        if (retries > 100) { // 10 seconds (100 * 100ms)
          console.log(`\n⚠️ Start Force Exit (Timeout)`);
          console.log(`Total Sent: ${global.totalStrokesSent}`);
          console.log(`Total Acked: ${global.totalStrokesAcked}`);
          console.log(`Missed: ${pending}`);
          clearInterval(checkDone);
          process.exit(0);
        }
      }, 100);
    });

    console.log(`✅ Image Loaded (${IMG_W}x${IMG_H}). Launching ${CONCURRENCY} Painter Bots...`);

    for (let i = 0; i < CONCURRENCY; i++) {
      const bot = new ImageBot(i);
      setTimeout(() => bot.start(), i * 20);
    }
  } catch (err) {
    console.error(err);
  }
}

main();
