/**
 * FeedbackModal — "Signaler un problème ou une idée": free text sent to Sentry
 * as a user feedback (no screenshot: it would not be masked). /issues turns
 * each feedback into a GitHub issue.
 */

import React, { useEffect, useState } from 'react';
import { CheckCircle2, MessageSquareText, X } from 'lucide-react';
import { Modal } from './Modal';
import { prepareFeedback, sendAppFeedback, type FeedbackSource } from '../../services/sentryService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  source: FeedbackSource;
  /** Demo mode: no account, so an optional e-mail to be answered. */
  askEmail?: boolean;
}

type Status = 'editing' | 'sent' | 'failed';

export const FeedbackModal: React.FC<Props> = ({ isOpen, onClose, source, askEmail = false }) => {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('editing');

  useEffect(() => {
    if (isOpen) void prepareFeedback();
  }, [isOpen]);

  const close = () => {
    if (status === 'sent') {
      setMessage('');
      setEmail('');
    }
    setStatus('editing');
    onClose();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    setStatus(sendAppFeedback(message.trim(), source, askEmail ? email : undefined) ? 'sent' : 'failed');
  };

  return (
    <Modal isOpen={isOpen} onClose={close} zIndex={300}>
      <button
        type="button"
        onClick={close}
        className="absolute top-5 right-5 h-8 w-8 rounded-full flex items-center justify-center text-[var(--text-light)] hover:bg-[var(--hover-bg)]"
        aria-label="Fermer"
      >
        <X size={18} />
      </button>

      {status === 'sent' ? (
        <div className="text-center py-4">
          <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-500" />
          <h2 className="font-serif text-xl font-bold text-[var(--text-heading)] mb-2">Merci !</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-6">Votre retour est bien arrivé.</p>
          <button type="button" onClick={close} className="px-6 py-3 bg-[var(--secondary)] text-white rounded-xl font-bold text-sm">
            Fermer
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <h2 className="font-serif text-xl font-bold text-[var(--text-heading)] mb-1 flex items-center gap-2 pr-8">
            <MessageSquareText size={20} className="text-[#E07A5F]" /> Signaler un problème ou une idée
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Dites-nous ce que vous faisiez et ce qui s'est passé. L'écran où vous étiez est joint automatiquement.
          </p>

          <label htmlFor="feedback-message" className="block text-xs font-bold uppercase tracking-wider text-[var(--text-light)] mb-1">
            Votre message
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            required
            autoFocus
            placeholder="Ex. : en réévaluation, étape Scores, le bouton Suivant ne répond plus."
            className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--card-bg-raised)] p-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-main)]"
          />
          <p className="mt-2 mb-4 text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            N'écrivez pas le nom de l'enfant ni d'information qui permette de le reconnaître.
          </p>

          {askEmail && (
            <>
              <label htmlFor="feedback-email" className="block text-xs font-bold uppercase tracking-wider text-[var(--text-light)] mb-1">
                Votre e-mail (facultatif, pour vous répondre)
              </label>
              <input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mb-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg-raised)] p-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-main)]"
              />
            </>
          )}

          {status === 'failed' && (
            <p className="mb-4 text-xs font-semibold text-rose-600">
              L'envoi n'est pas disponible ici. Réessayez depuis l'application en ligne.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="px-4 py-3 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-main)]"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!message.trim()}
              className="px-6 py-3 bg-[var(--secondary)] text-white rounded-xl font-bold text-sm disabled:opacity-50"
            >
              Envoyer
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
