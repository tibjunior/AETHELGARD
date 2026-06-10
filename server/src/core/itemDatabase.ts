import * as fs from 'fs';
import * as path from 'path';

export interface ItemDef {
  name: string;
  emoji: string;
  namePt: string;
  type: 'consumable' | 'equippable' | 'material';
  weight: number;
  droppable: boolean;
  stackable: boolean;
  maxStack: number;
  sellPrice: number;
  // Consumable props
  property?: 'hp' | 'sp' | 'buff_atk' | 'buff_def' | 'buff_light';
  value?: number;
  // Equippable props
  slot?: 'rightHand' | 'leftHand' | 'head' | 'body' | 'legs' | 'boots' | 'backpack';
  attack?: number;
  matk?: number;
  defense?: number;
  mdef?: number;
  itemPower?: number;
  maxDurability?: number;
  backpackSlots?: number;
}

interface ItemsFile {
  version: number;
  items: ItemDef[];
}

let cache: ItemsFile | null = null;
const DATA_PATH = path.join(__dirname, '..', 'data', 'items.json');

function getDataPath(): string {
  return DATA_PATH;
}

export function loadItems(): ItemDef[] {
  if (cache) return cache.items;
  try {
    const raw = fs.readFileSync(getDataPath(), 'utf-8');
    const data: ItemsFile = JSON.parse(raw);
    cache = data;
    return data.items;
  } catch (e) {
    console.error('[ItemDB] Erro ao carregar items.json:', e);
    return [];
  }
}

export function saveItems(items: ItemDef[]): boolean {
  try {
    const data: ItemsFile = { version: 1, items };
    fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2), 'utf-8');
    cache = data;
    return true;
  } catch (e) {
    console.error('[ItemDB] Erro ao salvar items.json:', e);
    return false;
  }
}

export function getItem(name: string): ItemDef | undefined {
  return loadItems().find(i => i.name === name);
}

export function addItem(item: ItemDef): boolean {
  const items = loadItems();
  if (items.find(i => i.name === item.name)) return false;
  items.push(item);
  return saveItems(items);
}

export function updateItem(name: string, updates: Partial<ItemDef>): boolean {
  const items = loadItems();
  const idx = items.findIndex(i => i.name === name);
  if (idx === -1) return false;
  items[idx] = { ...items[idx], ...updates };
  return saveItems(items);
}

export function deleteItem(name: string): boolean {
  const items = loadItems();
  const idx = items.findIndex(i => i.name === name);
  if (idx === -1) return false;
  items.splice(idx, 1);
  return saveItems(items);
}

export function getItemsByType(type: 'consumable' | 'equippable' | 'material'): ItemDef[] {
  return loadItems().filter(i => i.type === type);
}
