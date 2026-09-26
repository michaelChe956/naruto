'use strict';

// 验收测试：gomoku-ai.js —— 先成五、再堵五、否则随机的唯一落子决策实现。
//
// 覆盖范围：
//   TASK-004 / CT-002 —— CommonJS module.exports 与浏览器 <script> 双环境导出契约，
//                        以及“复用 gomoku-rules.js 的 checkWin 判胜、不复制判胜逻辑”的唯一实现约束；
//   AC-006 —— AI 存在可立即连成五子的空交叉点时选择该点落子；
//   AC-007 —— AI 无法立即连五且对方存在一步成五的空交叉点时封堵该点（含“自身成五优先”对照）；
//   AC-008 —— 既无成五点也无堵五点时空交叉点随机落子；
//   AC-009 —— 棋盘已锁盘（已分胜负）或已无空交叉点时返回无合法落子且棋盘不变。
//
// 依赖仅使用 Node 内置模块（node:test、node:assert、node:fs、node:path、node:vm）。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const AI_PATH = path.join(__dirname, '..', 'gomoku-ai.js');
const RULES_PATH = path.join(__dirname, '..', 'gomoku-rules.js');

const { BOARD_SIZE, EMPTY, BLACK, WHITE, checkWin } = require(RULES_PATH);

// 直接 require 会在缺少实现时抛出，为让 TDD 红灯逐条可读，这里做安全加载。
let chooseMove;
try {
  ({ chooseMove } = require(AI_PATH));
} catch (error) {
  chooseMove = undefined;
}

const DIRECTIONS = {
  横向: [0, 1],
  纵向: [1, 0],
  主斜线: [1, 1],
  副斜线: [1, -1],
};

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

function snapshot(board) {
  return board.map((row) => row.slice());
}

function emptyPoints(board) {
  const points = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] === EMPTY) {
        points.push([row, col]);
      }
    }
  }
  return points;
}

function assertOnBoard(candidate) {
  assert.ok(candidate && typeof candidate === 'object', '应返回 { row, col } 落子对象');
  assert.equal(typeof candidate.row, 'number', 'row 应为数字');
  assert.equal(typeof candidate.col, 'number', 'col 应为数字');
  assert.ok(
    Number.isInteger(candidate.row) && candidate.row >= 0 && candidate.row < BOARD_SIZE,
    `row 应落在 0..${BOARD_SIZE - 1}`,
  );
  assert.ok(
    Number.isInteger(candidate.col) && candidate.col >= 0 && candidate.col < BOARD_SIZE,
    `col 应落在 0..${BOARD_SIZE - 1}`,
  );
}

// 固定着色 (2 * row + col) % 4 < 2 ? BLACK : WHITE：任一方向同色连续段最长 2，构造“225 子填满且无五连”。
function fullBoardWithoutFive() {
  const board = emptyBoard();
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      board[row][col] = (2 * row + col) % 4 < 2 ? BLACK : WHITE;
    }
  }
  return board;
}

describe('TASK-004 / CT-002 模块契约与唯一实现', () => {
  it('CommonJS 导出单一决策函数 chooseMove(board, player, random)', () => {
    assert.equal(typeof chooseMove, 'function', 'gomoku-ai.js 应通过 module.exports 导出 chooseMove');
  });

  it('浏览器 <script> 加载后可用的 chooseMove 全局引用与 CommonJS 为同一契约', () => {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(RULES_PATH, 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(AI_PATH, 'utf8'), sandbox);

    assert.equal(typeof sandbox.chooseMove, 'function', '浏览器环境应挂载 chooseMove 全局引用');
    assert.equal(typeof sandbox.GomokuAI?.chooseMove, 'function', '浏览器环境应挂载 GomokuAI 命名空间');

    const board = emptyBoard();
    const move = sandbox.chooseMove(board, BLACK, () => 0);
    assertOnBoard(move);
    assert.deepEqual([move.row, move.col], [0, 0], '注入随机源后应可确定性地选择首个空交叉点');
  });

  it('落子决策复用 gomoku-rules.js 的 checkWin 判定成五点，而非复制判胜逻辑', () => {
    const seen = [];
    const sandbox = {
      checkWin: () => {
        seen.push(1);
        return false;
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(AI_PATH, 'utf8'), sandbox);

    // 黑方在 row 5 的 col 9..12 已有四连，成五点为 (5,8)/(5,13)。
    const board = placeLine(emptyBoard(), 5, 9, DIRECTIONS.横向, 4, BLACK);
    const move = sandbox.chooseMove(board, BLACK, () => 0);

    assert.ok(seen.length > 0, '应调用注入的 checkWin 判定成五点');
    assert.deepEqual([move.row, move.col], [0, 0], '判胜结果来自注入的 checkWin 时不得自行识别成五点');
  });
});

describe('AC-006 一步成五优先落子', () => {
  for (const [name, direction, startRow, startCol] of [
    ['横向', DIRECTIONS.横向, 5, 5],
    ['纵向', DIRECTIONS.纵向, 3, 7],
    ['主斜线', DIRECTIONS.主斜线, 2, 2],
    ['副斜线', DIRECTIONS.副斜线, 10, 12],
  ]) {
    it(`${name}四连时选择可立即成五的空交叉点`, () => {
      const board = placeLine(emptyBoard(), startRow, startCol, direction, 4, BLACK);
      const before = snapshot(board);

      const move = chooseMove(board, BLACK);

      assertOnBoard(move);
      const probe = snapshot(board);
      probe[move.row][move.col] = BLACK;
      assert.equal(checkWin(probe, BLACK), true, '所选交叉点落子后应连成五子');
      assert.deepEqual(board, before, '决策过程不得修改棋盘');
    });
  }

  it('两端皆可成五时返回其中一个成五点', () => {
    const board = placeLine(emptyBoard(), 7, 4, DIRECTIONS.横向, 4, WHITE);
    const before = snapshot(board);

    const move = chooseMove(board, WHITE);

    assertOnBoard(move);
    const probe = snapshot(board);
    probe[move.row][move.col] = WHITE;
    assert.equal(checkWin(probe, WHITE), true, '所选交叉点落子后应连成五子');
    assert.deepEqual(board, before, '决策过程不得修改棋盘');
  });
});

describe('AC-007 无成五点时封堵对方成五点', () => {
  it('对方存在一步成五的空交叉点时选择该点封堵', () => {
    const board = emptyBoard();
    placeLine(board, 7, 3, DIRECTIONS.横向, 4, BLACK); // 黑方成五点 (7,2)/(7,7)
    placeLine(board, 11, 6, DIRECTIONS.横向, 2, WHITE); // 白方无成五点
    const before = snapshot(board);

    const move = chooseMove(board, WHITE);

    assertOnBoard(move);
    assert.equal(board[move.row][move.col], EMPTY, '应落在空交叉点');
    assert.ok(
      (move.row === 7 && (move.col === 2 || move.col === 7)),
      `应封堵黑方成五点，实际落在 (${move.row},${move.col})`,
    );
    assert.deepEqual(board, before, '决策过程不得修改棋盘');
  });

  it('自身可成五且对方亦有一形成五时优先自身成五', () => {
    const board = emptyBoard();
    placeLine(board, 7, 3, DIRECTIONS.横向, 4, BLACK); // 黑方成五点 (7,2)/(7,7)
    placeLine(board, 9, 4, DIRECTIONS.横向, 4, WHITE); // 白方成五点 (9,3)/(9,8)

    const move = chooseMove(board, WHITE);

    assertOnBoard(move);
    assert.ok(
      move.row === 9 && (move.col === 3 || move.col === 8),
      `应优先自身成五，实际落在 (${move.row},${move.col})`,
    );
  });
});

describe('AC-008 既无成五也无堵五时空交叉点随机落子', () => {
  it('在空交叉点落子且棋盘保持不变', () => {
    const board = emptyBoard();
    placeLine(board, 4, 4, DIRECTIONS.横向, 2, BLACK);
    placeLine(board, 9, 9, DIRECTIONS.纵向, 2, WHITE);
    const before = snapshot(board);
    const candidates = new Set(emptyPoints(board).map(([row, col]) => `${row},${col}`));

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const move = chooseMove(board, BLACK);
      assertOnBoard(move);
      assert.ok(candidates.has(`${move.row},${move.col}`), '应落在已有棋盘的某个空交叉点');
    }
    assert.deepEqual(board, before, '决策过程不得修改棋盘');
  });

  it('按注入的随机源选取空交叉点', () => {
    const board = placeLine(emptyBoard(), 0, 3, DIRECTIONS.横向, 1, WHITE);
    const candidates = emptyPoints(board);

    const first = chooseMove(board, BLACK, () => 0);
    const last = chooseMove(board, BLACK, () => 0.999999);

    assert.deepEqual([first.row, first.col], candidates[0], '随机值 0 应取首个空交叉点');
    assert.deepEqual([last.row, last.col], candidates[candidates.length - 1], '随机值接近 1 应取末尾空交叉点');
  });
});

describe('AC-009 锁盘或满盘时无合法落子', () => {
  it('棋盘已分胜负（锁盘）时返回 null 且棋盘不变', () => {
    const board = placeLine(emptyBoard(), 0, 0, DIRECTIONS.横向, 5, BLACK);
    board[8][8] = WHITE;
    const before = snapshot(board);

    assert.equal(chooseMove(board, WHITE), null, '锁盘后应返回无合法落子');
    assert.equal(chooseMove(board, BLACK), null, '锁盘后任何一方都不应再落子');
    assert.deepEqual(board, before, '决策过程不得修改棋盘');
  });

  it('盘面无空交叉点（满盘平局）时返回 null 且棋盘不变', () => {
    const board = fullBoardWithoutFive();
    const before = snapshot(board);

    assert.deepEqual(emptyPoints(board), [], '前置条件：盘面应无空交叉点');
    assert.equal(chooseMove(board, BLACK), null, '满盘时应返回无合法落子');
    assert.equal(chooseMove(board, WHITE), null, '满盘时应返回无合法落子');
    assert.deepEqual(board, before, '决策过程不得修改棋盘');
  });
});

describe('入参校验', () => {
  it('非法 player 或非法 board 抛出 TypeError', () => {
    const board = emptyBoard();
    assert.throws(() => chooseMove(board, 0), TypeError, 'EMPTY 不是合法落子方');
    assert.throws(() => chooseMove(board, 3), TypeError, '越界取值不是合法落子方');
    assert.throws(() => chooseMove([[EMPTY]], BLACK), TypeError, '非 15 路棋盘应被拒绝');
  });
});
