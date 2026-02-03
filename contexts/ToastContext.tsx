
import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
    warning: (msg: string) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    
    // Auto-dismiss après 4 secondes
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const toast = {
    success: (msg: string) => addToast(msg, 'success'),
    error: (msg: string) => addToast(msg, 'error'),
    info: (msg: string) => addToast(msg, 'info'),
    warning: (msg: string) => addToast(msg, 'warning'),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[300] flex flex-col gap-3 pointer-events-none">
        {toasts.map(t => (
          <div 
            key={t.id} 
            className="pointer-events-auto animate-in slide-in-from-right-full fade-in duration-300 min-w-[300px] max-w-md bg-white rounded-2xl shadow-xl shadow-stone-200/50 border border-stone-100 p-4 flex items-start gap-3"
          >
            <div className={`mt-0.5 p-1 rounded-full shrink-0 ${
                t.type === 'success' ? 'text-emerald-500 bg-emerald-50' :
                t.type === 'error' ? 'text-rose-500 bg-rose-50' :
                t.type === 'warning' ? 'text-amber-500 bg-amber-50' :
                'text-[#3D405B] bg-stone-100'
            }`}>
                {t.type === 'success' && <CheckCircle2 size={18} strokeWidth={3} />}
                {t.type === 'error' && <AlertCircle size={18} strokeWidth={3} />}
                {t.type === 'warning' && <AlertTriangle size={18} strokeWidth={3} />}
                {t.type === 'info' && <Info size={18} strokeWidth={3} />}
            </div>
            
            <p className="text-sm font-bold text-[#3D405B] flex-1 leading-relaxed pt-0.5">
                {t.message}
            </p>

            <button 
                onClick={() => removeToast(t.id)}
                className="text-stone-300 hover:text-stone-500 transition-colors p-1"
            >
                <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) throw new Error('useToast must be used within a ToastProvider');
  return context.toast;
};
