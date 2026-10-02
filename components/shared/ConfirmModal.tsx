import React from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'warning' | 'danger' | 'info';
  /** Optional third action button (e.g. "Save draft" alongside "Discard" and "Cancel") */
  secondaryAction?: { label: string; onClick: () => void };
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'warning',
  secondaryAction,
}) => {
  const accentColor = variant === 'danger' ? 'rose' : variant === 'info' ? 'blue' : 'amber';
  const Icon = variant === 'info' ? Info : AlertTriangle;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      closeOnEscape={false}
      overlayClassName="bg-[var(--modal-overlay,rgba(61,64,91,0.7))] backdrop-blur-sm"
      overlayAnimationClassName="animate-in fade-in duration-200"
    >
      {/* Accent bar */}
      <div className={`absolute top-0 left-0 w-full h-1.5 bg-${accentColor}-500`} />

      {/* Close */}
      <button
        onClick={onCancel}
        className="absolute top-4 right-4 p-2 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--hover-bg)] transition-colors"
      >
        <X size={18} />
      </button>

      {/* Icon */}
      <div
        className={`w-14 h-14 bg-${accentColor}-50 dark:bg-${accentColor}-900/30 rounded-2xl flex items-center justify-center mx-auto mb-5 text-${accentColor}-500`}
      >
        <Icon size={28} />
      </div>

      {/* Content */}
      <h3 className="font-serif font-bold text-xl text-[var(--text-heading)] text-center mb-3">{title}</h3>
      <p className="text-[var(--text-secondary)] text-sm text-center leading-relaxed mb-8 whitespace-pre-line">{message}</p>

      {/* Actions */}
      <div className={`flex gap-3 ${secondaryAction ? 'flex-col sm:flex-row' : ''}`}>
        <button
          onClick={onCancel}
          className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-sm uppercase tracking-wider"
        >
          {cancelLabel}
        </button>
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            className="flex-1 py-3 bg-[var(--hover-bg)] text-[var(--text-heading)] font-bold rounded-xl transition-colors text-sm uppercase tracking-wider hover:bg-[var(--border-color)]"
          >
            {secondaryAction.label}
          </button>
        )}
        <button
          onClick={onConfirm}
          className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition-all text-sm uppercase tracking-wider ${
            variant === 'danger' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-[#3D405B] hover:bg-[#2c2e42]'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
};
