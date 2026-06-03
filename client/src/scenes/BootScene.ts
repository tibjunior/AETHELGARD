import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    // Aqui no futuro carregaremos os assets encontrados pela nossa IA de pesquisa
    // Por enquanto, geraremos texturas dinâmicas (placeholders) para não depender de arquivos de imagem locais que não baixamos ainda.
    
    // Melhorando a Grama (Grass Tile com textura)
    const canvas = this.textures.createCanvas('tile-grass', 32, 32);
    if (canvas && canvas.context) {
        const ctx = canvas.context;
        ctx.fillStyle = '#166534'; // Verde escuro base
        ctx.fillRect(0, 0, 32, 32);
        // Adiciona "noise" de grama
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#15803d' : '#22c55e';
            ctx.fillRect(Math.random() * 32, Math.random() * 32, 2, 2);
        }
        canvas.refresh();
    }

    // Melhorando o Cavaleiro (Tiberius)
    const knightCanvas = this.textures.createCanvas('tiberius-sprite', 32, 32);
    if (knightCanvas && knightCanvas.context) {
        const ctx = knightCanvas.context;
        // Corpo (Armadura de Prata)
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(8, 8, 16, 20);
        // Capacete
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(10, 4, 12, 8);
        // Viseira escura
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(12, 8, 8, 2);
        // Capa
        ctx.fillStyle = '#991b1b'; // Vermelha
        ctx.fillRect(6, 10, 4, 16);
        // Espada (Mão Direita)
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(24, 12, 2, 14);
        ctx.fillStyle = '#b45309'; // Punho
        ctx.fillRect(22, 24, 6, 2);
        
        knightCanvas.refresh();
    }

    // Criando Parede de Pedra (Stone Wall)
    const wallCanvas = this.textures.createCanvas('tile-wall', 32, 32);
    if (wallCanvas && wallCanvas.context) {
        const ctx = wallCanvas.context;
        ctx.fillStyle = '#475569'; // Cinza base
        ctx.fillRect(0, 0, 32, 32);
        // Tijolos escuros e claros
        ctx.fillStyle = '#334155';
        ctx.fillRect(0, 16, 32, 2);
        ctx.fillRect(16, 0, 2, 32);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(0, 0, 16, 2);
        ctx.fillRect(0, 0, 2, 16);
        ctx.fillRect(16, 16, 16, 2);
        
        wallCanvas.refresh();
    }

    // Criando o Rato (Giant Rat)
    const ratCanvas = this.textures.createCanvas('rat-sprite', 32, 32);
    if (ratCanvas && ratCanvas.context) {
        const ctx = ratCanvas.context;
        ctx.fillStyle = '#78350f'; // Marrom
        ctx.fillRect(4, 12, 24, 12);
        // Orelhas
        ctx.fillStyle = '#b45309';
        ctx.fillRect(6, 8, 6, 6);
        ctx.fillRect(20, 8, 6, 6);
        // Olhos vermelhos de monstro
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(8, 14, 2, 2);
        ctx.fillRect(22, 14, 2, 2);
        
        ratCanvas.refresh();
    }

    // Criando o Orc (Level 3)
    const orcCanvas = this.textures.createCanvas('orc-sprite', 32, 32);
    if (orcCanvas && orcCanvas.context) {
        const ctx = orcCanvas.context;
        ctx.fillStyle = '#16a34a'; // Verde Orc
        ctx.fillRect(8, 6, 16, 22);
        // Armadura de Couro
        ctx.fillStyle = '#78350f';
        ctx.fillRect(6, 14, 20, 10);
        // Olhos irados
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(10, 10, 2, 2);
        ctx.fillRect(20, 10, 2, 2);
        // Clava/Machado na mão
        ctx.fillStyle = '#451a03';
        ctx.fillRect(24, 10, 4, 16);
        ctx.fillStyle = '#64748b'; // Lâmina de metal
        ctx.fillRect(22, 8, 8, 4);

        orcCanvas.refresh();
    }

    // Criando a Rotworm (Level 5)
    const rotwormCanvas = this.textures.createCanvas('rotworm-sprite', 32, 32);
    if (rotwormCanvas && rotwormCanvas.context) {
        const ctx = rotwormCanvas.context;
        ctx.fillStyle = '#f87171'; // Rosa/Carne
        ctx.fillRect(6, 10, 20, 14);
        // Segmentos da minhoca
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(10, 10, 2, 14);
        ctx.fillRect(16, 10, 2, 14);
        ctx.fillRect(22, 10, 2, 14);
        // Boca aberta com dentes (Tibia style)
        ctx.fillStyle = '#000000';
        ctx.fillRect(22, 14, 4, 6);
        ctx.fillStyle = '#ffffff'; // Dentes
        ctx.fillRect(22, 14, 1, 1);
        ctx.fillRect(25, 19, 1, 1);

        rotwormCanvas.refresh();
    }

    // Criando o Demon Skeleton (Level 10)
    const dsCanvas = this.textures.createCanvas('demonskeleton-sprite', 32, 32);
    if (dsCanvas && dsCanvas.context) {
        const ctx = dsCanvas.context;
        // Capuz negro rasgado
        ctx.fillStyle = '#090d16';
        ctx.fillRect(6, 4, 20, 24);
        // Caixa Torácica / Ossos
        ctx.fillStyle = '#e2e8f0'; // Ossos brancos
        ctx.fillRect(10, 14, 12, 12);
        ctx.fillStyle = '#020617'; // Espaços vazios nas costelas
        ctx.fillRect(12, 16, 8, 2);
        ctx.fillRect(12, 20, 8, 2);
        // Crânio
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(11, 6, 10, 8);
        // Olhos Vermelhos Brilhantes do Demônio
        ctx.fillStyle = '#f43f5e';
        ctx.fillRect(13, 9, 2, 2);
        ctx.fillRect(17, 9, 2, 2);

        dsCanvas.refresh();
    }

    // Criando o Merchant NPC
    const merchantCanvas = this.textures.createCanvas('merchant-sprite', 32, 32);
    if (merchantCanvas && merchantCanvas.context) {
        const ctx = merchantCanvas.context;
        // Capa Roxa elegante
        ctx.fillStyle = '#7c3aed';
        ctx.fillRect(6, 8, 20, 22);
        // Rosto
        ctx.fillStyle = '#fed7aa';
        ctx.fillRect(10, 4, 12, 8);
        // Capuz
        ctx.fillStyle = '#5b21b6';
        ctx.fillRect(8, 2, 16, 3);
        // Sacola de ouro / Mercadorias
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(22, 16, 6, 8);
        ctx.fillStyle = '#b45309'; // Corda do saco
        ctx.fillRect(20, 18, 2, 4);

        merchantCanvas.refresh();
    }
  }

  create() {
    // Assim que tudo for carregado, vamos para o Jogo Principal
    this.scene.start('GameScene');
  }
}
