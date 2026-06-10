import Database from 'better-sqlite3';
import path from 'path';
import { PlayerData } from '../../../shared/types';

// Banco de dados SQLite local (arquivo único no disco)
// Quando voltar a publicar, basta trocar este adapter pelo `pg` e ajustar a sintaxe.
const DB_PATH = process.env.SQLITE_PATH || path.resolve(__dirname, '../../../database.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// =============================================================
// Schema & Migrations
// =============================================================
function migrate() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS players (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            x INTEGER,
            y INTEGER,
            level INTEGER,
            experience INTEGER,
            gold INTEGER,
            stats TEXT,
            statPoints INTEGER,
            sp INTEGER,
            health INTEGER,
            equipment TEXT,
            backpack TEXT
        )
    `);

    // Colunas adicionadas em fases posteriores (SQLite não suporta IF NOT EXISTS em colunas,
    // então checamos PRAGMA table_info e adicionamos se faltar).
    const playerCols = db.prepare(`PRAGMA table_info(players)`).all() as { name: string }[];
    const existing = new Set(playerCols.map(c => c.name));

    const addColumn = (col: string, def: string) => {
        if (!existing.has(col)) {
            try {
                db.exec(`ALTER TABLE players ADD COLUMN ${col} ${def}`);
            } catch (e) {
                console.warn(`[DB] Falha ao adicionar coluna ${col}:`, e);
            }
        }
    };

    addColumn('gathering_mining_level',    'INTEGER DEFAULT 1');
    addColumn('gathering_mining_xp',       'REAL DEFAULT 0');
    addColumn('gathering_herbalism_level', 'INTEGER DEFAULT 1');
    addColumn('gathering_herbalism_xp',    'REAL DEFAULT 0');
    addColumn('gathering_skinning_level',  'INTEGER DEFAULT 1');
    addColumn('gathering_skinning_xp',     'REAL DEFAULT 0');
    addColumn('gathering_woodcutting_level','INTEGER DEFAULT 1');
    addColumn('gathering_woodcutting_xp',  'REAL DEFAULT 0');
    addColumn('profession_smithing_level', 'INTEGER DEFAULT 1');
    addColumn('profession_smithing_xp',    'REAL DEFAULT 0');
    addColumn('profession_alchemy_level',  'INTEGER DEFAULT 1');
    addColumn('profession_alchemy_xp',     'REAL DEFAULT 0');
    addColumn('profession_tanning_level',  'INTEGER DEFAULT 1');
    addColumn('profession_tanning_xp',     'REAL DEFAULT 0');
    addColumn('learned_recipes',           "TEXT DEFAULT '[]'");
    addColumn('ui_positions',              "TEXT DEFAULT '{}'");
    addColumn('password',                  "TEXT DEFAULT ''");
    addColumn('bank_gold',                 'INTEGER DEFAULT 0');
    addColumn('bank_items',                "TEXT DEFAULT '[]'");
    addColumn('bank_debt_days',            'INTEGER DEFAULT 0');
    addColumn('account_name',              "TEXT DEFAULT ''");
    addColumn('sprite_id',                 "TEXT DEFAULT 'm1'");
    addColumn('quests',                    "TEXT DEFAULT '{}'");
    addColumn('subskills',                 "TEXT DEFAULT '{}'");

    db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
            account_name TEXT PRIMARY KEY,
            password TEXT NOT NULL DEFAULT '',
            max_characters INTEGER DEFAULT 4,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS auctions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seller_name TEXT,
            item_data TEXT,
            price INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS server_config (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    console.log(`[DB] SQLite inicializado em ${DB_PATH}`);
}
migrate();

// =============================================================
// Server Config persistence
// =============================================================
export function saveConfigToDB(key: string, value: any): void {
    try {
        const json = JSON.stringify(value);
        db.prepare(`INSERT INTO server_config (key, value) VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
          .run(key, json);
    } catch (err) {
        console.error(`saveConfigToDB(${key}) Error:`, err);
    }
}

export function loadConfigFromDB(key: string): any | null {
    try {
        const row = db.prepare(`SELECT value FROM server_config WHERE key = ?`).get(key) as any;
        if (!row) return null;
        return JSON.parse(row.value);
    } catch (err) {
        console.error(`loadConfigFromDB(${key}) Error:`, err);
        return null;
    }
}

export function loadAllConfigFromDB(): Record<string, any> {
    try {
        const rows = db.prepare(`SELECT key, value FROM server_config`).all() as any[];
        const out: Record<string, any> = {};
        for (const r of rows) {
            try { out[r.key] = JSON.parse(r.value); } catch {}
        }
        return out;
    } catch (err) {
        console.error('loadAllConfigFromDB Error:', err);
        return {};
    }
}

// =============================================================
// Helpers de mapeamento linha ↔ PlayerData
// =============================================================
function rowToPlayer(row: any): PlayerData {
    return {
        id: row.id,
        name: row.name,
        x: row.x,
        y: row.y,
        level: row.level,
        experience: row.experience,
        gold: row.gold,
        stats: safeJson(row.stats, {}),
        statPoints: row.statPoints ?? 0,
        sp: row.sp,
        health: row.health,
        equipment: safeJson(row.equipment, {}),
        backpack: safeJson(row.backpack, []),
        gatheringMiningLevel: row.gathering_mining_level ?? 1,
        gatheringMiningXp: row.gathering_mining_xp ?? 0,
        gatheringHerbalismLevel: row.gathering_herbalism_level ?? 1,
        gatheringHerbalismXp: row.gathering_herbalism_xp ?? 0,
        gatheringSkinningLevel: row.gathering_skinning_level ?? 1,
        gatheringSkinningXp: row.gathering_skinning_xp ?? 0,
        gatheringWoodcuttingLevel: row.gathering_woodcutting_level ?? 1,
        gatheringWoodcuttingXp: row.gathering_woodcutting_xp ?? 0,
        professionSmithingLevel: row.profession_smithing_level ?? 1,
        professionSmithingXp: row.profession_smithing_xp ?? 0,
        professionAlchemyLevel: row.profession_alchemy_level ?? 1,
        professionAlchemyXp: row.profession_alchemy_xp ?? 0,
        professionTanningLevel: row.profession_tanning_level ?? 1,
        professionTanningXp: row.profession_tanning_xp ?? 0,
        learnedRecipes: safeJson(row.learned_recipes, []),
        uiPositions: safeJson(row.ui_positions, {}),
        password: row.password || '',
        bankGold: row.bank_gold ?? 0,
        bankItems: safeJson(row.bank_items, []),
        bankDebtDays: row.bank_debt_days ?? 0,
        accountName: row.account_name || row.name || '',
        spriteId: row.sprite_id || 'm1',
        quests: safeJson(row.quests, {}),
        subskills: safeJson(row.subskills, {}),
    } as PlayerData;
}

function safeJson<T>(value: any, fallback: T): T {
    if (value == null || value === '') return fallback;
    try { return JSON.parse(value) as T; }
    catch { return fallback; }
}

// =============================================================
// Players
// =============================================================
export async function getPlayerFromDB(name: string): Promise<PlayerData | null> {
    try {
        const row = db.prepare(`SELECT * FROM players WHERE name = ?`).get(name) as any;
        if (!row) return null;
        return rowToPlayer(row);
    } catch (err) {
        console.error('getPlayerFromDB Error:', err);
        return null;
    }
}

export async function savePlayerToDB(player: PlayerData): Promise<void> {
    const stmt = db.prepare(`
        INSERT INTO players (
            id, name, x, y, level, experience, gold, stats, statPoints, sp, health, equipment, backpack,
            gathering_mining_level, gathering_mining_xp,
            gathering_herbalism_level, gathering_herbalism_xp,
            gathering_skinning_level, gathering_skinning_xp,
            gathering_woodcutting_level, gathering_woodcutting_xp,
            profession_smithing_level, profession_smithing_xp,
            profession_alchemy_level, profession_alchemy_xp,
            profession_tanning_level, profession_tanning_xp,
            learned_recipes, ui_positions, password,
            bank_gold, bank_items, bank_debt_days,
            account_name, sprite_id, quests, subskills
        )
        VALUES (
            @id, @name, @x, @y, @level, @experience, @gold, @stats, @statPoints, @sp, @health, @equipment, @backpack,
            @gatheringMiningLevel, @gatheringMiningXp,
            @gatheringHerbalismLevel, @gatheringHerbalismXp,
            @gatheringSkinningLevel, @gatheringSkinningXp,
            @gatheringWoodcuttingLevel, @gatheringWoodcuttingXp,
            @professionSmithingLevel, @professionSmithingXp,
            @professionAlchemyLevel, @professionAlchemyXp,
            @professionTanningLevel, @professionTanningXp,
            @learnedRecipes, @uiPositions, @password,
            @bankGold, @bankItems, @bankDebtDays,
            @accountName, @spriteId, @quests, @subskills
        )
        ON CONFLICT(name) DO UPDATE SET
            id=excluded.id, x=excluded.x, y=excluded.y, level=excluded.level, experience=excluded.experience,
            gold=excluded.gold, stats=excluded.stats, statPoints=excluded.statPoints, sp=excluded.sp,
            health=excluded.health, equipment=excluded.equipment, backpack=excluded.backpack,
            gathering_mining_level=excluded.gathering_mining_level, gathering_mining_xp=excluded.gathering_mining_xp,
            gathering_herbalism_level=excluded.gathering_herbalism_level, gathering_herbalism_xp=excluded.gathering_herbalism_xp,
            gathering_skinning_level=excluded.gathering_skinning_level, gathering_skinning_xp=excluded.gathering_skinning_xp,
            gathering_woodcutting_level=excluded.gathering_woodcutting_level, gathering_woodcutting_xp=excluded.gathering_woodcutting_xp,
            profession_smithing_level=excluded.profession_smithing_level, profession_smithing_xp=excluded.profession_smithing_xp,
            profession_alchemy_level=excluded.profession_alchemy_level, profession_alchemy_xp=excluded.profession_alchemy_xp,
            profession_tanning_level=excluded.profession_tanning_level, profession_tanning_xp=excluded.profession_tanning_xp,
            learned_recipes=excluded.learned_recipes, ui_positions=excluded.ui_positions, password=excluded.password,
            bank_gold=excluded.bank_gold, bank_items=excluded.bank_items, bank_debt_days=excluded.bank_debt_days,
            account_name=excluded.account_name, sprite_id=excluded.sprite_id, quests=excluded.quests, subskills=excluded.subskills
    `);

    try {
        stmt.run({
            id: player.id,
            name: player.name,
            x: player.x,
            y: player.y,
            level: player.level,
            experience: player.experience,
            gold: player.gold,
            stats: JSON.stringify(player.stats ?? {}),
            statPoints: player.statPoints ?? 0,
            sp: player.sp,
            health: player.health,
            equipment: JSON.stringify(player.equipment ?? {}),
            backpack: JSON.stringify(player.backpack ?? []),
            gatheringMiningLevel: player.gatheringMiningLevel ?? 1,
            gatheringMiningXp: player.gatheringMiningXp ?? 0,
            gatheringHerbalismLevel: player.gatheringHerbalismLevel ?? 1,
            gatheringHerbalismXp: player.gatheringHerbalismXp ?? 0,
            gatheringSkinningLevel: player.gatheringSkinningLevel ?? 1,
            gatheringSkinningXp: player.gatheringSkinningXp ?? 0,
            gatheringWoodcuttingLevel: player.gatheringWoodcuttingLevel ?? 1,
            gatheringWoodcuttingXp: player.gatheringWoodcuttingXp ?? 0,
            professionSmithingLevel: player.professionSmithingLevel ?? 1,
            professionSmithingXp: player.professionSmithingXp ?? 0,
            professionAlchemyLevel: player.professionAlchemyLevel ?? 1,
            professionAlchemyXp: player.professionAlchemyXp ?? 0,
            professionTanningLevel: player.professionTanningLevel ?? 1,
            professionTanningXp: player.professionTanningXp ?? 0,
            learnedRecipes: JSON.stringify(player.learnedRecipes ?? []),
            uiPositions: JSON.stringify(player.uiPositions ?? {}),
            password: player.password ?? '',
            bankGold: player.bankGold ?? 0,
            bankItems: JSON.stringify(player.bankItems ?? []),
            bankDebtDays: player.bankDebtDays ?? 0,
            accountName: player.accountName || player.name || '',
            spriteId: player.spriteId || 'm1',
            quests: JSON.stringify(player.quests ?? {}),
            subskills: JSON.stringify(player.subskills ?? {})
        });
    } catch (err) {
        console.error('savePlayerToDB Error:', err);
        throw err;
    }
}

export async function getAllRegisteredPlayers(): Promise<PlayerData[]> {
    try {
        const rows = db.prepare(`SELECT * FROM players`).all() as any[];
        return rows.map(rowToPlayer);
    } catch (err) {
        console.error('getAllRegisteredPlayers Error:', err);
        return [];
    }
}

export async function updatePlayerOffline(name: string, level: number, gold: number, statPoints: number): Promise<void> {
    try {
        db.prepare(`UPDATE players SET level = ?, gold = ?, statPoints = ? WHERE name = ?`)
          .run(level, gold, statPoints, name);
    } catch (err) {
        console.error('updatePlayerOffline Error:', err);
        throw err;
    }
}

export async function incrementGoldOffline(name: string, amount: number): Promise<void> {
    try {
        db.prepare(`UPDATE players SET gold = gold + ? WHERE name = ?`).run(amount, name);
    } catch (err) {
        console.error('incrementGoldOffline Error:', err);
        throw err;
    }
}

export async function deletePlayerFromDB(name: string): Promise<void> {
    try {
        db.prepare(`DELETE FROM players WHERE name = ?`).run(name);
    } catch (err) {
        console.error('deletePlayerFromDB Error:', err);
        throw err;
    }
}

// =============================================================
// Auctions
// =============================================================
export async function getAuctionsFromDB() {
    try {
        const rows = db.prepare(`SELECT * FROM auctions ORDER BY created_at DESC`).all() as any[];
        return rows.map(row => ({
            id: row.id,
            sellerName: row.seller_name,
            itemData: safeJson(row.item_data, {}),
            price: row.price,
            createdAt: row.created_at
        }));
    } catch (err) {
        console.error('getAuctionsFromDB Error:', err);
        return [];
    }
}

export async function createAuctionInDB(sellerName: string, itemData: any, price: number): Promise<number> {
    try {
        const info = db.prepare(
            `INSERT INTO auctions (seller_name, item_data, price) VALUES (?, ?, ?)`
        ).run(sellerName, JSON.stringify(itemData), price);
        return Number(info.lastInsertRowid);
    } catch (err) {
        console.error('createAuctionInDB Error:', err);
        throw err;
    }
}

export async function removeAuctionFromDB(id: number): Promise<void> {
    try {
        db.prepare(`DELETE FROM auctions WHERE id = ?`).run(id);
    } catch (err) {
        console.error('removeAuctionFromDB Error:', err);
        throw err;
    }
}

export async function getAuctionByIdFromDB(id: number) {
    try {
        const row = db.prepare(`SELECT * FROM auctions WHERE id = ?`).get(id) as any;
        if (!row) return null;
        return {
            id: row.id,
            sellerName: row.seller_name,
            itemData: safeJson(row.item_data, {}),
            price: row.price
        };
    } catch (err) {
        console.error('getAuctionByIdFromDB Error:', err);
        return null;
    }
}

// =============================================================
// Bank debt
// =============================================================
export async function deductOfflineBankGold(onlineNames: string[], maxDebtDays: number = -20, dailyFee: number = 1): Promise<void> {
    try {
        const safeFee = Math.max(0, dailyFee);
        const safeMaxDebtDays = Math.floor(maxDebtDays);
        if (onlineNames.length > 0) {
            const placeholders = onlineNames.map(() => '?').join(', ');
            db.prepare(`
                UPDATE players
                SET
                    bank_gold = CASE WHEN bank_gold > 0 THEN bank_gold - ? ELSE bank_gold END,
                    bank_debt_days = CASE WHEN bank_gold <= 0 AND bank_debt_days > ? THEN bank_debt_days - 1 ELSE bank_debt_days END
                WHERE name NOT IN (${placeholders})
            `).run(safeFee, safeMaxDebtDays, ...onlineNames);
        } else {
            db.prepare(`
                UPDATE players
                SET
                    bank_gold = CASE WHEN bank_gold > 0 THEN bank_gold - ? ELSE bank_gold END,
                    bank_debt_days = CASE WHEN bank_gold <= 0 AND bank_debt_days > ? THEN bank_debt_days - 1 ELSE bank_debt_days END
            `).run(safeFee, safeMaxDebtDays);
        }
    } catch (err) {
        console.error('deductOfflineBankGold Error:', err);
    }
}

// =============================================================
// Accounts (login por conta, até 4 personagens por conta)
// =============================================================
export interface AccountRow {
    accountName: string;
    password: string;
    maxCharacters: number;
    createdAt: string;
}

export async function getAccountFromDB(accountName: string): Promise<AccountRow | null> {
    try {
        const row = db.prepare(`SELECT * FROM accounts WHERE account_name = ?`).get(accountName) as any;
        if (!row) return null;
        return {
            accountName: row.account_name,
            password: row.password,
            maxCharacters: row.max_characters,
            createdAt: row.created_at
        };
    } catch (err) {
        console.error('getAccountFromDB Error:', err);
        return null;
    }
}

export async function createAccountInDB(accountName: string, password: string): Promise<{ ok: boolean; reason?: string }> {
    if (!accountName || accountName.length < 3 || accountName.length > 20) return { ok: false, reason: 'Nome deve ter 3-20 caracteres.' };
    if (!/^[a-zA-Z0-9_]+$/.test(accountName)) return { ok: false, reason: 'Use apenas letras, números e underscore.' };
    if (!password || password.length < 3) return { ok: false, reason: 'Senha deve ter pelo menos 3 caracteres.' };
    try {
        const existing = await getAccountFromDB(accountName);
        if (existing) return { ok: false, reason: 'Conta já existe.' };
        db.prepare(`INSERT INTO accounts (account_name, password) VALUES (?, ?)`).run(accountName, password);
        return { ok: true };
    } catch (err: any) {
        if (String(err).includes('UNIQUE')) return { ok: false, reason: 'Conta já existe.' };
        console.error('createAccountInDB Error:', err);
        return { ok: false, reason: 'Erro ao criar conta.' };
    }
}

export async function setAccountPassword(accountName: string, newPassword: string): Promise<{ ok: boolean; reason?: string }> {
    if (!newPassword || newPassword.length < 3 || newPassword.length > 8) {
        return { ok: false, reason: 'Senha deve ter 3-8 caracteres.' };
    }
    try {
        const result = db.prepare(`UPDATE accounts SET password = ? WHERE account_name = ?`).run(newPassword, accountName);
        if (result.changes === 0) return { ok: false, reason: 'Conta não encontrada.' };
        return { ok: true };
    } catch (err) {
        console.error('setAccountPassword Error:', err);
        return { ok: false, reason: 'Erro ao atualizar senha.' };
    }
}

export async function listCharactersForAccount(accountName: string): Promise<{ slot: number; name: string; level: number; spriteId: string }[]> {
    try {
        const rows = db.prepare(`
            SELECT name, level, sprite_id FROM players
            WHERE account_name = ? OR (account_name = '' AND name = ?)
            ORDER BY level DESC, name ASC
        `).all(accountName, accountName) as any[];
        return rows.map((r, i) => ({
            slot: i + 1,
            name: r.name,
            level: r.level ?? 1,
            spriteId: r.sprite_id || 'm1'
        }));
    } catch (err) {
        console.error('listCharactersForAccount Error:', err);
        return [];
    }
}

export async function countCharactersForAccount(accountName: string): Promise<number> {
    try {
        const row = db.prepare(`
            SELECT COUNT(*) as c FROM players
            WHERE account_name = ? OR (account_name = '' AND name = ?)
        `).get(accountName, accountName) as any;
        return row?.c ?? 0;
    } catch (err) {
        console.error('countCharactersForAccount Error:', err);
        return 0;
    }
}

export async function deleteCharacterFromAccount(accountName: string, characterName: string): Promise<{ ok: boolean; reason?: string }> {
    try {
        const row = db.prepare(`
            SELECT id, name, level FROM players
            WHERE name = ? AND (account_name = ? OR (account_name = '' AND name = ?))
        `).get(characterName, accountName, accountName) as any;
        if (!row) return { ok: false, reason: 'Personagem não encontrado.' };
        if ((row.level ?? 1) > 10) return { ok: false, reason: 'Personagens acima do nível 10 não podem ser deletados (contate um admin).' };
        db.prepare(`DELETE FROM players WHERE name = ?`).run(characterName);
        return { ok: true };
    } catch (err) {
        console.error('deleteCharacterFromAccount Error:', err);
        return { ok: false, reason: 'Erro ao deletar personagem.' };
    }
}

export async function createCharacterInDBTx(accountName: string, playerData: PlayerData): Promise<{ ok: boolean; reason?: string; slot?: number }> {
    try {
        const result = db.transaction(() => {
            const account = db.prepare(`SELECT max_characters FROM accounts WHERE account_name = ?`).get(accountName) as { max_characters: number } | undefined;
            if (!account) throw new Error('Conta não encontrada.');
            
            const count = db.prepare(`
                SELECT COUNT(*) as c FROM players
                WHERE account_name = ? OR (account_name = '' AND name = ?)
            `).get(accountName, accountName) as { c: number };
            
            if (count.c >= account.max_characters) throw new Error(`Limite de ${account.max_characters} personagens atingido.`);
            
            const existing = db.prepare(`SELECT name FROM players WHERE name = ?`).get(playerData.name);
            if (existing) throw new Error('Já existe um personagem com esse nome.');
            
            const stmt = db.prepare(`
                INSERT INTO players (
                    id, name, x, y, level, experience, gold, stats, statPoints, sp, health, equipment, backpack,
                    gathering_mining_level, gathering_mining_xp,
                    gathering_herbalism_level, gathering_herbalism_xp,
                    gathering_skinning_level, gathering_skinning_xp,
                    gathering_woodcutting_level, gathering_woodcutting_xp,
                    profession_smithing_level, profession_smithing_xp,
                    profession_alchemy_level, profession_alchemy_xp,
                    profession_tanning_level, profession_tanning_xp,
                    learned_recipes, ui_positions, password,
                    bank_gold, bank_items, bank_debt_days,
                    account_name, sprite_id, quests, subskills
                ) VALUES (
                    @id, @name, @x, @y, @level, @experience, @gold, @stats, @statPoints, @sp, @health, @equipment, @backpack,
                    @gatheringMiningLevel, @gatheringMiningXp,
                    @gatheringHerbalismLevel, @gatheringHerbalismXp,
                    @gatheringSkinningLevel, @gatheringSkinningXp,
                    @gatheringWoodcuttingLevel, @gatheringWoodcuttingXp,
                    @professionSmithingLevel, @professionSmithingXp,
                    @professionAlchemyLevel, @professionAlchemyXp,
                    @professionTanningLevel, @professionTanningXp,
                    @learnedRecipes, @uiPositions, @password,
                    @bankGold, @bankItems, @bankDebtDays,
                    @accountName, @spriteId, @quests, @subskills
                )
            `);
            
            stmt.run({
                id: playerData.id,
                name: playerData.name,
                x: playerData.x,
                y: playerData.y,
                level: playerData.level,
                experience: playerData.experience,
                gold: playerData.gold,
                stats: JSON.stringify(playerData.stats ?? {}),
                statPoints: playerData.statPoints ?? 0,
                sp: playerData.sp,
                health: playerData.health,
                equipment: JSON.stringify(playerData.equipment ?? {}),
                backpack: JSON.stringify(playerData.backpack ?? []),
                gatheringMiningLevel: playerData.gatheringMiningLevel ?? 1,
                gatheringMiningXp: playerData.gatheringMiningXp ?? 0,
                gatheringHerbalismLevel: playerData.gatheringHerbalismLevel ?? 1,
                gatheringHerbalismXp: playerData.gatheringHerbalismXp ?? 0,
                gatheringSkinningLevel: playerData.gatheringSkinningLevel ?? 1,
                gatheringSkinningXp: playerData.gatheringSkinningXp ?? 0,
                gatheringWoodcuttingLevel: playerData.gatheringWoodcuttingLevel ?? 1,
                gatheringWoodcuttingXp: playerData.gatheringWoodcuttingXp ?? 0,
                professionSmithingLevel: playerData.professionSmithingLevel ?? 1,
                professionSmithingXp: playerData.professionSmithingXp ?? 0,
                professionAlchemyLevel: playerData.professionAlchemyLevel ?? 1,
                professionAlchemyXp: playerData.professionAlchemyXp ?? 0,
                professionTanningLevel: playerData.professionTanningLevel ?? 1,
                professionTanningXp: playerData.professionTanningXp ?? 0,
                learnedRecipes: JSON.stringify(playerData.learnedRecipes ?? []),
                uiPositions: JSON.stringify(playerData.uiPositions ?? {}),
                password: playerData.password ?? '',
                bankGold: playerData.bankGold ?? 0,
                bankItems: JSON.stringify(playerData.bankItems ?? []),
                bankDebtDays: playerData.bankDebtDays ?? 0,
                accountName: playerData.accountName || playerData.name || '',
                spriteId: playerData.spriteId || 'm1',
                quests: JSON.stringify(playerData.quests ?? {}),
                subskills: JSON.stringify(playerData.subskills ?? {})
            });
            
            return { slot: count.c + 1 };
        })();
        
        return { ok: true, slot: result.slot };
    } catch (err: any) {
        const msg = String(err);
        if (msg.includes('UNIQUE') || msg.includes('unique')) return { ok: false, reason: 'Já existe um personagem com esse nome.' };
        if (msg.includes('Limite')) return { ok: false, reason: msg };
        if (msg.includes('Conta não encontrada')) return { ok: false, reason: 'Conta não encontrada.' };
        console.error('createCharacterInDBTx Error:', err);
        return { ok: false, reason: 'Erro ao criar personagem.' };
    }
}
