export interface SubskillDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  profession: 'mining' | 'herbalism' | 'woodcutting' | 'smithing' | 'alchemy' | 'tanning';
  requiredLevel: number;
  maxRank: number;
  xpPerRank: number;
  effectPerRank: string;
}

export const SUBSKILLS: SubskillDef[] = [
  // === MINERAÇÃO ===
  {
    id: 'mining_prospecting',
    name: 'Prospecção',
    icon: '💎',
    description: 'Chance de encontrar minérios raros',
    profession: 'mining',
    requiredLevel: 5,
    maxRank: 5,
    xpPerRank: 200,
    effectPerRank: '+4% chance de minério raro por rank',
  },
  {
    id: 'mining_hauling',
    name: 'Carregador',
    icon: '📦',
    description: 'Aumenta capacidade de peso',
    profession: 'mining',
    requiredLevel: 3,
    maxRank: 5,
    xpPerRank: 150,
    effectPerRank: '+10 peso máximo por rank',
  },
  // === HERBOLOGIA ===
  {
    id: 'herbalism_botany',
    name: 'Botânico',
    icon: '🌱',
    description: 'Chance de dobrar a quantidade de ervas coletadas',
    profession: 'herbalism',
    requiredLevel: 5,
    maxRank: 5,
    xpPerRank: 200,
    effectPerRank: '+5% chance de dobrar erva por rank',
  },
  {
    id: 'herbalism_identification',
    name: 'Identificador',
    icon: '🔍',
    description: 'Revela propriedades ocultas das ervas',
    profession: 'herbalism',
    requiredLevel: 3,
    maxRank: 3,
    xpPerRank: 250,
    effectPerRank: 'Desbloqueia receitas de alquimia por rank',
  },
  // === MADEIREIRO ===
  {
    id: 'woodcutting_lumberjack',
    name: 'Lenhador',
    icon: '🪓',
    description: 'Coleta mais madeira por nó',
    profession: 'woodcutting',
    requiredLevel: 5,
    maxRank: 5,
    xpPerRank: 200,
    effectPerRank: '+1 madeira por nó por rank',
  },
  {
    id: 'woodcutting_silviculture',
    name: 'Silvicultor',
    icon: '🌳',
    description: 'Chance de encontrar madeira mágica',
    profession: 'woodcutting',
    requiredLevel: 8,
    maxRank: 5,
    xpPerRank: 300,
    effectPerRank: '+3% chance de madeira mágica por rank',
  },
  // === FERRARIA ===
  {
    id: 'smithing_weaponsmith',
    name: 'Armeiro',
    icon: '🗡️',
    description: 'Fabricação de armas com bônus de ATK',
    profession: 'smithing',
    requiredLevel: 5,
    maxRank: 5,
    xpPerRank: 250,
    effectPerRank: '+2 ATK em armas fabricadas por rank',
  },
  {
    id: 'smithing_armorsmith',
    name: 'Armaduras',
    icon: '🛡️',
    description: 'Fabricação de armaduras com bônus de DEF',
    profession: 'smithing',
    requiredLevel: 5,
    maxRank: 5,
    xpPerRank: 250,
    effectPerRank: '+2 DEF em armaduras fabricadas por rank',
  },
  // === ALQUIMIA ===
  {
    id: 'alchemy_potions',
    name: 'Poções',
    icon: '🧪',
    description: 'Poções fabricadas duram mais',
    profession: 'alchemy',
    requiredLevel: 5,
    maxRank: 5,
    xpPerRank: 250,
    effectPerRank: '+5% duração de poções por rank',
  },
  {
    id: 'alchemy_transmutation',
    name: 'Transmutação',
    icon: '🔮',
    description: 'Converte itens comuns em outros materiais',
    profession: 'alchemy',
    requiredLevel: 10,
    maxRank: 3,
    xpPerRank: 500,
    effectPerRank: 'Desbloqueia receita de transmutação por rank',
  },
  // === ALFAIATARIA ===
  {
    id: 'tanning_lightarmor',
    name: 'Armaduras Leves',
    icon: '👕',
    description: 'Armaduras leves fabricadas dão bônus de esquiva',
    profession: 'tanning',
    requiredLevel: 5,
    maxRank: 5,
    xpPerRank: 250,
    effectPerRank: '+1% DODGE em armaduras leves por rank',
  },
  {
    id: 'tanning_packs',
    name: 'Bolsas',
    icon: '🎒',
    description: 'Fabricação de bolsas que aumentam slots da mochila',
    profession: 'tanning',
    requiredLevel: 8,
    maxRank: 3,
    xpPerRank: 400,
    effectPerRank: 'Desbloqueia receita de bolsa por rank',
  },
];

export function getSubskillsByProfession(profession: string): SubskillDef[] {
  return SUBSKILLS.filter(s => s.profession === profession);
}
