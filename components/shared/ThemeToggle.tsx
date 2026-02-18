import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="relative h-8 w-8 rounded-full flex items-center justify-center transition-all hover:bg-[var(--hover-bg)]"
      title={theme === 'light' ? 'Activer le mode nuit' : 'Activer le mode jour'}
      aria-label={theme === 'light' ? 'Activer le mode nuit' : 'Activer le mode jour'}
    >
      {theme === 'light' ? (
        <Moon size={18} className="text-[#3D405B] transition-transform hover:scale-110" />
      ) : (
        <Sun size={18} className="text-[#F2CC8F] transition-transform hover:scale-110" />
      )}
    </button>
  );
};
