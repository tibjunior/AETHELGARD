/**
 * Configuração central do servidor. Todas as taxas, tempos e regras que
 * o GM pode ajustar em tempo real pela página de admin ficam aqui.
 *
 * O objeto `CONFIG` é um singleton mutável. Para alterar uma taxa em
 * tempo real, basta atribuir o novo valor e chamar `saveConfig()`.
 */

export interface DropEntry {
    item: string;       // nome do item (ou vazio para nada)
    weight: number;     // peso relativo na rolagem
}

export interface DropTable {
    [monsterName: string]: DropEntry[];
}

/**
 * Configuração por monstro: experiência, comportamento, drops.
 * - exp: experiência ganha ao matar
 * - isAggressive: se true, monstro procura jogadores. Se false (passivo), só ataca se for atacado.
 * - drops: lista de itens com weight (rolagem) + minQty/maxQty (quantidade sorteada)
 */
export interface MonsterDropEntry {
    item: string;
    weight: number;     // peso relativo na rolagem
    minQty: number;     // quantidade mínima
    maxQty: number;     // quantidade máxima
}

export interface MonsterConfig {
    exp: number;
    isAggressive: boolean;
    drops: MonsterDropEntry[];
    /** Atributos base do monstro (HP, ataque, velocidade). Editáveis em tempo real pelo admin. */
    health: number;
    attack: number;
    speed: number;
}

export type MonsterConfigs = Record<string, MonsterConfig>;

export interface ServerConfig {
    // ==================== Combate / Drop ====================
    /** @deprecated mantido por compat — usar monsterConfigs. Atualizado por Object.assign. */
    dropTables: DropTable;
    /** @deprecated mantido por compat — usar monsterConfigs. Atualizado por Object.assign. */
    expByMonster: Record<string, number>;
    /** Config unificada por monstro (exp + comportamento + drops com qty). */
    monsterConfigs: MonsterConfigs;
    goldByLevel: number;            // multiplicador de gold = monster.level * goldByLevel
    globalGoldMultiplier: number;   // multiplicador global de gold (1.0 = padrão)
    globalExpMultiplier: number;    // multiplicador global de exp (1.0 = padrão)
    globalDropMultiplier: number;   // multiplicador global de drop (1.0 = padrão)
    pvpGoldReward: number;
    pvpItemLossChance: number;      // 0.0 a 1.0
    supremeBossItemDrop: string;    // item que boss supremo dropa (Nightmare Skeleton).
                                    // Valores: '__NONE__' = não dropa, '__RANDOM__' = item aleatório não-consumível, ou nome do item.
    supremeBossDropChance: number;  // 0 a 100 (% chance do boss supremo dropar o item configurado)
    cityBossItemDrop: string;       // item que bosses de cidade dropam (Rat King, Orc Warlord, Ancient Rotworm, Demon Lord).
                                    // Valores: '__NONE__' = não dropa, '__RANDOM__' = item aleatório não-consumível, ou nome do item.
    cityBossDropChance: number;     // 0 a 100 (% chance dos bosses de cidade droparem o item configurado)

    // ==================== Regeneração ====================
    hpRegenBase: number;            // HP base por tick de regen
    hpRegenPerVit: number;          // HP extra a cada 5 pontos de VIT
    spRegenBase: number;            // SP base por tick
    spRegenPerInt: number;          // SP extra a cada 5 pontos de INT
    regenIntervalTicks: number;     // a cada quantos ticks regenera (20 = 1s)

    // ==================== Banco ====================
    bankDailyFee: number;           // gold por dia
    bankMaxDebtDays: number;        // -20 padrão
    bankSlots: number;              // 50 padrão
    bankDistanceCheck: number;      // tiles de distância para interagir

    // ==================== Inventário ====================
    maxStackSize: number;           // 99 padrão
    backpackBaseSlots: number;      // 8 padrão (sem mochila)
    backpackLeatherSlots: number;
    backpackWoodenSlots: number;
    backpackIronSlots: number;
    maxWeightBase: number;          // 250 oz padrão

    // ==================== Respawn / Spawn ====================
    playerRespawnMs: number;        // tempo até reviver (5000 padrão)
    autoSaveIntervalMs: number;     // auto-save no DB
    monsterRespawnMs: number;       // tempo base de respawn de monstro
    monsterRespawnJitterMs: number; // variação aleatória (+0..jitter ms)
    monsterNightCloneChance: number;
    bossSpawnChancePerNight: number;
    cityBossSpawnChance: number;    // chance de spawnar boss noturno em cada cidade (0.0 a 1.0)

    // ==================== Ciclo Dia/Noite ====================
    dayDurationTicks: number;       // 6000 = 5 min
    nightDurationTicks: number;     // 6000 = 5 min

    // ==================== PvP ====================
    cityBounds: {
        xMin: number; xMax: number;
        yMin: number; yMax: number;
    };

    // ==================== ASPD / Cooldowns ====================
    basePlayerCooldownMs: number;
    baseMonsterCooldownMs: number;
    aspdDesReductionFactor: number; // quanto DES reduz o cooldown
}

/**
 * Default de configuração de cada monstro do jogo.
 * Inclui os 4 monstros do mapa antigo + os 5 bosses (1 supremo + 4 de cidade).
 * isAggressive=true para todos por padrão; Nightmare Skeleton já é passivo no código
 * (ver Game.ts:2320) e aqui mantemos true para refletir a config geral (você pode
 * desligar via admin se quiser).
 */
export const DEFAULT_MONSTER_CONFIGS: MonsterConfigs = {
    'Giant Rat': {
        exp: 50, isAggressive: true,
        health: 50,  attack: 8,  speed: 150,
        drops: [
            { item: 'Steel Sword',     weight: 5,  minQty: 1, maxQty: 1 },
            { item: 'Torch',           weight: 5,  minQty: 1, maxQty: 1 },
            { item: 'Cheese',          weight: 15, minQty: 1, maxQty: 2 },
            { item: 'Apple',           weight: 20, minQty: 1, maxQty: 3 },
            { item: 'Blueberry',       weight: 15, minQty: 1, maxQty: 3 },
            { item: 'Wood Log',        weight: 15, minQty: 1, maxQty: 2 },
            { item: 'Medicinal Herb',  weight: 15, minQty: 1, maxQty: 2 },
            { item: 'Leather Hide',    weight: 10, minQty: 1, maxQty: 1 },
        ],
    },
    'Orc': {
        exp: 150, isAggressive: true,
        health: 120, attack: 15, speed: 100,
        drops: [
            { item: 'Steel Sword',     weight: 12, minQty: 1, maxQty: 1 },
            { item: 'Medicinal Herb',  weight: 18, minQty: 1, maxQty: 2 },
            { item: 'Blueberry',       weight: 15, minQty: 1, maxQty: 3 },
            { item: 'Apple',           weight: 30, minQty: 1, maxQty: 3 },
            { item: 'Leather Hide',    weight: 25, minQty: 1, maxQty: 2 },
        ],
    },
    'Rotworm': {
        exp: 250, isAggressive: true,
        health: 200, attack: 22, speed: 120,
        drops: [
            { item: 'Steel Sword',     weight: 4,  minQty: 1, maxQty: 1 },
            { item: 'Wood Sword',      weight: 6,  minQty: 1, maxQty: 1 },
            { item: 'Medicinal Herb',  weight: 10, minQty: 1, maxQty: 2 },
            { item: 'Cheese',          weight: 20, minQty: 1, maxQty: 2 },
            { item: 'Apple',           weight: 25, minQty: 1, maxQty: 3 },
            { item: 'Leather Hide',    weight: 35, minQty: 1, maxQty: 2 },
        ],
    },
    'Demon Skeleton': {
        exp: 600, isAggressive: true,
        health: 400, attack: 38, speed: 90,
        drops: [
            { item: 'Armor',           weight: 10, minQty: 1, maxQty: 1 },
            { item: 'Leather Boots',   weight: 10, minQty: 1, maxQty: 1 },
            { item: 'Steel Sword',     weight: 15, minQty: 1, maxQty: 1 },
            { item: 'Pants',           weight: 15, minQty: 1, maxQty: 1 },
            { item: 'Helmet',          weight: 15, minQty: 1, maxQty: 1 },
            { item: 'Medicinal Herb',  weight: 15, minQty: 1, maxQty: 2 },
            { item: 'Blueberry',       weight: 12, minQty: 1, maxQty: 3 },
            { item: 'Iron Ore',        weight: 8,  minQty: 1, maxQty: 2 },
        ],
    },
    // Bosses
    'Nightmare Skeleton': {
        exp: 5000, isAggressive: false,
        health: 1200, attack: 90, speed: 150,
        drops: [], // drop tratado por CONFIG.supremeBossItemDrop (ver rollDropTable)
    },
    'Rat King': {
        exp: 800, isAggressive: true,
        health: 400, attack: 18, speed: 160,
        drops: [], // drop tratado por CONFIG.cityBossItemDrop
    },
    'Orc Warlord': {
        exp: 2000, isAggressive: true,
        health: 800, attack: 30, speed: 120,
        drops: [],
    },
    'Ancient Rotworm': {
        exp: 4500, isAggressive: true,
        health: 1500, attack: 50, speed: 140,
        drops: [],
    },
    'Demon Lord': {
        exp: 10000, isAggressive: true,
        health: 3000, attack: 80, speed: 110,
        drops: [],
    },
};

/** Lista com todos os nomes de monstros configuráveis. */
export function getAllMonsterNames(): string[] {
    return Object.keys(DEFAULT_MONSTER_CONFIGS);
}

export const DEFAULT_CONFIG: ServerConfig = {
    // Drop (mantidos por compat — derivados de monsterConfigs)
    dropTables: {},
    expByMonster: {},
    monsterConfigs: JSON.parse(JSON.stringify(DEFAULT_MONSTER_CONFIGS)),
    goldByLevel: 1,
    globalGoldMultiplier: 1.0,
    globalExpMultiplier: 1.0,
    globalDropMultiplier: 1.0,
    pvpGoldReward: 10,
    pvpItemLossChance: 0.30,
    supremeBossItemDrop: '__RANDOM__',
    supremeBossDropChance: 100,   // 100% = sempre dropa (se não for __NONE__)
    cityBossItemDrop: '__RANDOM__',
    cityBossDropChance: 100,      // 100% = sempre dropa (se não for __NONE__)

    // Regen
    hpRegenBase: 2,
    hpRegenPerVit: 5,
    spRegenBase: 1,
    spRegenPerInt: 5,
    regenIntervalTicks: 40,

    // Banco
    bankDailyFee: 1,
    bankMaxDebtDays: -20,
    bankSlots: 50,
    bankDistanceCheck: 2,

    // Inventário
    maxStackSize: 99,
    backpackBaseSlots: 8,
    backpackLeatherSlots: 16,
    backpackWoodenSlots: 24,
    backpackIronSlots: 32,
    maxWeightBase: 250,

    // Respawn
    playerRespawnMs: 5000,
    autoSaveIntervalMs: 10000,
    monsterRespawnMs: 20000,        // monstro revive 20s após morrer
    monsterRespawnJitterMs: 10000,  // +0-10s aleatório (total 20-30s)
    monsterNightCloneChance: 1.0,   // 100% clona à noite (sempre)
    bossSpawnChancePerNight: 1.0,   // 100% spawn de boss global
    cityBossSpawnChance: 0.50,      // 50% de chance de cada cidade spawnar seu boss noturno

    // Ciclo dia/noite (em ticks; 20 ticks = 1s)
    dayDurationTicks: 6000,
    nightDurationTicks: 6000,

    // PvP / Safe Zone (Praça Central)
    cityBounds: { xMin: 100, xMax: 130, yMin: 100, yMax: 130 },

    // ASPD
    basePlayerCooldownMs: 1500,
    baseMonsterCooldownMs: 2000,
    aspdDesReductionFactor: 20  // (1500 - DES*20) com piso de 500
};

// Singleton mutável
export const CONFIG: ServerConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

/** Reseta a config para os defaults (não salva automaticamente). */
export function resetConfigToDefaults(): void {
    Object.assign(CONFIG, JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
}

/** Sentinels para os campos de drop de boss */
export const BOSS_DROP_NONE = '__NONE__';
export const BOSS_DROP_RANDOM = '__RANDOM__';

/** Itens não-consumíveis do jogo (que bosses podem dropar). */
export const NON_CONSUMABLE_ITEMS: readonly string[] = [
    'Steel Sword',
    'Wood Sword',
    'Helmet',
    'Armor',
    'Pants',
    'Leather Boots',
    'Torch',
    'Leather Backpack',
    'Wooden Backpack',
    'Iron Backpack',
];

/**
 * Retorna o nome dos bosses supremos (globais).
 */
export function getSupremeBossNames(): string[] {
    return ['Nightmare Skeleton'];
}

/**
 * Retorna o nome dos bosses de cidade.
 */
export function getCityBossNames(): string[] {
    const names: string[] = [];
    for (const city of MONSTER_CITIES) {
        names.push(city.bossName);
    }
    return names;
}

/**
 * Retorna o nome de TODOS os bosses do jogo (supremos + cidade).
 */
export function getAllBossNames(): string[] {
    return [...getSupremeBossNames(), ...getCityBossNames()];
}

/**
 * Escolhe um item aleatório da lista de não-consumíveis.
 * Retorna string vazia se a lista estiver vazia.
 */
function pickRandomNonConsumable(): string {
    if (NON_CONSUMABLE_ITEMS.length === 0) return '';
    const idx = Math.floor(Math.random() * NON_CONSUMABLE_ITEMS.length);
    return NON_CONSUMABLE_ITEMS[idx];
}

/**
 * Rola o drop table de um monstro e retorna o NOME do item.
 * Retorna string vazia ('') se nada deve ser dropado.
 * - Bosses supremos (Nightmare Skeleton): usam CONFIG.supremeBossItemDrop + CONFIG.supremeBossDropChance
 * - Bosses de cidade (Rat King, Orc Warlord, etc.): usam CONFIG.cityBossItemDrop + CONFIG.cityBossDropChance
 * - Monstros normais: usam CONFIG.monsterConfigs[monsterName].drops (com weight)
 */
export function rollDropTable(monsterName: string): string {
    // ===== Bosses supremos: usam CONFIG.supremeBossItemDrop + chance =====
    if (getSupremeBossNames().includes(monsterName)) {
        const choice = CONFIG.supremeBossItemDrop;
        if (!choice || choice === BOSS_DROP_NONE) return '';
        // Aplica chance de drop (0-100)
        const chance = Math.max(0, Math.min(100, CONFIG.supremeBossDropChance || 100));
        if (Math.random() * 100 > chance) return '';
        if (choice === BOSS_DROP_RANDOM) return pickRandomNonConsumable();
        return choice; // nome específico de item
    }

    // ===== Bosses de cidade: usam CONFIG.cityBossItemDrop + chance =====
    if (getCityBossNames().includes(monsterName)) {
        const choice = CONFIG.cityBossItemDrop;
        if (!choice || choice === BOSS_DROP_NONE) return '';
        // Aplica chance de drop (0-100)
        const chance = Math.max(0, Math.min(100, CONFIG.cityBossDropChance || 100));
        if (Math.random() * 100 > chance) return '';
        if (choice === BOSS_DROP_RANDOM) return pickRandomNonConsumable();
        return choice; // nome específico de item
    }

    // ===== Monstros normais: drop table por monstro (CONFIG.monsterConfigs) =====
    const cfg = CONFIG.monsterConfigs?.[monsterName];
    const table = cfg?.drops;
    if (!table || table.length === 0) return '';

    const totalWeight = table.reduce((sum, e) => sum + (e.weight || 0), 0);
    if (totalWeight <= 0) return '';

    let roll = Math.random() * totalWeight;
    for (const entry of table) {
        roll -= (entry.weight || 0);
        if (roll <= 0) return entry.item;
    }
    return table[table.length - 1].item;
}

/**
 * Rola a QUANTIDADE de um item dropado (entre minQty e maxQty do MonsterDropEntry).
 * Chamado pelo Game.ts após `rollDropTable` para sortear a quantidade.
 */
export function rollDropQuantity(monsterName: string, itemName: string): number {
    const cfg = CONFIG.monsterConfigs?.[monsterName];
    const entry = cfg?.drops?.find(d => d.item === itemName);
    if (!entry) return 1;
    const min = Math.max(1, entry.minQty || 1);
    const max = Math.max(min, entry.maxQty || min);
    return min + Math.floor(Math.random() * (max - min + 1));
}

/** Verifica se um item deve ser empilhável (default) */
export function getStackableItems(): string[] {
    return [
        'Apple', 'Cheese', 'Health Potion', 'Mana Potion', 'Blueberry',
        'Iron Ore', 'Wood Log', 'Medicinal Herb', 'Leather Hide', 'Gold Coin'
    ];
}

// =====================================================================
// ===== Cidades de Monstros (Fase 3) =====
// =====================================================================

export interface MonsterCity {
    id: string;             // 'rat_city', 'orc_city', etc.
    name: string;           // 'Cidade dos Ratos'
    monster: string;        // nome do monstro que habita (igual ao do bestiário)
    minLevel: number;       // nível mínimo para entrar
    bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
    /** @deprecated portais físicos foram removidos; mantido por compat. */
    portalIn: { x: number; y: number };
    /** @deprecated portais físicos foram removidos; mantido por compat. */
    portalOut: { x: number; y: number };
    bossName: string;       // nome do boss noturno desta cidade
    bossStats: { health: number; attack: number; speed: number; exp: number };
    spawnPositions: Array<{ x: number; y: number }>;  // onde os monstros aparecem
    bgColor: number;        // cor visual (p/ client render do chão da cidade)
    floorEmoji: string;     // emoji do chão temático
    /** Centro da safe zone (5x5) dentro da cidade, com muro em volta. */
    safeZoneCenter: { x: number; y: number };
    /** Portão de 1 tile no muro da safe zone (face do centro da cidade).
     *  O player passa por aqui, monstros NÃO. */
    gate: { x: number; y: number };
}

export const PLAZA_BOUNDS = { xMin: 100, xMax: 130, yMin: 100, yMax: 130 };

/**
 * Tiles da borda da praça que NÃO são portais para cidades (em vez disso
 * levam ao mapa antigo / 'wilderness'). Usado em `getPortalOutAt` para
 * que o level check e o teleporte saibam que essas coordenadas não
 * pertencem a nenhuma cidade.
 */
export const PLAZA_NON_CITY_PORTALS: ReadonlyArray<{ x: number; y: number }> = [
    { x: 115, y: 100 }, // norte da praça → mapa antigo (40x40)
];

/**
 * Tiles da borda do mapa antigo (40x40) que são portais para outras áreas.
 * Usado em `setupMap` para não criar paredes nesses tiles.
 *  - (10, 0)  → norte do mapa antigo, vai pra praça
 *  - (115, 40) → sul do mapa antigo, vai pra rotworm_city (entrada norte)
 */
export const MAIN_MAP_PORTALS: ReadonlyArray<{ x: number; y: number }> = [
    { x: 10, y: 0 },
    { x: 115, y: 40 },
];

/**
 * Lista das 4 cidades de monstros. Cada uma exige nível mínimo e tem
 * um boss noturno. A praça central (PLAZA_BOUNDS) conecta todas.
 */
export const MONSTER_CITIES: MonsterCity[] = [
    {
        id: 'rat_city',
        name: 'Cidade dos Ratos',
        monster: 'Giant Rat',
        minLevel: 1,
        bounds: { xMin: 50, xMax: 90, yMin: 100, yMax: 130 },
        portalIn: { x: 90, y: 115 },
        portalOut: { x: 100, y: 115 },
        bossName: 'Rat King',
        bossStats: { health: 400, attack: 18, speed: 160, exp: 800 },
        spawnPositions: [
            { x: 60, y: 110 }, { x: 70, y: 108 }, { x: 80, y: 112 },
            { x: 65, y: 122 }, { x: 75, y: 120 }, { x: 85, y: 125 }
        ],
        bgColor: 0x4a3a2a,        // marrom rato
        floorEmoji: '🟫',
        safeZoneCenter: { x: 54, y: 104 },
        gate: { x: 54, y: 107 },  // sul da safe zone (centro da cidade em (70,115))
    },
    {
        id: 'orc_city',
        name: 'Cidade dos Orcs',
        monster: 'Orc',
        minLevel: 3,
        bounds: { xMin: 140, xMax: 180, yMin: 100, yMax: 130 },
        portalIn: { x: 140, y: 115 },
        portalOut: { x: 130, y: 115 },
        bossName: 'Orc Warlord',
        bossStats: { health: 800, attack: 30, speed: 120, exp: 2000 },
        spawnPositions: [
            { x: 150, y: 110 }, { x: 160, y: 108 }, { x: 170, y: 112 },
            { x: 155, y: 122 }, { x: 165, y: 120 }, { x: 175, y: 125 }
        ],
        bgColor: 0x553322,        // marrom-avermelhado
        floorEmoji: '🟥',
        safeZoneCenter: { x: 176, y: 104 },
        gate: { x: 176, y: 107 }, // sul da safe zone (centro da cidade em (160,115))
    },
    {
        id: 'rotworm_city',
        name: 'Cidade dos Rotworms',
        monster: 'Rotworm',
        minLevel: 5,
        bounds: { xMin: 100, xMax: 130, yMin: 40, yMax: 90 },
        portalIn: { x: 115, y: 40 },
        portalOut: { x: 115, y: 39 },
        bossName: 'Ancient Rotworm',
        bossStats: { health: 1500, attack: 50, speed: 140, exp: 4500 },
        spawnPositions: [
            { x: 110, y: 50 }, { x: 120, y: 55 }, { x: 115, y: 60 },
            { x: 108, y: 70 }, { x: 122, y: 75 }, { x: 115, y: 82 }
        ],
        bgColor: 0x445533,        // verde podre
        floorEmoji: '🟩',
        safeZoneCenter: { x: 104, y: 44 },
        gate: { x: 104, y: 47 },  // sul da safe zone (centro da cidade em (115,65))
    },
    {
        id: 'demon_city',
        name: 'Cidade dos Demônios',
        monster: 'Demon Skeleton',
        minLevel: 10,
        bounds: { xMin: 100, xMax: 130, yMin: 140, yMax: 190 },
        portalIn: { x: 115, y: 140 },
        portalOut: { x: 115, y: 130 },
        bossName: 'Demon Lord',
        bossStats: { health: 3000, attack: 80, speed: 110, exp: 10000 },
        spawnPositions: [
            { x: 110, y: 150 }, { x: 120, y: 155 }, { x: 115, y: 160 },
            { x: 108, y: 170 }, { x: 122, y: 175 }, { x: 115, y: 182 }
        ],
        bgColor: 0x551133,        // roxo sangue
        floorEmoji: '🟪',
        safeZoneCenter: { x: 104, y: 184 },
        gate: { x: 104, y: 181 }, // norte da safe zone (centro da cidade em (115,165))
    },
];

/** Procura uma cidade que contém o tile (x, y) ou null se não está em nenhuma. */
export function getCityAt(x: number, y: number): MonsterCity | null {
    for (const city of MONSTER_CITIES) {
        if (x >= city.bounds.xMin && x <= city.bounds.xMax &&
            y >= city.bounds.yMin && y <= city.bounds.yMax) {
            return city;
        }
    }
    return null;
}

/** Verifica se um tile é a entrada (portal) de uma cidade. */
export function getPortalAt(x: number, y: number): MonsterCity | null {
    for (const city of MONSTER_CITIES) {
        if (city.portalIn.x === x && city.portalIn.y === y) return city;
    }
    return null;
}

/**
 * Verifica se um tile é a saída (portalOut) de uma cidade — usado no lado da praça.
 * Tiles em `PLAZA_NON_CITY_PORTALS` (que levam ao mapa antigo) sempre retornam `null`.
 */
export function getPortalOutAt(x: number, y: number): MonsterCity | null {
    for (const p of PLAZA_NON_CITY_PORTALS) {
        if (p.x === x && p.y === y) return null;
    }
    for (const city of MONSTER_CITIES) {
        if (city.portalOut.x === x && city.portalOut.y === y) return city;
    }
    return null;
}

/** Verifica se um tile está dentro dos limites da praça central. */
export function isInPlaza(x: number, y: number): boolean {
    return x >= PLAZA_BOUNDS.xMin && x <= PLAZA_BOUNDS.xMax &&
           y >= PLAZA_BOUNDS.yMin && y <= PLAZA_BOUNDS.yMax;
}

// =====================================================================
// ===== NPCs de Teleporte e Vendedor (sistema de teleporte por NPC) ==
// =====================================================================

export type TeleporterKind = 'hub' | 'cityReturn' | 'cavernaReturn';

/** Definição de um NPC de teleporte. */
export interface TeleporterNpc {
    id: string;                 // 'npc_teleporter_hub', etc.
    name: string;               // 'Mago Teleportador'
    x: number;
    y: number;
    kind: TeleporterKind;
    /** Cidade associada (apenas para cityReturn). */
    cityId?: string;
}

/** Definição de um NPC vendedor dentro de uma cidade. */
export interface VendorNpc {
    id: string;
    name: string;
    x: number;
    y: number;
    cityId: string;
    /** Lista de itens com nome, emoji, preço e estoque máximo por dia. */
    stock: Array<{ name: string; emoji: string; price: number; dailyStock?: number }>;
    /** Quantos de cada item foram vendidos hoje (reset ao amanhecer). */
    soldToday?: Record<string, number>;
}

export interface QuestObjective {
    type: 'collect' | 'kill' | 'craft';
    target: string;    // nome do item / monstro / receita
    count: number;
}

export interface QuestReward {
    gold?: number;
    xp?: number;
    items?: Array<{ name: string; count: number }>;
    professionXp?: { smithing?: number; alchemy?: number; tanning?: number };
}

export interface Quest {
    id: string;
    title: string;
    description: string;
    npcId: string;               // qual NPC dá a quest
    levelRequired: number;
    objectives: QuestObjective[];
    rewards: QuestReward;
}

export type PlayerQuestProgress = Record<string, {
    started: boolean;
    completed: boolean;
    objectives: Record<string, number>; // objective index → current count
}>

/** NPC de teleporte central na praça (hub): permite ir a qualquer destino. */
export const PLAZA_TELEPORTER: TeleporterNpc = {
    id: 'npc_teleporter_hub',
    name: 'Mago Teleportador',
    x: 115,
    y: 110,
    kind: 'hub',
};

/** NPC de teleporte no centro da caverna (mapa antigo 40x40): volta para a praça. */
export const CAVERNA_TELEPORTER: TeleporterNpc = {
    id: 'npc_teleporter_caverna',
    name: 'Mago Teleportador',
    x: 20,
    y: 20,
    kind: 'cavernaReturn',
};

/** Centro da safe zone da caverna (5x5 ao redor do teleporter) + portão sul. */
export const CAVERNA_SAFE_ZONE_CENTER = { x: 20, y: 20 };
export const CAVERNA_SAFE_ZONE_GATE = { x: 20, y: 23 };

/** Um teleporter de retorno em cada cidade de monstros (volta para a praça). */
export const CITY_TELEPORTERS: TeleporterNpc[] = [
    { id: 'npc_teleporter_rat',     name: 'Mago Teleportador', x: 54, y: 104, kind: 'cityReturn', cityId: 'rat_city' },
    { id: 'npc_teleporter_orc',     name: 'Mago Teleportador', x: 176, y: 104, kind: 'cityReturn', cityId: 'orc_city' },
    { id: 'npc_teleporter_rotworm', name: 'Mago Teleportador', x: 104, y: 44, kind: 'cityReturn', cityId: 'rotworm_city' },
    { id: 'npc_teleporter_demon',   name: 'Mago Teleportador', x: 104, y: 184, kind: 'cityReturn', cityId: 'demon_city' },
];

/** Um vendedor temático em cada cidade de monstros. */
export const CITY_VENDORS: VendorNpc[] = [
    {
        id: 'npc_vendor_rat',
        name: 'Mercador dos Ratos',
        x: 56, y: 104,
        cityId: 'rat_city',
        stock: [
            { name: 'Apple',          emoji: '🍎', price: 3,  dailyStock: 20 },
            { name: 'Cheese',         emoji: '🧀', price: 5,  dailyStock: 15 },
            { name: 'Blueberry',      emoji: '🫐', price: 4,  dailyStock: 20 },
            { name: 'Torch',          emoji: '🔦', price: 5,  dailyStock: 10 },
        ],
    },
    {
        id: 'npc_vendor_orc',
        name: 'Mercador dos Orcs',
        x: 174, y: 104,
        cityId: 'orc_city',
        stock: [
            { name: 'Apple',          emoji: '🍎', price: 3,  dailyStock: 20 },
            { name: 'Blueberry',      emoji: '🫐', price: 4,  dailyStock: 20 },
            { name: 'Medicinal Herb', emoji: '🌿', price: 8,  dailyStock: 10 },
            { name: 'Leather Hide',   emoji: '🟫', price: 15, dailyStock: 8 },
        ],
    },
    {
        id: 'npc_vendor_rotworm',
        name: 'Mercador dos Rotworms',
        x: 106, y: 44,
        cityId: 'rotworm_city',
        stock: [
            { name: 'Cheese',          emoji: '🧀', price: 5,  dailyStock: 15 },
            { name: 'Apple',           emoji: '🍎', price: 3,  dailyStock: 20 },
            { name: 'Medicinal Herb',  emoji: '🌿', price: 8,  dailyStock: 10 },
            { name: 'Health Potion',   emoji: '🧪', price: 15, dailyStock: 5 },
        ],
    },
    {
        id: 'npc_vendor_demon',
        name: 'Mercador Demoníaco',
        x: 106, y: 184,
        cityId: 'demon_city',
        stock: [
            { name: 'Health Potion',  emoji: '🧪', price: 15, dailyStock: 5 },
            { name: 'Mana Potion',    emoji: '💙', price: 20, dailyStock: 3 },
            { name: 'Medicinal Herb', emoji: '🌿', price: 8,  dailyStock: 10 },
            { name: 'Steel Sword',    emoji: '🗡️', price: 100, dailyStock: 2 },
        ],
    },
];

export const QUESTS: Quest[] = [
    {
        id: 'quest_rat_meat',
        title: 'Carne de Rato',
        description: 'Os mercadores da praça precisam de carne de rato para o ensopado. Mate 5 Giant Rats e traga a carne.',
        npcId: 'npc_questgiver',
        levelRequired: 1,
        objectives: [
            { type: 'kill', target: 'Giant Rat', count: 5 },
        ],
        rewards: { gold: 25, xp: 50 },
    },
    {
        id: 'quest_orc_cleaver',
        title: 'Machados Orcs',
        description: 'Os Orc estão acumulando armas. Derrote 3 Orcs e colete suas armas.',
        npcId: 'npc_questgiver',
        levelRequired: 3,
        objectives: [
            { type: 'kill', target: 'Orc', count: 3 },
        ],
        rewards: { gold: 60, xp: 120 },
    },
    {
        id: 'quest_rotworm_venom',
        title: 'Veneno de Rotworm',
        description: 'Precisamos de veneno de Rotworm para criar antídotos. Mate 3 Rotworms.',
        npcId: 'npc_questgiver',
        levelRequired: 5,
        objectives: [
            { type: 'kill', target: 'Rotworm', count: 3 },
        ],
        rewards: { gold: 100, xp: 250 },
    },
    {
        id: 'quest_first_sword',
        title: 'Primeira Espada',
        description: 'Forje uma Steel Sword na bigorna para provar seu valor como ferreiro.',
        npcId: 'npc_blacksmith',
        levelRequired: 1,
        objectives: [
            { type: 'craft', target: 'Steel Sword', count: 1 },
        ],
        rewards: { gold: 30, xp: 80, professionXp: { smithing: 20 } },
    },
    {
        id: 'quest_first_potion',
        title: 'Primeira Poção',
        description: 'Prepare uma Health Potion no alambique para mostrar suas habilidades de alquimista.',
        npcId: 'npc_alchemist',
        levelRequired: 1,
        objectives: [
            { type: 'craft', target: 'Health Potion', count: 1 },
        ],
        rewards: { gold: 30, xp: 80, professionXp: { alchemy: 20 } },
    },
    {
        id: 'quest_leather_armor',
        title: 'Armadura de Couro',
        description: 'Mostre seu talento como alfaiate e crie uma armadura de couro no tear.',
        npcId: 'npc_tailor',
        levelRequired: 1,
        objectives: [
            { type: 'craft', target: 'Leather Armor', count: 1 },
        ],
        rewards: { gold: 30, xp: 80, professionXp: { tanning: 20 } },
    },
];

/** Raio (em tiles) da safe zone ao redor de um NPC. 2 = 5x5. */
export const SAFE_ZONE_RADIUS = 2;

/** Tiles seguros de cada cidade (gerados a partir de safeZoneCenter + SAFE_ZONE_RADIUS). */
export function getCitySafeZoneTiles(city: MonsterCity): Array<{ x: number; y: number }> {
    const tiles: Array<{ x: number; y: number }> = [];
    const c = city.safeZoneCenter;
    for (let dx = -SAFE_ZONE_RADIUS; dx <= SAFE_ZONE_RADIUS; dx++) {
        for (let dy = -SAFE_ZONE_RADIUS; dy <= SAFE_ZONE_RADIUS; dy++) {
            tiles.push({ x: c.x + dx, y: c.y + dy });
        }
    }
    return tiles;
}

/** Tiles do muro (ring externo) que cerca a safe zone de uma cidade.
 *  São os tiles adjacentes ao quadrado 5x5, formando uma "cerca" que impede
 *  monstros de se aproximarem dos NPCs. */
export function getSafeZoneWallRing(city: MonsterCity): Array<{ x: number; y: number }> {
    const ring: Array<{ x: number; y: number }> = [];
    const c = city.safeZoneCenter;
    const r = SAFE_ZONE_RADIUS + 1; // ring fica 1 tile fora da safe zone
    // Top & bottom rows
    for (let dx = -r; dx <= r; dx++) {
        ring.push({ x: c.x + dx, y: c.y - r });
        ring.push({ x: c.x + dx, y: c.y + r });
    }
    // Left & right columns (sem os cantos, já inclusos acima)
    for (let dy = -r + 1; dy <= r - 1; dy++) {
        ring.push({ x: c.x - r, y: c.y + dy });
        ring.push({ x: c.x + r, y: c.y + dy });
    }
    return ring;
}

/** Verifica se (x, y) está dentro de alguma safe zone (praça ou cidade de monstros). */
export function isInSafeZone(x: number, y: number): boolean {
    if (isInPlaza(x, y)) return true;
    for (const city of MONSTER_CITIES) {
        for (const t of getCitySafeZoneTiles(city)) {
            if (t.x === x && t.y === y) return true;
        }
    }
    return false;
}

/** Procura o NPC de teleporte em (x, y), ou null. */
export function getTeleporterAt(x: number, y: number): TeleporterNpc | null {
    if (PLAZA_TELEPORTER.x === x && PLAZA_TELEPORTER.y === y) return PLAZA_TELEPORTER;
    if (CAVERNA_TELEPORTER.x === x && CAVERNA_TELEPORTER.y === y) return CAVERNA_TELEPORTER;
    for (const t of CITY_TELEPORTERS) {
        if (t.x === x && t.y === y) return t;
    }
    return null;
}

/** Procura o NPC vendedor em (x, y), ou null. */
export function getVendorAt(x: number, y: number): VendorNpc | null {
    for (const v of CITY_VENDORS) {
        if (v.x === x && v.y === y) return v;
    }
    return null;
}

/**
 * Posição de destino de um teleporte.
 * - hub → praça central (115, 115)
 * - cityReturn/cityId → centro da safe zone da cidade
 * - cavernaReturn → centro da caverna (20, 20)
 * - destino de uma cidade específica → safe zone dessa cidade
 */
export function getTeleporterDestination(target: { kind: TeleporterKind; cityId?: string }): { x: number; y: number } {
    if (target.kind === 'hub') {
        return { x: PLAZA_BOUNDS.xMin + Math.floor((PLAZA_BOUNDS.xMax - PLAZA_BOUNDS.xMin) / 2),
                 y: PLAZA_BOUNDS.yMin + Math.floor((PLAZA_BOUNDS.yMax - PLAZA_BOUNDS.yMin) / 2) };
    }
    if (target.kind === 'cavernaReturn') {
        return CAVERNA_TELEPORTER;
    }
    if (target.kind === 'cityReturn' && target.cityId) {
        const city = MONSTER_CITIES.find(c => c.id === target.cityId);
        if (city) return { ...city.safeZoneCenter };
    }
    return { x: 115, y: 115 };
}

/** Lista de destinos oferecida pelo NPC hub da praça (4 cidades + caverna). */
export function getHubDestinations(): Array<{ id: string; name: string; minLevel: number; emoji: string }> {
    const list = MONSTER_CITIES.map(c => ({
        id: c.id,
        name: c.name,
        minLevel: c.minLevel,
        emoji: c.floorEmoji,
    }));
    list.push({ id: 'caverna', name: 'Caverna (Mapa Antigo)', minLevel: 1, emoji: '⛰️' });
    return list;
}
