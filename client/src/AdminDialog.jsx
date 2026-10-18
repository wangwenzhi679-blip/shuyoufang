import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

const CloseContext = createContext(null);
let openCount = 0,
  previousOverflow = '';
const focusables = (root) =>
  [
    ...root.querySelectorAll(
      'button:not(:disabled),summary,a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
    ),
  ].filter((el) => el.getClientRects().length);

export default function AdminDialog({
  title,
  onClose,
  locked = false,
  dirty = false,
  className = '',
  children,
}) {
  const root = useRef(null),
    confirm = useRef(null),
    editFocus = useRef(null),
    latest = useRef({});
  const [discard, setDiscard] = useState(false);
  const requestClose = () => {
    if (locked) return;
    if (dirty) {
      editFocus.current = document.activeElement;
      setDiscard(true);
      return;
    }
    onClose();
  };
  const resumeEditing = () => {
    setDiscard(false);
    const target = editFocus.current;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
      else root.current?.focus();
    });
  };
  latest.current = { locked, discard, requestClose, resumeEditing };
  useEffect(() => {
    const opener = document.activeElement;
    if (openCount++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    root.current?.focus();
    const keydown = (event) => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
        (el) => el.getClientRects().length,
      );
      if (dialogs.at(-1) !== root.current) return;
      const state = latest.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (state.locked) return;
        if (state.discard) state.resumeEditing();
        else state.requestClose();
      }
      if (event.key === 'Tab') {
        const area = confirm.current || root.current,
          items = focusables(area);
        if (!items.length) {
          event.preventDefault();
          area.focus();
          return;
        }
        const first = items[0],
          last = items.at(-1),
          active = document.activeElement;
        if (!area.contains(active) || active === area) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (--openCount === 0) document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    if (discard) confirm.current?.querySelector('button')?.focus();
  }, [discard]);
  return (
    <div
      className="admin-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={root}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={discard ? '放弃修改？' : title}
        aria-busy={locked}
        className={`admin-dialog ${className}`}
      >
        <CloseContext.Provider value={{ requestClose, locked }}>
          <div hidden={discard}>{children}</div>
        </CloseContext.Provider>
        {discard && (
          <div
            ref={confirm}
            className="admin-discard-confirm"
            role="alertdialog"
            aria-label="放弃修改？"
            tabIndex={-1}
          >
            <h2>放弃修改？</h2>
            <p>本次修改尚未保存。</p>
            <footer>
              <button type="button" onClick={resumeEditing}>
                继续编辑
              </button>
              <button type="button" className="admin-primary" onClick={onClose}>
                放弃修改
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
export function AdminDialogClose({ children = '关闭', disabled = false, ...props }) {
  const context = useContext(CloseContext);
  return (
    <button
      {...props}
      type="button"
      disabled={disabled || context?.locked}
      onClick={() => context?.requestClose()}
    >
      {children}
    </button>
  );
}
