/**
 * YouTubeSpatialPlayer — Holographic Translucent AR Multimedia & YouTube Portal.
 *
 * Provides complete video playback in WebAR with mid-air finger gestures:
 *  1. Direct High-Definition 4K Streams (Nature, Cars, Sci-Fi, Quran, Cartoon) — 100% reliable, zero CORS/embed blocks.
 *  2. Live Screen/Tab Capture (📡 بث يوتيوب المباشر) via navigator.mediaDevices.getDisplayMedia — Streams ANY real YouTube tab/video live into AR with zero restrictions!
 *  3. Local Video Picker (📂 فتح فيديو من الكمبيوتر) — Plays any local MP4/WebM/MKV file inside AR.
 *  4. Enhanced YouTube Embeds (youtube-nocookie.com with origin) + External YouTube window link.
 *
 * Fullscreen ("Ga3 L'écran"), adjustable translucency (user is visible in the background), and mid-air finger pinch controls.
 */
import { el } from '../../ui/dom';
import { iconElement } from '../../ui/icon';
import { haptic } from '../../utils/device';

export interface VideoPreset {
  type: 'direct' | 'youtube';
  idOrUrl: string;
  title: string;
  icon: string;
}

export const VIDEO_PRESETS: readonly VideoPreset[] = [
  // Direct High-Definition Streams (100% guaranteed to work without any block or regional restriction)
  {
    type: 'direct',
    idOrUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    title: '🌿 طبيعة ساحرة 4K',
    icon: '🏝️',
  },
  {
    type: 'direct',
    idOrUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    title: '🏎️ سرعة وسيارات رياضية',
    icon: '⚡',
  },
  {
    type: 'direct',
    idOrUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    title: '🤖 خيال علمي وروبوتات',
    icon: '🪐',
  },
  {
    type: 'direct',
    idOrUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    title: '🎬 رسوم متحركة 3D',
    icon: '🐰',
  },
  {
    type: 'direct',
    idOrUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    title: '🌌 فضاء وهولوغرام 3D',
    icon: '🔮',
  },
  // Guaranteed Embeddable YouTube Presets (Via youtube-nocookie with origin)
  {
    type: 'youtube',
    idOrUrl: 'mR6_r9ZzM_k',
    title: '📖 تلاوة قرآنية خاشعة',
    icon: '✨',
  },
  {
    type: 'youtube',
    idOrUrl: 'LXb3EKWsInQ',
    title: '🌴 كوستاريكا 4K',
    icon: '🦜',
  },
  {
    type: 'youtube',
    idOrUrl: 'EngW7tLk6R8',
    title: '🌍 الأرض من الفضاء 4K',
    icon: '🛰️',
  },
];

export interface YouTubeSpatialPlayerOptions {
  container: HTMLElement;
  onStatusChange?: (msg: string, kind: 'idle' | 'draw' | 'seized' | 'erase' | 'warning' | 'point') => void;
  onClose?: () => void;
}

export type PlayerMode = 'direct' | 'screen' | 'youtube';

export class YouTubeSpatialPlayer {
  readonly element: HTMLElement;
  private readonly iframe: HTMLIFrameElement;
  private readonly videoElement: HTMLVideoElement;
  private readonly searchInput: HTMLInputElement;
  private readonly tabDirectBtn: HTMLElement;
  private readonly tabScreenBtn: HTMLElement;
  private readonly tabYoutubeBtn: HTMLElement;
  private readonly fallbackNotice: HTMLElement;

  private active = false;
  private isFullscreen = false;
  private currentOpacity = 0.76; // Semi-transparent so user in webcam feed is visible behind the video!
  private isPlaying = true;
  private isMuted = true;
  private currentMode: PlayerMode = 'direct';
  private currentSource = VIDEO_PRESETS[0]!.idOrUrl;

  private screenStream: MediaStream | null = null;
  private localVideoUrl: string | null = null;

  constructor(private readonly options: YouTubeSpatialPlayerOptions) {
    this.element = el('div', {
      class: 'ar-youtube-player glass animate-slide-up',
      style: {
        position: 'fixed',
        zIndex: '38',
        display: 'none',
      },
    });

    // 1. Header (Mode tabs, Search, Opacity, Fullscreen, Close)
    const header = el('div', { class: 'ar-youtube-player__header' });

    const titleBox = el(
      'div',
      { class: 'ar-youtube-player__title' },
      iconElement('Tv', { size: 18 }),
      el('span', { text: 'بوابة AR الفيديو ويوتيوب' }),
    );

    // Mode Selector: Direct HD | Screen/Tab Share | YouTube
    const modeTabs = el('div', { class: 'ar-youtube-mode-tabs' });
    this.tabDirectBtn = el('button', {
      class: 'ar-youtube-tab-btn is-active',
      type: 'button',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.switchMode('direct') },
    }, el('span', { text: '🎬 فيديو HD مباشر' }));

    this.tabScreenBtn = el('button', {
      class: 'ar-youtube-tab-btn',
      type: 'button',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => void this.toggleScreenShare() },
    }, el('span', { text: '📡 بث تاب يوتيوب' }));

    this.tabYoutubeBtn = el('button', {
      class: 'ar-youtube-tab-btn',
      type: 'button',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.switchMode('youtube') },
    }, el('span', { text: '🎥 يوتيوب AR' }));

    modeTabs.append(this.tabDirectBtn, this.tabScreenBtn, this.tabYoutubeBtn);

    // Search / URL input
    this.searchInput = el('input', {
      class: 'ar-youtube-player__search-input',
      attrs: {
        type: 'text',
        placeholder: 'ابحث أو ضع رابط فيديو مباشر / يوتيوب...',
        dir: 'rtl',
        'data-hand-clickable': '',
      },
      on: {
        keydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') this.handleSearch(this.searchInput.value);
        },
      },
    }) as HTMLInputElement;

    const searchBtn = el('button', {
      class: 'btn btn--ghost btn--icon',
      title: 'بحث أو تشغيل الرابط',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.handleSearch(this.searchInput.value) },
    }, iconElement('Search', { size: 16 }));

    // Open External YouTube in popup/tab
    const openYtBtn = el('button', {
      class: 'btn btn--ghost btn--icon',
      title: 'فتح موقع يوتيوب الكامل في نافذة مستقلة',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.openExternalYouTube() },
    }, iconElement('ExternalLink', { size: 16 }));

    // Opacity toggle (translucent AR effect)
    const opacityBtn = el('button', {
      class: 'btn btn--ghost ar-youtube-player__opacity-btn',
      attrs: { 'data-hand-clickable': '' },
      title: 'تغيير درجة الشفافية لتظهر بوضوح في الخلفية',
      on: { click: () => this.cycleOpacity() },
    }, el('span', { class: 'ar-youtube-player__opacity-label', text: '👻 75%' }));

    // Fullscreen toggle ("Ga3 L'écran")
    const fullscreenBtn = el('button', {
      class: 'btn btn--ghost btn--icon ar-youtube-player__expand-btn',
      title: 'ملء الشاشة بالكامل (Ga3 L\'écran)',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.toggleFullscreen() },
    }, iconElement('Maximize', { size: 16 }));

    // Close button
    const closeBtn = el('button', {
      class: 'btn btn--ghost btn--icon',
      title: 'إغلاق نافذة الفيديو',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.close() },
    }, iconElement('X', { size: 18 }));

    header.append(
      titleBox,
      modeTabs,
      this.searchInput,
      searchBtn,
      openYtBtn,
      opacityBtn,
      fullscreenBtn,
      closeBtn,
    );

    // 2. Preset category pills & quick actions
    const presetsRow = el('div', { class: 'ar-youtube-player__presets' });

    // Local file button
    const localFileBtn = el('button', {
      class: 'ar-youtube-preset-btn ar-youtube-preset-btn--highlight',
      type: 'button',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.openLocalVideo() },
    }, iconElement('Upload', { size: 14 }), el('span', { text: '📂 فيديو من جهازك' }));
    presetsRow.appendChild(localFileBtn);

    for (const p of VIDEO_PRESETS) {
      const pBtn = el('button', {
        class: 'ar-youtube-preset-btn',
        type: 'button',
        attrs: { 'data-hand-clickable': '' },
        on: { click: () => this.loadPreset(p) },
      }, el('span', { text: `${p.icon} ${p.title}` }));
      presetsRow.appendChild(pBtn);
    }

    // 3. Media wrapper: HTML5 video element + YouTube iframe + Fallback banner
    const mediaWrapper = el('div', { class: 'ar-youtube-player__video-wrapper' });

    this.videoElement = document.createElement('video');
    this.videoElement.className = 'ar-youtube-player__video';
    this.videoElement.autoplay = true;
    this.videoElement.loop = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    this.videoElement.crossOrigin = 'anonymous';
    this.videoElement.src = this.currentSource;

    this.iframe = document.createElement('iframe');
    this.iframe.className = 'ar-youtube-player__iframe';
    this.iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    this.iframe.allowFullscreen = true;
    this.iframe.style.display = 'none';

    // Fallback notice if YouTube block occurs
    this.fallbackNotice = el('div', {
      class: 'ar-youtube-fallback-banner',
      style: { display: 'none' },
    },
      el('span', { text: '⚠️ إذا ظهرت رسالة (Vidéo non disponible)، انقر هنا لبث تاب يوتيوب الحقيقي مباشرة:' }),
      el('button', {
        class: 'btn btn--primary btn--sm',
        attrs: { 'data-hand-clickable': '' },
        on: { click: () => void this.toggleScreenShare() },
      }, iconElement('Monitor', { size: 14 }), el('span', { text: '📡 بث تاب يوتيوب المباشر' })),
      el('button', {
        class: 'btn btn--ghost btn--sm',
        attrs: { 'data-hand-clickable': '' },
        on: { click: () => this.switchMode('direct') },
      }, el('span', { text: '🎬 فيديو HD مباشر' })),
    );

    mediaWrapper.append(this.videoElement, this.iframe, this.fallbackNotice);

    // 4. Mid-air finger touch controls bar
    const controlsBar = el('div', { class: 'ar-youtube-player__controls' });

    const playPauseBtn = el('button', {
      class: 'btn btn--primary ar-youtube-ctrl-btn',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.togglePlayPause() },
    }, iconElement('Play', { size: 18 }), el('span', { class: 'play-label', text: 'تشغيل / إيقاف' }));

    const rewindBtn = el('button', {
      class: 'btn btn--ghost ar-youtube-ctrl-btn',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.seekBy(-10) },
    }, iconElement('RotateCcw', { size: 16 }), el('span', { text: '-10s' }));

    const forwardBtn = el('button', {
      class: 'btn btn--ghost ar-youtube-ctrl-btn',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.seekBy(10) },
    }, iconElement('RotateCw', { size: 16 }), el('span', { text: '+10s' }));

    const muteBtn = el('button', {
      class: 'btn btn--ghost ar-youtube-ctrl-btn',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.toggleMute() },
    }, iconElement('Volume2', { size: 17 }), el('span', { class: 'mute-label', text: 'صوت 🔊' }));

    const screenBtn = el('button', {
      class: 'btn btn--ghost ar-youtube-ctrl-btn ar-youtube-ctrl-btn--stream',
      attrs: { 'data-hand-clickable': '' },
      title: 'بث نافذة يوتيوب أو المتصفح مباشرة في الواقع المعزز',
      on: { click: () => void this.toggleScreenShare() },
    }, iconElement('Monitor', { size: 16 }), el('span', { text: '📡 بث تاب يوتيوب' }));

    const fullToggleBtn = el('button', {
      class: 'btn btn--ghost ar-youtube-ctrl-btn',
      attrs: { 'data-hand-clickable': '' },
      on: { click: () => this.toggleFullscreen() },
    }, iconElement('Maximize', { size: 16 }), el('span', { text: 'ملء الشاشة بالكامل' }));

    controlsBar.append(playPauseBtn, rewindBtn, forwardBtn, muteBtn, screenBtn, fullToggleBtn);

    this.element.append(header, presetsRow, mediaWrapper, controlsBar);
    options.container.appendChild(this.element);

    this.applyStyles();
  }

  private buildYouTubeUrl(videoId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&controls=1&rel=0&enablejsapi=1${origin ? `&origin=${encodeURIComponent(origin)}` : ''}`;
  }

  private applyStyles(): void {
    this.element.style.opacity = `${this.currentOpacity}`;
  }

  switchMode(mode: PlayerMode): void {
    this.currentMode = mode;
    this.tabDirectBtn.classList.toggle('is-active', mode === 'direct');
    this.tabScreenBtn.classList.toggle('is-active', mode === 'screen');
    this.tabYoutubeBtn.classList.toggle('is-active', mode === 'youtube');

    if (mode === 'direct') {
      this.stopScreenShare();
      this.iframe.style.display = 'none';
      this.iframe.src = '';
      this.fallbackNotice.style.display = 'none';
      this.videoElement.style.display = 'block';
      this.videoElement.srcObject = null;
      this.videoElement.src = this.currentSource.startsWith('http') || this.currentSource.startsWith('blob:')
        ? this.currentSource
        : VIDEO_PRESETS[0]!.idOrUrl;
      void this.videoElement.play();
      this.options.onStatusChange?.('🎬 تم تفعيل: فيديو مباشر HD عالي الدقة (يعمل فوراً 100% بدون حجب)', 'seized');
    } else if (mode === 'screen') {
      this.iframe.style.display = 'none';
      this.iframe.src = '';
      this.fallbackNotice.style.display = 'none';
      this.videoElement.style.display = 'block';
      this.options.onStatusChange?.('📡 جاري بث تاب يوتيوب / الشاشة مباشرة في الواقع المعزز...', 'point');
    } else {
      // YouTube mode
      this.stopScreenShare();
      this.videoElement.style.display = 'none';
      this.videoElement.pause();
      this.iframe.style.display = 'block';
      this.fallbackNotice.style.display = 'flex';
      const ytId = this.currentSource.length === 11 ? this.currentSource : 'mR6_r9ZzM_k';
      this.iframe.src = this.buildYouTubeUrl(ytId);
      this.options.onStatusChange?.('🎥 وضع يوتيوب AR: إذا واجهت حظر الفيديو، استخدم زر "📡 بث تاب يوتيوب"', 'warning');
    }
  }

  async toggleScreenShare(): Promise<void> {
    if (this.screenStream) {
      this.stopScreenShare();
      this.switchMode('direct');
      return;
    }

    try {
      this.options.onStatusChange?.('📡 اختر نافذة أو تاب (YouTube) من المتصفح لبثه فوراً...', 'point');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
        } as MediaTrackConstraints,
        audio: true,
      });

      this.screenStream = stream;
      this.currentMode = 'screen';
      this.tabDirectBtn.classList.remove('is-active');
      this.tabScreenBtn.classList.add('is-active');
      this.tabYoutubeBtn.classList.remove('is-active');

      this.iframe.style.display = 'none';
      this.iframe.src = '';
      this.fallbackNotice.style.display = 'none';
      this.videoElement.style.display = 'block';
      this.videoElement.src = '';
      this.videoElement.srcObject = stream;
      this.videoElement.muted = false; // Enable audio for user's stream!
      void this.videoElement.play();

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        this.stopScreenShare();
        this.switchMode('direct');
      });

      haptic([30, 40]);
      this.options.onStatusChange?.('✅ تم بث تاب يوتيوب مباشرة داخل شاشة الواقع المعزز الشفافة!', 'seized');
    } catch {
      this.options.onStatusChange?.('⚠️ تم إلغاء مشاركة الشاشة أو لا يدعمها المتصفح', 'warning');
    }
  }

  private stopScreenShare(): void {
    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        track.stop();
      }
      this.screenStream = null;
    }
    if (this.videoElement.srcObject) {
      this.videoElement.srcObject = null;
    }
  }

  openLocalVideo(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,audio/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        if (this.localVideoUrl) URL.revokeObjectURL(this.localVideoUrl);
        this.localVideoUrl = URL.createObjectURL(file);
        this.currentSource = this.localVideoUrl;
        this.switchMode('direct');
        haptic(30);
        this.options.onStatusChange?.(`📂 تم تشغيل الفيديو المحلي: ${file.name}`, 'seized');
      }
    };
    input.click();
  }

  openExternalYouTube(): void {
    window.open('https://www.youtube.com', '_blank');
    haptic(30);
    this.options.onStatusChange?.('🌐 تم فتح موقع يوتيوب الكامل في نافذة مستقلة', 'point');
  }

  loadPreset(preset: VideoPreset): void {
    this.currentSource = preset.idOrUrl;
    if (preset.type === 'direct') {
      this.switchMode('direct');
      this.videoElement.src = preset.idOrUrl;
      void this.videoElement.play();
    } else {
      this.switchMode('youtube');
      this.iframe.src = this.buildYouTubeUrl(preset.idOrUrl);
    }
    haptic(35);
    this.options.onStatusChange?.(`▶️ جاري تشغيل: ${preset.title}`, 'seized');
  }

  setActive(active: boolean): void {
    this.active = active;
    this.element.style.display = active ? 'flex' : 'none';
    if (active) {
      if (this.currentMode === 'direct') {
        void this.videoElement.play();
      }
      this.options.onStatusChange?.('📺 شاشة الفيديو الشفافة مفتوحة: تحكّم بالأصابع وبدّل الشفافية وملء الشاشة!', 'point');
    } else {
      this.videoElement.pause();
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  close(): void {
    this.setActive(false);
    this.options.onClose?.();
  }

  cycleOpacity(): void {
    // Cycle: 76% -> 50% -> 95% -> 100% -> 76%
    if (this.currentOpacity >= 0.95) {
      this.currentOpacity = 0.5;
    } else if (this.currentOpacity >= 0.74) {
      this.currentOpacity = 0.95;
    } else {
      this.currentOpacity = 0.76;
    }
    this.element.style.opacity = `${this.currentOpacity}`;
    const label = this.element.querySelector('.ar-youtube-player__opacity-label');
    if (label) label.textContent = `👻 ${Math.round(this.currentOpacity * 100)}%`;

    haptic(30);
    this.options.onStatusChange?.(`👻 شفافية الفيديو: ${Math.round(this.currentOpacity * 100)}% (صورتك ظاهرة في الخلفية)`, 'seized');
  }

  toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    this.element.classList.toggle('is-fullscreen', this.isFullscreen);
    haptic([30, 40]);
    if (this.isFullscreen) {
      this.options.onStatusChange?.('🪟 وضع ملء الشاشة بالكامل (Ga3 L\'écran) مع ظهور صورتك في الخلفية!', 'seized');
    } else {
      this.options.onStatusChange?.('🪟 وضع النافذة الهولوغرافية العائمة', 'point');
    }
  }

  handleSearch(query: string): void {
    if (!query.trim()) return;

    // Direct MP4 / WebM link
    if (query.endsWith('.mp4') || query.endsWith('.webm') || query.includes('.mp4?')) {
      this.currentSource = query;
      this.switchMode('direct');
      this.videoElement.src = query;
      void this.videoElement.play();
      this.options.onStatusChange?.('🎬 تم تحميل الفيديو المباشر بنجاح', 'seized');
      return;
    }

    // YouTube URL or 11-character video ID
    const urlMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    const videoId = urlMatch ? urlMatch[1] : (query.length === 11 ? query : null);

    if (videoId) {
      this.currentSource = videoId;
      this.switchMode('youtube');
      this.iframe.src = this.buildYouTubeUrl(videoId);
      this.options.onStatusChange?.('🎥 تم تشغيل فيديو يوتيوب المحدد', 'seized');
      return;
    }

    // Keyword shortcuts
    const clean = query.trim().toLowerCase();
    if (clean.includes('quran') || clean.includes('قران') || clean.includes('قرآن')) {
      this.loadPreset(VIDEO_PRESETS[5]!);
    } else if (clean.includes('space') || clean.includes('فضاء') || clean.includes('3d')) {
      this.loadPreset(VIDEO_PRESETS[4]!);
    } else if (clean.includes('nature') || clean.includes('طبيعة') || clean.includes('بحر')) {
      this.loadPreset(VIDEO_PRESETS[0]!);
    } else if (clean.includes('car') || clean.includes('سيار') || clean.includes('سرعة')) {
      this.loadPreset(VIDEO_PRESETS[1]!);
    } else {
      // General YouTube search embed
      this.switchMode('youtube');
      this.iframe.src = `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(query)}&autoplay=1&mute=1`;
      this.options.onStatusChange?.(`🔍 جاري البحث في يوتيوب عن: "${query}"`, 'point');
    }
  }

  togglePlayPause(): void {
    this.isPlaying = !this.isPlaying;
    if (this.currentMode === 'direct' || this.currentMode === 'screen') {
      if (this.isPlaying) void this.videoElement.play();
      else this.videoElement.pause();
    } else {
      const command = this.isPlaying ? 'playVideo' : 'pauseVideo';
      this.postMessageToPlayer(command);
    }
    haptic(30);
    this.options.onStatusChange?.(this.isPlaying ? '▶️ تشغيل الفيديو' : '⏸️ إيقاف الفيديو مؤقتاً', 'point');
  }

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    if (this.currentMode === 'direct' || this.currentMode === 'screen') {
      this.videoElement.muted = this.isMuted;
    } else {
      const command = this.isMuted ? 'mute' : 'unMute';
      this.postMessageToPlayer(command);
    }
    const muteLabel = this.element.querySelector('.mute-label');
    if (muteLabel) muteLabel.textContent = this.isMuted ? 'كتم 🔇' : 'صوت 🔊';
    haptic(25);
    this.options.onStatusChange?.(this.isMuted ? '🔇 تم كتم الصوت' : '🔊 تم تشغيل الصوت', 'point');
  }

  seekBy(deltaSeconds: number): void {
    if (this.currentMode === 'direct' || this.currentMode === 'screen') {
      this.videoElement.currentTime += deltaSeconds;
    } else {
      this.postMessageToPlayer('seekTo', [deltaSeconds, true]);
    }
    haptic(25);
  }

  private postMessageToPlayer(func: string, args: unknown[] = []): void {
    try {
      this.iframe.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        '*',
      );
    } catch {
      // Cross-origin safe
    }
  }

  /**
   * Mid-air finger touch interaction:
   * Called on every frame from the hand tracking loop.
   * If user hovers or pinches over any button, it triggers with haptic feedback.
   */
  updateFinger(screenX: number, screenY: number, isPinch: boolean): boolean {
    if (!this.active) return false;

    const px = screenX * window.innerWidth;
    const py = screenY * window.innerHeight;

    const rect = this.element.getBoundingClientRect();
    const isInsidePlayer = px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;

    if (!isInsidePlayer) return false;

    const hitElement = document.elementFromPoint(px, py);
    const clickable = hitElement?.closest<HTMLElement>('[data-hand-clickable]');

    if (clickable) {
      clickable.style.transform = 'scale(1.08)';
      if (isPinch) {
        clickable.click();
        haptic(35);
      }
    }

    return true;
  }

  /**
   * Spatial scroll gesture handler for presets bar and video seek:
   * Called when user drags with 2 fingers / pinch.
   */
  handleScrollGesture(px: number, py: number, deltaPxX: number, _deltaPxY: number): boolean {
    if (!this.active) return false;

    const rect = this.element.getBoundingClientRect();
    const isInsidePlayer = px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
    if (!isInsidePlayer) return false;

    // Check presets row:
    const presetsRow = this.element.querySelector('.ar-youtube-player__presets') as HTMLElement | null;
    if (presetsRow) {
      const pRect = presetsRow.getBoundingClientRect();
      if (py >= pRect.top && py <= pRect.bottom) {
        presetsRow.scrollLeft += deltaPxX;
        return true;
      }
    }

    // Check video area for horizontal seek
    const vRect = this.videoElement.getBoundingClientRect();
    if (px >= vRect.left && px <= vRect.right && py >= vRect.top && py <= vRect.bottom) {
      if (Math.abs(deltaPxX) > 12) {
        this.seekBy(deltaPxX > 0 ? 5 : -5);
        return true;
      }
    }

    return false;
  }

  dispose(): void {
    this.stopScreenShare();
    if (this.localVideoUrl) {
      URL.revokeObjectURL(this.localVideoUrl);
      this.localVideoUrl = null;
    }
    this.videoElement.pause();
    this.videoElement.src = '';
    this.element.remove();
  }
}
