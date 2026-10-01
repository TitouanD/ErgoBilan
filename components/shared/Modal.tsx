import React, { useEffect } from 'react';

interface ModalProps {
  /** Controls mounting — when false, nothing is rendered. */
  isOpen: boolean;
  /** Called on backdrop click and Escape key (unless closeOnBackdrop/closeOnEscape are false). */
  onClose: () => void;
  children: React.ReactNode;
  /** z-index of the overlay. Defaults to the app's standard modal layer. */
  zIndex?: number;
  /** Overlay (backdrop) classes — override to match a specific modal's existing look. */
  overlayClassName?: string;
  /** Entrance animation classes applied to the overlay. Defaults to a 300ms fade. */
  overlayAnimationClassName?: string;
  /** Card/panel classes — override to match a specific modal's existing look. */
  panelClassName?: string;
  /** Entrance animation classes applied to the panel. Pass '' to match modals that didn't animate the panel. */
  panelAnimationClassName?: string;
  /** Set to false to disable closing when clicking the backdrop. */
  closeOnBackdrop?: boolean;
  /** Set to false to disable closing on Escape. */
  closeOnEscape?: boolean;
}

/**
 * Generic modal shell shared across the app: fixed full-screen overlay +
 * centered card. Each call site keeps its own icon/content/buttons and only
 * delegates the outer wrapper markup here — pass overlayClassName/panelClassName
 * to reproduce a specific modal's exact existing appearance (color, blur,
 * rounding, max-width, animation) without any visual change.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  zIndex = 200,
  overlayClassName = 'bg-[var(--secondary)]/80 backdrop-blur-md',
  overlayAnimationClassName = 'animate-in fade-in duration-300',
  panelClassName = 'bg-[var(--card-bg)] max-w-md w-full rounded-[32px] p-8 shadow-2xl',
  panelAnimationClassName = 'animate-in zoom-in-95 duration-200',
  closeOnBackdrop = true,
  closeOnEscape = true,
}) => {
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${overlayAnimationClassName} ${overlayClassName}`}
      style={{ zIndex }}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div className={`relative overflow-hidden ${panelAnimationClassName} ${panelClassName}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

export default Modal;
