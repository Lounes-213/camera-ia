/**
 * Icon helper.
 *
 * Lucide ships ~1700 icons. Importing the aggregate `icons` map would drag all
 * of them into the bundle (≈700 kB), so we import only the icons this app
 * actually uses. Each icon is an "icon node" — `['svg', attrs, [['path', attrs]]]`
 * — which we render to inline SVG ourselves: no sprite fetch, no runtime pass,
 * and icons inherit `currentColor` so they follow the theme.
 */
import {
  AlertTriangle,
  BadgeInfo,
  Bot,
  Box,
  Boxes,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleSlash,
  CircleSlash2,
  Copy,
  Crown,
  Download,
  Ellipsis,
  ExternalLink,
  Flag,
  Gem,
  Globe,
  Grid3x3,
  Hand,
  Image,
  Infinity as InfinityIcon,
  Info,
  Keyboard,
  Languages,
  Lock,
  LogIn,
  LogOut,
  Maximize,
  Mic,
  Monitor,
  Moon,
  MousePointer2,
  Move3d,
  MoveHorizontal,
  Orbit,
  Palette,
  PanelLeft,
  Pencil,
  Play,
  Pause,
  Plus,
  Pointer,
  QrCode,
  RefreshCw,
  Rocket,
  RotateCcw,
  RotateCw,
  Scan,
  ScanLine,
  Search,
  SearchX,
  Shapes,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  SunMoon,
  SwitchCamera,
  Trash2,
  TriangleAlert,
  Tv,
  Undo2,
  Upload,
  User,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide';
import type { IconNode as LucideIconNode } from 'lucide';

/** The icons this app uses, keyed by the name used in components. */
const ICONS = {
  AlertTriangle,
  BadgeInfo,
  Bot,
  Box,
  Boxes,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleSlash,
  CircleSlash2,
  Copy,
  Crown,
  Download,
  Ellipsis,
  ExternalLink,
  Flag,
  Gem,
  Globe,
  Grid3x3,
  Hand,
  Image,
  Infinity: InfinityIcon,
  Info,
  Keyboard,
  Languages,
  Lock,
  LogIn,
  LogOut,
  Maximize,
  Mic,
  Monitor,
  Moon,
  MousePointer2,
  Move3d,
  MoveHorizontal,
  Orbit,
  Palette,
  PanelLeft,
  Pencil,
  Play,
  Pause,
  Plus,
  Pointer,
  QrCode,
  RefreshCw,
  Rocket,
  RotateCcw,
  RotateCw,
  Scan,
  ScanLine,
  Search,
  SearchX,
  Shapes,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  SunMoon,
  SwitchCamera,
  Trash2,
  TriangleAlert,
  Tv,
  Undo2,
  Upload,
  User,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
  XCircle,
} as const;

/** Lucide's icon node shape: `[tag, attributes, children?]`. */
export type IconNode = LucideIconNode;

/** Every icon name available to components. */
export type IconName = keyof typeof ICONS;

export interface IconOptions {
  /** Square size in px (default 20). */
  size?: number;
  className?: string;
  strokeWidth?: number;
  /** Decorative by default; set a label to expose it to screen readers. */
  label?: string;
}

/** Looks up an icon node. Unknown names render an empty svg rather than throwing. */
export function iconNode(name: IconName | string): IconNode {
  const map = ICONS as unknown as Record<string, IconNode | undefined>;
  return map[name] ?? (['svg', {}, []] as unknown as IconNode);
}

function attrsToString(attrs: Record<string, string | number>): string {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, '&quot;')}"`)
    .join(' ');
}

/** Normalised view of an icon node we can walk safely. */
type NodeTuple = readonly [
  string,
  Record<string, string | number>,
  (readonly IconNode[] | null)?,
];

function renderNode(node: IconNode): string {
  const [tag, attrs, children] = node as unknown as NodeTuple;
  const inner = (children ?? []).map((child) => renderNode(child)).join('');
  return `<${tag} ${attrsToString(attrs)}>${inner}</${tag}>`;
}

/** Renders an icon as an inline SVG string. */
export function icon(name: IconName | string, options: IconOptions = {}): string {
  const [, baseAttrs, children] = iconNode(name) as unknown as NodeTuple;

  const size = options.size ?? 20;
  const attrs: Record<string, string | number> = {
    ...baseAttrs,
    width: size,
    height: size,
    'stroke-width': options.strokeWidth ?? baseAttrs['stroke-width'] ?? 2,
    'aria-hidden': options.label ? 'false' : 'true',
  };
  if (options.label) {
    attrs.role = 'img';
    attrs['aria-label'] = options.label;
  } else {
    attrs.focusable = 'false';
  }
  if (options.className) attrs.class = options.className;

  const inner = (children ?? []).map((child) => renderNode(child)).join('');
  return `<svg ${attrsToString(attrs)}>${inner}</svg>`;
}

/** Creates an icon as a live DOM node. */
export function iconElement(name: IconName | string, options: IconOptions = {}): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = icon(name, options).trim();
  return template.content.firstElementChild as SVGSVGElement;
}

/** True when the name is part of the bundled icon set. */
export function hasIcon(name: string): name is IconName {
  return name in ICONS;
}
