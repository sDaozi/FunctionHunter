/**
 * 敌人生成系统
 *
 * 敌人类型：
 *   - 'normal'  普通飞船，1HP，100 分（tri / square）
 *   - 'elite'   精英，2HP/3HP（hex 2HP, star 3HP），300/500 分
 *   - 'boss'    BOSS（后期再设，当前未启用）
 */
const Spawner = {
  /**
   * 精英怪启动波表：每个精英 shape 第一次可能出现的波次。
   * 用于「波次 HP 加成」：从启动波起每过 10 波，HP 上限 +1（不封顶）。
   * 与 generateWave 中的概率门槛保持一致；不在表内的 shape（tri/square/penta/star4 子代/dodeca/icosa/sphere）不受加成。
   */
  ELITE_START_WAVE: {
    hex: 1,
    star: 8,
    split: 5,        // 一级 star4（split 母体）
    hexagram: 10,
    hep: 10,
    inv7: 15,
    star7: 15,
    star8: 20,
    star9: 10,
    star10: 20,
  },

  /**
   * 计算精英在指定 wave 时的 HP 加成：每 10 波 +1，从该 shape 的启动波算起。
   * 不在精英表里的 shape 返回 0。
   */
  eliteHpBonus(shape, wave) {
    const startWave = this.ELITE_START_WAVE[shape];
    if (!startWave || !wave) return 0;
    const elapsed = wave - startWave;
    if (elapsed < 10) return 0;   // 启动波那 10 波内不加成
    return Math.floor(elapsed / 10);
  },

  /**
   * 创建一个敌人
   * @param {object} opts { x, y, type, shape, color, vy, hp, wave }
   *   wave: 当前波次，用于计算精英 HP 加成；不传则不加成。
   */
  createEnemy(opts) {
    const baseHp = opts.hp || 1;
    const bonus = (opts.wave !== undefined) ? this.eliteHpBonus(opts.shape, opts.wave) : 0;
    const finalHp = baseHp + bonus;
    // 蓝1 泰勒展开：从全局 Upgrade state 读 size 倍率
    let baseSize = opts.size || 0.5;
    if (typeof Game !== 'undefined' && Game.state && Game.state.upgrades && typeof Upgrade !== 'undefined') {
      baseSize *= Upgrade.taylorFactor(Game.state);
    }
    const enemy = {
      id: Math.random().toString(36).slice(2),
      x: opts.x,
      y: opts.y,
      type: opts.type || 'normal',
      shape: opts.shape || 'tri',
      color: opts.color || '#ff5577',
      vy: opts.vy || -0.3, // 数学坐标下下落（y 减小）
      hp: finalHp,
      maxHp: finalHp,
      size: baseSize, // 数学坐标下的"半径"（含泰勒倍率）
      hit: false,             // 命中标记
      score: opts.score || 100,
      spawnTime: 0,
    };
    if (opts.shape === 'inv7') {
      // 逆七芒星：fireTimer 倒计时到 0 时发射狂热粒子束
      enemy.fireTimer = 4 + Math.random() * 4;  // 首发 4-8 秒（不要一上来就放）
      enemy.fireInterval = 5 + Math.random() * 3;  // 后续每 5-8 秒（每次发射后重新随机）
      enemy.angle = Math.random() * Math.PI * 2;
    }
    if (opts.shape === 'star7') {
      // 正七芒星：fireTimer 倒计时到 0 时发射祝福粒子束
      enemy.fireTimer = 2 + Math.random() * 3;  // 首发 2-5 秒（之前 4-8 秒）
      enemy.angle = Math.random() * Math.PI * 2;
    }
    if (opts.shape === 'star9') {
      // 九芒星：出生时从 5 类函数中随机选 2 类附加禁闭
      const ALL = ['trig', 'const', 'vline', 'power', 'exp'];
      // 随机洗牌取前 2
      for (let i = ALL.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ALL[i], ALL[j]] = [ALL[j], ALL[i]];
      }
      enemy.lockedCategories = [ALL[0], ALL[1]];
      enemy.angle = Math.random() * Math.PI * 2;
    }
    if (opts.shape === 'star10') {
      // 十芒星：fireTimer 倒计时到 0 时发射"毁灭"粒子束
      enemy.fireTimer = 4 + Math.random() * 3;  // 首发 4-7 秒
      enemy.angle = Math.random() * Math.PI * 2;
    }
    if (opts.shape === 'star8') {
      // 八芒星：fogTimer 倒计时进入雾隐；fogActive 状态期间静止 + 半透明烟雾
      enemy.fogTimer = 3 + Math.random() * 4;   // 首次 3-7 秒后进入雾隐
      enemy.fogActive = false;
      enemy.fogDuration = 7;                     // 单次雾隐持续 7 秒（之前 4 秒）
      enemy.fogElapsed = 0;
      enemy.angle = Math.random() * Math.PI * 2;
    }
    if (opts.shape === 'hep') {
      // 七边形：自转角度（用于渲染），触底/被杀都会自爆
      enemy.angle = Math.random() * Math.PI * 2;
      enemy.touchDamage = 3;   // 触底扣 3 命
    }
    if (opts.shape === 'oct') {
      // 八边形精英：每 2 秒向四周发射 4 只扈从
      enemy.angle = Math.random() * Math.PI * 2;
      enemy.spawnTimer = 2.0;        // 倒计时
      enemy.spawnInterval = 2.0;
    }
    if (opts.shape === 'octminion') {
      // 八边形扈从：围绕 master 八边形圆周运动；master 死亡后转为正常下落
      enemy.angle = Math.random() * Math.PI * 2;
      enemy.orbitAngle = opts.orbitAngle !== undefined ? opts.orbitAngle : Math.random() * Math.PI * 2;
      enemy.orbitRadius = opts.orbitRadius !== undefined ? opts.orbitRadius : 1.8;
      enemy.orbitSpeed = 1.5;        // 弧度/秒
      enemy.masterId = opts.masterId || null;  // 关联的八边形 id
      enemy.orbiting = true;          // master 还活着时为 true，死亡后转 false 进入下落
    }
    return enemy;
  },

  /**
   * 根据当前波数生成一波敌人
   * 难度逐渐上升：数量更多、下落更快、出现精英/BOSS
   */
  generateWave(wave, opts) {
    opts = opts || {};
    const sphereWave = !!opts.sphereWave;  // 球波：只产生 1HP 普通小怪（刷得快、纯炮灰）
    const enemies = [];
    const time = performance.now();

    // 难度曲线：数量更多但速度更慢
    // 数量：起点 3，每 12 波 +1，封顶 9（第 72 波到 cap）
    // 出怪数量：5 起步 + 每 10 波 +1，cap 10（之前 3 起步、每 12 波 +1、cap 9）
    let count = Math.min(5 + Math.floor(wave / 10), 10);
    if (sphereWave) count = 8;  // 球波固定 8 只（之前 7）

    // 速度：基础 0.45（之前 0.55），每波 +0.008（90 波 ≈ 1.16）—— 整体慢约 25%
    const baseSpeed = 0.45 + (wave - 1) * 0.008;

    // 精英概率（按优先级 hex > star > split > hexagram > star8 = inv7）：
    // 六边形精英（hex 2HP）：起点 0.10，每波 +0.0040，封顶 0.45（第 89 波）—— 最常见
    let eliteChance = Math.min(0.10 + wave * 0.0040, 0.45);
    // 五角星精英（star 3HP，第 8 波后）：起点 0.08，每波 +0.0036，封顶 0.38（第 91 波）
    let starChance = wave >= 8 ? Math.min(0.08 + (wave - 8) * 0.0036, 0.38) : 0;
    // 四芒星分裂怪（第 5 波起）：起点 0.04，每波 +0.0025，封顶 0.25（第 89 波）
    let splitChance = wave >= 5 ? Math.min(0.04 + (wave - 5) * 0.0025, 0.25) : 0;
    // 六芒星精英（第 10 波起）：起点 0.03，每波 +0.0019，封顶 0.18（第 89 波）
    let hexagramChance = wave >= 10 ? Math.min(0.03 + (wave - 10) * 0.0019, 0.18) : 0;
    // 逆七芒星精英（第 15 波起）：起点 0.02，每波 +0.00135，封顶 0.12（第 89 波）—— 最稀有之一
    let inv7Chance = wave >= 15 ? Math.min(0.02 + (wave - 15) * 0.00135, 0.12) : 0;
    // 正七芒星精英（第 15 波起）：与 inv7 概率相同
    let star7Chance = wave >= 15 ? Math.min(0.02 + (wave - 15) * 0.00135, 0.12) : 0;
    // 八芒星精英（第 20 波起）：起点 0.02，每波 +0.0014，封顶 0.12（第 91 波）—— 最稀有之一
    let star8Chance = wave >= 20 ? Math.min(0.02 + (wave - 20) * 0.0014, 0.12) : 0;
    // 九芒星精英（第 10 波起）：与 star8 概率相同
    let star9Chance = wave >= 10 ? Math.min(0.02 + (wave - 10) * 0.0014, 0.12) : 0;
    // 十芒星精英（第 20 波起）：概率最低，起点 0.01，每波 +0.001，封顶 0.08（第 90 波）
    let star10Chance = wave >= 20 ? Math.min(0.01 + (wave - 20) * 0.001, 0.08) : 0;
    // 八边形精英（第 15 波起）：起点 0.025，每波 +0.0012，封顶 0.10 —— 比十芒星更常见
    let octChance = wave >= 15 ? Math.min(0.025 + (wave - 15) * 0.0012, 0.10) : 0;
    // 七边形精英（第 10 波起）：概率较低，起点 0.02，每波 +0.001，封顶 0.10（第 90 波）
    // 1HP 但触底自爆 3 命，击杀时 AOE 自爆 3 单位 3 伤
    let hepChance = wave >= 10 ? Math.min(0.02 + (wave - 10) * 0.001, 0.10) : 0;
    // 球波次：所有特殊全归零，只刷 1HP 小怪
    if (sphereWave) {
      eliteChance = 0; starChance = 0; splitChance = 0; hexagramChance = 0; inv7Chance = 0; star7Chance = 0; star8Chance = 0; star9Chance = 0; star10Chance = 0; octChance = 0; hepChance = 0;
    }

    for (let i = 0; i < count; i++) {
      // 随机 x（在 -15 到 15 之间，覆盖默认视野和大部分平移区域）
      const x = (Math.random() - 0.5) * 30;
      // 起始 y 在 14-18 之间，错开
      const y = 14 + Math.random() * 4 + i * 0.6;
      
      // 速度有 ±20% 抖动
      const vy = -(baseSpeed * (0.85 + Math.random() * 0.3));
      
      const r = Math.random();
      let type, hp, score, color, shape, size, vyOverride;
      if (r < splitChance) {
        // 一级四芒星：1HP，速度慢，被击中分裂成 2 个次级
        type = 'split';
        hp = 1;
        score = 200;
        color = '#5dffd6';
        shape = 'star4';
        size = 0.6;
        vyOverride = vy * 0.6;
      } else if (r < splitChance + hexagramChance) {
        // 六芒星精英：3HP，下落较慢，自带护盾
        type = 'elite';
        hp = 3;
        score = 600;
        color = '#88ccff';
        shape = 'hexagram';
        size = 0.7;
        vyOverride = vy * 0.55;
      } else if (r < splitChance + hexagramChance + hepChance) {
        // 七边形精英：1HP，速度较快，触底自爆 3 命，被击杀时 AOE 自爆 3 单位 3 伤
        type = 'elite';
        hp = 1;
        score = 400;
        color = '#ff8844';
        shape = 'hep';
        size = 0.6;
        vyOverride = vy * 1.5;   // 速度较快
      } else if (r < splitChance + hexagramChance + hepChance + inv7Chance) {
        // 逆七芒星精英：2HP，下落很慢，每 5-8 秒朝随机怪发射狂热粒子束
        type = 'elite';
        hp = 2;
        score = 700;
        color = '#ff3344';
        shape = 'inv7';
        size = 0.7;
        vyOverride = vy * 0.45;  // 下落很慢
      } else if (r < splitChance + hexagramChance + hepChance + inv7Chance + star7Chance) {
        // 正七芒星精英：10HP，下落极慢，每 10 秒朝随机怪发射祝福粒子束（伤害承担）
        type = 'elite';
        hp = 10;
        score = 1200;
        color = '#44dd88';
        shape = 'star7';
        size = 0.75;
        vyOverride = vy * 0.30;  // 下落极慢
      } else if (r < splitChance + hexagramChance + hepChance + inv7Chance + star7Chance + star8Chance) {
        // 八芒星精英：3HP，每隔 4-10 秒进入"雾隐"状态遮挡视野
        type = 'elite';
        hp = 3;
        score = 800;
        color = '#bbbbcc';
        shape = 'star8';
        size = 0.75;
        vyOverride = vy * 0.5;
      } else if (r < splitChance + hexagramChance + hepChance + inv7Chance + star7Chance + star8Chance + star9Chance) {
        // 九芒星精英：3HP，速度极慢，出生时随机封禁 2 个函数类别
        type = 'elite';
        hp = 3;
        score = 900;
        color = '#ffaa44';
        shape = 'star9';
        size = 0.78;
        vyOverride = vy * 0.25;  // 极慢
      } else if (r < splitChance + hexagramChance + hepChance + inv7Chance + star7Chance + star8Chance + star9Chance + star10Chance) {
        // 十芒星精英：15HP，速度极为缓慢，每 3-6 秒发射黑色"毁灭"粒子束
        type = 'elite';
        hp = 15;
        score = 1500;
        color = '#222233';
        shape = 'star10';
        size = 0.85;
        vyOverride = vy * 0.20;  // 极为缓慢
      } else if (r < splitChance + hexagramChance + hepChance + inv7Chance + star7Chance + star8Chance + star9Chance + star10Chance + octChance) {
        // 八边形精英：5HP，移动慢，每 2 秒向四周发射 4 只扈从
        type = 'elite';
        hp = 5;
        score = 1000;
        color = '#ffd700';   // 金光
        shape = 'oct';
        size = 0.78;
        vyOverride = vy * 0.30;
      } else if (r < splitChance + hexagramChance + hepChance + inv7Chance + star7Chance + star8Chance + star9Chance + star10Chance + octChance + starChance) {
        // 星形精英：3HP
        type = 'elite';
        hp = 3;
        score = 500;
        color = '#ff5577';
        shape = 'star';
        size = 0.7;
      } else if (r < splitChance + hexagramChance + hepChance + inv7Chance + star7Chance + star8Chance + star9Chance + star10Chance + octChance + starChance + eliteChance) {
        // 六边形精英：2HP
        type = 'elite';
        hp = 2;
        score = 300;
        color = '#b88dff';
        shape = 'hex';
        size = 0.6;
      } else {
        type = 'normal';
        hp = 1;
        score = 100;
        color = '#ffaa33';
        shape = ['tri', 'square'][Math.floor(Math.random() * 2)];
        size = 0.45;
      }
      
      enemies.push(this.createEnemy({
        x, y, type, shape, color,
        vy: vyOverride !== undefined ? vyOverride : vy,
        hp, score, size,
        wave,
      }));
    }
    return enemies;
  },

  /**
   * 创建一个次级四芒星（由一级被击中后分裂产生）
   * 1HP，速度正常（普通敌人速度），不再分裂
   */
  createSplitChild(opts) {
    const baseSpeed = opts.baseSpeed || 0.55;
    return {
      id: Math.random().toString(36).slice(2),
      x: opts.x,
      y: opts.y,
      type: 'split_child',     // 子代不再分裂
      shape: 'star4',           // 同样四芒星造型，但更小
      color: '#7df0ff',         // 颜色稍微浅一点区分
      vy: -baseSpeed * (0.85 + Math.random() * 0.3),
      hp: 1,
      maxHp: 1,
      size: 0.42,
      hit: false,
      score: 100,
      spawnTime: 0,
    };
  },

  /**
   * 更新敌人位置（随时间下落）
   * dt 单位：秒
  /**
   * 更新敌人位置（随时间下落）
   * dt 单位：秒
   *
   * 普通敌人：仅 y 方向下落
   * penta wanderer（boss 投掷的五边形）：垃圾鱼式拖动 — 维护 wanderTargetVx，
   *   每隔 wanderRetargetIn 秒重新随机 vx 目标，当前 vx 平滑插值过去
   */
  update(enemy, dt) {
    // 被牵引中的敌人：忽略普通运动，沿直线向 absorbTarget 移动
    if (enemy.absorbing && enemy.absorbTarget) {
      enemy.absorbProgress = (enemy.absorbProgress || 0) + dt / (enemy.absorbDuration || 1.0);
      const t = Math.min(1, enemy.absorbProgress);
      // 缓入二次（开始慢、末段快，像被加速吸进去）
      const eased = t * t;
      enemy.x = enemy.absorbStart.x + (enemy.absorbTarget.x - enemy.absorbStart.x) * eased;
      enemy.y = enemy.absorbStart.y + (enemy.absorbTarget.y - enemy.absorbStart.y) * eased;
      return;
    }
    // 冰冻状态：什么都不做（boss 不会被冻 — 由 game.js 拒绝标记 boss）
    if (enemy.frozen) return;
    // 黑烟状态（被毁灭怪复活前）：完全静止，不下落、不发射、不雾隐
    if (enemy.smokeTimer > 0) {
      enemy.smokeTimer -= dt;
      // 黑烟时间结束时由 game.js 处理复活（这里只倒计时，不主动复活）
      return;
    }
    // 雾隐状态（star8 进入雾隐期间）：完全静止
    if (enemy.fogActive) {
      // 仍处理 fogElapsed 倒计时
      enemy.fogElapsed += dt;
      if (enemy.fogElapsed >= enemy.fogDuration) {
        enemy.fogActive = false;
        enemy.fogElapsed = 0;
        enemy.fogTimer = 4 + Math.random() * 6;  // 下次 4-10 秒后再雾隐
      }
      return;
    }
    // 紫3 麻痹大意：倒计时（独立于速度因子；用 0.5×）
    let paralyzeFactor = 1.0;
    if (enemy.paralyzeRemain && enemy.paralyzeRemain > 0) {
      enemy.paralyzeRemain -= dt;
      if (enemy.paralyzeRemain > 0) paralyzeFactor = 0.5;
      else enemy.paralyzeRemain = 0;
    }
    // 蓝4 迟缓 + 金1 以太编辑速度通道（从全局 Upgrade state 读取）
    let upgradeSpeedFactor = 1.0;
    if (typeof Game !== 'undefined' && Game.state && Game.state.upgrades && typeof Upgrade !== 'undefined') {
      upgradeSpeedFactor = Upgrade.combinedSpeedFactor(Game.state);
    }
    enemy.y += enemy.vy * dt * paralyzeFactor * upgradeSpeedFactor;

    // 紫4 渐近线：普通敌人缓慢向 y 轴靠近（每秒 0.2 单位，3 关有效期）
    // 不影响 boss 系：icosa / sphere / dodeca / penta（投掷物） —— 但 penta 是普通"小怪"，受影响
    // 只跳过 icosa（三角二十面体）、函数队列怪，其它 boss 不在 s.enemies 列表里
    if (typeof Game !== 'undefined' && Game.state && Game.state.upgrades && Game.state.upgrades.asymptoteUnlocked) {
      if (enemy.shape !== 'icosa' && !enemy.queueEventId) {
        const ASYMPTOTE_SPEED = 0.2;
        const dx = ASYMPTOTE_SPEED * dt;
        if (enemy.x > dx) enemy.x -= dx;
        else if (enemy.x < -dx) enemy.x += dx;
        else enemy.x = 0;  // 接近 0 时直接吸附，避免抖动
      }
    }
    // 投掷阶段（penta 出生 0.6 秒）：vx 自然衰减不被 wander 干扰，让它先飞出去散开
    if (enemy.throwTimer > 0) {
      enemy.throwTimer -= dt;
      // 摩擦：每秒衰减约 90%（k = 1 - exp(-dt * 2.5)），适配新的 4x 大速度
      const fk = 1 - Math.exp(-dt * 2.5);
      enemy.vx = (enemy.vx || 0) - (enemy.vx || 0) * fk;
      enemy.x += enemy.vx * dt;
      // 边界软回弹（投掷期间也防越界）
      if (enemy.x > 15 && enemy.vx > 0) enemy.vx = -Math.abs(enemy.vx) * 0.5;
      if (enemy.x < -15 && enemy.vx < 0) enemy.vx = Math.abs(enemy.vx) * 0.5;
      // 投掷期间不要 wander 干预，但仍允许其他逻辑跑（icosa 自转 / inv7 计时）
    } else if (enemy.wanderTargetVx !== undefined) {
      // 通用左右拖动：任何带 wanderTargetVx 字段的敌人（penta / icosa）
      const range = enemy.wanderRange !== undefined ? enemy.wanderRange : 1.0;
      enemy.wanderRetargetIn -= dt;
      if (enemy.wanderRetargetIn <= 0) {
        enemy.wanderTargetVx = (Math.random() - 0.5) * 2 * range;
        enemy.wanderRetargetIn = 0.6 + Math.random() * 1.0;
      }
      const k = 1 - Math.exp(-dt * 3);
      enemy.vx = (enemy.vx || 0) + (enemy.wanderTargetVx - (enemy.vx || 0)) * k;
      enemy.x += enemy.vx * dt;
      if (enemy.x > 15 && enemy.vx > 0) enemy.wanderTargetVx = -Math.abs(enemy.wanderTargetVx);
      if (enemy.x < -15 && enemy.vx < 0) enemy.wanderTargetVx = Math.abs(enemy.wanderTargetVx);
    }
    if (enemy.shape === 'icosa') {
      enemy.angle = (enemy.angle || 0) + dt * 0.5;
      // 生长计时（只对非顶级有效，顶级 growTime=0）
      if (enemy.growTime > 0) {
        enemy.growTimer = (enemy.growTimer || 0) + dt;
      }
    }
    if (enemy.shape === 'inv7') {
      enemy.angle = (enemy.angle || 0) - dt * 0.4;  // 反向旋转更"邪"
      // 被毁灭：失去技能 → 停止 fireTimer 推进
      if (!enemy.doomedBy) enemy.fireTimer -= dt;
    }
    if (enemy.shape === 'star7') {
      enemy.angle = (enemy.angle || 0) + dt * 0.35;  // 正向旋转（与 inv7 相反）
      if (!enemy.doomedBy) enemy.fireTimer -= dt;
    }
    if (enemy.shape === 'star9') {
      enemy.angle = (enemy.angle || 0) + dt * 0.25;  // 缓慢自转（庄严感）
    }
    if (enemy.shape === 'star10') {
      enemy.angle = (enemy.angle || 0) + dt * 0.20;  // 极慢自转
      enemy.fireTimer -= dt;   // star10 不会被毁灭，所以无需守卫
    }
    if (enemy.shape === 'hep') {
      enemy.angle = (enemy.angle || 0) + dt * 0.6;   // 较快自转（速度快）
    }
    if (enemy.shape === 'oct') {
      enemy.angle = (enemy.angle || 0) + dt * 0.4;
      // spawnTimer 在 game.js 里推进（需要访问 s.enemies 数组）
    }
    if (enemy.shape === 'octminion') {
      // 扈从：master 还活着时围绕 master 圆周运动；死亡后转为正常下落
      if (enemy.orbiting && enemy.masterId && typeof Game !== 'undefined' && Game.state) {
        const master = Game.state.enemies.find(e => e.id === enemy.masterId && e.shape === 'oct' && e.hp > 0);
        if (master) {
          enemy.orbitAngle += enemy.orbitSpeed * dt;
          enemy.x = master.x + Math.cos(enemy.orbitAngle) * enemy.orbitRadius;
          enemy.y = master.y + Math.sin(enemy.orbitAngle) * enemy.orbitRadius;
          // 抵消正常的 vy 推进（已在前面 enemy.y += vy * dt 加过，需回退）
          enemy.y -= enemy.vy * dt * paralyzeFactor * upgradeSpeedFactor;
        } else {
          // master 已死：转为下落模式，朝当前 orbitAngle 方向飞散
          enemy.orbiting = false;
          // 以 orbit 切线方向给一个轻微初速度（飞散感，但不要太快）
          const tangent = enemy.orbitAngle + Math.PI / 2;
          enemy.vx = Math.cos(tangent) * 3.0;
          enemy.vy = -1.4;   // 比普通敌人快约 2.5 倍（普通约 -0.45 ~ -0.6）
        }
      } else if (!enemy.orbiting) {
        // 飞散后正常下落 + 水平摩擦
        const fk = 1 - Math.exp(-dt * 1.5);
        enemy.vx = (enemy.vx || 0) - (enemy.vx || 0) * fk;
        enemy.x += enemy.vx * dt;
        // 边界软回弹
        if (enemy.x > 15) enemy.x = 15;
        if (enemy.x < -15) enemy.x = -15;
      }
      enemy.angle = (enemy.angle || 0) + dt * 1.5;
    }
    if (enemy.shape === 'star8') {
      enemy.angle = (enemy.angle || 0) + dt * 0.3;
      // 被毁灭：失去技能 → 不再雾隐计时
      if (enemy.doomedBy) {
        // 已在雾中？立即退出雾隐避免视觉穿帮
        enemy.fogActive = false;
        enemy.fogElapsed = 0;
      } else if (!enemy.fogActive) {
        enemy.fogTimer -= dt;
        if (enemy.fogTimer <= 0) {
          enemy.fogActive = true;
          enemy.fogElapsed = 0;
        }
      }
    }
    // 被强化怪：发出红光的同时仍按原 vy 移动（vy 已在 game.js 加倍）
  },

  /**
   * 创建一个 boss 投掷的五边形小怪
   * 与普通小怪同速度（约 0.55），1HP，随机左右拖动
   */
  createPentaWanderer(opts) {
    const baseSpeed = opts.baseSpeed || 0.55;
    // 横向投掷：随机方向、12-24 单位/秒初速度（之前 3-6，现增大 4 倍）
    // 投出后 0.6 秒内不被 wander 重定向，让它先飞出去散开
    const throwVx = (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 12);
    return {
      id: Math.random().toString(36).slice(2),
      x: opts.x,
      y: opts.y,
      type: 'penta',
      shape: 'penta',
      color: '#9d6dff',     // 紫罗兰，跟 boss 同色系
      vy: -baseSpeed * (0.85 + Math.random() * 0.3),
      vx: throwVx,                // 初速度
      throwTimer: 0.6,            // 投掷阶段倒计时（这段时间禁用 wander 干扰）
      wanderTargetVx: (Math.random() - 0.5) * 2,
      wanderRetargetIn: 0.6 + Math.random() * 1.0,
      wanderRange: 1.0,           // 拖动峰值范围（±1.0）
      hp: 1,
      maxHp: 1,
      size: 0.42,
      hit: false,
      score: 50,            // 击杀分数较低，因为目的是打 boss
      spawnTime: 0,
    };
  },

  /**
   * 三角二十面体配置：每级的 hp / size / score / color
   * tier 1 = 顶级，4 = 终级
   */
  ICOSA_TIERS: [
    null,
    { hp: 5, size: 2.0, score: 4000, color: '#ffd45d', label: '三角二十面体' },
    { hp: 3, size: 1.4, score: 1500, color: '#ffaa33', label: '亚-三角二十面体' },
    { hp: 2, size: 0.95, score: 600, color: '#ff7a00', label: '次-三角二十面体' },
    { hp: 1, size: 0.6, score: 200, color: '#ff5577', label: '终-三角二十面体' },
  ],

  /**
   * 创建一个三角二十面体（icosahedron）
   * 与原 boss 类似但可被激光直接命中、有多级分裂、缓慢下落
   * tier: 1=顶级, 2=亚, 3=次, 4=终
   */
  createIcosa(tier, opts) {
    const cfg = this.ICOSA_TIERS[tier];
    if (!cfg) return null;
    opts = opts || {};
    const wave = opts.wave || 1;
    // HP 随波次提升：每 20 波 +1（第 20 波 cfg.hp，第 80 波 cfg.hp+3）
    const hpBoost = Math.floor(wave / 20);
    const hp = cfg.hp + hpBoost;
    // 生长时间随波次缩短：第 20 波 18s，第 80 波 14s，第 110 波 11s（最低 8s）
    const baseGrowTime = tier > 1 ? Math.max(8, 18 - Math.floor(wave / 20) * 1.5) : 0;
    // 基础下落速度 0.20，每只 ±25% 抖动 → 实际范围 -0.15 ~ -0.25
    const baseVy = -0.20 * (0.75 + Math.random() * 0.5);
    return {
      id: 'icosa-' + Math.random().toString(36).slice(2),
      x: opts.x !== undefined ? opts.x : 0,
      y: opts.y !== undefined ? opts.y : 20,
      type: 'icosa' + tier,
      shape: 'icosa',
      tier: tier,
      color: cfg.color,
      vy: baseVy,
      vx: 0,
      wanderTargetVx: (Math.random() - 0.5) * 1.2,
      wanderRetargetIn: 0.6 + Math.random() * 1.0,
      wanderRange: 0.6,
      hp: hp,
      maxHp: hp,
      size: cfg.size,
      hit: false,
      // 顶级(tier 1)按 BOSS 标准给奖励：12000 × 1.5^(appearance-1)
      //   第 10 波 12000 / 第 35 波 18000 / 第 60 波 27000 / 第 85 波 40500
      // 子代（分裂出来的亚/次/终级）保留原始 cfg.score（按小怪处理）
      score: tier === 1
        ? Math.round(12000 * Math.pow(1.5, Math.max(1, Math.floor((wave + 15) / 25)) - 1))
        : cfg.score + hpBoost * 200,
      spawnTime: 0,
      angle: Math.random() * Math.PI * 2,
      growTimer: 0,
      growTime: baseGrowTime,
      // 记录创建时的 wave 给分裂子代继承
      spawnWave: wave,
    };
  },

  /**
   * 创建球 BOSS（黑洞）
   * 固定 (0, 15)，可被激光打，体积随 HP 增长
   * size = 0.5 + 0.15 * HP 对应：HP 10 → 2.0；HP 50 → 8.0；HP 97 → 15.05（触底 GG）
   */
  SPHERE_INIT_HP: 10,
  sphereSize(hp) { return 0.5 + 0.15 * hp; },

  createSphere(opts) {
    opts = opts || {};
    const hp = this.SPHERE_INIT_HP;
    const wave = opts.wave || 15;
    // 击败奖励：18000 × 1.5^(appearance-1)
    //   第 15 波 18000 / 第 40 波 27000 / 第 65 波 40500 / 第 90 波 60750
    const appearance = Math.max(1, Math.floor((wave + 10) / 25));
    const score = Math.round(18000 * Math.pow(1.5, appearance - 1));
    return {
      id: 'sphere-' + Math.random().toString(36).slice(2),
      x: 0,
      y: 15,
      type: 'sphere',
      shape: 'sphere',
      color: '#1a0033',
      vy: 0,
      vx: 0,
      hp: hp,
      maxHp: hp,
      size: this.sphereSize(hp),
      hit: false,
      score: score,
      spawnTime: 0,
      // 吸收计时器
      absorbTimer: 1.5 + Math.random() * 1.5,  // 首次吸收 1.5–3 秒
      // 自转动画
      angle: 0,
    };
  },

  /**
   * 创建 BOSS：立方体 · 赌徒
   * 固定 (0, 15)，不下落，免疫所有伤害
   * 每 10 秒投一次骰子：1=自扣血 / 2=召唤10小怪 / 3=全场狂热 / 4=召唤3八芒星 / 5=投5七边形 / 6=投10狂热七边形
   * 出现波次：40 / 80 / 120 / ... HP 每次出现 +2 (40→5, 80→7, 120→9)
   */
  createGambler(opts) {
    opts = opts || {};
    const wave = opts.wave || 20;
    // 每次出现 +2 HP：第 1 次 5 HP / 第 2 次 7 / 第 3 次 9 / ...
    const appearance = Math.max(1, Math.floor((wave + 5) / 25));
    const hp = 3 + appearance * 2;
    return {
      id: 'gambler-' + Math.random().toString(36).slice(2),
      x: 0,
      y: 15,
      type: 'gambler',
      shape: 'gambler',
      color: '#c8cfd6',       // 银色基调
      vy: 0,
      vx: 0,
      hp: hp,
      maxHp: hp,
      size: 2.0,
      hit: false,
      score: Math.round(27000 * Math.pow(1.5, appearance - 1)),
      spawnTime: 0,
      // 投骰子计时器：首次 4 秒后投，之后固定 10 秒
      diceTimer: 4.0,
      diceInterval: 10.0,
      // 骰子动画状态：null = 待机；object = 正在旋转/展示
      // { phase: 'spinning'|'reveal', elapsed: 0, duration, result: 1-6 }
      dice: null,
      // BOSS 本体动画：缓慢自转 + 呼吸
      angle: 0,
      bodyPulse: 0,
      // 最近一次骰子结果（用于显示历史小提示）
      lastResult: null,
    };
  },

  /**
   * 创建 BOSS：正八面体 · 帝皇
   * 固定 (0, 18)，不下落，可被激光击中
   * 三阶段总血 100 (20/30/50)：
   *   阶段 1 (HP 81-100)：每 7s 朝 4 个方向(下/左下/右下/正下)发射小三角形
   *   阶段 2 (HP 51-80)：每 1s 发射 1 颗随机方向(强制向下)的红色弹幕
   *   阶段 3 (HP 0-50)：几何登基 —— 每 3s 弹幕 + 90s 倒计时秒杀
   * 出现波次：50 / 100 / 150 / ... HP 随波次增加 +20 (50→100, 100→120, 150→140)
   * 击败奖励：36000 × 1.5^(appearance-1)
   *   第 50 波 36000 / 第 100 波 54000 / 第 150 波 81000 / 第 200 波 121500
   */
  createEmperor(opts) {
    opts = opts || {};
    const wave = opts.wave || 25;
    const appearance = Math.max(1, Math.floor(wave / 25));
    // 各阶段血量随出现次数提升
    // 第 25 波 20/30/50=100；第 50 波 24/36/60=120；第 75 波 28/42/70=140
    const phase1Hp = 20 + (appearance - 1) * 4;
    const phase2Hp = 30 + (appearance - 1) * 6;
    const phase3Hp = 50 + (appearance - 1) * 10;
    const totalHp = phase1Hp + phase2Hp + phase3Hp;
    const score = Math.round(36000 * Math.pow(1.5, appearance - 1));
    return {
      id: 'emperor-' + Math.random().toString(36).slice(2),
      x: 0,
      y: 18,
      type: 'emperor',
      shape: 'emperor',
      color: '#ffd45d',   // 金色基调
      vy: 0,
      vx: 0,
      hp: totalHp,
      maxHp: totalHp,
      // 各阶段阈值（向下计数）
      phase1Threshold: phase2Hp + phase3Hp,   // 进入阶段 2 的 HP 值
      phase2Threshold: phase3Hp,              // 进入阶段 3 的 HP 值
      phase1Hp: phase1Hp,
      phase2Hp: phase2Hp,
      phase3Hp: phase3Hp,
      // 当前阶段 1/2/3
      phase: 1,
      // 阶段转换无敌期（玩家打不动）
      invulnTimer: 0,
      // 计时器
      triFireTimer: 7.0,        // 阶段 1：四方三角形
      projectileTimer: 1.0,     // 阶段 2/3：弹幕
      // 几何登基：阶段 3 开始时初始化为 90.0
      coronationTimer: 0,
      coronationActive: false,
      size: 1.6,
      hit: false,
      score: score,
      spawnTime: 0,
      // 自身动画
      angle: 0,
      bodyPulse: 0,
      // 标记本次出现的波次（用于 HUD 显示）
      spawnWave: wave,
    };
  },

  /**
   * 创建 boss：五角十二面体（dodecahedron 二维投影：五角星嵌套五边形）
   * 固定 (0, 20)，不下落，不可被激光直接击中
   *
   * 击败奖励：9000 × 1.5^(appearance-1)
   *   第 1 次(wave 5) 9000 / 第 2 次(30) 13500 / 第 3 次(55) 20250 / 第 4 次(80) 30375
   */
  createBoss(opts) {
    opts = opts || {};
    const wave = opts.wave || 5;
    const appearance = Math.max(1, Math.floor((wave + 20) / 25));
    const score = Math.round(9000 * Math.pow(1.5, appearance - 1));
    return {
      id: 'boss-' + Math.random().toString(36).slice(2),
      x: 0,
      y: 20,
      type: 'boss',
      shape: 'dodeca',     // 五角十二面体
      color: '#ff5dd6',
      vy: 0,
      vx: 0,
      hp: 1,               // 形式上的 hp（其实通过五边形击杀计数判定死亡）
      maxHp: 1,
      size: 2.0,
      hit: false,
      score: score,
      spawnTime: 0,
      // boss 专属：投掷计时器
      throwInterval: opts.throwInterval || 3.0,  // 每 3.0 秒投一个
      throwTimer: 1.0,                             // 首次投出延迟 1.0 秒
      // 自身呼吸/旋转动画用
      angle: 0,
    };
  },

  /**
   * 检查敌人是否触底（y < 0 表示已经穿过原点 = 触底）
   */
  reachedBottom(enemy) {
    return enemy.y <= 0;
  },

  /**
   * 检查曲线是否击中敌人
   *
   * 算法：用"局部最近点"判定。
   *   1. 在敌人 x 附近的小窗口内（±0.7 单位）密集采样函数 y 值
   *   2. 计算每个采样点到敌人中心的欧氏距离
   *   3. 取最小距离，与 hitRadius + enemy.size 比较
   *
   * 间断点处理：如果相邻样本 y 跳跃 > 50（如 1/x 跨越 x=0），
   * 不连线段（避免虚假命中）
   */
  curveHits(enemy, fn, _xRangeIgnored, hitRadius = 0.5) {
    const ex = enemy.x;
    const ey = enemy.y;
    const window = 0.7;
    const samples = 30;
    const step = (window * 2) / samples;
    const JUMP_THRESHOLD = 50;  // y 跳跃阈值（视野高度约 14）
    let minDistSq = Infinity;
    let prevValid = null;
    for (let i = 0; i <= samples; i++) {
      const x = ex - window + i * step;
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
      // 当前采样点距离
      const dx = x - ex;
      const dy = y - ey;
      const distSq = dx * dx + dy * dy;
      if (distSq < minDistSq) minDistSq = distSq;
      // 与上一个采样点构成线段
      if (prevValid && Math.abs(y - prevValid.y) < JUMP_THRESHOLD) {
        const segDistSq = this._pointToSegDistSq(ex, ey, prevValid.x, prevValid.y, x, y);
        if (segDistSq < minDistSq) minDistSq = segDistSq;
      }
      prevValid = { x, y };
    }
    const radius = hitRadius + enemy.size;
    return minDistSq < radius * radius;
  },

  /**
   * 通用形状击中检测（函数 + 几何统一入口）
   * 委托给 shape.distSq；hitRadius 与 curveHits 一致
   */
  shapeHits(enemy, shape, hitRadius = 0.5) {
    if (!shape || typeof shape.distSq !== 'function') return false;
    const dsq = shape.distSq(enemy.x, enemy.y);
    const r = hitRadius + enemy.size;
    return dsq < r * r;
  },

  /** 点到线段距离的平方（避免开方） */
  _pointToSegDistSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const ddx = px - ax, ddy = py - ay;
      return ddx * ddx + ddy * ddy;
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const ddx = px - cx, ddy = py - cy;
    return ddx * ddx + ddy * ddy;
  },
};
