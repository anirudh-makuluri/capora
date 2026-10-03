import { readFile, writeFile } from 'node:fs/promises';
type Report = { violations: { id: string; nodes: { failureSummary?: string }[] }[] };
const reports = JSON.parse(await readFile('.local/accessibility.json', 'utf8')) as Report[];
const backgrounds = new Map<string, Set<string>>();
for (const report of reports)
  for (const issue of report.violations.filter((v) => v.id === 'color-contrast'))
    for (const node of issue.nodes) {
      const match = node.failureSummary?.match(
        /foreground color: (#[\da-f]+), background color: (#[\da-f]+)/i,
      );
      if (match) {
        const set = backgrounds.get(match[1]) ?? new Set<string>();
        set.add(match[2]);
        backgrounds.set(match[1], set);
      }
    }
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) =>
  rgb(hex)
    .map((c) => {
      const n = c / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: string, b: string) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const mix = (source: string, target: string, amount: number) =>
  `#${rgb(source)
    .map((c, i) =>
      Math.round(c * (1 - amount) + rgb(target)[i] * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
let css = await readFile('apps/web/src/styles.css', 'utf8');
for (const [fg, bgs] of backgrounds) {
  const darkBackground = [...bgs].every((bg) => luminance(bg) < 0.15);
  let replacement = fg;
  for (let amount = 0.01; amount < 1; amount += 0.01) {
    replacement = mix(fg, darkBackground ? '#f2f8e9' : '#263820', amount);
    if ([...bgs].every((bg) => ratio(replacement, bg) >= 4.7)) break;
  }
  // Change text colors only; borders, illustrations, and backgrounds retain the original palette.
  css = css.replace(new RegExp(`(?<![-\\w])color:\\s*${fg}\\b`, 'gi'), `color: ${replacement}`);
}
await writeFile('apps/web/src/styles.css', css);
console.log(`Adjusted ${backgrounds.size} text colors against measured backgrounds.`);
