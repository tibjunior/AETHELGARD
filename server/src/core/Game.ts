import { Server, Socket } from 'socket.io';
import { PlayerData, Position, MapData, ItemData, ResourceNode, CraftingStation } from '../../../shared/types';
import { getPlayerFromDB, savePlayerToDB, getAllRegisteredPlayers, updatePlayerOffline, incrementGoldOffline, getAuctionsFromDB, createAuctionInDB, removeAuctionFromDB, getAuctionByIdFromDB } from './database';
import { CRAFTING_RECIPES, Recipe } from '../../../shared/recipes';

export const ITEM_WEIGHTS: Record<string, number> = {
    'Steel Sword': 25, 'Wood Sword': 15, 'Helmet': 15, 'Armor': 40,
    'Pants': 20, 'Leather Boots': 10, 'Health Potion': 5, 'Mana Potion': 4,
    'Torch': 5, 'Apple': 2, 'Cheese': 2, 'Blueberry': 1,
    'Iron Ore': 8, 'Wood Log': 6, 'Medicinal Herb': 2, 'Gold Coin': 0.1,
    'Leather Hide': 4,
    'Leather Backpack': 10, 'Wooden Backpack': 15, 'Iron Backpack': 25
};

export const ITEM_EMOJIS: Record<string, string> = {
    'Steel Sword': '🗡️', 'Wood Sword': '🗡️', 'Health Potion': '🧪', 'Mana Potion': '💙',
    'Apple': '🍎', 'Cheese': '🧀', 'Gold Coin': '💰', 'Torch': '🔦', 'Blueberry': '🍇',
    'Helmet': '👑', 'Armor': '👕', 'Pants': '👖', 'Leather Boots': '🥾',
    'Iron Ore': '🌑', 'Wood Log': '🌲', 'Medicinal Herb': '🌿', 'Leather Hide': '📦',
    'Leather Backpack': '🎒', 'Wooden Backpack': '💼', 'Iron Backpack': '🧳'
};

export const ITEM_NAMES_PT: Record<string, string> = {
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
    'Leather Hide': 'Pele de Couro',
    'Helmet': 'Elmo de Aço',
    'Armor': 'Armadura de Placas',
    'Pants': 'Calças de Couro',
    'Leather Boots': 'Botas de Couro',
    'Gold Coin': 'Moeda de Ouro',
    'Leather Backpack': 'Mochila de Couro',
    'Wooden Backpack': 'Mochila de Madeira',
    'Iron Backpack': 'Mochila de Ferro'
};

export class Game {
  private io: Server;
  private players: Map<string, PlayerData> = new Map();
  private projectiles: any[] = []; // { id, casterId, x, y, dx, dy, speed }
  private walls: Set<string> = new Set();
  private itemsOnFloor: Map<string, ItemData> = new Map(); // Chave: "x,y"
  private tickRate: number = 1000 / 20; // 20 Ticks por segundo
  private lastUpdate: number = Date.now();
  private ticks: number = 0;
  private isNight: boolean = false; 
  private resourceNodes: Map<string, ResourceNode> = new Map();
  private activeGatherings: Map<string, NodeJS.Timeout> = new Map();
  private activeRecalls: Map<string, NodeJS.Timeout> = new Map();
  private craftingStations: Map<string, CraftingStation> = new Map();

  constructor(io: Server) {
    this.io = io;
    this.setupMap();
    this.setupResourceNodes();
    this.setupCraftingStations();
    this.setupNetwork();
    
    // Auto-save no DB a cada 10 segundos
    setInterval(() => this.saveAllPlayers(), 10000);
  }

  private async saveAllPlayers() {
      const allPlayers = Array.from(this.players.values()).filter(p => !p.isMonster);
      for (const p of allPlayers) {
          try {
             await savePlayerToDB(p);
          } catch(e) {
             console.error(`Erro ao salvar player ${p.name}:`, e);
          }
      }
      console.log(`[DB] Salvos ${allPlayers.length} jogadores.`);
  }

  private setupMap() {
    // Sala 40x40 com pilares
    for (let x = 0; x <= 40; x++) {
      for (let y = 0; y <= 40; y++) {
        // Paredes externas
        if (x === 0 || y === 0 || x === 40 || y === 40) {
          // Deixa um buraco para o portal na parede norte (x=10, y=0)
          if (x === 10 && y === 0) {
              // não é parede
          } else {
              this.walls.add(`${x},${y}`);
          }
        }
        // Pilares internos (formato +)
        else if (x % 8 === 0 && y % 8 === 0) {
          this.walls.add(`${x},${y}`);
          this.walls.add(`${x+1},${y}`);
          this.walls.add(`${x},${y+1}`);
          this.walls.add(`${x-1},${y}`);
          this.walls.add(`${x},${y-1}`);
        }
      }
    }

    // Sala da Cidade (Safe Zone): 100,100 até 140,140
    for (let x = 100; x <= 140; x++) {
      for (let y = 100; y <= 140; y++) {
        if (x === 100 || y === 100 || x === 140 || y === 140) {
          // Deixa um buraco pro portal de volta (x=120, y=140)
          if (x === 120 && y === 140) {
              // portal de volta
          } else {
              this.walls.add(`${x},${y}`);
          }
        }
      }
    }

    // Spawna o Mercador na Cidade
    const merchant: PlayerData = {
        id: 'npc_merchant',
        name: 'Merchant',
        x: 120,
        y: 110,
        health: 9999,
        maxHealth: 9999,
        speed: 0,
        isMonster: false,
        level: 100,
        experience: 0
    };
    // Adicionamos uma tag especial para NPCs pacíficos
    (merchant as any).isNPC = true;
    this.players.set(merchant.id, merchant);

    // Spawna múltiplos monstros
    for (let i = 1; i <= 8; i++) {
        const rat: PlayerData = {
          id: `rat_${i}`,
          name: 'Giant Rat',
          x: 4 + (i * 3),
          y: 6 + (i * 2),
          health: 50,
          maxHealth: 50,
          speed: 150,
          isMonster: true,
          level: 1,
          experience: 0,
          attack: 8
        };
        this.players.set(rat.id, rat);
    }
    
    // Spawna Orcs (Fase 13)
    for (let i = 1; i <= 4; i++) {
        const orc: PlayerData = {
          id: `orc_${i}`,
          name: 'Orc',
          x: 20 + (i * 4),
          y: 30 + (i % 2 * 3),
          health: 120,
          maxHealth: 120,
          speed: 100, // Mais lento
          isMonster: true,
          level: 3,
          experience: 0,
          attack: 15
        };
        this.players.set(orc.id, orc);
    }

    // Spawna Rotworms (Level 5)
    for (let i = 1; i <= 3; i++) {
        const rotworm: PlayerData = {
          id: `rotworm_${i}`,
          name: 'Rotworm',
          x: 10 + (i * 8),
          y: 22,
          health: 200,
          maxHealth: 200,
          speed: 120,
          isMonster: true,
          level: 5,
          experience: 0,
          attack: 22
        };
        this.players.set(rotworm.id, rotworm);
    }

    // Spawna Demon Skeletons (Level 10)
    for (let i = 1; i <= 2; i++) {
        const ds: PlayerData = {
          id: `demonskeleton_${i}`,
          name: 'Demon Skeleton',
          x: 12 + (i * 12),
          y: 28,
          health: 400,
          maxHealth: 400,
          speed: 90,
          isMonster: true,
          level: 10,
          experience: 0,
          attack: 38
        };
        this.players.set(ds.id, ds);
    }
  }

  private setupNetwork() {
    this.io.on('connection', async (socket: Socket) => {
      const playerName = socket.handshake.auth.name || 'Unknown';
      const playerPassword = socket.handshake.auth.password || '';
      console.log(`Aventureiro tentando conectar: ${playerName} (${socket.id})`);
      this.registerAdminEvents(socket);
      if (playerName === "AdminGM") {
          console.log("Sessão AdminGM sem avatar iniciada.");
          return;
      }

      let newPlayer: PlayerData;
      
      // Procura se o jogador já está em memória (pra evitar race condition no F5)
      let existingPlayerId: string | undefined;
      for (const [id, p] of this.players.entries()) {
          if (p.name === playerName && !p.isMonster) {
              existingPlayerId = id;
              break;
          }
      }

      if (existingPlayerId) {
          const oldP = this.players.get(existingPlayerId)!;
          if (oldP.password && oldP.password !== playerPassword) {
              socket.emit('loginFailed', { message: 'Senha incorreta.' });
              socket.disconnect(true);
              return;
          }

          console.log(`Sessão transferida para ${playerName} do socket antigo para o novo.`);
          newPlayer = { ...oldP, id: socket.id };
          this.players.delete(existingPlayerId);
          
          // Desconecta o socket antigo e marca pra não salvar em cima
          const oldSocket = this.io.sockets.sockets.get(existingPlayerId);
          if (oldSocket) {
              (oldSocket as any).sessionTransferred = true;
              oldSocket.disconnect(true);
          }
          this.io.emit('playerLeft', existingPlayerId);
      } else {
          // Carrega do Banco ou Cria Novo
          const dbPlayer = await getPlayerFromDB(playerName);
          if (dbPlayer) {
              if (dbPlayer.password && dbPlayer.password !== playerPassword) {
                  socket.emit('loginFailed', { message: 'Senha incorreta.' });
                  socket.disconnect(true);
                  return;
              }
              newPlayer = { ...dbPlayer, id: socket.id }; // Preserva o ID do socket
              
              // Suporte a personagens antigos (Retroatividade)
              if (!newPlayer.stats) {
                  newPlayer.stats = { FOR: 5, AGI: 5, VIT: 5, INT: 5, DES: 5, SOR: 5 };
              newPlayer.statPoints = (newPlayer.level - 1) * 5;
          }
          if (newPlayer.sp === undefined) newPlayer.sp = 50;
          if (newPlayer.weight === undefined) newPlayer.weight = 0;
          this.recalculateStats(newPlayer);
      } else {
          newPlayer = {
            id: socket.id,
            name: playerName,
            password: playerPassword,
            x: 10,
            y: 10,
            health: 150,
            maxHealth: 150,
            speed: 200,
            equipment: {
               head: 'Helmet',
               body: 'Armor',
               legs: 'Pants',
               boots: 'Leather Boots',
               leftHand: 'Torch', 
               rightHand: 'Wood Sword'
            },
            level: 1,
            experience: 0,
            gold: 0,
            backpack: [],
            stats: { FOR: 5, AGI: 5, VIT: 5, INT: 5, DES: 5, SOR: 5 },
            statPoints: 0,
            sp: 50,
            weight: 0
          };
          this.recalculateStats(newPlayer);
          newPlayer.health = newPlayer.maxHealth;
          newPlayer.facing = 'down';
              await savePlayerToDB(newPlayer);
          }
      }

      this.players.set(socket.id, newPlayer);

      // Envia os dados iniciais do jogador para o cliente
      socket.emit('init', newPlayer);

      const mapData: MapData = {
        walls: Array.from(this.walls).map(w => {
          const [x, y] = w.split(',');
          return { x: parseInt(x), y: parseInt(y) };
        }),
        itemsOnFloor: Array.from(this.itemsOnFloor.values()),
        resourceNodes: Array.from(this.resourceNodes.values()),
        craftingStations: Array.from(this.craftingStations.values())
      };
      socket.emit('mapData', mapData);
      
      // Envia o clima (Dia/Noite)
      socket.emit('timeUpdate', { isNight: this.isNight });

      // Avisa a todos os outros clientes sobre o novo jogador
      socket.broadcast.emit('playerJoined', newPlayer);

      // Envia todos os jogadores existentes para o cliente recém-conectado
      socket.emit('currentPlayers', Array.from(this.players.values()));
      this.io.emit('newPlayer', newPlayer);

      // Movimentação (com validação básica de colisão)
      socket.on('move', (data: { position: Position, facing: string }) => {
        const player = this.players.get(socket.id);
        if (player) {
          if (player.isDead) return;
          this.cancelGathering(socket.id);
          const { position: targetPosition, facing } = data;
          
          player.facing = facing; // Atualiza a direção que ele está olhando

          // Validação simples: o jogador só pode se mover 1 casa por vez
          const dx = Math.abs(targetPosition.x - player.x);
          const dy = Math.abs(targetPosition.y - player.y);
          if (dx > 1 || dy > 1) {
             socket.emit('playerMoved', player); 
             return;
          }

          // Verifica Colisão com Paredes
          if (this.walls.has(`${targetPosition.x},${targetPosition.y}`)) {
             // Retorna o jogador para a posição atual dele se bateu na parede
             socket.emit('playerMoved', player); 
             return; 
          }
          
          player.x = targetPosition.x;
          player.y = targetPosition.y;

          // PORTAL: Mundo -> Cidade
          if (player.x === 10 && player.y === 0) {
              player.x = 120;
              player.y = 139; // Coloca logo acima da parede de saída
              player.facing = 'up';
          }
          // PORTAL: Cidade -> Mundo
          else if (player.x === 120 && player.y === 140) {
              player.x = 10;
              player.y = 1; // Coloca logo abaixo do portão do mercador
              player.facing = 'down';
          }

          // Verifica se pegou algum item no chão (procura por qualquer item nas coordenadas do player)
          const itemsAtCoord = Array.from(this.itemsOnFloor.values()).filter(item => item.x === player.x && item.y === player.y);
          if (itemsAtCoord.length > 0) {
             let backpackUpdated = false;
             let weightUpdated = false;
             let inventoryFullMsgSent = false;
             
             for (const item of itemsAtCoord) {
                 if (item.name === 'Gold Coin') {
                     // Moeda vai direto pro banco!
                     this.itemsOnFloor.delete(item.id);
                     player.gold = (player.gold || 0) + 1;
                     socket.emit('statsUpdate', { id: player.id, level: player.level, experience: player.experience, gold: player.gold });
                     socket.emit('itemPickedUp', item); 
                     this.io.emit('itemRemoved', item.id);
                 } else if (player.backpack) {
                     const weight = ITEM_WEIGHTS[item.name] || 5;
                     
                     if (player.weight + weight <= (player.maxWeight || 250)) {
                         const added = this.addItemToBackpack(player, item.name);
                         if (added) {
                             this.itemsOnFloor.delete(item.id);
                             this.recalculateWeight(player);
                             backpackUpdated = true;
                             weightUpdated = true;
                             
                             socket.emit('itemPickedUp', item); // Só pro textinho flutuante
                             this.io.emit('itemRemoved', item.id);
                         } else {
                             if (!inventoryFullMsgSent) {
                                 socket.emit('textEffect', { x: player.x, y: player.y, message: 'Mochila Cheia!', color: '#ff5555' });
                                 inventoryFullMsgSent = true;
                             }
                         }
                     } else {
                         if (!inventoryFullMsgSent) {
                             socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito Pesado!', color: '#ff5555' });
                             inventoryFullMsgSent = true;
                         }
                     }
                 }
             }
             if (backpackUpdated) {
                 socket.emit('inventoryUpdate', player.backpack); // Sincroniza UI real
             }
             if (weightUpdated) {
                 socket.emit('statsUpdate', { id: player.id, weight: player.weight, maxWeight: player.maxWeight });
             }
          }
          
          // Re-transmite o movimento para todo mundo
          this.io.emit('playerMoved', player);
        }
      });

      // Handler de Atributos
      socket.on('addStat', (statName: string) => {
         const player = this.players.get(socket.id);
         if (!player || !player.stats) return;
         
         if (player.statPoints && player.statPoints > 0) {
             const validStats = ['FOR', 'AGI', 'VIT', 'INT', 'DES', 'SOR'];
             if (validStats.includes(statName)) {
                 player.stats[statName] += 1;
                 player.statPoints -= 1;
                 this.recalculateStats(player);
                 
                 socket.emit('statsUpdate', { 
                     id: player.id, level: player.level, experience: player.experience, gold: player.gold, 
                     stats: player.stats, statPoints: player.statPoints,
                     attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
                     hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
                     sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
                     health: player.health, maxHealth: player.maxHealth
                 });
             }
         }
      });

      // Handler de Combate
      socket.on('attack', (targetId: string) => {
        const player = this.players.get(socket.id);
        if (player) {
           if (player.isDead) return;
           this.cancelGathering(socket.id);
           player.targetId = targetId; // Marca quem o jogador quer atacar
        }
      });

      // Handler de Chat e Magias
      socket.on('chatMessage', (msg: string) => {
        const player = this.players.get(socket.id);
        if (!player) return;

        // Verifica se é uma magia
        if (msg.toLowerCase() === 'exori vis') {
           if (player.targetId) {
              const target = this.players.get(player.targetId);
               if (target) {
                  // Safe zone check
                  if (!player.isMonster && !target.isMonster) {
                      if ((player.x >= 100 && player.y >= 100) || (target.x >= 100 && target.y >= 100)) {
                          return;
                      }
                  }

                  // Dano massivo mágico
                  const damage = Math.floor(Math.random() * 20) + 30; // 30-50 dano
                 target.health -= damage;
                 this.cancelGathering(target.id);
                 
                 // Emite efeito visual mágico
                 this.io.emit('spellCast', { casterId: player.id, targetId: target.id, spell: 'exori vis' });
                 this.io.emit('playerDamaged', { id: target.id, health: target.health, maxHealth: target.maxHealth, amount: damage, attackerId: player.id });
                 
                 this.checkDeath(player, target);
              }
           }
        }
        
        // Emite a mensagem (fala) para renderizar o Floating Text
        this.io.emit('playerSpoke', { id: player.id, message: msg });
      });

      // Handler do Dash (Mecânica de Aethelgard)
      socket.on('dash', () => {
          const player = this.players.get(socket.id);
          if (player && player.facing) {
              if (player.isDead) return;
              this.cancelGathering(socket.id);
              // Pula até 3 tiles na direção do facing
              let dx = 0, dy = 0;
              if (player.facing === 'up') dy = -1;
              if (player.facing === 'down') dy = 1;
              if (player.facing === 'left') dx = -1;
              if (player.facing === 'right') dx = 1;

              for (let step = 1; step <= 3; step++) {
                  const checkX = player.x + dx;
                  const checkY = player.y + dy;
                  if (this.walls.has(`${checkX},${checkY}`)) break; // Bateu na parede, para o dash
                  
                  // Atualiza posição validada
                  player.x = checkX;
                  player.y = checkY;
              }

              // Verifica Loot no tile final
              const itemsAtCoord = Array.from(this.itemsOnFloor.values()).filter(item => item.x === player.x && item.y === player.y);
              let backpackUpdated = false;
              for (const item of itemsAtCoord) {
                  const added = this.addItemToBackpack(player, item.name);
                  if (added) {
                      this.itemsOnFloor.delete(item.id);
                      socket.emit('itemPickedUp', item);
                      this.io.emit('itemRemoved', item.id);
                      backpackUpdated = true;
                  } else {
                      socket.emit('textEffect', { x: player.x, y: player.y, message: 'Mochila Cheia!', color: '#ff5555' });
                      break;
                  }
              }
              if (backpackUpdated) {
                  socket.emit('inventoryUpdate', player.backpack);
              }

              this.io.emit('playerDashed', player);
          }
      });

      // Handler do Skillshot (Fireball) - dispara em direcão ao target selecionado
      socket.on('skillshot', (data?: { targetId?: string }) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead) return;
          this.cancelGathering(socket.id);

          // 1. Checa SP
          const spCost = 10;
          if ((player.sp || 0) < spCost) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Sem Mana!', color: '#3b82f6' });
              return;
          }

          // 2. Checa Cooldown (1500ms base, reduzido por DES)
          const des = player.stats?.DES || 5;
          const cooldownMs = Math.max(500, 1500 - (des * 20));
          const now = Date.now();
          const lastCast = (player as any).lastSkillshotTime || 0;
          if (now - lastCast < cooldownMs) {
              return; // Ignora se tentar burlar cooldown no client
          }

          // Deduz SP e atualiza tempo
          player.sp -= spCost;
          (player as any).lastSkillshotTime = now;

          // Envia atualização de mana/vida
          socket.emit('statsUpdate', { 
              id: player.id, 
              sp: player.sp, 
              maxSp: player.maxSp,
              health: player.health,
              maxHealth: player.maxHealth
          });

          // Direção: para o target selecionado, ou para a direção atual do facing
          const targetId = data?.targetId || player.targetId;
          const target = targetId ? this.players.get(targetId) : null;

          let dx = 0, dy = 0;

          if (target) {
              // Calcula o vetor normalizado de 8 direções até o target
              const rawDx = target.x - player.x;
              const rawDy = target.y - player.y;
              dx = rawDx === 0 ? 0 : (rawDx > 0 ? 1 : -1);
              dy = rawDy === 0 ? 0 : (rawDy > 0 ? 1 : -1);
              // Prefere eixo com maior distância (diagonal vira cardinal)
              if (Math.abs(rawDx) >= Math.abs(rawDy)) dy = 0;
              else dx = 0;
          } else {
              // Sem target: usa o facing
              if (player.facing === 'up') dy = -1;
              else if (player.facing === 'down') dy = 1;
              else if (player.facing === 'left') dx = -1;
              else dx = 1;
          }

          const proj = {
              id: 'proj_' + Math.random().toString(36).substring(7),
              casterId: player.id,
              x: player.x + dx,
              y: player.y + dy,
              dx, dy
          };

          this.projectiles.push(proj);
          this.io.emit('projectileCreated', proj);
          this.io.emit('spellCast', { casterId: player.id, targetId: targetId, spell: 'skillshot' });
      });

      // Handler do Whirlwind / Exori (AoE) - atinge todos num raio de 2 SQMs
      socket.on('castAoE', (data?: { targetId?: string }) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead) return;
          this.cancelGathering(socket.id);

          // 1. Checa SP
          const spCost = 20;
          if ((player.sp || 0) < spCost) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Sem Mana!', color: '#3b82f6' });
              return;
          }

          // 2. Checa Cooldown (3000ms base, reduzido por DES)
          const des = player.stats?.DES || 5;
          const cooldownMs = Math.max(1000, 3000 - (des * 40));
          const now = Date.now();
          const lastCast = (player as any).lastWhirlwindTime || 0;
          if (now - lastCast < cooldownMs) {
              return; // Ignora se tentar burlar cooldown
          }

          // Deduz SP e atualiza tempo
          player.sp -= spCost;
          (player as any).lastWhirlwindTime = now;

          // Envia atualização de mana/vida
          socket.emit('statsUpdate', { 
              id: player.id, 
              sp: player.sp, 
              maxSp: player.maxSp,
              health: player.health,
              maxHealth: player.maxHealth
          });

          let hitCount = 0;
          this.players.forEach((target) => {
              if (target.id === player.id || target.isDead || (target as any).isNPC) return;

              const dx = Math.abs(player.x - target.x);
              const dy = Math.abs(player.y - target.y);

              if (dx <= 2 && dy <= 2) { // Raio de 2 SQMs
                  const damage = Math.floor(Math.random() * 20) + 15; // 15-35 dano
                  target.health -= damage;
                  this.cancelGathering(target.id);
                  this.io.emit('playerDamaged', { id: target.id, health: target.health, maxHealth: target.maxHealth, amount: damage });
                  this.checkDeath(player, target);
                  hitCount++;
              }
          });

          // Emite animação para o caster
          this.io.emit('spellCast', { casterId: player.id, spell: 'whirlwind' });

          // Feedback de miss se ninguém foi atingido
          if (hitCount === 0) {
              this.io.to(player.id).emit('textEffect', { x: player.x, y: player.y, message: 'Sem alvos!', color: '#888888' });
          }
      });

      // Handler de Itens Consumíveis e Equipamentos
      socket.on('useItem', (index: number) => {
          const player = this.players.get(socket.id);
          if (player && player.backpack[index]) {
              if (player.isDead) return;
              this.cancelGathering(socket.id);
              const item = player.backpack[index];
              const parsed = this.parseItem(item);
              if (!parsed) return;
              const itemName = parsed.name;
              const countStr = item.includes(':') ? item.split(':')[1] : '1';
              const count = parseInt(countStr) || 1;
              let consumed = false;

              // Validação: HP cheia para consumíveis de vida
              const hpConsumables = ['Cheese', 'Apple', 'Health Potion'];
              if (hpConsumables.includes(itemName) && player.health >= player.maxHealth) {
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Vida cheia!', color: '#22c55e' });
                  return;
              }
              // Validação: SP cheia para consumíveis de mana
              const mpConsumables = ['Mana Potion', 'Blueberry'];
              if (mpConsumables.includes(itemName) && (player.sp || 0) >= (player.maxSp || 50)) {
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Mana cheia!', color: '#3b82f6' });
                  return;
              }

              if (itemName === 'Cheese') {
                  player.health = Math.min(player.maxHealth, player.health + 20);
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Nham!', color: '#ffaa00' });
                  this.io.emit('playerDamaged', { id: player.id, health: player.health, maxHealth: player.maxHealth, amount: -20 });
                  consumed = true;
              } else if (itemName === 'Apple') {
                  player.health = Math.min(player.maxHealth, player.health + 10);
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Croc!', color: '#ffaa00' });
                  this.io.emit('playerDamaged', { id: player.id, health: player.health, maxHealth: player.maxHealth, amount: -10 });
                  consumed = true;
              } else if (itemName === 'Health Potion') {
                  player.health = Math.min(player.maxHealth, player.health + 50);
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Glup!', color: '#ef4444' });
                  this.io.emit('playerDamaged', { id: player.id, health: player.health, maxHealth: player.maxHealth, amount: -50 });
                  consumed = true;
              } else if (itemName === 'Mana Potion') {
                  const mpGain = 40;
                  player.sp = Math.min(player.maxSp || 50, (player.sp || 0) + mpGain);
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Gole!', color: '#818cf8' });
                  socket.emit('statsUpdate', { id: player.id, sp: player.sp, maxSp: player.maxSp, health: player.health, maxHealth: player.maxHealth });
                  consumed = true;
              } else if (itemName === 'Blueberry') {
                  const mpGain = 15;
                  player.sp = Math.min(player.maxSp || 50, (player.sp || 0) + mpGain);
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Mmm!', color: '#a78bfa' });
                  socket.emit('statsUpdate', { id: player.id, sp: player.sp, maxSp: player.maxSp, health: player.health, maxHealth: player.maxHealth });
                  consumed = true;
              } else if (itemName === 'Steel Sword') {
                  if (!player.equipment) player.equipment = {};
                  
                  // Se já tiver arma, joga pra bolsa (swap) e avisa se inferior
                  if (player.equipment && player.equipment.rightHand) {
                      const currentParsed = this.parseItem(player.equipment.rightHand);
                      if (currentParsed && this.getItemPower(currentParsed.name) > this.getItemPower(itemName)) {
                          this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Item inferior ao equipado!', color: '#fbbf24' });
                      }
                      this.addItemToBackpack(player, player.equipment.rightHand);
                  }
                  if (player.equipment) player.equipment.rightHand = item;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Wood Sword') {
                  if (!player.equipment) player.equipment = {};
                  if (player.equipment && player.equipment.rightHand) {
                      const currentParsed = this.parseItem(player.equipment.rightHand);
                      if (currentParsed && this.getItemPower(currentParsed.name) > this.getItemPower(itemName)) {
                          this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Item inferior ao equipado!', color: '#fbbf24' });
                      }
                      this.addItemToBackpack(player, player.equipment.rightHand);
                  }
                  if (player.equipment) player.equipment.rightHand = item;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Torch') {
                  if (player.equipment && player.equipment.leftHand) {
                      this.addItemToBackpack(player, player.equipment.leftHand);
                  }
                  if (player.equipment) player.equipment.leftHand = item;
                  this.recalculateStats(player);
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Luz!', color: '#ffaa00' });
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Helmet') {
                  if (player.equipment && player.equipment.head) {
                      const currentParsed = this.parseItem(player.equipment.head);
                      if (currentParsed && this.getItemPower(currentParsed.name) > this.getItemPower(itemName)) {
                          this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Item inferior ao equipado!', color: '#fbbf24' });
                      }
                      this.addItemToBackpack(player, player.equipment.head);
                  }
                  if (player.equipment) player.equipment.head = item;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Armor') {
                  if (player.equipment && player.equipment.body) {
                      const currentParsed = this.parseItem(player.equipment.body);
                      if (currentParsed && this.getItemPower(currentParsed.name) > this.getItemPower(itemName)) {
                          this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Item inferior ao equipado!', color: '#fbbf24' });
                      }
                      this.addItemToBackpack(player, player.equipment.body);
                  }
                  if (player.equipment) player.equipment.body = item;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Pants') {
                  if (player.equipment && player.equipment.legs) {
                      const currentParsed = this.parseItem(player.equipment.legs);
                      if (currentParsed && this.getItemPower(currentParsed.name) > this.getItemPower(itemName)) {
                          this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Item inferior ao equipado!', color: '#fbbf24' });
                      }
                      this.addItemToBackpack(player, player.equipment.legs);
                  }
                  if (player.equipment) player.equipment.legs = item;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Leather Boots') {
                  if (player.equipment && player.equipment.boots) {
                      const currentParsed = this.parseItem(player.equipment.boots);
                      if (currentParsed && this.getItemPower(currentParsed.name) > this.getItemPower(itemName)) {
                          this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Item inferior ao equipado!', color: '#fbbf24' });
                      }
                      this.addItemToBackpack(player, player.equipment.boots);
                  }
                  if (player.equipment) player.equipment.boots = item;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Leather Backpack' || itemName === 'Wooden Backpack' || itemName === 'Iron Backpack') {
                  if (!player.equipment) player.equipment = {};
                  if (player.equipment && player.equipment.backpack) {
                      this.addItemToBackpack(player, player.equipment.backpack);
                  }
                  player.equipment.backpack = item;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Gold Coin') {
                  player.gold = (player.gold || 0) + 1;
                  socket.emit('statsUpdate', { id: player.id, level: player.level, experience: player.experience, gold: player.gold, health: player.health, maxHealth: player.maxHealth });
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: '+1 Ouro', color: '#fbbf24' });
                  consumed = true;
              }

              if (consumed) {
                  const isConsumable = ['Cheese', 'Apple', 'Health Potion', 'Mana Potion', 'Blueberry', 'Gold Coin'].includes(itemName);
                  if (isConsumable && count > 1) {
                      player.backpack[index] = `${itemName}:${count - 1}`;
                  } else {
                      player.backpack.splice(index, 1);
                  }
                  this.recalculateWeight(player);
                  this.recalculateStats(player);
                  
                  socket.emit('inventoryUpdate', player.backpack);
                  socket.emit('statsUpdate', { 
                      id: player.id, level: player.level, experience: player.experience, gold: player.gold, 
                      stats: player.stats, statPoints: player.statPoints,
                      attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
                      hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
                      sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
                      health: player.health, maxHealth: player.maxHealth
                  });
              }
          }
      });

      // Handler para Dropar Item da Mochila
      socket.on('dropItemFromBackpack', (data: { index: number, amount: number }) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead) return;
          if (!player.backpack || !player.backpack[data.index]) return;
          
          const item = player.backpack[data.index];
          const parsed = this.parseItem(item);
          if (!parsed) return;
          const itemName = parsed.name;
          
          // Mochilas não podem ser dropadas
          const noDropItems = ['Leather Backpack', 'Wooden Backpack', 'Iron Backpack'];
          if (noDropItems.includes(itemName)) {
              this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Não pode dropar!', color: '#ff5555' });
              return;
          }
          
          let amount = Math.max(1, Math.floor(data.amount));
          
          // Verifica se é item empilhado
          if (item.includes(':')) {
              const [name, countStr] = item.split(':');
              const count = parseInt(countStr) || 1;
              amount = Math.min(amount, count);
              
              if (amount >= count) {
                  player.backpack.splice(data.index, 1);
              } else {
                  player.backpack[data.index] = `${name}:${count - amount}`;
              }
              
              // Cria itens no chão (para stacks, cria um item com o nome base)
              for (let i = 0; i < amount; i++) {
                  const dropId = `drop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}_${i}`;
                  const dropItem = { id: dropId, name: itemName, x: player.x, y: player.y, emoji: ITEM_EMOJIS[itemName] || '📦' };
                  this.itemsOnFloor.set(dropId, dropItem);
                  this.io.emit('itemDropped', dropItem);
              }
          } else if (item.startsWith('{')) {
              // Item JSON (equipamento com stats) — dropa inteiro
              player.backpack.splice(data.index, 1);
              const dropId = `drop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              const dropItem = { id: dropId, name: itemName, x: player.x, y: player.y, emoji: ITEM_EMOJIS[itemName] || '📦' };
              this.itemsOnFloor.set(dropId, dropItem);
              this.io.emit('itemDropped', dropItem);
          } else {
              // Item simples sem stack
              player.backpack.splice(data.index, 1);
              const dropId = `drop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              const dropItem = { id: dropId, name: itemName, x: player.x, y: player.y, emoji: ITEM_EMOJIS[itemName] || '📦' };
              this.itemsOnFloor.set(dropId, dropItem);
              this.io.emit('itemDropped', dropItem);
          }
          
          this.recalculateWeight(player);
          this.recalculateStats(player);
          socket.emit('inventoryUpdate', player.backpack);
          socket.emit('statsUpdate', {
              id: player.id, level: player.level, experience: player.experience, gold: player.gold,
              stats: player.stats, statPoints: player.statPoints,
              attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
              hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
              sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
              health: player.health, maxHealth: player.maxHealth
          });
          this.io.emit('textEffect', { x: player.x, y: player.y, message: `Dropou ${itemName}!`, color: '#fbbf24' });
      });

      // Loja: Comprar Item
      socket.on('buyItem', (itemName: string) => {
          const player = this.players.get(socket.id);
          const merchant = this.players.get('npc_merchant');
          
          if (!player || !merchant) return;
          if (!player.backpack) player.backpack = [];
          if (!player.gold) player.gold = 0;
          
          // Checa distância
          const dist = Math.abs(player.x - merchant.x) + Math.abs(player.y - merchant.y);
          if (dist > 2) return;
          
          // Preços
          const prices: Record<string, number> = {
              'Torch': 5, 'Health Potion': 15, 'Mana Potion': 20, 'Steel Sword': 100,
              'Leather Backpack': 500, 'Wooden Backpack': 1500, 'Iron Backpack': 4000
          };
          const cost = prices[itemName];
          
          if (cost && player.gold >= cost) {
              const itemWeight = ITEM_WEIGHTS[itemName] || 5;
              if (player.weight + itemWeight > (player.maxWeight || 250)) {
                  socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito Pesado!', color: '#ff5555' });
                  return;
              }

              const added = this.addItemToBackpack(player, itemName);
              if (added) {
                  player.gold -= cost;
                  this.recalculateWeight(player);
                  this.recalculateStats(player);
                  socket.emit('statsUpdate', { 
                      id: player.id, level: player.level, experience: player.experience, gold: player.gold,
                      stats: player.stats, statPoints: player.statPoints,
                      attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
                      hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
                      sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
                      health: player.health, maxHealth: player.maxHealth
                  });
                  socket.emit('inventoryUpdate', player.backpack);
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Comprado!', color: '#00ff00' });
              } else {
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Mochila Cheia!', color: '#ff0000' });
              }
          } else {
              this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Falhou', color: '#ff0000' });
          }
      });
      
      // Loja: Vender Item
      socket.on('sellItem', (invIndex: number) => {
          const player = this.players.get(socket.id);
          const merchant = this.players.get('npc_merchant');
          
          if (!player || !merchant || !player.backpack) return;
          
          const dist = Math.abs(player.x - merchant.x) + Math.abs(player.y - merchant.y);
          if (dist > 2) return;
          
          const itemString = player.backpack[invIndex];
          if (!itemString) return;
          
          let baseName = itemString.startsWith('{') ? JSON.parse(itemString).name : itemString.split(':')[0];
          if (baseName === 'Leather Backpack' || baseName === 'Wooden Backpack' || baseName === 'Iron Backpack') {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Não pode ser vendido!', color: '#ff5555' });
              return;
          }
          
          const [itemName, countStr] = itemString.split(':');
          const count = parseInt(countStr) || 1;
          
          const sellPrices: Record<string, number> = { 'Cheese': 2, 'Apple': 3, 'Steel Sword': 25, 'Mana Potion': 5, 'Blueberry': 1 };
          const sellValue = sellPrices[itemName] || 1;
          
          if (count > 1) {
              player.backpack[invIndex] = `${itemName}:${count - 1}`;
          } else {
              player.backpack.splice(invIndex, 1);
          }
          
          player.gold = (player.gold || 0) + sellValue;
          this.recalculateWeight(player);
          this.recalculateStats(player);
          
          socket.emit('statsUpdate', { 
              id: player.id, level: player.level, experience: player.experience, gold: player.gold,
              stats: player.stats, statPoints: player.statPoints,
              attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
              hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
              sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
              health: player.health, maxHealth: player.maxHealth
          });
          socket.emit('inventoryUpdate', player.backpack);
          this.io.emit('textEffect', { x: player.x, y: player.y, message: `+${sellValue} Ouro`, color: '#fbbf24' });
      });

      // Desequipar Item
      socket.on('unequipItem', (slot: string) => {
          const player = this.players.get(socket.id);
          if (!player || !player.equipment || !player.backpack) return;
          
          const validSlots = ['head', 'body', 'legs', 'boots', 'leftHand', 'rightHand', 'backpack'] as const;
          type EquipSlot = typeof validSlots[number];
          
          if (validSlots.includes(slot as EquipSlot)) {
              const item = player.equipment[slot as EquipSlot];
              if (item) {
                  const added = this.addItemToBackpack(player, item);
                  if (added) {
                      player.equipment[slot as EquipSlot] = undefined;
                      this.recalculateWeight(player);
                      this.recalculateStats(player);
                      
                      socket.emit('equipmentUpdate', player.equipment);
                      socket.emit('inventoryUpdate', player.backpack);
                      socket.emit('statsUpdate', { 
                          id: player.id, level: player.level, experience: player.experience, gold: player.gold, 
                          stats: player.stats, statPoints: player.statPoints,
                          attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
                          hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
                          sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
                          health: player.health, maxHealth: player.maxHealth
                      });
                  } else {
                      socket.emit('textEffect', { x: player.x, y: player.y, message: 'Mochila Cheia!', color: '#ff5555' });
                  }
              }
          }
      });

      socket.on('respawn', () => {
          const player = this.players.get(socket.id);
          if (player && player.isDead) {
              player.isDead = false;
              player.health = player.maxHealth;
              player.x = 10;
              player.y = 10;
              player.targetId = undefined;
              
              // Notifica todos que o jogador renasceu e se moveu
              this.io.emit('playerMoved', player);
              
              // Atualiza o HUD do jogador local
              socket.emit('statsUpdate', { id: player.id, health: player.health, maxHealth: player.maxHealth });
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'RENASCIDO!', color: '#00ff00' });
          }
      });

      // Hotkey: usar consumível do tipo especificado (Q = vida, E = mana)
      socket.on('useConsumable', (type: 'hp' | 'mp') => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead || !player.backpack) return;
          this.cancelGathering(socket.id);
          
          // Mapeia tipo pra lista de consumíveis em ordem de prioridade
          const hpItems = ['Health Potion', 'Cheese', 'Apple'];
          const mpItems = ['Mana Potion', 'Blueberry'];
          const candidates = type === 'hp' ? hpItems : mpItems;

          let usedIndex = -1;
          let usedItemName = '';

          for (const candidateName of candidates) {
              const idx = player.backpack.findIndex(slot => {
                  const [name] = slot.split(':');
                  return name === candidateName;
              });
              if (idx !== -1) { usedIndex = idx; usedItemName = candidateName; break; }
          }

          if (usedIndex === -1) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: type === 'hp' ? 'Sem Itens de Vida!' : 'Sem Itens de Mana!', color: '#ff5555' });
              return;
          }

          const slotStr = player.backpack[usedIndex];
          const [itemName, countStr] = slotStr.split(':');
          const count = parseInt(countStr) || 1;

          let restoreAmt = 0;
          let restoreMsg = '';
          let restoreColor = '#00ff88';

          if (type === 'hp') {
              if (itemName === 'Health Potion') { restoreAmt = 50; restoreMsg = 'Gulp!'; restoreColor = '#ef4444'; }
              else if (itemName === 'Cheese')   { restoreAmt = 20; restoreMsg = 'Munch!'; restoreColor = '#fbbf24'; }
              else if (itemName === 'Apple')    { restoreAmt = 10; restoreMsg = 'Crunch!'; restoreColor = '#ff6347'; }

              if (restoreAmt > 0) {
                  player.health = Math.min(player.maxHealth, player.health + restoreAmt);
                  this.io.emit('playerDamaged', { id: player.id, health: player.health, maxHealth: player.maxHealth, amount: -restoreAmt });
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: restoreMsg, color: restoreColor });
              }
          } else {
              if (itemName === 'Mana Potion') { restoreAmt = 40; restoreMsg = 'Sip!'; restoreColor = '#818cf8'; }
              else if (itemName === 'Blueberry') { restoreAmt = 15; restoreMsg = 'Mmm!'; restoreColor = '#a78bfa'; }

              if (restoreAmt > 0) {
                  player.sp = Math.min(player.maxSp || 50, (player.sp || 0) + restoreAmt);
                  socket.emit('statsUpdate', { id: player.id, sp: player.sp, maxSp: player.maxSp, health: player.health, maxHealth: player.maxHealth });
                  this.io.emit('textEffect', { x: player.x, y: player.y, message: restoreMsg, color: restoreColor });
              }
          }

          if (restoreAmt > 0) {
              if (count > 1) {
                  player.backpack[usedIndex] = `${itemName}:${count - 1}`;
              } else {
                  player.backpack.splice(usedIndex, 1);
              }
              socket.emit('inventoryUpdate', player.backpack);
          }
      });

      socket.on('saveUiPositions', (uiPositions: Record<string, { x: number, y: number }>) => {
          const player = this.players.get(socket.id);
          if (player) {
              player.uiPositions = uiPositions;
          }
      });

      // --- SISTEMA DE CRAFTING E LEILÕES ---
      
      // 1. Criar Item (Craft)
      socket.on('craftItem', (data: { recipeId: string }) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead) return;
          
          const recipe = CRAFTING_RECIPES.find(r => r.id === data.recipeId);
          if (!recipe) return;
          
          // Valida proximidade da estação (2 tiles)
          let nearStation = false;
          for (const station of this.craftingStations.values()) {
              if (station.type === recipe.stationType) {
                  const dist = Math.abs(player.x - station.x) + Math.abs(player.y - station.y);
                  if (dist <= 2) { nearStation = true; break; }
              }
          }
          
          if (!nearStation) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito longe da bancada!', color: '#ff5555' });
              return;
          }
          
          // Valida nível requerido
          let playerProfLvl = 1;
          let xpField: 'professionSmithingXp' | 'professionAlchemyXp' | 'professionTanningXp' = 'professionSmithingXp';
          let lvlField: 'professionSmithingLevel' | 'professionAlchemyLevel' | 'professionTanningLevel' = 'professionSmithingLevel';
          
          if (recipe.profession === 'smithing') {
              playerProfLvl = player.professionSmithingLevel ?? 1;
              xpField = 'professionSmithingXp';
              lvlField = 'professionSmithingLevel';
          } else if (recipe.profession === 'alchemy') {
              playerProfLvl = player.professionAlchemyLevel ?? 1;
              xpField = 'professionAlchemyXp';
              lvlField = 'professionAlchemyLevel';
          } else if (recipe.profession === 'tanning') {
              playerProfLvl = player.professionTanningLevel ?? 1;
              xpField = 'professionTanningXp';
              lvlField = 'professionTanningLevel';
          }
          
          if (playerProfLvl < recipe.levelRequired) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Nível muito baixo!', color: '#ff5555' });
              return;
          }

          // Valida aprendizado (se level >= 2)
          if (recipe.levelRequired >= 2) {
              const isLearned = player.learnedRecipes && player.learnedRecipes.includes(recipe.id);
              if (!isLearned) {
                  socket.emit('textEffect', { x: player.x, y: player.y, message: 'Receita não aprendida!', color: '#ff5555' });
                  return;
              }
          }
          
          // Valida ingredientes
          let hasIngredients = true;
          recipe.ingredients.forEach(ing => {
              if (this.countItemInBackpack(player, ing.itemName) < ing.count) {
                  hasIngredients = false;
              }
          });
          
          if (!hasIngredients) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Materiais ausentes!', color: '#ff5555' });
              return;
          }
          
          // Remove ingredientes
          recipe.ingredients.forEach(ing => {
              this.removeItemFromBackpack(player, ing.itemName, ing.count);
          });
          
          // Sucesso rate:
          const levelDiff = playerProfLvl - recipe.levelRequired;
          const successChance = Math.min(100, 85 + levelDiff * 5);
          const isSuccess = (Math.random() * 100) <= successChance;
          
          if (isSuccess) {
              // RNG Rolagem de Qualidade
              const luck = player.stats?.SOR || 5;
              const rareChance = 5 + (luck / 2);
              const epicChance = 1 + (luck / 5);
              const roll = Math.random() * 100;
              
              let quality: 'comum' | 'raro' | 'epico' = 'comum';
              let extraStats: any = {};
              
              if (roll <= epicChance) {
                  quality = 'epico';
                  // Bônus Épico (+3 a +6)
                  const statsPool = ['FOR', 'AGI', 'VIT', 'INT', 'DES', 'SOR'];
                  const chosenStat = statsPool[Math.floor(Math.random() * statsPool.length)];
                  extraStats[chosenStat] = Math.floor(Math.random() * 4) + 3; // 3-6
              } else if (roll <= epicChance + rareChance) {
                  quality = 'raro';
                  // Bônus Raro (+1 a +3)
                  const statsPool = ['FOR', 'AGI', 'VIT', 'INT', 'DES', 'SOR'];
                  const chosenStat = statsPool[Math.floor(Math.random() * statsPool.length)];
                  extraStats[chosenStat] = Math.floor(Math.random() * 3) + 1; // 1-3
              }
              
              // Criação do item com durabilidade inicial 100
              const isEquipable = ['Steel Sword', 'Wood Sword', 'Helmet', 'Armor', 'Pants', 'Leather Boots', 'Torch'].includes(recipe.resultItem);
              let itemToAdd: string;
              if (isEquipable) {
                  const itemDataObj = {
                      name: recipe.resultItem,
                      quality,
                      stats: extraStats,
                      durability: 100,
                      maxDurability: 100
                  };
                  itemToAdd = JSON.stringify(itemDataObj);
              } else {
                  itemToAdd = recipe.resultItem;
              }
              
              this.addItemToBackpack(player, itemToAdd);
              
              // Concede XP da profissão
              const xpGain = recipe.levelRequired * 25;
              let newXp = (player[xpField] || 0) + xpGain;
              let newLvl = player[lvlField] || 1;
              const nextLvlReq = newLvl * 100;
              
              if (newXp >= nextLvlReq) {
                  newXp -= nextLvlReq;
                  newLvl++;
                  socket.emit('textEffect', { x: player.x, y: player.y, message: `Nível de Profissão Subiu!`, color: '#fbbf24' });
              }
              
              player[xpField] = newXp;
              player[lvlField] = newLvl;
              
              this.recalculateWeight(player);
              
              // Avisa os clientes próximos para desenharem partículas
              this.io.emit('craftEffect', {
                  x: player.x,
                  y: player.y,
                  stationType: recipe.stationType,
                  itemName: recipe.resultItem,
                  quality
              });
              
              if (quality === 'epico') {
                  // Mensagem Global para item Épico
                  const displayItem = ITEM_NAMES_PT[recipe.resultItem] || recipe.resultItem;
                  this.io.emit('playerSpoke', { id: player.id, message: `Forjei um item ÉPICO: ${displayItem}! 🔥` });
              }
              
              socket.emit('inventoryUpdate', player.backpack);
              socket.emit('statsUpdate', {
                  id: player.id,
                  weight: player.weight,
                  maxWeight: player.maxWeight,
                  [xpField]: player[xpField],
                  [lvlField]: player[lvlField]
              });
          } else {
              // Falha: materiais consumidos
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Criação Falhou! Materiais perdidos', color: '#ef4444' });
              socket.emit('inventoryUpdate', player.backpack);
          }
      });
      
      // 2. Desmontar Item (Salvage)
      socket.on('salvageItem', (recipeId: string) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead || !player.backpack) return;
          
          const recipe = CRAFTING_RECIPES.find(r => r.id === recipeId);
          if (!recipe) return;
          
          // Procura o item na mochila
          const idx = player.backpack.findIndex(slot => {
              const parsed = this.parseItem(slot);
              return parsed && parsed.name === recipe.resultItem;
          });
          
          if (idx === -1) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Item não encontrado!', color: '#ff5555' });
              return;
          }
          
          const itemSlotStr = player.backpack[idx];
          player.backpack.splice(idx, 1);
          
          const [_, countStr] = itemSlotStr.split(':');
          const count = parseInt(countStr) || 1;
          
          // Reembolsa 20-50% dos materiais de volta, vezes a quantidade na pilha
          const refunded: string[] = [];
          recipe.ingredients.forEach(ing => {
              const pct = 0.2 + Math.random() * 0.3; // 20% a 50%
              const baseQty = Math.max(1, Math.floor(ing.count * pct));
              const qty = baseQty * count;
              for (let i = 0; i < qty; i++) {
                  this.addItemToBackpack(player, ing.itemName);
              }
              const namePt = ITEM_NAMES_PT[ing.itemName] || ing.itemName;
              refunded.push(`${qty}x ${namePt}`);
          });
          
          this.recalculateWeight(player);
          this.recalculateStats(player);
          
          socket.emit('inventoryUpdate', player.backpack);
          socket.emit('statsUpdate', { 
              id: player.id, 
              weight: player.weight, 
              maxWeight: player.maxWeight 
          });
          socket.emit('textEffect', { x: player.x, y: player.y, message: 'Desmantelado!', color: '#3b82f6' });
          const displayResult = ITEM_NAMES_PT[recipe.resultItem] || recipe.resultItem;
          socket.emit('playerSpoke', { id: player.id, message: `Desmontei ${displayResult} e recuperei ${refunded.join(', ')}!` });
      });

      // 3. Consertar Equipamentos (Repair All)
      socket.on('repairAllItems', () => {
          const player = this.players.get(socket.id);
          const merchant = this.players.get('npc_merchant');
          if (!player || !merchant) return;
          
          const dist = Math.abs(player.x - merchant.x) + Math.abs(player.y - merchant.y);
          if (dist > 2) return;
          
          let totalCost = 0;
          const slots = ['head', 'body', 'legs', 'boots', 'rightHand', 'leftHand'] as const;
          const itemsToRepair: { slot: typeof slots[number], parsed: any }[] = [];
          
          slots.forEach(slot => {
              const eqStr = player.equipment?.[slot];
              if (!eqStr) return;
              const parsed = this.parseItem(eqStr);
              if (parsed && parsed.durability !== undefined && parsed.maxDurability !== undefined) {
                  const diff = parsed.maxDurability - parsed.durability;
                  if (diff > 0) {
                      totalCost += diff;
                      itemsToRepair.push({ slot, parsed });
                  }
              }
          });
          
          if (totalCost === 0) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Todos os itens reparados!', color: '#00ff00' });
              return;
          }
          
          if ((player.gold || 0) >= totalCost) {
              player.gold = (player.gold || 0) - totalCost;
              itemsToRepair.forEach(({ slot, parsed }) => {
                  parsed.durability = parsed.maxDurability;
                  player.equipment![slot] = JSON.stringify(parsed);
              });
              
              this.recalculateStats(player);
              socket.emit('statsUpdate', { 
                  id: player.id, 
                  gold: player.gold,
                  def: player.def,
                  mdef: player.mdef,
                  attack: player.attack,
                  health: player.health,
                  maxHealth: player.maxHealth
              });
              socket.emit('equipmentUpdate', player.equipment);
              socket.emit('textEffect', { x: player.x, y: player.y, message: `Reparado! -${totalCost} Ouro`, color: '#00ff00' });
          } else {
              socket.emit('textEffect', { x: player.x, y: player.y, message: `Necessita de ${totalCost} Ouro!`, color: '#ff5555' });
          }
      });

      // 4. Anunciar no Leilão
      socket.on('createAuction', (data: { backpackIndex: number, price: number }) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead || !player.backpack) return;
          
          const index = data.backpackIndex;
          const price = Math.floor(data.price);
          if (price <= 0) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Preço Inválido!', color: '#ff5555' });
              return;
          }
          
          const itemStr = player.backpack[index];
          if (!itemStr) return;
          
          let baseName = itemStr.startsWith('{') ? JSON.parse(itemStr).name : itemStr.split(':')[0];
          if (baseName === 'Leather Backpack' || baseName === 'Wooden Backpack' || baseName === 'Iron Backpack') {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Item não negociável!', color: '#ff5555' });
              return;
          }
          
          player.backpack.splice(index, 1);
          this.recalculateWeight(player);
          
          createAuctionInDB(player.name, itemStr, price).then(() => {
              socket.emit('inventoryUpdate', player.backpack);
              socket.emit('statsUpdate', { id: player.id, weight: player.weight, maxWeight: player.maxWeight });
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Listado!', color: '#00ff00' });
              this.broadcastAuctions();
          }).catch(err => {
              console.error(err);
              player.backpack.push(itemStr);
              socket.emit('inventoryUpdate', player.backpack);
          });
      });

      // 5. Comprar do Leilão
      socket.on('buyAuction', (auctionId: number) => {
          const buyer = this.players.get(socket.id);
          if (!buyer || buyer.isDead || !buyer.backpack) return;
          
          getAuctionByIdFromDB(auctionId).then((auc) => {
              if (!auc) {
                  socket.emit('textEffect', { x: buyer.x, y: buyer.y, message: 'Não encontrado!', color: '#ff5555' });
                  return;
              }
              
              if ((buyer.gold || 0) < auc.price) {
                  socket.emit('textEffect', { x: buyer.x, y: buyer.y, message: 'Sem Ouro!', color: '#ff5555' });
                  return;
              }
              
              const itemStr = typeof auc.itemData === 'string' ? auc.itemData : JSON.stringify(auc.itemData);
              const parsedItem = this.parseItem(itemStr)!;
              const weight = ITEM_WEIGHTS[parsedItem.name] || 5;
              if (buyer.weight + weight > (buyer.maxWeight || 250)) {
                  socket.emit('textEffect', { x: buyer.x, y: buyer.y, message: 'Muito Pesado!', color: '#ff5555' });
                  return;
              }
              
              buyer.gold = (buyer.gold || 0) - auc.price;
              buyer.backpack.push(itemStr);
              this.recalculateWeight(buyer);
              this.recalculateStats(buyer);
              
              removeAuctionFromDB(auctionId).then(() => {
                  let sellerPlayer: PlayerData | null = null;
                  for (const p of this.players.values()) {
                      if (p.name === auc.sellerName) {
                          sellerPlayer = p;
                          break;
                      }
                  }
                  
                  if (sellerPlayer) {
                      sellerPlayer.gold = (sellerPlayer.gold || 0) + auc.price;
                      const sellerSocket = this.io.sockets.sockets.get(sellerPlayer.id);
                      if (sellerSocket) {
                          sellerSocket.emit('statsUpdate', { id: sellerPlayer.id, gold: sellerPlayer.gold });
                          sellerSocket.emit('textEffect', { x: sellerPlayer.x, y: sellerPlayer.y, message: `Vendido! +${auc.price} Ouro`, color: '#00ff00' });
                      }
                  } else {
                      incrementGoldOffline(auc.sellerName, auc.price).catch(console.error);
                  }
                  
                  socket.emit('statsUpdate', { 
                      id: buyer.id, 
                      gold: buyer.gold, 
                      weight: buyer.weight, 
                      maxWeight: buyer.maxWeight 
                  });
                  socket.emit('inventoryUpdate', buyer.backpack);
                  socket.emit('textEffect', { x: buyer.x, y: buyer.y, message: 'Comprado!', color: '#00ff00' });
                  
                  this.broadcastAuctions();
              }).catch(err => {
                  console.error(err);
              });
          }).catch(err => {
              console.error(err);
          });
      });

      // 6. Listar Leilões
      socket.on('getAuctions', () => {
          getAuctionsFromDB().then((list) => {
              socket.emit('auctionList', list);
          }).catch(console.error);
      });

      socket.on('disconnect', async () => {
        this.cancelGathering(socket.id);
        if ((socket as any).sessionTransferred) {
            return; // Sessão transferida, não salva para evitar race condition
        }
        console.log(`Aventureiro desconectado: ${socket.id}`);
        const p = this.players.get(socket.id);
        if (p && !p.isMonster) {
            try {
                await savePlayerToDB(p); // Salva o progresso no Banco
            } catch (e) {
                console.error(`Erro ao salvar DB do disconnect:`, e);
            }
        }
        this.players.delete(socket.id);
        this.io.emit('playerLeft', socket.id);
      });
    });
  }

  public start() {
    console.log('Game Loop iniciado (20 Ticks/s)');
    setInterval(() => {
      this.tick();
    }, this.tickRate);
  }

  private tick() {
    const now = Date.now();
    const dt = now - this.lastUpdate;
    this.lastUpdate = now;
    this.ticks++;

    // Respawn dos nós de recursos esgotados a cada 20 ticks (1 segundo)
    if (this.ticks % 20 === 0) {
        const nowMs = Date.now();
        this.resourceNodes.forEach(node => {
            if (node.state === 'depleted' && node.respawnTime && nowMs >= node.respawnTime) {
                node.state = 'rich';
                node.charges = node.maxCharges;
                node.respawnTime = undefined;
                this.io.emit('resourceNodeUpdated', node);
            }
        });
    }

    // Atualiza a rede 20 vezes por segundo
    this.io.emit('update', Array.from(this.players.values()));

    // Autosave a cada 60 segundos (1200 ticks)
    if (this.ticks % 1200 === 0) {
        this.players.forEach(p => {
            if (!p.isMonster) {
                savePlayerToDB(p).catch(e => console.error('Autosave erro:', e));
            }
        });
    }

    // Sistema de Ciclo de Dia e Noite (5 min dia = 6000 ticks, 2 min noite = 2400 ticks. Total = 8400)
    const cycle = this.ticks % 8400;
    
    if (cycle === 0) {
        this.isNight = false;
        this.io.emit('timeUpdate', { isNight: this.isNight });
        const msg = 'O sol nasce. Você está seguro por enquanto.';
        this.players.forEach(p => { 
            if (!p.isMonster) {
                this.io.emit('textEffect', { x: p.x, y: p.y, message: msg, color: '#ffff00' }); 
            } else if (p.id.startsWith('night_')) {
                // Remove monstros da noite
                if (!p.isDead) {
                    p.isDead = true;
                    // Se for o Boss e estiver vivo de dia, morre e vira caveira normal
                    if (p.id === 'night_boss') {
                        this.io.emit('playerDamaged', { id: p.id, health: 0, maxHealth: p.maxHealth, amount: 9999 });
                        const dropId = `item_${Math.random().toString(36).substring(2, 9)}`;
                        const dropItem = { id: dropId, name: 'Skull', x: p.x, y: p.y, emoji: '💀' };
                        this.itemsOnFloor.set(dropId, dropItem);
                        this.io.emit('itemDropped', dropItem);
                    }
                    this.io.emit('playerLeft', p.id);
                }
                this.players.delete(p.id);
            }
        });
    } else if (cycle === 6000) {
        this.isNight = true;
        this.io.emit('timeUpdate', { isNight: this.isNight });
        const msg = 'O sol se põe. Os monstros ficam mais fortes...';
        this.players.forEach(p => { if (!p.isMonster) this.io.emit('textEffect', { x: p.x, y: p.y, message: msg, color: '#aa00ff' }); });
        
        // Spawn Night Boss e Duplica Monstros
        const baseMonsters: PlayerData[] = [];
        this.players.forEach(p => {
            if (p.isMonster && !p.id.startsWith('night_') && !p.isDead) {
                baseMonsters.push(p);
            }
        });

        baseMonsters.forEach((m, idx) => {
            const clone: PlayerData = {
                ...m,
                id: `night_clone_${m.name}_${idx}_${Date.now()}`,
                health: m.maxHealth,
                targetId: undefined
            };
            this.players.set(clone.id, clone);
            this.io.emit('newPlayer', clone);
        });

        // Spawn Boss (Aleatório no mapa mas fora da cidade)
        const bossX = Math.floor(Math.random() * 30) + 5;
        const bossY = Math.floor(Math.random() * 30) + 5;
        const boss: PlayerData = {
            id: 'night_boss',
            name: 'Nightmare Skeleton',
            x: bossX,
            y: bossY,
            health: 1200, // 3x Demon Skeleton
            maxHealth: 1200,
            speed: 150,
            isMonster: true,
            level: 30,
            experience: 0,
            attack: 90 // 2x Demon Skeleton
        };
        this.players.set(boss.id, boss);
        this.io.emit('newPlayer', boss);
    }

    // Inteligência Artificial do Monstro (Mover a cada 10 ticks = ~0.5 segundos)
    if (this.ticks % 10 === 0) {
      this.players.forEach((entity) => {
          if (entity.isMonster && !entity.isDead) {
              // Verifica se tem algum jogador por perto (Aggro Range = 5)
              let closestPlayer: PlayerData | null = null;
              let minDistance = 6;

              if (entity.name === 'Nightmare Skeleton' && !entity.targetId) {
                  // Boss passivo: não procura ninguém até ser atacado
              } else {
                  this.players.forEach((p) => {
                      if (!p.isMonster) {
                          const dist = Math.abs(p.x - entity.x) + Math.abs(p.y - entity.y); // Manhattan
                          if (dist < minDistance) {
                              minDistance = dist;
                              closestPlayer = p;
                          }
                      }
                  });
              }

              let targetX = entity.x;
              let targetY = entity.y;

              if (closestPlayer) {
                  const dx = Math.abs(closestPlayer.x - entity.x);
                  const dy = Math.abs(closestPlayer.y - entity.y);

                  // Só se move se não estiver adjacente (distância > 1)
                  if (dx > 1 || dy > 1) {
                      // Chase (Perseguir o jogador mais próximo)
                      if (closestPlayer.x > entity.x) targetX++;
                      else if (closestPlayer.x < entity.x) targetX--;
                      else if (closestPlayer.y > entity.y) targetY++;
                      else if (closestPlayer.y < entity.y) targetY--;
                  }
                  
                  entity.targetId = closestPlayer.id;
              } else {
                  entity.targetId = undefined;
                  // Random Wander (Andar aleatoriamente)
                  const directions = [
                      { x: 0, y: -1 }, { x: 0, y: 1 }, 
                      { x: -1, y: 0 }, { x: 1, y: 0 }
                  ];
                  const move = directions[Math.floor(Math.random() * directions.length)];
                  targetX = entity.x + move.x;
                  targetY = entity.y + move.y;
              }
              
              // Verifica colisão
              if (!this.walls.has(`${targetX},${targetY}`)) {
                  entity.x = targetX;
                  entity.y = targetY;
                  this.io.emit('playerMoved', entity);
              }
             }
      });
    }

    // Regeneração Passiva do Jogador a cada 2 segundos (40 ticks)
    if (this.ticks % 40 === 0) {
        this.players.forEach((entity) => {
            if (!entity.isMonster && !entity.isDead && !(entity as any).isNPC) {
                let updated = false;

                // Regenera HP
                if (entity.health < entity.maxHealth) {
                    const vit = entity.stats?.VIT || 5;
                    const regen = 2 + Math.floor(vit / 5);
                    entity.health = Math.min(entity.maxHealth, entity.health + regen);
                    this.io.emit('playerDamaged', { id: entity.id, health: entity.health, maxHealth: entity.maxHealth, amount: -regen });
                    updated = true;
                }

                // Regenera SP (Mana)
                const maxSp = entity.maxSp || 50;
                if ((entity.sp || 0) < maxSp) {
                    const intVal = entity.stats?.INT || 5;
                    const regenSp = 1 + Math.floor(intVal / 5);
                    entity.sp = Math.min(maxSp, (entity.sp || 0) + regenSp);
                    updated = true;
                }

                if (updated) {
                    const socket = this.io.sockets.sockets.get(entity.id);
                    if (socket) {
                        socket.emit('statsUpdate', {
                            id: entity.id,
                            sp: entity.sp,
                            maxSp: entity.maxSp,
                            health: entity.health,
                            maxHealth: entity.maxHealth
                        });
                    }
                }
            }
        });
    }

    // Processamento de Projéteis (Andam a cada 2 ticks = ~10 vezes por seg)
    if (this.ticks % 2 === 0) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.x += p.dx;
            p.y += p.dy;
            
            let hit = false;
            
            // Colisão com parede
            if (this.walls.has(`${p.x},${p.y}`) || p.x < 0 || p.x > 40 || p.y < 0 || p.y > 40) {
                hit = true;
            } else {
                // Colisão com entidades (monstros ou players)
                for (const [id, entity] of this.players.entries()) {
                    if (entity.id !== p.casterId && entity.x === p.x && entity.y === p.y && !entity.isDead) {
                        // Safe zone check para projeteis
                        const casterPlayer = this.players.get(p.casterId);
                        if (!entity.isMonster && casterPlayer && !casterPlayer.isMonster) {
                            if (entity.x >= 100 && entity.y >= 100) continue;
                        }

                        // Acertou
                        hit = true;
                        const damage = 25;
                        entity.health -= damage;
                        this.cancelGathering(entity.id);
                        this.io.emit('playerDamaged', { id: entity.id, health: entity.health, maxHealth: entity.maxHealth, amount: damage, attackerId: p.casterId });
                        if (!entity.isMonster) {
                            this.reduceArmorDurability(entity);
                        }
                        
                        if (casterPlayer) this.checkDeath(casterPlayer, entity);
                        break; // Só acerta 1
                    }
                }
            }

            if (hit) {
                this.io.emit('projectileDestroyed', p.id);
                this.projectiles.splice(i, 1);
            } else {
                this.io.emit('projectileMoved', p);
            }
        }
    }

    // Sistema de Auto-Attack (Meelee) - Executado todo Tick, mas limitado pelo ASPD interno
    if (this.ticks % 1 === 0) {
       this.players.forEach((player) => {
          if (player.targetId && !player.isDead && !(player as any).isNPC) {
             const target = this.players.get(player.targetId);
             if (target && !target.isDead && !(target as any).isNPC) {
                // Checa distância (Meelee = 1 SQM ortogonal ou diagonal)
                const dx = Math.abs(player.x - target.x);
                const dy = Math.abs(player.y - target.y);
                
                if (dx <= 1 && dy <= 1) {
                   const now = Date.now();
                   const lastAttack = (player as any).lastAttackTime || 0;
                   const cooldown = player.aspd || (player.isMonster ? (player.name === 'Orc' ? 2000 : 1500) : 1500);
                   
                   if (now - lastAttack >= cooldown) {
                      // Safe zone check PvP
                      if (!player.isMonster && !target.isMonster) {
                          if ((player.x >= 100 && player.y >= 100) || (target.x >= 100 && target.y >= 100)) {
                              player.targetId = undefined; // Para de atacar
                              return; // Cancela hit no forEach
                          }
                      }

                      (player as any).lastAttackTime = now;
                      
                      // Causa dano
                      let damage = 0;
                      if (player.isMonster) {
                          // Fórmula de Ataque de Monstro Básica com variação de ±20%
                          const baseAtk = player.attack || 5;
                          damage = Math.floor(baseAtk * 0.8) + Math.floor(Math.random() * (baseAtk * 0.4));
                      } else {
                          // Fórmula de Ataque Físico: (Poder Base da Arma) + (FOR * 2) + Math.floor(SOR / 3)
                          // Como o player.attack já guarda o base da arma ou 5 se desarmado:
                          damage = player.attack || 5;
                          this.reduceWeaponDurability(player);
                      }
                      
                      target.health -= damage;
                      this.cancelGathering(target.id);

                      // Avisa que tomou dano com a quantidade para o Hit Splat
                      this.io.emit('playerDamaged', { id: target.id, health: target.health, maxHealth: target.maxHealth, amount: damage, attackerId: player.id });
                      if (!target.isMonster) {
                          this.reduceArmorDurability(target);
                      }

                      this.checkDeath(player, target);
                   }
                }
             } else {
                // Target sumiu/desconectou
                player.targetId = undefined;
             }
          }
       });
       
       // Sincroniza o relógio a cada 1 segundo (20 ticks)
       if (this.ticks % 20 === 0) {
           const cycle = this.ticks % 8400;
           const isNight = cycle >= 6000;
           const ticksInPhase = isNight ? (cycle - 6000) : cycle;
           const phaseDuration = isNight ? 2400 : 6000;
           const secondsLeft = Math.floor((phaseDuration - ticksInPhase) / 20);
           this.io.emit('timeSync', { isNight, secondsLeft });
       }
    }
  }
  private checkDeath(attacker: PlayerData, target: PlayerData) {
     if (target.health <= 0 && !target.isDead) {
        target.isDead = true;
        
        // Lógica de Respawn e Loot
        if (target.isMonster) {
            // Da Experiencia dependendo do monstro
            let expReward = 50;
            if (target.name === 'Orc') expReward = 150;
            else if (target.name === 'Rotworm') expReward = 250;
            else if (target.name === 'Demon Skeleton') expReward = 600;
            else if (target.name === 'Nightmare Skeleton') expReward = 5000;
            attacker.experience += expReward;
            
            let leveledUp = false;
            while (attacker.experience >= attacker.level * 100) {
               attacker.experience -= attacker.level * 100;
               attacker.level += 1;
               attacker.maxHealth += 10;
               attacker.statPoints = (attacker.statPoints || 0) + 5;
               leveledUp = true;
            }
            
            if (leveledUp) {
               this.recalculateStats(attacker);
               attacker.health = attacker.maxHealth; // Cura total ao upar
               
               this.io.emit('levelUp', { id: attacker.id, level: attacker.level });
               this.io.emit('textEffect', { x: attacker.x, y: attacker.y, message: 'Subiu de Nível!', color: '#ffff00' });
            }
            
            // Sempre enviar a atualização completa pro cliente
            this.io.emit('statsUpdate', { 
                id: attacker.id, level: attacker.level, experience: attacker.experience, gold: attacker.gold, 
                stats: attacker.stats, statPoints: attacker.statPoints,
                attack: attacker.attack, matk: attacker.matk, def: attacker.def, mdef: attacker.mdef,
                hit: attacker.hit, dodge: attacker.dodge, crit: attacker.crit, aspd: attacker.aspd,
                sp: attacker.sp, maxSp: attacker.maxSp, weight: attacker.weight, maxWeight: attacker.maxWeight
            });
            
            // Texto visual de XP ganha em cima do corpo do monstro
            this.io.emit('textEffect', { x: target.x, y: target.y, text: `+${expReward} EXP`, color: '#fbbf24' });

            // Expande Loot baseado no monstro
            const roll = Math.random();
            let itemName = '';
            
            if (target.name === 'Orc') {
                if (roll < 0.10) itemName = 'Steel Sword';  // 10%
                else if (roll < 0.25) itemName = 'Health Potion'; // 15%
                else if (roll < 0.38) itemName = 'Mana Potion';   // 13%
                else if (roll < 0.65) itemName = 'Apple';         // 27%
                else itemName = 'Gold Coin';                      // 35%
            } else if (target.name === 'Rotworm') {
                // Rotworm drops: Gold Coin 50%, Apple 20%, Cheese 15%, Health Potion 8%, Wood Sword 5%, Steel Sword 2%
                if (roll < 0.02) itemName = 'Steel Sword'; // 2%
                else if (roll < 0.07) itemName = 'Wood Sword'; // 5%
                else if (roll < 0.15) itemName = 'Health Potion'; // 8%
                else if (roll < 0.30) itemName = 'Cheese'; // 15%
                else if (roll < 0.50) itemName = 'Apple'; // 20%
                else itemName = 'Gold Coin'; // 50%
            } else if (target.name === 'Demon Skeleton') {
                // Demon Skeleton drops: Gold Coin 70% direct. Others in remaining 30%:
                if (Math.random() < 0.70) {
                    itemName = 'Gold Coin';
                } else {
                    const eqRoll = Math.random();
                    if (eqRoll < 0.05) itemName = 'Armor'; // 5%
                    else if (eqRoll < 0.10) itemName = 'Leather Boots'; // 5%
                    else if (eqRoll < 0.18) itemName = 'Steel Sword'; // 8%
                    else if (eqRoll < 0.26) itemName = 'Pants'; // 8%
                    else if (eqRoll < 0.36) itemName = 'Helmet'; // 10%
                    else if (eqRoll < 0.51) itemName = 'Health Potion'; // 15%
                    else if (eqRoll < 0.66) itemName = 'Mana Potion'; // 15%
                    else itemName = 'Gold Coin'; // Fallback
                }
            } else if (target.name === 'Nightmare Skeleton') {
                itemName = 'Armor'; // Drop do boss: Armadura Forte
                // Drop extra de Gold garantido
                const dropId2 = `item_${Math.random().toString(36).substring(2, 9)}`;
                const dropItem2 = { id: dropId2, name: 'Gold Coin', x: target.x, y: target.y, emoji: ITEM_EMOJIS['Gold Coin'] || '📦' };
                this.itemsOnFloor.set(dropId2, dropItem2);
                this.io.emit('itemDropped', dropItem2);
            } else {
                // Giant Rat
                if (roll < 0.04) itemName = 'Steel Sword';   // 4%
                else if (roll < 0.08) itemName = 'Torch';    // 4%
                else if (roll < 0.16) itemName = 'Health Potion'; // 8%
                else if (roll < 0.23) itemName = 'Mana Potion';   // 7%
                else if (roll < 0.36) itemName = 'Apple';         // 13%
                else if (roll < 0.52) itemName = 'Cheese';        // 16%
                else if (roll < 0.65) itemName = 'Blueberry';     // 13%
                else itemName = 'Gold Coin';                      // 35%
            }
            
            const dropId = `item_${Math.random().toString(36).substring(2, 9)}`;
            const dropItem = { id: dropId, name: itemName, x: target.x, y: target.y, emoji: ITEM_EMOJIS[itemName] || '📦' };
            this.itemsOnFloor.set(dropId, dropItem);
            this.io.emit('itemDropped', dropItem);
            
            // Auto-pickup: verifica se algum jogador está exatamente na coordenada do drop
            this.players.forEach((p) => {
                if (!p.isMonster && !p.isDead && p.x === dropItem.x && p.y === dropItem.y) {
                    if (dropItem.name === 'Gold Coin') {
                        this.itemsOnFloor.delete(dropId);
                        p.gold = (p.gold || 0) + 1;
                        this.io.to(p.id).emit('statsUpdate', { id: p.id, level: p.level, experience: p.experience, gold: p.gold });
                        this.io.to(p.id).emit('itemPickedUp', dropItem);
                        this.io.emit('itemRemoved', dropId);
                    } else if (p.backpack) {
                        const weight = ITEM_WEIGHTS[dropItem.name] || 5;
                        if (p.weight + weight <= (p.maxWeight || 250)) {
                            const added = this.addItemToBackpack(p, dropItem.name);
                            if (added) {
                                this.itemsOnFloor.delete(dropId);
                                this.recalculateWeight(p);
                                this.io.to(p.id).emit('itemPickedUp', dropItem);
                                this.io.to(p.id).emit('inventoryUpdate', p.backpack);
                                this.io.to(p.id).emit('statsUpdate', { id: p.id, weight: p.weight, maxWeight: p.maxWeight });
                                this.io.emit('itemRemoved', dropId);
                            }
                        }
                    }
                }
            });
            
            // Tira do mapa
            target.x = -100;
            target.y = -100;
            this.io.emit('playerMoved', target);

            setTimeout(() => {
                target.isDead = false;
                target.health = target.maxHealth;
                // Random Respawn
                let newX = Math.floor(Math.random() * 38) + 1;
                let newY = Math.floor(Math.random() * 38) + 1;
                while (this.walls.has(`${newX},${newY}`)) {
                    newX = Math.floor(Math.random() * 38) + 1;
                    newY = Math.floor(Math.random() * 38) + 1;
                }
                target.x = newX;
                target.y = newY;
                this.io.emit('playerMoved', target);
            }, 5000); // 5 segs pra reviver
        } else {
            // Player morreu!
            target.isDead = true;
            target.health = 0;
            attacker.targetId = undefined; // Atacante perde o target
            
            // Lógica de perder itens do inventário (30% de chance de perder cada slot de item)
            const lostItems: string[] = [];
            if (target.backpack && target.backpack.length > 0) {
                for (let i = target.backpack.length - 1; i >= 0; i--) {
                    if (Math.random() < 0.30) { // 30% de chance de perder o slot
                        const itemString = target.backpack[i];
                        const [itemName, countStr] = itemString.split(':');
                        target.backpack.splice(i, 1);
                        
                        // Spawna no chão onde o jogador morreu
                        const dropId = `item_${Math.random().toString(36).substring(2, 9)}`;
                        const dropItem = { id: dropId, name: itemName, x: target.x, y: target.y, emoji: ITEM_EMOJIS[itemName] || '📦' };
                        this.itemsOnFloor.set(dropId, dropItem);
                        this.io.emit('itemDropped', dropItem);
                        
                        lostItems.push(itemName);
                    }
                }
            }
            
            this.recalculateWeight(target);
            
            // Envia o sinal de morte e os itens perdidos para o jogador local
            this.io.to(target.id).emit('playerDied', { lostItems });
            
            // Notifica todos que o jogador está morto (deitado na mesma coordenada)
            this.io.emit('playerMoved', target);
            
            // Sincroniza a barra lateral do HUD local com HP 0
            this.io.to(target.id).emit('statsUpdate', { id: target.id, health: 0, weight: target.weight });
            this.io.to(target.id).emit('inventoryUpdate', target.backpack);
        }
        
        // Remove o target do atacante atual porque o alvo morreu
        attacker.targetId = undefined;
     }
  }

  private getMaxBackpackSlots(player: PlayerData): number {
      if (!player.equipment || !player.equipment.backpack) {
          return 8;
      }
      const bp = player.equipment.backpack;
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

  private addItemToBackpack(player: PlayerData, itemName: string): boolean {
      if (!player.backpack) player.backpack = [];
      
      // Define quais itens são empilháveis (até 99 stacks, exceto armas, roupas, tochas)
      const stackableItems = ['Apple', 'Cheese', 'Health Potion', 'Mana Potion', 'Blueberry', 'Iron Ore', 'Wood Log', 'Medicinal Herb', 'Leather Hide'];
      
      if (stackableItems.includes(itemName)) {
          // Procura por um slot existente do mesmo item com espaço (menor que 99)
          for (let i = 0; i < player.backpack.length; i++) {
              const slot = player.backpack[i];
              const [name, countStr] = slot.split(':');
              const count = parseInt(countStr) || 1;
              
              if (name === itemName && count < 99) {
                  player.backpack[i] = `${name}:${count + 1}`;
                  return true;
              }
          }
      }
      
      // Se não empilhou, tenta adicionar em um novo slot
      const maxSlots = this.getMaxBackpackSlots(player);
      if (player.backpack.length < maxSlots) {
          if (stackableItems.includes(itemName)) {
              player.backpack.push(`${itemName}:1`);
          } else {
              player.backpack.push(itemName);
          }
          return true;
      }
      
      return false; // Mochila cheia
  }

  private recalculateWeight(player: PlayerData) {
      if (!player.backpack) {
          player.weight = 0;
          return;
      }
      const currentWeight = player.backpack.reduce((sum, slot) => {
          const [name, countStr] = slot.split(':');
          const count = parseInt(countStr) || 1;
          return sum + (ITEM_WEIGHTS[name] || 5) * count;
      }, 0);
      player.weight = currentWeight;
  }

  private recalculateStats(player: PlayerData) {
      if (!player.stats || player.isMonster) return;
      
      const { FOR, AGI, VIT, INT, DES, SOR } = player.stats;
      const level = player.level;
      
      let baseWeaponAtk = 5; // Punhos
      let baseWeaponMAtk = 5;
      let baseArmorDef = 0;
      let baseArmorMDef = 0;
      
      let bonusFOR = 0;
      let bonusAGI = 0;
      let bonusVIT = 0;
      let bonusINT = 0;
      let bonusDES = 0;
      let bonusSOR = 0;
      
      const eqSlots = ['head', 'body', 'legs', 'boots', 'rightHand', 'leftHand'] as const;
      eqSlots.forEach(slot => {
          const eqStr = player.equipment?.[slot];
          if (!eqStr) return;
          const parsed = this.parseItem(eqStr);
          if (!parsed) return;
          
          // Se o item tem durabilidade, e ela for <= 0, o item está quebrado e não concede nenhum benefício
          if (parsed.durability !== undefined && parsed.durability <= 0) {
              return;
          }
          
          // Adiciona atributos extras do item
          if (parsed.stats) {
              if (parsed.stats.FOR) bonusFOR += parsed.stats.FOR;
              if (parsed.stats.AGI) bonusAGI += parsed.stats.AGI;
              if (parsed.stats.VIT) bonusVIT += parsed.stats.VIT;
              if (parsed.stats.INT) bonusINT += parsed.stats.INT;
              if (parsed.stats.DES) bonusDES += parsed.stats.DES;
              if (parsed.stats.SOR) bonusSOR += parsed.stats.SOR;
          }
          
          // Adiciona atributos base baseados no nome do item
          const itemName = parsed.name;
          if (slot === 'rightHand') {
              if (itemName === 'Steel Sword') baseWeaponAtk = 15;
              else if (itemName === 'Wood Sword') baseWeaponAtk = 8;
          } else if (slot === 'body') {
              if (itemName === 'Armor') baseArmorDef += 10;
          } else if (slot === 'head') {
              if (itemName === 'Helmet') baseArmorDef += 5;
          } else if (slot === 'legs') {
              if (itemName === 'Pants') baseArmorDef += 4;
          } else if (slot === 'boots') {
              if (itemName === 'Leather Boots') baseArmorDef += 2;
          }
      });
      
      const totalFOR = FOR + bonusFOR;
      const totalAGI = AGI + bonusAGI;
      const totalVIT = VIT + bonusVIT;
      const totalINT = INT + bonusINT;
      const totalDES = DES + bonusDES;
      const totalSOR = SOR + bonusSOR;
      
      // HP e SP
      player.maxHealth = 100 + (totalVIT * 10) + (level * 5);
      player.maxSp = 20 + (totalINT * 5) + (level * 2);
      
      // Se tiver menos SP que o Max, ajusta, ou garante que SP seja válido
      if (player.sp === undefined) player.sp = player.maxSp;
      else if (player.sp > player.maxSp) player.sp = player.maxSp;
      
      // Velocidade de Movimento (Speed invertida, menor = mais rápido)
      player.speed = Math.max(50, 200 - (totalAGI * 3));
      
      // Dano Físico e Mágico
      player.attack = baseWeaponAtk + (totalFOR * 2) + Math.floor(totalDES / 5) + Math.floor(totalSOR / 3);
      player.matk = baseWeaponMAtk + (totalINT * 2) + Math.floor(totalSOR / 3);
      
      // Defesas
      player.def = baseArmorDef + Math.floor(totalVIT / 2) + Math.floor(totalAGI / 5);
      player.mdef = baseArmorMDef + Math.floor(totalINT / 2);
      
      // Precisão, Esquiva e Crítico
      player.hit = 100 + totalDES + Math.floor(totalSOR / 3) + level;
      player.dodge = totalAGI + Math.floor(totalSOR / 3) + level;
      player.crit = Math.floor(totalSOR / 3) + 1;
      
      // Attack Speed (ASPD) - Reduz o Cooldown Base de 1500ms
      player.aspd = Math.max(200, 1500 - (totalAGI * 10) - Math.floor(totalDES * 2.5));
      
      // Capacidade de Carga (Max Weight)
      player.maxWeight = 100 + (totalFOR * 30);
  }

  private registerAdminEvents(socket: any) {
      // Handlers de ADMIN (Game Master)
      // Nota: Em um servidor de produção, checaríamos autenticação/senhas aqui.
      socket.on('admin:getPlayers', async () => {
          try {
              const allRegistered = await getAllRegisteredPlayers();
              const onlinePlayers = Array.from(this.players.values()).filter(p => !p.isMonster);
              const list = allRegistered.map(p => {
                  const onlinePlayer = onlinePlayers.find(op => op.name === p.name);
                  const isOnline = !!onlinePlayer;
                  if (isOnline && onlinePlayer) {
                      p.id = onlinePlayer.id; // Vincula o socket.id atual
                      p.x = onlinePlayer.x;
                      p.y = onlinePlayer.y;
                      p.health = onlinePlayer.health;
                      p.maxHealth = onlinePlayer.maxHealth;
                      p.level = onlinePlayer.level;
                      p.gold = onlinePlayer.gold;
                      p.statPoints = onlinePlayer.statPoints;
                      p.backpack = onlinePlayer.backpack;
                      p.equipment = onlinePlayer.equipment;
                  }
                  return {
                      ...p,
                      isOnline
                  };
              });
              socket.emit('admin:playersData', list);
          } catch(e) {
              console.error('Erro no admin:getPlayers:', e);
          }
      });

      socket.on('admin:kickPlayer', (id: string) => {
          const targetSocket = this.io.sockets.sockets.get(id);
          if (targetSocket) {
              targetSocket.disconnect(true);
              this.io.emit('admin:playerUpdated'); // Avisa todos os admins pra atualizar a tela
          }
      });

      socket.on('admin:resetPlayer', async (idOrName: string) => {
          // Procura online
          let p = this.players.get(idOrName) || Array.from(this.players.values()).find(op => op.name === idOrName);
          if (p && !p.isMonster) {
              p.level = 1;
              p.experience = 0;
              p.gold = 0;
              p.stats = { FOR: 5, AGI: 5, VIT: 5, INT: 5, DES: 5, SOR: 5 };
              p.statPoints = 0;
              this.recalculateStats(p);
              p.health = p.maxHealth;
              
              this.io.to(p.id).emit('statsUpdate', { 
                  id: p.id, level: p.level, experience: p.experience, gold: p.gold, 
                  stats: p.stats, statPoints: p.statPoints,
                  attack: p.attack, matk: p.matk, def: p.def, mdef: p.mdef,
                  hit: p.hit, dodge: p.dodge, crit: p.crit, aspd: p.aspd,
                  sp: p.sp, maxSp: p.maxSp, weight: p.weight, maxWeight: p.maxWeight,
                  health: p.health, maxHealth: p.maxHealth
              });
              this.io.to(p.id).emit('textEffect', { x: p.x, y: p.y, message: 'RENASCIDO!', color: '#ff00ff' });
              await savePlayerToDB(p);
          } else {
              // Se offline, atualiza SQLite pelo nome
              await updatePlayerOffline(idOrName, 1, 0, 0);
          }
          this.io.emit('admin:playerUpdated');
      });

      socket.on('admin:giveGold', async (idOrName: string) => {
          let p = this.players.get(idOrName) || Array.from(this.players.values()).find(op => op.name === idOrName);
          if (p && !p.isMonster) {
              p.gold = (p.gold || 0) + 1000;
              this.io.to(p.id).emit('statsUpdate', { id: p.id, level: p.level, experience: p.experience, gold: p.gold, stats: p.stats, statPoints: p.statPoints, health: p.health, maxHealth: p.maxHealth });
              this.io.to(p.id).emit('textEffect', { x: p.x, y: p.y, message: '+1000 Ouro GM', color: '#fbbf24' });
              await savePlayerToDB(p);
          } else {
              await incrementGoldOffline(idOrName, 1000);
          }
          this.io.emit('admin:playerUpdated');
      });

      socket.on('admin:deletePlayer', async (name: string) => {
          try {
              // Verifica se o player está online e kicka primeiro
              const onlinePlayer = Array.from(this.players.values()).find(p => p.name === name);
              if (onlinePlayer && onlinePlayer.id) {
                  const pSocket = this.io.sockets.sockets.get(onlinePlayer.id);
                  if (pSocket) pSocket.disconnect();
                  this.players.delete(onlinePlayer.id);
              }
              // Deleta do banco
              const { deletePlayerFromDB } = require('./database');
              await deletePlayerFromDB(name);
              this.io.emit('admin:playerUpdated');
          } catch(e) {
              console.error('Erro ao excluir conta:', e);
          }
      });

      socket.on('admin:resetPassword', async (data: { name: string, newPass: string }) => {
          try {
              const { getPlayerFromDB, savePlayerToDB } = require('./database');
              const pData = await getPlayerFromDB(data.name);
              if (pData) {
                  pData.password = data.newPass;
                  await savePlayerToDB(pData);
                  this.io.emit('admin:playerUpdated');
              }
          } catch(e) {
              console.error('Erro ao resetar senha:', e);
          }
      });

      socket.on('admin:editPlayer', async (data: { name: string, level: number, gold: number, statPoints: number }) => {
          let p = Array.from(this.players.values()).find(op => op.name === data.name);
          if (p && !p.isMonster) {
              p.level = data.level;
              p.gold = data.gold;
              p.statPoints = data.statPoints;
              this.recalculateStats(p);
              
              this.io.to(p.id).emit('statsUpdate', { 
                  id: p.id, level: p.level, experience: p.experience, gold: p.gold, 
                  stats: p.stats, statPoints: p.statPoints,
                  attack: p.attack, matk: p.matk, def: p.def, mdef: p.mdef,
                  hit: p.hit, dodge: p.dodge, crit: p.crit, aspd: p.aspd,
                  sp: p.sp, maxSp: p.maxSp, weight: p.weight, maxWeight: p.maxWeight,
                  health: p.health, maxHealth: p.maxHealth
              });
              this.io.to(p.id).emit('textEffect', { x: p.x, y: p.y, message: 'GM EDITOU ATRIBUTOS!', color: '#00ffff' });
              await savePlayerToDB(p);
          } else {
              await updatePlayerOffline(data.name, data.level, data.gold, data.statPoints);
          }
          this.io.emit('admin:playerUpdated');
      });

      socket.on('admin:broadcast', (msg: string) => {
          this.io.emit('textEffect', { x: 20, y: 15, message: `[GM] ${msg}`, color: '#ff3333' });
          this.io.emit('playerSpoke', { id: 'npc_merchant', message: `[GM]: ${msg}` }); // Mensagem de chat global
      });

      socket.on('admin:setTime', (isNight: boolean) => {
          this.isNight = isNight;
          this.io.emit('timeUpdate', { isNight: this.isNight });
          const msg = isNight ? 'O GM forçou a Noite...' : 'O GM forçou o Dia...';
          this.players.forEach(p => { if (!p.isMonster) this.io.to(p.id).emit('textEffect', { x: p.x, y: p.y, message: msg, color: isNight ? '#aa00ff' : '#ffff00' }); });
      });

      socket.on('admin:spawnEntity', (data: { name: string, x?: number, y?: number }) => {
           let spawnX = data.x;
           let spawnY = data.y;

           if (spawnX === undefined || spawnY === undefined || spawnX === null || spawnY === null || isNaN(spawnX) || isNaN(spawnY)) {
               spawnX = Math.floor(Math.random() * 38) + 1;
               spawnY = Math.floor(Math.random() * 38) + 1;
               while (this.walls.has(`${spawnX},${spawnY}`)) {
                   spawnX = Math.floor(Math.random() * 38) + 1;
                   spawnY = Math.floor(Math.random() * 38) + 1;
               }
           }

           const id = `${data.name.toLowerCase().replace(' ', '_')}_gm_${Math.random().toString(36).substring(2, 7)}`;
           const isMonster = data.name === 'Orc' || data.name === 'Giant Rat' || data.name === 'Rotworm' || data.name === 'Demon Skeleton';
           
           let hp = 9999;
           let speed = 0;
           let level = 100;
           let attack = 5;
           
           if (data.name === 'Giant Rat') {
               hp = 50; speed = 150; level = 1; attack = 8;
           } else if (data.name === 'Orc') {
               hp = 120; speed = 100; level = 3; attack = 15;
           } else if (data.name === 'Rotworm') {
               hp = 200; speed = 120; level = 5; attack = 22;
           } else if (data.name === 'Demon Skeleton') {
               hp = 400; speed = 90; level = 10; attack = 38;
           }

           const entity: PlayerData = {
               id,
               name: data.name,
               x: spawnX,
               y: spawnY,
               health: hp,
               maxHealth: hp,
               speed,
               isMonster,
               level,
               experience: 0,
               attack
           };
           
           if (data.name === 'Merchant') {
               (entity as any).isNPC = true;
           }
           
           this.players.set(id, entity);
           this.io.emit('newPlayer', entity);
           this.io.emit('admin:playerUpdated');
       });

       socket.on('admin:spawnItem', (data: { name: string, x?: number, y?: number }) => {
           let spawnX = data.x;
           let spawnY = data.y;

           if (spawnX === undefined || spawnY === undefined || spawnX === null || spawnY === null || isNaN(spawnX) || isNaN(spawnY)) {
               spawnX = Math.floor(Math.random() * 38) + 1;
               spawnY = Math.floor(Math.random() * 38) + 1;
               while (this.walls.has(`${spawnX},${spawnY}`)) {
                   spawnX = Math.floor(Math.random() * 38) + 1;
                   spawnY = Math.floor(Math.random() * 38) + 1;
               }
           }

           const dropId = `item_gm_${Math.random().toString(36).substring(2, 7)}`;
           const dropItem = { id: dropId, name: data.name, x: spawnX, y: spawnY, emoji: ITEM_EMOJIS[data.name] || '📦' };
           this.itemsOnFloor.set(dropId, dropItem);
           this.io.emit('itemDropped', dropItem);
       });

        socket.on('startGathering', (data: { nodeId: string }) => {
            const player = this.players.get(socket.id);
            if (!player || player.isDead) return;

            // Cancela qualquer coleta ativa primeiro
            this.cancelGathering(socket.id);

            const node = this.resourceNodes.get(data.nodeId);
            if (!node || node.state === 'depleted') {
                socket.emit('textEffect', { x: player.x, y: player.y, message: 'Recurso esgotado!', color: '#ff5555' });
                return;
            }

            // Verifica distância (máximo 1.5 de distância Manhattan ou Chebyshev)
            const dx = Math.abs(node.x - player.x);
            const dy = Math.abs(node.y - player.y);
            if (dx > 1 || dy > 1) {
                socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito longe!', color: '#ff5555' });
                return;
            }

            // Inicia a canalização (tempo base: 2.5s)
            const duration = 2500;
            socket.emit('gatheringStarted', { duration, nodeType: node.type });

            const timeout = setTimeout(() => {
                this.activeGatherings.delete(socket.id);
                this.completeGathering(socket, node);
            }, duration);

            this.activeGatherings.set(socket.id, timeout);
        });

        socket.on('startRecall', () => {
             const player = this.players.get(socket.id);
             if (!player || player.isDead) return;

             // Cancela qualquer canalização de coleta ou recall ativa
             this.cancelGathering(socket.id);

             // Inicia canalização de 5 segundos (5000ms)
             const duration = 5000;
             socket.emit('recallStarted', { duration });

             const timeout = setTimeout(() => {
                 this.activeRecalls.delete(socket.id);
                 this.completeRecall(socket);
             }, duration);

             this.activeRecalls.set(socket.id, timeout);
         });

  }

  private setupResourceNodes() {
      const types: Array<{ type: 'ore' | 'tree' | 'herb'; name: string; emoji: string }> = [
          { type: 'ore', name: 'Iron Ore', emoji: '🌑' },
          { type: 'tree', name: 'Wood Log', emoji: '🌳' },
          { type: 'herb', name: 'Medicinal Herb', emoji: '🌿' }
      ];

      // Spawn 8 nós de cada tipo
      for (const t of types) {
          for (let i = 0; i < 8; i++) {
              let attempts = 0;
              while (attempts < 100) {
                  const rx = Math.floor(Math.random() * 38) + 1;
                  const ry = Math.floor(Math.random() * 38) + 1;
                  
                  const coordKey = `${rx},${ry}`;
                  const isWall = this.walls.has(coordKey);
                  const isNodeHere = Array.from(this.resourceNodes.values()).some(n => n.x === rx && n.y === ry);
                  const isMerchantHere = rx === 10 && ry === 8;
                  
                  if (!isWall && !isNodeHere && !isMerchantHere) {
                      const id = `node_${t.type}_${Math.random().toString(36).substring(2, 9)}`;
                      this.resourceNodes.set(id, {
                          id,
                          type: t.type,
                          name: t.name,
                          emoji: t.emoji,
                          x: rx,
                          y: ry,
                          charges: 3,
                          maxCharges: 3,
                          state: 'rich'
                      });
                      break;
                  }
                  attempts++;
              }
          }
      }
  }

  private cancelGathering(socketId: string) {
      const timeout = this.activeGatherings.get(socketId);
      if (timeout) {
          clearTimeout(timeout);
          this.activeGatherings.delete(socketId);
          this.io.to(socketId).emit('gatheringCancelled');
      }
      this.cancelRecall(socketId);
  }

  private cancelRecall(socketId: string) {
      const timeout = this.activeRecalls.get(socketId);
      if (timeout) {
          clearTimeout(timeout);
          this.activeRecalls.delete(socketId);
          this.io.to(socketId).emit('recallCancelled');
      }
  }

  private completeRecall(socket: Socket) {
      const player = this.players.get(socket.id);
      if (!player || player.isDead) return;

      player.x = 10;
      player.y = 10;
      player.targetId = undefined;

      // Notifica todos que o jogador se moveu
      this.io.emit('playerMoved', player);

      // Atualiza o HUD do jogador local
      socket.emit('statsUpdate', { id: player.id, health: player.health, maxHealth: player.maxHealth });
      socket.emit('textEffect', { x: player.x, y: player.y, message: 'Retornou!', color: '#3b82f6' });
      socket.emit('recallCompleted');
  }

  private completeGathering(socket: Socket, node: ResourceNode) {
      const player = this.players.get(socket.id);
      if (!player || player.isDead) return;

      const dx = Math.abs(node.x - player.x);
      const dy = Math.abs(node.y - player.y);
      if (dx > 1 || dy > 1 || node.state === 'depleted') {
          socket.emit('textEffect', { x: player.x, y: player.y, message: 'Coleta falhou!', color: '#ff5555' });
          return;
      }

      let itemName = '';
      let xpField: 'gatheringMiningXp' | 'gatheringHerbalismXp' | 'gatheringWoodcuttingXp' | null = null;
      let lvlField: 'gatheringMiningLevel' | 'gatheringHerbalismLevel' | 'gatheringWoodcuttingLevel' | null = null;

      if (node.type === 'ore') {
          itemName = 'Iron Ore';
          xpField = 'gatheringMiningXp';
          lvlField = 'gatheringMiningLevel';
      } else if (node.type === 'tree') {
          itemName = 'Wood Log';
          xpField = 'gatheringWoodcuttingXp';
          lvlField = 'gatheringWoodcuttingLevel';
      } else if (node.type === 'herb') {
          itemName = 'Medicinal Herb';
          xpField = 'gatheringHerbalismXp';
          lvlField = 'gatheringHerbalismLevel';
      }

      if (!itemName) return;

      const itemWeight = ITEM_WEIGHTS[itemName] || 5;
      if (player.weight + itemWeight > (player.maxWeight || 250)) {
          socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito Pesado!', color: '#ff5555' });
          return;
      }

      const added = this.addItemToBackpack(player, itemName);
      if (!added) {
          socket.emit('textEffect', { x: player.x, y: player.y, message: 'Mochila Cheia!', color: '#ff5555' });
          return;
      }

      node.charges--;
      if (node.charges <= 0) {
          node.state = 'depleted';
          node.respawnTime = Date.now() + 30000; // 30s respawn
      }
      this.io.emit('resourceNodeUpdated', node);

      if (xpField && lvlField) {
          const currentLvl = player[lvlField] || 1;
          const currentXp = player[xpField] || 0;
          const xpGained = 15;
          const nextLvlXp = currentLvl * 100;
          
          let newXp = currentXp + xpGained;
          let newLvl = currentLvl;
          if (newXp >= nextLvlXp) {
              newXp -= nextLvlXp;
              newLvl++;
              socket.emit('textEffect', { x: player.x, y: player.y, message: `Nível Subiu: ${node.type === 'ore' ? 'Mineração' : node.type === 'tree' ? 'Lenhador' : 'Herborismo'}!`, color: '#eab308' });
          }

          player[xpField] = newXp;
          player[lvlField] = newLvl;
      }

      this.recalculateWeight(player);

      const displayItemName = ITEM_NAMES_PT[itemName] || itemName;
      socket.emit('textEffect', { x: player.x, y: player.y, message: `+1 ${displayItemName}`, color: '#10b981' });
      socket.emit('inventoryUpdate', player.backpack);
      socket.emit('statsUpdate', { 
          id: player.id, 
          weight: player.weight, 
          maxWeight: player.maxWeight,
          gatheringMiningLevel: player.gatheringMiningLevel,
          gatheringMiningXp: player.gatheringMiningXp,
          gatheringHerbalismLevel: player.gatheringHerbalismLevel,
          gatheringHerbalismXp: player.gatheringHerbalismXp,
          gatheringWoodcuttingLevel: player.gatheringWoodcuttingLevel,
          gatheringWoodcuttingXp: player.gatheringWoodcuttingXp
      });
  }

  private setupCraftingStations() {
      const stations: CraftingStation[] = [
          { id: 'station_forge', type: 'forge', name: 'Forja', emoji: '⚒️', x: 118, y: 110 },
          { id: 'station_alchemy', type: 'alchemy', name: 'Mesa de Alquimia', emoji: '🧪', x: 122, y: 110 },
          { id: 'station_tanning', type: 'tanning', name: 'Bancada de Alfaiataria', emoji: '🧵', x: 120, y: 108 }
      ];
      stations.forEach(s => {
          this.craftingStations.set(s.id, s);
          // Bloqueia a posição para não andarem em cima
          this.walls.add(`${s.x},${s.y}`);
      });
  }

  private parseItem(itemStr: string): { name: string, quality?: string, stats?: any, durability?: number, maxDurability?: number } | null {
      if (!itemStr) return null;
      if (itemStr.startsWith('{')) {
          try {
              return JSON.parse(itemStr);
          } catch (e) {
              console.error('Error parsing item JSON:', e);
              return null;
          }
      }
      const [name] = itemStr.split(':');
      return { name };
  }

  private getItemPower(itemName: string): number {
      const powerMap: Record<string, number> = {
          'Wood Sword': 8, 'Steel Sword': 15,
          'Helmet': 5, 'Armor': 10, 'Pants': 2, 'Leather Boots': 1,
          'Torch': 1,
          'Leather Backpack': 16, 'Wooden Backpack': 24, 'Iron Backpack': 32
      };
      return powerMap[itemName] || 0;
  }

  private countItemInBackpack(player: PlayerData, itemName: string): number {
      if (!player.backpack) return 0;
      let total = 0;
      player.backpack.forEach(slot => {
          const parsed = this.parseItem(slot);
          if (parsed && parsed.name === itemName) {
              if (slot.includes(':')) {
                  const count = parseInt(slot.split(':')[1]) || 1;
                  total += count;
              } else {
                  total += 1;
              }
          }
      });
      return total;
  }

  private removeItemFromBackpack(player: PlayerData, itemName: string, countToRemove: number): void {
      if (!player.backpack) return;
      let remaining = countToRemove;
      
      for (let i = player.backpack.length - 1; i >= 0; i--) {
          if (remaining <= 0) break;
          
          const slot = player.backpack[i];
          const parsed = this.parseItem(slot);
          if (parsed && parsed.name === itemName) {
              if (slot.includes(':')) {
                  const [name, countStr] = slot.split(':');
                  const qty = parseInt(countStr) || 1;
                  if (qty > remaining) {
                      player.backpack[i] = `${name}:${qty - remaining}`;
                      remaining = 0;
                  } else {
                      player.backpack.splice(i, 1);
                      remaining -= qty;
                  }
              } else {
                  player.backpack.splice(i, 1);
                  remaining -= 1;
              }
          }
      }
  }

  private broadcastAuctions(): void {
      getAuctionsFromDB().then((list) => {
          this.io.emit('auctionList', list);
      }).catch(console.error);
  }

  private reduceWeaponDurability(player: PlayerData) {
      if (!player.equipment || !player.equipment.rightHand) return;
      const eqStr = player.equipment.rightHand;
      const parsed = this.parseItem(eqStr);
      if (parsed && parsed.durability !== undefined) {
          parsed.durability = Math.max(0, parsed.durability - 1);
          player.equipment.rightHand = JSON.stringify(parsed);
          
          const socket = this.io.sockets.sockets.get(player.id);
          if (socket) {
              socket.emit('equipmentUpdate', player.equipment);
              this.recalculateStats(player);
              socket.emit('statsUpdate', { 
                  id: player.id, 
                  attack: player.attack,
                  aspd: player.aspd
              });
          }
      }
  }

  private reduceArmorDurability(player: PlayerData) {
      if (!player.equipment) return;
      
      const armorSlots = ['head', 'body', 'legs', 'boots'] as const;
      const filledSlots = armorSlots.filter(slot => {
          const eqStr = player.equipment?.[slot];
          if (!eqStr) return false;
          const parsed = this.parseItem(eqStr);
          return parsed && parsed.durability !== undefined;
      });
      
      if (filledSlots.length === 0) return;
      
      const randomSlot = filledSlots[Math.floor(Math.random() * filledSlots.length)];
      const eqStr = player.equipment[randomSlot]!;
      const parsed = this.parseItem(eqStr);
      if (parsed && parsed.durability !== undefined) {
          parsed.durability = Math.max(0, parsed.durability - 1);
          player.equipment[randomSlot] = JSON.stringify(parsed);
          
          const socket = this.io.sockets.sockets.get(player.id);
          if (socket) {
              socket.emit('equipmentUpdate', player.equipment);
              this.recalculateStats(player);
              socket.emit('statsUpdate', { 
                  id: player.id,
                  def: player.def,
                  mdef: player.mdef,
                  health: player.health,
                  maxHealth: player.maxHealth
              });
          }
      }
  }

}
// Restart trigger
