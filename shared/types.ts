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
}

export interface Equipment {
  head?: string;
  body?: string;
  legs?: string;
  boots?: string;
  leftHand?: string;
  rightHand?: string;
}

export interface MapData {
  walls: Position[];
  itemsOnFloor: ItemData[];
}

export interface ItemData {
  id: string;
  name: string;
  emoji: string;
  x: number;
  y: number;
  weight?: number;
}


