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
        console.log('Conectado ao banco de dados PostgreSQL.');
    } catch (err) {
        console.error('Erro ao criar tabela:', err);
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
            backpack: JSON.parse(row.backpack)
        } as PlayerData;
    } catch (err) {
        console.error('getPlayerFromDB Error:', err);
        return null;
    }
}

export async function savePlayerToDB(player: PlayerData): Promise<void> {
    const stmt = `
        INSERT INTO players (id, name, x, y, level, experience, gold, stats, statPoints, sp, health, equipment, backpack)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT(name) DO UPDATE SET 
        id=excluded.id, x=excluded.x, y=excluded.y, level=excluded.level, experience=excluded.experience, 
        gold=excluded.gold, stats=excluded.stats, statPoints=excluded.statPoints, sp=excluded.sp, 
        health=excluded.health, equipment=excluded.equipment, backpack=excluded.backpack
    `;
    
    try {
        await pool.query(stmt, [
            player.id, player.name, player.x, player.y, player.level, player.experience, player.gold,
            JSON.stringify(player.stats), player.statPoints, player.sp, player.health,
            JSON.stringify(player.equipment || {}), JSON.stringify(player.backpack || [])
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
            backpack: JSON.parse(row.backpack || '[]')
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
