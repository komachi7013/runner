import Phaser from 'phaser';
import { COIN_SCORE, getStageDistance, RunState } from '../../game/simulation/RunState';

const VIEW_W = 1280;
const VIEW_H = 720;
const GROUND_Y = 590;
const COIN_Y_SHIFT = 36;
const PIXELS_PER_DISTANCE = 10;
const GOAL_APPROACH_CLEAR_DISTANCE = 50;
const LIGHTNING_WARNING_SECONDS = 0.7;
const LIGHTNING_GROUND_HIT_MARGIN = 12;
const RUN_ANIMATION_FRAME_RATE = 14;

interface GameEvents {
  onUpdate: (score: number, coins: number, best: number, stage: number, progress: number, retriesRemaining: number) => void;
  onStageClear: (stage: number) => void;
  onComplete: (score: number, coins: number) => void;
  onGameOver: (score: number, coins: number, stage: number, retriesRemaining: number) => void;
}

interface HoleVisual {
  container: Phaser.GameObjects.Container;
  width: number;
}

interface StormHazard {
  cloud: Phaser.Physics.Arcade.Image;
  bolt?: Phaser.Physics.Arcade.Image;
  marker?: Phaser.GameObjects.Image;
  warningRemaining?: number;
  released: boolean;
}

export class GameScene extends Phaser.Scene {
  private runState = new RunState();
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerLegs!: Phaser.GameObjects.Sprite;
  private playerBaseScaleX = 1;
  private playerBaseScaleY = 1;
  private runnerFrameWidth = 0;
  private runnerFrameHeight = 0;
  private upperBodyCutoff = 0;
  private obstacles!: Phaser.Physics.Arcade.Group;
  private platforms!: Phaser.Physics.Arcade.Group;
  private coins!: Phaser.Physics.Arcade.Group;
  private stormClouds!: Phaser.Physics.Arcade.Group;
  private lightningBolts!: Phaser.Physics.Arcade.Group;
  private storms: StormHazard[] = [];
  private holes: HoleVisual[] = [];
  private groundTiles: Phaser.GameObjects.TileSprite[] = [];
  private scenery!: Phaser.GameObjects.Image;
  private foreground!: Phaser.GameObjects.TileSprite;
  private groundEdge!: Phaser.GameObjects.Rectangle;
  private groundCollider!: Phaser.GameObjects.Rectangle;
  private clouds: Phaser.GameObjects.Image[] = [];
  private spawnTimer = 0;
  private stageTransitioning = false;
  private goalLine?: Phaser.GameObjects.Container;
  private finishCorridorPrepared = false;
  private floaterCooldownMs = 0;
  private lastSnapshotScore = -1;
  private gameEvents: GameEvents = {
    onUpdate: () => undefined,
    onStageClear: () => undefined,
    onComplete: () => undefined,
    onGameOver: () => undefined,
  };
  private jumpQueued = false;
  private coyoteTime = 0;
  private jumpsUsed = 0;
  private soundEnabled = true;
  private audioContext?: AudioContext;
  private bgmTimer?: number;
  private bgmStep = 0;
  private bgmNextNoteTime = 0;

  constructor() {
    super('game');
  }

  setGameEvents(gameEvents: GameEvents): void {
    this.gameEvents = gameEvents;
  }

  isRunning(): boolean {
    return this.runState.snapshot().phase === 'running';
  }

  setPaused(paused: boolean): void {
    if (paused) this.stopBgm();
    else if (this.isRunning()) this.startBgm();
  }

  preload(): void {
    this.load.image('runner-source', '/assets/characters/runner-girl-run-jump-sheet.png');
    this.load.image('stage-1-scenery', '/assets/map/stage-1-meadow.png');
    this.load.image('stage-2-scenery', '/assets/map/stage-2-highland.png');
    this.load.image('stage-3-scenery', '/assets/map/stage-3-moonlight.png');
    this.load.image('stage-1-foreground', '/assets/map/stage-1-foreground.png');
    this.load.image('stage-2-foreground', '/assets/map/stage-2-foreground.png');
    this.load.image('stage-3-foreground', '/assets/map/stage-3-foreground.png');
  }

  create(): void {
    this.createTextures();
    this.createWorld();
    this.createPlayer();

    this.obstacles = this.physics.add.group({ allowGravity: false, immovable: true });
    this.platforms = this.physics.add.group({ allowGravity: false, immovable: true });
    this.coins = this.physics.add.group({ allowGravity: false, immovable: true });
    this.stormClouds = this.physics.add.group({ allowGravity: false, immovable: true });
    this.lightningBolts = this.physics.add.group({ allowGravity: false, immovable: true });

    this.physics.add.overlap(this.player, this.coins, (_, coin) => this.collectCoin(coin as Phaser.Physics.Arcade.Image));
    this.physics.add.overlap(this.player, this.obstacles, () => this.hitObstacle());
    this.physics.add.overlap(this.player, this.lightningBolts, (_player, bolt) => {
      if (this.isLightningGrounded(bolt as Phaser.Physics.Arcade.Image)) this.hitObstacle();
    });
    this.physics.add.collider(
      this.player,
      this.platforms,
      (_player, platform) => this.handlePlatformCollision(platform as Phaser.Physics.Arcade.Image),
    );

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.y > 80) this.queueJump();
    });
    this.input.keyboard?.on('keydown-SPACE', () => this.queueJump());
    this.input.keyboard?.on('keydown-UP', () => this.queueJump());
    this.input.keyboard?.on('keydown-W', () => this.queueJump());

    this.events.on('start-run', () => this.startRun());
    this.events.on('jump', () => this.queueJump());
    this.events.on('toggle-sound', (enabled: boolean) => {
      this.soundEnabled = enabled;
      if (enabled && this.runState.snapshot().phase === 'running') this.startBgm();
      else this.stopBgm();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.stopBgm());
  }

  private createTextures(): void {
    const g = this.add.graphics();

    this.createRunnerTexture();

    g.fillStyle(0xffd75e).fillCircle(15, 15, 14);
    g.lineStyle(3, 0xfff2aa).strokeCircle(15, 15, 10);
    g.fillStyle(0xe6a72e).fillRect(13, 7, 4, 16);
    g.generateTexture('coin', 30, 30).clear();

    g.fillStyle(0xffffff).fillTriangle(0, 62, 25, 0, 50, 62);
    g.fillStyle(0xe6e6e6).fillTriangle(8, 62, 25, 14, 34, 62);
    g.lineStyle(3, 0xffffff, 0.95).strokeTriangle(0, 62, 25, 0, 50, 62);
    g.generateTexture('spike', 50, 62).clear();

    g.fillStyle(0xffffff).fillRoundedRect(0, 0, 70, 82, 8);
    g.fillStyle(0xe8e8e8).fillRoundedRect(8, 9, 54, 10, 5);
    g.fillStyle(0xd0d0d0).fillRoundedRect(10, 64, 50, 18, 5);
    g.lineStyle(3, 0xffffff, 0.9).strokeRoundedRect(1, 1, 68, 80, 8);
    g.generateTexture('block', 70, 82).clear();

    g.fillStyle(0xffffff).fillRoundedRect(0, 0, 106, 48, 18);
    g.fillStyle(0xe4e4e4).fillRoundedRect(10, 8, 86, 10, 5);
    g.fillStyle(0xf5f5f5).fillCircle(20, 34, 5).fillCircle(86, 34, 5);
    g.lineStyle(3, 0xffffff, 0.9).strokeRoundedRect(3, 3, 100, 42, 16);
    g.generateTexture('floater', 106, 48).clear();

    const grounds = [
      { name: 'ground-1', soil: 0xcaa579, grass: 0x82c977, trim: 0xa8df84 },
      { name: 'ground-2', soil: 0xb59377, grass: 0x6bb789, trim: 0x9cdb91 },
      { name: 'ground-3', soil: 0x64618f, grass: 0x78a6a9, trim: 0xa8cbd1 },
    ];
    grounds.forEach(({ name, soil, grass, trim }) => {
      g.fillStyle(soil).fillRect(0, 0, 128, 130);
      g.fillStyle(grass).fillRect(0, 0, 128, 21);
      g.fillStyle(trim).fillRect(0, 0, 128, 7);
      g.fillStyle(0xffffff, 0.13).fillCircle(24, 53, 5).fillCircle(94, 95, 7);
      g.generateTexture(name, 128, 130).clear();
    });

    g.fillStyle(0xffffff, 0.14).fillCircle(48, 24, 22).fillCircle(76, 20, 30).fillCircle(104, 28, 19).fillRoundedRect(40, 25, 82, 25, 14);
    g.generateTexture('cloud', 140, 60).clear();

    g.fillStyle(0x34395f).fillCircle(35, 34, 27);
    g.fillStyle(0x42496f).fillCircle(70, 25, 35).fillCircle(105, 36, 25);
    g.fillStyle(0x292e52).fillRoundedRect(16, 34, 112, 34, 17);
    g.lineStyle(4, 0x707aa8, 0.8).strokeRoundedRect(17, 35, 110, 32, 16);
    g.generateTexture('storm-cloud', 145, 76).clear();

    g.fillStyle(0xfff36a).fillPoints([
      new Phaser.Geom.Point(31, 0),
      new Phaser.Geom.Point(5, 43),
      new Phaser.Geom.Point(25, 43),
      new Phaser.Geom.Point(12, 82),
      new Phaser.Geom.Point(57, 31),
      new Phaser.Geom.Point(35, 31),
      new Phaser.Geom.Point(48, 0),
    ], true);
    g.lineStyle(3, 0xffffff, 0.9).strokePoints([
      new Phaser.Geom.Point(31, 0), new Phaser.Geom.Point(5, 43),
      new Phaser.Geom.Point(25, 43), new Phaser.Geom.Point(12, 82),
      new Phaser.Geom.Point(57, 31), new Phaser.Geom.Point(35, 31),
      new Phaser.Geom.Point(48, 0),
    ], true);
    g.generateTexture('lightning', 62, 86).clear();

    g.fillStyle(0xfff36a, 0.2).fillEllipse(44, 12, 84, 22);
    g.lineStyle(3, 0xfff36a, 0.95).strokeEllipse(44, 12, 76, 16);
    g.lineStyle(2, 0xffffff, 0.85).strokeEllipse(44, 12, 48, 10);
    g.generateTexture('lightning-marker', 88, 24).clear();

    g.fillStyle(0xffffff).fillCircle(3, 3, 3);
    g.generateTexture('spark', 6, 6).destroy();
  }

  private createWorld(): void {
    this.scenery = this.add.image(VIEW_W / 2, VIEW_H / 2, 'stage-1-scenery').setDisplaySize(VIEW_W, VIEW_H).setDepth(-20);
    const stripHeight = 190 * VIEW_H / this.textures.get('stage-1-scenery').getSourceImage().height;
    this.foreground = this.add.tileSprite(VIEW_W / 2, GROUND_Y - stripHeight / 2, VIEW_W, stripHeight, 'stage-1-foreground').setDepth(-10);
    this.foreground.setTileScale(VIEW_H / this.textures.get('stage-1-scenery').getSourceImage().height);
    const ground = this.add.tileSprite(VIEW_W / 2, GROUND_Y + 65, VIEW_W, 130, 'ground-1');
    ground.setDepth(5);
    this.groundTiles.push(ground);

    this.groundEdge = this.add.rectangle(VIEW_W / 2, GROUND_Y - 2, VIEW_W, 5, 0xa8df84, 0.9).setDepth(6);
    this.groundCollider = this.add.rectangle(VIEW_W / 2, GROUND_Y + 12, VIEW_W, 24, 0x000000, 0);
    this.physics.add.existing(this.groundCollider, true);
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(225, GROUND_Y - 47, 'runner', '0').setDepth(11).setDisplaySize(94, 94);
    this.playerBaseScaleX = this.player.scaleX;
    this.playerBaseScaleY = this.player.scaleY;
    this.runnerFrameWidth = this.player.frame.realWidth;
    this.runnerFrameHeight = this.player.frame.realHeight;
    this.upperBodyCutoff = Math.round(this.runnerFrameHeight * 0.58);
    this.playerLegs = this.add.sprite(225, GROUND_Y - 47, 'runner', '0').setDepth(10).setDisplaySize(94, 94).setVisible(false);
    this.player.setCollideWorldBounds(false).setGravityY(1650).setBodySize(135, 310).setOffset(140, 55).setBounce(0);
    this.player.setVisible(false);

    if (!this.anims.exists('runner-run')) {
      this.anims.create({
        key: 'runner-run',
        frames: Array.from({ length: 6 }, (_, frame) => ({ key: 'runner', frame: String(frame) })),
        frameRate: RUN_ANIMATION_FRAME_RATE,
        repeat: -1,
      });
    }

    this.physics.add.collider(
      this.player,
      this.groundCollider,
      undefined,
      () => this.canCollideWithGround(),
    );
  }

  private applyStageTheme(): void {
    const stage = this.runState.snapshot().stage;
    const sceneryKey = `stage-${stage}-scenery`;
    this.scenery.setTexture(sceneryKey);
    this.foreground.setTexture(`stage-${stage}-foreground`);
    this.foreground.tilePositionX = 0;
    this.groundTiles.forEach((tile) => tile.setTexture(`ground-${stage}`));
    this.groundEdge.setFillStyle([0xa8df84, 0xa1de9b, 0xc4e1e3][stage - 1], 0.9);
    this.cameras.main.setBackgroundColor(['#a5e3f2', '#78c4ec', '#5b69b6'][stage - 1]);
  }

  private createRunnerTexture(): void {
    if (this.textures.exists('runner')) return;
    const source = this.textures.get('runner-source').getSourceImage() as HTMLImageElement;
    const texture = this.textures.createCanvas('runner', source.width, source.height);
    if (!texture) return;

    const context = texture.context;
    context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, source.width, source.height);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i];
      const green = pixels[i + 1];
      const blue = pixels[i + 2];
      const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) < 12;
      if (neutral && red > 224 && green > 224 && blue > 224) pixels[i + 3] = 0;
    }
    context.putImageData(image, 0, 0);
    const frameWidth = Math.floor(source.width / 3);
    const frameHeight = Math.floor(source.height / 3);
    for (let frame = 0; frame < 8; frame++) {
      texture.add(String(frame), 0, (frame % 3) * frameWidth, Math.floor(frame / 3) * frameHeight, frameWidth, frameHeight);
    }
    texture.refresh();
  }

  startRun(): void {
    this.runState.start();
    this.resetCourseForRun();
  }

  retryStage(): void {
    if (!this.runState.retryStage()) return;
    this.resetCourseForRun();
  }

  private resetCourseForRun(): void {
    this.obstacles.clear(true, true);
    this.platforms.clear(true, true);
    this.coins.clear(true, true);
    this.stormClouds.clear(true, true);
    this.lightningBolts.clear(true, true);
    this.storms.forEach(({ marker }) => marker?.destroy());
    this.storms = [];
    this.holes.forEach(({ container }) => container.destroy());
    this.holes = [];
    this.goalLine?.destroy();
    this.goalLine = undefined;
    this.tweens.killTweensOf(this.player);
    this.player
      .setPosition(225, GROUND_Y - 47)
      .setVelocity(0, 0)
      .setAngularVelocity(0)
      .setScale(this.playerBaseScaleX, this.playerBaseScaleY)
      .setAlpha(1)
      .setAngle(0)
      .setVisible(true);
    this.showRunningLayers();
    this.spawnTimer = 900;
    this.floaterCooldownMs = 0;
    this.jumpsUsed = 0;
    this.coyoteTime = 0;
    this.jumpQueued = false;
    this.lastSnapshotScore = -1;
    this.stageTransitioning = false;
    this.finishCorridorPrepared = false;
    this.applyStageTheme();
    this.playTone(440, 0.08, 'sine');
    this.startBgm();
    const snapshot = this.runState.snapshot();
    this.gameEvents.onUpdate(snapshot.score, snapshot.coins, snapshot.best, snapshot.stage, 0, snapshot.retriesRemaining);
  }

  private queueJump(): void {
    if (this.runState.snapshot().phase !== 'running') return;
    this.jumpQueued = true;
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000;
    const snapshot = this.runState.snapshot();

    this.clouds.forEach((cloud, index) => {
      cloud.x -= dt * (7 + index * 3);
      if (cloud.x < -160) cloud.x = VIEW_W + 160;
    });

    if (snapshot.phase !== 'running') return;

    this.runState.update(dt);
    const current = this.runState.snapshot();
    this.updateGoalLine(current.stage, current.stageDistance);
    if (current.phase === 'stageclear' || current.phase === 'complete') {
      this.handleStageFinish(current.phase === 'complete');
      return;
    }
    this.groundTiles.forEach((tile) => { tile.tilePositionX += current.speed * dt; });
    this.foreground.tilePositionX += current.speed * dt * 0.16;

    const grounded = this.player.body?.blocked.down ?? false;
    if (grounded) this.jumpsUsed = 0;
    this.coyoteTime = grounded ? 0.1 : Math.max(0, this.coyoteTime - dt);
    if (this.jumpQueued && (this.coyoteTime > 0 || this.jumpsUsed < 2)) {
      const isDoubleJump = !grounded && this.coyoteTime <= 0 && this.jumpsUsed > 0;
      this.player.setVelocityY(isDoubleJump ? -610 : -660);
      this.jumpsUsed += 1;
      this.coyoteTime = 0;
      this.playTone(isDoubleJump ? 690 : 520, 0.06, 'square');
      if (isDoubleJump) {
        this.player.setScale(this.playerBaseScaleX * 1.12, this.playerBaseScaleY * 1.12);
        this.tweens.add({
          targets: this.player,
          scaleX: this.playerBaseScaleX,
          scaleY: this.playerBaseScaleY,
          duration: 150,
          ease: 'Back.out',
        });
      }
    }
    if (this.jumpQueued) {
      this.jumpQueued = false;
    }

    this.updatePlayerAnimation(grounded);
    this.syncPlayerLegs();
    this.moveGroup(this.obstacles, current.speed, dt, -120);
    this.moveGroup(this.platforms, current.speed, dt, -140);
    this.moveGroup(this.coins, current.speed, dt, -80);
    this.updateStorms(current.speed, dt);
    this.moveHoles(current.speed, dt);
    this.enforceSingleFloatingPlatform();

    if (this.player.y > VIEW_H + 65) {
      this.fallIntoHole();
      return;
    }

    this.spawnTimer -= deltaMs;
    this.floaterCooldownMs = Math.max(0, this.floaterCooldownMs - deltaMs);
    if (this.spawnTimer <= 0) {
      this.spawnPattern(current.speed);
      this.spawnTimer = Phaser.Math.Between(1120, 1700) * (360 / current.speed);
    }

    if (current.score !== this.lastSnapshotScore) {
      this.lastSnapshotScore = current.score;
      this.gameEvents.onUpdate(current.score, current.coins, current.best, current.stage, current.stageProgress, current.retriesRemaining);
    }
  }

  private handleStageFinish(completedRun: boolean): void {
    if (this.stageTransitioning) return;
    this.stageTransitioning = true;
    const snapshot = this.runState.snapshot();
    this.clearCourse();
    this.player.setVelocity(0, 0);
    this.stopBgm();
    this.playTone(completedRun ? 880 : 660, 0.18, 'sine');

    if (completedRun) {
      this.gameEvents.onUpdate(snapshot.score, snapshot.coins, snapshot.best, snapshot.stage, 1, snapshot.retriesRemaining);
      this.time.delayedCall(500, () => {
        this.playerLegs.stop().setVisible(false);
        this.player.setVisible(false);
        this.gameEvents.onComplete(snapshot.score, snapshot.coins);
      });
      return;
    }

    this.gameEvents.onStageClear(snapshot.stage);
    this.time.delayedCall(1400, () => {
      this.goalLine?.destroy();
      this.goalLine = undefined;
      this.runState.advanceStage();
      this.applyStageTheme();
      this.stageTransitioning = false;
      this.finishCorridorPrepared = false;
      this.spawnTimer = 900;
      this.lastSnapshotScore = -1;
      this.startBgm();
    });
  }

  private clearCourse(): void {
    this.obstacles.clear(true, true);
    this.platforms.clear(true, true);
    this.coins.clear(true, true);
    this.stormClouds.clear(true, true);
    this.lightningBolts.clear(true, true);
    this.storms.forEach(({ marker }) => marker?.destroy());
    this.storms = [];
    this.holes.forEach(({ container }) => container.destroy());
    this.holes = [];
  }

  private updateGoalLine(stage: number, stageDistance: number): void {
    const remaining = getStageDistance(stage) - stageDistance;
    const goalX = this.player.x + remaining * PIXELS_PER_DISTANCE;

    // Stop adding new patterns close enough to the finish that they could
    // spawn beyond the goal. Clear existing hazards from the final approach,
    // too, so the goal always takes priority over generated course patterns.
    if (remaining <= 115 && !this.finishCorridorPrepared) {
      this.finishCorridorPrepared = true;
      this.spawnTimer = Number.POSITIVE_INFINITY;
    }
    if (this.finishCorridorPrepared) this.clearGoalApproach(goalX);

    if (remaining > 110) return;
    if (!this.goalLine) this.goalLine = this.createGoalLine(stage);
    this.goalLine.x = goalX;
  }

  private clearGoalApproach(goalX: number): void {
    const corridorStart = goalX - GOAL_APPROACH_CLEAR_DISTANCE * PIXELS_PER_DISTANCE;

    [this.obstacles, this.platforms, this.coins, this.stormClouds, this.lightningBolts].forEach((group) => {
      group.getChildren().forEach((child) => {
        const courseObject = child as Phaser.Physics.Arcade.Image;
        if (courseObject.getBounds().right >= corridorStart) courseObject.destroy();
      });
    });
    this.storms.forEach((storm) => {
      if (storm.marker?.active && storm.marker.getBounds().right >= corridorStart) storm.marker.destroy();
    });
    this.storms = this.storms.filter(({ cloud, bolt, marker }) =>
      cloud.active || Boolean(bolt?.active) || Boolean(marker?.active),
    );

    for (let index = this.holes.length - 1; index >= 0; index--) {
      const hole = this.holes[index];
      if (hole.container.x + hole.width / 2 < corridorStart) continue;
      hole.container.destroy();
      this.holes.splice(index, 1);
    }
  }

  private createGoalLine(stage: number): Phaser.GameObjects.Container {
    const leftPost = this.add.rectangle(-70, -78, 12, 156, 0xf5f1ff).setStrokeStyle(3, 0x5869b5);
    const rightPost = this.add.rectangle(70, -78, 12, 156, 0xf5f1ff).setStrokeStyle(3, 0x5869b5);
    const banner = this.add.rectangle(0, -142, 152, 42, 0xffd75e).setStrokeStyle(4, 0xffffff);
    const label = this.add.text(0, -142, `GOAL ${stage}`, {
      color: '#2c2545',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '20px',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const line = this.add.graphics();
    for (let index = 0; index < 8; index++) {
      line.fillStyle(index % 2 === 0 ? 0xffffff : 0x313d7a);
      line.fillRect(-72 + index * 18, -8, 18, 16);
    }
    return this.add.container(VIEW_W + 100, GROUND_Y, [leftPost, rightPost, banner, label, line]).setDepth(12);
  }

  private moveGroup(group: Phaser.Physics.Arcade.Group, speed: number, dt: number, cutoff: number): void {
    group.getChildren().forEach((child) => {
      const body = child as Phaser.Physics.Arcade.Image;
      body.x -= speed * dt;
      if (body.x < cutoff) body.destroy();
    });
  }

  private updatePlayerAnimation(grounded: boolean): void {
    const velocityY = this.player.body!.velocity.y;
    if (grounded && Math.abs(velocityY) < 40) {
      this.player.setAngle(0);
      if (!this.playerLegs.visible) this.showRunningLayers();
      if (this.playerLegs.anims.currentAnim?.key !== 'runner-run' || !this.playerLegs.anims.isPlaying) {
        this.playerLegs.play('runner-run');
      }
      return;
    }

    this.playerLegs.stop().setVisible(false);
    this.player.setCrop().setFrame(velocityY < 0 ? '6' : '7');
    this.player.setAngle(Phaser.Math.Clamp(velocityY * 0.006, -4, 6));
  }

  private showRunningLayers(): void {
    this.player.stop().setFrame('0').setCrop(0, 0, this.runnerFrameWidth, this.upperBodyCutoff);
    this.playerLegs
      .setFrame('0')
      .setCrop(0, this.upperBodyCutoff, this.runnerFrameWidth, this.runnerFrameHeight - this.upperBodyCutoff)
      .setVisible(true)
      .play('runner-run');
    this.syncPlayerLegs();
  }

  private syncPlayerLegs(): void {
    if (!this.playerLegs.visible) return;
    this.playerLegs
      .setPosition(this.player.x, this.player.y)
      .setScale(this.player.scaleX, this.player.scaleY)
      .setAngle(this.player.angle)
      .setAlpha(this.player.alpha);
  }

  private canCollideWithGround(): boolean {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (body.bottom > GROUND_Y + 20) return false;
    return !this.holes.some(({ container, width }) =>
      this.player.x > container.x - width / 2 + 12
      && this.player.x < container.x + width / 2 - 12,
    );
  }

  private moveHoles(speed: number, dt: number): void {
    for (let index = this.holes.length - 1; index >= 0; index--) {
      const hole = this.holes[index];
      hole.container.x -= speed * dt;
      if (hole.container.x + hole.width / 2 < -20) {
        hole.container.destroy();
        this.holes.splice(index, 1);
      }
    }
  }

  private enforceSingleFloatingPlatform(): void {
    const floaters = this.platforms.getChildren()
      .map((child) => child as Phaser.Physics.Arcade.Image)
      .filter((platform) => platform.active && platform.texture.key === 'floater')
      .sort((a, b) => a.x - b.x);

    // Runtime invariant: even stale/HMR state can never leave two floaters alive.
    floaters.slice(1).forEach((extra) => extra.destroy());
  }

  private spawnHolePattern(x: number): void {
    const stage = this.runState.snapshot().stage;
    const [minWidth, maxWidth] = ([[125, 165], [155, 205], [180, 235]] as const)[stage - 1];
    const width = Phaser.Math.Between(minWidth, maxWidth);
    const abyss = this.add.rectangle(0, 65, width, 134, [0x7bbaa2, 0x6e9fa9, 0x242a59][stage - 1]);
    const inner = this.add.rectangle(0, 10, width - 18, 22, [0x9bd4a5, 0x88c3ad, 0x464b86][stage - 1]);
    const rimColor = [0xa8df84, 0x9cdb91, 0xa8cbd1][stage - 1];
    const leftRim = this.add.rectangle(-width / 2 + 4, 15, 8, 30, rimColor, 0.95);
    const rightRim = this.add.rectangle(width / 2 - 4, 15, 8, 30, rimColor, 0.95);
    const container = this.add.container(x, GROUND_Y, [abyss, inner, leftRim, rightRim]).setDepth(7);
    this.holes.push({ container, width });

    const count = Phaser.Math.Between(3, 5);
    for (let i = 0; i < count; i++) {
      const progress = count === 1 ? 0.5 : i / (count - 1);
      const coinX = x - width * 0.36 + progress * width * 0.72;
      const coinY = GROUND_Y - 105 - Math.sin(progress * Math.PI) * 85;
      const coin = this.coins.create(coinX, coinY, 'coin') as Phaser.Physics.Arcade.Image;
      coin.setDepth(9).setCircle(13);
      this.tweens.add({ targets: coin, scaleX: 0.18, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
  }

  private fallIntoHole(): void {
    if (this.runState.snapshot().phase !== 'running') return;
    this.runState.end();
    const snapshot = this.runState.snapshot();
    this.tweens.killTweensOf(this.player);
    this.playerLegs.stop().setVisible(false);
    this.player.stop().setCrop().setFrame('7').setAngularVelocity(0);
    this.cameras.main.shake(180, 0.006);
    this.playTone(85, 0.3, 'sawtooth');
    this.stopBgm();
    this.time.delayedCall(280, () => {
      this.player.setVisible(false);
      this.gameEvents.onGameOver(snapshot.score, snapshot.coins, snapshot.stage, snapshot.retriesRemaining);
    });
  }

  private spawnPattern(speed: number): void {
    const x = VIEW_W + 90;
    const stage = this.runState.snapshot().stage;
    if (stage === 3 && Phaser.Math.Between(0, 100) < 13) {
      this.spawnStormPattern(x);
      return;
    }
    // A spawn tick owns one exclusive ground pattern. Returning here is the
    // invariant that prevents a spike from sharing a hole's horizontal span.
    if (Phaser.Math.Between(0, 100) < [12, 18, 24][stage - 1]) {
      this.spawnHolePattern(x);
      return;
    }
    const hasActiveFloater = this.platforms.getChildren().some((child) => {
      const platform = child as Phaser.Physics.Arcade.Image;
      return platform.active && platform.texture.key === 'floater';
    });
    const useFloater = !hasActiveFloater && this.floaterCooldownMs <= 0 && Phaser.Math.Between(0, 100) < [22, 35, 43][stage - 1];
    let floaterY: number | undefined;
    if (useFloater) {
      floaterY = GROUND_Y - Phaser.Math.RND.pick(stage === 1 ? [115, 130] : stage === 2 ? [125, 150, 175] : [145, 175, 205]);
      const floater = this.platforms.create(x, floaterY, 'floater') as Phaser.Physics.Arcade.Image;
      floater
        .setDepth(8)
        .setBodySize(94, 38);
      floater.setTint([0x9fdf95, 0x83d0a0, 0xb7c4f5][stage - 1]);
      this.floaterCooldownMs = [4800, 4000, 3400][stage - 1];
    } else {
      const useBlock = Phaser.Math.Between(0, 100) < 35;
      const group = useBlock ? this.platforms : this.obstacles;
      const obstacle = group.create(x, GROUND_Y - (useBlock ? 41 : 31), useBlock ? 'block' : 'spike') as Phaser.Physics.Arcade.Image;
      obstacle.setDepth(8).setBodySize(useBlock ? 58 : 34, useBlock ? 74 : 48);
      obstacle.setTint(useBlock ? [0xb8d990, 0x8ac7a1, 0xaaa8d9][stage - 1] : [0xffc1d0, 0xffa9bd, 0xffb5dd][stage - 1]);
    }

    const count = Phaser.Math.Between(3, 6);
    const arcHeight = Phaser.Math.Between(115, 195);
    for (let i = 0; i < count; i++) {
      const coinX = x + 15 + i * 55;
      const curve = Math.sin((i / Math.max(1, count - 1)) * Math.PI);
      const coinY = floaterY !== undefined
        ? floaterY - 58 - curve * 32
        : GROUND_Y - 75 - COIN_Y_SHIFT - curve * arcHeight;
      const coin = this.coins.create(coinX, coinY, 'coin') as Phaser.Physics.Arcade.Image;
      coin.setDepth(9).setCircle(13).setData('phase', Phaser.Math.FloatBetween(0, Math.PI * 2));
      this.tweens.add({ targets: coin, scaleX: 0.18, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    // Do not place a second spike ahead of this pattern. It would occupy the
    // next pattern's spawn area and could later be covered by a newly made hole.
  }

  private spawnStormPattern(x: number): void {
    const cloud = this.stormClouds.create(x, Phaser.Math.Between(145, 205), 'storm-cloud') as Phaser.Physics.Arcade.Image;
    cloud.setDepth(14).setScale(1.05).setAlpha(0.96);
    this.tweens.add({
      targets: cloud,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 360,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    this.storms.push({ cloud, released: false });
  }

  private updateStorms(speed: number, dt: number): void {
    for (let index = this.storms.length - 1; index >= 0; index--) {
      const storm = this.storms[index];
      if (storm.cloud.active) {
        storm.cloud.x -= speed * dt;
        const fallSeconds = (GROUND_Y - (storm.cloud.y + 52)) / 920;
        if (storm.warningRemaining === undefined
          && storm.cloud.x <= this.player.x + speed * LIGHTNING_WARNING_SECONDS) {
          storm.warningRemaining = LIGHTNING_WARNING_SECONDS;
          const marker = this.add.image(storm.cloud.x, GROUND_Y - 5, 'lightning-marker');
          marker.setDepth(13).setAlpha(0.45);
          storm.marker = marker;
          this.tweens.add({
            targets: marker,
            alpha: 1,
            scaleX: 1.18,
            scaleY: 1.18,
            duration: 120,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
          });
          this.playTone(330, 0.08, 'sine');
        }

        if (storm.warningRemaining !== undefined) {
          storm.warningRemaining = Math.max(0, storm.warningRemaining - dt);
        }

        if (!storm.released && storm.warningRemaining !== undefined && storm.warningRemaining <= fallSeconds) {
          storm.released = true;
          const bolt = this.lightningBolts.create(storm.cloud.x, storm.cloud.y + 52, 'lightning') as Phaser.Physics.Arcade.Image;
          bolt.setDepth(15).setBodySize(34, 74).setVelocityY(920);
          storm.bolt = bolt;
          this.cameras.main.flash(80, 255, 246, 150, false);
          this.playTone(105, 0.12, 'sawtooth');
        }
        if (storm.cloud.x < -170) storm.cloud.destroy();
      }

      if (storm.bolt?.active) {
        storm.bolt.x -= speed * dt;
        if (storm.bolt.y > VIEW_H + 90 || storm.bolt.x < -90) storm.bolt.destroy();
      }

      if (storm.marker?.active) {
        if (storm.cloud.active) storm.marker.x = storm.cloud.x;
        else storm.marker.x -= speed * dt;
        if ((storm.warningRemaining ?? 0) <= 0 || storm.marker.x < -90) storm.marker.destroy();
      }

      if (!storm.cloud.active && !storm.bolt?.active && !storm.marker?.active) this.storms.splice(index, 1);
    }
  }

  private collectCoin(coin: Phaser.Physics.Arcade.Image): void {
    if (!coin.active) return;
    const x = coin.x;
    const y = coin.y;
    coin.destroy();
    this.runState.collectCoin();
    this.showScorePopup(x, y, `+${COIN_SCORE}`);
    this.playTone(880, 0.045, 'sine');

    const particles = this.add.particles(x, y, 'spark', {
      speed: { min: 70, max: 180 },
      lifespan: 420,
      quantity: 9,
      scale: { start: 1, end: 0 },
      tint: [0xffd75e, 0xffffff],
      emitting: false,
    }).setDepth(20);
    particles.explode(9);
    this.time.delayedCall(500, () => particles.destroy());
  }

  private isLightningGrounded(bolt: Phaser.Physics.Arcade.Image): boolean {
    const body = bolt.body as Phaser.Physics.Arcade.Body;
    return body.bottom >= GROUND_Y - LIGHTNING_GROUND_HIT_MARGIN;
  }

  private showScorePopup(x: number, y: number, label: string): void {
    const popup = this.add.text(x, y - 12, label, {
      color: '#fff2aa',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '24px',
      fontStyle: 'bold',
      stroke: '#5b376e',
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(25);
    this.tweens.add({
      targets: popup,
      y: y - 70,
      alpha: 0,
      duration: 650,
      ease: 'Cubic.out',
      onComplete: () => popup.destroy(),
    });
  }

  private hitObstacle(): void {
    if (this.runState.snapshot().phase !== 'running') return;
    this.runState.end();
    const snapshot = this.runState.snapshot();
    this.tweens.killTweensOf(this.player);
    this.playerLegs.stop().setVisible(false);
    this.player.stop().setCrop().setFrame('7').setScale(this.playerBaseScaleX, this.playerBaseScaleY);
    this.player.setVelocity(0, -380).setAngularVelocity(240);
    this.cameras.main.shake(260, 0.012);
    this.playTone(130, 0.2, 'sawtooth');
    this.stopBgm();
    this.time.delayedCall(600, () => {
      this.player.setAngularVelocity(0).setVisible(false);
      this.gameEvents.onGameOver(snapshot.score, snapshot.coins, snapshot.stage, snapshot.retriesRemaining);
    });
  }

  private handlePlatformCollision(platform: Phaser.Physics.Arcade.Image): void {
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    const platformBody = platform.body as Phaser.Physics.Arcade.Body;
    const landedOnTop = playerBody.touching.down && platformBody.touching.up;
    if (!landedOnTop) this.hitObstacle();
  }

  private startBgm(): void {
    if (!this.soundEnabled) return;
    try {
      this.audioContext ??= new AudioContext();
      void this.audioContext.resume();
      this.stopBgm();
      this.bgmStep = 0;
      this.bgmNextNoteTime = this.audioContext.currentTime + 0.08;
      this.scheduleBgm();
      this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 100);
    } catch { /* Web Audio may be unavailable. */ }
  }

  private stopBgm(): void {
    if (this.bgmTimer !== undefined) window.clearInterval(this.bgmTimer);
    this.bgmTimer = undefined;
  }

  private scheduleBgm(): void {
    if (!this.audioContext || !this.soundEnabled) return;
    const beat = 60 / 152 / 2; // up-tempo 2/4 march, scheduled in eighth notes
    const melody = [
      67, 67, 69, 71, 72, 71, 69, 67,
      64, 64, 65, 67, 69, 67, 65, 64,
      67, 69, 71, 72, 74, 72, 71, 69,
      67, 64, 67, 71, 69, 66, 67, null,
    ] as const;
    const bass = [48, 55, 48, 55, 50, 57, 50, 57] as const;
    while (this.bgmNextNoteTime < this.audioContext.currentTime + 0.35) {
      const step = this.bgmStep % melody.length;
      const note = melody[step];
      if (note !== null) this.scheduleNote(note, this.bgmNextNoteTime, beat * 0.72, 'triangle', 0.025);
      if (step % 4 === 0) {
        const bassNote = bass[Math.floor(step / 4) % bass.length];
        this.scheduleNote(bassNote, this.bgmNextNoteTime, beat * 1.7, 'square', 0.014);
      }
      // Soft snare-like pulse keeps the military-march character without samples.
      if (step % 2 === 1) this.scheduleNoise(this.bgmNextNoteTime, 0.025);
      this.bgmStep += 1;
      this.bgmNextNoteTime += beat;
    }
  }

  private scheduleNote(midi: number, at: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this.audioContext) return;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    oscillator.connect(gain).connect(this.audioContext.destination);
    oscillator.start(at);
    oscillator.stop(at + duration);
  }

  private scheduleNoise(at: number, volume: number): void {
    if (!this.audioContext) return;
    const length = Math.floor(this.audioContext.sampleRate * 0.045);
    const buffer = this.audioContext.createBuffer(1, length, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = this.audioContext.createBufferSource();
    const filter = this.audioContext.createBiquadFilter();
    const gain = this.audioContext.createGain();
    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = 1600;
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.045);
    source.connect(filter).connect(gain).connect(this.audioContext.destination);
    source.start(at);
  }

  private playTone(frequency: number, duration: number, type: OscillatorType): void {
    if (!this.soundEnabled) return;
    try {
      this.audioContext ??= new AudioContext();
      const oscillator = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.06, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
      oscillator.connect(gain).connect(this.audioContext.destination);
      oscillator.start();
      oscillator.stop(this.audioContext.currentTime + duration);
    } catch { /* Audio is an enhancement, not a requirement. */ }
  }
}
