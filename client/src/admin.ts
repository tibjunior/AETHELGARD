import { io } from 'socket.io-client';

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const defaultUrl = isLocal ? window.location.origin : 'https://aethelgard-server-9go1.onrender.com';
const serverUrl = (import.meta as any).env.VITE_SERVER_URL || defaultUrl;

let socket: any = null;
let accountsCache: any[] = [];
let currentConfig: any = null;
let currentCities: any[] = [];
let currentEntities: any[] = [];
let citiesPollingInterval: number | null = null;
let currentDetailCityId: string | null = null;
let searchTerm = '';

// ===== Login & Connection =====
const loginScreen = document.getElementById('login-screen')!;
const loginPass = document.getElementById('login-password') as HTMLInputElement;
const loginError = document.getElementById('login-error')!;
const btnLogin = document.getElementById('btn-login')!;

function appendLog(msg: string) {
  const el = document.getElementById('cfg-status');
  if (el) el.innerText = msg;
}

function showToast(msg: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:10px;color:white;font-size:14px;z-index:10000;background:${type === 'success' ? '#10b981' : '#ef4444'};box-shadow:0 4px 20px rgba(0,0,0,0.4);opacity:0;transition:opacity 0.3s;font-family:'Inter',sans-serif;pointer-events:none;`;
  toast.innerText = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.style.opacity = '1');
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function setConnectionStatus(connected: boolean) {
  const dot = document.getElementById('conn-indicator');
  const txt = document.getElementById('conn-text');
  if (dot) {
    dot.style.background = connected ? '#10b981' : '#ef4444';
    dot.style.boxShadow = connected ? '0 0 8px #10b981' : '0 0 8px #ef4444';
  }
  if (txt) txt.innerText = connected ? 'Conectado' : 'Desconectado';
}

function doLogin(password: string) {
  if (socket?.connected) socket.disconnect();

  socket = io(serverUrl, {
    auth: { name: 'AdminGM', password, type: 'admin' },
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => { setConnectionStatus(true); });

  socket.on('admin:loginResult', (data: { ok: boolean; reason?: string }) => {
    if (data.ok) {
      loginScreen.classList.add('hidden');
      showToast('✅ Conectado como administrador!');
      fetchPlayers();
    } else {
      setConnectionStatus(false);
      loginError.innerText = data.reason || 'Senha incorreta.';
    }
  });

  socket.on('disconnect', () => {
    setConnectionStatus(false);
    if (!loginScreen.classList.contains('hidden')) {
      loginError.innerText = 'Conexão perdida.';
    }
  });

  socket.on('connect_error', () => {
    setConnectionStatus(false);
    loginError.innerText = 'Erro ao conectar ao servidor.';
  });

  // Listeners de dados do admin
  socket.on('admin:playersData', (players: any[]) => {
  accountsCache = players;
  renderPlayers(players);
  updateStats(players);
});

socket.on('admin:playerMoved', (data: { id: string; x: number; y: number }) => {
  const displayId = data.id ? data.id.substring(0, 4) : null;
  if (!displayId) return;
  const cell = document.getElementById(`loc-${displayId}`);
  if (cell) {
    cell.innerText = `${data.x}, ${data.y}`;
    cell.style.color = '#fbbf24';
    setTimeout(() => { if (cell) cell.style.color = '#94a3b8'; }, 300);
  }
});

socket.on('admin:playerUpdated', () => fetchPlayers());
socket.on('admin:configData', (cfg: any) => {
  currentConfig = cfg;
  populateConfigForm(cfg);
  renderBankAdmin();
  appendLog('✅ Configuração carregada.');
});
socket.on('admin:vendorsData', (vendors: any[]) => {
  currentVendors = vendors;
  renderVendorsAdmin();
});
socket.on('admin:craftersData', (data: { stations: any[], recipes: any[] }) => {
  currentCraftingStations = data.stations;
  currentRecipes = data.recipes;
  renderCraftersAdmin();
});
socket.on('admin:teleportersData', (teleporters: any[]) => {
  currentTeleporters = teleporters;
  renderTeleporterAdmin();
});
socket.on('admin:monsterConfigsData', () => {});
socket.on('admin:monsterConfigResult', (data: { name: string; ok: boolean; reason?: string; liveUpdated?: number }) => {
  if (data.ok) {
    showToast(`✅ ${data.name} salvo! ${data.liveUpdated ?? 0} monstro(s) vivo(s) atualizado(s).`, 'success');
  } else {
    showToast(`❌ ${data.name}: ${data.reason || 'Erro ao salvar'}`, 'error');
  }
});
socket.on('admin:citiesData', (cities: any[]) => {
  currentCities = cities;
  renderCitiesAdmin();
  if (currentDetailCityId) renderCityDetail(currentDetailCityId);
});
socket.on('admin:entitiesData', (entities: any[]) => {
  currentEntities = entities;
  renderCitiesAdmin();
  if (currentDetailCityId) renderCityDetail(currentDetailCityId);
});
socket.on('admin:cityBossResult', (data: { cityId: string; ok: boolean; reason?: string }) => {
  showToast(data.ok ? `✅ Boss de ${CITY_META[data.cityId]?.name || data.cityId} invocado!` : `❌ ${data.reason || 'Erro'}`, data.ok ? 'success' : 'error');
});
socket.on('admin:cityEditResult', (data: { cityId: string; ok: boolean; reason?: string }) => {
  showToast(data.ok ? `✅ Configurações de ${CITY_META[data.cityId]?.name || data.cityId} salvas!` : `❌ ${data.reason || 'Erro'}`, data.ok ? 'success' : 'error');
});
}

btnLogin.addEventListener('click', () => {
  const pass = loginPass.value.trim();
  if (!pass) { loginError.innerText = 'Digite a senha de administrador.'; return; }
  loginError.innerText = 'Conectando...';
  doLogin(pass);
});

loginPass.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnLogin.click();
});

// ===== Players =====
function fetchPlayers() {
  socket?.emit('admin:getPlayers');
}

const searchInput = document.getElementById('player-search') as HTMLInputElement;
if (searchInput) {
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.toLowerCase().trim();
    renderPlayers(accountsCache);
  });
}

function renderPlayers(players: any[]) {
  const tbody = document.getElementById('players-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filtered = searchTerm ? players.filter(p => p.name?.toLowerCase().includes(searchTerm)) : players;
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.innerText = `${filtered.length} / ${players.length} jogadores`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#64748b;">Nenhum jogador encontrado.</td></tr>';
    return;
  }

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    const isOnline = p.isOnline ? 'status-online' : 'status-offline';
    const onText = p.isOnline ? 'Online' : 'Offline';
    const kickDis = p.isOnline ? '' : 'disabled';
    const displayId = p.id ? p.id.substring(0, 4) : 'DB';

    tr.innerHTML = `
      <td><span class="status-badge ${isOnline}"><span class="status-dot"></span> ${onText}</span></td>
      <td style="font-weight:600;">${p.name} <span style="color:#64748b;font-size:11px;">(${displayId})</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-family:monospace;background:rgba(0,0,0,0.4);padding:4px 8px;border-radius:4px;filter:blur(4px);transition:filter 0.2s;" id="pass-${displayId}">${p.password || '—'}</span>
          <button style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:14px;" title="Ver Senha" onclick="window.adminActions.togglePass('${displayId}')">👁️</button>
        </div>
      </td>
      <td>Lv ${p.level}</td>
      <td style="color:#fbbf24;font-weight:bold;">${p.gold}G</td>
      <td>${p.statPoints}</td>
      <td id="loc-${displayId}" style="font-family:monospace;color:#94a3b8;">${p.isOnline ? `${p.x},${p.y}` : '—'}</td>
      <td class="actions">
        <button class="btn btn-gold" onclick="window.emit('admin:giveGold','${p.name}')">+1000G</button>
        <button class="btn btn-reset" onclick="confirm('Resetar ${p.name}?')&&window.emit('admin:resetPlayer','${p.name}')">Reset</button>
        <button class="btn btn-edit" onclick="window.adminActions.openEditModal('${p.name}')">Editar</button>
        <button class="btn btn-kick" ${kickDis} onclick="window.emit('admin:kickPlayer','${p.id}')">Kick</button>
        <button class="btn btn-reset" onclick="window.adminActions.resetPassword('${p.name}')" style="background:#8b5cf6;">Senha</button>
        <button class="btn btn-kick" onclick="window.adminActions.deletePlayer('${p.name}')" style="background:#991b1b;">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

(window as any).emit = (event: string, data: any) => {
  socket?.emit(event, data);
};
(window as any).adminActions = {
  resetPassword(name: string) {
    const pass = prompt(`Nova senha para ${name} (até 8 caracteres):`);
    if (pass?.trim()) socket?.emit('admin:resetPassword', { name, newPass: pass.trim().substring(0, 8) });
  },
  deletePlayer(name: string) {
    const c = prompt(`EXCLUIR ${name} permanentemente? Digite o nome para confirmar:`);
    if (c === name) socket?.emit('admin:deletePlayer', name);
    else if (c !== null) showToast('Nome incorreto. Exclusão cancelada.', 'error');
  },
  openEditModal(name: string) {
    const p = accountsCache.find(x => x.name === name);
    if (!p) return;
    (document.getElementById('edit-player-name') as HTMLInputElement).value = p.name;
    (document.getElementById('edit-player-level') as HTMLInputElement).value = p.level;
    (document.getElementById('edit-player-gold') as HTMLInputElement).value = p.gold;
    (document.getElementById('edit-player-points') as HTMLInputElement).value = p.statPoints;
    document.getElementById('edit-modal')!.style.display = 'flex';
  },
  togglePass(id: string) {
    const el = document.getElementById(`pass-${id}`);
    if (el) el.style.filter = el.style.filter === 'none' ? 'blur(4px)' : 'none';
  }
};

function updateStats(players: any[]) {
  const onlineEl = document.getElementById('total-online');
  const regEl = document.getElementById('total-registered');
  const avgEl = document.getElementById('avg-level');
  const onlineCount = players.filter(p => p.isOnline).length;
  if (onlineEl) onlineEl.innerText = onlineCount.toString();
  if (regEl) regEl.innerText = players.length.toString();
  const avg = players.length > 0 ? (players.reduce((s, p) => s + (p.level || 1), 0) / players.length).toFixed(1) : '0';
  if (avgEl) avgEl.innerText = avg;
}

// Modal handlers
document.getElementById('btn-edit-cancel')?.addEventListener('click', () => {
  document.getElementById('edit-modal')!.style.display = 'none';
});
document.getElementById('btn-edit-save')?.addEventListener('click', () => {
  const name = (document.getElementById('edit-player-name') as HTMLInputElement).value;
  const level = parseInt((document.getElementById('edit-player-level') as HTMLInputElement).value) || 1;
  const gold = parseInt((document.getElementById('edit-player-gold') as HTMLInputElement).value) || 0;
  const sp = parseInt((document.getElementById('edit-player-points') as HTMLInputElement).value) || 0;
  socket?.emit('admin:editPlayer', { name, level, gold, statPoints: sp });
  document.getElementById('edit-modal')!.style.display = 'none';
  showToast('✅ Jogador atualizado!');
});

// Navigation
const tabs = ['players', 'server', 'spawner', 'map'];
tabs.forEach(t => {
  document.getElementById(`nav-${t}`)?.addEventListener('click', (e) => {
    e.preventDefault();
    tabs.forEach(x => {
      document.getElementById(`nav-${x}`)?.classList.remove('active');
      const tabEl = document.getElementById(`tab-${x}`);
      if (tabEl) tabEl.style.display = 'none';
    });
    document.getElementById(`nav-${t}`)?.classList.add('active');
    const tabEl = document.getElementById(`tab-${t}`);
    if (tabEl) tabEl.style.display = 'flex';

    const titles: Record<string, string> = { players: 'Gerenciamento de Contas', server: 'Comandos do Servidor', spawner: 'Gerador de Entidades e Itens', map: 'Editor de Cidades' };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.innerText = titles[t];

    if (t === 'map') { loadCitiesAdmin(); }
    else { stopCitiesPolling(); if (currentDetailCityId) closeCityDetail(); }
  });
});

// ===== Sub-aba switching (Jogadores / NPCs) =====
document.querySelectorAll('.subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.subtab-btn').forEach(b => {
      (b as HTMLElement).style.color = '#94a3b8';
      (b as HTMLElement).style.borderBottomColor = 'transparent';
    });
    (btn as HTMLElement).style.color = '#f8fafc';
    (btn as HTMLElement).style.borderBottomColor = '#3b82f6';

    const sub = (btn as HTMLElement).dataset.subtab;
    document.querySelectorAll('.subtab-content').forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
    const target = document.getElementById(`subtab-${sub}`);
    if (target) target.style.display = 'block';

    if (sub === 'npcs') {
      loadVendorsAdmin();
      loadCraftersAdmin();
      loadTeleporterAdmin();
      loadBankAdmin();
    }
  });
});

// ===== NPC nav card clicks =====
document.querySelectorAll('.npc-nav-card').forEach(card => {
  card.addEventListener('click', () => {
    const section = (card as HTMLElement).dataset.npcSection;
    document.querySelectorAll('.npc-section').forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
    const target = document.getElementById(`npc-section-${section}`);
    if (target) target.style.display = 'block';
  });
});

// ===== NPC back buttons =====
document.querySelectorAll('.btn-npc-back').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.npc-section').forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
  });
});

// Server commands
document.getElementById('btn-broadcast-submit')?.addEventListener('click', () => {
  const input = document.getElementById('broadcast-msg') as HTMLInputElement;
  if (input.value.trim()) {
    socket?.emit('admin:broadcast', input.value);
    showToast('📢 Anúncio enviado!');
    input.value = '';
  }
});
document.getElementById('btn-time-day')?.addEventListener('click', () => { socket?.emit('admin:setTime', false); showToast('☀️ Forçado: Dia!'); });
document.getElementById('btn-time-night')?.addEventListener('click', () => { socket?.emit('admin:setTime', true); showToast('🌙 Forçado: Noite!'); });

// Spawners
document.getElementById('btn-spawn-entity')?.addEventListener('click', () => {
  const name = (document.getElementById('spawn-entity-name') as HTMLSelectElement).value;
  socket?.emit('admin:spawnEntity', { name });
  showToast(`👾 ${name} invocado!`);
});
document.getElementById('btn-spawn-item')?.addEventListener('click', () => {
  const name = (document.getElementById('spawn-item-name') as HTMLSelectElement).value;
  socket?.emit('admin:spawnItem', { name });
  showToast(`📦 ${name} spawnado!`);
});
document.getElementById('btn-refresh')?.addEventListener('click', fetchPlayers);

// ===== Server Config (reformulado) =====
// Salva taxa: converte slider value para config real
function saveRates() {
  if (!currentConfig) return;
  const goldMult = parseFloat((document.getElementById('rate-gold') as HTMLInputElement).value);
  const expMult = parseFloat((document.getElementById('rate-exp') as HTMLInputElement).value);
  const dropMult = parseFloat((document.getElementById('rate-drop') as HTMLInputElement).value);
  // Envia os multiplicadores globais para o servidor (em tempo real)
  socket?.emit('admin:setConfig', {
    globalGoldMultiplier: Math.round(goldMult * 10) / 10,
    globalExpMultiplier: Math.round(expMult * 10) / 10,
    globalDropMultiplier: Math.round(dropMult * 10) / 10,
  });
  showToast('✅ Taxas salvas! Multiplicadores ativos em tempo real.');
}

// Sliders: atualiza label em tempo real
['rate-gold', 'rate-exp', 'rate-drop'].forEach(id => {
  const el = document.getElementById(id) as HTMLInputElement;
  const val = document.getElementById(id + '-val');
  if (el && val) {
    el.addEventListener('input', () => { val.textContent = parseFloat(el.value).toFixed(1) + 'x'; });
  }
});

document.getElementById('btn-save-rates')?.addEventListener('click', saveRates);

// Recarregar/Resetar Config
document.getElementById('btn-reload-config')?.addEventListener('click', () => { socket?.emit('admin:getConfig'); appendLog('🔄 Recarregando...'); });
document.getElementById('btn-reset-config')?.addEventListener('click', () => {
  if (confirm('Resetar TODAS as configurações para os padrões?')) { socket?.emit('admin:resetConfig'); appendLog('⚠️ Resetando...'); }
});

// PvP Toggle
let pvpEnabled = true;
document.getElementById('btn-toggle-pvp')?.addEventListener('click', () => {
  pvpEnabled = !pvpEnabled;
  const btn = document.getElementById('btn-toggle-pvp')!;
  btn.textContent = pvpEnabled ? '🟢 Ativado' : '🔴 Desativado';
  btn.style.background = pvpEnabled ? '#10b981' : '#ef4444';
  // PvP item loss: 0 quando desativado, 0.30 quando ativado
  socket?.emit('admin:setConfig', { pvpItemLossChance: pvpEnabled ? 0.30 : 0, pvpGoldReward: pvpEnabled ? 10 : 0 });
  showToast(pvpEnabled ? '🛡️ PvP ativado!' : '🛡️ PvP desativado!');
});



// Day duration slider
const daySlider = document.getElementById('rate-day-duration') as HTMLInputElement;
const dayVal = document.getElementById('rate-day-duration-val');
if (daySlider && dayVal) {
  daySlider.addEventListener('input', () => { dayVal.textContent = daySlider.value + ' min'; });
  daySlider.addEventListener('change', () => {
    const ticks = parseInt(daySlider.value) * 6000; // 1 min = 6000 ticks
    socket?.emit('admin:setConfig', { dayDurationTicks: ticks });
    showToast('☀️ Duração do dia atualizada!');
  });
}

// Night duration slider
const nightSlider = document.getElementById('rate-night-duration') as HTMLInputElement;
const nightVal = document.getElementById('rate-night-duration-val');
if (nightSlider && nightVal) {
  nightSlider.addEventListener('input', () => { nightVal.textContent = nightSlider.value + ' min'; });
  nightSlider.addEventListener('change', () => {
    const ticks = parseInt(nightSlider.value) * 6000; // 1 min = 6000 ticks
    socket?.emit('admin:setConfig', { nightDurationTicks: ticks });
    showToast('🌙 Duração da noite atualizada!');
  });
}

// ===== Populate Config Form (ao receber config do server) =====
function populateConfigForm(cfg: any) {
  if (!cfg) return;
  // Rate sliders
  const setSlider = (id: string, val: number) => {
    const el = document.getElementById(id) as HTMLInputElement;
    const label = document.getElementById(id + '-val');
    if (el) { el.value = String(val); }
    if (label) { label.textContent = val.toFixed(1) + 'x'; }
  };
  setSlider('rate-gold', cfg.globalGoldMultiplier ?? cfg.goldByLevel ?? 1);
  setSlider('rate-exp', cfg.globalExpMultiplier ?? 1);
  setSlider('rate-drop', cfg.globalDropMultiplier ?? 1);
  // Day duration slider
  if (daySlider && dayVal) {
    const ticks = cfg.dayDurationTicks || 6000;
    const mins = Math.round(ticks / 6000);
    daySlider.value = String(mins);
    dayVal.textContent = mins + ' min';
  }
  // Night duration slider
  if (nightSlider && nightVal) {
    const ticks = cfg.nightDurationTicks || 6000;
    const mins = Math.round(ticks / 6000);
    nightSlider.value = String(mins);
    nightVal.textContent = mins + ' min';
  }
  // Monster cards
  renderMonsterCards(cfg);
  appendLog('✅ Configuração carregada.');
}

// ===== Monster Cards Editor =====
function renderMonsterCards(cfg: any) {
  const container = document.getElementById('monster-cards');
  if (!container || !cfg.monsterConfigs) return;
  container.innerHTML = '';
  for (const [name, mc] of Object.entries<any>(cfg.monsterConfigs)) {
    const card = document.createElement('div');
    card.className = 'monster-card';
    card.innerHTML = `
      <h4>👾 ${name}</h4>
      <div class="m-field"><label>HP</label><input type="number" class="m-hp" value="${mc.health || 100}" min="1" /></div>
      <div class="m-field"><label>Ataque</label><input type="number" class="m-atk" value="${mc.attack || 10}" min="1" /></div>
      <div class="m-field"><label>Velocidade</label><input type="number" class="m-spd" value="${mc.speed || 100}" min="1" /></div>
      <div class="m-field"><label>EXP</label><input type="number" class="m-exp" value="${mc.exp || 50}" min="0" /></div>
      <div class="m-field">
        <label>Comportamento</label>
        <select class="m-aggro">
          <option value="true" ${mc.isAggressive ? 'selected' : ''}>⚔️ Agressivo</option>
          <option value="false" ${!mc.isAggressive ? 'selected' : ''}>🕊️ Passivo</option>
        </select>
      </div>
      <div class="m-field"><label>Respawn (ms)</label><input type="number" class="m-respawn" value="${mc.respawnMs || 20000}" min="1000" step="1000" /></div>
      <div class="m-field"><label>Qtd no Mapa</label><input type="number" class="m-count" value="${mc.count || 8}" min="1" max="50" /></div>
      <button class="btn-save-monster" data-name="${name}">💾 Salvar ${name}</button>
    `;
    container.appendChild(card);
    card.querySelector('.btn-save-monster')?.addEventListener('click', () => {
      const hp = parseInt((card.querySelector('.m-hp') as HTMLInputElement).value) || 100;
      const atk = parseInt((card.querySelector('.m-atk') as HTMLInputElement).value) || 10;
      const spd = parseInt((card.querySelector('.m-spd') as HTMLInputElement).value) || 100;
      const exp = parseInt((card.querySelector('.m-exp') as HTMLInputElement).value) || 50;
      const agg = (card.querySelector('.m-aggro') as HTMLSelectElement).value === 'true';
      const respawn = parseInt((card.querySelector('.m-respawn') as HTMLInputElement).value) || 20000;
      const count = parseInt((card.querySelector('.m-count') as HTMLInputElement).value) || 8;
      socket?.emit('admin:setMonsterConfig', {
        name,
        partial: { health: hp, attack: atk, speed: spd, exp, isAggressive: agg, respawnMs: respawn, count }
      });
      showToast(`💾 ${name} atualizado!`);
    });
  }
}

// ===== Quick Player Search =====
let quickPlayerData: any = null;
document.getElementById('btn-quick-search')?.addEventListener('click', () => {
  const name = (document.getElementById('quick-player-search') as HTMLInputElement).value.trim();
  const errorEl = document.getElementById('quick-player-error')!;
  const resultEl = document.getElementById('quick-player-result')!;
  if (!name) { errorEl.innerText = 'Digite um nome.'; resultEl.style.display = 'none'; return; }
  const player = accountsCache.find(p => p.name?.toLowerCase() === name.toLowerCase());
  if (!player || !player.isOnline) {
    errorEl.innerText = 'Jogador não encontrado ou offline.';
    resultEl.style.display = 'none';
    quickPlayerData = null;
    return;
  }
  errorEl.innerText = '';
  quickPlayerData = player;
  document.getElementById('qp-name')!.textContent = player.name;
  document.getElementById('qp-level')!.textContent = 'Lv ' + player.level;
  document.getElementById('qp-gold')!.textContent = player.gold + 'G';
  document.getElementById('qp-hp')!.textContent = (player.health || '—') + '/' + (player.maxHealth || '—');
  document.getElementById('qp-stats')!.textContent = player.stats ? Object.entries(player.stats).map(([k, v]) => `${k}:${v}`).join(' ') : '—';
  document.getElementById('qp-online')!.textContent = 'Sim';
  document.getElementById('qp-online')!.style.color = '#10b981';
  resultEl.style.display = 'block';
});

document.getElementById('qp-btn-gold')?.addEventListener('click', () => {
  if (quickPlayerData) { socket?.emit('admin:giveGold', quickPlayerData.name); showToast(`💰 +1000 ouro para ${quickPlayerData.name}!`); }
});
document.getElementById('qp-btn-level-up')?.addEventListener('click', () => {
  if (quickPlayerData) { socket?.emit('admin:setLevel', { name: quickPlayerData.name, level: (quickPlayerData.level || 1) + 1 }); showToast(`⬆️ ${quickPlayerData.name} agora é Lv ${(quickPlayerData.level || 1) + 1}!`); }
});
document.getElementById('qp-btn-level-down')?.addEventListener('click', () => {
  if (quickPlayerData) { const lv = Math.max(1, (quickPlayerData.level || 2) - 1); socket?.emit('admin:setLevel', { name: quickPlayerData.name, level: lv }); showToast(`⬇️ ${quickPlayerData.name} agora é Lv ${lv}!`); }
});
document.getElementById('qp-btn-respec')?.addEventListener('click', () => {
  if (quickPlayerData && confirm(`Resetar stats de ${quickPlayerData.name}?`)) { socket?.emit('admin:respecPlayer', quickPlayerData.name); showToast(`✨ Stats de ${quickPlayerData.name} resetados!`); }
});
document.getElementById('qp-btn-kick')?.addEventListener('click', () => {
  if (quickPlayerData && confirm(`Desconectar ${quickPlayerData.name}?`)) { socket?.emit('admin:kickPlayer', quickPlayerData.id); showToast(`👢 ${quickPlayerData.name} desconectado!`); }
});
document.getElementById('qp-btn-ban')?.addEventListener('click', () => {
  if (quickPlayerData && confirm(`BANIR ${quickPlayerData.name} permanentemente?`)) {
    socket?.emit('admin:deletePlayer', quickPlayerData.name);
    showToast(`🚫 ${quickPlayerData.name} banido!`);
    document.getElementById('quick-player-result')!.style.display = 'none';
    quickPlayerData = null;
  }
});

const navServer = document.getElementById('nav-server');
if (navServer) {
  navServer.addEventListener('click', () => {
    socket?.emit('admin:getConfig');
    socket?.emit('admin:getMonsterConfigs');
  });
}

// ===== City Editor =====
const CITY_META: Record<string, { name: string; monster: string; boss: string; bgColor: string }> = {
  rat_city: { name:'Cidade dos Ratos', monster:'Giant Rat', boss:'Rat King', bgColor:'#4a3a2a' },
  orc_city: { name:'Cidade dos Orcs', monster:'Orc', boss:'Orc Warlord', bgColor:'#553322' },
  rotworm_city: { name:'Cidade dos Rotworms', monster:'Rotworm', boss:'Ancient Rotworm', bgColor:'#445533' },
  demon_city: { name:'Cidade dos Demônios', monster:'Demon Skeleton', boss:'Demon Lord', bgColor:'#551133' },
};

function loadCitiesAdmin() {
  socket?.emit('admin:getConfig');
  socket?.emit('admin:getCities');
  socket?.emit('admin:listEntities');
  renderCitiesAdmin();
  startCitiesPolling();
}

function startCitiesPolling() {
  if (citiesPollingInterval !== null) return;
  citiesPollingInterval = window.setInterval(() => { socket?.emit('admin:listEntities'); }, 5000);
}

function stopCitiesPolling() {
  if (citiesPollingInterval !== null) { clearInterval(citiesPollingInterval); citiesPollingInterval = null; }
}

function countMonstersInCity(city: any) {
  if (!city || !currentEntities) return { alive:0, total:0, bossAlive:false };
  const b = city.bounds;
  let alive = 0, total = 0, bossAlive = false, bossHp: number | undefined, bossMax: number | undefined;
  for (const e of currentEntities) {
    if (!e.isMonster) continue;
    if (e.x < b.xMin || e.x > b.xMax || e.y < b.yMin || e.y > b.yMax) continue;
    total++;
    if (e.id === `city_boss_${city.id}`) { bossAlive = !e.isDead; bossHp = e.health; bossMax = e.maxHealth; }
    else if (!e.isDead) alive++;
  }
  return { alive, total, bossAlive, bossHp, bossMax };
}

function renderCitiesAdmin() {
  const grid = document.getElementById('cities-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!currentCities || currentCities.length === 0) { grid.innerHTML = '<p style="color:var(--text-muted);">Carregando cidades...</p>'; return; }
  for (const city of currentCities) {
    const meta = CITY_META[city.id];
    if (!meta) continue;
    const c = countMonstersInCity(city);
    const bs = c.bossAlive ? `<span style="color:#10b981;">✓ vivo (${c.bossHp}/${c.bossMax})</span>` : `<span style="color:#ef4444;">✗ morto/ausente</span>`;
    const card = document.createElement('div');
    card.className = 'gm-card city-card';
    card.style.borderLeft = `4px solid ${meta.bgColor}`;
    card.innerHTML = `
      <h3 class="city-card-title" style="color:${meta.bgColor};margin-top:0;">⚔ ${meta.name} ▸</h3>
      <p style="font-size:12px;color:var(--text-muted);margin:6px 0;">Monstro: <b>${meta.monster}</b> · Lv min: <b>${city.minLevel}</b></p>
      <p style="font-size:12px;color:var(--text-muted);margin:4px 0;">Monstros vivos: <b style="color:#fbbf24;">${c.alive}</b> / ${c.total}</p>
      <p style="font-size:12px;color:var(--text-muted);margin:4px 0;">Boss (<b>${meta.boss}</b>): ${bs}</p>
      <div style="display:flex;gap:6px;margin-top:12px;"><button class="btn-submit btn-force-boss" data-city-id="${city.id}" style="background:#ef4444;flex:1;font-size:12px;">👹 Forçar Boss</button></div>
    `;
    card.addEventListener('click', (ev) => { if (!(ev.target as HTMLElement).closest('.btn-force-boss')) openCityDetail(city.id); });
    grid.appendChild(card);
    card.querySelector('.btn-force-boss')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Forçar spawn do boss de ${meta.name}?`)) socket?.emit('admin:forceCityBoss', city.id);
    });
  }
  renderPlazaInfo();
}

function renderPlazaInfo() {
  const card = document.getElementById('plaza-info-card');
  if (!card) return;
  const cb = currentConfig?.cityBounds || { xMin:100, xMax:130, yMin:100, yMax:130 };
  card.innerHTML = `
    <h3 style="color:#10b981;margin-top:0;">🛡 Praça Central (Safe Zone)</h3>
    <p style="font-size:12px;color:var(--text-muted);">Hub que conecta todas as 4 cidades. PvP é bloqueado aqui.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-family:monospace;font-size:12px;margin-top:8px;"><div>X: ${cb.xMin}–${cb.xMax}</div><div>Y: ${cb.yMin}–${cb.yMax}</div></div>
    <p style="font-size:11px;color:#64748b;margin-top:8px;">🔒 Editável em <code>server/src/core/serverConfig.ts</code></p>
  `;
}

function openCityDetail(cityId: string) {
  currentDetailCityId = cityId;
  const grid = document.getElementById('cities-grid-view'); if (grid) grid.style.display = 'none';
  const det = document.getElementById('city-detail-view'); if (det) det.style.display = 'block';
  renderCityDetail(cityId);
}

function closeCityDetail() {
  currentDetailCityId = null;
  const det = document.getElementById('city-detail-view'); if (det) det.style.display = 'none';
  const grid = document.getElementById('cities-grid-view'); if (grid) grid.style.display = 'block';
}

function renderCityDetail(cityId: string) {
  const city = currentCities.find(c => c.id === cityId);
  if (!city) return;
  const meta = CITY_META[cityId];
  if (!meta) return;
  const content = document.getElementById('city-detail-content');
  if (!content) return;
  const c = countMonstersInCity(city);
  const bs = c.bossAlive ? `<span style="color:#10b981;">✓ vivo (${c.bossHp}/${c.bossMax} HP)</span>` : `<span style="color:#ef4444;">✗ morto/ausente</span>`;
  const exp = (currentConfig?.expByMonster as any)?.[meta.monster] ?? 0;
  content.innerHTML = `
    <h2 style="color:${meta.bgColor};margin-top:0;">⚔ ${meta.name}</h2>
    <div class="gm-card" style="margin-top:16px;">
      <h3 style="margin-top:0;">📋 Informações (read-only)</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px;">
        <div><b>Monstro:</b> ${meta.monster}</div><div><b>Boss:</b> ${meta.boss}</div>
        <div><b>Bounds X:</b> ${city.bounds.xMin}–${city.bounds.xMax}</div><div><b>Bounds Y:</b> ${city.bounds.yMin}–${city.bounds.yMax}</div>
        <div><b>Portal In:</b> (${city.portalIn.x},${city.portalIn.y})</div><div><b>Portal Out:</b> (${city.portalOut.x},${city.portalOut.y})</div>
      </div>
      <p style="font-size:11px;color:#64748b;margin-top:12px;">🔒 Bounds e portais são read-only. Edite <code>serverConfig.ts</code>.</p>
    </div>
    <div class="gm-card" style="margin-top:16px;">
      <h3 style="margin-top:0;">📊 Status ao Vivo</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px;"><div><b>Monstros ativos:</b> <span style="color:#fbbf24;">${c.alive}/${c.total}</span></div><div><b>Boss:</b> ${bs}</div></div>
      <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">↻ Atualiza a cada 5s.</p>
    </div>
    <div class="gm-card" style="margin-top:16px;">
      <h3 style="margin-top:0;">⚙️ Configuração Editável</h3>
      <div class="form-group"><label>Nível mínimo (atual: <b>${city.minLevel}</b>)</label><div style="display:flex;gap:8px;"><input type="number" id="edit-min-level" min="1" value="${city.minLevel}" style="flex:1;" /><button class="btn-submit" id="btn-save-minlevel" style="background:#10b981;">💾 Salvar</button></div></div>
      <div class="form-group"><label>EXP por kill (atual: <b>${exp}</b>)</label><div style="display:flex;gap:8px;"><input type="number" id="edit-monster-exp" min="0" value="${exp}" style="flex:1;" /><button class="btn-submit" id="btn-save-exp" style="background:#10b981;">💾 Salvar</button></div></div>
      <h4 style="color:${meta.bgColor};margin-top:20px;">Boss — ${meta.boss}</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${['health','attack','speed','exp'].map(f => `
          <div class="form-group"><label>${f} (atual: ${city.bossStats[f]})</label><div style="display:flex;gap:6px;"><input type="number" id="edit-boss-${f}" min="1" value="${city.bossStats[f]}" style="flex:1;" /><button class="btn-submit btn-save-boss" data-field="${f}" style="background:#10b981;font-size:12px;">💾</button></div></div>
        `).join('')}
      </div>
    </div>
    <div class="gm-card" style="margin-top:16px;background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.3);">
      <h3 style="margin-top:0;color:#ef4444;">👹 Forçar Spawn do Boss</h3>
      <button class="btn-submit" id="btn-force-boss-detail" style="background:#ef4444;width:100%;padding:12px;">👹 Forçar Spawn do Boss Agora</button>
    </div>
  `;
  document.getElementById('btn-save-minlevel')?.addEventListener('click', () => {
    const v = parseInt((document.getElementById('edit-min-level') as HTMLInputElement).value) || 1;
    socket?.emit('admin:editCity', { cityId, minLevel: v });
    showToast(`⏳ Salvando minLevel...`);
  });
  document.getElementById('btn-save-exp')?.addEventListener('click', () => {
    const v = parseInt((document.getElementById('edit-monster-exp') as HTMLInputElement).value) || 0;
    if (currentConfig) {
      if (!currentConfig.expByMonster) currentConfig.expByMonster = {};
      currentConfig.expByMonster[meta.monster] = v;
      socket?.emit('admin:setConfig', { expByMonster: currentConfig.expByMonster });
      showToast(`⏳ Salvando EXP...`);
    }
  });
  document.querySelectorAll<HTMLButtonElement>('.btn-save-boss').forEach(btn => {
    btn.onclick = () => {
      const field = btn.dataset.field!;
      const v = parseInt((document.getElementById(`edit-boss-${field}`) as HTMLInputElement).value) || 0;
      socket?.emit('admin:editCity', { cityId, bossStats: { [field]: v } });
      showToast(`⏳ Salvando ${field}...`);
    };
  });
  document.getElementById('btn-force-boss-detail')?.addEventListener('click', () => {
    if (confirm(`Forçar spawn do boss de ${meta.name}?`)) socket?.emit('admin:forceCityBoss', cityId);
  });
}

document.getElementById('btn-city-back')?.addEventListener('click', closeCityDetail);
document.getElementById('btn-teleport')?.addEventListener('click', () => {
  const name = (document.getElementById('tp-name') as HTMLInputElement).value.trim();
  const dest = (document.getElementById('tp-destination') as HTMLSelectElement).value;
  if (!name) { showToast('Digite o nome do jogador.', 'error'); return; }
  socket?.emit('admin:teleportToCity', { name, cityId: dest });
  showToast(`🌀 Teleporte de ${name} enviado!`);
  (document.getElementById('tp-name') as HTMLInputElement).value = '';
});

// ===== NPC Vendors Admin =====
const ALL_VENDOR_ITEMS: { name: string; emoji: string }[] = [
  { name: 'Torch', emoji: '🔦' }, { name: 'Health Potion', emoji: '🧪' }, { name: 'Mana Potion', emoji: '💙' },
  { name: 'Steel Sword', emoji: '🗡️' }, { name: 'Wood Sword', emoji: '🗡️' }, { name: 'Helmet', emoji: '👑' },
  { name: 'Armor', emoji: '👕' }, { name: 'Pants', emoji: '👖' }, { name: 'Leather Boots', emoji: '🥾' },
  { name: 'Apple', emoji: '🍎' }, { name: 'Cheese', emoji: '🧀' }, { name: 'Blueberry', emoji: '🍇' },
  { name: 'Iron Ore', emoji: '🌑' }, { name: 'Wood Log', emoji: '🌲' }, { name: 'Medicinal Herb', emoji: '🌿' },
  { name: 'Leather Hide', emoji: '📦' }, { name: 'Gold Coin', emoji: '💰' },
  { name: 'Leather Backpack', emoji: '🎒' }, { name: 'Wooden Backpack', emoji: '💼' }, { name: 'Iron Backpack', emoji: '🧳' },
  { name: 'Skull', emoji: '💀' },
];
let currentVendors: any[] = [];

function loadVendorsAdmin() {
  socket?.emit('admin:getVendors');
  socket?.emit('admin:getConfig'); // para ter lista de itens conhecidos
  renderVendorsAdmin();
}

function renderVendorsAdmin() {
  const grid = document.getElementById('vendors-grid');
  if (!grid) return;
  if (!currentVendors || currentVendors.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;">Carregando vendedores...</p>';
    return;
  }
  grid.innerHTML = '';
  for (const v of currentVendors) {
    const card = document.createElement('div');
    card.className = 'gm-card';
    card.style.borderLeft = '4px solid #fbbf24';
    const stockHtml = (v.stock || []).map((item: any, idx: number) => `
      <div class="v-item-row" style="display:flex;flex-direction:column;gap:6px;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:8px;">
        <div style="display:flex;gap:8px;align-items:center;">
          <select class="v-item-name" data-idx="${idx}" style="flex:1;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:8px;border-radius:6px;font-size:13px;">
            ${ALL_VENDOR_ITEMS.map(i => `<option value="${i.name}" ${i.name === item.name ? 'selected' : ''}>${i.emoji} ${i.name}</option>`).join('')}
          </select>
          <input type="text" class="v-item-emoji" data-idx="${idx}" value="${item.emoji || ''}" placeholder="emoji" style="width:60px;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:8px;border-radius:6px;font-size:13px;text-align:center;" maxlength="2" />
          <button class="btn btn-kick btn-vendor-del" data-vendor-id="${v.id}" data-idx="${idx}" style="padding:6px 10px;font-size:11px;background:#991b1b;">🗑️</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:12px;color:var(--text-muted);white-space:nowrap;">Preço:</span>
          <input type="number" class="v-item-price" data-idx="${idx}" value="${item.price}" min="1" step="1" style="flex:1;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:8px;border-radius:6px;font-size:13px;" />
        </div>
      </div>
    `).join('');
    card.innerHTML = `
      <h3 style="color:#fbbf24;margin-top:0;">🏪 ${v.name} (${v.id})</h3>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">Localização: <b>${v.x}, ${v.y}</b> · Cidade: <b>${v.cityId || 'plaza'}</b></p>
      <div style="margin-bottom:12px;">${stockHtml}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-gold btn-vendor-add" data-vendor-id="${v.id}" style="font-size:12px;">➕ Add Item</button>
        <button class="btn btn-edit btn-vendor-save" data-vendor-id="${v.id}" style="background:#10b981;font-size:12px;">💾 Salvar Estoque</button>
      </div>
    `;
    grid.appendChild(card);
    card.querySelectorAll('.btn-vendor-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((e.currentTarget as HTMLButtonElement).dataset.idx!);
        const vendorId = (e.currentTarget as HTMLButtonElement).dataset.vendorId;
        if (vendorId) deleteVendorItem(vendorId, idx);
      });
    });
    card.querySelector('.btn-vendor-add')?.addEventListener('click', (e) => {
      const vendorId = (e.currentTarget as HTMLButtonElement).dataset.vendorId;
      if (vendorId) addVendorItem(vendorId);
    });
    card.querySelector('.btn-vendor-save')?.addEventListener('click', (e) => {
      const vendorId = (e.currentTarget as HTMLButtonElement).dataset.vendorId;
      if (vendorId) saveVendorStock(vendorId, card);
    });
    card.querySelectorAll('.v-item-name').forEach(el => {
      el.addEventListener('change', () => autoFillVendorEmoji(el as HTMLSelectElement));
    });
  }
}

function addVendorItem(vendorId: string) {
  const vendor = currentVendors.find(v => v.id === vendorId);
  if (!vendor) return;
  const defaultItem = ALL_VENDOR_ITEMS[0];
  const newItem = { name: defaultItem.name, emoji: defaultItem.emoji, price: 10 };
  if (!vendor.stock) vendor.stock = [];
  vendor.stock.push(newItem);
  renderVendorsAdmin();
}

function deleteVendorItem(vendorId: string, idx: number) {
  const vendor = currentVendors.find(v => v.id === vendorId);
  if (!vendor || !vendor.stock) return;
  vendor.stock.splice(idx, 1);
  renderVendorsAdmin();
}

function autoFillVendorEmoji(selectEl: HTMLSelectElement) {
  const emojiInput = selectEl.closest('.v-item-row')?.querySelector('.v-item-emoji') as HTMLInputElement;
  if (emojiInput) {
    const match = ALL_VENDOR_ITEMS.find(i => i.name === selectEl.value);
    if (match) emojiInput.value = match.emoji;
  }
}

function saveVendorStock(vendorId: string, cardEl: HTMLElement) {
  const vendor = currentVendors.find(v => v.id === vendorId);
  if (!vendor) return;
  const newStock: any[] = [];
  const nameSelects = cardEl.querySelectorAll<HTMLSelectElement>('.v-item-name');
  const emojiInputs = cardEl.querySelectorAll<HTMLInputElement>('.v-item-emoji');
  const priceInputs = cardEl.querySelectorAll<HTMLInputElement>('.v-item-price');
  for (let i = 0; i < nameSelects.length; i++) {
    const name = nameSelects[i].value.trim();
    const emoji = emojiInputs[i].value.trim();
    const price = parseInt(priceInputs[i].value) || 1;
    if (name) newStock.push({ name, emoji: emoji || '📦', price });
  }
  vendor.stock = newStock;
  socket?.emit('admin:setVendorStock', { vendorId, stock: newStock });
  showToast(`✅ Estoque de ${vendor.name} salvo!`);
}

// ===== NPC Crafting Stations Admin =====
let currentCraftingStations: any[] = [];
let currentRecipes: any[] = [];

function loadCraftersAdmin() {
  socket?.emit('admin:getCrafters');
  renderCraftersAdmin();
}

function renderRecipeForm(container: HTMLElement, stationType: string, recipe?: any) {
  const isNew = !recipe;
  const rid = recipe?.id || `recipe_${Date.now()}`;
  const rname = recipe?.name || '';
  const rresult = recipe?.resultItem || ALL_VENDOR_ITEMS[0].name;
  const rlevel = recipe?.levelRequired || 1;
  const rtime = recipe?.craftTimeMs ? (recipe.craftTimeMs / 1000) : 2;
  const rfee = recipe?.craftFee ?? 0;
  const ringredients = recipe?.ingredients || [{ itemName: ALL_VENDOR_ITEMS[0].name, count: 1 }];

  const form = document.createElement('div');
  form.className = 'recipe-form';
  form.style.cssText = 'padding:12px;background:rgba(0,0,0,0.25);border-radius:8px;margin-bottom:10px;border:1px solid rgba(245,158,11,0.3);';

  const itemOptions = ALL_VENDOR_ITEMS.map(i => `<option value="${i.name}" ${i.name === rresult ? 'selected' : ''}>${i.emoji} ${i.name}</option>`).join('');

  form.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
      <input type="text" class="rf-name" value="${rname}" placeholder="Nome da receita" style="flex:2;min-width:120px;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:8px;border-radius:6px;font-size:13px;" />
      <select class="rf-result" style="flex:1;min-width:100px;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:8px;border-radius:6px;font-size:13px;">${itemOptions}</select>
      <input type="number" class="rf-level" value="${rlevel}" placeholder="Nível" min="1" style="width:70px;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:8px;border-radius:6px;font-size:13px;" />
      <input type="number" class="rf-time" value="${rtime}" placeholder="Tempo (s)" min="0.5" step="0.5" style="width:80px;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:8px;border-radius:6px;font-size:13px;" />
      <input type="number" class="rf-fee" value="${rfee}" placeholder="Taxa" min="0" style="width:80px;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:8px;border-radius:6px;font-size:13px;" />
      ${isNew ? '' : `<button class="btn btn-kick rf-delete" data-rid="${rid}" style="padding:6px 10px;font-size:11px;background:#991b1b;">🗑️</button>`}
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Ingredientes:</div>
    <div class="rf-ingredients">
      ${ringredients.map((ing: any, i: number) => `
        <div class="rf-ing-row" style="display:flex;gap:6px;margin-bottom:4px;">
          <select class="rf-ing-name" data-idx="${i}" style="flex:1;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:6px;border-radius:6px;font-size:12px;">
            ${ALL_VENDOR_ITEMS.map(ai => `<option value="${ai.name}" ${ai.name === ing.itemName ? 'selected' : ''}>${ai.emoji} ${ai.name}</option>`).join('')}
          </select>
          <input type="number" class="rf-ing-count" data-idx="${i}" value="${ing.count}" min="1" style="width:60px;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:6px;border-radius:6px;font-size:12px;" />
          <button class="btn btn-kick rf-ing-del" data-idx="${i}" style="padding:4px 8px;font-size:10px;background:#991b1b;">✕</button>
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="btn btn-gold rf-ing-add" style="font-size:11px;padding:6px 12px;">➕ Ingrediente</button>
      <button class="btn btn-edit rf-save" data-rid="${rid}" data-station="${stationType}" style="background:#10b981;font-size:11px;padding:6px 12px;">💾 Salvar Receita</button>
    </div>
  `;
  container.appendChild(form);

  form.querySelector('.rf-ing-add')?.addEventListener('click', () => {
    const ingContainer = form.querySelector('.rf-ingredients')!;
    const idx = ingContainer.children.length;
    const row = document.createElement('div');
    row.className = 'rf-ing-row';
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;';
    row.innerHTML = `
      <select class="rf-ing-name" data-idx="${idx}" style="flex:1;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:6px;border-radius:6px;font-size:12px;">
        ${ALL_VENDOR_ITEMS.map(ai => `<option value="${ai.name}">${ai.emoji} ${ai.name}</option>`).join('')}
      </select>
      <input type="number" class="rf-ing-count" data-idx="${idx}" value="1" min="1" style="width:60px;background:rgba(0,0,0,0.4);border:1px solid var(--glass-border);color:white;padding:6px;border-radius:6px;font-size:12px;" />
      <button class="btn btn-kick rf-ing-del" data-idx="${idx}" style="padding:4px 8px;font-size:10px;background:#991b1b;">✕</button>
    `;
    ingContainer.appendChild(row);
    row.querySelector('.rf-ing-del')?.addEventListener('click', () => row.remove());
  });

  form.querySelectorAll('.rf-ing-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = (e.currentTarget as HTMLElement).closest('.rf-ing-row');
      if (row) row.remove();
    });
  });

  form.querySelector('.rf-save')?.addEventListener('click', () => {
    const name = (form.querySelector('.rf-name') as HTMLInputElement).value.trim();
    const resultItem = (form.querySelector('.rf-result') as HTMLSelectElement).value;
    const levelRequired = parseInt((form.querySelector('.rf-level') as HTMLInputElement).value) || 1;
    const craftTimeMs = Math.round((parseFloat((form.querySelector('.rf-time') as HTMLInputElement).value) || 2) * 1000);
    const craftFee = parseInt((form.querySelector('.rf-fee') as HTMLInputElement).value) || 0;
    const ingredients: { itemName: string; count: number }[] = [];
    form.querySelectorAll('.rf-ing-row').forEach(row => {
      const nameEl = row.querySelector('.rf-ing-name') as HTMLSelectElement;
      const countEl = row.querySelector('.rf-ing-count') as HTMLInputElement;
      if (nameEl && countEl) {
        const itemName = nameEl.value;
        const count = parseInt(countEl.value) || 1;
        ingredients.push({ itemName, count });
      }
    });
    const professionMap: Record<string, string> = { forge: 'smithing', alchemy: 'alchemy', tanning: 'tanning' };
    const recipe: any = {
      id: rid,
      name: name || resultItem,
      profession: professionMap[stationType] || 'smithing',
      stationType,
      levelRequired,
      ingredients,
      resultItem,
      craftTimeMs,
      craftFee
    };
    socket?.emit('admin:setRecipe', { recipe });
    showToast(`✅ Receita ${recipe.name} salva!`);
  });

  if (!isNew) {
    form.querySelector('.rf-delete')?.addEventListener('click', () => {
      socket?.emit('admin:deleteRecipe', { recipeId: rid });
      form.remove();
      showToast('🗑️ Receita removida!');
    });
  }
}

function renderCraftersAdmin() {
  const grid = document.getElementById('crafters-grid');
  if (!grid) return;
  if (!currentCraftingStations || currentCraftingStations.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);">Carregando estações de craft...</p>';
    return;
  }
  grid.innerHTML = '';
  for (const station of currentCraftingStations) {
    const card = document.createElement('div');
    card.className = 'gm-card';
    const stationType = station.type;
    const stationRecipes = currentRecipes.filter((r: any) => r.stationType === stationType);
    card.innerHTML = `
      <h3 style="color:#f59e0b;margin-top:0;">${station.emoji} ${station.name}</h3>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">ID: <b>${station.id}</b> · Localização: <b>${station.x}, ${station.y}</b></p>
      <div id="recipes-${stationType}"></div>
      <div style="margin-top:12px;"><button class="btn btn-gold rf-add-new" data-station="${stationType}" style="font-size:12px;">➕ Nova Receita</button></div>
    `;
    grid.appendChild(card);
    const recipeContainer = card.querySelector(`#recipes-${stationType}`)!;
    stationRecipes.forEach((r: any) => renderRecipeForm(recipeContainer as HTMLElement, stationType, r));
    card.querySelector('.rf-add-new')?.addEventListener('click', () => {
      renderRecipeForm(recipeContainer as HTMLElement, stationType);
    });
  }
}

// ===== NPC Teleporter Admin =====
let currentTeleporters: any[] = [];

function loadTeleporterAdmin() {
  socket?.emit('admin:getTeleporters');
  renderTeleporterAdmin();
}

function renderTeleporterAdmin() {
  const grid = document.getElementById('teleporter-grid');
  if (!grid) return;
  if (!currentTeleporters || currentTeleporters.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);">Carregando teleporters...</p>';
    return;
  }
  grid.innerHTML = '';
  for (const tp of currentTeleporters) {
    const card = document.createElement('div');
    card.className = 'gm-card';
    const kindLabels: Record<string, string> = { hub: 'Central (Praça)', cityReturn: 'Retorno (Cidade)', cavernaReturn: 'Retorno (Caverna)' };
    card.innerHTML = `
      <h3 style="color:#8b5cf6;margin-top:0;">🌀 ${tp.name}</h3>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">ID: <b>${tp.id}</b> · Local: <b>${tp.x}, ${tp.y}</b></p>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Tipo: <b>${kindLabels[tp.kind] || tp.kind}</b> ${tp.cityId ? `· Cidade: <b>${tp.cityId}</b>` : ''}</p>
      <p style="font-size:11px;color:#64748b;margin-top:8px;">🔒 Configurável em <code>serverConfig.ts</code> (read-only no painel)</p>
    `;
    grid.appendChild(card);
  }
}

// ===== NPC Bank Admin =====
function loadBankAdmin() {
  socket?.emit('admin:getConfig');
  renderBankAdmin();
}

function renderBankAdmin() {
  const container = document.getElementById('bank-config');
  if (!container) return;
  const cfg = currentConfig;
  if (!cfg) {
    container.innerHTML = '<p style="color:var(--text-muted);">Carregando configuração do banco...</p>';
    return;
  }
  const bankSlots = cfg.bankSlots ?? 50;
  const bankDistance = cfg.bankDistanceCheck ?? 2;
  container.innerHTML = `
    <h3 style="color:#10b981;margin-top:0;">🏦 Configurações do Banco</h3>
    <div class="form-group">
      <label>Slots do Banco</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" id="bank-slots" value="${bankSlots}" min="10" max="200" style="flex:1;" />
        <button class="btn-submit" id="btn-save-bank-slots" style="background:#10b981;">💾 Salvar</button>
      </div>
    </div>
    <div class="form-group">
      <label>Distância Máxima para Interagir (tiles)</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" id="bank-distance" value="${bankDistance}" min="1" max="10" style="flex:1;" />
        <button class="btn-submit" id="btn-save-bank-distance" style="background:#10b981;">💾 Salvar</button>
      </div>
    </div>
    <p style="font-size:11px;color:#64748b;margin-top:12px;">⏳ Alterações salvam automaticamente no servidor.</p>
  `;
  document.getElementById('btn-save-bank-slots')?.addEventListener('click', () => {
    const v = parseInt((document.getElementById('bank-slots') as HTMLInputElement).value) || 50;
    socket?.emit('admin:setConfig', { bankSlots: v });
    showToast(`✅ Slots do banco atualizados para ${v}!`);
  });
  document.getElementById('btn-save-bank-distance')?.addEventListener('click', () => {
    const v = parseInt((document.getElementById('bank-distance') as HTMLInputElement).value) || 2;
    socket?.emit('admin:setConfig', { bankDistanceCheck: v });
    showToast(`✅ Distância do banco atualizada para ${v} tiles!`);
  });
}


