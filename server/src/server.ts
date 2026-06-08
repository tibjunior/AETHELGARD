import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Game } from './core/Game';

dotenv.config();

// Global safety nets — log instead of crash on unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/aethelgard';

// Inicializar a lógica core do jogo
const game = new Game(io);

// Rota de saúde simples
app.get('/health', (req, res) => {
  res.send('Aethelgard Server is running.');
});

// Servir arquivos estáticos do client (Vite build em client/dist/)
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
// SPA fallback: qualquer rota não-API devolve o index.html
app.get('*', (req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

// Conectar ao MongoDB (comentado até o usuário ter a string real, usa memória por enquanto)
/*
mongoose.connect(MONGO_URI).then(() => {
  console.log('✅ Conectado ao MongoDB Aethelgard Database');
}).catch(err => {
  console.error('❌ Erro ao conectar no MongoDB:', err);
});
*/

server.listen(PORT, () => {
  console.log(`🗡️  Servidor de Aethelgard rodando na porta ${PORT}`);
  console.log(`📂 Servindo cliente de: ${clientDist}`);
  game.start();
});
