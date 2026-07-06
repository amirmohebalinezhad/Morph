// Creates the shadow host and renders the React app inside it. The host is a
// zero-footprint fixed element attached to <html> (not <body>, which SPAs
// love to replace). All UI styling is scoped to the shadow root.
import { createRoot, type Root } from 'react-dom/client';
import type { Session } from '../content/session';
import { MORPH_HOST_ID } from '../content/dom-utils';
import { App } from './app';
// esbuild loads .css as a plain string (loader: text)
import cssText from './styles.css';

export interface UIHandle {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  /** Container for the imperative overlay layer (below the React layer). */
  overlayContainer: HTMLElement;
  focusPrompt(): void;
  unmount(): void;
}

export function mountUI(session: Session): UIHandle {
  const host = document.createElement('div');
  host.id = MORPH_HOST_ID;
  host.style.cssText =
    'all:initial; position:fixed; top:0; left:0; width:0; height:0; z-index:2147483647; display:none;';
  const shadowRoot = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = cssText;
  shadowRoot.appendChild(style);

  const overlayContainer = document.createElement('div');
  overlayContainer.className = 'morph-overlay-container';
  shadowRoot.appendChild(overlayContainer);

  const reactContainer = document.createElement('div');
  reactContainer.className = 'morph-app';
  shadowRoot.appendChild(reactContainer);

  document.documentElement.appendChild(host);

  const root: Root = createRoot(reactContainer);
  root.render(<App session={session} />);

  return {
    host,
    shadowRoot,
    overlayContainer,
    focusPrompt() {
      const input = shadowRoot.querySelector<HTMLTextAreaElement>('[data-morph-prompt-input]');
      input?.focus();
    },
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}
