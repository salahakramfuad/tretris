/*
  Tetris - Vanilla JS + Canvas
  Features:
  - 7-bag randomizer
  - Ghost piece
  - Next piece preview
  - Score / Lines / Level + increasing speed
  - Hard drop + soft drop
  - Rounded blocks + playful colors
  - Sound effects (Web Audio) + mute
  - Dark mode + saved high score
*/

(() => {
  'use strict';

  // --- DOM ---
  const gameCanvas = document.getElementById('game');
  const ctx = gameCanvas.getContext('2d');

  const nextCanvas = document.getElementById('next');
  const nextCtx = nextCanvas.getContext('2d');

  const overlayEl = document.getElementById('overlay');

  const scoreEl = document.getElementById('score');
  const linesEl = document.getElementById('lines');
  const levelEl = document.getElementById('level');
  const highScoreEl = document.getElementById('highScore');

  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');

  const darkToggle = document.getElementById('darkToggle');
  const muteToggle = document.getElementById('muteToggle');

  // --- Game constants ---
  const COLS = 10;
  const ROWS = 20;
  const BLOCK = 30; // internal pixel size per block (canvas is 300x600)

  // Nice outline + shine amounts.
  const GRID_LINE_ALPHA = 0.08;
  const BLOCK_RADIUS = 7;
  const BLOCK_BORDER_ALPHA = 0.22;

  // Scoring: classic-ish (multiplied by level).
  const LINE_SCORES = {
    1: 40,
    2: 100,
    3: 300,
    4: 1200,
  };

  const STORAGE_KEYS = {
    highScore: 'tetris_highScore_v1',
    darkMode: 'tetris_darkMode_v1',
    muted: 'tetris_muted_v1',
  };

  // --- Tetrominoes (4x4 matrices) ---
  // 1 = block
  const TETROMINOES = {
    I: {
      color: '#00d2ff',
      matrix: [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
    O: {
      color: '#ffd400',
      matrix: [
        [0, 1, 1, 0],
        [0, 1, 1, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
    T: {
      color: '#b45cff',
      matrix: [
        [0, 1, 0, 0],
        [1, 1, 1, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
    S: {
      color: '#1ee37a',
      matrix: [
        [0, 1, 1, 0],
        [1, 1, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
    Z: {
      color: '#ff4d4d',
      matrix: [
        [1, 1, 0, 0],
        [0, 1, 1, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
    J: {
      color: '#3b7bff',
      matrix: [
        [1, 0, 0, 0],
        [1, 1, 1, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
    L: {
      color: '#ff9f1a',
      matrix: [
        [0, 0, 1, 0],
        [1, 1, 1, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
  };

  const TYPES = Object.keys(TETROMINOES);

  // --- State ---
  let board = makeMatrix(ROWS, COLS, null);
  let current = null;
  let next = null;

  let score = 0;
  let lines = 0;
  let level = 1;
  let highScore = Number(localStorage.getItem(STORAGE_KEYS.highScore) || 0);

  let running = false;
  let paused = false;
  let gameOver = false;

  // Timing
  let dropCounter = 0;
  let lastTime = 0;
  let dropInterval = 900; // ms, adjusted by level

  // Effects
  let flashTimer = 0; // used for line-clear flash

  // --- Sound (Web Audio) ---
  let audioCtx = null;
  let muted = localStorage.getItem(STORAGE_KEYS.muted) === '1';

  function ensureAudio() {
    if (audioCtx) return;
    // Create lazily on first user gesture.
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function beep({ freq = 440, duration = 0.06, type = 'sine', gain = 0.07 }) {
    if (muted) return;
    ensureAudio();
    const t0 = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(g);
    g.connect(audioCtx.destination);

    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function sfxPlace() {
    beep({ freq: 220, duration: 0.055, type: 'triangle', gain: 0.06 });
  }

  function sfxLine() {
    // Little "sparkle".
    beep({ freq: 660, duration: 0.05, type: 'square', gain: 0.05 });
    setTimeout(() => beep({ freq: 880, duration: 0.05, type: 'square', gain: 0.045 }), 25);
  }

  function sfxGameOver() {
    beep({ freq: 220, duration: 0.12, type: 'sawtooth', gain: 0.05 });
    setTimeout(() => beep({ freq: 165, duration: 0.18, type: 'sawtooth', gain: 0.05 }), 120);
  }

  // --- Helpers ---
  function makeMatrix(h, w, fill) {
    return Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
  }

  function cloneMatrix(m) {
    return m.map((row) => row.slice());
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 7-bag generator
  let bag = [];
  function takeFromBag() {
    if (bag.length === 0) {
      bag = shuffleInPlace(TYPES.slice());
    }
    return bag.pop();
  }

  function createPiece(type) {
    const def = TETROMINOES[type];
    const matrix = cloneMatrix(def.matrix);
    return {
      type,
      matrix,
      color: def.color,
      x: Math.floor(COLS / 2) - 2,
      y: -1, // spawn slightly above
    };
  }

  function collide(b, piece) {
    const { matrix, x: px, y: py } = piece;
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const bx = px + x;
        const by = py + y;

        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        if (by < 0) continue; // allow above-top
        if (b[by][bx]) return true;
      }
    }
    return false;
  }

  function merge(b, piece) {
    const { matrix, x: px, y: py, color } = piece;
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const by = py + y;
        const bx = px + x;
        if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) {
          b[by][bx] = color;
        }
      }
    }
  }

  function rotateClockwise(matrix) {
    const N = matrix.length;
    const res = makeMatrix(N, N, 0);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        res[x][N - 1 - y] = matrix[y][x];
      }
    }
    return res;
  }

  function tryRotate(piece) {
    const original = piece.matrix;
    const rotated = rotateClockwise(original);

    piece.matrix = rotated;

    // Simple wall kicks: try shifting sideways if rotation collides.
    const kicks = [0, -1, 1, -2, 2];
    const ox = piece.x;
    for (const dx of kicks) {
      piece.x = ox + dx;
      if (!collide(board, piece)) return true;
    }

    // Revert
    piece.x = ox;
    piece.matrix = original;
    return false;
  }

  function clearLines() {
    let cleared = 0;

    outer: for (let y = ROWS - 1; y >= 0; y--) {
      for (let x = 0; x < COLS; x++) {
        if (!board[y][x]) continue outer;
      }
      // Row full
      board.splice(y, 1);
      board.unshift(Array.from({ length: COLS }, () => null));
      cleared++;
      y++; // re-check same y (since rows shifted)
    }

    if (cleared > 0) {
      lines += cleared;
      const add = (LINE_SCORES[cleared] || 0) * level;
      score += add;

      // Level progression: every 10 lines.
      const newLevel = Math.floor(lines / 10) + 1;
      if (newLevel !== level) level = newLevel;

      // Speed up: decreasing interval.
      dropInterval = Math.max(90, 900 - (level - 1) * 70);

      flashTimer = 9; // frames
      sfxLine();
      pulseUI();
    }
  }

  function pulseUI() {
    document.body.classList.remove('pop');
    // Force reflow for repeated triggers.
    void document.body.offsetWidth;
    document.body.classList.add('pop');
    setTimeout(() => document.body.classList.remove('pop'), 260);
  }

  function computeGhost(piece) {
    const ghost = { ...piece, matrix: piece.matrix };
    while (!collide(board, { ...ghost, y: ghost.y + 1 })) {
      ghost.y++;
    }
    return ghost;
  }

  function dropOne() {
    current.y++;
    if (collide(board, current)) {
      current.y--;
      lockPiece();
      return true;
    }
    return false;
  }

  function lockPiece() {
    merge(board, current);
    sfxPlace();

    clearLines();

    // Spawn next
    current = next;
    next = createPiece(takeFromBag());

    // If spawn collides, game over.
    if (collide(board, current)) {
      setGameOver();
    }

    drawNext();
    updateHUD();
  }

  function hardDrop() {
    let dist = 0;
    while (!collide(board, { ...current, y: current.y + 1 })) {
      current.y++;
      dist++;
    }
    // Hard drop score bonus
    score += dist * 2;
    lockPiece();
  }

  function softDrop() {
    // Give a tiny score for soft dropping.
    const locked = dropOne();
    if (!locked) score += 1;
    updateHUD();
  }

  // --- Drawing ---
  function clearCanvas(context, canvas) {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawRoundedRect(context, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + rr, y);
    context.arcTo(x + w, y, x + w, y + h, rr);
    context.arcTo(x + w, y + h, x, y + h, rr);
    context.arcTo(x, y + h, x, y, rr);
    context.arcTo(x, y, x + w, y, rr);
    context.closePath();
  }

  function shade(hex, amt) {
    // Tiny helper to lighten/darken hex colors.
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function drawCell(context, x, y, color, { alpha = 1, ghost = false } = {}) {
    const px = x * BLOCK;
    const py = y * BLOCK;

    context.save();
    context.globalAlpha = alpha;

    // Base
    drawRoundedRect(context, px + 2, py + 2, BLOCK - 4, BLOCK - 4, BLOCK_RADIUS);
    context.fillStyle = ghost ? 'rgba(255,255,255,0.08)' : color;
    context.fill();

    // Inner highlight
    drawRoundedRect(context, px + 5, py + 5, BLOCK - 10, BLOCK - 10, BLOCK_RADIUS - 2);
    context.fillStyle = ghost ? 'rgba(255,255,255,0.05)' : shade(color, 35);
    context.fill();

    // Border
    drawRoundedRect(context, px + 2, py + 2, BLOCK - 4, BLOCK - 4, BLOCK_RADIUS);
    context.strokeStyle = `rgba(0,0,0,${BLOCK_BORDER_ALPHA})`;
    context.lineWidth = 2;
    context.stroke();

    context.restore();
  }

  function drawGrid(context) {
    context.save();
    context.globalAlpha = GRID_LINE_ALPHA;
    context.strokeStyle = '#000';
    context.lineWidth = 1;

    for (let x = 1; x < COLS; x++) {
      context.beginPath();
      context.moveTo(x * BLOCK, 0);
      context.lineTo(x * BLOCK, ROWS * BLOCK);
      context.stroke();
    }

    for (let y = 1; y < ROWS; y++) {
      context.beginPath();
      context.moveTo(0, y * BLOCK);
      context.lineTo(COLS * BLOCK, y * BLOCK);
      context.stroke();
    }

    context.restore();
  }

  function drawMatrix(context, matrix, offsetX, offsetY, color, opts = {}) {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const by = offsetY + y;
        const bx = offsetX + x;
        if (by < 0) continue;
        drawCell(context, bx, by, color, opts);
      }
    }
  }

  function drawBoard() {
    clearCanvas(ctx, gameCanvas);

    // Board background flash on line clear
    if (flashTimer > 0) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
      ctx.restore();
      flashTimer--;
    }

    // Placed blocks
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = board[y][x];
        if (cell) drawCell(ctx, x, y, cell);
      }
    }

    // Grid on top
    drawGrid(ctx);

    if (!current) return;

    // Ghost piece first
    const ghost = computeGhost(current);
    drawMatrix(ctx, ghost.matrix, ghost.x, ghost.y, current.color, { alpha: 0.33, ghost: true });

    // Current piece
    drawMatrix(ctx, current.matrix, current.x, current.y, current.color);
  }

  function drawNext() {
    clearCanvas(nextCtx, nextCanvas);

    // Render next piece centered in a 4x4 at 30px blocks, scaled down.
    const previewBlock = 24;
    const pad = 10;

    nextCtx.save();
    nextCtx.translate(pad, pad);

    // Background
    nextCtx.globalAlpha = 0.15;
    nextCtx.fillStyle = '#000';
    nextCtx.fillRect(0, 0, nextCanvas.width - pad * 2, nextCanvas.height - pad * 2);
    nextCtx.globalAlpha = 1;

    if (!next) {
      nextCtx.restore();
      return;
    }

    // Find bounds to center nicely
    const m = next.matrix;
    let minX = 4, minY = 4, maxX = -1, maxY = -1;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (!m[y][x]) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const w = (maxX - minX + 1) * previewBlock;
    const h = (maxY - minY + 1) * previewBlock;
    const centerX = (nextCanvas.width - pad * 2 - w) / 2;
    const centerY = (nextCanvas.height - pad * 2 - h) / 2;

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (!m[y][x]) continue;
        const px = centerX + (x - minX) * previewBlock;
        const py = centerY + (y - minY) * previewBlock;

        // Rounded preview block
        nextCtx.save();
        drawRoundedRect(nextCtx, px + 2, py + 2, previewBlock - 4, previewBlock - 4, 7);
        nextCtx.fillStyle = next.color;
        nextCtx.fill();
        drawRoundedRect(nextCtx, px + 2, py + 2, previewBlock - 4, previewBlock - 4, 7);
        nextCtx.strokeStyle = 'rgba(0,0,0,0.22)';
        nextCtx.lineWidth = 2;
        nextCtx.stroke();
        nextCtx.restore();
      }
    }

    nextCtx.restore();
  }

  function updateHUD() {
    scoreEl.textContent = String(score);
    linesEl.textContent = String(lines);
    levelEl.textContent = String(level);

    if (score > highScore) {
      highScore = score;
      localStorage.setItem(STORAGE_KEYS.highScore, String(highScore));
    }
    highScoreEl.textContent = String(highScore);
  }

  function setOverlay(text) {
    overlayEl.textContent = text;
    overlayEl.classList.add('show');
  }

  function clearOverlay() {
    overlayEl.textContent = '';
    overlayEl.classList.remove('show');
  }

  function setGameOver() {
    running = false;
    paused = false;
    gameOver = true;
    setOverlay(`Game Over\nScore: ${score}`);
    sfxGameOver();

    pauseBtn.disabled = true;
    startBtn.disabled = false;
    restartBtn.disabled = false;

    updateHUD();
  }

  // --- Main loop ---
  function update(time = 0) {
    const delta = time - lastTime;
    lastTime = time;

    if (running && !paused && !gameOver) {
      dropCounter += delta;
      if (dropCounter >= dropInterval) {
        dropOne();
        dropCounter = 0;
      }
    }

    drawBoard();
    requestAnimationFrame(update);
  }

  // --- Control actions ---
  function move(dx) {
    current.x += dx;
    if (collide(board, current)) current.x -= dx;
  }

  function startNewGame() {
    board = makeMatrix(ROWS, COLS, null);

    score = 0;
    lines = 0;
    level = 1;
    dropInterval = 900;

    bag = [];
    current = createPiece(takeFromBag());
    next = createPiece(takeFromBag());

    running = true;
    paused = false;
    gameOver = false;
    dropCounter = 0;

    clearOverlay();
    drawNext();
    updateHUD();

    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = false;
    restartBtn.disabled = false;
    startBtn.disabled = true;
  }

  function togglePause() {
    if (!running || gameOver) return;
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    if (paused) setOverlay('Paused');
    else clearOverlay();
  }

  function onKeyDown(e) {
    // Initialize audio on any key interaction (browser policies).
    ensureAudio();

    if (e.code === 'Space') e.preventDefault();

    if (!running) {
      // Allow quick start
      if (e.code === 'Space' || e.code === 'Enter') {
        startNewGame();
      }
      return;
    }

    if (gameOver) return;

    if (e.code === 'KeyP') {
      togglePause();
      return;
    }

    if (paused) return;

    switch (e.code) {
      case 'ArrowLeft':
        move(-1);
        break;
      case 'ArrowRight':
        move(1);
        break;
      case 'ArrowDown':
        softDrop();
        break;
      case 'ArrowUp':
        if (!e.repeat) tryRotate(current);
        break;
      case 'Space':
        if (!e.repeat) hardDrop();
        break;
      default:
        break;
    }
  }

  // --- Toggles ---
  function applyDarkMode(enabled) {
    document.body.classList.toggle('dark', enabled);
    darkToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    darkToggle.textContent = enabled ? 'Light' : 'Dark';
    localStorage.setItem(STORAGE_KEYS.darkMode, enabled ? '1' : '0');
  }

  function applyMuted(isMuted) {
    muted = isMuted;
    muteToggle.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteToggle.textContent = muted ? 'Muted' : 'Sound';
    localStorage.setItem(STORAGE_KEYS.muted, muted ? '1' : '0');
  }

  // --- Init ---
  function init() {
    // Ensure crisp internal resolution.
    gameCanvas.width = COLS * BLOCK;
    gameCanvas.height = ROWS * BLOCK;

    highScoreEl.textContent = String(highScore);

    // Restore toggles
    const dark = localStorage.getItem(STORAGE_KEYS.darkMode) === '1';
    applyDarkMode(dark);
    applyMuted(muted);

    startBtn.addEventListener('click', () => {
      ensureAudio();
      startNewGame();
    });

    pauseBtn.addEventListener('click', () => {
      ensureAudio();
      togglePause();
    });

    restartBtn.addEventListener('click', () => {
      ensureAudio();
      startNewGame();
    });

    darkToggle.addEventListener('click', () => {
      applyDarkMode(!document.body.classList.contains('dark'));
    });

    muteToggle.addEventListener('click', () => {
      applyMuted(!muted);
    });

    document.addEventListener('keydown', onKeyDown);

    // Idle screen
    setOverlay('Press Start (or Space)');

    // Start render loop
    requestAnimationFrame(update);
  }

  init();
})();
