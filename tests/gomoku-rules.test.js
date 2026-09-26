'use strict';

// 验收测试：gomoku-rules.js —— 五连判胜与满盘平局判定的唯一实现（CT-001）。
//
// 覆盖范围：
//   TASK-001 / CT-001 —— CommonJS module.exports 导出契约与浏览器侧同名全局引用；
//   TASK-002 / AC-001 —— 横向、纵向、主斜线、副斜线方向恰好五连判胜；
//   TASK-002 / AC-002 —— 同方向六连及更长连子判胜（含四连不判胜的负向对照）；
//   TASK-003 / AC-003 —— 四连被对方阻断且无其他五连时判对局未结束；
//   TASK-003 / AC-004 —— 空盘不判胜，判对局未结束；
//   TASK-003 / AC-005 —— 225 个交叉点填满且无五连判平局（含满盘有连判胜、未满盘不判平局的反向对照）。
//
// 依赖仅使用 Node 内置模块（node:test、node:assert、node:fs、node:path、node:vm）。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RULES_PATH = path.join(__dirname, '..', 'gomoku-rules.js');

const { BOARD_SIZE, EMPTY, BLACK, WHITE, checkWin, isDraw, judgeBoard } = require(RULES_PATH);

// 四个扫描方向（[行增量, 列增量]）：横向、纵向、主斜线、副斜线。
const DIRECTIONS = {
  横向: [0, 1],
  纵向: [1, 0],
  主斜线: [1, 1],
  副斜线: [1, -1],
};

const ONGOING = { status: 'ongoing', winner: EMPTY };

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(EMPTY));
}

function placeLine(board, startRow, startCol, direction, length, player) {
  const [rowStep, colStep] = direction;
  for (let offset = 0; offset < length; offset += 1) {
    board[startRow + rowStep * offset][startCol + colStep * offset] = player;
  }
  return board;
}

// 固定着色 (2 * row + col) % 4 < 2 ? BLACK : WHITE：
// 任一方向同色连续段最长 2，用于构造“225 子填满且无五连”的棋盘。
function fullBoardWithoutFive() {
  const board = emptyBoard();
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      board[row][col] = (2 * row + col) % 4 < 2 ? BLACK : WHITE;
    }
  }
  return board;
}

function filledCount(board) {
  return board.flat().filter((cell) => cell !== EMPTY).length;
}

function assertWinner(board, player) {
  assert.equal(checkWin(board, player), true, '连子方应被判胜');
  assert.equal(checkWin(board, player === BLACK ? WHITE : BLACK), false, '未连子方不应被判胜');
  assert.equal(isDraw(board), false, '已分胜负时不应判平局');
  assert.deepEqual(judgeBoard(board), { status: 'win', winner: player });
}

function assertOngoing(board) {
  assert.equal(checkWin(board, BLACK), false, '黑方不应被判胜');
  assert.equal(checkWin(board, WHITE), false, '白方不应被判胜');
  assert.equal(isDraw(board), false, '未满盘无五连不应判平局');
  assert.deepEqual(judgeBoard(board), ONGOING);
}

describe('AC-001 恰好五连判胜', () => {
  for (const [name, direction] of Object.entries(DIRECTIONS)) {
    it(`${name}方向恰好五连时判连子方获胜`, () => {
      const board = placeLine(emptyBoard(), 5, 5, direction, 5, BLACK);
      assertWinner(board, BLACK);
    });
  }

  it('白方在副斜线方向恰好五连时判白方获胜', () => {
    const board = placeLine(emptyBoard(), 4, 9, DIRECTIONS.副斜线, 5, WHITE);
    assertWinner(board, WHITE);
  });

  it('贴边的横向恰好五连同样判胜', () => {
    const board = placeLine(emptyBoard(), BOARD_SIZE - 1, BOARD_SIZE - 5, DIRECTIONS.横向, 5, BLACK);
    assertWinner(board, BLACK);
  });
});

describe('AC-002 六连及更长连子判胜', () => {
  for (const [name, direction] of Object.entries(DIRECTIONS)) {
    it(`${name}方向六连时判连子方获胜`, () => {
      const board = placeLine(emptyBoard(), 3, 7, direction, 6, WHITE);
      assertWinner(board, WHITE);
    });
  }

  it('横向七连（更长连子）时判连子方获胜', () => {
    const board = placeLine(emptyBoard(), 8, 2, DIRECTIONS.横向, 7, BLACK);
    assertWinner(board, BLACK);
  });

  it('同方向恰好四连不判胜（五连起判的负向对照）', () => {
    const board = placeLine(emptyBoard(), 6, 6, DIRECTIONS.主斜线, 4, BLACK);
    assertOngoing(board);
  });
});

describe('AC-003 四连被对方阻断不判胜', () => {
  it('横向四连被对方两子夹断且无其他五连时判对局未结束', () => {
    const board = emptyBoard();
    for (let col = 3; col <= 6; col += 1) {
      board[7][col] = BLACK;
    }
    board[7][2] = WHITE;
    board[7][7] = WHITE;
    assertOngoing(board);
  });

  it('同色四连被对方子隔断时不拼接为更长连子', () => {
    const board = emptyBoard();
    for (let col = 0; col <= 3; col += 1) {
      board[4][col] = WHITE;
    }
    board[4][4] = BLACK;
    for (let col = 5; col <= 8; col += 1) {
      board[4][col] = WHITE;
    }
    assertOngoing(board);
  });

  it('纵向四连被对方阻断且无其他五连时判对局未结束', () => {
    const board = emptyBoard();
    for (let row = 9; row <= 12; row += 1) {
      board[row][1] = BLACK;
    }
    board[8][1] = WHITE;
    board[13][1] = WHITE;
    assertOngoing(board);
  });
});

describe('AC-004 空盘不判胜', () => {
  it('空盘时双方均不判胜且判对局未结束', () => {
    const board = emptyBoard();
    assert.equal(filledCount(board), 0);
    assertOngoing(board);
  });

  it('仅有零星落子的棋盘判对局未结束', () => {
    const board = emptyBoard();
    board[0][0] = BLACK;
    board[BOARD_SIZE - 1][BOARD_SIZE - 1] = WHITE;
    assertOngoing(board);
  });
});

describe('AC-005 满盘无五连判平局', () => {
  it('225 个交叉点填满且双方无五连时判平局', () => {
    const board = fullBoardWithoutFive();
    assert.equal(filledCount(board), BOARD_SIZE * BOARD_SIZE, '构造的棋盘必须是满盘');
    assert.equal(checkWin(board, BLACK), false, '构造的满盘不应含黑方五连');
    assert.equal(checkWin(board, WHITE), false, '构造的满盘不应含白方五连');
    assert.equal(isDraw(board), true);
    assert.deepEqual(judgeBoard(board), { status: 'draw', winner: EMPTY });
  });

  it('满盘但存在五连时判胜而非平局（判胜优先于平局）', () => {
    const board = fullBoardWithoutFive();
    for (let col = 0; col < 5; col += 1) {
      board[0][col] = BLACK;
    }
    assert.equal(filledCount(board), BOARD_SIZE * BOARD_SIZE);
    assert.equal(isDraw(board), false);
    assert.deepEqual(judgeBoard(board), { status: 'win', winner: BLACK });
  });

  it('仅差一个交叉点未填满且无五连时不判平局', () => {
    const board = fullBoardWithoutFive();
    board[0][0] = EMPTY;
    assert.equal(filledCount(board), BOARD_SIZE * BOARD_SIZE - 1);
    assertOngoing(board);
  });
});

describe('TASK-001 导出契约', () => {
  it('CommonJS 导出判胜函数、平局判定函数与聚合判定函数', () => {
    assert.equal(typeof checkWin, 'function');
    assert.equal(typeof isDraw, 'function');
    assert.equal(typeof judgeBoard, 'function');
  });

  it('导出棋盘常量：15 路棋盘与空/黑/白取值', () => {
    assert.equal(BOARD_SIZE, 15);
    assert.equal(EMPTY, 0);
    assert.equal(BLACK, 1);
    assert.equal(WHITE, 2);
  });

  it('棋盘形状或棋子取值非法时抛出 TypeError', () => {
    const shortBoard = Array.from({ length: BOARD_SIZE - 1 }, () => new Array(BOARD_SIZE).fill(EMPTY));
    assert.throws(() => checkWin(shortBoard, BLACK), TypeError);
    assert.throws(() => checkWin(emptyBoard(), 3), TypeError);
    assert.throws(() => isDraw('not-a-board'), TypeError);
    assert.throws(() => judgeBoard(null), TypeError);
  });

  it('浏览器侧 <script> 加载时挂载同名全局引用并完成判胜与平局判定', () => {
    const source = fs.readFileSync(RULES_PATH, 'utf8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'gomoku-rules.js' });

    assert.equal(sandbox.module, undefined, '浏览器侧不应泄漏 CommonJS 的 module 引用');
    assert.equal(typeof sandbox.checkWin, 'function');
    assert.equal(typeof sandbox.isDraw, 'function');
    assert.equal(typeof sandbox.judgeBoard, 'function');
    assert.equal(typeof sandbox.GomokuRules, 'object');

    const api = sandbox.GomokuRules;
    assert.equal(typeof api.checkWin, 'function');
    assert.equal(typeof api.isDraw, 'function');
    assert.equal(typeof api.judgeBoard, 'function');
    assert.equal(api.BOARD_SIZE, BOARD_SIZE);

    const winBoard = placeLine(emptyBoard(), 0, 0, DIRECTIONS.横向, 5, api.BLACK);
    assert.equal(sandbox.checkWin(winBoard, api.BLACK), true);
    // 跨 realm 对象的原型不同，这里逐字段断言判定结果。
    const sandboxWin = sandbox.judgeBoard(winBoard);
    assert.equal(sandboxWin.status, 'win');
    assert.equal(sandboxWin.winner, api.BLACK);

    const drawBoard = fullBoardWithoutFive();
    assert.equal(sandbox.isDraw(drawBoard), true);
    const sandboxDraw = sandbox.judgeBoard(drawBoard);
    assert.equal(sandboxDraw.status, 'draw');
    assert.equal(sandboxDraw.winner, api.EMPTY);
  });
});
