import Phaser from 'phaser';

const DIRS: Array<{ x: number; y: number }> = [
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
];

export class SkeletonMonster extends Phaser.GameObjects.Sprite {
    private patrolDir: { x: number; y: number };
    private patrolTimer: number = 0;
    private patrolDuration: number = 0;
    private readonly patrolSpeed: number = 50;
    private currentAnimKey: string = '';
    private collisionMap: Set<string>;

    constructor(scene: Phaser.Scene, tileX: number, tileY: number, collisionMap: Set<string>, tint?: number) {
        super(scene, tileX * 32 + 16, tileY * 32 + 16, 'skeleton8', 0);
        scene.add.existing(this);
        this.collisionMap = collisionMap;
        this.setOrigin(0.5, 2/3);

        this.setDepth(10);
        if (tint !== undefined) this.setTint(tint);

        this.patrolDir = { x: 0, y: 1 };
        this.pickNewDirection();
    }

    private pickNewDirection(): void {
        const shuffled = [...DIRS].sort(() => Math.random() - 0.5);
        const tileX = Math.round((this.x - 16) / 32);
        const tileY = Math.round((this.y - 16) / 32);
        for (const dir of shuffled) {
            const nx = tileX + dir.x;
            const ny = tileY + dir.y;
            if (!this.collisionMap.has(`${nx},${ny}`) && nx >= 0 && ny >= 0 && nx <= 149 && ny <= 149) {
                this.patrolDir = dir;
                this.patrolDuration = 2000 + Math.random() * 4000;
                this.patrolTimer = 0;
                this.updateAnimation();
                return;
            }
        }
        this.patrolDir = { x: 0, y: 0 };
        this.patrolDuration = 500;
        this.patrolTimer = 0;
        if (this.currentAnimKey) this.stop();
        this.setFrame(0);
    }

    private updateAnimation(): void {
        const animKey = this.patrolDir.y === 1 ? 'skeleton_walk_down'
            : this.patrolDir.x === -1 ? 'skeleton_walk_left'
            : this.patrolDir.x === 1 ? 'skeleton_walk_right'
            : this.patrolDir.y === -1 ? 'skeleton_walk_up'
            : 'skeleton_walk_down';
        if (animKey !== this.currentAnimKey) {
            this.currentAnimKey = animKey;
            this.play(animKey);
        }
    }

    tick(delta: number): void {
        const dt = delta / 1000;
        this.patrolTimer += delta;

        if (this.patrolTimer >= this.patrolDuration) {
            this.pickNewDirection();
        }

        if (this.patrolDir.x === 0 && this.patrolDir.y === 0) return;

        const newX = this.x + this.patrolDir.x * this.patrolSpeed * dt;
        const newY = this.y + this.patrolDir.y * this.patrolSpeed * dt;

        const tileX = Math.round((newX - 16) / 32);
        const tileY = Math.round((newY - 16) / 32);
        if (!this.collisionMap.has(`${tileX},${tileY}`) && tileX >= 0 && tileY >= 0 && tileX <= 149 && tileY <= 149) {
            this.x = newX;
            this.y = newY;
        } else {
            this.pickNewDirection();
        }
    }
}
