import { describe, expect, it } from 'vitest';
import { installPageRuntime } from '../../src/background/page-runtime';
import { wrapBehaviorCode } from '../../src/content/behaviors/runtime-client';

describe('installPageRuntime self-containedness', () => {
  // The function is serialized into the page via chrome.scripting.executeScript.
  // Any reference to module scope (bundler helpers, imports) would be a
  // ReferenceError at injection time on every site.
  it('contains no bundler or module artifacts', () => {
    const src = installPageRuntime.toString();
    for (const marker of ['import_', '__toESM', '__toCommonJS', 'require(', 'exports.', 'module.exports', '__name(']) {
      expect(src, `must not reference ${marker}`).not.toContain(marker);
    }
  });

  it('references only expected globals', () => {
    const src = installPageRuntime.toString();
    expect(src).toContain('__morphRuntime');
    expect(src).toContain('data-morph-runtime');
    expect(src).toContain('morph:behavior-exec');
    expect(src).toContain('morph:behavior-teardown');
    expect(src).toContain('morph:mock-set');
  });
});

describe('wrapBehaviorCode', () => {
  it('inlines the body without eval/new Function and notifies results', () => {
    const wrapped = wrapBehaviorCode('b1', 'morph.toast("hi");');
    expect(wrapped).toContain('morph.toast("hi");');
    expect(wrapped).toContain('rt.begin("b1")');
    expect(wrapped).toContain('rt.notifyResult("b1", null)');
    expect(wrapped).not.toContain('eval(');
    expect(wrapped).not.toContain('new Function');
  });

  it('escapes ids safely', () => {
    const wrapped = wrapBehaviorCode('we"ird\\id', 'return;');
    expect(wrapped).toContain(JSON.stringify('we"ird\\id'));
  });
});
