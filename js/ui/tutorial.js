/**
 * 教程系统（第 0 波）
 *
 * 工作流程：
 *   Game.start() 检测 wave === 0 → Tutorial.start()
 *   每步：变暗 + 可选聚焦镂空 + 浮窗显示文案
 *   非聚焦步骤：点击屏幕任意位置切换下一句
 *   聚焦+requireClick 步骤：必须点击聚焦元素才能继续（其他点击拦截）
 *   完成所有步骤 → Tutorial.finish() → 推进到 wave 1
 */
const Tutorial = {
  STEPS: [
    { text: '唔，又有新手来了，嗯，就叫我"锒狠"吧，我负责提供什么"新手教程"。' },
    { text: '呃，如你所见，这个游戏是用函数图像激光攻击几何图形怪物的。' },
    { text: '这个是预设函数，有点简单了，不过当教程刚好。点这个按钮。', focus: '#preset-btn', requireClick: true },
    { text: '选这个试试。', focus: 'preset-x^2', requireClick: true },
    { text: '点这个发射。', focus: '#fire-btn', requireClick: true },
    { text: '看，就是这样。' },
    { text: '如果这个太简单了，你也可以自己构思点函数输入，这个就任你发挥了。', focus: '#func-input' },
    { text: '拖动屏幕可以改变观察位置，滚轮缩放屏幕，按"R"恢复默认视角。' },
    { text: '所有函数共用 1 秒冷却,发射后等一下才能再发射。' },
    { text: '击杀怪物可以获得积分,达到一定积分可以升级,每次升级时可以获得特殊能力。' },
    { text: '另外，每五波会有 BOSS 出现，一共五种。' },
    { text: '差不多就这些。' },
    { text: '对了，悄悄告诉你，如果实在打不过，试试输入"y=lv.999"，别说是我教你的。' },
  ],

  active: false,
  stepIndex: 0,
  _overlay: null,
  _textEl: null,
  _hintEl: null,
  _maskCutoutRect: null,
  _highlightRect: null,
  _resizeListener: null,
  _clickListener: null,
  _keyListener: null,    // 'T' 跳过教程

  /** localStorage key */
  STORAGE_KEY: 'fh_tutorial_seen_v1',

  /** 检查是否已完整看过教程 */
  hasSeen() {
    try { return localStorage.getItem(this.STORAGE_KEY) === '1'; }
    catch (e) { return false; }
  },

  /** 标记教程已完成（只在完整走完最后一步时调用） */
  markSeen() {
    try { localStorage.setItem(this.STORAGE_KEY, '1'); } catch (e) {}
  },

  start() {
    this.active = true;
    this.stepIndex = 0;
    this._overlay = document.getElementById('tutorial-overlay');
    this._textEl = document.getElementById('tutorial-text');
    this._hintEl = document.getElementById('tutorial-hint');
    this._maskCutoutRect = document.getElementById('tutorial-cutout-rect');
    this._highlightRect = document.getElementById('tutorial-highlight-rect');
    this._overlay.classList.remove('hidden');

    // 已看过教程：显示提示弹窗，可按 T 跳过
    if (this.hasSeen()) {
      showToast('已完整观看过教程，可以按 T 跳过', 3500);
    }

    // 全屏点击监听（capture 阶段优先于元素自身的事件）
    this._clickListener = (e) => this._onOverlayClick(e);
    this._overlay.addEventListener('click', this._clickListener, true);

    // 'T' 键跳过教程：仅当已看过时允许
    this._keyListener = (e) => {
      if ((e.key === 't' || e.key === 'T') && this.active) {
        if (!this.hasSeen()) {
          // 第一次看不能跳过
          showToast('首次需完整观看教程，无法跳过', 2000);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        this.finish();
      }
    };
    window.addEventListener('keydown', this._keyListener, true);

    // 窗口尺寸变化时重算聚焦框位置
    this._resizeListener = () => this._updateFocusRect();
    window.addEventListener('resize', this._resizeListener);

    this._renderStep();
  },

  finish() {
    if (!this.active) return;   // 防止重复 finish
    this.active = false;
    this.markSeen();              // 走到这里说明完整看完或主动跳过，标记已看
    if (this._overlay) {
      this._overlay.removeEventListener('click', this._clickListener, true);
      this._overlay.classList.add('hidden');
    }
    if (this._keyListener) {
      window.removeEventListener('keydown', this._keyListener, true);
      this._keyListener = null;
    }
    if (this._resizeListener) {
      window.removeEventListener('resize', this._resizeListener);
      this._resizeListener = null;
    }
    // 通知 Game 推进到 wave 1
    if (typeof Game !== 'undefined' && Game.onTutorialFinish) {
      Game.onTutorialFinish();
    }
  },

  _renderStep() {
    const step = this.STEPS[this.stepIndex];
    if (!step) {
      this.finish();
      return;
    }
    this._textEl.textContent = step.text;
    if (step.requireClick) {
      this._hintEl.textContent = '⚠ 请点击高亮处';
      this._hintEl.classList.add('action-required');
    } else {
      this._hintEl.textContent = '点击任意位置继续 ▶';
      this._hintEl.classList.remove('action-required');
    }
    // 如果聚焦项是预设菜单中的某项，先确保菜单展开
    if (step.focus && step.focus.startsWith('preset-')) {
      const presetBtn = document.getElementById('preset-btn');
      const presetMenu = document.getElementById('preset-menu');
      if (presetBtn && presetMenu && presetMenu.classList.contains('hidden')) {
        presetBtn.classList.add('open');
        presetMenu.classList.remove('hidden');
      }
    }
    // 等一帧让 DOM 更新（如菜单展开）后再算位置
    requestAnimationFrame(() => this._updateFocusRect());
  },

  _updateFocusRect() {
    const step = this.STEPS[this.stepIndex];
    if (!step || !step.focus) {
      // 无聚焦：镂空 0×0（整屏全暗）
      this._maskCutoutRect.setAttribute('width', '0');
      this._maskCutoutRect.setAttribute('height', '0');
      this._highlightRect.setAttribute('width', '0');
      this._highlightRect.setAttribute('height', '0');
      return;
    }
    let el = null;
    if (step.focus.startsWith('preset-')) {
      // 找预设项
      const expr = step.focus.slice('preset-'.length);
      const items = document.querySelectorAll('#preset-menu [data-snippet]');
      for (const it of items) {
        if (it.dataset.snippet === expr) { el = it; break; }
      }
    } else {
      el = document.querySelector(step.focus);
    }
    if (!el) {
      this._maskCutoutRect.setAttribute('width', '0');
      this._maskCutoutRect.setAttribute('height', '0');
      this._highlightRect.setAttribute('width', '0');
      this._highlightRect.setAttribute('height', '0');
      return;
    }
    const rect = el.getBoundingClientRect();
    const pad = 6;
    const x = rect.left - pad;
    const y = rect.top - pad;
    const w = rect.width + pad * 2;
    const h = rect.height + pad * 2;
    this._maskCutoutRect.setAttribute('x', x);
    this._maskCutoutRect.setAttribute('y', y);
    this._maskCutoutRect.setAttribute('width', w);
    this._maskCutoutRect.setAttribute('height', h);
    this._highlightRect.setAttribute('x', x);
    this._highlightRect.setAttribute('y', y);
    this._highlightRect.setAttribute('width', w);
    this._highlightRect.setAttribute('height', h);
  },

  _onOverlayClick(e) {
    // 防止 el.click() 触发的合成事件再次进入此 listener 造成循环
    if (e._tutSynthetic) return;
    const step = this.STEPS[this.stepIndex];
    if (!step) return;
    if (!step.requireClick) {
      e.preventDefault();
      e.stopPropagation();
      this.stepIndex++;
      this._renderStep();
      return;
    }
    let el = null;
    if (step.focus.startsWith('preset-')) {
      const expr = step.focus.slice('preset-'.length);
      const items = document.querySelectorAll('#preset-menu [data-snippet]');
      for (const it of items) {
        if (it.dataset.snippet === expr) { el = it; break; }
      }
    } else {
      el = document.querySelector(step.focus);
    }
    if (!el) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const rect = el.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right
                && e.clientY >= rect.top  && e.clientY <= rect.bottom;
    if (inside) {
      e.preventDefault();
      e.stopPropagation();
      // 用合成事件触发目标元素的点击，标记 _tutSynthetic 防止再次进入此 listener
      const synth = new MouseEvent('click', {
        bubbles: true, cancelable: true,
        clientX: e.clientX, clientY: e.clientY,
      });
      synth._tutSynthetic = true;
      el.dispatchEvent(synth);
      this.stepIndex++;
      // 渲染下一步可能需要等 DOM 更新（比如点 preset-btn 后菜单要展开）
      requestAnimationFrame(() => this._renderStep());
    } else {
      e.preventDefault();
      e.stopPropagation();
    }
  },
};
