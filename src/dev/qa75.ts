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
    check('system bar has 7 entries', document.querySelectorAll('#system-bar .ds-icon-btn').length === 7);
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
