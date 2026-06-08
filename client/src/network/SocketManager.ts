import { io, Socket } from 'socket.io-client';
import { GameScene } from '../scenes/GameScene';
import { Position } from '../../../shared/types';

export class SocketManager {
  public socket!: Socket;
  private scene: GameScene;

  constructor(scene: GameScene) {
    this.scene = scene;
  }

  public connect(playerName: string) {
    // Em localhost, usa o proxy do Vite (mesma origem) — elimina CORS no desenvolvimento.
    // Em produção (acesso externo), usa VITE_SERVER_URL.
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const defaultUrl = isLocal ? window.location.origin : 'https://aethelgard-server-9go1.onrender.com';
    const serverUrl = (import.meta as any).env.VITE_SERVER_URL || defaultUrl;

    this.socket = io(serverUrl, {
        auth: {
            name: playerName,
            password: (window as any).playerPassword
        },
        transports: ['websocket', 'polling']
    });

    this.setupListeners();
    
    (window as any).socket = this.socket;
    
    // Expose global for HTML clicks
    (window as any).sendAddStat = (statName: string) => {
        if (this.socket) this.socket.emit('addStat', statName);
    };
  }

  public attachExisting(existingSocket: Socket) {
    this.socket = existingSocket;
    this.setupListeners();
    (window as any).socket = existingSocket;
    (window as any).sendAddStat = (statName: string) => {
      if (this.socket) this.socket.emit('addStat', statName);
    };
    console.log('[SocketManager] attached existing socket', this.socket.id);
    // Conecta um handler global que recebe TODOS os eventos do jogo (incluindo os bufferados)
    (window as any).__onGameEvent = (event: string, data: any) => this.routeGameEvent(event, data);
    // Drena o buffer de eventos que chegaram antes do attach
    if ((window as any).__flushGameEvents) {
      (window as any).__flushGameEvents((evt: string, data: any) => this.routeGameEvent(evt, data));
    }
  }

  private routeGameEvent(event: string, data: any) {
    switch (event) {
      case 'init': this.scene.onLocalPlayerInit(data); break;
      case 'mapData': this.scene.onMapData(data); break;
      case 'cities:data': this.scene.onCitiesData(data); break;
      case 'plaza:data': this.scene.onPlazaData(data); break;
      case 'timeUpdate': {
        this.scene.setNight(data.isNight);
        this.scene.addServerMessage(data.isNight ? 'Anoiteceu nas terras de Aethelgard' : 'Amanheceu nas terras de Aethelgard');
        break;
      }
      case 'currentPlayers': this.scene.onCurrentPlayers(data); break;
      case 'playerJoined': this.scene.onPlayerJoined(data); break;
      case 'playerMoved': this.scene.onPlayerMoved(data); break;
      case 'playerDashed': this.scene.onPlayerDashed(data); break;
      case 'itemDropped': this.scene.onItemDropped(data); break;
      case 'itemRemoved': this.scene.onItemRemoved(data); break;
      case 'itemPickedUp': this.scene.onItemPickedUp(data); break;
      case 'inventoryUpdate': {
        this.scene.onInventoryUpdate(data);
        if ((window as any).updateHotkeyBar) {
          (window as any).updateHotkeyBar(data);
        }
        // Re-renderiza aba de vender se vendor ou shop UI estiver aberto na aba Vender
        const vendorUi = document.getElementById('vendor-ui');
        if (vendorUi && vendorUi.style.display === 'flex') {
          const sellTab = document.getElementById('vendor-tab-sell');
          if (sellTab && (sellTab.style.background === '#92400e' || sellTab.style.background === 'rgb(146, 64, 14)')) {
            this.renderVendorSell();
          }
        }
        const shopUi = document.getElementById('shop-ui');
        if (shopUi && shopUi.style.display === 'flex') {
          const shopSellTab = document.getElementById('tab-sell');
          if (shopSellTab && (shopSellTab.style.background === '#333' || shopSellTab.style.background === 'rgb(51, 51, 51)')) {
            this.scene.renderShopSell();
          }
        }
        break;
      }
      case 'equipmentUpdate': this.scene.onEquipmentUpdate(data); break;
      case 'statsUpdate': {
        this.scene.onStatsUpdate(data);
        if (data.id === this.socket.id && data.level !== undefined) {
          const levelEl = document.getElementById('player-level-display');
          if (levelEl) levelEl.innerText = `Level ${data.level}`;
        }
        break;
      }
      case 'bank:update': this.scene.onBankUpdate(data); break;
      case 'textEffect': this.scene.onTextEffect(data.x, data.y, data.text || data.message || '', data.color); break;
      case 'levelUp': this.scene.onLevelUp(data); break;
      case 'playerDamaged': this.scene.onPlayerDamaged(data); break;
      case 'entity:info': this.scene.onEntityInfo(data); break;
      case 'timeSync': /* clock handled by main UI */ break;
      case 'bossSpawned': this.scene.addServerMessage(`O aterrorizante ${data.name} nasceu`, true); break;
      case 'teleporter:destinations': console.log('[NPC] evento teleporter:destinations recebido', data); this.openTeleporter(data.destinations); break;
      case 'vendor:open': console.log('[NPC] evento vendor:open recebido', data); this.openVendor(data.name, data.stock); break;
      default: console.warn('[SocketManager] unhandled game event:', event);
    }
  }

  public getId(): string | undefined {
    return this.socket.id;
  }

  private setupListeners() {
    this.socket.on('connect', () => {
      console.log('🔗 Conectado ao servidor Aethelgard');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Desconectado:', reason);
      // NÃO recarregar a página — isso destruía o estado do usuário.
      // Apenas loga. O main.ts cuida de mostrar toast e reconectar.
    });

    this.socket.on('loginFailed', (data: { message: string }) => {
        alert("Falha no Login: " + data.message);
        document.getElementById('login-screen')!.style.display = 'flex';
        // Remove from global
        (window as any).playerName = undefined;
        (window as any).playerPassword = undefined;
    });

    this.socket.on('projectileCreated', (data: any) => {
      this.scene.onProjectileCreated(data);
    });
    this.socket.on('projectileMoved', (data: any) => {
      this.scene.onProjectileMoved(data);
    });
    this.socket.on('projectileDestroyed', (id: string) => {
      this.scene.onProjectileDestroyed(id);
    });

    this.socket.on('playerLeft', (id: string) => {
      this.scene.onPlayerLeft(id);
    });

    this.socket.on('playerSpoke', (data: { id: string, message: string }) => {
      this.scene.onPlayerSpoke(data.id, data.message);
    });

    this.socket.on('spellCast', (data: {casterId: string, targetId?: string, spell: string}) => {
        this.scene.onSpellCast(data);
    });
    
    this.socket.on('timeSync', (data: { isNight: boolean, secondsLeft: number }) => {
        const icon = data.isNight ? '🌙' : '☀️';
        const sec = data.secondsLeft;
        const min = Math.floor(sec / 60);
        const remSec = sec % 60;
        const timeStr = `0${min}:${remSec < 10 ? '0' : ''}${remSec}`;
        const clockIcon = document.getElementById('clock-icon');
        const clockTime = document.getElementById('clock-time');
        
        if (clockIcon && clockTime) {
            clockIcon.innerText = icon;
            clockTime.innerText = timeStr;
            clockTime.style.color = sec <= 5 ? '#ff4444' : '#ffffff'; // Fica vermelho nos ultimos 5 segundos
        }
    });

    this.socket.on('resourceNodeUpdated', (data: any) => {
      this.scene.onResourceNodeUpdated(data);
    });

    this.socket.on('gatheringStarted', (data: { duration: number, nodeType: string }) => {
      this.scene.onGatheringStarted(data.duration, data.nodeType);
    });

    this.socket.on('gatheringCancelled', () => {
      this.scene.onGatheringCancelled();
    });

    this.socket.on('recallStarted', (data: { duration: number }) => {
      this.scene.onRecallStarted(data.duration);
    });

    this.socket.on('recallCancelled', () => {
      this.scene.onRecallCancelled();
    });

    this.socket.on('recallCompleted', () => {
      this.scene.onRecallCompleted();
    });

    this.socket.on('playerDied', (data: { lostItems: string[] }) => {
      this.scene.onLocalPlayerDeath(data.lostItems);
    });

    this.socket.on('auctionList', (list: any[]) => {
      this.scene.renderAuctionList(list);
    });

    this.socket.on('quest:open', (data: { npcId: string; name: string; quests: any[]; playerProgress: any[] }) => {
      this.openQuestUI(data);
    });

    this.socket.on('quest:data', (data: { quests: any[] }) => {
      this.renderQuestJournal(data.quests);
    });

    this.socket.on('subskillsUpdate', (data: Record<string, { rank: number; xp: number }>) => {
      this.scene.onSubskillsUpdate(data);
    });

    this.socket.on('quest:reward', (data: { questId: string; rewards: any }) => {
      // Feedback visual da recompensa
      if (data.rewards) {
          let msg = '🎁 Recompensas:';
          if (data.rewards.xp) msg += ` +${data.rewards.xp} XP`;
          if (data.rewards.gold) msg += ` +${data.rewards.gold} Ouro`;
          if (data.rewards.professionXp) {
              for (const [prof, amt] of Object.entries(data.rewards.professionXp)) {
                  msg += ` +${amt} ${prof}`;
              }
          }
          const toast = document.getElementById('toast');
          if (toast) {
              toast.textContent = msg;
              toast.style.display = 'block';
              toast.style.background = '#10b981';
              setTimeout(() => { toast.style.display = 'none'; }, 4000);
          }
      }
    });
  }

  public sendMove(targetPosition: Position, facing: string) {
    this.socket.emit('move', { position: targetPosition, facing: facing });
  }

  public sendRespawn() {
    this.socket.emit('respawn');
  }

  public sendDash() {
    this.socket.emit('dash');
  }

  public sendSkillshot(targetId?: string) {
    this.socket.emit('skillshot', targetId ? { targetId } : undefined);
  }

  public sendAttack(targetId: string) {
    this.socket.emit('attack', targetId);
  }

  public sendChat(msg: string) {
    this.socket.emit('chatMessage', msg);
  }

  public sendUseItem(index: number) {
    this.socket.emit('useItem', index);
  }

  public sendUseConsumable(type: 'hp' | 'mp') {
    this.socket.emit('useConsumable', type);
  }

  public sendUnequip(slot: string) {
    this.socket.emit('unequipItem', slot);
  }

  public sendBuy(itemName: string) {
    this.socket.emit('buyItem', itemName);
  }

  public sendSell(invIndex: number) {
    this.socket.emit('sellItem', invIndex);
  }

  public sendDropItem(index: number, amount: number) {
    this.socket.emit('dropItemFromBackpack', { index, amount });
  }
  
  // --- Funções de Loja ---

  public openShop() {
      const ui = document.getElementById('shop-ui');
      if (ui) {
          ui.style.display = 'flex';
          this.renderShopBuy();

          document.getElementById('close-shop')!.onclick = () => ui.style.display = 'none';

          const resetTabs = () => {
              ['tab-buy', 'tab-sell', 'tab-repair', 'tab-auction'].forEach(id => {
                  const el = document.getElementById(id);
                  if (el) el.style.background = '#222';
              });
          };

          document.getElementById('tab-buy')!.onclick = () => {
              resetTabs();
              document.getElementById('tab-buy')!.style.background = '#333';
              this.renderShopBuy();
          };

          document.getElementById('tab-sell')!.onclick = () => {
              resetTabs();
              document.getElementById('tab-sell')!.style.background = '#333';
              this.scene.renderShopSell();
          };

          const tabRepair = document.getElementById('tab-repair');
          if (tabRepair) {
              tabRepair.onclick = () => {
                  resetTabs();
                  tabRepair.style.background = '#333';
                  this.renderShopRepair();
              };
          }

          const tabAuction = document.getElementById('tab-auction');
          if (tabAuction) {
              tabAuction.onclick = () => {
                  resetTabs();
                  tabAuction.style.background = '#333';
                  this.socket.emit('getAuctions');
              };
          }
      }
  }

  // --- Interação com NPCs (teleporter / vendor) ---

  public interactNPC(npcId: string) {
      console.log(`[NPC] emitindo npc:interact npcId=${npcId}`);
      this.socket.emit('npc:interact', { npcId });
  }

  public openTeleporter(destinations: Array<{ id: string; name: string; minLevel: number; emoji: string }>) {
      console.log(`[NPC] openTeleporter chamado com ${destinations.length} destinos`);
      const ui = document.getElementById('teleporter-ui');
      const content = document.getElementById('teleporter-content');
      if (!ui || !content) {
          console.warn('[NPC] openTeleporter: elementos do DOM não encontrados', { ui: !!ui, content: !!content });
          return;
      }
      content.innerHTML = '';
      destinations.forEach(dest => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.style.padding = '10px';
          row.style.borderBottom = '1px solid #1e3a8a';
          row.style.fontSize = '12px';
          row.innerHTML = `
              <span style="color: #e2e8f0;">${dest.emoji} ${dest.name} ${dest.minLevel > 1 ? `<span style="color: #94a3b8; font-size: 10px;">(Requer Lv.${dest.minLevel})</span>` : ''}</span>
              <button data-dest="${dest.id}" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;">Ir ✨</button>
          `;
          content.appendChild(row);
          const btn = row.querySelector('button') as HTMLButtonElement;
          btn.onclick = () => {
              this.socket.emit('teleporter:teleport', { destinationId: dest.id });
              ui.style.display = 'none';
          };
      });
      ui.style.display = 'flex';
      const closeBtn = document.getElementById('close-teleporter');
      if (closeBtn) closeBtn.onclick = () => { ui.style.display = 'none'; };
  }

  private _vendorStock: Array<{ name: string; emoji: string; price: number; soldToday?: number; dailyStock?: number }> = [];

  public openVendor(name: string, stock: Array<{ name: string; emoji: string; price: number; soldToday?: number; dailyStock?: number }>) {
      const ui = document.getElementById('vendor-ui');
      const titleEl = document.getElementById('vendor-title');
      if (!ui) return;
      this._vendorStock = stock;
      if (titleEl) titleEl.textContent = `🛒 ${name}`;
      ui.style.display = 'flex';
      const closeBtn = document.getElementById('close-vendor');
      if (closeBtn) closeBtn.onclick = () => { ui.style.display = 'none'; };
      document.getElementById('vendor-tab-buy')!.onclick = () => {
          document.getElementById('vendor-tab-buy')!.style.background = '#92400e';
          document.getElementById('vendor-tab-sell')!.style.background = '#451a03';
          this.renderVendorBuy();
      };
      document.getElementById('vendor-tab-sell')!.onclick = () => {
          document.getElementById('vendor-tab-sell')!.style.background = '#92400e';
          document.getElementById('vendor-tab-buy')!.style.background = '#451a03';
          this.renderVendorSell();
      };
      this.renderVendorBuy();
  }

  private renderVendorBuy() {
      const content = document.getElementById('vendor-content');
      if (!content) return;
      content.innerHTML = '';
      this._vendorStock.forEach(item => {
          const displayItemName = (window as any).translateItem ? (window as any).translateItem(item.name) : item.name;
          const remaining = item.dailyStock ? Math.max(0, item.dailyStock - (item.soldToday ?? 0)) : Infinity;
          const stockText = item.dailyStock ? ` [${remaining}/${item.dailyStock}]` : '';
          const soldOut = item.dailyStock && remaining <= 0;
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.style.padding = '8px';
          row.style.borderBottom = '1px solid #451a03';
          row.innerHTML = `
              <span style="color: #e2e8f0;">${item.emoji} ${displayItemName}${stockText}</span>
              <button data-item="${item.name}" style="background: ${soldOut ? '#555' : '#d97706'}; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: ${soldOut ? 'not-allowed' : 'pointer'}; font-weight: bold; font-size: 11px;">${soldOut ? 'Esgotado' : `Comprar (${item.price} Ouro)`}</button>
          `;
          content.appendChild(row);
          const btn = row.querySelector('button') as HTMLButtonElement;
          if (!soldOut) {
              btn.onclick = () => {
                  this.socket.emit('buyItem', item.name);
              };
          }
      });
  }

  private renderVendorSell() {
      const content = document.getElementById('vendor-content');
      if (!content) return;
      content.innerHTML = '';
      const sellPrices: Record<string, number> = { 'Cheese': 2, 'Apple': 3, 'Steel Sword': 25, 'Mana Potion': 5, 'Blueberry': 1 };
      const emojis: Record<string, string> = {
          'Cheese': '🧀', 'Apple': '🍎', 'Steel Sword': '🗡️',
          'Health Potion': '🧪', 'Mana Potion': '💙', 'Blueberry': '🍇', 'Torch': '🔦',
          'Iron Ore': '🌑', 'Wood Log': '🌲', 'Medicinal Herb': '🌿', 'Leather Hide': '📦',
          'Skull': '💀'
      };
      let hasItems = false;
      this.scene.backpackData.forEach((itemString, index) => {
          if (!itemString || itemString === '') return;
          hasItems = true;
          let baseItemName = itemString;
          let count = 1;
          if (itemString.startsWith('{')) {
              try { const parsed = JSON.parse(itemString); baseItemName = parsed.name; } catch (e) {}
          } else if (itemString.includes(':')) {
              const [name, countStr] = itemString.split(':'); baseItemName = name; count = parseInt(countStr) || 1;
          }
          const emoji = emojis[baseItemName] || '📦';
          const val = sellPrices[baseItemName] || 1;
          const displayItemName = (window as any).translateItem ? (window as any).translateItem(itemString) : baseItemName;
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.style.padding = '8px';
          row.style.borderBottom = '1px solid #451a03';
          row.innerHTML = `
              <span style="color:#e2e8f0;">${emoji} ${displayItemName} (x${count})</span>
              <button style="background:#ef4444;color:white;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">Vender (+${val} Ouro)</button>
          `;
          content.appendChild(row);
          row.querySelector('button')!.onclick = () => { this.sendSell(index); };
      });
      if (!hasItems) {
          content.innerHTML = '<div style="text-align:center;color:#888;padding:10px;font-size:12px;">Sua mochila está vazia.</div>';
      }
  }

  private renderShopRepair() {
      const content = document.getElementById('shop-content');
      if (!content) return;
      
      content.innerHTML = `
          <div style="text-align: center; padding: 20px; font-family: monospace;">
              <p>O Ferreiro Mercador pode consertar todos os seus equipamentos equipados de uma só vez.</p>
              <p style="color: #fbbf24; font-size: 11px; margin-bottom: 15px;">Custo: 1 Gold por ponto de durabilidade perdido.</p>
              <button id="btn-repair-all-action" style="background: #ef4444; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; font-family: monospace;">
                  Consertar Tudo 🛠️
              </button>
          </div>
      `;
      
      document.getElementById('btn-repair-all-action')!.onclick = () => {
          this.socket.emit('repairAllItems');
      };
  }

  private renderShopBuy() {
      const content = document.getElementById('shop-content');
      if (!content) return;
      
      const items = [
          { name: 'Torch', emoji: '🔦', price: 5 },
          { name: 'Health Potion', emoji: '🧪', price: 15 },
          { name: 'Mana Potion', emoji: '💙', price: 20 },
          { name: 'Steel Sword', emoji: '🗡️', price: 100 },
          { name: 'Leather Backpack', emoji: '🎒', price: 500 },
          { name: 'Wooden Backpack', emoji: '💼', price: 1500 },
          { name: 'Iron Backpack', emoji: '🧳', price: 4000 }
      ];
      
      content.innerHTML = '';
      items.forEach(item => {
          const div = document.createElement('div');
          div.style.display = 'flex';
          div.style.justifyContent = 'space-between';
          div.style.alignItems = 'center';
          div.style.padding = '8px';
          div.style.borderBottom = '1px solid #333';
          
          const displayItemName = (window as any).translateItem ? (window as any).translateItem(item.name) : item.name;
          div.innerHTML = `
              <span class="shop-item-hover" style="cursor: help; text-decoration: underline dotted rgba(255,255,255,0.3);">${item.emoji} ${displayItemName}</span>
              <button style="background: #fbbf24; color: black; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">
                 Comprar (${item.price} Ouro)
              </button>
          `;
          
          const span = div.querySelector('.shop-item-hover') as HTMLElement;
          if (span) {
              const tooltip = document.getElementById('item-tooltip')!;
              const tName = document.getElementById('tooltip-name')!;
              const tDesc = document.getElementById('tooltip-desc')!;
              
              span.addEventListener('mouseenter', (e) => {
                  const details = this.scene.itemDetails[item.name] || { name: item.name, desc: 'Item à venda.', color: '#ffffff' };
                  tName.innerText = details.name;
                  tName.style.color = details.color;
                  tDesc.innerText = details.desc;
                  tooltip.style.display = 'block';
                  tooltip.style.left = (e.pageX + 15) + 'px';
                  tooltip.style.top = (e.pageY + 15) + 'px';
              });
              span.addEventListener('mousemove', (e) => {
                  tooltip.style.left = (e.pageX + 15) + 'px';
                  tooltip.style.top = (e.pageY + 15) + 'px';
              });
              span.addEventListener('mouseleave', () => {
                  tooltip.style.display = 'none';
              });
          }
          
          div.querySelector('button')!.onclick = () => {
              this.sendBuy(item.name);
          };
          
          content.appendChild(div);
      });
  }

  // ===== Quest UI =====
  public renderQuestJournal(quests: any[]) {
      const panel = document.getElementById('quests-panel');
      if (!panel) return;
      if (quests.length === 0) {
          panel.innerHTML = '<div style="color:#64748b;font-size:11px;text-align:center;padding:20px 0;">Nenhuma missão ativa.</div>';
          return;
      }
      panel.innerHTML = '';
      quests.forEach((q: any) => {
          const done = q.objectives.every((o: any) => o.current >= o.count);
          const expired = q.expired;
          const rewarded = q.rewarded;
          const objectivesComplete = q.objectivesComplete;
          const card = document.createElement('div');
          let borderColor = '#334155';
          let statusText = '';
          if (rewarded) { borderColor = '#334155'; statusText = '✅ Entregue'; }
          else if (expired) { borderColor = '#ef4444'; statusText = '⏰ Expirada!'; }
          else if (objectivesComplete) { borderColor = '#10b981'; statusText = '🎁 Pronta pra entregar!'; }
          else if (done) { borderColor = '#10b981'; statusText = '✅ Concluída!'; }
          card.style.cssText = `padding:10px;margin-bottom:8px;background:rgba(0,0,0,0.3);border-radius:8px;border:1px solid ${borderColor};`;
          card.innerHTML = `
              <h4 style="margin:0 0 2px;color:#fbbf24;font-size:13px;">${q.title}</h4>
              <p style="margin:0 0 6px;color:#94a3b8;font-size:10px;">${q.description}</p>
              <div style="font-size:10px;color:#e2e8f0;display:flex;flex-direction:column;gap:2px;">
                  ${q.objectives.map((o: any) => {
                      return `<div style="display:flex;justify-content:space-between;"><span>• ${translateQuestObjective(o)}</span><span style="color:${o.current >= o.count ? '#10b981' : '#fbbf24'};">${o.current}/${o.count}</span></div>`;
                  }).join('')}
              </div>
              <div style="font-size:10px;color:#10b981;margin-top:4px;">
                  Recompensas: ${q.rewards.gold ? `${q.rewards.gold} Ouro ` : ''}${q.rewards.xp ? `${q.rewards.xp} XP ` : ''}${q.rewards.professionXp ? Object.entries(q.rewards.professionXp).map(([prof, amt]: [string, any]) => `+${amt} ${prof}`).join(' ') : ''}
              </div>
              ${statusText ? `<div style="margin-top:4px;color:${rewarded ? '#94a3b8' : expired ? '#ef4444' : '#10b981'};font-weight:bold;font-size:11px;">${statusText}</div>` : ''}
          `;
          panel.appendChild(card);
      });
  }

  public openQuestUI(data: { npcId: string; name: string; quests: any[]; playerProgress: any[] }) {
      const existing = document.getElementById('quest-ui');
      if (existing) existing.remove();
      const overlay = document.createElement('div');
      overlay.id = 'quest-ui';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `
          <div style="background:#1e293b;border:2px solid #fbbf24;border-radius:12px;padding:20px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;color:white;font-family:monospace;">
              <h2 style="color:#fbbf24;margin-top:0;">❓ ${data.name}</h2>
              <div id="quest-list"></div>
              <button id="close-quest" style="margin-top:12px;background:#451a03;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;width:100%;font-family:monospace;">Fechar</button>
          </div>
      `;
      document.body.appendChild(overlay);
      const list = document.getElementById('quest-list')!;
      if (data.quests.length === 0) {
          list.innerHTML = '<p style="color:#888;text-align:center;">Nenhuma missão disponível no momento.</p>';
      } else {
          data.quests.forEach((quest: any, idx: number) => {
              const prog = data.playerProgress[idx];
              const accepted = prog && prog.started;
              const rewarded = prog && prog.rewarded;
              const expired = prog && prog.expired;
              // Calcula se todos os objetivos foram cumpridos (compara progresso com a quest)
              const allDone = !!(prog && quest.objectives && quest.objectives.every((o: any, oi: number) => {
                  const current = prog.objectives?.[oi] ?? 0;
                  return current >= o.count;
              }));
              const objectsComplete = (prog && prog.objectivesComplete) || allDone;
              const card = document.createElement('div');
              let borderColor = '#334155';
              let btnLabel = 'Aceitar Missão';
              let btnBg = '#d97706';
              let btnDisabled = false;
              let btnAction: (() => void) | null = () => {
                  this.socket.emit('quest:accept', { questId: quest.id });
                  overlay.remove();
              };
              if (rewarded) {
                  borderColor = '#334155';
                  btnLabel = '✔️ Concluída';
                  btnBg = '#334155';
                  btnDisabled = true;
                  btnAction = null;
              } else if (expired) {
                  borderColor = '#ef4444';
                  btnLabel = '⏰ Expirada';
                  btnBg = '#334155';
                  btnDisabled = true;
                  btnAction = null;
              } else if (objectsComplete) {
                  borderColor = '#10b981';
                  btnLabel = '🎁 Entregar';
                  btnBg = '#10b981';
                  btnAction = () => {
                      if (this.socket) this.socket.emit('quest:turnin', { questId: quest.id });
                      overlay.remove();
                  };
              } else if (accepted) {
                  borderColor = '#fbbf24';
                  btnLabel = '📜 Em andamento';
                  btnBg = '#334155';
                  btnDisabled = true;
                  btnAction = null;
              }
              card.style.cssText = `padding:12px;margin-bottom:10px;background:rgba(0,0,0,0.3);border-radius:8px;border:1px solid ${borderColor};`;
              const objHtml = objectsComplete
                  ? '<div style="color:#10b981;font-size:11px;margin-bottom:8px;">✅ Todos os objetivos concluídos!</div>'
                  : quest.objectives.map((o: any, oi: number) => {
                        const current = prog?.objectives?.[oi] ?? 0;
                        return `<div style="display:flex;justify-content:space-between;font-size:11px;color:#e2e8f0;"><span>• ${translateQuestObjective(o)}</span><span style="color:${current >= o.count ? '#10b981' : '#fbbf24'};">${current}/${o.count}</span></div>`;
                    }).join('');
              card.innerHTML = `
                  <h3 style="margin:0 0 4px;color:#fbbf24;font-size:14px;">${quest.title}</h3>
                  <p style="margin:0 0 8px;color:#94a3b8;font-size:11px;">${quest.description}</p>
                  ${objHtml}
                  <div style="font-size:11px;color:#10b981;margin-bottom:8px;">
                      Recompensas: ${quest.rewards.gold ? `${quest.rewards.gold} Ouro ` : ''}${quest.rewards.xp ? `${quest.rewards.xp} XP ` : ''}${quest.rewards.professionXp ? Object.entries(quest.rewards.professionXp).map(([prof, amt]) => `+${amt} ${prof}`).join(' ') : ''}
                  </div>
                  <button data-quest-id="${quest.id}" style="background:${btnBg};color:white;border:none;padding:6px 12px;border-radius:4px;cursor:${btnDisabled ? 'not-allowed' : 'pointer'};font-size:11px;font-family:monospace;" ${btnDisabled ? 'disabled' : ''}>${btnLabel}</button>
              `;
              list.appendChild(card);
              if (btnAction) {
                  card.querySelector('button')!.onclick = btnAction;
              }
          });
      }
      document.getElementById('close-quest')!.onclick = () => overlay.remove();
  }
}

function translateQuestObjective(o: any): string {
    switch (o.type) {
        case 'kill': return `Derrote ${o.count}x ${o.target}`;
        case 'collect': return `Colete ${o.count}x ${o.target}`;
        case 'craft': return `Crie ${o.count}x ${o.target}`;
        default: return `${o.count}x ${o.target}`;
    }
}
