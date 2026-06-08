import Phaser from 'phaser';
import { SpriteId, getFrameIndex } from '../../../shared/types';

// Compat: chamada antiga (spriteId → frame idle/down)
export function spriteIdToFrame(spriteId: string): number {
  return getFrameIndex((spriteId as SpriteId) || 'm1', 'down', 0);
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    // Spritesheet de personagens (192x96 = 12 cols × 4 rows de 16x24).
    // Linhas: 0=down, 1=up, 2=left, 3=right
    // Cols: m1(0-2), m2(3-5), f1(6-8), f2(9-11) — 3 frames de andar cada
    this.load.spritesheet('characters', 'sprites/characters.png', {
      frameWidth: 16,
      frameHeight: 24
    });

    // Gera texturas dinâmicas (placeholders) para tiles e monstros
    const grassCanvas = this.textures.createCanvas('tile-grass', 32, 32);
    if (grassCanvas && grassCanvas.context) {
      const ctx = grassCanvas.context;
      ctx.fillStyle = '#166534';
      ctx.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#15803d' : '#22c55e';
        ctx.fillRect(Math.random() * 32, Math.random() * 32, 2, 2);
      }
      grassCanvas.refresh();
    }

    const knightCanvas = this.textures.createCanvas('tiberius-sprite', 32, 32);
    if (knightCanvas && knightCanvas.context) {
      const ctx = knightCanvas.context;
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(8, 8, 16, 20);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(10, 4, 12, 8);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(12, 8, 8, 2);
      ctx.fillStyle = '#991b1b';
      ctx.fillRect(6, 10, 4, 16);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(24, 12, 2, 14);
      ctx.fillStyle = '#b45309';
      ctx.fillRect(22, 24, 6, 2);
      knightCanvas.refresh();
    }

    const wallCanvas = this.textures.createCanvas('tile-wall', 32, 32);
    if (wallCanvas && wallCanvas.context) {
      const ctx = wallCanvas.context;
      ctx.fillStyle = '#475569';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 16, 32, 2);
      ctx.fillRect(16, 0, 2, 32);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(0, 0, 16, 2);
      ctx.fillRect(0, 0, 2, 16);
      ctx.fillRect(16, 16, 16, 2);
      wallCanvas.refresh();
    }

    const ratCanvas = this.textures.createCanvas('rat-sprite', 32, 32);
    if (ratCanvas && ratCanvas.context) {
      const ctx = ratCanvas.context;
      ctx.fillStyle = '#78350f';
      ctx.fillRect(4, 12, 24, 12);
      ctx.fillStyle = '#b45309';
      ctx.fillRect(6, 8, 6, 6);
      ctx.fillRect(20, 8, 6, 6);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(8, 14, 2, 2);
      ctx.fillRect(22, 14, 2, 2);
      ratCanvas.refresh();
    }

    const orcCanvas = this.textures.createCanvas('orc-sprite', 32, 32);
    if (orcCanvas && orcCanvas.context) {
      const ctx = orcCanvas.context;
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(8, 6, 16, 22);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(6, 14, 20, 10);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(10, 10, 2, 2);
      ctx.fillRect(20, 10, 2, 2);
      ctx.fillStyle = '#451a03';
      ctx.fillRect(24, 10, 4, 16);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(22, 8, 8, 4);
      orcCanvas.refresh();
    }

    const rotwormCanvas = this.textures.createCanvas('rotworm-sprite', 32, 32);
    if (rotwormCanvas && rotwormCanvas.context) {
      const ctx = rotwormCanvas.context;
      ctx.fillStyle = '#f87171';
      ctx.fillRect(6, 10, 20, 14);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(10, 10, 2, 14);
      ctx.fillRect(16, 10, 2, 14);
      ctx.fillRect(22, 10, 2, 14);
      ctx.fillStyle = '#000000';
      ctx.fillRect(22, 14, 4, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(22, 14, 1, 1);
      ctx.fillRect(25, 19, 1, 1);
      rotwormCanvas.refresh();
    }

    const dsCanvas = this.textures.createCanvas('demonskeleton-sprite', 32, 32);
    if (dsCanvas && dsCanvas.context) {
      const ctx = dsCanvas.context;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(4, 4, 24, 24);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(8, 6, 16, 20);
      ctx.fillStyle = '#020617';
      ctx.fillRect(12, 14, 8, 2);
      ctx.fillRect(12, 18, 8, 2);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(11, 8, 10, 8);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(13, 10, 2, 2);
      ctx.fillRect(17, 10, 2, 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(9, 14, 2, 6);
      ctx.fillRect(21, 14, 2, 6);
      dsCanvas.refresh();
    }

    const merchantCanvas = this.textures.createCanvas('merchant-sprite', 32, 32);
    if (merchantCanvas && merchantCanvas.context) {
      const ctx = merchantCanvas.context;
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(6, 8, 20, 22);
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(10, 4, 12, 8);
      ctx.fillStyle = '#5b21b6';
      ctx.fillRect(8, 2, 16, 3);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(22, 16, 6, 8);
      ctx.fillStyle = '#b45309';
      ctx.fillRect(20, 18, 2, 4);
      merchantCanvas.refresh();
    }

    const bankerCanvas = this.textures.createCanvas('banker-sprite', 32, 32);
    if (bankerCanvas && bankerCanvas.context) {
      const ctx = bankerCanvas.context;
      ctx.fillStyle = '#334155';
      ctx.fillRect(6, 8, 20, 22);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(13, 8, 6, 8);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(15, 11, 2, 8);
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(10, 3, 12, 7);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(8, 1, 16, 3);
      ctx.fillRect(8, 4, 2, 4);
      ctx.fillRect(22, 4, 2, 4);
      bankerCanvas.refresh();
    }

    const skullCanvas = this.textures.createCanvas('skull-sprite', 32, 32);
    if (skullCanvas && skullCanvas.context) {
      const ctx = skullCanvas.context;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(8, 8, 16, 12);
      ctx.fillStyle = '#020617';
      ctx.fillRect(10, 12, 4, 4);
      ctx.fillRect(18, 12, 4, 4);
      ctx.fillStyle = '#020617';
      ctx.fillRect(15, 16, 2, 2);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(12, 20, 8, 4);
      ctx.fillStyle = '#020617';
      ctx.fillRect(14, 20, 1, 4);
      ctx.fillRect(17, 20, 1, 4);
      skullCanvas.refresh();
    }

    const blacksmithCanvas = this.textures.createCanvas('blacksmith-sprite', 32, 32);
    if (blacksmithCanvas && blacksmithCanvas.context) {
      const ctx = blacksmithCanvas.context;
      ctx.fillStyle = '#78350f';
      ctx.fillRect(6, 11, 20, 21);
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(10, 4, 12, 7);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(8, 2, 16, 3);
      ctx.fillRect(10, 9, 12, 4);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(22, 14, 6, 4);
      ctx.fillStyle = '#b45309';
      ctx.fillRect(24, 17, 2, 8);
      blacksmithCanvas.refresh();
    }

    const alchemistCanvas = this.textures.createCanvas('alchemist-sprite', 32, 32);
    if (alchemistCanvas && alchemistCanvas.context) {
      const ctx = alchemistCanvas.context;
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(6, 12, 20, 20);
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(10, 6, 12, 6);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(11, 11, 10, 7);
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(8, 5, 16, 2);
      ctx.fillRect(10, 3, 12, 2);
      ctx.fillRect(13, 0, 6, 3);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(23, 16, 5, 7);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(24, 14, 3, 2);
      alchemistCanvas.refresh();
    }

    const tailorCanvas = this.textures.createCanvas('tailor-sprite', 32, 32);
    if (tailorCanvas && tailorCanvas.context) {
      const ctx = tailorCanvas.context;
      ctx.fillStyle = '#065f46';
      ctx.fillRect(6, 11, 20, 21);
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(10, 4, 12, 7);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(8, 2, 16, 3);
      ctx.fillRect(8, 5, 2, 10);
      ctx.fillRect(22, 5, 2, 10);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(7, 11, 3, 9);
      ctx.fillRect(22, 11, 3, 6);
      tailorCanvas.refresh();
    }

    // Mago Teleportador — manto azul-royal com borda dourada e cajado com orbe brilhante
    const teleporterCanvas = this.textures.createCanvas('teleporter-sprite', 32, 32);
    if (teleporterCanvas && teleporterCanvas.context) {
      const ctx = teleporterCanvas.context;
      // Cajado (atrás do corpo)
      ctx.fillStyle = '#78350f';
      ctx.fillRect(23, 4, 2, 26);
      // Orbe brilhante do cajado
      ctx.fillStyle = '#60a5fa';
      ctx.fillRect(22, 2, 4, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(23, 3, 2, 2);
      // Manto azul-royal
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(5, 10, 22, 22);
      // Detalhe/borda dourada do manto
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(5, 10, 22, 2);
      ctx.fillRect(5, 30, 22, 2);
      ctx.fillRect(5, 10, 2, 22);
      ctx.fillRect(25, 10, 2, 22);
      // Cabeça
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(11, 4, 10, 8);
      // Chapéu pontudo (chapéu de mago)
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(8, 0, 16, 4);
      ctx.fillRect(10, -2, 12, 2); // ponta do chapéu
      ctx.fillRect(12, -4, 8, 2); // topo
      // Borda dourada do chapéu
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(8, 4, 16, 1);
      // Olhos
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(13, 7, 2, 2);
      ctx.fillRect(17, 7, 2, 2);
      // Brilho mágico na base (círculo)
      ctx.fillStyle = 'rgba(96, 165, 250, 0.3)';
      ctx.beginPath();
      ctx.arc(16, 30, 5, 0, Math.PI * 2);
      ctx.fill();
      teleporterCanvas.refresh();
    }

    // Vendedor — manto temático com bolsa de itens
    const vendorCanvas = this.textures.createCanvas('vendor-sprite', 32, 32);
    if (vendorCanvas && vendorCanvas.context) {
      const ctx = vendorCanvas.context;
      // Manto marrom (genérico de mercador)
      ctx.fillStyle = '#78350f';
      ctx.fillRect(6, 9, 20, 23);
      // Avental
      ctx.fillStyle = '#d97706';
      ctx.fillRect(9, 14, 14, 18);
      // Cabeça
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(10, 3, 12, 8);
      // Chapéu/boné de mercador
      ctx.fillStyle = '#92400e';
      ctx.fillRect(8, 1, 16, 3);
      ctx.fillRect(7, 3, 18, 2);
      // Olhos
      ctx.fillStyle = '#000000';
      ctx.fillRect(13, 6, 2, 2);
      ctx.fillRect(17, 6, 2, 2);
      // Sorriso
      ctx.fillStyle = '#000000';
      ctx.fillRect(14, 9, 4, 1);
      // Bolsa/mochila
      ctx.fillStyle = '#451a03';
      ctx.fillRect(2, 16, 5, 8);
      // Etiquetas de preço
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(11, 18, 2, 2);
      ctx.fillRect(14, 20, 2, 2);
      ctx.fillRect(17, 22, 2, 2);
      vendorCanvas.refresh();
    }

    // Portão de safe zone — porta de madeira com moldura dourada
    const gateCanvas = this.textures.createCanvas('gate-door', 32, 32);
    if (gateCanvas && gateCanvas.context) {
      const ctx = gateCanvas.context;
      // Chão de pedra sob a porta
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#52525b';
      ctx.fillRect(0, 0, 16, 2);
      ctx.fillRect(16, 16, 16, 2);
      // Arco/moldura dourada (top + sides)
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(0, 0, 32, 3);          // topo
      ctx.fillRect(0, 0, 2, 32);          // esquerda
      ctx.fillRect(30, 0, 2, 32);         // direita
      // Porta de madeira (pranchas verticais)
      ctx.fillStyle = '#78350f';
      ctx.fillRect(3, 3, 26, 27);
      // Pranchas
      ctx.fillStyle = '#451a03';
      ctx.fillRect(9, 4, 1, 25);
      ctx.fillRect(16, 4, 1, 25);
      ctx.fillRect(22, 4, 1, 25);
      // Bandas horizontais de ferro
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(3, 8, 26, 2);
      ctx.fillRect(3, 22, 26, 2);
      // Maçaneta brilhante (indica "passável")
      ctx.fillStyle = '#60a5fa';
      ctx.fillRect(22, 15, 3, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(23, 16, 1, 1);
      gateCanvas.refresh();
    }

    // Portão ABERTO — moldura dourada + arco vazio (sem porta de madeira)
    const gateOpenCanvas = this.textures.createCanvas('gate-door-open', 32, 32);
    if (gateOpenCanvas && gateOpenCanvas.context) {
      const ctx = gateOpenCanvas.context;
      // Chão de pedra sob o arco
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#52525b';
      ctx.fillRect(0, 0, 16, 2);
      ctx.fillRect(16, 16, 16, 2);
      // Arco/moldura dourada (topo + laterais) — SEM porta
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(0, 0, 32, 3);          // topo do arco
      ctx.fillRect(0, 0, 2, 32);          // pilar esquerdo
      ctx.fillRect(30, 0, 2, 32);         // pilar direito
      // Brilho mágico na passagem (indica "pode passar")
      const grad = ctx.createLinearGradient(3, 4, 29, 28);
      grad.addColorStop(0, 'rgba(96, 165, 250, 0.25)');
      grad.addColorStop(0.5, 'rgba(96, 165, 250, 0.1)');
      grad.addColorStop(1, 'rgba(96, 165, 250, 0.25)');
      ctx.fillStyle = grad;
      ctx.fillRect(3, 4, 26, 25);
      // Partículas de luz flutuantes
      ctx.fillStyle = '#60a5fa';
      ctx.fillRect(8, 8, 2, 2);
      ctx.fillRect(22, 18, 2, 2);
      ctx.fillRect(14, 24, 2, 2);
      gateOpenCanvas.refresh();
    }
  }

  create() {
    this.scene.start('GameScene');
  }
}
