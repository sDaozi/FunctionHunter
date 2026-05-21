/**
 * 简易音效播放器
 *
 * 使用方式：
 *   Sound.play('laserok');   // 播放预定义音效
 *
 * 实现要点：
 *   - 每个音效预先 new Audio()，避免每次播放新建对象
 *   - 快速连发时通过克隆 Audio 元素实现重叠播放（同一首曲可多个实例并行）
 *   - 浏览器自动播放策略：用户首次交互前播放会被拒，silently catch
 *   - 全局静音开关 Sound.muted（默认 false）
 */
const Sound = {
  // 音效路径表
  SOURCES: {
    laserok: 'assets/audio/laserok.mp3',
    gameover: 'assets/audio/gameover.mp3',
  },

  // 背景音乐路径表
  BGM_SOURCES: {
    menu: 'assets/audio/game-menu.mp3',
    battle: 'assets/audio/game-battle.mp3',
    boss: 'assets/audio/game-boss.mp3',
  },

  // 默认音量（0..1）
  DEFAULT_VOLUME: 0.45,
  BGM_VOLUME: 0.32,         // BGM 比 sfx 低一点不抢戏

  // 全局静音
  muted: false,
  bgmMuted: false,

  // 缓存：每个音效一份「模板」Audio，仅用于克隆
  _templates: {},

  // BGM 当前实例 + 当前曲名
  _bgmAudio: null,
  _bgmName: null,
  _bgmInstances: {},        // 每个 BGM 一个长生 Audio，方便切换不重新加载
  _userInteracted: false,   // 用户是否曾交互过（决定 autoplay 是否被允许）
  _pendingBgm: null,        // 待播放的 BGM（首次交互后触发）

  /**
   * 监听全局首次用户交互（pointerdown / keydown / click），触发后允许 autoplay
   * 必须在用户能交互的元素挂载后调用一次（main.js 启动时）
   */
  initAutoplayUnlock() {
    const unlock = () => {
      this._userInteracted = true;
      if (this._pendingBgm) {
        const name = this._pendingBgm;
        this._pendingBgm = null;
        this.playBgm(name);
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
  },

  /**
   * 预加载（可选）。在用户首次操作之前就把音频元数据拉下来，
   * 减少首次播放的延迟。
   */
  preload() {
    for (const name of Object.keys(this.SOURCES)) {
      this._getTemplate(name);
    }
    for (const name of Object.keys(this.BGM_SOURCES)) {
      this._getBgmInstance(name);
    }
  },

  _getTemplate(name) {
    if (this._templates[name]) return this._templates[name];
    const src = this.SOURCES[name];
    if (!src) return null;
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = this.DEFAULT_VOLUME;
    this._templates[name] = audio;
    return audio;
  },

  _getBgmInstance(name) {
    if (this._bgmInstances[name]) return this._bgmInstances[name];
    const src = this.BGM_SOURCES[name];
    if (!src) return null;
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = this.BGM_VOLUME;
    this._bgmInstances[name] = audio;
    return audio;
  },

  /**
   * 播放一次音效
   */
  play(name, volume) {
    if (this.muted) return;
    const tpl = this._getTemplate(name);
    if (!tpl) return;
    const a = tpl.cloneNode();
    a.volume = (typeof volume === 'number') ? volume : this.DEFAULT_VOLUME;
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  },

  /**
   * 播放/切换 BGM
   * - 如果当前已是同一首，什么也不做
   * - 否则停掉当前曲，播放新曲（循环）
   * - 浏览器自动播放策略：用户首次交互前 play() 会 reject —— 静默吞掉
   */
  playBgm(name) {
    if (this.bgmMuted) return;
    // 首次交互前 autoplay 必被 reject，记下 pending 等首次交互后再播
    if (!this._userInteracted) {
      this._pendingBgm = name;
      return;
    }
    if (this._bgmName === name) return;   // 已在播
    // 停掉旧的
    if (this._bgmAudio) {
      try {
        this._bgmAudio.pause();
        this._bgmAudio.currentTime = 0;
      } catch (e) {}
    }
    const a = this._getBgmInstance(name);
    if (!a) return;
    a.currentTime = 0;
    a.volume = this.BGM_VOLUME;
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    this._bgmAudio = a;
    this._bgmName = name;
  },

  stopBgm() {
    if (this._bgmAudio) {
      try {
        this._bgmAudio.pause();
        this._bgmAudio.currentTime = 0;
      } catch (e) {}
      this._bgmAudio = null;
      this._bgmName = null;
    }
  },

  setMuted(m) {
    this.muted = !!m;
  },

  setBgmMuted(m) {
    this.bgmMuted = !!m;
    if (this.bgmMuted) {
      this.stopBgm();
    }
  },

  /** 设置 BGM 音量（0..1），持久化并立即应用到当前播放的 BGM */
  setBgmVolume(v) {
    v = Math.max(0, Math.min(1, v));
    this.BGM_VOLUME = v;
    if (this._bgmAudio) {
      try { this._bgmAudio.volume = v; } catch (e) {}
    }
    try { localStorage.setItem('fh_bgm_vol', String(v)); } catch (e) {}
  },

  /** 设置 SFX 音量（0..1），持久化（影响后续 play() 的默认音量） */
  setSfxVolume(v) {
    v = Math.max(0, Math.min(1, v));
    this.DEFAULT_VOLUME = v;
    try { localStorage.setItem('fh_sfx_vol', String(v)); } catch (e) {}
  },

  /** 从 localStorage 加载持久化音量（main.js 启动时调用） */
  loadVolumeSettings() {
    try {
      const bv = parseFloat(localStorage.getItem('fh_bgm_vol'));
      if (isFinite(bv) && bv >= 0 && bv <= 1) this.BGM_VOLUME = bv;
      const sv = parseFloat(localStorage.getItem('fh_sfx_vol'));
      if (isFinite(sv) && sv >= 0 && sv <= 1) this.DEFAULT_VOLUME = sv;
    } catch (e) {}
  },
};
