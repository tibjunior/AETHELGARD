export interface Position {
  x: number;
  y: number;
}

export interface PlayerStats {
  FOR: number;
  AGI: number;
  VIT: number;
  INT: number;
  DES: number;
  SOR: number;
}

export interface PlayerData {
  id: string;
  name: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  sp?: number;
  maxSp?: number;
  speed: number;
  password?: string;
  isMonster?: boolean;
  targetId?: string; // ID de quem o jogador está atacando
  equipment?: Equipment;
  level: number;
  experience: number;
  gold?: number;
  backpack?: string[];
  facing?: string; // 'up', 'down', 'left', 'right'
  isDead?: boolean;
  isNPC?: boolean;
  npcType?: 'teleporter' | 'vendor' | 'banker' | 'merchant' | 'questgiver';
  stats?: PlayerStats;
  statPoints?: number;
  
  // Secondary Stats
  attack?: number;
  matk?: number;
  def?: number;
  mdef?: number;
  hit?: number;
  dodge?: number;
  crit?: number;
  aspd?: number;
  weight?: number;
  maxWeight?: number;

  // Habilidades de Coleta e Profissões
  gatheringMiningLevel?: number;
  gatheringMiningXp?: number;
  gatheringHerbalismLevel?: number;
  gatheringHerbalismXp?: number;
  gatheringSkinningLevel?: number;
  gatheringSkinningXp?: number;
  gatheringWoodcuttingLevel?: number;
  gatheringWoodcuttingXp?: number;
  professionSmithingLevel?: number;
  professionSmithingXp?: number;
  professionAlchemyLevel?: number;
  professionAlchemyXp?: number;
  professionTanningLevel?: number;
  professionTanningXp?: number;
  learnedRecipes?: string[];
  uiPositions?: Record<string, { x: number, y: number }>;
  bankGold?: number;
  bankItems?: string[];
  bankDebtDays?: number;

  // Conta + sprite (multi-personagem)
  accountName?: string;
  spriteId?: string;

  // Missões
  quests?: Record<string, {
    started: boolean;
    completed: boolean;
    objectives: Record<string, number>;
    acceptedAt?: number;
    expiresAt?: number;
  }>;
}

export const SPRITE_IDS = ['m1', 'm2', 'f1', 'f2'] as const;
export type SpriteId = typeof SPRITE_IDS[number];

export type Facing = 'down' | 'up' | 'left' | 'right';
export const FACINGS: Facing[] = ['down', 'up', 'left', 'right'];

// Spritesheet layout: 192x96 = 12 cols x 4 rows of 16x24
//   Row 0=down, Row 1=up, Row 2=left, Row 3=right
//   Cols: m1(0-2), m2(3-5), f1(6-8), f2(9-11) — 3 walk frames each
export const WALK_FRAMES = 3;
export const FRAMES_PER_ROW = 12;

export function getFrameIndex(spriteId: SpriteId, facing: Facing, walkFrame: number = 0): number {
  const charIdx = SPRITE_IDS.indexOf(spriteId);
  if (charIdx < 0) return 0;
  const dirIdx = FACINGS.indexOf(facing);
  if (dirIdx < 0) return charIdx * WALK_FRAMES;
  const frame = Math.max(0, Math.min(WALK_FRAMES - 1, Math.floor(walkFrame)));
  return dirIdx * FRAMES_PER_ROW + charIdx * WALK_FRAMES + frame;
}

export interface CharacterSlot {
  slot: number;
  name: string;
  level: number;
  spriteId: string;
}

export interface Equipment {
  head?: string;
  body?: string;
  legs?: string;
  boots?: string;
  leftHand?: string;
  rightHand?: string;
  backpack?: string;
}

export interface CraftingStation {
  id: string;
  type: 'forge' | 'alchemy' | 'tanning';
  name: string;
  emoji: string;
  x: number;
  y: number;
}

export interface MapData {
  walls: Position[];
  /** Portões (1 tile) nas safe zones: player passa, monstro não. */
  gates: Position[];
  itemsOnFloor: ItemData[];
  resourceNodes: ResourceNode[];
  craftingStations: CraftingStation[];
}

export interface ItemData {
  id: string;
  name: string;
  emoji: string;
  x: number;
  y: number;
  weight?: number;
}

export interface ResourceNode {
  id: string;
  type: 'ore' | 'tree' | 'herb';
  name: string;
  emoji: string;
  x: number;
  y: number;
  charges: number;
  maxCharges: number;
  state: 'rich' | 'depleted';
  respawnTime?: number;
}


