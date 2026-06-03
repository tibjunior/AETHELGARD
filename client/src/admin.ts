import { io, Socket } from 'socket.io-client';

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const defaultUrl = isLocal ? 'http://localhost:3000' : 'https://aethelgard-server-9go1.onrender.com';
const serverUrl = (import.meta as any).env.VITE_SERVER_URL || defaultUrl;

const socket: Socket = io(serverUrl, {
    auth: { name: 'AdminGM' }
});

// Cache local das contas recebidas para preencher o formulário do modal
let accountsCache: any[] = [];

socket.on('connect', () => {
    console.log('Conectado como Administrador.');
    fetchPlayers();
});

socket.on('admin:playersData', (players: any[]) => {
    accountsCache = players;
    renderPlayers(players);
    updateStats(players);
});

socket.on('admin:playerUpdated', () => {
    fetchPlayers();
});

function fetchPlayers() {
    socket.emit('admin:getPlayers');
}

function renderPlayers(players: any[]) {
    const tbody = document.getElementById('players-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (players.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">Nenhuma conta cadastrada ou online no momento.</td></tr>';
        return;
    }

    players.forEach(p => {
        const tr = document.createElement('tr');
        const isOnlineClass = p.isOnline ? 'status-online' : 'status-offline';
        const isOnlineText = p.isOnline ? 'Online' : 'Offline';
        const kickDisabled = p.isOnline ? '' : 'disabled';
        const displayId = p.id ? p.id.substring(0, 4) : 'DB';
        
        tr.innerHTML = `
            <td>
               <span class="status-badge ${isOnlineClass}">
                  <span class="status-dot"></span> ${isOnlineText}
               </span>
            </td>
            <td style="font-weight: 600;">${p.name} <span style="color: #64748b; font-size: 11px;">(${displayId})</span></td>
            <td>Lvl ${p.level}</td>
            <td style="color: #fbbf24; font-weight: bold;">${p.gold} G</td>
            <td>${p.statPoints}</td>
            <td class="actions">
                <button class="btn btn-gold" onclick="window.giveGold('${p.name}')">+1000G</button>
                <button class="btn btn-reset" onclick="window.resetPlayer('${p.name}')">Reset</button>
                <button class="btn btn-edit" onclick="window.openEditModal('${p.name}')">Editar</button>
                <button class="btn btn-kick" ${kickDisabled} onclick="window.kickPlayer('${p.id}')">Kick</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateStats(players: any[]) {
    const totalEl = document.getElementById('total-online');
    const registeredEl = document.getElementById('total-registered');
    const avgEl = document.getElementById('avg-level');
    
    const onlineCount = players.filter(p => p.isOnline).length;
    
    if (totalEl) totalEl.innerText = onlineCount.toString();
    if (registeredEl) registeredEl.innerText = players.length.toString();
    
    let totalLevel = 0;
    players.forEach(p => {
        totalLevel += p.level || 1;
    });
    
    if (avgEl) {
        const avg = players.length > 0 ? (totalLevel / players.length).toFixed(1) : '0';
        avgEl.innerText = avg;
    }
}

// Global functions for inline HTML event handlers
(window as any).giveGold = (name: string) => {
    socket.emit('admin:giveGold', name);
};

(window as any).resetPlayer = (name: string) => {
    if(confirm(`Tem certeza que deseja resetar os atributos de ${name}? Ele voltará ao Level 1.`)) {
        socket.emit('admin:resetPlayer', name);
    }
};

(window as any).kickPlayer = (id: string) => {
    if(confirm('Tem certeza que deseja desconectar (kickar) este jogador?')) {
        socket.emit('admin:kickPlayer', id);
    }
};

(window as any).openEditModal = (name: string) => {
    const player = accountsCache.find(p => p.name === name);
    if (!player) return;
    
    (document.getElementById('edit-player-name') as HTMLInputElement).value = player.name;
    (document.getElementById('edit-player-level') as HTMLInputElement).value = player.level;
    (document.getElementById('edit-player-gold') as HTMLInputElement).value = player.gold;
    (document.getElementById('edit-player-points') as HTMLInputElement).value = player.statPoints;
    
    document.getElementById('edit-modal')!.style.display = 'flex';
};

// Modal Actions
document.getElementById('btn-edit-cancel')?.addEventListener('click', () => {
    document.getElementById('edit-modal')!.style.display = 'none';
});

document.getElementById('btn-edit-save')?.addEventListener('click', () => {
    const name = (document.getElementById('edit-player-name') as HTMLInputElement).value;
    const level = parseInt((document.getElementById('edit-player-level') as HTMLInputElement).value) || 1;
    const gold = parseInt((document.getElementById('edit-player-gold') as HTMLInputElement).value) || 0;
    const statPoints = parseInt((document.getElementById('edit-player-points') as HTMLInputElement).value) || 0;
    
    socket.emit('admin:editPlayer', { name, level, gold, statPoints });
    document.getElementById('edit-modal')!.style.display = 'none';
});

// Navigation Tabs
const tabs = ['players', 'server', 'spawner'];
tabs.forEach(tab => {
    document.getElementById(`nav-${tab}`)?.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Ativa link
        tabs.forEach(t => {
            document.getElementById(`nav-${t}`)?.classList.remove('active');
            document.getElementById(`tab-${t}`)!.style.display = 'none';
        });
        document.getElementById(`nav-${tab}`)?.classList.add('active');
        document.getElementById(`tab-${tab}`)!.style.display = 'flex';
        
        // Altera Título
        const titles: Record<string, string> = {
            players: 'Gerenciamento de Contas',
            server: 'Comandos do Servidor',
            spawner: 'Gerador de Entidades e Itens'
        };
        document.getElementById('page-title')!.innerText = titles[tab];
    });
});

// Server Commands
document.getElementById('btn-broadcast-submit')?.addEventListener('click', () => {
    const input = document.getElementById('broadcast-msg') as HTMLInputElement;
    if (input.value.trim() !== '') {
        socket.emit('admin:broadcast', input.value);
        alert('Anúncio enviado!');
        input.value = '';
    }
});

document.getElementById('btn-time-day')?.addEventListener('click', () => {
    socket.emit('admin:setTime', false);
    alert('Forçado: Dia!');
});

document.getElementById('btn-time-night')?.addEventListener('click', () => {
    socket.emit('admin:setTime', true);
    alert('Forçado: Noite!');
});

// Spawners
document.getElementById('btn-spawn-entity')?.addEventListener('click', () => {
    const name = (document.getElementById('spawn-entity-name') as HTMLSelectElement).value;
    
    socket.emit('admin:spawnEntity', { name });
    alert(`${name} invocado no mapa em uma posição aleatória!`);
});

document.getElementById('btn-spawn-item')?.addEventListener('click', () => {
    const name = (document.getElementById('spawn-item-name') as HTMLSelectElement).value;
    
    socket.emit('admin:spawnItem', { name });
    alert(`${name} gerado no mapa em uma posição aleatória!`);
});

// Refresh button
document.getElementById('btn-refresh')?.addEventListener('click', () => {
    fetchPlayers();
});
