import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';

// Desativa menu de contexto nativo do browser (botão direito) em toda a página
// para usar apenas menus customizados do jogo
document.addEventListener('contextmenu', (e: MouseEvent) => {
  e.preventDefault();
}, { passive: false });

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  scale: {
      mode: Phaser.Scale.RESIZE,
      parent: 'game-container',
      width: '100%',
      height: '100%'
  },
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      debug: false
    }
  },
  scene: [BootScene, GameScene]
};

interface CharacterSlot {
  slot: number;
  name: string;
  level: number;
  spriteId: string;
}

const state = {
  accountName: '',
  accountPassword: '',
  characters: [] as CharacterSlot[],
  selectedSlot: -1,
  selectedSpriteId: 'm1',
  socket: null as any
};

let phaserGameInstance: Phaser.Game | null = null;

function showScreen(id: string) {
  ['login-screen', 'character-select-screen', 'character-create-screen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) (el as HTMLElement).style.display = s === id ? 'flex' : 'none';
  });
}

function showToast(msg: string, color: string = '#fbbf24') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.background = color;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

function spritePreviewHTML(spriteId: string, size: 'small' | 'large' = 'small'): string {
  // small: 16x24 com 4x scale = 64x96. large: 16x24 com 6x scale = 96x144
  const scale = size === 'large' ? 6 : 4;
  const w = 16 * scale;
  const h = 24 * scale;
  return `<canvas class="sprite-preview" data-sprite="${spriteId}" width="${w}" height="${h}" style="width:${w}px;height:${h}px;"></canvas>`;
}

function drawSpritePreview(canvas: HTMLCanvasElement) {
  const spriteId = canvas.dataset.sprite || 'm1';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = (window as any).__characterSpritesheet as HTMLImageElement | undefined;
  if (!img || !img.complete) {
    canvas.style.background = '#1f2937';
    return;
  }
  const idx = ['m1', 'm2', 'f1', 'f2'].indexOf(spriteId);
  if (idx < 0) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, idx * 48, 0, 16, 24, 0, 0, canvas.width, canvas.height);
}

const CLASS_NAMES: Record<string, string> = {
  m1: 'CAVALEIRO',
  m2: 'MAGO',
  f1: 'ARQUEIRA',
  f2: 'CURANDEIRA',
};

function renderCharacterSlots() {
  const container = document.getElementById('character-slots');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const ch = state.characters.find(c => c.slot === i + 1);
    const card = document.createElement('div');
    card.className = 'char-card' + (state.selectedSlot === i + 1 ? ' selected' : '') + (ch ? '' : ' empty');
    if (ch) {
      card.innerHTML = `
        <div class="char-banner ${ch.spriteId}">${CLASS_NAMES[ch.spriteId] || ch.spriteId.toUpperCase()}</div>
        <div class="char-portrait">${spritePreviewHTML(ch.spriteId, 'large')}</div>
        <div class="char-info">
          <div class="char-name">${ch.name}</div>
          <div class="char-level-row"><span class="char-level-badge">Nv. ${ch.level}</span></div>
        </div>
        <button class="char-delete-btn" data-action="delete" data-name="${ch.name}" title="Deletar">🗑️</button>
      `;
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).dataset.action === 'delete') return;
        state.selectedSlot = i + 1;
        renderCharacterSlots();
        (document.getElementById('btn-play') as HTMLButtonElement).disabled = false;
      });
      const delBtn = card.querySelector('.char-delete-btn') as HTMLButtonElement;
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Deletar ${ch.name} (Nv. ${ch.level})? Esta ação não pode ser desfeita.`)) return;
        state.socket.emit('character:delete', { name: ch.name });
      });
    } else {
      card.innerHTML = `
        <div class="char-empty-icon">+</div>
        <div class="char-empty-text">Criar Personagem</div>
      `;
      card.addEventListener('click', () => {
        openCreateScreen();
      });
    }
    container.appendChild(card);
  }
  setTimeout(() => {
    document.querySelectorAll('.sprite-preview').forEach(c => drawSpritePreview(c as HTMLCanvasElement));
  }, 0);
  updateSelectedInfo();
  const playBtn = document.getElementById('btn-play') as HTMLButtonElement;
  if (playBtn) playBtn.disabled = state.selectedSlot < 0;
}

function updateSelectedInfo() {
  const infoEl = document.getElementById('select-selected-info');
  const nameEl = document.getElementById('select-selected-name');
  if (!infoEl || !nameEl) return;
  const ch = state.characters.find(c => c.slot === state.selectedSlot);
  if (ch) {
    infoEl.classList.add('has-selection');
    nameEl.textContent = `${ch.name}  •  ${CLASS_NAMES[ch.spriteId] || ''}  •  Nv. ${ch.level}`;
  } else {
    infoEl.classList.remove('has-selection');
    nameEl.textContent = 'Nenhum';
  }
}

function updateAccountDisplay() {
  const accountEl = document.getElementById('char-select-account');
  const avatarEl = document.getElementById('char-select-avatar');
  if (accountEl) accountEl.textContent = state.accountName || '-';
  if (avatarEl && state.accountName) {
    avatarEl.textContent = state.accountName.charAt(0).toUpperCase();
  }
}

function openCreateScreen() {
  state.selectedSpriteId = 'm1';
  showScreen('character-create-screen');
  refreshSpriteOptions();
  (document.getElementById('char-create-name') as HTMLInputElement).value = '';
  updateCreateConfirmState();
  setTimeout(() => {
    document.querySelectorAll('.sprite-preview').forEach(c => drawSpritePreview(c as HTMLCanvasElement));
  }, 0);
}

const CLASS_INFO: Record<string, { name: string; desc: string }> = {
  m1: { name: 'CAVALEIRO',   desc: 'Tanque. Alto HP, defesa e dano corpo-a-corpo.' },
  m2: { name: 'MAGO',        desc: 'Dano mágico em área. Fragil, devasta em grupo.' },
  f1: { name: 'ARQUEIRA',    desc: 'Ataque à distância. Ágil, dano constante.' },
  f2: { name: 'CURANDEIRA',  desc: 'Suporte. Cura aliados, dano fraco.' },
};

function refreshSpriteOptions() {
  const container = document.getElementById('sprite-options');
  if (!container) return;
  container.innerHTML = '';
  ['m1', 'm2', 'f1', 'f2'].forEach(s => {
    const info = CLASS_INFO[s];
    const card = document.createElement('div');
    card.className = 'class-card' + (state.selectedSpriteId === s ? ' selected' : '');
    card.innerHTML = `
      <div class="char-banner ${s}">${info.name}</div>
      <div class="char-portrait">${spritePreviewHTML(s, 'large')}</div>
      <div class="class-desc">${info.desc}</div>
    `;
    card.addEventListener('click', () => {
      state.selectedSpriteId = s;
      refreshSpriteOptions();
      updateCreateConfirmState();
    });
    container.appendChild(card);
  });
  setTimeout(() => {
    document.querySelectorAll('.sprite-preview').forEach(c => drawSpritePreview(c as HTMLCanvasElement));
  }, 0);
}

function updateCreateConfirmState() {
  const nameInput = document.getElementById('char-create-name') as HTMLInputElement | null;
  const confirmBtn = document.getElementById('btn-create-confirm') as HTMLButtonElement | null;
  if (!confirmBtn) return;
  const nameOk = !!(nameInput && nameInput.value.trim().length >= 3);
  confirmBtn.disabled = !nameOk;
}

function startGame() {
  if (state.selectedSlot < 0) return;
  const ch = state.characters.find(c => c.slot === state.selectedSlot);
  if (!ch) return;
  // Esconde tela de seleção e entra no jogo
  showScreen('hidden');
  (window as any).playerName = ch.name;
  (window as any).playerPassword = state.accountPassword;
  state.socket.emit('character:select', { name: ch.name });
}

// =========================================================
// EVENTOS
// =========================================================

document.getElementById('btn-login')!.addEventListener('click', () => {
  const name = (document.getElementById('login-name') as HTMLInputElement).value.trim();
  const pwd = (document.getElementById('login-password') as HTMLInputElement).value;
  if (name.length < 3) { showToast('Nome da conta deve ter pelo menos 3 caracteres.', '#ef4444'); return; }
  if (pwd.length < 3) { showToast('Senha deve ter pelo menos 3 caracteres.', '#ef4444'); return; }
  if (pwd.length > 8) { showToast('Senha deve ter no máximo 8 caracteres.', '#ef4444'); return; }
  state.accountName = name;
  state.accountPassword = pwd;
  document.getElementById('login-screen')!.style.display = 'none';
  document.getElementById('login-loading')!.style.display = 'flex';
  const loginBtn = document.getElementById('btn-login') as HTMLButtonElement;
  loginBtn.disabled = true;

  // Garante socket único: desconecta qualquer socket anterior antes de criar um novo
  if (state.socket) {
    try { state.socket.disconnect(); } catch {}
    state.socket = null;
  }
  (window as any).__loginSocket = null;

  // Conecta socket
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const defaultUrl = isLocal ? window.location.origin : 'https://aethelgard-server-9go1.onrender.com';
  const serverUrl = (import.meta as any).env.VITE_SERVER_URL || defaultUrl;
  const socket = io(serverUrl, {
    auth: { name, password: pwd },
    transports: ['websocket', 'polling']
  });
  state.socket = socket;
  (window as any).__loginSocket = socket;
  (window as any).socket = socket;

  socket.on('connect', () => {
    console.log('[client] connected:', socket.id);
    loginBtn.disabled = false;
  });

  socket.on('connect_error', (err: any) => {
    console.error('[client] connect_error:', err.message);
    document.getElementById('login-loading')!.style.display = 'none';
    document.getElementById('login-screen')!.style.display = 'flex';
    showToast('Erro de conexão: ' + err.message, '#ef4444');
    loginBtn.disabled = false;
  });

  socket.on('account:characters', (data: { accountName: string; characters: CharacterSlot[]; maxCharacters: number }) => {
    state.characters = data.characters;
    state.selectedSlot = -1;
    state.accountName = data.accountName;
    document.getElementById('login-loading')!.style.display = 'none';
    showScreen('character-select-screen');
    updateAccountDisplay();
    renderCharacterSlots();
  });

  socket.on('character:createResult', (data: { ok: boolean; reason?: string; character?: CharacterSlot }) => {
    if (data.ok) {
      showToast('Personagem criado!', '#10b981');
      showScreen('character-select-screen');
    } else {
      showToast(data.reason || 'Erro ao criar.', '#ef4444');
    }
  });

  socket.on('character:deleteResult', (data: { ok: boolean; reason?: string }) => {
    if (data.ok) showToast('Personagem deletado.', '#10b981');
    else showToast(data.reason || 'Erro ao deletar.', '#ef4444');
  });

  socket.on('character:selectResult', (data: { ok: boolean; reason?: string }) => {
    if (!data.ok) {
      showToast(data.reason || 'Erro ao entrar.', '#ef4444');
      showScreen('character-select-screen');
      return;
    }
    // Inicia o Phaser (destrói instância anterior se existir)
    if (phaserGameInstance) {
      try { phaserGameInstance.destroy(true); } catch {}
      phaserGameInstance = null;
    }
    phaserGameInstance = new Phaser.Game(config);
  });

  // Buffer de eventos do jogo (caso cheguem antes do GameScene anexar o socket)
  const gameEvents = ['init', 'mapData', 'cities:data', 'plaza:data', 'timeUpdate', 'currentPlayers', 'playerJoined', 'playerMoved', 'playerDashed', 'itemDropped', 'itemRemoved', 'itemPickedUp', 'inventoryUpdate', 'equipmentUpdate', 'statsUpdate', 'bank:update', 'textEffect', 'levelUp', 'playerDamaged', 'entity:info', 'timeSync', 'bossSpawned', 'teleporter:destinations', 'vendor:open', 'skullking:open', 'skullking:update'];
  (window as any).__gameEventBuffer = [];
  (window as any).__flushGameEvents = (handler: (event: string, data: any) => void) => {
    const buf = (window as any).__gameEventBuffer || [];
    (window as any).__gameEventBuffer = [];
    for (const [evt, data] of buf) handler(evt, data);
  };
  for (const evt of gameEvents) {
    socket.on(evt, (data: any) => {
      if ((window as any).__onGameEvent) {
        (window as any).__onGameEvent(evt, data);
      } else {
        (window as any).__gameEventBuffer.push([evt, data]);
      }
    });
  }

  socket.on('loginFailed', (data: { message: string }) => {
    document.getElementById('login-loading')!.style.display = 'none';
    document.getElementById('login-screen')!.style.display = 'flex';
    showToast(data.message, '#ef4444');
    loginBtn.disabled = false;
  });

  socket.on('disconnect', (reason: string) => {
    console.log('[client] disconnect:', reason);
    loginBtn.disabled = false;
    const cs = document.getElementById('character-select-screen') as HTMLElement;
    if (cs && cs.style.display === 'flex') {
      showToast('Desconectado do servidor (' + reason + '). Tente entrar novamente.', '#ef4444');
    }
  });
});

document.getElementById('btn-play')!.addEventListener('click', startGame);
document.getElementById('btn-logout')!.addEventListener('click', logout);
// Botão in-game: mostra modal de confirmação
document.getElementById('btn-logout-game')!.addEventListener('click', showExitConfirm);
document.getElementById('btn-exit-cancel')!.addEventListener('click', hideExitConfirm);
document.getElementById('btn-exit-to-lobby')!.addEventListener('click', () => {
  hideExitConfirm();
  returnToLobby();
});
document.getElementById('btn-exit-to-login')!.addEventListener('click', () => {
  hideExitConfirm();
  logout();
});

function showExitConfirm() {
  const modal = document.getElementById('exit-confirm-modal');
  if (modal) (modal as HTMLElement).style.display = 'flex';
}

function hideExitConfirm() {
  const modal = document.getElementById('exit-confirm-modal');
  if (modal) (modal as HTMLElement).style.display = 'none';
}

function returnToLobby() {
  // Destrói a instância do Phaser pra não duplicar listeners/sprites
  if (phaserGameInstance) {
    try { phaserGameInstance.destroy(true); } catch {}
    phaserGameInstance = null;
  }
  (window as any).__onGameEvent = null;
  (window as any).__gameEventBuffer = [];
  const gameEl = document.getElementById('game-container');
  if (gameEl) gameEl.style.display = 'none';
  // Pede a lista atualizada de chars para o server
  if (state.socket) {
    state.socket.emit('character:list');
  }
  showScreen('character-select-screen');
  renderCharacterSlots();
}

function logout() {
  if (state.socket) {
    try { state.socket.disconnect(); } catch {}
    state.socket = null;
  }
  (window as any).__loginSocket = null;
  (window as any).__onGameEvent = null;
  (window as any).__gameEventBuffer = [];
  if (phaserGameInstance) {
    try { phaserGameInstance.destroy(true); } catch {}
    phaserGameInstance = null;
  }
  state.characters = [];
  state.selectedSlot = -1;
  state.accountName = '';
  state.accountPassword = '';
  (document.getElementById('login-name') as HTMLInputElement).value = '';
  (document.getElementById('login-password') as HTMLInputElement).value = '';
  const gameEl = document.getElementById('game-container');
  if (gameEl) gameEl.style.display = 'none';
  showScreen('login-screen');
}

document.getElementById('char-create-name')!.addEventListener('input', updateCreateConfirmState);

document.getElementById('btn-create-confirm')!.addEventListener('click', () => {
  const name = (document.getElementById('char-create-name') as HTMLInputElement).value.trim();
  if (name.length < 3) { showToast('Nome deve ter 3-20 caracteres.', '#ef4444'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(name)) { showToast('Use apenas letras, números e underscore.', '#ef4444'); return; }
  state.socket.emit('character:create', { name, spriteId: state.selectedSpriteId });
});

document.getElementById('btn-create-cancel')!.addEventListener('click', () => {
  showScreen('character-select-screen');
});

// Pré-carrega o spritesheet quando a página carregar
const img = new Image();
img.onload = () => {
  (window as any).__characterSpritesheet = img;
  // Redesenha qualquer preview que já esteja visível
  document.querySelectorAll('.sprite-preview').forEach(c => drawSpritePreview(c as HTMLCanvasElement));
};
img.src = new URL('./sprites/characters.png', document.baseURI).href;
