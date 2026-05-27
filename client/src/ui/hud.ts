import type { WeaponId } from "../combat/weapons";

/**
 * Combat HUD: HP bar, shuriken count, weapon indicator, damage vignette,
 * and a game-over overlay with a restart hook.
 */
export class Hud {
  private hpFill: HTMLDivElement;
  private hpText: HTMLDivElement;
  private starText: HTMLDivElement;
  private weaponText: HTMLDivElement;
  private vignette: HTMLDivElement;
  private gameOver: HTMLDivElement;
  private bossPanel: HTMLDivElement;
  private bossBarFill: HTMLDivElement;
  private bossNameText: HTMLDivElement;
  private victory: HTMLDivElement;
  private root: HTMLDivElement;

  constructor(private onRestart: () => void) {
    this.root = document.createElement("div");
    this.root.id = "combat-hud";
    this.root.innerHTML = `
      <style>
        #combat-hud { position: fixed; inset: 0; pointer-events: none; font-family: system-ui, sans-serif; color: #f0f0f0; }
        #combat-hud.hidden { display: none; }
        .panel { background: rgba(8, 10, 16, 0.6); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
        #hp-panel { position: fixed; left: 16px; bottom: 16px; width: 240px; }
        #hp-bar { width: 100%; height: 14px; background: #2a0c0c; border-radius: 3px; overflow: hidden; margin-top: 6px; }
        #hp-fill { height: 100%; background: linear-gradient(90deg, #e22, #f55); width: 100%; transition: width 120ms linear; }
        #hp-text { font-size: 14px; font-weight: 600; letter-spacing: 1px; }
        #ammo-panel { position: fixed; right: 16px; bottom: 16px; min-width: 160px; text-align: right; }
        #weapon-text { font-size: 12px; opacity: 0.8; letter-spacing: 2px; text-transform: uppercase; }
        #star-text { font-size: 22px; font-weight: 700; margin-top: 4px; }
        #vignette { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 200px 60px rgba(255,40,40,0); transition: box-shadow 120ms ease-out; }
        #game-over { position: fixed; inset: 0; background: rgba(8,4,4,0.78); display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: auto; cursor: pointer; text-align: center; }
        #game-over.hidden { display: none; }
        #game-over h1 { font-size: 64px; margin: 0 0 12px; color: #ff5050; letter-spacing: 4px; }
        #game-over p { opacity: 0.85; }
        #boss-panel { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); width: 60vw; max-width: 620px; padding: 8px 12px; background: rgba(10,4,4,0.72); border: 1px solid rgba(255,80,80,0.5); border-radius: 6px; text-align: center; pointer-events: none; }
        #boss-panel.hidden { display: none; }
        #boss-name { font-size: 14px; font-weight: 700; letter-spacing: 4px; color: #ff8080; text-shadow: 0 1px 2px #000; margin-bottom: 6px; }
        #boss-bar { position: relative; height: 18px; background: #220606; border-radius: 3px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
        #boss-bar-fill { height: 100%; background: linear-gradient(90deg, #aa0e0e, #ff4040, #aa0e0e); width: 100%; transition: width 250ms ease; }
        .boss-tick { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.35); pointer-events: none; }
        .boss-tick-66 { left: 66%; }
        .boss-tick-33 { left: 33%; }
        #victory { position: fixed; inset: 0; background: rgba(20,12,2,0.82); display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: auto; cursor: pointer; text-align: center; }
        #victory.hidden { display: none; }
        #victory h1 { font-size: 72px; margin: 0 0 12px; color: #ffd060; letter-spacing: 6px; text-shadow: 0 0 20px rgba(255,200,80,0.6); }
        #victory p { opacity: 0.9; }
        kbd { background:#222; border:1px solid #444; border-bottom-width:2px; border-radius:4px; padding:1px 6px; font-size:0.9em; }
      </style>
      <div id="hp-panel" class="panel">
        <div id="hp-text">HP 100 / 100</div>
        <div id="hp-bar"><div id="hp-fill"></div></div>
      </div>
      <div id="ammo-panel" class="panel">
        <div id="weapon-text">Katana</div>
        <div id="star-text">★ 20</div>
      </div>
      <div id="vignette"></div>
      <div id="game-over" class="hidden">
        <h1>YOU DIED</h1>
        <p>The dungeon claimed another ninja.</p>
        <p style="margin-top: 24px">Press <kbd>R</kbd> or click to try again</p>
      </div>
      <div id="boss-panel" class="hidden">
        <div id="boss-name">DRAGON</div>
        <div id="boss-bar">
          <div id="boss-bar-fill"></div>
          <div class="boss-tick boss-tick-66"></div>
          <div class="boss-tick boss-tick-33"></div>
        </div>
      </div>
      <div id="victory" class="hidden">
        <h1>VICTORY</h1>
        <p>The dragon is slain. The treasure is yours.</p>
        <p style="margin-top: 24px">Press <kbd>R</kbd> or click to play again</p>
      </div>
    `;
    document.body.appendChild(this.root);

    this.hpFill = this.root.querySelector("#hp-fill") as HTMLDivElement;
    this.hpText = this.root.querySelector("#hp-text") as HTMLDivElement;
    this.starText = this.root.querySelector("#star-text") as HTMLDivElement;
    this.weaponText = this.root.querySelector("#weapon-text") as HTMLDivElement;
    this.vignette = this.root.querySelector("#vignette") as HTMLDivElement;
    this.gameOver = this.root.querySelector("#game-over") as HTMLDivElement;
    this.bossPanel = this.root.querySelector("#boss-panel") as HTMLDivElement;
    this.bossBarFill = this.root.querySelector("#boss-bar-fill") as HTMLDivElement;
    this.bossNameText = this.root.querySelector("#boss-name") as HTMLDivElement;
    this.victory = this.root.querySelector("#victory") as HTMLDivElement;

    this.gameOver.addEventListener("click", () => this.onRestart());
    this.victory.addEventListener("click", () => this.onRestart());
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyR") return;
      if (!this.gameOver.classList.contains("hidden")) this.onRestart();
      else if (!this.victory.classList.contains("hidden")) this.onRestart();
    });

    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle("hidden", !v);
  }

  setHp(hp: number, maxHp: number): void {
    const ratio = Math.max(0, hp / maxHp);
    this.hpFill.style.width = `${ratio * 100}%`;
    this.hpText.textContent = `HP ${Math.ceil(hp)} / ${maxHp}`;
  }

  setShurikens(n: number): void {
    this.starText.textContent = `★ ${n}`;
  }

  setWeapon(id: WeaponId): void {
    this.weaponText.textContent = id === "katana" ? "1 — KATANA" : "2 — SHURIKEN";
  }

  setHitFlash(intensity: number): void {
    const a = Math.max(0, Math.min(1, intensity));
    this.vignette.style.boxShadow = `inset 0 0 200px 60px rgba(255,40,40,${a * 0.55})`;
  }

  showGameOver(): void {
    this.gameOver.classList.remove("hidden");
  }

  hideGameOver(): void {
    this.gameOver.classList.add("hidden");
  }

  setBossBarVisible(visible: boolean, name = "DRAGON"): void {
    this.bossPanel.classList.toggle("hidden", !visible);
    this.bossNameText.textContent = name;
  }

  setBossHp(hp: number, maxHp: number): void {
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    this.bossBarFill.style.width = `${ratio * 100}%`;
  }

  showVictory(): void {
    this.victory.classList.remove("hidden");
  }

  hideVictory(): void {
    this.victory.classList.add("hidden");
  }
}
