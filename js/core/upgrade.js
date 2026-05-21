/**
 * 升级系统（Upgrade）
 *
 * 玩家累计分数达到阈值（1k → 3k → 6k → 10k → 15k → 21k...）即升级。
 *   等级 N 升 N+1 需要的分数总和 = 1+2+3+...+N 千分 = N*(N+1)/2 * 1000
 *
 * 等级影响：
 *   - 函数解锁：1 级仅 power/vline/const；3 级开 exp；5 级全开（trig）
 *   - 升级时弹 3 张卡，从 effects 库抽 2 张（去重，按权重 75/20/5）+ 第 3 张固定 BLUE_REROLL
 *
 * 状态结构（挂在 Game.state.upgrades 上）：
 *   {
 *     level: 1,                  // 当前等级
 *     scoreAtLastLevel: 0,       // 上次升级时的累计分（用于计算下一级阈值）
 *     pendingChoice: false,      // 是否有未选择的卡
 *     rerollsLeft: 0,            // 剩余刷新次数
 *     // 各效果的累加状态
 *     taylorStacks: 0,           // 蓝1：泰勒展开堆叠数
 *     maclaurinStacks: 0,        // 蓝2：麦克劳林堆叠数
 *     slowStacks: 0,             // 蓝4：迟缓堆叠数
 *     pushcartCharges: 0,        // 蓝5：小推车充能数
 *     paralyzeUnlocked: false,   // 紫3：麻痹大意（不堆叠）
 *     // 第二阶段才用：partialUnlocked, stackDamage, etherStacks 等
 *   }
 */
const Upgrade = {

  // ===== 等级阈值（1.4^(N-1) 千分累加，指数化锁住后期升级速度） =====
  /** 升到 N 级（1-indexed）所需的【累计分数下限】
   *  升级速度 ×2 后:L1=0, L2=500, L3=1.2k, L5=3.55k, L10=24.5k, L15=137.5k, L20=745k, L25=4M
   */
  thresholdToReach(targetLevel) {
    if (targetLevel <= 1) return 0;
    // 几何级数求和：sum_{k=0}^{N-2} 1.4^k * 500 = (1.4^(N-1) - 1) / 0.4 * 500
    // 系数从 1000 改为 500 → 等同于升级速度 ×2(达到每级所需分数减半)
    return Math.round((Math.pow(1.4, targetLevel - 1) - 1) / 0.4 * 500);
  },

  /** 在累计分数 score 下应当处于的等级（1-indexed） */
  levelForScore(score) {
    if (score < 500) return 1;
    // 浮点精度安全：直接逐级累加查（最多 100 级，开销可忽略）
    let level = 1;
    while (level < 100 && this.thresholdToReach(level + 1) <= score) {
      level++;
    }
    return level;
  },

  // ===== 解锁判定 (已废弃 —— 所有函数始终可用) =====
  /** 给定等级，返回当前可用的函数类别集合(保留 API 兼容性,实际返回全集) */
  unlockedCategories(level) {
    // 等级解锁已废除:所有类别永久可用
    return new Set(['power', 'vline', 'const', 'exp', 'trig']);
  },

  /** 给定表达式，是否被当前等级允许(等级解锁已废除,始终返回 true) */
  isExprUnlocked(expr, level) {
    return true;
  },

  /** 给定表达式被锁时，返回缺失的类别中文标签（用于错误提示） */
  missingCategoryLabel(expr, level) {
    const cats = Library.categoriesOf(expr);
    const unlocked = this.unlockedCategories(level);
    for (const c of cats) {
      if (!unlocked.has(c)) return Library.CATEGORY_LABELS[c] || c;
    }
    return null;
  },

  // ===== 效果库 =====
  /**
   * 每张效果卡的元数据：
   *   id: 唯一键
   *   tier: 'blue' | 'purple' | 'gold'
   *   title / desc: 中文展示
   *   maxStacks: 最大堆叠数（不限填 Infinity；不堆叠填 1）
   *   apply(state): 应用效果（修改 state.upgrades 与可能的 state 其他字段；可触发即时事件）
   */
  EFFECTS: {
    BLUE_TAYLOR: {
      id: 'BLUE_TAYLOR', tier: 'blue',
      title: '泰勒展开',
      desc: '所有敌人的体积 ×1.25（叠加，封顶 3 层）',
      maxStacks: 3,  // 1 → 1.25；2 → 1.5625；3 → 1.953（每层 ×1.25 累乘）
      apply(s) { s.upgrades.taylorStacks = Math.min(3, (s.upgrades.taylorStacks || 0) + 1); },
    },
    BLUE_MACLAURIN: {
      id: 'BLUE_MACLAURIN', tier: 'blue',
      title: '麦克劳林展开',
      desc: '激光命中半径 ×1.5（叠加，封顶 2 层）',
      maxStacks: 2,  // 1 → 1.5；2 → 2.25
      apply(s) { s.upgrades.maclaurinStacks = Math.min(2, (s.upgrades.maclaurinStacks || 0) + 1); },
    },
    BLUE_INTEGRAL: {
      id: 'BLUE_INTEGRAL', tier: 'blue',
      title: '环形积分',
      desc: '立刻获得 3 点护盾（叠加，封顶 5 次；护盾上限 10 ❤）',
      maxStacks: 5,
      apply(s) {
        const n = s.upgrades.integralStacks || 0;
        if (n >= 5) return;
        s.upgrades.integralStacks = n + 1;
        s.lives = Math.min(10, s.lives + 3);
      },
    },
    BLUE_SLOW: {
      id: 'BLUE_SLOW', tier: 'blue',
      title: '迟缓',
      desc: '敌人速度 ×0.8（叠加，封顶 ×0.5）',
      maxStacks: 3,  // 1 → 0.8；2 → 0.64；3 → 0.5（实际算法用 max）
      apply(s) { s.upgrades.slowStacks = Math.min(3, (s.upgrades.slowStacks || 0) + 1); },
    },
    BLUE_PUSHCART: {
      id: 'BLUE_PUSHCART', tier: 'blue',
      title: '小推车',
      desc: '获得 1 次充能：受伤时立刻清屏（不影响 BOSS）',
      maxStacks: Infinity,
      apply(s) { s.upgrades.pushcartCharges = (s.upgrades.pushcartCharges || 0) + 1; },
    },
    BLUE_CONVERGENCE: {
      id: 'BLUE_CONVERGENCE', tier: 'blue',
      title: '趋同演化',
      desc: '函数队列特殊事件出现概率 +15%（叠加封顶 3 层 = +45%）',
      maxStacks: 3,
      apply(s) { s.upgrades.convergenceStacks = Math.min(3, (s.upgrades.convergenceStacks || 0) + 1); },
    },
    BLUE_REROLL: {
      id: 'BLUE_REROLL', tier: 'blue',
      title: '颠倒黑白',
      desc: '放弃本次升级，获得 3 次刷新（下次升级才能用，可累积）',
      maxStacks: Infinity,
      apply(s) {
        // 实际累加在 game.js 的 _chooseUpgradeCard 里完成（避免双重叠加），这里 noop
      },
    },
    PURPLE_PARTIAL: {
      id: 'PURPLE_PARTIAL', tier: 'purple',
      title: '偏微分',
      desc: '每 10 秒自动发射一条 y=kx 锁定 |y| 最近的敌人，伤害 1（不可叠加）',
      maxStacks: 1,
      apply(s) {
        if (s.upgrades.partialUnlocked) return;
        s.upgrades.partialUnlocked = true;
        // 计时器初始化
        if (s.upgrades.partialTimer === undefined) s.upgrades.partialTimer = 10.0;
      },
    },
    PURPLE_STACK: {
      id: 'PURPLE_STACK', tier: 'purple',
      title: '叠加',
      desc: '激光命中后伤害 +1（封顶 +5），未命中或 3 秒未再命中清零',
      maxStacks: 1,
      apply(s) {
        s.upgrades.stackUnlocked = true;
        // 当前堆叠不在升级时给，由命中事件累加
        if (s.upgrades.stackDamage === undefined) s.upgrades.stackDamage = 0;
      },
    },
    PURPLE_PARALYZE: {
      id: 'PURPLE_PARALYZE', tier: 'purple',
      title: '麻痹大意',
      desc: '激光命中后 5 秒内敌人速度减半，并显示电击标志（不叠加）',
      maxStacks: 1,
      apply(s) { s.upgrades.paralyzeUnlocked = true; },
    },
    PURPLE_SUPER_EXPAND: {
      id: 'PURPLE_SUPER_EXPAND', tier: 'purple',
      title: '超级展开',
      desc: '5 关内所有怪物被击杀时,会像七边形一样发生范围爆炸(3 单位 AOE 扣 3 伤)。有效期内不再出现此卡',
      maxStacks: 1,
      apply(s) {
        s.upgrades.superExpandUnlocked = true;
        s.upgrades.superExpandActivatedAtWave = s.wave || 1;
      },
    },
    GOLD_ETHER: {
      id: 'GOLD_ETHER', tier: 'gold',
      title: '以太编辑：火力全开',
      desc: '基础伤害 +1；当前护盾 ×2（封顶 10）；敌速 ×0.8；冷却统一为 1（叠加，封顶 2 层)',
      maxStacks: 2,
      apply(s) {
        const n = s.upgrades.etherStacks || 0;
        if (n >= 2) {
          // 已达上限：仅保留冷却效果（已恒定生效），不再叠加伤害/护盾/速度
          return;
        }
        s.upgrades.etherStacks = n + 1;
        s.lives = Math.min(10, s.lives * 2);  // 当前护盾立即翻倍，封顶 10
      },
    },
  },

  /** 抽卡用的池：按 tier 分组（BLUE_REROLL 不参与随机抽，所以不放进抽池） */
  POOL: {
    blue: ['BLUE_TAYLOR', 'BLUE_MACLAURIN', 'BLUE_INTEGRAL', 'BLUE_SLOW', 'BLUE_PUSHCART', 'BLUE_CONVERGENCE'],
    purple: ['PURPLE_PARTIAL', 'PURPLE_STACK', 'PURPLE_PARALYZE', 'PURPLE_SUPER_EXPAND'],
    gold: ['GOLD_ETHER'],
  },

  /** 检查某效果是否对当前 state 已达 maxStacks（已满层，不应再抽到） */
  isEffectCapped(effectId, state) {
    const eff = this.EFFECTS[effectId];
    if (!eff || !state || !state.upgrades) return false;
    const max = eff.maxStacks;
    if (max === Infinity) return false;
    // 各效果当前堆叠数
    const stacks = {
      BLUE_TAYLOR: state.upgrades.taylorStacks || 0,
      BLUE_MACLAURIN: state.upgrades.maclaurinStacks || 0,
      BLUE_INTEGRAL: state.upgrades.integralStacks || 0,
      BLUE_SLOW: state.upgrades.slowStacks || 0,
      BLUE_CONVERGENCE: state.upgrades.convergenceStacks || 0,
      PURPLE_PARTIAL: state.upgrades.partialUnlocked ? 1 : 0,
      PURPLE_STACK: state.upgrades.stackUnlocked ? 1 : 0,
      PURPLE_PARALYZE: state.upgrades.paralyzeUnlocked ? 1 : 0,
      PURPLE_SUPER_EXPAND: state.upgrades.superExpandUnlocked ? 1 : 0,
      GOLD_ETHER: state.upgrades.etherStacks || 0,
    };
    const cur = stacks[effectId];
    if (cur === undefined) return false;
    return cur >= max;
  },

  /** 抽一张卡（按 88.5/10/1.5 加权选稀有度，再在该稀有度池内均匀抽，可传 excludeId 避免重复，
   *  可传 state 让已 cap 的效果不被抽到） */
  drawOne(excludeIds = [], state = null) {
    // 先把已 cap 的效果 ID 加入排除列表
    const allExclude = [...excludeIds];
    if (state) {
      for (const id of Object.keys(this.EFFECTS)) {
        if (this.isEffectCapped(id, state) && !allExclude.includes(id)) {
          allExclude.push(id);
        }
      }
    }

    const r = Math.random();
    let tier;
    // 金色概率随选过以太编辑的次数减半：基础 1.5%，1 次后 0.75%，2 次后 0.375%，3 次后 0.1875% ...
    const etherPicked = state ? (state.upgrades && state.upgrades.etherPickedCount) || 0 : 0;
    // 金色基础概率 2%（彩蛋设计：每选一次以太编辑后概率减半，3 次触发彩蛋）
    const goldProb = 0.02 / Math.pow(2, etherPicked);
    const purpleProb = 0.10;
    const blueProb = 1 - goldProb - purpleProb;  // 蓝色吃掉金色减少的部分
    if (r < blueProb) tier = 'blue';
    else if (r < blueProb + purpleProb) tier = 'purple';
    else tier = 'gold';

    const candidates = this.POOL[tier].filter(id => !allExclude.includes(id));
    if (candidates.length === 0) {
      // 该稀有度全被排除：fallback 到全部池排除后均匀
      const allTiers = ['blue', 'purple', 'gold'];
      const allIds = [];
      for (const t of allTiers) {
        for (const id of this.POOL[t]) {
          if (!allExclude.includes(id)) allIds.push(id);
        }
      }
      if (allIds.length === 0) return null;
      return allIds[Math.floor(Math.random() * allIds.length)];
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  },

  /** 抽 3 张卡：前 2 张随机（去重），第 3 张固定 BLUE_REROLL */
  drawThree(state = null) {
    const first = this.drawOne([], state);
    const second = this.drawOne([first], state);
    return [first, second, 'BLUE_REROLL'];
  },

  /** 颠倒黑白触发后的"刷新"：抽 3 张普通卡，全部去重，且不含 BLUE_REROLL */
  drawThreeNoReroll(state = null) {
    const exclude = ['BLUE_REROLL'];
    const a = this.drawOne(exclude, state);
    const b = this.drawOne([...exclude, a], state);
    const c = this.drawOne([...exclude, a, b], state);
    return [a, b, c];
  },

  // ===== State 工具 =====
  /** 初始化升级状态（在 game.js 的 state 里挂 upgrades 子对象） */
  initState(state) {
    state.upgrades = {
      level: 1,
      scoreAtLastLevel: 0,
      pendingChoice: false,
      pendingCards: [],
      // 各效果累计字段（按需懒初始化，但提前归零便于排查）
      taylorStacks: 0,
      maclaurinStacks: 0,
      integralStacks: 0,
      slowStacks: 0,
      pushcartCharges: 0,
      convergenceStacks: 0,
      rerollsLeft: 0,
      paralyzeUnlocked: false,
      superExpandUnlocked: false,
      superExpandActivatedAtWave: 0,
      // 第二阶段字段（先占位）
      partialUnlocked: false,
      partialTimer: 10.0,
      stackUnlocked: false,
      stackDamage: 0,
      stackTimer: 0,
      etherStacks: 0,
      etherPickedCount: 0,    // 选过以太编辑的次数（影响金色抽卡概率，3 次触发彩蛋）
    };
  },

  // ===== 派生值（供 game.js 读取） =====
  /** 蓝1 体积倍率：1.0 → 1.25 → 1.5625 → 1.953（每层 ×1.25 累乘，封顶 3 层） */
  taylorFactor(state) {
    const n = state.upgrades.taylorStacks || 0;
    if (n <= 0) return 1.0;
    return Math.pow(1.25, Math.min(3, n));
  },

  /** 蓝2 命中半径倍率：1.0 → 1.5 → 2.25（每层 ×1.5 累乘，封顶 2 层） */
  maclaurinFactor(state) {
    const n = state.upgrades.maclaurinStacks || 0;
    if (n <= 0) return 1.0;
    return Math.pow(1.5, Math.min(2, n));
  },

  /** 蓝4 速度倍率：1.0 / 0.8 / 0.64 / 0.5（floor 0.5） */
  slowFactor(state) {
    const n = state.upgrades.slowStacks || 0;
    if (n <= 0) return 1.0;
    return Math.max(0.5, Math.pow(0.8, n));
  },

  /** 金1 衍生：基础伤害加成（+1 每堆叠） */
  etherDamageBonus(state) {
    return state.upgrades.etherStacks || 0;
  },

  /** 金1 衍生：敌速倍率（0.8^n） —— 与 slow 独立通道 */
  etherSpeedFactor(state) {
    const n = state.upgrades.etherStacks || 0;
    return n > 0 ? Math.pow(0.8, n) : 1.0;
  },

  /** 金1 衍生：冷却统一为 1（任何冷却函数发射后冷却数 = 1） */
  etherCooldownActive(state) {
    return (state.upgrades.etherStacks || 0) > 0;
  },

  /** 综合敌速倍率（蓝4 × 金1） —— 应用到 enemy.vy 上 */
  combinedSpeedFactor(state) {
    return this.slowFactor(state) * this.etherSpeedFactor(state);
  },
};
