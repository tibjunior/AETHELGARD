import sqlite3 from 'sqlite3';
import { resolve } from 'path';
import { PlayerData } from '../../../shared/types';

const dbPath = resolve(process.cwd(), '../database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao abrir o banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
        db.run(`CREATE TABLE IF NOT EXISTS players (
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
        )`);
    }
});

// Helper functions for easy async queries
export function getPlayerFromDB(name: string): Promise<PlayerData | null> {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM players WHERE name = ?`, [name], (err, row: any) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            
            // Parse JSON fields
            resolve({
                id: row.id,
                name: row.name,
                x: row.x,
                y: row.y,
                level: row.level,
                experience: row.experience,
                gold: row.gold,
                stats: JSON.parse(row.stats),
                statPoints: row.statPoints,
                sp: row.sp,
                health: row.health,
                equipment: JSON.parse(row.equipment),
                backpack: JSON.parse(row.backpack)
            } as PlayerData);
        });
    });
}

export function savePlayerToDB(player: PlayerData): Promise<void> {
    return new Promise((resolve, reject) => {
        const stmt = `INSERT INTO players (id, name, x, y, level, experience, gold, stats, statPoints, sp, health, equipment, backpack)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(name) DO UPDATE SET 
                      id=excluded.id, x=excluded.x, y=excluded.y, level=excluded.level, experience=excluded.experience, 
                      gold=excluded.gold, stats=excluded.stats, statPoints=excluded.statPoints, sp=excluded.sp, 
                      health=excluded.health, equipment=excluded.equipment, backpack=excluded.backpack`;
        
        db.run(stmt, [
            player.id, player.name, player.x, player.y, player.level, player.experience, player.gold,
            JSON.stringify(player.stats), player.statPoints, player.sp, player.health,
            JSON.stringify(player.equipment || {}), JSON.stringify(player.backpack || [])
        ], (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

export function getAllRegisteredPlayers(): Promise<PlayerData[]> {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM players`, [], (err, rows: any[]) => {
            if (err) return reject(err);
            if (!rows) return resolve([]);
            
            const list = rows.map(row => ({
                id: row.id,
                name: row.name,
                x: row.x,
                y: row.y,
                level: row.level,
                experience: row.experience,
                gold: row.gold,
                stats: JSON.parse(row.stats || '{}'),
                statPoints: row.statPoints,
                sp: row.sp,
                health: row.health,
                equipment: JSON.parse(row.equipment || '{}'),
                backpack: JSON.parse(row.backpack || '[]')
            } as PlayerData));
            resolve(list);
        });
    });
}

export function updatePlayerOffline(name: string, level: number, gold: number, statPoints: number): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE players SET level = ?, gold = ?, statPoints = ? WHERE name = ?`, 
            [level, gold, statPoints, name], 
            (err) => {
                if (err) return reject(err);
                resolve();
            }
        );
    });
}

export function incrementGoldOffline(name: string, amount: number): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE players SET gold = gold + ? WHERE name = ?`, [amount, name], (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}
