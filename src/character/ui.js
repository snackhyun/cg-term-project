/**
 * 캐릭터 UI: 프리셋 버튼, 정지, 클릭 모드, 카메라 따라가기 (index.html #info)
 */

/**
 * @param {object} actions
 * @param {(name: string) => void} actions.runPreset
 * @param {() => void} actions.stop
 * @param {() => void} actions.reset
 * @param {(mode: 'impact' | 'character') => void} actions.setMode
 * @param {(on: boolean) => void} actions.setFollow
 */
export function initCharacterUI(actions) {
  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => actions.runPreset(btn.dataset.preset));
  }
  document.getElementById('btn-stop')?.addEventListener('click', actions.stop);
  document
    .getElementById('btn-reset')
    ?.addEventListener('click', actions.reset);

  const modeButtons = [...document.querySelectorAll('[data-interaction]')];
  const hint = document.getElementById('move-hint');
  function setMode(mode) {
    for (const b of modeButtons) {
      b.classList.toggle('active', b.dataset.interaction === mode);
    }
    if (hint) hint.hidden = mode !== 'character';
    actions.setMode(mode);
  }
  for (const b of modeButtons) {
    b.addEventListener('click', () => setMode(b.dataset.interaction));
  }
  setMode('impact');

  const follow = document.getElementById('follow-camera');
  follow?.addEventListener('change', () => actions.setFollow(follow.checked));

  return {
    /** 모델 로드 실패 시 캐릭터 기능 비활성 */
    setUnavailable() {
      for (const b of document.querySelectorAll(
        '[data-preset], [data-interaction="character"]',
      )) {
        b.disabled = true;
        b.title = '캐릭터 모델 로드 실패';
      }
    },
  };
}
