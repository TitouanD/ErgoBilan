import React, { useState, useEffect } from 'react';

// COMPOSANT LOCAL POUR ÉVITER L'ERREUR REACT #185 (Too many re-renders)
export const DebouncedColorInput: React.FC<{
    value: string;
    onChange: (val: string) => void;
}> = ({ value, onChange }) => {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    return (
        <div className="h-10 rounded-lg border border-[var(--border-color)] relative overflow-hidden mb-1 shadow-sm group">
            <input
                type="color"
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={() => onChange(localValue)}
                className="absolute -top-2 -left-2 w-20 h-20 cursor-pointer"
            />
        </div>
    );
};

export default DebouncedColorInput;
