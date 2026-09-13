// 告警提醒：声音（beep）与闪烁（flash），受 soundOn 开关约束。
export function useMonitorNotify(state) {
  let audioCtx = null;

  function flash(id) {
    state.flashIds.add(id);
    setTimeout(() => state.flashIds.delete(id), 4000);
  }

  function beep(times = 1) {
    if (!state.soundOn.value) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      for (let i = 0; i < times; i++) {
        const t0 = audioCtx.currentTime + i * 0.55;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'square';
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.06, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(t0);
        o.stop(t0 + 0.4);
      }
    } catch { /* 音频不可用则静默 */ }
  }

  return { flash, beep };
}
