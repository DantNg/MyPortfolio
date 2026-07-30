/**
 * Rasterise the hand-drawn SVG thumbnails to PNG.
 *
 * WHY THIS EXISTS
 * The blog thumbnails are SVG, which is what the site itself displays — sharp
 * at any size and a few kB each. But Open Graph scrapers (Facebook, X,
 * LinkedIn, Slack) do not render SVG, so a shared link would show no preview.
 * This script writes a PNG twin next to each SVG, and the layouts point
 * og:image at the PNG while <img> keeps using the SVG.
 *
 * The PNGs are committed, so a normal `npm run build` never needs this script
 * or its dependency. Run it only after editing one of the SVGs:
 *
 *     npm run thumbnails
 *
 * NOTE ON FONTS: resvg has no access to the webfont the site loads, so it
 * falls back to a locally installed family. `defaultFontFamily` below pins it
 * to something sane rather than whatever resvg picks first. The PNGs are only
 * ever seen as social previews, so a system sans is fine.
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { platform } from 'node:os';

/** [svg path, output width] — width drives the raster size, aspect is kept */
const TARGETS = [
  ['public/images/blog/ble-mesh.svg', 1200],
  ['public/images/blog/freertos.svg', 1200],
  ['public/images/blog/zephyr-rtos.svg', 1200],
  ['public/images/series/lvgl.svg', 1200],
  ['public/images/series/linux.svg', 1200],
  ['public/images/series/rtos.svg', 1200],
  ['public/images/series/automotive.svg', 1200],
  ['public/images/series/design-patterns.svg', 1200],
  ['public/og-default.svg', 1200],
];

/**
 * Pick a sans family that is actually installed.
 *
 * resvg takes ONE family name, and if that name is missing it falls back to
 * whatever it finds first — which on a bare Windows box is a condensed display
 * face that looks nothing like the site. So probe real font files and only name
 * a family we can see on disk.
 */
function pickSansFamily() {
  const candidates = {
    win32: [
      ['Inter', 'C:/Windows/Fonts/Inter-Regular.ttf'],
      ['Segoe UI', 'C:/Windows/Fonts/segoeui.ttf'],
      ['Arial', 'C:/Windows/Fonts/arial.ttf'],
    ],
    darwin: [
      ['Inter', '/Library/Fonts/Inter-Regular.ttf'],
      ['Helvetica Neue', '/System/Library/Fonts/HelveticaNeue.ttc'],
      ['Helvetica', '/System/Library/Fonts/Helvetica.ttc'],
    ],
    linux: [
      ['Inter', '/usr/share/fonts/truetype/inter/Inter-Regular.ttf'],
      ['DejaVu Sans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
      ['Liberation Sans', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'],
    ],
  }[platform()] ?? [];

  for (const [family, probe] of candidates) {
    if (existsSync(probe)) return family;
  }
  console.warn('  ! no known sans font found — resvg will pick its own fallback');
  return undefined;
}

const SANS = pickSansFamily();
if (SANS) console.log(`  font: ${SANS}
`);

let failed = 0;

for (const [src, width] of TARGETS) {
  if (!existsSync(src)) {
    console.error(`  missing  ${src}`);
    failed++;
    continue;
  }

  const out = join(dirname(src), basename(src).replace(/\.svg$/, '.png'));

  try {
    const resvg = new Resvg(readFileSync(src, 'utf8'), {
      fitTo: { mode: 'width', value: width },
      font: {
        loadSystemFonts: true,
        ...(SANS ? { defaultFontFamily: SANS, sansSerifFamily: SANS } : {}),
      },
    });

    const png = resvg.render().asPng();
    writeFileSync(out, png);
    console.log(`  ok       ${out}  (${(png.length / 1024).toFixed(0)} kB)`);
  } catch (err) {
    console.error(`  FAILED   ${src}: ${err.message}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed.`);
  process.exit(1);
}
console.log('\nAll thumbnails rendered.');
