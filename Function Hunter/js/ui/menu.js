/**
 * 主菜单 UI
 */
const Menu = {
  init() {
    // 播放菜单 BGM（首次进入或从游戏返回菜单时）
    Sound.playBgm('menu');

    document.querySelectorAll('.menu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'play') {
          Screen.show('game');
          Game.start();
          Sound.playBgm('battle');   // 切到战斗 BGM
        } else if (action === 'codex') {
          Screen.show('codex');
          CodexScreen.init();
        } else if (action === 'settings') {
          Screen.show('settings');
          SettingsScreen.init();
        }
      });
    });

    document.querySelectorAll('[data-back]').forEach(btn => {
      btn.addEventListener('click', () => {
        const back = btn.dataset.back;
        if (Game.running) Game.stop();
        Screen.show(back);
        if (back === 'menu') {
          Sound.playBgm('menu');     // 回到菜单切回 menu BGM
          // 刷新最高分显示（暂停退出可能更新了它）
          try {
            const best = parseInt(localStorage.getItem('fh_best') || '0', 10) || 0;
            const el = document.getElementById('best-score');
            if (el) el.textContent = best;
          } catch (e) {}
        }
      });
    });

    // 显示最高分
    let best = 0;
    try {
      best = parseInt(localStorage.getItem('fh_best') || '0', 10) || 0;
    } catch (e) { /* file:// 某些浏览器禁用 */ }
    document.getElementById('best-score').textContent = best;
  },
};

/**
 * 图鉴菜单：左侧网格列出所有怪物 / 函数 / 效果，未见过的剪影显示
 */
const CodexScreen = {
  // 当前 tab：'enemies' / 'functions' / 'effects'
  currentTab: 'enemies',

  // 主菜单图鉴显示顺序（从普通到稀有）
  ORDER: [
    'tri', 'square', 'tri_queue',
    'hex', 'star', 'split', 'split_child',
    'hexagram', 'hep', 'inv7', 'star7', 'star8', 'star9', 'star10', 'oct', 'octminion',
    'boss', 'penta', 'icosa1', 'icosa2', 'icosa3', 'icosa4', 'sphere', 'gambler', 'emperor',
    'pickup_shield', 'pickup_eraser', 'pickup_boost', 'pickup_freeze',
  ],

  // 函数图鉴：基础函数（13 个）+ 标题 + 描述 + 解锁等级
  // 1 级：power 类（x²/x³/√x/1/x/|x|）+ 几何形（圆/椭圆/双曲线，初始就能用）
  // 3 级：exp 类（2^x / log）
  // 5 级：trig 类（sin / cos / tan）
  FUNC_DATA: [
    { key: 'x^2',          unlockLevel: 1, title: '二次函数',  expr: 'x^2',          desc: '抛物线，最经典的二次函数。开口向上的 U 形曲线，对称轴是 y 轴。\n\n<i>它不是一个碗。</i>' },
    { key: 'x^3',          unlockLevel: 1, title: '三次函数',  expr: 'x^3',          desc: '立方函数，关于原点中心对称。负半轴下沉、正半轴上扬。\n\n<i>这个函数大有一飞冲天之态。</i>' },
    { key: 'sqrt(x)',      unlockLevel: 1, title: '平方根',   expr: 'sqrt(x)',      desc: '只在 x ≥ 0 时定义。增长速度逐渐变慢，是平方函数的反函数。\n\n<i>“为什么你在负数没有定义？”“啊哈，我在负数的值是复数！”</i>' },
    { key: '1/x',          unlockLevel: 1, title: '反比例',   expr: '1/x',          desc: '双曲线，x = 0 是垂直渐近线，y = 0 是水平渐近线。\n\n<i>裂成两端，令无数导数使用者头痛欲裂。</i>' },
    { key: 'abs(x)',       unlockLevel: 1, title: '绝对值',   expr: 'abs(x)',       desc: 'V 形函数，关于 y 轴对称，在 x = 0 处不可导。\n\n<i>你的脑袋好尖噢。</i>' },
    { key: 'x^2+y^2=4',    unlockLevel: 1, title: '圆',       expr: 'x^2+y^2=4',    desc: '半径为 2 的圆，圆心在原点。所有点到原点的距离恒为 2。\n\n<i>噢，伟大的中心对称图形。</i>' },
    { key: 'x^2/9+y^2/4=1',unlockLevel: 1, title: '椭圆',     expr: 'x^2/9+y^2/4=1',desc: '半长轴 3、半短轴 2 的椭圆。两焦点的距离之和恒定。\n\n<i>你踩圆一脚，“啊！”。</i>' },
    { key: 'x^2/9-y^2/4=1',unlockLevel: 1, title: '双曲线',   expr: 'x^2/9-y^2/4=1',desc: '左右两支张开的双曲线。两焦点的距离之差恒定。\n\n<i>一种倾斜的反比例函数，或者反过来？</i>' },
    { key: '2^x',          unlockLevel: 3, title: '指数',     expr: '2^x',          desc: '指数增长，永远为正，恒过 (0, 1)。增长速度极快。\n\n<i>I will shatter you all!!!</i>' },
    { key: 'log(x)',       unlockLevel: 3, title: '对数',     expr: 'log(x)',       desc: '自然对数，只在 x > 0 时定义。是指数函数 e^x 的反函数。\n\n<i>弯下身子，给考生做牛马。</i>' },
    { key: 'sin(x)',       unlockLevel: 5, title: '正弦',     expr: 'sin(x)',       desc: '周期 2π，振幅 1。在原点附近近似 y = x（小角度近似）。\n\n<i>随风飘扬。</i>' },
    { key: 'cos(x)',       unlockLevel: 5, title: '余弦',     expr: 'cos(x)',       desc: '周期 2π，振幅 1。是正弦的相位偏移：cos(x) = sin(x + π/2)。\n\n<i>浪花里舞蹈。</i>' },
    { key: 'tan(x)',       unlockLevel: 5, title: '正切',     expr: 'tan(x)',       desc: '周期 π，在 x = π/2 + kπ 处有垂直渐近线，发散到无穷。\n\n<i>有的地方没有定义。</i>' },
  ],

  // 效果图鉴：所有效果卡（蓝紫金）
  EFFECT_DATA: [
    { key: 'BLUE_TAYLOR',      tier: 'blue',   icon: '📐', title: '泰勒展开',     desc: '激光体积 ×1.25（叠加封顶 3 次 ≈ ×1.95）' },
    { key: 'BLUE_MACLAURIN',   tier: 'blue',   icon: '〰️', title: '麦克劳林展开', desc: '命中半径 ×1.5（叠加封顶 2 次 = ×2.25）' },
    { key: 'BLUE_INTEGRAL',    tier: 'blue',   icon: '🛡️', title: '环形积分',     desc: '立刻获得 3 点护盾（叠加封顶 5 次；护盾上限 10 ❤）' },
    { key: 'BLUE_SLOW',        tier: 'blue',   icon: '🐢', title: '迟缓',         desc: '所有敌人速度 ×0.8（叠加封顶 3 次 ≈ ×0.51）' },
    { key: 'BLUE_PUSHCART',    tier: 'blue',   icon: '💨', title: '小推车',       desc: '受伤时自动清屏（消耗一次充能，可叠加无上限）' },
    { key: 'BLUE_CONVERGENCE', tier: 'blue',   icon: '🌀', title: '趋同演化',     desc: '函数队列特殊事件出现概率 +15%（叠加封顶 3 层 = +45%）' },
    { key: 'BLUE_REROLL',      tier: 'blue',   icon: '🔄', title: '颠倒黑白',     desc: '放弃本次升级，获得 3 次刷新（下次升级才能用，可累积）' },
    { key: 'PURPLE_PARTIAL',   tier: 'purple', icon: '∂',  title: '偏微分',       desc: '每 10 秒自动发射一条 y=kx 锁定 |y| 最近的敌人，伤害 1（不可叠加）' },
    { key: 'PURPLE_STACK',     tier: 'purple', icon: '∑',  title: '叠加',         desc: '激光命中后叠加 +1 伤害（封顶 5；超 3 秒未命中清零）' },
    { key: 'PURPLE_PARALYZE',  tier: 'purple', icon: '⚡', title: '麻痹大意',     desc: '命中的敌人 5 秒内速度 ×0.5（不可叠加）' },
    { key: 'PURPLE_SUPER_EXPAND', tier: 'purple', icon: '💥', title: '超级展开',     desc: '5 关内所有怪物被击杀时,会像七边形一样发生范围爆炸(3 单位 AOE 扣 3 伤)' },
    { key: 'GOLD_ETHER',       tier: 'gold',   icon: '✨', title: '以太编辑',     desc: '基础伤害 +1 / 护盾翻倍（cap 10）/ 敌速 ×0.8 / 全部冷却变 1（封顶 2 次）' },
  ],

  init() {
    // 绑定 tab 切换
    document.querySelectorAll('.codex-tab').forEach(btn => {
      // 防止重复绑定
      btn.replaceWith(btn.cloneNode(true));
    });
    document.querySelectorAll('.codex-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.codex-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTab = btn.dataset.tab;
        this._render();
      });
    });
    // 默认敌人 tab
    this.currentTab = 'enemies';
    document.querySelectorAll('.codex-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === 'enemies');
    });
    this._render();
  },

  _render() {
    if (this.currentTab === 'enemies') this._renderEnemies();
    else if (this.currentTab === 'functions') this._renderFunctions();
    else if (this.currentTab === 'effects') this._renderEffects();
  },

  _renderEnemies() {
    let seen = new Set();
    try {
      const raw = localStorage.getItem('fh_seen_enemies');
      if (raw) seen = new Set(JSON.parse(raw));
    } catch (e) {}

    const data = Game.CODEX_DATA;
    const list = document.getElementById('codex-list');
    list.innerHTML = '';

    let totalKnown = 0;
    let total = 0;

    for (const key of this.ORDER) {
      if (!data[key]) continue;
      total++;
      const isSeen = seen.has(key);
      if (isSeen) totalKnown++;

      const card = document.createElement('div');
      card.className = 'codex-card' + (isSeen ? '' : ' locked');
      card.dataset.key = key;

      const canvas = document.createElement('canvas');
      canvas.width = 56;
      canvas.height = 56;
      this._drawIcon(canvas, data[key], isSeen);

      const label = document.createElement('div');
      label.className = 'codex-card-label';
      label.textContent = isSeen ? data[key].title.split(' · ')[0] : '???';

      card.appendChild(canvas);
      card.appendChild(label);
      card.addEventListener('click', () => this._select(key, isSeen));
      list.appendChild(card);
    }

    document.getElementById('codex-progress-sub').textContent = `已解锁 ${totalKnown} / ${total} 个敌人`;

    const firstKey = this.ORDER.find(k => data[k]);
    if (firstKey) this._select(firstKey, seen.has(firstKey));
  },

  _renderFunctions() {
    // 函数图鉴：所有 13 个基础函数默认全部解锁
    const list = document.getElementById('codex-list');
    list.innerHTML = '';

    const total = this.FUNC_DATA.length;

    for (const item of this.FUNC_DATA) {
      const card = document.createElement('div');
      card.className = 'codex-card';
      card.dataset.key = item.key;

      const canvas = document.createElement('canvas');
      canvas.width = 56;
      canvas.height = 56;
      this._drawFuncGraph(canvas, item.expr);

      const label = document.createElement('div');
      label.className = 'codex-card-label';
      label.textContent = item.title;

      card.appendChild(canvas);
      card.appendChild(label);
      card.addEventListener('click', () => this._selectFunc(item, true));
      list.appendChild(card);
    }

    document.getElementById('codex-progress-sub').textContent = `已解锁 ${total} / ${total} 个函数`;

    if (this.FUNC_DATA.length > 0) {
      this._selectFunc(this.FUNC_DATA[0], true);
    }
  },

  _renderEffects() {
    let seen = new Set();
    try {
      const raw = localStorage.getItem('fh_seen_effects');
      if (raw) seen = new Set(JSON.parse(raw));
    } catch (e) {}

    const list = document.getElementById('codex-list');
    list.innerHTML = '';

    let totalKnown = 0;
    const total = this.EFFECT_DATA.length;

    for (const item of this.EFFECT_DATA) {
      const isSeen = seen.has(item.key);
      if (isSeen) totalKnown++;

      const card = document.createElement('div');
      card.className = 'codex-card codex-card-effect tier-' + item.tier + (isSeen ? '' : ' locked');
      card.dataset.key = item.key;

      // emoji 图标
      const iconDiv = document.createElement('div');
      iconDiv.className = 'codex-effect-icon';
      iconDiv.textContent = isSeen ? item.icon : '?';

      const label = document.createElement('div');
      label.className = 'codex-card-label';
      label.textContent = isSeen ? item.title : '???';

      card.appendChild(iconDiv);
      card.appendChild(label);
      card.addEventListener('click', () => this._selectEffect(item, isSeen));
      list.appendChild(card);
    }

    document.getElementById('codex-progress-sub').textContent = `已解锁 ${totalKnown} / ${total} 个效果`;

    if (this.EFFECT_DATA.length > 0) {
      this._selectEffect(this.EFFECT_DATA[0], seen.has(this.EFFECT_DATA[0].key));
    }
  },

  _selectFunc(item, isSeen) {
    document.querySelectorAll('.codex-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.codex-card[data-key="${CSS.escape(item.key)}"]`);
    if (card) card.classList.add('selected');
    const detail = document.getElementById('codex-detail');
    if (!isSeen) {
      detail.innerHTML = `
        <div class="codex-detail-locked">
          <canvas class="codex-detail-icon" width="120" height="120"></canvas>
          <div class="codex-detail-locked-text">？？？</div>
          <div class="codex-detail-locked-sub">达到 ${item.unlockLevel} 级后解锁</div>
        </div>
      `;
    } else {
      detail.innerHTML = `
        <canvas class="codex-detail-icon" width="200" height="200"></canvas>
        <h3 class="codex-detail-title">${item.title}</h3>
        <div class="codex-detail-meta">
          <span class="codex-tag">${item.expr}</span>
        </div>
        <div class="codex-detail-desc">${item.desc}</div>
      `;
      const c = detail.querySelector('canvas');
      this._drawFuncGraph(c, item.expr);
    }
  },

  _selectEffect(item, isSeen) {
    document.querySelectorAll('.codex-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.codex-card[data-key="${item.key}"]`);
    if (card) card.classList.add('selected');
    const detail = document.getElementById('codex-detail');
    if (!isSeen) {
      detail.innerHTML = `
        <div class="codex-detail-locked">
          <div class="codex-effect-icon-large locked">?</div>
          <div class="codex-detail-locked-text">？？？</div>
          <div class="codex-detail-locked-sub">在游戏中首次选择此效果后解锁</div>
        </div>
      `;
    } else {
      const tierLabel = { blue: '常见 · 蓝', purple: '稀有 · 紫', gold: '传说 · 金' };
      detail.innerHTML = `
        <div class="codex-effect-icon-large tier-${item.tier}">${item.icon}</div>
        <h3 class="codex-detail-title">${item.title}</h3>
        <div class="codex-detail-meta">
          <span class="codex-tag tier-${item.tier}">${tierLabel[item.tier]}</span>
        </div>
        <div class="codex-detail-desc">${item.desc}</div>
      `;
    }
  },

  /** 在 56x56 或更大 canvas 上画函数图像（小预览，给左侧卡片用） */
  _drawFuncGraph(canvas, expr) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 背景：黑色 + 网格
    ctx.fillStyle = '#0a1320';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.18)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * h / 8);
      ctx.lineTo(w, i * h / 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i * w / 8, 0);
      ctx.lineTo(i * w / 8, h);
      ctx.stroke();
    }
    // 坐标轴
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    // 视域：[-6, 6] × [-6, 6]
    const VIEW = 6;
    const tx = (mx) => w / 2 + (mx / VIEW) * (w / 2);
    const ty = (my) => h / 2 - (my / VIEW) * (h / 2);

    ctx.strokeStyle = '#5dffd6';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#5dffd6';
    ctx.shadowBlur = 4;
    try {
      // 对几何形（圆/椭圆/双曲线）特殊处理
      if (expr === 'x^2+y^2=4') {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, (2 / VIEW) * (w / 2), 0, Math.PI * 2);
        ctx.stroke();
      } else if (expr === 'x^2/9+y^2/4=1') {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, (3 / VIEW) * (w / 2), (2 / VIEW) * (h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (expr === 'x^2/9-y^2/4=1') {
        // 双曲线两支：参数方程 x = 3·cosh(t), y = 2·sinh(t)
        for (const sign of [1, -1]) {
          ctx.beginPath();
          let first = true;
          for (let t = -2; t <= 2; t += 0.05) {
            const mx = sign * 3 * Math.cosh(t);
            const my = 2 * Math.sinh(t);
            const x = tx(mx);
            const y = ty(my);
            if (x < 0 || x > w || y < 0 || y > h) { first = true; continue; }
            if (first) { ctx.moveTo(x, y); first = false; }
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else {
        // 普通函数 y = f(x)：用 Parser.compile
        const compiled = Parser.compile(expr);
        if (!compiled || !compiled.fn) return;
        const fn = compiled.fn;
        ctx.beginPath();
        let first = true;
        for (let mx = -VIEW; mx <= VIEW; mx += 0.05) {
          let my;
          try { my = fn(mx); } catch (e) { my = NaN; }
          if (!isFinite(my) || Math.abs(my) > VIEW * 1.5) { first = true; continue; }
          const x = tx(mx);
          const y = ty(my);
          if (first) { ctx.moveTo(x, y); first = false; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } catch (e) { /* 解析失败，留空 */ }
    ctx.shadowBlur = 0;
  },

  _select(key, isSeen) {
    document.querySelectorAll('.codex-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.codex-card[data-key="${key}"]`);
    if (card) card.classList.add('selected');
    const detail = document.getElementById('codex-detail');
    const data = Game.CODEX_DATA[key];
    if (!data) { detail.innerHTML = ''; return; }
    if (!isSeen) {
      const isPickup = key.startsWith('pickup_');
      const sub = isPickup
        ? '在战斗中拾取此道具以解锁图鉴'
        : '在战斗中遭遇此敌人以解锁图鉴';
      detail.innerHTML = `
        <div class="codex-detail-locked">
          <canvas class="codex-detail-icon" width="120" height="120"></canvas>
          <div class="codex-detail-locked-text">？？？</div>
          <div class="codex-detail-locked-sub">${sub}</div>
        </div>
      `;
      const c = detail.querySelector('canvas');
      this._drawIcon(c, data, false);
    } else {
      detail.innerHTML = `
        <canvas class="codex-detail-icon" width="120" height="120"></canvas>
        <h3 class="codex-detail-title">${data.title}</h3>
        <div class="codex-detail-meta">
          ${(data.tags || []).map(t => `<span class="codex-tag">${t}</span>`).join('')}
        </div>
        <div class="codex-detail-desc">${data.desc || ''}</div>
      `;
      const c = detail.querySelector('canvas');
      this._drawIcon(c, data, true);
    }
  },

  _drawIcon(canvas, data, isSeen) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) * 0.36 * (data.iconSize || 1);

    if (!isSeen) {
      // 先正常画出形状（保留路径形态）
      if (Game._drawCodexIcon) {
        Game._drawCodexIcon(ctx, cx, cy, r, data);
      }
      // 用 source-in 把所有非透明像素覆盖为统一深灰，剪影效果
      // source-in 仅在已有内容的位置绘制新内容
      ctx.save();
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = '#3a4055';   // 中性深灰
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }

    // 已解锁：正常彩色绘制
    if (Game._drawCodexIcon) {
      Game._drawCodexIcon(ctx, cx, cy, r, data);
    }
  },
};

/**
 * 设置：音乐音量、音效音量、清空存档
 */
const SettingsScreen = {
  init() {
    const bgmSlider = document.getElementById('settings-bgm');
    const sfxSlider = document.getElementById('settings-sfx');
    const bgmVal = document.getElementById('settings-bgm-val');
    const sfxVal = document.getElementById('settings-sfx-val');
    const clearBtn = document.getElementById('settings-clear-save');

    // 初始化滑条值（从 sound 当前音量读取）
    bgmSlider.value = Math.round((Sound.BGM_VOLUME || 0) * 100);
    sfxSlider.value = Math.round((Sound.DEFAULT_VOLUME || 0) * 100);
    bgmVal.textContent = bgmSlider.value;
    sfxVal.textContent = sfxSlider.value;

    bgmSlider.oninput = () => {
      const v = parseInt(bgmSlider.value, 10) / 100;
      Sound.setBgmVolume(v);
      bgmVal.textContent = bgmSlider.value;
    };
    sfxSlider.oninput = () => {
      // 拖动时只更新数值显示和持久化音量，不试听
      const v = parseInt(sfxSlider.value, 10) / 100;
      Sound.setSfxVolume(v);
      sfxVal.textContent = sfxSlider.value;
    };
    sfxSlider.onchange = () => {
      // 松手时播一声 sfx 让玩家试听新音量
      const v = parseInt(sfxSlider.value, 10) / 100;
      Sound.play('laserok', v);
    };

    clearBtn.onclick = () => {
      if (!confirm('确定清空所有存档？\n\n这将清除：\n• 最高分\n• 已解锁的图鉴（敌人/函数/效果）\n• 函数队列成就\n• 教程进度\n• 音量设置\n\n此操作不可撤销。')) return;
      try {
        localStorage.removeItem('fh_best');
        localStorage.removeItem('fh_max_level');
        localStorage.removeItem('fh_seen_enemies');
        localStorage.removeItem('fh_seen_functions');
        localStorage.removeItem('fh_seen_effects');
        localStorage.removeItem('fh_library');
        localStorage.removeItem('fh_achievements_v1');
        localStorage.removeItem('fh_tutorial_seen_v1');
        localStorage.removeItem('fh_bgm_vol');
        localStorage.removeItem('fh_sfx_vol');
      } catch (e) {}
      // 重置音量到默认
      Sound.BGM_VOLUME = 0.32;
      Sound.DEFAULT_VOLUME = 0.45;
      bgmSlider.value = 32;
      sfxSlider.value = 45;
      bgmVal.textContent = '32';
      sfxVal.textContent = '45';
      // 重置 Game 状态中的 seenEnemies
      if (Game.state) Game.state.seenEnemies = new Set();
      // 重置 Library 内存中的 items（下次开局重新加载就为空）
      if (typeof Library !== 'undefined') Library.items = [];
      // 刷新最高分显示
      const bestEl = document.getElementById('best-score');
      if (bestEl) bestEl.textContent = '0';
      showToast('✅ 存档已清空', 1800);
    };
  },
};

/**
 * 屏幕切换
 */
const Screen = {
  show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('screen-' + name);
    if (target) target.classList.add('active');
  },
};

/**
 * Toast
 */
function showToast(msg, duration = 1800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), duration);
}
