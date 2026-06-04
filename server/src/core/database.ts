import { Pool } from 'pg';
import { PlayerData } from '../../../shared/types';

// O dotenv é útil para desenvolvimento local, se configurado. Na Render a variável vem do painel.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/aethelgard',
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('onrender.com') 
        ? { rejectUnauthorized: false } 
        : false
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Inicializa o BD
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE,
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

        // Adiciona colunas para Habilidades de Coleta e Profissões
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gathering_mining_level INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gathering_mining_xp INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gathering_herbalism_level INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gathering_herbalism_xp INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gathering_skinning_level INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gathering_skinning_xp INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gathering_woodcutting_level INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gathering_woodcutting_xp INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS profession_smithing_level INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS profession_smithing_xp INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS profession_alchemy_level INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS profession_alchemy_xp INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS profession_tanning_level INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS profession_tanning_xp INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS learned_recipes TEXT DEFAULT '[]'`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS ui_positions TEXT DEFAULT '{}'`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS password TEXT DEFAULT ''`);

        // Cria a tabela de Leilões
        await pool.query(`
            CREATE TABLE IF NOT EXISTS auctions (
                id SERIAL PRIMARY KEY,
                seller_name TEXT,
                item_data TEXT,
                price INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('Conectado ao banco de dados PostgreSQL e esquema de crafting e leilões inicializado.');
    } catch (err) {
        console.error('Erro ao criar tabela ou atualizar esquema:', err);
    }
}
initDB();

export async function getPlayerFromDB(name: string): Promise<PlayerData | null> {
    try {
        const res = await pool.query(`SELECT * FROM players WHERE name = $1`, [name]);
        if (res.rows.length === 0) return null;
        
        const row = res.rows[0];
        return {
            id: row.id,
            name: row.name,
            x: row.x,
            y: row.y,
            level: row.level,
            experience: row.experience,
            gold: row.gold,
            stats: JSON.parse(row.stats),
            statPoints: row.statpoints, // Postgres converte nomes de coluna para lowercase
            sp: row.sp,
            health: row.health,
            equipment: JSON.parse(row.equipment),
            backpack: JSON.parse(row.backpack),
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
            learnedRecipes: JSON.parse(row.learned_recipes || '[]'),
            uiPositions: JSON.parse(row.ui_positions || '{}'),
            password: row.password || ''
        } as PlayerData;
    } catch (err) {
        console.error('getPlayerFromDB Error:', err);
        return null;
    }
}

export async function savePlayerToDB(player: PlayerData): Promise<void> {
    const stmt = `
        INSERT INTO players (
            id, name, x, y, level, experience, gold, stats, statPoints, sp, health, equipment, backpack,
            gathering_mining_level, gathering_mining_xp,
            gathering_herbalism_level, gathering_herbalism_xp,
            gathering_skinning_level, gathering_skinning_xp,
            gathering_woodcutting_level, gathering_woodcutting_xp,
            profession_smithing_level, profession_smithing_xp,
            profession_alchemy_level, profession_alchemy_xp,
            profession_tanning_level, profession_tanning_xp,
            learned_recipes, ui_positions, password
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
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
        learned_recipes=excluded.learned_recipes, ui_positions=excluded.ui_positions, password=excluded.password
    `;
    
    try {
        await pool.query(stmt, [
            player.id, player.name, player.x, player.y, player.level, player.experience, player.gold,
            JSON.stringify(player.stats), player.statPoints, player.sp, player.health,
            JSON.stringify(player.equipment || {}), JSON.stringify(player.backpack || []),
            player.gatheringMiningLevel ?? 1, player.gatheringMiningXp ?? 0,
            player.gatheringHerbalismLevel ?? 1, player.gatheringHerbalismXp ?? 0,
            player.gatheringSkinningLevel ?? 1, player.gatheringSkinningXp ?? 0,
            player.gatheringWoodcuttingLevel ?? 1, player.gatheringWoodcuttingXp ?? 0,
            player.professionSmithingLevel ?? 1, player.professionSmithingXp ?? 0,
            player.professionAlchemyLevel ?? 1, player.professionAlchemyXp ?? 0,
            player.professionTanningLevel ?? 1, player.professionTanningXp ?? 0,
            JSON.stringify(player.learnedRecipes || []),
            JSON.stringify(player.uiPositions || {}),
            player.password || ''
        ]);
    } catch (err) {
        console.error('savePlayerToDB Error:', err);
        throw err;
    }
}

export async function getAllRegisteredPlayers(): Promise<PlayerData[]> {
    try {
        const res = await pool.query(`SELECT * FROM players`);
        return res.rows.map(row => ({
            id: row.id,
            name: row.name,
            x: row.x,
            y: row.y,
            level: row.level,
            experience: row.experience,
            gold: row.gold,
            stats: JSON.parse(row.stats || '{}'),
            statPoints: row.statpoints, // lowercase from PG
            sp: row.sp,
            health: row.health,
            equipment: JSON.parse(row.equipment || '{}'),
            backpack: JSON.parse(row.backpack || '[]'),
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
            learnedRecipes: JSON.parse(row.learned_recipes || '[]'),
            uiPositions: JSON.parse(row.ui_positions || '{}'),
            password: row.password || ''
        } as PlayerData));
    } catch (err) {
        console.error('getAllRegisteredPlayers Error:', err);
        return [];
    }
}

export async function updatePlayerOffline(name: string, level: number, gold: number, statPoints: number): Promise<void> {
    try {
        await pool.query(
            `UPDATE players SET level = $1, gold = $2, statPoints = $3 WHERE name = $4`, 
            [level, gold, statPoints, name]
        );
    } catch (err) {
        console.error('updatePlayerOffline Error:', err);
        throw err;
    }
}

export async function incrementGoldOffline(name: string, amount: number): Promise<void> {
    try {
        await pool.query(
            `UPDATE players SET gold = gold + $1 WHERE name = $2`, 
            [amount, name]
        );
    } catch (err) {
        console.error('incrementGoldOffline Error:', err);
        throw err;
    }
}

// Funções Auxiliares para a Casa de Leilões
export async function getAuctionsFromDB() {
    try {
        const res = await pool.query(`SELECT * FROM auctions ORDER BY created_at DESC`);
        return res.rows.map(row => ({
            id: row.id,
            sellerName: row.seller_name,
            itemData: JSON.parse(row.item_data),
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
        const res = await pool.query(
            `INSERT INTO auctions (seller_name, item_data, price) VALUES ($1, $2, $3) RETURNING id`,
            [sellerName, JSON.stringify(itemData), price]
        );
        return res.rows[0].id;
    } catch (err) {
        console.error('createAuctionInDB Error:', err);
        throw err;
    }
}

export async function removeAuctionFromDB(id: number): Promise<void> {
    try {
        await pool.query(`DELETE FROM auctions WHERE id = $1`, [id]);
    } catch (err) {
        console.error('removeAuctionFromDB Error:', err);
        throw err;
    }
}

export async function getAuctionByIdFromDB(id: number) {
    try {
        const res = await pool.query(`SELECT * FROM auctions WHERE id = $1`, [id]);
        if (res.rows.length === 0) return null;
        const row = res.rows[0];
        return {
            id: row.id,
            sellerName: row.seller_name,
            itemData: JSON.parse(row.item_data),
            price: row.price
        };
    } catch (err) {
        console.error('getAuctionByIdFromDB Error:', err);
        return null;
    }
}
