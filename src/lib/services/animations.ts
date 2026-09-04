/**
 * The canvas particle systems for the public display, ported from src/js/modules/animations.js.
 *
 * They live in a plain `.ts` module rather than inside the two components on purpose: runes are
 * not available here at all, so the per-frame particle churn *cannot* be made reactive. A
 * thousand-element array declared `$state` and mutated sixty times a second would push every
 * write through the reactivity graph and destroy the frame rate — the arrays below are plain
 * `let`, and the module boundary is what guarantees they stay that way. The components own the
 * lifecycle (mount, teardown, when to fire); this module owns the pixels.
 *
 * Two fixes over the module this replaces:
 *   - `startSwirlAnimation` built its particles, registered a resize listener and then never
 *     called `animate()`, so the swirl visual rendered nothing at all. It runs here.
 *   - Every loop and every resize listener is owned by a handle the caller must destroy. The old
 *     code kept one module-global frame id, so starting a second animation orphaned the first
 *     and left it running for the life of the page.
 */

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The confetti's non-theme accent, and the colour of the coins. Not a theme colour. */
const GOLD: Rgb = { r: 255, g: 215, b: 0 };
const GOLD_RIM = '#ffa500';
const GOLD_SHINE = '#ffff99';

/** Used only when a custom property is missing or unparseable — the shipped default theme. */
const FALLBACK_PRIMARY: Rgb = { r: 99, g: 102, b: 241 };
const FALLBACK_SECONDARY: Rgb = { r: 139, g: 92, b: 246 };
const FALLBACK_SELECTION: Rgb = { r: 16, g: 185, b: 129 };

const HEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

export function hexToRgb(hex: string, fallback: Rgb): Rgb {
  const match = HEX.exec(hex.trim());
  const r = match?.[1];
  const g = match?.[2];
  const b = match?.[3];
  if (!r || !g || !b) return fallback;
  return { r: Number.parseInt(r, 16), g: Number.parseInt(g, 16), b: Number.parseInt(b, 16) };
}

export interface ThemeColours {
  primary: Rgb;
  secondary: Rgb;
  selection: Rgb;
}

/**
 * Read the live theme colours off `:root`.
 *
 * `settings.applyTheme()` is what writes them there, so this stays correct for a custom theme
 * without the animations having to know the settings store exists.
 */
export function readThemeColours(): ThemeColours {
  const styles = getComputedStyle(document.documentElement);
  return {
    primary: hexToRgb(styles.getPropertyValue('--primary-color'), FALLBACK_PRIMARY),
    secondary: hexToRgb(styles.getPropertyValue('--secondary-color'), FALLBACK_SECONDARY),
    selection: hexToRgb(styles.getPropertyValue('--selection-color'), FALLBACK_SELECTION)
  };
}

function rgba(colour: Rgb, alpha: number): string {
  return `rgba(${colour.r}, ${colour.g}, ${colour.b}, ${alpha})`;
}

function pick<T>(items: readonly T[], fallback: T): T {
  return items[Math.floor(Math.random() * items.length)] ?? fallback;
}

// ---------------------------------------------------------------------------------------------
// Surface — one canvas, one frame loop, one resize listener
// ---------------------------------------------------------------------------------------------

/**
 * A canvas plus the two things every effect below needs and the old code kept forgetting to
 * clean up: the animation frame and the resize listener.
 */
class Surface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  #frame: number | null = null;
  readonly #handleResize = () => this.fit();

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.fit();
    window.addEventListener('resize', this.#handleResize);
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /**
   * Size the backing store to the viewport.
   *
   * Deliberately not scaled by `devicePixelRatio`: the CSS gives these canvases `width: auto`,
   * so the element renders at its intrinsic size and a scaled backing store would render the
   * effect larger than the screen instead of sharper.
   */
  fit(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /** `step` returns false when there is nothing left to draw, which stops the loop. */
  run(step: () => boolean): void {
    if (this.#frame !== null) return;
    const tick = () => {
      if (!step()) {
        this.#frame = null;
        return;
      }
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.#frame === null) return;
    cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  destroy(): void {
    this.stop();
    this.clear();
    window.removeEventListener('resize', this.#handleResize);
  }
}

function surfaceFor(canvas: HTMLCanvasElement): Surface | null {
  const ctx = canvas.getContext('2d');
  return ctx ? new Surface(canvas, ctx) : null;
}

// ---------------------------------------------------------------------------------------------
// Delay visuals
// ---------------------------------------------------------------------------------------------

/** The four `delayVisualType` values that draw on a canvas. `countdown` and `none` do not. */
export type DelayAnimationType = 'animation' | 'swirl-animation' | 'christmas-snow' | 'time-machine';

export interface DelayAnimation {
  destroy(): void;
}

export function startDelayAnimation(
  canvas: HTMLCanvasElement,
  type: DelayAnimationType
): DelayAnimation | null {
  const surface = surfaceFor(canvas);
  if (!surface) return null;

  const colours = readThemeColours();
  switch (type) {
    case 'animation':
      runDrifting(surface, colours);
      break;
    case 'swirl-animation':
      runSwirl(surface, colours);
      break;
    case 'christmas-snow':
      runChristmasSnow(surface);
      break;
    case 'time-machine':
      runTimeMachine(surface, colours);
      break;
  }

  return { destroy: () => surface.destroy() };
}

// ---- 'animation': drifting dots that bounce off the edges -------------------------------------

interface Dot {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  colour: Rgb;
  opacity: number;
}

function runDrifting(surface: Surface, colours: ThemeColours): void {
  // Plain array: see the module header.
  const dots: Dot[] = [];
  for (let index = 0; index < 50; index++) {
    dots.push({
      x: Math.random() * surface.width,
      y: Math.random() * surface.height,
      radius: Math.random() * 2 + 1,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      colour: Math.random() > 0.5 ? colours.primary : colours.secondary,
      opacity: Math.random() * 0.5 + 0.5
    });
  }

  surface.run(() => {
    const { ctx } = surface;
    surface.clear();

    for (const dot of dots) {
      dot.x += dot.vx;
      dot.y += dot.vy;
      if (dot.x < 0 || dot.x > surface.width) dot.vx *= -1;
      if (dot.y < 0 || dot.y > surface.height) dot.vy *= -1;

      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.radius, 0, TAU);
      ctx.fillStyle = rgba(dot.colour, dot.opacity);
      ctx.fill();
    }
    return true;
  });
}

// ---- 'swirl-animation': a breeze of trailing particles with periodic bursts --------------------

interface SwirlParticle {
  x: number;
  y: number;
  radius: number;
  life: number;
  angle: number;
  speed: number;
  colour: Rgb;
  trail: number;
}

/**
 * The emitter adds seven particles a frame and each lives 100–200 frames, so the population
 * settles around a thousand. The cap is a guard, not a look: a tab throttled and then resumed
 * can queue a burst of frames, and an unbounded array is what turns that into a stall.
 */
const SWIRL_MAX_PARTICLES = 1400;

function makeSwirlParticle(surface: Surface, colours: ThemeColours, star: boolean): SwirlParticle {
  return {
    x: surface.width / 2,
    y: surface.height / 2,
    radius: star ? Math.random() * 3 + 2 : Math.random() * 1 + 0.5,
    life: Math.random() * 100 + 100,
    angle: Math.random() * TAU,
    speed: Math.random() * 4 + 2,
    colour: Math.random() > 0.5 ? colours.primary : colours.secondary,
    trail: Math.random() * 20 + 10
  };
}

function runSwirl(surface: Surface, colours: ThemeColours): void {
  const particles: SwirlParticle[] = [];
  let frame = 0;

  surface.run(() => {
    const { ctx } = surface;

    // A translucent wash rather than a clear, which is what leaves the comet trails behind.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, surface.width, surface.height);

    if (particles.length < SWIRL_MAX_PARTICLES) {
      for (let index = 0; index < 5; index++) {
        particles.push(makeSwirlParticle(surface, colours, false));
      }
      for (let index = 0; index < 2; index++) {
        particles.push(makeSwirlParticle(surface, colours, true));
      }
    }

    frame++;
    if (frame % 30 === 0 && particles.length < SWIRL_MAX_PARTICLES) {
      const burstX = Math.random() * surface.width;
      const burstY = Math.random() * surface.height;
      for (let index = 0; index < 20; index++) {
        const particle = makeSwirlParticle(surface, colours, true);
        particle.x = burstX;
        particle.y = burstY;
        particle.speed = Math.random() * 6 + 3;
        particle.angle += (index - 10) * 0.1;
        particles.push(particle);
      }
    }

    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index];
      if (!particle) continue;

      particle.x += Math.cos(particle.angle) * particle.speed;
      particle.y += Math.sin(particle.angle) * particle.speed;
      particle.angle += (Math.random() - 0.5) * 0.3;
      particle.speed *= 0.99;
      particle.life--;

      const opacity = Math.min(1, Math.max(0, particle.life / 100));

      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, TAU);
      ctx.fillStyle = rgba(particle.colour, opacity);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(
        particle.x - Math.cos(particle.angle) * particle.trail,
        particle.y - Math.sin(particle.angle) * particle.trail
      );
      ctx.strokeStyle = rgba(particle.colour, opacity * 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();

      if (particle.life <= 0) particles.splice(index, 1);
    }

    return true;
  });
}

// ---- 'christmas-snow': night sky, twinkling stars, the Star of Bethlehem, falling snow --------

interface Snowflake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  opacity: number;
  wobble: number;
  wobbleSpeed: number;
}

interface TwinkleStar {
  x: number;
  y: number;
  size: number;
  colour: Rgb;
  twinkleSpeed: number;
  twinklePhase: number;
  baseOpacity: number;
}

const SNOW_WHITE: Rgb = { r: 255, g: 255, b: 255 };
const STAR_COLOURS: readonly Rgb[] = [
  { r: 255, g: 215, b: 0 },
  { r: 255, g: 255, b: 200 },
  { r: 200, g: 220, b: 255 }
];

function resetSnowflake(flake: Snowflake, surface: Surface): void {
  flake.x = Math.random() * surface.width;
  flake.y = -10;
  flake.radius = Math.random() * 3 + 1;
  flake.speed = Math.random() * 2 + 1;
  flake.drift = (Math.random() - 0.5) * 0.5;
  flake.opacity = Math.random() * 0.5 + 0.5;
  flake.wobble = Math.random() * TAU;
  flake.wobbleSpeed = Math.random() * 0.02 + 0.01;
}

function runChristmasSnow(surface: Surface): void {
  const flakes: Snowflake[] = [];
  for (let index = 0; index < 100; index++) {
    const flake: Snowflake = {
      x: 0,
      y: 0,
      radius: 0,
      speed: 0,
      drift: 0,
      opacity: 0,
      wobble: 0,
      wobbleSpeed: 0
    };
    resetSnowflake(flake, surface);
    // Seed the sky already full, so the first frame is snowing rather than empty.
    flake.y = Math.random() * surface.height;
    flakes.push(flake);
  }

  const stars: TwinkleStar[] = [];
  for (let index = 0; index < 30; index++) {
    stars.push({
      x: Math.random() * surface.width,
      y: Math.random() * surface.height * 0.6,
      size: Math.random() * 2 + 1,
      colour: pick(STAR_COLOURS, SNOW_WHITE),
      twinkleSpeed: Math.random() * 0.05 + 0.02,
      twinklePhase: Math.random() * TAU,
      baseOpacity: Math.random() * 0.5 + 0.3
    });
  }

  let pulsePhase = 0;
  let rayRotation = 0;

  surface.run(() => {
    const { ctx } = surface;

    const sky = ctx.createLinearGradient(0, 0, 0, surface.height);
    sky.addColorStop(0, '#0a1628');
    sky.addColorStop(0.5, '#162d50');
    sky.addColorStop(1, '#1a3a5c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, surface.width, surface.height);

    for (const star of stars) {
      star.twinklePhase += star.twinkleSpeed;
      const opacity = star.baseOpacity * (Math.sin(star.twinklePhase) * 0.4 + 0.6);

      ctx.save();
      ctx.translate(star.x, star.y);

      ctx.beginPath();
      ctx.arc(0, 0, star.size * 3, 0, TAU);
      ctx.fillStyle = rgba(star.colour, opacity * 0.15);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, star.size * 1.5, 0, TAU);
      ctx.fillStyle = rgba(star.colour, opacity * 0.3);
      ctx.fill();

      ctx.fillStyle = rgba(star.colour, opacity);
      ctx.fillRect(-star.size * 0.3, -star.size * 2, star.size * 0.6, star.size * 4);
      ctx.fillRect(-star.size * 2, -star.size * 0.3, star.size * 4, star.size * 0.6);

      ctx.beginPath();
      ctx.arc(0, 0, star.size * 0.8, 0, TAU);
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.fill();
      ctx.restore();
    }

    pulsePhase += 0.03;
    rayRotation += 0.005;
    drawStarOfBethlehem(surface, pulsePhase, rayRotation);

    for (const flake of flakes) {
      flake.y += flake.speed;
      flake.wobble += flake.wobbleSpeed;
      flake.x += flake.drift + Math.sin(flake.wobble) * 0.5;

      if (flake.y > surface.height + 10) resetSnowflake(flake, surface);
      if (flake.x < -10) flake.x = surface.width + 10;
      if (flake.x > surface.width + 10) flake.x = -10;

      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.radius, 0, TAU);
      ctx.fillStyle = rgba(SNOW_WHITE, flake.opacity);
      ctx.fill();

      if (flake.radius > 2) {
        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.radius * 2, 0, TAU);
        ctx.fillStyle = rgba(SNOW_WHITE, flake.opacity * 0.2);
        ctx.fill();
      }
    }

    return true;
  });
}

function drawStarOfBethlehem(surface: Surface, pulsePhase: number, rayRotation: number): void {
  const { ctx } = surface;
  const pulse = Math.sin(pulsePhase) * 0.3 + 0.7;
  const size = 25 * pulse;

  ctx.save();
  ctx.translate(surface.width * 0.75, surface.height * 0.15);

  const outerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 4);
  outerGlow.addColorStop(0, `rgba(255, 248, 220, ${0.4 * pulse})`);
  outerGlow.addColorStop(0.3, `rgba(255, 215, 0, ${0.2 * pulse})`);
  outerGlow.addColorStop(1, 'rgba(255, 215, 0, 0)');
  ctx.beginPath();
  ctx.arc(0, 0, size * 4, 0, TAU);
  ctx.fillStyle = outerGlow;
  ctx.fill();

  ctx.save();
  ctx.rotate(rayRotation);
  for (let index = 0; index < 8; index++) {
    ctx.save();
    ctx.rotate((index * Math.PI) / 4);

    const rayLength = index % 2 === 0 ? size * 3.5 : size * 2.5;
    const rayWidth = index % 2 === 0 ? 3 : 2;

    ctx.beginPath();
    ctx.moveTo(0, -size * 0.5);
    ctx.lineTo(rayWidth, -rayLength);
    ctx.lineTo(0, -rayLength - 5);
    ctx.lineTo(-rayWidth, -rayLength);
    ctx.closePath();

    const rayGradient = ctx.createLinearGradient(0, -size * 0.5, 0, -rayLength);
    rayGradient.addColorStop(0, `rgba(255, 255, 255, ${0.9 * pulse})`);
    rayGradient.addColorStop(0.5, `rgba(255, 248, 200, ${0.6 * pulse})`);
    rayGradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
    ctx.fillStyle = rayGradient;
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  const innerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.5);
  innerGlow.addColorStop(0, `rgba(255, 255, 255, ${0.95 * pulse})`);
  innerGlow.addColorStop(0.4, `rgba(255, 248, 220, ${0.7 * pulse})`);
  innerGlow.addColorStop(1, `rgba(255, 215, 0, ${0.3 * pulse})`);
  ctx.beginPath();
  ctx.arc(0, 0, size * 1.5, 0, TAU);
  ctx.fillStyle = innerGlow;
  ctx.fill();

  ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;

  ctx.beginPath();
  ctx.moveTo(0, -size * 1.8);
  ctx.quadraticCurveTo(size * 0.15, -size * 0.3, size * 0.4, 0);
  ctx.quadraticCurveTo(size * 0.15, size * 0.3, 0, size * 1.8);
  ctx.quadraticCurveTo(-size * 0.15, size * 0.3, -size * 0.4, 0);
  ctx.quadraticCurveTo(-size * 0.15, -size * 0.3, 0, -size * 1.8);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-size * 1.2, 0);
  ctx.quadraticCurveTo(-size * 0.3, -size * 0.12, 0, -size * 0.3);
  ctx.quadraticCurveTo(size * 0.3, -size * 0.12, size * 1.2, 0);
  ctx.quadraticCurveTo(size * 0.3, size * 0.12, 0, size * 0.3);
  ctx.quadraticCurveTo(-size * 0.3, size * 0.12, -size * 1.2, 0);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, size * 0.35, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(-size * 0.1, -size * 0.1, size * 0.12, 0, TAU);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fill();

  ctx.restore();
}

// ---- 'time-machine': a warp tunnel of expanding rings -----------------------------------------

interface TimeRing {
  radius: number;
  maxRadius: number;
  speed: number;
  thickness: number;
  colour: Rgb;
  opacity: number;
  pulseOffset: number;
}

interface EnergyParticle {
  angle: number;
  distance: number;
  speed: number;
  size: number;
  colour: Rgb;
  life: number;
}

function runTimeMachine(surface: Surface, colours: ThemeColours): void {
  const rings: TimeRing[] = [];
  const sparks: EnergyParticle[] = [];
  let time = 0;

  surface.run(() => {
    const { ctx } = surface;
    const centerX = surface.width / 2;
    const centerY = surface.height / 2;
    const reach = Math.max(surface.width, surface.height);
    time++;

    const backdrop = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, reach / 2);
    backdrop.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
    backdrop.addColorStop(0.3, 'rgba(0, 0, 0, 0.95)');
    backdrop.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, surface.width, surface.height);

    // Tunnel grid.
    for (let index = 0; index < 8; index++) {
      const angle = (index * TAU) / 8 + time * 0.02;
      const startX = centerX + Math.cos(angle) * 50;
      const startY = centerY + Math.sin(angle) * 50;
      const endX = centerX + Math.cos(angle) * reach;
      const endY = centerY + Math.sin(angle) * reach;

      const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
      gradient.addColorStop(0, rgba(colours.primary, 0.4));
      gradient.addColorStop(1, rgba(colours.secondary, 0.1));

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (time % 20 === 0) {
      rings.push({
        radius: 0,
        maxRadius: reach,
        speed: 3 + Math.random() * 2,
        thickness: 2 + Math.random() * 3,
        colour: Math.random() > 0.5 ? colours.primary : colours.secondary,
        opacity: 1,
        pulseOffset: Math.random() * TAU
      });
    }

    for (let index = rings.length - 1; index >= 0; index--) {
      const ring = rings[index];
      if (!ring) continue;

      ring.radius += ring.speed;
      ring.opacity = 1 - ring.radius / ring.maxRadius;
      ring.speed *= 1.02;

      const glow = ring.opacity * (Math.sin(time * 0.1 + ring.pulseOffset) * 0.2 + 0.8);

      ctx.beginPath();
      ctx.arc(centerX, centerY, ring.radius, 0, TAU);
      ctx.strokeStyle = rgba(ring.colour, Math.max(0, glow * 0.3));
      ctx.lineWidth = ring.thickness * 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY, ring.radius, 0, TAU);
      ctx.strokeStyle = rgba(ring.colour, Math.max(0, glow));
      ctx.lineWidth = ring.thickness;
      ctx.stroke();

      if (ring.opacity <= 0) rings.splice(index, 1);
    }

    if (time % 3 === 0) {
      sparks.push({
        angle: Math.random() * TAU,
        distance: 20 + Math.random() * 50,
        speed: 2 + Math.random() * 3,
        size: 1 + Math.random() * 2,
        colour: Math.random() > 0.5 ? colours.primary : colours.secondary,
        life: 1
      });
    }

    for (let index = sparks.length - 1; index >= 0; index--) {
      const spark = sparks[index];
      if (!spark) continue;

      spark.distance += spark.speed;
      spark.speed *= 1.05;
      spark.life = Math.max(0, 1 - spark.distance / 800);

      ctx.beginPath();
      ctx.arc(
        centerX + Math.cos(spark.angle) * spark.distance,
        centerY + Math.sin(spark.angle) * spark.distance,
        spark.size,
        0,
        TAU
      );
      ctx.fillStyle = rgba(spark.colour, spark.life);
      ctx.fill();

      if (spark.life <= 0) sparks.splice(index, 1);
    }

    if (time % 60 === 0) {
      ctx.fillStyle = rgba(colours.primary, 0.1);
      ctx.fillRect(0, 0, surface.width, surface.height);
    }

    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Celebration — confetti and gold coins
// ---------------------------------------------------------------------------------------------

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  colour: Rgb;
  rotation: number;
  rotationSpeed: number;
  life: number;
}

interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  life: number;
}

const CONFETTI_LIFE = 200;
const COIN_LIFE = 120;
const CONFETTI_BATCH_MS = 100;

/**
 * An `all-at-once` reveal of a hundred winners asks for a hundred bursts in one frame. The cap
 * keeps the cost of a big draw the same as the cost of a small one; coins die after two seconds,
 * so it only ever bites during that window.
 */
const MAX_COINS = 400;

export interface CelebrationAnimator {
  /** Rain confetti, spawning new pieces for `durationMs`. Existing pieces fall out naturally. */
  confetti(durationMs: number): void;
  /** A burst of gold coins from one point, in viewport coordinates. */
  coins(x: number, y: number): void;
  /** Cancel the loop, drop every particle and wipe the canvas. */
  clear(): void;
  /** `clear()` plus the resize listener. Call from the component's teardown. */
  destroy(): void;
}

export function createCelebrationAnimator(canvas: HTMLCanvasElement): CelebrationAnimator | null {
  // Built here rather than through `surfaceFor` so `surface` is non-nullable for the closures
  // below — TypeScript will not carry a narrowing into a hoisted function declaration.
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const surface = new Surface(canvas, ctx);

  // Plain arrays and a plain timer handle: see the module header. Nothing here is reactive.
  let confettiPieces: ConfettiPiece[] = [];
  let coinPieces: Coin[] = [];
  let spawnTimer: ReturnType<typeof setInterval> | null = null;

  function stopSpawning(): void {
    if (spawnTimer === null) return;
    clearInterval(spawnTimer);
    spawnTimer = null;
  }

  function step(): boolean {
    const { ctx } = surface;
    surface.clear();

    for (let index = confettiPieces.length - 1; index >= 0; index--) {
      const piece = confettiPieces[index];
      if (!piece) continue;

      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.vy += 0.05;
      piece.rotation += piece.rotationSpeed;
      piece.vx *= 0.999;
      piece.vy *= 0.999;
      piece.life--;

      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      ctx.fillStyle = rgba(piece.colour, Math.max(0, piece.life / CONFETTI_LIFE));
      ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
      ctx.restore();

      if (piece.y > surface.height + 10 || piece.life <= 0) confettiPieces.splice(index, 1);
    }

    for (let index = coinPieces.length - 1; index >= 0; index--) {
      const coin = coinPieces[index];
      if (!coin) continue;

      coin.x += coin.vx;
      coin.y += coin.vy;
      coin.vy += 0.3;
      coin.rotation += coin.rotationSpeed;
      coin.life--;

      if (coin.x < 0 || coin.x > surface.width) {
        coin.vx *= -0.6;
        coin.x = Math.max(0, Math.min(surface.width, coin.x));
      }
      if (coin.y > surface.height - coin.size) {
        coin.vy *= -0.6;
        coin.y = surface.height - coin.size;
        coin.vx *= 0.8;
      }

      ctx.save();
      ctx.translate(coin.x, coin.y);
      ctx.rotate(coin.rotation);
      ctx.globalAlpha = Math.max(0, coin.life / COIN_LIFE);

      ctx.beginPath();
      ctx.arc(0, 0, coin.size, 0, TAU);
      ctx.fillStyle = rgba(GOLD, 1);
      ctx.fill();
      ctx.strokeStyle = GOLD_RIM;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(-coin.size * 0.3, -coin.size * 0.3, coin.size * 0.3, 0, TAU);
      ctx.fillStyle = GOLD_SHINE;
      ctx.fill();
      ctx.restore();

      if (coin.life <= 0) coinPieces.splice(index, 1);
    }

    // The loop stops itself once the screen is empty, and any new burst restarts it. That is
    // what keeps an idle public display from holding a frame callback open all evening.
    return confettiPieces.length > 0 || coinPieces.length > 0;
  }

  function spawnConfetti(count: number, palette: readonly Rgb[]): void {
    for (let index = 0; index < count; index++) {
      confettiPieces.push({
        x: Math.random() * surface.width,
        y: -10,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 3 + 2,
        width: Math.random() * 8 + 4,
        height: Math.random() * 8 + 4,
        colour: pick(palette, GOLD),
        rotation: Math.random() * TAU,
        rotationSpeed: (Math.random() - 0.5) * 0.3,
        life: CONFETTI_LIFE
      });
    }
  }

  return {
    confetti(durationMs: number): void {
      stopSpawning();

      // Read the palette per run, so a theme change between draws is picked up.
      const theme = readThemeColours();
      const palette: readonly Rgb[] = [theme.primary, theme.secondary, theme.selection, GOLD];

      spawnConfetti(50, palette);
      surface.run(step);

      const startedAt = performance.now();
      spawnTimer = setInterval(() => {
        if (performance.now() - startedAt >= durationMs) {
          stopSpawning();
          return;
        }
        spawnConfetti(10, palette);
        surface.run(step);
      }, CONFETTI_BATCH_MS);
    },

    coins(x: number, y: number): void {
      if (coinPieces.length >= MAX_COINS) return;
      const count = 8 + Math.floor(Math.random() * 5);
      for (let index = 0; index < count; index++) {
        coinPieces.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 8,
          vy: -Math.random() * 8 - 3,
          size: Math.random() * 8 + 6,
          rotation: 0,
          rotationSpeed: (Math.random() - 0.5) * 0.3,
          life: COIN_LIFE
        });
      }
      surface.run(step);
    },

    clear(): void {
      stopSpawning();
      confettiPieces = [];
      coinPieces = [];
      surface.stop();
      surface.clear();
    },

    destroy(): void {
      stopSpawning();
      confettiPieces = [];
      coinPieces = [];
      surface.destroy();
    }
  };
}
