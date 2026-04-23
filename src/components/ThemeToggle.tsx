import React from 'react';
import type { Theme } from '../types';

interface Props {
  theme: Theme;
  onToggle: () => void;
}

export const ThemeToggle: React.FC<Props> = ({ theme, onToggle }) => (
  <button
    className="theme-toggle"
    onClick={onToggle}
    title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    aria-label="Toggle theme"
  >
    {theme === 'dark' ? '☀' : '☾'}
  </button>
);
