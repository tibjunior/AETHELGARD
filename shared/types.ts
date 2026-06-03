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
  isMonster?: boolean;
  targetId?: string; // ID de quem o jogador está atacando
  equipment?: Equipment;
  level: number;
  experience: number;
  gold?: number;
  backpack?: string[];
  facing?: string; // 'up', 'down', 'left', 'right'
  isDead?: boolean;
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
}

export interface Equipment {
  head?: string;
  body?: string;
  legs?: string;
  boots?: string;
  leftHand?: string;
  rightHand?: string;
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


