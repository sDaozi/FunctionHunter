/**
 * 函数队列事件管理器（扩充版）
 *
 * 核心规则：
 *   - 距上次事件 ≥5 关 + 非 boss 波（10/20/30）+ 非球波（25/35/55）+ 30% 概率
 *   - 触发时屏幕顶部沿某函数曲线生成 8 只队列怪
 *   - 提示「消灭 XX 函数队列！」
 *   - 玩家用对应类别函数命中至少 4/8（一半以上） → 获得成就（持久化到 localStorage）
 *   - 事件持续到所有队列怪都死或飘出屏幕
 *
 * 11 种事件类型：一次/二次/三次/平方根/绝对值/反比例/正弦/余弦/指数/圆/椭圆
 */
const FunctionEvent = {
  /** 本局已完成的成就 id 集合 */
  thisRunAchievements: new Set(),

  /** 11 种事件类型 */
  TYPES: [
    {
      id: 'EVENT_LINE',
      name: '一次',
      example: 'y = x',
      category: 'linear',
      yFunc: (x) => x + 20,         // 上移让队列从更高处下落
      xRange: [-8, 8],
    },
    {
      id: 'EVENT_QUADRATIC',
      name: '二次',
      example: 'y = x²/4',
      category: 'quadratic',
      yFunc: (x) => x * x / 4 + 16,
      xRange: [-7, 7],
    },
    {
      id: 'EVENT_CUBIC',
      name: '三次',
      example: 'y = x³/40',
      category: 'cubic',
      yFunc: (x) => x * x * x / 40 + 20,
      xRange: [-7, 7],
    },
    {
      id: 'EVENT_SQRT',
      name: '平方根',
      example: 'y = 2·√x',
      category: 'sqrt',
      yFunc: (x) => x >= 0 ? 2 * Math.sqrt(x) + 16 : NaN,
      xRange: [0.5, 14],
    },
    {
      id: 'EVENT_ABS',
      name: '绝对值',
      example: 'y = |x|',
      category: 'abs',
      yFunc: (x) => Math.abs(x) + 16,
      xRange: [-7, 7],
    },
    {
      id: 'EVENT_RECIPROCAL',
      name: '反比例',
      example: 'y = 4/x',
      category: 'reciprocal',
      yFunc: (x) => 4 / x + 20,
      xRange: [-8, 8],
      skipNearZero: true,
    },
    {
      id: 'EVENT_SINE',
      name: '正弦',
      example: 'y = 3·sin(x)',
      category: 'sine',
      yFunc: (x) => 3 * Math.sin(x) + 22,
      xRange: [-8, 8],
    },
    {
      id: 'EVENT_COSINE',
      name: '余弦',
      example: 'y = 3·cos(x)',
      category: 'cosine',
      yFunc: (x) => 3 * Math.cos(x) + 22,
      xRange: [-8, 8],
    },
    {
      id: 'EVENT_EXP',
      name: '指数',
      example: 'y = 2^(x/3)',
      category: 'exp',
      yFunc: (x) => Math.pow(2, x / 3) + 16,
      xRange: [-7, 7],
    },
    {
      id: 'EVENT_CIRCLE',
      name: '圆',
      example: 'x²+(y-22)²=16',
      category: 'circle',
      isImplicit: true,
      circleR: 4,
      circleCy: 22,
    },
    {
      id: 'EVENT_ELLIPSE',
      name: '椭圆',
      example: '(x²)/25+(y-22)²/4=1',
      category: 'ellipse',
      isImplicit: true,
      ellipseA: 5,
      ellipseB: 2,
      ellipseCy: 22,
    },
  ],

  /** localStorage key */
  STORAGE_KEY: 'fh_achievements_v1',

  current: null,
  lastTriggerWave: 0,

  reset() {
    this.current = null;
    this.lastTriggerWave = 0;
    this.thisRunAchievements = new Set();
  },

  shouldTrigger(wave) {
    if (this.current) return false;
    if (wave <= 0) return false;
    if (wave % 5 === 0) return false;         // BOSS 波（每 5 波 = 周期 25 的 BOSS 全覆盖）
    if (wave - this.lastTriggerWave < 3) return false;   // 冷却也压缩到 3 波(原 5 波)
    // 基础概率 50%，每层趋同演化 +15%（cap 3 层 = +45%）
    let prob = 0.50;
    if (typeof Game !== 'undefined' && Game.state && Game.state.upgrades) {
      const stacks = Game.state.upgrades.convergenceStacks || 0;
      prob += stacks * 0.15;
    }
    return Math.random() < prob;
  },

  pickType() {
    return this.TYPES[Math.floor(Math.random() * this.TYPES.length)];
  },

  /** 生成队列怪坐标列表（8 个点，沿曲线均匀分布）
   *  圆和椭圆是隐式曲线，按角度均匀分布 */
  generatePositions(type) {
    const N = 18;
    const positions = [];
    if (type.isImplicit) {
      // 圆 / 椭圆：按角度均匀分布
      for (let i = 0; i < N; i++) {
        const theta = (i / N) * Math.PI * 2;
        let x, y;
        if (type.id === 'EVENT_CIRCLE') {
          x = type.circleR * Math.cos(theta);
          y = type.circleCy + type.circleR * Math.sin(theta);
        } else {
          // ellipse
          x = type.ellipseA * Math.cos(theta);
          y = type.ellipseCy + type.ellipseB * Math.sin(theta);
        }
        positions.push({ x, y });
      }
      return positions;
    }
    // 显式曲线 y = f(x)（yFunc 已包含整体上移，这里只做合法性检查）
    const [xLo, xHi] = type.xRange;
    for (let i = 0; i < N; i++) {
      const x = xLo + (xHi - xLo) * (i / (N - 1));
      if (type.skipNearZero && Math.abs(x) < 0.5) continue;
      let y = type.yFunc(x);
      if (!isFinite(y)) continue;
      // 钳位避免出屏（y 太大或太小都不要）
      if (y > 32) y = 32;
      if (y < 5) y = 5;
      positions.push({ x, y });
    }
    return positions;
  },

  /** 触发：返回 { type, positions } */
  trigger(wave) {
    const type = this.pickType();
    const positions = this.generatePositions(type);
    this.current = {
      type,
      startWave: wave,
      enemiesCreated: [],
      // 用对函数命中的怪物 id 集合（去重，避免一只被多次扫到重复计数）
      correctlyKilled: new Set(),
      ended: false,
    };
    this.lastTriggerWave = wave;
    return { type, positions };
  },

  attachEnemies(enemies) {
    if (!this.current) return;
    this.current.enemiesCreated = enemies;
    for (const e of enemies) e.queueEventId = this.current.type.id;
  },

  /** 严格类别匹配 */
  matchCategory(eventCategory, exprStr, libCategoriesSet) {
    if (!exprStr) return false;
    let norm = (exprStr || '').toLowerCase().replace(/\s+/g, '').replace(/\*\*/g, '^').replace(/^y=/, '');
    // 隐式乘法处理：2x → 2*x
    norm = norm.replace(/(\d)([a-z(])/g, '$1*$2').replace(/([a-z\)])(\d)/g, '$1*$2').replace(/\)\(/g, ')*(');

    let cats = libCategoriesSet;
    if (cats.size === 0 && /[a-z*\d^]/.test(norm)) {
      cats = (typeof Library !== 'undefined') ? Library.categoriesOf(norm) : new Set();
    }

    switch (eventCategory) {
      case 'sine':
        return /\bsin\(/.test(norm);
      case 'cosine':
        return /\bcos\(/.test(norm);
      case 'exp':
        // 指数：2^x、e^x、log，但不含 sin/cos（玩家可能写 2^sin(x) 钻空子，本规则不允许）
        return cats.has('exp') && !/\bsin\(|\bcos\(|\btan\(/.test(norm);
      case 'sqrt':
        return /\bsqrt\(/.test(norm);
      case 'abs':
        return /\babs\(/.test(norm);
      case 'linear':
        // 一次：power 类，不含 ^2/^3/sqrt/abs/k/x/sin 等
        if (!cats.has('power')) return false;
        if (/x\^[2-9]/.test(norm)) return false;
        if (/\bsqrt\(|\babs\(|\bsin\(|\bcos\(|\btan\(/.test(norm)) return false;
        if (/[\d.]\/x|\/x|1\/x/.test(norm)) return false;
        return true;
      case 'quadratic':
        if (!cats.has('power')) return false;
        if (!/x\^2/.test(norm)) return false;
        if (/x\^[3-9]/.test(norm)) return false;
        if (/\bsqrt\(|\babs\(|\bsin\(|\bcos\(/.test(norm)) return false;
        return true;
      case 'cubic':
        if (!cats.has('power')) return false;
        if (!/x\^3/.test(norm)) return false;
        if (/x\^[4-9]/.test(norm)) return false;
        if (/\bsqrt\(|\babs\(|\bsin\(|\bcos\(/.test(norm)) return false;
        return true;
      case 'reciprocal':
        if (!cats.has('power')) return false;
        return /[\d.]+\s*\/\s*x|1\s*\/\s*x|\/\s*x/.test(norm);
      case 'circle': {
        // 圆方程：x^2+y^2=k 或 (x±a)^2+(y±b)^2=k
        // 允许 x^2 形式或 (x±数字)^2 形式
        if (!/=/.test(norm)) return false;
        const hasX2 = /x\^2/.test(norm) || /\(x[+-][\d.]+\)\^2/.test(norm);
        const hasY2 = /y\^2/.test(norm) || /\(y[+-][\d.]+\)\^2/.test(norm);
        if (!hasX2 || !hasY2) return false;
        // 排除椭圆/双曲线
        if (/\^2\s*\/\s*[\d.]/.test(norm)) return false;  // 含分母的是椭圆
        if (/x.*\^2\s*-\s*.*y.*\^2/.test(norm) || /y.*\^2\s*-\s*.*x.*\^2/.test(norm)) return false;
        return true;
      }
      case 'ellipse': {
        // 椭圆方程：x^2/a + y^2/b = 1（含可能的 (x-h) 平移）
        if (!/=/.test(norm)) return false;
        const hasX2 = /x\^2/.test(norm) || /\(x[+-][\d.]+\)\^2/.test(norm);
        const hasY2 = /y\^2/.test(norm) || /\(y[+-][\d.]+\)\^2/.test(norm);
        if (!hasX2 || !hasY2) return false;
        // 必须含至少一个 ^2/数字（区别于圆）
        if (!/\^2\s*\/\s*[\d.]/.test(norm)) return false;
        // 排除双曲线
        if (/x.*\^2.*-\s*.*y.*\^2/.test(norm) || /y.*\^2.*-\s*.*x.*\^2/.test(norm)) return false;
        return true;
      }
      default:
        return false;
    }
  },

  /** 队列怪被击杀（不论方法）
   *  @param matched 是否用对函数（类别匹配）击杀 */
  onEnemyKilled(enemy, matched) {
    if (!this.current) return;
    if (enemy.queueEventId !== this.current.type.id) return;
    if (matched) this.current.correctlyKilled.add(enemy.id);
  },

  /** 每帧检查事件是否结束
   *  @param currentWave 当前游戏 wave，用于"推进波次后强制清理"的保险条件
   */
  tick(currentWave) {
    if (!this.current || this.current.ended) return null;
    const enemies = this.current.enemiesCreated;
    const stillAlive = enemies.filter(e => e.hp > 0 && e.y > -3);
    // 保险条件：当前 wave 已经超过事件触发波次 → 强制结算（可能进了 boss 战或别的)
    const wavePassed = currentWave !== undefined && currentWave > this.current.startWave;
    if (stillAlive.length === 0 || wavePassed) {
      this.current.ended = true;
      const correctCount = this.current.correctlyKilled.size;
      const totalCount = enemies.length;
      const achieved = correctCount >= Math.ceil(totalCount / 2);
      const result = {
        ended: true,
        achieved,
        correctCount,
        totalCount,
        type: this.current.type,
      };
      if (achieved) {
        this.thisRunAchievements.add(this.current.type.id);
        this._saveToStorage(this.current.type.id);
      }
      this.current = null;
      return result;
    }
    return null;
  },

  _saveToStorage(id) {
    try {
      const all = this.loadAll();
      all[id] = (all[id] || 0) + 1;
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
    } catch (e) {}
  },

  loadAll() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) { return {}; }
  },
};

if (typeof module !== 'undefined') module.exports = FunctionEvent;
