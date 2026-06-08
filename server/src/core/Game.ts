import { Server, Socket } from 'socket.io';
import { PlayerData, Position, MapData, ItemData, ResourceNode, CraftingStation } from '../../../shared/types';
import { getPlayerFromDB, savePlayerToDB, getAllRegisteredPlayers, updatePlayerOffline, incrementGoldOffline, getAuctionsFromDB, createAuctionInDB, removeAuctionFromDB, getAuctionByIdFromDB, deletePlayerFromDB, deductOfflineBankGold, saveConfigToDB, loadConfigFromDB, loadAllConfigFromDB, getAccountFromDB, createAccountInDB, listCharactersForAccount, deleteCharacterFromAccount, countCharactersForAccount, setAccountPassword, AccountRow } from './database';
import { CRAFTING_RECIPES, Recipe } from '../../../shared/recipes';
import { CONFIG, ServerConfig, rollDropTable, getStackableItems, resetConfigToDefaults, MONSTER_CITIES, MonsterCity, PLAZA_BOUNDS, PLAZA_TELEPORTER, CAVERNA_TELEPORTER, CAVERNA_SAFE_ZONE_CENTER, CAVERNA_SAFE_ZONE_GATE, CITY_TELEPORTERS, CITY_VENDORS, QUESTS, VendorNpc, Quest, getCityAt, getTeleporterAt, getVendorAt, isInPlaza, isInSafeZone, getHubDestinations, getTeleporterDestination, getSafeZoneWallRing, SAFE_ZONE_RADIUS } from './serverConfig';

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
    'Iron Ore': '🌑', 'Wood Log': '🌲', 'Medicinal Herb': '🌿',
    'Leather Backpack': '🎒', 'Wooden Backpack': '💼', 'Iron Backpack': '🧳',
    'Skull': '💀'
};

/**
 * Ícones de item baseados em imagens (URLs servidas pelo Vite a partir de /client/public).
 * Quando um item está aqui, o cliente renderiza <img src=...> em vez de texto emoji.
 */
export const ITEM_ICONS: Record<string, string> = {
};

/** Retorna o ícone do item: URL de imagem (se existir) ou emoji. */
export function getItemIcon(itemName: string): string {
    return ITEM_ICONS[itemName] || ITEM_EMOJIS[itemName] || '📦';
}

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

// Stats base dos monstros (usado pelas cidades de monstros - Fase 3)
export const MONSTER_BASE_STATS: Record<string, { health: number; attack: number; speed: number; level: number }> = {
    'Giant Rat':         { health: 50,  attack: 8,  speed: 150, level: 1 },
    'Orc':               { health: 120, attack: 15, speed: 100, level: 3 },
    'Rotworm':           { health: 200, attack: 22, speed: 120, level: 5 },
    'Demon Skeleton':    { health: 400, attack: 38, speed: 90,  level: 10 },
};

export class Game {
  private io: Server;
  private players: Map<string, PlayerData> = new Map();
  private projectiles: any[] = []; // { id, casterId, x, y, dx, dy, speed }
  private walls: Set<string> = new Set();
  /** Paredes extras para monstros (inclui portões e outras barreiras só pra eles). */
  private monsterWalls: Set<string> = new Set();
  private itemsOnFloor: Map<string, ItemData> = new Map(); // Chave: "x,y"
  private tickRate: number = 1000 / 20; // 20 Ticks por segundo
  private lastUpdate: number = Date.now();
  private ticks: number = 0;
  private isNight: boolean = false;
  private resourceNodes: Map<string, ResourceNode> = new Map();
  private activeGatherings: Map<string, NodeJS.Timeout> = new Map();

  // Respawn gradual de monstros (Fase 4a)
  private pendingRespawns: Map<string, number> = new Map();   // monsterId -> Date.now() quando revive
  private monsterSpawnData: Map<string, { x: number; y: number; bounds?: { xMin: number; xMax: number; yMin: number; yMax: number } }> = new Map();
  private activeRecalls: Map<string, NodeJS.Timeout> = new Map();
  private craftingStations: Map<string, CraftingStation> = new Map();

  constructor(io: Server) {
    this.io = io;
    this.loadServerConfig();
    this.setupMap();
    this.setupResourceNodes();
    this.setupCraftingStations();
    this.setupNetwork();

    // Auto-save no DB (intervalo configurável)
    setInterval(() => this.saveAllPlayers(), CONFIG.autoSaveIntervalMs);
  }

  private loadServerConfig() {
      const saved = loadAllConfigFromDB();
      if (saved.main) {
          try {
              Object.assign(CONFIG, saved.main);
              console.log('[CONFIG] Configuração carregada do banco.');
          } catch (e) {
              console.error('[CONFIG] Erro ao carregar config salva, usando defaults:', e);
          }
      } else {
          // Primeira execução: salvar os defaults
          saveConfigToDB('main', CONFIG);
          console.log('[CONFIG] Configuração padrão persistida pela primeira vez.');
      }
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
    // Sala 40x40 com pilares (caverna/mapa antigo) — totalmente fechada
    for (let x = 0; x <= 40; x++) {
      for (let y = 0; y <= 40; y++) {
        // Paredes externas (sem buracos — portais foram removidos)
        if (x === 0 || y === 0 || x === 40 || y === 40) {
          this.walls.add(`${x},${y}`);
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

    // Sala da Cidade (Safe Zone): agora é a Praça Central (Fase 3)
    // Os portais e paredes da praça são criados mais abaixo.
    // Spawna o Mercador na Praça Central
    const merchant: PlayerData = {
        id: 'npc_merchant',
        name: 'Merchant',
        x: 110,
        y: 115,
        health: 9999,
        maxHealth: 9999,
        speed: 0,
        isMonster: false,
        level: 100,
        experience: 0
    };
    (merchant as any).isNPC = true;
    this.players.set(merchant.id, merchant);
    this.walls.add('110,115');

    // Spawna o Banqueiro na Praça Central
    const banker: PlayerData = {
        id: 'npc_banker',
        name: 'Banker',
        x: 120,
        y: 115,
        health: 9999,
        maxHealth: 9999,
        speed: 0,
        isMonster: false,
        level: 100,
        experience: 0
    };
    (banker as any).isNPC = true;
    this.players.set(banker.id, banker);
    this.walls.add('120,115');

    // Spawna o NPC de Missões na Praça Central
    const questgiver: PlayerData = {
        id: 'npc_questgiver',
        name: 'Mestre das Missões',
        x: 115,
        y: 120,
        health: 9999,
        maxHealth: 9999,
        speed: 0,
        isMonster: false,
        level: 100,
        experience: 0
    };
    (questgiver as any).isNPC = true;
    (questgiver as any).npcType = 'questgiver';
    this.players.set(questgiver.id, questgiver);
    this.walls.add('115,120');

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
        this.monsterSpawnData.set(rat.id, { x: rat.x, y: rat.y });
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
        this.monsterSpawnData.set(orc.id, { x: orc.x, y: orc.y });
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
        this.monsterSpawnData.set(rotworm.id, { x: rotworm.x, y: rotworm.y });
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
        this.monsterSpawnData.set(ds.id, { x: ds.x, y: ds.y });
    }

    // ===========================================================
    // ===== Praça Central (Hub entre as 4 cidades de monstro) ====
    // ===========================================================
    for (let x = PLAZA_BOUNDS.xMin; x <= PLAZA_BOUNDS.xMax; x++) {
        for (let y = PLAZA_BOUNDS.yMin; y <= PLAZA_BOUNDS.yMax; y++) {
            // Borda da praça vira parede (sem buracos — portais foram removidos)
            if (x === PLAZA_BOUNDS.xMin || y === PLAZA_BOUNDS.yMin ||
                x === PLAZA_BOUNDS.xMax || y === PLAZA_BOUNDS.yMax) {
                this.walls.add(`${x},${y}`);
            }
        }
    }

    // ===========================================================
    // ===== 4 Cidades de Monstros (Fase 3) =====================
    // ===========================================================
    for (const city of MONSTER_CITIES) {
        // Cria as paredes da cidade (sem buracos — portais foram removidos)
        for (let x = city.bounds.xMin; x <= city.bounds.xMax; x++) {
            for (let y = city.bounds.yMin; y <= city.bounds.yMax; y++) {
                if (x === city.bounds.xMin || y === city.bounds.yMin ||
                    x === city.bounds.xMax || y === city.bounds.yMax) {
                    this.walls.add(`${x},${y}`);
                }
            }
        }

        // Muro em volta da safe zone (ring externo) — bloqueia monstros
        // de se aproximarem dos NPCs de teleporte/venda da cidade.
        for (const t of getSafeZoneWallRing(city)) {
            this.walls.add(`${t.x},${t.y}`);
        }

        // Spawna os monstros temáticos dentro da cidade
        city.spawnPositions.forEach((pos, i) => {
            const baseStats = MONSTER_BASE_STATS[city.monster];
            if (!baseStats) return;
            const m: PlayerData = {
                id: `${city.id}_monster_${i}`,
                name: city.monster,
                x: pos.x,
                y: pos.y,
                health: baseStats.health,
                maxHealth: baseStats.health,
                speed: baseStats.speed,
                isMonster: true,
                level: baseStats.level,
                experience: 0,
                attack: baseStats.attack
            };
            this.players.set(m.id, m);
            // Salva dados de spawn (com bounds da cidade para respawn aleatório dentro)
            this.monsterSpawnData.set(m.id, {
                x: pos.x,
                y: pos.y,
                bounds: { ...city.bounds }
            });
        });
    }

    // ===========================================================
    // ===== NPCs de Teleporte (substituem os portais físicos) ===
    // ===========================================================

    // Mago Teleportador Hub na praça central
    const hubNpc: PlayerData = {
        id: PLAZA_TELEPORTER.id,
        name: PLAZA_TELEPORTER.name,
        x: PLAZA_TELEPORTER.x,
        y: PLAZA_TELEPORTER.y,
        health: 9999,
        maxHealth: 9999,
        speed: 0,
        isMonster: false,
        level: 100,
        experience: 0,
    };
    (hubNpc as any).isNPC = true;
    (hubNpc as any).npcType = 'teleporter';
    this.players.set(hubNpc.id, hubNpc);
    this.walls.add(`${PLAZA_TELEPORTER.x},${PLAZA_TELEPORTER.y}`);

    // Mago Teleportador da Caverna (mapa antigo 40x40)
    const cavernaNpc: PlayerData = {
        id: CAVERNA_TELEPORTER.id,
        name: CAVERNA_TELEPORTER.name,
        x: CAVERNA_TELEPORTER.x,
        y: CAVERNA_TELEPORTER.y,
        health: 9999,
        maxHealth: 9999,
        speed: 0,
        isMonster: false,
        level: 100,
        experience: 0,
    };
    (cavernaNpc as any).isNPC = true;
    (cavernaNpc as any).npcType = 'teleporter';
    this.players.set(cavernaNpc.id, cavernaNpc);
    this.walls.add(`${CAVERNA_TELEPORTER.x},${CAVERNA_TELEPORTER.y}`);

    // Teleporters de retorno em cada cidade
    for (const t of CITY_TELEPORTERS) {
        const n: PlayerData = {
            id: t.id,
            name: t.name,
            x: t.x,
            y: t.y,
            health: 9999,
            maxHealth: 9999,
            speed: 0,
            isMonster: false,
            level: 100,
            experience: 0,
        };
        (n as any).isNPC = true;
        (n as any).npcType = 'teleporter';
        this.players.set(n.id, n);
        this.walls.add(`${t.x},${t.y}`);
    }

    // Vendedores temáticos em cada cidade
    for (const v of CITY_VENDORS) {
        const n: PlayerData = {
            id: v.id,
            name: v.name,
            x: v.x,
            y: v.y,
            health: 9999,
            maxHealth: 9999,
            speed: 0,
            isMonster: false,
            level: 100,
            experience: 0,
        };
        (n as any).isNPC = true;
        (n as any).npcType = 'vendor';
        this.players.set(n.id, n);
        this.walls.add(`${v.x},${v.y}`);
    }

    // =====================================================================
    // ===== Safe Zone da Caverna (5x5 ao redor do teleporter) ===========
    // =====================================================================
    // Muro em volta (mesma lógica das cidades)
    for (let dx = -SAFE_ZONE_RADIUS - 1; dx <= SAFE_ZONE_RADIUS + 1; dx++) {
        for (let dy = -SAFE_ZONE_RADIUS - 1; dy <= SAFE_ZONE_RADIUS + 1; dy++) {
            // Só o ring externo (|dx| === r+1 OU |dy| === r+1)
            const r = SAFE_ZONE_RADIUS + 1;
            if (Math.abs(dx) === r || Math.abs(dy) === r) {
                this.walls.add(`${CAVERNA_SAFE_ZONE_CENTER.x + dx},${CAVERNA_SAFE_ZONE_CENTER.y + dy}`);
            }
        }
    }

    // =====================================================================
    // ===== monsterWalls: copia de walls + portões (gate tiles) ==========
    // =====================================================================
    // monsterWalls = walls + portões. Os portões são paredes SÓ para
    // monstros: o player passa pelo portão, o monstro não.
    this.monsterWalls = new Set(this.walls);
    // Portão da caverna
    this.monsterWalls.add(`${CAVERNA_SAFE_ZONE_GATE.x},${CAVERNA_SAFE_ZONE_GATE.y}`);
    // Portão de cada cidade
    for (const city of MONSTER_CITIES) {
        this.monsterWalls.add(`${city.gate.x},${city.gate.y}`);
    }
    // Remove os portões de 'walls' (player passa), mas mantém no monsterWalls (monstro não passa)
    this.walls.delete(`${CAVERNA_SAFE_ZONE_GATE.x},${CAVERNA_SAFE_ZONE_GATE.y}`);
    for (const city of MONSTER_CITIES) {
        this.walls.delete(`${city.gate.x},${city.gate.y}`);
    }
  }

  private setupNetwork() {
    this.io.on('connection', async (socket: Socket) => {
      const accountName = socket.handshake.auth.name || 'Unknown';
      const accountPassword = socket.handshake.auth.password || '';
      console.log(`Aventureiro tentando conectar: ${accountName} (${socket.id})`);
      this.registerAdminEvents(socket);
      if (accountName === "AdminGM") {
          const expected = process.env.ADMIN_PASSWORD || 'admin';
          if (accountPassword && accountPassword !== expected) {
              socket.emit('admin:loginResult', { ok: false, reason: 'Senha de administrador incorreta.' });
              socket.disconnect(true);
              return;
          }
          console.log("Sessão AdminGM sem avatar iniciada.");
          socket.emit('admin:loginResult', { ok: true });
          socket.on('disconnect', () => {
              console.log(`Admin desconectado: ${socket.id}`);
          });
          return;
      }

      // Autentica a CONTA (não o personagem).
      // Auto-cria a conta se não existir; se existir, valida a senha.
      // Migração: contas antigas com senha vazia aceitam a primeira senha fornecida.
      let account = await getAccountFromDB(accountName);
      if (!account) {
          const created = await createAccountInDB(accountName, accountPassword);
          if (!created.ok) {
              socket.emit('loginFailed', { message: created.reason || 'Erro ao autenticar.' });
              socket.disconnect(true);
              return;
          }
          account = await getAccountFromDB(accountName);
          if (!account) {
              socket.emit('loginFailed', { message: 'Erro ao criar conta.' });
              socket.disconnect(true);
              return;
          }
      } else if (account.password === '') {
          // Migração: conta antiga sem senha → define a senha fornecida
          if (accountPassword && accountPassword.length >= 3 && accountPassword.length <= 8) {
              const result = await setAccountPassword(accountName, accountPassword);
              if (!result.ok) {
                  socket.emit('loginFailed', { message: result.reason || 'Erro ao definir senha.' });
                  socket.disconnect(true);
                  return;
              }
              account.password = accountPassword;
              console.log(`Conta ${accountName} migrada com nova senha.`);
          } else {
              socket.emit('loginFailed', { message: 'Senha deve ter 3-8 caracteres.' });
              socket.disconnect(true);
              return;
          }
      } else if (account.password !== accountPassword) {
          socket.emit('loginFailed', { message: 'Senha incorreta.' });
          socket.disconnect(true);
          return;
      }

      (socket as any).data = { accountName, accountPassword };
      console.log(`Conta autenticada: ${accountName} (${socket.id})`);

      // Envia a lista de personagens imediatamente para o cliente
      await this.sendCharacterList(socket, account);

      // Desconexão antes de escolher personagem: nada para salvar
      socket.on('disconnect', () => {
          console.log(`Socket desconectado (sem personagem): ${socket.id}`);
      });

      this.registerCharacterHandlers(socket, account);
    });
  }

  // ============================================================
  // Character Selection (multi-personagem por conta)
  // ============================================================

  private async sendCharacterList(socket: Socket, account: AccountRow): Promise<void> {
      const characters = await listCharactersForAccount(account.accountName);
      socket.emit('account:characters', {
          accountName: account.accountName,
          characters,
          maxCharacters: account.maxCharacters
      });
  }

  private async createCharacterForAccount(accountName: string, data: { name: string; spriteId: string }): Promise<{ ok: boolean; reason?: string; character?: { slot: number; name: string; level: number; spriteId: string } }> {
      const name = (data.name || '').trim();
      const spriteId = data.spriteId || 'm1';
      if (!name || name.length < 3 || name.length > 20) return { ok: false, reason: 'Nome deve ter 3-20 caracteres.' };
      if (!/^[a-zA-Z0-9_]+$/.test(name)) return { ok: false, reason: 'Use apenas letras, números e underscore.' };
      const count = await countCharactersForAccount(accountName);
      const account = await getAccountFromDB(accountName);
      if (!account) return { ok: false, reason: 'Conta não encontrada.' };
      if (count >= account.maxCharacters) return { ok: false, reason: `Limite de ${account.maxCharacters} personagens atingido.` };
      const existing = await getPlayerFromDB(name);
      if (existing) return { ok: false, reason: 'Já existe um personagem com esse nome.' };

      const newPlayer: PlayerData = {
          id: 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          name,
          x: 10,
          y: 10,
          health: 150,
          maxHealth: 150,
          speed: 200,
          password: '',
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
          weight: 0,
          accountName,
          spriteId
      };
      this.recalculateStats(newPlayer);
      newPlayer.health = newPlayer.maxHealth;
      newPlayer.facing = 'down';
      newPlayer.bankGold = 0;
      newPlayer.bankDebtDays = 0;
      newPlayer.bankItems = Array(50).fill('');
      try {
          await savePlayerToDB(newPlayer);
      } catch (e) {
          console.error('Erro ao salvar novo personagem:', e);
          return { ok: false, reason: 'Erro ao salvar personagem.' };
      }
      return { ok: true, character: { slot: count + 1, name, level: 1, spriteId } };
  }

  private registerCharacterHandlers(socket: Socket, account: AccountRow): void {
      const accountName = account.accountName;

      socket.on('character:list', async () => {
          // Voltar ao lobby = liberar personagem da memória
          this.cancelGathering(socket.id);
          const p = this.players.get(socket.id);
          if (p && !p.isMonster) {
              try { await savePlayerToDB(p); } catch (e) { console.error('Erro ao salvar ao voltar ao lobby:', e); }
          }
          this.players.delete(socket.id);
          this.io.emit('playerLeft', socket.id);
          await this.sendCharacterList(socket, account);
      });

      socket.on('character:create', async (data: { name: string; spriteId: string }) => {
          const result = await this.createCharacterForAccount(accountName, data);
          socket.emit('character:createResult', { ok: result.ok, reason: result.reason, character: result.character });
          if (result.ok) {
              await this.sendCharacterList(socket, account);
          }
      });

      socket.on('character:delete', async (data: { name: string }) => {
          if (!data || !data.name) {
              socket.emit('character:deleteResult', { ok: false, reason: 'Nome inválido.' });
              return;
          }
          const result = await deleteCharacterFromAccount(accountName, data.name);
          socket.emit('character:deleteResult', { ok: result.ok, reason: result.reason });
          if (result.ok) {
              await this.sendCharacterList(socket, account);
          }
      });

      socket.on('character:select', async (data: { name: string }) => {
          if (this.players.has(socket.id)) {
              socket.emit('character:selectResult', { ok: false, reason: 'Personagem já carregado.' });
              return;
          }
          if (!data || !data.name) {
              socket.emit('character:selectResult', { ok: false, reason: 'Nome inválido.' });
              return;
          }
          const dbPlayer = await getPlayerFromDB(data.name);
          if (!dbPlayer) {
              socket.emit('character:selectResult', { ok: false, reason: 'Personagem não encontrado.' });
              return;
          }
          if (dbPlayer.accountName && dbPlayer.accountName !== accountName) {
              socket.emit('character:selectResult', { ok: false, reason: 'Este personagem não pertence à sua conta.' });
              return;
          }
          // Compat: personagens antigos sem accountName ficam vinculados a esta conta
          if (!dbPlayer.accountName) {
              dbPlayer.accountName = accountName;
              try { await savePlayerToDB(dbPlayer); } catch (e) { console.warn('Falha ao retro-vincular accountName:', e); }
          }

          // Se o jogador já está em memória (F5 rápido), transfere a sessão
          let existingPlayerId: string | undefined;
          for (const [id, p] of this.players.entries()) {
              if (p.name === dbPlayer.name && !p.isMonster) {
                  existingPlayerId = id;
                  break;
              }
          }
          if (existingPlayerId) {
              const oldP = this.players.get(existingPlayerId)!;
              const newPlayer: PlayerData = { ...oldP, id: socket.id };
              this.players.delete(existingPlayerId);
              const oldSocket = this.io.sockets.sockets.get(existingPlayerId);
              if (oldSocket) {
                  (oldSocket as any).sessionTransferred = true;
                  oldSocket.disconnect(true);
              }
              this.io.emit('playerLeft', existingPlayerId);
              this.applyPlayerDefaultsAndRegister(newPlayer, socket);
              socket.emit('character:selectResult', { ok: true });
              return;
          }

          const newPlayer: PlayerData = { ...dbPlayer, id: socket.id };
          this.applyPlayerDefaultsAndRegister(newPlayer, socket);
          socket.emit('character:selectResult', { ok: true });
      });
  }

  private applyPlayerDefaultsAndRegister(newPlayer: PlayerData, socket: Socket): void {
      if (!newPlayer.stats) {
          newPlayer.stats = { FOR: 5, AGI: 5, VIT: 5, INT: 5, DES: 5, SOR: 5 };
          newPlayer.statPoints = (newPlayer.level - 1) * 5;
      }
      if (newPlayer.sp === undefined) newPlayer.sp = 50;
      if (newPlayer.weight === undefined) newPlayer.weight = 0;
      this.recalculateStats(newPlayer);
      if (newPlayer.bankGold === undefined) newPlayer.bankGold = 0;
      if (newPlayer.bankDebtDays === undefined) newPlayer.bankDebtDays = 0;
      if (!newPlayer.bankItems || newPlayer.bankItems.length !== 50) {
          newPlayer.bankItems = Array(50).fill('');
      }
      newPlayer.facing = newPlayer.facing || 'down';
      this.players.set(socket.id, newPlayer);
      this.registerGameplayHandlers(socket);
      this.sendInitAndWorld(socket, newPlayer);
  }

  private sendInitAndWorld(socket: Socket, newPlayer: PlayerData): void {
      socket.emit('init', newPlayer);
      // Coleta os portões (4 cidades + caverna) para enviar ao client
      const gates: Position[] = [
          CAVERNA_SAFE_ZONE_GATE,
          ...MONSTER_CITIES.map(c => c.gate),
      ];
      const mapData: MapData = {
          walls: Array.from(this.walls).map(w => {
              const [x, y] = w.split(',');
              return { x: parseInt(x), y: parseInt(y) };
          }),
          gates,
          itemsOnFloor: Array.from(this.itemsOnFloor.values()),
          resourceNodes: Array.from(this.resourceNodes.values()),
          craftingStations: Array.from(this.craftingStations.values())
      };
      socket.emit('mapData', mapData);
      socket.emit('timeUpdate', { isNight: this.isNight });
      socket.broadcast.emit('playerJoined', newPlayer);
      socket.emit('currentPlayers', Array.from(this.players.values()));
      socket.emit('cities:data', MONSTER_CITIES);
      socket.emit('plaza:data', PLAZA_BOUNDS);
      this.io.emit('newPlayer', newPlayer);
  }

  // ============================================================
  // Handlers de gameplay (chamados após character:select)
  // ============================================================

  private registerGameplayHandlers(socket: Socket): void {

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

          // Salva posição anterior para detecção de mudança de área
          const prevX = player.x;
          const prevY = player.y;
          const wasInCity = getCityAt(prevX, prevY);

          player.x = targetPosition.x;
          player.y = targetPosition.y;

          // Mensagem ao entrar em uma cidade (primeira vez) — informativo
          const targetCity = getCityAt(targetPosition.x, targetPosition.y);
          if (targetCity && !wasInCity) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: `Entrou em: ${targetCity.name}`, color: '#fbbf24' });
          }
          // (portais físicos foram removidos — teleporte agora é feito pelos NPCs)

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

      // Right-click context menu: inspecionar entidade (Fase 4b)
      socket.on('entity:query', (targetId: string) => {
        const target = this.players.get(targetId);
        if (!target) {
          socket.emit('entity:info', { id: targetId, error: 'Entidade não encontrada' });
          return;
        }
        const info: any = {
          id: target.id,
          name: target.name,
          level: target.level,
          health: target.health,
          maxHealth: target.maxHealth,
          isMonster: !!target.isMonster,
          isNPC: !!(target as any).isNPC,
          isDead: !!target.isDead,
          x: target.x,
          y: target.y,
        };
        // Só revela gold/stats de players (PvP inspection)
        if (!target.isMonster && !(target as any).isNPC && target.id !== socket.id) {
          info.gold = target.gold;
        }
        // Bosses de cidade ganham flag visual
        if (target.id.startsWith('city_boss_')) {
          const city = MONSTER_CITIES.find(c => `city_boss_${c.id}` === target.id);
          if (city) info.bossOfCity = city.name;
        }
        socket.emit('entity:info', info);
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
                           const inCity = (x: number, y: number) => {
                               const cb = CONFIG.cityBounds;
                               return x >= cb.xMin && x <= cb.xMax && y >= cb.yMin && y <= cb.yMax;
                           };
                      if (inCity(player.x, player.y) || inCity(target.x, target.y)) {
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

              // Garante durabilidade em itens equipáveis que não têm (plain string)
              const equipableItems = ['Steel Sword', 'Wood Sword', 'Torch', 'Helmet', 'Armor', 'Pants', 'Leather Boots', 'Leather Backpack', 'Wooden Backpack', 'Iron Backpack'];
              let itemToEquip = item;
              if (equipableItems.includes(itemName) && !item.startsWith('{')) {
                  itemToEquip = JSON.stringify({ name: itemName, durability: 100, maxDurability: 100, quality: parsed.quality || 'common' });
              }

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
                  if (player.equipment.rightHand) {
                      const currentParsed = this.parseItem(player.equipment.rightHand);
                      if (currentParsed && this.getItemPower(currentParsed.name) > this.getItemPower(itemName)) {
                          this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Item inferior ao equipado!', color: '#fbbf24' });
                      }
                      this.addItemToBackpack(player, player.equipment.rightHand);
                  }
                  player.equipment.rightHand = itemToEquip;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Wood Sword') {
                  if (!player.equipment) player.equipment = {};
                  if (player.equipment.rightHand) {
                      const currentParsed = this.parseItem(player.equipment.rightHand);
                      if (currentParsed && this.getItemPower(currentParsed.name) > this.getItemPower(itemName)) {
                          this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Item inferior ao equipado!', color: '#fbbf24' });
                      }
                      this.addItemToBackpack(player, player.equipment.rightHand);
                  }
                  player.equipment.rightHand = itemToEquip;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Torch') {
                  if (player.equipment && player.equipment.leftHand) {
                      this.addItemToBackpack(player, player.equipment.leftHand);
                  }
                  player.equipment.leftHand = itemToEquip;
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
                  player.equipment.head = itemToEquip;
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
                  player.equipment.body = itemToEquip;
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
                  player.equipment.legs = itemToEquip;
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
                  player.equipment.boots = itemToEquip;
                  this.recalculateStats(player);
                  socket.emit('equipmentUpdate', player.equipment);
                  consumed = true;
              } else if (itemName === 'Leather Backpack' || itemName === 'Wooden Backpack' || itemName === 'Iron Backpack') {
                  if (!player.equipment) player.equipment = {};
                  if (player.equipment.backpack) {
                      this.addItemToBackpack(player, player.equipment.backpack);
                  }
                  player.equipment.backpack = itemToEquip;
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
                  
               // Atualiza progresso de quests (craft)
               this.updateQuestProgress(player, 'craft', recipe.resultItem);

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
                   const dropItem = { id: dropId, name: itemName, x: player.x, y: player.y, emoji: getItemIcon(itemName) };
                  this.itemsOnFloor.set(dropId, dropItem);
                  this.io.emit('itemDropped', dropItem);
              }
          } else if (item.startsWith('{')) {
              // Item JSON (equipamento com stats) — dropa inteiro
              player.backpack.splice(data.index, 1);
              const dropId = `drop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              const dropItem = { id: dropId, name: itemName, x: player.x, y: player.y, emoji: getItemIcon(itemName) };
              this.itemsOnFloor.set(dropId, dropItem);
              this.io.emit('itemDropped', dropItem);
          } else {
              // Item simples sem stack
              player.backpack.splice(data.index, 1);
              const dropId = `drop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              const dropItem = { id: dropId, name: itemName, x: player.x, y: player.y, emoji: getItemIcon(itemName) };
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
          if (!player) return;
          if (!player.backpack) player.backpack = [];
          if (!player.gold) player.gold = 0;

          // Encontra qual vendedor o jogador está próximo
          let nearVendor: VendorNpc | null = null;
          const merchant = this.players.get('npc_merchant');
          if (merchant) {
              const dist = Math.abs(player.x - merchant.x) + Math.abs(player.y - merchant.y);
              if (dist <= CONFIG.bankDistanceCheck) {
                  // Merchant da praça usa preços fixos, sem estoque diário
                  nearVendor = null; // será tratado como Merchant
              }
          }
          for (const v of CITY_VENDORS) {
              const npc = this.players.get(v.id);
              if (npc) {
                  const dist = Math.abs(player.x - npc.x) + Math.abs(player.y - npc.y);
                  if (dist <= CONFIG.bankDistanceCheck) { nearVendor = v; break; }
              }
          }
          // Se não achou vendor de cidade, verifica se está perto do merchant (praça)
          if (!nearVendor && merchant) {
              const dist = Math.abs(player.x - merchant.x) + Math.abs(player.y - merchant.y);
              if (dist > CONFIG.bankDistanceCheck) return;
          } else if (!nearVendor && !merchant) {
              return;
          }

          // Determina preço: usa o preço do vendor específico, ou fallback hardcoded
          let cost = 0;
          const fallbackPrices: Record<string, number> = {
              'Torch': 5, 'Health Potion': 15, 'Mana Potion': 20, 'Steel Sword': 100,
              'Leather Backpack': 500, 'Wooden Backpack': 1500, 'Iron Backpack': 4000,
              'Apple': 3, 'Cheese': 5, 'Blueberry': 4, 'Medicinal Herb': 8, 'Leather Hide': 15,
          };
          if (nearVendor) {
              const stockItem = nearVendor.stock.find(s => s.name === itemName);
              if (!stockItem) {
                  socket.emit('textEffect', { x: player.x, y: player.y, message: 'Item não disponível aqui!', color: '#ff5555' });
                  return;
              }
              cost = stockItem.price;
              // Verifica estoque diário
              const maxStock = stockItem.dailyStock ?? Infinity;
              const sold = nearVendor.soldToday?.[itemName] ?? 0;
              if (sold >= maxStock) {
                  socket.emit('textEffect', { x: player.x, y: player.y, message: 'Estoque diário esgotado!', color: '#ff5555' });
                  return;
              }
          } else {
              cost = fallbackPrices[itemName] || 0;
          }

          if (cost && player.gold >= cost) {
              const itemWeight = ITEM_WEIGHTS[itemName] || 5;
              if (player.weight + itemWeight > (player.maxWeight || 250)) {
                  socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito Pesado!', color: '#ff5555' });
                  return;
              }

              const added = this.addItemToBackpack(player, itemName);
              if (added) {
                  player.gold -= cost;
                  // Marca venda no estoque diário
                  if (nearVendor) {
                      if (!nearVendor.soldToday) nearVendor.soldToday = {};
                      nearVendor.soldToday[itemName] = (nearVendor.soldToday[itemName] || 0) + 1;
                  }
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
          if (!player || !player.backpack) return;

          // Valida que o jogador está próximo de ALGUM vendedor
          const vendors: Array<{ x: number; y: number }> = [];
          const merchant = this.players.get('npc_merchant');
          if (merchant) vendors.push({ x: merchant.x, y: merchant.y });
          for (const v of CITY_VENDORS) {
              const npc = this.players.get(v.id);
              if (npc) vendors.push({ x: npc.x, y: npc.y });
          }
          let nearVendor = false;
          for (const v of vendors) {
              const dist = Math.abs(player.x - v.x) + Math.abs(player.y - v.y);
              if (dist <= CONFIG.bankDistanceCheck) { nearVendor = true; break; }
          }
          if (!nearVendor) return;

          const itemString = player.backpack[invIndex];
          if (!itemString) return;

          let baseName = itemString.startsWith('{') ? JSON.parse(itemString).name : itemString.split(':')[0];
          if (baseName === 'Leather Backpack' || baseName === 'Wooden Backpack' || baseName === 'Iron Backpack') {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Não pode ser vendido!', color: '#ff5555' });
              return;
          }

          const [itemName, countStr] = itemString.split(':');
          const count = parseInt(countStr) || 1;

          const sellPrices: Record<string, number> = { 'Cheese': 2, 'Apple': 3, 'Steel Sword': 25, 'Mana Potion': 5, 'Blueberry': 1, 'Medicinal Herb': 4, 'Leather Hide': 7 };
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

      // Banco: Depositar Ouro
      socket.on('bank:depositGold', (data: { amount: number }) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead) return;

          // Valida distância do Banqueiro
          const banker = Array.from(this.players.values()).find(p => p.name === 'Banker');
          if (!banker) return;
          const dist = Math.abs(player.x - banker.x) + Math.abs(player.y - banker.y);
          if (dist > CONFIG.bankDistanceCheck) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito longe!', color: '#ff5555' });
              return;
          }

          const amount = Math.floor(data.amount);
          if (isNaN(amount) || amount <= 0 || (player.gold || 0) < amount) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Quantidade inválida!', color: '#ff5555' });
              return;
          }

          player.gold = (player.gold || 0) - amount;

          // Paga dívida primeiro
          if ((player.bankDebtDays || 0) < 0) {
              const debt = -(player.bankDebtDays || 0); // Ex: se bankDebtDays é -5, debt é 5
              if (amount >= debt) {
                  player.bankDebtDays = 0;
                  const leftover = amount - debt;
                  player.bankGold = (player.bankGold || 0) + leftover;
              } else {
                  player.bankDebtDays = (player.bankDebtDays || 0) + amount; // Reduz a dívida
              }
          } else {
              player.bankGold = (player.bankGold || 0) + amount;
          }

          // Salva no banco de dados
          savePlayerToDB(player).catch(e => console.error('Error saving bank gold:', e));

          // Envia atualizações
          socket.emit('statsUpdate', { 
              id: player.id, level: player.level, experience: player.experience, gold: player.gold,
              stats: player.stats, statPoints: player.statPoints,
              attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
              hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
              sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
              health: player.health, maxHealth: player.maxHealth
          });

          socket.emit('bank:update', {
              bankGold: player.bankGold,
              bankItems: player.bankItems || [],
              bankDebtDays: player.bankDebtDays
          });

          socket.emit('textEffect', { x: player.x, y: player.y, message: `Depositou ${amount} Ouro`, color: '#10b981' });
      });

      // Banco: Sacar Ouro
      socket.on('bank:withdrawGold', (data: { amount: number }) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead) return;

          // Valida distância do Banqueiro
          const banker = Array.from(this.players.values()).find(p => p.name === 'Banker');
          if (!banker) return;
          const dist = Math.abs(player.x - banker.x) + Math.abs(player.y - banker.y);
          if (dist > CONFIG.bankDistanceCheck) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito longe!', color: '#ff5555' });
              return;
          }

          // Verifica se a conta está bloqueada
          if ((player.bankDebtDays || 0) < 0 || (player.bankGold || 0) <= 0) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Conta bloqueada por falta de pagamento!', color: '#ff5555' });
              return;
          }

          const amount = Math.floor(data.amount);
          if (isNaN(amount) || amount <= 0 || (player.bankGold || 0) < amount) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Quantidade inválida!', color: '#ff5555' });
              return;
          }

          player.bankGold = (player.bankGold || 0) - amount;
          player.gold = (player.gold || 0) + amount;

          // Salva no banco de dados
          savePlayerToDB(player).catch(e => console.error('Error saving bank gold:', e));

          socket.emit('statsUpdate', { 
              id: player.id, level: player.level, experience: player.experience, gold: player.gold,
              stats: player.stats, statPoints: player.statPoints,
              attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
              hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
              sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
              health: player.health, maxHealth: player.maxHealth
          });

          socket.emit('bank:update', {
              bankGold: player.bankGold,
              bankItems: player.bankItems || [],
              bankDebtDays: player.bankDebtDays
          });

          socket.emit('textEffect', { x: player.x, y: player.y, message: `Sacou ${amount} Ouro`, color: '#10b981' });
      });

      // Banco: Depositar Item
      socket.on('bank:depositItem', (data: { backpackIndex: number, amount: number }) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead || !player.backpack || !player.bankItems) return;

          // Valida distância do Banqueiro
          const banker = Array.from(this.players.values()).find(p => p.name === 'Banker');
          if (!banker) return;
          const dist = Math.abs(player.x - banker.x) + Math.abs(player.y - banker.y);
          if (dist > CONFIG.bankDistanceCheck) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito longe!', color: '#ff5555' });
              return;
          }

          // Verifica se a conta está bloqueada
          if ((player.bankDebtDays || 0) < 0 || (player.bankGold || 0) <= 0) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Conta bloqueada!', color: '#ff5555' });
              return;
          }

          const { backpackIndex, amount } = data;
          if (backpackIndex < 0 || backpackIndex >= player.backpack.length) return;
          if (!amount || amount < 1) return;

          const bpItem = player.backpack[backpackIndex];
          if (!bpItem) return;

          // Parse do item: pode ser "Nome:count" ou "Nome" (count=1) ou JSON (não-stackable)
          const stackableItems = ['Apple', 'Cheese', 'Health Potion', 'Mana Potion', 'Blueberry', 'Iron Ore', 'Wood Log', 'Medicinal Herb', 'Leather Hide', 'Gold Coin'];
          let itemName = bpItem;
          let bpCount = 1;
          let isJsonItem = false;

          if (bpItem.startsWith('{')) {
              // Equipamento com stats - não pode ser parcialmente empilhado
              isJsonItem = true;
              try { itemName = JSON.parse(bpItem).name; } catch(e) {}
              bpCount = 1;
          } else if (bpItem.includes(':')) {
              const [n, c] = bpItem.split(':');
              itemName = n;
              bpCount = parseInt(c) || 1;
          }

          if (amount > bpCount) return;
          if (isJsonItem && amount > 1) return; // Equipamentos são sempre 1 por slot

          // Subtrai `amount` do backpack
          if (amount === bpCount) {
              player.backpack.splice(backpackIndex, 1);
          } else {
              player.backpack[backpackIndex] = `${itemName}:${bpCount - amount}`;
          }

          // Tenta empilhar em um slot existente do banco
          let remaining = amount;
          if (stackableItems.includes(itemName)) {
              for (let i = 0; i < player.bankItems.length && remaining > 0; i++) {
                  const slot = player.bankItems[i];
                  if (!slot) continue;
                  const [bName, bCountStr] = slot.split(':');
                  const bCount = parseInt(bCountStr) || 1;
                  if (bName === itemName && bCount < 99) {
                      const newCount = Math.min(99, bCount + remaining);
                      player.bankItems[i] = `${itemName}:${newCount}`;
                      remaining -= (newCount - bCount);
                  }
              }
          }

          // Se sobrou (item não-stackable OU todas as pilhas cheias), coloca em um slot vazio
          if (remaining > 0) {
              // Garante que bankItems tem 50 slots
              while (player.bankItems.length < 50) player.bankItems.push('');
              const emptyIdx = player.bankItems.findIndex(s => !s);
              if (emptyIdx === -1) {
                  // Cofre cheio: devolve tudo para a mochila
                  this.addItemToBackpack(player, bpItem);
                  socket.emit('textEffect', { x: player.x, y: player.y, message: 'Cofre Cheio!', color: '#ff5555' });
                  return;
              }
              if (isJsonItem) {
                  player.bankItems[emptyIdx] = bpItem;
              } else if (stackableItems.includes(itemName) && remaining > 1) {
                  player.bankItems[emptyIdx] = `${itemName}:${remaining}`;
              } else {
                  player.bankItems[emptyIdx] = itemName;
              }
          }

          // Recalcula peso
          this.recalculateWeight(player);
          this.recalculateStats(player);

          // Salva no banco de dados
          savePlayerToDB(player).catch(e => console.error('Error saving bank item:', e));

          socket.emit('statsUpdate', {
              id: player.id, level: player.level, experience: player.experience, gold: player.gold,
              stats: player.stats, statPoints: player.statPoints,
              attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
              hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
              sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
              health: player.health, maxHealth: player.maxHealth
          });

          socket.emit('inventoryUpdate', player.backpack);
          socket.emit('bank:update', {
              bankGold: player.bankGold,
              bankItems: player.bankItems || [],
              bankDebtDays: player.bankDebtDays
          });
      });

      // Banco: Organizar Itens
      socket.on('bank:sort', () => {
          const player = this.players.get(socket.id);
          if (!player || !player.bankItems) return;

          // Valida distância do Banqueiro
          const banker = Array.from(this.players.values()).find(p => p.name === 'Banker');
          if (!banker) return;
          const dist = Math.abs(player.x - banker.x) + Math.abs(player.y - banker.y);
          if (dist > CONFIG.bankDistanceCheck) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito longe!', color: '#ff5555' });
              return;
          }

          player.bankItems = this.sortItemList(player.bankItems, 50);
          savePlayerToDB(player).catch(e => console.error('Error saving sorted bank:', e));
          socket.emit('bank:update', {
              bankGold: player.bankGold,
              bankItems: player.bankItems,
              bankDebtDays: player.bankDebtDays
          });
      });

      // Mochila: Organizar Itens
      socket.on('backpack:sort', () => {
          const player = this.players.get(socket.id);
          if (!player || !player.backpack) return;

          const maxSlots = this.getMaxBackpackSlots(player);
          player.backpack = this.sortItemList(player.backpack, maxSlots);
          this.recalculateWeight(player);

          savePlayerToDB(player).catch(e => console.error('Error saving sorted backpack:', e));
          socket.emit('inventoryUpdate', player.backpack);
          socket.emit('statsUpdate', { id: player.id, weight: player.weight, maxWeight: player.maxWeight });
      });

      // Banco: Retirar Item
      socket.on('bank:withdrawItem', (data: { bankIndex: number, backpackIndex: number }) => {
          const player = this.players.get(socket.id);
          if (!player || player.isDead || !player.backpack || !player.bankItems) return;

          // Valida distância do Banqueiro
          const banker = Array.from(this.players.values()).find(p => p.name === 'Banker');
          if (!banker) return;
          const dist = Math.abs(player.x - banker.x) + Math.abs(player.y - banker.y);
          if (dist > CONFIG.bankDistanceCheck) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito longe!', color: '#ff5555' });
              return;
          }

          // Verifica se a conta está bloqueada
          if ((player.bankDebtDays || 0) < 0 || (player.bankGold || 0) <= 0) {
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Conta bloqueada!', color: '#ff5555' });
              return;
          }

          const { bankIndex, backpackIndex } = data;
          if (bankIndex < 0 || bankIndex >= CONFIG.bankSlots) return;

          const bankItem = player.bankItems[bankIndex];
          if (!bankItem) return;

          if (backpackIndex === -1) {
              // Retira para o primeiro slot livre da mochila
              const maxSlots = this.getMaxBackpackSlots(player);
              if (player.backpack.length >= maxSlots) {
                  socket.emit('textEffect', { x: player.x, y: player.y, message: 'Mochila Cheia!', color: '#ff5555' });
                  return;
              }

              // Se o item for empilhável, tenta empilhar
              const [itemName, countStr] = bankItem.split(':');
              const count = parseInt(countStr) || 1;
              const stackableItems = ['Apple', 'Cheese', 'Health Potion', 'Mana Potion', 'Blueberry', 'Iron Ore', 'Wood Log', 'Medicinal Herb', 'Leather Hide'];
              let stacked = false;

              if (stackableItems.includes(itemName)) {
                  for (let i = 0; i < player.backpack.length; i++) {
                      const slot = player.backpack[i];
                      const [bpName, bpCountStr] = slot.split(':');
                      const bpCount = parseInt(bpCountStr) || 1;
                      
                      if (bpName === itemName && bpCount < 99) {
                          player.backpack[i] = `${bpName}:${bpCount + 1}`;
                          stacked = true;
                          break;
                      }
                  }
              }

              if (stacked) {
                  // Se era um stack no banco, deduz 1, senão limpa o slot do banco
                  if (count > 1) {
                      player.bankItems[bankIndex] = `${itemName}:${count - 1}`;
                  } else {
                      player.bankItems[bankIndex] = '';
                  }
              } else {
                  // Adiciona como novo slot se couber
                  const itemWeight = ITEM_WEIGHTS[itemName] || 5;
                  if (player.weight + itemWeight > (player.maxWeight || 250)) {
                      socket.emit('textEffect', { x: player.x, y: player.y, message: 'Muito Pesado!', color: '#ff5555' });
                      return;
                  }
                  
                  // Se tinha mais de 1 stack no banco, retira 1
                  if (count > 1) {
                      player.bankItems[bankIndex] = `${itemName}:${count - 1}`;
                      player.backpack.push(`${itemName}:1`);
                  } else {
                      player.bankItems[bankIndex] = '';
                      player.backpack.push(bankItem);
                  }
              }
          } else {
              // Swap com o backpackIndex especificado
              if (backpackIndex < 0 || backpackIndex >= player.backpack.length) return;
              const bpItem = player.backpack[backpackIndex];
              player.backpack[backpackIndex] = bankItem;
              player.bankItems[bankIndex] = bpItem;

              player.backpack = player.backpack.filter(slot => slot !== '' && slot !== null);
          }

          // Recalcula peso
          this.recalculateWeight(player);
          this.recalculateStats(player);

          // Salva no banco de dados
          savePlayerToDB(player).catch(e => console.error('Error saving bank item:', e));

          socket.emit('statsUpdate', { 
              id: player.id, level: player.level, experience: player.experience, gold: player.gold,
              stats: player.stats, statPoints: player.statPoints,
              attack: player.attack, matk: player.matk, def: player.def, mdef: player.mdef,
              hit: player.hit, dodge: player.dodge, crit: player.crit, aspd: player.aspd,
              sp: player.sp, maxSp: player.maxSp, weight: player.weight, maxWeight: player.maxWeight,
              health: player.health, maxHealth: player.maxHealth
          });

          socket.emit('inventoryUpdate', player.backpack);
          socket.emit('bank:update', {
              bankGold: player.bankGold,
              bankItems: player.bankItems || [],
              bankDebtDays: player.bankDebtDays
          });
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
          
          // Taxa de serviço
          const fee = recipe.craftFee || 0;
          if (fee > 0) {
              if ((player.gold || 0) < fee) {
                  socket.emit('textEffect', { x: player.x, y: player.y, message: 'Gold insuficiente!', color: '#ff5555' });
                  return;
              }
              player.gold = (player.gold || 0) - fee;
          }
          
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
                  gold: player.gold,
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
          
          // XP de profissão ao desmontar
          let xpField: 'professionSmithingXp' | 'professionAlchemyXp' | 'professionTanningXp' | null = null;
          let lvlField: 'professionSmithingLevel' | 'professionAlchemyLevel' | 'professionTanningLevel' | null = null;
          if (recipe.profession === 'smithing') { xpField = 'professionSmithingXp'; lvlField = 'professionSmithingLevel'; }
          else if (recipe.profession === 'alchemy') { xpField = 'professionAlchemyXp'; lvlField = 'professionAlchemyLevel'; }
          else if (recipe.profession === 'tanning') { xpField = 'professionTanningXp'; lvlField = 'professionTanningLevel'; }
          if (xpField && lvlField) {
              const currentLvl = player[lvlField] || 1;
              const currentXp = player[xpField] || 0;
              const xpGained = 8;
              const nextLvlXp = currentLvl * 100;
              let newXp = currentXp + xpGained;
              let newLvl = currentLvl;
              if (newXp >= nextLvlXp) {
                  newXp -= nextLvlXp;
                  newLvl++;
                  socket.emit('textEffect', { x: player.x, y: player.y, message: 'Nível de Profissão Subiu!', color: '#eab308' });
              }
              player[xpField] = newXp;
              player[lvlField] = newLvl;
          }

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
          if (dist > CONFIG.bankDistanceCheck) return;
          
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

    // Respawn gradual de monstros (Fase 4a) — a cada 20 ticks (1s)
    if (this.ticks % 20 === 0) {
        this.processPendingRespawns();
    }

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

    // Sistema de Ciclo de Dia e Noite (configurável via CONFIG.dayDurationTicks / nightDurationTicks)
    const dayTicks = CONFIG.dayDurationTicks;
    const nightTicks = CONFIG.nightDurationTicks;
    const cycleTotal = dayTicks + nightTicks;
    const cycle = this.ticks % cycleTotal;
    
    if (cycle === 0) {
        this.isNight = false;
        this.io.emit('timeUpdate', { isNight: this.isNight });
        // Reseta o estoque diário dos vendedores
        for (const v of CITY_VENDORS) {
            v.soldToday = {};
        }
        // Reseta quests entregues (available again)
        this.players.forEach(p => {
            if (!p.isMonster && p.quests) {
                let changed = false;
                for (const qId of Object.keys(p.quests)) {
                    if (p.quests[qId].rewarded) {
                        delete p.quests[qId];
                        changed = true;
                    }
                }
                if (changed) savePlayerToDB(p).catch(() => {});
            }
        });
        const msg = 'O sol nasce. Você está seguro por enquanto.';
        
        // Dedução da taxa do Banqueiro
        const onlineNames: string[] = [];
        this.players.forEach(p => {
            if (!p.isMonster) {
                onlineNames.push(p.name);
                let bankGold = p.bankGold ?? 0;
                let bankDebtDays = p.bankDebtDays ?? 0;

                if (bankGold > 0) {
                    bankGold -= CONFIG.bankDailyFee;
                } else {
                    if (bankDebtDays > CONFIG.bankMaxDebtDays) {
                        bankDebtDays -= 1; // limite de CONFIG.bankMaxDebtDays
                    }
                }
                p.bankGold = bankGold;
                p.bankDebtDays = bankDebtDays;

                const playerSocket = this.io.sockets.sockets.get(p.id);
                if (playerSocket) {
                    playerSocket.emit('bank:update', {
                        bankGold: p.bankGold,
                        bankItems: p.bankItems || [],
                        bankDebtDays: p.bankDebtDays
                    });
                    playerSocket.emit('textEffect', { x: p.x, y: p.y, message: `Tarifa do Banco (-${CONFIG.bankDailyFee} Ouro)`, color: '#ffaa00' });
                }
            }
        });

        // Dedução para jogadores offline no banco de dados
        deductOfflineBankGold(onlineNames, CONFIG.bankMaxDebtDays, CONFIG.bankDailyFee).catch(err => console.error('Erro ao debitar banco offline:', err));

        this.players.forEach(p => {
            if (!p.isMonster) {
                this.io.emit('textEffect', { x: p.x, y: p.y, message: msg, color: '#ffff00' });
            } else if (p.id.startsWith('night_') || p.id.startsWith('city_boss_')) {
                // Remove monstros da noite e bosses de cidade
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
    } else if (cycle === dayTicks) {
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

        // ===== Bosses Noturnos por Cidade de Monstro (Fase 3) =====
        for (const city of MONSTER_CITIES) {
            if (Math.random() > CONFIG.cityBossSpawnChance) continue; // chance de spawn
            // Posição: centro da cidade
            const cx = Math.floor((city.bounds.xMin + city.bounds.xMax) / 2);
            const cy = Math.floor((city.bounds.yMin + city.bounds.yMax) / 2);
            const cityBoss: PlayerData = {
                id: `city_boss_${city.id}`,
                name: city.bossName,
                x: cx,
                y: cy,
                health: city.bossStats.health,
                maxHealth: city.bossStats.health,
                speed: city.bossStats.speed,
                isMonster: true,
                level: 5 + city.minLevel, // nível proporcional
                experience: 0,
                attack: city.bossStats.attack
            };
            this.players.set(cityBoss.id, cityBoss);
            this.io.emit('newPlayer', cityBoss);
            // Anúncio global
            this.players.forEach(p => {
                if (!p.isMonster) {
                    this.io.to(p.id).emit('textEffect', { x: p.x, y: p.y, message: `👹 ${city.bossName} apareceu em ${city.name}!`, color: '#ef4444' });
                }
            });
        }
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
                      // NPCs são imunes a monstros (teleporter, vendor, banker, merchant)
                      if (!p.isMonster && !(p as any).isNPC) {
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

              // Verifica colisão: monsterWalls (paredes + portões) + safe zones
              // (monstros não entram na safe zone nem passam por portões)
              if (!this.monsterWalls.has(`${targetX},${targetY}`) && !isInSafeZone(targetX, targetY)) {
                  entity.x = targetX;
                  entity.y = targetY;
                  this.io.emit('playerMoved', entity);
              }
             }
      });
    }

    // Regeneração Passiva do Jogador (intervalo configurável)
    if (this.ticks % CONFIG.regenIntervalTicks === 0) {
        this.players.forEach((entity) => {
            if (!entity.isMonster && !entity.isDead && !(entity as any).isNPC) {
                let updated = false;

                // Safe Zone da Cidade: regenera HP e Mana a 100% (segue bounds do CONFIG)
                const cb = CONFIG.cityBounds;
                const inCity = entity.x >= cb.xMin && entity.x <= cb.xMax && entity.y >= cb.yMin && entity.y <= cb.yMax;
                const maxSp = entity.maxSp || 50;

                if (inCity) {
                    if (entity.health < entity.maxHealth) {
                        const healed = entity.maxHealth - entity.health;
                        entity.health = entity.maxHealth;
                        this.io.emit('playerDamaged', { id: entity.id, health: entity.health, maxHealth: entity.maxHealth, amount: -healed });
                        updated = true;
                    }
                    if ((entity.sp || 0) < maxSp) {
                        entity.sp = maxSp;
                        updated = true;
                    }
                } else {
                    // Regenera HP (campo aberto) - usa rates do CONFIG
                    if (entity.health < entity.maxHealth) {
                        const vit = entity.stats?.VIT || 5;
                        const regen = CONFIG.hpRegenBase + Math.floor(vit / CONFIG.hpRegenPerVit);
                        entity.health = Math.min(entity.maxHealth, entity.health + regen);
                        this.io.emit('playerDamaged', { id: entity.id, health: entity.health, maxHealth: entity.maxHealth, amount: -regen });
                        updated = true;
                    }

                    // Regenera SP (Mana) - usa rates do CONFIG
                    if ((entity.sp || 0) < maxSp) {
                        const intVal = entity.stats?.INT || 5;
                        const regenSp = CONFIG.spRegenBase + Math.floor(intVal / CONFIG.spRegenPerInt);
                        entity.sp = Math.min(maxSp, (entity.sp || 0) + regenSp);
                        updated = true;
                    }
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
                // Colisão com entidades (monstros ou players) — NPCs são imunes
                for (const [id, entity] of this.players.entries()) {
                    if (entity.id !== p.casterId && entity.x === p.x && entity.y === p.y && !entity.isDead && !(entity as any).isNPC) {
                        // Safe zone check para projeteis
                        const casterPlayer = this.players.get(p.casterId);
                        if (!entity.isMonster && casterPlayer && !casterPlayer.isMonster) {
                             const inCity = (x: number, y: number) => {
                           const cb = CONFIG.cityBounds;
                           return x >= cb.xMin && x <= cb.xMax && y >= cb.yMin && y <= cb.yMax;
                       };
                             if (inCity(entity.x, entity.y)) continue;
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
                   const cooldown = player.aspd || (player.isMonster ? CONFIG.baseMonsterCooldownMs : CONFIG.basePlayerCooldownMs);
                   
                   if (now - lastAttack >= cooldown) {
                      // Safe zone check PvP
                      if (!player.isMonster && !target.isMonster) {
                           const inCity = (x: number, y: number) => {
                           const cb = CONFIG.cityBounds;
                           return x >= cb.xMin && x <= cb.xMax && y >= cb.yMin && y <= cb.yMax;
                       };
                           if (inCity(player.x, player.y) || inCity(target.x, target.y)) {
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
            const dayTicks = CONFIG.dayDurationTicks;
            const nightTicks = CONFIG.nightDurationTicks;
            const cycleTotal = dayTicks + nightTicks;
            const cycle = this.ticks % cycleTotal;
            const isNight = cycle >= dayTicks;
            const ticksInPhase = isNight ? (cycle - dayTicks) : cycle;
            const phaseDuration = isNight ? nightTicks : dayTicks;
           const secondsLeft = Math.floor((phaseDuration - ticksInPhase) / 20);
           this.io.emit('timeSync', { isNight, secondsLeft });
       }
    }
  }
  /**
   * Processa a fila de monstros pendentes de respawn. A cada 1s, revive
   * os que já cumpriram o timer. (Fase 4a — Respawn gradual)
   */
  private processPendingRespawns() {
      const now = Date.now();
      const toRespawn: string[] = [];
      this.pendingRespawns.forEach((respawnAt, id) => {
          if (now >= respawnAt) toRespawn.push(id);
      });
      for (const id of toRespawn) {
          const m = this.players.get(id);
          if (!m) { this.pendingRespawns.delete(id); continue; }
          const spawn = this.monsterSpawnData.get(id);
          if (!spawn) { this.pendingRespawns.delete(id); continue; }
          // Calcula posição de respawn
          let newX = spawn.x;
          let newY = spawn.y;
          if (spawn.bounds) {
              // Cidade: spawn aleatório dentro dos bounds (evita paredes + portões)
              let attempts = 0;
              do {
                  newX = Math.floor(Math.random() * (spawn.bounds.xMax - spawn.bounds.xMin + 1)) + spawn.bounds.xMin;
                  newY = Math.floor(Math.random() * (spawn.bounds.yMax - spawn.bounds.yMin + 1)) + spawn.bounds.yMin;
                  attempts++;
              } while (this.monsterWalls.has(`${newX},${newY}`) && attempts < 20);
          }
          // Revive o monstro
          m.isDead = false;
          m.health = m.maxHealth;
          m.x = newX;
          m.y = newY;
          m.targetId = undefined;
          this.pendingRespawns.delete(id);
          // Anuncia para todos
          this.io.emit('playerMoved', m);
          this.io.emit('textEffect', { x: newX, y: newY, message: `👹 ${m.name} reviveu`, color: '#888888' });
      }
  }

  private checkDeath(attacker: PlayerData, target: PlayerData) {
     if (target.health <= 0 && !target.isDead) {
        target.isDead = true;
        
        // Lógica de Respawn e Loot
        if (target.isMonster) {
            // Da Experiencia dependendo do monstro (configurável)
            let expReward = CONFIG.expByMonster[target.name] ?? 50;
            // Boss de cidade dá EXP extra (definida em bossStats)
            const isBoss = target.id.startsWith('city_boss_') || target.id === 'night_boss';
            if (target.id.startsWith('city_boss_')) {
                const city = MONSTER_CITIES.find(c => `city_boss_${c.id}` === target.id);
                if (city) expReward = city.bossStats.exp;
            }
            // Anúncio global quando um Boss é morto
            if (isBoss) {
                const bossName = target.name;
                const heroName = attacker.name;
                const msg = `${heroName} matou ${bossName}!`;
                this.players.forEach(p => {
                    if (!p.isMonster) {
                        this.io.to(p.id).emit('textEffect', { x: p.x, y: p.y, message: `🔥 ${msg}`, color: '#ef4444' });
                    }
                });
                this.io.emit('playerSpoke', { id: '__system__', message: `🔥 ${msg}` });
            }
            attacker.experience += expReward;

            // Ouro direto = nível do monstro * multiplicador (não dropa Gold Coin)
            const goldReward = (target.level || 1) * CONFIG.goldByLevel;
            attacker.gold = (attacker.gold || 0) + goldReward;
            this.io.emit('textEffect', { x: target.x, y: target.y, message: `+${goldReward} Ouro`, color: '#fbbf24' });
            this.io.to(attacker.id).emit('statsUpdate', { id: attacker.id, gold: attacker.gold });

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

            // Atualiza progresso de quests (kill)
            if (target.name) {
                this.updateQuestProgress(attacker, 'kill', target.name);
            }

            // Texto visual de XP ganha em cima do corpo do monstro
            this.io.emit('textEffect', { x: target.x, y: target.y, text: `+${expReward} EXP`, color: '#fbbf24' });

            // Loot via drop table configurável
            const itemName = rollDropTable(target.name);
            if (itemName) {
                const dropId = `item_${Math.random().toString(36).substring(2, 9)}`;
                const dropItem = { id: dropId, name: itemName, x: target.x, y: target.y, emoji: getItemIcon(itemName) };
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
                            if (p.weight + weight <= (p.maxWeight || CONFIG.maxWeightBase)) {
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
            }
            
            // Tira do mapa
            target.x = -100;
            target.y = -100;
            this.io.emit('playerMoved', target);

            // Agenda respawn gradual (Fase 4a)
            const jitter = Math.floor(Math.random() * CONFIG.monsterRespawnJitterMs);
            const respawnAt = Date.now() + CONFIG.monsterRespawnMs + jitter;
            this.pendingRespawns.set(target.id, respawnAt);
        } else {
            // Player morreu (PvP)!
            target.isDead = true;
            target.health = 0;
            attacker.targetId = undefined; // Atacante perde o target

            // PvP: 10 ouro direto para o vencedor
            const pvpGold = CONFIG.pvpGoldReward;
            attacker.gold = (attacker.gold || 0) + pvpGold;
            this.io.to(attacker.id).emit('statsUpdate', { id: attacker.id, gold: attacker.gold });
            this.io.emit('textEffect', { x: attacker.x, y: attacker.y, message: `+${pvpGold} Ouro (PvP)`, color: '#fbbf24' });

            // PvP: Skull com nome do derrotado no chão
            const skullId = `item_${Math.random().toString(36).substring(2, 9)}`;
            const skullItem = {
                id: skullId,
                name: 'Skull',
                x: target.x,
                y: target.y,
                emoji: '💀',
                metadata: { ofPlayer: target.name }
            };
            this.itemsOnFloor.set(skullId, skullItem);
            this.io.emit('itemDropped', skullItem);

            // Lógica de perder itens do inventário (30% de chance de perder cada slot de item)
            const lostItems: string[] = [];
            if (target.backpack && target.backpack.length > 0) {
                for (let i = target.backpack.length - 1; i >= 0; i--) {
                    if (Math.random() < CONFIG.pvpItemLossChance) { // chance configurável de perder o slot
                        const itemString = target.backpack[i];
                        const [itemName, countStr] = itemString.split(':');
                        target.backpack.splice(i, 1);

                        // Spawna no chão onde o jogador morreu
                        const dropId = `item_${Math.random().toString(36).substring(2, 9)}`;
                        const dropItem = { id: dropId, name: itemName, x: target.x, y: target.y, emoji: getItemIcon(itemName) };
                        this.itemsOnFloor.set(dropId, dropItem);
                        this.io.emit('itemDropped', dropItem);

                        lostItems.push(itemName);
                    }
                }
            }

            this.recalculateWeight(target);

            // Envia o sinal de morte e os itens perdidos para o jogador local
            this.io.to(target.id).emit('playerDied', { lostItems, killer: attacker.name });

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

  private sendQuestData(socket: any, player: PlayerData) {
      if (!player.quests) player.quests = {};
      const now = Date.now();
      const result: any[] = [];
      for (const [questId, progress] of Object.entries(player.quests)) {
          const quest = QUESTS.find(q => q.id === questId);
          if (!quest) continue;
          // Marca como expirada
          if (!progress.rewarded && progress.expiresAt && now > progress.expiresAt) {
              (progress as any).expired = true;
          }
          result.push({
              questId,
              title: quest.title,
              description: quest.description,
              objectives: quest.objectives.map((obj, i) => ({
                  ...obj,
                  current: progress.objectives?.[i] ?? 0,
              })),
              rewards: quest.rewards,
              objectivesComplete: progress.objectivesComplete || false,
              rewarded: progress.rewarded || false,
              expired: (progress as any).expired || false,
          });
      }
      socket.emit('quest:data', { quests: result });
  }

  private emitQuestProgress(socketId: string, player: PlayerData) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) this.sendQuestData(socket, player);
  }

  private updateQuestProgress(player: PlayerData, type: 'kill' | 'craft', targetName: string) {
      if (!player.quests) return;
      let changed = false;
      const now = Date.now();
      for (const [questId, progress] of Object.entries(player.quests)) {
          if (progress.rewarded) continue;
          if (progress.expiresAt && now > progress.expiresAt) {
              (progress as any).expired = true;
              changed = true;
              continue;
          }
          if (progress.objectivesComplete) continue;
          const quest = QUESTS.find(q => q.id === questId);
          if (!quest) continue;
          quest.objectives.forEach((obj, i) => {
              if (obj.type === type && obj.target === targetName) {
                  const current = progress.objectives?.[i] ?? 0;
                  if (current < obj.count) {
                      if (!progress.objectives) progress.objectives = {};
                      progress.objectives[i] = current + 1;
                      changed = true;
                  }
              }
          });
          // Verifica se completou os objetivos
          if (quest.objectives.every((obj, i) => (progress.objectives?.[i] ?? 0) >= obj.count)) {
              progress.objectivesComplete = true;
              changed = true;
          }
      }
      if (changed) {
          savePlayerToDB(player).catch(() => {});
          this.emitQuestProgress(player.id, player);
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

  /**
   * Organiza uma lista de itens: empilha stacks do mesmo item (até 99),
   * mantém a ordem de prioridade (stackables primeiro, depois alfabético).
   * Preenche o restante com strings vazias até o maxSlots.
   */
  private sortItemList(items: string[], maxSlots: number): string[] {
      const stackableItems = ['Apple', 'Cheese', 'Health Potion', 'Mana Potion', 'Blueberry', 'Iron Ore', 'Wood Log', 'Medicinal Herb', 'Leather Hide', 'Gold Coin'];

      type Entry = { name: string; count: number; isJson: boolean; jsonStr?: string };
      const stackMap = new Map<string, number>();
      const unique: Entry[] = [];

      for (const raw of items) {
          if (!raw) continue;
          let name = raw;
          let count = 1;
          let isJson = false;
          let jsonStr: string | undefined;
          if (raw.startsWith('{')) {
              isJson = true;
              jsonStr = raw;
              try { name = JSON.parse(raw).name; } catch (e) {}
          } else if (raw.includes(':')) {
              const [n, c] = raw.split(':');
              name = n;
              count = parseInt(c) || 1;
          }

          if (stackableItems.includes(name) && !isJson) {
              stackMap.set(name, (stackMap.get(name) || 0) + count);
          } else {
              unique.push({ name, count, isJson, jsonStr });
          }
      }

      // Constrói stacks (até 99 por slot)
      const result: string[] = [];
      for (const [name, total] of stackMap) {
          let remaining = total;
          while (remaining > 0) {
              const chunk = Math.min(99, remaining);
              result.push(`${name}:${chunk}`);
              remaining -= chunk;
          }
      }
      // Itens únicos (não-stackable ou JSON) ordenados por nome
      unique.sort((a, b) => a.name.localeCompare(b.name));
      for (const u of unique) {
          result.push(u.isJson ? u.jsonStr! : u.name);
      }

      // Preenche até maxSlots com vazios
      while (result.length < maxSlots) result.push('');
      // Trunca se passou do limite
      return result.slice(0, maxSlots);
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
              await deletePlayerFromDB(name);
              this.io.emit('admin:playerUpdated');
          } catch(e) {
              console.error('Erro ao excluir conta:', e);
          }
      });

      socket.on('admin:resetPassword', async (data: { name: string, newPass: string }) => {
          try {
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

      // ============ Config do Servidor (página admin) ============
      socket.on('admin:getConfig', () => {
          socket.emit('admin:configData', CONFIG);
      });

      socket.on('admin:setConfig', (partial: Partial<ServerConfig>) => {
          try {
              // Aplica cada chave recebida (campos top-level + dropTables + expByMonster + cityBounds)
              for (const key of Object.keys(partial) as (keyof ServerConfig)[]) {
                  if (key in CONFIG) {
                      (CONFIG as any)[key] = (partial as any)[key];
                  }
              }
              saveConfigToDB('main', CONFIG);
              this.io.emit('admin:configData', CONFIG); // broadcast pra todos os GMs conectados
              this.io.emit('textEffect', { x: 20, y: 15, message: '[CONFIG] Configuração atualizada pelo GM', color: '#fbbf24' });
              console.log('[CONFIG] Atualizado pelo GM:', Object.keys(partial).join(', '));
          } catch (err) {
              console.error('admin:setConfig error:', err);
              socket.emit('textEffect', { x: 20, y: 15, message: 'Erro ao salvar config!', color: '#ff5555' });
          }
      });

      socket.on('admin:resetConfig', () => {
          resetConfigToDefaults();
          saveConfigToDB('main', CONFIG);
          this.io.emit('admin:configData', CONFIG);
          this.io.emit('textEffect', { x: 20, y: 15, message: '[CONFIG] Resetado para os padrões', color: '#fbbf24' });
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
            const dropItem = { id: dropId, name: data.name, x: spawnX, y: spawnY, emoji: getItemIcon(data.name) };
            this.itemsOnFloor.set(dropId, dropItem);
            this.io.emit('itemDropped', dropItem);
        });

        // ============ Admin: NPC Vendors ============
        socket.on('admin:getVendors', () => {
            // Retorna a configuração atual dos vendors (inclui os da praça se houver)
            const vendors = CITY_VENDORS.map(v => ({
                id: v.id,
                name: v.name,
                x: v.x,
                y: v.y,
                cityId: v.cityId || 'plaza',
                stock: v.stock.map(s => ({ ...s }))
            }));
            socket.emit('admin:vendorsData', vendors);
        });

        socket.on('admin:setVendorStock', (data: { vendorId: string, stock: Array<{ name: string, emoji: string, price: number, dailyStock?: number }> }) => {
            const vendorIdx = CITY_VENDORS.findIndex(v => v.id === data.vendorId);
            if (vendorIdx >= 0) {
                CITY_VENDORS[vendorIdx].stock = data.stock.map(s => ({ name: s.name, emoji: s.emoji || '📦', price: Math.max(1, s.price || 1), dailyStock: Math.max(1, s.dailyStock || 10) }));
                this.io.emit('admin:vendorsData', CITY_VENDORS.map(v => ({
                    id: v.id,
                    name: v.name,
                    x: v.x,
                    y: v.y,
                    cityId: v.cityId || 'plaza',
                    stock: v.stock.map(s => ({ ...s }))
                })));
                // Atualiza o NPC vendor online se estiver conectado
                const vendorNpc = this.players.get(data.vendorId);
                if (vendorNpc && (vendorNpc as any).isNPC && (vendorNpc as any).npcType === 'vendor') {
                    // O estoque é lido direto do CITY_VENDORS na interação, não precisa atualizar o NPC
                }
                socket.emit('textEffect', { x: 0, y: 0, message: `✅ Estoque de ${CITY_VENDORS[vendorIdx]?.name || data.vendorId} atualizado!`, color: '#10b981' });
            } else {
                socket.emit('textEffect', { x: 0, y: 0, message: `❌ Vendor ${data.vendorId} não encontrado!`, color: '#ef4444' });
            }
        });

        // ============ Admin: NPC Crafting Stations ============
        socket.on('admin:getCrafters', () => {
            const stations = Array.from(this.craftingStations.values()).map(s => ({
                id: s.id,
                type: s.type,
                name: s.name,
                emoji: s.emoji,
                x: s.x,
                y: s.y
            }));
            socket.emit('admin:craftersData', {
                stations,
                recipes: CRAFTING_RECIPES.map(r => ({ ...r }))
            });
        });

        // ============ Admin: Save Recipe ============
        socket.on('admin:setRecipe', (data: { recipe: Recipe }) => {
            const idx = CRAFTING_RECIPES.findIndex(r => r.id === data.recipe.id);
            if (idx >= 0) {
                CRAFTING_RECIPES[idx] = data.recipe;
            } else {
                CRAFTING_RECIPES.push(data.recipe);
            }
            socket.emit('textEffect', { x: 0, y: 0, message: `✅ Receita ${data.recipe.name} salva!`, color: '#10b981' });
        });

        // ============ Admin: Delete Recipe ============
        socket.on('admin:deleteRecipe', (data: { recipeId: string }) => {
            const idx = CRAFTING_RECIPES.findIndex(r => r.id === data.recipeId);
            if (idx >= 0) {
                CRAFTING_RECIPES.splice(idx, 1);
                socket.emit('textEffect', { x: 0, y: 0, message: `✅ Receita removida!`, color: '#10b981' });
            }
        });

        // ============ Admin: NPC Teleporters ============
        socket.on('admin:getTeleporters', () => {
            const teleporters = [
                { id: PLAZA_TELEPORTER.id, name: PLAZA_TELEPORTER.name, x: PLAZA_TELEPORTER.x, y: PLAZA_TELEPORTER.y, kind: PLAZA_TELEPORTER.kind },
                { id: CAVERNA_TELEPORTER.id, name: CAVERNA_TELEPORTER.name, x: CAVERNA_TELEPORTER.x, y: CAVERNA_TELEPORTER.y, kind: CAVERNA_TELEPORTER.kind },
                ...CITY_TELEPORTERS.map(t => ({ id: t.id, name: t.name, x: t.x, y: t.y, kind: t.kind, cityId: t.cityId }))
            ];
            socket.emit('admin:teleportersData', teleporters);
        });

        // ============ Admin: Quests ============
        socket.on('admin:getQuests', () => {
            socket.emit('admin:questsData', QUESTS.map(q => ({ ...q, objectives: q.objectives.map(o => ({ ...o })), rewards: { ...q.rewards } })));
        });

        socket.on('admin:setQuest', (data: { quest: Quest }) => {
            const idx = QUESTS.findIndex(q => q.id === data.quest.id);
            if (idx >= 0) {
                QUESTS[idx] = data.quest;
            } else {
                QUESTS.push(data.quest);
            }
            socket.emit('textEffect', { x: 0, y: 0, message: `✅ Quest ${data.quest.title} salva!`, color: '#10b981' });
        });

        socket.on('admin:deleteQuest', (data: { questId: string }) => {
            const idx = QUESTS.findIndex(q => q.id === data.questId);
            if (idx >= 0) {
                QUESTS.splice(idx, 1);
                socket.emit('textEffect', { x: 0, y: 0, message: `✅ Quest removida!`, color: '#10b981' });
            }
        });

        // ============ Player: Quest Progress ============
        socket.on('quest:accept', (data: { questId: string }) => {
            const player = this.players.get(socket.id);
            if (!player) return;
            const quest = QUESTS.find(q => q.id === data.questId);
            if (!quest) return;
            if (!player.quests) player.quests = {};
            if (player.quests[data.questId]) return;
            const expiredAt = quest.expiresAfterMin ? Date.now() + quest.expiresAfterMin * 60000 : undefined;
            player.quests[data.questId] = {
                started: true,
                objectives: {},
                acceptedAt: Date.now(),
                expiresAt: expiredAt,
            };
            savePlayerToDB(player).catch(() => {});
            socket.emit('textEffect', { x: player.x, y: player.y, message: `✅ Quest "${quest.title}" aceita!`, color: '#10b981' });
        });

        socket.on('quest:list', () => {
            const player = this.players.get(socket.id);
            if (!player) return;
            this.sendQuestData(socket, player);
        });

        socket.on('quest:turnin', (data: { questId: string }) => {
            const player = this.players.get(socket.id);
            if (!player) return;
            if (!player.quests || !player.quests[data.questId]) return;
            const progress = player.quests[data.questId];
            if (!progress.objectivesComplete || progress.rewarded) return;
            const quest = QUESTS.find(q => q.id === data.questId);
            if (!quest) return;
            // Valida proximidade do NPC
            const npc = this.players.get(quest.npcId);
            if (npc) {
                const dist = Math.abs(npc.x - player.x) + Math.abs(npc.y - player.y);
                if (dist > 3) {
                    socket.emit('textEffect', { x: player.x, y: player.y, message: 'Chegue mais perto do NPC!', color: '#ff5555' });
                    return;
                }
            }
            // Dá as recompensas
            if (quest.rewards.xp) {
                player.experience = (player.experience || 0) + quest.rewards.xp;
                let leveledUp = false;
                while (player.experience >= player.level * 100) {
                    player.experience -= player.level * 100;
                    player.level += 1;
                    player.maxHealth += 10;
                    player.statPoints = (player.statPoints || 0) + 5;
                    leveledUp = true;
                }
                if (leveledUp) {
                    this.recalculateStats(player);
                    player.health = player.maxHealth;
                    this.io.emit('levelUp', { id: player.id, level: player.level });
                    this.io.emit('textEffect', { x: player.x, y: player.y, message: 'Subiu de Nível!', color: '#ffff00' });
                }
            }
            if (quest.rewards.gold) {
                player.gold = (player.gold || 0) + quest.rewards.gold;
                this.io.to(player.id).emit('statsUpdate', { id: player.id, gold: player.gold });
            }
            if (quest.rewards.professionXp) {
                for (const [prof, amt] of Object.entries(quest.rewards.professionXp)) {
                    const xpField = `profession${prof.charAt(0).toUpperCase() + prof.slice(1)}Xp` as keyof PlayerData;
                    const lvlField = `profession${prof.charAt(0).toUpperCase() + prof.slice(1)}Level` as keyof PlayerData;
                    const currXp = (player[xpField] as number) || 0;
                    let newXp = currXp + (amt as number);
                    let newLvl = (player[lvlField] as number) || 1;
                    while (newXp >= newLvl * 100) {
                        newXp -= newLvl * 100;
                        newLvl++;
                    }
                    (player as any)[xpField] = newXp;
                    (player as any)[lvlField] = newLvl;
                }
            }
            progress.rewarded = true;
            savePlayerToDB(player).catch(() => {});
            socket.emit('quest:reward', { questId: data.questId, rewards: quest.rewards });
            socket.emit('textEffect', { x: player.x, y: player.y, message: `🎁 Quest "${quest.title}" entregue!`, color: '#10b981' });
            // Re-envia estado atualizado pro cliente
            this.sendQuestData(socket, player);
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

         // ============================================================
         // Interação com NPCs (teleporter / vendor) — substitui portais
         // ============================================================

         // Cliente clicou num NPC; servidor valida proximidade e responde
         socket.on('npc:interact', (data: { npcId: string }) => {
             console.log(`[NPC] npc:interact de ${socket.id} npcId=${data.npcId}`);
             const player = this.players.get(socket.id);
             if (!player || player.isDead) return;
             const npc = this.players.get(data.npcId);
             if (!npc || !(npc as any).isNPC) {
                 console.log(`[NPC] NPC inválido: npc=${!!npc} isNPC=${npc ? (npc as any).isNPC : 'n/a'}`);
                 socket.emit('textEffect', { x: player.x, y: player.y, message: 'NPC inválido.', color: '#ff5555' });
                 return;
             }
             const npcType = (npc as any).npcType;
             console.log(`[NPC] npc:interact válido npcId=${data.npcId} npcType=${npcType} pos=(${npc.x},${npc.y}) playerPos=(${player.x},${player.y})`);
             // Valida distância (≤ 2 tiles)
             const dist = Math.abs(npc.x - player.x) + Math.abs(npc.y - player.y);
             if (dist > 2) {
                 socket.emit('textEffect', { x: player.x, y: player.y, message: 'Chegue mais perto!', color: '#ff5555' });
                 return;
             }
              if (npcType === 'teleporter') {
                  // Identifica qual teleporter é este NPC
                  const teleporter = getTeleporterAt(npc.x, npc.y);
                  if (!teleporter) return;
                  if (teleporter.kind === 'hub') {
                      // Hub: envia lista de destinos
                      socket.emit('teleporter:destinations', {
                          npcId: npc.id,
                          destinations: getHubDestinations(),
                      });
                   } else {
                       // cityReturn / cavernaReturn: volta instantânea para a praça central
                       // (kind=hub aciona a getTeleporterDestination que retorna o centro da praça)
                       this.performTeleport(socket, { kind: 'hub' });
                   }
             } else if (npcType === 'questgiver') {
                 const available = QUESTS.filter(q => q.npcId === data.npcId && q.levelRequired <= (player.level || 1));
                 const progress = available.map(q => {
                     const p = player.quests?.[q.id];
                     if (!p) return null;
                     return {
                         started: p.started,
                         objectives: p.objectives,
                         objectivesComplete: p.objectivesComplete || false,
                         rewarded: p.rewarded || false,
                         expired: (p as any).expired || false,
                     };
                 });
                 socket.emit('quest:open', { npcId: data.npcId, name: npc.name, quests: available, playerProgress: progress });
             } else if (npcType === 'vendor') {
                const vendor = getVendorAt(npc.x, npc.y);
                if (!vendor) return;
                // Inclui soldToday no stock para o cliente saber quantos já foram vendidos
                const stockWithAvailability = vendor.stock.map(s => ({
                    ...s,
                    soldToday: vendor.soldToday?.[s.name] ?? 0,
                }));
                socket.emit('vendor:open', {
                    npcId: npc.id,
                    name: vendor.name,
                    stock: stockWithAvailability,
                });
            }
        });

         // Cliente escolheu um destino no menu do teleporter hub
         socket.on('teleporter:teleport', (data: { destinationId: string }) => {
             const player = this.players.get(socket.id);
             if (!player || player.isDead) return;
             const dest = data.destinationId;
             // caverna
             if (dest === 'caverna') {
                 this.performTeleport(socket, { kind: 'cavernaReturn' });
                 return;
             }
             // cidade
             const city = MONSTER_CITIES.find(c => c.id === dest);
             if (city) {
                 if (player.level < city.minLevel) {
                     socket.emit('textEffect', { x: player.x, y: player.y, message: `Requer nível ${city.minLevel} para entrar!`, color: '#ff5555' });
                     return;
                 }
                 this.performTeleport(socket, { kind: 'cityReturn', cityId: city.id });
             }
         });
  }

  /** Move o player para o destino do teleporter e notifica todos. */
  private performTeleport(socket: Socket, target: { kind: 'hub' | 'cityReturn' | 'cavernaReturn'; cityId?: string }) {
      const player = this.players.get(socket.id);
      if (!player || player.isDead) return;
      const dest = getTeleporterDestination(target);
      // Garante que a posição de destino não é parede
      if (this.walls.has(`${dest.x},${dest.y}`)) {
          // Procura tile adjacente livre
          const offsets = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];
          let found: { x: number; y: number } | null = null;
          for (const [dx, dy] of offsets) {
              const tx = dest.x + dx, ty = dest.y + dy;
              const occupied = Array.from(this.players.values()).some(p => p.x === tx && p.y === ty);
              if (!this.walls.has(`${tx},${ty}`) && !occupied) {
                  found = { x: tx, y: ty };
                  break;
              }
          }
          if (!found) return;
          player.x = found.x;
          player.y = found.y;
      } else {
          player.x = dest.x;
          player.y = dest.y;
      }
      player.facing = 'down';
      player.targetId = undefined;
      this.io.emit('playerMoved', player);
      socket.emit('textEffect', { x: player.x, y: player.y, message: '✨ Teleportado!', color: '#60a5fa' });
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

      player.x = 120;
      player.y = 114;
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

      // XP de profissão ao coletar (minério → Smithing, madeira → Tanning, ervas → Alchemy)
      let profXpField: 'professionSmithingXp' | 'professionAlchemyXp' | 'professionTanningXp' | null = null;
      let profLvlField: 'professionSmithingLevel' | 'professionAlchemyLevel' | 'professionTanningLevel' | null = null;
      if (node.type === 'ore') { profXpField = 'professionSmithingXp'; profLvlField = 'professionSmithingLevel'; }
      else if (node.type === 'herb') { profXpField = 'professionAlchemyXp'; profLvlField = 'professionAlchemyLevel'; }
      else if (node.type === 'tree') { profXpField = 'professionTanningXp'; profLvlField = 'professionTanningLevel'; }
      if (profXpField && profLvlField) {
          const currentLvl = player[profLvlField] || 1;
          const currentXp = player[profXpField] || 0;
          const xpGained = 6;
          const nextLvlXp = currentLvl * 100;
          let newXp = currentXp + xpGained;
          let newLvl = currentLvl;
          if (newXp >= nextLvlXp) {
              newXp -= nextLvlXp;
              newLvl++;
              socket.emit('textEffect', { x: player.x, y: player.y, message: 'Nível de Profissão Subiu!', color: '#eab308' });
          }
          player[profXpField] = newXp;
          player[profLvlField] = newLvl;
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
          gatheringWoodcuttingXp: player.gatheringWoodcuttingXp,
          professionSmithingLevel: player.professionSmithingLevel,
          professionSmithingXp: player.professionSmithingXp,
          professionAlchemyLevel: player.professionAlchemyLevel,
          professionAlchemyXp: player.professionAlchemyXp,
          professionTanningLevel: player.professionTanningLevel,
          professionTanningXp: player.professionTanningXp
      });
  }

  private setupCraftingStations() {
      const stations: CraftingStation[] = [
          { id: 'station_forge', type: 'forge', name: 'Ferreiro', emoji: '🧔', x: 118, y: 110 },
          { id: 'station_alchemy', type: 'alchemy', name: 'Alquimista', emoji: '🧙‍♂️', x: 122, y: 110 },
          { id: 'station_tanning', type: 'tanning', name: 'Alfaiate', emoji: '🧝‍♂️', x: 120, y: 108 }
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
