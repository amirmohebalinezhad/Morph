// Samples the page's design language — CSS custom properties, dominant fonts,
// colors, radii — so the AI can produce edits that fit in ("use the existing
// design language" without shipping the whole stylesheet).

function collectRootCustomProps(limit: number): string[] {
  const found = new Map<string, string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules; // throws on cross-origin sheets
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const sel = rule.selectorText;
      if (sel !== ':root' && sel !== 'html' && sel !== ':host') continue;
      for (const prop of Array.from(rule.style)) {
        if (prop.startsWith('--') && !found.has(prop)) {
          found.set(prop, rule.style.getPropertyValue(prop).trim());
          if (found.size >= limit) return format(found);
        }
      }
    }
  }
  return format(found);

  function format(map: Map<string, string>): string[] {
    return Array.from(map, ([k, v]) => `${k}: ${v}`);
  }
}

function tally(values: Iterable<string>, skip: (v: string) => boolean): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v || skip(v)) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

function top(counts: Map<string, number>, n: number): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v);
}

export function buildDesignTokens(): string {
  const lines: string[] = [];

  const body = getComputedStyle(document.body);
  lines.push(`base font: ${body.fontFamily.split(',')[0]?.trim()} ${body.fontSize}; text color: ${body.color}; page background: ${getComputedStyle(document.documentElement).backgroundColor}`);

  const samples = Array.from(
    document.querySelectorAll('button, a, h1, h2, h3, header, nav, [class*="card"], [class*="btn"], input'),
  ).slice(0, 60);

  const colors = tally(
    samples.map((el) => getComputedStyle(el).backgroundColor),
    (v) => v === 'rgba(0, 0, 0, 0)' || v === 'transparent',
  );
  const textColors = tally(samples.map((el) => getComputedStyle(el).color), () => false);
  const radii = tally(
    samples.map((el) => getComputedStyle(el).borderRadius),
    (v) => v === '0px',
  );
  const fonts = tally(
    samples.map((el) => getComputedStyle(el).fontFamily.split(',')[0]?.trim() ?? ''),
    () => false,
  );

  const bg = top(colors, 6);
  if (bg.length) lines.push(`common backgrounds: ${bg.join(' · ')}`);
  const fg = top(textColors, 4);
  if (fg.length) lines.push(`common text colors: ${fg.join(' · ')}`);
  const r = top(radii, 3);
  if (r.length) lines.push(`common border radii: ${r.join(' · ')}`);
  const f = top(fonts, 3);
  if (f.length > 1) lines.push(`fonts in use: ${f.join(' · ')}`);

  const custom = collectRootCustomProps(40);
  if (custom.length) {
    lines.push('CSS custom properties on :root:');
    lines.push(...custom.map((c) => `  ${c}`));
  }

  return lines.join('\n');
}
