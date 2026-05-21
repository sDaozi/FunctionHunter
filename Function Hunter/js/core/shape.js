/**
 * 几何 / 函数轨迹统一抽象
 *
 * Shape 接口（duck typing）：
 *   {
 *     kind: 'function' | 'circle' | 'ellipse' | 'hyperbola' | 'vline',
 *     // 返回 { paths: [[{x,y}, {x,y}, ...], ...] }
 *     // 每条 path 是一段连续折线；多 path 用于双曲线两支等
 *     sample(viewport): { paths: [...] }
 *
 *     // 点 (px, py) 到本形状的最短距离平方（数学坐标系）
 *     // 用于命中判断
 *     distSq(px, py): number
 *   }
 *
 * Shape.compile(expr) 是主入口：
 *   - 先尝试识别几何模板（带 `=` 号且匹配解析几何形式）
 *   - 失败则降级为函数表达式（沿用 Parser.compile）
 *   - 返回 { shape, error } 或 { shape: null, error: '...' }
 */
const Shape = {

  /**
   * 主入口：表达式 → Shape
   */
  compile(expr) {
    if (!expr || !expr.trim()) return { shape: null, error: '请输入函数或几何形状' };

    // 预处理：² → ^2、³ → ^3、Unicode 减号 → ASCII -
    let s = expr
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/[−–—]/g, '-')
      .trim();

    // 含 `=` 走几何识别；否则走函数
    if (s.includes('=')) {
      const geo = this._compileGeometry(s);
      if (geo) return { shape: geo, error: null };
      return { shape: null, error: '无法识别的几何形式（支持：圆、椭圆、双曲线、x=k 直线）' };
    }

    // 普通函数
    const { fn, error } = Parser.compile(s);
    if (error) return { shape: null, error };
    return { shape: this._makeFunctionShape(s, fn), error: null };
  },

  /**
   * 识别并构造几何形状
   * 支持：
   *   x = k                         垂直线
   *   y = k                         水平线（其实退化为函数）
   *   (x-h)^2 + (y-k)^2 = r^2       圆
   *   x^2 + y^2 = r^2               圆（h=k=0）
   *   (x-h)^2/a^2 + (y-k)^2/b^2 = 1 椭圆
   *   x^2/a^2 + y^2/b^2 = 1         椭圆
   *   (x-h)^2/a^2 - (y-k)^2/b^2 = 1 双曲线（x 主轴）
   *   x^2/a^2 - y^2/b^2 = 1
   *   - (x-h)^2/a^2 + (y-k)^2/b^2 = 1 双曲线（y 主轴），等价 -x..+y..=1
   * 实现策略：
   *   归一化字符串后用一组正则匹配模板
   */
  _compileGeometry(raw) {
    // 全部去空格、转小写
    let s = raw.replace(/\s+/g, '').toLowerCase();

    // —— 垂直线 / 水平线 ——
    // x = 数字（含正负、小数）
    let m = s.match(/^x=(-?\d+(?:\.\d+)?)$/);
    if (m) return this._makeVLine(parseFloat(m[1]), raw);
    // y = k 是水平函数，让 Parser 处理（剥掉 y= 后转给函数路径）
    m = s.match(/^y=(.+)$/);
    if (m) {
      const { fn, error } = Parser.compile(m[1]);
      if (error) return null;
      return this._makeFunctionShape(raw, fn);
    }

    // 把 ^2 替换成更易识别的语法形式后再匹配
    // 我们要匹配各种二次曲线，尝试通过规范化系数提取

    // —— 圆：(x-h)^2 + (y-k)^2 = r^2  或者展开/简化形式 ——
    // 形式 A: (x-h)^2+(y-k)^2=数字
    let circ = this._matchCircle(s);
    if (circ) return this._makeCircle(circ.h, circ.k, circ.r, raw);

    // —— 椭圆：(x-h)^2/a^2 + (y-k)^2/b^2 = 1 ——
    let ell = this._matchEllipseOrHyperbola(s);
    if (ell) {
      if (ell.kind === 'ellipse') {
        return this._makeEllipse(ell.h, ell.k, ell.a, ell.b, raw);
      } else {
        return this._makeHyperbola(ell.h, ell.k, ell.a, ell.b, ell.axis, raw);
      }
    }

    return null;
  },

  // —— 圆模板匹配 ——
  // 接受：(x-h)^2+(y-k)^2=R, x^2+(y-k)^2=R, (x-h)^2+y^2=R, x^2+y^2=R
  // 其中 R 可以是数字或 r^2 形式（数字^2）
  _matchCircle(s) {
    // 解析 R 部分：要么是单个数字（含小数），要么是 数字^2
    const numRe = '(-?\\d+(?:\\.\\d+)?)';
    const RPart = `(?:${numRe}\\^2|${numRe})`;
    const xPart = `(?:\\(x-?(-?\\d+(?:\\.\\d+)?)\\)\\^2|x\\^2)`;
    const yPart = `(?:\\(y-?(-?\\d+(?:\\.\\d+)?)\\)\\^2|y\\^2)`;
    // 注意：上面的 -? 在 \(x-? 这种处理不了 (x+3) → 我们改写
    // 简单点：匹配 ( x [+-] num )^2 整体或 x^2
    const xBlock = `(?:\\(x([+-]\\d+(?:\\.\\d+)?)\\)\\^2|x\\^2)`;
    const yBlock = `(?:\\(y([+-]\\d+(?:\\.\\d+)?)\\)\\^2|y\\^2)`;
    const re = new RegExp(`^${xBlock}\\+${yBlock}=${RPart}$`);
    const m = s.match(re);
    if (!m) return null;
    // m[1]: x 偏移（含正负，可 undefined 表 0）；m[2]: y 偏移；m[3]/m[4]: R 部分
    const xShift = m[1] !== undefined ? parseFloat(m[1]) : 0;
    const yShift = m[2] !== undefined ? parseFloat(m[2]) : 0;
    // (x-h)^2 中 (x+3) 表示 h=-3，(x-3) 表示 h=3
    // 我们 capture 到的是 [+-]数字 这一段，比如 "+3" 或 "-3"
    // 关系：(x + 3)^2 = (x - (-3))^2 → h = -(+3) = -3；(x - 3)^2 → h = -(-3) = 3
    const h = -xShift;
    const k = -yShift;
    let r;
    if (m[3] !== undefined) r = Math.abs(parseFloat(m[3]));      // r^2 形式 → r 是 m[3]
    else r = Math.sqrt(parseFloat(m[4]));                         // 直接数字 → R = r^2 → r = sqrt
    if (!isFinite(r) || r <= 0) return null;
    return { h, k, r };
  },

  // —— 椭圆 / 双曲线模板 ——
  // 形式：xBlock/aDen ± yBlock/bDen = 1
  // aDen / bDen 可以是 数字 或 数字^2
  // ± 决定椭圆 / 双曲线（x 轴主轴 / y 轴主轴由 ± 顺序决定）
  _matchEllipseOrHyperbola(s) {
    const xBlock = `(?:\\(x([+-]\\d+(?:\\.\\d+)?)\\)\\^2|x\\^2)`;
    const yBlock = `(?:\\(y([+-]\\d+(?:\\.\\d+)?)\\)\\^2|y\\^2)`;
    const denom = `(?:(\\d+(?:\\.\\d+)?)\\^2|(\\d+(?:\\.\\d+)?))`;  // 例如 4 或 2^2
    // 主形式：xBlock/denomA op yBlock/denomB = 1
    const re = new RegExp(`^${xBlock}/${denom}([+-])${yBlock}/${denom}=1$`);
    const m = s.match(re);
    if (!m) return null;
    // 索引：1=xShift  2=denomA(平方形式)  3=denomA(直接) 4=op 5=yShift 6=denomB(^2) 7=denomB
    const xShift = m[1] !== undefined ? parseFloat(m[1]) : 0;
    const yShift = m[5] !== undefined ? parseFloat(m[5]) : 0;
    const h = -xShift;
    const k = -yShift;
    const op = m[4]; // '+' 椭圆 / '-' 双曲线（x 主轴）
    let a, b;
    if (m[2] !== undefined) a = Math.abs(parseFloat(m[2]));
    else a = Math.sqrt(parseFloat(m[3]));
    if (m[6] !== undefined) b = Math.abs(parseFloat(m[6]));
    else b = Math.sqrt(parseFloat(m[7]));
    if (!isFinite(a) || a <= 0 || !isFinite(b) || b <= 0) return null;
    if (op === '+') {
      return { kind: 'ellipse', h, k, a, b };
    } else {
      // x 项正、y 项负 → x 主轴双曲线
      return { kind: 'hyperbola', h, k, a, b, axis: 'x' };
    }
    // y 主轴双曲线（-x^2/a^2 + y^2/b^2 = 1）暂不支持，玩家少见
  },

  // ============ Shape 工厂 ============

  _makeFunctionShape(expr, fn) {
    return {
      kind: 'function',
      expr,
      fn,
      sample(viewport) {
        const [xMin, xMax] = viewport.xRange;
        const points = Coords.sampleCurve(fn, xMin, xMax, viewport.samples || 600);
        // 把 valid 段切分成多条 path
        const paths = [];
        let cur = [];
        for (const p of points) {
          if (!p.valid) {
            if (cur.length) { paths.push(cur); cur = []; }
          } else {
            cur.push({ x: p.x, y: p.y });
          }
        }
        if (cur.length) paths.push(cur);
        return { paths };
      },
      distSq(px, py) {
        // 复用现有 ±0.7 局部窗口算法（spawn.js 里的 curveHits 内核）
        const window = 0.7;
        const samples = 30;
        const step = (window * 2) / samples;
        const JUMP = 50;
        let minDistSq = Infinity;
        let prev = null;
        for (let i = 0; i <= samples; i++) {
          const x = px - window + i * step;
          let y;
          try { y = fn(x); } catch (e) { prev = null; continue; }
          if (!isFinite(y) || isNaN(y)) { prev = null; continue; }
          const dx = x - px, dy = y - py;
          const dsq = dx * dx + dy * dy;
          if (dsq < minDistSq) minDistSq = dsq;
          if (prev && Math.abs(y - prev.y) < JUMP) {
            const segDsq = Shape._pointSegDistSq(px, py, prev.x, prev.y, x, y);
            if (segDsq < minDistSq) minDistSq = segDsq;
          }
          prev = { x, y };
        }
        return minDistSq;
      },
    };
  },

  _makeVLine(k, expr) {
    return {
      kind: 'vline',
      expr,
      k,
      sample(viewport) {
        const [yMin, yMax] = viewport.yRange;
        return { paths: [[{ x: k, y: yMin }, { x: k, y: yMax }]] };
      },
      distSq(px, py) {
        const dx = px - k;
        return dx * dx;  // 垂直线：水平距离
      },
    };
  },

  _makeCircle(h, k, r, expr) {
    return {
      kind: 'circle',
      expr,
      h, k, r,
      sample(viewport) {
        const N = 80;
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const t = (i / N) * Math.PI * 2;
          pts.push({ x: h + r * Math.cos(t), y: k + r * Math.sin(t) });
        }
        return { paths: [pts] };
      },
      distSq(px, py) {
        // 点到圆最短距离 = ||向量(px-h, py-k)|| - r 的绝对值
        const dx = px - h, dy = py - k;
        const dToCenter = Math.sqrt(dx * dx + dy * dy);
        const d = Math.abs(dToCenter - r);
        return d * d;
      },
    };
  },

  _makeEllipse(h, k, a, b, expr) {
    return {
      kind: 'ellipse',
      expr,
      h, k, a, b,
      sample(viewport) {
        const N = 96;
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const t = (i / N) * Math.PI * 2;
          pts.push({ x: h + a * Math.cos(t), y: k + b * Math.sin(t) });
        }
        return { paths: [pts] };
      },
      distSq(px, py) {
        // 点到椭圆精确解需要解 4 次方程；这里用沿采样点找最近段的近似
        return Shape._distSqToParam(px, py,
          t => h + a * Math.cos(t),
          t => k + b * Math.sin(t),
          0, Math.PI * 2, 64);
      },
    };
  },

  _makeHyperbola(h, k, a, b, axis, expr) {
    return {
      kind: 'hyperbola',
      expr,
      h, k, a, b, axis,
      sample(viewport) {
        // x 主轴：(x-h)^2/a^2 - (y-k)^2/b^2 = 1
        // 参数化：x = h ± a·cosh(t), y = k + b·sinh(t)，t∈[-T, T]
        // T 取使曲线超出视野范围的值
        const [xMin, xMax] = viewport.xRange;
        const [yMin, yMax] = viewport.yRange;
        // 估计 T：让 b·sinh(T) 至少覆盖 yMax-yMin 的两倍
        const yRange = Math.max(Math.abs(yMax - k), Math.abs(yMin - k)) + 1;
        const T = Math.max(1, Math.asinh(yRange / b));
        const N = 80;
        const right = [];  // 右支（+a·cosh）
        const left = [];   // 左支（-a·cosh）
        for (let i = 0; i <= N; i++) {
          const t = -T + (2 * T * i) / N;
          const cosh = (Math.exp(t) + Math.exp(-t)) / 2;
          const sinh = (Math.exp(t) - Math.exp(-t)) / 2;
          right.push({ x: h + a * cosh, y: k + b * sinh });
          left.push({ x: h - a * cosh, y: k + b * sinh });
        }
        // 视野裁剪：去除完全不可见的支
        const inView = (pts) => pts.some(p => p.x >= xMin - 1 && p.x <= xMax + 1 && p.y >= yMin - 1 && p.y <= yMax + 1);
        const paths = [];
        if (inView(right)) paths.push(right);
        if (inView(left)) paths.push(left);
        return { paths };
      },
      distSq(px, py) {
        // 沿两支的参数化采样找最近
        const yRange = Math.max(Math.abs(py - k), 5);
        const T = Math.max(1, Math.asinh(yRange / b) + 0.5);
        const dRight = Shape._distSqToParam(px, py,
          t => h + a * Math.cosh(t),
          t => k + b * Math.sinh(t),
          -T, T, 64);
        const dLeft = Shape._distSqToParam(px, py,
          t => h - a * Math.cosh(t),
          t => k + b * Math.sinh(t),
          -T, T, 64);
        return Math.min(dRight, dLeft);
      },
    };
  },

  // —— 工具：参数曲线最短距离平方 ——
  // 沿采样点折线找最近段，避免完整解析解
  _distSqToParam(px, py, fx, fy, tMin, tMax, N) {
    const step = (tMax - tMin) / N;
    let minDsq = Infinity;
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const t = tMin + step * i;
      const x = fx(t), y = fy(t);
      if (!isFinite(x) || !isFinite(y)) { prev = null; continue; }
      const dx = x - px, dy = y - py;
      const dsq = dx * dx + dy * dy;
      if (dsq < minDsq) minDsq = dsq;
      if (prev) {
        const segDsq = Shape._pointSegDistSq(px, py, prev.x, prev.y, x, y);
        if (segDsq < minDsq) minDsq = segDsq;
      }
      prev = { x, y };
    }
    return minDsq;
  },

  /** 点到线段距离平方 */
  _pointSegDistSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const ex = px - ax, ey = py - ay;
      return ex * ex + ey * ey;
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const ex = px - cx, ey = py - cy;
    return ex * ex + ey * ey;
  },
};
