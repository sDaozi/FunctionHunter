/**
 * 沙盒练习
 * 自由输入函数或几何形状，看图像
 */
const Practice = {
  canvas: null,
  ctx: null,
  curves: [],   // [{ expr, shape, color }]
  preview: null,  // { shape, expr } | null
  running: false,

  COLORS: ['#5dffd6', '#7a8cff', '#ff5577', '#ffaa33', '#b88dff', '#6dffaa', '#ffe066', '#ff8c5d'],

  init() {
    this.canvas = document.getElementById('practice-canvas');
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    Coords.resetPan();

    this.curves = [];
    this.preview = null;

    this._bindEvents();
    this.running = true;
    this._loop();
  },

  _bindEvents() {
    if (this._bound) return;
    this._bound = true;

    const input = document.getElementById('practice-input');
    const inputPrompt = input.previousElementSibling;  // <span class="input-prompt">
    const updatePromptVisibility = (expr) => {
      if (!inputPrompt) return;
      inputPrompt.classList.toggle('hidden', expr.includes('='));
    };

    input.addEventListener('input', () => {
      const expr = input.value.trim();
      updatePromptVisibility(expr);
      if (!expr) {
        this.preview = null;
        document.getElementById('practice-error').textContent = '';
        return;
      }
      const { shape, error } = Shape.compile(expr);
      this.preview = shape ? { shape, expr } : null;
      document.getElementById('practice-error').textContent = error || '';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._addCurve();
      }
    });

    document.getElementById('practice-clear').addEventListener('click', () => {
      this.curves = [];
      input.value = '';
      this.preview = null;
      document.getElementById('practice-error').textContent = '';
      updatePromptVisibility('');
      this._renderHistory();
    });

    document.querySelectorAll('[data-practice-snippet]').forEach(tag => {
      tag.addEventListener('click', () => {
        input.value = tag.dataset.practiceSnippet;
        input.dispatchEvent(new Event('input'));
        input.focus();
      });
    });

    window.addEventListener('resize', () => this._resize());

    // 拖动平移
    this._bindDrag();

    // R 键重置视野
    document.addEventListener('keydown', (e) => {
      if (!document.getElementById('screen-practice').classList.contains('active')) return;
      if ((e.key === 'r' || e.key === 'R') && document.activeElement !== input) {
        Coords.resetPan();
      }
    });
  },

  _bindDrag() {
    const canvas = this.canvas;
    let dragging = false;
    let lastX = 0, lastY = 0;
    canvas.addEventListener('mousedown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      Coords.pan(dx, dy);
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('dblclick', () => Coords.resetPan());
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (dragging && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - lastX;
        const dy = e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        Coords.pan(dx, dy);
      }
    }, { passive: false });
    canvas.addEventListener('touchend', () => { dragging = false; });

    // 滚轮缩放
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      const step = 1.12;
      const factor = e.deltaY > 0 ? 1 / step : step;
      Coords.zoomBy(factor, ax, ay);
    }, { passive: false });
  },

  _resize() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    Coords.setCanvas({ width: rect.width, height: rect.height });
  },

  _addCurve() {
    if (!this.preview) return;
    const color = this.COLORS[this.curves.length % this.COLORS.length];
    this.curves.push({ expr: this.preview.expr, shape: this.preview.shape, color });
    const input = document.getElementById('practice-input');
    input.value = '';
    this.preview = null;
    document.getElementById('practice-error').textContent = '';
    // 恢复 y= 提示
    const inputPrompt = input.previousElementSibling;
    if (inputPrompt) inputPrompt.classList.remove('hidden');
    this._renderHistory();
  },

  _renderHistory() {
    const div = document.getElementById('practice-history');
    div.innerHTML = this.curves.map((c, i) => {
      // 几何形状不加 y= 前缀
      const prefix = c.expr.includes('=') ? '' : 'y = ';
      return `
        <span class="history-item">
          <span class="swatch" style="background:${c.color}"></span>
          ${prefix}${c.expr}
          <span class="remove" data-idx="${i}" title="删除">×</span>
        </span>
      `;
    }).join('');
    div.querySelectorAll('.remove').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        this.curves.splice(idx, 1);
        this._renderHistory();
      });
    });
  },

  stop() {
    this.running = false;
  },

  _loop() {
    if (!this.running) return;
    if (!document.getElementById('screen-practice').classList.contains('active')) {
      this.running = false;
      return;
    }
    this._render();
    requestAnimationFrame(() => this._loop());
  },

  _getViewport() {
    return {
      xRange: Coords.visibleXRange(),
      yRange: Coords.visibleYRange(),
      samples: 600,
    };
  },

  _render() {
    const ctx = this.ctx;
    const W = Coords.W;
    const H = Coords.H;

    ctx.clearRect(0, 0, W, H);

    // 背景
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#050a14');
    grad.addColorStop(1, '#0a1424');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    this._drawGrid();

    // 已加入的曲线
    const view = this._getViewport();
    for (const c of this.curves) {
      const paths = c.shape.sample(view).paths;
      this._drawPaths(paths, { color: c.color, width: 2.5, glow: 8 });
    }

    // 预览
    if (this.preview) {
      const paths = this.preview.shape.sample(view).paths;
      this._drawPaths(paths, {
        color: 'rgba(93, 255, 214, 0.65)',
        width: 2,
        glow: 8,
        dashed: true
      });
    }

    // 原点标记
    const o = Coords.toScreen(0, 0);
    if (o.x >= 0 && o.x <= Coords.W && o.y >= 0 && o.y <= Coords.H) {
      ctx.save();
      ctx.fillStyle = '#5dffd6';
      ctx.shadowColor = '#5dffd6';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },

  _drawGrid() {
    const ctx = this.ctx;
    const [xMin, xMax] = Coords.visibleXRange();
    const [yMin, yMax] = Coords.visibleYRange();
    const xLo = Math.floor(xMin);
    const xHi = Math.ceil(xMax);
    const yLo = Math.floor(yMin);
    const yHi = Math.ceil(yMax);

    ctx.save();
    ctx.lineWidth = 1;

    ctx.strokeStyle = 'rgba(120, 180, 255, 0.07)';
    ctx.beginPath();
    for (let x = xLo; x <= xHi; x++) {
      const p = Coords.toScreen(x, 0);
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, Coords.H);
    }
    for (let y = yLo; y <= yHi; y++) {
      const p = Coords.toScreen(0, y);
      ctx.moveTo(0, p.y);
      ctx.lineTo(Coords.W, p.y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(120, 180, 255, 0.18)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = Math.floor(xLo / 5) * 5; x <= xHi; x += 5) {
      const p = Coords.toScreen(x, 0);
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, Coords.H);
    }
    for (let y = Math.floor(yLo / 5) * 5; y <= yHi; y += 5) {
      const p = Coords.toScreen(0, y);
      ctx.moveTo(0, p.y);
      ctx.lineTo(Coords.W, p.y);
    }
    ctx.stroke();

    // 坐标轴
    ctx.strokeStyle = 'rgba(93, 255, 214, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const o = Coords.toScreen(0, 0);
    ctx.moveTo(0, o.y);
    ctx.lineTo(Coords.W, o.y);
    ctx.moveTo(o.x, 0);
    ctx.lineTo(o.x, Coords.H);
    ctx.stroke();

    // 刻度
    ctx.fillStyle = 'rgba(165, 180, 204, 0.7)';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    for (let x = xLo; x <= xHi; x++) {
      if (x === 0) continue;
      if (x % 5 !== 0 && Math.abs(x) > 5) continue;
      const p = Coords.toScreen(x, 0);
      const labelY = Math.min(o.y + 14, Coords.H - 4);
      ctx.fillText(x.toString(), p.x, labelY);
    }
    ctx.textAlign = 'left';
    for (let y = yLo; y <= yHi; y++) {
      if (y === 0) continue;
      if (y % 5 !== 0 && y > 5) continue;
      const p = Coords.toScreen(0, y);
      const labelX = Math.max(o.x + 4, 4);
      ctx.fillText(y.toString(), labelX, p.y + 4);
    }

    ctx.restore();
  },

  /**
   * 通用 polyline 绘制：接受 paths（多段折线，数学坐标）
   * 自动跳过远超视野的点
   */
  _drawPaths(paths, opts) {
    const ctx = this.ctx;
    const [yMin, yMax] = Coords.visibleYRange();
    ctx.save();
    if (opts.glow) {
      ctx.shadowColor = opts.color;
      ctx.shadowBlur = opts.glow;
    }
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = opts.width || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (opts.dashed) ctx.setLineDash([4, 6]);

    for (const path of paths) {
      let pathOpen = false;
      ctx.beginPath();
      for (const pt of path) {
        if (!isFinite(pt.x) || !isFinite(pt.y)) {
          if (pathOpen) { ctx.stroke(); ctx.beginPath(); pathOpen = false; }
          continue;
        }
        if (pt.y < yMin - 20 || pt.y > yMax + 20) {
          if (pathOpen) { ctx.stroke(); ctx.beginPath(); pathOpen = false; }
          continue;
        }
        const sp = Coords.toScreen(pt.x, pt.y);
        if (!pathOpen) { ctx.moveTo(sp.x, sp.y); pathOpen = true; }
        else { ctx.lineTo(sp.x, sp.y); }
      }
      if (pathOpen) ctx.stroke();
    }
    ctx.restore();
  },
};
