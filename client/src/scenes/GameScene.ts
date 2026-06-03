import Phaser from 'phaser';
import { SocketManager } from '../network/SocketManager';
import { PlayerData, Position } from '../../../shared/types';

export class GameScene extends Phaser.Scene {
  private socketManager!: SocketManager;
  private otherPlayers: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private projectiles: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private localPlayerSprite?: Phaser.GameObjects.Sprite;
  private wallsGroup!: Phaser.GameObjects.Group;
  private floorItems: Map<string, Phaser.GameObjects.Text> = new Map();
  
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

  private readonly TILE_SIZE = 32;
  private isMoving = false;
  private localFacing: string = 'down';
  
  private collisionMap: Set<string> = new Set();
  private autoPath: {x: number, y: number}[] = [];
  
  private fog!: Phaser.GameObjects.Graphics;
  private lightBrush!: Phaser.GameObjects.Image;
  private hasTorch: boolean = false;
  
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
      'Gold Coin': { name: 'Moeda de Ouro', desc: 'Ouro: +1 G | Peso: 0.1 oz\nMoeda brilhante de ouro.', color: '#eab308' }
  };
  
  constructor() {
    super('GameScene');
  }

  create() {
    this.wallsGroup = this.add.group();
    this.createWorld();
    
    // Iniciar a Conexão
    this.socketManager = new SocketManager(this);
    
    // Conecta usando o nome do login screen
    const pName = (window as any).playerName || 'Tiberius';
    this.socketManager.connect(pName);

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
  }

  private createWorld() {
    // Criar o gramado cobrindo o mapa inteiro (41x41 tiles de 32px)
    const mapSize = 41 * this.TILE_SIZE;
    
    const bg = this.add.tileSprite(mapSize/2, mapSize/2, mapSize, mapSize, 'tile-grass');
    bg.setTint(0x3b3b55); // Efeito de Noite (Azul escuro) na Grama
  }

  // --- Callbacks do Socket.io ---

  public onLocalPlayerInit(data: PlayerData) {
    this.localPlayerSprite = this.add.sprite(
      data.x * this.TILE_SIZE, 
      data.y * this.TILE_SIZE, 
      'tiberius-sprite'
    );
    this.localPlayerSprite.setDepth(10); // Garantir que o player fique sobre as paredes
    
    // Cria a textura de luz (brush gradiente) para apagar a escuridão
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    this.textures.addSpriteSheet('lightBrush', canvas as any, { frameWidth: 256, frameHeight: 256 });
    
    this.lightBrush = this.make.image({ x: 0, y: 0, key: 'lightBrush', add: true });
    this.lightBrush.setVisible(false); // Fica invisível, serve só como máscara
    
    // Cria a camada de Fog com Graphics cobrindo todo o mapa
    const mapWidth = 60 * this.TILE_SIZE;
    const mapHeight = 60 * this.TILE_SIZE;
    this.fog = this.add.graphics();
    this.fog.fillStyle(0x000000, 0.98);
    this.fog.fillRect(0, 0, mapWidth, mapHeight);
    this.fog.setDepth(19); // Acima de monstros(10) e chão, abaixo de texto de level up(20)

    // Cria a máscara invertida (Furo de Luz)
    const mask = this.lightBrush.createBitmapMask();
    mask.invertAlpha = true;
    this.fog.setMask(mask);

    // Ajusta o tamanho do mapa e câmera
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    
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
  }

  public onMapData(data: { walls: Position[], itemsOnFloor: any[] }) {
    data.walls.forEach(wall => {
      const sprite = this.add.sprite(wall.x * this.TILE_SIZE, wall.y * this.TILE_SIZE, 'tile-wall');
      sprite.setDepth(5);
      // Efeito de noite nas paredes (azul escuro)
      sprite.setTint(0x1e1e40);
      this.wallsGroup.add(sprite);
      this.collisionMap.add(`${wall.x},${wall.y}`);
    });
    
    // Desenha os itens iniciais
    data.itemsOnFloor.forEach(item => this.onItemDropped(item));
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
  }

  public onPlayerMoved(data: PlayerData) {
    const isLocal = data.id === this.socketManager.getId();
    if (!isLocal) {
        this.otherPlayersData.set(data.id, data);
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
       if (this.localPlayerSprite.x === data.x * this.TILE_SIZE && this.localPlayerSprite.y === data.y * this.TILE_SIZE) {
           this.isMoving = false;
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
      }
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
    const adjacentTiles = [
        { x: tx, y: ty - 1 }, { x: tx, y: ty + 1 },
        { x: tx - 1, y: ty }, { x: tx + 1, y: ty }
    ].filter(t => !this.collisionMap.has(`${t.x},${t.y}`) && t.x >= 0 && t.x <= 40 && t.y >= 0 && t.y <= 40);

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

  /** Cancela a perseguição atual */
  private stopChase() {
    this.chaseTargetId = undefined;
    this.chaseTargetPos = undefined;
    this.autoPath = [];
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

  public onPlayerDamaged(data: { id: string, health: number, maxHealth: number, amount?: number, isCrit?: boolean }) {
       const cached = this.otherPlayersData.get(data.id);
       if (cached) {
           cached.health = data.health;
           cached.maxHealth = data.maxHealth;
           if (cached.health <= 0) cached.isDead = true;
       }
       this.updateHpBar({ id: data.id, health: data.health, maxHealth: data.maxHealth } as PlayerData);
       const sprite = data.id === this.socketManager.getId() ? this.localPlayerSprite : this.otherPlayers.get(data.id);
      
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
    const sprite = id === this.socketManager.getId() ? this.localPlayerSprite : this.otherPlayers.get(id);
    if (!sprite) return;

    const text = this.add.text(sprite.x, sprite.y - 40, message, {
        fontFamily: 'Courier New',
        fontSize: '14px',
        color: '#ffff00', // Texto amarelo tradicional do Tibia
        stroke: '#000000',
        strokeThickness: 3
    }).setOrigin(0.5).setDepth(15);

    // Texto sobe e some aos poucos
    this.tweens.add({
        targets: text,
        y: text.y - 20,
        alpha: 0,
        duration: 3000,
        onComplete: () => text.destroy()
    });
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
     const textObj = this.add.text(item.x * this.TILE_SIZE, item.y * this.TILE_SIZE, item.emoji, {
         fontSize: '20px'
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
         const details = this.itemDetails[item.name] || { name: item.name, desc: 'Item caído no chão.', color: '#ffffff' };
         tName.innerText = details.name;
         tName.style.color = details.color;
         tDesc.innerText = details.desc + '\n\nClique no chão para andar e pegá-lo.';
         
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
     // Apenas fala no chat
     this.onPlayerSpoke(this.socketManager.getId()!, 'Got ' + item.name);
  }

  public onEquipmentUpdate(eq: any) {
         this.equipmentData = eq;
         const getEmoji = (name: string) => {
            if (name === 'Steel Sword' || name === 'Wood Sword') return '🗡️';
            if (name === 'Torch') return '🔦';
            if (name === 'Helmet') return '👑';
            if (name === 'Armor') return '👕';
            if (name === 'Pants') return '👖';
            if (name === 'Leather Boots') return '🥾';
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
        
        const equipSlots = ['slot-head', 'slot-body', 'slot-legs', 'slot-boots', 'slot-left', 'slot-right'];
        equipSlots.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                // Se o texto for curto (provavelmente um Emoji), aumenta a fonte. Senão volta ao padrão 11px.
                const isEmoji = el.innerText.length <= 2 && el.innerText !== '';
                el.style.fontSize = isEmoji ? '24px' : '11px';
                el.style.cursor = isEmoji ? 'pointer' : 'default';
                el.style.color = isEmoji ? '#ffffff' : '#475569';
            }
        });
  }

  private backpackData: string[] = []; // Armazena a bolsa localmente para facilitar a renderização da loja

  public onInventoryUpdate(backpack: string[]) {
     this.backpackData = backpack;
     const slots = document.querySelectorAll('#backpack-grid .slot');
     slots.forEach((slot, index) => {
         const htmlSlot = slot as HTMLElement;
         htmlSlot.onclick = null;
         
         const itemString = backpack[index];
         if (itemString) {
             const [itemName, countStr] = itemString.split(':');
             const count = parseInt(countStr) || 1;
             
             const emojis: Record<string, string> = { 
                 'Cheese': '🧀', 'Gold Coin': '💰', 'Apple': '🍎', 'Health Potion': '🧪', 
                 'Mana Potion': '💙', 'Blueberry': '🍇',
                 'Steel Sword': '🗡️', 'Wood Sword': '🗡️', 'Torch': '🔦',
                 'Helmet': '👑', 'Armor': '👕', 'Pants': '👖', 'Leather Boots': '🥾'
             };
             
             const isEmojiChar = itemName.length <= 4;
             const emoji = emojis[itemName] || (isEmojiChar ? itemName : '📦');
             
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
             htmlSlot.onclick = () => {
                 this.socketManager.sendUseItem(index);
             };
         } else {
             htmlSlot.innerHTML = '';
             htmlSlot.style.cursor = 'default';
         }
     });
     
     // Atualiza a aba Sell da loja se ela estiver aberta
     if (document.getElementById('shop-ui')?.style.display === 'flex') {
         this.renderShopSell();
     }
  }
  
  public renderShopSell() {
      const content = document.getElementById('shop-content');
      if (!content) return;
      
      const sellPrices: Record<string, number> = { 'Cheese': 2, 'Apple': 3, 'Steel Sword': 25 };
      const emojis: Record<string, string> = { 
          'Cheese': '🧀', 'Apple': '🍎', 'Steel Sword': '🗡️', 
          'Health Potion': '🧪', 'Mana Potion': '💙', 'Blueberry': '🍇', 'Torch': '🔦' 
      };
      
      content.innerHTML = '';
      
      let hasItems = false;
      
      this.backpackData.forEach((itemString, index) => {
          if (itemString && itemString !== '') {
              hasItems = true;
              const [itemName, countStr] = itemString.split(':');
              const count = parseInt(countStr) || 1;
              const emoji = emojis[itemName] || '📦';
              const val = sellPrices[itemName] || 1;
              
              const div = document.createElement('div');
              div.style.display = 'flex';
              div.style.justifyContent = 'space-between';
              div.style.alignItems = 'center';
              div.style.padding = '8px';
              div.style.borderBottom = '1px solid #333';
              
              div.innerHTML = `
                  <span class="shop-item-hover" style="cursor: help; text-decoration: underline dotted rgba(255,255,255,0.3);">${emoji} ${itemName} (x${count})</span>
                  <button style="background: #ff4444; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">
                      Sell (+${val}G)
                  </button>
              `;
              
              const span = div.querySelector('.shop-item-hover') as HTMLElement;
              if (span) {
                  const tooltip = document.getElementById('item-tooltip')!;
                  const tName = document.getElementById('tooltip-name')!;
                  const tDesc = document.getElementById('tooltip-desc')!;
                  
                  span.addEventListener('mouseenter', (e) => {
                      const details = this.itemDetails[itemName] || { name: itemName, desc: 'Item na bolsa', color: '#ffffff' };
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
          content.innerHTML = '<div style="text-align: center; color: #888; padding: 10px;">Your backpack is empty.</div>';
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
    if (data.isMonster) {
        if (data.name === 'Orc') texture = 'orc-sprite';
        else if (data.name === 'Rotworm') texture = 'rotworm-sprite';
        else if (data.name === 'Demon Skeleton') texture = 'demonskeleton-sprite';
        else texture = 'rat-sprite';
    } else if (data.name === 'Merchant') {
        texture = 'merchant-sprite';
    }

    const sprite = this.add.sprite(
      data.x * this.TILE_SIZE, 
      data.y * this.TILE_SIZE, 
      texture
    );
    if (!data.isMonster && data.name !== 'Merchant') {
        sprite.setTint(0xff0000); // Jogadores inimigos em vermelho
    }
    sprite.setDepth(10);
    sprite.setInteractive({ useHandCursor: true }); // Torna clicável

    // Nomes Coloridos de acordo com o nível/perigo
    let nameColor = '#ffffff';
    if (data.name === 'Orc') nameColor = '#f97316';
    else if (data.name === 'Rotworm') nameColor = '#ec4899';
    else if (data.name === 'Demon Skeleton') nameColor = '#ef4444';
    else if (data.name === 'Merchant') nameColor = '#fbbf24';
    else if (data.name === 'Giant Rat') nameColor = '#94a3b8';

    this.add.text(sprite.x, sprite.y - 30, data.name, { fontSize: '10px', color: nameColor }).setOrigin(0.5);

    // Botão ESQUERDO = selecionar (marcar target), sem atacar
    sprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (data.name === 'Merchant') {
          const myPos = this.localPlayerSprite;
          if (myPos) {
              const dist = Math.abs(myPos.x - sprite.x) + Math.abs(myPos.y - sprite.y);
              if (dist / this.TILE_SIZE <= 2.5) {
                  this.socketManager.openShop();
              } else {
                  this.onTextEffect(Math.round(myPos.x/this.TILE_SIZE), Math.round(myPos.y/this.TILE_SIZE), 'Too far!', '#ff0000');
              }
          }
      } else if (pointer.rightButtonDown()) {
          // Botão DIREITO = perseguir e atacar
          this.currentTargetId = data.id;
          this.updateTargetSquare(sprite);
          this.startChase(data.id); // Inicia perseguição automática
      } else {
          // Botão ESQUERDO = apenas selecionar o target
          this.stopChase(); // Para perseguição anterior
          this.currentTargetId = data.id;
          this.updateTargetSquare(sprite);
      }
    });

    // DUPLO CLIQUE esquerdo = perseguir e atacar
    sprite.on('pointerdblclick', () => {
      if (data.name !== 'Merchant') {
          this.currentTargetId = data.id;
          this.updateTargetSquare(sprite);
          this.startChase(data.id);
      }
    });

    this.otherPlayers.set(data.id, sprite);
    this.updateHpBar(data);
    this.updateHpBarPosition(data.id, sprite);
  }

  private updateTargetSquare(sprite: Phaser.GameObjects.Sprite) {
    if (!this.targetSquare) return;
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
     
     // Barra preta de fundo
     hpBar.fillStyle(0x000000);
     hpBar.fillRect(-14, -20, 28, 4);

     // Barra verde de vida
     const pct = Math.max(0, data.health / data.maxHealth);
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

    // Clique para andar (Pathfinding)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, currentlyOver: any[]) => {
        const blocksMovement = currentlyOver.some(obj => !obj.getData('isFloorItem'));
        if (blocksMovement) return;
        if (!this.localPlayerSprite) return;

        // Clique no chão cancela perseguição
        this.stopChase();

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

    // ENTER: abre/fecha chat
    this.input.keyboard?.on('keydown-ENTER', () => {
        if (document.activeElement === chatInput) {
            if (chatInput.value.trim() !== '') {
                this.socketManager.sendChat(chatInput.value);
            }
            chatInput.value = '';
            chatInput.blur();
            chatInput.style.display = 'none';
        } else {
            chatInput.style.display = 'block';
            chatInput.focus();
        }
    });

    // Desativa menu de contexto do botão direito no canvas (para usar right-click para atacar)
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (document.activeElement === chatInput) return;
      if (!this.localPlayerSprite) return;

      // Atalho do Autofarm
      if (event.key.toLowerCase() === 'f') {
          this.toggleAutofarm();
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
      if (movKeys.includes(event.key)) this.stopChase();

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
  }

  // Algoritmo BFS para encontrar menor caminho desviando das paredes
  private calculatePath(startX: number, startY: number, destX: number, destY: number): {x: number, y: number}[] {
      const queue = [{ x: startX, y: startY, path: [] as {x:number, y:number}[] }];
      const visited = new Set<string>();
      visited.add(`${startX},${startY}`);
      
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
              if (!visited.has(key) && !this.collisionMap.has(key) && n.x >= 0 && n.x <= 40 && n.y >= 0 && n.y <= 40) {
                  visited.add(key);
                  queue.push({ x: n.x, y: n.y, path: [...curr.path, {x: n.x, y: n.y}] });
              }
          }
      }
      return [];
  }

  public setNight(isNight: boolean) {
      if (this.fog) {
          // Anima a transição Dia -> Noite (1 segundo)
          this.tweens.add({
              targets: this.fog,
              alpha: isNight ? 1 : 0,
              duration: 2000,
              ease: 'Sine.easeInOut'
          });
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

      const getTooltipData = (slotEl: HTMLElement): { name: string, desc: string, color: string } | null => {
          const id = slotEl.id;
          if (id && id.startsWith('slot-')) {
              const eqSlot = id.replace('slot-', '');
              const slotMap: Record<string, string> = {
                  'head': 'head', 'left': 'leftHand', 'right': 'rightHand',
                  'body': 'body', 'legs': 'legs', 'boots': 'boots'
              };
              const key = slotMap[eqSlot];
              const itemName = this.equipmentData ? this.equipmentData[key] : null;
              
              if (itemName) {
                  return this.itemDetails[itemName] || { name: itemName, desc: 'Equipamento', color: '#ffffff' };
              } else {
                  const emptyNames: Record<string, string> = {
                      'head': 'Slot de Cabeça', 'left': 'Mão Esquerda', 'right': 'Mão Direita',
                      'body': 'Slot de Corpo', 'legs': 'Slot de Pernas', 'boots': 'Slot de Botas'
                  };
                  const emptyDescs: Record<string, string> = {
                      'head': 'Vazio\nEquipe elmos para aumentar sua Defesa.',
                      'left': 'Vazio\nEquipe escudos ou tochas na mão esquerda.',
                      'right': 'Vazio\nEquipe armas para aumentar seu ATK.',
                      'body': 'Vazio\nEquipe armaduras para aumentar sua Defesa.',
                      'legs': 'Vazio\nEquipe calças para proteção.',
                      'boots': 'Vazio\nEquipe botas para proteção.'
                  };
                  return { name: emptyNames[eqSlot] || 'Equipamento', desc: emptyDescs[eqSlot] || 'Slot vazio.', color: '#475569' };
              }
          }
          
          const indexAttr = slotEl.getAttribute('data-index');
          if (indexAttr !== null) {
              const index = parseInt(indexAttr);
              const itemString = this.backpackData[index];
              if (itemString) {
                  const [itemName, countStr] = itemString.split(':');
                  const count = parseInt(countStr) || 1;
                  const details = this.itemDetails[itemName];
                  if (details) {
                      const countText = count > 1 ? ` (x${count})` : '';
                      return {
                          name: details.name + countText,
                          desc: details.desc,
                          color: details.color
                      };
                  }
                  return { name: itemName, desc: `Item (x${count})`, color: '#ffffff' };
              } else {
                  return { name: 'Espaço Vazio', desc: 'Slot de inventário livre.', color: '#475569' };
              }
          }
          
          return null;
      };

      const showTooltip = (e: MouseEvent) => {
          const slotEl = e.currentTarget as HTMLElement;
          const data = getTooltipData(slotEl);
          if (data) {
              tName.innerText = data.name;
              tName.style.color = data.color;
              tDesc.innerText = data.desc;
              
              this.positionTooltip(e.pageX, e.pageY);
          }
      };

      const moveTooltip = (e: MouseEvent) => {
          this.positionTooltip(e.pageX, e.pageY);
      };

      const hideTooltip = () => {
          tooltip.style.display = 'none';
      };

      const allSlots = document.querySelectorAll('.slot');
      allSlots.forEach(slot => {
          const el = slot as HTMLElement;
          el.addEventListener('mouseenter', showTooltip);
          el.addEventListener('mousemove', moveTooltip);
          el.addEventListener('mouseleave', hideTooltip);
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
      // Atualiza a Fog of War desenhando uma luz macia em cima do jogador todo frame
      if (this.localPlayerSprite && this.fog) {
          // A máscara segue o jogador exatamente nas coordenadas do mapa
          this.lightBrush.x = this.localPlayerSprite.x;
          this.lightBrush.y = this.localPlayerSprite.y;
          
          // Raio visual aumentado (Sem Tocha = 0.8, Com Tocha = 5.0)
          const scale = this.hasTorch ? 5.0 : 0.8;
          this.lightBrush.setScale(scale);
      }
  }

  public toggleAutofarm() {
      if (this.localPlayerDead) return;
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
      
      const px = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
      const py = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
      
      let nearest: PlayerData | null = null;
      let minDist = Infinity;
      
      this.otherPlayersData.forEach(p => {
          if (p.isMonster && !p.isDead && p.health > 0) {
              const dist = Math.abs(p.x - px) + Math.abs(p.y - py);
              if (dist < minDist) {
                  minDist = dist;
                  nearest = p;
              }
          }
      });
      
      return nearest;
  }

  private runAutofarmTick() {
      if (!this.isAutofarmEnabled || !this.localPlayerSprite || this.localPlayerDead) {
          if (this.isAutofarmEnabled) this.stopAutofarm();
          return;
      }

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
      if (this.lootTargetId && this.lootTargetPos) {
          if (this.floorItems.has(this.lootTargetId)) {
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
              return; // Looting tem prioridade sobre monstros
          } else {
              this.stopLootChase();
          }
      }

      // 3. Verificar se o alvo atual de perseguicao ainda esta vivo e visivel
      let currentTargetAlive = false;
      if (this.chaseTargetId) {
          const targetData = this.otherPlayersData.get(this.chaseTargetId);
          if (targetData && !targetData.isDead && targetData.health > 0) {
              currentTargetAlive = true;
          }
      }

      // 4. Se nao tiver alvo ativo de monstro ou o atual morreu
      if (!currentTargetAlive) {
          // Primeiro, procura loot por perto antes de buscar outro monstro!
          const nearestLoot = this.findNearestLoot();
          if (nearestLoot) {
              this.startLootChase(nearestLoot.id, nearestLoot.x, nearestLoot.y);
              const targetDisplay = document.getElementById('autofarm-target');
              if (targetDisplay) targetDisplay.innerText = `Alvo: Pegando loot (${nearestLoot.name})`;
              return;
          }

          // Se não houver loot, busca monstro
          const nearest = this.findNearestMonster();
          if (nearest) {
              this.currentTargetId = nearest.id;
              const targetSprite = this.otherPlayers.get(nearest.id);
              if (targetSprite) this.updateTargetSquare(targetSprite);
              this.startChase(nearest.id);
              
              const targetDisplay = document.getElementById('autofarm-target');
              if (targetDisplay) targetDisplay.innerText = `Alvo: ${nearest.name}`;
          } else {
              this.stopChase();
              const targetDisplay = document.getElementById('autofarm-target');
              if (targetDisplay) targetDisplay.innerText = 'Alvo: Procurando...';
          }
      } else {
          // Se tiver alvo ativo, atualiza o texto da UI
          const targetData = this.otherPlayersData.get(this.chaseTargetId!);
          const targetDisplay = document.getElementById('autofarm-target');
          if (targetDisplay && targetData) {
              targetDisplay.innerText = `Alvo: ${targetData.name} (Lvl ${targetData.level})`;
          }

          // 5. Auto Magic Skills (se habilitado)
          const checkbox = document.getElementById('autofarm-skills') as HTMLInputElement;
          if (checkbox && checkbox.checked && targetData) {
              const px = Math.round(this.localPlayerSprite.x / this.TILE_SIZE);
              const py = Math.round(this.localPlayerSprite.y / this.TILE_SIZE);
              const dx = Math.abs(px - targetData.x);
              const dy = Math.abs(py - targetData.y);
              const isAdjacent = (dx <= 1 && dy <= 1);

              if (isAdjacent) {
                  // Prioridade 1: Whirlwind (AoE) - Custo 20 SP, Cooldown 3000ms
                  const lastWhirlwind = this.skillCooldowns['whirlwind'] || 0;
                  if (now - lastWhirlwind >= 3000 && this.localSp >= 20) {
                      this.useSkill('whirlwind');
                      return;
                   }
              }

              // Prioridade 2: Skillshot - Custo 10 SP, Cooldown 1500ms
              const lastSkillshot = this.skillCooldowns['skillshot'] || 0;
              if (now - lastSkillshot >= 1500 && this.localSp >= 10) {
                  this.useSkill('skillshot');
                  return;
              }
          }
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
}
