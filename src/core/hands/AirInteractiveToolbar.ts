/**
 * AirInteractiveToolbar — the unified floating top control dock for WebAR.
 *
 * Consolidates all controls into ONE single, sleek, futuristic glassmorphism bar:
 *  - ✍️ Stylu (قلم نحيف 2D)
 *  - ✨ Pinceau (فرشاة عريضة نيون)
 *  - 🧼 Gomme (ممحاة ذكية موضعية)
 *  - ⚡ Saisir 3D (إمساك المجسم وتحريكه)
 *  - 🔤 حروف الورقة (Touch-to-Type OCR)
 *  - 🎨 لوحة الألوان الستة الموحدة (Palette de 6 couleurs)
 *  - 🖐️ نقاط اليد (Toggle Hand Points ON/OFF)
 *  - 📷 لقطة AR (Snapshot)
 *  - 🧹 مسح الخطوط (Clear All)
 *
 * Designed for mid-air spatial finger dwell interaction (2s dwell or instant tap/pinch).
 */
import { el } from '../../ui/dom';
import { iconElement } from '../../ui/icon';
import type { IconName } from '../../ui/icon';

export type AirToolId =
  | 'pen'
  | 'brush'
  | 'eraser'
  | 'grab'
  | 'switch_cam'
  | 'paper_ocr'
  | 'youtube'
  | 'color_cyan'
  | 'color_orange'
  | 'color_magenta'
  | 'color_green'
  | 'color_yellow'
  | 'color_white'
  | 'skeleton'
  | 'snap'
  | 'clear';

export interface AirToolDef {
  id: AirToolId;
  label: string;
  icon?: IconName;
  colorSwatch?: string;
  group?: 'draw' | 'color' | 'util';
}

export const AIR_TOOLS: readonly AirToolDef[] = [
  // Interactive Tools
  { id: 'pen', label: 'قلم نحيف (Stylu 2D)', icon: 'Pencil', group: 'draw' },
  { id: 'brush', label: 'فرشاة نيون (Pinceau)', icon: 'Sparkles', group: 'draw' },
  { id: 'eraser', label: 'ممحاة ذكية (Gomme)', icon: 'Trash2', group: 'draw' },
  { id: 'grab', label: 'إمساك المجسم (Saisir 3D)', icon: 'Hand', group: 'draw' },
  { id: 'switch_cam', label: 'تبديل الكاميرا (Flip)', icon: 'SwitchCamera', group: 'draw' },
  { id: 'paper_ocr', label: 'حروف الورقة (Touch-to-Type)', icon: 'ScanLine', group: 'draw' },
  { id: 'youtube', label: 'يوتيوب AR شفاف (YouTube)', icon: 'Tv', group: 'draw' },

  // Unified Colors
  { id: 'color_cyan', label: 'نيون أزرق', colorSwatch: '#00f0ff', group: 'color' },
  { id: 'color_orange', label: 'برتقالي مشع', colorSwatch: '#ff8800', group: 'color' },
  { id: 'color_magenta', label: 'وردي نيون', colorSwatch: '#ff00aa', group: 'color' },
  { id: 'color_green', label: 'أخضر ماتريكس', colorSwatch: '#00ff66', group: 'color' },
  { id: 'color_yellow', label: 'أصفر ذهبي', colorSwatch: '#ffe600', group: 'color' },
  { id: 'color_white', label: 'أبيض ناصع', colorSwatch: '#ffffff', group: 'color' },

  // Actions
  { id: 'skeleton', label: 'نقاط اليد (Points Mains)', icon: 'Pointer', group: 'util' },
  { id: 'snap', label: 'لقطة AR (Snapshot)', icon: 'Camera', group: 'util' },
  { id: 'clear', label: 'مسح الكل (Effacer)', icon: 'RotateCcw', group: 'util' },
];

export interface AirInteractiveToolbarOptions {
  container: HTMLElement;
  initialTool?: AirToolId;
  skeletonEnabled?: boolean;
  onToolSelected: (tool: AirToolId) => void;
}

export class AirInteractiveToolbar {
  readonly element: HTMLElement;
  private readonly toolElements = new Map<AirToolId, {
    btn: HTMLElement;
    ringCircle: SVGCircleElement;
    iconWrapper: HTMLElement;
    rect: DOMRect | null;
  }>();

  private activeDrawTool: AirToolId = 'pen';
  private activeColor: AirToolId = 'color_cyan';
  private hoveredTool: AirToolId | null = null;
  private hoverStartTime: number | null = null;
  private readonly dwellDurationMs = 2000; // 2 seconds dwell ring as requested ("tdur f 2 second")
  private readonly onToolSelected: (tool: AirToolId) => void;
  private lastTriggeredTool: AirToolId | null = null;
  private isSkeletonOn = true;
  private isPaperOcrOn = false;
  private isYouTubeOn = false;

  constructor(options: AirInteractiveToolbarOptions) {
    this.onToolSelected = options.onToolSelected;
    if (options.initialTool && !options.initialTool.startsWith('color_')) {
      this.activeDrawTool = options.initialTool;
    }
    if (options.skeletonEnabled !== undefined) this.isSkeletonOn = options.skeletonEnabled;

    this.element = el('div', { class: 'air-toolbar glass' });
    this.buildTools();
    options.container.appendChild(this.element);

    // Update rects after layout and on resize/orientationchange
    window.addEventListener('resize', this.updateRects);
    window.addEventListener('orientationchange', this.updateRects);
    this.element.addEventListener('scroll', this.updateRects);
    requestAnimationFrame(() => this.updateRects());
  }

  private buildTools(): void {
    let lastGroup: string | undefined = undefined;

    for (const tool of AIR_TOOLS) {
      // Add subtle divider between groups
      if (lastGroup && lastGroup !== tool.group) {
        const divider = el('div', { class: 'air-toolbar__divider' });
        this.element.appendChild(divider);
      }
      lastGroup = tool.group;

      const isSelected =
        tool.id === this.activeDrawTool ||
        tool.id === this.activeColor ||
        (tool.id === 'skeleton' && this.isSkeletonOn) ||
        (tool.id === 'paper_ocr' && this.isPaperOcrOn);

      // Circular SVG progress ring
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'air-tool__ring');
      svg.setAttribute('viewBox', '0 0 44 44');

      const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bgCircle.setAttribute('cx', '22');
      bgCircle.setAttribute('cy', '22');
      bgCircle.setAttribute('r', '18');
      bgCircle.setAttribute('class', 'air-tool__ring-bg');

      const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      progressCircle.setAttribute('cx', '22');
      progressCircle.setAttribute('cy', '22');
      progressCircle.setAttribute('r', '18');
      progressCircle.setAttribute('class', 'air-tool__ring-progress');
      // Circumference = 2 * PI * 18 ≈ 113.1
      progressCircle.style.strokeDasharray = '113.1';
      progressCircle.style.strokeDashoffset = '113.1';

      svg.append(bgCircle, progressCircle);

      // Icon / Swatch element
      const iconWrapper = el('div', { class: 'air-tool__icon-wrap' });
      if (tool.colorSwatch) {
        const dot = el('div', {
          class: 'air-tool__swatch-dot',
          style: { backgroundColor: tool.colorSwatch },
        });
        iconWrapper.appendChild(dot);
      } else if (tool.icon) {
        iconWrapper.appendChild(iconElement(tool.icon, { size: 18 }));
      }

      const btn = el(
        'button',
        {
          class: `air-tool ${isSelected ? 'is-active' : ''}`,
          type: 'button',
          attrs: { 'aria-label': tool.label, title: tool.label },
          on: {
            click: () => this.selectTool(tool.id),
          },
        },
        svg,
        iconWrapper,
      );

      this.element.appendChild(btn);
      this.toolElements.set(tool.id, {
        btn,
        ringCircle: progressCircle,
        iconWrapper,
        rect: null,
      });
    }
  }

  readonly updateRects = (): void => {
    for (const [, entry] of this.toolElements) {
      entry.rect = entry.btn.getBoundingClientRect();
    }
  };

  /**
   * Updates index finger position every frame and drives the circular dwell animation.
   * @param screenX Normalised screen X (0..1)
   * @param screenY Normalised screen Y (0..1)
   * @param nowMs Current timestamp
   */
  updateFingerHover(screenX: number, screenY: number, nowMs: number): AirToolId | null {
    const px = screenX * window.innerWidth;
    const py = screenY * window.innerHeight;

    let hoveredId: AirToolId | null = null;

    // Check hit test against all tool buttons
    for (const [id, entry] of this.toolElements) {
      if (!entry.rect) entry.rect = entry.btn.getBoundingClientRect();
      const r = entry.rect;
      // Generous hit radius (expanded by 12px for easy finger touch)
      const hit =
        px >= r.left - 12 &&
        px <= r.right + 12 &&
        py >= r.top - 12 &&
        py <= r.bottom + 12;

      if (hit) {
        hoveredId = id;
        break;
      }
    }

    if (hoveredId !== this.hoveredTool) {
      // Clear previous hover
      if (this.hoveredTool) {
        const prev = this.toolElements.get(this.hoveredTool);
        if (prev) {
          prev.btn.classList.remove('is-hovered');
          prev.ringCircle.style.strokeDashoffset = '113.1';
        }
      }

      this.hoveredTool = hoveredId;
      this.hoverStartTime = hoveredId ? nowMs : null;
      this.lastTriggeredTool = null;

      if (hoveredId) {
        const curr = this.toolElements.get(hoveredId);
        curr?.btn.classList.add('is-hovered');
      }
    }

    // If hovering, update the circular progress fill
    if (this.hoveredTool && this.hoverStartTime !== null) {
      const elapsed = nowMs - this.hoverStartTime;
      const progress = Math.min(1, elapsed / this.dwellDurationMs);
      const curr = this.toolElements.get(this.hoveredTool);

      if (curr) {
        // Circumference = 113.1; offset goes from 113.1 down to 0
        const offset = 113.1 * (1 - progress);
        curr.ringCircle.style.strokeDashoffset = String(offset);

        // When the circle completely fills up (100% in 2s)
        if (progress >= 1 && this.lastTriggeredTool !== this.hoveredTool) {
          this.lastTriggeredTool = this.hoveredTool;
          this.selectTool(this.hoveredTool);

          // Pop animation
          curr.btn.classList.add('is-triggered');
          setTimeout(() => curr.btn.classList.remove('is-triggered'), 300);
          return this.hoveredTool;
        }
      }
    }

    return null;
  }

  selectTool(toolId: AirToolId): void {
    if (toolId === 'skeleton') {
      this.isSkeletonOn = !this.isSkeletonOn;
      this.toolElements.get('skeleton')?.btn.classList.toggle('is-active', this.isSkeletonOn);
      this.onToolSelected('skeleton');
      return;
    }

    if (toolId === 'paper_ocr') {
      this.isPaperOcrOn = !this.isPaperOcrOn;
      this.toolElements.get('paper_ocr')?.btn.classList.toggle('is-active', this.isPaperOcrOn);
      this.onToolSelected('paper_ocr');
      return;
    }

    if (toolId === 'youtube') {
      this.isYouTubeOn = !this.isYouTubeOn;
      this.toolElements.get('youtube')?.btn.classList.toggle('is-active', this.isYouTubeOn);
      this.onToolSelected('youtube');
      return;
    }

    if (toolId === 'clear' || toolId === 'snap' || toolId === 'switch_cam') {
      this.onToolSelected(toolId);
      return;
    }

    // Color selection: updates active color, while KEEPING the active draw tool (pen/brush) selected!
    if (toolId.startsWith('color_')) {
      this.activeColor = toolId;
      for (const [id, entry] of this.toolElements) {
        if (id.startsWith('color_')) {
          entry.btn.classList.toggle('is-active', id === toolId);
        }
      }
      this.onToolSelected(toolId);
      return;
    }

    // Tool selection (pen, brush, eraser, grab): preserves the active color!
    this.activeDrawTool = toolId;
    for (const [id, entry] of this.toolElements) {
      if (id === 'pen' || id === 'brush' || id === 'eraser' || id === 'grab') {
        entry.btn.classList.toggle('is-active', id === toolId);
      }
    }
    this.onToolSelected(toolId);
  }

  setSkeletonActive(active: boolean): void {
    this.isSkeletonOn = active;
    this.toolElements.get('skeleton')?.btn.classList.toggle('is-active', active);
  }

  setPaperOcrActive(active: boolean): void {
    this.isPaperOcrOn = active;
    this.toolElements.get('paper_ocr')?.btn.classList.toggle('is-active', active);
  }

  setYouTubeActive(active: boolean): void {
    this.isYouTubeOn = active;
    this.toolElements.get('youtube')?.btn.classList.toggle('is-active', active);
  }

  getActiveTool(): AirToolId {
    return this.activeDrawTool;
  }

  isHovering(): boolean {
    return this.hoveredTool !== null;
  }

  dispose(): void {
    window.removeEventListener('resize', this.updateRects);
    this.element.remove();
  }
}
