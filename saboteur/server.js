const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 카드 정의
// ============================================================
// edges: [top, right, bottom, left] - true=열림
// connections: 내부 연결 그룹 배열 (0=top,1=right,2=bottom,3=left)

const PATH_TEMPLATES = [
  // --- 연결된 카드 ---
  { id: 'cross', edges: [1,1,1,1], connections: [[0,1,2,3]], count: 5 },
  { id: 't_up', edges: [1,1,0,1], connections: [[0,1,3]], count: 5 },
  { id: 't_right', edges: [1,1,1,0], connections: [[0,1,2]], count: 5 },
  { id: 'straight_v', edges: [1,0,1,0], connections: [[0,2]], count: 4 },
  { id: 'straight_h', edges: [0,1,0,1], connections: [[1,3]], count: 4 },
  { id: 'curve_tr', edges: [1,1,0,0], connections: [[0,1]], count: 5 },
  { id: 'curve_tl', edges: [1,0,0,1], connections: [[0,3]], count: 5 },
  // --- 막힌 카드 (dead-end) ---
  { id: 'dead_cross', edges: [1,1,1,1], connections: [], deadEnd: true, count: 1 },
  { id: 'dead_t_up', edges: [1,1,0,1], connections: [], deadEnd: true, count: 1 },
  { id: 'dead_t_right', edges: [1,1,1,0], connections: [], deadEnd: true, count: 1 },
  { id: 'dead_straight_v', edges: [1,0,1,0], connections: [], deadEnd: true, count: 1 },
  { id: 'dead_straight_h', edges: [0,1,0,1], connections: [], deadEnd: true, count: 1 },
  { id: 'dead_curve_tr', edges: [1,1,0,0], connections: [], deadEnd: true, count: 1 },
  { id: 'dead_curve_tl', edges: [1,0,0,1], connections: [], deadEnd: true, count: 1 },
  { id: 'dead_single_t', edges: [1,0,0,0], connections: [], deadEnd: true, count: 1 },
  { id: 'dead_single_r', edges: [0,1,0,0], connections: [], deadEnd: true, count: 1 },
];

const ACTION_TEMPLATES = [
  { id: 'break_pickaxe', tool: 'pickaxe', action: 'break', count: 3 },
  { id: 'break_lantern', tool: 'lantern', action: 'break', count: 3 },
  { id: 'break_cart', tool: 'cart', action: 'break', count: 3 },
  { id: 'repair_pickaxe', tool: 'pickaxe', action: 'repair', count: 3 },
  { id: 'repair_lantern', tool: 'lantern', action: 'repair', count: 3 },
  { id: 'repair_cart', tool: 'cart', action: 'repair', count: 3 },
  { id: 'rockfall', action: 'rockfall', count: 3 },
  { id: 'map', action: 'map', count: 6 },
];

function createDeck() {
  const deck = [];
  let uid = 0;
  for (const t of PATH_TEMPLATES) {
    for (let i = 0; i < t.count; i++) {
      deck.push({
        uid: uid++,
        type: 'path',
        id: t.id,
        edges: [...t.edges],
        connections: t.connections.map(g => [...g]),
        deadEnd: !!t.deadEnd,
      });
    }
  }
  for (const t of ACTION_TEMPLATES) {
    for (let i = 0; i < t.count; i++) {
      deck.push({
        uid: uid++,
        type: 'action',
        id: t.id,
        action: t.action,
        tool: t.tool || null,
      });
    }
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 카드 180도 회전
function rotateCard(card) {
  const newEdges = [card.edges[2], card.edges[3], card.edges[0], card.edges[1]];
  const newConns = card.connections.map(g => g.map(e => (e + 2) % 4));
  return { ...card, edges: newEdges, connections: newConns, rotated: !card.rotated };
}

// ============================================================
// 보드 & 경로 검증
// ============================================================
const START_POS = { row: 3, col: 0 };
const GOAL_POSITIONS = [
  { row: 1, col: 8 },
  { row: 3, col: 8 },
  { row: 5, col: 8 },
];

const DIR_OFFSETS = [
  { row: -1, col: 0 },  // 0: top
  { row: 0, col: 1 },   // 1: right
  { row: 1, col: 0 },   // 2: bottom
  { row: 0, col: -1 },  // 3: left
];
const OPPOSITE = [2, 3, 0, 1];

function posKey(row, col) { return `${row},${col}`; }

function createStartCard() {
  return {
    uid: -1, type: 'path', id: 'start',
    edges: [1, 1, 1, 1],
    connections: [[0, 1, 2, 3]],
    deadEnd: false, special: 'start',
  };
}

function createGoalCard(hasGold) {
  return {
    uid: -2, type: 'path', id: hasGold ? 'gold' : 'stone',
    edges: [1, 1, 1, 1],
    connections: [[0, 1, 2, 3]],
    deadEnd: false, special: 'goal',
    hasGold, revealed: false,
  };
}

function initBoard() {
  const board = {};
  board[posKey(START_POS.row, START_POS.col)] = createStartCard();
  const goalOrder = shuffle([0, 1, 2]);
  const goldIndex = goalOrder[0];
  GOAL_POSITIONS.forEach((pos, i) => {
    board[posKey(pos.row, pos.col)] = createGoalCard(i === goldIndex);
  });
  return board;
}

// 카드 배치 가능 여부 확인
function canPlaceCard(board, card, row, col) {
  const key = posKey(row, col);
  if (board[key]) return false; // 이미 카드 있음

  let hasAdjacentCard = false;
  for (let d = 0; d < 4; d++) {
    const nr = row + DIR_OFFSETS[d].row;
    const nc = col + DIR_OFFSETS[d].col;
    const neighborKey = posKey(nr, nc);
    const neighbor = board[neighborKey];
    if (!neighbor) continue;

    // 목표 카드(미공개)는 인접 검증에서 무시 (연결 시도는 별도 처리)
    if (neighbor.special === 'goal' && !neighbor.revealed) {
      // 목표 카드와 인접한 것은 허용하지만 변 매칭은 무시
      hasAdjacentCard = true;
      continue;
    }

    hasAdjacentCard = true;
    const myEdge = card.edges[d];
    const theirEdge = neighbor.edges[OPPOSITE[d]];
    if (myEdge !== theirEdge) return false; // 변 불일치
  }
  return hasAdjacentCard;
}

// BFS: 시작 카드에서 연결된 경로를 통해 도달 가능한 모든 위치
function getReachablePositions(board) {
  const startKey = posKey(START_POS.row, START_POS.col);
  const visited = new Set();
  const queue = [startKey];
  visited.add(startKey);

  while (queue.length > 0) {
    const key = queue.shift();
    const [r, c] = key.split(',').map(Number);
    const card = board[key];
    if (!card) continue;

    // 목표 카드(미공개)는 통과하지 않음
    if (card.special === 'goal' && !card.revealed) continue;

    for (let d = 0; d < 4; d++) {
      if (!card.edges[d]) continue;

      // 이 변이 내부적으로 연결되어 있는지 확인
      const isConnected = card.connections.some(group => group.includes(d));
      if (!isConnected) continue;

      // 시작 카드의 연결 확인 - 시작점에서 이 방향으로 나갈 수 있는지
      // 연결 그룹에 포함되어 있으면 통과 가능
      const nr = r + DIR_OFFSETS[d].row;
      const nc = c + DIR_OFFSETS[d].col;
      const nKey = posKey(nr, nc);
      if (visited.has(nKey)) continue;

      const neighbor = board[nKey];
      if (!neighbor) continue;

      const oppDir = OPPOSITE[d];
      if (!neighbor.edges[oppDir]) continue;

      // 이웃 카드도 해당 변이 내부 연결되어 있어야 함
      const neighborConnected = neighbor.connections.some(group => group.includes(oppDir));
      if (!neighborConnected) continue;

      visited.add(nKey);
      queue.push(nKey);
    }
  }
  return visited;
}

// 목표 카드 도달 확인
function checkGoalReached(board) {
  const reachable = getReachablePositions(board);
  for (const pos of GOAL_POSITIONS) {
    const key = posKey(pos.row, pos.col);
    const goal = board[key];
    if (!goal || goal.revealed) continue;

    // 목표 카드에 인접한 위치가 도달 가능하고, 변이 맞는지 확인
    for (let d = 0; d < 4; d++) {
      const ar = pos.row + DIR_OFFSETS[d].row;
      const ac = pos.col + DIR_OFFSETS[d].col;
      const aKey = posKey(ar, ac);
      if (!reachable.has(aKey)) continue;

      const adjCard = board[aKey];
      if (!adjCard) continue;
      const oppDir = OPPOSITE[d];
      if (adjCard.edges[oppDir] && goal.edges[d]) {
        // 인접 카드가 연결 가능하고 도달 가능 → 목표 도달
        const adjConnected = adjCard.connections.some(group => group.includes(oppDir));
        if (adjConnected) {
          return { reached: true, position: pos, key, goal };
        }
      }
    }
  }
  return { reached: false };
}

// ============================================================
// 역할 배분
// ============================================================
function getSaboteurCount(playerCount) {
  if (playerCount <= 4) return 1;
  if (playerCount <= 6) return 2;
  if (playerCount <= 9) return 3;
  return 4;
}

function getHandSize(playerCount) {
  if (playerCount <= 5) return 6;
  if (playerCount <= 7) return 5;
  return 4;
}

// ============================================================
// 방 관리
// ============================================================
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(hostSocket, hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    players: [{ id: hostSocket.id, name: hostName, isHost: true }],
    state: 'lobby', // lobby | playing | finished
    game: null,
  };
  rooms.set(code, room);
  return room;
}

function getPublicBoard(board) {
  const pub = {};
  for (const [key, card] of Object.entries(board)) {
    if (card.special === 'goal' && !card.revealed) {
      pub[key] = { special: 'goal', revealed: false, edges: [1,1,1,1] };
    } else {
      pub[key] = { ...card };
    }
  }
  return pub;
}

function getPublicPlayers(game) {
  return game.players.map(p => ({
    id: p.id,
    name: p.name,
    tools: { ...p.tools },
    handCount: p.hand.length,
  }));
}

// ============================================================
// Socket.IO
// ============================================================
io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('create-room', (name) => {
    if (!name || name.length > 10) return;
    const room = createRoom(socket, name.trim());
    currentRoom = room.code;
    socket.join(room.code);
    socket.emit('room-created', { code: room.code, players: room.players.map(p => ({ name: p.name, isHost: p.isHost })) });
  });

  socket.on('join-room', ({ code, name }) => {
    if (!code || !name) return;
    code = code.toUpperCase().trim();
    name = name.trim();
    const room = rooms.get(code);
    if (!room) return socket.emit('error-msg', '방을 찾을 수 없습니다.');
    if (room.state !== 'lobby') return socket.emit('error-msg', '이미 게임이 진행 중입니다.');
    if (room.players.length >= 10) return socket.emit('error-msg', '방이 가득 찼습니다.');
    if (room.players.find(p => p.name === name)) return socket.emit('error-msg', '이미 사용 중인 이름입니다.');

    room.players.push({ id: socket.id, name, isHost: false });
    currentRoom = code;
    socket.join(code);

    const playerList = room.players.map(p => ({ name: p.name, isHost: p.isHost }));
    socket.emit('room-joined', { code, players: playerList });
    socket.to(code).emit('player-list-updated', playerList);
  });

  socket.on('start-game', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;
    if (room.players.length < 3) return socket.emit('error-msg', '최소 3명이 필요합니다.');

    // 게임 초기화
    const playerCount = room.players.length;
    const sabCount = getSaboteurCount(playerCount);
    const handSize = getHandSize(playerCount);

    // 역할 배분 - 인덱스 셔플 방식으로 완전 랜덤 보장
    const roleIndices = Array.from({ length: playerCount }, (_, i) => i);
    shuffle(roleIndices);
    const saboteurSet = new Set(roleIndices.slice(0, sabCount));

    // 덱 생성 및 셔플
    const deck = shuffle(createDeck());

    // 보드 초기화
    const board = initBoard();

    // 게임 상태
    const game = {
      board,
      deck,
      discardPile: [],
      players: room.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        role: saboteurSet.has(i) ? 'saboteur' : 'miner',
        hand: deck.splice(0, handSize),
        tools: { pickaxe: true, lantern: true, cart: true },
      })),
      currentTurnIndex: 0,
      state: 'playing',
    };
    room.game = game;
    room.state = 'playing';

    // 각 플레이어에게 개별 정보 전송
    for (const gp of game.players) {
      io.to(gp.id).emit('game-started', {
        role: gp.role,
        hand: gp.hand,
        board: getPublicBoard(board),
        players: getPublicPlayers(game),
        currentTurnIndex: 0,
        myIndex: game.players.findIndex(p => p.id === gp.id),
      });
    }
  });

  // 길 카드 놓기
  socket.on('play-path-card', ({ cardIndex, row, col, rotated }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.game) return;
    const game = room.game;

    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex < 0 || playerIndex !== game.currentTurnIndex) return;

    const player = game.players[playerIndex];
    if (cardIndex < 0 || cardIndex >= player.hand.length) return;

    // 도구 확인
    if (!player.tools.pickaxe || !player.tools.lantern || !player.tools.cart) {
      return socket.emit('error-msg', '도구가 고장나서 길 카드를 놓을 수 없습니다.');
    }

    let card = { ...player.hand[cardIndex] };
    if (card.type !== 'path') return socket.emit('error-msg', '길 카드가 아닙니다.');

    if (rotated) card = rotateCard(card);

    if (!canPlaceCard(game.board, card, row, col)) {
      return socket.emit('error-msg', '이 위치에 놓을 수 없습니다.');
    }

    // 카드 배치
    game.board[posKey(row, col)] = card;
    player.hand.splice(cardIndex, 1);

    // 카드 드로우
    if (game.deck.length > 0) {
      player.hand.push(game.deck.pop());
    }

    // 목표 도달 확인
    const goalCheck = checkGoalReached(game.board);
    if (goalCheck.reached) {
      const goal = game.board[goalCheck.key];
      goal.revealed = true;

      if (goal.hasGold) {
        // 금광꾼 승리!
        game.state = 'finished';
        room.state = 'finished';
        io.to(currentRoom).emit('board-updated', getPublicBoard(game.board));
        io.to(currentRoom).emit('goal-revealed', {
          position: goalCheck.position,
          hasGold: true,
        });
        // 역할 공개 및 결과
        const roleReveal = game.players.map(p => ({ name: p.name, role: p.role }));
        io.to(currentRoom).emit('game-over', { winner: 'miner', roles: roleReveal });
        // 개별 손패 업데이트
        for (const gp of game.players) {
          io.to(gp.id).emit('hand-updated', gp.hand);
        }
        return;
      } else {
        // 돌 카드 → 계속 진행
        io.to(currentRoom).emit('goal-revealed', {
          position: goalCheck.position,
          hasGold: false,
        });
      }
    }

    // 보드 및 플레이어 정보 브로드캐스트
    io.to(currentRoom).emit('board-updated', getPublicBoard(game.board));
    io.to(currentRoom).emit('players-updated', getPublicPlayers(game));
    for (const gp of game.players) {
      io.to(gp.id).emit('hand-updated', gp.hand);
    }

    // 다음 턴
    advanceTurn(game, room);
  });

  // 액션 카드 사용
  socket.on('play-action-card', ({ cardIndex, targetPlayerId, targetRow, targetCol, targetGoalIndex }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.game) return;
    const game = room.game;

    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex < 0 || playerIndex !== game.currentTurnIndex) return;

    const player = game.players[playerIndex];
    if (cardIndex < 0 || cardIndex >= player.hand.length) return;

    const card = player.hand[cardIndex];
    if (card.type !== 'action') return;

    // 액션 처리
    if (card.action === 'break') {
      if (!targetPlayerId) return socket.emit('error-msg', '대상 플레이어를 선택하세요.');
      const target = game.players.find(p => p.id === targetPlayerId);
      if (!target) return;
      if (target.id === player.id) return socket.emit('error-msg', '자신에게 사용할 수 없습니다.');
      if (!target.tools[card.tool]) return socket.emit('error-msg', '이미 고장난 도구입니다.');
      target.tools[card.tool] = false;
      io.to(currentRoom).emit('action-played', {
        player: player.name,
        action: 'break',
        tool: card.tool,
        target: target.name,
      });
    } else if (card.action === 'repair') {
      if (!targetPlayerId) return socket.emit('error-msg', '대상 플레이어를 선택하세요.');
      const target = game.players.find(p => p.id === targetPlayerId);
      if (!target) return;
      if (target.tools[card.tool]) return socket.emit('error-msg', '고장나지 않은 도구입니다.');
      target.tools[card.tool] = true;
      io.to(currentRoom).emit('action-played', {
        player: player.name,
        action: 'repair',
        tool: card.tool,
        target: target.name,
      });
    } else if (card.action === 'rockfall') {
      if (targetRow === undefined || targetCol === undefined) return socket.emit('error-msg', '제거할 길 카드를 선택하세요.');
      const key = posKey(targetRow, targetCol);
      const targetCard = game.board[key];
      if (!targetCard) return socket.emit('error-msg', '카드가 없는 위치입니다.');
      if (targetCard.special) return socket.emit('error-msg', '시작/목표 카드는 제거할 수 없습니다.');
      delete game.board[key];
      io.to(currentRoom).emit('action-played', {
        player: player.name,
        action: 'rockfall',
        position: { row: targetRow, col: targetCol },
      });
    } else if (card.action === 'map') {
      if (targetGoalIndex === undefined || targetGoalIndex < 0 || targetGoalIndex > 2) {
        return socket.emit('error-msg', '확인할 목표 카드를 선택하세요.');
      }
      const goalPos = GOAL_POSITIONS[targetGoalIndex];
      const goalCard = game.board[posKey(goalPos.row, goalPos.col)];
      if (!goalCard) return;
      // 사용한 플레이어에게만 결과 전송
      socket.emit('map-result', { goalIndex: targetGoalIndex, hasGold: goalCard.hasGold });
      io.to(currentRoom).emit('action-played', {
        player: player.name,
        action: 'map',
        goalIndex: targetGoalIndex,
      });
    }

    player.hand.splice(cardIndex, 1);
    if (game.deck.length > 0) {
      player.hand.push(game.deck.pop());
    }

    io.to(currentRoom).emit('board-updated', getPublicBoard(game.board));
    io.to(currentRoom).emit('players-updated', getPublicPlayers(game));
    for (const gp of game.players) {
      io.to(gp.id).emit('hand-updated', gp.hand);
    }

    advanceTurn(game, room);
  });

  // 카드 버리기
  socket.on('discard-card', ({ cardIndex }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.game) return;
    const game = room.game;

    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex < 0 || playerIndex !== game.currentTurnIndex) return;

    const player = game.players[playerIndex];
    if (cardIndex < 0 || cardIndex >= player.hand.length) return;

    game.discardPile.push(player.hand.splice(cardIndex, 1)[0]);

    if (game.deck.length > 0) {
      player.hand.push(game.deck.pop());
    }

    io.to(currentRoom).emit('action-played', {
      player: player.name,
      action: 'discard',
    });
    io.to(currentRoom).emit('players-updated', getPublicPlayers(game));
    for (const gp of game.players) {
      io.to(gp.id).emit('hand-updated', gp.hand);
    }

    advanceTurn(game, room);
  });

  function advanceTurn(game, room) {
    // 모든 플레이어 손패가 비었는지 확인
    const allEmpty = game.players.every(p => p.hand.length === 0);
    if (allEmpty && game.deck.length === 0) {
      // 사보타주 승리
      game.state = 'finished';
      room.state = 'finished';
      const roleReveal = game.players.map(p => ({ name: p.name, role: p.role }));
      io.to(room.code).emit('game-over', { winner: 'saboteur', roles: roleReveal });
      return;
    }

    // 다음 플레이어 (손패가 있는 사람)
    let next = (game.currentTurnIndex + 1) % game.players.length;
    let attempts = 0;
    while (game.players[next].hand.length === 0 && attempts < game.players.length) {
      next = (next + 1) % game.players.length;
      attempts++;
    }
    if (attempts >= game.players.length) {
      game.state = 'finished';
      room.state = 'finished';
      const roleReveal = game.players.map(p => ({ name: p.name, role: p.role }));
      io.to(room.code).emit('game-over', { winner: 'saboteur', roles: roleReveal });
      return;
    }

    game.currentTurnIndex = next;
    io.to(room.code).emit('turn-changed', { currentTurnIndex: next });
  }

  // 연결 해제
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx < 0) return;
    const wasHost = room.players[idx].isHost;
    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      rooms.delete(currentRoom);
      return;
    }

    if (wasHost) {
      room.players[0].isHost = true;
    }

    if (room.state === 'lobby') {
      const playerList = room.players.map(p => ({ name: p.name, isHost: p.isHost }));
      io.to(currentRoom).emit('player-list-updated', playerList);
    } else if (room.state === 'playing' && room.game) {
      // 게임 중 퇴장 → 알림
      io.to(currentRoom).emit('player-disconnected', {
        name: room.game.players[idx]?.name || '알 수 없음',
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`사보타주 서버 실행 중: http://localhost:${PORT}`);
});
