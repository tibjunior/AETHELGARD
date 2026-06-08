import Phaser from 'phaser';
import { SocketManager } from '../network/SocketManager';
import { PlayerData, Position, ResourceNode, CraftingStation, SpriteId, SPRITE_IDS, Facing, FACINGS, getFrameIndex } from '../../../shared/types';
import { CRAFTING_RECIPES, Recipe } from '../../../shared/recipes';

/**
 * Ícones de item baseados em imagens (URLs servidas pelo Vite a partir de /client/public).
 * Quando o nome está aqui, retornamos o caminho; o renderizador usa <img> em vez de texto emoji.
 */
const ITEM_ICONS: Record<string, string> = {
    'Leather Hide': '/items/leather.webp'
};

/**
 * Retorna o ícone do item: URL de imagem (se houver) ou emoji Unicode.
 * Renderizadores devem checar se o retorno começa com '/' para decidir entre <img> e texto.
 */
// @ts-ignore — mantida para uso futuro via getItemIcon
function getItemIcon(name: string, fallbackEmoji: string): string {
    return ITEM_ICONS[name] || fallbackEmoji;
}

// @ts-ignore — mantida para uso futuro via paintItemIcon
function paintItemIcon(el: HTMLElement, icon: string, size: number = 24): void {
    if (icon.startsWith('/')) {
        el.innerHTML = `<img src="${icon}" style="width:${size}px;height:${size}px;image-rendering:pixelated;object-fit:contain;" />`;
    } else {
        el.innerText = icon;
    }
}

export class GameScene extends Phaser.Scene {
  private socketManager!: SocketManager;
  private otherPlayers: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private otherPlayerLabels: Map<string, Phaser.GameObjects.Text> = new Map();

  // Animação direcional de andar
  private localWalkFrame: number = 0;
  private localWalkTimer: number = 0;
  private localLastFacing: Facing = 'down';
  private localSpriteId: SpriteId = 'm1';
  private otherPlayerAnim: Map<string, { walkFrame: number, walkTimer: number, lastMoveTime: number, facing: Facing, spriteId: SpriteId }> = new Map();
  private readonly WALK_FRAME_MS = 180;
  private showTooltipFn?: (e: MouseEvent) => void;
  private moveTooltipFn?: (e: MouseEvent) => void;
  private hideTooltipFn?: (e: MouseEvent) => void;
  private projectiles: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private localPlayerSprite?: Phaser.GameObjects.Sprite;
  private wallsGroup!: Phaser.GameObjects.Group;
  private gatesGroup!: Phaser.GameObjects.Group;
  /** Cada portão: posição + sprite + estado atual (aberto/fechado). */
  private gateSprites: Array<{ x: number, y: number, sprite: Phaser.GameObjects.Sprite, isOpen: boolean }> = [];
  /** Distância (em tiles) em que a porta abre: 1 = player precisa estar ADJACENTE (colado no portão). */
  private static readonly GATE_OPEN_DISTANCE = 1;
  private floorItems: Map<string, Phaser.GameObjects.Text> = new Map();
  
  // Habilidades de Coleta e Recursos do Mapa
  private resourceNodesMap: Map<string, { sprite: any, label: Phaser.GameObjects.Text, data: ResourceNode }> = new Map();
  private craftingStationsMap: Map<string, { sprite: any, label: Phaser.GameObjects.Text, data: any }> = new Map();
  private gatheringProgressBar?: Phaser.GameObjects.Graphics;
  private gatheringProgressText?: Phaser.GameObjects.Text;
  private gatheringTimerEvent?: Phaser.Time.TimerEvent;
  private recallProgressBar?: Phaser.GameObjects.Graphics;
  private recallProgressText?: Phaser.GameObjects.Text;

  // Cidades de Monstros (Fase 3)
  private cityOverlays: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] = [];
  private plazaOverlay?: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Graphics;
  private plazaLabel?: Phaser.GameObjects.Text;

  // Right-click context menu (Fase 4b)
  private contextMenuTargetId: string | null = null;
  private recallTimerEvent?: Phaser.Time.TimerEvent;
  private recallGlowGraphics?: Phaser.GameObjects.Graphics;

  // Profissões de Criação e Receitas do Jogador
  private professionSmithingLevel: number = 1;
  private professionSmithingXp: number = 0;
  private professionAlchemyLevel: number = 1;
  private professionAlchemyXp: number = 0;
  private professionTanningLevel: number = 1;
  private professionTanningXp: number = 0;
  private learnedRecipes: string[] = [];
  private currentCraftingStationType: string = 'forge';
  
  // Interface e Status
  private hpBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private targetSquare?: Phaser.GameObjects.Graphics;
  private currentTargetId?: string;
  private equipmentData: any = {};

  // Cooldown de skills no cliente (ms)
  private skillCooldowns: Record<string, number> = {};
  private localSp: number = 50;
  private localMaxSp: number = 50;

  // Sistema de perseguição (Chase)
  private chaseTargetId?: string;         // ID do alvo sendo perseguido
  private chaseTargetPos?: { x: number, y: number }; // última posição conhecida do alvo
  private chaseNodeId?: string;           // ID do recurso sendo coletado
  private chaseNodePos?: { x: number, y: number }; // posição do recurso sendo coletado

  // Chase genérico para interações (NPC, bancada, etc.) - clica e anda até 1 célula de distância
  private interactionChase?: {
    pos: { x: number, y: number };
    onArrive: () => void;
  };

  private readonly TILE_SIZE = 32;
  private isMoving = false;
  private localFacing: string = 'down';
  
  private collisionMap: Set<string> = new Set();
  private autoPath: {x: number, y: number}[] = [];
  
  private worldBounds: { width: number; height: number } = { width: 150 * 32, height: 150 * 32 };
  private backgroundTileSprite!: Phaser.GameObjects.TileSprite;
  
  private hasTorch: boolean = false;
  
  // Banker state variables
  public bankGold = 0;
  public bankItems: string[] = [];
  public bankDebtDays = 0;

  // Autofarm e Auto-attack
  private isAutofarmEnabled: boolean = false;
  private otherPlayersData: Map<string, PlayerData> = new Map();
  private localHealth: number = 150;
  private localMaxHealth: number = 150;
  private localPlayerDead: boolean = false;
  private lootTargetId?: string;
  private lootTargetPos?: { x: number, y: number };

  public itemDetails: Record<string, { name: string, desc: string, color: string }> = {
      'Steel Sword': { name: 'Espada de Aço', desc: 'Dano: +15 | Peso: 25.0 oz\nUma espada pesada forjada com liga de metal resistente.', color: '#e2e8f0' },
      'Wood Sword': { name: 'Espada de Madeira', desc: 'Dano: +8 | Peso: 15.0 oz\nUma espada simples ideal para iniciantes.', color: '#854d0e' },
      'Torch': { name: 'Tocha de Fogo', desc: 'Iluminação: 5 SQMs | Peso: 5.0 oz\nAjuda a enxergar através da névoa escura do clima.', color: '#fbbf24' },
      'Helmet': { name: 'Elmo de Aço', desc: 'Defesa: +5 | Peso: 15.0 oz\nProteção básica reforçada para a cabeça.', color: '#94a3b8' },
      'Armor': { name: 'Armadura de Placas', desc: 'Defesa: +10 | Peso: 40.0 oz\nUma armadura pesada que reduz muito o dano físico.', color: '#3b82f6' },
      'Pants': { name: 'Calças de Couro', desc: 'Defesa: +2 | Peso: 20.0 oz\nCalças de couro curtido flexíveis.', color: '#a16207' },
      'Leather Boots': { name: 'Botas de Couro', desc: 'Defesa: +1 | Peso: 10.0 oz\nBotas de couro leves e confortáveis.', color: '#a16207' },
      'Health Potion': { name: 'Poção de Vida', desc: 'Cura: +50 HP | Peso: 5.0 oz\nRestaura a saúde ao ser consumida.', color: '#ef4444' },
      'Mana Potion': { name: 'Poção de Mana', desc: 'Mana: +40 SP | Peso: 4.0 oz\nPoção azulada que restaura o poder mágico.', color: '#818cf8' },
      'Apple': { name: 'Maçã Vermelha', desc: 'Cura: +10 HP | Peso: 2.0 oz\nFruta fresca e crocante.', color: '#ef4444' },
      'Cheese': { name: 'Pedaço de Queijo', desc: 'Cura: +20 HP | Peso: 2.0 oz\nQueijo saboroso e curado.', color: '#fbbf24' },
      'Blueberry': { name: 'Mirtilo Azul', desc: 'Mana: +15 SP | Peso: 1.0 oz\nFrutinha azul que restaura levemente a mana.', color: '#a78bfa' },
      'Gold Coin': { name: 'Moeda de Ouro', desc: 'Ouro: +1 G | Peso: 0.1 oz\nMoeda brilhante de ouro.', color: '#eab308' },
      'Iron Ore': { name: 'Minério de Ferro', desc: 'Peso: 8.0 oz\nMinério bruto extraído de depósitos rochosos.', color: '#94a3b8' },
      'Wood Log': { name: 'Tronco de Madeira', desc: 'Peso: 6.0 oz\nMadeira cortada pronta para uso.', color: '#b45309' },
      'Medicinal Herb': { name: 'Erva Medicinal', desc: 'Peso: 2.0 oz\nUma erva com propriedades curativas básicas.', color: '#10b981' },
      'Leather Hide': { name: 'Couro', desc: 'Peso: 4.0 oz\nCouro obtido de criaturas selvagens.', color: '#78350f' },
      'Leather Backpack': { name: 'Mochila de Couro', desc: 'Capacidade: 16 slots | Peso: 10.0 oz\nUma mochila de couro costurada à mão.', color: '#a16207' },
      'Wooden Backpack': { name: 'Mochila de Madeira', desc: 'Capacidade: 24 slots | Peso: 15.0 oz\nUma caixa de madeira reforçada com alças.', color: '#b45309' },
      'Iron Backpack': { name: 'Mochila de Ferro', desc: 'Capacidade: 32 slots | Peso: 25.0 oz\nUma mala metálica ultra-resistente e pesada.', color: '#94a3b8' },
      'Skull': { name: 'Caveira', desc: 'Troféu de combate.\nCarrega o nome do derrotado.', color: '#ffffff' }
  };
  
  constructor() {
    super('GameScene');
  }

  create() {
    (window as any).gameScene = this;
    // ===== Chat Toggle & Input =====
    const chatBox = document.getElementById('chat-box') as HTMLDivElement;
    const chatInput = document.getElementById('chat-input') as HTMLInputElement;
    if (chatBox) chatBox.style.display = 'none';
    const chatTabs = document.querySelectorAll('.chat-tab');
    const chatPanels = document.querySelectorAll('.chat-panel');
    const chatMinimizeBtn = document.getElementById('chat-minimize-btn');
    const chatResizeBtn = document.getElementById('chat-resize-btn');
    const chatResizeHandle = document.getElementById('chat-resize-handle');

    let isChatOpen = false;

    const openChat = () => {
      if (chatBox) {
        chatBox.style.display = 'flex';
        isChatOpen = true;
        // Foca no input após abrir
        setTimeout(() => chatInput?.focus(), 50);
      }
    };
    const closeChat = () => {
      if (chatBox) chatBox.style.display = 'none';
      isChatOpen = false;
      chatInput?.blur();
    };
    const toggleChat = () => {
      if (isChatOpen) closeChat();
      else openChat();
    };

    // Toggle button
    const chatToggleBtn = document.getElementById('chat-toggle-btn');
    if (chatToggleBtn) {
      chatToggleBtn.style.display = 'flex';
      chatToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleChat();
      });
    }

    // Tabs
    chatTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');
        chatTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        chatPanels.forEach(p => {
          (p as HTMLElement).style.display = p.id === `chat-${targetTab}` ? 'flex' : 'none';
        });
      });
    });

    // Minimizar/Expandir
    let isMinimized = false;
    chatMinimizeBtn?.addEventListener('click', () => {
      if (!chatBox) return;
      isMinimized = !isMinimized;
      const content = chatBox.querySelector('#chat-content') as HTMLElement;
      const inputWrapper = chatBox.querySelector('#chat-input-wrapper') as HTMLElement;
      const resizeHandle = document.getElementById('chat-resize-handle') as HTMLElement;
      if (content) content.style.display = isMinimized ? 'none' : 'flex';
      if (inputWrapper) inputWrapper.style.display = isMinimized ? 'none' : 'flex';
      if (resizeHandle) resizeHandle.style.display = isMinimized ? 'none' : 'block';
      chatMinimizeBtn.textContent = isMinimized ? '+' : '−';
    });

    // Resize (desktop: 3 tamanhos; mobile: apenas toggle)
    const resizeSizes = ['420px', '560px', '700px'];
    let resizeIdx = 0;
    chatResizeBtn?.addEventListener('click', () => {
      if (!chatBox) return;
      resizeIdx = (resizeIdx + 1) % resizeSizes.length;
      chatBox.style.width = resizeSizes[resizeIdx];
    });

    // Resize handle (drag para redimensionar)
    let isResizing = false;
    const startResize = () => {
      isResizing = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'se-resize';
    };
    const doResize = (clientX: number, clientY: number) => {
      if (!isResizing || !chatBox) return;
      const rect = chatBox.getBoundingClientRect();
      const newWidth = Math.max(300, clientX - rect.left + 8);
      const newHeight = Math.max(200, rect.top + rect.height - clientY + 8);
      chatBox.style.width = `${Math.min(newWidth, window.innerWidth - 40)}px`;
      chatBox.style.height = `${Math.min(newHeight, window.innerHeight - 120)}px`;
    };
    const stopResize = () => {
      isResizing = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    chatResizeHandle?.addEventListener('mousedown', () => startResize());
    chatResizeHandle?.addEventListener('touchstart', (e) => { startResize(); e.preventDefault(); }, { passive: false });
    document.addEventListener('mousemove', (e) => doResize(e.clientX, e.clientY));
    document.addEventListener('touchmove', (e) => { if (isResizing) { const t = e.touches[0]; doResize(t.clientX, t.clientY); e.preventDefault(); } }, { passive: false });
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('touchend', stopResize);
    document.addEventListener('touchcancel', stopResize);

    // Fecha chat ao clicar fora (apenas se não for no input/buttons)
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (chatBox && chatBox.style.display === 'flex' &&
          !chatBox.contains(target) &&
          target !== document.getElementById('chat-toggle-btn') &&
          !target.closest('.chat-tab')) {
        closeChat();
      }
    });

    // Hotkeys: Enter, T, / abrem chat
    this.input.keyboard?.on('keydown-ENTER', () => { if (!isChatOpen) openChat(); });
    this.input.keyboard?.on('keydown-T', () => { if (!isChatOpen && document.activeElement !== chatInput) openChat(); });
    this.input.keyboard?.on('keydown-SLASH', () => { if (!isChatOpen && document.activeElement !== chatInput) openChat(); });

    // Evita keydown de movimento quando input do chat focado
    (window as any).chatInput = chatInput;
    (window as any).translateMonster = (name: string): string => {
        const MONSTER_NAMES_PT: Record<string, string> = {
            'Giant Rat': 'Rato Gigante',
            'Orc': 'Orc',
            'Rotworm': 'Verme da Podridão',
            'Demon Skeleton': 'Esqueleto Demônio',
            'Nightmare Skeleton': 'Esqueleto do Pesadelo (Boss)',
            'Merchant': 'Mercador',
            'Banker': 'Banqueiro'
        };
        return MONSTER_NAMES_PT[name] || name;
    };

    (window as any).translateItem = (itemStr: string): string => {
        if (!itemStr) return '';
        let name = itemStr;
        let quality = '';
        
        if (itemStr.startsWith('{')) {
            try {
                const parsed = JSON.parse(itemStr);
                name = parsed.name;
                quality = parsed.quality || '';
            } catch (e) {}
        } else if (itemStr.includes(':')) {
            [name] = itemStr.split(':');
        }
        
        if (name.includes(' (')) {
            const parts = name.split(' (');
            name = parts[0];
            if (!quality) {
                const qPart = parts[1].replace(')', '');
                quality = qPart;
            }
        }
        
        const ITEM_NAMES_PT: Record<string, string> = {
            'Torch': 'Tocha',
            'Apple': 'Maçã',
            'Cheese': 'Queijo',
            'Health Potion': 'Poção de Vida',
            'Mana Potion': 'Poção de Mana',
            'Blueberry': 'Mirtilo',
            'Steel Sword': 'Espada de Aço',
            'Wood Sword': 'Espada de Madeira',
            'Iron Ore': 'Minério de Ferro',
            'Wood Log': 'Tronco de Madeira',
            'Medicinal Herb': 'Erva Medicinal',
            'Leather Hide': 'Couro',
            'Helmet': 'Elmo de Aço',
            'Armor': 'Armadura de Placas',
            'Pants': 'Calças de Couro',
            'Leather Boots': 'Botas de Couro',
            'Gold Coin': 'Moeda de Ouro',
            'Leather Backpack': 'Mochila de Couro',
            'Wooden Backpack': 'Mochila de Madeira',
            'Iron Backpack': 'Mochila de Ferro',
            'Skull': 'Caveira de PvP'
        };
        
        const QUALITY_NAMES_PT: Record<string, string> = {
            'comum': 'Comum',
            'raro': 'Raro',
            'epico': 'Épico',
            'common': 'Comum',
            'rare': 'Raro',
            'epic': 'Épico'
        };
        
        const translatedName = ITEM_NAMES_PT[name] || name;
        if (quality) {
            const transQuality = QUALITY_NAMES_PT[quality.toLowerCase()] || quality;
            return `${translatedName} (${transQuality})`;
        }
        return translatedName;
    };

    this.wallsGroup = this.add.group();
    this.gatesGroup = this.add.group();
    this.createWorld();
    
    // Iniciar a Conexão — reutiliza o socket do main.ts (login) em vez de criar outro
    this.socketManager = new SocketManager(this);
    const existingSocket = (window as any).__loginSocket;
    if (existingSocket) {
        this.socketManager.attachExisting(existingSocket);
    } else {
        // Fallback: cria novo socket
        const pName = (window as any).playerName || 'Aventureiro';
        this.socketManager.connect(pName);
    }

    // Mapear teclas do teclado (WASD / Setas)
    this.setupInput();
    this.setupTooltips();

    // Habilita botão direito do mouse no canvas do Phaser (para atacar com right-click)
    this.input.mouse!.disableContextMenu();

    // Loop do Autofarm rodando a cada 250ms
    this.time.addEvent({
        delay: 250,
        callback: this.runAutofarmTick,
        callbackScope: this,
        loop: true
    });

    // Vincula o clique do botão HTML
    const autoBtn = document.getElementById('btn-toggle-autofarm');
    if (autoBtn) {
        autoBtn.onclick = () => this.toggleAutofarm();
    }

    // Vincula botão Organizar Mochila
    const btnSortBp = document.getElementById('btn-sort-backpack') as HTMLButtonElement;
    if (btnSortBp) {
        btnSortBp.onclick = () => {
            this.socketManager.socket.emit('backpack:sort');
        };
    }

    const autoRetaliateCheck = document.getElementById('auto-retaliate-checkbox') as HTMLInputElement;
    if (autoRetaliateCheck) {
        autoRetaliateCheck.checked = localStorage.getItem('autoRetaliate') === 'true';
        autoRetaliateCheck.onchange = () => {
            localStorage.setItem('autoRetaliate', autoRetaliateCheck.checked.toString());
        };
    }

    // Drag & Drop: soltar item no chão (no canvas do jogo)
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
        gameContainer.ondragover = (e: DragEvent) => { e.preventDefault(); };
        gameContainer.ondrop = (e: DragEvent) => {
            e.preventDefault();
            const index = e.dataTransfer?.getData('text/plain');
            if (index !== undefined && index !== '') {
                const bankModal = document.getElementById('modal-bank');
                if (bankModal && bankModal.style.display === 'flex') return;
                this.socketManager.sendDropItem(parseInt(index), 1);
            }
        };
    }

    // Drag & Drop: soltar no cofre para depositar
    const bankGrid = document.getElementById('bank-grid');
    if (bankGrid) {
        bankGrid.ondragover = (e: DragEvent) => { e.preventDefault(); };
        bankGrid.ondrop = (e: DragEvent) => {
            e.preventDefault();
            const index = e.dataTransfer?.getData('text/plain');
            if (index !== undefined && index !== '') {
                this.socketManager.socket.emit('bank:depositItem', { backpackIndex: parseInt(index), amount: 999 });
            }
        };
    }
  }

  private createWorld() {
    // REGRA: Sempre que criar/expandir mapa, calcular bounds baseado em TODOS os elementos conhecidos
    // (paredes, cidades, nós de recursos, estações) para garantir que a câmera englobe tudo.
    // O tamanho inicial é mínimo; onMapData/onCitiesData expandem automaticamente via expandWorldBounds().
    
    const initialTiles = 150;
    const mapSize = initialTiles * this.TILE_SIZE;
    
    this.worldBounds = { width: mapSize, height: mapSize };
    
    const bg = this.add.tileSprite(mapSize/2, mapSize/2, mapSize, mapSize, 'tile-grass');
    bg.setTint(0x3b3b55);
    this.backgroundTileSprite = bg;
  }

  /**
   * REGRA DE MAPA: Sempre que receber dados de mapa (paredes, cidades, nós, praça),
   * chamar expandWorldBounds* para garantir que worldBounds engloba tudo.
   * A câmera e o background são redimensionados automaticamente.
   */
  private expandWorldBoundsFromData(walls: Position[], resourceNodes?: ResourceNode[], craftingStations?: CraftingStation[]) {
    let maxX = 0, maxY = 0;
    walls.forEach(w => { maxX = Math.max(maxX, w.x); maxY = Math.max(maxY, w.y); });
    resourceNodes?.forEach(n => { maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); });
    craftingStations?.forEach(s => { maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y); });
    this.applyWorldBounds(maxX, maxY);
  }

  private expandWorldBoundsFromCities(cities: any[]) {
    let maxX = 0, maxY = 0;
    cities.forEach(c => {
      maxX = Math.max(maxX, c.bounds.xMax);
      maxY = Math.max(maxY, c.bounds.yMax);
      // Também considera portais de saída (na praça)
      if (c.portalOut) {
        maxX = Math.max(maxX, c.portalOut.x);
        maxY = Math.max(maxY, c.portalOut.y);
      }
    });
    this.applyWorldBounds(maxX, maxY);
  }

  private expandWorldBoundsFromPlaza(bounds: { xMin: number; xMax: number; yMin: number; yMax: number }) {
    this.applyWorldBounds(bounds.xMax, bounds.yMax);
  }

  private applyWorldBounds(maxTileX: number, maxTileY: number) {
    const padding = 5; // margem extra em tiles
    const newWidth = (maxTileX + padding + 1) * this.TILE_SIZE;
    const newHeight = (maxTileY + padding + 1) * this.TILE_SIZE;

    if (newWidth > this.worldBounds.width || newHeight > this.worldBounds.height) {
      this.worldBounds.width = Math.max(this.worldBounds.width, newWidth);
      this.worldBounds.height = Math.max(this.worldBounds.height, newHeight);

      // Redimensiona câmera
      this.cameras.main.setBounds(0, 0, this.worldBounds.width, this.worldBounds.height);

      // Redimensiona background tileSprite
      if (this.backgroundTileSprite) {
        this.backgroundTileSprite.setSize(this.worldBounds.width, this.worldBounds.height);
        this.backgroundTileSprite.setPosition(this.worldBounds.width / 2, this.worldBounds.height / 2);
      }

      console.log(`[Map] World bounds expandidos: ${this.worldBounds.width}x${this.worldBounds.height} (${maxTileX+1}x${maxTileY+1} tiles)`);
    }
  }

  // --- Callbacks do Socket.io ---

  public onLocalPlayerInit(data: PlayerData) {
    const spriteId: SpriteId = (SPRITE_IDS.includes(data.spriteId as SpriteId) ? data.spriteId : 'm1') as SpriteId;
    this.localSpriteId = spriteId;
    const initialFacing: Facing = (FACINGS.includes(data.facing as Facing) ? data.facing : 'down') as Facing;
    this.localLastFacing = initialFacing;
    this.localPlayerSprite = this.add.sprite(
      data.x * this.TILE_SIZE,
      data.y * this.TILE_SIZE,
      'characters',
      getFrameIndex(spriteId, initialFacing, 0)
    );
    this.localPlayerSprite.setScale(2);
    this.localPlayerSprite.setDepth(10);
    this.localPlayerSprite.flipX = (initialFacing === 'right');
    
    // Cria a textura de luz (brush gradiente) para apagar a escuridão
    // Cria overlay de noite APENAS sobre o canvas (deixa UI visível)
    const container = document.getElementById('game-container');
    const nightOverlay = document.createElement('div');
    nightOverlay.id = 'night-overlay';
    nightOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;opacity:0;transition:opacity 2s ease;background:radial-gradient(circle at 50% 50%, transparent 64px, rgba(0,0,0,0.85) 120px);';
    if (container) container.appendChild(nightOverlay);

    // Ajusta o tamanho do mapa e câmera
    this.cameras.main.setBounds(0, 0, this.worldBounds.width, this.worldBounds.height);
    
    // Câmera segue o jogador local
    this.cameras.main.startFollow(this.localPlayerSprite, true, 0.1, 0.1);
    
    // Atualiza HP Local
    this.updateHpBar(data);

    // Preparar o quadrado vermelho de target (Tibia style)
    this.targetSquare = this.add.graphics();
    this.targetSquare.lineStyle(2, 0xff0000, 1);
    this.targetSquare.strokeRect(-16, -16, 32, 32);
    this.targetSquare.setVisible(false);
    this.targetSquare.setDepth(11);

    // Popula a Interface de Equipamentos (Right Panel)
    if (data.equipment) {
        this.equipmentData = data.equipment;
        this.onEquipmentUpdate(data.equipment);
    }
    
    // Atualiza a Mochila (Caso tenha carregado do banco de dados)
    if (data.backpack) {
        this.onInventoryUpdate(data.backpack);
    }

    document.getElementById('player-name-display')!.innerText = data.name;
    document.getElementById('player-level-display')!.innerText = `Level ${data.level || 1}`;
    
    // Atualiza a UI lateral com os stats carregados
    this.onStatsUpdate(data);

    if (data.uiPositions && (window as any).loadUiPositions) {
        (window as any).loadUiPositions(data.uiPositions);
    }
  }

  public onMapData(data: { walls: Position[], gates?: Position[], itemsOnFloor: any[], resourceNodes?: ResourceNode[], craftingStations?: CraftingStation[] }) {
    this.expandWorldBoundsFromData(data.walls, data.resourceNodes, data.craftingStations);

    // Limpa nós de recursos existentes se houver
    this.resourceNodesMap.forEach(n => {
        n.sprite.destroy();
        n.label.destroy();
    });
    this.resourceNodesMap.clear();

    // Limpa estações de trabalho existentes se houver
    this.craftingStationsMap.forEach(s => {
        s.sprite.destroy();
        s.label.destroy();
    });
    this.craftingStationsMap.clear();

    // Limpa itens no chão existentes para evitar duplicação
    this.floorItems.forEach(textObj => textObj.destroy());
    this.floorItems.clear();

    // Limpa portões antigos
    this.gatesGroup.clear(true);
    this.gateSprites = [];

    data.walls.forEach(wall => {
      const sprite = this.add.sprite(wall.x * this.TILE_SIZE, wall.y * this.TILE_SIZE, 'tile-wall');
      sprite.setDepth(5);
      sprite.setTint(0x1e1e40);
      this.wallsGroup.add(sprite);
      this.collisionMap.add(`${wall.x},${wall.y}`);
    });

    // Desenha os portões das safe zones (player passa, monstro não)
    if (data.gates) {
      data.gates.forEach(gate => {
        const sprite = this.add.sprite(gate.x * this.TILE_SIZE, gate.y * this.TILE_SIZE, 'gate-door');
        sprite.setDepth(5);
        this.gatesGroup.add(sprite);
        this.gateSprites.push({ x: gate.x, y: gate.y, sprite, isOpen: false });
      });
    }
    
    // Desenha os itens iniciais
    data.itemsOnFloor.forEach(item => this.onItemDropped(item));

    // Desenha os nós de recursos
    if (data.resourceNodes) {
        data.resourceNodes.forEach(node => this.drawResourceNode(node));
    }

    // Desenha as estações de trabalho
    if (data.craftingStations) {
        data.craftingStations.forEach(station => this.drawCraftingStation(station));
    }
  }

  public onCitiesData(cities: any[]) {
    if (!cities || cities.length === 0) return;
    this.expandWorldBoundsFromCities(cities);
    
    // Limpa cities visuals antigos (se reconectar)
    this.cityOverlays.forEach(s => s.destroy());
    this.cityOverlays = [];

    for (const city of cities) {
      const w = (city.bounds.xMax - city.bounds.xMin + 1) * this.TILE_SIZE;
      const h = (city.bounds.yMax - city.bounds.yMin + 1) * this.TILE_SIZE;
      const cx = (city.bounds.xMin + city.bounds.xMax + 1) / 2 * this.TILE_SIZE;
      const cy = (city.bounds.yMin + city.bounds.yMax + 1) / 2 * this.TILE_SIZE;

      // Overlay colorido do chão (semi-transparente)
      const rect = this.add.rectangle(cx, cy, w, h, city.bgColor || 0x222222, 0.30);
      rect.setDepth(1);
      this.cityOverlays.push(rect);

      // Borda da cidade (apenas contorno)
      const border = this.add.graphics();
      border.lineStyle(2, city.bgColor || 0xfbbf24, 0.7);
      border.strokeRect(
        city.bounds.xMin * this.TILE_SIZE,
        city.bounds.yMin * this.TILE_SIZE,
        w, h
      );
      border.setDepth(2);
      this.cityOverlays.push(border);

      // Nome da cidade no topo
      const labelY = (city.bounds.yMin - 1) * this.TILE_SIZE;
      const label = this.add.text(cx, labelY, `⚔ ${city.name} (Lv ${city.minLevel}+)`, {
        fontSize: '12px',
        color: '#fbbf24',
        backgroundColor: '#000000',
        padding: { x: 4, y: 2 }
      });
      label.setOrigin(0.5, 1);
      label.setDepth(2);
      this.cityOverlays.push(label);
    }
  }

  public onPlazaData(bounds: { xMin: number; xMax: number; yMin: number; yMax: number }) {
    this.expandWorldBoundsFromPlaza(bounds);
    
    // Limpa overlay anterior
    if (this.plazaOverlay) this.plazaOverlay.destroy();
    if (this.plazaLabel) this.plazaLabel.destroy();

    const w = (bounds.xMax - bounds.xMin + 1) * this.TILE_SIZE;
    const h = (bounds.yMax - bounds.yMin + 1) * this.TILE_SIZE;
    const cx = (bounds.xMin + bounds.xMax + 1) / 2 * this.TILE_SIZE;
    const cy = (bounds.yMin + bounds.yMax + 1) / 2 * this.TILE_SIZE;

    // Praça central: tom verde (safe zone)
    this.plazaOverlay = this.add.rectangle(cx, cy, w, h, 0x10b981, 0.18);
    this.plazaOverlay.setDepth(1);

    const border = this.add.graphics();
    border.lineStyle(2, 0x10b981, 0.6);
    border.strokeRect(bounds.xMin * this.TILE_SIZE, bounds.yMin * this.TILE_SIZE, w, h);
    border.setDepth(2);
    this.plazaOverlay = border;

    // Label da praça
    const labelY = (bounds.yMin - 1) * this.TILE_SIZE;
    this.plazaLabel = this.add.text(cx, labelY, '🛡 Praça Central (Safe Zone)', {
      fontSize: '13px',
      color: '#10b981',
      backgroundColor: '#000000',
      padding: { x: 4, y: 2 }
    });
    this.plazaLabel.setOrigin(0.5, 1);
    this.plazaLabel.setDepth(2);
  }

  public onCurrentPlayers(players: PlayerData[]) {
    players.forEach(p => {
      // Ignorar nós mesmos
      if (this.localPlayerSprite && p.id === this.socketManager.getId()) return;
      this.otherPlayersData.set(p.id, p);
      this.addOtherPlayer(p);
    });
  }

  public onPlayerJoined(data: PlayerData) {
    this.otherPlayersData.set(data.id, data);
    this.addOtherPlayer(data);
    this.updateGates();
  }

  // ============ Right-click Context Menu (Fase 4b) ============

  private openBackpackContextMenu(x: number, y: number, slotIndex: number) {
      const itemStr = this.backpackData?.[slotIndex];
      if (!itemStr) return;
      const itemName = (window as any).translateItem ? (window as any).translateItem(itemStr) : itemStr;
      const menu = document.getElementById('context-menu');
      const header = document.getElementById('ctx-header');
      if (!menu || !header) return;
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      header.innerText = itemName;
      menu.style.display = 'block';
      menu.setAttribute('data-ctx-type', 'backpack');

      const attackBtn = menu.querySelector('[data-action="attack"]') as HTMLButtonElement;
      const inspectBtn = menu.querySelector('[data-action="inspect"]') as HTMLButtonElement;
      const targetBtn = menu.querySelector('[data-action="target"]') as HTMLButtonElement;
      if (attackBtn) attackBtn.style.display = 'none';
      if (inspectBtn) inspectBtn.style.display = 'none';
      if (targetBtn) targetBtn.style.display = 'none';

      // Cria botões específicos para item da bolsa
      let useBtn = menu.querySelector('[data-action="useItem"]') as HTMLButtonElement;
      let dropBtn = menu.querySelector('[data-action="dropItem"]') as HTMLButtonElement;
      if (!useBtn) {
          useBtn = document.createElement('button');
          useBtn.className = 'ctx-item';
          useBtn.dataset.action = 'useItem';
          useBtn.style.cssText = 'display:block;width:100%;padding:8px 10px;background:transparent;color:#22c55e;border:none;text-align:left;cursor:pointer;font-family:inherit;font-size:13px;border-radius:4px;';
          useBtn.innerText = '✅ Usar / Equipar';
          menu.appendChild(useBtn);
      }
      if (!dropBtn) {
          dropBtn = document.createElement('button');
          dropBtn.className = 'ctx-item';
          dropBtn.dataset.action = 'dropItem';
          dropBtn.style.cssText = 'display:block;width:100%;padding:8px 10px;background:transparent;color:#ef4444;border:none;text-align:left;cursor:pointer;font-family:inherit;font-size:13px;border-radius:4px;';
          dropBtn.innerText = '🗑️ Descartar';
          menu.appendChild(dropBtn);
      }
      useBtn.style.display = 'block';
      dropBtn.style.display = 'block';

      this.contextMenuTargetId = null;
      (menu as any).__backpackSlot = slotIndex;
  }

  private closeContextMenu() {
      const menu = document.getElementById('context-menu');
      if (menu) menu.style.display = 'none';
      this.contextMenuTargetId = null;
  }

  public onEntityInfo(data: any) {
      const modal = document.getElementById('inspect-modal');
      const title = document.getElementById('inspect-title');
      const body = document.getElementById('inspect-body');
      if (!modal || !title || !body) return;

      if (data.error) {
          title.innerText = 'Erro';
          body.innerHTML = `<p style="color: #ef4444;">${data.error}</p>`;
          modal.style.display = 'flex';
          return;
      }

      const translatedName = (window as any).translateMonster ? (window as any).translateMonster(data.name) : data.name;
      title.innerText = `🔍 ${translatedName}`;
      const type = data.isNPC ? 'NPC' : data.isMonster ? 'Monstro' : 'Jogador';
      const hpPct = data.maxHealth > 0 ? Math.round((data.health / data.maxHealth) * 100) : 0;
      const status = data.isDead ? '<span style="color: #ef4444;">(Morto)</span>' : '<span style="color: #10b981;">(Vivo)</span>';

      let html = `
          <p><b>Tipo:</b> ${type}</p>
          <p><b>Nível:</b> ${data.level || '?'} ${status}</p>
          <p><b>HP:</b> ${data.health}/${data.maxHealth} <span style="color: #94a3b8;">(${hpPct}%)</span></p>
          <p><b>Posição:</b> (${data.x}, ${data.y})</p>
      `;
      if (data.bossOfCity) {
          html += `<p style="color: #ff00ff;"><b>👹 Boss de:</b> ${data.bossOfCity}</p>`;
      }
      if (data.gold !== undefined) {
          html += `<p><b>Ouro:</b> <span style="color: #fbbf24;">${data.gold} G</span></p>`;
      }
      body.innerHTML = html;
      modal.style.display = 'flex';
  }

  public onPlayerMoved(data: PlayerData) {
    const isLocal = data.id === this.socketManager.getId();
    if (!isLocal) {
        this.otherPlayersData.set(data.id, data);
    }

    // Atualiza a localização no card do player LOCAL a cada movimento
    if (isLocal && data.x !== undefined && data.y !== undefined) {
        const locEl = document.getElementById('player-location');
        if (locEl) locEl.innerText = `Localização: ${data.x}, ${data.y}`;
        // Fecha UI de NPC se estiver muito longe
        const npcPositions = [
            { name: 'Merchant', x: 110, y: 115 },
            { name: 'Banker', x: 120, y: 115 },
            { name: 'Teleporter Hub', x: 115, y: 110 },
            { name: 'Teleporter Caverna', x: 20, y: 20 },
            { name: 'Teleporter Rat', x: 54, y: 104 },
            { name: 'Teleporter Orc', x: 176, y: 104 },
            { name: 'Teleporter Rotworm', x: 104, y: 44 },
            { name: 'Teleporter Demon', x: 104, y: 184 },
            { name: 'Vendor Rat', x: 56, y: 104 },
            { name: 'Vendor Orc', x: 174, y: 104 },
            { name: 'Vendor Rotworm', x: 106, y: 44 },
            { name: 'Vendor Demon', x: 106, y: 184 },
        ];
        const shopUI = document.getElementById('shop-ui');
        const bankUI = document.getElementById('modal-bank');
        const craftingUI = document.getElementById('crafting-ui');
        const teleporterUI = document.getElementById('teleporter-ui');
        const vendorUI = document.getElementById('vendor-ui');
        for (const npc of npcPositions) {
            const dist = Math.abs(data.x - npc.x) + Math.abs(data.y - npc.y);
            if (dist > 2) {
                if (shopUI && shopUI.style.display === 'flex') shopUI.style.display = 'none';
                if (bankUI && bankUI.style.display === 'flex') bankUI.style.display = 'none';
                if (craftingUI && craftingUI.style.display === 'flex') craftingUI.style.display = 'none';
                if (teleporterUI && teleporterUI.style.display === 'flex') teleporterUI.style.display = 'none';
                if (vendorUI && vendorUI.style.display === 'flex') vendorUI.style.display = 'none';
            }
        }
    }

    const sprite = isLocal ? this.localPlayerSprite : this.otherPlayers.get(data.id);
    
    if (sprite) {
        if (data.isDead) {
            sprite.setAlpha(0.4);
            sprite.setAngle(90);
        } else {
            sprite.setAlpha(1);
            sprite.setAngle(0);
        }
    }

    if (isLocal && this.localPlayerSprite) {
       if ((this as any)._moveSafetyTimeout) {
           clearTimeout((this as any)._moveSafetyTimeout);
           (this as any)._moveSafetyTimeout = null;
       }
       if (this.localPlayerSprite.x === data.x * this.TILE_SIZE && this.localPlayerSprite.y === data.y * this.TILE_SIZE) {
           this.isMoving = false;
           this.processNextAutoWalkStep();
           return;
       }

        this.tweens.add({
           targets: this.localPlayerSprite,
           x: data.x * this.TILE_SIZE,
           y: data.y * this.TILE_SIZE,
           duration: 250,
           onComplete: () => { 
               this.isMoving = false; 
               this.processNextAutoWalkStep();
           },
           onUpdate: () => { this.updateHpBarPosition(data.id, this.localPlayerSprite!); }
       });
    } else {
      const sprite = this.otherPlayers.get(data.id);
      if (sprite) {
        // Atualiza facing + lastMoveTime pra animar o andar deste player
        const anim = this.otherPlayerAnim.get(data.id);
        if (anim) {
          if (data.facing && FACINGS.includes(data.facing as Facing)) {
            anim.facing = data.facing as Facing;
          }
          if (data.spriteId && SPRITE_IDS.includes(data.spriteId as SpriteId)) {
            anim.spriteId = data.spriteId as SpriteId;
          }
          anim.lastMoveTime = this.time.now;
        }
        this.tweens.add({
            targets: sprite,
            x: data.x * this.TILE_SIZE,
            y: data.y * this.TILE_SIZE,
            duration: 250,
            onUpdate: () => {
              this.updateHpBarPosition(data.id, sprite);
              if (this.currentTargetId === data.id) this.updateTargetSquare(sprite);
            }
        });

        // --- CHASE: Se o alvo que se moveu é o que estamos perseguindo ---
        if (data.id === this.chaseTargetId && !data.isDead) {
            const newPos = { x: data.x, y: data.y };
            // Só re-calcula se o alvo mudou de tile
            if (!this.chaseTargetPos || this.chaseTargetPos.x !== newPos.x || this.chaseTargetPos.y !== newPos.y) {
                this.chaseTargetPos = newPos;
                this.recalculateChase();
            }
        }
        // Para chase se o alvo morreu
        if (data.id === this.chaseTargetId && data.isDead) {
            this.stopChase();
        }
         // Se o alvo selecionado morreu, limpa target
         if (data.id === this.currentTargetId && data.isDead) {
             this.currentTargetId = undefined;
             this.updateTargetSquare(null);
             const targetInfo = document.getElementById('target-info');
             if (targetInfo) targetInfo.style.display = 'none';
         }
       }
     }

     // Abre/fecha portões das safe zones baseado na distância de todos os players
     this.updateGates();
   }

   /**
    * Percorre todos os portões e os abre (alpha→0) se algum player estiver
    * a até GATE_OPEN_DISTANCE tiles, ou os fecha (alpha→1) se ninguém estiver perto.
    * Tudo client-side (puro visual): a colisão já está liberada no servidor.
    */
   private updateGates() {
     if (this.gateSprites.length === 0) return;
     // Coleta posições de todos os players conhecidos
     const positions: Array<{ x: number, y: number }> = [];
     if (this.localPlayerSprite) {
       positions.push({
         x: Math.round(this.localPlayerSprite.x / this.TILE_SIZE),
         y: Math.round(this.localPlayerSprite.y / this.TILE_SIZE),
       });
     }
     this.otherPlayersData.forEach(p => {
       if (p.x !== undefined && p.y !== undefined) positions.push({ x: p.x, y: p.y });
     });
     for (const gate of this.gateSprites) {
       const nearest = positions.reduce((min, pos) => {
         const d = Math.abs(pos.x - gate.x) + Math.abs(pos.y - gate.y);
         return d < min ? d : min;
       }, Infinity);
       const shouldOpen = nearest <= GameScene.GATE_OPEN_DISTANCE;
       if (shouldOpen === gate.isOpen) continue;
       gate.isOpen = shouldOpen;
       // Troca textura: porta fechada <-> porta aberta (sem fade)
       gate.sprite.setTexture(shouldOpen ? 'gate-door-open' : 'gate-door');
     }
   }

  /** Inicia a perseguição a um alvo — recalcula caminho até ficar adjacente */
  private startChase(targetId: string) {
    this.chaseTargetId = targetId;
    // Envia attack para o server (servidor fará auto-attack quando em range)
    this.socketManager.sendAttack(targetId);
    // Calcula caminho imediatamente
    const targetSprite = this.otherPlayers.get(targetId);
    if (targetSprite) {
        const tx = Math.round(targetSprite.x / this.TILE_SIZE);
        const ty = Math.round(targetSprite.y / this.TILE_SIZE);
        this.chaseTargetPos = { x: tx, y: ty };
        this.recalculateChase();
    }
  }

  /** Recalcula o caminho até o tile adjacente ao alvo */
  private recalculateChase() {
    if (!this.chaseTargetId || !this.chaseTargetPos || !this.localPlayerSprite) return;

    const playerX = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
    const playerY = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
    const tx = this.chaseTargetPos.x;
    const ty = this.chaseTargetPos.y;

    // Já está adjacente? Para de andar (server cuida do ataque)
    const dx = Math.abs(playerX - tx);
    const dy = Math.abs(playerY - ty);
    if (dx <= 1 && dy <= 1) {
        this.autoPath = [];
        return;
    }

    // Tenta os 4 tiles adjacentes ao alvo e escolhe o mais próximo alcançável
    const maxTileX = Math.floor(this.worldBounds.width / this.TILE_SIZE) - 1;
    const maxTileY = Math.floor(this.worldBounds.height / this.TILE_SIZE) - 1;
    const adjacentTiles = [
        { x: tx, y: ty - 1 }, { x: tx, y: ty + 1 },
        { x: tx - 1, y: ty }, { x: tx + 1, y: ty }
    ].filter(t => !this.collisionMap.has(`${t.x},${t.y}`) && t.x >= 0 && t.x <= maxTileX && t.y >= 0 && t.y <= maxTileY);

    if (adjacentTiles.length === 0) return;

    // Escolhe o adjacente mais próximo do player
    adjacentTiles.sort((a, b) => {
        const da = Math.abs(a.x - playerX) + Math.abs(a.y - playerY);
        const db = Math.abs(b.x - playerX) + Math.abs(b.y - playerY);
        return da - db;
    });

    const dest = adjacentTiles[0];
    this.autoPath = this.calculatePath(playerX, playerY, dest.x, dest.y);
    if (this.autoPath.length > 0 && !this.isMoving) {
      this.processNextAutoWalkStep();
    }
  }

  /** Cancela a perseguição atual de monstro */
  private stopChase() {
    this.chaseTargetId = undefined;
    this.chaseTargetPos = undefined;
    this.autoPath = [];
    if (this.socketManager?.socket) {
      this.socketManager.socket.emit('playerCommand', { action: 'stopAttack' });
    }
  }

  /** Inicia um chase genérico: caminha até 1 célula de distância do alvo e dispara o callback. */
  private startInteractionChase(x: number, y: number, onArrive: () => void) {
    this.stopChase();
    this.stopLootChase();
    this.interactionChase = { pos: { x, y }, onArrive };
    this.recalcInteractionChase();
  }

  private recalcInteractionChase() {
    if (!this.interactionChase || !this.localPlayerSprite) return;

    const playerX = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
    const playerY = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
    const tx = this.interactionChase.pos.x;
    const ty = this.interactionChase.pos.y;

    if (Math.abs(playerX - tx) <= 1 && Math.abs(playerY - ty) <= 1) {
      this.autoPath = [];
      const cb = this.interactionChase.onArrive;
      this.interactionChase = undefined;
      cb();
      return;
    }

    const maxTileX = Math.floor(this.worldBounds.width / this.TILE_SIZE) - 1;
    const maxTileY = Math.floor(this.worldBounds.height / this.TILE_SIZE) - 1;
    const adjacentTiles = [
      { x: tx, y: ty - 1 }, { x: tx, y: ty + 1 },
      { x: tx - 1, y: ty }, { x: tx + 1, y: ty }
    ].filter(t => !this.collisionMap.has(`${t.x},${t.y}`) && t.x >= 0 && t.x <= maxTileX && t.y >= 0 && t.y <= maxTileY);

    if (adjacentTiles.length === 0) return;

    adjacentTiles.sort((a, b) => {
      const da = Math.abs(a.x - playerX) + Math.abs(a.y - playerY);
      const db = Math.abs(b.x - playerX) + Math.abs(b.y - playerY);
      return da - db;
    });

    const dest = adjacentTiles[0];
    this.autoPath = this.calculatePath(playerX, playerY, dest.x, dest.y);
    if (this.autoPath.length > 0 && !this.isMoving) {
      this.processNextAutoWalkStep();
    }
  }

  /** Cancela a perseguição de recurso (gathering) */
  private stopNodeChase() {
    this.chaseNodeId = undefined;
    this.chaseNodePos = undefined;
    this.autoPath = [];
  }

  /** Inicia a perseguição de um nó de recurso */
  private startNodeChase(id: string, x: number, y: number) {
    this.stopChase();
    this.stopLootChase();
    this.chaseNodeId = id;
    this.chaseNodePos = { x, y };
    this.recalculateNodeChase();
  }

  private recalculateNodeChase() {
    if (!this.chaseNodeId || !this.chaseNodePos || !this.localPlayerSprite) return;

    const playerX = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
    const playerY = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
    const tx = this.chaseNodePos.x;
    const ty = this.chaseNodePos.y;

    const dx = Math.abs(playerX - tx);
    const dy = Math.abs(playerY - ty);
    if (dx <= 1 && dy <= 1) {
        this.autoPath = [];
        this.socketManager.socket.emit('startGathering', { nodeId: this.chaseNodeId });
        return;
    }

    const maxTileX = Math.floor(this.worldBounds.width / this.TILE_SIZE) - 1;
    const maxTileY = Math.floor(this.worldBounds.height / this.TILE_SIZE) - 1;
    const adjacentTiles = [
        { x: tx, y: ty - 1 }, { x: tx, y: ty + 1 },
        { x: tx - 1, y: ty }, { x: tx + 1, y: ty }
    ].filter(t => !this.collisionMap.has(`${t.x},${t.y}`) && t.x >= 0 && t.x <= maxTileX && t.y >= 0 && t.y <= maxTileY);

    if (adjacentTiles.length === 0) return;

    adjacentTiles.sort((a, b) => {
        const da = Math.abs(a.x - playerX) + Math.abs(a.y - playerY);
        const db = Math.abs(b.x - playerX) + Math.abs(b.y - playerY);
        return da - db;
    });

    const dest = adjacentTiles[0];
    this.autoPath = this.calculatePath(playerX, playerY, dest.x, dest.y);
    if (this.autoPath.length > 0 && !this.isMoving) {
        this.processNextAutoWalkStep();
    }
  }

  private startLootChase(id: string, x: number, y: number) {
      this.stopChase(); // Para de perseguir monstros
      this.lootTargetId = id;
      this.lootTargetPos = { x, y };
      
      const playerX = Math.round(this.localPlayerSprite!.x / this.TILE_SIZE);
      const playerY = Math.round(this.localPlayerSprite!.y / this.TILE_SIZE);
      
      this.autoPath = this.calculatePath(playerX, playerY, x, y);
      if (this.autoPath.length > 0 && !this.isMoving) {
          this.processNextAutoWalkStep();
      }
  }
  
  private stopLootChase() {
      this.lootTargetId = undefined;
      this.lootTargetPos = undefined;
  }


  public onPlayerDashed(data: PlayerData) {
    const isLocal = data.id === this.socketManager.getId();
    const sprite = isLocal ? this.localPlayerSprite : this.otherPlayers.get(data.id);

    if (!isLocal) {
      const anim = this.otherPlayerAnim.get(data.id);
      if (anim) {
        if (data.facing && FACINGS.includes(data.facing as Facing)) anim.facing = data.facing as Facing;
        if (data.spriteId && SPRITE_IDS.includes(data.spriteId as SpriteId)) anim.spriteId = data.spriteId as SpriteId;
        anim.lastMoveTime = this.time.now;
      }
    }

    if (sprite) {
       // Animação super rápida (Dash)
       this.tweens.add({
           targets: sprite,
           x: data.x * this.TILE_SIZE,
           y: data.y * this.TILE_SIZE,
           duration: 100, // Muito mais rápido que o walk de 250ms
           ease: 'Sine.easeOut',
           onComplete: () => {
               if (isLocal) this.isMoving = false;
           },
           onUpdate: () => {
               // Rastro (Trail Effect) super simples do phaser
               const trail = this.add.graphics({ x: sprite.x, y: sprite.y });
               trail.fillStyle(0xffffff, 0.5);
               trail.fillCircle(0, 0, 10);
               this.tweens.add({ targets: trail, alpha: 0, duration: 200, onComplete: () => trail.destroy() });
           }
       });
    }
  }

  public onProjectileCreated(data: any) {
    const proj = this.add.graphics({ x: data.x * this.TILE_SIZE + 16, y: data.y * this.TILE_SIZE + 16 });
    proj.fillStyle(0xff4500, 1); // Laranja avermelhado
    proj.fillCircle(0, 0, 8);
    proj.setDepth(15);
    this.projectiles.set(data.id, proj);
  }

  public onProjectileMoved(data: any) {
    const proj = this.projectiles.get(data.id);
    if (proj) {
        this.tweens.add({
            targets: proj,
            x: data.x * this.TILE_SIZE + 16,
            y: data.y * this.TILE_SIZE + 16,
            duration: 100 // Deve bater com o tickrate do server
        });
        
        // Particle simples de fogo
        const spark = this.add.graphics({ x: proj.x, y: proj.y });
        spark.fillStyle(0xffaa00, 0.8).fillCircle(0, 0, 4);
        this.tweens.add({ targets: spark, scale: 0, alpha: 0, duration: 300, onComplete: () => spark.destroy() });
    }
  }

  public onProjectileDestroyed(id: string) {
    const proj = this.projectiles.get(id);
    if (proj) {
        proj.destroy();
        this.projectiles.delete(id);
    }
  }

  public onPlayerDamaged(data: { id: string, health: number, maxHealth: number, amount?: number, isCrit?: boolean, attackerId?: string }) {
       const cached = this.otherPlayersData.get(data.id);
       if (cached) {
           cached.health = data.health;
           cached.maxHealth = data.maxHealth;
           if (cached.health <= 0) cached.isDead = true;
       }
       this.updateHpBar({ id: data.id, health: data.health, maxHealth: data.maxHealth } as PlayerData);
       const sprite = data.id === this.socketManager.getId() ? this.localPlayerSprite : this.otherPlayers.get(data.id);
       
       if (data.id === this.socketManager.getId() && data.attackerId) {
           const autoRetaliate = (document.getElementById('auto-retaliate-checkbox') as HTMLInputElement)?.checked;
           if (autoRetaliate && this.currentTargetId !== data.attackerId) {
               // Auto-revidar
               const attackerSprite = this.otherPlayers.get(data.attackerId);
               if (attackerSprite) {
                   this.currentTargetId = data.attackerId;
                   this.startChase(data.attackerId);
                   if (!this.isAutofarmEnabled) {
                       this.toggleAutofarm(); // Ativa autofarm
                   }
               }
           }
       }
      
      if (sprite) {
          // Feedback Visual
          sprite.setTint(0xff0000);
          this.time.delayedCall(150, () => {
              if (sprite.active) sprite.clearTint();
          });

          // Hit Splat Text
          if (data.amount !== undefined && data.amount !== 0) {
              const isHeal = data.amount < 0;
              const isCrit = data.isCrit;
              const amt = Math.abs(data.amount);
              
              let color = '#ff0000';
              let stroke = '#550000';
              let fontSize = '20px';
              let prefix = '-';
              
              if (isHeal) {
                  color = '#00ff00'; stroke = '#005500'; prefix = '+';
              } else if (isCrit) {
                  color = '#ffff00'; stroke = '#aa5500'; fontSize = '28px'; prefix = 'CRIT ';
              }
              
              const splat = this.add.text(sprite.x, sprite.y - 30, `${prefix}${amt}`, {
                  fontFamily: 'Courier New',
                  fontSize: fontSize,
                  color: color,
                  stroke: stroke,
                  strokeThickness: isCrit ? 4 : 2,
                  fontStyle: 'bold'
              }).setOrigin(0.5).setDepth(20);

              this.tweens.add({
                  targets: splat,
                  y: splat.y - (isCrit ? 60 : 40),
                  alpha: 0,
                  scale: isCrit ? 1.5 : 1,
                  duration: isCrit ? 1200 : 1000,
                  ease: 'Power2',
                  onComplete: () => splat.destroy()
              });
          }
      }
  }

  public onPlayerSpoke(id: string, message: string) {
    // Mensagens do sistema (sem sprite, vão para aba servidor)
    if (id === '__system__') {
        if ((window as any).addChatMessage) {
            (window as any).addChatMessage('servidor', 'Sistema', message);
        }
        return;
    }

    const sprite = id === this.socketManager.getId() ? this.localPlayerSprite : this.otherPlayers.get(id);
    if (!sprite) return;

    // Floating text acima do personagem (mantém para imersão)
    const text = this.add.text(sprite.x, sprite.y - 40, message, {
        fontFamily: 'Courier New',
        fontSize: '14px',
        color: '#ffff00',
        stroke: '#000000',
        strokeThickness: 3
    }).setOrigin(0.5).setDepth(15);

    this.tweens.add({
        targets: text,
        y: text.y - 20,
        alpha: 0,
        duration: 3000,
        onComplete: () => text.destroy()
    });

    // Adiciona no chat box (aba Bate-Papo)
    const playerName = this.otherPlayersData.get(id)?.name || 'Desconhecido';
    const displayName = id === this.socketManager.getId() ? 'Você' : playerName;
    if ((window as any).addChatMessage) {
      (window as any).addChatMessage('global', displayName, message);
    }
  }

  public addServerMessage(message: string, isBoss = false) {
    if ((window as any).addChatMessage) {
      (window as any).addChatMessage('servidor', '', message, true, isBoss);
    }
  }

  public onSpellCast(data: { casterId: string, targetId?: string, spell: string }) {
      const casterSprite = data.casterId === this.socketManager.getId() ? this.localPlayerSprite : this.otherPlayers.get(data.casterId);
      if (!casterSprite) return;

      if (data.spell === 'exori vis' && data.targetId) {
          // Linha mágica para o target
          const targetSprite = data.targetId === this.socketManager.getId() ? this.localPlayerSprite : this.otherPlayers.get(data.targetId);
          if (targetSprite) {
              const line = this.add.graphics();
              line.lineStyle(2, 0xff00ff, 1);
              line.beginPath();
              line.moveTo(casterSprite.x, casterSprite.y);
              line.lineTo(targetSprite.x, targetSprite.y);
              line.strokePath();
              this.tweens.add({ targets: line, alpha: 0, duration: 200, onComplete: () => line.destroy() });
          }

      } else if (data.spell === 'skillshot') {
          // Efeito de cháma disparada — um flash na posição do caster
          const flash = this.add.graphics().setDepth(18);
          flash.fillStyle(0xff6600, 0.9);
          flash.fillCircle(casterSprite.x, casterSprite.y, 10);
          this.tweens.add({
              targets: flash,
              scaleX: 1.8, scaleY: 1.8,
              alpha: 0,
              duration: 250,
              ease: 'Sine.easeOut',
              onComplete: () => flash.destroy()
          });

          // Se tem target, desenha um raio de projétil até ele
          if (data.targetId) {
              const targetSprite = data.targetId === this.socketManager.getId() ? this.localPlayerSprite : this.otherPlayers.get(data.targetId);
              if (targetSprite) {
                  const beam = this.add.graphics().setDepth(18);
                  beam.lineStyle(3, 0xff8800, 0.85);
                  beam.beginPath();
                  beam.moveTo(casterSprite.x, casterSprite.y);
                  beam.lineTo(targetSprite.x, targetSprite.y);
                  beam.strokePath();
                  this.tweens.add({ targets: beam, alpha: 0, duration: 350, onComplete: () => beam.destroy() });
              }
          }

      } else if (data.spell === 'whirlwind') {
          // Anel de giro duplo — círculo que expande e desaparece
          const ring1 = this.add.graphics().setDepth(18);
          ring1.lineStyle(5, 0xff8800, 0.9);
          ring1.strokeCircle(casterSprite.x, casterSprite.y, this.TILE_SIZE * 0.6);

          const ring2 = this.add.graphics().setDepth(18);
          ring2.lineStyle(3, 0xffdd00, 0.7);
          ring2.strokeCircle(casterSprite.x, casterSprite.y, this.TILE_SIZE * 1.2);

          const ring3 = this.add.graphics().setDepth(18);
          ring3.lineStyle(2, 0xffffff, 0.4);
          ring3.strokeCircle(casterSprite.x, casterSprite.y, this.TILE_SIZE * 2.0);

          // Texto de spell
          const label = this.add.text(casterSprite.x, casterSprite.y - 36, 'WHIRLWIND', {
              fontSize: '11px', color: '#ffaa00', fontStyle: 'bold',
              stroke: '#000', strokeThickness: 3
          }).setOrigin(0.5).setDepth(19);

          this.tweens.add({ targets: [ring1, ring2, ring3], scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: 500, ease: 'Sine.easeOut', onComplete: () => { ring1.destroy(); ring2.destroy(); ring3.destroy(); } });
          this.tweens.add({ targets: label, y: label.y - 20, alpha: 0, duration: 700, onComplete: () => label.destroy() });
      }
  }

    public onItemDropped(item: any) {
     const key = item.id;
     // Remove sprite existente com o mesmo ID (defesa contra duplicação)
     const existing = this.floorItems.get(key);
     if (existing) {
          existing.destroy();
          this.floorItems.delete(key);
     }
     const textObj = this.add.text(item.x * this.TILE_SIZE, item.y * this.TILE_SIZE, item.emoji, {
         fontSize: '20px',
         fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Android Emoji", sans-serif'
     }).setOrigin(0.5).setDepth(4); // Fica abaixo das paredes(5) e do player(10), mas acima do chão
     
     textObj.setData('isFloorItem', true);
     textObj.setData('itemName', item.name);
     textObj.setData('gridX', item.x);
     textObj.setData('gridY', item.y);
     textObj.setData('itemId', item.id);
     textObj.setInteractive({ useHandCursor: true });
     
     const tooltip = document.getElementById('item-tooltip')!;
     const tName = document.getElementById('tooltip-name')!;
     const tDesc = document.getElementById('tooltip-desc')!;
     
     textObj.on('pointerover', (pointer: Phaser.Input.Pointer) => {
         const isSkull = item.name === 'Skull' && item.metadata;
         const victimName = isSkull ? (item.metadata.victimName || '???') : null;
         const victimColor = isSkull ? (item.metadata.color || '#ef4444') : null;
         const kindLabel = isSkull ? (item.metadata.kind === 'boss' ? 'Boss' : 'Jogador') : null;

         const baseName = (window as any).translateItem
             ? (window as any).translateItem(item.name)
             : item.name;

         if (isSkull) {
             // Exibe "Caveira de <victim>" com a cor do tipo
             tName.innerHTML = `${baseName} de <span style="color:${victimColor}; font-weight:bold;">${victimName}</span>`;
             tName.style.color = '#ffffff';
         } else {
             const details = this.itemDetails[item.name] || { name: item.name, desc: 'Item caído no chão.', color: '#ffffff' };
             tName.innerText = details.name;
             tName.style.color = details.color;
         }

         const desc = isSkull
             ? `Caveira de ${kindLabel} derrotado em combate.\n\nClique no chão para andar e pegá-la.`
             : ((this.itemDetails[item.name]?.desc) || 'Item caído no chão.') + '\n\nClique no chão para andar e pegá-lo.';
         tDesc.innerText = desc;

         const rect = this.game.canvas.getBoundingClientRect();
         this.positionTooltip(pointer.x + rect.left + window.scrollX, pointer.y + rect.top + window.scrollY);
     });
     
     textObj.on('pointermove', (pointer: Phaser.Input.Pointer) => {
         const rect = this.game.canvas.getBoundingClientRect();
         this.positionTooltip(pointer.x + rect.left + window.scrollX, pointer.y + rect.top + window.scrollY);
     });
     
     textObj.on('pointerout', () => {
         tooltip.style.display = 'none';
     });
     
     this.floorItems.set(key, textObj);
  }

  public onItemRemoved(id: string) {
     const textObj = this.floorItems.get(id);
     if (textObj) {
          textObj.destroy();
          this.floorItems.delete(id);
          
          // Oculta o tooltip se o item destruído era o que estava sob o mouse
          const tooltip = document.getElementById('item-tooltip')!;
          if (tooltip) tooltip.style.display = 'none';
     }
  }

  public onItemPickedUp(item: any) {
     const qty = item.qty && item.qty > 1 ? ` x${item.qty}` : '';
     const translated = (window as any).translateItem
         ? (window as any).translateItem(item.name)
         : item.name;
     this.onTextEffect(
         Math.round(this.localPlayerSprite!.x / this.TILE_SIZE),
         Math.round(this.localPlayerSprite!.y / this.TILE_SIZE),
         `${translated}${qty}`,
         '#10b981'
     );
  }

  public onEquipmentUpdate(eq: any) {
         this.equipmentData = eq;
         const getEmoji = (itemStr: string) => {
             let name = itemStr;
             if (itemStr && itemStr.startsWith('{')) {
                 try {
                     name = JSON.parse(itemStr).name;
                 } catch(e){}
             }
             if (name === 'Steel Sword' || name === 'Wood Sword') return '🗡️';
             if (name === 'Torch') return '🔦';
             if (name === 'Helmet') return '👑';
             if (name === 'Armor') return '👕';
             if (name === 'Pants') return '👖';
             if (name === 'Leather Boots') return '🥾';
             if (name === 'Leather Backpack') return '🎒';
             if (name === 'Wooden Backpack') return '💼';
             if (name === 'Iron Backpack') return '🧳';
             return name;
         };

         if (eq.head) {
             const el = document.getElementById('slot-head')!;
             el.innerText = getEmoji(eq.head);
             el.onclick = () => this.socketManager.sendUnequip('head');
         } else {
             document.getElementById('slot-head')!.innerText = 'Head';
             document.getElementById('slot-head')!.onclick = null;
         }

         if (eq.body) {
             const el = document.getElementById('slot-body')!;
             el.innerText = getEmoji(eq.body);
             el.onclick = () => this.socketManager.sendUnequip('body');
         } else {
             document.getElementById('slot-body')!.innerText = 'Body';
             document.getElementById('slot-body')!.onclick = null;
         }

         if (eq.legs) {
             const el = document.getElementById('slot-legs')!;
             el.innerText = getEmoji(eq.legs);
             el.onclick = () => this.socketManager.sendUnequip('legs');
         } else {
             document.getElementById('slot-legs')!.innerText = 'Legs';
             document.getElementById('slot-legs')!.onclick = null;
         }

         if (eq.boots) {
             const el = document.getElementById('slot-boots')!;
             el.innerText = getEmoji(eq.boots);
             el.onclick = () => this.socketManager.sendUnequip('boots');
         } else {
             document.getElementById('slot-boots')!.innerText = 'Boots';
             document.getElementById('slot-boots')!.onclick = null;
         }
         
         if (eq.leftHand) {
             const el = document.getElementById('slot-left')!;
             el.innerText = getEmoji(eq.leftHand);
             el.onclick = () => this.socketManager.sendUnequip('leftHand');
             this.hasTorch = eq.leftHand === 'Torch';
         } else {
             document.getElementById('slot-left')!.innerText = 'L-Hand';
             document.getElementById('slot-left')!.onclick = null;
             this.hasTorch = false;
         }
         
         if (eq.rightHand) {
             const el = document.getElementById('slot-right')!;
             el.innerText = getEmoji(eq.rightHand);
             el.onclick = () => this.socketManager.sendUnequip('rightHand');
         } else {
             document.getElementById('slot-right')!.innerText = 'R-Hand';
             document.getElementById('slot-right')!.onclick = null;
         }

         if (eq.backpack) {
             const el = document.getElementById('slot-backpack')!;
             el.innerText = getEmoji(eq.backpack);
             el.onclick = () => this.socketManager.sendUnequip('backpack');
         } else {
             document.getElementById('slot-backpack')!.innerText = 'Bolsa';
             document.getElementById('slot-backpack')!.onclick = null;
         }
         
         const equipSlots = ['slot-head', 'slot-body', 'slot-legs', 'slot-boots', 'slot-left', 'slot-right', 'slot-backpack'];
         equipSlots.forEach(id => {
             const el = document.getElementById(id);
             if (el) {
                 // Se o texto for curto (provavelmente um Emoji), aumenta a fonte. Senão volta ao padrão 11px.
                 const isEmoji = el.innerText.length <= 4 && el.innerText !== '';
                 el.style.fontSize = isEmoji ? '24px' : '11px';
                 el.style.cursor = isEmoji ? 'pointer' : 'default';
                 el.style.color = isEmoji ? '#ffffff' : '#475569';

                 if (isEmoji && this.showTooltipFn && this.moveTooltipFn && this.hideTooltipFn) {
                     let name = '';
                     if (id === 'slot-head') name = eq.head || '';
                     else if (id === 'slot-body') name = eq.body || '';
                     else if (id === 'slot-legs') name = eq.legs || '';
                     else if (id === 'slot-boots') name = eq.boots || '';
                     else if (id === 'slot-left') name = eq.leftHand || '';
                     else if (id === 'slot-right') name = eq.rightHand || '';
                     else if (id === 'slot-backpack') name = eq.backpack || '';
                     
                     if (name.includes(':')) name = name.split(':')[0];
                     if (name.startsWith('{')) {
                         try { name = JSON.parse(name).name; } catch(e){}
                     }
                     
                     el.dataset.itemName = name;
                     el.removeEventListener('mouseenter', this.showTooltipFn);
                     el.removeEventListener('mousemove', this.moveTooltipFn);
                     el.removeEventListener('mouseleave', this.hideTooltipFn);
                     el.addEventListener('mouseenter', this.showTooltipFn);
                     el.addEventListener('mousemove', this.moveTooltipFn);
                     el.addEventListener('mouseleave', this.hideTooltipFn);
                 } else {
                     if (this.showTooltipFn && this.moveTooltipFn && this.hideTooltipFn) {
                         el.removeEventListener('mouseenter', this.showTooltipFn);
                         el.removeEventListener('mousemove', this.moveTooltipFn);
                         el.removeEventListener('mouseleave', this.hideTooltipFn);
                     }
                 }
             }
         });
  }

  public backpackData: string[] = []; // Armazena a bolsa localmente para facilitar a renderização da loja

  private getMaxBackpackSlotsClient(): number {
      if (!this.equipmentData || !this.equipmentData.backpack) {
          return 8;
      }
      const bp = this.equipmentData.backpack;
      let name = bp;
      if (bp.startsWith('{')) {
          try {
              name = JSON.parse(bp).name;
          } catch(e){}
      }
      if (name === 'Leather Backpack') return 16;
      if (name === 'Wooden Backpack') return 24;
      if (name === 'Iron Backpack') return 32;
      return 8;
  }

  public onInventoryUpdate(backpack: string[]) {
     this.backpackData = backpack;
     
     const grid = document.getElementById('backpack-grid');
     if (!grid) return;
     
     const maxSlots = this.getMaxBackpackSlotsClient();
     
     // Recria os slots se o tamanho atual no DOM for diferente do limite maxSlots
     if (grid.children.length !== maxSlots) {
         grid.innerHTML = '';
         for (let i = 0; i < maxSlots; i++) {
             const slotDiv = document.createElement('div');
             slotDiv.className = 'slot';
             slotDiv.setAttribute('data-index', i.toString());
             grid.appendChild(slotDiv);
         }
     }
     
     const slots = grid.querySelectorAll('.slot');
     slots.forEach((slot, index) => {
         const htmlSlot = slot as HTMLElement;
         htmlSlot.onclick = null;
         htmlSlot.oncontextmenu = null;
         
         const itemString = backpack[index];
         if (itemString) {
             let baseItemName = itemString;
             let count = 1;
             
             if (itemString.startsWith('{')) {
                 try {
                     baseItemName = JSON.parse(itemString).name;
                 } catch(e){}
             } else if (itemString.includes(':')) {
                 const [name, countStr] = itemString.split(':');
                 baseItemName = name;
                 count = parseInt(countStr) || 1;
             }
             
              const emojis: Record<string, string> = {
                  'Cheese': '🧀', 'Gold Coin': '💰', 'Apple': '🍎', 'Health Potion': '🧪',
                  'Mana Potion': '💙', 'Blueberry': '🍇',
                  'Steel Sword': '🗡️', 'Wood Sword': '🗡️', 'Torch': '🔦',
                  'Helmet': '👑', 'Armor': '👕', 'Pants': '👖', 'Leather Boots': '🥾',
                   'Iron Ore': '🌑', 'Wood Log': '🌲', 'Medicinal Herb': '🌿', 'Leather Hide': '🥩',
                  'Leather Backpack': '🎒', 'Wooden Backpack': '💼', 'Iron Backpack': '🧳',
                  'Skull': '💀'
              };

              const isEmojiChar = baseItemName.length <= 4;
              const emoji = emojis[baseItemName] || (isEmojiChar ? baseItemName : '📦');

              // Se tiver mais de 1 item, exibe o contador no canto inferior direito
             if (count > 1) {
                 htmlSlot.innerHTML = `
                     <div style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                         <span>${emoji}</span>
                         <span style="position: absolute; bottom: -2px; right: 2px; font-size: 11px; color: #fbbf24; font-weight: bold; font-family: monospace; text-shadow: 1px 1px 0 #000;">${count}</span>
                     </div>
                 `;
             } else {
                 htmlSlot.innerText = emoji;
             }
             
             htmlSlot.style.cursor = 'pointer';
             htmlSlot.style.fontSize = '24px';
             
              // Left-click = Depositar se o banco estiver aberto, senão Dropar item
              htmlSlot.onclick = () => {
                  const bankModal = document.getElementById('modal-bank');
                  const isBankOpen = bankModal && bankModal.style.display === 'flex';
                  if (isBankOpen) {
                      // Pergunta a quantidade se for stack; senão deposita tudo
                      let qty = count;
                      if (count > 1) {
                          const input = prompt(`Quantos enviar para o cofre? (1 a ${count})`, count.toString());
                          if (input === null) return;
                          qty = parseInt(input);
                          if (isNaN(qty) || qty < 1 || qty > count) {
                              this.onTextEffect(
                                  Math.round(this.localPlayerSprite!.x / this.TILE_SIZE),
                                  Math.round(this.localPlayerSprite!.y / this.TILE_SIZE),
                                  'Quantidade inválida!',
                                  '#ff5555'
                              );
                              return;
                          }
                      }
                      this.socketManager.socket.emit('bank:depositItem', { backpackIndex: index, amount: qty });
                  } else {
                      if (count > 1) {
                          const input = prompt(`Quantos deseja dropar? (1 a ${count})`, count.toString());
                          if (input !== null) {
                              const amount = parseInt(input);
                              if (!isNaN(amount) && amount >= 1 && amount <= count) {
                                  this.socketManager.sendDropItem(index, amount);
                              }
                          }
                      } else {
                          this.socketManager.sendDropItem(index, 1);
                      }
                 }
             };
             
              // Right-click = Abrir menu de contexto do item
             htmlSlot.oncontextmenu = (e: MouseEvent) => {
                 e.preventDefault();
                 this.openBackpackContextMenu(e.clientX, e.clientY, index);
             };

              if (this.showTooltipFn && this.moveTooltipFn && this.hideTooltipFn) {
                  htmlSlot.removeEventListener('mouseenter', this.showTooltipFn);
                  htmlSlot.removeEventListener('mousemove', this.moveTooltipFn);
                  htmlSlot.removeEventListener('mouseleave', this.hideTooltipFn);
                  htmlSlot.addEventListener('mouseenter', this.showTooltipFn);
                  htmlSlot.addEventListener('mousemove', this.moveTooltipFn);
                  htmlSlot.addEventListener('mouseleave', this.hideTooltipFn);
              }

              // Drag & Drop: começar arrasto
              htmlSlot.draggable = true;
              htmlSlot.ondragstart = (e: DragEvent) => {
                  e.dataTransfer?.setData('text/plain', index.toString());
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              };
          } else {
              htmlSlot.innerHTML = '';
              htmlSlot.style.cursor = 'default';
              htmlSlot.draggable = false;
              htmlSlot.ondragstart = null;
          }
     });
     
     // Atualiza a aba Sell da loja se ela estiver aberta
     if (document.getElementById('shop-ui')?.style.display === 'flex') {
          this.renderShopSell();
     }
  }

  public openBankUI() {
      const ui = document.getElementById('modal-bank');
      if (!ui) return;

      ui.style.display = 'flex';

      // Re-atualiza mochila para ligar click de depositar
      this.onInventoryUpdate(this.backpackData);

      // Vincula fechar modal
      const closeBtn = ui.querySelector('.close-modal') as HTMLElement;
      if (closeBtn) {
          closeBtn.onclick = () => {
              ui.style.display = 'none';
              // Restaura clicks normais da mochila
              this.onInventoryUpdate(this.backpackData);
          };
      }

      // Vincula botões de depósito/saque
      const btnDeposit = document.getElementById('btn-bank-deposit') as HTMLButtonElement;
      const btnWithdraw = document.getElementById('btn-bank-withdraw') as HTMLButtonElement;
      const goldInput = document.getElementById('bank-gold-input') as HTMLInputElement;

      if (btnDeposit) {
          btnDeposit.onclick = () => {
              const amount = parseInt(goldInput.value);
              if (!isNaN(amount) && amount > 0) {
                  this.socketManager.socket.emit('bank:depositGold', { amount });
                  goldInput.value = '';
              }
          };
      }

      if (btnWithdraw) {
          btnWithdraw.onclick = () => {
              const amount = parseInt(goldInput.value);
              if (!isNaN(amount) && amount > 0) {
                  this.socketManager.socket.emit('bank:withdrawGold', { amount });
                  goldInput.value = '';
              }
          };
      }

      // Botão Organizar Banco
      const btnSortBank = document.getElementById('btn-sort-bank') as HTMLButtonElement;
      if (btnSortBank) {
          btnSortBank.onclick = () => {
              this.socketManager.socket.emit('bank:sort');
          };
      }

      // Inicializa grade do banco se vazia
      this.renderBankGrid();
  }

  public onBankUpdate(data: { bankGold: number, bankItems: string[], bankDebtDays: number }) {
      this.bankGold = data.bankGold;
      this.bankItems = data.bankItems;
      this.bankDebtDays = data.bankDebtDays;

      const goldAmt = document.getElementById('bank-gold-amount');
      if (goldAmt) goldAmt.innerText = this.bankGold.toString();

      const statusMsg = document.getElementById('bank-status-msg');
      const lockedAlert = document.getElementById('bank-locked-alert');

      if (statusMsg) {
          if (this.bankDebtDays < 0) {
              statusMsg.innerText = `Em Atraso (${this.bankDebtDays} dias)`;
              statusMsg.style.color = '#f87171'; // vermelho
              if (lockedAlert) lockedAlert.style.display = 'inline';
          } else if (this.bankGold === 0) {
              statusMsg.innerText = 'Sem Saldo';
              statusMsg.style.color = '#fbbf24'; // amarelo
              if (lockedAlert) lockedAlert.style.display = 'inline';
          } else {
              statusMsg.innerText = 'Regular';
              statusMsg.style.color = '#4ade80'; // verde
              if (lockedAlert) lockedAlert.style.display = 'none';
          }
      }

      this.renderBankGrid();
  }

  public renderBankGrid() {
      const grid = document.getElementById('bank-grid');
      if (!grid) return;

      grid.innerHTML = '';
      for (let i = 0; i < 50; i++) {
          const slotDiv = document.createElement('div');
          slotDiv.className = 'slot';
          slotDiv.setAttribute('data-index', i.toString());

          const itemString = this.bankItems[i];
          if (itemString) {
              let baseItemName = itemString;
              let count = 1;

              if (itemString.startsWith('{')) {
                  try {
                      baseItemName = JSON.parse(itemString).name;
                  } catch(e){}
              } else if (itemString.includes(':')) {
                  const [name, countStr] = itemString.split(':');
                  baseItemName = name;
                  count = parseInt(countStr) || 1;
              }

               const emojis: Record<string, string> = {
                   'Cheese': '🧀', 'Gold Coin': '💰', 'Apple': '🍎', 'Health Potion': '🧪',
                   'Mana Potion': '💙', 'Blueberry': '🍇',
                   'Steel Sword': '🗡️', 'Wood Sword': '🗡️', 'Torch': '🔦',
                   'Helmet': '👑', 'Armor': '👕', 'Pants': '👖', 'Leather Boots': '🥾',
                   'Iron Ore': '🌑', 'Wood Log': '🌲', 'Medicinal Herb': '🌿', 'Leather Hide': '🥩',
                   'Leather Backpack': '🎒', 'Wooden Backpack': '💼', 'Iron Backpack': '🧳',
                   'Skull': '💀'
               };

               const isEmojiChar = baseItemName.length <= 4;
               const emoji = emojis[baseItemName] || (isEmojiChar ? baseItemName : '📦');

              if (count > 1) {
                  slotDiv.innerHTML = `
                      <div style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                          <span>${emoji}</span>
                          <span style="position: absolute; bottom: -2px; right: 2px; font-size: 11px; color: #fbbf24; font-weight: bold; font-family: monospace; text-shadow: 1px 1px 0 #000;">${count}</span>
                      </div>
                  `;
              } else {
                  slotDiv.innerText = emoji;
              }

              slotDiv.style.cursor = 'pointer';
              slotDiv.style.fontSize = '24px';

              // Clique no item do banco para retirar
              slotDiv.onclick = () => {
                  this.socketManager.socket.emit('bank:withdrawItem', { bankIndex: i, backpackIndex: -1 });
              };

              // Tooltips
              if (this.showTooltipFn && this.moveTooltipFn && this.hideTooltipFn) {
                  slotDiv.addEventListener('mouseenter', this.showTooltipFn);
                  slotDiv.addEventListener('mousemove', this.moveTooltipFn);
                  slotDiv.addEventListener('mouseleave', this.hideTooltipFn);
              }
          }

          grid.appendChild(slotDiv);
      }
  }

  public renderShopSell() {
      const content = document.getElementById('shop-content');
      if (!content) return;
      
      const sellPrices: Record<string, number> = { 'Cheese': 2, 'Apple': 3, 'Steel Sword': 25, 'Mana Potion': 5, 'Blueberry': 1 };
      const emojis: Record<string, string> = {
          'Cheese': '🧀', 'Apple': '🍎', 'Steel Sword': '🗡️',
          'Health Potion': '🧪', 'Mana Potion': '💙', 'Blueberry': '🍇', 'Torch': '🔦',
          'Iron Ore': '🌑', 'Wood Log': '🌲', 'Medicinal Herb': '🌿', 'Leather Hide': '📦',
          'Skull': '💀'
      };
      
      content.innerHTML = '';
      
      let hasItems = false;
      
      this.backpackData.forEach((itemString, index) => {
          if (itemString && itemString !== '') {
              hasItems = true;
              
              let baseItemName = itemString;
              let count = 1;
              
              if (itemString.startsWith('{')) {
                  try {
                      const parsed = JSON.parse(itemString);
                      baseItemName = parsed.name;
                  } catch (e) {}
              } else if (itemString.includes(':')) {
                  const [name, countStr] = itemString.split(':');
                  baseItemName = name;
                  count = parseInt(countStr) || 1;
              }
              
              const emoji = emojis[baseItemName] || '📦';
              const val = sellPrices[baseItemName] || 1;
              const displayItemName = (window as any).translateItem ? (window as any).translateItem(itemString) : baseItemName;
              
              const div = document.createElement('div');
              div.style.display = 'flex';
              div.style.justifyContent = 'space-between';
              div.style.alignItems = 'center';
              div.style.padding = '8px';
              div.style.borderBottom = '1px solid #333';
              
              div.innerHTML = `
                  <span class="shop-item-hover" style="cursor: help; text-decoration: underline dotted rgba(255,255,255,0.3);">${emoji} ${displayItemName} (x${count})</span>
                  <button style="background: #ff4444; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">
                      Vender (+${val} Ouro)
                  </button>
              `;
              
              const span = div.querySelector('.shop-item-hover') as HTMLElement;
              if (span) {
                  const tooltip = document.getElementById('item-tooltip')!;
                  const tName = document.getElementById('tooltip-name')!;
                  const tDesc = document.getElementById('tooltip-desc')!;
                  
                  span.addEventListener('mouseenter', (e) => {
                      const details = this.itemDetails[baseItemName] || { name: baseItemName, desc: 'Item na bolsa', color: '#ffffff' };
                      tName.innerText = details.name;
                      tName.style.color = details.color;
                      tDesc.innerText = details.desc;
                      this.positionTooltip(e.pageX, e.pageY);
                  });
                  span.addEventListener('mousemove', (e) => {
                      this.positionTooltip(e.pageX, e.pageY);
                  });
                  span.addEventListener('mouseleave', () => {
                      tooltip.style.display = 'none';
                  });
               }
              
              div.querySelector('button')!.onclick = () => {
                  this.socketManager.sendSell(index);
              };
              
              content.appendChild(div);
          }
      });
      
      if (!hasItems) {
          content.innerHTML = '<div style="text-align: center; color: #888; padding: 10px;">Sua mochila está vazia.</div>';
      }
  }

  public onStatsUpdate(data: any) {
      if (data.id !== this.socketManager.getId()) return;
      
      if (data.level !== undefined && data.experience !== undefined) {
          const expNeeded = data.level * 100;
          const pct = (data.experience / expNeeded) * 100;
          const expFill = document.getElementById('exp-fill');
          const expText = document.getElementById('exp-text');
          
          if (expFill) expFill.style.width = `${Math.min(pct, 100)}%`;
          if (expText) expText.innerText = `Level ${data.level} (${data.experience}/${expNeeded})`;
      }
      
      if (data.gold !== undefined) {
          const goldEl = document.getElementById('gold-value');
          if (goldEl) goldEl.innerText = data.gold.toString();
      }
      
      // Atualiza localização no card do player (Gold à esquerda | Localização à direita)
      if (data.x !== undefined && data.y !== undefined) {
          const locEl = document.getElementById('player-location');
          if (locEl) locEl.innerText = `Localização: ${data.x}, ${data.y}`;
      }
      
      if (data.stats) {
          ['FOR', 'AGI', 'VIT', 'INT', 'DES', 'SOR'].forEach(stat => {
              const valEl = document.getElementById(`val-${stat}`);
              if (valEl) valEl.innerText = data.stats[stat].toString();
          });
      }
      
      if (data.statPoints !== undefined) {
          const ptsEl = document.getElementById('stat-points');
          const buttons = document.querySelectorAll('.btn-stat-add');
          if (data.statPoints > 0) {
              if (ptsEl) ptsEl.innerText = `Pts: ${data.statPoints}`;
              buttons.forEach(btn => (btn as HTMLElement).style.display = 'inline-block');
          } else {
              if (ptsEl) ptsEl.innerText = `Pts: 0`;
              buttons.forEach(btn => (btn as HTMLElement).style.display = 'none');
          }
      }
      
      // Update HP
      if (data.health !== undefined && data.maxHealth !== undefined) {
          this.localHealth = data.health;
          this.localMaxHealth = data.maxHealth;
          this.localPlayerDead = (data.health <= 0);
          
          const pct = Math.max(0, data.health / data.maxHealth);
          const healthFill = document.getElementById('health-fill');
          const healthText = document.getElementById('health-text');
          if (healthFill) healthFill.style.width = `${pct * 100}%`;
          if (healthText) healthText.innerText = `${Math.max(0, Math.round(data.health))}/${data.maxHealth}`;
          
          this.updateHpBar({ id: data.id, health: data.health, maxHealth: data.maxHealth } as PlayerData);
      }

      // Update Secondary Stats
      const secStats = ['ATK', 'MATK', 'DEF', 'MDEF', 'HIT', 'DODGE', 'ASPD'];
      secStats.forEach(stat => {
          const serverKey = stat === 'ATK' ? 'attack' : stat.toLowerCase();
          if (data[serverKey] !== undefined) {
              const el = document.getElementById(`val-${stat}`);
              if (el) {
                  let val = data[serverKey].toString();
                  if (stat === 'ASPD') {
                      // Converte cooldown ms em pontuação de ASPD (Ragnarok Style: 50 a 180) e exibe velocidade real
                      const cooldownMs = Number(data[serverKey]);
                      const attacksPerSec = (1000 / cooldownMs).toFixed(2);
                      const aspdScore = Math.floor(200 - (cooldownMs / 10));
                      val = `${aspdScore} (${attacksPerSec}/s)`;
                  }
                  el.innerText = val;
              }
          }
      });
      if (data.crit !== undefined) {
          const el = document.getElementById('val-CRIT');
          if (el) el.innerText = `${data.crit}%`;
      }
      
      // Update SP
      if (data.sp !== undefined && data.maxSp !== undefined) {
          this.localSp = data.sp;
          this.localMaxSp = data.maxSp;
          const pct = (data.sp / data.maxSp) * 100;
          const fill = document.getElementById('sp-fill');
          const text = document.getElementById('sp-text');
          if (fill) fill.style.width = `${Math.max(0, Math.min(pct, 100))}%`;
          if (text) text.innerText = `${data.sp}/${data.maxSp}`;
      }
      
      // Update Weight
      if (data.weight !== undefined && data.maxWeight !== undefined) {
          const pct = (data.weight / data.maxWeight) * 100;
          const fill = document.getElementById('weight-fill');
          const text = document.getElementById('weight-text');
          if (fill) fill.style.width = `${Math.max(0, Math.min(pct, 100))}%`;
          if (text) text.innerText = `Cap: ${data.weight}/${data.maxWeight}`;
          if (fill) fill.style.background = pct > 90 ? '#ef4444' : '#d97706';
      }

      // Update local professions & learned recipes
      let profChanged = false;
      if (data.professionSmithingLevel !== undefined) { this.professionSmithingLevel = data.professionSmithingLevel; profChanged = true; }
      if (data.professionSmithingXp !== undefined) { this.professionSmithingXp = data.professionSmithingXp; profChanged = true; }
      if (data.professionAlchemyLevel !== undefined) { this.professionAlchemyLevel = data.professionAlchemyLevel; profChanged = true; }
      if (data.professionAlchemyXp !== undefined) { this.professionAlchemyXp = data.professionAlchemyXp; profChanged = true; }
      if (data.professionTanningLevel !== undefined) { this.professionTanningLevel = data.professionTanningLevel; profChanged = true; }
      if (data.professionTanningXp !== undefined) { this.professionTanningXp = data.professionTanningXp; profChanged = true; }
      if (data.learnedRecipes !== undefined) this.learnedRecipes = data.learnedRecipes;
      if (profChanged) this.refreshCraftingProfessionDisplay();
  }

  public onLevelUp(data: { id: string, level: number }) {
      const sprite = data.id === this.socketManager.getId() ? this.localPlayerSprite : this.otherPlayers.get(data.id);
      if (sprite) {
          const levelText = this.add.text(sprite.x, sprite.y - 40, 'LEVEL UP!', {
              fontSize: '24px',
              color: '#fbbf24',
              fontStyle: 'bold',
              stroke: '#ffffff',
              strokeThickness: 2
          }).setOrigin(0.5).setDepth(20);

          this.tweens.add({
              targets: levelText,
              y: levelText.y - 50,
              scale: 1.5,
              alpha: 0,
              duration: 2000,
              ease: 'Power2',
              onComplete: () => levelText.destroy()
          });
          
          if (data.id === this.socketManager.getId()) {
              document.getElementById('player-level-display')!.innerText = `Level ${data.level}`;
          }
      }
  }

  public onTextEffect(x: number, y: number, msg: string, color: string) {
      const text = this.add.text(x * this.TILE_SIZE, y * this.TILE_SIZE - 20, msg, {
          fontFamily: 'Courier New',
          fontSize: '16px',
          color: color,
          stroke: '#000000',
          strokeThickness: 3,
          fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(16);

      this.tweens.add({
          targets: text,
          y: text.y - 30,
          alpha: 0,
          duration: 1500,
          onComplete: () => text.destroy()
      });
  }

  public onPlayerLeft(id: string) {
    this.otherPlayersData.delete(id);
    const sprite = this.otherPlayers.get(id);
    if (sprite) {
      sprite.destroy();
      this.otherPlayers.delete(id);
    }
    const label = this.otherPlayerLabels.get(id);
    if (label) {
      label.destroy();
      this.otherPlayerLabels.delete(id);
    }
    const hpBar = this.hpBars.get(id);
    if (hpBar) {
      hpBar.destroy();
      this.hpBars.delete(id);
    }
    if (this.currentTargetId === id) {
       this.currentTargetId = undefined;
       this.targetSquare?.setVisible(false);
    }
  }

  private addOtherPlayer(data: PlayerData) {
    let texture = 'tiberius-sprite';
    let isCharacterSprite = false;
    let npcType: string | undefined = (data as any).npcType;
    const isNpc = !!(data as any).isNPC;
    // Fallback: se o servidor não mandou npcType, identifica pelo id
    if (isNpc && !npcType) {
      if (typeof data.id === 'string') {
        if (data.id.startsWith('npc_teleporter_')) npcType = 'teleporter';
        else if (data.id.startsWith('npc_vendor_')) npcType = 'vendor';
        else if (data.id === 'npc_merchant') npcType = 'merchant';
        else if (data.id === 'npc_banker') npcType = 'banker';
        else if (data.id.startsWith('npc_questgiver')) npcType = 'questgiver';
      }
    }
    if (isNpc) {
      console.log(`[NPC] addOtherPlayer id=${data.id} name="${data.name}" isNPC=${isNpc} npcType=${npcType}`);
    }
    if (data.isMonster) {
        if (data.name === 'Orc') texture = 'orc-sprite';
        else if (data.name === 'Rotworm') texture = 'rotworm-sprite';
        else if (data.name === 'Demon Skeleton') texture = 'demonskeleton-sprite';
        else if (data.name === 'Nightmare Skeleton') texture = 'demonskeleton-sprite';
        else texture = 'rat-sprite';
    } else if (data.name === 'Merchant') {
        texture = 'merchant-sprite';
    } else if (data.name === 'Banker') {
        texture = 'banker-sprite';
    } else if (npcType === 'teleporter') {
        texture = 'teleporter-sprite';
    } else if (npcType === 'vendor') {
        texture = 'vendor-sprite';
    } else if (npcType === 'questgiver') {
        texture = 'teleporter-sprite'; // reusa sprite do mago
    } else {
        // Personagem de jogador: usa o sprite selecionado
        texture = 'characters';
        isCharacterSprite = true;
    }

    const sprite = this.add.sprite(
      data.x * this.TILE_SIZE,
      data.y * this.TILE_SIZE,
      texture,
      isCharacterSprite ? getFrameIndex((data.spriteId as SpriteId) || 'm1', (data.facing as Facing) || 'down', 0) : 0
    );

    // Inicializa estado de animação de outros jogadores
    if (isCharacterSprite) {
      this.otherPlayerAnim.set(data.id, {
        walkFrame: 0,
        walkTimer: 0,
        lastMoveTime: 0,
        facing: (data.facing as Facing) || 'down',
        spriteId: (data.spriteId as SpriteId) || 'm1'
      });
      sprite.flipX = ((data.facing as Facing) || 'down') === 'right';
    }

    if (isCharacterSprite) {
        sprite.setScale(2);
    } else if (data.name === 'Nightmare Skeleton') {
        sprite.setScale(2);
        sprite.setTint(0xff00ff); // Roxo demoníaco
    } else if (npcType === 'teleporter') {
        // Mago teleportador: mantém cor natural (azul-royal)
    } else if (npcType === 'vendor') {
        // Vendedor: mantém cor natural
    } else if (npcType === 'questgiver') {
        sprite.setTint(0xa855f7); // Roxo
    } else if (!data.isMonster && !isNpc) {
        sprite.setTint(0xff0000); // Jogadores inimigos em vermelho
    }
    sprite.setDepth(10);
    sprite.setInteractive({ useHandCursor: true }); // Torna clicável

    // Nomes Coloridos de acordo com o nível/perigo
    let nameColor = '#ffffff';
    if (data.name === 'Orc') nameColor = '#f97316';
    else if (data.name === 'Rotworm') nameColor = '#ec4899';
    else if (data.name === 'Demon Skeleton') nameColor = '#ef4444';
    else if (data.name === 'Nightmare Skeleton') nameColor = '#ff00ff';
    else if (data.name === 'Merchant') nameColor = '#fbbf24';
    else if (data.name === 'Banker') nameColor = '#10b981';
    else if (npcType === 'teleporter') nameColor = '#60a5fa';
    else if (npcType === 'vendor') nameColor = '#d97706';
    else if (npcType === 'questgiver') nameColor = '#a855f7';
    else if (data.name === 'Giant Rat') nameColor = '#94a3b8';

    const displayName = (window as any).translateMonster ? (window as any).translateMonster(data.name) : data.name;
    const coordText = `(${data.x}, ${data.y})`;
    const nameLabel = this.add.text(sprite.x, sprite.y - 30, `[Lv.${data.level || 1}] ${displayName} ${coordText}`, {
        fontSize: '10px',
        color: nameColor,
        fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Android Emoji", sans-serif'
    }).setOrigin(0.5).setVisible(false);
    this.otherPlayerLabels.set(data.id, nameLabel);

    // Botão ESQUERDO = selecionar (marcar target), sem atacar
    sprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (isNpc) console.log(`[NPC] clique em ${data.id} (npcType=${npcType})`);
      if (data.name === 'Merchant') {
          this.startInteractionChase(data.x, data.y, () => this.socketManager.openShop());
      } else if (data.name === 'Banker') {
          this.startInteractionChase(data.x, data.y, () => this.openBankUI());
      } else if (npcType === 'teleporter') {
          this.startInteractionChase(data.x, data.y, () => {
            console.log(`[NPC] chegou no teleporter ${data.id}, emitindo npc:interact`);
            this.socketManager.interactNPC(data.id);
          });
      } else if (npcType === 'vendor') {
          this.startInteractionChase(data.x, data.y, () => {
            console.log(`[NPC] chegou no vendor ${data.id}, emitindo npc:interact`);
            this.socketManager.interactNPC(data.id);
          });
      } else if (npcType === 'questgiver') {
          this.startInteractionChase(data.x, data.y, () => {
            console.log(`[NPC] chegou no questgiver ${data.id}, emitindo npc:interact`);
            this.socketManager.interactNPC(data.id);
          });
      } else if (pointer.rightButtonDown()) {
          if (!isNpc) {
              this.currentTargetId = data.id;
              const sp = this.otherPlayers.get(data.id);
              this.updateTargetSquare(sp || null);
              this.startChase(data.id);
          }
      } else {
          this.stopChase();
          this.currentTargetId = data.id;
          this.updateTargetSquare(sprite);
      }
    });

    // DUPLO CLIQUE esquerdo = perseguir e atacar (somente inimigos)
    sprite.on('pointerdblclick', () => {
      if (!isNpc && !data.isMonster) {
          this.currentTargetId = data.id;
          this.updateTargetSquare(sprite);
          this.startChase(data.id);
      } else if (data.isMonster) {
          this.currentTargetId = data.id;
          this.updateTargetSquare(sprite);
          this.startChase(data.id);
      }
    });

    this.otherPlayers.set(data.id, sprite);
    this.updateHpBar(data);
    this.updateHpBarPosition(data.id, sprite);
  }

  private updateTargetSquare(sprite: Phaser.GameObjects.Sprite | null) {
    if (!this.targetSquare) return;
    if (!sprite) {
        this.targetSquare.setVisible(false);
        return;
    }
    this.targetSquare.setVisible(true);
    this.targetSquare.x = sprite.x;
    this.targetSquare.y = sprite.y;
  }

  private updateHpBar(data: PlayerData) {
      let hpBar = this.hpBars.get(data.id);
      if (!hpBar) {
         hpBar = this.add.graphics();
         hpBar.setDepth(12);
         this.hpBars.set(data.id, hpBar);
      }
      
      hpBar.clear();
      
      // Fallback: se maxHealth não veio, assume health como maxHealth (evita barra preta)
      const maxHealth = data.maxHealth || data.health || 1;
      const health = data.health || 0;
      
      // Barra preta de fundo
      hpBar.fillStyle(0x000000);
      hpBar.fillRect(-14, -20, 28, 4);

      // Barra verde de vida
      const pct = Math.max(0, health / maxHealth);
      const color = pct > 0.5 ? 0x22c55e : (pct > 0.2 ? 0xeab308 : 0xef4444); // Verde -> Amarelo -> Vermelho
      hpBar.fillStyle(color);
      hpBar.fillRect(-14, -20, 28 * pct, 4);

     // Atualiza a barra de vida do HUD (barra inferior direita) se for o jogador local
     if (data.id === this.socketManager.getId()) {
         const healthFill = document.getElementById('health-fill');
         const healthText = document.getElementById('health-text');
         if (healthFill) healthFill.style.width = `${pct * 100}%`;
         if (healthText) healthText.innerText = `${Math.max(0, Math.round(data.health))}/${data.maxHealth}`;
     }

     // Update position if sprite exists
     const sprite = data.id === this.socketManager.getId() ? this.localPlayerSprite : this.otherPlayers.get(data.id);
     if (sprite) {
       this.updateHpBarPosition(data.id, sprite);
     }
  }

  private updateHpBarPosition(id: string, sprite: Phaser.GameObjects.Sprite) {
     const hpBar = this.hpBars.get(id);
     if (hpBar) {
         hpBar.x = sprite.x;
         hpBar.y = sprite.y;
     }
  }

  // --- Lógica de Input Básico ---
  private setupInput() {
    const chatInput = document.getElementById('chat-input') as HTMLInputElement;

    // Listeners do Right-click Context Menu (Fase 4b) — usa delegação de evento
    document.getElementById('context-menu')?.addEventListener('click', (e: Event) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement;
      if (!btn) return;
      const action = btn.dataset.action;
      const menu = document.getElementById('context-menu')!;
      const ctxType = menu.getAttribute('data-ctx-type') || 'entity';

      if (ctxType === 'backpack') {
          const slotIndex = (menu as any).__backpackSlot;
          if (slotIndex === undefined) return;
          if (action === 'useItem') {
              this.socketManager.sendUseItem(slotIndex);
          } else if (action === 'dropItem') {
              this.socketManager.sendDropItem(slotIndex, 1);
          }
          this.closeContextMenu();
          return;
      }

      const targetId = this.contextMenuTargetId;
      const data = targetId ? this.otherPlayersData.get(targetId) : null;
      if (!data || !targetId) return;

      if (action === 'attack') {
          this.currentTargetId = targetId;
          const sprite = this.otherPlayers.get(targetId);
          this.updateTargetSquare(sprite || null);
          this.startChase(targetId);
      } else if (action === 'target') {
          this.currentTargetId = targetId;
          const sprite = this.otherPlayers.get(targetId);
          this.updateTargetSquare(sprite || null);
      } else if (action === 'inspect') {
          this.socketManager.socket.emit('entity:query', targetId);
      }
      this.closeContextMenu();
    });

    // Fecha menu ao clicar fora
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('context-menu');
      if (menu && menu.style.display === 'block' && !(e.target as HTMLElement).closest('#context-menu')) {
        this.closeContextMenu();
      }
    });

    // Fecha modal de inspeção
    document.getElementById('inspect-close')?.addEventListener('click', () => {
      const modal = document.getElementById('inspect-modal');
      if (modal) modal.style.display = 'none';
    });

    // Toggle collapsed mode do HUD player
    const hudPlayer = document.getElementById('hud-player');
    if (hudPlayer) {
      hudPlayer.querySelector('.hud-header')?.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('#btn-logout-game')) return;
        hudPlayer.classList.toggle('collapsed');
      });
    }

    // Clique para andar (Pathfinding)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, currentlyOver: any[]) => {
        const blocksMovement = currentlyOver.some(obj => !obj.getData('isFloorItem'));
        if (blocksMovement) return;
        if (!this.localPlayerSprite) return;

        // Clique no chão cancela perseguição e autofarm e desmarca alvo

        this.stopChase();
        this.stopNodeChase();
        this.stopLootChase();
        this.currentTargetId = undefined;
        this.updateTargetSquare(null);

        const destX = Math.round(pointer.worldX / this.TILE_SIZE);
        const destY = Math.round(pointer.worldY / this.TILE_SIZE);
        const startX = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
        const startY = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
        
        this.autoPath = this.calculatePath(startX, startY, destX, destY);
        
        if (this.autoPath.length > 0) {
            const marker = this.add.graphics();
            marker.lineStyle(2, 0x00ff00, 0.8);
            marker.strokeCircle(destX * this.TILE_SIZE, destY * this.TILE_SIZE, 10);
            this.tweens.add({ targets: marker, scale: 0.5, alpha: 0, duration: 600, onComplete: () => marker.destroy() });
            
            if (!this.isMoving) this.processNextAutoWalkStep();
        }
    });

    // Adiciona tecla de Dash
    this.input.keyboard!.on('keydown-SPACE', () => {
        if (document.activeElement === chatInput) return;
        if (!this.isMoving) {
            this.socketManager.sendDash();
            this.isMoving = true;
            setTimeout(() => this.isMoving = false, 300);
        }
    });

    // Q = Usar poção/item de HP (Health Potion > Cheese > Apple em prioridade)
    this.input.keyboard!.on('keydown-Q', () => {
        if (document.activeElement === chatInput) return;
        this.socketManager.sendUseConsumable('hp');
    });

    // E = Usar poção/item de MP (Mana) - reservado para futuro
    this.input.keyboard!.on('keydown-E', () => {
        if (document.activeElement === chatInput) return;
        this.socketManager.sendUseConsumable('mp');
    });

    // Teclas 1-8 são tratadas no handler genérico keydown abaixo (usa event.key nativo)
    // para evitar conflito com o sistema Phaser de keydown-ONE, keydown-TWO etc.

    // Desativa menu de contexto do botão direito no canvas (para usar right-click para atacar)
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ===== Mobile: utilidades =====
    // Clampa posição de modais para ficarem dentro do viewport (útil no mobile)
    const clampModalToViewport = (modal: HTMLElement) => {
      const rect = modal.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = rect.left, top = rect.top;
      if (rect.right > vw) left = vw - rect.width - 8;
      if (rect.bottom > vh) top = vh - rect.height - 8;
      if (left < 8) left = 8;
      if (top < 8) top = 8;
      modal.style.left = left + 'px';
      modal.style.top = top + 'px';
      modal.style.transform = 'none'; // remove translate(-50%, -50%)
    };

    // Torna um modal arrastável pelo header (desktop + touch)
    const makeDraggable = (modal: HTMLElement, handle: HTMLElement) => {
      let isDragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
      const onDown = (clientX: number, clientY: number) => {
        isDragging = true;
        const rect = modal.getBoundingClientRect();
        origLeft = rect.left; origTop = rect.top;
        startX = clientX; startY = clientY;
        modal.style.transform = 'none';
        document.body.style.userSelect = 'none';
      };
      const onMove = (clientX: number, clientY: number) => {
        if (!isDragging) return;
        const dx = clientX - startX, dy = clientY - startY;
        let newLeft = origLeft + dx, newTop = origTop + dy;
        // clamp ao viewport
        const vw = window.innerWidth, vh = window.innerHeight;
        const rw = modal.offsetWidth, rh = modal.offsetHeight;
        if (newLeft < 8) newLeft = 8;
        if (newTop < 8) newTop = 8;
        if (newLeft + rw > vw - 8) newLeft = vw - rw - 8;
        if (newTop + rh > vh - 8) newTop = vh - rh - 8;
        modal.style.left = newLeft + 'px';
        modal.style.top = newTop + 'px';
      };
      const onUp = () => { isDragging = false; document.body.style.userSelect = ''; };
      // Mouse
      handle.addEventListener('mousedown', (e) => { onDown(e.clientX, e.clientY); e.preventDefault(); });
      document.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
      document.addEventListener('mouseup', onUp);
      // Touch
      handle.addEventListener('touchstart', (e) => { const t = e.touches[0]; onDown(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      document.addEventListener('touchmove', (e) => { if (isDragging) { const t = e.touches[0]; onMove(t.clientX, t.clientY); e.preventDefault(); } }, { passive: false });
      document.addEventListener('touchend', onUp);
    };

    // Aplica clamp + draggable nos modais conhecidos
    const modalIds = ['shop-ui', 'teleporter-ui', 'vendor-ui', 'crafting-ui', 'modal-bank', 'chat-box'];
    modalIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      // Clampa ao abrir (MutationObserver detecta display change)
      const observer = new MutationObserver(() => {
        if (el.style.display === 'flex' || el.style.display === 'block') {
          setTimeout(() => clampModalToViewport(el), 0);
        }
      });
      observer.observe(el, { attributes: true, attributeFilter: ['style'] });
      // Draggable pelo header (primeiro child com cursor:move ou classe .modal-header)
      const header = el.querySelector('[style*="cursor: move"]') || el.querySelector('.modal-header') || el.firstElementChild;
      if (header) makeDraggable(el, header as HTMLElement);
    });

    // Long-press (hold) = right-click no mobile
    // Detecta hold de ~500ms em elementos interativos (NPCs, tiles, etc.)
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const startHold = (target: HTMLElement, clientX: number, clientY: number) => {
      holdTimer = setTimeout(() => {
        // Dispara evento customizado 'longpress' no target
        const evt = new CustomEvent('longpress', { detail: { clientX, clientY } });
        target.dispatchEvent(evt);
      }, 500);
    };
    const cancelHold = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    };
    document.addEventListener('touchstart', (e) => {
      const target = e.target as HTMLElement;
      if (target && (target.closest('.pointer-events-auto') || target.closest('[style*="pointer-events:auto"]') || target === document.getElementById('game-container'))) {
        const t = e.touches[0];
        startHold(target, t.clientX, t.clientY);
      }
    }, { passive: true });
    document.addEventListener('touchmove', cancelHold, { passive: true });
    document.addEventListener('touchend', cancelHold, { passive: true });
    document.addEventListener('touchcancel', cancelHold, { passive: true });

    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (document.activeElement === chatInput) return;
      if (!this.localPlayerSprite) return;

      // Atalho do Autofarm
      if (event.key.toLowerCase() === 'f') {
          this.toggleAutofarm();
          return;
      }

      // Atalho de retornar para a base (Recall)
      if (event.key.toLowerCase() === 'b') {

          this.socketManager.socket.emit('startRecall');
          return;
      }

      // --- Skills por tecla numérica ---
      const skillMap: Record<string, string> = { '1': 'skillshot', '2': 'whirlwind', '3': 'skill3', '4': 'skill4', '5': 'skill5', '6': 'skill6', '7': 'skill7', '8': 'skill8' };
      if (skillMap[event.key]) {
          const skillId = skillMap[event.key];
          this.useSkill(skillId);
          return;
      }

      // Qualquer tecla de movimento cancela perseguição
      const movKeys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'];
      // Limpa target de perseguição se moveu manualmente
      if (movKeys.includes(event.key)) {
          this.stopChase();
          this.stopNodeChase();
          this.stopLootChase();
      }

      // Aborta auto-walk e processa movimento manual
      this.autoPath = [];
      if (this.isMoving) return;
      
      let targetX = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
      let targetY = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);

      let moved = false;

      if (event.key === 'ArrowUp' || event.key === 'w') {
        targetY -= 1; this.localFacing = 'up'; moved = true;
      } else if (event.key === 'ArrowDown' || event.key === 's') {
        targetY += 1; this.localFacing = 'down'; moved = true;
      } else if (event.key === 'ArrowLeft' || event.key === 'a') {
        targetX -= 1; this.localFacing = 'left'; moved = true;
      } else if (event.key === 'ArrowRight' || event.key === 'd') {
        targetX += 1; this.localFacing = 'right'; moved = true;
      }

      if (moved) {
        this.isMoving = true;
        // Envia tentativa de movimento para o servidor
        this.socketManager.sendMove({ x: targetX, y: targetY }, this.localFacing);
        
        // Safety timeout para teclado
        if ((this as any)._moveSafetyTimeout) clearTimeout((this as any)._moveSafetyTimeout);
        (this as any)._moveSafetyTimeout = setTimeout(() => {
            if (this.isMoving) {
                this.isMoving = false;
            }
        }, 500);
      }
    });
  }

  private useSkill(skillId: string) {
      if (!this.localPlayerSprite) return;

      const skillCosts: Record<string, number> = {
          'skillshot': 10,
          'whirlwind': 20
      };
      
      const skillCooldownDurations: Record<string, number> = {
          'skillshot': 1500,
          'whirlwind': 3000
      };

      const cost = skillCosts[skillId] || 0;
      const cooldownMs = skillCooldownDurations[skillId] || 0;

      // 1. Checar se a skill existe
      if (cost === 0 && cooldownMs === 0) {
          this.onTextEffect(
              Math.round(this.localPlayerSprite.x / this.TILE_SIZE),
              Math.round(this.localPlayerSprite.y / this.TILE_SIZE),
              'Not learned!',
              '#ff5555'
          );
          return;
      }

      // 2. Checar Cooldown no cliente
      const now = Date.now();
      const lastCast = this.skillCooldowns[skillId] || 0;
      if (now - lastCast < cooldownMs) {
          const remainingSec = ((cooldownMs - (now - lastCast)) / 1000).toFixed(1);
          this.onTextEffect(
              Math.round(this.localPlayerSprite.x / this.TILE_SIZE),
              Math.round(this.localPlayerSprite.y / this.TILE_SIZE),
              `Cooldown: ${remainingSec}s`,
              '#ffaa00'
          );
          return;
      }

      // 3. Checar SP (mana) no cliente
      if (this.localSp < cost) {
          this.onTextEffect(
              Math.round(this.localPlayerSprite.x / this.TILE_SIZE),
              Math.round(this.localPlayerSprite.y / this.TILE_SIZE),
              'Need Mana!',
              '#3b82f6'
          );
          return;
      }

      // 4. Se OK, envia para o servidor
      if (skillId === 'skillshot') {
          this.socketManager.sendSkillshot(this.currentTargetId);
      } else if (skillId === 'whirlwind') {
          this.socketManager.socket.emit('castAoE');
      }

      // 5. Inicia Cooldown local e deduz SP local temporariamente (sincronizado pelo servidor)
      this.skillCooldowns[skillId] = now;
      this.localSp = Math.max(0, this.localSp - cost);
      
      const pct = (this.localSp / this.localMaxSp) * 100;
      const fill = document.getElementById('sp-fill');
      const text = document.getElementById('sp-text');
      if (fill) fill.style.width = `${Math.max(0, Math.min(pct, 100))}%`;
      if (text) text.innerText = `${this.localSp}/${this.localMaxSp}`;

      // 6. Inicia visual cooldown overlay
      this.startVisualCooldown(skillId, cooldownMs);
  }

  private startVisualCooldown(skillId: string, durationMs: number) {
      const skillToSlot: Record<string, string> = {
          'skillshot': 'hk-1',
          'whirlwind': 'hk-2'
      };
      
      const slotId = skillToSlot[skillId];
      if (!slotId) return;

      const slotEl = document.getElementById(slotId);
      if (!slotEl) return;

      const oldOverlay = slotEl.querySelector('.hk-cooldown-overlay');
      if (oldOverlay) oldOverlay.remove();

      const overlay = document.createElement('div');
      overlay.className = 'hk-cooldown-overlay';
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.background = 'rgba(0, 0, 0, 0.7)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.color = '#fff';
      overlay.style.fontSize = '12px';
      overlay.style.fontWeight = 'bold';
      overlay.style.fontFamily = 'monospace';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '10';

      slotEl.appendChild(overlay);

      const startTime = Date.now();
      const interval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const remaining = durationMs - elapsed;
          if (remaining <= 0) {
              clearInterval(interval);
              overlay.remove();
          } else {
              overlay.innerText = (remaining / 1000).toFixed(1) + 's';
          }
      }, 50);

      (slotEl as any)._cooldownInterval = interval;
  }

  private processNextAutoWalkStep() {
      if (this.autoPath.length === 0 || this.isMoving || !this.localPlayerSprite) return;
      const nextStep = this.autoPath.shift()!;
      const currX = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
      const currY = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
      
      if (nextStep.x < currX) this.localFacing = 'left';
      else if (nextStep.x > currX) this.localFacing = 'right';
      else if (nextStep.y < currY) this.localFacing = 'up';
      else if (nextStep.y > currY) this.localFacing = 'down';

      this.isMoving = true;
      this.socketManager.sendMove(nextStep, this.localFacing);

      // Safety timeout para auto-walk
      if ((this as any)._moveSafetyTimeout) clearTimeout((this as any)._moveSafetyTimeout);
      (this as any)._moveSafetyTimeout = setTimeout(() => {
          if (this.isMoving) {
              this.isMoving = false;
              this.processNextAutoWalkStep();
          }
      }, 600);
  }

  // Algoritmo BFS para encontrar menor caminho desviando das paredes
  private calculatePath(startX: number, startY: number, destX: number, destY: number): {x: number, y: number}[] {
      const queue = [{ x: startX, y: startY, path: [] as {x:number, y:number}[] }];
      const visited = new Set<string>();
      visited.add(`${startX},${startY}`);
      
      // Limites dinâmicos baseados no worldBounds
      const maxTileX = Math.floor(this.worldBounds.width / this.TILE_SIZE) - 1;
      const maxTileY = Math.floor(this.worldBounds.height / this.TILE_SIZE) - 1;
      
      // Limite de segurança para não travar o browser
      let iterations = 0;
      
      while (queue.length > 0 && iterations++ < 2000) {
          const curr = queue.shift()!;
          if (curr.x === destX && curr.y === destY) return curr.path;
          
          const neighbors = [
              { x: curr.x + 1, y: curr.y }, { x: curr.x - 1, y: curr.y },
              { x: curr.x, y: curr.y + 1 }, { x: curr.x, y: curr.y - 1 }
          ];
          
          for (const n of neighbors) {
              const key = `${n.x},${n.y}`;
              if (!visited.has(key) && !this.collisionMap.has(key) && n.x >= 0 && n.x <= maxTileX && n.y >= 0 && n.y <= maxTileY) {
                  visited.add(key);
                  queue.push({ x: n.x, y: n.y, path: [...curr.path, {x: n.x, y: n.y}] });
              }
          }
      }
      return [];
  }

  public setNight(isNight: boolean) {
      const overlay = document.getElementById('night-overlay');
      if (overlay) {
          overlay.style.opacity = isNight ? '1' : '0';
      }
  }

  public onLocalPlayerDeath(lostItems: string[]) {
      const overlay = document.getElementById('death-screen');
      const lootMsg = document.getElementById('death-loot-msg');
      const btn = document.getElementById('btn-respawn') as HTMLButtonElement;
      
      if (overlay) {
          overlay.style.display = 'flex';
          
          if (lostItems.length > 0) {
              lootMsg!.innerText = `Você morreu e perdeu os seguintes itens: ${lostItems.join(', ')}`;
              lootMsg!.style.color = '#ef4444';
          } else {
              lootMsg!.innerText = "Você deu sorte! Não perdeu nenhum item do inventário.";
              lootMsg!.style.color = '#22c55e';
          }
          
          let count = 5;
          btn.disabled = true;
          btn.style.cursor = 'not-allowed';
          btn.style.opacity = '0.5';
          btn.style.background = '#3b82f6';
          btn.innerText = `Renascer (${count}s)`;
          
          const interval = setInterval(() => {
              count--;
              if (count > 0) {
                  btn.innerText = `Renascer (${count}s)`;
              } else {
                  clearInterval(interval);
                  btn.disabled = false;
                  btn.innerText = 'Renascer';
                  btn.style.cursor = 'pointer';
                  btn.style.opacity = '1';
                  btn.style.background = '#ef4444';
                  
                  btn.onclick = () => {
                      this.socketManager.sendRespawn();
                      overlay.style.display = 'none';
                      if (this.localPlayerSprite) {
                          this.localPlayerSprite.setAlpha(1);
                          this.localPlayerSprite.setAngle(0);
                      }
                  };
              }
          }, 1000);
      }
  }

  private setupTooltips() {
      const tooltip = document.getElementById('item-tooltip')!;
      const tName = document.getElementById('tooltip-name')!;
      const tDesc = document.getElementById('tooltip-desc')!;

       const getTooltipData = (slotEl: HTMLElement): { name: string, desc: string, color: string, html?: string } | null => {
          const QUALITY_NAMES_PT: Record<string, string> = {
              'comum': 'Comum',
              'raro': 'Raro',
              'epico': 'Épico',
              'common': 'Comum',
              'rare': 'Raro',
              'epic': 'Épico'
          };
          const id = slotEl.id;
          if (id && id.startsWith('slot-')) {
              const eqSlot = id.replace('slot-', '');
              const slotMap: Record<string, string> = {
                  'head': 'head', 'left': 'leftHand', 'right': 'rightHand',
                  'body': 'body', 'legs': 'legs', 'boots': 'boots',
                  'backpack': 'backpack'
              };
              const key = slotMap[eqSlot];
              const itemString = this.equipmentData ? this.equipmentData[key] : null;
              
              if (itemString) {
                  let itemName = itemString;
                  let quality = 'comum';
                  let stats: any = null;
                  let durability = 100;
                  let maxDurability = 100;
                  
                  if (itemString.startsWith('{')) {
                      try {
                          const parsed = JSON.parse(itemString);
                          itemName = parsed.name;
                          quality = parsed.quality || 'comum';
                          stats = parsed.stats;
                          durability = parsed.durability ?? 100;
                          maxDurability = parsed.maxDurability ?? 100;
                      } catch (e) {}
                  }
                  
                  const details = this.itemDetails[itemName] || { name: itemName, desc: 'Equipamento', color: '#ffffff' };
                  let displayName = details.name;
                  let displayDesc = details.desc;
                  let displayColor = details.color;
                  
                  if (quality && quality !== 'comum') {
                      const transQuality = QUALITY_NAMES_PT[quality.toLowerCase()] || quality;
                      displayName += ` [${transQuality}]`;
                      if (quality.toLowerCase() === 'raro' || quality.toLowerCase() === 'rare') {
                          displayColor = '#3b82f6';
                      } else if (quality.toLowerCase() === 'epico' || quality.toLowerCase() === 'epic') {
                          displayColor = '#a78bfa';
                      }
                  }
                  
                  if (stats && Object.keys(stats).length > 0) {
                      displayDesc += '\n\nAtributos adicionais:';
                      for (const [stat, val] of Object.entries(stats)) {
                          displayDesc += `\n +${val} ${stat}`;
                      }
                  }
                  
                  displayDesc += `\n\nDurabilidade: ${durability}/${maxDurability}`;
                  
                  return { name: displayName, desc: displayDesc, color: displayColor };
              } else {
                  const emptyNames: Record<string, string> = {
                      'head': 'Slot de Cabeça', 'left': 'Mão Esquerda', 'right': 'Mão Direita',
                      'body': 'Slot de Corpo', 'legs': 'Slot de Pernas', 'boots': 'Slot de Botas',
                      'backpack': 'Slot de Mochila'
                  };
                  const emptyDescs: Record<string, string> = {
                      'head': 'Vazio\nEquipe elmos para aumentar sua Defesa.',
                      'left': 'Vazio\nEquipe escudos ou tochas na mão esquerda.',
                      'right': 'Vazio\nEquipe armas para aumentar seu ATK.',
                      'body': 'Vazio\nEquipe armaduras para aumentar sua Defesa.',
                      'legs': 'Vazio\nEquipe calças para proteção.',
                      'boots': 'Vazio\nEquipe botas para proteção.',
                      'backpack': 'Vazio\nEquipe mochilas para obter mais espaço no inventário.'
                  };
                  return { name: emptyNames[eqSlot] || 'Equipamento', desc: emptyDescs[eqSlot] || 'Slot vazio.', color: '#475569' };
              }
          }
          
          const indexAttr = slotEl.getAttribute('data-index');
          if (indexAttr !== null) {
              const index = parseInt(indexAttr);
              const itemString = this.backpackData[index];
              if (itemString) {
                  let itemName = itemString;
                  let count = 1;
                  let quality = 'comum';
                  let stats: any = null;
                  let durability: number | undefined;
                  let maxDurability: number | undefined;
                  
                   if (itemString.startsWith('{')) {
                       try {
                           const parsed = JSON.parse(itemString);
                           itemName = parsed.name;
                           quality = parsed.quality || 'comum';
                           stats = parsed.stats;
                           durability = parsed.durability;
                           maxDurability = parsed.maxDurability;
                       } catch (e) {}
                   } else if (itemString.includes(':')) {
                       const [name, countStr] = itemString.split(':');
                       itemName = name;
                       count = parseInt(countStr) || 1;
                   }

                   // ===== Skull: exibe nome da vítima com cor (vermelha=player, roxa=boss) =====
                   if (itemName === 'Skull' && itemString.startsWith('{')) {
                       try {
                           const parsed = JSON.parse(itemString);
                           const victimName = parsed.victimName || '???';
                           const victimColor = parsed.color || '#ef4444';
                           const kindLabel = parsed.kind === 'boss' ? 'Boss' : 'Jogador';
                           return {
                               name: '',
                               desc: `Troféu de combate contra ${kindLabel.toLowerCase()}.`,
                               color: '#ffffff',
                               html: `Caveira de <span style="color:${victimColor}; font-weight:bold;">${victimName}</span> <span style="color:#888; font-size:11px;">(${kindLabel})</span>`
                           };
                       } catch (e) {}
                   }

                   const details = this.itemDetails[itemName];
                  if (details) {
                      let displayName = details.name;
                      let displayDesc = details.desc;
                      let displayColor = details.color;
                      
                      if (quality && quality !== 'comum') {
                          const transQuality = QUALITY_NAMES_PT[quality.toLowerCase()] || quality;
                          displayName += ` [${transQuality}]`;
                          if (quality.toLowerCase() === 'raro' || quality.toLowerCase() === 'rare') {
                              displayColor = '#3b82f6';
                          } else if (quality.toLowerCase() === 'epico' || quality.toLowerCase() === 'epic') {
                              displayColor = '#a78bfa';
                          }
                      }
                      
                      if (stats && Object.keys(stats).length > 0) {
                          displayDesc += '\n\nAtributos adicionais:';
                          for (const [stat, val] of Object.entries(stats)) {
                              displayDesc += `\n +${val} ${stat}`;
                          }
                      }
                      
                      if (durability !== undefined && maxDurability !== undefined) {
                          displayDesc += `\n\nDurabilidade: ${durability}/${maxDurability}`;
                      }
                      
                      const countText = count > 1 ? ` (x${count})` : '';
                      return {
                          name: displayName + countText,
                          desc: displayDesc,
                          color: displayColor
                      };
                  }
                  
                  const countText = count > 1 ? ` (x${count})` : '';
                  const displayItemName = (window as any).translateItem ? (window as any).translateItem(itemString) : itemName;
                  return { name: displayItemName + countText, desc: `Item (x${count})`, color: '#ffffff' };
              } else {
                  return { name: 'Espaço Vazio', desc: 'Slot de inventário livre.', color: '#475569' };
              }
          }
          
          return null;
      };

       this.showTooltipFn = (e: MouseEvent) => {
           const slotEl = e.currentTarget as HTMLElement;
           const data = getTooltipData(slotEl) as any;
           if (data) {
               if (data.html) {
                   tName.innerHTML = data.html;
                   tName.style.color = data.color || '#ffffff';
               } else {
                   tName.innerText = data.name;
                   tName.style.color = data.color;
               }
               tDesc.innerText = data.desc;

               this.positionTooltip(e.pageX, e.pageY);
           }
       };

      this.moveTooltipFn = (e: MouseEvent) => {
          this.positionTooltip(e.pageX, e.pageY);
      };

      this.hideTooltipFn = () => {
          tooltip.style.display = 'none';
      };

      const allSlots = document.querySelectorAll('.slot');
      allSlots.forEach(slot => {
          const el = slot as HTMLElement;
          el.removeEventListener('mouseenter', this.showTooltipFn!);
          el.removeEventListener('mousemove', this.moveTooltipFn!);
          el.removeEventListener('mouseleave', this.hideTooltipFn!);
          el.addEventListener('mouseenter', this.showTooltipFn!);
          el.addEventListener('mousemove', this.moveTooltipFn!);
          el.addEventListener('mouseleave', this.hideTooltipFn!);
      });
  }

  public positionTooltip(x: number, y: number) {
      const tooltip = document.getElementById('item-tooltip')!;
      if (!tooltip) return;
      
      tooltip.style.display = 'block';
      
      const width = tooltip.offsetWidth || 200;
      const height = tooltip.offsetHeight || 150;
      
      let left = x + 15;
      let top = y + 15;
      
      // Se estourar a tela na direita, inverte para a esquerda do cursor
      if (left + width > window.innerWidth) {
          left = x - width - 15;
      }
      
      // Se estourar a tela embaixo, exibe acima do cursor
      if (top + height > window.innerHeight) {
          top = y - height - 15;
      }
      
      // Proteções limites
      if (left < 10) left = 10;
      if (top < 10) top = 10;
      
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
  }

  update() {
      // Atualiza o overlay de noite para seguir o jogador (gradiente radial centrado)
      const overlay = document.getElementById('night-overlay');
      if (overlay && this.localPlayerSprite) {
          const rect = this.cameras.main;
          const px = (this.localPlayerSprite.x - rect.scrollX) / rect.width;
          const py = (this.localPlayerSprite.y - rect.scrollY) / rect.height;
          const radius = (this.hasTorch ? 5 : 2) * this.TILE_SIZE;
          overlay.style.background = `radial-gradient(circle at ${px * 100}% ${py * 100}%, transparent ${radius}px, rgba(0,0,0,0.85) ${radius + 40}px)`;
      }

      // === Animação de andar: jogador local ===
      if (this.localPlayerSprite) {
          const facing = (this.localFacing as Facing) || 'down';
          if (this.isMoving) {
              this.localWalkTimer += 1000 / 60;
              if (this.localWalkTimer >= this.WALK_FRAME_MS) {
                  this.localWalkTimer = 0;
                  this.localWalkFrame = (this.localWalkFrame + 1) % 3;
              }
          } else {
              this.localWalkFrame = 0;
              this.localWalkTimer = 0;
          }
          if (facing !== this.localLastFacing || this.localWalkFrame !== 0) {
              this.localLastFacing = facing;
              this.localPlayerSprite.setFrame(getFrameIndex(this.localSpriteId, facing, this.localWalkFrame));
              this.localPlayerSprite.flipX = (facing === 'right');
          }
      }

      // === Animação de andar: outros jogadores ===
      const now2 = this.time.now;
      this.otherPlayerAnim.forEach((anim, id) => {
          const sprite = this.otherPlayers.get(id);
          if (!sprite) return;
          const isMoving = (now2 - anim.lastMoveTime) < 200; // considera "andando" se moveu nos últimos 200ms
          if (isMoving) {
              anim.walkTimer += 1000 / 60;
              if (anim.walkTimer >= this.WALK_FRAME_MS) {
                  anim.walkTimer = 0;
                  anim.walkFrame = (anim.walkFrame + 1) % 3;
              }
          } else {
              anim.walkFrame = 0;
              anim.walkTimer = 0;
          }
          sprite.setFrame(getFrameIndex(anim.spriteId, anim.facing, anim.walkFrame));
          sprite.flipX = (anim.facing === 'right');
      });

      // Visibilidade de nomes baseada em distância (5 tiles)
      if (this.localPlayerSprite) {
          const px = this.localPlayerSprite.x;
          const py = this.localPlayerSprite.y;
          const maxDist = 5 * this.TILE_SIZE;

          // Labels e HP bars de entidades (monstros, jogadores, NPCs)
          this.otherPlayersData.forEach((p, id) => {
              const label = this.otherPlayerLabels.get(id);
              if (label) {
                  const displayName = (window as any).translateMonster ? (window as any).translateMonster(p.name) : p.name;
                  const coordText = `(${p.x}, ${p.y})`;
                  if (p.isMonster) {
                      label.setText(`${p.level || 1} ${coordText}`);
                  } else {
                      label.setText(`[Lv.${p.level || 1}] ${displayName} ${coordText}`);
                  }
                  
                  const dist = Math.abs(px - p.x * this.TILE_SIZE) + Math.abs(py - p.y * this.TILE_SIZE);
                  label.setVisible(dist <= maxDist);
                  label.setPosition(p.x * this.TILE_SIZE, p.y * this.TILE_SIZE - 30);
              }
          });
          
          const targetInfo = document.getElementById('target-info');

          if (this.currentTargetId) {
              const p = this.otherPlayersData.get(this.currentTargetId);
              if (p && targetInfo) {
                  targetInfo.style.display = 'block';
                  const tName = document.getElementById('target-info-name');
                  const tHp = document.getElementById('target-info-hp');
                  const tDrops = document.getElementById('target-info-drops');
                  
                  if (tName) {
                      const displayName = (window as any).translateMonster ? (window as any).translateMonster(p.name) : p.name;
                      tName.innerText = `[Lv.${p.level || 1}] ${displayName}`;
                  }
                  
                  if (tHp) {
                      tHp.innerText = `${p.health}/${p.maxHealth}`;
                      tHp.style.color = (p.health / p.maxHealth) < 0.3 ? '#ef4444' : '#10b981';
                  }
                  
                  if (tDrops && p.isMonster) {
                      const MONSTER_DROPS: Record<string, string> = {
                          'Orc': 'Iron Ore, Wood Log, Leather, Empty Flask',
                          'Rotworm': 'Meat, Wood Log, Iron Ore',
                          'Demon Skeleton': 'Iron Ore, Bone, Sword',
                          'Giant Rat': 'Cheese, Leather'
                      };
                      tDrops.innerText = `Drops: ${MONSTER_DROPS[p.name] || 'Ouro, Itens Comuns'}`;
                  } else if (tDrops) {
                      tDrops.innerText = '';
                  }
              } else if (targetInfo) {
                  targetInfo.style.display = 'none';
              }
          } else if (targetInfo) {
              targetInfo.style.display = 'none';
          }

          // 4) (Futuro) Tenta atualizar inventário/loot do alvo
          // if (this.currentTargetId) {
          //     this.socketManager.sendTargetInventory(this.currentTargetId);
          // }

          // Labels de nós de recursos
          this.resourceNodesMap.forEach(entry => {
              const dist = Math.abs(px - entry.data.x * this.TILE_SIZE) + Math.abs(py - entry.data.y * this.TILE_SIZE);
              entry.label.setVisible(dist <= maxDist);
          });

          // Labels de estações de trabalho
          this.craftingStationsMap.forEach(entry => {
              const dist = Math.abs(px - entry.data.x * this.TILE_SIZE) + Math.abs(py - entry.data.y * this.TILE_SIZE);
              entry.label.setVisible(dist <= maxDist);
          });

          // Itens no chão — só visíveis a 5 tiles
          this.floorItems.forEach(textObj => {
              const dist = Math.abs(px - textObj.x) + Math.abs(py - textObj.y);
              textObj.setVisible(dist <= maxDist);
          });
      }
  }

  public toggleAutofarm() {
      if (this.localPlayerDead) return;
      if (!this.localPlayerSprite) return;
      this.isAutofarmEnabled = !this.isAutofarmEnabled;
      
      const btn = document.getElementById('btn-toggle-autofarm');
      const indicator = document.getElementById('autofarm-indicator');
      const targetDisplay = document.getElementById('autofarm-target');
      
      if (this.isAutofarmEnabled) {
          if (btn) {
              btn.innerText = 'ON';
              btn.style.background = '#10b981';
          }
          if (indicator) {
              indicator.style.background = '#10b981';
              indicator.style.boxShadow = '0 0 8px #10b981';
          }
          if (targetDisplay) targetDisplay.innerText = 'Alvo: Procurando...';
          
          // Abre a janela do Autofarm se estiver fechada
          const modal = document.getElementById('autofarm-panel');
          if (modal && modal.style.display !== 'flex') {
              modal.style.display = 'flex';
              const menuBtn = document.querySelector('.menu-btn[data-target="autofarm-panel"]');
              if (menuBtn) menuBtn.classList.add('active');
          }

          this.onTextEffect(
              Math.round(this.localPlayerSprite!.x / this.TILE_SIZE),
              Math.round(this.localPlayerSprite!.y / this.TILE_SIZE),
              'Autofarm: ON',
              '#10b981'
          );
      } else {
          this.stopAutofarm();
          this.onTextEffect(
              Math.round(this.localPlayerSprite!.x / this.TILE_SIZE),
              Math.round(this.localPlayerSprite!.y / this.TILE_SIZE),
              'Autofarm: OFF',
              '#ef4444'
          );
      }
  }

  private stopAutofarm() {
      this.isAutofarmEnabled = false;
      this.stopChase();
      this.stopLootChase();
      this.stopNodeChase();
      
      const btn = document.getElementById('btn-toggle-autofarm');
      const indicator = document.getElementById('autofarm-indicator');
      const targetDisplay = document.getElementById('autofarm-target');
      
      if (btn) {
          btn.innerText = 'OFF';
          btn.style.background = '#ef4444';
      }
      if (indicator) {
          indicator.style.background = '#ef4444';
          indicator.style.boxShadow = '0 0 8px #ef4444';
      }
      if (targetDisplay) targetDisplay.innerText = 'Alvo: Nenhum';
  }

  private findNearestMonster(): PlayerData | null {
      if (!this.localPlayerSprite) return null;
      
      const checkbox = document.getElementById('autofarm-kill-monster') as HTMLInputElement;
      if (checkbox && !checkbox.checked) return null;

      const select = document.getElementById('autofarm-monster-select') as HTMLSelectElement;
      const selectedMonster = select ? select.value : 'all';

      const px = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
      const py = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
      
      let nearest: PlayerData | null = null;
      let minDist = Infinity;
      
      this.otherPlayersData.forEach(p => {
          if (p.isMonster && !p.isDead && p.health > 0) {
              if (selectedMonster !== 'all' && p.name !== selectedMonster) {
                  return;
              }
              const dist = Math.abs(p.x - px) + Math.abs(p.y - py);
              if (dist < minDist) {
                  minDist = dist;
                  nearest = p;
              }
          }
      });
      
      return nearest;
  }

  private findNearestResourceNode(): ResourceNode | null {
      if (!this.localPlayerSprite) return null;

      const px = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
      const py = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);

      const mineCheck = document.getElementById('autofarm-mine') as HTMLInputElement;
      const woodCheck = document.getElementById('autofarm-wood') as HTMLInputElement;
      const herbCheck = document.getElementById('autofarm-herb') as HTMLInputElement;

      const mineEnabled = mineCheck ? mineCheck.checked : false;
      const woodEnabled = woodCheck ? woodCheck.checked : false;
      const herbEnabled = herbCheck ? herbCheck.checked : false;

      if (!mineEnabled && !woodEnabled && !herbEnabled) return null;

      let nearest: ResourceNode | null = null;
      let minDist = Infinity;

      this.resourceNodesMap.forEach(entry => {
          const node = entry.data;
          if (node.state === 'depleted') return;

          if (node.type === 'ore' && !mineEnabled) return;
          if (node.type === 'tree' && !woodEnabled) return;
          if (node.type === 'herb' && !herbEnabled) return;

          const dist = Math.abs(node.x - px) + Math.abs(node.y - py);
          if (dist < minDist) {
              minDist = dist;
              nearest = node;
          }
      });

      return nearest;
  }

  private runAutofarmTick() {
      if (!this.isAutofarmEnabled || !this.localPlayerSprite || this.localPlayerDead) {
          if (this.isAutofarmEnabled) this.stopAutofarm();
          return;
      }

      // Se estiver no processo de coleta (canalizando), apenas retorna
      if (this.gatheringTimerEvent) return;

      // 1. Auto-potion check (HP & MP)
      const now = Date.now();
      if (this.localHealth < this.localMaxHealth * 0.40) {
          const lastHpUse = (this as any).lastHpUseTime || 0;
          if (now - lastHpUse >= 1000) {
              (this as any).lastHpUseTime = now;
              this.socketManager.sendUseConsumable('hp');
          }
      }
      if (this.localSp < this.localMaxSp * 0.20) {
          const lastMpUse = (this as any).lastMpUseTime || 0;
          if (now - lastMpUse >= 1000) {
              (this as any).lastMpUseTime = now;
              this.socketManager.sendUseConsumable('mp');
          }
      }

      // 2. Verificar e processar perseguição de loot ativa
      const lootCheckbox = document.getElementById('autofarm-loot') as HTMLInputElement;
      const isLootEnabled = lootCheckbox ? lootCheckbox.checked : true;

      if (this.lootTargetId && this.lootTargetPos) {
          if (isLootEnabled && this.floorItems.has(this.lootTargetId)) {
              const playerX = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
              const playerY = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
              if (playerX === this.lootTargetPos.x && playerY === this.lootTargetPos.y) {
                  this.stopLootChase();
              } else if (this.autoPath.length === 0 && !this.isMoving) {
                  this.autoPath = this.calculatePath(playerX, playerY, this.lootTargetPos.x, this.lootTargetPos.y);
                  if (this.autoPath.length > 0 && !this.isMoving) {
                      this.processNextAutoWalkStep();
                  } else {
                      this.stopLootChase();
                  }
              }
              return; // Looting tem prioridade máxima
          } else {
              this.stopLootChase();
          }
      }

      // Se houver loot por perto e auto-loot habilitado, vai pegar primeiro!
      if (isLootEnabled) {
          const nearestLoot = this.findNearestLoot();
          if (nearestLoot) {
              this.startLootChase(nearestLoot.id, nearestLoot.x, nearestLoot.y);
              const targetDisplay = document.getElementById('autofarm-target');
              if (targetDisplay) targetDisplay.innerText = `Alvo: Pegando loot (${nearestLoot.name})`;
              return;
          }
      }

      // 3. Processamento de Coleta de Recursos (Node Chase)
      if (this.chaseNodeId && this.chaseNodePos) {
          const entry = this.resourceNodesMap.get(this.chaseNodeId);
          if (entry && entry.data.state !== 'depleted') {
              // Continua perseguindo recurso
              const playerX = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
              const playerY = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
              const dx = Math.abs(playerX - this.chaseNodePos.x);
              const dy = Math.abs(playerY - this.chaseNodePos.y);

              if (dx <= 1 && dy <= 1) {
                  this.autoPath = [];
                  this.socketManager.socket.emit('startGathering', { nodeId: this.chaseNodeId });
              } else if (this.autoPath.length === 0 && !this.isMoving) {
                  this.recalculateNodeChase();
              }
              const targetDisplay = document.getElementById('autofarm-target');
              if (targetDisplay) targetDisplay.innerText = `Coletando: ${entry.data.name}`;
              return;
          } else {
              this.stopNodeChase();
          }
      }

      // 3.5. Chase genérico de interação (NPC, bancada, etc.) - anda até 1 célula e dispara onArrive
      if (this.interactionChase) {
          if (this.autoPath.length === 0 && !this.isMoving) {
              this.recalcInteractionChase();
          }
          return;
      }

      // 4. Processamento de Combate com Monstros (Monster Chase)
      let currentTargetAlive = false;
      if (this.chaseTargetId) {
          const targetData = this.otherPlayersData.get(this.chaseTargetId);
          if (targetData && !targetData.isDead && targetData.health > 0) {
              currentTargetAlive = true;
          }
      }

      if (currentTargetAlive) {
          const targetData = this.otherPlayersData.get(this.chaseTargetId!);
          const targetDisplay = document.getElementById('autofarm-target');
          if (targetDisplay && targetData) {
              targetDisplay.innerText = `Alvo: ${targetData.name} (Lvl ${targetData.level})`;
          }

          // Auto Magic Skills (se habilitado)
          const checkbox = document.getElementById('autofarm-skills') as HTMLInputElement;
          if (checkbox && checkbox.checked && targetData) {
              const px = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
              const py = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
              const dx = Math.abs(px - targetData.x);
              const dy = Math.abs(py - targetData.y);
              const isAdjacent = (dx <= 1 && dy <= 1);

              if (isAdjacent) {
                  const lastWhirlwind = this.skillCooldowns['whirlwind'] || 0;
                  const lastSkillshot = this.skillCooldowns['skillshot'] || 0;
                  if (now - lastWhirlwind >= 3000) {
                      this.useSkill('whirlwind');
                  } else if (now - lastSkillshot >= 2000) {
                      this.useSkill('skillshot');
                  }
              }
          }
          return;
      } else {
          this.stopChase();
      }

      // 5. Se estiver livre, escolhe o alvo mais próximo entre Monstros e Recursos
      const nearestMonster = this.findNearestMonster();
      const nearestNode = this.findNearestResourceNode();

      if (nearestMonster && nearestNode) {
          // Compara distâncias
          const px = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
          const py = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
          const distMonster = Math.abs(nearestMonster.x - px) + Math.abs(nearestMonster.y - py);
          const distNode = Math.abs(nearestNode.x - px) + Math.abs(nearestNode.y - py);

          if (distNode < distMonster) {
              this.startNodeChase(nearestNode.id, nearestNode.x, nearestNode.y);
              const targetDisplay = document.getElementById('autofarm-target');
              if (targetDisplay) targetDisplay.innerText = `Coletando: ${nearestNode.name}`;
          } else {
              this.currentTargetId = nearestMonster.id;
              const targetSprite = this.otherPlayers.get(nearestMonster.id);
              if (targetSprite) this.updateTargetSquare(targetSprite);
              this.startChase(nearestMonster.id);
              const targetDisplay = document.getElementById('autofarm-target');
              if (targetDisplay) targetDisplay.innerText = `Alvo: ${nearestMonster.name}`;
          }
      } else if (nearestMonster) {
          this.currentTargetId = nearestMonster.id;
          const targetSprite = this.otherPlayers.get(nearestMonster.id);
          if (targetSprite) this.updateTargetSquare(targetSprite);
          this.startChase(nearestMonster.id);
          const targetDisplay = document.getElementById('autofarm-target');
          if (targetDisplay) targetDisplay.innerText = `Alvo: ${nearestMonster.name}`;
      } else if (nearestNode) {
          this.startNodeChase(nearestNode.id, nearestNode.x, nearestNode.y);
          const targetDisplay = document.getElementById('autofarm-target');
          if (targetDisplay) targetDisplay.innerText = `Coletando: ${nearestNode.name}`;
      } else {
          const targetDisplay = document.getElementById('autofarm-target');
          if (targetDisplay) targetDisplay.innerText = 'Alvo: Procurando...';
      }
  }

  private findNearestLoot(): { id: string, x: number, y: number, name: string, distance: number } | null {
      if (!this.localPlayerSprite) return null;
      const px = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
      const py = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
      
      let nearest: { id: string, x: number, y: number, name: string, distance: number } | null = null;
      
      this.floorItems.forEach((textObj, id) => {
          const tx = Math.round(textObj.x / this.TILE_SIZE);
          const ty = Math.round(textObj.y / this.TILE_SIZE);
          const name = textObj.getData('itemName') || 'Item';
          
          const dist = Math.abs(px - tx) + Math.abs(py - ty); // Manhattan distance
          // Limita a busca a 15 tiles
          if (dist <= 15) {
              if (!nearest || dist < nearest.distance) {
                  nearest = { id, x: tx, y: ty, name, distance: dist };
              }
          }
      });
      return nearest;
  }

  public drawResourceNode(node: ResourceNode) {
      const existing = this.resourceNodesMap.get(node.id);
      if (existing) {
          existing.sprite.destroy();
          existing.label.destroy();
      }

      const emoji = node.state === 'depleted' ? '🕳️' : node.emoji;
      const sprite = this.add.text(node.x * this.TILE_SIZE, node.y * this.TILE_SIZE, emoji, {
          fontSize: '24px',
          fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Android Emoji", sans-serif'
      }).setOrigin(0.5).setDepth(4) as any;

      const displayNodeName = (window as any).translateItem ? (window as any).translateItem(node.name) : node.name;
      const chargesInfo = node.state === 'depleted' ? '(Esgotado)' : `(${node.charges}/${node.maxCharges})`;
      const label = this.add.text(node.x * this.TILE_SIZE, node.y * this.TILE_SIZE - 20, `${displayNodeName} ${chargesInfo}`, {
          fontSize: '9px',
          color: node.state === 'depleted' ? '#888' : '#10b981',
          backgroundColor: 'rgba(0,0,0,0.6)',
          padding: { x: 3, y: 1 }
      }).setOrigin(0.5).setDepth(4);

      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerdown', () => {
          if (node.state === 'depleted') {
              this.onTextEffect(node.x, node.y, 'Esgotado!', '#ff5555');
              return;
          }
          this.startInteractionChase(node.x, node.y, () => {
              this.socketManager.socket.emit('startGathering', { nodeId: node.id });
          });
      });

      this.resourceNodesMap.set(node.id, { sprite, label, data: node });
  }

  public drawCraftingStation(station: CraftingStation) {
      const existing = this.craftingStationsMap.get(station.id);
      if (existing) {
          existing.sprite.destroy();
          existing.label.destroy();
      }

      let texture = '';
      if (station.type === 'forge') texture = 'blacksmith-sprite';
      else if (station.type === 'alchemy') texture = 'alchemist-sprite';
      else if (station.type === 'tanning') texture = 'tailor-sprite';

      let sprite: any;
      if (texture) {
          sprite = this.add.sprite(station.x * this.TILE_SIZE, station.y * this.TILE_SIZE, texture)
              .setOrigin(0.5)
              .setDepth(10);
      } else {
          sprite = this.add.text(station.x * this.TILE_SIZE, station.y * this.TILE_SIZE, station.emoji, {
              fontSize: '28px',
              fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Android Emoji", sans-serif'
          }).setOrigin(0.5).setDepth(4);
      }

      const label = this.add.text(station.x * this.TILE_SIZE, station.y * this.TILE_SIZE - 20, station.name, {
          fontSize: '10px',
          color: '#fbbf24',
          backgroundColor: 'rgba(0,0,0,0.6)',
          padding: { x: 3, y: 1 }
      }).setOrigin(0.5).setDepth(10);

      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerdown', () => {
          this.startInteractionChase(station.x, station.y, () => {
              this.openCraftingUI(station);
          });
      });

      this.craftingStationsMap.set(station.id, { sprite, label, data: station });
  }

  public onResourceNodeUpdated(data: any) {
      this.drawResourceNode(data);
  }

  public onGatheringStarted(duration: number, nodeType: string) {
      this.onGatheringCancelled();
      
      if (!this.localPlayerSprite) return;
      
      const width = 60;
      const height = 8;
      
      this.gatheringProgressBar = this.add.graphics();
      this.gatheringProgressBar.setDepth(15);
      
      const labelText = nodeType === 'ore' ? 'Minerando...' : nodeType === 'tree' ? 'Cortando...' : 'Colhendo...';
      this.gatheringProgressText = this.add.text(this.localPlayerSprite.x, this.localPlayerSprite.y - 45, labelText, {
          fontSize: '8px',
          color: '#10b981',
          fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(15);

      const startTime = Date.now();
      
      this.gatheringTimerEvent = this.time.addEvent({
          delay: 50,
          loop: true,
          callback: () => {
              if (!this.localPlayerSprite || !this.gatheringProgressBar) return;
              
              const elapsed = Date.now() - startTime;
              const pct = Math.min(elapsed / duration, 1.0);
              
              this.gatheringProgressBar.clear();
              this.gatheringProgressBar.fillStyle(0x000000, 0.7);
              this.gatheringProgressBar.fillRect(this.localPlayerSprite.x - width / 2, this.localPlayerSprite.y - 35, width, height);
              
              this.gatheringProgressBar.fillStyle(0x10b981, 1.0);
              this.gatheringProgressBar.fillRect(this.localPlayerSprite.x - width / 2 + 1, this.localPlayerSprite.y - 34, (width - 2) * pct, height - 2);
              
              if (this.gatheringProgressText) {
                  this.gatheringProgressText.x = this.localPlayerSprite.x;
                  this.gatheringProgressText.y = this.localPlayerSprite.y - 45;
              }
              
              if (pct >= 1.0) {
                  this.onGatheringCancelled();
              }
          }
      });
  }

  public onGatheringCancelled() {
      if (this.gatheringTimerEvent) {
          this.gatheringTimerEvent.destroy();
          this.gatheringTimerEvent = undefined;
      }
      if (this.gatheringProgressBar) {
          this.gatheringProgressBar.destroy();
          this.gatheringProgressBar = undefined;
      }
      if (this.gatheringProgressText) {
          this.gatheringProgressText.destroy();
          this.gatheringProgressText = undefined;
      }
  }

  public onRecallStarted(duration: number) {
      this.onRecallCancelled();
      
      if (!this.localPlayerSprite) return;
      
      const width = 60;
      const height = 8;
      
      this.recallProgressBar = this.add.graphics();
      this.recallProgressBar.setDepth(15);
      
      this.recallProgressText = this.add.text(this.localPlayerSprite.x, this.localPlayerSprite.y - 45, 'Retornando à base...', {
          fontSize: '8px',
          color: '#3b82f6',
          fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(15);

      this.recallGlowGraphics = this.add.graphics();
      this.recallGlowGraphics.setDepth(this.localPlayerSprite.depth - 1);

      const startTime = Date.now();
      
      this.recallTimerEvent = this.time.addEvent({
          delay: 20,
          loop: true,
          callback: () => {
              if (!this.localPlayerSprite || !this.recallProgressBar || !this.recallGlowGraphics) return;
              
              const elapsed = Date.now() - startTime;
              const pct = Math.min(elapsed / duration, 1.0);
              
              // Barra de Progresso
              this.recallProgressBar.clear();
              this.recallProgressBar.fillStyle(0x000000, 0.7);
              this.recallProgressBar.fillRect(this.localPlayerSprite.x - width / 2, this.localPlayerSprite.y - 35, width, height);
              
              this.recallProgressBar.fillStyle(0x3b82f6, 1.0);
              this.recallProgressBar.fillRect(this.localPlayerSprite.x - width / 2 + 1, this.localPlayerSprite.y - 34, (width - 2) * pct, height - 2);
              
              if (this.recallProgressText) {
                  this.recallProgressText.x = this.localPlayerSprite.x;
                  this.recallProgressText.y = this.localPlayerSprite.y - 45;
              }
              
              // Efeito de Brilho Neon Pulsante (Glow Aura)
              this.recallGlowGraphics.clear();
              const pulse = Math.sin(Date.now() / 150) * 0.25 + 0.75;
              const radius = 16 + pulse * 8;
              
              for (let i = 1; i <= 3; i++) {
                  const alpha = (0.25 / i) * pulse;
                  const r = radius + i * 4;
                  this.recallGlowGraphics.fillStyle(0x60a5fa, alpha);
                  this.recallGlowGraphics.fillCircle(this.localPlayerSprite.x, this.localPlayerSprite.y + 4, r);
              }
              
              this.recallGlowGraphics.fillStyle(0xffffff, 0.4 * pulse);
              this.recallGlowGraphics.fillCircle(this.localPlayerSprite.x, this.localPlayerSprite.y + 4, 12);
              
              if (pct >= 1.0) {
                  this.onRecallCancelled();
              }
          }
      });
  }

  public onRecallCancelled() {
      if (this.recallTimerEvent) {
          this.recallTimerEvent.destroy();
          this.recallTimerEvent = undefined;
      }
      if (this.recallProgressBar) {
          this.recallProgressBar.destroy();
          this.recallProgressBar = undefined;
      }
      if (this.recallProgressText) {
          this.recallProgressText.destroy();
          this.recallProgressText = undefined;
      }
      if (this.recallGlowGraphics) {
          this.recallGlowGraphics.destroy();
          this.recallGlowGraphics = undefined;
      }
  }

  public onRecallCompleted() {
      this.onRecallCancelled();
  }

  private refreshCraftingProfessionDisplay() {
      const ui = document.getElementById('crafting-ui');
      if (!ui || ui.style.display !== 'flex') return;
      const stationType = this.currentCraftingStationType;
      const profNameEl = document.getElementById('crafting-prof-name');
      const profLvlEl = document.getElementById('crafting-prof-level');
      let profName = 'Ferraria';
      let profLvl = this.professionSmithingLevel;
      let profXp = this.professionSmithingXp;
      if (stationType === 'alchemy') {
          profName = 'Alquimia';
          profLvl = this.professionAlchemyLevel;
          profXp = this.professionAlchemyXp;
      } else if (stationType === 'tanning') {
          profName = 'Alfaiataria';
          profLvl = this.professionTanningLevel;
          profXp = this.professionTanningXp;
      }
      if (profNameEl) profNameEl.innerText = profName;
      if (profLvlEl) profLvlEl.innerText = `Lvl ${profLvl} (${profXp}/${profLvl * 100} XP)`;
  }

  public openCraftingUI(station: CraftingStation) {
      const ui = document.getElementById('crafting-ui');
      if (!ui) return;
      this.currentCraftingStationType = station.type;

      ui.style.display = 'flex';
      
      const titleEl = document.getElementById('crafting-title');
      if (titleEl) titleEl.innerText = `⚒️ ${station.name}`;

      const closeBtn = document.getElementById('close-crafting');
      if (closeBtn) closeBtn.onclick = () => ui.style.display = 'none';

      const profNameEl = document.getElementById('crafting-prof-name');
      const profLvlEl = document.getElementById('crafting-prof-level');

      let profName = 'Ferraria';
      let profLvl = this.professionSmithingLevel;
      let profXp = this.professionSmithingXp;

      if (station.type === 'alchemy') {
          profName = 'Alquimia';
          profLvl = this.professionAlchemyLevel;
          profXp = this.professionAlchemyXp;
      } else if (station.type === 'tanning') {
          profName = 'Alfaiataria';
          profLvl = this.professionTanningLevel;
          profXp = this.professionTanningXp;
      }

      if (profNameEl) profNameEl.innerText = profName;
      if (profLvlEl) profLvlEl.innerText = `Lvl ${profLvl} (${profXp}/${profLvl * 100} XP)`;

      const listEl = document.getElementById('crafting-recipe-list');
      if (!listEl) return;
      listEl.innerHTML = '';

      const recipes = CRAFTING_RECIPES.filter(r => r.stationType === station.type);

      recipes.forEach(recipe => {
          const div = document.createElement('div');
          div.style.padding = '8px';
          div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
          div.style.cursor = 'pointer';
          div.style.fontSize = '11px';
          
          const isLvlReqMet = profLvl >= recipe.levelRequired;
          const isLearned = recipe.levelRequired < 2 || this.learnedRecipes.includes(recipe.id);
          
          let statusText = '';
          if (!isLvlReqMet) {
              statusText = ` (Lvl ${recipe.levelRequired})`;
              div.style.color = '#ef4444';
          } else if (!isLearned) {
              statusText = ' (Bloqueada)';
              div.style.color = '#a8a29e';
          } else {
              div.style.color = '#e2e8f0';
          }

          div.innerText = `⚒️ ${recipe.name}${statusText}`;
          
          div.onclick = () => {
              Array.from(listEl.children).forEach(child => (child as HTMLElement).style.background = 'transparent');
              div.style.background = 'rgba(16, 185, 129, 0.2)';
              
              this.showRecipeDetails(recipe, isLvlReqMet && isLearned);
          };

          listEl.appendChild(div);
      });
  }

  private showRecipeDetails(recipe: Recipe, canCraft: boolean) {
      const detailsEl = document.getElementById('crafting-recipe-details');
      if (!detailsEl) return;

      const emojis: Record<string, string> = {
          'Cheese': '🧀', 'Apple': '🍎', 'Steel Sword': '🗡️', 'Wood Sword': '🗡️',
          'Health Potion': '🧪', 'Mana Potion': '💙', 'Blueberry': '🍇', 'Torch': '🔦',
          'Helmet': '👑', 'Armor': '👕', 'Pants': '👖', 'Leather Boots': '🥾',
          'Iron Ore': '🌑', 'Wood Log': '🌲', 'Medicinal Herb': '🌿', 'Leather Hide': '🫘',
          'Leather Backpack': '🎒', 'Wooden Backpack': '💼', 'Iron Backpack': '🧳',
          'Skull': '💀'
      };

      const resultEmoji = emojis[recipe.resultItem] || '📦';
      
      let ingredsHtml = '';
      recipe.ingredients.forEach(ing => {
          const countInBackpack = this.countItemInBackpackClient(ing.itemName);
          const color = countInBackpack >= ing.count ? '#22c55e' : '#ef4444';
          const ingEmoji = emojis[ing.itemName] || '📦';
          const translatedIngName = (window as any).translateItem ? (window as any).translateItem(ing.itemName) : ing.itemName;
          ingredsHtml += `
              <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:11px; color:${color};">
                  <span>${ingEmoji} ${translatedIngName}</span>
                  <span>${countInBackpack}/${ing.count}</span>
              </div>
          `;
      });

      const profLvl = recipe.profession === 'smithing' ? this.professionSmithingLevel 
                    : recipe.profession === 'alchemy' ? this.professionAlchemyLevel 
                    : this.professionTanningLevel;
      const successChance = Math.min(100, 85 + (profLvl - recipe.levelRequired) * 5);

      detailsEl.innerHTML = `
          <div style="text-align:center; margin-bottom:12px;">
              <span style="font-size:32px; display:block;">${resultEmoji}</span>
              <span style="font-weight:bold; font-size:14px; color:#fbbf24;">${recipe.name}</span>
              <span style="font-size:10px; color:#94a3b8; display:block; margin-top:2px;">Chance de Sucesso: ${successChance}%</span>
          </div>

          <div style="background:rgba(0,0,0,0.2); padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); margin-bottom:12px;">
              <div style="font-size:10px; color:#94a3b8; margin-bottom:6px; font-weight:bold;">Ingredientes:</div>
              ${ingredsHtml}
          </div>

          <div style="display:flex; gap:8px;">
              <button id="btn-craft-action" ${canCraft ? '' : 'disabled'} style="flex:1; background:#10b981; color:white; border:none; padding:8px; border-radius:6px; cursor:${canCraft ? 'pointer' : 'not-allowed'}; font-weight:bold; opacity:${canCraft ? 1 : 0.5}; font-family:monospace; font-size:11px;">
                  Criar Item ⚒️
              </button>
              <button id="btn-salvage-action" style="background:#ef4444; color:white; border:none; padding:8px; border-radius:6px; cursor:pointer; font-weight:bold; font-family:monospace; font-size:11px;">
                  Desmontar ♻️
              </button>
          </div>
      `;

      if (canCraft) {
          document.getElementById('btn-craft-action')!.onclick = () => {
              this.socketManager.socket.emit('craftItem', { recipeId: recipe.id });
          };
      }

      document.getElementById('btn-salvage-action')!.onclick = () => {
          this.socketManager.socket.emit('salvageItem', recipe.id);
      };
  }

  private countItemInBackpackClient(itemName: string): number {
      if (!this.backpackData) return 0;
      let total = 0;
      this.backpackData.forEach(slot => {
          if (!slot) return;
          let name = slot;
          let count = 1;
          
          if (slot.startsWith('{')) {
              try {
                  const parsed = JSON.parse(slot);
                  name = parsed.name;
              } catch (e) {}
          } else if (slot.includes(':')) {
              [name, count] = slot.split(':') as any;
              count = parseInt(count as any) || 1;
          }
          
          if (name === itemName) {
              total += count;
          }
      });
      return total;
  }

  public renderAuctionList(list: any[]) {
      const content = document.getElementById('shop-content');
      if (!content) return;

      const emojis: Record<string, string> = {
          'Cheese': '🧀', 'Apple': '🍎', 'Steel Sword': '🗡️', 'Wood Sword': '🗡️',
          'Health Potion': '🧪', 'Mana Potion': '💙', 'Blueberry': '🍇', 'Torch': '🔦',
          'Helmet': '👑', 'Armor': '👕', 'Pants': '👖', 'Leather Boots': '🥾',
          'Iron Ore': '🌑', 'Wood Log': '🌲', 'Medicinal Herb': '🌿', 'Leather Hide': '🫘',
          'Leather Backpack': '🎒', 'Wooden Backpack': '💼', 'Iron Backpack': '🧳',
          'Skull': '💀'
      };

      let html = '<div style="display:flex; flex-direction:column; gap:10px; font-family:monospace;">';

      html += '<div style="font-weight:bold; border-bottom:1px solid #444; padding-bottom:5px; color:#fbbf24;">Ofertas Ativas:</div>';
      if (list.length === 0) {
          html += '<div style="color:#888; text-align:center; padding:10px;">Nenhum item à venda no leilão.</div>';
      } else {
          list.forEach(auc => {
              let itemName = '';
              let itemEmoji = '📦';
              
              if (typeof auc.itemData === 'string') {
                  itemName = (window as any).translateItem ? (window as any).translateItem(auc.itemData) : auc.itemData;
              } else if (auc.itemData && typeof auc.itemData === 'object') {
                  const itemStr = JSON.stringify(auc.itemData);
                  itemName = (window as any).translateItem ? (window as any).translateItem(itemStr) : auc.itemData.name;
              }
              
              const baseName = typeof auc.itemData === 'string'
                  ? (auc.itemData.startsWith('{') ? JSON.parse(auc.itemData).name : auc.itemData.split(':')[0])
                  : auc.itemData.name;
              itemEmoji = emojis[baseName] || '📦';
              
              html += `
                  <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); padding:6px; border-radius:4px; border: 1px solid rgba(255,255,255,0.05);">
                      <div style="display:flex; flex-direction:column;">
                          <span style="font-weight:bold; color:#fbbf24;">${itemEmoji} ${itemName}</span>
                          <span style="font-size:10px; color:#888;">Vendedor: ${auc.sellerName}</span>
                      </div>
                      <button class="btn-buy-auction" data-id="${auc.id}" style="background:#10b981; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-weight:bold;">
                          Comprar (${auc.price}G)
                      </button>
                  </div>
              `;
          });
      }

      html += '<div style="font-weight:bold; border-bottom:1px solid #444; padding-bottom:5px; margin-top:15px; color:#fbbf24;">Vender no Leilão:</div>';
      
      let hasItems = false;
      this.backpackData.forEach((itemString, index) => {
          if (itemString && itemString !== '') {
              hasItems = true;
              let itemName = (window as any).translateItem ? (window as any).translateItem(itemString) : itemString;
              let itemEmoji = '📦';
              
              const baseName = itemString.startsWith('{') ? JSON.parse(itemString).name : itemString.split(':')[0];
              itemEmoji = emojis[baseName] || '📦';
              
              html += `
                  <div style="display:flex; justify-content:space-between; align-items:center; padding:6px; border-bottom:1px dashed #333;">
                      <span>${itemEmoji} ${itemName}</span>
                      <div style="display:flex; gap:5px; align-items:center;">
                          <input type="number" id="auc-price-${index}" placeholder="Preço" min="1" style="width:60px; background:#1e293b; color:white; border:1px solid #444; border-radius:4px; padding:3px; font-family:monospace; text-align:center;" />
                          <button class="btn-create-auction" data-index="${index}" style="background:#fbbf24; color:black; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-weight:bold;">
                              Vender
                          </button>
                      </div>
                  </div>
              `;
          }
      });

      if (!hasItems) {
          html += '<div style="color:#888; text-align:center; padding:10px;">Sua mochila está vazia.</div>';
      }

      html += '</div>';
      content.innerHTML = html;

      content.querySelectorAll('.btn-buy-auction').forEach(btn => {
          (btn as HTMLElement).onclick = (e) => {
              const id = parseInt((e.currentTarget as HTMLElement).getAttribute('data-id') || '0');
              if (id > 0) {
                  this.socketManager.socket.emit('buyAuction', id);
              }
          };
      });

      content.querySelectorAll('.btn-create-auction').forEach(btn => {
          (btn as HTMLElement).onclick = (e) => {
              const index = parseInt((e.currentTarget as HTMLElement).getAttribute('data-index') || '0');
              const priceInput = document.getElementById(`auc-price-${index}`) as HTMLInputElement;
              const price = parseInt(priceInput?.value || '0');
              if (price > 0) {
                  this.socketManager.socket.emit('createAuction', { backpackIndex: index, price });
              } else {
                  alert('Insira um preço válido maior que zero.');
              }
          };
      });
  }
}
