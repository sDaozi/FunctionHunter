/**
 * 函数库 & 次数冷却管理
 *
 * 冷却规则（v2）：
 *   - 每次发射函数 A 之后，A 进入「锁定」状态
 *   - 锁定的 A 必须等到「3 个不同的、非 A 本身的其他函数被发射过」之后才解锁
 *   - 这些 3 次必须是 3 个不同的函数（去重，重复发射同一个不计）
 *   - 开局时所有函数初始为 unlocked，首次使用没有任何门槛
 *
 * 数据结构（运行时）：
 *   library.items = [
 *     {
 *       expr: 'x^2',                 // 原始表达式
 *       complexity: 5,               // 复杂度评分（保留供 UI 显示）
 *       fireCount: 3,                // 累计发射次数
 *       firstUsedAt: 12345,
 *       locked: false,               // 是否处于锁定（待解锁）状态
 *       unlockNeeded: 3,             // 解锁所需不同函数数（恒为 3，留作扩展）
 *       unlockProgress: ['x^2','sin(x)'],  // 自上次发射以来，已经被使用过的、不同的、非自身的函数 id（normalize 后的 expr）
 *     },
 *     ...
 *   ]
 *
 * 持久化（localStorage）：v2 版本格式带 version 字段；旧 v1 数据加载时迁移为「全部 unlocked」。
 */
const Library = {
  STORAGE_KEY: 'fh_library',
  VERSION: 2,
  UNLOCK_NEEDED: 3,        // 普通自定义函数：3 轮冷却
  UNLOCK_NEEDED_SHORT: 1,  // 主动变体（基础±常数 / x=k）：1 轮冷却
  MAX_ITEMS: 5,

  /**
   * 表达式分类（决定行为的核心规则）：
   *
   *   isBasic(expr)         — 完全免费：不进栏 + 不占名额 + 无冷却
   *                           覆盖：原始 10 个函数 + 3 个几何模板（圆/椭圆/双曲线）
   *
   *   isShortCooldown(expr) — 主动变体：进栏 + 占名额 + 1 轮冷却 + 同 base 替换
   *                           覆盖：基础±常数（如 x^2+3）、任意 x=k 垂直线
   *
   *   isFreeFire(expr)      — 无冷却 = isBasic（保留对外 API 兼容）
   *
   *   普通自定义              — 上述全部 false：进栏 + 占名额 + 3 轮冷却
   *
   * 同 base 替换规则：发射主动变体会把已学函数中"同 base"的旧变体踢出。
   *   x^2+3、x^2-7、3+x^2  共同 base = "x^2"
   *   x=3、x=-2.5、x=42     共同 base = "x=*"
   */

  // 函数类基础（10 个），允许 ±常数变体
  BASIC_FUNCS: new Set([
    'x^2', 'x^3', 'sqrt(x)', '1/x',
    'sin(x)', 'cos(x)', 'tan(x)',
    'abs(x)', '2^x', 'log(x)',
  ]),
  // 几何类基础
  BASIC_GEOMS: new Set([
    'x^2+y^2=4', 'x^2/9+y^2/4=1', 'x^2/9-y^2/4=1',
  ]),
  // 任意 x=k 形式的垂直线（k 为带符号小数）
  X_EQ_K_RE: /^x=-?\d+(?:\.\d+)?$/,
  // y=k 形式的水平线 / 常数函数
  Y_EQ_K_RE: /^y=-?\d+(?:\.\d+)?$/,

  /**
   * 把表达式归到一个广义类别（用于九芒星禁闭机制）
   * 返回值之一：'trig' / 'const' / 'vline' / 'power' / 'exp' / null
   *
   *   trig    三角函数：sin / cos / tan（含 ±常数变体）
   *   const   y=常数：y=5、y=-3 等
   *   vline   x=常数：x=k
   *   power   幂函数：x^n / sqrt / 1/x / abs（含 ±常数变体）
   *   exp     指数函数：2^x / log（含 ±常数变体）
   *   null    其他自定义（不在禁闭范围）
   */
  categoryOf(exprOrItem) {
    const raw = typeof exprOrItem === 'string' ? exprOrItem : exprOrItem.expr;
    const norm = this.normalize(raw);
    if (this.X_EQ_K_RE.test(norm)) return 'vline';
    if (this.Y_EQ_K_RE.test(norm)) return 'const';
    // 抽取 base：原始基础或 base±数字
    let base = null;
    if (this.BASIC_FUNCS.has(norm)) {
      base = norm;
    } else {
      const bk = this.baseKeyOf(norm);
      if (bk && bk !== 'x=*') base = bk;
    }
    if (!base) return null;
    if (base === 'sin(x)' || base === 'cos(x)' || base === 'tan(x)') return 'trig';
    if (base === '2^x' || base === 'log(x)') return 'exp';
    if (base === 'x^2' || base === 'x^3' || base === 'sqrt(x)' || base === '1/x' || base === 'abs(x)') return 'power';
    return null;
  },

  /**
   * 检测表达式涉及的所有类别（用于九芒星禁闭：复合函数也要禁）
   * 返回类别 Set，可能多类（如 y= x*sin(x) 同时涉及 power 和 trig）
   *
   * 检测策略：
   *   1) 主类别由 categoryOf 给出（精确匹配优先）
   *   2) 子串扫描三角/指数/sqrt/abs/x^/1/x 关键字
   *   3) 剥离三角/指数/sqrt 的函数参数后，若剩下还含 x（任何位置），算 power
   *      —— 这样 x*cos(x)、tan(x)/x、x*x、y=x*cos(x) 都正确归到 power
   *      —— 只有 x 在 sin(x)/cos(x) 等纯函数参数里时不算 power
   */
  categoriesOf(exprOrItem) {
    const raw = typeof exprOrItem === 'string' ? exprOrItem : exprOrItem.expr;
    const norm = this.normalize(raw);
    const set = new Set();
    // 主类别（精确匹配优先）
    const main = this.categoryOf(norm);
    if (main) set.add(main);
    // 关键字扫描
    if (/\bsin\(|\bcos\(|\btan\(/.test(norm)) set.add('trig');
    if (/\b2\^|\blog\(|\be\^/.test(norm)) set.add('exp');
    // 显式 power 标志
    if (/\bsqrt\(|\babs\(|x\^|\b1\/x\b/.test(norm)) set.add('power');
    // 隐式 power：仅当主类别不是 vline/const 时才扫（赋值式 x=k / y=k 中的 x 不算 power）
    if (main !== 'vline' && main !== 'const') {
      const stripped = norm
        .replace(/\bsin\([^()]*\)/g, '_')
        .replace(/\bcos\([^()]*\)/g, '_')
        .replace(/\btan\([^()]*\)/g, '_')
        .replace(/\bsqrt\([^()]*\)/g, '_')
        .replace(/\blog\([^()]*\)/g, '_')
        .replace(/\babs\([^()]*\)/g, '_')
        .replace(/\d+\^x/g, '_')
        .replace(/\be\^x/g, '_');
      if (/(^|[^a-z0-9_])x([^a-z0-9_]|$)/.test(stripped)) set.add('power');
    }
    return set;
  },

  /** 类别中文名（用于 toast / 图鉴） */
  CATEGORY_LABELS: {
    trig:  '三角函数',
    const: 'y= 常数',
    vline: 'x= 常数',
    power: '幂函数',
    exp:   '指数函数',
  },

  /**
   * 是否完全免费（不进栏、不占名额、无冷却）
   */
  isBasic(exprOrItem) {
    const raw = typeof exprOrItem === 'string' ? exprOrItem : exprOrItem.expr;
    const norm = this.normalize(raw);
    if (this.BASIC_FUNCS.has(norm)) return true;
    if (this.BASIC_GEOMS.has(norm)) return true;
    if (this.Y_EQ_K_RE.test(norm)) return true;   // y=k 常数函数：基本函数
    return false;
  },

  /**
   * 是否短冷却的主动变体：进栏 + 占名额 + 1 轮冷却 + 同 base 替换
   */
  isShortCooldown(exprOrItem) {
    const raw = typeof exprOrItem === 'string' ? exprOrItem : exprOrItem.expr;
    const norm = this.normalize(raw);
    if (this.isBasic(raw)) return false;  // 原始基础不算
    if (this.X_EQ_K_RE.test(norm)) return true;
    if (norm.includes('=')) return false;  // 其他几何不允许变体
    return this._matchBasicVariant(norm);
  },

  /**
   * 是否无冷却（仅原始基础）
   * 保留作对外 API 兼容
   */
  isFreeFire(exprOrItem) {
    return this.isBasic(exprOrItem);
  },

  /**
   * 提取 base key — 用于「同 base 只保留最新」
   *   x^2+3、3+x^2、x^2-7  → 'x^2'
   *   x=3、x=-2.5、x=0     → 'x=*'
   *   其他                  → null（不参与替换规则）
   */
  baseKeyOf(exprOrItem) {
    const raw = typeof exprOrItem === 'string' ? exprOrItem : exprOrItem.expr;
    const norm = this.normalize(raw);
    if (this.X_EQ_K_RE.test(norm)) return 'x=*';
    const UNSIGNED_NUM = /^\d+(?:\.\d+)?$/;
    for (const base of this.BASIC_FUNCS) {
      if (norm.startsWith(base) && norm.length > base.length) {
        const tail = norm.slice(base.length);
        if ((tail[0] === '+' || tail[0] === '-') && UNSIGNED_NUM.test(tail.slice(1))) {
          return base;
        }
      }
      if (norm.endsWith(base) && norm.length > base.length) {
        const head = norm.slice(0, norm.length - base.length);
        if (head.endsWith('+')) {
          const numPart = head.slice(0, -1);
          if (UNSIGNED_NUM.test(numPart)) return base;
        }
      }
    }
    return null;
  },

  /**
   * 匹配 base±num 或 num+base
   */
  _matchBasicVariant(norm) {
    const UNSIGNED_NUM = /^\d+(?:\.\d+)?$/;
    for (const base of this.BASIC_FUNCS) {
      if (norm.startsWith(base) && norm.length > base.length) {
        const tail = norm.slice(base.length);
        if ((tail[0] === '+' || tail[0] === '-') && UNSIGNED_NUM.test(tail.slice(1))) {
          return true;
        }
      }
      if (norm.endsWith(base) && norm.length > base.length) {
        const head = norm.slice(0, norm.length - base.length);
        if (head.endsWith('+')) {
          const numPart = head.slice(0, -1);
          if (UNSIGNED_NUM.test(numPart)) return true;
        }
      }
    }
    return false;
  },

  /** 内存中的函数库 */
  items: [],

  /**
   * 归一化表达式：去空格、统一 ** 为 ^，作为去重 key 与函数 id
   */
  normalize(expr) {
    return expr.replace(/\s+/g, '').replace(/\*\*/g, '^').toLowerCase();
  },

  /**
   * 评估复杂度（保留供 UI 显示和未来拓展）
   */
  complexity(expr) {
    const e = this.normalize(expr);
    let score = 0;
    score += Math.min(e.length, 30) * 0.3;
    const funcs = ['sin','cos','tan','sqrt','abs','log','ln','exp','asin','acos','atan'];
    funcs.forEach(f => { if (e.includes(f + '(')) score += 3; });
    const powMatches = e.match(/\^/g);
    if (powMatches) score += powMatches.length * 2;
    const opsMatches = e.replace(/^[-+]/, '').match(/[+\-]/g);
    if (opsMatches) score += opsMatches.length * 1.2;
    const lparenMatches = e.match(/\(/g);
    if (lparenMatches) score += lparenMatches.length * 0.8;
    if (/\d\.\d/.test(e)) score += 0.5;
    if (e.includes('/')) score += 1.5;
    return score;
  },

  /**
   * 添加 / 查找一个函数项
   * - 完全免费的基础项（isBasic）：直接加，不占名额、不触发淘汰
   * - 主动变体（isShortCooldown）：进栏占名额；同 base 已存在则先踢掉旧的（被替换提示）
   * - 普通自定义：进栏占名额；超额则淘汰
   */
  addOrGet(expr) {
    const key = this.normalize(expr);
    let item = this.items.find(i => this.normalize(i.expr) === key);
    if (item) return item;

    const basic = this.isBasic(expr);
    // 基础函数（含 y=k 常数）：完全不进栏，无冷却，返回一个临时不入库的占位 item
    if (basic) {
      return {
        expr: expr.trim(),
        complexity: 0,
        fireCount: 0,
        firstUsedAt: performance.now(),
        locked: false,
        unlockNeeded: 0,
        unlockProgress: [],
        isBasic: true,
        isFreeFire: true,
        isShortCooldown: false,
        _ephemeral: true,    // 标记：不在 items 数组里，无需 trigger 时更新冷却
      };
    }

    const shortCD = this.isShortCooldown(expr);

    this._lastEvictedExpr = null;
    this._lastReplacedExpr = null;

    // 同 base 替换（仅对主动变体）：如 x^2+3 → x^2+5 时，移除旧的 x^2+3
    if (shortCD) {
      const baseKey = this.baseKeyOf(expr);
      if (baseKey) {
        const sameBase = this.items.find(i => this.baseKeyOf(i.expr) === baseKey);
        if (sameBase) {
          this._lastReplacedExpr = sameBase.expr;
          this.remove(sameBase.expr);
        }
      }
    }

    // 名额淘汰：库满时挤掉一个
    const nonBasicCount = this.items.filter(i => !i.isBasic).length;
    if (nonBasicCount >= this.MAX_ITEMS) {
      this._lastEvictedExpr = this._evictOne();
    }

    const c = this.complexity(expr);
    item = {
      expr: expr.trim(),
      complexity: Math.round(c * 10) / 10,
      fireCount: 0,
      firstUsedAt: performance.now(),
      locked: false,
      // 短冷却变体（含 x=k）只需 1 轮；其他普通函数 3 轮
      unlockNeeded: shortCD ? this.UNLOCK_NEEDED_SHORT : this.UNLOCK_NEEDED,
      unlockProgress: [],
      isBasic: false,
      isFreeFire: false,
      isShortCooldown: shortCD,
    };
    this.items.push(item);
    this.save();
    return item;
  },

  /**
   * 淘汰一个非基础函数（库满时调用）
   * 排序优先级：
   *   1) 仅 isBasic=false 中选（基础函数永不淘汰）
   *   2) 未锁定的优先于锁定的
   *   3) fireCount 最小（用得最少）
   *   4) firstUsedAt 最早（最老进库）
   * 返回被淘汰项的 expr，无可淘汰返回 null
   */
  _evictOne() {
    const candidates = this.items.filter(i => !i.isBasic);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      if (a.locked !== b.locked) return a.locked ? 1 : -1;
      if (a.fireCount !== b.fireCount) return a.fireCount - b.fireCount;
      return a.firstUsedAt - b.firstUsedAt;
    });
    const victim = candidates[0];
    const expr = victim.expr;
    this.remove(expr);
    return expr;
  },

  /**
   * 触发发射 — 推进次数冷却状态机
   *   1) 先把当前 item.id 推进给所有其他 locked item 的 unlockProgress
   *      （基础函数也算"被使用过的事件"，照样推进别人）
   *   2) 再把 item 锁定（基础函数除外，其无冷却）
   */
  /**
   * 计算一个 item 当前生效的"解锁所需数"。
   * 默认返回 item.unlockNeeded；如果金1 以太编辑生效（Game.state.upgrades.etherStacks > 0），
   * 强制返回 1（所有冷却统一为 1 回合）。
   */
  effectiveUnlockNeeded(item) {
    const base = item.unlockNeeded || this.UNLOCK_NEEDED;
    if (typeof Game !== 'undefined' && Game.state && Game.state.upgrades
        && (Game.state.upgrades.etherStacks || 0) > 0) {
      return 1;
    }
    return base;
  },

  trigger(item) {
    const id = this.normalize(item.expr);

    // 推进其他锁定项的进度
    for (const other of this.items) {
      if (other === item) continue;
      if (!other.locked) continue;
      if (other.unlockProgress.indexOf(id) === -1) {
        other.unlockProgress.push(id);
        if (other.unlockProgress.length >= this.effectiveUnlockNeeded(other)) {
          other.locked = false;
          other.unlockProgress = [];
        }
      }
    }

    // 自身锁定：仅完全免费（isBasic）的不锁；短冷却变体也要锁（只是 unlockNeeded=1）
    if (!item.isBasic) {
      item.locked = true;
      item.unlockProgress = [];
    }
    item.fireCount++;

    // ephemeral basic item 不在 this.items 里，但 trigger 仍要推进其他锁定项进度
    // 仅当此次 trigger 触动了 items 数组内的状态（非 ephemeral 或推进了别的项）才存
    if (!item._ephemeral) {
      this.save();
    } else if (this.items.some(i => i.locked)) {
      // 还有别的锁定项被推进了进度，需要持久化进度
      this.save();
    }
    return item;
  },

  /**
   * 是否锁定中（不可发射）
   */
  isLocked(item) {
    if (!item.locked) return false;
    // 金1 以太编辑生效时，effective unlock 可能已经满足
    if (item.unlockProgress.length >= this.effectiveUnlockNeeded(item)) {
      // 立刻解锁（修正状态，让后续 trigger 时不再误处理）
      item.locked = false;
      item.unlockProgress = [];
      return false;
    }
    return true;
  },

  /**
   * 还需要多少个不同函数才能解锁（0 表示已解锁）
   */
  remainingUses(item) {
    if (!item.locked) return 0;
    const need = this.effectiveUnlockNeeded(item);
    return Math.max(0, need - item.unlockProgress.length);
  },

  /**
   * 已积累的解锁进度（0..unlockNeeded）
   */
  progressCount(item) {
    const need = this.effectiveUnlockNeeded(item);
    if (!item.locked) return need;
    return item.unlockProgress.length;
  },

  // —— 兼容旧 API：保留 isOnCooldown 别名 ——
  /** @deprecated 使用 isLocked */
  isOnCooldown(item) {
    return this.isLocked(item);
  },

  /**
   * 移除一个函数
   */
  remove(expr) {
    const key = this.normalize(expr);
    this.items = this.items.filter(i => this.normalize(i.expr) !== key);
    // 同步清理其他项 unlockProgress 中可能残留的引用，
    // 否则被移除的函数仍占着别人的解锁进度名额
    for (const it of this.items) {
      if (it.unlockProgress && it.unlockProgress.length) {
        it.unlockProgress = it.unlockProgress.filter(id => id !== key);
      }
    }
    this.save();
  },

  /**
   * 重置（每局开始调用）：清掉所有锁定状态，所有函数变为可用
   * 函数库本身保留
   */
  reset() {
    this.items.forEach(i => {
      i.locked = false;
      i.unlockProgress = [];
    });
  },

  /**
   * 加载持久化的函数列表
   * - v2 格式：{ version: 2, items: [...] }
   * - v1 旧格式：直接是数组（带 cooldownMs/cooldownEndAt 字段）
   * 加载后所有项一律 unlocked（运行时锁定状态不持久化，与原版「重启即清冷却」行为一致）
   */
  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      let arr = null;
      if (Array.isArray(parsed)) {
        arr = parsed;  // v1
      } else if (parsed && Array.isArray(parsed.items)) {
        arr = parsed.items;  // v2
      } else {
        return;
      }

      this.items = arr.map(d => {
        const c = (typeof d.complexity === 'number') ? d.complexity : this.complexity(d.expr || '');
        const expr = d.expr || '';
        const basic = this.isBasic(expr);
        const shortCD = this.isShortCooldown(expr);
        return {
          expr,
          complexity: c,
          fireCount: d.fireCount || 0,
          firstUsedAt: d.firstUsedAt || performance.now(),
          locked: false,
          unlockNeeded: shortCD ? this.UNLOCK_NEEDED_SHORT : this.UNLOCK_NEEDED,
          unlockProgress: [],
          isBasic: basic,
          isFreeFire: basic,
          isShortCooldown: shortCD,
        };
      }).filter(i => i.expr);

      // 名额限制：仅对非基础项；保留所有基础项 + 至多 MAX_ITEMS 个非基础项
      const basics = this.items.filter(i => i.isBasic);
      const nonBasics = this.items.filter(i => !i.isBasic).slice(0, this.MAX_ITEMS);
      this.items = [...basics, ...nonBasics];
    } catch (e) {
      this.items = [];
    }
  },

  /**
   * 保存到 localStorage
   */
  save() {
    try {
      const payload = {
        version: this.VERSION,
        items: this.items.map(i => ({
          expr: i.expr,
          complexity: i.complexity,
          fireCount: i.fireCount,
          firstUsedAt: i.firstUsedAt,
        })),
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {}
  },

  /**
   * 排序：用于「已学函数」UI 展示
   * - 过滤掉基础函数（含 ±常数变体），它们不进展示栏
   * - 可用的在前，按使用次数倒序
   */
  sortedItems() {
    const copy = this.items.filter(i => !i.isBasic);
    copy.sort((a, b) => {
      const aLocked = this.isLocked(a);
      const bLocked = this.isLocked(b);
      if (aLocked !== bLocked) return aLocked ? 1 : -1;
      return b.fireCount - a.fireCount;
    });
    return copy;
  },
};
