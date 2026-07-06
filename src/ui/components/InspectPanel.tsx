import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { Session } from '../../content/session';
import { describeElement } from '../../content/dom-utils';
import { primarySelection } from '../../content/store';

function pxNum(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return '#000000';
  const to = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${to(m[1]!)}${to(m[2]!)}${to(m[3]!)}`;
}

const SHADOWS: Array<{ label: string; value: string }> = [
  { label: 'None', value: 'none' },
  { label: 'Subtle', value: '0 1px 2px rgba(0,0,0,0.10)' },
  { label: 'Medium', value: '0 4px 12px rgba(0,0,0,0.14)' },
  { label: 'Large', value: '0 14px 36px rgba(0,0,0,0.20)' },
];

interface Values {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  fontSize: number;
  fontWeight: string;
  textAlign: string;
  color: string;
  background: string;
  radius: number;
  opacity: number;
  shadow: string;
}

function readValues(el: Element): Values {
  const cs = getComputedStyle(el);
  return {
    paddingTop: pxNum(cs.paddingTop),
    paddingRight: pxNum(cs.paddingRight),
    paddingBottom: pxNum(cs.paddingBottom),
    paddingLeft: pxNum(cs.paddingLeft),
    marginTop: pxNum(cs.marginTop),
    marginRight: pxNum(cs.marginRight),
    marginBottom: pxNum(cs.marginBottom),
    marginLeft: pxNum(cs.marginLeft),
    fontSize: pxNum(cs.fontSize),
    fontWeight: cs.fontWeight,
    textAlign: cs.textAlign,
    color: rgbToHex(cs.color),
    background: rgbToHex(cs.backgroundColor),
    radius: pxNum(cs.borderTopLeftRadius),
    opacity: Math.round(parseFloat(cs.opacity) * 100),
    shadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow,
  };
}

function Num(props: {
  label: string;
  prop: string;
  value: number;
  onStage: (prop: string, cssValue: string) => void;
  set: (v: number) => void;
  min?: number;
}) {
  return (
    <label className="in-num">
      <span>{props.label}</span>
      <input
        type="number"
        min={props.min ?? 0}
        value={props.value}
        data-morph-inspect={props.prop}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          props.set(v);
          props.onStage(props.prop, `${v}px`);
        }}
      />
    </label>
  );
}

export function InspectPanel({ session }: { session: Session }) {
  const primary = useStore(session.store, (s) => primarySelection(s));
  const headId = useStore(session.history.view, (s) => s.headId);
  const [values, setValues] = useState<Values | null>(null);
  const connected = primary?.isConnected ?? false;

  const descriptor = useMemo(
    () => (primary && connected ? describeElement(primary, 4) : null),
    [primary, connected],
  );

  useEffect(() => {
    if (primary && primary.isConnected) setValues(readValues(primary));
    else setValues(null);
  }, [primary, headId]);

  if (!primary || !connected || !values || !descriptor) {
    return (
      <div className="dock-placeholder" data-morph-pane="inspect">
        <p className="ph-title">Inspect</p>
        <p className="ph-hint">Select an element to edit its spacing, type, colors, and effects by hand.</p>
      </div>
    );
  }

  const stage = (prop: string, cssValue: string) => session.manualStage(primary, prop, cssValue);
  const patch = (p: Partial<Values>) => setValues((v) => (v ? { ...v, ...p } : v));

  return (
    <div className="inspect" data-morph-pane="inspect">
      <div className="in-target" title={descriptor}>
        {descriptor}
      </div>

      <div className="in-section">
        <div className="in-title">Padding</div>
        <div className="in-grid4">
          <Num label="T" prop="padding-top" value={values.paddingTop} set={(v) => patch({ paddingTop: v })} onStage={stage} />
          <Num label="R" prop="padding-right" value={values.paddingRight} set={(v) => patch({ paddingRight: v })} onStage={stage} />
          <Num label="B" prop="padding-bottom" value={values.paddingBottom} set={(v) => patch({ paddingBottom: v })} onStage={stage} />
          <Num label="L" prop="padding-left" value={values.paddingLeft} set={(v) => patch({ paddingLeft: v })} onStage={stage} />
        </div>
      </div>

      <div className="in-section">
        <div className="in-title">Margin</div>
        <div className="in-grid4">
          <Num label="T" prop="margin-top" value={values.marginTop} set={(v) => patch({ marginTop: v })} onStage={stage} min={-400} />
          <Num label="R" prop="margin-right" value={values.marginRight} set={(v) => patch({ marginRight: v })} onStage={stage} min={-400} />
          <Num label="B" prop="margin-bottom" value={values.marginBottom} set={(v) => patch({ marginBottom: v })} onStage={stage} min={-400} />
          <Num label="L" prop="margin-left" value={values.marginLeft} set={(v) => patch({ marginLeft: v })} onStage={stage} min={-400} />
        </div>
      </div>

      <div className="in-section">
        <div className="in-title">Typography</div>
        <div className="in-row">
          <Num label="Size" prop="font-size" value={values.fontSize} set={(v) => patch({ fontSize: v })} onStage={stage} min={6} />
          <label className="in-select">
            <span>Weight</span>
            <select
              value={values.fontWeight}
              data-morph-inspect="font-weight"
              onChange={(e) => {
                patch({ fontWeight: e.target.value });
                stage('font-weight', e.target.value);
              }}
            >
              {['300', '400', '500', '600', '700', '800'].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label className="in-color">
            <span>Color</span>
            <input
              type="color"
              value={values.color}
              data-morph-inspect="color"
              onChange={(e) => {
                patch({ color: e.target.value });
                stage('color', e.target.value);
              }}
            />
          </label>
        </div>
        <div className="in-seg" role="radiogroup" aria-label="Text align">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              type="button"
              className={values.textAlign === a ? 'on' : ''}
              data-morph-inspect={`align-${a}`}
              onClick={() => {
                patch({ textAlign: a });
                stage('text-align', a);
              }}
            >
              {a === 'left' ? '⇤' : a === 'center' ? '⇥⇤' : '⇥'}
            </button>
          ))}
        </div>
      </div>

      <div className="in-section">
        <div className="in-title">Fill & effects</div>
        <div className="in-row">
          <label className="in-color">
            <span>Fill</span>
            <input
              type="color"
              value={values.background}
              data-morph-inspect="background-color"
              onChange={(e) => {
                patch({ background: e.target.value });
                stage('background-color', e.target.value);
              }}
            />
          </label>
          <Num label="Radius" prop="border-radius" value={values.radius} set={(v) => patch({ radius: v })} onStage={stage} />
          <label className="in-select">
            <span>Shadow</span>
            <select
              value={SHADOWS.some((s) => s.value === values.shadow) ? values.shadow : 'custom'}
              data-morph-inspect="box-shadow"
              onChange={(e) => {
                patch({ shadow: e.target.value });
                stage('box-shadow', e.target.value);
              }}
            >
              {SHADOWS.map((s) => (
                <option key={s.label} value={s.value}>
                  {s.label}
                </option>
              ))}
              {!SHADOWS.some((s) => s.value === values.shadow) && (
                <option value="custom" disabled>
                  Custom
                </option>
              )}
            </select>
          </label>
        </div>
        <label className="in-slider">
          <span>Opacity {values.opacity}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={values.opacity}
            data-morph-inspect="opacity"
            onChange={(e) => {
              const v = Number(e.target.value);
              patch({ opacity: v });
              stage('opacity', String(v / 100));
            }}
          />
        </label>
      </div>

      <p className="in-hint">
        Changes preview instantly and are saved to history a moment after you stop adjusting. Drag the
        ✥ grip to move the element; drag the corner handles to resize.
      </p>
    </div>
  );
}
