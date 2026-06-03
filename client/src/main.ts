import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  scale: {
      mode: Phaser.Scale.RESIZE,
      parent: 'game-container',
      width: '100%',
      height: '100%'
  },
  pixelArt: true, // Crucial para MMORPGs pixelados como Tibia! Remove o blur dos assets.
  physics: {
    default: 'arcade',
    arcade: {
      debug: false
    }
  },
  scene: [BootScene, GameScene]
};

document.getElementById('btn-login')!.onclick = () => {
    const name = (document.getElementById('login-name') as HTMLInputElement).value;
    if (name.trim() === '') return;
    
    // Esconde o Login e salva o nome
    document.getElementById('login-screen')!.style.display = 'none';
    (window as any).playerName = name;
    
    // Inicia o Jogo
    new Phaser.Game(config);
};
