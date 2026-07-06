// Curated computed-style extraction: only the properties that inform design
// decisions, only when they differ from boring defaults. Output is a compact
// `prop: value; prop: value` string.

const CURATED_PROPS = [
  // layout
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float',
  'overflow', 'box-sizing',
  // flex/grid
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
  'gap', 'flex', 'grid-template-columns', 'grid-template-rows', 'grid-auto-flow',
  // box
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin', 'padding', 'border', 'border-radius', 'box-shadow', 'outline',
  // typography
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration', 'white-space', 'color',
  // visual
  'background-color', 'background-image', 'opacity', 'visibility', 'transform',
  'transition', 'animation', 'cursor', 'filter', 'backdrop-filter',
] as const;

function isDefaultValue(prop: string, value: string): boolean {
  if (value === '' || value === 'none' || value === 'auto' || value === 'normal') return true;
  switch (prop) {
    case 'display':
      return false; // always informative
    case 'position':
      return value === 'static';
    case 'top':
    case 'right':
    case 'bottom':
    case 'left':
      return value === 'auto';
    case 'overflow':
      return value === 'visible';
    case 'box-sizing':
      return value === 'content-box';
    case 'flex-direction':
      return value === 'row';
    case 'flex-wrap':
      return value === 'nowrap';
    case 'justify-content':
    case 'align-items':
    case 'align-content':
      return value === 'normal' || value === 'stretch' || value === 'flex-start';
    case 'flex':
      return value === '0 1 auto';
    case 'margin':
    case 'padding':
      return value === '0px';
    case 'border':
      return value.startsWith('0px');
    case 'border-radius':
      return value === '0px';
    case 'box-shadow':
    case 'text-decoration':
      return value.startsWith('none');
    case 'outline':
      return value.includes('none 0px') || value.startsWith('none');
    case 'font-weight':
      return value === '400';
    case 'letter-spacing':
      return value === 'normal';
    case 'text-align':
      return value === 'start' || value === 'left';
    case 'text-transform':
      return value === 'none';
    case 'white-space':
      return value === 'normal';
    case 'background-color':
      return value === 'rgba(0, 0, 0, 0)' || value === 'transparent';
    case 'opacity':
      return value === '1';
    case 'visibility':
      return value === 'visible';
    case 'cursor':
      return value === 'auto' || value === 'default';
    case 'z-index':
      return value === 'auto';
    case 'transition':
      return value === 'all' || value.startsWith('all 0s');
    case 'animation':
      return value.startsWith('none');
    case 'width':
    case 'height':
    case 'min-width':
    case 'min-height':
      return value === 'auto';
    case 'max-width':
    case 'max-height':
      return value === 'none';
    case 'gap':
      return value === 'normal' || value === 'normal normal';
    default:
      return false;
  }
}

export function compactComputedStyles(el: Element, maxProps = 40): string {
  const cs = getComputedStyle(el);
  const parts: string[] = [];
  for (const prop of CURATED_PROPS) {
    if (parts.length >= maxProps) break;
    const value = cs.getPropertyValue(prop).trim();
    if (!value || isDefaultValue(prop, value)) continue;
    parts.push(`${prop}: ${value}`);
  }
  return parts.join('; ');
}

/** Two or three key layout facts for one-line ancestor descriptions. */
export function layoutHint(el: Element): string {
  const cs = getComputedStyle(el);
  const bits: string[] = [`display:${cs.display}`];
  if (cs.position !== 'static') bits.push(`position:${cs.position}`);
  if (cs.display.includes('flex')) bits.push(`flex-direction:${cs.flexDirection}`);
  if (cs.display.includes('grid')) bits.push(`grid-cols:${cs.gridTemplateColumns.split(' ').length}`);
  return bits.join(' ');
}
