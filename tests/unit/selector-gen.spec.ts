import { beforeEach, describe, expect, it } from 'vitest';
import { generateSelector } from '../../src/content/refs/selector-gen';

describe('generateSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function roundTrips(el: Element): void {
    const sel = generateSelector(el);
    const found = document.querySelectorAll(sel);
    expect(found.length, `selector "${sel}" should be unique`).toBe(1);
    expect(found[0]).toBe(el);
  }

  it('uses the id when unique', () => {
    document.body.innerHTML = '<div><button id="save">Save</button></div>';
    const el = document.getElementById('save')!;
    expect(generateSelector(el)).toBe('#save');
    roundTrips(el);
  });

  it('resolves table cells positionally', () => {
    document.body.innerHTML = `
      <table id="t"><tbody>
        <tr><td>a</td><td>b</td></tr>
        <tr><td>c</td><td>d</td></tr>
      </tbody></table>`;
    const cell = document.querySelectorAll('td')[3]!;
    roundTrips(cell);
  });

  it('disambiguates by class when siblings share a tag', () => {
    document.body.innerHTML = `
      <div id="wrap">
        <span class="alpha">1</span>
        <span class="beta">2</span>
        <span class="beta">3</span>
      </div>`;
    roundTrips(document.querySelector('.alpha')!);
    roundTrips(document.querySelectorAll('.beta')[1]!);
  });

  it('handles deep unclassed nesting', () => {
    document.body.innerHTML = `<main><section><div><div><p>x</p><p>y</p></div></div></section></main>`;
    roundTrips(document.querySelectorAll('p')[1]!);
  });

  it('anchors at the nearest unique-id ancestor', () => {
    document.body.innerHTML = `
      <div id="app"><ul><li>one</li><li>two</li></ul></div>
      <div><ul><li>other</li><li>list</li></ul></div>`;
    const li = document.querySelector('#app li:nth-of-type(2)')!;
    const sel = generateSelector(li);
    expect(sel.startsWith('#app')).toBe(true);
    roundTrips(li);
  });
});
