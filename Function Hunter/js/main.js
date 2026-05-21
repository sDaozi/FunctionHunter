/**
 * 主入口
 */
window.addEventListener('DOMContentLoaded', () => {
  console.log('🎯 函数猎手 启动');
  Sound.loadVolumeSettings();   // 加载持久化的音量设置（早于 preload）
  Sound.preload();
  Sound.initAutoplayUnlock();   // 等用户首次交互后才放 BGM
  Menu.init();
  Screen.show('menu');

  // 启动遮罩：首次点击后淡出消失（同时浏览器解锁 audio autoplay → menu BGM 自动播放）
  const gate = document.getElementById('start-gate');
  if (gate) {
    const dismiss = () => {
      gate.classList.add('fading');
      setTimeout(() => gate.remove(), 450);
    };
    gate.addEventListener('click', dismiss, { once: true });
    gate.addEventListener('keydown', dismiss, { once: true });
  }
});

window.addEventListener('error', (e) => {
  console.error('运行错误:', e.message, e.error);
});
