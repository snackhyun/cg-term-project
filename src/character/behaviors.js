/**
 * 프리셋 행동 (제너레이터) 실행기
 * 명령: { type: 'move', target: {u,v}, gait, until?, through? } | { type: 'wait', duration }
 *       | { type: 'jump' } | { type: 'prop', kind } | { type: 'once', clip }
 * 목표는 걷는 영역 기준 상대 좌표라서 건물을 다시 만들어도 그대로 이어짐
 */
import { farEndpointFirst, toNormalized } from './navigation.js';

/** 프리셋별 길이·횟수. runDuration: 아이 뛰기 시간(초), jumpGap: 점프 사이 대기(초) */
export const BEHAVIOR_PARAMS = Object.freeze({
  runDuration: 8,
  jumps: 4,
  jumpGap: 0.25,
});

function endpoints(character) {
  const rect = character.rect;
  const p = character.position;
  return farEndpointFirst(rect, p.x, p.z).map((e) =>
    toNormalized(rect, e.x, e.z),
  );
}

/** 걷기: 먼 쪽 끝까지 가로지르기 */
function* walkAcross(character) {
  const [far] = endpoints(character);
  yield { type: 'move', target: far, gait: 'walk' };
}

/** 아이 뛰기: 정해진 시간 동안 왕복 */
function* runBackAndForth(character, env) {
  const end = env.time + BEHAVIOR_PARAMS.runDuration;
  let [a, b] = endpoints(character);
  while (env.time < end) {
    yield { type: 'move', target: a, gait: 'run', until: end, through: true };
    [a, b] = [b, a];
  }
  yield { type: 'stop' };
}

/** 제자리 점프 */
function* jumpInPlace() {
  yield { type: 'stop' };
  for (let i = 0; i < BEHAVIOR_PARAMS.jumps; i++) {
    yield { type: 'jump' };
    yield { type: 'wait', duration: BEHAVIOR_PARAMS.jumpGap };
  }
}

function* hammering() {
  yield { type: 'stop' };
  yield { type: 'prop', kind: 'hammer' };
}

function* dropping() {
  yield { type: 'stop' };
  yield { type: 'once', clip: 'interact' };
  yield { type: 'prop', kind: 'drop' };
}

/** 프리셋 이름 → 행동 */
export const BEHAVIORS = Object.freeze({
  walk: walkAcross,
  run: runBackAndForth,
  jump: jumpInPlace,
  hammer: hammering,
  drop: dropping,
});

/** 행동 실행기 */
export class BehaviorRunner {
  /**
   * @param {object} hooks
   * @param {(kind: string) => { done: boolean }} hooks.startProp
   * @param {() => void} hooks.clearProps
   */
  constructor(character, hooks) {
    this.character = character;
    this.hooks = hooks;
    this.env = { time: 0 };
    this.task = null;
    this.command = null;
    this.name = null;
  }

  get busy() {
    return this.task !== null;
  }

  /** 행동 시작 (진행 중인 행동은 취소) */
  start(name) {
    const make = BEHAVIORS[name];
    if (!make) return false;
    this.cancel();
    this.name = name;
    this.task = make(this.character, this.env);
    this.next();
    return true;
  }

  /** 직접 지정한 명령 하나 실행 (클릭 이동) */
  startCommand(command, name = 'command') {
    this.cancel();
    this.name = name;
    this.task = (function* () {
      yield command;
    })();
    this.next();
  }

  /** 취소. 캐릭터는 감속 후 대기 */
  cancel() {
    if (this.task) this.task.return();
    this.task = null;
    this.command = null;
    this.name = null;
    this.hooks.clearProps();
    this.character.cancelPop?.();
    this.character.stop();
  }

  next() {
    const r = this.task.next();
    if (r.done) {
      this.task = null;
      this.command = null;
      this.name = null;
      return;
    }
    this.command = { ...r.value, t: 0, started: false };
  }

  update(delta) {
    this.env.time += delta;
    // 한 프레임에 여러 명령 종료 가능 → 횟수 제한
    for (let guard = 0; guard < 8 && this.task && this.command; guard++) {
      if (!this.step(this.command, delta)) break;
      this.next();
      delta = 0;
    }
  }

  /** 명령 진행. 끝나면 true */
  step(cmd, delta) {
    const c = this.character;
    const first = !cmd.started;
    cmd.started = true;
    cmd.t += delta;
    switch (cmd.type) {
      case 'move':
        if (first) c.moveTo(cmd.target, cmd.gait, !!cmd.through);
        if (cmd.until !== undefined && this.env.time >= cmd.until) {
          if (c.target || cmd.through) c.stop();
          cmd.through = false;
          return !c.isMoving;
        }
        if (cmd.through) return !first && c.target === null;
        return !first && !c.isMoving;
      case 'stop':
        if (first) c.stop();
        return !c.isMoving;
      case 'wait':
        return cmd.t >= cmd.duration;
      case 'jump':
        if (first) c.jump();
        return !first && c.jumpDone;
      case 'once':
        if (first) c.playOnce(cmd.clip);
        return true;
      case 'prop':
        if (first) cmd.prop = this.hooks.startProp(cmd.kind);
        return !cmd.prop || cmd.prop.done;
      default:
        return true;
    }
  }
}
