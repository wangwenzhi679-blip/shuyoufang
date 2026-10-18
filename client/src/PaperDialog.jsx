import React, { Children, cloneElement, isValidElement, useEffect, useId, useRef } from 'react';

let openDialogs = 0;
let previousOverflow = '';
const controls = (root) =>
  [
    ...root.querySelectorAll(
      'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
    ),
  ].filter((el) => el.getClientRects().length);
const classOf = (node) => (isValidElement(node) ? node.props.className || '' : '');
const isHeader = (node) =>
  isValidElement(node) &&
  (node.type === 'header' ||
    /(?:^|\s)(?:modal-header|library-dialog-header)(?:\s|$)/.test(classOf(node)));
const isFooter = (node) =>
  isValidElement(node) &&
  (node.type === 'footer' ||
    /(?:^|\s)(?:rename-actions|question-preview-footer)(?:\s|$)/.test(classOf(node)));
const flatten = (children) =>
  Children.toArray(children).flatMap((node) =>
    isValidElement(node) && node.type === React.Fragment ? flatten(node.props.children) : [node],
  );

function labelHeading(node, fallbackId) {
  if (!isValidElement(node)) return node;
  if (node.type === 'button' && node.props.onClick && !node.props['aria-label'])
    return cloneElement(node, { 'aria-label': '关闭弹窗', type: node.props.type || 'button' });
  if (typeof node.type === 'string' && /^h[1-6]$/.test(node.type))
    return cloneElement(node, { id: node.props.id || fallbackId });
  if (!node.props.children) return node;
  return cloneElement(
    node,
    {},
    Children.map(node.props.children, (child) => labelHeading(child, fallbackId)),
  );
}

/** Shared user-facing dialog frame; each feature keeps its existing actions and API calls. */
export default function PaperDialog({
  as: Tag = 'section',
  children,
  className = '',
  onDismiss,
  busy = false,
  ...props
}) {
  const root = useRef(null),
    latest = useRef({ onDismiss, busy });
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement);
  const titleId = useId();
  latest.current = { onDismiss, busy };
  const items = flatten(children);
  const headerIndex = items.findIndex(isHeader);
  const footerIndex = items.findLastIndex(isFooter);
  const header = headerIndex < 0 ? null : items[headerIndex];
  const heading =
    header ||
    items.find(
      (node) => isValidElement(node) && typeof node.type === 'string' && /^h[1-6]$/.test(node.type),
    );
  const footer = footerIndex < 0 ? null : items[footerIndex];
  const body = items.filter(
    (node, index) => index !== headerIndex && index !== footerIndex && (header || node !== heading),
  );
  const label = props['aria-labelledby'] || titleId;

  useEffect(() => {
    const previous = opener.current;
    if (openDialogs++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    if (!root.current.contains(document.activeElement)) root.current.focus({ preventScroll: true });
    const keydown = (event) => {
      const visible = [
        ...document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]'),
      ].filter((el) => el.getClientRects().length);
      if (visible.at(-1) !== root.current) return;
      if (event.key === 'Escape' && latest.current.onDismiss) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!latest.current.busy) latest.current.onDismiss();
      }
      if (event.key === 'Tab') {
        const list = controls(root.current),
          first = list[0],
          last = list.at(-1),
          active = document.activeElement;
        if (!first) {
          event.preventDefault();
          root.current.focus();
        } else if (!root.current.contains(active) || active === root.current) {
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
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <Tag
      {...props}
      ref={root}
      tabIndex={-1}
      role={props.role || 'dialog'}
      aria-modal="true"
      aria-busy={busy}
      aria-labelledby={props['aria-label'] ? undefined : label}
      className={`student-paper-dialog ${className}`}
    >
      {heading &&
        (header ? (
          cloneElement(labelHeading(header, label), {
            className: `${classOf(header)} student-dialog-header`,
          })
        ) : (
          <header className="student-dialog-header">
            {labelHeading(heading, label)}
            {onDismiss && (
              <button
                type="button"
                className="icon-close"
                disabled={busy}
                aria-label="关闭弹窗"
                onClick={onDismiss}
              >
                ×
              </button>
            )}
          </header>
        ))}
      {body.length > 0 && <div className="student-dialog-body">{body}</div>}
      {footer && cloneElement(footer, { className: `${classOf(footer)} student-dialog-actions` })}
    </Tag>
  );
}
