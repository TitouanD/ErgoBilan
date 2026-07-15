import React from 'react';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string;
    /** Optional left-aligned icon (e.g. from lucide-react), rendered inside the input. */
    icon?: React.ReactNode;
    /** Wrapper div className override (rarely needed). */
    wrapperClassName?: string;
    /** Input className override — use to reproduce a specific field's exact existing look. */
    inputClassName?: string;
}

const DEFAULT_LABEL_CLASSNAME = 'text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-1 tracking-wider';
const DEFAULT_INPUT_CLASSNAME = 'w-full mt-1 p-3 bg-[var(--input-bg)] rounded-xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] outline-none font-bold text-[var(--text-main)]';

/**
 * Shared label+input(+icon) field, capturing the input styling repeated across
 * profile/patient forms. Pass `inputClassName`/`wrapperClassName` to reproduce
 * a specific field's exact existing look if it differs from the common case.
 */
export const FormField: React.FC<FormFieldProps> = ({
    label,
    icon,
    wrapperClassName,
    inputClassName = DEFAULT_INPUT_CLASSNAME,
    ...inputProps
}) => (
    <div className={wrapperClassName}>
        <label className={DEFAULT_LABEL_CLASSNAME}>{label}</label>
        {icon ? (
            <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]">{icon}</span>
                <input
                    {...inputProps}
                    className={`pl-10 ${inputClassName.replace('mt-1 ', '')}`}
                />
            </div>
        ) : (
            <input {...inputProps} className={inputClassName} />
        )}
    </div>
);

export default FormField;
