// ============================================================
// 사보타주 클라이언트
// ============================================================
const socket = io();

// ===== 상태 =====
let myIndex = -1;
let myRole = '';
let myHand = [];
let board = {};
let players = [];
let currentTurnIndex = 0;
let selectedCardIndex = -1;
let isRotated = false;
let roomCode = '';

// ===== 보드 렌더링 설정 =====
const CELL = 68;
const PAD = 2;
const BOARD_ROWS = 7;
const BOARD_COLS = 11;
const PATH_W = 16;

// 보드 좌표 → 화면 좌표
function cellX(col) { return col * CELL + PAD; }
function cellY(row) { return row * CELL + PAD; }

// ===== DOM =====
const $ = id => document.getElementById(id);

const lobbyScreen = $('lobby-screen');
const gameScreen = $('game-screen');
const nicknameInput = $('nickname');
const roomCodeInput = $('room-code-input');
const btnCreate = $('btn-create');
const btnJoin = $('btn-join');
const btnStartGame = $('btn-start-game');
const lobbyMenu = $('lobby-menu');
const waitingRoom = $('waiting-room');
const roomCodeLabel = $('room-code-label');
const playerListLobby = $('player-list-lobby');
const playerCountLabel = $('player-count-label');
const roleBadge = $('role-badge');
const turnInfoEl = $('turn-info');
const deckCountEl = $('deck-count');
const playersPanel = $('players-panel');
const boardCanvas = $('board-canvas');
const ctx = boardCanvas.getContext('2d');
const handCardsEl = $('hand-cards');
const btnRotate = $('btn-rotate');
const btnDiscard = $('btn-discard');
const gameLog = $('game-log');
const modalOverlay = $('modal-overlay');
const modalTitle = $('modal-title');
const modalContent = $('modal-content');
const modalCancel = $('modal-cancel');
const gameoverOverlay = $('gameover-overlay');
const toast = $('toast');

// ===== 유틸 =====
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function addLog(msg) {
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.textContent = msg;
  gameLog.appendChild(el);
  setTimeout(() => el.remove(), 5000);
  while (gameLog.children.length > 5) gameLog.firstChild.remove();
}

function showScreen(screen) {
  lobbyScreen.classList.remove('active');
  gameScreen.classList.remove('active');
  screen.classList.add('active');
}

// ===== 로비 =====
btnCreate.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  if (!name) return showToast('닉네임을 입력하세요');
  socket.emit('create-room', name);
});

btnJoin.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) return showToast('닉네임을 입력하세요');
  if (!code || code.length !== 4) return showToast('방 코드 4자리를 입력하세요');
  socket.emit('join-room', { code, name });
});

btnStartGame.addEventListener('click', () => {
  socket.emit('start-game');
});

socket.on('room-created', ({ code, players: pl }) => {
  roomCode = code;
  lobbyMenu.style.display = 'none';
  waitingRoom.style.display = '';
  roomCodeLabel.textContent = code;
  btnStartGame.style.display = '';
  updateLobbyPlayers(pl);
});

socket.on('room-joined', ({ code, players: pl }) => {
  roomCode = code;
  lobbyMenu.style.display = 'none';
  waitingRoom.style.display = '';
  roomCodeLabel.textContent = code;
  updateLobbyPlayers(pl);
});

socket.on('player-list-updated', (pl) => {
  updateLobbyPlayers(pl);
});

function updateLobbyPlayers(pl) {
  playerListLobby.innerHTML = pl.map(p => `
    <li>${p.name} ${p.isHost ? '<span class="host-badge">방장</span>' : ''}</li>
  `).join('');
  playerCountLabel.textContent = `${pl.length}명 / 10명`;
  if (pl.length >= 3) btnStartGame.disabled = false;
}

// ===== 게임 시작 =====
socket.on('game-started', (data) => {
  myRole = data.role;
  myHand = data.hand;
  board = data.board;
  players = data.players;
  currentTurnIndex = data.currentTurnIndex;
  myIndex = data.myIndex;
  selectedCardIndex = -1;
  isRotated = false;

  showScreen(gameScreen);
  setupBoard();
  renderAll();
});

// ===== 보드 캔버스 설정 =====
function setupBoard() {
  boardCanvas.width = BOARD_COLS * CELL + PAD * 2;
  boardCanvas.height = BOARD_ROWS * CELL + PAD * 2;
}

// ===== 카드 그리기 =====
const COLOR_CARD_BG = '#8B7355';
const COLOR_CARD_DEAD = '#6B5345';
const COLOR_PATH = '#4a3728';
const COLOR_PATH_DEAD = '#5a2020';
const COLOR_START = '#2d8a4e';
const COLOR_GOAL_BACK = '#555';
const COLOR_GOLD = '#e2b04a';
const COLOR_STONE = '#888';
const COLOR_EMPTY = '#1a2030';
const COLOR_VALID = 'rgba(226,176,74,0.25)';
const COLOR_GRID = '#1e2a3a';

function drawCardOnCtx(c, card, x, y, size, faceDown) {
  const s = size;
  const half = s / 2;
  const pw = PATH_W * (s / CELL);

  // 배경
  c.fillStyle = COLOR_EMPTY;
  c.fillRect(x, y, s, s);

  if (!card) return;

  if (faceDown) {
    c.fillStyle = COLOR_GOAL_BACK;
    c.fillRect(x + 2, y + 2, s - 4, s - 4);
    c.fillStyle = '#777';
    c.font = `bold ${s * 0.4}px sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', x + half, y + half);
    return;
  }

  // 카드 바탕
  if (card.special === 'start') {
    c.fillStyle = COLOR_START;
  } else if (card.special === 'goal' && card.revealed) {
    c.fillStyle = card.hasGold ? COLOR_GOLD : COLOR_STONE;
  } else {
    c.fillStyle = card.deadEnd ? COLOR_CARD_DEAD : COLOR_CARD_BG;
  }
  c.fillRect(x + 1, y + 1, s - 2, s - 2);

  // 경로 그리기
  const pathColor = card.deadEnd ? COLOR_PATH_DEAD : COLOR_PATH;
  c.fillStyle = pathColor;

  const edgeMids = [
    { ex: x + half, ey: y },           // 0: top
    { ex: x + s, ey: y + half },       // 1: right
    { ex: x + half, ey: y + s },       // 2: bottom
    { ex: x, ey: y + half },           // 3: left
  ];

  const cx = x + half;
  const cy = y + half;

  const edges = card.edges || [0,0,0,0];

  for (let d = 0; d < 4; d++) {
    if (!edges[d]) continue;
    const em = edgeMids[d];
    if (d === 0 || d === 2) {
      c.fillRect(cx - pw / 2, Math.min(em.ey, cy), pw, Math.abs(em.ey - cy));
    } else {
      c.fillRect(Math.min(em.ex, cx), cy - pw / 2, Math.abs(em.ex - cx), pw);
    }
  }

  // 중앙 사각형 (연결점)
  const hasAnyEdge = edges.some(e => e);
  if (hasAnyEdge) {
    c.fillRect(cx - pw / 2, cy - pw / 2, pw, pw);
  }

  // 데드엔드 표시
  if (card.deadEnd && hasAnyEdge) {
    c.fillStyle = '#ff4444';
    c.beginPath();
    c.arc(cx, cy, pw * 0.4, 0, Math.PI * 2);
    c.fill();
  }

  // 특수 카드 아이콘
  if (card.special === 'start') {
    c.fillStyle = '#fff';
    c.font = `bold ${s * 0.3}px sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('S', cx, cy);
  } else if (card.special === 'goal' && card.revealed) {
    c.fillStyle = card.hasGold ? '#1a1a2e' : '#fff';
    c.font = `bold ${s * 0.35}px sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(card.hasGold ? '💰' : '🪨', cx, cy);
  }
}

// ===== 보드 렌더링 =====
function renderBoard() {
  ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

  // 그리드 배경
  ctx.fillStyle = '#0d1520';
  ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

  // 그리드 선
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  for (let r = 0; r <= BOARD_ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(PAD, r * CELL + PAD);
    ctx.lineTo(BOARD_COLS * CELL + PAD, r * CELL + PAD);
    ctx.stroke();
  }
  for (let c = 0; c <= BOARD_COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL + PAD, PAD);
    ctx.lineTo(c * CELL + PAD, BOARD_ROWS * CELL + PAD);
    ctx.stroke();
  }

  // 유효 배치 위치 하이라이트
  const validPositions = getValidPositions();
  for (const key of validPositions) {
    const [r, c] = key.split(',').map(Number);
    ctx.fillStyle = COLOR_VALID;
    ctx.fillRect(cellX(c), cellY(r), CELL, CELL);
  }

  // 카드 그리기
  for (const [key, card] of Object.entries(board)) {
    const [r, c] = key.split(',').map(Number);
    const faceDown = card.special === 'goal' && !card.revealed;
    drawCardOnCtx(ctx, card, cellX(c), cellY(r), CELL, faceDown);
  }
}

function getValidPositions() {
  if (selectedCardIndex < 0) return [];
  const card = myHand[selectedCardIndex];
  if (!card || card.type !== 'path') return [];
  if (currentTurnIndex !== myIndex) return [];

  const me = players[myIndex];
  if (me && (!me.tools.pickaxe || !me.tools.lantern || !me.tools.cart)) return [];

  let testCard = { ...card, edges: [...card.edges], connections: card.connections.map(g => [...g]) };
  if (isRotated) testCard = rotateCardClient(testCard);

  const valid = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      if (canPlaceClient(testCard, r, c)) {
        valid.push(`${r},${c}`);
      }
    }
  }
  return valid;
}

function rotateCardClient(card) {
  return {
    ...card,
    edges: [card.edges[2], card.edges[3], card.edges[0], card.edges[1]],
    connections: card.connections.map(g => g.map(e => (e + 2) % 4)),
  };
}

const OPPOSITE = [2, 3, 0, 1];
const DIR_OFFSETS = [
  { row: -1, col: 0 }, { row: 0, col: 1 },
  { row: 1, col: 0 }, { row: 0, col: -1 },
];

function canPlaceClient(card, row, col) {
  const key = `${row},${col}`;
  if (board[key]) return false;

  let hasAdj = false;
  for (let d = 0; d < 4; d++) {
    const nr = row + DIR_OFFSETS[d].row;
    const nc = col + DIR_OFFSETS[d].col;
    const nKey = `${nr},${nc}`;
    const neighbor = board[nKey];
    if (!neighbor) continue;

    if (neighbor.special === 'goal' && !neighbor.revealed) {
      hasAdj = true;
      continue;
    }

    hasAdj = true;
    const myEdge = card.edges[d];
    const theirEdge = neighbor.edges[OPPOSITE[d]];
    if (myEdge !== theirEdge) return false;
  }
  return hasAdj;
}

// ===== 손패 렌더링 =====
function renderHand() {
  handCardsEl.innerHTML = '';
  myHand.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'hand-card' + (i === selectedCardIndex ? ' selected' : '');

    const cvs = document.createElement('canvas');
    cvs.width = 60;
    cvs.height = 60;
    const c = cvs.getContext('2d');

    if (card.type === 'path') {
      let drawCard = { ...card, edges: [...card.edges], connections: card.connections.map(g => [...g]) };
      if (i === selectedCardIndex && isRotated) drawCard = rotateCardClient(drawCard);
      drawCardOnCtx(c, drawCard, 0, 0, 60, false);
    } else {
      // 액션 카드
      drawActionCard(c, card, 0, 0, 60);
    }

    div.appendChild(cvs);
    div.addEventListener('click', () => selectCard(i));
    handCardsEl.appendChild(div);
  });
}

function drawActionCard(c, card, x, y, s) {
  c.fillStyle = '#2a3a5c';
  c.fillRect(x + 1, y + 1, s - 2, s - 2);

  c.font = `bold ${s * 0.3}px sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';

  const cx = x + s / 2;
  const cy = y + s / 2;

  if (card.action === 'break') {
    c.fillStyle = '#c0392b';
    const icon = card.tool === 'pickaxe' ? '⛏' : card.tool === 'lantern' ? '🔦' : '🛒';
    c.font = `${s * 0.35}px sans-serif`;
    c.fillText(icon, cx, cy - s * 0.1);
    c.fillStyle = '#ff6666';
    c.font = `bold ${s * 0.25}px sans-serif`;
    c.fillText('고장', cx, cy + s * 0.25);
  } else if (card.action === 'repair') {
    c.fillStyle = '#27ae60';
    const icon = card.tool === 'pickaxe' ? '⛏' : card.tool === 'lantern' ? '🔦' : '🛒';
    c.font = `${s * 0.35}px sans-serif`;
    c.fillText(icon, cx, cy - s * 0.1);
    c.fillStyle = '#66ff88';
    c.font = `bold ${s * 0.25}px sans-serif`;
    c.fillText('수리', cx, cy + s * 0.25);
  } else if (card.action === 'rockfall') {
    c.fillStyle = '#e2b04a';
    c.font = `${s * 0.4}px sans-serif`;
    c.fillText('💥', cx, cy - s * 0.05);
    c.font = `bold ${s * 0.2}px sans-serif`;
    c.fillText('낙석', cx, cy + s * 0.3);
  } else if (card.action === 'map') {
    c.fillStyle = '#3498db';
    c.font = `${s * 0.4}px sans-serif`;
    c.fillText('🗺', cx, cy - s * 0.05);
    c.font = `bold ${s * 0.2}px sans-serif`;
    c.fillText('지도', cx, cy + s * 0.3);
  }
}

// ===== 플레이어 패널 =====
function renderPlayers() {
  const toolIcon = (tool, ok) => {
    const icons = { pickaxe: '⛏', lantern: '🔦', cart: '🛒' };
    return `<span class="tool ${ok ? 'ok' : ''}">${icons[tool]}</span>`;
  };

  playersPanel.innerHTML = players.map((p, i) => `
    <div class="player-chip ${i === currentTurnIndex ? 'current-turn' : ''}" data-player-id="${p.id}">
      <span class="p-name">${p.name}${i === myIndex ? ' (나)' : ''}</span>
      <span class="p-cards">🃏${p.handCount}</span>
      <span class="p-tools">
        ${toolIcon('pickaxe', p.tools.pickaxe)}
        ${toolIcon('lantern', p.tools.lantern)}
        ${toolIcon('cart', p.tools.cart)}
      </span>
    </div>
  `).join('');
}

function renderGameInfo() {
  roleBadge.textContent = myRole === 'miner' ? '⛏ 금광꾼' : '💀 사보타주';
  roleBadge.className = myRole;

  const currentPlayer = players[currentTurnIndex];
  if (currentTurnIndex === myIndex) {
    turnInfoEl.textContent = '🔔 내 차례!';
    turnInfoEl.style.color = '#e2b04a';
  } else {
    turnInfoEl.textContent = `${currentPlayer?.name || '?'}의 차례`;
    turnInfoEl.style.color = '#ccc';
  }

  // 덱 수 계산 (서버에서 받으면 좋지만 근사값)
  deckCountEl.textContent = ``;
}

function renderAll() {
  renderBoard();
  renderHand();
  renderPlayers();
  renderGameInfo();
}

// ===== 카드 선택 =====
function selectCard(index) {
  if (selectedCardIndex === index) {
    selectedCardIndex = -1;
    isRotated = false;
  } else {
    selectedCardIndex = index;
    isRotated = false;
  }
  renderAll();
}

// ===== 회전 =====
btnRotate.addEventListener('click', () => {
  if (selectedCardIndex < 0) return;
  const card = myHand[selectedCardIndex];
  if (!card || card.type !== 'path') return showToast('길 카드만 회전할 수 있습니다');
  isRotated = !isRotated;
  renderAll();
});

// ===== 버리기 =====
btnDiscard.addEventListener('click', () => {
  if (selectedCardIndex < 0) return showToast('버릴 카드를 선택하세요');
  if (currentTurnIndex !== myIndex) return showToast('내 차례가 아닙니다');
  socket.emit('discard-card', { cardIndex: selectedCardIndex });
  selectedCardIndex = -1;
  isRotated = false;
});

// ===== 보드 클릭 (카드 배치 / 낙석 대상) =====
boardCanvas.addEventListener('click', (e) => {
  const rect = boardCanvas.getBoundingClientRect();
  const scaleX = boardCanvas.width / rect.width;
  const scaleY = boardCanvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;

  const col = Math.floor((mx - PAD) / CELL);
  const row = Math.floor((my - PAD) / CELL);

  if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return;
  if (currentTurnIndex !== myIndex) return;
  if (selectedCardIndex < 0) return;

  const card = myHand[selectedCardIndex];
  if (!card) return;

  if (card.type === 'path') {
    socket.emit('play-path-card', {
      cardIndex: selectedCardIndex,
      row, col,
      rotated: isRotated,
    });
    selectedCardIndex = -1;
    isRotated = false;
  } else if (card.action === 'rockfall') {
    const key = `${row},${col}`;
    if (!board[key]) return showToast('카드가 없는 위치입니다');
    if (board[key].special) return showToast('시작/목표 카드는 제거할 수 없습니다');
    socket.emit('play-action-card', {
      cardIndex: selectedCardIndex,
      targetRow: row,
      targetCol: col,
    });
    selectedCardIndex = -1;
  }
});

// ===== 플레이어 칩 클릭 (고장/수리 대상) =====
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.player-chip');
  if (!chip) return;
  if (currentTurnIndex !== myIndex) return;
  if (selectedCardIndex < 0) return;

  const card = myHand[selectedCardIndex];
  if (!card || card.type !== 'action') return;
  if (card.action !== 'break' && card.action !== 'repair') return;

  const targetId = chip.dataset.playerId;
  socket.emit('play-action-card', {
    cardIndex: selectedCardIndex,
    targetPlayerId: targetId,
  });
  selectedCardIndex = -1;
});

// ===== 지도 카드 → 목표 선택 모달 =====
function showMapModal() {
  modalTitle.textContent = '🗺 확인할 목표 카드 선택';
  modalContent.innerHTML = '';
  const goalLabels = ['위쪽 (행 1)', '가운데 (행 3)', '아래쪽 (행 5)'];
  for (let i = 0; i < 3; i++) {
    const btn = document.createElement('button');
    btn.className = 'modal-option';
    btn.textContent = `목표 ${i + 1}: ${goalLabels[i]}`;
    btn.addEventListener('click', () => {
      socket.emit('play-action-card', {
        cardIndex: selectedCardIndex,
        targetGoalIndex: i,
      });
      selectedCardIndex = -1;
      modalOverlay.style.display = 'none';
    });
    modalContent.appendChild(btn);
  }
  modalOverlay.style.display = 'flex';
}

modalCancel.addEventListener('click', () => {
  modalOverlay.style.display = 'none';
});

// 지도 카드 더블클릭 또는 선택 후 사용
handCardsEl.addEventListener('dblclick', (e) => {
  if (selectedCardIndex < 0) return;
  if (currentTurnIndex !== myIndex) return;
  const card = myHand[selectedCardIndex];
  if (!card || card.type !== 'action' || card.action !== 'map') return;
  showMapModal();
});

// 선택 카드가 map이면 안내
function checkMapCard() {
  if (selectedCardIndex < 0) return;
  const card = myHand[selectedCardIndex];
  if (card && card.type === 'action' && card.action === 'map') {
    showMapModal();
  }
}

// 카드 선택 시 map이면 모달
const origSelect = selectCard;
function selectCard(index) {
  if (selectedCardIndex === index) {
    selectedCardIndex = -1;
    isRotated = false;
  } else {
    selectedCardIndex = index;
    isRotated = false;
  }
  renderAll();
  // map 카드면 자동 모달
  if (selectedCardIndex >= 0 && currentTurnIndex === myIndex) {
    const card = myHand[selectedCardIndex];
    if (card && card.type === 'action' && card.action === 'map') {
      setTimeout(() => showMapModal(), 100);
    }
  }
}

// ===== 소켓 이벤트 수신 =====
socket.on('board-updated', (newBoard) => {
  board = newBoard;
  renderBoard();
});

socket.on('hand-updated', (newHand) => {
  myHand = newHand;
  if (selectedCardIndex >= myHand.length) selectedCardIndex = -1;
  renderHand();
});

socket.on('players-updated', (newPlayers) => {
  players = newPlayers;
  renderPlayers();
});

socket.on('turn-changed', ({ currentTurnIndex: idx }) => {
  currentTurnIndex = idx;
  selectedCardIndex = -1;
  isRotated = false;
  renderAll();
});

socket.on('action-played', (data) => {
  const toolNames = { pickaxe: '곡괭이', lantern: '랜턴', cart: '수레' };
  if (data.action === 'break') {
    addLog(`${data.player}이(가) ${data.target}의 ${toolNames[data.tool]}을 고장냈습니다!`);
  } else if (data.action === 'repair') {
    addLog(`${data.player}이(가) ${data.target}의 ${toolNames[data.tool]}을 수리했습니다.`);
  } else if (data.action === 'rockfall') {
    addLog(`${data.player}이(가) 낙석을 일으켰습니다!`);
  } else if (data.action === 'map') {
    addLog(`${data.player}이(가) 지도를 사용했습니다.`);
  } else if (data.action === 'discard') {
    addLog(`${data.player}이(가) 카드를 버렸습니다.`);
  }
});

socket.on('map-result', ({ goalIndex, hasGold }) => {
  const labels = ['위쪽', '가운데', '아래쪽'];
  const msg = hasGold ? '💰 금이 있습니다!' : '🪨 돌입니다.';
  modalTitle.textContent = '🗺 지도 결과';
  modalContent.innerHTML = `<p style="text-align:center;font-size:1.2rem;padding:16px;">
    ${labels[goalIndex]} 목표 카드:<br><strong style="font-size:1.5rem">${msg}</strong>
  </p>`;
  modalOverlay.style.display = 'flex';
});

socket.on('goal-revealed', ({ position, hasGold }) => {
  if (hasGold) {
    addLog(`💰 금광 발견! 금광꾼 승리!`);
  } else {
    addLog(`🪨 돌이었습니다... 계속 진행!`);
  }
});

socket.on('game-over', ({ winner, roles }) => {
  const icon = $('gameover-icon');
  const title = $('gameover-title');
  const rolesDiv = $('gameover-roles');

  if (winner === 'miner') {
    icon.textContent = '⛏💰';
    title.textContent = '금광꾼 승리!';
    title.style.color = '#27ae60';
  } else {
    icon.textContent = '💀💣';
    title.textContent = '사보타주 승리!';
    title.style.color = '#c0392b';
  }

  rolesDiv.innerHTML = '<h3 style="margin:16px 0 10px;color:#e2b04a;">역할 공개</h3>' +
    roles.map(r => `
      <div class="role-line">
        ${r.name}: <span class="role-${r.role}">${r.role === 'miner' ? '⛏ 금광꾼' : '💀 사보타주'}</span>
      </div>
    `).join('');

  gameoverOverlay.style.display = 'flex';
});

$('btn-back-lobby').addEventListener('click', () => {
  gameoverOverlay.style.display = 'none';
  lobbyMenu.style.display = '';
  waitingRoom.style.display = 'none';
  showScreen(lobbyScreen);
});

socket.on('error-msg', (msg) => {
  showToast(msg);
});

socket.on('player-disconnected', ({ name }) => {
  addLog(`⚠️ ${name}이(가) 연결이 끊어졌습니다.`);
});
