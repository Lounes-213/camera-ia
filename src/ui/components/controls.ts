/**
 * Small shared controls used by every panel: a switch, a segmented control,
 * button factories and the panel chrome. Keeping them here means the individual
 * panels stay short and consistent.
 */
import { attachRipple, el, type Child } from '../dom';
import { iconElement } from '../icon';
import type { IconName } from '../icon';

/** A labelled toggle row bound to a boolean. */
export function switchRow(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLLabelElement {
  const input = el('input', {
    type: 'checkbox',
    attrs: { checked: checked ? '' : null },
  });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));

  return el(
    'label',
    { class: 'switch' },
    input,
    el('span', { class: 'switch__track' }, el('span', { class: 'switch__thumb' })),
    el('span', { text: label }),
  ) as HTMLLabelElement;
}

/** A two/three-option segmented control. */
export function segmented<T extends string>(
  options: { value: T; label: string; icon?: IconName }[],
  current: T,
  onChange: (value: T) => void,
): HTMLDivElement {
  const container = el('div', { class: 'segmented', role: 'group' });
  const buttons: HTMLButtonElement[] = [];

  for (const option of options) {
    const button = el(
      'button',
      {
        class: 'segmented__option',
        type: 'button',
        attrs: { 'aria-pressed': String(option.value === current) },
        on: {
          click: () => {
            for (const other of buttons) other.setAttribute('aria-pressed', 'false');
            button.setAttribute('aria-pressed', 'true');
            onChange(option.value);
          },
        },
      },
      option.icon ? iconElement(option.icon, { size: 16 }) : null,
      el('span', { text: option.label }),
    );
    buttons.push(button);
    container.appendChild(button);
  }

  return container;
}

export interface ButtonOptions {
  label: string;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  block?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}

/** Creates a themed button with ripple feedback. */
export function button(options: ButtonOptions): HTMLButtonElement {
  const element = el(
    'button',
    {
      class: [
        'btn',
        `btn--${options.variant ?? 'secondary'}`,
        options.size === 'sm' ? 'btn--sm' : '',
        options.block ? 'btn--block' : '',
      ]
        .filter(Boolean)
        .join(' '),
      type: 'button',
      title: options.title ?? options.label,
      attrs: {
        'aria-pressed': options.pressed === undefined ? null : String(options.pressed),
        disabled: options.disabled ? '' : null,
        'data-hand-clickable': '',
      },
      on: { click: () => options.onClick() },
    },
    options.icon ? iconElement(options.icon, { size: 18 }) : null,
    options.label ? el('span', { text: options.label }) : null,
  );
  attachRipple(element);
  return element;
}

/** Creates a round glass icon button (used by the floating chrome). */
export function iconButton(
  icon: IconName,
  label: string,
  onClick: () => void,
  options: { pressed?: boolean; className?: string } = {},
): HTMLButtonElement {
  const element = el(
    'button',
    {
      class: `icon-btn ${options.className ?? ''}`.trim(),
      type: 'button',
      title: label,
      attrs: {
        'aria-label': label,
        'aria-pressed': options.pressed === undefined ? null : String(options.pressed),
        'data-hand-clickable': '',
      },
      on: { click: () => onClick() },
    },
    iconElement(icon, { size: 20 }),
  );
  return element;
}

/** Panel chrome: a glass card with a title row and content. */
export function panel(title: string, ...content: Child[]): HTMLElement {
  return el(
    'section',
    { class: 'glass panel' },
    el(
      'h2',
      { class: 'panel__title' },
      el('span', { text: title }),
    ),
    ...content,
  );
}

/** A labelled empty state. */
export function emptyState(icon: IconName, message: string): HTMLElement {
  return el(
    'div',
    { class: 'empty' },
    el('span', { class: 'empty__icon' }, iconElement(icon, { size: 22 })),
    el('span', { text: message }),
  );
}

/** A horizontal progress bar. */
export function progressBar(value: number): HTMLElement {
  const fill = el('div', { class: 'progress__fill' });
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  return el('div', { class: 'progress', role: 'progressbar' }, fill);
}

/** A row of small text badges. */
export function badges(items: string[]): HTMLElement {
  return el('div', { class: 'row' }, ...items.map((text) => el('span', { class: 'badge', text })));
}
