import React, { useState, useEffect } from 'react';

interface DebouncedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string | number;
  onChange: (value: string) => void;
  debounceMs?: number;
}

interface DebouncedTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

/**
 * Input qui garde son état local et ne notifie le parent qu'après un délai ou sur blur.
 */
export const DebouncedInput: React.FC<DebouncedInputProps> = ({ value: initialValue, onChange, debounceMs = 500, ...props }) => {
  const [localValue, setLocalValue] = useState<string | number>(initialValue);

  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const handler = setTimeout(() => {
      // On ne déclenche que si différent pour éviter les loops
      if (localValue !== initialValue) {
        onChange(String(localValue));
      }
    }, debounceMs);

    return () => clearTimeout(handler);
  }, [localValue, debounceMs]); // initialValue retiré des deps pour éviter le re-render cyclique pendant la frappe

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  // CRITIQUE : Force l'update immédiat si on quitte le champ (ex: clic sur Suivant)
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (localValue !== initialValue) {
      onChange(String(localValue));
    }
    if (props.onBlur) props.onBlur(e);
  };

  return <input {...props} value={localValue} onChange={handleChange} onBlur={handleBlur} />;
};

export const DebouncedTextarea: React.FC<DebouncedTextareaProps> = ({ value: initialValue, onChange, debounceMs = 800, ...props }) => {
  const [localValue, setLocalValue] = useState<string>(initialValue);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);

  // Auto-resize on value change
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [localValue]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (localValue !== initialValue) {
        onChange(localValue);
      }
    }, debounceMs);

    return () => clearTimeout(handler);
  }, [localValue, debounceMs]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (localValue !== initialValue) {
      onChange(localValue);
    }
    if (props.onBlur) props.onBlur(e);
  };

  return (
    <textarea
      {...props}
      ref={textareaRef}
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      style={{ overflow: 'hidden', ...props.style }}
    />
  );
};
