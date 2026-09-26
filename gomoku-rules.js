'use strict';

// 五子棋规则判定：五连判胜与满盘平局判定的唯一实现（CT-001）。
//
// 本文件是五连判胜与满盘平局判定的权威实现；页面、AI 与自动化测试均须复用本文件，
// 不得在 gomoku-ai.js、gomoku.html 等处复制同一套规则。
//
// 导出契约（CommonJS `module.exports`；浏览器 <script> 加载时挂载同名全局引用）：
//   BOARD_SIZE              15    棋盘边长（15 路，共 225 个交叉点）
//   EMPTY / BLACK / WHITE   0/1/2 空交叉点 / 黑子 / 白子
//   checkWin(board, player) -> boolean  判胜函数：player 是否存在五连及以上
//   isDraw(board)           -> boolean  平局判定函数：225 子填满且双方均无五连
//   judgeBoard(board)       -> { status: 'win' | 'draw' | 'ongoing', winner }
//                                       聚合判定；winner 取 BLACK/WHITE，未分胜负为 EMPTY
//
// board 形状：BOARD_SIZE 行 × BOARD_SIZE 列的二维数组，board[row][col] 取值 EMPTY/BLACK/WHITE。
// 判胜规则：同色棋子在横向、纵向、主斜线、副斜线任一方向的连续个数 >= 5 即获胜
// （恰好五连与六连及以上同样判胜）；满盘且双方均无五连判平局；其余判对局未结束。

const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const WIN_LENGTH = 5;

// 四个扫描方向（[行增量, 列增量]）：横向、纵向、主斜线、副斜线。
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

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

// 单色判胜：只统计同色连续段，对方棋子视为断点。
function hasConsecutiveWin(board, player) {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== player) {
        continue;
      }
      for (const [rowStep, colStep] of DIRECTIONS) {
        // 只从连续段起点起算，避免同一段被每个棋子重复统计。
        if (isInside(row - rowStep, col - colStep) && board[row - rowStep][col - colStep] === player) {
          continue;
        }
        let length = 0;
        let currentRow = row;
        let currentCol = col;
        while (isInside(currentRow, currentCol) && board[currentRow][currentCol] === player) {
          length += 1;
          currentRow += rowStep;
          currentCol += colStep;
        }
        if (length >= WIN_LENGTH) {
          return true;
        }
      }
    }
  }
  return false;
}

function findWinner(board) {
  if (hasConsecutiveWin(board, BLACK)) {
    return BLACK;
  }
  if (hasConsecutiveWin(board, WHITE)) {
    return WHITE;
  }
  return EMPTY;
}

function isBoardFull(board) {
  for (const row of board) {
    for (const cell of row) {
      if (cell === EMPTY) {
        return false;
      }
    }
  }
  return true;
}

/** 判胜函数：player 在任一方向存在五连及以上返回 true。 */
function checkWin(board, player) {
  assertPlayer(player);
  assertBoard(board);
  return hasConsecutiveWin(board, player);
}

/** 平局判定函数：225 个交叉点填满且双方均无五连返回 true。 */
function isDraw(board) {
  assertBoard(board);
  return isBoardFull(board) && findWinner(board) === EMPTY;
}

/** 聚合判定：先判胜、再判平局，其余为对局未结束。 */
function judgeBoard(board) {
  assertBoard(board);
  const winner = findWinner(board);
  if (winner !== EMPTY) {
    return { status: 'win', winner };
  }
  if (isBoardFull(board)) {
    return { status: 'draw', winner: EMPTY };
  }
  return { status: 'ongoing', winner: EMPTY };
}

const api = {
  BOARD_SIZE,
  EMPTY,
  BLACK,
  WHITE,
  checkWin,
  isDraw,
  judgeBoard,
};

const hasCommonJS = typeof module === 'object' && module !== null && !!module.exports;
if (hasCommonJS) {
  module.exports = api;
} else {
  const root = typeof globalThis !== 'undefined' ? globalThis : null;
  if (root) {
    root.GomokuRules = api;
    root.checkWin = api.checkWin;
    root.isDraw = api.isDraw;
    root.judgeBoard = api.judgeBoard;
  }
}
