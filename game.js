/**
 * 忍者跳跃 · H5 游戏骨架
 *
 * 分层结构：
 *   0. 常量与工具
 *   1. 引擎层：画布、缩放、主循环
 *   2. 输入层：键盘 + 触屏，统一成一份按键状态
 *   3. 游戏层：状态、实体、逻辑更新
 *   4. 渲染层
 *
 * 约定：
 *   - 所有绘制基于 960×540 的逻辑坐标系，画布负责等比缩放到屏幕
 *   - 物理使用固定步长（1/60s），与渲染帧率解耦
 *   - 核心计算（物理积分、碰撞解算）抽为纯函数，便于后续补测试
 */
(() => {
  'use strict';

  // ============================================================
  // 0. 常量与工具
  // ============================================================
  const WORLD = { width: 960, height: 540 };   // 逻辑分辨率（内部坐标系固定）
  const STEP = 1 / 60;                        // 固定步长，物理与帧率解耦
  const GRAVITY = 2200;                       // px/s^2
  const MOVE_SPEED = 320;                     // px/s
  const GROUND_ACCEL = 2600;                  // 地面加速度
  const AIR_ACCEL = 1500;                     // 空中加速度
  const JUMP_SPEED = 780;                     // 起跳初速度
  const FRICTION = 0.86;                      // 无输入时的速度衰减系数

  const GROUND_Y = WORLD.height - 72;         // TODO 改为关卡数据

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // 老版本 WebView 可能没有 roundRect，退化为直角矩形
  const roundRect = (context, x, y, w, h, r) => {
    context.beginPath();
    if (typeof context.roundRect === 'function') {
      context.roundRect(x, y, w, h, r);
    } else {
      context.rect(x, y, w, h);
    }
    context.fill();
  };

  // 物理环境：集中放可调参数，替换关卡数据时只改这里
  const PHYSICS_ENV = {
    gravity: GRAVITY,
    moveSpeed: MOVE_SPEED,
    groundAccel: GROUND_ACCEL,
    airAccel: AIR_ACCEL,
    jumpSpeed: JUMP_SPEED,
    worldWidth: WORLD.width,
    groundY: GROUND_Y
  };

  // ------------------------------------------------------------
  // 纯函数：物理积分
  // 入参出参都是纯数据，不触碰 DOM，可直接单元测试
  // ------------------------------------------------------------
  function stepPhysics(state, input, dt, env) {
    // 水平移动：区分地面/空中加速度
    const accel = state.onGround ? env.groundAccel : env.airAccel;
    if (input.left) state.vx -= accel * dt;
    if (input.right) state.vx += accel * dt;
    if (!input.left && !input.right) state.vx *= FRICTION;
    state.vx = clamp(state.vx, -env.moveSpeed, env.moveSpeed);

    // 跳跃：仅在落地时可起跳
    if (input.jump && state.onGround) {
      state.vy = -env.jumpSpeed;
      state.onGround = false;
    }

    // 重力
    state.vy += env.gravity * dt;

    // 位移
    state.x += state.vx * dt;
    state.y += state.vy * dt;

    return state;
  }

  // ------------------------------------------------------------
  // 纯函数：边界与地面碰撞解算
  // ------------------------------------------------------------
  function resolveCollisions(state, env) {
    if (state.x < 0) { state.x = 0; state.vx = 0; }
    if (state.x + state.w > env.worldWidth) { state.x = env.worldWidth - state.w; state.vx = 0; }
    if (state.y + state.h >= env.groundY) {
      state.y = env.groundY - state.h;
      state.vy = 0;
      state.onGround = true;
    } else {
      state.onGround = false;
    }
    return state;
  }

  // ============================================================
  // 1. 引擎层：画布、缩放、主循环
  // ============================================================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const fpsEl = document.getElementById('fps');

  let scale = 1;
  let dpr = 1;

  /** 画布按逻辑分辨率等比缩放并居中（letterbox），避免移动端拉伸变形 */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    scale = Math.min(vw / WORLD.width, vh / WORLD.height);

    canvas.width = Math.round(WORLD.width * scale * dpr);
    canvas.height = Math.round(WORLD.height * scale * dpr);
    canvas.style.width = Math.round(WORLD.width * scale) + 'px';
    canvas.style.height = Math.round(WORLD.height * scale) + 'px';
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // ============================================================
  // 2. 输入层：键盘 + 触屏，统一成一份按键状态
  // ============================================================
  const keys = { left: false, right: false, jump: false };

  const KEY_MAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump'
  };

  window.addEventListener('keydown', (e) => {
    const action = KEY_MAP[e.code];
    if (!action) return;
    e.preventDefault();
    keys[action] = true;
    if (action === 'jump' && !e.repeat) jumpQueued = true;
  });

  window.addEventListener('keyup', (e) => {
    const action = KEY_MAP[e.code];
    if (action) keys[action] = false;
  });

  // 虚拟按键：按下 / 松开分别写入 keys，与键盘共用同一套状态
  document.querySelectorAll('#pad button').forEach((btn) => {
    const action = btn.dataset.key;
    const down = (e) => { e.preventDefault(); keys[action] = true; if (action === 'jump') jumpQueued = true; };
    const up = (e) => { e.preventDefault(); keys[action] = false; };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  });

  // ============================================================
  // 3. 游戏层：状态、实体、逻辑更新
  // ============================================================
  let jumpQueued = false;      // 跳跃请求（按下瞬间置位，物理步消费后清空）
  let score = 0;               // TODO 正式玩法接入计分
  let player;

  function createPlayer() {
    return {
      x: 160,
      y: WORLD.height - 120,
      w: 36,
      h: 48,
      vx: 0,
      vy: 0,
      onGround: true
    };
  }

  function reset() {
    player = createPlayer();
    score = 0;
    jumpQueued = false;
  }

  function update(dt) {
    // 跳跃请求是边沿触发：一次按下只被一个物理步消费，
    // 无论此时是否落地都会清除，因此不会出现按住连跳
    const jump = jumpQueued;
    jumpQueued = false;

    stepPhysics(player, { left: keys.left, right: keys.right, jump }, dt, PHYSICS_ENV);
    resolveCollisions(player, PHYSICS_ENV);

    // TODO 在此处接入：敌人 AI、道具拾取、碰撞检测、关卡推进
  }

  // ============================================================
  // 4. 渲染层
  // ============================================================
  function drawBackground(t) {
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    sky.addColorStop(0, '#10242e');
    sky.addColorStop(0.55, '#1d3d47');
    sky.addColorStop(1, '#c78a5a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    // 月亮
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ffd79a';
    ctx.beginPath();
    ctx.arc(WORLD.width - 150, 118, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 远山剪影
    ctx.fillStyle = 'rgba(13, 27, 34, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= WORLD.width; x += 40) {
      const y = GROUND_Y - 120 - Math.sin(x / 130 + 0.6) * 46 - Math.sin(x / 47) * 12;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(WORLD.width, GROUND_Y);
    ctx.closePath();
    ctx.fill();

    // 地面
    ctx.fillStyle = '#0d1b22';
    ctx.fillRect(0, GROUND_Y, WORLD.width, WORLD.height - GROUND_Y);
    ctx.fillStyle = 'rgba(244, 237, 226, 0.18)';
    ctx.fillRect(0, GROUND_Y, WORLD.width, 3);
  }

  function drawPlayer(t) {
    const bob = player.onGround ? Math.sin(t / 180) * 1.5 : 0;
    const x = player.x;
    const y = player.y + bob;

    // 围巾（随速度飘动）
    ctx.save();
    ctx.strokeStyle = '#e8503a';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + player.w - 4, y + 16);
    ctx.quadraticCurveTo(
      x + player.w + 18 - player.vx * 0.03, y + 12,
      x + player.w + 30 - player.vx * 0.05, y + 24 + Math.sin(t / 120) * 4
    );
    ctx.stroke();
    ctx.restore();

    // 身体
    ctx.fillStyle = '#e8503a';
    roundRect(ctx, x, y, player.w, player.h, 10);

    // 头带
    ctx.fillStyle = '#1f2933';
    ctx.fillRect(x, y + 14, player.w, 8);

    // 眼睛
    ctx.fillStyle = '#f4ede2';
    ctx.fillRect(x + 8, y + 26, 5, 5);
    ctx.fillRect(x + player.w - 13, y + 26, 5, 5);
  }

  function render(t) {
    ctx.save();
    ctx.scale(scale * dpr, scale * dpr);
    drawBackground(t);
    drawPlayer(t);
    ctx.restore();
  }

  // ============================================================
  // 5. 主循环：固定步长累加 + 渲染
  // ============================================================
  let last = performance.now();
  let acc = 0;
  let fps = 0;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;      // 切后台回来不要一次补太多帧

    acc += dt;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }

    render(now);

    fps = fps * 0.9 + (1 / Math.max(dt, 0.0001)) * 0.1;
    fpsEl.textContent = Math.round(fps);

    requestAnimationFrame(frame);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') reset();
  });

  // 切到后台时暂停，回来重置时间基准
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { last = performance.now(); acc = 0; }
  });

  // ============================================================
  // 6. 对外暴露：供调试与后续单元测试使用
  // ============================================================
  window.GameCore = {
    stepPhysics,
    resolveCollisions,
    clamp,
    WORLD,
    STEP,
    PHYSICS_ENV,
    getPlayer: () => player,
    reset
  };

  reset();
  requestAnimationFrame(frame);
})();
