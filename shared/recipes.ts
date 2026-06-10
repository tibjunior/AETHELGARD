export interface Recipe {
  id: string;
  name: string;
  profession: 'smithing' | 'alchemy' | 'tanning';
  stationType: 'forge' | 'alchemy' | 'tanning';
  levelRequired: number;
  ingredients: { itemName: string, count: number }[];
  resultItem: string;
  craftTimeMs: number;
  craftFee?: number;
}

export let CRAFTING_RECIPES: Recipe[] = [
  {
    id: 'recipe_wood_sword',
    name: 'Espada de Madeira',
    profession: 'tanning',
    stationType: 'tanning',
    levelRequired: 1,
    ingredients: [
      { itemName: 'Wood Log', count: 3 }
    ],
    resultItem: 'Wood Sword',
    craftTimeMs: 2000,
    craftFee: 0
  },
  {
    id: 'recipe_torch',
    name: 'Tocha de Fogo',
    profession: 'tanning',
    stationType: 'tanning',
    levelRequired: 1,
    ingredients: [
      { itemName: 'Wood Log', count: 1 },
      { itemName: 'Medicinal Herb', count: 1 }
    ],
    resultItem: 'Torch',
    craftTimeMs: 2000,
    craftFee: 0
  },
  {
    id: 'recipe_pants',
    name: 'Calças de Couro',
    profession: 'tanning',
    stationType: 'tanning',
    levelRequired: 1,
    ingredients: [
      { itemName: 'Leather Hide', count: 3 }
    ],
    resultItem: 'Pants',
    craftTimeMs: 3000,
    craftFee: 0
  },
  {
    id: 'recipe_leather_boots',
    name: 'Botas de Couro',
    profession: 'tanning',
    stationType: 'tanning',
    levelRequired: 1,
    ingredients: [
      { itemName: 'Leather Hide', count: 2 }
    ],
    resultItem: 'Leather Boots',
    craftTimeMs: 2500,
    craftFee: 0
  },
  {
    id: 'recipe_steel_sword',
    name: 'Espada de Aço',
    profession: 'smithing',
    stationType: 'forge',
    levelRequired: 3,
    ingredients: [
      { itemName: 'Iron Ore', count: 5 },
      { itemName: 'Wood Log', count: 2 }
    ],
    resultItem: 'Steel Sword',
    craftTimeMs: 3000,
    craftFee: 0
  },
  {
    id: 'recipe_helmet',
    name: 'Elmo de Aço',
    profession: 'smithing',
    stationType: 'forge',
    levelRequired: 2,
    ingredients: [
      { itemName: 'Iron Ore', count: 4 }
    ],
    resultItem: 'Helmet',
    craftTimeMs: 3000,
    craftFee: 0
  },
  {
    id: 'recipe_armor',
    name: 'Armadura de Placas',
    profession: 'smithing',
    stationType: 'forge',
    levelRequired: 3,
    ingredients: [
      { itemName: 'Iron Ore', count: 8 },
      { itemName: 'Leather Hide', count: 2 }
    ],
    resultItem: 'Armor',
    craftTimeMs: 4000,
    craftFee: 0
  },
  {
    id: 'recipe_health_potion',
    name: 'Poção de Vida',
    profession: 'alchemy',
    stationType: 'alchemy',
    levelRequired: 1,
    ingredients: [
      { itemName: 'Medicinal Herb', count: 2 },
      { itemName: 'Blueberry', count: 1 }
    ],
    resultItem: 'Health Potion',
    craftTimeMs: 2000,
    craftFee: 0
  },
  {
    id: 'recipe_mana_potion',
    name: 'Poção de Mana',
    profession: 'alchemy',
    stationType: 'alchemy',
    levelRequired: 2,
    ingredients: [
      { itemName: 'Medicinal Herb', count: 1 },
      { itemName: 'Blueberry', count: 2 }
    ],
    resultItem: 'Mana Potion',
    craftTimeMs: 2000,
    craftFee: 0
  },
  {
    id: 'recipe_leather_backpack',
    name: 'Mochila de Couro',
    profession: 'tanning',
    stationType: 'tanning',
    levelRequired: 2,
    ingredients: [
      { itemName: 'Leather Hide', count: 8 },
      { itemName: 'Wood Log', count: 2 }
    ],
    resultItem: 'Leather Backpack',
    craftTimeMs: 3000,
    craftFee: 0
  },
  {
    id: 'recipe_wooden_backpack',
    name: 'Mochila de Madeira',
    profession: 'tanning',
    stationType: 'tanning',
    levelRequired: 3,
    ingredients: [
      { itemName: 'Wood Log', count: 15 },
      { itemName: 'Leather Hide', count: 4 }
    ],
    resultItem: 'Wooden Backpack',
    craftTimeMs: 3000,
    craftFee: 0
  },
  {
    id: 'recipe_iron_backpack',
    name: 'Mochila de Ferro',
    profession: 'smithing',
    stationType: 'forge',
    levelRequired: 4,
    ingredients: [
      { itemName: 'Iron Ore', count: 20 },
      { itemName: 'Wood Log', count: 5 },
      { itemName: 'Leather Hide', count: 5 }
    ],
    resultItem: 'Iron Backpack',
    craftTimeMs: 4000,
    craftFee: 0
  },
  {
    id: 'recipe_wooden_shield',
    name: 'Escudo de Madeira',
    profession: 'tanning',
    stationType: 'tanning',
    levelRequired: 1,
    ingredients: [
      { itemName: 'Wood Log', count: 5 },
      { itemName: 'Leather Hide', count: 2 }
    ],
    resultItem: 'Wooden Shield',
    craftTimeMs: 2500,
    craftFee: 0
  },
  {
    id: 'recipe_iron_shield',
    name: 'Escudo de Ferro',
    profession: 'smithing',
    stationType: 'forge',
    levelRequired: 2,
    ingredients: [
      { itemName: 'Iron Ore', count: 8 },
      { itemName: 'Wood Log', count: 3 },
      { itemName: 'Leather Hide', count: 2 }
    ],
    resultItem: 'Iron Shield',
    craftTimeMs: 3500,
    craftFee: 0
  },
  {
    id: 'recipe_steel_shield',
    name: 'Escudo de Aço',
    profession: 'smithing',
    stationType: 'forge',
    levelRequired: 4,
    ingredients: [
      { itemName: 'Iron Ore', count: 15 },
      { itemName: 'Wood Log', count: 5 },
      { itemName: 'Leather Hide', count: 4 }
    ],
    resultItem: 'Steel Shield',
    craftTimeMs: 5000,
    craftFee: 0
  }
];
