/**
 * Minimal DOM helpers.
 *
 * No framework, no virtual DOM: components build their own elements with these
 * helpers, which keeps bundles tiny and makes the "UI never touches 3D" rule
 * easy to follow.
 */

export type Child = Node | string | number | null | undefined | false;

export interface ElementProps {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  role?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  draggable?: boolean;
  hidden?: boolean;
  tabIndex?: number;
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  dataset?: Record<string, string>;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Partial<{
    [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void;
  }>;
}

/** Creates an element with props and children in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (props.class) node.className = props.class;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.title) node.title = props.title;
  if (props.role) node.setAttribute('role', props.role);
  if (props.tabIndex !== undefined) node.tabIndex = props.tabIndex;
  if (props.hidden) node.hidden = true;
  if (props.type) node.setAttribute('type', props.type);
  if (props.value !== undefined) (node as HTMLInputElement).value = props.value;
  if (props.placeholder) node.setAttribute('placeholder', props.placeholder);
  if (props.draggable !== undefined) node.draggable = props.draggable;

  if (props.style) {
    for (const [key, value] of Object.entries(props.style)) {
      if (value === undefined) continue;
      if (key.startsWith('--')) node.style.setProperty(key, String(value));
      else node.style.setProperty(kebab(key), String(value));
    }
  }

  if (props.dataset) {
    for (const [key, value] of Object.entries(props.dataset)) node.dataset[key] = value;
  }

  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      if (!handler) continue;
      node.addEventListener(type, handler as EventListener);
    }
  }

  append(node, children);
  return node;
}

/** Appends children, skipping falsy values and flattening arrays. */
export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child as Child[]);
    else if (typeof child === 'string' || typeof child === 'number') {
      parent.appendChild(document.createTextNode(String(child)));
    } else {
      parent.appendChild(child);
    }
  }
}

/** Creates a DocumentFragment from children. */
export function frag(...children: Child[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  append(fragment, children);
  return fragment;
}

/** Removes every child of a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replaces a node's content in one shot. */
export function replace(node: Node, ...children: Child[]): void {
  clear(node);
  append(node, children);
}

/** Adds an event listener and returns a detach function. */
export function on<K extends keyof HTMLElementEventMap>(
  target: EventTarget,
  type: K | string,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler as EventListener, options);
  return () => target.removeEventListener(type, handler as EventListener, options);
}

/** Applies a style object. */
export function style(node: HTMLElement, values: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('--')) node.style.setProperty(key, String(value));
    else node.style.setProperty(kebab(key), String(value));
  }
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

/** Adds a pointer ripple to a button-like element. */
export function attachRipple(node: HTMLElement): () => void {
  return on(node, 'pointerdown', (event) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = node.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = el('span', {
      class: 'ripple',
      style: {
        width: `${size}px`,
        height: `${size}px`,
        left: `${event.clientX - rect.left - size / 2}px`,
        top: `${event.clientY - rect.top - size / 2}px`,
      },
    });
    node.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 560);
  });
}

/** True when the pointer device is touch-first. */
export const isCoarsePointer = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
