'use strict';

// 五子棋落子决策：先成五、再堵五、否则随机空点的唯一实现（CT-002）。
//
// 本文件是落子决策的唯一实现；页面（gomoku.html）与自动化测试均须复用本文件，
// 不得在页面或其他脚本中复制同一套决策逻辑。判胜一律复用 gomoku-rules.js，
// 本文件不包含任何判胜/平局规则实现。
//
// 依赖：gomoku-rules.js（CT-001）。CommonJS 下 require 相对路径；浏览器 <script> 加载时
// 复用已挂载的 GomokuRules 命名空间（或退化为同名全局 checkWin）。
//
// 导出契约（CommonJS `module.exports`；浏览器 <script> 加载时挂载同名全局引用）：
//   chooseMove(board, player, random?) -> { row, col } | null
//     board    15 行 × 15 列二维数组，board[row][col] 取值 EMPTY/BLACK/WHITE
//     player   落子方，BLACK(1) 或 WHITE(2)
//     random   可选随机源，返回 [0, 1) 数值，默认 Math.random；仅用于无成五也无堵五时的随机选点
//     返回     合法落子交叉点 { row, col }；锁盘（已分胜负）或已无空交叉点时返回 null
//
// 决策优先级：锁盘/满盘返回 null > 自身一步成五 > 封堵对方一步成五 > 随机空交叉点。
// 决策过程只读取棋盘，不修改传入的 board。

// 以 IIFE 包裹，避免与 gomoku-rules.js 等经典 <script> 的顶层 const 声明冲突。
(function attachGomokuAI() {
  const BOARD_SIZE = 15;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;

  function resolveRules() {
    if (typeof module === 'object' && module !== null && !!module.exports) {
      return require('./gomoku-rules.js');
    }
    const root = typeof globalThis !== 'undefined' ? globalThis : null;
    if (!root) {
      throw new Error('gomoku-ai.js 需要运行环境提供 globalThis');
    }
    if (root.GomokuRules && typeof root.GomokuRules.checkWin === 'function') {
      return root.GomokuRules;
    }
    if (typeof root.checkWin === 'function') {
      return { checkWin: root.checkWin, judgeBoard: root.judgeBoard };
    }
    throw new Error('gomoku-ai.js 需要先加载 gomoku-rules.js（GomokuRules 或 checkWin）');
  }

  const rules = resolveRules();

  function isInside(row, col) {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
  }

  function assertBoard(board) {
    if (!Array.isArray(board) || board.length !== BOARD_SIZE) {
      throw new TypeError(`board 必须是 ${BOARD_SIZE} 行二维数组`);
    }
    for (const row of board) {
      if (!Array.isArray(row) || row.length !== BOARD_SIZE) {
        throw new TypeError(`board 每行必须是 ${BOARD_SIZE} 列二维数组`);
      }
      for (const cell of row) {
        if (cell !== EMPTY && cell !== BLACK && cell !== WHITE) {
          throw new TypeError('board 交叉点取值只能是 EMPTY(0)/BLACK(1)/WHITE(2)');
        }
      }
    }
  }

  function assertPlayer(player) {
    if (player !== BLACK && player !== WHITE) {
      throw new TypeError('player 只能是 BLACK(1) 或 WHITE(2)');
    }
  }

  function collectEmptyPoints(board) {
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

  function isGameOver(board) {
    if (typeof rules.judgeBoard === 'function') {
      return rules.judgeBoard(board).status !== 'ongoing';
    }
    return (
      rules.checkWin(board, BLACK)
      || rules.checkWin(board, WHITE)
      || collectEmptyPoints(board).length === 0
    );
  }

  // 在 empties 中寻找一步成五的点；判定交给 gomoku-rules.js 的 checkWin，不复制判胜逻辑。
  function findFivePoint(board, stone, empties) {
    for (const [row, col] of empties) {
      const probe = board.map((line) => line.slice());
      probe[row][col] = stone;
      if (rules.checkWin(probe, stone)) {
        return { row, col };
      }
    }
    return null;
  }

  function pickRandomPoint(empties, random) {
    const raw = Math.floor(random() * empties.length);
    const index = raw < 0 ? 0 : (raw >= empties.length ? empties.length - 1 : raw);
    const [row, col] = empties[index];
    return { row, col };
  }

  /** 落子决策：先成五、再堵五、否则随机空点；锁盘或满盘返回 null，且不修改棋盘。 */
  function chooseMove(board, player, random = Math.random) {
    assertBoard(board);
    assertPlayer(player);
    if (isGameOver(board)) {
      return null;
    }
    const empties = collectEmptyPoints(board);
    if (empties.length === 0) {
      return null;
    }

    const ownFive = findFivePoint(board, player, empties);
    if (ownFive) {
      return ownFive;
    }

    const opponent = player === BLACK ? WHITE : BLACK;
    const opponentFive = findFivePoint(board, opponent, empties);
    if (opponentFive) {
      return opponentFive;
    }

    return pickRandomPoint(empties, random);
  }

  const api = { chooseMove };

  const hasCommonJS = typeof module === 'object' && module !== null && !!module.exports;
  if (hasCommonJS) {
    module.exports = api;
  } else {
    const root = typeof globalThis !== 'undefined' ? globalThis : null;
    if (root) {
      root.GomokuAI = api;
      root.chooseMove = api.chooseMove;
    }
  }
})();
