/**
 * @module dev/qa75
 * THE LONG QA SESSION (it.75). A dev-only scripted playthrough: nothing
 * imports it, so it never reaches a build. Load it from the console with
 *
 *     await import('/src/dev/qa75.ts'); await __qa75({ seed: 3, cls: 'mage' })
 *
 * and it drives a whole run through the public debug handles — town, the
 * panels, a fight, loot, skills, draughts, five floors, a warden, the town
 * portal both ways, a save and a reload, a death and a rising, the chart,
 * the device matrix — recording every assertion that fails and every
 * console error along the way. Sim time is `loop.step`; only real floor
 * transitions wait on the wall clock (bounded).
 *
 * It returns `{ pass, fail, errors }`. A clean session is `fail: []` and
 * `errors: []`.
 */

type Cls = 'warrior' | 'mage' | 'ranger' | 'rogue';

interface Report {
  seed: number;
  cls: Cls;
  pass: string[];
  fail: string[];
  errors: string[];
  ms: number;
}

// Loose views over the DEV handles (the harness never ships).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms: number, step = 120): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (cond()) return true;
    await wait(step);
  }
  return cond();
}

const W = window as Any;
const game = (): Any => W.__game;

function countFoes(g: Any): number {
  let n = 0;
  g.state.forEach((e: Any) => {
    if (e.constructor.name === 'Enemy' && e.action !== 'dead' && (e.pos.x || e.pos.y)) n++;
  });
  return n;
}

function foes(g: Any): Any[] {
  const out: Any[] = [];
  g.state.forEach((e: Any) => {
    if (e.constructor.name === 'Enemy' && e.action !== 'dead' && (e.pos.x || e.pos.y)) out.push(e);
  });
  return out;
}

/** A warp queued during a fade's tail is dropped by design: wait the fade out first. */
const fadeClear = (): Promise<boolean> => until(() => !document.getElementById('floor-fade')?.classList.contains('show'), 6000, 100);

const key = (code: string): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
};

function inside(el: Element | null): boolean {
  if (!el) return false;
  const b = el.getBoundingClientRect();
  const W2 = document.documentElement.clientWidth;
  const H2 = document.documentElement.clientHeight;
  return b.width > 4 && b.height > 4 && b.left >= -1 && b.top >= -1 && b.right <= W2 + 1 && b.bottom <= H2 + 1;
}

export async function runQa(opts: { seed?: number; cls?: Cls; deep?: boolean } = {}): Promise<Report> {
  const seed = opts.seed ?? 1;
  const cls = opts.cls ?? 'warrior';
  const t0 = performance.now();
  const pass: string[] = [];
  const fail: string[] = [];
  const errors: string[] = [];
  const check = (name: string, ok: boolean, detail = ''): void => {
    (ok ? pass : fail).push(ok ? name : `${name}${detail ? ` — ${detail}` : ''}`);
    (window as unknown as { __qaLast: string }).__qaLast = `${pass.length + fail.length} ${name}`; // Where the run is, for a watcher outside.
  };
  // Every console error and unhandled rejection during the session is a finding.
  const origErr = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ').slice(0, 200));
    origErr(...a);
  };
  const onRej = (e: PromiseRejectionEvent): void => {
    errors.push(`rejection: ${String(e.reason).slice(0, 200)}`);
  };
  window.addEventListener('unhandledrejection', onRej);

  try {
    // ---- a fresh hero in town -------------------------------------------------
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('iso-arpg-save-')) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    if (game()) {
      W.__menu.exitToMenu();
      await until(() => !game(), 4000);
    }
    W.__menu.beginRun(cls, 0, { slot: 1 });
    check('run starts', await until(() => !!game(), 20000));
    let g = game();
    if (!g) throw new Error('no run');
    g.loop.step(30);
    check('starts in town', g.floor === 0 && !!g.town);
    check('first skill on slot 1', !!g.player.loadout[0], JSON.stringify(g.player.loadout));
    check('status plate present', !!document.getElementById('status-frame'));
    check('system bar has 8 entries', document.querySelectorAll('#system-bar .ds-icon-btn').length === 8); // The codex joined (it.81).
    check('chart present', !!document.getElementById('minimap'));

    // ---- every window opens, fits, closes -----------------------------------
    for (const [code, sel] of [
      ['KeyI', '#inv-panel'],
      ['KeyK', '#skill-tree'],
      ['KeyC', '#char-sheet'],
      ['KeyB', '#bestiary'],
      ['KeyL', '#level-select'],
      ['F1', '#cheat-menu'],
      ['KeyO', '#settings-panel'],
    ] as const) {
      key(code);
      W.__layout.fit.refresh();
      const el = document.querySelector(sel);
      const open = !!el && el.classList.contains('open');
      check(`${sel} opens on ${code}`, open);
      check(`${sel} fits the screen`, !open || inside(el));
      key(code);
      check(`${sel} closes on ${code}`, !document.querySelector(`${sel}.open`));
    }
    key('Escape');
    check('pause opens on Escape', !!document.querySelector('#pause-menu.show'));
    key('Escape');
    check('pause closes on Escape', !document.querySelector('#pause-menu.show'));

    // ---- the chart expands and folds ------------------------------------------
    const map = document.getElementById('minimap')!;
    const tap = (el: Element): void => {
      for (const t of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true }));
    };
    tap(map);
    await wait(60);
    check('chart expands on a tap', map.classList.contains('expanded'));
    key('Escape');
    check('chart folds on Escape without pausing', !map.classList.contains('expanded') && !document.querySelector('#pause-menu.show'));

    // ---- the town economy -------------------------------------------------------
    const gold0 = g.player.gold;
    g.player.gold += 500;
    g.shopUI.open('alchemist');
    check('shop opens', !!document.querySelector('.town-panel.open'));
    g.queue.enqueue({ type: 'BUY', playerId: 0, index: 0, vendor: 'alchemist' });
    g.loop.step(2);
    check('a purchase costs gold', g.player.gold < gold0 + 500, `${g.player.gold}`);
    g.shopUI.close();
    g.stashUI.open();
    const packBefore = g.player.backpack.length;
    if (packBefore > 0) {
      g.queue.enqueue({ type: 'STASH_PUT', playerId: 0, backpackIndex: 0 });
      g.loop.step(2);
      check('stash takes an item', g.player.backpack.length === packBefore - 1);
      g.queue.enqueue({ type: 'STASH_TAKE', playerId: 0, index: 0 });
      g.loop.step(2);
      check('stash gives it back', g.player.backpack.length === packBefore);
    }
    g.stashUI.close();

    // ---- into the crypt ------------------------------------------------------------
    await g.travel(1);
    check('travel to depth I', await until(() => game() && game().floor === 1, 8000));
    g = game();
    g.loop.step(10);
    const n1 = countFoes(g);
    check('depth I has foes', n1 > 0, `${n1}`);
    check('stairs exist', !!g.stairs);

    // ---- a fight: click-attack the nearest foe (the hero walks, so the
    // fog and the target rules run exactly as they do for a player) --------------
    const list = foes(g);
    if (list.length) {
      let best = list[0];
      let bd = 1e9;
      for (const e of list) {
        const d = Math.hypot(e.pos.x - g.player.pos.x, e.pos.y - g.player.pos.y);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      const hp0 = best.hp;
      g.queue.enqueue({ type: 'ATTACK', playerId: 0, targetId: best.id });
      for (let i = 0; i < 12 && best.hp >= hp0 && best.action !== 'dead'; i++) g.loop.step(60);
      check('click-attack reaches and wounds the foe', best.hp < hp0 || best.action === 'dead', `${hp0} -> ${best.hp} at ${bd.toFixed(1)} tiles`);
      g.queue.enqueue({ type: 'ATTACK_DOWN', playerId: 0 });
      g.loop.step(120);
      g.queue.enqueue({ type: 'ATTACK_UP', playerId: 0 });
      g.loop.step(5);
    }

    // ---- kills, XP, loot, pickup -----------------------------------------------------
    const xp0 = g.player.xp;
    const lvl0 = g.player.level;
    for (const e of foes(g)) g.combat.dealDamage({ sourceId: g.player.id, targetId: e.id, amount: 9999 });
    g.loop.step(120);
    check('kills give XP', g.player.xp > xp0 || g.player.level > lvl0, `${xp0} -> ${g.player.xp}, lvl ${lvl0} -> ${g.player.level}`);
    check('the floor is cleared', countFoes(g) === 0, `${countFoes(g)} left`);
    const drops = g.loot.snapshot().items;
    check('kills drop loot', drops.length > 0, `${drops.length}`);
    if (drops.length) {
      const it = drops[0];
      g.player.warpTo(it.x, it.y);
      const pack = g.player.backpack.length;
      g.queue.enqueue({ type: 'PICKUP_NEAREST', playerId: 0 });
      g.loop.step(90);
      check('pickup lands in the pack', g.player.backpack.length > pack || g.loot.snapshot().items.length < drops.length);
    }
    if (g.player.level > lvl0) check('a level brings skill points', g.player.skillPoints > 0);

    // ---- skills and draughts ----------------------------------------------------------
    if (g.player.loadout[0]) {
      g.player.resource = g.player.resourceMax;
      g.queue.enqueue({ type: 'SKILL', playerId: 0, slot: 0 });
      g.loop.step(3);
      check('skill 1 casts and cools', g.skills.cooldowns[0] > 0, `${g.skills.cooldowns[0]}`);
    }
    g.player.hp = Math.max(1, Math.floor(g.player.hpMax * 0.3));
    const potions = g.player.backpack.filter((id: string) => id === 'health_potion').length;
    const hpBefore = g.player.hp;
    g.queue.enqueue({ type: 'USE_QUICK', playerId: 0, kind: 'health' });
    g.loop.step(90);
    check('a draught heals', potions === 0 || g.player.hp > hpBefore, `${hpBefore} -> ${g.player.hp} (${potions} potions)`);

    // ---- down to the warden --------------------------------------------------------------
    for (let f = 2; f <= 4; f++) {
      await g.travel(f);
      const ok = await until(() => game() && game().floor === f, 8000);
      check(`travel to depth ${f}`, ok);
      g = game();
      g.loop.step(10);
      if (!ok) break;
    }
    // Depth V proper has a sealed chamber; the warden waits in the ARENA behind it.
    await g.travel(5, true);
    check('travel to the depth V arena', await until(() => game() && game().floor === 5 && game().isArena, 8000));
    g = game();
    g.loop.step(10);
    if (g.floor === 5) {
      check('depth V has a warden', !!g.boss, String(!!g.boss));
      if (g.boss) {
        const drops0 = g.loot.snapshot().items.length;
        g.combat.dealDamage({ sourceId: g.player.id, targetId: g.boss.id, amount: 99999 });
        g.loop.step(200);
        check('the warden falls', g.boss.action === 'dead' || g.boss.hp <= 0);
        g.loop.step(240);
        check('the warden drops trophies', g.loot.snapshot().items.length > drops0, `${drops0} -> ${g.loot.snapshot().items.length}`);
      }
    }

    // ---- the town portal, both ways (real fades: bounded wall-clock waits;
    // a hidden tab throttles their timers, so the bound is generous) ----------------
    const fromFloor = g.floor;
    await fadeClear();
    g.queue.enqueue({ type: 'TOWN_PORTAL', playerId: 0 });
    g.loop.step(5);
    check('portal home', await until(() => game() && game().floor === 0 && !!game().town, 25000, 250));
    g = game();
    g.loop.step(10);
    check('portal remembers the floor', !!g.portalReturn && g.portalReturn.floor === fromFloor, JSON.stringify(g.portalReturn));
    await fadeClear();
    g.queue.enqueue({ type: 'WARP', playerId: 0, to: 'portalBack' });
    g.loop.step(5);
    check('portal back down', await until(() => game() && game().floor === fromFloor, 25000, 250));
    g = game();
    g.loop.step(10);

    // ---- save and reload ------------------------------------------------------------------
    const lvl = g.player.level;
    const gold = g.player.gold;
    check('save writes', g.saveNow() === true);
    const raw = localStorage.getItem('iso-arpg-save-1');
    check('save persists', !!raw);
    if (raw) {
      const save = JSON.parse(raw);
      W.__menu.exitToMenu();
      await until(() => !game(), 4000);
      W.__menu.beginRun(cls, save.pos && save.floor > 0 ? save.floor : 0, { slot: 1, save });
      check('reload starts', await until(() => !!game(), 20000));
      g = game();
      g.loop.step(10);
      check('reload keeps level and gold', g.player.level === lvl && g.player.gold === gold, `${g.player.level}/${lvl}, ${g.player.gold}/${gold}`);
      check('reload lands on the saved floor', g.floor === (save.pos && save.floor > 0 ? save.floor : 0), `${g.floor}`);
    }

    // ---- death and rising --------------------------------------------------------------------
    if (g.floor > 0) {
      g.combat.dealDamage({ sourceId: g.player.id, targetId: g.player.id, amount: 99999 });
      g.loop.step(120);
      check('the hero falls', g.player.action === 'dead' || g.runMenus.isDeathShown);
      check('the death sheet shows', g.runMenus.isDeathShown);
      await wait(450); // The sheet ignores the opening tap's click for 350 ms.
      (document.querySelector('#death-menu [data-act=respawn]') as HTMLElement | null)?.click();
      g.loop.step(10);
      check('rising again', g.player.action !== 'dead' && g.player.hp > 0, `${g.player.action} ${g.player.hp}`);
    }

    // ---- the coliseum -------------------------------------------------------------------------
    if (g.floor !== 0) {
      await g.travel(0);
      await until(() => game() && game().floor === 0, 8000);
      g = game();
    }
    await fadeClear();
    g.queue.enqueue({ type: 'WARP', playerId: 0, to: 'coliseum', n: 2 });
    g.loop.step(5);
    check('coliseum opens', await until(() => game() && game().floor < 0, 25000, 250));
    g = game();
    g.loop.step(120);
    check('coliseum has a wave', !!g.coliseum, String(!!g.coliseum));
    await fadeClear();
    g.queue.enqueue({ type: 'WARP', playerId: 0, to: 'town' });
    g.loop.step(5);
    check('coliseum back to town', await until(() => game() && game().floor === 0, 25000, 250));
    g = game();

    // ---- the camp forge and the merchants (it.78) ----------------------------------------------
    {
      if (g.floor !== 0) {
        await g.travel(0);
        await until(() => game() && game().floor === 0, 8000);
        g = game();
        await fadeClear();
      }
      const forge = g.town?.interactables.find((i: { kind: string }) => i.kind === 'forge');
      check('the camp forge stands in town', !!forge, forge ? `${forge.x},${forge.y}` : 'none');
      const p = g.player;
      p.addItem('steel_blade@L3R2U0Astr2.crt1');
      p.addItem('leather_boots@L2R0U0');
      p.addMaterial('iron_scrap', 30);
      p.addMaterial('arcane_dust', 6);
      p.addMaterial('essence', 4);
      const goldBefore = p.gold;
      p.gold = Math.max(p.gold, 2000);
      g.craftUI.open('salvage');
      await wait(60);
      check('the forge panel opens', !!document.querySelector('#craft-panel.open'));
      check('the forge panel fits the screen', inside(document.getElementById('craft-panel')));
      const bootsIdx = p.backpack.findIndex((id: string) => id.startsWith('leather_boots'));
      const scrapBefore = p.materials.get('iron_scrap') ?? 0;
      g.queue.enqueue({ type: 'SALVAGE', playerId: 0, backpackIndex: bootsIdx });
      g.loop.step(3);
      check('salvage pays scraps', (p.materials.get('iron_scrap') ?? 0) > scrapBefore && !p.backpack.some((id: string) => id.startsWith('leather_boots')));
      const dustBefore = p.materials.get('arcane_dust') ?? 0;
      g.queue.enqueue({ type: 'TRANSMUTE', playerId: 0, recipe: 'scrap_dust', times: 1 });
      g.loop.step(3);
      check('transmute turns five scraps into dust', (p.materials.get('arcane_dust') ?? 0) === dustBefore + 1);
      const bladeIdx = p.backpack.findIndex((id: string) => id.startsWith('steel_blade'));
      for (let i = 0; i < 3; i++) {
        g.queue.enqueue({ type: 'REINFORCE', playerId: 0, backpackIndex: bladeIdx });
        g.loop.step(3);
      }
      check('three sure reinforcements reach +3', p.backpack[bladeIdx]?.includes('U3'), p.backpack[bladeIdx]);
      const before = p.backpack[bladeIdx];
      g.queue.enqueue({ type: 'REROLL', playerId: 0, backpackIndex: bladeIdx, affixIndex: 0 });
      g.loop.step(3);
      check('refining rewrites one line', p.backpack[bladeIdx] !== before && p.backpack[bladeIdx]?.includes('U3'), p.backpack[bladeIdx]);
      const packBefore = p.backpack.length;
      g.queue.enqueue({ type: 'FORGE', playerId: 0, base: 'steel_shortsword' });
      g.loop.step(3);
      check('the forge makes a blueprint', p.backpack.length === packBefore + 1 && p.backpack[p.backpack.length - 1].startsWith('steel_shortsword@'), p.backpack[p.backpack.length - 1]);
      g.craftUI.close();
      g.shopUI.open('armorer');
      await wait(60);
      check('the armorer stocks rolled gear', g.townSystem.stock.some((id: string) => id.includes('@')), String(g.townSystem.stock.length));
      check('the restock clock reads', !!document.querySelector('#shop-panel [data-restock]')?.textContent);
      g.shopUI.close();
      p.gold = goldBefore;
    }

    // ---- the belt, the draughts, the enchantments, the effects (it.80) -------------------------
    {
      if (g.floor !== 0) {
        await g.travel(0);
        await until(() => game() && game().floor === 0, 8000);
        g = game();
        await fadeClear();
      }
      const p = g.player;
      // The belt: assign a rejuvenation draught to Q, quaff it, and the cooldown refuses the next.
      p.addItem('rejuvenation');
      p.addItem('rejuvenation');
      g.queue.enqueue({ type: 'SET_BELT', playerId: 0, slot: 0, item: 'rejuvenation' });
      g.loop.step(2);
      check('the belt takes a chosen draught on Q', p.belt[0] === 'rejuvenation', String(p.belt[0]));
      p.hp = Math.max(1, Math.round(p.hpMax * 0.5));
      const packBefore = p.backpack.length;
      g.queue.enqueue({ type: 'USE_QUICK', playerId: 0, kind: 'health' });
      g.loop.step(2);
      check('Q quaffs the belt draught', p.backpack.length === packBefore - 1 && p.hp > p.hpMax * 0.5, `${p.hp}/${p.hpMax}`);
      check('a healing draught starts its cooldown', (p.quaffCd.get('heal') ?? 0) > 200, String(p.quaffCd.get('heal')));
      g.queue.enqueue({ type: 'USE_QUICK', playerId: 0, kind: 'health' });
      g.loop.step(2);
      check('the cooldown refuses a second quaff', p.backpack.length === packBefore - 1);
      // A recipe scroll: read it, then enchant a weapon at the forge, then reinforce with gold alone.
      p.addItem('recipe_flame');
      const scrollIdx = p.backpack.indexOf('recipe_flame');
      g.queue.enqueue({ type: 'USE_ITEM', playerId: 0, backpackIndex: scrollIdx });
      g.loop.step(2);
      check('a recipe scroll teaches the enchantment', p.recipes.has('flame'));
      p.addItem('steel_saber@L4R2U0Astr1.crt1');
      p.addMaterial('essence', 6);
      p.addMaterial('arcane_dust', 12);
      p.addMaterial('iron_scrap', 20);
      const goldBefore2 = p.gold;
      p.gold = Math.max(p.gold, 3000);
      const saberIdx = p.backpack.findIndex((id: string) => id.startsWith('steel_saber'));
      g.queue.enqueue({ type: 'ENCHANT', playerId: 0, backpackIndex: saberIdx, key: 'flame' });
      g.loop.step(2);
      const { itemDef } = await import('@/items/instance');
      const saber = itemDef(p.backpack[saberIdx]);
      check('the forge lays the enchantment', p.backpack[saberIdx].includes('Eflame') && !!saber?.effects?.some((e: { proc?: { status: string } }) => e.proc?.status === 'burn'), p.backpack[saberIdx]);
      check('an enchanted weapon says so in its name and lines', !!saber && saber.name.startsWith('Flaming') && (saber.affixLines ?? []).some((l: string) => l.startsWith('Enchant')), saber?.name);
      const scrapBefore = p.materials.get('iron_scrap') ?? 0;
      const goldMid = p.gold;
      g.queue.enqueue({ type: 'REINFORCE', playerId: 0, backpackIndex: saberIdx, payGold: true });
      g.loop.step(2);
      check('reinforcing with gold alone spends gold, not scraps', p.backpack[saberIdx].includes('U1') && (p.materials.get('iron_scrap') ?? 0) === scrapBefore && p.gold < goldMid, p.backpack[saberIdx]);
      // The forge's book and the enchant tab open and fit.
      g.craftUI.open('recipes');
      await wait(60);
      check('the recipe book opens', !!document.querySelector('#craft-panel.open .rb-odds'));
      check('the recipe book fits the screen', inside(document.getElementById('craft-panel')));
      g.craftUI.close();
      g.craftUI.open('enchant');
      await wait(60);
      check('the enchant tab lists weapons', !!document.querySelector('#craft-panel.open [data-pick]'));
      g.craftUI.close();
      p.gold = goldBefore2;
      // Weapon identity: a steel saber and a crystal saber are not the same weapon.
      const a = itemDef('steel_saber');
      const b = itemDef('crystal_saber');
      check('tiers differ in their innates', !!a?.effects?.length && !!b?.effects?.length && JSON.stringify(a.effects) !== JSON.stringify(b.effects));
      // Statuses on a foe: a floor the session has not cleared yet.
      await g.travel(6);
      await until(() => game() && game().floor === 6, 12000);
      g = game();
      await fadeClear();
      g.loop.step(30);
      const foe = foes(g).find((e: { hp: number }) => e.hp > 0);
      if (foe) {
        const hpBefore = foe.hp;
        g.status.inflict(foe, { status: 'bleed', chance: 1, power: 1 }, 40, g.player.id);
        g.loop.step(70);
        check('a bleed bites over time', foe.hp < hpBefore || foe.action === 'dead', `${hpBefore} -> ${foe.hp}`);
        const foe2 = foes(g).find((e: { hp: number; id: number }) => e.hp > 0 && e.id !== foe.id);
        if (foe2) {
          g.status.inflict(foe2, { status: 'chill', chance: 1, power: 1 }, 10, g.player.id);
          check('a chill slows the foe', foe2.chillTicks > 0 && foe2.chillFactor < 1, `${foe2.chillTicks} ${foe2.chillFactor}`);
        }
      } else check('a foe stands to test statuses', false, 'no foe');
    }

    // ---- the codex, the filters, the borders, the gauge labels (it.81) -----------------------
    {
      const p = g.player;
      check('the gauges are labelled', [...document.querySelectorAll('#status-frame .ds-bar-label')].map((l: Element) => l.textContent?.trim()).join('|').includes('HP') && !!document.querySelector('#status-frame .sf-xp .ds-bar-label'));
      key('KeyH');
      await wait(80);
      check('the codex opens on H', !!document.querySelector('#codex.open .codex-body'));
      check('the codex fits the screen', inside(document.getElementById('codex')));
      for (const ch of ['catalogue', 'statuses', 'enchants', 'forge', 'legend', 'merchants', 'combat']) {
        g.codexUI.open(ch);
        await wait(30);
        check(`the codex chapter ${ch} renders`, (document.querySelector('#codex .codex-body')?.textContent?.length ?? 0) > 200);
      }
      key('KeyH');
      await wait(50);
      check('the codex closes on H', !document.querySelector('#codex.open'));
      p.addItem('steel_saber@L4R2U0Astr1.crt1Eflame');
      p.addItem('crystal_kris@L60R3U2Aagi3.crt2');
      key('KeyI');
      await wait(60);
      check('special pieces wear an effect border', !!document.querySelector('#inv-panel .inv-item.fx-ench') && !!document.querySelector('#inv-panel .inv-item.fx-proc'));
      const chip = document.querySelector<HTMLButtonElement>('#inv-panel .if-chip[data-if-filter=weapon]');
      chip?.click();
      await wait(60);
      const shown = [...document.querySelectorAll('#inv-panel .inv-pack-grid .inv-item')];
      check('the ARMS filter shows only weapons', shown.length > 0 && shown.every((c) => !c.classList.contains('inv-use')), String(shown.length));
      document.querySelector<HTMLButtonElement>('#inv-panel .if-chip[data-if-filter=all]')?.click();
      await wait(40);
      const before = [...p.backpack];
      g.queue.enqueue({ type: 'SORT_PACK', playerId: 0 });
      g.loop.step(2);
      check('TIDY reorders the pack deterministically', p.backpack.length === before.length && p.backpack.join() !== before.join() && [...p.backpack].sort().join() === [...before].sort().join());
      key('KeyI');
      await wait(40);
    }

    // ---- the cross after a repaint, the icons on the card, every window's cross (it.82) ----------
    {
      const p = g.player;
      key('KeyI');
      await wait(60);
      p.addItem('potion_haste'); // A repaint while the window is open.
      await wait(60);
      document.querySelector<HTMLElement>('#inv-panel [data-close]')?.click();
      await wait(60);
      check('the inventory cross works after a repaint', !document.querySelector('#inv-panel.open'));
      p.addItem('crystal_orbrod@L58R2U1Aint2.rgn3');
      key('KeyI');
      await wait(60);
      const cell = document.querySelector<HTMLElement>('#inv-panel button[data-item^=crystal_orbrod]');
      const r = cell?.getBoundingClientRect();
      cell?.dispatchEvent(new MouseEvent('mouseenter', { clientX: (r?.left ?? 0) + 10, clientY: (r?.top ?? 0) + 10 }));
      const tip = document.getElementById('inv-tooltip');
      check('a weapon card shows its status icon and a plain sentence', !!tip?.querySelector('.tip-fx-icon') && /Applies Chill to enemies/.test(tip?.textContent ?? ''), tip?.textContent?.slice(0, 80));
      cell?.dispatchEvent(new MouseEvent('mouseleave'));
      key('KeyI');
      await wait(40);
      // Every window: open, click its cross, closed.
      const probe = async (id: string, open: () => void): Promise<void> => {
        open();
        await wait(80);
        const el = document.getElementById(id);
        const x = el?.querySelector<HTMLElement>('[data-close], [data-close-x], .tp-close');
        x?.click();
        await wait(80);
        const still = !!el && (el.classList.contains('open') || el.classList.contains('show'));
        check(`${id} closes on its cross`, !!x && !still);
        if (still) el?.classList.remove('open', 'show');
      };
      await probe('skill-tree', () => key('KeyK'));
      await probe('char-sheet', () => key('KeyC'));
      await probe('bestiary', () => key('KeyB'));
      await probe('level-select', () => key('KeyL'));
      await probe('settings-panel', () => key('KeyO'));
      await probe('cheat-menu', () => key('F1'));
      await probe('codex', () => key('KeyH'));
      if (g.floor === 0) {
        await probe('shop-panel', () => g.shopUI.open('armorer'));
        await probe('stash-panel', () => g.stashUI.open());
        await probe('craft-panel', () => g.craftUI.open('salvage'));
      }
      // The journal knows the craft log and the recipes.
      g.codexUI.open('log');
      await wait(40);
      check('the journal has a craft log', !!document.querySelector('#codex .cx-log'));
      g.codexUI.close();
    }

    // ---- THE CRAFT LEDGER (it.83): every forge and counter operation, to the coin ----------------
    {
      if (g.floor !== 0) {
        await g.travel(0);
        await until(() => game() && game().floor === 0, 8000);
        g = game();
        await fadeClear();
      }
      const p = g.player;
      const { itemDef } = await import('@/items/instance');
      const { itemValue } = await import('@/items/catalog');
      const { salvageYield, forgeCost, rerollCost, reinforceCost, enchantCost, goldOnlyCost, TRANSMUTE_RECIPES } = await import('@/systems/Crafting');
      const { ilvlForDepth } = await import('@/items/instance');
      const { SELL_RATIO } = await import('@/systems/Town');
      const mat = (k: string): number => p.materials.get(k) ?? 0;
      const snap = (): Record<string, number> => ({ gold: p.gold, iron_scrap: mat('iron_scrap'), arcane_dust: mat('arcane_dust'), essence: mat('essence'), alloy_shard: mat('alloy_shard'), catalyst: mat('catalyst') });
      const delta = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]]));
      const paid = (d: Record<string, number>, cost: Record<string, number | undefined>): boolean => Object.entries(d).every(([k, v]) => v === -(cost[k] ?? 0));
      const goldBefore = p.gold;
      p.gold = 20000;
      p.addMaterial('iron_scrap', 60);
      p.addMaterial('arcane_dust', 30);
      p.addMaterial('essence', 20);
      p.addMaterial('alloy_shard', 6);
      p.addMaterial('catalyst', 2);
      // SALVAGE: a rare level-12 helm pays exactly its table.
      p.addItem('iron_helm@L12R2U0Aint2.arm2');
      let idx = p.backpack.findIndex((id: string) => id.startsWith('iron_helm'));
      const helm = itemDef(p.backpack[idx])!;
      const expectSalvage = salvageYield(helm)!;
      let before = snap();
      g.queue.enqueue({ type: 'SALVAGE', playerId: 0, backpackIndex: idx });
      g.loop.step(3);
      let d = delta(before, snap());
      check('salvage pays exactly the table', Object.entries(expectSalvage).every(([k, n]) => d[k] === n) && d.gold === 0 && !p.backpack.some((id: string) => id.startsWith('iron_helm')), JSON.stringify(d));
      // TRANSMUTE ×2: ten scraps for two dust.
      const rc = TRANSMUTE_RECIPES.find((r) => r.id === 'scrap_dust')!;
      before = snap();
      g.queue.enqueue({ type: 'TRANSMUTE', playerId: 0, recipe: 'scrap_dust', times: 2 });
      g.loop.step(3);
      d = delta(before, snap());
      check('transmute twice takes and gives exactly', d.iron_scrap === -2 * rc.take && d.arcane_dust === 2 * rc.give, JSON.stringify(d));
      // FORGE: the blueprint rolls at the deepest depth's level and costs the forge's own price.
      const deepest = Math.max(1, g.deepestFloor ?? 1);
      const lvl = ilvlForDepth(deepest);
      const base = itemDef('steel_blade')!;
      const expectForge = forgeCost(base, lvl);
      before = snap();
      const packBefore = p.backpack.length;
      g.queue.enqueue({ type: 'FORGE', playerId: 0, base: 'steel_blade' });
      g.loop.step(3);
      d = delta(before, snap());
      const forged = p.backpack[p.backpack.length - 1] ?? '';
      const forgedDef = itemDef(forged);
      check('forge charges its own price', p.backpack.length === packBefore + 1 && paid(d, expectForge), JSON.stringify({ d, expectForge }));
      check('a forged piece rolls at the deepest level (−1..+2), uncommon or better', !!forgedDef && (forgedDef.ilvl ?? 0) >= lvl - 1 && (forgedDef.ilvl ?? 0) <= lvl + 2 && forgedDef.rarity !== 'common', `${forged} · lvl ${lvl}`);
      // REFINE: one line changes, the others stay, the price is the table's.
      p.addItem('gilded_rapier@L30R2U0Aagi2.crt1.arm1');
      idx = p.backpack.findIndex((id: string) => id.startsWith('gilded_rapier'));
      const saberDef = itemDef(p.backpack[idx])!;
      const expectReroll = rerollCost(saberDef, 1)!;
      const linesBefore = (saberDef.affixes ?? []).map((a: { key: string; tier: number }) => `${a.key}${a.tier}`);
      before = snap();
      g.queue.enqueue({ type: 'REROLL', playerId: 0, backpackIndex: idx, affixIndex: 1 });
      g.loop.step(3);
      d = delta(before, snap());
      const linesAfter = (itemDef(p.backpack[idx])!.affixes ?? []).map((a: { key: string; tier: number }) => `${a.key}${a.tier}`);
      check('refine charges essence and a fifth of the worth', paid(d, expectReroll), JSON.stringify({ d, expectReroll }));
      check('refine keeps the other lines and the count', linesAfter.length === linesBefore.length && linesAfter[0] === linesBefore[0] && linesAfter[2] === linesBefore[2], `${linesBefore} → ${linesAfter}`);
      // REINFORCE +1 with materials, then +2 with gold alone.
      const r1 = reinforceCost(itemDef(p.backpack[idx])!)!;
      before = snap();
      g.queue.enqueue({ type: 'REINFORCE', playerId: 0, backpackIndex: idx });
      g.loop.step(3);
      d = delta(before, snap());
      check('reinforce +1 charges the table', p.backpack[idx].includes('U1') && paid(d, r1.cost), JSON.stringify({ d, cost: r1.cost }));
      const r2 = reinforceCost(itemDef(p.backpack[idx])!)!;
      before = snap();
      g.queue.enqueue({ type: 'REINFORCE', playerId: 0, backpackIndex: idx, payGold: true });
      g.loop.step(3);
      d = delta(before, snap());
      check('reinforce in gold alone charges the materials two and a half times', p.backpack[idx].includes('U2') && d.gold === -goldOnlyCost(r2.cost) && d.iron_scrap === 0 && d.arcane_dust === 0, JSON.stringify({ d, gold: goldOnlyCost(r2.cost) }));
      // ENCHANT: the recipe's essence and dust and 30% of the worth.
      p.addItem('recipe_frost');
      g.queue.enqueue({ type: 'USE_ITEM', playerId: 0, backpackIndex: p.backpack.indexOf('recipe_frost') });
      g.loop.step(2);
      idx = p.backpack.findIndex((id: string) => id.startsWith('gilded_rapier'));
      const expectEnchant = enchantCost(itemDef(p.backpack[idx])!, 'frost')!;
      before = snap();
      g.queue.enqueue({ type: 'ENCHANT', playerId: 0, backpackIndex: idx, key: 'frost' });
      g.loop.step(3);
      d = delta(before, snap());
      check('enchant charges the recipe and a third of the worth', p.backpack[idx].includes('Efrost') && paid(d, expectEnchant), JSON.stringify({ d, expectEnchant }));
      // THE COUNTER: sell at a quarter, buy back at the same, buy at the full worth.
      g.shopUI.open('armorer');
      await wait(60);
      idx = p.backpack.findIndex((id: string) => id.startsWith('gilded_rapier'));
      const sold = p.backpack[idx];
      const worth = itemValue(itemDef(sold)!);
      before = snap();
      g.queue.enqueue({ type: 'SELL', playerId: 0, backpackIndex: idx });
      g.loop.step(2);
      d = delta(before, snap());
      check('a sale pays a quarter of the worth', d.gold === Math.max(1, Math.round(worth * SELL_RATIO)) && !p.backpack.includes(sold), `${d.gold} of ${worth}`);
      before = snap();
      g.queue.enqueue({ type: 'BUYBACK', playerId: 0, index: 0 });
      g.loop.step(2);
      d = delta(before, snap());
      check('buyback costs exactly what was paid', d.gold === -Math.max(1, Math.round(worth * SELL_RATIO)) && p.backpack.includes(sold), String(d.gold));
      const stockId = g.townSystem.stock[0];
      const stockWorth = itemValue(itemDef(stockId)!);
      before = snap();
      g.queue.enqueue({ type: 'BUY', playerId: 0, index: 0, vendor: 'armorer' });
      g.loop.step(2);
      d = delta(before, snap());
      check('a purchase costs the full worth and lands in the pack', d.gold === -stockWorth && p.backpack.includes(stockId), `${d.gold} of ${stockWorth}`);
      g.shopUI.close();
      // THE RESTOCK: a warden's fall turns the counter over on the next arrival in town.
      const serial = g.townSystem.restockSerial;
      g.townSystem.markBossCleared();
      g.townSystem.restockIfDue(1, deepest, g.state.tick);
      check('the counter restocks after a warden falls', g.townSystem.restockSerial === serial + 1, `${serial} → ${g.townSystem.restockSerial}`);
      // THE STASH: gold in, gold out.
      before = snap();
      g.queue.enqueue({ type: 'STASH_GOLD', playerId: 0, amount: 500 });
      g.loop.step(2);
      d = delta(before, snap());
      check('the stash takes gold', d.gold === -500 && g.townSystem.stash.gold === 500, String(g.townSystem.stash.gold));
      g.queue.enqueue({ type: 'STASH_GOLD', playerId: 0, amount: -500 });
      g.loop.step(2);
      check('the stash gives gold back', p.gold === before.gold && g.townSystem.stash.gold === 0, String(p.gold));
      // The journal's worked example uses the forge's own numbers.
      g.codexUI.open('forge');
      await wait(60);
      const sample = { id: 's', name: 's', slot: 'mainHand', rarity: 'rare', color: 0, ilvl: 12, upgrade: 0, affixes: [{ key: 'str', tier: 1 }] };
      const example = document.querySelector('#codex .codex-body')?.textContent ?? '';
      check('the journal quotes the forge\'s own reinforcement price', example.includes(`${goldOnlyCost(reinforceCost(sample as never)!.cost)} gold`), example.slice(example.indexOf('A worked example'), example.indexOf('A worked example') + 120));
      g.codexUI.open('catalogue');
      await wait(60);
      const cards = document.querySelectorAll('#codex .cx-shape').length;
      check('the catalogue lists every shape and unique', cards >= 37 + 22 + 3, String(cards));
      const findBox = document.querySelector<HTMLInputElement>('#codex .cx-find');
      if (findBox) {
        findBox.value = 'poison';
        findBox.dispatchEvent(new Event('input'));
        await wait(30);
        const shown = [...document.querySelectorAll<HTMLElement>('#codex [data-find]')].filter((e) => !e.hidden).length;
        check('the catalogue search narrows the cards', shown > 0 && shown < cards, String(shown));
      }
      g.codexUI.close();
      p.gold = goldBefore;
    }

    // ---- THE MARKET WARD (it.84): two districts, one road, the vendors, the board, the gateways ---
    {
      if (g.floor !== 0) {
        await g.travel(0);
        await until(() => game() && game().floor === 0, 8000);
        g = game();
        await fadeClear();
      }
      const p = g.player;
      const { auditTownLayout, WARD_Y } = await import('@/town/TownMap');
      const { itemDef } = await import('@/items/instance');
      const layout = g.town.layout;
      const audit = auditTownLayout(layout);
      check('the town layout audit is clean', audit.unreachable.length === 0 && audit.missing.length === 0, JSON.stringify({ u: audit.unreachable.length, m: audit.missing }));
      check('the town has two districts', layout.districts.length === 2 && layout.map.height > WARD_Y + 20, String(layout.map.height));
      // A road from the old quarter to the plaza: a 4-connected walk exists.
      const W = layout.map.width;
      const walk = (fx: number, fy: number, tx: number, ty: number): boolean => {
        const seen = new Uint8Array(W * layout.map.height);
        const stack = [fy * W + fx];
        seen[stack[0]] = 1;
        while (stack.length) {
          const i = stack.pop()!;
          const x = i % W;
          const y = (i - x) / W;
          if (x === tx && y === ty) return true;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= layout.map.height) continue;
            const j = ny * W + nx;
            if (seen[j] || !g.scene.isWalkable(nx, ny)) continue;
            seen[j] = 1;
            stack.push(j);
          }
        }
        return false;
      };
      check('the south road joins the plaza', walk(30, 30, 31, 72));
      check('the gateways stand on blocked tiles', layout.gateways.every((gw: { x: number; y: number }) => !g.scene.isWalkable(gw.x, gw.y)));
      check('every ward prop keeps its footprint solid', layout.props.filter((pr: { kind: string; w?: number; x: number; y: number }) => ['guildhall', 'statue', 'bench', 'cart', 'lamp', 'barricade', 'dummy'].includes(pr.kind)).every((pr: { x: number; y: number }) => !g.scene.isWalkable(pr.x, pr.y)));
      // The zone chip follows the hero.
      p.pos.x = 31.5;
      p.pos.y = 72.5;
      g.lighting.updateVisibility(31, 72);
      g.loop.step(3);
      await wait(200);
      check('the zone chip reads the Market Ward on the plaza', document.getElementById('zone-label')?.textContent === 'THE MARKET WARD', document.getElementById('zone-label')?.textContent ?? '');
      // The vendors sell what the old quarter does not.
      g.shopUI.open('jeweler');
      await wait(60);
      check('the jeweler opens and fits', !!document.querySelector('#shop-panel.open') && inside(document.getElementById('shop-panel')) && /JEWELER/.test(document.querySelector('#shop-panel h3')?.textContent ?? ''));
      check('the jeweler sells rings and amulets only', g.townSystem.stockJewel.length >= 3 && g.townSystem.stockJewel.every((id: string) => itemDef(id)?.slot === 'ring'), g.townSystem.stockJewel.join());
      check('the scribe sells recipe scrolls', g.townSystem.stockScribe.some((id: string) => id.startsWith('recipe_')), g.townSystem.stockScribe.join());
      check('the bowyer sells bows, wands, staves and polearms', g.townSystem.stockBowyer.length >= 3 && g.townSystem.stockBowyer.every((id: string) => ['bow', 'wand', 'polearm'].includes(itemDef(id)?.weaponKind ?? '')), g.townSystem.stockBowyer.join());
      const gold0 = p.gold;
      p.gold = Math.max(p.gold, 5000);
      const first = g.townSystem.stockJewel[0];
      g.queue.enqueue({ type: 'BUY', playerId: 0, index: 0, vendor: 'jeweler' });
      g.loop.step(2);
      check('a purchase at the jeweler lands in the pack', p.backpack.includes(first), first);
      p.gold = gold0;
      g.shopUI.close();
      // The bounty board opens, fits, closes on its cross.
      g.noticeUI.open();
      await wait(80);
      check('the bounty board opens and fits', !!document.querySelector('#notice-board.open') && inside(document.getElementById('notice-board')) && document.querySelectorAll('#notice-board .nb-card').length >= 3);
      document.querySelector<HTMLElement>('#notice-board [data-close]')?.click();
      await wait(60);
      check('the bounty board closes on its cross', !document.querySelector('#notice-board.open'));
      // A gateway says the way is shut.
      const south = layout.gateways[0];
      p.pos.x = south.x + 0.5;
      p.pos.y = south.y - 1.5;
      g.lighting.updateVisibility(south.x, south.y - 2);
      g.loop.step(3);
      await wait(60);
      g.queue.enqueue({ type: 'PICKUP_NEAREST', playerId: 0 });
      g.loop.step(2);
      await wait(400);
      check('a gateway tells the hero the road is not open', /not open yet/i.test(document.getElementById('hint-banner')?.textContent ?? ''), document.getElementById('hint-banner')?.textContent ?? '');
      p.pos.x = 30.5;
      p.pos.y = 30.5;
      g.lighting.updateVisibility(30, 30);
      g.loop.step(3);
      await wait(200);
      check('the zone chip reads the Old Quarter on the square', document.getElementById('zone-label')?.textContent === 'THE OLD QUARTER', document.getElementById('zone-label')?.textContent ?? '');
    }

    // ---- PLATES ON APPROACH (it.84): a foe's name, level and life show before the first blow ---
    {
      // An uncleared floor: depth I was emptied earlier in this run.
      await g.travel(7);
      await until(() => game() && game().floor === 7, 8000);
      g = game();
      await fadeClear();
      const p = g.player;
      type FoeShape = { pos: { x: number; y: number }; hp: number; hpMax: number; healthBar?: { visible: boolean }; levelText?: { text: string; visible: boolean } };
      const box: { f: FoeShape | null } = { f: null };
      g.state.forEach((e: { constructor: { name: string }; hp: number }) => {
        if (!box.f && e.constructor.name === 'Enemy' && e.hp > 0 && (e as unknown as { spawned?: boolean }).spawned !== false) box.f = e as unknown as FoeShape;
      });
      if (box.f) {
        const f = box.f;
        f.pos.x = p.pos.x + 2;
        f.pos.y = p.pos.y;
        g.loop.step(4);
        check('a foe near the hero shows its plate before any blow', f.hp === f.hpMax && !!f.healthBar?.visible && !!f.levelText?.visible, `${f.healthBar?.visible} ${f.levelText?.text}`);
        check('the plate names the foe and its level', /Lv \d+/.test(f.levelText?.text ?? ''), f.levelText?.text);
        f.pos.x = p.pos.x + 20;
        f.pos.y = p.pos.y + 20;
        g.loop.step(4);
        check('the plate hides again when the hero walks away', !f.healthBar?.visible);
      } else check('a foe stands on depth VII for the plate test', false);
      check('the zone chip reads the depth below', /DEPTH VII/.test(document.getElementById('zone-label')?.textContent ?? ''), document.getElementById('zone-label')?.textContent ?? '');
      await g.travel(0);
      await until(() => game() && game().floor === 0, 8000);
      g = game();
      await fadeClear();
    }

    // ---- THE FOREST AND THE QUARRY (it.85): the zoom, the CRT, the roads, the gates and keys, the way home ---
    {
      if (g.floor !== 0) {
        await g.travel(0);
        await until(() => game() && game().floor === 0, 8000);
        g = game();
        await fadeClear();
      }
      check('the crypt opens half again closer', Math.abs(g.camera.currentZoom / (g.camera.layoutBias ?? 1) - 1.5) < 0.01 || Math.abs(g.camera.currentZoom - 1.5) < 0.2, String(g.camera.currentZoom));
      // THE CRT: the switch on the settings sheet adds the pass and takes it away.
      const app = (window as unknown as { __app: { stage: { filters: Array<{ constructor: { name: string } }> | null } } }).__app;
      key('KeyO');
      await wait(60);
      document.querySelector<HTMLElement>('#settings-panel [data-tab=visuals]')?.click();
      await wait(40);
      const crtBox = document.querySelector<HTMLInputElement>('#settings-panel input[data-visual=crt]');
      if (crtBox && !crtBox.checked) crtBox.click();
      await wait(60);
      check('the CRT switch adds the tube pass', !!app.stage.filters?.some((f) => f.constructor.name === 'CrtFilter'));
      crtBox?.click();
      await wait(40);
      check('the CRT switch takes the tube pass away', !app.stage.filters?.some((f) => f.constructor.name === 'CrtFilter'));
      key('KeyO');
      await wait(40);
      // THE ROADS STAY OPEN: no clutter on a street tile.
      const L = g.town.layout;
      const W = L.map.width;
      const clutter = ['torch', 'lamp', 'barrel', 'crates', 'bench', 'cart', 'jar', 'box', 'table', 'trashbox', 'bigtree', 'pine', 'deadtree', 'tree', 'rock', 'column', 'banner', 'wood_pile', 'barrels_stacked', 'crates_wood'];
      const onRoad = L.props.filter((pr: { kind: string; x: number; y: number }) => clutter.includes(pr.kind) && L.road[pr.y * W + pr.x]);
      check('no clutter stands in a street', onRoad.length === 0, onRoad.map((pr: { kind: string; x: number; y: number }) => `${pr.kind}@${pr.x},${pr.y}`).join(' '));
      check('the eastern road leads to the forest', g.town.interactables.some((i: { kind: string; dest?: string }) => i.kind === 'gateway' && i.dest === 'forest'));
      // THE DARK FOREST.
      await g.travel(101);
      await until(() => game() && game().floor === 101, 10000);
      g = game();
      await fadeClear();
      check('the forest stands east of the ward', g.floor === 101 && document.getElementById('zone-label')?.textContent === 'THE DARK FOREST');
      check('the forest has the road to town and the quarry mouth', g.town.interactables.some((i: { kind: string }) => i.kind === 'townroad') && g.town.interactables.some((i: { kind: string }) => i.kind === 'quarry'));
      const forestKinds = new Set<string>();
      g.state.forEach((e: { constructor: { name: string }; hp: number; def?: { kind: string }; spawned?: boolean }) => {
        if (e.constructor.name === 'Enemy' && e.hp > 0 && e.spawned !== false && e.def) forestKinds.add(e.def.kind);
      });
      check('wolves and poachers hunt the forest', ['wolf', 'poacher', 'spider', 'orc'].some((k) => forestKinds.has(k)), [...forestKinds].join());
      // THE QUARRY MINES.
      await g.travel(102);
      await until(() => game() && game().floor === 102, 12000);
      g = game();
      await fadeClear();
      const m = g.mines;
      const D = g.dungeon;
      check('the quarry is one floor, three to five crypts long', !!m && D.width * D.height >= 3 * 44 * 44 && D.width * D.height <= 6 * 44 * 44, `${D.width}x${D.height}`);
      check('the quarry has locked gates and their keys', !!m && m.doors.length >= 2 && m.keys.length === m.doors.length, `${m?.doors.length} gates, ${m?.keys.length} keys`);
      check('every gate is shut and solid', m.doors.every((d: { tiles: Array<{ x: number; y: number }> }) => d.tiles.every((t: { x: number; y: number }) => !g.scene.isWalkable(t.x, t.y))));
      check('every key lies on the floor', m.keys.every((k: { uid: number }) => !!g.loot.getItem(k.uid)));
      check('the keeper waits in the deepest hall', !!g.boss && g.boss.def.kind === 'hydra' && g.boss.hp > 0);
      const k1 = m.keys[0];
      const d1 = m.doors[0];
      check('a key is hidden by the fog until its room is explored', g.lighting.getState(k1.x, k1.y) === 0 && g.lighting.getState(d1.x, d1.y) === 0);
      g.player.pos.x = k1.x + 0.5;
      g.player.pos.y = k1.y + 1.5;
      g.lighting.updateVisibility(k1.x, k1.y + 1);
      g.loop.step(2);
      check('the fog lifts from the key once the hero arrives', g.lighting.getState(k1.x, k1.y) > 0);
      // A gate without the key stays shut; with the key it opens, every bar of it.
      const t0 = d1.tiles[0];
      const beside = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => ({ x: t0.x + dx, y: t0.y + dy })).find((q) => g.scene.isWalkable(q.x, q.y))!;
      g.player.pos.x = beside.x + 0.5;
      g.player.pos.y = beside.y + 0.5;
      g.lighting.updateVisibility(beside.x, beside.y);
      g.loop.step(4);
      check('a gate stays shut without its key', !d1.open && d1.tiles.every((t: { x: number; y: number }) => !g.scene.isWalkable(t.x, t.y)));
      g.player.addItem(`quarry_key_${d1.key}`);
      g.loop.step(4);
      check('the key opens every bar of its gate and is spent', d1.open && d1.tiles.every((t: { x: number; y: number }) => g.scene.isWalkable(t.x, t.y)) && !g.player.backpack.includes(`quarry_key_${d1.key}`));
      // The keeper falls: the way home rises where it stood.
      g.player.pos.x = m.boss.x + 0.5;
      g.player.pos.y = m.boss.y + 2.5;
      g.lighting.updateVisibility(m.boss.x, m.boss.y + 2);
      g.boss.hp = 0;
      g.loop.step(5);
      const after = game(); // The handle is a snapshot: read the world again.
      check("the keeper's fall opens the way home", after.arenaCleared && !!after.victoryPortal && after.victoryPortal.x === m.boss.x && after.victoryPortal.y === m.boss.y, JSON.stringify(after.victoryPortal));
      g.player.pos.x = m.boss.x + 3;
      g.player.pos.y = m.boss.y + 0.5;
      g.loop.step(3);
      g.player.pos.x = m.boss.x + 0.5;
      g.player.pos.y = m.boss.y + 0.5;
      g.loop.step(3);
      await until(() => game() && game().floor === 0, 10000);
      g = game();
      await fadeClear();
      check('the teleporter brings the hero home', g.floor === 0);
      check('the quarry remembers its opened gate', !!g.floors[102] && (g.floors[102].doorsOpened ?? []).includes(1) && g.floors[102].arenaCleared === true, JSON.stringify(g.floors[102] && { d: g.floors[102].doorsOpened, c: g.floors[102].arenaCleared }));
    }

    // ---- THE FOREST ERRAND (it.87): the gatekeeper, the errand, the clearing, the thanks, the safe road ---
    {
      if (g.floor !== 0) {
        await g.travel(0);
        await until(() => game() && game().floor === 0, 8000);
        g = game();
        await fadeClear();
      }
      const p = g.player;
      g.quests.forest = 'new';
      const keeper = g.town.layout.gatekeeper;
      check('the gatekeeper stands at the eastern road', !!keeper && !g.scene.isWalkable(keeper.x, keeper.y));
      p.pos.x = 50.5;
      p.pos.y = 72.5;
      g.lighting.updateVisibility(50, 72);
      g.queue.enqueue({ type: 'PICKUP_NEAREST', playerId: 0 });
      g.loop.step(3);
      await wait(80);
      check('E at the shut road opens the gatekeeper\'s word', !!document.querySelector('#dialogue-panel.open') && /clear the forest/i.test(document.querySelector('#dialogue-panel')?.textContent ?? ''));
      check('the dialogue fits the screen', inside(document.getElementById('dialogue-panel')));
      document.querySelector<HTMLElement>('#dialogue-panel [data-choice=accept]')?.click();
      await until(() => game() && game().floor === 101, 12000);
      g = game();
      await fadeClear();
      check('taking the errand walks the hero into the forest', g.floor === 101 && g.quests.forest === 'active');
      let alive = 0;
      g.enemies.forEachActive((e: { hp: number }) => {
        if (e.hp > 0) {
          alive++;
          e.hp = 0;
        }
      });
      check('the forest had beasts to clear', alive > 0, String(alive));
      const gold0 = p.gold;
      g.loop.step(125);
      await until(() => game() && game().floor === 0, 12000);
      g = game();
      await fadeClear();
      await wait(120);
      check('the last beast\'s fall sends the hero back to the gatekeeper', g.floor === 0 && g.quests.forest === 'done' && Math.hypot(p.pos.x - (keeper!.x + 0.5), p.pos.y - (keeper!.y + 0.5)) < 3, `${g.floor} ${g.quests.forest} ${p.pos.x},${p.pos.y}`);
      check('the gatekeeper pays a hundred gold', p.gold === gold0 + 100, `${gold0} → ${p.gold}`);
      check('the thanks are on the table', !!document.querySelector('#dialogue-panel.open') && /hundred gold/i.test(document.querySelector('#dialogue-panel')?.textContent ?? ''));
      document.querySelector<HTMLElement>('#dialogue-panel [data-choice=ok]')?.click();
      await wait(40);
      await g.travel(101);
      await until(() => game() && game().floor === 101, 12000);
      g = game();
      await fadeClear();
      let hostile = 0;
      g.enemies.forEachActive((e: { hp: number }) => {
        if (e.hp > 0) hostile++;
      });
      check('the cleared forest is a safe road with folk and sentries', hostile === 0 && g.town.layout.guards.length === 2, String(hostile));
      await g.travel(0);
      await until(() => game() && game().floor === 0, 8000);
      g = game();
      await fadeClear();
      // The key beacon and the mirrored gates.
      await g.travel(102);
      await until(() => game() && game().floor === 102, 12000);
      g = game();
      await fadeClear();
      const k = g.mines.keys[0];
      const item = g.loot.getItem(k.uid);
      check('a quarry key lies small on the floor with a beacon above the walls', !!item && item.glyph.scale.x <= 0.31 && !!item.beacon && !item.beacon.visible);
      g.player.pos.x = k.x + 0.5;
      g.player.pos.y = k.y + 1.5;
      g.lighting.updateVisibility(k.x, k.y + 1);
      g.loot.updateBeacons((x: number, y: number) => g.lighting.isVisible(x, y), 0);
      check('the beacon lights once the fog lifts', !!item?.beacon?.visible);
      check('every gate knows its corridor\'s way', g.mines.doors.every((d: { axis: string }) => d.axis === 'x' || d.axis === 'y'));
      await g.travel(0);
      await until(() => game() && game().floor === 0, 8000);
      g = game();
      await fadeClear();
    }

    // ---- the item card (it.76): a pack weapon beside the worn one -----------------------------
    {
      g.player.addItem('soldier_blade');
      key('KeyI');
      await wait(50);
      const cell = document.querySelector<HTMLElement>('#inv-panel button[data-item=soldier_blade]');
      const r = cell?.getBoundingClientRect();
      cell?.dispatchEvent(new MouseEvent('mouseenter', { clientX: (r?.left ?? 0) + 10, clientY: (r?.top ?? 0) + 10 }));
      const tip = document.getElementById('inv-tooltip');
      const shown = !!tip && tip.classList.contains('show') && !!tip.querySelector('.tip-cmp');
      check('item card compares to the worn piece', shown && !!tip?.querySelector('.tip-verdict'), tip?.innerText.slice(0, 80));
      check('item card sits above the window', !!tip && parseInt(getComputedStyle(tip).zIndex, 10) > 40, tip ? getComputedStyle(tip).zIndex : 'none');
      cell?.dispatchEvent(new MouseEvent('mouseleave'));
      key('KeyI');
      await wait(50);
    }

    // ---- DEEP (it.75): gear, the economy, gold on the floor, the menus, touch --------------
    if (opts.deep) {
      // Gear: the starter kit carries a spare weapon in the pack.
      const spareIdx = g.player.backpack.findIndex((id: string) => /bow|sword|wand|katana/.test(id));
      if (spareIdx >= 0) {
        const spare = g.player.backpack[spareIdx];
        const heldBefore = g.player.getEquipped('mainHand');
        g.queue.enqueue({ type: 'EQUIP', playerId: 0, backpackIndex: spareIdx });
        g.loop.step(2);
        check('equip from the pack', g.player.getEquipped('mainHand') === spare, `${heldBefore} -> ${g.player.getEquipped('mainHand')}`);
        g.queue.enqueue({ type: 'UNEQUIP', playerId: 0, slot: 'mainHand' });
        g.loop.step(2);
        check('unequip returns to the pack', g.player.backpack.includes(spare) && !g.player.getEquipped('mainHand'));
        g.queue.enqueue({ type: 'EQUIP', playerId: 0, backpackIndex: g.player.backpack.indexOf(heldBefore) });
        g.loop.step(2);
      }
      // The economy: sell and buy back in town.
      if (g.floor !== 0) {
        await g.travel(0);
        await until(() => game() && game().floor === 0, 8000);
        g = game();
      }
      const sellIdx = g.player.backpack.findIndex((id: string) => id !== 'health_potion');
      if (sellIdx >= 0) {
        const goldS = g.player.gold;
        const item = g.player.backpack[sellIdx];
        g.shopUI.open('armorer');
        g.queue.enqueue({ type: 'SELL', playerId: 0, backpackIndex: sellIdx });
        g.loop.step(2);
        check('a sale pays gold', g.player.gold > goldS && !g.player.backpack.includes(item), `${goldS} -> ${g.player.gold}`);
        g.queue.enqueue({ type: 'BUYBACK', playerId: 0, index: 0 });
        g.loop.step(2);
        check('buyback returns the item', g.player.backpack.includes(item));
        g.shopUI.close();
      }
      // Gold on the floor: stand on a pile.
      await g.travel(1);
      await until(() => game() && game().floor === 1, 8000);
      g = game();
      g.loop.step(5);
      const pile = (g.goldPiles as Any[]).find((p) => !p.taken);
      if (pile) {
        const goldP = g.player.gold;
        g.player.warpTo(pile.x + 0.5, pile.y + 0.5);
        g.loop.step(30);
        check('a gold pile is picked up by standing on it', g.player.gold > goldP && pile.taken, `${goldP} -> ${g.player.gold}`);
      }
      // Touch: a forced stick steers the hero. The controls are blocked while
      // a fade's tail is still up (`transitioning`), so let it clear first.
      await fadeClear();
      await wait(200);
      W.__layout.touchControls.setForced(true);
      const zone = document.querySelector('.vj-zone') as HTMLElement;
      if (zone) {
        const zb = zone.getBoundingClientRect();
        const cx = zb.left + zb.width / 2;
        const cy = zb.top + zb.height / 2;
        const ev = (t: string, x: number, y: number): void => {
          zone.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
        };
        // Four headings: a wall may stand on any one side of the hero.
        let moved = 0;
        for (const [dx, dy] of [[40, 40], [-40, -40], [40, -40], [-40, 40]]) {
          const px = g.player.pos.x;
          const py = g.player.pos.y;
          ev('pointerdown', cx, cy);
          ev('pointermove', cx + dx, cy + dy);
          g.loop.step(30);
          ev('pointerup', cx, cy);
          g.loop.step(2);
          moved = Math.max(moved, Math.hypot(g.player.pos.x - px, g.player.pos.y - py));
          if (moved > 0.05) break;
        }
        check('the thumb stick moves the hero', moved > 0.05, `${moved.toFixed(2)}`);
      }
      W.__layout.touchControls.setForced(null);
      // The menus: credits, the exit modal, the co-op lobby, the class screen.
      W.__menu.exitToMenu();
      check('exit to the title', await until(() => !game() && !!document.querySelector('#main-menu.show'), 6000));
      const mm = (sel: string): HTMLElement | null => document.querySelector(sel);
      mm('#main-menu [data-menu=credits]')?.click();
      await wait(80);
      check('credits open', !!document.querySelector('#credits.show'));
      key('Escape');
      await wait(80);
      check('credits close on Escape', !document.querySelector('#credits.show'));
      mm('#main-menu [data-menu=exit]')?.click();
      await wait(80);
      check('exit modal opens', !!document.querySelector('#exit-modal.open'));
      key('Escape');
      await wait(80);
      check('exit modal closes on Escape', !document.querySelector('#exit-modal.open'));
      mm('#main-menu [data-menu=coop]')?.click();
      await wait(120);
      check('co-op lobby opens', !!document.querySelector('#coop-panel.show'));
      mm('#coop-panel [data-back]')?.click();
      await wait(120);
      check('co-op lobby closes and the title returns', !document.querySelector('#coop-panel.show') && !!document.querySelector('#main-menu.show'));
      mm('#main-menu [data-menu=play]')?.click();
      await wait(120);
      check('class screen opens', !!document.querySelector('#class-select.show'));
      mm('#class-select .class-card[data-class=rogue]')?.click();
      await wait(60);
      const confirm = mm('#class-select .cs-confirm') as HTMLButtonElement | null;
      check('picking a class enables CONFIRM', !!confirm && !confirm.disabled);
      mm('#class-select .cs-back')?.click();
      await wait(120);
      check('class screen BACK returns to the title', !document.querySelector('#class-select.show') && !!document.querySelector('#main-menu.show'));
      // Continue from the title lands the saved hero back in the run.
      mm('#main-menu [data-menu=continue]')?.click();
      check('CONTINUE resumes the run', await until(() => !!game(), 20000));
      g = game();
      if (g) g.loop.step(5);
    }

    // ---- settings toggles persist -------------------------------------------------------------
    key('KeyO');
    const sp = document.getElementById('settings-panel')!;
    (sp.querySelector('[data-tab=visuals]') as HTMLElement).click();
    for (const k of ['shake', 'gore', 'flash', 'particles', 'haptics', 'grade']) {
      const t = sp.querySelector<HTMLInputElement>(`input[data-visual=${k}]`);
      if (!t) {
        fail.push(`settings toggle ${k} missing`);
        continue;
      }
      const before = t.checked;
      t.click();
      const stored = JSON.parse(localStorage.getItem('iso-arpg-visuals') ?? '{}');
      check(`toggle ${k} persists`, stored[k] === !before);
      t.click();
    }
    key('KeyO');

    // ---- the device matrix in this state ------------------------------------------------
    await import('./qa66');
    const m = W.__qa66(true);
    check('device matrix', m.failed === 0, `${m.failed} failed: ${JSON.stringify(m.fails.slice(0, 2))}`);
  } catch (err) {
    fail.push(`exception: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  } finally {
    console.error = origErr;
    window.removeEventListener('unhandledrejection', onRej);
  }
  return { seed, cls, pass, fail, errors, ms: Math.round(performance.now() - t0) };
}

W.__qa75 = runQa;
