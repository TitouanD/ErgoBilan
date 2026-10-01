import React, { createContext, useContext, useState, useEffect } from 'react';
import { Logger } from '../utils/logger';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'ergobilan.theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    // Load theme from localStorage on mount
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') {
        Logger.info('UI', `Loaded theme from storage: ${stored}`);
        return stored;
      }
    } catch (error) {
      Logger.warn('UI', 'Failed to load theme from localStorage', error);
    }
    // Default theme is always light when no user preference is stored.
    return 'light';
  });

  useEffect(() => {
    // Apply theme class to document body
    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(`${theme}-theme`);

    // Persist theme to localStorage
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      Logger.info('UI', `Theme switched to: ${theme}`);
    } catch (error) {
      Logger.warn('UI', 'Failed to save theme to localStorage', error);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
