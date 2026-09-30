import React from 'react';
import { FlaskConical, LogOut } from 'lucide-react';

interface Props {
  email: string;
  onLogout: () => void;
}

/** Shown on the test environment to an account that is not on its access list (utils/testAccess.ts). */
export const TestAccessScreen: React.FC<Props> = ({ email, onLogout }) => (
  <div className="flex h-screen w-full items-center justify-center bg-[var(--app-bg)]">
    <div className="flex flex-col items-center gap-6 text-center max-w-sm px-6">
      <div className="w-20 h-20 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center">
        <FlaskConical size={36} className="text-amber-500" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-serif font-bold text-[var(--text-heading)]">Version de test</h2>
        <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
          Cette version d'ErgoBilan est réservée aux testeurs. Le compte <strong>{email}</strong> n'y a pas accès.
        </p>
        <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
          Pour utiliser ErgoBilan, rendez-vous sur{' '}
          <a href="https://app.ergobilan.com" className="font-bold text-[var(--primary)] underline">
            app.ergobilan.com
          </a>
          .
        </p>
      </div>
      <button
        onClick={onLogout}
        className="w-full py-3.5 bg-[var(--card-bg)] text-[var(--text-secondary)] rounded-2xl font-medium border border-[var(--border-color)] hover:border-[var(--text-light)] hover:text-[var(--text-main)] transition-all flex items-center justify-center gap-2"
      >
        <LogOut size={16} />
        Se déconnecter
      </button>
    </div>
  </div>
);

/** Permanent badge on test builds so nobody mistakes dev for production. */
export const TestBuildBadge: React.FC = () => (
  <div
    aria-hidden
    className="pointer-events-none fixed bottom-2 left-2 z-[9999] rounded-full bg-amber-400/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-950 shadow"
  >
    Version de test
  </div>
);
