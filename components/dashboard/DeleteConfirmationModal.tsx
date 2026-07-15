import React, { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { Modal } from '../shared/Modal';

export const DeleteConfirmationModal: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
  const [input, setInput] = useState('');
  const isValid = input.toLowerCase() === 'supprimer';
  return (
    <Modal
      isOpen
      onClose={onCancel}
      closeOnBackdrop={false}
      closeOnEscape={false}
      overlayClassName="bg-[var(--secondary)]/80 backdrop-blur-md"
      overlayAnimationClassName=""
      panelClassName="w-full max-w-md rounded-[32px] bg-[var(--card-bg)] p-8 text-center shadow-2xl"
      panelAnimationClassName=""
    >
      <button onClick={onCancel} className="absolute right-6 top-6 text-[var(--text-disabled)] hover:text-[var(--text-secondary)]">
        <X size={24} />
      </button>
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-rose-50 text-rose-500">
        <Trash2 size={32} />
      </div>
      <h3 className="mb-2 font-serif text-2xl font-bold text-[var(--text-heading)]">Zone de danger</h3>
      <p className="mb-6 text-sm text-[var(--text-secondary)]">Tapez "supprimer" pour confirmer la suppression définitive.</p>
      <input
        value={input}
        onChange={(event) => setInput(event.target.value)}
        className="w-full rounded-xl border-2 border-[var(--input-border)] p-4 text-center font-bold text-rose-500 outline-none focus:border-rose-500 bg-[var(--input-bg)]"
        placeholder="supprimer"
      />
      <div className="mt-6 flex gap-3">
        <button onClick={onCancel} className="flex-1 rounded-xl py-3 font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]">
          Annuler
        </button>
        <button
          onClick={onConfirm}
          disabled={!isValid}
          className={`flex-1 rounded-xl py-3 font-bold text-white ${isValid ? 'bg-rose-500 hover:bg-rose-600' : 'cursor-not-allowed bg-[var(--card-bg-raised)] text-[var(--text-disabled)]'}`}
        >
          Supprimer
        </button>
      </div>
    </Modal>
  );
};

export default DeleteConfirmationModal;
