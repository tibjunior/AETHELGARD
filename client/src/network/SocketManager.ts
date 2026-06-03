import { io, Socket } from 'socket.io-client';
import { GameScene } from '../scenes/GameScene';
import { PlayerData, Position } from '../../../shared/types';

export class SocketManager {
  public socket!: Socket;
  private scene: GameScene;

  constructor(scene: GameScene) {
    this.scene = scene;
  }

  public connect(playerName: string) {
    // Detecta se estamos em ambiente local. Caso contrario, busca a variavel VITE_SERVER_URL ou usa o placeholder de producao.
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const defaultUrl = isLocal ? 'http://localhost:3000' : 'https://aethelgard-server-9go1.onrender.com';
    const serverUrl = (import.meta as any).env.VITE_SERVER_URL || defaultUrl;

    this.socket = io(serverUrl, {
        auth: { name: playerName }
    });

    this.setupListeners();
    
    // Expose global for HTML clicks
    (window as any).sendAddStat = (statName: string) => {
        if (this.socket) this.socket.emit('addStat', statName);
    };
  }

  public getId(): string | undefined {
    return this.socket.id;
  }

  private setupListeners() {
    this.socket.on('connect', () => {
      console.log('🔗 Conectado ao servidor Aethelgard');
    });

    this.socket.on('init', (data: PlayerData) => {
      this.scene.onLocalPlayerInit(data);
    });

    this.socket.on('mapData', (data: any) => {
      this.scene.onMapData(data);
    });

    this.socket.on('currentPlayers', (data: PlayerData[]) => {
      this.scene.onCurrentPlayers(data);
    });

    this.socket.on('playerJoined', (data: PlayerData) => {
      this.scene.onPlayerJoined(data);
    });

    this.socket.on('playerMoved', (data: PlayerData) => {
      this.scene.onPlayerMoved(data);
    });

    this.socket.on('playerDashed', (data: PlayerData) => {
      this.scene.onPlayerDashed(data);
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

    this.socket.on('playerDamaged', (data: { id: string, health: number, maxHealth: number, amount?: number }) => {
      this.scene.onPlayerDamaged(data);
    });

    this.socket.on('playerSpoke', (data: { id: string, message: string }) => {
      this.scene.onPlayerSpoke(data.id, data.message);
    });

    this.socket.on('spellCast', (data: {casterId: string, targetId?: string, spell: string}) => {
        this.scene.onSpellCast(data);
    });
    
    this.socket.on('levelUp', (data: {id: string, level: number}) => {
        this.scene.onLevelUp(data);
    });

    this.socket.on('timeUpdate', (data: { isNight: boolean }) => {
        this.scene.setNight(data.isNight);
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

    this.socket.on('itemDropped', (data: any) => {
      this.scene.onItemDropped(data);
    });

    this.socket.on('itemRemoved', (key: string) => {
      this.scene.onItemRemoved(key);
    });

    this.socket.on('itemPickedUp', (data: any) => {
      this.scene.onItemPickedUp(data);
    });

    this.socket.on('inventoryUpdate', (backpack: string[]) => {
      this.scene.onInventoryUpdate(backpack);
      // Sincroniza a barra de hotkeys visual (Q = HP, E = MP)
      if ((window as any).updateHotkeyBar) {
        (window as any).updateHotkeyBar(backpack);
      }
    });

    this.socket.on('equipmentUpdate', (eq: any) => {
        this.scene.onEquipmentUpdate(eq);
    });

    this.socket.on('statsUpdate', (data: any) => {
      this.scene.onStatsUpdate(data);
      
      // Update local level text
      if (data.id === this.socket.id && data.level !== undefined) {
          const levelEl = document.getElementById('player-level-display');
          if (levelEl) levelEl.innerText = `Level ${data.level}`;
      }
    });

    this.socket.on('playerDied', (data: { lostItems: string[] }) => {
      this.scene.onLocalPlayerDeath(data.lostItems);
    });

    this.socket.on('textEffect', (data: { x: number, y: number, text?: string, message?: string, color: string }) => {
      this.scene.onTextEffect(data.x, data.y, data.text || data.message || '', data.color);
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
  
  // --- Funções de Loja ---
  
  public openShop() {
      const ui = document.getElementById('shop-ui');
      if (ui) {
          ui.style.display = 'flex';
          this.renderShopBuy();
          
          document.getElementById('close-shop')!.onclick = () => ui.style.display = 'none';
          
          document.getElementById('tab-buy')!.onclick = () => {
              document.getElementById('tab-buy')!.style.background = '#333';
              document.getElementById('tab-sell')!.style.background = '#222';
              this.renderShopBuy();
          };
          
          document.getElementById('tab-sell')!.onclick = () => {
              document.getElementById('tab-buy')!.style.background = '#222';
              document.getElementById('tab-sell')!.style.background = '#333';
              this.scene.renderShopSell();
          };
      }
  }

  private renderShopBuy() {
      const content = document.getElementById('shop-content');
      if (!content) return;
      
      const items = [
          { name: 'Torch', emoji: '🔦', price: 5 },
          { name: 'Health Potion', emoji: '🧪', price: 15 },
          { name: 'Mana Potion', emoji: '💙', price: 20 },
          { name: 'Steel Sword', emoji: '🗡️', price: 100 }
      ];
      
      content.innerHTML = '';
      items.forEach(item => {
          const div = document.createElement('div');
          div.style.display = 'flex';
          div.style.justifyContent = 'space-between';
          div.style.alignItems = 'center';
          div.style.padding = '8px';
          div.style.borderBottom = '1px solid #333';
          
          div.innerHTML = `
              <span class="shop-item-hover" style="cursor: help; text-decoration: underline dotted rgba(255,255,255,0.3);">${item.emoji} ${item.name}</span>
              <button style="background: #fbbf24; color: black; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">
                 Buy (${item.price}G)
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
}
