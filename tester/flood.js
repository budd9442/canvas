const axios = require('axios');
const io = require('socket.io-client');
const { randomBytes } = require('crypto');
const { Jimp } = require('jimp');

// CONFIGURATION
const TARGET_HOST = 'https://canvas.budd.codes';
const CONCURRENCY = 30;
const CANVAS_ID = 'default';
const IMG_URL = process.argv[2] || 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg';

const randStr = (len = 8) => randomBytes(len).toString('hex');

let SHARED_IMAGE = null;
let IMG_W = 0;
let IMG_H = 0;

class ImageBot {
  constructor(id) {
    this.id = id;
    this.username = `painter_${randStr(4)}`;
    this.password = 'password123';
    this.token = null;
    this.socket = null;
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
        this.startPainting();
      });

    } catch (err) {
      setTimeout(() => this.start(), 5000);
    }
  }

  startPainting() {
    const paint = () => {
      if (!this.socket || !this.socket.connected) {
        setTimeout(paint, 100);
        return;
      }

      const stroke = this.generateStroke();
      if (stroke) {
        this.socket.emit('draw_stroke', { canvasId: CANVAS_ID, stroke: stroke });
      }
      setImmediate(paint);
    };
    paint();
  }

  generateStroke() {
    if (!SHARED_IMAGE) return null;

    const x = Math.floor(Math.random() * IMG_W);
    const y = Math.floor(Math.random() * IMG_H);

    // Jimp v1: getPixelColor might be different or same.
    // Try standard way. If this fails, we catch it inside loop? No, this is sync.
    // Documentation says for v1: image.getPixelColor(x, y) returns hex number.
    // intToRGBA still exists on Jimp class? Or utils?
    // Let's use simple bit shifting if helper fails, but let's try helper.
    let color = 'rgba(0,0,0,1)';
    try {
      const hex = SHARED_IMAGE.getPixelColor(x, y);
      // intToRGBA: {r, g, b, a}
      const r = (hex >>> 24) & 0xFF; // Jimp hex is usually R G B A? Or 0xRRGGBBAA?
      // Actually Jimp returns 0xRRGGBBAA.
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
      senderSocketId: this.socket.id
    };
  }
}

async function main() {
  console.log(`🖼️  Loading Image: ${IMG_URL}`);
  try {
    const image = await Jimp.read(IMG_URL);

    // Fix: Use object syntax for resize in Jimp v1
    image.resize({ w: 800, h: 600 });

    SHARED_IMAGE = image;
    IMG_W = 800; // image.bitmap.width;
    IMG_H = 600; // image.bitmap.height;
    console.log(`✅ Image Loaded (${IMG_W}x${IMG_H}). Launching ${CONCURRENCY} Painter Bots...`);


    // ... inside main ...
    let totalStrokesSent = 0;

    // Graceful Exit
    process.on('SIGINT', () => {
      console.log(`\n🛑 Interrupted! Total Strokes Sent Attempted: ${totalStrokesSent.toLocaleString()}`);
      process.exit(0);
    });

    console.log(`✅ Image Loaded (${IMG_W}x${IMG_H}). Launching ${CONCURRENCY} Painter Bots...`);

    for (let i = 0; i < CONCURRENCY; i++) {
      const bot = new ImageBot(i);
      // HACK: attach global counter increment to bot's paint method or emit
      // We can modify ImageBot or just increment here if we passed a callback.
      // Let's modify ImageBot prototype or instance.
      bot._originalEmit = bot.socket ? bot.socket.emit : null;
      // Wait, socket is created in start().

      // Easier: Modifying ImageBot class to increment global.

      setTimeout(() => bot.start(), i * 20);
    }
  } catch (err) {
    //...
  }
}

// Modify ImageBot.generateStroke to increment global counter
const originalGenerate = ImageBot.prototype.generateStroke;
// We can't easily hook into generateStroke because it returns data.
// We can hook into the 'paint' loop inside ImageBot?
// Actually simpler: Just increment a global variable from inside the class if we can.
// But class is defined above.
// I will rewrite the class method startPainting to increment the counter.

ImageBot.prototype.startPainting = function () {
  const paint = () => {
    if (!this.socket || !this.socket.connected) {
      setTimeout(paint, 100);
      return;
    }

    // Rate Limiting: 100 RPS total / 50 bots = 2 RPS per bot = 500ms delay
    const RATE_LIMIT_DELAY = 50;

    const stroke = this.generateStroke();
    if (stroke) {
      this.socket.emit('draw_stroke', { canvasId: CANVAS_ID, stroke: stroke });
      if (global.totalStrokesSent !== undefined) global.totalStrokesSent++;
    }

    // Throttle loop
    setTimeout(paint, RATE_LIMIT_DELAY);
  };
  paint();
};

global.totalStrokesSent = 0;

process.on('SIGINT', () => {
  console.log(`\n🛑 Interrupted! Total Strokes Sent Attempted: ${global.totalStrokesSent.toLocaleString()}`);
  process.exit(0);
});

main();
