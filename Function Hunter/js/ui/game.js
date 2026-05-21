/**
 * 游戏主循环
 */
const Game = {
  // 状态
  running: false,
  paused: false,
  canvas: null,
  ctx: null,
  
  // 游戏数据
  state: null,
  
  /** 启动新游戏 */
  start() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this._resizeCanvas();
    Coords.resetPan();
    
    // 加载持久化的函数库
    Library.load();
    Library.reset();
    // 重置函数队列事件管理器
    if (typeof FunctionEvent !== 'undefined') FunctionEvent.reset();
    
    this.state = {
      score: 0,
      combo: 1,
      comboTimer: 0,        // combo 维持倒计时（秒），命中后刷新到 2.5 秒；归零后 combo 重置为 1
      maxCombo: 1,
      kills: 0,
      lives: 3,
      baseDamage: 1,        // 激光基础伤害（彩蛋触发后变 10）
      globalFireCooldown: 0, // 全局发射冷却（秒）—— 任何函数发射后进入 1 秒冷却,偏微分/lv.999 不受影响
      wave: 0,            // 0 = 教程波次，玩家完成教程后推进到 1
      enemies: [],
      lasers: [],
      pickups: [],          // 掉落物 [{id,x,y,vy,type,age}]
      damageBoostShots: 0,  // 复合函数包：剩余威力翻倍发射次数
      boss: null,           // 五角十二面体 BOSS（每 25 波周期，% 25 === 5：5/30/55...）
      pentaKillCount: 0,    // 当前 boss 战已击杀的五边形数
      pentaKillGoal: 20,    // 击败 boss 需要的五边形击杀数
      icosaBattle: false,   // 三角二十面体战（每 25 波周期，% 25 === 10：10/35/60...）
      sphere: null,         // 球 BOSS（每 25 波周期，% 25 === 15：15/40/65...，可同时存在普通敌人）
      sphereDeathAnim: null,  // 球死亡动画 {x, y, peakSize, color, age, duration}
      gambler: null,        // 立方体·赌徒 BOSS（每 25 波周期，% 25 === 20：20/45/70...）
      gamblerDeathAnim: null, // 赌徒死亡动画 {x, y, age, duration}
      gamblerPendingSpawns: [], // 赌徒延迟生成队列 {delay, spawnFn} —— 错开召唤，避免偏微分一波清空
      emperor: null,        // 正八面体·帝皇 BOSS（每 25 波周期，% 25 === 0：25/50/75...）
      emperorDeathAnim: null, // 帝皇死亡动画 {x, y, age, duration, bursts:[]}
      emperorPendingSpawns: [], // 帝皇延迟生成队列（阶段 1 的四向三角形错开生成）
      emperorProjectiles: [], // 帝皇红色极光弹幕 {x, y, vx, vy, life, age, color}
      emperorCoronationStrike: null,  // 几何登基秒杀光柱动画 {age, duration}
      inv7Beams: [],        // 逆七芒星发射的粒子束动画 [{fromX,fromY,toX,toY,age,duration}]
      star7Beams: [],       // 正七芒星发射的祝福粒子束动画
      star10Beams: [],      // 十芒星发射的毁灭粒子束动画
      purpleFlash: 0,       // 球死亡紫色全屏闪烁强度（1.0 → 0.0 衰减）
      pendingNextWave: null, // {delay, callback} 延迟推进下一波（让死亡特效播完）
      bossDeathAnim: null,   // 五角十二面体死亡动画 {x, y, color, age, duration, phase} 用于触发分阶段粒子
      freezeTimer: 0,       // 急速制冷-狼：剩余冰冻秒数（>0 时所有非 boss 敌人 frozen=true）
      seenEnemies: this._loadSeenEnemies(),  // 已展示过图鉴的怪物 type 集合（持久化）
      pendingCodex: [],     // 待弹出图鉴的 type 队列
      codexShowing: false,  // 当前是否在显示图鉴弹窗
      particles: [],
      damageNumbers: [],
      previewShape: null,
      previewExpr: '',
      previewError: null,
      lastSpawnTime: 0,
      spawnInterval: 4500,
      timeOfDay: 0,
      lastLibraryRender: 0,
    };
    // 升级系统初始化（添加 state.upgrades 子对象）
    Upgrade.initState(this.state);
    
    this._bindEvents();
    this.running = true;
    this.paused = false;

    // 主动清理所有可能遗留的 overlay（图鉴、暂停、game over、教程、升级）
    document.getElementById('codex-overlay').classList.add('hidden');
    document.getElementById('pause-overlay').classList.add('hidden');
    document.getElementById('gameover-overlay').classList.add('hidden');
    const tutOverlay = document.getElementById('tutorial-overlay');
    if (tutOverlay) tutOverlay.classList.add('hidden');
    const upgOverlay = document.getElementById('upgrade-overlay');
    if (upgOverlay) upgOverlay.classList.add('hidden');

    // 教程波次（wave 0）：不刷怪，启动 Tutorial 引导玩家
    if (this.state.wave === 0) {
      // 等一帧让 DOM 完全渲染（preset-btn 等元素的位置可算）
      requestAnimationFrame(() => Tutorial.start());
    } else {
      this._spawnInitialWave();
    }
    this._renderLibrary();
    this.lastTime = performance.now();
    this._updateHUD();
    document.getElementById('func-input').focus();
    requestAnimationFrame(this._loop);
  },

  /**
   * 教程结束回调：推进到第 1 波
   * 延迟 600ms 让 tutorial overlay 完全消失 + 玩家有短暂喘息，再刷怪
   */
  onTutorialFinish() {
    setTimeout(() => {
      this.state.wave = 1;
      this._spawnInitialWave();
      this._updateHUD();
      showToast('🎮 教程完成！', 3500);
    }, 600);
  },
  
  stop() {
    this.running = false;
    // 退出时也保存最高分（死亡时已经会保存，但暂停 → 主菜单也要计入）
    if (this.state && typeof this.state.score === 'number') {
      try {
        const best = parseInt(localStorage.getItem('fh_best') || '0', 10) || 0;
        if (this.state.score > best) {
          localStorage.setItem('fh_best', this.state.score);
        }
      } catch (e) {}
    }
  },

  _bindEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;
    
    const input = document.getElementById('func-input');
    const fireBtn = document.getElementById('fire-btn');
    
    // 实时预览
    const inputPrompt = document.getElementById('input-prompt');
    const updatePromptVisibility = (expr) => {
      if (!inputPrompt) return;
      // 含 = 视为几何/方程，隐藏「y =」前缀
      inputPrompt.classList.toggle('hidden', expr.includes('='));
    };
    input.addEventListener('input', () => {
      const expr = input.value.trim();
      updatePromptVisibility(expr);
      this.state.previewExpr = expr;
      if (!expr) {
        this.state.previewShape = null;
        this.state.previewError = null;
        document.getElementById('error-msg').textContent = '';
        return;
      }
      const { shape, error } = Shape.compile(expr);
      this.state.previewShape = shape;
      this.state.previewError = error;
      document.getElementById('error-msg').textContent = error || '';
    });
    
    // 回车发射
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._fire();
      }
    });
    
    fireBtn.addEventListener('click', () => this._fire());

    // 预设函数下拉
    const presetBtn = document.getElementById('preset-btn');
    const presetMenu = document.getElementById('preset-menu');
    if (presetBtn && presetMenu) {
      presetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !presetMenu.classList.contains('hidden');
        presetMenu.classList.toggle('hidden', isOpen);
        presetBtn.classList.toggle('open', !isOpen);
      });
      // 点菜单外区域关闭
      document.addEventListener('click', (e) => {
        if (presetMenu.classList.contains('hidden')) return;
        if (presetMenu.contains(e.target) || presetBtn.contains(e.target)) return;
        presetMenu.classList.add('hidden');
        presetBtn.classList.remove('open');
      });
    }

    // 提示标签：填入输入栏并关闭下拉菜单
    document.querySelectorAll('[data-snippet]').forEach(tag => {
      tag.addEventListener('click', () => {
        const snippet = tag.dataset.snippet;
        input.value = snippet;
        input.dispatchEvent(new Event('input'));
        input.focus();
        if (presetMenu) {
          presetMenu.classList.add('hidden');
          presetBtn && presetBtn.classList.remove('open');
        }
      });
    });
    
    // 暂停
    document.getElementById('pause-btn').addEventListener('click', () => this._togglePause());
    document.getElementById('resume-btn').addEventListener('click', () => this._togglePause());
    document.getElementById('restart-btn').addEventListener('click', () => {
      document.getElementById('pause-overlay').classList.add('hidden');
      this.start();
    });
    document.getElementById('quit-btn').addEventListener('click', () => {
      document.getElementById('pause-overlay').classList.add('hidden');
      this.stop();
      Screen.show('menu');
      Menu.init();
      Sound.playBgm('menu');
    });

    // 图鉴弹窗：继续按钮
    document.getElementById('codex-continue').addEventListener('click', () => {
      this._closeCodexEntry();
    });
    
    // Game over
    document.getElementById('gover-retry').addEventListener('click', () => {
      document.getElementById('gameover-overlay').classList.add('hidden');
      this.start();
      Sound.playBgm('battle');
    });
    document.getElementById('gover-quit').addEventListener('click', () => {
      document.getElementById('gameover-overlay').classList.add('hidden');
      this.stop();
      Screen.show('menu');
      Menu.init();
      Sound.playBgm('menu');
    });
    
    // 键盘：ESC 暂停，R 重置视野
    document.addEventListener('keydown', (e) => {
      if (!this.running) return;
      if (this.state && this.state.codexShowing) return;  // 图鉴弹窗时不响应快捷键
      if (e.key === 'Escape') {
        this._togglePause();
      } else if ((e.key === 'r' || e.key === 'R') && document.activeElement !== input) {
        this._viewTween = null;
        Coords.resetPan();
      }
    });

    // ============ 调试组合键：a+o+e 同时按下清屏（不在输入框内） ============
    this._debugPressed = new Set();
    document.addEventListener('keydown', (e) => {
      if (!this.running) return;
      if (document.activeElement === input) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'a' || k === 'o' || k === 'e') {
        this._debugPressed.add(k);
        if (this._debugPressed.has('a') &&
            this._debugPressed.has('o') &&
            this._debugPressed.has('e')) {
          this._debugClearAll();
        }
      }
    });
    document.addEventListener('keyup', (e) => {
      const k = (e.key || '').toLowerCase();
      if (k === 'a' || k === 'o' || k === 'e') {
        this._debugPressed.delete(k);
      }
    });
    // 窗口失焦时清键集（避免按键卡住）
    window.addEventListener('blur', () => { this._debugPressed.clear(); });

    // ============ 调试组合键：b+s+1/2/3/4 同时按下跳到对应 BOSS 关 ============
    // 1 → penta(10 波) / 2 → icosa(20 波) / 3 → sphere(30 波) / 4 → gambler(40 波)
    // 必须 b 和 s 都按住，再按数字才触发；释放任一即失效，避免误触
    this._bossSkipPressed = new Set();
    document.addEventListener('keydown', (e) => {
      if (!this.running) return;
      if (document.activeElement === input) return;
      if (this.state && this.state.codexShowing) return;  // 图鉴弹窗时不响应
      const k = (e.key || '').toLowerCase();
      if (k === 'b' || k === 's') {
        this._bossSkipPressed.add(k);
        return;
      }
      // 仅在 b+s 都按住时，数字键才作为跳关触发
      if (this._bossSkipPressed.has('b') && this._bossSkipPressed.has('s')) {
        if (k === '1') { this._debugSkipToBoss(5); }
        else if (k === '2') { this._debugSkipToBoss(10); }
        else if (k === '3') { this._debugSkipToBoss(15); }
        else if (k === '4') { this._debugSkipToBoss(20); }
        else if (k === '5') { this._debugSkipToBoss(25); }
      }
    });
    document.addEventListener('keyup', (e) => {
      const k = (e.key || '').toLowerCase();
      if (k === 'b' || k === 's') {
        this._bossSkipPressed.delete(k);
      }
    });
    window.addEventListener('blur', () => { this._bossSkipPressed.clear(); });
    
    // 窗口大小变化
    window.addEventListener('resize', () => {
      if (this.canvas) this._resizeCanvas();
    });
    // 移动端：地址栏伸缩 / 屏幕旋转专用事件（resize 在某些浏览器不触发）
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        if (this.canvas) this._resizeCanvas();
      });
    }
    window.addEventListener('orientationchange', () => {
      // orientationchange 后 layout 还在过渡，延迟一帧再重算
      setTimeout(() => { if (this.canvas) this._resizeCanvas(); }, 100);
    });
    
    // ============ 拖动平移视野 ============
    this._bindCanvasDrag();
    
    // 重置视野按钮
    const resetBtn = document.getElementById('reset-view-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this._viewTween = null;
        Coords.resetPan();
        showToast('视野已重置 (R)', 1000);
      });
    }
  },

  /**
   * 绑定画布拖动事件（鼠标 + 触屏）
   */
  _bindCanvasDrag() {
    const canvas = this.canvas;
    let dragging = false;
    let lastX = 0, lastY = 0;
    let movedDistance = 0;

    const onStart = (px, py) => {
      dragging = true;
      lastX = px;
      lastY = py;
      movedDistance = 0;
    };
    const onMove = (px, py) => {
      if (!dragging) return;
      const dx = px - lastX;
      const dy = py - lastY;
      lastX = px;
      lastY = py;
      movedDistance += Math.abs(dx) + Math.abs(dy);
      this._viewTween = null;  // 玩家手动拖动 → 打断运镜动画
      Coords.pan(dx, dy);
    };
    const onEnd = () => {
      dragging = false;
    };

    // 鼠标
    canvas.addEventListener('mousedown', (e) => {
      onStart(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (dragging) onMove(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', onEnd);

    // 双击重置
    canvas.addEventListener('dblclick', () => {
      this._viewTween = null;
      Coords.resetPan();
      showToast('视野已重置', 800);
    });

    // 触屏（单指拖动）
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        onStart(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });
    canvas.addEventListener('touchend', onEnd);

    // —— 鼠标滚轮缩放（围绕鼠标位置） ——
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      // deltaY > 0 → 向下滚 → 缩小；< 0 → 向上滚 → 放大
      // 用乘性步进让缩放感觉线性（每滚一格 ×1.12 / ÷1.12）
      const step = 1.12;
      const factor = e.deltaY > 0 ? 1 / step : step;
      this._viewTween = null;  // 玩家手动缩放 → 打断运镜动画
      Coords.zoomBy(factor, ax, ay);
    }, { passive: false });
  },

  _resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    Coords.setCanvas({ width: rect.width, height: rect.height });
    // 注意：Coords 内部的宽高是 CSS 像素，绘制也用 CSS 像素，DPR 自动放大
  },

  _togglePause() {
    if (!this.running) return;
    // 升级卡牌弹出时不允许通过暂停按钮关闭
    if (this.state.upgrades && this.state.upgrades.pendingChoice) {
      showToast('请先选择一张升级卡牌', 1200);
      return;
    }
    this.paused = !this.paused;
    const overlay = document.getElementById('pause-overlay');
    overlay.classList.toggle('hidden', !this.paused);
    if (!this.paused) {
      this.lastTime = performance.now();
      requestAnimationFrame(this._loop);
    }
  },

  _spawnInitialWave() {
    const s = this.state;
    // 进入 boss/球波时，强制结束遗留的函数队列事件（避免 banner 不消失）
    const isBossOrSphereWave = s.wave > 0 && s.wave % 5 === 0;
    if (isBossOrSphereWave && typeof FunctionEvent !== 'undefined' && FunctionEvent.current) {
      for (const e of FunctionEvent.current.enemiesCreated) {
        if (e.hp > 0) e.y = -10;  // 强制飞出屏幕
      }
      const result = FunctionEvent.tick(s.wave);
      if (result) this._endFunctionEvent(result);
      // 清理 enemies 里的死亡队列怪
      s.enemies = s.enemies.filter(e => e.hp > 0 && e.y > -3);
    }
    // 5 BOSS 轮换，周期 25 波（波次减半,玩家耐心友好）：
    //   % 25 === 5   → penta（五角十二面体）：5/30/55/80 ...
    //   % 25 === 10  → icosa（三角二十面体）：10/35/60/85 ...
    //   % 25 === 15  → sphere（球·黑洞）：15/40/65/90 ...
    //   % 25 === 20  → gambler（立方体·赌徒）：20/45/70/95 ...
    //   % 25 === 0   → emperor（正八面体·帝皇）：25/50/75/100 ...
    if (s.wave > 0 && s.wave % 25 === 0) {
      // 正八面体·帝皇
      s.emperor = Spawner.createEmperor({ wave: s.wave });
      this._centerViewOnBoss();
      showToast(`⚠️ 正八面体·帝皇登场！HP ${s.emperor.hp}，三阶段战`, 2800);
      this._recordEnemy(s.emperor);
      Sound.playBgm('boss');
    } else if (s.wave > 0 && s.wave % 25 === 20) {
      // 立方体·赌徒
      s.gambler = Spawner.createGambler({ wave: s.wave });
      this._centerViewOnBoss();
      showToast(`⚠️ 立方体·赌徒登场！HP ${s.gambler.hp}，免疫一切伤害`, 2600);
      this._recordEnemy(s.gambler);
      Sound.playBgm('boss');
    } else if (s.wave > 0 && s.wave % 25 === 15) {
      // 球波次：15/40/65/90 ... 球出现 + 正常刷怪
      s.sphere = Spawner.createSphere({ wave: s.wave });
      const enemies = Spawner.generateWave(s.wave, { sphereWave: true });
      s.enemies.push(...enemies);
      this._recordEnemy(s.sphere);
      this._recordEnemies(enemies);
      this._centerViewOnBoss();
      showToast('⚠️ 球（黑洞）出现！清完小怪不让球吸收！', 2400);
      Sound.playBgm('boss');
    } else if (s.wave > 0 && s.wave % 5 === 0) {
      // 其他每 5 波 boss 战
      if (s.wave % 25 === 10) {
        // 三角二十面体顶级：10/35/60/85 ...
        const icosa = Spawner.createIcosa(1, { x: 0, y: 20, wave: s.wave });
        s.enemies.push(icosa);
        s.icosaBattle = true;
        this._centerViewOnBoss();
        showToast('⚠️ 三角二十面体 BOSS 战！击破后会分裂', 2400);
        this._recordEnemy(icosa);
        Sound.playBgm('boss');
      } else {
        // 五角十二面体（penta-boss）：5/30/55/80 ... 投掷间隔随波次缩短
        const interval = Math.max(1.5, 3.0 - s.wave * 0.030);  // 缩短系数翻倍,匹配波次减半
        s.boss = Spawner.createBoss({ throwInterval: interval, wave: s.wave });
        s.pentaKillCount = 0;
        s.pentaKillGoal = 10 + s.wave * 2;  // 击杀目标也翻倍,匹配波次减半
        this._centerViewOnBoss();
        showToast(`⚠️ BOSS 出现 · 击杀 ${s.pentaKillGoal} 个五边形！`, 2200);
        this._recordEnemy(s.boss);
        Sound.playBgm('boss');
      }
    } else {
      // 先看是否触发函数队列事件 —— 触发则只生成队列怪，跳过普通波次
      const isFunctionEventWave = typeof FunctionEvent !== 'undefined' && FunctionEvent.shouldTrigger(s.wave);
      if (isFunctionEventWave) {
        this._startFunctionEvent();
        Sound.playBgm('battle');
      } else {
        const enemies = Spawner.generateWave(s.wave);
        s.enemies.push(...enemies);
        this._recordEnemies(enemies);
        Sound.playBgm('battle');
      }
    }
    s.lastSpawnTime = performance.now();
  },

  /** 启动一个函数队列事件 */
  _startFunctionEvent() {
    const s = this.state;
    const { type, positions } = FunctionEvent.trigger(s.wave);
    // 在指定位置生成 HP=2 队列怪（用对函数秒杀，用错要打 2 下）
    const queueEnemies = [];
    for (const pos of positions) {
      const e = Spawner.createEnemy({
        x: pos.x, y: pos.y,
        type: 'normal',
        shape: 'tri',          // 队列怪统一三角形外观
        color: '#ff66cc',      // 粉色（区别于普通橙色）
        vy: -0.15,             // 慢速下落（约 80-150 秒触底，明显慢于普通怪）
        hp: 2, score: 150,     // HP=2，分数略高（鼓励打）
        size: 0.6,             // 略大些更显眼
        wave: s.wave,
      });
      e.isQueueMember = true;   // 标识用
      e.codexKey = 'tri_queue';   // 自定义图鉴 key
      queueEnemies.push(e);
      s.enemies.push(e);
    }
    FunctionEvent.attachEnemies(queueEnemies);
    // 触发图鉴（首次出现时弹窗）
    if (queueEnemies.length > 0) this._recordEnemy(queueEnemies[0]);
    // 显示事件提示横幅
    const banner = document.getElementById('event-banner');
    const fnEl = document.getElementById('event-banner-fn');
    if (banner && fnEl) {
      fnEl.textContent = type.name + '（如 ' + type.example + '）';
      banner.classList.remove('hidden');
    }
    showToast(`✦ 函数队列出现！消灭 ${type.name} 函数队列`, 2400);
  },

  /** 结束函数队列事件（事件结算后调用） */
  _endFunctionEvent(result) {
    const banner = document.getElementById('event-banner');
    if (banner) banner.classList.add('hidden');
    const { type, achieved, correctCount, totalCount } = result;
    if (achieved) {
      showToast(`🏆 成就达成：${type.name}函数（${correctCount}/${totalCount}）`, 2800);
      Sound.play('laserok');
    } else {
      showToast(`✕ 未达成（${correctCount}/${totalCount} 用对函数，需 ≥ ${Math.ceil(totalCount / 2)}）`, 2000);
    }
  },

  /**
   * 调整视野以同时容纳 BOSS（或所有 icosa）和原点
   *   - penta-boss 战：以 boss 位置为目标
   *   - icosa 战：覆盖所有当前存活 icosa 的边界框 + 原点
   */
  _centerViewOnBoss() {
    const s = this.state;
    let yHi, xLo, xHi;
    const marginBottom = 1.5;
    const marginTop = 3.0;
    const marginX = 1.5;

    if (s.boss) {
      // 单个 penta-boss
      yHi = s.boss.y + s.boss.size + marginTop;
      xLo = -marginX;
      xHi = marginX;
    } else if (s.gambler) {
      // 赌徒：在 (0, 15)，size 2.0，给上方多留点空间放骰子动画
      yHi = s.gambler.y + s.gambler.size + marginTop + 2.5;
      xLo = -s.gambler.size - marginX;
      xHi = s.gambler.size + marginX;
    } else if (s.emperor) {
      // 帝皇：在 (0, 18)，size 1.6，给上方多留空间放 HP 条 + 倒计时显示
      yHi = s.emperor.y + s.emperor.size + marginTop + 3.0;
      xLo = -s.emperor.size - marginX - 1;
      xHi = s.emperor.size + marginX + 1;
    } else if (s.sphere) {
      // 球：用一个稍大的固定预算（球可能膨胀；让初始视野能容下中等大小）
      // 球在 (0, 15)，给上方留 4 单位让头顶血条可见
      const sphereTopY = s.sphere.y + Math.max(s.sphere.size, 3.0);
      yHi = sphereTopY + marginTop;
      xLo = -Math.max(s.sphere.size, 3.0) - marginX;
      xHi = Math.max(s.sphere.size, 3.0) + marginX;
    } else {
      // icosa 战：找所有 icosa 的 y 上界 + x 范围
      const icosas = s.enemies.filter(e => e.shape === 'icosa');
      if (icosas.length === 0) return;
      yHi = -Infinity;
      xLo = Infinity;
      xHi = -Infinity;
      for (const e of icosas) {
        yHi = Math.max(yHi, e.y + e.size);
        xLo = Math.min(xLo, e.x - e.size);
        xHi = Math.max(xHi, e.x + e.size);
      }
      yHi += marginTop;
      xLo -= marginX;
      xHi += marginX;
    }
    const yLo = -marginBottom;
    const neededHeight = yHi - yLo;
    const neededWidth = xHi - xLo;

    // 反推 zoom：要同时满足竖向和横向容纳
    const zoomByH = Coords.H / (Coords.baseScale * neededHeight);
    const zoomByW = Coords.W / (Coords.baseScale * neededWidth);
    let targetZoom = Math.min(zoomByH, zoomByW);
    targetZoom = Math.max(Coords.ZOOM_MIN, Math.min(Coords.ZOOM_MAX, targetZoom));

    const targetScale = Coords.baseScale * targetZoom;
    const desiredCenterY = (yLo + yHi) / 2;
    const desiredCenterX = (xLo + xHi) / 2;
    const centerYAtZeroPan = Coords.H / (2 * targetScale) + Coords.YR_BOTTOM;
    const targetPanY = centerYAtZeroPan - desiredCenterY;
    const targetPanX = desiredCenterX;

    // 启动 tween（约 0.8 秒，ease-out cubic）
    this._viewTween = {
      fromZoom: Coords.zoom,
      fromPanX: Coords.panX,
      fromPanY: Coords.panY,
      toZoom: targetZoom,
      toPanX: targetPanX,
      toPanY: targetPanY,
      elapsed: 0,
      duration: 0.8,
    };
  },

  /**
   * 推进视野 tween（每帧调用）
   */
  _updateViewTween(dt) {
    const tw = this._viewTween;
    if (!tw) return;
    tw.elapsed += dt;
    let t = Math.min(1, tw.elapsed / tw.duration);
    // ease-out cubic：1 - (1-t)^3
    const k = 1 - Math.pow(1 - t, 3);
    Coords.zoom = tw.fromZoom + (tw.toZoom - tw.fromZoom) * k;
    Coords._calcScale();
    const newPanX = tw.fromPanX + (tw.toPanX - tw.fromPanX) * k;
    const newPanY = tw.fromPanY + (tw.toPanY - tw.fromPanY) * k;
    Coords.setPan(newPanX, newPanY);
    if (t >= 1) {
      this._viewTween = null;
    }
  },

  /** 主循环 */
  _loop: function tick(now) {
    if (!Game.running) return;
    if (Game.paused) return;
    
    const dt = Math.min(0.1, (now - Game.lastTime) / 1000);
    Game.lastTime = now;
    Game.state.timeOfDay += dt;
    
    Game._update(dt, now);
    Game._render();
    
    // 函数库冷却刷新（每 100ms 更新一次）
    if (now - (Game.state.lastLibraryRender || 0) > 100) {
      Game._refreshLibraryCooldowns();
      Game.state.lastLibraryRender = now;
    }
    
    requestAnimationFrame(Game._loop);
  },

  _update(dt, now) {
    const s = this.state;

    // 全局发射冷却推进
    if (s.globalFireCooldown > 0) {
      s.globalFireCooldown = Math.max(0, s.globalFireCooldown - dt);
    }

    // 视野 tween（boss 出现/离开时的运镜）
    this._updateViewTween(dt);

    // 更新敌人
    for (const e of s.enemies) {
      Spawner.update(e, dt);
    }

    // 三角二十面体生长：到时间未死则升级为上一级
    this._updateIcosaGrowth();

    // 球吸收 + 体积更新 + 触底判定
    this._updateSphere(dt);

    // 立方体·赌徒：投骰子计时 + 骰子动画推进
    this._updateGambler(dt);

    // 正八面体·帝皇：三阶段战 + 弹幕推进 + 几何登基倒计时
    this._updateEmperor(dt);
    this._updateEmperorProjectiles(dt);

    // 逆七芒星：发射诅咒粒子束 + 强化效果应用
    this._updateInv7Beams(dt);

    // 正七芒星：发射祝福粒子束 + 祝福效果应用
    this._updateStar7Beams(dt);

    // 十芒星：发射毁灭粒子束 + 毁灭效果应用
    this._updateStar10Beams(dt);

    // 八边形：每 2 秒向四周发射 4 只扈从
    this._updateOctSpawners(dt);

    // 雾中行 buff：被八芒星雾覆盖的怪获得增益
    this._updateMistyTouch(dt);

    // 黑烟复活：被毁灭怪从黑烟中复活
    this._updateSmokeRevive();

    // 紫色全屏闪烁衰减（球死亡触发）
    if (s.purpleFlash > 0) {
      s.purpleFlash = Math.max(0, s.purpleFlash - dt * 0.5);  // ~2 秒消退（球已消失，紫闪只是收尾）
    }

    // 球死亡动画推进
    if (s.sphereDeathAnim) {
      s.sphereDeathAnim.age += dt;
      if (s.sphereDeathAnim.age >= s.sphereDeathAnim.duration) {
        // 动画结束：球已经完全消散，此时触发紫色全屏闪烁宣告 BOSS 击败
        s.purpleFlash = 1.0;
        s.sphereDeathAnim = null;
      }
    }

    // 冰冻倒计时（急速制冷-狼效果）
    if (s.freezeTimer > 0) {
      s.freezeTimer -= dt;
      if (s.freezeTimer <= 0) {
        s.freezeTimer = 0;
        for (const e of s.enemies) {
          e.frozen = false;
        }
      }
    }

    // 五角十二面体死亡动画分阶段推进
    if (s.bossDeathAnim) {
      const anim = s.bossDeathAnim;
      const prevAge = anim.age;
      anim.age += dt;
      // 阶段 1：0-0.6 秒，每 0.12 秒发射一股小粒子束（5 股）
      if (anim.age <= 0.6) {
        const burstInterval = 0.12;
        const prevIdx = Math.floor(prevAge / burstInterval);
        const curIdx = Math.floor(anim.age / burstInterval);
        if (curIdx > prevIdx && curIdx <= 5) {
          this._spawnBossPreBurst(anim.x, anim.y, anim.color);
        }
      }
      // 阶段 2：0.6 秒触发主大爆炸（仅一次）
      if (prevAge < 0.6 && anim.age >= 0.6) {
        this._spawnBossMainExplosion(anim.x, anim.y, anim.color);
      }
      // 5 秒后清掉 anim
      if (anim.age >= 5.0) {
        s.bossDeathAnim = null;
      }
    }

    // 立方体·赌徒死亡动画推进（银色碎片爆炸）
    if (s.gamblerDeathAnim) {
      s.gamblerDeathAnim.age += dt;
      if (s.gamblerDeathAnim.age >= s.gamblerDeathAnim.duration) {
        s.gamblerDeathAnim = null;
      }
    }

    // 正八面体·帝皇死亡动画推进（多波金色粒子流爆炸）
    if (s.emperorDeathAnim) {
      const anim = s.emperorDeathAnim;
      const prevAge = anim.age;
      anim.age += dt;
      const burstInterval = 0.35;
      const maxBursts = 7;
      const prevIdx = Math.floor(prevAge / burstInterval);
      const curIdx = Math.floor(anim.age / burstInterval);
      if (curIdx > prevIdx && curIdx <= maxBursts) {
        this._spawnEmperorGoldBurst(anim.x, anim.y);
      }
      if (anim.age >= anim.duration) {
        s.emperorDeathAnim = null;
      }
    }

    // 几何登基秒杀光柱动画推进
    if (s.emperorCoronationStrike) {
      const strike = s.emperorCoronationStrike;
      const prevAge = strike.age;
      strike.age += dt;

      // —— 持续震屏:每 0.08 秒一次,贯穿主光柱期 ——
      if (strike.age >= 0.5 && strike.age <= 2.5) {
        const shakeInterval = 0.08;
        if (Math.floor(prevAge / shakeInterval) < Math.floor(strike.age / shakeInterval)) {
          this._shakeScreen();
        }
      }

      // —— 金色粒子瀑布:从屏幕顶部沿光柱位置喷洒 ——
      // 0.5s-2.5s 期间每帧生成 3-5 颗金色粒子
      if (strike.age >= 0.5 && strike.age <= 2.6) {
        const colWidth = 12;   // 数学坐标系下光柱宽度(画面 0.45 * canvas 宽 ≈ 12 数学单位)
        const particleCount = 4;
        for (let i = 0; i < particleCount; i++) {
          // 在光柱范围内随机 x,从顶部 y=25 出发
          const px = (Math.random() - 0.5) * colWidth;
          const py = 22 + Math.random() * 3;   // 顶部上方
          const colors = ['#ffffff', '#fff8d0', '#ffd45d', '#ffe066'];
          s.particles.push({
            x: px, y: py,
            vx: (Math.random() - 0.5) * 1.5,
            vy: -3 - Math.random() * 3,    // 向下飞落
            color: colors[Math.floor(Math.random() * colors.length)],
            size: 0.15 + Math.random() * 0.15,
            age: 0,
            life: 1.5 + Math.random() * 1.0,
            alpha: 1,
          });
        }
      }

      // 第 2.8 秒触发 game over(光柱主体已完整播放,玩家看到极光降临的全过程)
      if (strike.age >= 2.8 && !strike.killed) {
        strike.killed = true;
        s.lives = 0;
        this._addDamageNumber(0, 0, '👑 几何登基！', '#ffd45d');
        this._shakeScreen();
        this._shakeScreen();
        this._gameOver();
      }
      if (strike.age >= strike.duration) {
        s.emperorCoronationStrike = null;
      }
    }

    // 延迟推进下一波（让 boss 死亡特效播完）
    if (s.pendingNextWave) {
      s.pendingNextWave.delay -= dt;
      if (s.pendingNextWave.delay <= 0) {
        const cb = s.pendingNextWave.callback;
        s.pendingNextWave = null;
        cb();
      }
    }
    
    // 检查敌人触底
    const remaining = [];
    let pushcartShouldFire = false;   // 蓝5 小推车：本帧是否应触发清屏
    for (const e of s.enemies) {
      if (Spawner.reachedBottom(e)) {
        // 队列怪触底：直接消失，不扣玩家血（事件是可选的，不应惩罚放弃）
        if (e.queueEventId) {
          e.hp = 0;  // 标记为已死，让 FunctionEvent.tick 识别
          continue;  // 不进入扣血流程
        }
        // 三角二十面体触 x 轴 → 立即 game over（无视生命）
        if (e.shape === 'icosa') {
          this._addDamageNumber(e.x, 0, '三角二十面体着陆！', '#ff5577');
          this._shakeScreen();
          this._gameOver();
          return;
        }
        // 普通敌人扣血（buffed 怪扣 2 命）
        const dmg = e.touchDamage || 1;
        s.lives -= dmg;
        s.combo = 1;
        this._addDamageNumber(e.x, 0, '-' + dmg, '#ff5577');
        this._shakeScreen();
        this._updateHUD();
        if (s.lives <= 0) {
          this._gameOver();
          return;
        }
        // 标记小推车待触发（不能立刻调，因为下面的 s.enemies = remaining 会覆盖）
        if ((s.upgrades && s.upgrades.pushcartCharges || 0) > 0) {
          pushcartShouldFire = true;
        }
      } else {
        remaining.push(e);
      }
    }
    s.enemies = remaining;

    // 触底循环结束、s.enemies 已重置 → 现在才安全触发小推车清屏
    if (pushcartShouldFire) {
      s.upgrades.pushcartCharges -= 1;
      this._triggerPushcart();
    }

    // 更新掉落物（下落 + 触底消失）
    for (const p of s.pickups) {
      p.y += p.vy * dt;
      p.age += dt;
    }
    s.pickups = s.pickups.filter(p => p.y > 0);  // y<=0 视为飞出底部，错过

    // BOSS 在场：处理动画 + 定时投掷五边形
    if (s.boss) {
      s.boss.angle = (s.boss.angle || 0) + dt * 0.6;  // 缓慢自转
      s.boss.throwTimer -= dt;
      if (s.boss.throwTimer <= 0) {
        // 在 boss 位置略下方投出一个五边形
        const penta = Spawner.createPentaWanderer({
          x: s.boss.x + (Math.random() - 0.5) * 1.5,
          y: s.boss.y - 1.0,
          baseSpeed: 0.55,
        });
        s.enemies.push(penta);
        this._recordEnemy(penta);
        s.boss.throwTimer = s.boss.throwInterval * (0.85 + Math.random() * 0.3);
      }
    }

    // 自动生成下一波（boss 在场时不补充自然小怪）
    if (s.wave === 0) {
      // 教程波次：完全跳过 spawn 推进，由 Tutorial 系统接管
    } else if (s.boss) {
      // penta-boss 战进度由 pentaKillCount 推进，不在这里生成新怪
    } else if (s.gambler) {
      // 赌徒战：HP 耗尽即胜，骰子事件自行召唤小怪，这里不推进 wave、不补充自然小怪
    } else if (s.emperor) {
      // 帝皇战：HP 耗尽即胜，三阶段攻击由 _updateEmperor 控制，不补充自然小怪
    } else if (s.icosaBattle) {
      // 三角二十面体战：当所有 icosa 被清空时通关
      const hasIcosa = s.enemies.some(e => e.shape === 'icosa');
      if (!hasIcosa) {
        s.icosaBattle = false;
        showToast('🏆 三角二十面体击败！', 2200);
        this._resetViewWithTween();
        s.wave++;
        this._spawnInitialWave();
        this._updateHUD();
        showToast(`第 ${s.wave} 波`, 1200);
      }
    } else if (s.sphere) {
      // 球波次：球还在 → 不推进 wave，但持续高频补充小怪
      // 触发条件：少于 5 只时即开始补；冷却 600ms（原 1500ms 太慢，球总在挨饿）
      if (s.enemies.length < 5 && now - s.lastSpawnTime > 600) {
        const extra = Spawner.generateWave(s.wave, { sphereWave: true });
        const added = extra.slice(0, 4);
        if (s.freezeTimer > 0) for (const e of added) e.frozen = true;
        s.enemies.push(...added);
        s.lastSpawnTime = now;
      }
    } else if (s.enemies.length === 0 && now - s.lastSpawnTime > 800
               && !s.pendingNextWave && !s.sphereDeathAnim && !s.bossDeathAnim && !s.gamblerDeathAnim && !s.emperorDeathAnim) {
      // 死亡动画 / 待推进波次进行中：不要抢先推进 wave
      s.wave++;
      this._spawnInitialWave();
      this._updateHUD();
      showToast(`第 ${s.wave} 波`, 1200);
    } else if (s.enemies.length < 2 && now - s.lastSpawnTime > s.spawnInterval
               && !s.pendingNextWave && !s.sphereDeathAnim && !s.bossDeathAnim && !s.gamblerDeathAnim && !s.emperorDeathAnim) {
      // 持续补充：当只剩很少时
      const extra = Spawner.generateWave(s.wave);
      const added = extra.slice(0, 2);
      if (s.freezeTimer > 0) for (const e of added) e.frozen = true;
      s.enemies.push(...added);
      this._recordEnemies(added);
      s.lastSpawnTime = now;
    }
    
    // 更新激光（淡出）
    s.lasers = s.lasers.filter(l => {
      l.age += dt;
      return l.age < l.duration;
    });
    
    // 更新粒子
    s.particles = s.particles.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 4 * dt; // 重力（数学坐标 y 向上，这里粒子向下漂落 = vy 减少）
      p.age += dt;
      p.alpha = Math.max(0, 1 - p.age / p.life);
      return p.age < p.life;
    });
    
    // 更新飘字
    s.damageNumbers = s.damageNumbers.filter(d => {
      d.age += dt;
      d.y += 1.5 * dt; // 上飘
      d.alpha = Math.max(0, 1 - d.age / d.life);
      return d.age < d.life;
    });

    // 紫1 偏微分：每 10 秒自动发射 y=kx，瞄准 |y| 最近的敌人
    this._updatePartialDerivative(dt);

    // combo 维持倒计时：超时归零（连击窗口期 2.5 秒）
    if (s.comboTimer > 0) {
      s.comboTimer -= dt;
      if (s.comboTimer <= 0) {
        s.comboTimer = 0;
        if (s.combo > 1) {
          s.combo = 1;
          this._updateHUD();  // 让 HUD 立即反映归零
        }
      }
    }
    // combo 进度条（每帧同步）
    const fill = document.getElementById('hud-combo-fill');
    if (fill) {
      const pct = Math.max(0, Math.min(1, s.comboTimer / 2.5));
      fill.style.width = (pct * 100).toFixed(1) + '%';
    }

    // 紫2 叠加维持倒计时：3 秒未再命中归零
    if (s.upgrades && (s.upgrades.stackTimer || 0) > 0) {
      s.upgrades.stackTimer -= dt;
      if (s.upgrades.stackTimer <= 0) {
        s.upgrades.stackTimer = 0;
        if ((s.upgrades.stackDamage || 0) > 0) {
          s.upgrades.stackDamage = 0;
          this._addDamageNumber(0, 1, '叠加超时', '#888');
        }
      }
    }

    // 紫4 超级展开:5 关有效期,到期失效(重新进入抽卡池)
    if (s.upgrades && s.upgrades.superExpandUnlocked) {
      const startedAt = s.upgrades.superExpandActivatedAtWave || 0;
      if (s.wave - startedAt >= 5) {
        s.upgrades.superExpandUnlocked = false;
        s.upgrades.superExpandActivatedAtWave = 0;
        showToast('超级展开效果已结束', 1500);
      }
    }

    // 函数队列事件 tick：检查是否结算
    if (typeof FunctionEvent !== 'undefined') {
      const result = FunctionEvent.tick(s.wave);
      if (result && result.ended) this._endFunctionEvent(result);
    }
  },

  /** 发射 */
  _fire(exprOverride, options) {
    const s = this.state;
    options = options || {};
    const skipLibrary = !!options.skipLibrary;
    const purple = !!options.purple;
    const blue = !!options.blue;
    const bypassPaused = !!options.bypassPaused;
    // 全局冷却(1 秒)—— 仅作用于玩家手动发射;偏微分(damageOverride)、Lv.999(bypassPaused)、内部调用(skipLibrary)不受限
    const bypassCooldown = bypassPaused || options.damageOverride !== undefined || skipLibrary;
    if (this.paused && !bypassPaused) return;  // 暂停时禁止发射（lv.999 内部循环 bypass）

    // 隐藏指令 lv.999：先于冷却检测处理(让玩家在冷却中也能输 lv.999)
    // 注意：这里只能用 exprOverride 没传入时(玩家手输)的情形,内部循环调用的 'x=N' 会走正常路径
    if (exprOverride === undefined) {
      const inputExpr = (document.getElementById('func-input').value || '').trim();
      if (/^lv\.?999$/i.test(inputExpr)) {
        this._fireLv999();
        const input = document.getElementById('func-input');
        if (input) input.value = '';
        return;
      }
    }

    if (!bypassCooldown && s.globalFireCooldown > 0) {
      // 提示玩家冷却中(只提示一次,通过 toast)
      const remain = s.globalFireCooldown.toFixed(1);
      showToast(`冷却中…${remain}s`, 500);
      return;
    }
    const expr = (exprOverride !== undefined ? exprOverride : document.getElementById('func-input').value).trim();
    if (!expr) {
      showToast('请输入函数或几何形状', 1200);
      return;
    }

    const { shape, error } = Shape.compile(expr);
    if (error) {
      showToast('语法错误：' + error, 1500);
      document.getElementById('error-msg').textContent = error;
      return;
    }

    // 九芒星禁闭检查（lv.999 等特殊指令跳过）
    if (!skipLibrary) {
      const cats = Library.categoriesOf(expr);
      if (cats.size > 0) {
        // 找场上是否有九芒星禁了任一涉及类别
        let blockedCat = null;
        let blocker = null;
        for (const cat of cats) {
          const found = s.enemies.find(e =>
            e.shape === 'star9' && e.hp > 0 &&
            !e.doomedBy && !(e.smokeTimer > 0) &&    // 被毁灭/黑烟中的九芒星失去禁闭
            e.lockedCategories && e.lockedCategories.includes(cat)
          );
          if (found) { blockedCat = cat; blocker = found; break; }
        }
        if (blocker) {
          const label = Library.CATEGORY_LABELS[blockedCat] || blockedCat;
          showToast(`⛔ 「${label}」被九芒星禁闭！击杀九芒星解除`, 1800);
          this._addDamageNumber(blocker.x, blocker.y + 0.5, '禁闭', '#ffaa44');
          return;
        }
      }
    }

    // 函数库 + 次数冷却检查（lv.999 等特殊指令跳过）
    if (!skipLibrary) {
      const item = Library.addOrGet(expr);
      if (Library._lastReplacedExpr) {
        showToast(`同类变体替换：「${Library._lastReplacedExpr}」→「${expr}」`, 1600);
      }
      if (Library._lastEvictedExpr) {
        showToast(`函数库已满 · 替换最少使用的「${Library._lastEvictedExpr}」`, 1800);
      }
      // 个体冷却已废除,改用全局 1 秒冷却(在函数入口检测)
      // Library.isLocked 检查暂时保留兼容性,但实际不再触发(基础函数+几何模板永不锁;复合函数也通过全局冷却节流)
      Library.trigger(item);
      Sound.play('laserok');
    }
    // 设置全局发射冷却 1 秒(仅玩家手动发射;lv.999 内部 / 偏微分 / 内部调用不触发)
    if (!bypassCooldown) {
      s.globalFireCooldown = 1.0;
    }

    // 发射激光（保留一段时间用于动画）
    s.lasers.push({
      shape,
      expr,
      age: 0,
      duration: 0.7,
      progress: 0,
      purple: purple,    // lv.999 紫色标记
      blue: blue,        // 紫1 偏微分蓝色标记
    });

    // 记录函数图鉴（无弹窗，仅持久化）
    this._recordFunction(expr);

    // 伤害公式：(基础 × 道具加成) + 金1 etherStacks + 紫2 stackDamage
    // 道具仅作用于基础 1 点（防止后期爆炸）；金1/紫2 是固定加成
    // 若调用方传入 damageOverride（如紫1 偏微分自动激光），则直接使用，跳过加成
    let damage;
    if (options.damageOverride !== undefined) {
      damage = options.damageOverride;
    } else {
      let basePart = s.baseDamage || 1;     // 通常 1，彩蛋触发后是 10
      if (s.damageBoostShots > 0) {
        basePart *= 2;
        s.damageBoostShots--;
      }
      damage = basePart
        + (s.upgrades && Upgrade.etherDamageBonus(s) || 0)
        + (s.upgrades && s.upgrades.stackDamage || 0);
    }

    // 检查命中（统一走 shapeHits）
    let killsThisShot = 0;
    let scoreThisShot = 0;
    let enemyHitThisShot = false;   // 紫2 叠加用：本次激光是否命中过任何敌人（含护盾的 protector）
    // 命中半径（基础 0.6 × 蓝2 麦克劳林倍率）
    const hitR = this._hitRadius();

    // 待生成的分裂子代（循环结束后一并加入，避免污染当前迭代）
    const pendingSpawns = [];

    // 六芒星护盾：本帧任何「未被毁灭」的六芒星周围 SHIELD_RADIUS 内的非自身敌人免疫激光
    // 被毁灭（doomedBy）或在黑烟中的六芒星不再提供护盾（失去技能）
    const SHIELD_RADIUS = 5.0;
    const hexagrams = s.enemies.filter(e =>
      e.shape === 'hexagram' && e.hp > 0 &&
      !e.doomedBy && !(e.smokeTimer > 0)
    );
    const isShielded = (target) => {
      // 自己不受自己庇护（即六芒星本身仍可被打）
      // 六芒星之间也互不防御 —— 玩家可以集火击杀任意一只六芒星
      if (target.shape === 'hexagram') return false;
      for (const h of hexagrams) {
        if (h === target) continue;
        const dx = target.x - h.x, dy = target.y - h.y;
        if (dx * dx + dy * dy <= SHIELD_RADIUS * SHIELD_RADIUS) return true;
      }
      return false;
    };

    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      // 雾隐中的 star8 自身免疫激光（雾不阻挡其他敌人，仅自己不可被击中）
      if (e.fogActive) continue;
      // 黑烟中的怪：免疫激光（已死状态等待复活）
      if (e.smokeTimer > 0) continue;
      // 八边形扈从：在 master 还活着时免疫激光（仍 orbiting 的状态）
      if (e.shape === 'octminion' && e.orbiting) {
        if (Spawner.shapeHits(e, shape, hitR)) {
          this._addDamageNumber(e.x, e.y + 0.3, '免疫', '#ffd700');
        }
        continue;
      }
      if (isShielded(e)) {
        // 在某只六芒星护盾内：免疫激光。可视化：命中时显示提示
        if (Spawner.shapeHits(e, shape, hitR)) {
          this._addDamageNumber(e.x, e.y + 0.3, '护盾', '#88ccff');
        }
        continue;
      }
      if (Spawner.shapeHits(e, shape, hitR)) {
        // 函数队列事件命中：类别匹配 → 秒杀（hp=0）；不匹配 → 正常扣血（HP=2 要打 2 下）
        let queueOneShot = false;
        if (e.queueEventId && typeof FunctionEvent !== 'undefined') {
          const cats = Library.categoriesOf(expr);
          const matched = FunctionEvent.matchCategory(
            FunctionEvent.current ? FunctionEvent.current.type.category : '', expr, cats
          );
          if (matched) {
            queueOneShot = true;
            this._addDamageNumber(e.x, e.y + 0.7, '✓ 秒杀', '#ffe066');
          }
        }
        // 祝福伤害转移：被祝福的怪受伤时，伤害转给对应正七芒星
        if (e.blessedBy) {
          const protector = s.enemies.find(p => p.id === e.blessedBy && p.shape === 'star7' && p.hp > 0);
          if (protector) {
            // 视觉：被祝福怪命中位置显示绿色 0 + 飞向 star7 的伤害提示
            this._addDamageNumber(e.x, e.y + 0.3, '祝福', '#44dd88');
            // 把伤害转嫁给保护者
            protector.hp -= damage;
            enemyHitThisShot = true;
            this._addDamageNumber(protector.x, protector.y + 0.4, '-' + damage, '#44dd88');
            this._spawnExplosion(protector.x, protector.y, '#44dd88');
            if (protector.hp <= 0) {
              // star7 死亡：解除所有它祝福的怪
              for (const ally of s.enemies) {
                if (ally.blessedBy === protector.id) {
                  ally.blessedBy = null;
                }
              }
              killsThisShot++;
              scoreThisShot += protector.score;
              this._spawnExplosion(protector.x, protector.y, protector.color);
              this._addDamageNumber(protector.x, protector.y + 0.3, '+' + protector.score, '#ffe066');
            }
            continue;   // 此次命中处理完毕，不再扣 e 自己的 hp
          } else {
            // 保护者已死或丢失 → 自动解除祝福
            e.blessedBy = null;
          }
        }
        // 队列怪秒杀：直接 hp=0
        if (queueOneShot) {
          e.hp = 0;
          // 通知事件管理器：用对函数击杀
          if (typeof FunctionEvent !== 'undefined') {
            FunctionEvent.onEnemyKilled(e, true);
          }
        } else {
          e.hp -= damage;
          // 队列怪：用错函数命中，通知事件（不算成就）
          if (e.queueEventId && e.hp <= 0 && typeof FunctionEvent !== 'undefined') {
            FunctionEvent.onEnemyKilled(e, false);
          }
        }
        enemyHitThisShot = true;
        // 紫3 麻痹大意：被命中的怪在 5 秒内速度减半
        if (s.upgrades && s.upgrades.paralyzeUnlocked && e.hp > 0) {
          e.paralyzeRemain = 5.0;
        }
        // 雾中行 buff 受击解除（任何命中都清掉，伤害正常）
        if (e.mistyTouched) {
          e.mistyTouched = false;
          // 恢复速度（之前 ×1.15）—— 注意不能完美还原，因为可能其他效果也改了 vy
          // 简单做法：除回 1.15
          e.vy /= 1.15;
        }
        if (e.hp <= 0) {
          // 被毁灭的怪死亡：进入 5 秒黑烟，不真正死亡（除非毁灭它的 star10 已死）
          if (e.doomedBy) {
            const protector = s.enemies.find(p => p.id === e.doomedBy && p.shape === 'star10' && p.hp > 0);
            if (protector) {
              // 进入黑烟状态：5 秒后复活（仍处于毁灭状态）
              e.smokeTimer = 5.0;
              e._wasSmoking = true;
              e.hp = 0;   // 防止再被命中
              this._spawnExplosion(e.x, e.y, '#222233');
              this._addDamageNumber(e.x, e.y + 0.3, '黑烟', '#9966ff');
              continue;   // 跳过常规死亡逻辑
            } else {
              // 毁灭者已死 → 走正常死亡（虽然此时 doomedBy 应已被清，保险）
              e.doomedBy = null;
            }
          }
          killsThisShot++;
          scoreThisShot += e.score;
          this._spawnExplosion(e.x, e.y, e.color);
          this._addDamageNumber(e.x, e.y + 0.3, '+' + e.score, '#ffe066');
          // 正七芒星死亡：解除所有它祝福的怪
          if (e.shape === 'star7') {
            for (const ally of s.enemies) {
              if (ally.blessedBy === e.id) {
                ally.blessedBy = null;
              }
            }
          }
          // 十芒星死亡：所有它毁灭的怪（包括黑烟中）直接死亡
          if (e.shape === 'star10') {
            for (const slave of s.enemies) {
              if (slave.doomedBy === e.id) {
                // 直接消灭，不进黑烟、不走分裂等逻辑
                this._spawnExplosion(slave.x, slave.y, '#222233');
                this._addDamageNumber(slave.x, slave.y + 0.3, '+' + slave.score, '#ffe066');
                slave.hp = 0;
                slave.doomedBy = null;
                slave.smokeTimer = 0;
                slave._wasSmoking = false;
                killsThisShot++;
                scoreThisShot += slave.score;
              }
            }
          }
          // 七边形死亡：AOE 自爆 3 单位 3 伤
          if (e.shape === 'hep') {
            const RADIUS = 3.0;
            for (const other of s.enemies) {
              if (other === e || other.hp <= 0) continue;
              if (other.shape === 'icosa' || other.shape === 'sphere') continue;  // boss 类不受影响
              if (other.smokeTimer > 0) continue;   // 黑烟中免疫
              const dx = other.x - e.x, dy = other.y - e.y;
              if (dx * dx + dy * dy <= RADIUS * RADIUS) {
                // 给周围怪 3 点伤害
                if (other.blessedBy) {
                  // 转移伤害到对应 star7
                  const protector = s.enemies.find(p => p.id === other.blessedBy && p.shape === 'star7' && p.hp > 0);
                  if (protector) {
                    protector.hp -= 3;
                    this._addDamageNumber(protector.x, protector.y + 0.4, '-3', '#44dd88');
                    if (protector.hp <= 0) {
                      // star7 被自爆打死也走解除祝福
                      for (const ally of s.enemies) {
                        if (ally.blessedBy === protector.id) ally.blessedBy = null;
                      }
                    }
                    continue;
                  } else {
                    other.blessedBy = null;
                  }
                }
                if (other.doomedBy) {
                  // 被毁灭怪：HP 已经是 1，受 3 伤会死 → 但走黑烟逻辑（如果 star10 还活）
                  const star10 = s.enemies.find(p => p.id === other.doomedBy && p.shape === 'star10' && p.hp > 0);
                  if (star10) {
                    other.smokeTimer = 5.0;
                    other._wasSmoking = true;
                    other.hp = 0;
                    this._spawnExplosion(other.x, other.y, '#222233');
                    continue;
                  }
                }
                other.hp -= 3;
                this._addDamageNumber(other.x, other.y, '-3', '#ff8844');
                if (other.hp <= 0) {
                  this._spawnExplosion(other.x, other.y, other.color);
                  killsThisShot++;
                  scoreThisShot += other.score;
                }
              }
            }
            // 自爆视觉：橙色多重爆炸 + 放射粒子 + 震屏
            const RADIUS_VIS = 3.0;
            // 中心连环爆炸（4 组叠加）
            for (let k = 0; k < 4; k++) {
              const ox = e.x + (Math.random() - 0.5) * 0.8;
              const oy = e.y + (Math.random() - 0.5) * 0.8;
              this._spawnExplosion(ox, oy, '#ff8844');
            }
            // 边缘环形爆炸（沿半径外圈一圈 8 个小爆炸）
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2;
              const ox = e.x + Math.cos(a) * RADIUS_VIS * 0.7;
              const oy = e.y + Math.sin(a) * RADIUS_VIS * 0.7;
              this._spawnExplosion(ox, oy, '#ff5522');
            }
            // 放射粒子（60 颗朝四面飞）
            for (let k = 0; k < 60; k++) {
              const a = (k / 60) * Math.PI * 2 + Math.random() * 0.05;
              const speed = 4 + Math.random() * 5;
              s.particles.push({
                x: e.x, y: e.y,
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed,
                color: k % 3 === 0 ? '#ffe066' : '#ff8844',
                size: 0.10 + Math.random() * 0.08,
                age: 0,
                life: 0.8 + Math.random() * 0.6,
                alpha: 1,
              });
            }
            // 内层白色火花（高光）
            for (let k = 0; k < 20; k++) {
              const a = Math.random() * Math.PI * 2;
              const speed = 2 + Math.random() * 3;
              s.particles.push({
                x: e.x, y: e.y,
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed,
                color: '#ffffff',
                size: 0.06 + Math.random() * 0.05,
                age: 0,
                life: 0.4 + Math.random() * 0.3,
                alpha: 1,
              });
            }
            this._addDamageNumber(e.x, e.y + 0.5, '💥 自爆', '#ff8844');
            this._shakeScreen();
            this._shakeScreen();
          }
          // 紫4 超级展开:任何非 BOSS 普通怪死亡时,如果效果激活则触发七边形式 AOE
          // (七边形自身死亡已经走 hep AOE 了,不必重复;BOSS 自然过滤掉)
          // _supExpKilled 标记:这只怪是被另一次超级展开炸死的,不再连锁触发
          if (s.upgrades && s.upgrades.superExpandUnlocked
              && e.shape !== 'hep'
              && e.shape !== 'icosa' && e.shape !== 'sphere'
              && e.type !== 'penta'    // 五边形 boss 投掷物不触发(可能太多)
              && !e._supExpKilled) {
            const aoeResult = this._superExpandAoe(e.x, e.y, e);
            killsThisShot += aoeResult.kills;
            scoreThisShot += aoeResult.score;
          }
          // 一级四芒星：分裂成 2 个次级（位置左右散开）
          if (e.type === 'split') {
            pendingSpawns.push(Spawner.createSplitChild({
              x: e.x - 0.6, y: e.y - 0.2, baseSpeed: 0.55,
            }));
            pendingSpawns.push(Spawner.createSplitChild({
              x: e.x + 0.6, y: e.y - 0.2, baseSpeed: 0.55,
            }));
            this._addDamageNumber(e.x, e.y + 0.6, '分裂！', '#5dffd6');
          }
          // 三角二十面体：被击破时分裂为 2 个下一级（除非已是终级）
          if (e.shape === 'icosa' && e.tier < 4) {
            const xOffset = Math.max(e.size * 2.0, 1.5);
            const childWave = e.spawnWave || s.wave;
            pendingSpawns.push(Spawner.createIcosa(e.tier + 1, {
              x: e.x - xOffset, y: e.y + 0.4, wave: childWave,
            }));
            pendingSpawns.push(Spawner.createIcosa(e.tier + 1, {
              x: e.x + xOffset, y: e.y - 0.4, wave: childWave,
            }));
            this._addDamageNumber(e.x, e.y + 0.8, '分裂！', '#ffd45d');
            // 标记需要在循环结束后重新运镜（覆盖新分裂的子代）
            s._needRecenterAfterSplit = true;
          }
          // 五边形（boss 投掷物）：推进 boss 战进度
          if (e.type === 'penta' && s.boss) {
            s.pentaKillCount++;
            const remainHp = Math.max(0, s.pentaKillGoal - s.pentaKillCount);
            this._addDamageNumber(s.boss.x, s.boss.y - 1.5, `BOSS HP ${remainHp}`, '#ff5dd6');
            if (s.pentaKillCount >= s.pentaKillGoal) {
              this._defeatBoss();
            }
          }
          // 15% 概率掉落道具（penta 也算）
          if (Math.random() < 0.15) {
            this._spawnPickup(e.x, e.y);
          }
        } else {
          this._addDamageNumber(e.x, e.y + 0.3, '-' + damage, '#ff5577');
        }
      }
    }
    // 把分裂子代加入。它们不会被本发激光二次命中，因为 for 循环已结束
    for (const child of pendingSpawns) {
      s.enemies.push(child);
    }
    if (pendingSpawns.length > 0) {
      this._recordEnemies(pendingSpawns);
    }
    // 三角二十面体分裂后重新运镜，让所有 icosa 都进视野
    if (s._needRecenterAfterSplit) {
      s._needRecenterAfterSplit = false;
      this._centerViewOnBoss();
    }
    // BOSS 自身：激光不直接造成伤害，但显示一个 -0 提示让玩家知道"打不动"
    if (s.boss && Spawner.shapeHits(s.boss, shape, hitR)) {
      this._addDamageNumber(s.boss.x, s.boss.y, '免疫', '#888');
    }
    // 立方体·赌徒：免疫所有伤害（玩家伤害不进入，仅自扣血才能击败）
    if (s.gambler && Spawner.shapeHits(s.gambler, shape, hitR)) {
      this._addDamageNumber(s.gambler.x, s.gambler.y, '免疫', '#bbb');
    }
    // 球：可被激光命中，按 damage 扣血；体积在 _updateSphere 里同步
    if (s.sphere && Spawner.shapeHits(s.sphere, shape, hitR)) {
      s.sphere.hp -= damage;
      this._addDamageNumber(s.sphere.x, s.sphere.y + 0.4, '-' + damage, '#ff66cc');
      this._spawnExplosion(s.sphere.x, s.sphere.y, '#aa44ff');
    }
    // 正八面体·帝皇：可被激光命中。阶段切换无敌期(invulnTimer > 0)免疫；否则按 damage 扣血并检查阶段切换/击败
    if (s.emperor && Spawner.shapeHits(s.emperor, shape, hitR)) {
      const e = s.emperor;
      if (e.invulnTimer > 0) {
        this._addDamageNumber(e.x, e.y + 0.4, '陛下免疫', '#ffe066');
      } else {
        e.hp -= damage;
        this._addDamageNumber(e.x, e.y + 0.4, '-' + damage, '#ffd45d');
        this._spawnExplosion(e.x, e.y, '#ffd45d');
        // 阶段切换检测（按总血计算阶段边界）
        if (e.phase === 1 && e.hp <= e.phase1Threshold) {
          this._emperorEnterPhase(2);
        } else if (e.phase === 2 && e.hp <= e.phase2Threshold) {
          this._emperorEnterPhase(3);
        }
        if (e.hp <= 0) {
          this._defeatEmperor();
        }
      }
    }

    // 帝皇弹幕：可被激光击中并清除（不计入连击/分数，只是消灭威胁）
    // 命中半径 0.45（与弹幕 size 一致）；同一发激光可清多颗弹幕
    if (s.emperorProjectiles && s.emperorProjectiles.length > 0) {
      for (const p of s.emperorProjectiles) {
        if (p.destroyed) continue;
        if (Spawner.shapeHits({ x: p.x, y: p.y, size: p.size || 0.45 }, shape, hitR)) {
          p.destroyed = true;
          // 击毁特效：白色 + 红色双爆
          this._spawnExplosion(p.x, p.y, '#ffffff');
          this._spawnExplosion(p.x, p.y, '#ff5577');
        }
      }
      // 过滤掉被击毁的弹幕
      s.emperorProjectiles = s.emperorProjectiles.filter(p => !p.destroyed);
    }

    // 同一发激光：检测是否击中已掉落的道具
    // 但跳过「本次激光刚刚生成的 pickup」—— 避免击杀敌人和拾取道具同帧发生
    for (const p of s.pickups) {
      if (p.collected) continue;
      if (p.justSpawned) continue;
      if (Spawner.shapeHits({ x: p.x, y: p.y, size: 0.4 }, shape, hitR)) {
        p.collected = true;
        this._collectPickup(p);
      }
    }
    s.pickups = s.pickups.filter(p => !p.collected);
    // 清除本次激光的「新生」标记，下一发激光起恢复正常拾取
    for (const p of s.pickups) p.justSpawned = false;
    
    s.enemies = s.enemies.filter(e => e.hp > 0 || e.smokeTimer > 0);
    
    // 处理连击
    if (killsThisShot > 0) {
      s.kills += killsThisShot;
      // 先用当前 combo 结算分数（第一发 combo=1，得分不被放大；后续命中 combo 才递增）
      s.score += scoreThisShot * s.combo;
      // 然后递增 combo（cap 5），刷新维持时间
      s.combo = s.combo + 1;
      if (s.combo > 5) s.combo = 5;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.comboTimer = 2.5;   // 刷新 combo 维持时间
      this._comboBoostVisual();
      if (killsThisShot >= 3) showToast(`💥 ${killsThisShot} 连杀！`, 1200);
    } else {
      if (s.combo > 1) {
        s.combo = 1;
      }
    }

    // 紫2 叠加：本次激光是否命中至少一只敌人？是则 +1（cap 5），否则清零
    // 自动激光（紫1 偏微分等用 damageOverride）不参与叠加追踪
    if (s.upgrades && s.upgrades.stackUnlocked && options.damageOverride === undefined) {
      const old = s.upgrades.stackDamage || 0;
      if (enemyHitThisShot) {
        s.upgrades.stackDamage = Math.min(5, old + 1);
        s.upgrades.stackTimer = 3.0;   // 刷新维持时间，3 秒未再命中归零
        if (s.upgrades.stackDamage !== old) {
          this._addDamageNumber(0, 1, `叠加 ×${s.upgrades.stackDamage}`, '#b88dff');
        }
      } else if (old > 0) {
        s.upgrades.stackDamage = 0;
        s.upgrades.stackTimer = 0;
        this._addDamageNumber(0, 1, '叠加清零', '#888');
      }
    }

    this._updateHUD();
    this._checkLevelUp();
    
    // 如果是从输入框发射的，清空输入框
    if (exprOverride === undefined) {
      document.getElementById('func-input').value = '';
      s.previewShape = null;
      s.previewExpr = '';
      document.getElementById('error-msg').textContent = '';
      // 恢复 y= 提示（默认状态）
      const inputPrompt = document.getElementById('input-prompt');
      if (inputPrompt) inputPrompt.classList.remove('hidden');
    }
    
    // 立即刷新函数库（让冷却条出现）
    this._renderLibrary();
    // 视觉：发射的库项闪一下（skipLibrary 时不操作库 UI）
    if (!skipLibrary) {
      this._flashLibItemFire(expr);
    }
  },

  _spawnExplosion(x, y, color) {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2;
      this.state.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 0.06 + Math.random() * 0.06,
        age: 0,
        life: 0.5 + Math.random() * 0.4,
        alpha: 1,
      });
    }
  },

  /**
   * 超级展开 AOE 爆炸:在 (cx,cy) 半径 3 单位内对所有非 BOSS 敌人造成 3 伤
   * 复用七边形爆炸的视觉(中心连环 + 边缘环 + 放射粒子)
   * 返回 { kills, score } —— 被这次 AOE 顺带打死的敌人数 + 分数
   *
   * 注意:
   * - 跳过本次正在死亡的敌人(用 originEnemy 排除)
   * - 跳过 BOSS / 黑烟中的敌人
   * - 被打死的怪本身不再触发超级展开(避免无限连锁)
   */
  _superExpandAoe(cx, cy, originEnemy) {
    const s = this.state;
    const RADIUS = 3.0;
    const DAMAGE = 3;
    let kills = 0, score = 0;
    for (const other of s.enemies) {
      if (other === originEnemy || other.hp <= 0) continue;
      if (other.shape === 'icosa' || other.shape === 'sphere') continue;   // BOSS 类免疫
      if (other.smokeTimer > 0) continue;
      const dx = other.x - cx, dy = other.y - cy;
      if (dx * dx + dy * dy > RADIUS * RADIUS) continue;
      other.hp -= DAMAGE;
      this._addDamageNumber(other.x, other.y, '-' + DAMAGE, '#b88dff');
      if (other.hp <= 0) {
        // 死亡视觉但不再连锁(标记 _supExpKilled 防止递归触发更多超级展开)
        other._supExpKilled = true;
        this._spawnExplosion(other.x, other.y, other.color);
        kills += 1;
        score += other.score;
      }
    }
    // 视觉:简化版 hep 爆炸(中心 + 放射粒子)
    for (let k = 0; k < 3; k++) {
      const ox = cx + (Math.random() - 0.5) * 0.6;
      const oy = cy + (Math.random() - 0.5) * 0.6;
      this._spawnExplosion(ox, oy, '#b88dff');
    }
    // 紫色放射粒子(40 颗)
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2 + Math.random() * 0.05;
      const speed = 3 + Math.random() * 4;
      s.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        color: k % 3 === 0 ? '#ffd45d' : '#b88dff',
        size: 0.10 + Math.random() * 0.06,
        age: 0,
        life: 0.6 + Math.random() * 0.4,
        alpha: 1,
      });
    }
    this._shakeScreen();
    return { kills, score };
  },

  /**
   * 在 (x,y) 生成一个掉落物，type 三选一均匀随机
   *   shield  函数护盾：+1 命
   *   eraser  橡皮擦 lv999：清屏
   *   boost   复合函数包：下次起 3 发激光威力翻倍
   */
  _spawnPickup(x, y) {
    const TYPES = ['shield', 'eraser', 'boost', 'freeze'];
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    this.state.pickups.push({
      id: Math.random().toString(36).slice(2),
      x, y,
      // 比敌人慢约 40%（敌人基础 0.55 → pickup 0.33）
      vy: -0.33,
      type,
      codexKey: 'pickup_' + type,    // 走通用图鉴路径
      age: 0,
      collected: false,
      // 标记：本次激光刚生成的 pickup，本次扫描时跳过，下一发起可拾取
      justSpawned: true,
    });
  },

  /**
   * 拾取掉落物，应用对应效果
   */
  _collectPickup(p) {
    const s = this.state;
    // 触发图鉴（首次拾取该种道具）—— 走通用路径，p.codexKey 由 _spawnPickup 设
    this._recordEnemy(p);
    if (p.type === 'shield') {
      if (s.lives >= 10) {
        // 已达上限：不加血，给玩家一个提示
        this._addDamageNumber(p.x, p.y + 0.3, 'MAX', '#888');
        showToast('🛡️ 护盾已达上限（10 ❤）', 1400);
      } else {
        s.lives = Math.min(10, s.lives + 1);
        this._addDamageNumber(p.x, p.y + 0.3, '+1 ❤', '#5dffd6');
        showToast('🛡️ 函数护盾 · 生命 +1', 1400);
      }
    } else if (p.type === 'eraser') {
      // 清屏：所有当前敌人就地爆炸（无分数，无连击）
      // 但保留 icosa（boss 战类型不应被秒）
      const targets = s.enemies.filter(e => e.shape !== 'icosa');
      const protectedOnes = s.enemies.filter(e => e.shape === 'icosa');
      const cleared = targets.length;
      for (const e of targets) {
        this._spawnExplosion(e.x, e.y, e.color);
      }
      s.enemies = protectedOnes;
      this._addDamageNumber(p.x, p.y + 0.3, '清屏！', '#ffe066');
      showToast(`🧽 橡皮擦lv999 · 清除 ${cleared} 个敌人`, 1400);
    } else if (p.type === 'boost') {
      s.damageBoostShots = 3;
      this._addDamageNumber(p.x, p.y + 0.3, '×2 威力', '#ff8c5d');
      showToast('🎯 复合函数包 · 下 3 发威力 ×2', 1500);
    } else if (p.type === 'freeze') {
      // 急速制冷-狼：全场敌人变蓝静止 10 秒（boss / sphere / icosa 不冻）
      s.freezeTimer = 10;
      let frozenCount = 0;
      for (const e of s.enemies) {
        if (e.shape === 'icosa' || e.type === 'boss') continue;
        e.frozen = true;
        frozenCount++;
      }
      this._addDamageNumber(p.x, p.y + 0.3, '冰冻 10s', '#88ddff');
      showToast(`❄️ 急速制冷-狼 · ${frozenCount} 只敌人静止 10 秒`, 1600);
    }
    this._updateHUD();
  },

  /**
   * 调试：清除全部敌人 + boss + 掉落物
   * 触发：a + o + e 三键同时按下（输入框内不响应）
   */
  /**
   * 隐藏指令：lv.999
   * 一次性发射 31 条紫色 x=k 激光（k 从 -15 到 15），整片清屏
   * - 不消耗函数库次数
   * - 紫色激光（视觉与普通青色区分）
   * - 一次性播放发射音效（避免 31 次叠加爆音）
   */
  _fireLv999() {
    Sound.play('laserok');
    showToast('喏，拿去玩吧', 1500);
    for (let k = -15; k <= 15; k++) {
      this._fire('x=' + k, { skipLibrary: true, purple: true, bypassPaused: true });
    }
  },

  _debugClearAll() {
    const s = this.state;
    // 视觉上简单爆一下，不给分
    for (const e of s.enemies) this._spawnExplosion(e.x, e.y, e.color);
    if (s.boss) this._spawnExplosion(s.boss.x, s.boss.y, s.boss.color);
    if (s.sphere) this._spawnExplosion(s.sphere.x, s.sphere.y, '#aa44ff');
    if (s.gambler) this._spawnExplosion(s.gambler.x, s.gambler.y, '#c8cfd6');
    if (s.emperor) this._spawnExplosion(s.emperor.x, s.emperor.y, '#ffd45d');
    s.enemies = [];
    s.boss = null;
    s.sphere = null;
    s.gambler = null;
    s.emperor = null;
    s.pickups = [];
    s.pentaKillCount = 0;
    if (s.gamblerPendingSpawns) s.gamblerPendingSpawns = [];
    if (s.emperorPendingSpawns) s.emperorPendingSpawns = [];
    if (s.emperorProjectiles) s.emperorProjectiles = [];
    showToast('🧹 调试清屏', 1000);
  },

  /**
   * 调试：跳关到指定 BOSS 关（b+s+1/2/3/4 触发）
   * targetWave: 10/20/30/40 — 对应首次出现的 BOSS 关
   *   10 → 五角十二面体（penta）
   *   20 → 三角二十面体（icosa）
   *   30 → 球·黑洞（sphere）
   *   40 → 立方体·赌徒（gambler）
   * 跳关时清理场上所有怪/BOSS/掉落物/事件，然后设置 wave 并调用 _spawnInitialWave
   * 保留：血量、分数、升级、护盾等玩家状态
   */
  _debugSkipToBoss(targetWave) {
    const s = this.state;
    if (s.wave === 0) {
      // 教程波次：避免破坏教程流程
      showToast('⚠️ 教程进行中，无法跳关', 1500);
      return;
    }
    // 1) 清场：移除所有敌人 / BOSS / 掉落物 / 待推进波次 / 死亡动画 / 视图过渡
    s.enemies = [];
    s.boss = null;
    s.sphere = null;
    s.gambler = null;
    s.emperor = null;
    s.pickups = [];
    s.lasers = [];
    s.particles = [];
    s.damageNumbers = [];
    s.inv7Beams = [];
    s.star7Beams = [];
    s.star10Beams = [];
    s.bossDeathAnim = null;
    s.sphereDeathAnim = null;
    s.gamblerDeathAnim = null;
    s.gamblerPendingSpawns = [];
    s.emperorDeathAnim = null;
    s.emperorPendingSpawns = [];
    s.emperorProjectiles = [];
    s.emperorCoronationStrike = null;
    s.purpleFlash = 0;
    s.pentaKillCount = 0;
    s.icosaBattle = false;
    s.pendingNextWave = null;
    s.freezeTimer = 0;
    s.damageBoostShots = 0;
    this._viewTween = null;
    // 重置视图到默认
    if (typeof Coords !== 'undefined') {
      Coords.resetPan();
      Coords.zoom = 1;
    }
    // 注：函数队列事件的清理由 _spawnInitialWave 内部处理（它会在每 10 波检查并强制结束）
    // 2) 设置目标波次（_spawnInitialWave 内部会根据 wave 召唤对应 BOSS）
    s.wave = targetWave;
    this._spawnInitialWave();
    this._updateHUD();
    // 3) 提示
    const labels = { 5: '五角十二面体', 10: '三角二十面体', 15: '球·黑洞', 20: '立方体·赌徒', 25: '正八面体·帝皇' };
    showToast(`🐛 调试跳关：第 ${targetWave} 波 · ${labels[targetWave] || 'BOSS'}`, 1800);
  },

  /**
   * 图鉴数据：每种怪物的弹窗内容
   * iconShape 决定弹窗图标用哪种形状绘制（与 _drawEnemy 风格一致）
   */
  CODEX_DATA: {
    tri: {
      title: '三角形 · 普通',
      tags: ['普通', '1 HP', '基础速'],
      desc: '橙色三角形，最常见的敌人。1 HP，一发即倒。从第 1 波开始就会出现。\n\n<i>它只是一个走错了门的平平无奇的小三角形罢了。</i>',
      iconShape: 'tri', iconColor: '#ffaa33', iconSize: 0.85,
    },
    tri_queue: {
      title: '三角形 · 阵列',
      tags: ['特殊事件', '2 HP', '极慢下落', '类别匹配秒杀'],
      desc: '粉色三角形，仅在「函数队列」特殊事件中出现。它们沿某个数学函数的图像列阵下落，等待玩家用对应类别的函数将其消灭。\n\n用对类别的函数命中 → 一击秒杀；用错函数 → 像普通怪一样需要 2 下。如果用对函数击杀超过半数（≥9/18），获得对应函数的成就。\n\n<i>「我们不过是函数图像上的刻度。请用正确的函数把我们解构吧。」</i>',
      iconShape: 'tri', iconColor: '#ff66cc', iconSize: 0.85,
    },
    square: {
      title: '正方形 · 普通',
      tags: ['普通', '1 HP', '基础速'],
      desc: '橙色方块，与三角形并列出现的基础敌人。1 HP，注意它们密集时容易让分数连击中断。\n\n<i>俗话说天圆地方，不过它和大地可还差远了。</i>',
      iconShape: 'square', iconColor: '#ffaa33', iconSize: 0.85,
    },
    hex: {
      title: '六边形 · 精英',
      tags: ['精英', '2 HP', '中速'],
      desc: '紫罗兰色的六边形精英，需要两次命中才能击破。出现频率随关卡逐步提升。\n\n<i>它不组成蜂窝。</i>',
      iconShape: 'hex', iconColor: '#b88dff', iconSize: 0.8,
    },
    star: {
      title: '五角星 · 强精英',
      tags: ['强精英', '3 HP', '较慢'],
      desc: '红色五角星精英，移动较慢但耐久很高。第 8 波后开始出现，击杀奖励 500 分。\n\n<i>一闪一闪亮晶晶，呃，你不会希望在天上看见它的。</i>',
      iconShape: 'star', iconColor: '#ff5577', iconSize: 0.85,
    },
    split: {
      title: '青色四芒星 · 分裂体',
      tags: ['分裂', '1 HP', '慢速'],
      desc: '一击即破，但击中会分裂成两个稍小的次级四芒星。第 10 波后出现，提防它们突然增加屏幕压力。\n\n<i>在一个遥远的世界，它是人们心中最珍贵的货币。</i>',
      iconShape: 'star4', iconColor: '#5dffd6', iconSize: 0.8,
    },
    split_child: {
      title: '浅青四芒星 · 次级',
      tags: ['不再分裂', '1 HP', '正常速'],
      desc: '由分裂体生成的次级单位。速度恢复正常，但不会再次分裂。注意它们出现后会快速下落。\n\n<i>要是那种珍贵的货币也会这样增多就好了。</i>',
      iconShape: 'star4', iconColor: '#7df0ff', iconSize: 0.7,
    },
    boss: {
      title: '五角十二面体 · BOSS',
      tags: ['每 50 波周期', '免疫激光', '击杀目标随波次涨'],
      desc: '出现在第 5、30、55... 波，不会下落，激光对它无效。它会持续投掷紫色五边形小怪 —— 击杀足够数量才能击败 BOSS。投掷间隔随波次缩短（第 5 波约 2.85 秒，第 55 波 1.5 秒），需击杀的五边形数量 = 10 + 当前波次 ×2。\n\n<i>某位古希腊哲学家认为它代表以太，不知道为什么。</i>',
      iconShape: 'dodeca', iconColor: '#ff5dd6', iconSize: 0.85,
    },
    penta: {
      title: '紫色五边形 · BOSS 投掷物',
      tags: ['1 HP', '左右拖动', 'BOSS 战专属'],
      desc: 'BOSS 投出的五边形小怪，会随机左右晃动下落。每击杀一只就削减 BOSS 一点血量。\n\n<i>用一根纸带打一个活结就能得到它。</i>',
      iconShape: 'penta', iconColor: '#9d6dff', iconSize: 0.85,
    },
    icosa1: {
      title: '三角二十面体 · 顶级 · BOSS',
      tags: ['每 50 波周期', 'HP 随波次提升', '触底即败'],
      desc: '第 10、35、60…波出现的特殊 BOSS。可被激光直接击破，但会分裂成 2 个亚级。任何级别接触 x 轴游戏立即结束！基础 5 HP，每 25 波 +1（第 35 波 6 HP）。\n\n<i>那位古希腊哲学家认为它代表水，不过其实它更像史莱姆。</i>',
      iconShape: 'icosa', iconColor: '#ffd45d', iconSize: 0.85,
    },
    icosa2: {
      title: '亚-三角二十面体',
      tags: ['HP 随波次提升', '缓慢下落', '会生长'],
      desc: '由顶级三角二十面体分裂而来。基础 3 HP（每 20 波 +1）。击破后会分裂为 2 个次级。出现一段时间未被击杀会生长回顶级 —— 生长时间随波次缩短（第 20 波 16.5 秒、第 80 波 12 秒），最后 3 秒红光警告！\n\n<i>像细菌一样分裂。</i>',
      iconShape: 'icosa', iconColor: '#ffaa33', iconSize: 0.78,
    },
    icosa3: {
      title: '次-三角二十面体',
      tags: ['HP 随波次提升', '缓慢下落', '会生长'],
      desc: '由亚-三角二十面体分裂而来。基础 2 HP（每 20 波 +1）。击破后会分裂为 2 个终级。出现一段时间未被击杀会生长为亚级！\n\n<i>指数级增长，永无止境。</i>',
      iconShape: 'icosa', iconColor: '#ff7a00', iconSize: 0.7,
    },
    icosa4: {
      title: '终-三角二十面体',
      tags: ['HP 随波次提升', '缓慢下落', '会生长'],
      desc: '最小一级。基础 1 HP（每 20 波 +1）。击破即清除。但若一段时间内未被击杀会生长回次级 —— 不能放任不管！\n\n<i>呃，似乎是有止境的。</i>',
      iconShape: 'icosa', iconColor: '#ff5577', iconSize: 0.62,
    },
    pickup_shield: {
      title: '函数护盾',
      tags: ['掉落物', '+1 生命'],
      desc: '青色护盾图标。被激光接住后立即增加 1 点护盾值（生命）。每个被击杀的敌人有 15% 概率掉落，掉落后缓慢下落。',
      iconShape: 'pickup', iconColor: '#5dffd6', iconSize: 0.7, iconLabel: '🛡️',
    },
    pickup_eraser: {
      title: '橡皮擦 lv999',
      tags: ['掉落物', '清屏'],
      desc: '黄色擦除图标。被激光接住后立即清除当前屏幕上所有敌人（不包含 BOSS 和已掉落的其他道具），但不计分数。',
      iconShape: 'pickup', iconColor: '#ffe066', iconSize: 0.7, iconLabel: '🧽',
    },
    pickup_boost: {
      title: '复合函数包',
      tags: ['掉落物', '威力 ×2 · 3 发'],
      desc: '橙红色目标图标。被激光接住后，接下来的 3 发激光威力翻倍（敌人扣 2 滴血而非 1 滴）。',
      iconShape: 'pickup', iconColor: '#ff8c5d', iconSize: 0.7, iconLabel: '🎯',
    },
    pickup_freeze: {
      title: '急速制冷-狼',
      tags: ['掉落物', '全场冰冻 10 秒'],
      desc: '淡蓝色雪花图标。被激光接住后，全场敌人变成淡蓝色并完全静止 10 秒（BOSS 不受影响），10 秒内可以从容收割所有冰冻怪。',
      iconShape: 'pickup', iconColor: '#88ddff', iconSize: 0.7, iconLabel: '❄️',
    },
    hexagram: {
      title: '六芒星 · 护盾精英',
      tags: ['3 HP', '较慢下落', '展开能量护盾'],
      desc: '第 10 波后出现。在自身周围展开能量护盾，护盾内除自己外所有怪物免疫激光。多只六芒星之间也互不防御，玩家可以集火击杀任意一只来打破护盾链。死亡或离开护盾范围后效果解除。\n\n<i>在曾经认为的地球中心，这种图案被认为可以保护人们。</i>',
      iconShape: 'hexagram', iconColor: '#88ccff', iconSize: 0.85,
    },
    hep: {
      title: '七边形 · 自爆精英',
      tags: ['1 HP', '速度较快', '触底自爆 / 死亡 AOE'],
      desc: '第 10 波后出现。1 HP 一击必杀但下落极快。触底时自爆造成 3 点伤害（直接打掉 3 颗心）。被激光击杀时进入 AOE 自爆，对周围 3 单位以内所有敌人造成 3 点伤害（boss 类不受影响）。可以借此连锁清场，但要小心别让它触底。\n\n<i>“火气别那么大嘛！”“*函数粗口*”。</i>',
      iconShape: 'hep', iconColor: '#ff8844', iconSize: 0.85,
    },
    inv7: {
      title: '逆七芒星 · 狂热精英',
      tags: ['2 HP', '下落很慢', '狂热粒子束'],
      desc: '第 15 波后出现。每 5-8 秒朝随机一只小怪发射红色狂热粒子束 —— 被击中的怪 HP 降为 1、速度提升至两倍、触底伤害翻倍、发出红光。优先击杀逆七芒星可避免更多怪被狂热。它不会强化正七芒星、其他逆七芒星、十芒星、或已上 buff 的怪。\n\n<i>它一直为自己是几何图形中最擅长演讲的一个而自豪。</i>',
      iconShape: 'inv7', iconColor: '#ff3344', iconSize: 0.85,
    },
    star7: {
      title: '正七芒星 · 祝福精英',
      tags: ['10 HP', '下落极慢', '祝福伤害承担'],
      desc: '第 15 波后出现。每 6 秒朝随机一只小怪发射绿色祝福粒子束 —— 被祝福的怪发出绿光，受到的所有激光伤害由该正七芒星代为承担。正七芒星有 10 HP 但下落极慢；它死亡后，所有受它祝福的怪解除祝福状态。它不会祝福逆七芒星、其他正七芒星、十芒星、或已"狂热/祝福/毁灭"的怪。\n\n<i>心如止水。</i>',
      iconShape: 'star7', iconColor: '#44dd88', iconSize: 0.85,
    },
    star9: {
      title: '九芒星 · 禁闭精英',
      tags: ['3 HP', '速度极慢', '函数禁闭'],
      desc: '第 10 波后出现。出生时从「三角函数 / y=常数 / x=常数 / 幂函数 / 指数函数」中随机选取 2 类附加禁闭 —— 玩家发射这两类函数会被拦截。禁闭效果持续到该九芒星死亡。它头顶显示被禁的两类。如果场上同时有多只九芒星，被禁类别会叠加。\n\n<i>刻意为人添堵——这么做的不止它一个。</i>',
      iconShape: 'star9', iconColor: '#ffaa44', iconSize: 0.85,
    },
    star10: {
      title: '十芒星 · 毁灭精英',
      tags: ['15 HP', '速度极为缓慢', '黑色毁灭粒子束'],
      desc: '第 20 波后出现。每 3-6 秒朝随机一只小怪发射黑色「毁灭」粒子束 —— 被毁灭的怪 HP 降为 1、失去自身所有技能、速度略减慢、发出黑光。毁灭可以直接覆盖狂热和祝福状态。被打死时不会真正消失，而是变成「黑烟」5 秒后原地复活（仍处于毁灭状态）。十芒星本身有 15 HP 且速度极为缓慢，且免疫狂热和祝福；它死亡时所有它毁灭的怪（包括黑烟中）一起死亡。\n\n<i>“我就是死灵法师！”。</i>',
      iconShape: 'star10', iconColor: '#222233', iconSize: 0.9,
    },
    oct: {
      title: '八边形 · 召唤精英',
      tags: ['5 HP', '移动慢', '闪烁金光', '召唤扈从'],
      desc: '第 15 波后出现。八边形闪烁金光，移动缓慢，每 2 秒向四周发射 1 只「次级八边形 · 扈从」。扈从围绕本体做圆周运动 —— 直到本体被击杀。本体死亡瞬间，所有扈从朝外飞散并开始正常下落。\n\n<i>平身，四海之内几何图形，吾乃汝等之天命之君。</i>',
      iconShape: 'oct', iconColor: '#ffd700', iconSize: 0.85,
    },
    octminion: {
      title: '次级八边形 · 扈从',
      tags: ['1 HP', '不会自然出现', '围绕母体'],
      desc: '由八边形精英每 2 秒发射 4 只。闪烁金光，以母体为圆心做圆周运动，免疫伤害；母体死亡时，扈从朝外飞散，开始正常下落（移速较快）。\n\n<i>“老大没了我们也得为它复仇！”</i>',
      iconShape: 'octminion', iconColor: '#ffd700', iconSize: 0.65,
    },
    star8: {
      title: '八芒星 · 雾隐精英',
      tags: ['3 HP', '缓慢下落', '雾隐遮挡'],
      desc: '第 20 波后出现。每隔 4-10 秒进入「雾隐」状态：自身变为半径 12 的灰色烟雾团并完全静止，雾隐期间无法被激光击中，且会完全遮蔽背后所有敌人的视野（敌人虽不可见，仍可被命中）。雾隐持续 7 秒后扩散消散，恢复常态。被雾笼罩过的敌人获得「雾中行」buff：散发微弱烟雾、速度略加快、横向漂移，受击一次后解除。\n\n<i>来自雾都的几何图形，其他人担心它造成空气污染。</i>',
      iconShape: 'star8', iconColor: '#bbbbcc', iconSize: 0.85,
    },
    sphere: {
      title: '球 · 黑洞 BOSS',
      tags: ['每 50 波周期', '可被激光击中', '吸收速率随波次提升'],
      desc: '出现在第 15、40、65... 波。不会下落，固定在 (0, 15)。会随机吸收场上小怪 —— 每吸收一只 HP +1、体积变大。一旦体积大到接触 x 轴游戏立即结束！激光可以打它，HP 减少则体积缩小。吸收间隔随波次缩短（第 15 波 3-6 秒，第 65 波 1.5-3 秒，cap 50%）。击败后有 6 秒爆炸动画 + 全屏紫色闪烁收尾。\n\n<i>它比真黑洞还厉害——它不会霍金蒸发。</i>',
      iconShape: 'sphere', iconColor: '#aa44ff', iconSize: 0.85,
    },
    gambler: {
      title: '立方体 · 赌徒 BOSS',
      tags: ['每 50 波周期', '免疫一切伤害', '每 10 秒投骰子', 'HP 随波次提升'],
      desc: '出现在第 20、45、70... 波。固定在 (0, 15)，身披银色金属铠甲，**免疫激光的所有伤害**。每 10 秒投一次骰子，结果完全随机：\n\n🎲 1：自爆，扣自己 1 点血 —— 这是玩家唯一的击败手段\n🎲 2：召唤 10 个小怪\n🎲 3：场上所有敌人陷入狂热\n🎲 4：召唤 3 个八芒星\n🎲 5：随机方向投掷 5 个七边形\n🎲 6：随机方向投掷 10 个狂热七边形\n\n初始 HP 随波次提升：20 波 5 HP，45 波 7 HP，70 波 9 HP。打不过它的话 —— 只能祈祷骰子赏脸。被击败后爆炸成银色碎片。\n\n<i>所有或者一无所有，你选择了或者。</i>',
      iconShape: 'gambler', iconColor: '#c8cfd6', iconSize: 0.85,
    },
    emperor: {
      title: '正八面体 · 帝皇 BOSS',
      tags: ['每 50 波周期', '三阶段战', '45 秒倒计时秒杀', 'HP 随波次提升'],
      desc: '出现在第 25、50、75... 波。固定在 (0, 18)，金色正八面体之躯，可被激光直接打中。三阶段战 —— 必须连续击破 100 点 HP 才能斩王。\n\n👑 阶段一(20 HP)：朝四个方向(远/近左下/右下)抛投小三角形，每 7 秒一波。\n👑 阶段二(30 HP)：在阶段一的基础上叠加红白渐变极光弹幕 —— 三角形改为每 5 秒一波，每 1.2 秒一波 3 颗扇形弹幕。弹幕触底扣 1 命，但可被激光击毁。\n👑 阶段三(50 HP)：进入【几何登基】状态！三角形 + 弹幕(每 1.5 秒 4 颗) 双重压力 + 45 秒倒计时 —— 若 45 秒内未将其击杀，王座降临，巨大华丽极光从天而降即时秒杀玩家！\n\n阶段切换时帝皇短暂无敌、震屏宣告。初始总 HP 随波次提升：25 波 100 HP，50 波 120 HP，75 波 140 HP。被击败后连续爆炸喷射金色粒子流。\n\n<i>几何图形的王者，皇帝，千万不能叫他三方反棱柱。</i>',
      iconShape: 'emperor', iconColor: '#ffd45d', iconSize: 0.85,
    },
  },

  /**
   * 标记一种敌人已被遇到。如果首次遇到，加入图鉴弹窗队列。
   * 不在 CODEX_DATA 里的 codexKey 忽略。
   */
  _recordEnemy(enemy) {
    const s = this.state;
    if (!enemy) return;
    if (s.wave === 0) return;        // 教程波次：完全静默，不弹任何图鉴
    const key = this._codexKeyOf(enemy);
    if (!key || !this.CODEX_DATA[key]) return;
    if (s.seenEnemies.has(key)) return;
    s.seenEnemies.add(key);
    this._saveSeenEnemies();
    s.pendingCodex.push(key);
    this._tryShowNextCodex();
  },

  /** 从 localStorage 加载已遭遇敌人集合 */
  _loadSeenEnemies() {
    try {
      const raw = localStorage.getItem('fh_seen_enemies');
      if (raw) return new Set(JSON.parse(raw));
    } catch (e) {}
    return new Set();
  },

  /** 把 seenEnemies 持久化到 localStorage */
  _saveSeenEnemies() {
    try {
      localStorage.setItem('fh_seen_enemies', JSON.stringify([...this.state.seenEnemies]));
    } catch (e) {}
  },

  /** 记录玩家用过的基础函数到 localStorage（无弹窗） */
  _recordFunction(expr) {
    if (!expr) return;
    const norm = (typeof Library !== 'undefined' && Library.normalize) ? Library.normalize(expr) : expr;
    const FUNC_KEYS = ['x^2','x^3','sqrt(x)','1/x','sin(x)','cos(x)','tan(x)','abs(x)','2^x','log(x)',
                       'x^2+y^2=4','x^2/9+y^2/4=1','x^2/9-y^2/4=1'];
    let matchedKey = null;
    if (FUNC_KEYS.includes(norm)) {
      matchedKey = norm;
    } else {
      // 简单匹配 base：剥离尾部 +/-数字
      // x^2+3 → x^2, sin(x)-1.5 → sin(x), 2^x+5 → 2^x
      const stripped = norm.replace(/[+-]\d+(?:\.\d+)?$/, '');
      if (FUNC_KEYS.includes(stripped)) matchedKey = stripped;
    }
    if (!matchedKey) return;
    try {
      const raw = localStorage.getItem('fh_seen_functions');
      const seen = raw ? new Set(JSON.parse(raw)) : new Set();
      if (seen.has(matchedKey)) return;
      seen.add(matchedKey);
      localStorage.setItem('fh_seen_functions', JSON.stringify([...seen]));
    } catch (e) {}
  },

  /** 记录玩家选过的效果到 localStorage（无弹窗） */
  _recordEffect(effectKey) {
    if (!effectKey) return;
    try {
      const raw = localStorage.getItem('fh_seen_effects');
      const seen = raw ? new Set(JSON.parse(raw)) : new Set();
      if (seen.has(effectKey)) return;
      seen.add(effectKey);
      localStorage.setItem('fh_seen_effects', JSON.stringify([...seen]));
    } catch (e) {}
  },

  /**
   * 由 enemy 对象推导图鉴键。
   * 因为 hex/star 的 type 都是 'elite'，需要看 shape 区分；
   * 普通小怪的 type='normal'，由 shape 区分 tri / square；
   * 其他特殊类型直接用 type。
   */
  _codexKeyOf(enemy) {
    if (!enemy) return null;
    if (enemy.codexKey) return enemy.codexKey;     // 显式指定优先
    if (!enemy.type) return null;
    if (enemy.type === 'elite') return enemy.shape;     // hex / star
    if (enemy.type === 'normal') return enemy.shape;    // tri / square
    return enemy.type;                                   // split / split_child / penta / boss / icosa1..4
  },

  /**
   * 批量标记：传入 enemies 数组，逐个 _recordEnemy
   */
  _recordEnemies(enemies) {
    for (const e of enemies) {
      this._recordEnemy(e);
    }
  },

  /**
   * 如果有待弹图鉴且当前未在显示，弹下一个
   */
  _tryShowNextCodex() {
    const s = this.state;
    if (s.codexShowing) return;
    if (s.pendingCodex.length === 0) return;
    const type = s.pendingCodex.shift();
    this._showCodexEntry(type);
  },

  /**
   * 弹出图鉴：延迟 0.5 秒后暂停 + 渲染弹窗
   * (让玩家先看到首次遇到的敌人/动作,再切到说明)
   */
  _showCodexEntry(type) {
    const data = this.CODEX_DATA[type];
    if (!data) return;
    const s = this.state;
    s.codexShowing = true;
    // 延迟 0.5 秒后才暂停+显示弹窗
    setTimeout(() => {
      if (!this.running) return;  // 0.5 秒里玩家死了 → 取消弹窗
      // 暂停（与 ESC 暂停共用机制，但不显示 pause-overlay）
      this.paused = true;
      // 渲染内容
      document.getElementById('codex-title').textContent = data.title;
      const meta = document.getElementById('codex-meta');
      meta.innerHTML = (data.tags || []).map(t => `<span class="codex-tag">${t}</span>`).join('');
      document.getElementById('codex-desc').innerHTML = data.desc;
      // 在弹窗 canvas 上画图标
      this._drawCodexIcon(data);
      // 显示
      document.getElementById('codex-overlay').classList.remove('hidden');
    }, 500);
  },

  /**
   * 关闭图鉴弹窗，弹下一个或恢复游戏
   */
  _closeCodexEntry() {
    const s = this.state;
    document.getElementById('codex-overlay').classList.add('hidden');
    s.codexShowing = false;
    if (s.pendingCodex.length > 0) {
      // 队列还有 → 弹下一个
      this._tryShowNextCodex();
    } else {
      // 队列空 → 恢复游戏（必须重新调度主循环，因为 paused=true 时它会 return）
      this.paused = false;
      this.lastTime = performance.now();
      requestAnimationFrame(this._loop);
    }
  },

  /**
   * 在图鉴弹窗的小 canvas 上绘制怪物预览图标
   */
  /**
   * 渲染图鉴图标到任意 canvas context
   * 可被 Game 自身（弹窗中央 codex-icon-canvas）和图鉴菜单（小卡片 + 详情图）共用
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx 中心 x
   * @param {number} cy 中心 y
   * @param {number} r  基础半径（已包含 iconSize 调节）
   * @param {object} data CODEX_DATA 条目
   */
  _drawCodexIcon(ctx, cx, cy, r, data) {
    // 兼容旧签名 _drawCodexIcon(data)：从 codex-icon-canvas 自动获取上下文
    if (arguments.length === 1) {
      const data2 = ctx;
      const canvas = document.getElementById('codex-icon-canvas');
      if (!canvas) return;
      const c2 = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      c2.clearRect(0, 0, W, H);
      const cx2 = W / 2, cy2 = H / 2;
      const r2 = Math.min(W, H) * 0.4 * (data2.iconSize || 0.8);
      this._drawCodexIcon(c2, cx2, cy2, r2, data2);
      return;
    }
    const color = data.iconColor || '#5dffd6';

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;

    if (data.iconShape === 'tri') {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.9, cy + r * 0.6);
      ctx.lineTo(cx - r * 0.9, cy + r * 0.6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (data.iconShape === 'square') {
      ctx.fillRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
      ctx.strokeRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
    } else if (data.iconShape === 'hex') {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i - Math.PI / 6;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (data.iconShape === 'star') {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 5 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.5;
        const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (data.iconShape === 'star4') {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 4 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.38;
        const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (data.iconShape === 'penta') {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * 2 / 5 * i - Math.PI / 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (data.iconShape === 'dodeca') {
      // BOSS：外五边形 + 内五角星
      ctx.fillStyle = 'rgba(255, 93, 214, 0.18)';
      ctx.beginPath();
      const outerR = r * 1.15;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * 2 / 5 * i - Math.PI / 2;
        const x = cx + Math.cos(a) * outerR, y = cy + Math.sin(a) * outerR;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 内层五角星
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 5 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r * 0.8 : r * 0.4;
        const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (data.iconShape === 'icosa') {
      // 三角二十面体：六边形外框 + 中心放射 + 内倒三角
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i - Math.PI / 6;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i - Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * 2 / 3 * i + Math.PI / 6;
        const x = cx + Math.cos(a) * r * 0.55;
        const y = cy + Math.sin(a) * r * 0.55;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    } else if (data.iconShape === 'pickup_shield') {
      // 函数护盾：纯线条盾牌 + 中央十字（黑白风格）
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = data.iconColor;
      // 盾牌外形：上方平直，左右收缩到底部尖角
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.55, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.55, cy + r * 0.05);
      ctx.quadraticCurveTo(cx + r * 0.5, cy + r * 0.55, cx, cy + r * 0.7);
      ctx.quadraticCurveTo(cx - r * 0.5, cy + r * 0.55, cx - r * 0.55, cy + r * 0.05);
      ctx.closePath();
      ctx.stroke();
      // 内部十字（生命/护盾符号）
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.28);
      ctx.lineTo(cx, cy + r * 0.32);
      ctx.moveTo(cx - r * 0.25, cy + r * 0.02);
      ctx.lineTo(cx + r * 0.25, cy + r * 0.02);
      ctx.stroke();
      ctx.lineCap = 'butt';
    } else if (data.iconShape === 'pickup_eraser') {
      // 橡皮擦：纯线条立体橡皮（顶部金属帽 + 底部主体）
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = data.iconColor;
      const rw = r * 1.0, rh = r * 0.55;
      const rad = r * 0.1;
      // 主体：圆角矩形（橡皮）
      ctx.beginPath();
      ctx.moveTo(cx - rw / 2 + rad, cy - rh / 2);
      ctx.lineTo(cx + rw / 2 - rad, cy - rh / 2);
      ctx.arcTo(cx + rw / 2, cy - rh / 2, cx + rw / 2, cy - rh / 2 + rad, rad);
      ctx.lineTo(cx + rw / 2, cy + rh / 2 - rad);
      ctx.arcTo(cx + rw / 2, cy + rh / 2, cx + rw / 2 - rad, cy + rh / 2, rad);
      ctx.lineTo(cx - rw / 2 + rad, cy + rh / 2);
      ctx.arcTo(cx - rw / 2, cy + rh / 2, cx - rw / 2, cy + rh / 2 - rad, rad);
      ctx.lineTo(cx - rw / 2, cy - rh / 2 + rad);
      ctx.arcTo(cx - rw / 2, cy - rh / 2, cx - rw / 2 + rad, cy - rh / 2, rad);
      ctx.closePath();
      ctx.stroke();
      // 中央水平分隔（橡皮金属/橡胶接合）
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx - rw / 2 + rad, cy - rh * 0.1);
      ctx.lineTo(cx + rw / 2 - rad, cy - rh * 0.1);
      ctx.stroke();
      // 上半部分斜线纹路（金属感）
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - rw * 0.32, cy - rh * 0.4);
      ctx.lineTo(cx - rw * 0.20, cy - rh * 0.25);
      ctx.moveTo(cx - rw * 0.10, cy - rh * 0.4);
      ctx.lineTo(cx + rw * 0.02, cy - rh * 0.25);
      ctx.moveTo(cx + rw * 0.12, cy - rh * 0.4);
      ctx.lineTo(cx + rw * 0.24, cy - rh * 0.25);
      ctx.stroke();
    } else if (data.iconShape === 'pickup_boost') {
      // 准星：同心圆 + 十字延伸（黑白风格，无中心填色点）
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = data.iconColor;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      // 中央十字
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.12);
      ctx.lineTo(cx, cy + r * 0.12);
      ctx.moveTo(cx - r * 0.12, cy);
      ctx.lineTo(cx + r * 0.12, cy);
      ctx.stroke();
      // 十字延伸线
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.85);
      ctx.lineTo(cx, cy - r * 0.65);
      ctx.moveTo(cx, cy + r * 0.65);
      ctx.lineTo(cx, cy + r * 0.85);
      ctx.moveTo(cx - r * 0.85, cy);
      ctx.lineTo(cx - r * 0.65, cy);
      ctx.moveTo(cx + r * 0.65, cy);
      ctx.lineTo(cx + r * 0.85, cy);
      ctx.stroke();
    } else if (data.iconShape === 'pickup_freeze') {
      // 雪花：6 道射线 + 末端 V 字分叉（黑白风格）
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = data.iconColor;
      const arms = 6;
      const armLen = r * 0.78;
      for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2 - Math.PI / 2;
        const ex = cx + Math.cos(a) * armLen;
        const ey = cy + Math.sin(a) * armLen;
        // 主臂
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // 末端 V 形分叉
        const fa1 = a + Math.PI - Math.PI / 4;
        const fa2 = a + Math.PI + Math.PI / 4;
        const fl = r * 0.22;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(fa1) * fl, ey + Math.sin(fa1) * fl);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(fa2) * fl, ey + Math.sin(fa2) * fl);
        ctx.stroke();
        // 中部交叉小线（雪花典型特征）
        const mx = cx + Math.cos(a) * armLen * 0.5;
        const my = cy + Math.sin(a) * armLen * 0.5;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + Math.cos(fa1) * fl * 0.6, my + Math.sin(fa1) * fl * 0.6);
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + Math.cos(fa2) * fl * 0.6, my + Math.sin(fa2) * fl * 0.6);
        ctx.stroke();
        ctx.lineWidth = 2.2;
      }
      ctx.lineCap = 'butt';
    } else if (data.iconShape === 'pickup') {
      // 兼容旧版（如果还有用 iconLabel）
      ctx.fillStyle = 'rgba(8, 17, 28, 0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = `${Math.round(r * 1.1)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(data.iconLabel || '?', cx, cy + 1);
    } else if (data.iconShape === 'hexagram') {
      // 六芒星：两个反向叠加三角形 + 周围护盾圆
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * 2 / 3 * i - Math.PI / 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * 2 / 3 * i + Math.PI / 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 护盾环
      ctx.strokeStyle = 'rgba(136, 204, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (data.iconShape === 'hep') {
      // 七边形：7 顶点 + 中心红点（自爆能量）
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 2 / 7 * i - Math.PI / 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 中心红点
      ctx.fillStyle = '#ff3322';
      ctx.shadowColor = '#ff5522';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    } else if (data.iconShape === 'oct') {
      // 八边形：8 顶点 + 内部小八角
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * 2 / 8 * i - Math.PI / 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 内部小八角
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff8c0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * 2 / 8 * i - Math.PI / 2 + Math.PI / 8;
        const x = cx + Math.cos(a) * r * 0.45;
        const y = cy + Math.sin(a) * r * 0.45;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    } else if (data.iconShape === 'octminion') {
      // 八边形扈从：纯八角形（小型）
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * 2 / 8 * i - Math.PI / 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (data.iconShape === 'inv7') {
      // 逆七芒星：14 个交替顶点，尖角朝下
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = Math.PI / 7 * i + Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.45;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 中心血红点
      ctx.fillStyle = '#ff0033';
      ctx.shadowColor = '#ff0033';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (data.iconShape === 'star7') {
      // 正七芒星：14 个交替顶点，尖角朝上 + 中心白光
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = Math.PI / 7 * i - Math.PI / 2;   // 朝上
        const radius = i % 2 === 0 ? r : r * 0.45;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 中心白光
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#aaffcc';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.20, 0, Math.PI * 2);
      ctx.fill();
    } else if (data.iconShape === 'star9') {
      // 九芒星：18 顶点交替 + 中心双层封印环
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const a = Math.PI / 9 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.50;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 中心封印双环
      ctx.shadowColor = '#ffaa44';
      ctx.shadowBlur = 16;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffd99c';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2); ctx.stroke();
    } else if (data.iconShape === 'star10') {
      // 十芒星：纯黑主体 + 极轻微紫光描边 + 中心黑点
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0a0a14';
      ctx.beginPath();
      for (let i = 0; i < 20; i++) {
        const a = Math.PI / 10 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.42;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      // 极轻微紫光描边
      ctx.shadowColor = '#9966ff';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#7744cc';
      ctx.stroke();
      // 中心黑点
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#000000';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2); ctx.fill();
    } else if (data.iconShape === 'star8') {
      // 八芒星：16 顶点交替 + 周围淡灰色雾光晕
      ctx.save();
      // 雾光晕作为背景提示
      const grad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.5);
      grad.addColorStop(0, 'rgba(200, 200, 215, 0.4)');
      grad.addColorStop(1, 'rgba(200, 200, 215, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // 八芒星本体
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = Math.PI / 8 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.45;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (data.iconShape === 'sphere') {
      // 黑洞：渐变光环 + 黑色实心圆
      const gradient = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.4);
      gradient.addColorStop(0, 'rgba(170, 80, 255, 0.0)');
      gradient.addColorStop(0.5, 'rgba(170, 80, 255, 0.55)');
      gradient.addColorStop(1, 'rgba(255, 100, 200, 0.0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0a0014';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(170, 80, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.83, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
    } else if (data.iconShape === 'gambler') {
      // 立方体·赌徒：银色金属正方形 + 中心骰子5点装饰
      // 外层菱形（45°旋转的方框，表示装饰外框）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = '#9aa5b3';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(200, 207, 214, 0.10)';
      ctx.beginPath();
      ctx.rect(-r * 1.15, -r * 1.15, r * 2.3, r * 2.3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // 主体正方形：银色金属渐变
      const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      grad.addColorStop(0,   '#ffffff');
      grad.addColorStop(0.3, '#dee3eb');
      grad.addColorStop(0.55,'#a8b1bc');
      grad.addColorStop(0.85,'#6e7785');
      grad.addColorStop(1,   '#454c56');
      ctx.fillStyle = grad;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#dde3eb';
      ctx.shadowBlur = 16;
      ctx.fillRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
      ctx.strokeRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);

      // 中心 5 点骰子图案
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2a2f38';
      const dotR = r * 0.10;
      const off = r * 0.42;
      const dots = [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]];
      for (const [dx, dy] of dots) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (data.iconShape === 'emperor') {
      // 正八面体·帝皇：金色菱形(上下三角拼接) + 内部高光 + 王冠装饰
      // 外层金色光晕
      const haloGrad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.5);
      haloGrad.addColorStop(0, 'rgba(255, 212, 93, 0.45)');
      haloGrad.addColorStop(1, 'rgba(255, 212, 93, 0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // 正八面体 = 上下两个三角形相对组合 = 菱形外轮廓
      const topY = cy - r * 1.0;
      const botY = cy + r * 1.0;
      const lftX = cx - r * 0.85;
      const rgtX = cx + r * 0.85;

      // 渐变填充：从上往下,金色 → 暗金
      const grad = ctx.createLinearGradient(cx, topY, cx, botY);
      grad.addColorStop(0,   '#fff6c8');
      grad.addColorStop(0.3, '#ffd45d');
      grad.addColorStop(0.7, '#d4a020');
      grad.addColorStop(1,   '#6b4f0e');
      ctx.fillStyle = grad;
      ctx.strokeStyle = '#fff8d0';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#ffd45d';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(cx, topY);
      ctx.lineTo(rgtX, cy);
      ctx.lineTo(cx, botY);
      ctx.lineTo(lftX, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 中线（上下三角分界）
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lftX, cy);
      ctx.lineTo(rgtX, cy);
      ctx.stroke();

      // 顶点高光（白点）
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, topY + r * 0.15, r * 0.08, 0, Math.PI * 2);
      ctx.fill();

      // 中央"皇冠"小标记（3 个小金点呈三角排列）
      ctx.fillStyle = '#fff8d0';
      ctx.shadowColor = '#ffe066';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.15, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx - r * 0.18, cy + r * 0.05, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + r * 0.18, cy + r * 0.05, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  /**
   * 逆七芒星：每 10 秒朝随机怪发射诅咒粒子束
   * 被击中怪：HP→1，速度 ×2，触底伤害 ×2，发红光
   */
  _updateInv7Beams(dt) {
    const s = this.state;
    // 推进现有粒子束动画
    s.inv7Beams = s.inv7Beams.filter(b => {
      b.age += dt;
      return b.age < b.duration;
    });
    // 检查每只 inv7 是否到了发射时机
    for (const inv of s.enemies) {
      if (inv.shape !== 'inv7' || inv.hp <= 0) continue;
      if (inv.doomedBy) continue;        // 被十芒星毁灭：失去技能
      if (inv.smokeTimer > 0) continue;   // 黑烟中：跳过
      if (inv.fireTimer > 0) continue;
      // 重置下次发射间隔（每次重新在 5-8 秒区间随机）
      inv.fireTimer = 5 + Math.random() * 3;
      // 选择一只目标（不选自己、其他逆七芒星、boss、icosa、sphere、十芒星、被吸收中、已强化、已祝福、已毁灭、黑烟、正七芒星）
      const candidates = s.enemies.filter(e =>
        e !== inv && e.hp > 0 &&
        e.shape !== 'icosa' && e.shape !== 'sphere' &&
        e.shape !== 'star7' &&            // 不强化正七芒星
        e.shape !== 'inv7' &&             // 不强化其他逆七芒星
        e.shape !== 'star10' &&           // 不强化十芒星
        !e.absorbing && !e.buffed && !e.blessedBy &&
        !e.doomedBy && !(e.smokeTimer > 0)
      );
      if (candidates.length === 0) continue;
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      // 应用狂热：HP 设为 1（不增加），速度 ×2，触底伤害 ×2，红光
      if (target.hp > 1) target.hp = 1;
      target.vy *= 2;
      target.buffed = true;
      target.touchDamage = 2;          // 触底扣 2 命
      // 加入粒子束动画
      s.inv7Beams.push({
        fromX: inv.x, fromY: inv.y,
        toX: target.x, toY: target.y,
        age: 0,
        duration: 0.4,
      });
      this._spawnExplosion(target.x, target.y, '#ff3344');
      this._addDamageNumber(target.x, target.y + 0.3, '狂热', '#ff3344');
    }
  },

  /**
   * 正七芒星：每 10 秒朝随机怪发射绿色祝福粒子束
   * 被祝福的怪：发绿光，受到的伤害由该正七芒星承担
   * star7 死亡时所有它祝福的怪解除祝福（在命中循环中处理）
   */
  _updateStar7Beams(dt) {
    const s = this.state;
    // 推进现有粒子束动画
    s.star7Beams = s.star7Beams.filter(b => {
      b.age += dt;
      return b.age < b.duration;
    });
    for (const star7 of s.enemies) {
      if (star7.shape !== 'star7' || star7.hp <= 0) continue;
      if (star7.doomedBy) continue;       // 被十芒星毁灭：失去技能
      if (star7.smokeTimer > 0) continue;
      if (star7.fireTimer > 0) continue;
      star7.fireTimer = 6;  // 固定 6 秒间隔（之前 10 秒）
      // 选择目标：不选自己、其他正七芒星、boss、icosa、sphere、十芒星、被吸收中、狂热、已祝福、已毁灭、黑烟、逆七芒星
      const candidates = s.enemies.filter(e =>
        e !== star7 && e.hp > 0 &&
        e.shape !== 'icosa' && e.shape !== 'sphere' &&
        e.shape !== 'inv7' &&             // 不祝福逆七芒星
        e.shape !== 'star7' &&            // 不祝福其他正七芒星
        e.shape !== 'star10' &&           // 不祝福十芒星
        !e.absorbing && !e.buffed && !e.blessedBy &&
        !e.doomedBy && !(e.smokeTimer > 0)
      );
      if (candidates.length === 0) continue;
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      // 应用祝福：绑定 star7 ID（作为伤害承担引用）
      target.blessedBy = star7.id;
      // 加入粒子束动画
      s.star7Beams.push({
        fromX: star7.x, fromY: star7.y,
        toX: target.x, toY: target.y,
        age: 0,
        duration: 0.4,
      });
      this._spawnExplosion(target.x, target.y, '#44dd88');
      this._addDamageNumber(target.x, target.y + 0.3, '祝福', '#44dd88');
    }
  },

  /**
   * 十芒星：每 3-6 秒朝随机怪发射黑色"毁灭"粒子束
   * 被毁灭的怪：HP=1 + 失去技能 + 速度略减慢 + 黑光
   * 被打死时进入 3 秒黑烟期，期满原地复活；十芒星死亡时所有毁灭怪直接死亡
   */
  _updateStar10Beams(dt) {
    const s = this.state;
    s.star10Beams = s.star10Beams.filter(b => {
      b.age += dt;
      return b.age < b.duration;
    });
    for (const s10 of s.enemies) {
      if (s10.shape !== 'star10' || s10.hp <= 0) continue;
      if (s10.fireTimer > 0) continue;
      s10.fireTimer = 3 + Math.random() * 3;   // 每次 3-6 秒
      // 选择目标：不选 boss/icosa/sphere、自己、其他 star10、已毁灭、黑烟
      // 允许目标已狂热/已祝福 —— 毁灭直接覆盖这些 buff
      const candidates = s.enemies.filter(e =>
        e !== s10 && e.hp > 0 &&
        e.shape !== 'icosa' && e.shape !== 'sphere' &&
        e.shape !== 'star10' &&            // 不毁灭其他十芒星
        !e.absorbing &&
        !e.doomedBy && !(e.smokeTimer > 0)
      );
      if (candidates.length === 0) continue;
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      // 应用毁灭：先清掉狂热/祝福（被毁灭覆盖），然后施加毁灭效果
      if (target.buffed) {
        target.buffed = false;
        target.touchDamage = 1;            // 还原触底伤害
        // 注意：vy 之前被狂热 ×2，覆盖时按当前 vy 继续 ×0.85（不完美还原但合理）
      }
      if (target.blessedBy) {
        target.blessedBy = null;            // 解除祝福绑定
      }
      target.doomedBy = s10.id;
      target.preDoomHp = target.hp;
      target.preDoomVy = target.vy;
      target.hp = 1;
      target.vy = target.vy * 0.85;     // 速度略减慢
      // 加入粒子束动画
      s.star10Beams.push({
        fromX: s10.x, fromY: s10.y,
        toX: target.x, toY: target.y,
        age: 0,
        duration: 0.45,
      });
      this._spawnExplosion(target.x, target.y, '#222233');
      this._addDamageNumber(target.x, target.y + 0.3, '毁灭', '#9966ff');
    }
  },

  /**
   * 八边形：每 2 秒召唤 1 只扈从（围绕自己圆周运动），单只八边形周围最多 8 只扈从
   */
  _updateOctSpawners(dt) {
    const s = this.state;
    for (const oct of s.enemies) {
      if (oct.shape !== 'oct' || oct.hp <= 0) continue;
      if (oct.smokeTimer > 0) continue;
      // 数当前 master 周围还活着的扈从数（仍 orbiting）
      const aliveMinions = s.enemies.filter(e =>
        e.shape === 'octminion' && e.hp > 0 && e.orbiting && e.masterId === oct.id
      );
      if (aliveMinions.length >= 8) continue;  // 已达上限，停止召唤
      oct.spawnTimer = (oct.spawnTimer || 2.0) - dt;
      if (oct.spawnTimer > 0) continue;
      oct.spawnTimer = oct.spawnInterval || 2.0;
      // 计算下一只扈从的轨道角（让现有扈从均匀分布）
      // 简单做法：把现有扈从的 orbitAngle 当成参考，新的从最稀疏的"空缺"方向放
      // 这里用最简单：每召唤一只就往 oct.angle 偏移加 (PI/4 * 召唤次数)
      oct.spawnedCount = (oct.spawnedCount || 0) + 1;
      const angle = (oct.angle || 0) + (oct.spawnedCount * Math.PI / 4);
      const radius = 1.8;
      const minion = Spawner.createEnemy({
        x: oct.x + Math.cos(angle) * radius,
        y: oct.y + Math.sin(angle) * radius,
        type: 'normal',
        shape: 'octminion',
        color: '#ffd700',
        vy: -1.4,
        hp: 1,
        score: 80,
        size: 0.4,
        wave: s.wave,
        orbitAngle: angle,
        orbitRadius: radius,
        masterId: oct.id,
      });
      s.enemies.push(minion);
      this._recordEnemy(minion);
      this._spawnExplosion(oct.x, oct.y, '#ffd700');
    }
  },

  /**
   * 雾中行 buff：每帧扫所有 fogActive 的 star8，对其雾范围内的怪打上 mistyTouched
   * 首次打上时：vy ×= 1.15、设横向漂移 vx 摆动
   * 受激光命中一次后由命中循环清除（buff 不抵消伤害）
   */
  _updateMistyTouch(dt) {
    const s = this.state;
    const FOG_R = 12;   // 与渲染保持一致
    // 找出所有正在雾隐的 star8
    const foggers = s.enemies.filter(e => e.shape === 'star8' && e.fogActive && e.hp > 0);
    if (foggers.length > 0) {
      for (const e of s.enemies) {
        if (e.shape === 'star8') continue;        // star8 自身不被雾化
        if (e.shape === 'icosa' || e.shape === 'sphere') continue;  // boss 类不受影响
        if (e.smokeTimer > 0) continue;            // 黑烟中不受影响
        if (e.mistyTouched) {
          // 已经是 misty 了：仅推进漂移摆动
          e.mistyDriftPhase = (e.mistyDriftPhase || 0) + dt;
          continue;
        }
        // 检查是否在任一雾团内
        for (const fog of foggers) {
          const dx = e.x - fog.x, dy = e.y - fog.y;
          if (dx * dx + dy * dy <= FOG_R * FOG_R) {
            // 首次打上 buff
            e.mistyTouched = true;
            e.vy *= 1.15;                        // 速度略微加快
            e.mistyDriftAmp = 0.6 + Math.random() * 0.5;   // 漂移幅度
            e.mistyDriftFreq = 0.8 + Math.random() * 0.6;  // 摆动频率
            e.mistyDriftPhase = Math.random() * Math.PI * 2;
            break;
          }
        }
      }
    }
    // 应用横向漂移（mistyTouched 怪每帧根据相位更新 x）
    for (const e of s.enemies) {
      if (!e.mistyTouched) continue;
      if (e.smokeTimer > 0) continue;
      if (e.fogActive) continue;
      // 横向漂移：sin 波形，幅度 mistyDriftAmp，频率 mistyDriftFreq Hz
      // dx = amp * cos(phase) * dt（让 vx 平滑变化）
      const phase = e.mistyDriftPhase || 0;
      const driftVx = (e.mistyDriftAmp || 0.6) * Math.cos(phase * (e.mistyDriftFreq || 1));
      e.x += driftVx * dt;
    }
  },

  /**
   * 黑烟复活：扫所有处于 smokeTimer 倒计时的怪，倒计时到 0 → 原地复活
   * 复活后保持毁灭状态：HP=1、doomedBy 保留、vy 保留减慢值
   */
  _updateSmokeRevive() {
    const s = this.state;
    for (const e of s.enemies) {
      if (e.smokeTimer !== undefined && e.smokeTimer <= 0 && e._wasSmoking) {
        // 复活：HP=1（毁灭设定）+ 保持 doomedBy + 保持减慢的 vy
        e._wasSmoking = false;
        e.smokeTimer = 0;
        e.hp = 1;     // 仍处于毁灭，HP 仍为 1
        // 复活视觉
        this._spawnExplosion(e.x, e.y, '#9966ff');
        this._addDamageNumber(e.x, e.y + 0.3, '复活', '#cc99ff');
      }
    }
  },

  /**
   * 三角二十面体生长：tier > 1 的 icosa 出生 growTime 秒未死 → 升级为上一级
   * 升级保留位置和速度方向（vy/vx 重置为 tier-1 配置的初速度，因为大块体积应慢一些）
   * 实际做法：原地用上一级 tier 重新创建一个，替换数组中的引用
   */
  _updateIcosaGrowth() {
    const s = this.state;
    let needRecenter = false;
    for (let i = 0; i < s.enemies.length; i++) {
      const e = s.enemies[i];
      if (e.shape !== 'icosa') continue;
      if (!e.growTime || e.growTime <= 0) continue;       // 顶级不生长
      if (e.growTimer < e.growTime) continue;
      // 时间到，升级
      const newTier = e.tier - 1;
      const upgraded = Spawner.createIcosa(newTier, { x: e.x, y: e.y, wave: e.spawnWave || s.wave });
      if (!upgraded) continue;
      // 保留水平动量（视觉连贯）
      upgraded.vx = e.vx || 0;
      upgraded.wanderTargetVx = e.wanderTargetVx;
      // 替换数组中的引用
      s.enemies[i] = upgraded;
      // 提示玩家
      this._addDamageNumber(e.x, e.y + 0.8, '生长！', '#ff5577');
      this._spawnExplosion(e.x, e.y, '#ff5577');
      showToast(`⚠️ 三角二十面体生长 → ${this._icosaLabel(newTier)}！`, 1500);
      needRecenter = true;
    }
    if (needRecenter) {
      this._centerViewOnBoss();
    }
  },

  _icosaLabel(tier) {
    return ({ 1: '三角二十面体', 2: '亚-二十面体', 3: '次-二十面体', 4: '终-二十面体' })[tier] || 'BOSS';
  },

  /**
   * 球更新：吸收小怪、体积同步、自转、触底判定
   */
  _updateSphere(dt) {
    const s = this.state;
    if (!s.sphere) return;
    s.sphere.angle = (s.sphere.angle || 0) + dt * 0.8;
    // 死亡阶段：仅自转，不吸收、不再触发 _defeatSphere
    if (s.sphere.dying) return;

    // 吸收倒计时（更慢：3–6 秒）
    s.sphere.absorbTimer -= dt;
    if (s.sphere.absorbTimer <= 0) {
      // 选择 1 只可吸收的目标（仅未在被吸收中的普通/精英）
      const candidates = s.enemies.filter(e =>
        !e.absorbing &&
        e.shape !== 'icosa' && e.shape !== 'sphere' && e.type !== 'boss'
      );
      if (candidates.length > 0) {
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        // 标记为被吸收，spawn.js update 接管它的运动
        target.absorbing = true;
        target.absorbStart = { x: target.x, y: target.y };
        target.absorbTarget = { x: s.sphere.x, y: s.sphere.y };
        target.absorbProgress = 0;
        target.absorbDuration = 1.0;  // 1 秒到达球心
        // 视觉：从敌人位置画一道粒子飞向球（提示）
        this._spawnAbsorbBeam(target.x, target.y, s.sphere.x, s.sphere.y, target.color);
      }
      // 下一次吸收倒计时（3-6 秒基础，随波次缩短）
      // 第 30 波 100% (3-6s)、第 60 波 75% (2.25-4.5s)、第 90 波 50% (1.5-3s)
      const speedFactor = Math.max(0.5, 1 - (s.wave - 30) / 120);
      s.sphere.absorbTimer = (3.0 + Math.random() * 3.0) * speedFactor;
    }

    // 检查所有正在被吸收的怪是否到达球心
    let absorbedCount = 0;
    for (const e of s.enemies) {
      if (e.absorbing && e.absorbProgress >= 1) {
        e.hp = -999;  // 标记死亡
        s.sphere.hp += 1;
        absorbedCount++;
      }
    }
    if (absorbedCount > 0) {
      s.enemies = s.enemies.filter(e => e.hp > 0 || e.smokeTimer > 0);
    }

    // 体积平滑过渡到目标值
    const targetSize = Spawner.sphereSize(Math.max(1, s.sphere.hp));
    const k = 1 - Math.exp(-2 * dt);
    s.sphere.size = (s.sphere.size || targetSize) + (targetSize - (s.sphere.size || targetSize)) * k;

    // 触底判定：球底部 = y - size，<=0 → GG
    if (s.sphere.y - s.sphere.size <= 0) {
      this._addDamageNumber(0, 0, '黑洞吞噬！', '#ff5577');
      this._shakeScreen();
      this._gameOver();
      return;
    }

    // 球 HP 归零 → 击败
    if (s.sphere.hp <= 0) {
      this._defeatSphere();
    }
  },

  /**
   * 击败球：分数奖励 + 大爆炸 + 进下一波
   */
  _defeatSphere() {
    const s = this.state;
    if (!s.sphere) return;
    const x = s.sphere.x, y = s.sphere.y;
    const sphereSize = s.sphere.size;
    const peakSize = sphereSize * 1.8;
    const sphereScore = s.sphere.score || 8000;   // 提前存：下面要清掉 sphere 引用

    // 独立的死亡动画对象（不依赖 sphere 引用）
    s.sphereDeathAnim = {
      x: x, y: y,
      startSize: sphereSize,
      peakSize: peakSize,
      age: 0,
      duration: 6.0,            // 6 秒（之前 1.4）
    };

    // 立即清掉 sphere
    s.sphere = null;

    // 紫闪挪到死亡动画结束时触发（之前是立即闪，会盖住球爆炸）
    // 由 sphereDeathAnim 推进时检测到结束 → 设 purpleFlash = 1.0

    // 大爆炸：20 组爆炸 + 200 颗放射紫粒子（更多更密）
    for (let i = 0; i < 20; i++) {
      this._spawnExplosion(
        x + (Math.random() - 0.5) * sphereSize * 1.8,
        y + (Math.random() - 0.5) * sphereSize * 1.8,
        '#aa44ff'
      );
    }
    for (let i = 0; i < 200; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      s.particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: '#aa44ff',
        size: 0.10 + Math.random() * 0.10,
        age: 0,
        life: 3.0 + Math.random() * 1.5,    // 3-4.5 秒（让粒子在 6 秒动画中段还能看到）
        alpha: 1,
      });
    }
    for (let i = 0; i < 50; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      s.particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: '#ffffff',
        size: 0.08 + Math.random() * 0.06,
        age: 0,
        life: 1.0 + Math.random() * 0.6,
        alpha: 1,
      });
    }
    this._shakeScreen();
    this._shakeScreen();
    this._shakeScreen();

    // 所有场上小怪死亡
    for (const e of s.enemies) {
      if (e.shape === 'icosa') continue;
      this._spawnExplosion(e.x, e.y, e.color);
    }
    s.enemies = s.enemies.filter(e => e.shape === 'icosa');

    const score = sphereScore;
    s.score += score;
    s.kills++;
    this._addDamageNumber(x, y, `+${score} 球击败！`, '#ffe066');
    showToast(`🏆 黑洞球击败！+${score} 分`, 2400);

    // 延迟 8 秒进下一波（6 秒死亡动画 + 2 秒紫闪收尾）
    s.pendingNextWave = {
      delay: 8.0,
      callback: () => {
        this._resetViewWithTween();
        s.wave++;
        this._spawnInitialWave();
        this._updateHUD();
        showToast(`第 ${s.wave} 波`, 1200);
      },
    };
    this._updateHUD();
    this._checkLevelUp();
  },

  /**
   * 球吸收特效：从敌人位置飞向球的粒子流
   */
  _spawnAbsorbBeam(fromX, fromY, toX, toY, color) {
    // 简单做法：在两点之间播洒一串粒子
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      this.state.particles.push({
        x: fromX + (toX - fromX) * t,
        y: fromY + (toY - fromY) * t,
        vx: 0, vy: 0,
        color: color || '#aaccff',
        size: 0.05,
        age: 0,
        life: 0.5,
        alpha: 1,
      });
    }
  },

  /**
   * 击败 BOSS：奖励分数、清场、推进波次
   */
  _defeatBoss() {
    const s = this.state;
    if (!s.boss) return;
    const bx = s.boss.x, by = s.boss.y;
    const bossColor = s.boss.color;

    // 启动死亡动画：主循环按阶段触发粒子（前 0.6 秒小股预爆 + 0.6 秒后主大爆炸）
    s.bossDeathAnim = {
      x: bx, y: by,
      color: bossColor,
      age: 0,
      duration: 5.0,
    };
    this._shakeScreen();   // 立即一震，让玩家感知 boss 死了

    s.score += s.boss.score;
    s.kills++;
    this._addDamageNumber(bx, by, `+${s.boss.score} BOSS`, '#ffe066');
    showToast(`🏆 五角十二面体击败！+${s.boss.score} 分`, 2400);

    // 立即清掉 boss 和场上 penta（同时爆炸）
    s.boss = null;
    s.pentaKillCount = 0;
    for (const e of s.enemies) {
      if (e.type === 'penta') {
        this._spawnExplosion(e.x, e.y, e.color);
      }
    }
    s.enemies = s.enemies.filter(e => e.type !== 'penta');

    // 延迟 5 秒再推进下一波（让全段死亡动画播完）
    s.pendingNextWave = {
      delay: 5.0,
      callback: () => {
        this._resetViewWithTween();
        s.wave++;
        this._spawnInitialWave();
        this._updateHUD();
        showToast(`第 ${s.wave} 波`, 1200);
      },
    };
    this._checkLevelUp();
  },

  /**
   * 死亡动画阶段 1：每 0.12 秒一股小粒子束，朝随机方向喷射 30 颗
   */
  _spawnBossPreBurst(x, y, color) {
    const s = this.state;
    const burstAngle = Math.random() * Math.PI * 2;
    const spread = Math.PI / 6;   // 锥形喷射，宽度 30°
    for (let i = 0; i < 30; i++) {
      const angle = burstAngle + (Math.random() - 0.5) * spread;
      const speed = 5 + Math.random() * 4;
      s.particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: color,
        size: 0.10 + Math.random() * 0.08,
        age: 0,
        life: 1.2 + Math.random() * 0.5,
        alpha: 1,
      });
    }
    // 加一个小爆炸增加视觉
    this._spawnExplosion(
      x + Math.cos(burstAngle) * 0.3,
      y + Math.sin(burstAngle) * 0.3,
      color
    );
  },

  /**
   * 死亡动画阶段 2：0.6 秒触发的主大爆炸（18 组爆炸 + 80 颗放射粒子 + 30 颗白光）
   */
  _spawnBossMainExplosion(bx, by, bossColor) {
    const s = this.state;
    for (let i = 0; i < 18; i++) {
      const ox = bx + (Math.random() - 0.5) * 3;
      const oy = by + (Math.random() - 0.5) * 3;
      this._spawnExplosion(ox, oy, bossColor);
    }
    for (let i = 0; i < 80; i++) {
      const angle = (Math.PI * 2 * i) / 80 + Math.random() * 0.05;
      const speed = 3 + Math.random() * 4;
      s.particles.push({
        x: bx, y: by,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: bossColor,
        size: 0.12 + Math.random() * 0.10,
        age: 0,
        life: 2.4 + Math.random() * 1.2,    // 长粒子（2.4-3.6 秒），让 5 秒动画末段也有粒子
        alpha: 1,
      });
    }
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      s.particles.push({
        x: bx, y: by,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: '#ffffff',
        size: 0.08 + Math.random() * 0.05,
        age: 0,
        life: 0.7 + Math.random() * 0.4,
        alpha: 1,
      });
    }
    this._shakeScreen();
    this._shakeScreen();
    this._shakeScreen();
  },

  /**
   * 立方体·赌徒 BOSS 主更新
   * - 自身呼吸/自转
   * - 投骰子计时器：到点开始旋转动画
   * - 旋转/展示阶段推进，到时触发对应效果
   */
  _updateGambler(dt) {
    const s = this.state;

    // 推进延迟生成队列（独立于 BOSS 存活状态：BOSS 已死的话，仍把剩余预定的小怪投出来）
    if (s.gamblerPendingSpawns && s.gamblerPendingSpawns.length > 0) {
      const remaining = [];
      for (const item of s.gamblerPendingSpawns) {
        item.delay -= dt;
        if (item.delay <= 0) {
          // 到时间了：执行 spawn
          try { item.spawnFn(); } catch (e) { console.warn('gambler spawn error:', e); }
        } else {
          remaining.push(item);
        }
      }
      s.gamblerPendingSpawns = remaining;
    }

    const g = s.gambler;
    if (!g) return;

    // 本体动画（即便没投骰子也持续）
    g.angle = (g.angle || 0) + dt * 0.4;
    g.bodyPulse = (g.bodyPulse || 0) + dt;

    // 没有进行中的骰子动画：倒计时
    if (!g.dice) {
      g.diceTimer -= dt;
      if (g.diceTimer <= 0) {
        // 开骰！结果在动画开始就确定，便于动画末段精准定格
        const result = 1 + Math.floor(Math.random() * 6);
        g.dice = {
          phase: 'spinning',
          elapsed: 0,
          spinDuration: 1.3,    // 旋转 1.3 秒
          revealDuration: 1.5,  // 展示点数 1.5 秒
          result: result,
        };
        // 投骰开场震屏（轻微）
        this._shakeScreen();
      }
      return;
    }

    // 旋转 / 展示阶段
    const d = g.dice;
    d.elapsed += dt;
    if (d.phase === 'spinning' && d.elapsed >= d.spinDuration) {
      // 旋转结束 → 进入展示，并立即触发效果
      d.phase = 'reveal';
      d.elapsed = 0;
      this._applyDiceResult(d.result);
      g.lastResult = d.result;
    } else if (d.phase === 'reveal' && d.elapsed >= d.revealDuration) {
      // 展示结束 → 重置倒计时，等待下一次
      g.dice = null;
      g.diceTimer = g.diceInterval;
    }
  },

  /**
   * 触发骰子点数对应的效果
   * 1 = 自扣 1 血
   * 2 = 召唤 10 个小怪（三角/方形）
   * 3 = 给场上所有非 BOSS 敌人附加狂热
   * 4 = 召唤 3 个八芒星
   * 5 = 随机方向投掷 5 个七边形
   * 6 = 随机方向投掷 10 个狂热七边形
   */
  _applyDiceResult(result) {
    const s = this.state;
    const g = s.gambler;
    if (!g) return;

    switch (result) {
      case 1: {
        // 自扣 1 血
        g.hp = Math.max(0, g.hp - 1);
        this._addDamageNumber(g.x, g.y + 0.5, '-1 自爆!', '#ff5577');
        this._spawnExplosion(g.x, g.y, '#ff8899');
        this._shakeScreen();
        showToast(`🎲 1 点 · 赌徒自爆！HP ${g.hp} / ${g.maxHp}`, 1800);
        if (g.hp <= 0) {
          this._defeatGambler();
        }
        break;
      }
      case 2: {
        // 召唤 10 个小怪（三角/方形混合）
        this._gamblerSpawnFromTop(10, 'mixed');
        showToast(`🎲 2 点 · 召唤 10 个小怪！`, 1800);
        break;
      }
      case 3: {
        // 全场狂热：给所有可被狂热的怪 加 buffed
        const affected = this._gamblerFrenzyAll();
        showToast(`🎲 3 点 · ${affected} 只敌人陷入狂热！`, 1800);
        break;
      }
      case 4: {
        // 召唤 3 个八芒星
        this._gamblerSpawnFromTop(3, 'star8');
        showToast(`🎲 4 点 · 召唤 3 个八芒星！`, 1800);
        break;
      }
      case 5: {
        // 随机方向投掷 5 个七边形
        this._gamblerThrowHeps(5, false);
        showToast(`🎲 5 点 · 七边形雨！`, 1800);
        break;
      }
      case 6: {
        // 随机方向投掷 10 个狂热七边形
        this._gamblerThrowHeps(10, true);
        showToast(`🎲 6 点 · 狂热七边形海啸！`, 2200);
        break;
      }
    }
  },

  /**
   * 从赌徒头顶或屏幕上方分批生成 count 只敌人
   * type='mixed' → 三角/方形 各半；type='star8' → 全部八芒星
   *
   * 关键：分批延迟生成（每 0.15~0.25s 投一只），避免同帧同坐标堆叠
   * —— 否则偏微分等单次扫线激光可能一波清空。
   */
  _gamblerSpawnFromTop(count, type) {
    const s = this.state;
    const g = s.gambler;
    if (!g) return;
    const gx = g.x, gy = g.y;   // 抓快照：BOSS 死亡后仍可正确投放
    const wave = s.wave;
    for (let i = 0; i < count; i++) {
      // 投放间隔：0~count*0.2 秒分布；八芒星稍慢（更威胁，给反应时间）
      const stagger = type === 'star8' ? 0.30 : 0.18;
      const delay = i * stagger + Math.random() * 0.1;
      const fnSpawn = () => {
        const xOffset = (Math.random() - 0.5) * 10;  // ±5 单位散布
        const baseSpeed = 0.5 + (wave - 40) * 0.005;
        let enemy;
        if (type === 'star8') {
          enemy = Spawner.createEnemy({
            x: gx + xOffset, y: gy + 1.0,
            shape: 'star8', type: 'elite',
            color: '#bbbbcc', hp: 3, size: 0.7,
            vy: -baseSpeed * 0.5,
            score: 600, wave: wave,
          });
        } else {
          if (Math.random() < 0.7) {
            enemy = Spawner.createEnemy({
              x: gx + xOffset, y: gy + 1.0,
              shape: 'tri', type: 'normal',
              color: '#ff5577', hp: 1, size: 0.5,
              vy: -baseSpeed * (0.9 + Math.random() * 0.3),
              score: 100,
            });
          } else {
            enemy = Spawner.createEnemy({
              x: gx + xOffset, y: gy + 1.0,
              shape: 'square', type: 'normal',
              color: '#ffaa33', hp: 1, size: 0.5,
              vy: -baseSpeed * (0.9 + Math.random() * 0.3),
              score: 150,
            });
          }
        }
        // 给一点随机横向速度，让它们散开下落
        enemy.vx = (Math.random() - 0.5) * 1.5;
        enemy.throwTimer = 0.5;
        // 出生粒子提示（让玩家看到"这里出现了一只"）
        this._spawnExplosion(enemy.x, enemy.y, enemy.color);
        Game.state.enemies.push(enemy);
        Game._recordEnemy(enemy);
      };
      s.gamblerPendingSpawns.push({ delay: delay, spawnFn: fnSpawn });
    }
  },

  /**
   * 给场上所有可被狂热的敌人附加狂热 buff
   * 跳过：boss/icosa/sphere/gambler、其他正七芒星祝福、毁灭、已狂热、黑烟、星7/十芒星
   * 返回受影响数量
   */
  _gamblerFrenzyAll() {
    const s = this.state;
    let count = 0;
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      if (e.shape === 'icosa' || e.shape === 'sphere' || e.shape === 'gambler') continue;
      if (e.shape === 'star7' || e.shape === 'inv7' || e.shape === 'star10') continue;
      if (e.absorbing || e.buffed || e.blessedBy || e.doomedBy || e.smokeTimer > 0) continue;
      // 与逆七芒星狂热规则一致：HP 设为 1，速度 ×2，触底 ×2，红光
      if (e.hp > 1) e.hp = 1;
      e.vy *= 2;
      e.buffed = true;
      e.touchDamage = 2;
      this._spawnExplosion(e.x, e.y, '#ff3344');
      count++;
    }
    return count;
  },

  /**
   * 随机方向投掷 count 个七边形
   * 起始位置在赌徒头顶上方；初速度朝随机角度（横向占主导，避免直线下坠）
   * frenzy=true 时附加狂热 buff
   *
   * 关键：分批延迟生成（每 0.10~0.18s 投一只），避免同帧同坐标堆叠
   * 同时出生 x 偏移加大到 ±3，让 10 只七边形天然横向分散
   *
   * 角度/速度策略：
   *   - 横向占主导，永远保留充足反应时间
   *   - 非狂热(5 点)：|vx| 3~8 u/s，vy 1~3 u/s
   *   - 狂热(6 点)：|vx| 3.6~9.6 u/s，vy 1.2~3.6 u/s
   *   - 狂热触底伤害 = 2（与游戏内其它狂热怪一致）
   */
  _gamblerThrowHeps(count, frenzy) {
    const s = this.state;
    const g = s.gambler;
    if (!g) return;
    const gx = g.x, gy = g.y;   // 抓快照
    for (let i = 0; i < count; i++) {
      // 投放间隔 0.12~0.22 秒，逐个投出
      const stagger = 0.15;
      const delay = i * stagger + Math.random() * 0.08;
      const fnSpawn = () => {
        const hep = Spawner.createEnemy({
          x: gx + (Math.random() - 0.5) * 6,   // 出生 x 偏移 ±3（之前 ±0.75）
          y: gy + 1.0,
          shape: 'hep', type: 'elite',
          color: '#ff8844', hp: 1, size: 0.55,
          vy: -0.6,
          score: 400,
        });
        // 横向方向：左/右随机
        const dirX = Math.random() < 0.5 ? -1 : 1;
        // 横向速度（主导分量）：3~8 单位/秒
        const vxMag = 3 + Math.random() * 5;
        // 垂直下落速度：1~3 单位/秒（给玩家充足反应时间）
        const vyMag = 1 + Math.random() * 2;
        hep.vx = dirX * vxMag;
        hep.vy = -vyMag;
        hep.throwTimer = 0.5;
        if (frenzy) {
          hep.buffed = true;
          hep.touchDamage = 2;
          hep.vy *= 1.2;
          hep.vx *= 1.2;
        }
        // 出生粒子提示
        Game._spawnExplosion(hep.x, hep.y, hep.color);
        Game.state.enemies.push(hep);
        Game._recordEnemy(hep);
      };
      s.gamblerPendingSpawns.push({ delay: delay, spawnFn: fnSpawn });
    }
  },

  /**
   * 击败赌徒：奖励分数、清场、银色碎片爆炸、推进波次
   */
  _defeatGambler() {
    const s = this.state;
    if (!s.gambler) return;
    const g = s.gambler;
    const bx = g.x, by = g.y;
    const score = g.score;

    // 启动死亡动画
    s.gamblerDeathAnim = {
      x: bx, y: by,
      age: 0,
      duration: 4.0,
    };

    // 立刻生成银色碎片爆炸
    this._spawnGamblerSilverShards(bx, by);
    this._shakeScreen();
    this._shakeScreen();

    s.score += score;
    s.kills++;
    this._addDamageNumber(bx, by, `+${score} BOSS`, '#ffe066');
    showToast(`🏆 立方体·赌徒击败！+${score} 分`, 2600);

    // 清掉 gambler 引用
    s.gambler = null;
    // 清掉残留的延迟投放任务（避免击败后还飞来七边形/小怪）
    s.gamblerPendingSpawns = [];

    // 延迟 4 秒推进下一波（让碎片飞散）
    s.pendingNextWave = {
      delay: 4.0,
      callback: () => {
        this._resetViewWithTween();
        s.wave++;
        this._spawnInitialWave();
        this._updateHUD();
        showToast(`第 ${s.wave} 波`, 1200);
      },
    };
    this._checkLevelUp();
  },

  /**
   * 生成银色碎片爆炸特效（多层粒子）
   * - 一波大爆炸 + 60 颗放射状银色多边形碎片 + 30 颗高光白点
   */
  _spawnGamblerSilverShards(bx, by) {
    const s = this.state;
    // 中心闪光
    for (let i = 0; i < 6; i++) {
      this._spawnExplosion(bx + (Math.random() - 0.5) * 2.5,
                            by + (Math.random() - 0.5) * 2.5, '#e8edf3');
    }
    // 60 颗银色碎片（放射状）
    for (let i = 0; i < 60; i++) {
      const angle = (Math.PI * 2 * i) / 60 + Math.random() * 0.1;
      const speed = 4 + Math.random() * 5;
      s.particles.push({
        x: bx, y: by,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: i % 3 === 0 ? '#ffffff' : (i % 3 === 1 ? '#c8cfd6' : '#8a96a3'),
        size: 0.14 + Math.random() * 0.12,
        age: 0,
        life: 2.0 + Math.random() * 1.2,
        alpha: 1,
      });
    }
    // 30 颗白色高光（短促）
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      s.particles.push({
        x: bx, y: by,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: '#ffffff',
        size: 0.10 + Math.random() * 0.06,
        age: 0,
        life: 0.6 + Math.random() * 0.4,
        alpha: 1,
      });
    }
  },

  // ============================================================
  // ===== 正八面体·帝皇 BOSS 核心逻辑 =====
  // ============================================================

  /**
   * 帝皇主更新：三阶段计时器 + 阶段切换无敌期 + 几何登基倒计时
   */
  _updateEmperor(dt) {
    const s = this.state;

    // 推进延迟生成队列（独立于 BOSS 存活）
    if (s.emperorPendingSpawns && s.emperorPendingSpawns.length > 0) {
      const remaining = [];
      for (const item of s.emperorPendingSpawns) {
        item.delay -= dt;
        if (item.delay <= 0) {
          try { item.spawnFn(); } catch (err) { console.warn('emperor spawn error:', err); }
        } else {
          remaining.push(item);
        }
      }
      s.emperorPendingSpawns = remaining;
    }

    const e = s.emperor;
    if (!e) return;

    // 本体动画
    e.angle = (e.angle || 0) + dt * 0.3;
    e.bodyPulse = (e.bodyPulse || 0) + dt;

    // 阶段切换无敌期
    if (e.invulnTimer > 0) {
      e.invulnTimer -= dt;
      // 无敌期间停止攻击
      return;
    }

    // 阶段 1：四方向三角形（每 7 秒一波）
    if (e.phase === 1) {
      e.triFireTimer -= dt;
      if (e.triFireTimer <= 0) {
        this._emperorFireFourTriangles();
        e.triFireTimer = 7.0;
      }
    }

    // 阶段 2：三角形 (每 5 秒) + 红色弹幕 (每 1.2 秒,每波 3 颗扇形)
    if (e.phase === 2) {
      e.triFireTimer -= dt;
      if (e.triFireTimer <= 0) {
        this._emperorFireFourTriangles();
        e.triFireTimer = 5.0;
      }
      e.projectileTimer -= dt;
      if (e.projectileTimer <= 0) {
        this._emperorFireProjectile();
        e.projectileTimer = 1.2;
      }
    }

    // 阶段 3：几何登基 —— 三角形 (每 5 秒) + 弹幕 (每 1.5 秒,每波 4 颗扇形) + 45 秒倒计时
    if (e.phase === 3) {
      e.triFireTimer -= dt;
      if (e.triFireTimer <= 0) {
        this._emperorFireFourTriangles();
        e.triFireTimer = 5.0;
      }
      e.projectileTimer -= dt;
      if (e.projectileTimer <= 0) {
        this._emperorFireProjectile();
        e.projectileTimer = 1.5;
      }
      // 几何登基倒计时
      if (e.coronationActive) {
        e.coronationTimer -= dt;
        if (e.coronationTimer <= 0) {
          // 倒计时归零：触发秒杀光柱
          e.coronationTimer = 0;
          this._emperorTriggerCoronationStrike();
        }
      }
    }
  },

  /**
   * 阶段切换：1 → 2 或 2 → 3
   * 无敌 1.2 秒，震屏，toast 提示
   * 阶段 3 同时启动几何登基倒计时
   */
  _emperorEnterPhase(newPhase) {
    const s = this.state;
    const e = s.emperor;
    if (!e || e.phase >= newPhase) return;
    e.phase = newPhase;
    e.invulnTimer = 1.2;
    // 清空本阶段未发射任务（保留弹幕已在场的）
    e.triFireTimer = 7.0;
    e.projectileTimer = newPhase === 3 ? 3.0 : 1.0;
    this._shakeScreen();
    this._shakeScreen();
    this._spawnExplosion(e.x, e.y, '#ffd45d');
    this._spawnExplosion(e.x, e.y, '#fff8d0');
    if (newPhase === 2) {
      showToast('👑 帝皇 · 阶段 2：极光弹幕开始！', 2400);
    } else if (newPhase === 3) {
      e.coronationActive = true;
      e.coronationTimer = 45.0;
      showToast('👑 几何登基！45 秒内击败，否则秒杀！', 3000);
    }
  },

  /**
   * 阶段 1：朝四个方向发射小三角形
   * 方向：正下、左下 45°、右下 45°、正右下偏（你的需求是"四个垂直方向"，但向上无意义）
   * —— 改成正下/左下/右下/水平右 四个不同方向，给玩家差异化压力
   */
  _emperorFireFourTriangles() {
    const s = this.state;
    const e = s.emperor;
    if (!e) return;
    // 抛投策略:横向 vx 大、throwTimer 长,让三角形充分散开
    // 落点估算(throwTimer 2.0s + 全局衰减率):±1.5 ~ ±3.1 范围
    // 配合 ±1.5 起点偏移 → 实际落点范围 ±0 ~ ±4.5,远离 x=0 轴
    // 4 个方向:远左下 / 近左下 / 近右下 / 远右下,横向跨度大
    const dirs = [
      { vx: -8.0, vy: -1.2 },   // 远左下:抛得最远
      { vx: -4.0, vy: -2.0 },   // 近左下
      { vx:  4.0, vy: -2.0 },   // 近右下
      { vx:  8.0, vy: -1.2 },   // 远右下
    ];
    const ex = e.x, ey = e.y;
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      // 错开 0.12 秒生成,避免单条激光同帧扫穿
      const delay = i * 0.12;
      // 起点 ±1.5 随机偏移,让 4 只三角形不在同一 x 坐标出生
      const startXOffset = (Math.random() - 0.5) * 3.0;
      const fnSpawn = () => {
        const tri = Spawner.createEnemy({
          x: ex + startXOffset, y: ey - 0.5,
          shape: 'tri', type: 'normal',
          color: '#ffaa44', hp: 1, size: 0.5,
          vy: d.vy, score: 120,
        });
        // ±15% vx 抖动,让重复几波的落点不完全可预测
        const vxJitter = 1 + (Math.random() - 0.5) * 0.3;
        tri.vx = d.vx * vxJitter;
        // 投掷阶段拉长到 2.0 秒,让横向位移充分展开
        tri.throwTimer = 2.0;
        Game._spawnExplosion(tri.x, tri.y, '#ffd45d');
        Game.state.enemies.push(tri);
        Game._recordEnemy(tri);
      };
      s.emperorPendingSpawns.push({ delay: delay, spawnFn: fnSpawn });
    }
  },

  /**
   * 阶段 2/3：发射 1 颗红色极光弹幕
   * 随机方向，但强制 vy < 0(向下)
   */
  /**
   * 阶段 2/3：发射一波红色极光弹幕
   * 阶段 2: 单次 3 颗扇形(每 1.2s)
   * 阶段 3: 单次 4 颗扇形(每 1.5s)
   *
   * 速度定位:**飘浮型弹幕,比普通小怪(vy ≈ -0.5)略快但仍慢**
   * - vy 范围 -0.5 ~ -0.9 u/s,从 BOSS 位置 y=17 触底需 19-34 秒
   * - 横向 vx 0.1-0.4 u/s,轻微横移
   * - life 30 秒,部分快弹幕能在 life 内触底威胁玩家,其余飘飘过期消散
   * - 稳态约 67-71 颗弹幕同屏,形成饱满"弹幕雨"
   * 设计哲学:多数弹幕是装饰密度感,少数会真触底成为威胁源 — 玩家需要识别清理
   */
  _emperorFireProjectile() {
    const s = this.state;
    const e = s.emperor;
    if (!e) return;
    // 单次发射颗数:阶段 2 → 3,阶段 3 → 4(更密)
    const count = e.phase === 3 ? 4 : 3;
    const angleSpread = Math.PI * 0.67;  // 扇形 120°
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const baseAngle = -Math.PI / 2 + (t - 0.5) * angleSpread;
      const angle = baseAngle + (Math.random() - 0.5) * Math.PI / 12;   // ±15° 抖动
      // 总速度 0.5 - 0.9 u/s,飘浮型
      const speed = 0.5 + Math.random() * 0.4;
      let vx = Math.cos(angle) * speed;
      let vy = Math.sin(angle) * speed;
      // 保证向下
      if (vy > -0.2) vy = -0.2 - Math.random() * 0.15;
      // 速度上限:vy 不快于 -0.9 u/s(慢于普通敌人 2 倍)
      if (vy < -0.9) {
        const ratio = -0.9 / vy;
        vy *= ratio;
        vx *= ratio;
      }
      // 起点 ±0.3 抖动
      const startXOffset = (Math.random() - 0.5) * 0.6;
      s.emperorProjectiles.push({
        x: e.x + startXOffset, y: e.y - 0.8,
        vx: vx, vy: vy,
        age: 0,
        life: 30.0,   // 30 秒寿命:覆盖 vy=-0.6 触底时间(28.7s),vy 慢的飘飘过期
        size: 0.45,
        angle: Math.atan2(vy, vx),
      });
    }
    // 出生提示
    this._spawnExplosion(e.x, e.y - 0.8, '#ff5577');
  },

  /**
   * 推进所有帝皇弹幕：位置更新 + 触底扣血 + 寿命到期清理
   */
  _updateEmperorProjectiles(dt) {
    const s = this.state;
    if (!s.emperorProjectiles || s.emperorProjectiles.length === 0) return;
    const remaining = [];
    for (const p of s.emperorProjectiles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // 触底扣血
      if (p.y <= 0) {
        s.lives -= 1;
        s.combo = 1;
        this._addDamageNumber(p.x, 0, '-1 弹幕', '#ff5577');
        this._spawnExplosion(p.x, 0, '#ff5577');
        this._shakeScreen();
        this._updateHUD();
        if (s.lives <= 0) {
          this._gameOver();
        }
        continue;   // 不放回 remaining
      }
      // 飞出屏幕(超过 ±20)清理
      if (p.x < -20 || p.x > 20 || p.y > 25) continue;
      // 寿命到期
      if (p.age >= p.life) continue;
      remaining.push(p);
    }
    s.emperorProjectiles = remaining;
  },

  /**
   * 几何登基倒计时归零：触发巨大金色光柱秒杀
   */
  _emperorTriggerCoronationStrike() {
    const s = this.state;
    if (s.emperorCoronationStrike) return;   // 防重入
    s.emperorCoronationStrike = {
      age: 0,
      duration: 3.5,    // 总时长 3.5 秒(原 2 秒太短,看不到完整光柱)
      killed: false,
    };
    showToast('👑 几何登基完成！极光降临！', 1500);
    // 立即一次大震屏,给玩家"完了"的暴击感
    this._shakeScreen();
    this._shakeScreen();
    this._shakeScreen();
  },

  /**
   * 击败帝皇：奖励分数 + 死亡特效 + 推进下一波
   */
  _defeatEmperor() {
    const s = this.state;
    if (!s.emperor) return;
    const e = s.emperor;
    const bx = e.x, by = e.y;
    const score = e.score;

    // 启动死亡动画（4.5 秒，覆盖 7 波金色粒子流）
    s.emperorDeathAnim = {
      x: bx, y: by,
      age: 0,
      duration: 4.5,
    };

    // 立即喷发第一波金色粒子
    this._spawnEmperorGoldBurst(bx, by);
    this._shakeScreen();
    this._shakeScreen();
    this._shakeScreen();

    s.score += score;
    s.kills++;
    this._addDamageNumber(bx, by, `+${score} BOSS`, '#ffe066');
    showToast(`🏆 正八面体·帝皇陨落！+${score} 分`, 2800);

    // 清掉 emperor 引用
    s.emperor = null;
    // 清掉残留的延迟投放任务和弹幕
    s.emperorPendingSpawns = [];
    s.emperorProjectiles = [];

    // 延迟 5 秒推进下一波（让粒子流播完）
    s.pendingNextWave = {
      delay: 5.0,
      callback: () => {
        this._resetViewWithTween();
        s.wave++;
        this._spawnInitialWave();
        this._updateHUD();
        showToast(`第 ${s.wave} 波`, 1200);
      },
    };
    this._checkLevelUp();
  },

  /**
   * 帝皇死亡：金色粒子流喷射
   * 每波 40 颗放射状金色粒子 + 20 颗白色高光
   */
  _spawnEmperorGoldBurst(bx, by) {
    const s = this.state;
    // 中心闪光
    for (let i = 0; i < 4; i++) {
      this._spawnExplosion(bx + (Math.random() - 0.5) * 2,
                            by + (Math.random() - 0.5) * 2, '#ffd45d');
    }
    // 40 颗金色粒子流（放射状，速度快、寿命长）
    for (let i = 0; i < 40; i++) {
      const angle = (Math.PI * 2 * i) / 40 + Math.random() * 0.1;
      const speed = 5 + Math.random() * 5;
      s.particles.push({
        x: bx, y: by,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: i % 3 === 0 ? '#fff8d0' : (i % 3 === 1 ? '#ffd45d' : '#d4a020'),
        size: 0.16 + Math.random() * 0.14,
        age: 0,
        life: 2.0 + Math.random() * 1.5,
        alpha: 1,
      });
    }
    // 20 颗白色高光
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      s.particles.push({
        x: bx, y: by,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: '#ffffff',
        size: 0.10 + Math.random() * 0.06,
        age: 0,
        life: 0.7 + Math.random() * 0.4,
        alpha: 1,
      });
    }
  },

  /**
   * 视野平滑回归默认（zoom=1, pan=0,0）
   */
  _resetViewWithTween() {
    this._viewTween = {
      fromZoom: Coords.zoom,
      fromPanX: Coords.panX,
      fromPanY: Coords.panY,
      toZoom: 1,
      toPanX: 0,
      toPanY: 0,
      elapsed: 0,
      duration: 0.7,
    };
  },

  _addDamageNumber(x, y, text, color) {
    this.state.damageNumbers.push({
      x, y, text, color,
      age: 0, life: 1.0, alpha: 1,
    });
  },

  _comboBoostVisual() {
    const el = document.getElementById('hud-combo');
    el.classList.remove('boost');
    void el.offsetWidth; // reflow
    el.classList.add('boost');
  },

  _shakeScreen() {
    // 简单实现：给画布加抖动 class
    const c = this.canvas;
    c.style.transition = 'transform 0.05s';
    c.style.transform = 'translateX(-4px)';
    setTimeout(() => {
      c.style.transform = 'translateX(4px)';
      setTimeout(() => {
        c.style.transform = '';
      }, 50);
    }, 50);
  },

  _updateHUD() {
    const s = this.state;
    document.getElementById('hud-score').textContent = s.score;
    document.getElementById('hud-combo').textContent = '×' + s.combo;
    document.getElementById('hud-wave').textContent = s.wave === 0 ? '教程' : s.wave;
    // 护盾：超 5 颗折叠
    const lvEl = document.getElementById('hud-lives');
    if (s.lives <= 0) {
      lvEl.textContent = '○';
    } else if (s.lives <= 5) {
      lvEl.textContent = '❤'.repeat(s.lives);
    } else {
      lvEl.textContent = '❤×' + s.lives;
    }
    // 等级 + 经验条
    const lv = (s.upgrades && s.upgrades.level) || 1;
    document.getElementById('hud-level').textContent = lv;
    const curBase = Upgrade.thresholdToReach(lv);
    const nextBase = Upgrade.thresholdToReach(lv + 1);
    const progress = nextBase > curBase ? (s.score - curBase) / (nextBase - curBase) : 0;
    const pct = Math.max(0, Math.min(1, progress)) * 100;
    const fill = document.getElementById('hud-exp-fill');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
  },

  // ============================================================
  // 升级系统
  // ============================================================

  /** 分数变化后调用：检查是否到了升级阈值；如果是，弹出卡牌面板 */
  _checkLevelUp() {
    const s = this.state;
    const expectedLv = Upgrade.levelForScore(s.score);
    if (expectedLv > s.upgrades.level) {
      // 一次升一级（即使一次跳两级也只先弹一次卡，剩下的下次再触发）
      s.upgrades.level += 1;
      this._showUpgradeCards();
    }
  },

  /** 弹出升级卡牌面板（前置 0.5 秒延时，让玩家从战斗节奏中切换出来） */
  /** 弹出升级卡牌面板(延迟 0.5 秒,让玩家看到刚击杀的余韵动画再暂停弹窗) */
  _showUpgradeCards() {
    const s = this.state;
    s.upgrades.pendingChoice = true;
    s.upgrades.pendingCards = Upgrade.drawThree(s);
    // 延迟 0.5 秒后才暂停 + 显示弹窗 —— 玩家在这半秒看得到爆炸、分数飘字等余韵
    setTimeout(() => {
      if (!this.running) return;  // 0.5 秒里玩家死了 → 取消弹窗
      this.paused = true;
      Sound.play('laserok');
      document.getElementById('upgrade-title').textContent = `⭐ 等级提升  LV ${s.upgrades.level}`;
      this._renderUpgradeCards();
      document.getElementById('upgrade-overlay').classList.remove('hidden');
    }, 500);
  },

  /** 渲染当前 pendingCards 到面板。
   *  规则（新版）：
   *    - 升级初始：pendingCards = [卡A, 卡B, BLUE_REROLL]（颠倒黑白固定第三位）
   *    - 玩家选 BLUE_REROLL → 本次升级直接结束，rerollsLeft += 3 累积到下次升级
   *    - 玩家选普通卡 → 应用效果，升级结束
   *    - 玩家点「再刷一次」按钮（仅当 rerollsLeft > 0 显示）→ 三张卡全部重抽（无 BLUE_REROLL），rerollsLeft -= 1
   *    - 重抽后的三张卡里没有颠倒黑白，所以重抽不会"召唤"颠倒黑白回来
   */
  _renderUpgradeCards() {
    const s = this.state;
    const container = document.getElementById('upgrade-cards');
    container.innerHTML = '';
    const tierLabel = { blue: '常见 · 蓝', purple: '稀有 · 紫', gold: '传说 · 金' };
    // 效果图标用 emoji（最早 Windows 风格）
    const tierIcons = {
      BLUE_TAYLOR: '📐',
      BLUE_MACLAURIN: '〰️',
      BLUE_INTEGRAL: '🛡️',
      BLUE_SLOW: '🐢',
      BLUE_PUSHCART: '💨',
      BLUE_CONVERGENCE: '🌀',
      BLUE_REROLL: '🔄',
      PURPLE_PARTIAL: '∂',
      PURPLE_STACK: '∑',
      PURPLE_PARALYZE: '⚡',
      PURPLE_SUPER_EXPAND: '💥',
      GOLD_ETHER: '✨',
    };

    s.upgrades.pendingCards.forEach((cardId) => {
      const eff = Upgrade.EFFECTS[cardId];
      if (!eff) return;
      const card = document.createElement('div');
      card.className = `upgrade-card tier-${eff.tier}`;
      card.innerHTML = `
        <div class="upgrade-tier-badge">${tierLabel[eff.tier]}</div>
        <div class="upgrade-card-icon">${tierIcons[cardId] || ''}</div>
        <div class="upgrade-card-title">${eff.title}</div>
        <div class="upgrade-card-desc">${eff.desc}</div>
      `;
      card.addEventListener('click', () => this._chooseUpgradeCard(cardId));
      container.appendChild(card);
    });

    // 「再刷一次」小按钮 + 提示信息（放在三张卡下方，不再像卡牌）
    const info = document.getElementById('upgrade-rerolls-info');
    if (info) {
      info.innerHTML = '';
      const rl = s.upgrades.rerollsLeft || 0;
      if (rl > 0) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reroll-btn';
        btn.innerHTML = `<span class="reroll-icon">${tierIcons.BLUE_REROLL}</span><span>再刷一次（剩 ${rl} 次）</span>`;
        btn.addEventListener('click', () => this._handleRerollClick());
        info.appendChild(btn);
      } else {
        info.textContent = '没有刷新机会（选「颠倒黑白」可获得 3 次刷新）';
      }
    }
  },

  /** 玩家选了一张卡 */
  _chooseUpgradeCard(cardId) {
    const s = this.state;
    if (!s.upgrades.pendingChoice) return;
    const eff = Upgrade.EFFECTS[cardId];
    if (!eff) return;

    // 特殊：选了「颠倒黑白」 → 本次升级直接结束，rerollsLeft 累积 +3（下次升级才能用）
    if (cardId === 'BLUE_REROLL') {
      this._recordEffect('BLUE_REROLL');     // 图鉴记录（无弹窗）
      s.upgrades.rerollsLeft = (s.upgrades.rerollsLeft || 0) + 3;
      // 清理状态、关面板
      s.upgrades.pendingChoice = false;
      s.upgrades.pendingCards = [];
      document.getElementById('upgrade-overlay').classList.add('hidden');
      this.paused = false;
      this.lastTime = performance.now();
      requestAnimationFrame(this._loop);
      this._updateHUD();
      showToast(`🔄 颠倒黑白 · 获得 3 次刷新（共 ${s.upgrades.rerollsLeft} 次，下次升级生效）`, 2000);
      this._checkLevelUp();
      return;
    }

    // 普通卡：应用效果并结束本次升级
    this._recordEffect(cardId);     // 图鉴记录（无弹窗）
    eff.apply(s);
    if (cardId === 'BLUE_TAYLOR') this._applyTaylorToCurrentEnemies();
    // 金1 立即让所有锁定函数重新计算冷却（unlockNeeded 缩短为 1，可能立刻解锁多个）
    if (cardId === 'GOLD_ETHER') {
      this._refreshLibraryCooldowns();
      s.upgrades.etherPickedCount = (s.upgrades.etherPickedCount || 0) + 1;
      // 隐藏彩蛋：第 3 次选到以太编辑
      if (s.upgrades.etherPickedCount >= 3) {
        // 异步触发，让本次升级的常规流程先走完
        setTimeout(() => this._triggerEtherEasterEgg(), 200);
      }
    }

    // 清理状态
    s.upgrades.pendingChoice = false;
    s.upgrades.pendingCards = [];
    // rerollsLeft 不归零（长期累积资源）
    document.getElementById('upgrade-overlay').classList.add('hidden');
    this.paused = false;
    this.lastTime = performance.now();          // 修正 dt（避免暂停时长被算进下一帧）
    requestAnimationFrame(this._loop);          // 重启主循环（关键！）
    this._updateHUD();
    this._renderLibrary();  // 让金1的冷却数变化在 UI 上立即可见
    showToast(`✦ 已获得：${eff.title}`, 1800);
    // 选完一张后，可能因为本次跳了多级而还有下一级要弹（递归检查）
    this._checkLevelUp();
  },

  /** 隐藏彩蛋：选 3 次以太编辑 → 神级强化 + 弹窗 */
  _triggerEtherEasterEgg() {
    const s = this.state;
    if (s.upgrades.etherEasterTriggered) return;   // 防止重复触发
    s.upgrades.etherEasterTriggered = true;

    // 999 血、激光基础伤害 10
    s.lives = 999;
    s.baseDamage = 10;

    // 等级提升至 999
    s.upgrades.level = 999;

    // 立刻获得所有效果（cap 满）
    s.upgrades.taylorStacks = 3;
    s.upgrades.maclaurinStacks = 2;
    s.upgrades.integralStacks = 5;
    s.upgrades.slowStacks = 3;
    s.upgrades.pushcartCharges = 99;
    s.upgrades.partialUnlocked = true;
    s.upgrades.partialTimer = 1.0;     // 1 秒后立刻发射
    s.upgrades.stackUnlocked = true;
    s.upgrades.paralyzeUnlocked = true;
    s.upgrades.convergenceStacks = 3;
    s.upgrades.etherStacks = 2;
    s.upgrades.rerollsLeft += 99;       // 大量刷新机会

    // 全部函数无冷却（让 Library 内所有函数 cooldown=0）
    if (typeof Library !== 'undefined' && Library.entries) {
      for (const entry of Library.entries) {
        entry.cooldown = 0;
        entry.cooldownLeft = 0;
        if (entry.locked) entry.locked = false;
      }
    }

    // 暂停游戏循环（等关闭弹窗后恢复）
    this.paused = true;

    // 弹窗
    const overlay = document.createElement('div');
    overlay.id = 'ether-egg-overlay';
    overlay.innerHTML = `
      <div class="ether-egg-panel">
        <div class="ether-egg-avatar">
          <img src="assets/img/lang-hen.png" alt="锒狠" class="ether-egg-avatar-img">
          <div class="ether-egg-name">锒狠</div>
        </div>
        <div class="ether-egg-content">
          <div class="ether-egg-title">隐藏剧情解锁</div>
          <div class="ether-egg-text">行嘛，这个给你玩，接下来全看你的了。</div>
          <div class="ether-egg-bonus">
            ★ 等级跃升至 LV 999<br>
            ★ 护盾上限突破至 999 ❤<br>
            ★ 激光基础伤害提升至 10<br>
            ★ 全部函数无冷却<br>
            ★ 一次性获得所有效果
          </div>
          <button id="ether-egg-close" class="ether-egg-btn">收下，开始作威作福</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('ether-egg-close').addEventListener('click', () => {
      overlay.remove();
      this.paused = false;
      this.lastTime = performance.now();
      requestAnimationFrame(this._loop);
      this._updateHUD();
      this._renderLibrary();
      Sound.play('laserok');
    });
  },

  /** 玩家点了「再刷一次」按钮 */
  _handleRerollClick() {
    const s = this.state;
    if ((s.upgrades.rerollsLeft || 0) <= 0) return;
    s.upgrades.rerollsLeft -= 1;
    // 重抽 3 张普通卡（去重，无 BLUE_REROLL）
    s.upgrades.pendingCards = Upgrade.drawThreeNoReroll(s);
    this._renderUpgradeCards();
  },

  /** 蓝1 泰勒展开：对场上所有敌人立即放大 size */
  _applyTaylorToCurrentEnemies() {
    const s = this.state;
    // 因为 taylorStacks 已经在 apply 里 +1，新的 factor 已经是想要的总倍率；
    // 但场上敌人 size 是基于旧 factor 应用过的，要从旧倍率"切换"到新倍率
    const newF = Upgrade.taylorFactor(s);
    // 旧倍率：临时把 stacks 退一步算
    const curStacks = s.upgrades.taylorStacks;
    s.upgrades.taylorStacks = Math.max(0, curStacks - 1);
    const oldF = Upgrade.taylorFactor(s);
    s.upgrades.taylorStacks = curStacks;  // 恢复
    if (oldF === newF) return;
    const ratio = newF / oldF;
    for (const e of s.enemies) {
      if (e.type === 'boss') continue;
      e.size *= ratio;
    }
  },

  /** 蓝5 小推车清屏：清掉所有非 boss 系敌人，无分数 */
  _triggerPushcart() {
    const s = this.state;
    // 跳过 icosa（boss 战），跳过 boss 投掷物（penta 也清掉，跟 eraser 一致）
    const targets = s.enemies.filter(e => e.shape !== 'icosa');
    const protectedOnes = s.enemies.filter(e => e.shape === 'icosa');
    const cleared = targets.length;
    for (const e of targets) {
      this._spawnExplosion(e.x, e.y, e.color);
    }
    s.enemies = protectedOnes;
    showToast(`💨 小推车冲出！清除 ${cleared} 个敌人（剩 ${s.upgrades.pushcartCharges} 次充能）`, 1800);
  },

  /** 紫1 偏微分：每 10 秒自动发射 y=kx 激光，锁定 |y| 最近的敌人 */
  _updatePartialDerivative(dt) {
    const s = this.state;
    if (!s.upgrades || !s.upgrades.partialUnlocked) return;
    if (this.paused) return;
    s.upgrades.partialTimer = (s.upgrades.partialTimer || 10.0) - dt;
    if (s.upgrades.partialTimer > 0) return;

    // 候选目标：所有非雾隐、非黑烟、还活着的敌人（含 icosa）
    const candidates = s.enemies.filter(e =>
      e.hp > 0 &&
      !e.fogActive &&
      !(e.smokeTimer > 0)
    );
    // 球（黑洞）也纳入候选；五角十二面体 BOSS 本体免疫激光，不放进来（避免每次只打"免疫"）
    if (s.sphere && s.sphere.hp > 0) {
      candidates.push(s.sphere);
    }
    if (candidates.length === 0) {
      // 没有目标：不重置计时器，下一帧继续等
      s.upgrades.partialTimer = 0.5;  // 0.5 秒后再检查一次（避免每帧都遍历）
      return;
    }
    let target = candidates[0];
    for (const e of candidates) {
      if (Math.abs(e.y) < Math.abs(target.y)) target = e;
    }

    // 计算 k = y / x（避免除零）
    let expr;
    if (Math.abs(target.x) < 0.01) {
      // 目标在 y 轴附近：用 x=0 垂直线
      expr = 'x=0';
    } else {
      const k = target.y / target.x;
      // k 太大用垂直线
      if (Math.abs(k) > 50) {
        expr = `x=${target.x.toFixed(2)}`;
      } else {
        expr = `y=${k.toFixed(3)}*x`;
      }
    }
    // 伤害固定 1（紫1 不再可叠加）
    const dmg = 1;
    this._fire(expr, { skipLibrary: true, blue: true, damageOverride: dmg });
    showToast(`∂ 偏微分自动开火`, 1000);
    // 重置计时
    s.upgrades.partialTimer = 10.0;
  },

  /** 当前激光命中半径（基础 0.6 × 蓝2 倍率） */
  _hitRadius() {
    return 0.6 * Upgrade.maclaurinFactor(this.state);
  },

  /**
   * 渲染函数库（完整重绘）
   */
  _renderLibrary() {
    const list = document.getElementById('lib-list');
    if (!list) return;
    const items = Library.sortedItems();
    if (items.length === 0) {
      list.innerHTML = '<div class="lib-empty">输入函数发射后，会自动加入函数库</div>';
      return;
    }
    list.innerHTML = items.map(it => {
      const locked = Library.isLocked(it);
      const need = Library.UNLOCK_NEEDED;
      const done = Library.progressCount(it);  // 0..need
      const remain = Library.remainingUses(it); // need..0
      const pct = locked ? (done / need) * 100 : 0;
      // SVG 圆环：r=6, c=2π·6≈37.7
      const C = 37.7;
      const dash = locked ? (done / need) * C : 0;
      const ringHtml = locked ? `
        <span class="lib-ring" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="100%" height="100%">
            <circle cx="8" cy="8" r="6" class="lib-ring-track"></circle>
            <circle cx="8" cy="8" r="6" class="lib-ring-bar"
              stroke-dasharray="${dash.toFixed(2)} ${C.toFixed(2)}"
              transform="rotate(-90 8 8)"></circle>
          </svg>
          <span class="lib-ring-num">${remain}</span>
        </span>` : '';
      const titleAttr = locked
        ? `锁定中 · 还需 ${remain} 个不同函数 · 已用 ${it.fireCount} 次`
        : `可发射 · 已用 ${it.fireCount} 次`;
      // 几何表达式（含等号）不加 y= 前缀
      const isGeom = it.expr.includes('=');
      const prefixHtml = isGeom ? '' : `<span class="lib-prefix">y=</span>`;
      return `
        <div class="lib-item ${locked ? 'cooldown' : ''}" data-expr="${this._escapeAttr(it.expr)}"
             title="${titleAttr}">
          <div class="lib-cooldown-bar" style="width:${pct.toFixed(1)}%"></div>
          ${prefixHtml}<span class="lib-expr">${this._escapeHtml(it.expr)}</span>
          ${ringHtml}
          <span class="lib-remove" data-remove="${this._escapeAttr(it.expr)}" title="从库中移除">×</span>
        </div>
      `;
    }).join('');
    
    // 绑定点击：点击填充输入栏（不直接发射），点 × 移除
    list.querySelectorAll('.lib-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('lib-remove')) {
          const expr = e.target.dataset.remove;
          Library.remove(expr);
          this._renderLibrary();
          e.stopPropagation();
          return;
        }
        const expr = el.dataset.expr;
        // 填充到输入栏 + 触发预览
        const input = document.getElementById('func-input');
        input.value = expr;
        input.dispatchEvent(new Event('input'));
        input.focus();
        // 把光标放到末尾
        input.setSelectionRange(expr.length, expr.length);
        // 锁定中也允许填入，但提示还差几次
        if (el.classList.contains('cooldown')) {
          const item = Library.items.find(i => Library.normalize(i.expr) === Library.normalize(expr));
          if (item) {
            const need = Library.remainingUses(item);
            showToast(`已填入 · 此函数还需 ${need} 个不同函数才能发射`, 1600);
          }
        }
      });
    });
  },

  /**
   * 检查锁定状态是否与 DOM 不一致；不一致则整体重渲染
   * （次数冷却下进度只在发射时变化，不需要每帧刷数字）
   */
  _refreshLibraryCooldowns() {
    const list = document.getElementById('lib-list');
    if (!list) return;
    const elements = list.querySelectorAll('.lib-item');
    if (elements.length === 0) return;
    let needsRerender = false;
    for (const el of elements) {
      const expr = el.dataset.expr;
      const it = Library.items.find(i => Library.normalize(i.expr) === Library.normalize(expr));
      if (!it) { needsRerender = true; break; }
      const locked = Library.isLocked(it);
      const wasCd = el.classList.contains('cooldown');
      if (locked !== wasCd) { needsRerender = true; break; }
      // 同样锁定但进度数字变了
      if (locked) {
        const num = el.querySelector('.lib-ring-num');
        if (num && Number(num.textContent) !== Library.remainingUses(it)) {
          needsRerender = true; break;
        }
      }
    }
    if (needsRerender) this._renderLibrary();
  },

  _flashLibItemFire(expr) {
    const list = document.getElementById('lib-list');
    if (!list) return;
    const target = list.querySelector(`[data-expr="${CSS.escape ? CSS.escape(expr) : expr.replace(/"/g, '\\"')}"]`);
    if (target) {
      target.classList.add('fired');
      setTimeout(() => target.classList.remove('fired'), 400);
    }
  },

  _flashLibItemError(expr) {
    const list = document.getElementById('lib-list');
    if (!list) return;
    const target = list.querySelector(`[data-expr="${CSS.escape ? CSS.escape(expr) : expr.replace(/"/g, '\\"')}"]`);
    if (target) {
      target.style.transition = 'background 0.3s';
      target.style.background = 'rgba(255, 85, 119, 0.3)';
      setTimeout(() => { target.style.background = ''; }, 300);
    }
  },

  _escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  _escapeAttr(s) {
    return s.replace(/"/g, '&quot;');
  },

  _gameOver() {
    this.running = false;
    Sound.play('gameover');
    Sound.stopBgm();   // 停 BGM 让 gameover 音效突出
    const s = this.state;
    document.getElementById('gover-score').textContent = s.score;
    document.getElementById('gover-kills').textContent = s.kills;
    document.getElementById('gover-maxcombo').textContent = '×' + s.maxCombo;
    document.getElementById('gover-wave').textContent = s.wave;
    
    let best = 0;
    try {
      best = parseInt(localStorage.getItem('fh_best') || '0', 10) || 0;
    } catch (e) {}
    if (s.score > best) {
      try { localStorage.setItem('fh_best', s.score); } catch (e) {}
      document.getElementById('gover-best').textContent = `🏆 新纪录！原最高分 ${best}`;
    } else {
      document.getElementById('gover-best').textContent = `本次得分 ${s.score}（最高分 ${best}）`;
    }

    // 函数队列成就列表（本局 + 累计）
    const achEl = document.getElementById('gover-achievements');
    if (achEl && typeof FunctionEvent !== 'undefined') {
      const allHistory = FunctionEvent.loadAll();
      const thisRun = FunctionEvent.thisRunAchievements;
      const lines = [];
      lines.push('<div class="gover-achievements-title">🏆 函数队列成就</div>');
      let any = false;
      for (const type of FunctionEvent.TYPES) {
        const total = allHistory[type.id] || 0;
        const inRun = thisRun.has(type.id);
        if (total > 0 || inRun) {
          any = true;
          const cls = inRun ? 'gover-achievement-item this-run' : 'gover-achievement-item';
          lines.push(`<div class="${cls}"><span>${inRun ? '★ ' : ''}${type.name}（${type.example}）</span><span class="count">累计 ${total} 次</span></div>`);
        }
      }
      if (!any) {
        lines.push('<div class="gover-achievement-item" style="color:rgba(255,255,255,0.4)">暂未获得（用对应函数消灭队列即可解锁）</div>');
      }
      achEl.innerHTML = lines.join('');
    }

    document.getElementById('gameover-overlay').classList.remove('hidden');
  },

  // ============ 渲染 ============
  _render() {
    const ctx = this.ctx;
    const W = Coords.W;
    const H = Coords.H;
    
    // 清空
    ctx.clearRect(0, 0, W, H);
    
    // 背景星星
    this._drawStars();
    
    // 网格 + 坐标轴
    this._drawGrid();

    // 球 BOSS（底图层 — 在敌人之下）
    if (this.state.sphere) {
      this._drawSphere(this.state.sphere);
    }

    // 球死亡动画（独立绘制，不依赖 sphere 引用）
    if (this.state.sphereDeathAnim) {
      this._drawSphereDeath(this.state.sphereDeathAnim);
    }

    // 敌人
    for (const e of this.state.enemies) {
      this._drawEnemy(e);
    }

    // 八芒星雾隐覆盖（画在所有敌人之上，遮挡背后敌人；boss/pickup 之下，保留可识别性）
    this._drawFogOverlays();

    // BOSS
    if (this.state.boss) {
      this._drawBoss(this.state.boss);
    }

    // 立方体·赌徒 BOSS
    if (this.state.gambler) {
      this._drawGambler(this.state.gambler);
    }

    // 赌徒死亡动画（独立绘制）
    if (this.state.gamblerDeathAnim) {
      this._drawGamblerDeath(this.state.gamblerDeathAnim);
    }

    // 正八面体·帝皇 BOSS
    if (this.state.emperor) {
      this._drawEmperor(this.state.emperor);
    }

    // 帝皇弹幕(红色极光)
    if (this.state.emperorProjectiles && this.state.emperorProjectiles.length > 0) {
      for (const p of this.state.emperorProjectiles) {
        this._drawEmperorProjectile(p);
      }
    }

    // 帝皇死亡动画（独立绘制）
    if (this.state.emperorDeathAnim) {
      this._drawEmperorDeath(this.state.emperorDeathAnim);
    }

    // 掉落物
    for (const p of this.state.pickups) {
      this._drawPickup(p);
    }

    // 粒子
    for (const p of this.state.particles) {
      this._drawParticle(p);
    }
    
    // 实时预览（半透明）
    if (this.state.previewShape) {
      const view = this._getViewport();
      const previewPaths = this.state.previewShape.sample(view).paths;
      this._drawPaths(previewPaths, {
        color: 'rgba(93, 255, 214, 0.35)',
        width: 2,
        glow: 6,
        dashed: true,
      });
    }

    // 逆七芒星粒子束：从 inv7 飞向被狂热目标
    for (const beam of this.state.inv7Beams) {
      const t = beam.age / beam.duration;
      const alpha = 1 - t;
      const sp1 = Coords.toScreen(beam.fromX, beam.fromY);
      const sp2 = Coords.toScreen(beam.toX, beam.toY);
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 60, 80, ${alpha * 0.9})`;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.shadowColor = '#ff3344';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(sp1.x, sp1.y);
      ctx.lineTo(sp2.x, sp2.y);
      ctx.stroke();
      // 内核白线
      ctx.strokeStyle = `rgba(255, 220, 220, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(sp1.x, sp1.y);
      ctx.lineTo(sp2.x, sp2.y);
      ctx.stroke();
      ctx.restore();
    }

    // 正七芒星祝福粒子束：从 star7 飞向被祝福目标（绿色）
    for (const beam of this.state.star7Beams) {
      const t = beam.age / beam.duration;
      const alpha = 1 - t;
      const sp1 = Coords.toScreen(beam.fromX, beam.fromY);
      const sp2 = Coords.toScreen(beam.toX, beam.toY);
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = `rgba(80, 230, 140, ${alpha * 0.9})`;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.shadowColor = '#44dd88';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(sp1.x, sp1.y);
      ctx.lineTo(sp2.x, sp2.y);
      ctx.stroke();
      // 内核白线
      ctx.strokeStyle = `rgba(220, 255, 230, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(sp1.x, sp1.y);
      ctx.lineTo(sp2.x, sp2.y);
      ctx.stroke();
      ctx.restore();
    }

    // 十芒星毁灭粒子束：从 star10 飞向被毁灭目标（黑紫色）
    for (const beam of this.state.star10Beams) {
      const t = beam.age / beam.duration;
      const alpha = 1 - t;
      const sp1 = Coords.toScreen(beam.fromX, beam.fromY);
      const sp2 = Coords.toScreen(beam.toX, beam.toY);
      const ctx = this.ctx;
      ctx.save();
      // 外层深紫
      ctx.strokeStyle = `rgba(85, 34, 136, ${alpha * 0.95})`;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.shadowColor = '#9966ff';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.moveTo(sp1.x, sp1.y);
      ctx.lineTo(sp2.x, sp2.y);
      ctx.stroke();
      // 内核黑色（让它看起来像"反光"或"黑光"）
      ctx.strokeStyle = `rgba(20, 10, 30, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(sp1.x, sp1.y);
      ctx.lineTo(sp2.x, sp2.y);
      ctx.stroke();
      ctx.restore();
    }

    // 已发射激光（实体）—— 内白外红/紫三层叠绘
    for (const laser of this.state.lasers) {
      const t = laser.age / laser.duration;
      const alpha = 1 - t * t;
      const view = this._getViewport();
      const paths = laser.shape.sample(view).paths;
      // 紫色（lv.999）/ 蓝色（紫1偏微分）/ 默认红粉
      let outerC, midC;
      if (laser.blue) {
        outerC = `rgba(80, 150, 255, ${alpha * 0.95})`;
        midC   = `rgba(140, 200, 255, ${alpha})`;
      } else if (laser.purple) {
        outerC = `rgba(170, 80, 255, ${alpha * 0.95})`;
        midC   = `rgba(220, 130, 255, ${alpha})`;
      } else {
        outerC = `rgba(255, 60, 80, ${alpha * 0.95})`;
        midC   = `rgba(255, 120, 130, ${alpha})`;
      }
      // 蓝2 麦克劳林：激光视觉宽度按倍率放大
      const wf = Upgrade.maclaurinFactor(this.state);
      this._drawPaths(paths, { color: outerC, width: 9 * wf, glow: 24, dashed: false });
      this._drawPaths(paths, { color: midC,   width: 5 * wf, glow: 12, dashed: false });
      this._drawPaths(paths, {
        color: `rgba(255, 255, 255, ${alpha})`,
        width: 2 * wf, glow: 8, dashed: false,
      });
    }
    
    // 原点炮台
    this._drawCannon();
    
    // 飘字
    for (const d of this.state.damageNumbers) {
      this._drawDamageNumber(d);
    }
    
    // 视野指示器（始终显示，方便玩家定位敌人）
    this._drawPanIndicator();

    // 复合函数包激活提示
    if (this.state.damageBoostShots > 0) {
      this._drawBoostBadge();
    }

    // 升级系统状态徽章（紫1 倒计时 / 紫2 叠加层数 / 蓝5 充能 / 金1 等）
    this._drawUpgradeBadges();

    // 紫色全屏闪烁（球死亡 + 6 秒动画结束后触发）—— 短促强光收尾
    if (this.state.purpleFlash > 0) {
      const ctx = this.ctx;
      ctx.save();
      // 线性衰减：f=1 → alpha 0.85，2 秒内消退到 0
      const alpha = this.state.purpleFlash * 0.85;
      ctx.fillStyle = `rgba(170, 60, 220, ${alpha})`;
      ctx.fillRect(0, 0, Coords.W, Coords.H);
      ctx.restore();
    }

    // 几何登基秒杀光柱（全屏金色，覆盖在所有内容之上）
    if (this.state.emperorCoronationStrike) {
      this._drawEmperorCoronationStrike(this.state.emperorCoronationStrike);
    }
  },

  /**
   * 屏幕左上角徽章：剩余威力翻倍发射次数
   */
  _drawBoostBadge() {
    const ctx = this.ctx;
    const x = 14, y = 70;
    const w = 130, h = 30;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 140, 93, 0.18)';
    ctx.strokeStyle = '#ff8c5d';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#ff8c5d';
    ctx.shadowBlur = 10;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff8c5d';
    ctx.font = 'bold 12px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🎯 ×2 威力 · 剩 ${this.state.damageBoostShots}`, x + 8, y + h / 2);
    ctx.restore();
  },

  /**
   * 升级系统徽章组（左侧从上往下排列）
   * 仅显示有意义的状态
   */
  _drawUpgradeBadges() {
    const s = this.state;
    if (!s.upgrades) return;
    const ctx = this.ctx;
    const x = 14;
    let y = this.state.damageBoostShots > 0 ? 108 : 70;  // 错开 boost 徽章
    const w = 160, h = 26;
    const drawOne = (text, color, bg) => {
      ctx.save();
      ctx.fillStyle = bg;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      ctx.font = 'bold 11px Orbitron, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 8, y + h / 2);
      ctx.restore();
      y += h + 4;
    };
    // 紫1 偏微分倒计时
    if (s.upgrades.partialUnlocked) {
      const t = Math.max(0, s.upgrades.partialTimer || 0);
      drawOne(`∂ 偏微分 · ${t.toFixed(1)}s`,
              '#b88dff', 'rgba(184, 141, 255, 0.18)');
    }
    // 紫2 叠加层数
    if (s.upgrades.stackUnlocked && (s.upgrades.stackDamage || 0) > 0) {
      const cap = s.upgrades.stackDamage >= 5 ? ' MAX' : '';
      const t = Math.max(0, s.upgrades.stackTimer || 0);
      drawOne(`∑ 叠加 +${s.upgrades.stackDamage}${cap} · ${t.toFixed(1)}s`,
              '#b88dff', 'rgba(184, 141, 255, 0.18)');
    }
    // 蓝5 小推车充能
    if ((s.upgrades.pushcartCharges || 0) > 0) {
      drawOne(`💨 小推车 ×${s.upgrades.pushcartCharges}`,
              '#88aaff', 'rgba(68, 136, 255, 0.18)');
    }
    // 紫4 超级展开
    if (s.upgrades.superExpandUnlocked) {
      const startedAt = s.upgrades.superExpandActivatedAtWave || 0;
      const remaining = Math.max(0, 5 - (s.wave - startedAt));
      drawOne(`💥 超级展开 · 剩 ${remaining} 关`,
              '#b88dff', 'rgba(184, 141, 255, 0.18)');
    }
    // 金1 以太编辑
    if ((s.upgrades.etherStacks || 0) > 0) {
      const cap = s.upgrades.etherStacks >= 3 ? ' MAX' : '';
      drawOne(`✨ 以太编辑 ×${s.upgrades.etherStacks}${cap}`,
              '#ffe066', 'rgba(255, 224, 102, 0.20)');
    }
  },

  /**
   * 绘制视野指示器（迷你坐标 + 当前视野矩形 + 敌人红点）
   */
  _drawPanIndicator() {
    const ctx = this.ctx;
    const w = 110;
    const h = 78;
    const pad = 14;
    const x = Coords.W - w - pad;
    const y = 70;
    
    ctx.save();
    
    // 背景框
    ctx.fillStyle = 'rgba(15, 26, 44, 0.85)';
    ctx.strokeStyle = 'rgba(93, 255, 214, 0.5)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    
    // 标题
    ctx.fillStyle = 'rgba(93, 255, 214, 0.8)';
    ctx.font = 'bold 9px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('VIEW (R 重置)', x + 6, y + 12);
    
    // 全局边界（数学坐标 -MAX_PAN_X..+MAX_PAN_X、YR_BOTTOM-MAX_PAN_Y..YR+MAX_PAN_Y）
    const MX = Coords.MAX_PAN_X + Coords.XR;
    const MYbottom = Coords.YR_BOTTOM - Coords.MAX_PAN_Y;
    const MYtop = Coords.YR + Coords.MAX_PAN_Y;
    const totalW = MX * 2;
    const totalH = MYtop - MYbottom;
    
    const innerX = x + 6;
    const innerY = y + 18;
    const innerW = w - 12;
    const innerH = h - 24;
    
    // 工具：数学坐标 → 小地图屏幕坐标
    const mapX = (mathX) => innerX + (mathX - (-MX)) / totalW * innerW;
    const mapY = (mathY) => innerY + (MYtop - mathY) / totalH * innerH;
    
    // 默认视野矩形（淡绿）
    const dlx = mapX(-Coords.XR);
    const drx = mapX(Coords.XR);
    const dty = mapY(Coords.YR);
    const dby = mapY(Coords.YR_BOTTOM);
    ctx.fillStyle = 'rgba(93, 255, 214, 0.12)';
    ctx.fillRect(dlx, dty, drx - dlx, dby - dty);
    
    // 当前视野矩形（黄色）
    const [cxMin, cxMax] = Coords.visibleXRange();
    const [cyMin, cyMax] = Coords.visibleYRange();
    const clx = innerX + Math.max(0, (cxMin - (-MX)) / totalW * innerW);
    const crx = innerX + Math.min(innerW, (cxMax - (-MX)) / totalW * innerW);
    const cty = innerY + Math.max(0, (MYtop - cyMax) / totalH * innerH);
    const cby = innerY + Math.min(innerH, (MYtop - cyMin) / totalH * innerH);
    ctx.fillStyle = 'rgba(255, 224, 102, 0.25)';
    ctx.fillRect(clx, cty, Math.max(2, crx - clx), Math.max(2, cby - cty));
    ctx.strokeStyle = 'rgba(255, 224, 102, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(clx, cty, Math.max(2, crx - clx), Math.max(2, cby - cty));
    
    // 敌人红点
    for (const e of this.state.enemies) {
      const ex = mapX(e.x);
      const ey = mapY(e.y);
      // 跳过超出小地图边界的
      if (ex < innerX - 2 || ex > innerX + innerW + 2 || ey < innerY - 2 || ey > innerY + innerH + 2) continue;
      const isBig = e.type === 'boss' || e.type === 'elite';
      ctx.fillStyle = e.type === 'boss' ? '#ff5577' : (e.type === 'elite' ? '#b88dff' : '#ffaa33');
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(ex, ey, isBig ? 2.5 : 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    
    // 原点（炮台）绿点
    const ox = mapX(0);
    const oy = mapY(0);
    ctx.fillStyle = '#5dffd6';
    ctx.shadowColor = '#5dffd6';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(ox, oy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  },

  _drawStars() {
    const ctx = this.ctx;
    if (!this._stars) {
      this._stars = [];
      for (let i = 0; i < 60; i++) {
        this._stars.push({
          x: Math.random() * Coords.W,
          y: Math.random() * Coords.H,
          r: Math.random() * 1.2,
          alpha: 0.3 + Math.random() * 0.5,
        });
      }
    }
    ctx.save();
    for (const s of this._stars) {
      ctx.fillStyle = `rgba(180, 220, 255, ${s.alpha})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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
    
    // 细网格（每 1 单位）
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
    
    // 主网格（每 5 单位）
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.15)';
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
    ctx.strokeStyle = 'rgba(93, 255, 214, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // X 轴
    const xAxisP = Coords.toScreen(0, 0);
    ctx.moveTo(0, xAxisP.y);
    ctx.lineTo(Coords.W, xAxisP.y);
    // Y 轴
    ctx.moveTo(xAxisP.x, 0);
    ctx.lineTo(xAxisP.x, Coords.H);
    ctx.stroke();
    
    // 刻度数字
    ctx.fillStyle = 'rgba(165, 180, 204, 0.6)';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    for (let x = Math.floor(xLo / 5) * 5; x <= xHi; x += 5) {
      if (x === 0) continue;
      const p = Coords.toScreen(x, 0);
      // 让标签贴在 x 轴下方（屏幕下方）
      const labelY = Math.min(p.y + 14, Coords.H - 4);
      ctx.fillText(x.toString(), p.x, labelY);
    }
    ctx.textAlign = 'left';
    for (let y = Math.floor(yLo / 5) * 5; y <= yHi; y += 5) {
      if (y === 0) continue;
      const p = Coords.toScreen(0, y);
      // 标签贴在 y 轴右侧
      const labelX = Math.max(xAxisP.x + 4, 4);
      ctx.fillText(y.toString(), labelX, p.y + 4);
    }
    
    ctx.restore();
  },

  _getViewport() {
    return {
      xRange: Coords.visibleXRange(),
      yRange: Coords.visibleYRange(),
      samples: 600,
    };
  },

  /**
   * 通用 polyline 绘制：接受 paths（多段折线），数学坐标
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

  _drawCurve(fn, opts) {
    const ctx = this.ctx;
    const [xMin, xMax] = Coords.visibleXRange();
    const points = Coords.sampleCurve(fn, xMin, xMax, 600);
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
    
    let pathOpen = false;
    ctx.beginPath();
    for (const pt of points) {
      if (!pt.valid) {
        if (pathOpen) {
          ctx.stroke();
          ctx.beginPath();
          pathOpen = false;
        }
        continue;
      }
      // 跳过远超视野的点
      if (pt.y < yMin - 20 || pt.y > yMax + 20) {
        if (pathOpen) {
          ctx.stroke();
          ctx.beginPath();
          pathOpen = false;
        }
        continue;
      }
      const sp = Coords.toScreen(pt.x, pt.y);
      if (!pathOpen) {
        ctx.moveTo(sp.x, sp.y);
        pathOpen = true;
      } else {
        ctx.lineTo(sp.x, sp.y);
      }
    }
    if (pathOpen) ctx.stroke();
    ctx.restore();
  },

  _drawEnemy(e) {
    // 雾隐中的 star8：自身不画，由 _drawFogOverlays 在所有敌人之后画一个大雾团遮挡
    if (e.fogActive) return;
    // 黑烟中的怪：画黑色烟团特效，不画本体
    if (e.smokeTimer > 0) {
      this._drawSmoke(e);
      return;
    }
    const ctx = this.ctx;
    const sp = Coords.toScreen(e.x, e.y);
    // 麻痹大意：颤抖位移（每帧给 sp 加随机小偏移，所有后续渲染都跟着抖）
    if (e.paralyzeRemain && e.paralyzeRemain > 0) {
      // 颤抖幅度跟剩余时间正相关（刚命中颤得更厉害，快结束时颤得弱）
      const intensity = Math.min(1, e.paralyzeRemain / 5.0);
      const jitter = 2.5 * intensity;   // 像素级抖动幅度
      sp.x += (Math.random() - 0.5) * jitter * 2;
      sp.y += (Math.random() - 0.5) * jitter * 2;
    }
    const r = e.size * Coords.scale;

    // 雾中行 buff：在本体周围画微弱烟雾光晕（先画底层，后画本体覆盖在上）
    if (e.mistyTouched) {
      ctx.save();
      const t = performance.now() * 0.001;
      const haze = ctx.createRadialGradient(sp.x, sp.y, r * 0.6, sp.x, sp.y, r * 2.0);
      haze.addColorStop(0, 'rgba(180, 180, 195, 0.25)');
      haze.addColorStop(0.6, 'rgba(180, 180, 195, 0.10)');
      haze.addColorStop(1, 'rgba(180, 180, 195, 0)');
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 2.0, 0, Math.PI * 2);
      ctx.fill();
      // 3 个漂浮小烟团
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2 + t * 0.8;
        const dist = r * 1.0;
        const cx = sp.x + Math.cos(ang) * dist;
        const cy = sp.y + Math.sin(ang) * dist;
        const rr = r * 0.5;
        const sub = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        sub.addColorStop(0, 'rgba(220, 220, 235, 0.18)');
        sub.addColorStop(1, 'rgba(220, 220, 235, 0)');
        ctx.fillStyle = sub;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    
    // 进度条（如果 hp < maxHp）
    if (e.hp < e.maxHp) {
      const barW = r * 2;
      const ratio = e.hp / e.maxHp;
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(sp.x - barW / 2, sp.y - r - 8, barW, 3);
      ctx.fillStyle = '#ffaa33';
      ctx.fillRect(sp.x - barW / 2, sp.y - r - 8, barW * ratio, 3);
      ctx.restore();
    }
    
    ctx.save();
    // frozen（急速制冷-狼）：淡蓝色覆盖 + 冷色光
    if (e.frozen) {
      ctx.shadowColor = '#88ddff';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#88ccff';
      ctx.strokeStyle = '#cce8ff';
    } else if (e.doomedBy) {
      // doomedBy（被十芒星毁灭）：黑光笼罩
      const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.008);
      ctx.shadowColor = '#552288';
      ctx.shadowBlur = 18 * pulse;
      ctx.fillStyle = '#222233';
      ctx.strokeStyle = '#553388';
    } else if (e.buffed) {
      // buffed（被逆七芒星狂热）：红光强化 + 颜色覆盖
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.012);
      ctx.shadowColor = '#ff2244';
      ctx.shadowBlur = 18 * pulse;
      ctx.fillStyle = '#ff3344';
      ctx.strokeStyle = '#ff8899';
    } else if (e.blessedBy) {
      // blessed（被正七芒星祝福）：绿光保护 + 颜色覆盖
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.010);
      ctx.shadowColor = '#44dd88';
      ctx.shadowBlur = 18 * pulse;
      ctx.fillStyle = '#44dd88';
      ctx.strokeStyle = '#aaffcc';
    } else {
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = e.color;
      ctx.strokeStyle = this._darken(e.color, 0.3);
    }
    ctx.lineWidth = 2;
    
    if (e.shape === 'tri') {
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y - r);
      ctx.lineTo(sp.x + r * 0.9, sp.y + r * 0.6);
      ctx.lineTo(sp.x - r * 0.9, sp.y + r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (e.shape === 'square') {
      ctx.fillRect(sp.x - r * 0.85, sp.y - r * 0.85, r * 1.7, r * 1.7);
      ctx.strokeRect(sp.x - r * 0.85, sp.y - r * 0.85, r * 1.7, r * 1.7);
    } else if (e.shape === 'hex') {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i - Math.PI / 6;
        const x = sp.x + Math.cos(a) * r;
        const y = sp.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (e.shape === 'star') {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 5 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.5;
        const x = sp.x + Math.cos(a) * radius;
        const y = sp.y + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (e.shape === 'penta') {
      // 正五边形（boss 投掷的小怪）
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * 2 / 5 * i - Math.PI / 2;
        const x = sp.x + Math.cos(a) * r;
        const y = sp.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (e.shape === 'star4') {
      // 四芒星：8 个顶点交替（4 长 4 短），长尖向四方延伸
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 4 * i - Math.PI / 2;
        // 长尖在偶数索引（上、右、下、左），凹点在奇数索引
        const radius = i % 2 === 0 ? r : r * 0.38;
        const x = sp.x + Math.cos(a) * radius;
        const y = sp.y + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (e.shape === 'hexagram') {
      // 六芒星：两个反向叠加的等边三角形（大卫之星）
      ctx.beginPath();
      // 第一个三角形（顶点向上）
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * 2 / 3 * i - Math.PI / 2;
        const x = sp.x + Math.cos(a) * r;
        const y = sp.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 第二个三角形（顶点向下）
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * 2 / 3 * i + Math.PI / 2;
        const x = sp.x + Math.cos(a) * r;
        const y = sp.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 周围护盾（半透明青色圆 + 脉冲）
      const SHIELD_R = 5.0;
      const t = (performance.now() % 2000) / 2000;
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      ctx.save();
      ctx.strokeStyle = `rgba(136, 204, 255, ${0.35 + 0.25 * pulse})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#88ccff';
      ctx.shadowBlur = 16 * pulse;
      ctx.fillStyle = `rgba(136, 204, 255, 0.06)`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, SHIELD_R * Coords.scale * (0.95 + 0.05 * pulse), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (e.shape === 'hep') {
      // 七边形：7 个等距顶点的正七边形 + 内部不稳定脉冲（暗示自爆性）
      const ang = e.angle || 0;
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = ang + Math.PI * 2 / 7 * i - Math.PI / 2;
        const x = sp.x + Math.cos(a) * r;
        const y = sp.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 中心红色脉冲点（暗示自爆能量积聚）
      const t = (performance.now() % 700) / 700;
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      ctx.fillStyle = '#ff3322';
      ctx.shadowColor = '#ff5522';
      ctx.shadowBlur = 12 * pulse;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * (0.18 + 0.06 * pulse), 0, Math.PI * 2);
      ctx.fill();
    } else if (e.shape === 'oct') {
      // 八边形：8 个等距顶点 + 闪烁金光 + 内部小八角
      const ang = e.angle || 0;
      // 闪烁强度（脉冲）
      const tt = (performance.now() % 1200) / 1200;
      const goldPulse = 0.6 + 0.4 * Math.sin(tt * Math.PI * 2);
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 18 * goldPulse;
      // 外八角形
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = ang + Math.PI * 2 / 8 * i - Math.PI / 2;
        const x = sp.x + Math.cos(a) * r;
        const y = sp.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 内部小八角（旋转方向相反）
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff8c0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = -ang + Math.PI * 2 / 8 * i - Math.PI / 2 + Math.PI / 8;
        const x = sp.x + Math.cos(a) * r * 0.45;
        const y = sp.y + Math.sin(a) * r * 0.45;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (e.shape === 'octminion') {
      // 八边形扈从：小型 8 角形 + 闪烁金光
      const ang = e.angle || 0;
      const tt = (performance.now() % 600) / 600;
      const goldPulse = 0.5 + 0.5 * Math.sin(tt * Math.PI * 2);
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 14 * goldPulse;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = ang + Math.PI * 2 / 8 * i - Math.PI / 2;
        const x = sp.x + Math.cos(a) * r;
        const y = sp.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (e.shape === 'inv7') {
      // 逆七芒星：7 角星，但顶点朝下（上下颠倒）+ 旋转
      const ang = e.angle || 0;
      ctx.beginPath();
      // 14 顶点（7 长 + 7 短交替），整体翻转使尖角朝下：起点用 +π/2（朝下）而不是 -π/2
      for (let i = 0; i < 14; i++) {
        const a = ang + Math.PI / 7 * i + Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.45;
        const x = sp.x + Math.cos(a) * radius;
        const y = sp.y + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 中心一颗血红点，强化"邪"的感觉
      ctx.fillStyle = '#ff0033';
      ctx.shadowColor = '#ff0033';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.shape === 'star7') {
      // 正七芒星：14 顶点（7 长 + 7 短交替），尖角朝上（与 inv7 相反），绿色
      const ang = e.angle || 0;
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = ang + Math.PI / 7 * i - Math.PI / 2;   // -π/2 = 朝上
        const radius = i % 2 === 0 ? r : r * 0.45;
        const x = sp.x + Math.cos(a) * radius;
        const y = sp.y + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 中心一颗白光点（与 inv7 中心血红相反，强化"圣"的感觉）
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#aaffcc';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 0.20, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.shape === 'star9') {
      // 九芒星：18 顶点（9 长 9 短），橙色，中心一颗封印环
      const ang = e.angle || 0;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const a = ang + Math.PI / 9 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.50;
        const x = sp.x + Math.cos(a) * radius;
        const y = sp.y + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 中心封印圆环（双层，象征禁闭）
      ctx.shadowColor = '#ffaa44';
      ctx.shadowBlur = 16;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffd99c';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 0.18, 0, Math.PI * 2);
      ctx.stroke();
      // 头顶显示被禁的 2 个类别（中文小字）
      if (e.lockedCategories && e.lockedCategories.length > 0) {
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#000000';
        ctx.fillStyle = '#ffd99c';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labels = {
          trig: '三角', const: 'y=k', vline: 'x=k', power: '幂', exp: '指数',
        };
        const txt = e.lockedCategories.map(c => labels[c] || c).join(' · ');
        ctx.fillText('⛔ ' + txt, sp.x, sp.y - r - 14);
      }
    } else if (e.shape === 'star10') {
      // 十芒星：20 顶点 + 纯黑主体 + 极轻微紫光边缘 + 中心黑点
      const ang = e.angle || 0;
      // 重置 fill 为纯黑（覆盖入口处的 e.color）
      ctx.shadowBlur = 0;     // 主体不要阴影晕染
      ctx.fillStyle = '#0a0a14';   // 近黑色（比 #222233 还深）
      ctx.beginPath();
      for (let i = 0; i < 20; i++) {
        const a = ang + Math.PI / 10 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.42;
        const x = sp.x + Math.cos(a) * radius;
        const y = sp.y + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      // 仅外轮廓极轻微紫光描边（只勾勒形状，不晕染主体）
      const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.006);
      ctx.shadowColor = '#9966ff';
      ctx.shadowBlur = 4 * pulse;     // 之前 8，再减半
      ctx.lineWidth = 1.5;             // 之前 2，再细
      ctx.strokeStyle = '#7744cc';     // 不太亮的深紫
      ctx.stroke();
      // 中心黑点（不再加紫边，避免视觉污染）
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      // 头顶 HP 显示
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#000000';
      ctx.fillStyle = '#cc99ff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`HP ${e.hp}/${e.maxHp}`, sp.x, sp.y - r - 14);
    } else if (e.shape === 'star8') {
      // 八芒星：16 顶点（8 长 + 8 短交替）+ 自转
      const ang = e.angle || 0;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = ang + Math.PI / 8 * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.45;
        const x = sp.x + Math.cos(a) * radius;
        const y = sp.y + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (e.shape === 'icosa') {
      // 三角二十面体二维投影：六边形外框 + 内部三角网格
      const ang = e.angle || 0;
      // 即将生长：最后 3 秒画红色脉冲发光
      if (e.growTime > 0 && e.growTimer >= e.growTime - 3) {
        const remain = e.growTime - e.growTimer;  // 剩余秒数 ∈ [0, 3]
        const intensity = 1 - remain / 3;          // 0 → 1
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);  // 0..1 闪烁
        ctx.save();
        ctx.shadowColor = '#ff2244';
        ctx.shadowBlur = 30 * intensity * pulse;
        ctx.fillStyle = `rgba(255, 40, 80, ${0.35 * intensity * pulse})`;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r * (1.4 + 0.15 * pulse), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // 外六边形
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = ang + Math.PI / 3 * i - Math.PI / 6;
        const x = sp.x + Math.cos(a) * r;
        const y = sp.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 内部三角网格（6 条从中心到顶点的线 + 内三角形）
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1.2;
      // 中心到 6 个顶点
      for (let i = 0; i < 6; i++) {
        const a = ang + Math.PI / 3 * i - Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sp.x + Math.cos(a) * r, sp.y + Math.sin(a) * r);
        ctx.stroke();
      }
      // 内层倒三角（强化"三角面"视觉）
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = ang + Math.PI * 2 / 3 * i + Math.PI / 6;
        const x = sp.x + Math.cos(a) * r * 0.55;
        const y = sp.y + Math.sin(a) * r * 0.55;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    
    // 中心高光点
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y - r * 0.2, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();

    // 紫3 麻痹大意：被命中的怪间歇性快速闪出浅黄色光（每秒 2 次短闪）
    if (e.paralyzeRemain && e.paralyzeRemain > 0) {
      const ctx2 = this.ctx;
      // 每 0.5 秒一个周期，前 0.12 秒亮（闪），后面暗
      const phase = (performance.now() * 0.001) % 0.5;
      const isFlashing = phase < 0.12;
      if (isFlashing) {
        const flashIntensity = 1 - (phase / 0.12);  // 从亮到暗的线性衰减
        ctx2.save();
        // 浅黄叠加色（在怪本体上盖一层）
        ctx2.globalCompositeOperation = 'lighter';
        ctx2.shadowColor = '#fff8a0';
        ctx2.shadowBlur = 16 * flashIntensity;
        ctx2.fillStyle = `rgba(255, 248, 160, ${0.55 * flashIntensity})`;
        ctx2.beginPath();
        ctx2.arc(sp.x, sp.y, r * 1.05, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.restore();
      }
    }

    // 三角二十面体血条：剩余 / 最大 HP
    if (e.shape === 'icosa') {
      // outerR：用六边形顶点距离 ≈ r（已是 size * scale）
      const labels = { 1: '三角二十面体', 2: '亚-二十面体', 3: '次-二十面体', 4: '终-二十面体' };
      const label = labels[e.tier] || 'BOSS';
      this._drawHpBar(sp.x, sp.y, r, e.color, e.hp, e.maxHp, label);
    }
  },

  /**
   * 绘制 BOSS：五角十二面体（dodecahedron）二维投影
   *   - 外层正五边形（旋转）
   *   - 内层五角星（反向旋转）
   *   - 外环：进度（已击杀/目标）
   *   - 强烈光晕和呼吸缩放
   */
  _drawBoss(b) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(b.x, b.y);
    const baseR = b.size * Coords.scale;
    // 呼吸脉动
    const pulse = 1 + 0.05 * Math.sin(b.angle * 4);
    const r = baseR * pulse;

    ctx.save();
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 26;

    // —— 外层五边形（顺时针自转） ——
    const outerR = r * 1.15;
    const ang1 = b.angle;
    ctx.fillStyle = 'rgba(255, 93, 214, 0.18)';
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = ang1 + Math.PI * 2 / 5 * i - Math.PI / 2;
      const x = sp.x + Math.cos(a) * outerR;
      const y = sp.y + Math.sin(a) * outerR;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // —— 中层五角星（反向自转，更亮） ——
    const ang2 = -b.angle * 0.8;
    ctx.fillStyle = b.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = ang2 + Math.PI / 5 * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r * 0.8 : r * 0.4;
      const x = sp.x + Math.cos(a) * radius;
      const y = sp.y + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // —— 中心高光 ——
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // —— 上方血量条：剩余血量（从满到空） ——
    const s = this.state;
    const remaining = Math.max(0, s.pentaKillGoal - s.pentaKillCount);
    this._drawHpBar(sp.x, sp.y, outerR, b.color, remaining, s.pentaKillGoal, '五角十二面体');
  },

  /**
   * 绘制立方体·赌徒 BOSS（真 3D 立方体投影版本）
   *
   * 实现:
   *   - 8 个顶点的 3D 坐标 (±1, ±1, ±1)
   *   - 绕 X 轴和 Y 轴旋转,正交投影(忽略 z 维度的距离感)
   *   - 6 个面各对应 1 个骰子点数,且 face1+face6 = face2+face5 = face3+face4 = 7
   *   - 按 z 排序 + 法向量背面剔除 → 只绘制朝向相机的面
   *   - 平时缓速绕 Y 轴自转;投骰子时 X+Y 双轴高速旋转 + 振荡
   *   - reveal 阶段旋转减速到目标姿态,正面显示结果点数
   */
  _drawGambler(g) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(g.x, g.y);
    const baseR = g.size * Coords.scale;
    const pulse = 1 + 0.03 * Math.sin(g.bodyPulse * 2.2);
    const r = baseR * pulse;

    // —— 当前旋转角度 (rotX, rotY) ——
    let rotX, rotY;
    if (g.dice && g.dice.phase === 'spinning') {
      // 投骰中:双轴高速旋转 + 大幅振荡
      const t = g.dice.elapsed;
      rotX = t * 7 + Math.sin(t * 9) * 0.4;
      rotY = t * 10 + Math.cos(t * 11) * 0.4;
    } else if (g.dice && g.dice.phase === 'reveal') {
      // reveal:目标角度 = (0, 0,) 即正面朝相机;在 0.4 秒内缓动过渡
      const t = g.dice.elapsed;
      const ease = Math.min(1, t / 0.4);
      const fromX = g.dice._lastRotX || 0;
      const fromY = g.dice._lastRotY || 0;
      // 目标:让某个固定面正对相机。我们让正面 = result 的角度。
      // 各面正对相机时的 (rotX, rotY)(0 = 正面向 +z):
      //   face 1: (0, 0)             [front]
      //   face 2: (0, +π/2)          [right]
      //   face 3: (-π/2, 0)          [top]
      //   face 4: (+π/2, 0)          [bottom]
      //   face 5: (0, -π/2)          [left]
      //   face 6: (0, π)             [back]
      const targets = {
        1: [0, 0],
        2: [0, -Math.PI / 2],
        3: [-Math.PI / 2, 0],
        4: [Math.PI / 2, 0],
        5: [0, Math.PI / 2],
        6: [0, Math.PI],
      };
      const [toX, toY] = targets[g.dice.result] || [0, 0];
      rotX = fromX + (toX - fromX) * ease;
      rotY = fromY + (toY - fromY) * ease;
    } else {
      // 平时:缓速绕 Y 轴 + 微小绕 X 轴
      rotX = Math.sin(g.bodyPulse * 0.5) * 0.25;
      rotY = (g.angle || 0) * 0.8;
    }

    // 记录本帧 rotX/rotY,供 reveal 起始使用
    if (g.dice && g.dice.phase === 'spinning') {
      g.dice._lastRotX = rotX;
      g.dice._lastRotY = rotY;
    }

    // —— 3D 顶点(立方体本体 ±1)+ 旋转变换 ——
    // 顶点顺序约定:
    //   0: (-1,-1,-1)  1: (+1,-1,-1)  2: (+1,+1,-1)  3: (-1,+1,-1)   [后面 z=-1]
    //   4: (-1,-1,+1)  5: (+1,-1,+1)  6: (+1,+1,+1)  7: (-1,+1,+1)   [前面 z=+1]
    const verts = [
      [-1,-1,-1],[+1,-1,-1],[+1,+1,-1],[-1,+1,-1],
      [-1,-1,+1],[+1,-1,+1],[+1,+1,+1],[-1,+1,+1],
    ];
    // 旋转 + 投影
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const transformed = verts.map(v => {
      let [x, y, z] = v;
      // 绕 Y 轴(左右翻)
      let x1 = x * cosY + z * sinY;
      let z1 = -x * sinY + z * cosY;
      // 绕 X 轴(上下翻)
      let y2 = y * cosX - z1 * sinX;
      let z2 = y * sinX + z1 * cosX;
      return [x1, y2, z2];
    });

    // —— 6 个面(顶点索引 + 点数 + 法向量本体方向)——
    // 注意:每个面的顶点顺时针(从相机看)排列,法向量指向外
    // 对面之和 = 7:1↔6, 2↔5, 3↔4
    // 面顺序:前(z+) / 后(z-) / 右(x+) / 左(x-) / 上(y-,屏幕 y 是反的) / 下(y+)
    const faces = [
      { verts: [4, 5, 6, 7], pip: 1, normal: [0, 0, +1] },   // 前 = 1
      { verts: [1, 0, 3, 2], pip: 6, normal: [0, 0, -1] },   // 后 = 6
      { verts: [5, 1, 2, 6], pip: 2, normal: [+1, 0, 0] },   // 右 = 2
      { verts: [0, 4, 7, 3], pip: 5, normal: [-1, 0, 0] },   // 左 = 5
      { verts: [4, 5, 1, 0], pip: 3, normal: [0, -1, 0] },   // 上(屏幕 y 朝下,y=-1 是上面) = 3
      { verts: [7, 6, 2, 3], pip: 4, normal: [0, +1, 0] },   // 下 = 4
    ];

    // 每个面计算:旋转后法向量 z 分量 → 决定是否朝向相机
    //              旋转后中心 z 分量 → 用于按深度排序
    const visibleFaces = [];
    for (const f of faces) {
      // 旋转法向量
      let [nx, ny, nz] = f.normal;
      // 绕 Y
      let nx1 = nx * cosY + nz * sinY;
      let nz1 = -nx * sinY + nz * cosY;
      // 绕 X
      let ny2 = ny * cosX - nz1 * sinX;
      let nz2 = ny * sinX + nz1 * cosX;
      // 相机看向 -z 方向(屏幕坐标系约定:近的 z 大)
      // 法向量 z 分量 > 0 → 朝向相机,可见
      if (nz2 <= 0) continue;
      // 面中心 z(用于深度排序,虽然背面剔除后基本不需要,但保险起见)
      let centerZ = 0;
      for (const vi of f.verts) centerZ += transformed[vi][2];
      centerZ /= 4;
      visibleFaces.push({ ...f, centerZ, nz: nz2 });
    }
    // 从远到近排序(z 小的先画)
    visibleFaces.sort((a, b) => a.centerZ - b.centerZ);

    // —— 绘制 ——
    ctx.save();
    ctx.translate(sp.x, sp.y);

    // 整体光晕(spinning 时变金)
    if (g.dice && g.dice.phase === 'spinning') {
      ctx.shadowColor = '#ffe066';
      ctx.shadowBlur = 32;
    } else {
      ctx.shadowColor = '#dde3eb';
      ctx.shadowBlur = 22;
    }

    // 颜色函数:基于法向量朝相机程度决定亮度(模拟光照)
    function shadeFor(nz) {
      // nz=1 全亮,nz=0 全暗
      const k = Math.max(0.4, Math.min(1.0, 0.5 + nz * 0.6));
      const base = Math.round(0xa8 * k);
      const bright = Math.round(0xee * k);
      const dim = Math.round(0x70 * k);
      const toHex = v => ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
      return {
        light: '#' + toHex(bright) + toHex(bright) + toHex(bright + 10),
        mid:   '#' + toHex(base) + toHex(base + 10) + toHex(base + 20),
        dark:  '#' + toHex(dim) + toHex(dim + 5) + toHex(dim + 10),
      };
    }

    for (const f of visibleFaces) {
      const pts = f.verts.map(vi => {
        const [x, y, z] = transformed[vi];
        return { x: x * r, y: y * r };
      });

      // 渐变填充(从面中心到边)
      const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
      const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
      const shade = shadeFor(f.nz);
      const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[2].x, pts[2].y);
      grad.addColorStop(0,    shade.light);
      grad.addColorStop(0.45, shade.mid);
      grad.addColorStop(1,    shade.dark);
      ctx.fillStyle = grad;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.lineTo(pts[3].x, pts[3].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // —— 在面上绘制点数 ——
      // 点数沿面的局部坐标系排布(用面的两个边向量作为基)
      // 用变换矩阵:把面平面上的 (u,v) 映射到屏幕(已平移过)
      const e1x = (pts[1].x - pts[0].x) / 2;   // 边 1 半向量
      const e1y = (pts[1].y - pts[0].y) / 2;
      const e2x = (pts[3].x - pts[0].x) / 2;   // 边 2 半向量
      const e2y = (pts[3].y - pts[0].y) / 2;
      // 面中心 = pts[0] + e1 + e2
      // 局部 (u,v) ∈ [-1, 1] 映射到屏幕 = center + u*e1 + v*e2
      const dotR = r * 0.10 * (0.6 + f.nz * 0.4);   // 朝向越正点越大
      const off = 0.5;   // 点位置偏移(立方体面 ±1 的 50%)
      ctx.fillStyle = '#2a2f38';
      ctx.shadowBlur = 0;
      const drawPip = (u, v) => {
        const px = cx + u * e1x + v * e2x;
        const py = cy + u * e1y + v * e2y;
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fill();
      };
      switch (f.pip) {
        case 1:
          drawPip(0, 0); break;
        case 2:
          drawPip(-off, -off); drawPip(off, off); break;
        case 3:
          drawPip(-off, -off); drawPip(0, 0); drawPip(off, off); break;
        case 4:
          drawPip(-off, -off); drawPip(off, -off);
          drawPip(-off,  off); drawPip(off,  off); break;
        case 5:
          drawPip(-off, -off); drawPip(off, -off);
          drawPip(0, 0);
          drawPip(-off,  off); drawPip(off,  off); break;
        case 6:
          drawPip(-off, -off); drawPip(off, -off);
          drawPip(-off, 0);    drawPip(off, 0);
          drawPip(-off,  off); drawPip(off,  off); break;
      }
      // 恢复光晕给下个面用
      if (g.dice && g.dice.phase === 'spinning') {
        ctx.shadowColor = '#ffe066';
        ctx.shadowBlur = 32;
      } else {
        ctx.shadowColor = '#dde3eb';
        ctx.shadowBlur = 22;
      }
    }

    ctx.restore();

    // —— 头顶血量条 ——
    this._drawHpBar(sp.x, sp.y, r * 1.5, '#c8cfd6', g.hp, g.maxHp, '立方体·赌徒');

    // —— 倒计时 / 投骰子状态文字 ——
    const ctx2 = this.ctx;
    ctx2.save();
    ctx2.textAlign = 'center';
    ctx2.font = 'bold 10px Orbitron, sans-serif';
    ctx2.fillStyle = '#aab2bd';
    const labelY = sp.y - r * 1.5 - 36;
    if (g.dice) {
      if (g.dice.phase === 'spinning') {
        ctx2.fillStyle = '#ffe066';
        ctx2.fillText('🎲 投骰中…', sp.x, labelY);
      } else {
        ctx2.fillStyle = '#ffe066';
        ctx2.font = 'bold 14px Orbitron, sans-serif';
        ctx2.fillText(`🎲 = ${g.dice.result}`, sp.x, labelY);
      }
    } else {
      const remain = Math.max(0, g.diceTimer);
      ctx2.fillText(`下次投骰 ${remain.toFixed(1)}s`, sp.x, labelY);
    }
    ctx2.restore();
  },

  /**
   * 绘制骰子动画
   * 通过缩放 + 错切（skew）+ 旋转模拟 3D 立方体翻滚效果
   * 兼容性：纯 Canvas 2D 变换，所有现代浏览器（含 IE10+）均支持
   *
   * phase='spinning'：快速旋转 + 错切变换（模拟立方体翻转），面上的点数飞快切换
   * phase='reveal'：稳定显示，点数大写显示，呼吸光晕
   */
  _drawDice(cx, cy, size, dice) {
    const ctx = this.ctx;
    const t = dice.elapsed / (dice.phase === 'spinning' ? dice.spinDuration : dice.revealDuration);

    ctx.save();
    ctx.translate(cx, cy);

    if (dice.phase === 'spinning') {
      // —— 旋转阶段：3D 翻滚模拟 ——
      // 用 transform(a, b, c, d, ...) 做错切：scaleY 周期变化 + skewX 周期变化
      // 视觉上像立方体的不同侧面快速切换
      // 旋转角度：随时间加速然后减速（缓动）
      const easeOut = 1 - Math.pow(1 - t, 2);   // 减速曲线（旋转越来越慢）
      const totalRotation = Math.PI * 6 * easeOut;   // 总共转 3 圈
      ctx.rotate(totalRotation);

      // 缩放呼吸：开始 1.0，最大 1.3，再回到 1.0
      const breathe = 1 + 0.3 * Math.sin(t * Math.PI);
      // Y 方向额外的"翻滚"压缩（模拟立方体侧面翻转）
      const tumble = Math.sin(t * Math.PI * 8) * 0.4;   // 8 次大幅度翻滚
      const scaleX = breathe * (1 - Math.abs(tumble) * 0.5);
      const scaleY = breathe * (1 - tumble * tumble * 0.6);
      ctx.scale(scaleX, scaleY);

      // —— 主体正方形：金属渐变 ——
      const grad = ctx.createLinearGradient(-size, -size, size, size);
      grad.addColorStop(0,   '#ffffff');
      grad.addColorStop(0.25,'#e8edf3');
      grad.addColorStop(0.55,'#a8b1bc');
      grad.addColorStop(1,   '#5a6271');
      ctx.fillStyle = grad;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 25;
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.strokeRect(-size, -size, size * 2, size * 2);

      // —— 飞速切换的点数（旋转期间快速闪过 1-6）——
      // 每 0.08 秒切一个数；越接近 reveal 切换越慢
      const flashRate = 0.06 + t * 0.10;   // 0.06 → 0.16 秒
      const flashIdx = Math.floor(dice.elapsed / flashRate);
      const flashFace = (flashIdx % 6) + 1;
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2a2f38';
      // 反向应用 scale 让点数不会被压扁
      ctx.scale(1 / scaleX, 1 / scaleY);
      ctx.rotate(-totalRotation);
      this._drawDiceFaceDots(0, 0, size, flashFace);
    } else {
      // —— 展示阶段：稳定显示，呼吸光晕 ——
      const breathe = 1 + 0.05 * Math.sin(dice.elapsed * 6);
      ctx.scale(breathe, breathe);

      // 强光晕 + 主体
      const grad = ctx.createLinearGradient(-size, -size, size, size);
      grad.addColorStop(0,   '#ffffff');
      grad.addColorStop(0.3, '#f0f4f8');
      grad.addColorStop(0.7, '#c8cfd6');
      grad.addColorStop(1,   '#8a96a3');
      ctx.fillStyle = grad;
      ctx.strokeStyle = '#ffd45d';   // 金色描边突出"摇出来的点数"
      ctx.lineWidth = 4;
      ctx.shadowColor = '#ffe066';
      ctx.shadowBlur = 30;
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.strokeRect(-size, -size, size * 2, size * 2);

      // 点数（最终结果）
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2a2f38';
      this._drawDiceFaceDots(0, 0, size, dice.result);
    }

    ctx.restore();
  },

  /**
   * 在 (cx, cy) 处绘制骰子点数（标准骰子六面图案）
   * size 是骰子半边长（点数会画在 size×2 的区域内）
   */
  _drawDiceFaceDots(cx, cy, size, face) {
    const ctx = this.ctx;
    const dotR = size * 0.15;
    // 三档位置：左上 / 中 / 右下 等
    const off = size * 0.45;
    const draw = (dx, dy) => {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, dotR, 0, Math.PI * 2);
      ctx.fill();
    };
    switch (face) {
      case 1:
        draw(0, 0);
        break;
      case 2:
        draw(-off, -off); draw(off, off);
        break;
      case 3:
        draw(-off, -off); draw(0, 0); draw(off, off);
        break;
      case 4:
        draw(-off, -off); draw(off, -off);
        draw(-off,  off); draw(off,  off);
        break;
      case 5:
        draw(-off, -off); draw(off, -off);
        draw(0, 0);
        draw(-off,  off); draw(off,  off);
        break;
      case 6:
        draw(-off, -off); draw(off, -off);
        draw(-off, 0);    draw(off, 0);
        draw(-off,  off); draw(off,  off);
        break;
    }
  },

  /**
   * 绘制赌徒死亡动画（碎片粒子已经在 _spawnGamblerSilverShards 投放，
   * 此函数主要绘制一个收缩消散的"残影"和大爆发光环）
   */
  _drawGamblerDeath(anim) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(anim.x, anim.y);
    const t = Math.min(1, anim.age / anim.duration);
    // 收缩消散：尺寸从 1.0 → 0；alpha 从 1 → 0
    const sizeMul = 1 - t;
    const alpha = 1 - t;
    const baseR = 2.0 * Coords.scale;   // size 2.0
    const r = baseR * sizeMul;

    // 大爆发光环（前 0.3 秒）
    if (anim.age < 0.5) {
      const ringT = anim.age / 0.5;
      const ringR = baseR * (1 + ringT * 4);
      const ringAlpha = (1 - ringT) * 0.6;
      ctx.save();
      ctx.globalAlpha = ringAlpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6 * (1 - ringT);
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 残影（收缩中的银色方块）
    if (sizeMul > 0.05) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.7;
      ctx.translate(sp.x, sp.y);
      // 收缩的同时还在快速自转
      ctx.rotate(anim.age * 8);
      const grad = ctx.createLinearGradient(-r, -r, r, r);
      grad.addColorStop(0,   '#ffffff');
      grad.addColorStop(0.5, '#c8cfd6');
      grad.addColorStop(1,   '#6e7785');
      ctx.fillStyle = grad;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 20 * sizeMul;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
  },

  // ============================================================
  // ===== 帝皇 BOSS 绘制 =====
  // ============================================================

  /**
   * 绘制正八面体·帝皇 BOSS
   *   - 上下两个对顶三角形组成菱形(正八面体二维投影)
   *   - 金色外光晕 + 阶段感视觉差异
   *   - 阶段 3 几何登基期间根据倒计时强化金光
   *   - 头顶 HP 血条 + 阶段/倒计时显示
   */
  _drawEmperor(e) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(e.x, e.y);
    const baseR = e.size * Coords.scale;
    // 呼吸脉动 ±5%
    const pulse = 1 + 0.05 * Math.sin(e.bodyPulse * 2.0);
    const r = baseR * pulse;
    const angle = e.angle || 0;

    // 阶段 3 + 几何登基：金光强度随倒计时线性提升
    let glowBoost = 1.0;
    if (e.coronationActive) {
      // 45s 时 1.0,0s 时 4.0(更强烈)
      glowBoost = 1.0 + 3.0 * (1 - Math.max(0, e.coronationTimer) / 45);
    }
    // 阶段切换无敌期：闪烁（每 0.15 秒切换可见性）
    const flickerVisible = !(e.invulnTimer > 0 && Math.floor(e.invulnTimer * 7) % 2 === 0);

    ctx.save();

    // —— 外层金色光晕 ——
    if (flickerVisible) {
      const haloGrad = ctx.createRadialGradient(sp.x, sp.y, r * 0.6, sp.x, sp.y, r * 2.0 * glowBoost);
      haloGrad.addColorStop(0, `rgba(255, 212, 93, ${0.5 * glowBoost})`);
      haloGrad.addColorStop(0.5, `rgba(255, 212, 93, ${0.2 * glowBoost})`);
      haloGrad.addColorStop(1, 'rgba(255, 212, 93, 0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 2.0 * glowBoost, 0, Math.PI * 2);
      ctx.fill();
    }

    if (flickerVisible) {
      // —— 主体：正八面体二维投影(菱形 = 上下两个相对三角形) ——
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(angle * 0.5);

      const topY = -r * 1.2;
      const botY = r * 1.2;
      const lftX = -r * 0.95;
      const rgtX = r * 0.95;

      // 上三角(浅金) + 下三角(深金) —— 营造立体感
      const grad = ctx.createLinearGradient(0, topY, 0, botY);
      grad.addColorStop(0,   '#fff8d0');
      grad.addColorStop(0.3, '#ffd45d');
      grad.addColorStop(0.5, '#d4a020');
      grad.addColorStop(0.7, '#a07810');
      grad.addColorStop(1,   '#6b4f0e');

      ctx.fillStyle = grad;
      ctx.strokeStyle = '#fff8d0';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffd45d';
      ctx.shadowBlur = 20 * glowBoost;

      ctx.beginPath();
      ctx.moveTo(0, topY);
      ctx.lineTo(rgtX, 0);
      ctx.lineTo(0, botY);
      ctx.lineTo(lftX, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 中线：上下三角分界线（高光）
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lftX, 0);
      ctx.lineTo(rgtX, 0);
      ctx.stroke();

      // 顶点高光
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, topY + r * 0.2, r * 0.10, 0, Math.PI * 2);
      ctx.fill();

      // 几何登基期：内部"皇冠"图案(三个金色光点)
      if (e.coronationActive) {
        ctx.fillStyle = '#fff8d0';
        ctx.shadowColor = '#ffe066';
        ctx.shadowBlur = 12 * glowBoost;
        ctx.beginPath();
        ctx.arc(0, -r * 0.2, r * 0.10, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-r * 0.22, r * 0.08, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc( r * 0.22, r * 0.08, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    ctx.restore();

    // —— 头顶 HP 血条 ——
    this._drawHpBar(sp.x, sp.y, r * 1.2, '#ffd45d', e.hp, e.maxHp, '正八面体·帝皇');

    // —— 阶段标记 / 倒计时 ——
    const ctx2 = this.ctx;
    ctx2.save();
    ctx2.textAlign = 'center';
    ctx2.font = 'bold 11px Orbitron, sans-serif';
    const labelY = sp.y - r * 1.2 - 36;
    if (e.coronationActive) {
      // 几何登基倒计时：金色高亮，剩 10s 时变红
      const remain = Math.max(0, e.coronationTimer);
      const isUrgent = remain <= 10;
      ctx2.fillStyle = isUrgent ? '#ff5577' : '#ffd45d';
      ctx2.shadowColor = isUrgent ? '#ff5577' : '#ffd45d';
      ctx2.shadowBlur = 8;
      ctx2.font = 'bold 14px Orbitron, sans-serif';
      ctx2.fillText(`⏳ 几何登基：${remain.toFixed(1)}s`, sp.x, labelY);
    } else {
      ctx2.fillStyle = '#ffe066';
      ctx2.fillText(`阶段 ${e.phase} / 3`, sp.x, labelY);
    }
    ctx2.restore();
  },

  /**
   * 绘制单个帝皇极光弹幕
   * 中心白色 → 外层红色渐变，带拖尾光环
   */
  _drawEmperorProjectile(p) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(p.x, p.y);
    const r = p.size * Coords.scale;

    ctx.save();

    // 外层光晕(大半径，半透明红)
    const haloGrad = ctx.createRadialGradient(sp.x, sp.y, r * 0.5, sp.x, sp.y, r * 3);
    haloGrad.addColorStop(0, 'rgba(255, 80, 100, 0.5)');
    haloGrad.addColorStop(0.5, 'rgba(255, 80, 100, 0.2)');
    haloGrad.addColorStop(1, 'rgba(255, 80, 100, 0)');
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * 3, 0, Math.PI * 2);
    ctx.fill();

    // 拖尾(沿运动反方向延伸)
    const trailLen = r * 2.5;
    const ang = p.angle || Math.atan2(p.vy, p.vx);
    const tailX = sp.x - Math.cos(ang) * trailLen;
    const tailY = sp.y + Math.sin(ang) * trailLen;   // 注意：屏幕 y 取反
    const trailGrad = ctx.createLinearGradient(sp.x, sp.y, tailX, tailY);
    trailGrad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
    trailGrad.addColorStop(0.5, 'rgba(255, 80, 100, 0.4)');
    trailGrad.addColorStop(1, 'rgba(255, 80, 100, 0)');
    ctx.strokeStyle = trailGrad;
    ctx.lineWidth = r * 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    // 核心(白色实心)
    const coreGrad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.4, '#fff0d0');
    coreGrad.addColorStop(0.8, '#ff5577');
    coreGrad.addColorStop(1, '#cc1144');
    ctx.fillStyle = coreGrad;
    ctx.shadowColor = '#ff5577';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  },

  /**
   * 绘制帝皇死亡动画（已通过 _spawnEmperorGoldBurst 投放金色粒子流）
   * 这里再绘制一个收缩消散的金色八面体残影 + 中心冲击波环
   */
  _drawEmperorDeath(anim) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(anim.x, anim.y);
    const t = Math.min(1, anim.age / anim.duration);
    const sizeMul = 1 - t;
    const alpha = 1 - t * 0.8;
    const baseR = 1.6 * Coords.scale;

    // 多重冲击波环（前 1 秒触发 3 次）
    for (let ringIdx = 0; ringIdx < 3; ringIdx++) {
      const ringStart = ringIdx * 0.3;
      if (anim.age >= ringStart && anim.age < ringStart + 0.8) {
        const ringT = (anim.age - ringStart) / 0.8;
        const ringR = baseR * (1 + ringT * 6);
        const ringAlpha = (1 - ringT) * 0.5;
        ctx.save();
        ctx.globalAlpha = ringAlpha;
        ctx.strokeStyle = '#ffd45d';
        ctx.lineWidth = 6 * (1 - ringT);
        ctx.shadowColor = '#ffd45d';
        ctx.shadowBlur = 40;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 残影收缩
    if (sizeMul > 0.05) {
      const r = baseR * sizeMul;
      ctx.save();
      ctx.globalAlpha = alpha * 0.7;
      ctx.translate(sp.x, sp.y);
      ctx.rotate(anim.age * 6);   // 自转
      const grad = ctx.createLinearGradient(0, -r, 0, r);
      grad.addColorStop(0,   '#fff8d0');
      grad.addColorStop(0.5, '#ffd45d');
      grad.addColorStop(1,   '#6b4f0e');
      ctx.fillStyle = grad;
      ctx.shadowColor = '#ffd45d';
      ctx.shadowBlur = 30 * sizeMul;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.2);
      ctx.lineTo(r * 0.95, 0);
      ctx.lineTo(0, r * 1.2);
      ctx.lineTo(-r * 0.95, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  },

  /**
   * 几何登基秒杀光柱：全屏金色光柱从天而降
   * 三阶段：0-0.3s 预警闪烁，0.3-1.0s 光柱降下，1.0-2.0s 余晖消散
   */
  /**
   * 几何登基秒杀光柱:巨大华丽极光降临(3.5 秒动画)
   *   0.0-0.5s: 预警 — 全屏震颤金色脉冲,BOSS 自身金光暴涨
   *   0.5-1.5s: 主光柱降下 — 从天而降的巨大白金极光柱,逐渐变粗,光环辐射
   *   1.5-2.5s: 极光主体 — 中央巨柱稳态,周围多道副柱,金色粒子瀑布,全屏金色
   *   2.5-3.5s: 余晖消散
   */
  _drawEmperorCoronationStrike(anim) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cx = W * 0.5;
    const t = anim.age;

    ctx.save();

    if (t < 0.5) {
      // ========== 阶段 1:预警 ==========
      // 全屏快速脉动金色 + 顶部金色聚集
      const phase = t / 0.5;
      const pulse = 0.3 + 0.4 * Math.abs(Math.sin(t * 30));
      // 全屏背景金色
      ctx.fillStyle = `rgba(255, 212, 93, ${pulse * 0.5})`;
      ctx.fillRect(0, 0, W, H);
      // 顶部金色聚集(预示光柱位置)
      const topGrad = ctx.createLinearGradient(0, 0, 0, H * 0.4);
      topGrad.addColorStop(0, `rgba(255, 248, 208, ${0.7 * phase})`);
      topGrad.addColorStop(1, 'rgba(255, 212, 93, 0)');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, W, H * 0.4);

    } else if (t < 1.5) {
      // ========== 阶段 2:主光柱降下 ==========
      const phase = (t - 0.5) / 1.0;   // 0 → 1
      const eased = 1 - Math.pow(1 - phase, 3);   // ease-out cubic

      // 全屏金色覆盖(渐强)
      ctx.fillStyle = `rgba(255, 212, 93, ${0.4 + eased * 0.3})`;
      ctx.fillRect(0, 0, W, H);

      // ----- 主光柱:从顶部降下,长度随 phase 增长 -----
      // 光柱底部 y(屏幕坐标系,顶部 0,底部 H)
      const colBottom = H * eased;
      const colWidth = W * (0.15 + eased * 0.25);

      // 外层光柱(金色)
      const outerGrad = ctx.createLinearGradient(cx - colWidth / 2, 0, cx + colWidth / 2, 0);
      outerGrad.addColorStop(0, 'rgba(255, 212, 93, 0)');
      outerGrad.addColorStop(0.3, `rgba(255, 230, 150, ${0.85 * eased})`);
      outerGrad.addColorStop(0.5, `rgba(255, 248, 208, ${0.95 * eased})`);
      outerGrad.addColorStop(0.7, `rgba(255, 230, 150, ${0.85 * eased})`);
      outerGrad.addColorStop(1, 'rgba(255, 212, 93, 0)');
      ctx.fillStyle = outerGrad;
      ctx.fillRect(cx - colWidth / 2, 0, colWidth, colBottom);

      // 内层核心(纯白)
      const coreW = colWidth * 0.25;
      const coreGrad = ctx.createLinearGradient(cx - coreW / 2, 0, cx + coreW / 2, 0);
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      coreGrad.addColorStop(0.5, `rgba(255, 255, 255, ${0.95 * eased})`);
      coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = coreGrad;
      ctx.fillRect(cx - coreW / 2, 0, coreW, colBottom);

      // ----- 光柱底部辐射环(冲击波) -----
      if (eased > 0.3) {
        const ringPhase = (eased - 0.3) / 0.7;
        const ringR = colWidth * (0.5 + ringPhase * 2);
        ctx.save();
        ctx.globalAlpha = (1 - ringPhase) * 0.6;
        ctx.strokeStyle = '#fff8d0';
        ctx.lineWidth = 8 * (1 - ringPhase);
        ctx.shadowColor = '#ffd45d';
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.ellipse(cx, colBottom, ringR, ringR * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ----- 顶部喷射光带(光从天空射出) -----
      const beamWidth = W * 0.06;
      ctx.save();
      ctx.globalAlpha = 0.7 * eased;
      const beamGrad = ctx.createLinearGradient(cx - beamWidth, 0, cx + beamWidth, 0);
      beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      beamGrad.addColorStop(0.5, '#ffffff');
      beamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = beamGrad;
      ctx.fillRect(cx - beamWidth, 0, beamWidth * 2, Math.min(colBottom, H * 0.15));
      ctx.restore();

    } else if (t < 2.5) {
      // ========== 阶段 3:极光主体(稳态高潮) ==========
      const phase = (t - 1.5) / 1.0;   // 0 → 1
      // 全屏强金色覆盖(稳态)
      ctx.fillStyle = `rgba(255, 212, 93, 0.7)`;
      ctx.fillRect(0, 0, W, H);

      // ----- 中央主光柱 -----
      const colWidth = W * 0.45;
      const outerGrad = ctx.createLinearGradient(cx - colWidth / 2, 0, cx + colWidth / 2, 0);
      outerGrad.addColorStop(0, 'rgba(255, 212, 93, 0)');
      outerGrad.addColorStop(0.2, 'rgba(255, 230, 150, 0.7)');
      outerGrad.addColorStop(0.5, 'rgba(255, 248, 208, 0.98)');
      outerGrad.addColorStop(0.8, 'rgba(255, 230, 150, 0.7)');
      outerGrad.addColorStop(1, 'rgba(255, 212, 93, 0)');
      ctx.fillStyle = outerGrad;
      ctx.fillRect(cx - colWidth / 2, 0, colWidth, H);

      // 中心纯白核心(脉动)
      const corePulse = 0.95 + 0.05 * Math.sin(t * 25);
      const coreW = colWidth * 0.18 * corePulse;
      ctx.fillStyle = `rgba(255, 255, 255, ${corePulse})`;
      ctx.fillRect(cx - coreW / 2, 0, coreW, H);

      // ----- 副光柱(左右各 2 道,营造"极光多重幕布"感) -----
      const sideOffsets = [-W * 0.30, -W * 0.15, W * 0.15, W * 0.30];
      for (const off of sideOffsets) {
        const sideX = cx + off;
        const sideW = W * 0.05 + W * 0.02 * Math.sin(t * 8 + off * 0.01);  // 微微飘动
        const sideAlpha = 0.4 + 0.2 * Math.sin(t * 6 + off * 0.02);
        const sideGrad = ctx.createLinearGradient(sideX - sideW / 2, 0, sideX + sideW / 2, 0);
        sideGrad.addColorStop(0, 'rgba(255, 255, 220, 0)');
        sideGrad.addColorStop(0.5, `rgba(255, 248, 208, ${sideAlpha})`);
        sideGrad.addColorStop(1, 'rgba(255, 255, 220, 0)');
        ctx.fillStyle = sideGrad;
        ctx.fillRect(sideX - sideW / 2, 0, sideW, H);
      }

      // ----- 顶部金色"破天"光芒(放射状) -----
      ctx.save();
      ctx.globalAlpha = 0.8;
      const topY = -H * 0.05;
      const ngBeams = 12;   // 12 道放射光
      for (let i = 0; i < ngBeams; i++) {
        const ang = (i / ngBeams) * Math.PI - Math.PI / 2;   // 半圆扇形向下
        const len = H * 1.2;
        const grad2 = ctx.createLinearGradient(cx, topY, cx + Math.cos(ang) * len, topY + Math.abs(Math.sin(ang)) * len);
        grad2.addColorStop(0, `rgba(255, 248, 208, 0.7)`);
        grad2.addColorStop(1, 'rgba(255, 212, 93, 0)');
        ctx.strokeStyle = grad2;
        ctx.lineWidth = 4 + Math.random() * 3;
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.lineTo(cx + Math.cos(ang) * len, topY + Math.abs(Math.sin(ang)) * len);
        ctx.stroke();
      }
      ctx.restore();

      // ----- 底部冲击波 (持续辐射) -----
      const bottomCount = 3;
      for (let i = 0; i < bottomCount; i++) {
        const ringPhase = ((t * 2 + i * 0.5) % 1);
        const ringR = W * (0.1 + ringPhase * 0.5);
        ctx.save();
        ctx.globalAlpha = (1 - ringPhase) * 0.7;
        ctx.strokeStyle = '#fff8d0';
        ctx.lineWidth = 8 * (1 - ringPhase);
        ctx.shadowColor = '#ffd45d';
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.ellipse(cx, H, ringR, ringR * 0.35, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

    } else {
      // ========== 阶段 4:余晖消散 ==========
      const fadeT = (t - 2.5) / 1.0;
      const intensity = 1 - fadeT;

      // 全屏金色淡出
      ctx.fillStyle = `rgba(255, 212, 93, ${intensity * 0.7})`;
      ctx.fillRect(0, 0, W, H);

      // 残留中央光柱
      const colWidth = W * 0.45;
      const grad = ctx.createLinearGradient(cx - colWidth / 2, 0, cx + colWidth / 2, 0);
      grad.addColorStop(0, 'rgba(255, 212, 93, 0)');
      grad.addColorStop(0.5, `rgba(255, 248, 208, ${intensity})`);
      grad.addColorStop(1, 'rgba(255, 212, 93, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(cx - colWidth / 2, 0, colWidth, H);

      // 残留白色核心
      const coreW = colWidth * 0.18;
      ctx.fillStyle = `rgba(255, 255, 255, ${intensity * 0.95})`;
      ctx.fillRect(cx - coreW / 2, 0, coreW, H);
    }

    ctx.restore();
  },

  /**
   * 在屏幕坐标 (centerScreenX, centerScreenY) 上方绘制 HP 血条
   * 用于 boss / icosa / 任何"重要敌人"通用
   */
  _drawHpBar(sx, sy, outerR, color, remaining, total, label, opts) {
    opts = opts || {};
    const invert = !!opts.invert;  // true: 满 = 危险（球用）
    const ctx = this.ctx;
    const barW = outerR * 1.6;
    const barH = 6;
    const barX = sx - barW / 2;
    const barY = sy - outerR - 22;
    const ratio = total > 0 ? Math.min(1, remaining / total) : 0;
    ctx.save();
    ctx.fillStyle = invert ? 'rgba(170, 80, 255, 0.18)' : 'rgba(255, 80, 100, 0.18)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillRect(barX, barY, barW * ratio, barH);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    if (invert) {
      ctx.fillText(`${label} · HP ${remaining}`, sx, barY - 4);
    } else {
      ctx.fillText(`${label} · HP ${remaining} / ${total}`, sx, barY - 4);
    }
    ctx.restore();
  },

  /**
   * 绘制球 BOSS（黑洞）
   * - 黑色实心圆
   * - 旋转吸积盘（外环渐变 + 旋转条纹）
   * - 中心高光（事件视界亮点）
   * - 头顶血量条
   */
  _drawSphere(sphere) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(sphere.x, sphere.y);
    const r = sphere.size * Coords.scale;
    const ang = sphere.angle || 0;

    ctx.save();
    // —— 吸积盘（外环渐变） ——
    const gradient = ctx.createRadialGradient(sp.x, sp.y, r * 0.6, sp.x, sp.y, r * 1.4);
    gradient.addColorStop(0, 'rgba(170, 80, 255, 0.0)');
    gradient.addColorStop(0.4, 'rgba(170, 80, 255, 0.55)');
    gradient.addColorStop(0.7, 'rgba(255, 100, 200, 0.35)');
    gradient.addColorStop(1, 'rgba(255, 100, 200, 0.0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * 1.4, 0, Math.PI * 2);
    ctx.fill();

    // —— 旋转吸积条纹 ——
    ctx.translate(sp.x, sp.y);
    ctx.rotate(ang);
    ctx.strokeStyle = 'rgba(255, 200, 255, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.1, a, a + 0.5);
      ctx.stroke();
    }
    ctx.rotate(-ang);

    // —— 黑洞主体（深紫黑 + 边缘发光） ——
    ctx.shadowColor = '#aa44ff';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#0a0014';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // —— 事件视界亮边 ——
    ctx.strokeStyle = 'rgba(170, 80, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2);
    ctx.stroke();

    // —— 中心微小奇点 ——
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(r * 0.08, 3), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // —— 头顶血量条（显示当前 HP，越满越危险） ——
    const SPHERE_GG_HP = 97;
    this._drawHpBar(sp.x, sp.y, r, '#cc66ff', sphere.hp, SPHERE_GG_HP, '球 · 黑洞', { invert: true });
  },

  /**
   * 球死亡动画：膨胀 + 变白 + 淡出，6 秒
   * 时序：
   *   t=0..0.08    从 startSize 快速膨胀到 peakSize（鼓大，约 0.5 秒）
   *   t=0.08..0.83 保持 peakSize 颜色逐渐发白（约 4.5 秒）
   *   t=0.83..1.0  alpha 从 1 衰减到 0（约 1 秒淡出）
   */
  _drawSphereDeath(anim) {
    const ctx = this.ctx;
    const t = anim.age / anim.duration;
    // size 缓动：前 8% 膨胀（0.5 秒），之后保持
    const expandT = Math.min(1, t / 0.08);
    const easedExpand = 1 - Math.pow(1 - expandT, 3);
    const size = anim.startSize + (anim.peakSize - anim.startSize) * easedExpand;
    // 整体 alpha：前 83% 全显，后 17% 淡出
    const alpha = t < 0.83 ? 1 : (1 - (t - 0.83) / 0.17);
    // 颜色发白
    const whiteness = Math.min(1, t * 1.3);

    const sp = Coords.toScreen(anim.x, anim.y);
    const r = size * Coords.scale;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 外层光环
    const grad = ctx.createRadialGradient(sp.x, sp.y, r * 0.2, sp.x, sp.y, r * 1.6);
    const innerColor = `rgba(${170 + 85 * whiteness}, ${80 + 175 * whiteness}, 255, ${0.85 - 0.3 * t})`;
    grad.addColorStop(0, innerColor);
    grad.addColorStop(0.5, `rgba(170, 80, 255, ${0.55 - 0.3 * t})`);
    grad.addColorStop(1, `rgba(255, 100, 200, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // 主体 —— 后期颜色越来越白
    const bodyR = r * (1 + 0.05 * Math.sin(performance.now() * 0.04));
    ctx.shadowColor = '#cc88ff';
    ctx.shadowBlur = 40;
    ctx.fillStyle = `rgba(${30 + 225 * whiteness}, ${0 + 255 * whiteness}, ${20 + 235 * whiteness}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, bodyR, 0, Math.PI * 2);
    ctx.fill();

    // 边缘高亮环
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(255, 200, 255, ${alpha * 0.95})`;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, bodyR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  },

  /**
   * 八芒星雾隐覆盖：所有 fogActive=true 的 star8 画淡灰色烟雾大圆
   * 半径 8 数学单位；中心完全遮蔽（不透明）；边缘渐变消散
   * 扩散动画：
   *   前 0.5 秒  —— 半径从 0 → 8 扩散进入
   *   中段       —— 全尺寸稳定遮蔽
   *   末 0.7 秒  —— 边缘逐渐淡出消散
   */
  _drawFogOverlays() {
    const ctx = this.ctx;
    const FOG_R = 12;     // 雾半径（之前 8 → 现在 ×1.5 = 12）
    const FADE_IN = 0.5;
    const FADE_OUT = 0.7;
    for (const e of this.state.enemies) {
      if (!e.fogActive || e.shape !== 'star8') continue;
      const elapsed = e.fogElapsed || 0;
      const remaining = (e.fogDuration || 7) - elapsed;
      const fadeInFactor = Math.min(1, elapsed / FADE_IN);
      const fadeOutFactor = remaining > FADE_OUT ? 1 : Math.max(0, remaining / FADE_OUT);
      const opacity = Math.min(fadeInFactor, fadeOutFactor);
      if (opacity <= 0.02) continue;
      const sizeFactor = fadeInFactor * (remaining > FADE_OUT ? 1 : 0.7 + 0.3 * fadeOutFactor);
      const r = FOG_R * sizeFactor * Coords.scale;

      const sp = Coords.toScreen(e.x, e.y);

      ctx.save();
      // 中心 70% 区域完全不透明 —— 彻底遮蔽背后敌人
      const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
      grad.addColorStop(0,    `rgba(180, 180, 200, ${opacity * 1.0})`);
      grad.addColorStop(0.55, `rgba(170, 170, 195, ${opacity * 1.0})`);
      grad.addColorStop(0.7,  `rgba(165, 165, 190, ${opacity * 0.95})`);
      grad.addColorStop(0.85, `rgba(160, 160, 185, ${opacity * 0.55})`);
      grad.addColorStop(1,    `rgba(160, 160, 185, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();
      // 内部漂动小烟团（增加纹理感）
      const t = performance.now() * 0.001;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + t * 0.3;
        const dist = r * 0.45;
        const cx = sp.x + Math.cos(ang) * dist;
        const cy = sp.y + Math.sin(ang) * dist;
        const rr = r * 0.32;
        const sub = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        sub.addColorStop(0, `rgba(220, 220, 235, ${opacity * 0.30})`);
        sub.addColorStop(1, `rgba(220, 220, 235, 0)`);
        ctx.fillStyle = sub;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  /**
   * 黑烟特效：被毁灭怪打死后 3 秒内画黑色烟团代替本体
   * 越接近复活越透明（淡出感）
   */
  _drawSmoke(e) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(e.x, e.y);
    const baseR = e.size * Coords.scale * 1.4;
    // 进度 [0, 1]：0 = 刚进黑烟，1 = 即将复活
    const progress = 1 - (e.smokeTimer / 7.0);
    const alpha = 0.85 - 0.35 * progress;   // 0.85 → 0.5
    const t = performance.now() * 0.001;

    ctx.save();
    // 主烟团：径向渐变，深紫黑
    const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, baseR);
    grad.addColorStop(0,    `rgba(85, 34, 136, ${alpha * 0.95})`);
    grad.addColorStop(0.5,  `rgba(34, 17, 68, ${alpha * 0.85})`);
    grad.addColorStop(0.85, `rgba(17, 8, 34, ${alpha * 0.45})`);
    grad.addColorStop(1,    `rgba(0, 0, 0, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, baseR, 0, Math.PI * 2);
    ctx.fill();
    // 内部漂动小烟团
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + t * 0.5;
      const dist = baseR * 0.4;
      const cx = sp.x + Math.cos(ang) * dist;
      const cy = sp.y + Math.sin(ang) * dist;
      const rr = baseR * 0.4;
      const sub = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      sub.addColorStop(0, `rgba(120, 70, 180, ${alpha * 0.5})`);
      sub.addColorStop(1, `rgba(120, 70, 180, 0)`);
      ctx.fillStyle = sub;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    // 复活倒计时显示（最后 1 秒红色警告）
    const remain = e.smokeTimer;
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#000000';
    ctx.fillStyle = remain < 1 ? '#ff8866' : '#cc99ff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(remain.toFixed(1), sp.x, sp.y);
    ctx.restore();
  },

  /**
   * 绘制掉落物：圆形外框 + 中心 emoji 图标 + 轻微脉动 + 拖尾
   *   shield  🛡️ 青色
   *   eraser  🧽 黄色
   *   boost   🎯 橙红
   *   freeze  ❄️ 淡蓝
   */
  _drawPickup(p) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(p.x, p.y);
    const r = 0.4 * Coords.scale;
    const meta = {
      shield: { color: '#5dffd6', icon: '🛡️' },
      eraser: { color: '#ffe066', icon: '🧽' },
      boost:  { color: '#ff8c5d', icon: '🎯' },
      freeze: { color: '#88ddff', icon: '❄️' },
    }[p.type] || { color: '#ffffff', icon: '?' };
    const pulse = 1 + 0.08 * Math.sin(p.age * 6);
    const rr = r * pulse;

    ctx.save();
    // 外发光圆
    ctx.shadowColor = meta.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(8, 17, 28, 0.85)';
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // emoji 图标
    ctx.shadowBlur = 0;
    ctx.font = `${Math.round(rr * 1.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.icon, sp.x, sp.y + 1);
    ctx.restore();
  },

  _drawCannon() {
    const ctx = this.ctx;
    const o = Coords.toScreen(0, 0);  // 数学原点（炮台位置）
    // 如果原点不在屏幕内，跳过
    if (o.x < -50 || o.x > Coords.W + 50 || o.y < -50 || o.y > Coords.H + 50) return;
    ctx.save();
    // 发射台底座
    ctx.fillStyle = 'rgba(93, 255, 214, 0.3)';
    ctx.shadowColor = '#5dffd6';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 14, 0, Math.PI * 2);
    ctx.fill();
    // 内圈
    ctx.fillStyle = '#5dffd6';
    ctx.beginPath();
    ctx.arc(o.x, o.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  _drawParticle(p) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(p.x, p.y);
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, p.size * Coords.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  _drawDamageNumber(d) {
    const ctx = this.ctx;
    const sp = Coords.toScreen(d.x, d.y);
    ctx.save();
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = d.color;
    ctx.font = 'bold 18px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 8;
    ctx.fillText(d.text, sp.x, sp.y);
    ctx.restore();
  },

  _darken(hex, amount) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.round(r * (1 - amount));
    g = Math.round(g * (1 - amount));
    b = Math.round(b * (1 - amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  },
};
