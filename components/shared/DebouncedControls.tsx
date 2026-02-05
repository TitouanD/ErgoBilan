
import React, { useState, useEffect, useRef } from 'react';

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
 * Indispensable pour les formulaires connectés à un Contexte global lourd.
 */
export const DebouncedInput: React.FC<DebouncedInputProps> = ({ 
    value: initialValue, 
    onChange, 
    debounceMs = 500, 
    ...props 
}) => {
    const [localValue, setLocalValue] = useState<string | number>(initialValue);
    
    // Synchro descendante (Si le parent change la valeur pour une autre raison)
    useEffect(() => {
        setLocalValue(initialValue);
    }, [initialValue]);

    // Timer de debounce
    useEffect(() => {
        const handler = setTimeout(() => {
            if (localValue !== initialValue) {
                onChange(String(localValue));
            }
        }, debounceMs);

        return () => clearTimeout(handler);
    }, [localValue, debounceMs]); // On ne dépend pas de initialValue ici pour éviter les boucles

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalValue(e.target.value);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        if (localValue !== initialValue) {
            onChange(String(localValue));
        }
        if (props.onBlur) props.onBlur(e);
    };

    return (
        <input 
            {...props} 
            value={localValue} 
            onChange={handleChange} 
            onBlur={handleBlur} 
        />
    );
};

/**
 * Textarea optimisé (Même logique)
 */
export const DebouncedTextarea: React.FC<DebouncedTextareaProps> = ({ 
    value: initialValue, 
    onChange, 
    debounceMs = 800, // Délai un peu plus long pour le texte libre
    ...props 
}) => {
    const [localValue, setLocalValue] = useState<string>(initialValue);

    useEffect(() => {
        setLocalValue(initialValue);
    }, [initialValue]);

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
            value={localValue} 
            onChange={handleChange} 
            onBlur={handleBlur} 
        />
    );
};
