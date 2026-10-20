import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

export function useReadingFullscreen(root) {
  const [fullscreen, setFullscreen] = useState(false);
  const active = useRef(false);
  const ownsFullscreen = useRef(false);
  const button = useRef(null);
  const exit = () => {
    active.current = false;
    setFullscreen(false);
    if (ownsFullscreen.current && document.fullscreenElement) {
      ownsFullscreen.current = false;
      document.exitFullscreen().catch(() => {});
    }
  };
  const toggle = () => {
    if (active.current) return exit();
    active.current = true;
    setFullscreen(true);
    // 对整个文档申请全屏，让书签、笔记等已有弹窗仍可显示在阅读区上方。
    if (!document.fullscreenElement && document.fullscreenEnabled) {
      ownsFullscreen.current = true;
      document.documentElement.requestFullscreen().then(
        () => {
          if (!active.current && document.fullscreenElement)
            document.exitFullscreen().catch(() => {});
        },
        () => {
          // 嵌入式浏览器可能不允许系统全屏，仍保留占满页面的阅读布局。
          ownsFullscreen.current = false;
        },
      );
    }
  };
  useEffect(() => {
    if (!fullscreen) return;
    const overflow = document.body.style.overflow;
    const scrollPosition = { left: window.scrollX, top: window.scrollY };
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() =>
      root.current?.querySelector('.tracked-reading-scroll')?.focus({ preventScroll: true }),
    );
    const onFullscreenChange = () => {
      if (ownsFullscreen.current && !document.fullscreenElement) {
        ownsFullscreen.current = false;
        active.current = false;
        setFullscreen(false);
      }
    };
    const onKeyDown = (event) => {
      // 弹窗优先处理 Esc，关闭书签时不同时退出阅读。
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        exit();
      }
      if (event.key !== 'Tab' || !root.current) return;
      const controls = [
        ...root.current.querySelectorAll(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[contenteditable="true"],[tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
      window.scrollTo({ ...scrollPosition, behavior: 'instant' });
      button.current?.focus({ preventScroll: true });
    };
  }, [fullscreen]);
  useEffect(
    () => () => {
      active.current = false;
      if (ownsFullscreen.current && document.fullscreenElement)
        document.exitFullscreen().catch(() => {});
    },
    [],
  );
  return { fullscreen, toggle, button, exit };
}

export function ReadingFullscreenButton({ fullscreen, toggle, button }) {
  const Icon = fullscreen ? Minimize2 : Maximize2;
  return (
    <button
      ref={button}
      type="button"
      className="reading-fullscreen-button"
      aria-pressed={fullscreen}
      title={fullscreen ? '退出全屏阅读（Esc）' : '全屏阅读'}
      onClick={toggle}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{fullscreen ? '退出全屏' : '全屏阅读'}</span>
    </button>
  );
}
