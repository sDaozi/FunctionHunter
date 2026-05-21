/**
 * 坐标系映射
 * 
 * 数学坐标系：
 *   - 原点 (0, 0) 默认在屏幕底部中心
 *   - x 向右为正，y 向上为正
 *   - 视野默认 x ∈ [-XR, XR]，y ∈ [0, YR]
 * 
 * 屏幕坐标系：
 *   - 原点 (0, 0) 在画布左上角
 *   - x 向右为正，y 向下为正
 * 
 * 平移功能：
 *   - panX/panY 是视野中心的数学坐标偏移（数学单位）
 *   - 玩家拖动屏幕时增加 panX/panY，让视野"移动"
 */
const Coords = {
  XR: 10,
  YR: 14,
  YR_BOTTOM: -1,

  // 视野平移（数学坐标偏移）
  panX: 0,
  panY: 0,

  // 视野缩放倍率（1.0 = 默认；>1 放大；<1 缩小）
  zoom: 1,
  ZOOM_MIN: 0.4,
  ZOOM_MAX: 3.0,

  // 平移最大范围
  MAX_PAN_X: 20,
  MAX_PAN_Y: 14,

  /**
   * 设置画布大小（接受 {width, height} 对象，使用 CSS 像素）
   */
  setCanvas(canvasOrSize) {
    this.W = canvasOrSize.width;
    this.H = canvasOrSize.height;
    this._calcScale();
  },

  /**
   * 计算合适的 px/单位
   * baseScale 是默认视野（XR/YR）下的 px-per-unit；最终 scale = baseScale * zoom
   * 这样所有下游 toScreen/visibleXRange 等无需改动，自动跟随 zoom
   */
  _calcScale() {
    const scaleX = this.W / (2 * this.XR);
    const scaleY = this.H / (this.YR - this.YR_BOTTOM);
    this.baseScale = Math.min(scaleX, scaleY);
    this.scale = this.baseScale * this.zoom;
    this.visibleXR = (this.W / 2) / this.scale;
    this.visibleYR = this.H / this.scale + this.YR_BOTTOM;
    this._updateOrigin();
  },

  /**
   * 设置缩放（围绕屏幕上某点 anchorPx 缩放，使该点对应的数学坐标保持不变）
   *   - newZoom：目标 zoom（会被 clamp 到 [ZOOM_MIN, ZOOM_MAX]）
   *   - anchorPx, anchorPy：屏幕坐标系下的锚点（默认画布中心）
   * 实现：求出锚点对应的数学坐标 (mx,my)，缩放后调整 panX/panY 让锚点仍指向 (mx,my)
   */
  setZoom(newZoom, anchorPx, anchorPy) {
    const z = Math.max(this.ZOOM_MIN, Math.min(this.ZOOM_MAX, newZoom));
    if (z === this.zoom) return;

    // 锚点的数学坐标（缩放前）
    const ax = (typeof anchorPx === 'number') ? anchorPx : this.W / 2;
    const ay = (typeof anchorPy === 'number') ? anchorPy : this.H / 2;
    const before = this.toMath(ax, ay);

    // 应用 zoom 并重算 scale/origin
    this.zoom = z;
    this._calcScale();

    // 缩放后，同一屏幕坐标 ax/ay 现在对应别的数学坐标 → 调 pan 把它拉回 before
    // X 方向 panX 与屏幕 x 同向（panX 增大 → 视野中心右移 → 同一屏幕点对应数学 x 减小）；
    // Y 方向 panY 与屏幕 y 反向（panY 增大 → 视野中心上移 → 同一屏幕点对应数学 y 减小），
    // 所以 X 用加号、Y 用减号补偿。
    const after = this.toMath(ax, ay);
    this.setPan(this.panX + (before.x - after.x), this.panY - (before.y - after.y));
  },

  /**
   * 增量缩放（围绕屏幕某点）
   * factor > 1 放大，< 1 缩小
   */
  zoomBy(factor, anchorPx, anchorPy) {
    this.setZoom(this.zoom * factor, anchorPx, anchorPy);
  },

  _updateOrigin() {
    // 默认原点：底部中心。加平移：屏幕原点 = 默认 - pan*scale
    this.origin = {
      x: this.W / 2 - this.panX * this.scale,
      y: this.H + (this.YR_BOTTOM - this.panY) * this.scale,
    };
  },

  /**
   * 设置平移（数学坐标偏移），自动 clamp
   */
  setPan(x, y) {
    this.panX = Math.max(-this.MAX_PAN_X, Math.min(this.MAX_PAN_X, x));
    this.panY = Math.max(-this.MAX_PAN_Y, Math.min(this.MAX_PAN_Y, y));
    this._updateOrigin();
  },

  /**
   * 平移增量（屏幕像素 → 数学坐标）
   * 设计：地图跟随手指走（像谷歌地图）
   *   - 鼠标向右拖 (dxPx>0) → 内容向右移 → 视野中心向左 → panX 减小
   *   - 鼠标向下拖 (dyPx>0) → 内容向下移 → 视野中心向下 → panY 减小
   */
  pan(dxPx, dyPx) {
    const dx = dxPx / this.scale;
    const dy = dyPx / this.scale;
    this.setPan(this.panX - dx, this.panY - dy);
  },

  /**
   * 重置视野（pan + zoom）
   */
  resetPan() {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this._calcScale();
  },

  /** 数学 (x, y) → 屏幕 (px, py) */
  toScreen(mx, my) {
    return {
      x: this.origin.x + mx * this.scale,
      y: this.origin.y - my * this.scale,
    };
  },

  /** 屏幕 (px, py) → 数学 (x, y) */
  toMath(px, py) {
    return {
      x: (px - this.origin.x) / this.scale,
      y: (this.origin.y - py) / this.scale,
    };
  },

  /**
   * 当前视野的 x 范围（用于绘制曲线和敌人剔除）
   */
  visibleXRange() {
    const halfW = this.W / 2 / this.scale;
    return [this.panX - halfW - 0.5, this.panX + halfW + 0.5];
  },
  visibleYRange() {
    // 屏幕 y=0（顶部）对应数学 y = H/scale + YR_BOTTOM - panY
    // 屏幕 y=H（底部）对应数学 y = YR_BOTTOM - panY
    // panY 的方向：panY 减小 → 视野往下看（pan() 把 dyPx>0 映射到 panY 减小）
    const yBot = this.YR_BOTTOM - this.panY;
    const yTop = this.H / this.scale + this.YR_BOTTOM - this.panY;
    return [yBot - 0.5, yTop + 0.5];
  },

  /** 数学距离 */
  mathDist(p1x, p1y, p2x, p2y) {
    const dx = p1x - p2x;
    const dy = p1y - p2y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /**
   * 计算点 P 到曲线的最小距离
   */
  pointToCurveDistance(px, py, fn, xRange, samples = 200) {
    const [xmin, xmax] = xRange;
    let minDist = Infinity;
    let prevValid = null;
    const step = (xmax - xmin) / samples;
    for (let i = 0; i <= samples; i++) {
      const x = xmin + i * step;
      let y;
      try {
        y = fn(x);
      } catch (e) {
        prevValid = null;
        continue;
      }
      if (!isFinite(y) || isNaN(y)) {
        prevValid = null;
        continue;
      }
      const d = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (d < minDist) minDist = d;
      if (prevValid) {
        const segDist = this._pointToSegDist(px, py, prevValid.x, prevValid.y, x, y);
        if (segDist < minDist) minDist = segDist;
      }
      prevValid = { x, y };
    }
    return minDist;
  },

  _pointToSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  },

  /**
   * 采样函数曲线
   */
  sampleCurve(fn, xMin, xMax, samples = 400) {
    const points = [];
    const step = (xMax - xMin) / samples;
    for (let i = 0; i <= samples; i++) {
      const x = xMin + i * step;
      let y;
      let valid = true;
      try {
        y = fn(x);
        if (!isFinite(y) || isNaN(y)) valid = false;
      } catch (e) {
        valid = false;
        y = 0;
      }
      points.push({ x, y, valid });
    }
    return points;
  },
};
