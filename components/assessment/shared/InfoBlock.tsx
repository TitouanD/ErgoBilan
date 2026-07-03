import React from 'react';
import { Lock, Phone, Mail, Building, MapPin } from 'lucide-react';
import { BrandingConfig, InfoBlock as InfoBlockType, InfoBlockExtraLine } from '../../../types';

interface InfoBlockProps {
    branding: BrandingConfig;
    /** In print/PDF mode: hide editor chrome (lock icon badge) */
    isPrint?: boolean;
}

const sizeMap = {
    S: { text: 'text-[9px]', padding: 'p-2', gap: 'gap-0.5' },
    M: { text: 'text-[10px]', padding: 'p-3', gap: 'gap-1' },
    L: { text: 'text-xs', padding: 'p-4', gap: 'gap-1.5' },
};

/**
 * The InfoBlock card displays protected practitioner contact info
 * plus any user-defined extra lines. Text content is locked
 * (sourced directly from BrandingConfig, cannot be edited here).
 */
export const InfoBlock: React.FC<InfoBlockProps> = ({ branding, isPrint = false }) => {
    const cfg: InfoBlockType = branding.infoBlock ?? {
        position: 'right',
        size: 'M',
        bgColor: '#FAFAF9',
        borderColor: '#E7E5E4',
        extraLines: [],
    };

    const sz = sizeMap[cfg.size] ?? sizeMap['M'];

    /** Extra lines inserted after a given anchor */
    const extrasAfter = (anchor: InfoBlockExtraLine['after']) =>
        cfg.extraLines.filter(l => l.after === anchor).map(l => (
            <p key={l.id} className={`${sz.text} text-stone-600 leading-tight`}>{l.text}</p>
        ));

    const hasAnyInfo = branding.practitionerName || branding.phone || branding.email ||
        branding.siret || branding.address;

    if (!hasAnyInfo) return null;

    return (
        <div
            className={`relative inline-block min-w-[140px] ${sz.padding} rounded-lg border leading-snug`}
            style={{ backgroundColor: cfg.bgColor, borderColor: cfg.borderColor }}
        >
            {/* Lock badge — hidden when printing */}
            {!isPrint && (
                <div className="absolute -top-2 -right-2 bg-stone-200 rounded-full p-0.5 no-print print:hidden" title="Coordonnées protégées">
                    <Lock size={8} className="text-stone-500" />
                </div>
            )}

            <div className={`flex flex-col ${sz.gap}`}>
                {extrasAfter('top')}

                {branding.practitionerName && (
                    <p className={`${sz.text} font-bold text-stone-800 leading-tight`}>{branding.practitionerName}</p>
                )}
                {extrasAfter('name')}

                {branding.phone && (
                    <p className={`${sz.text} text-stone-600 leading-tight flex items-center gap-1`}>
                        <Phone size={8} className="shrink-0" />{branding.phone}
                    </p>
                )}
                {extrasAfter('phone')}

                {branding.email && (
                    <p className={`${sz.text} text-stone-600 leading-tight flex items-center gap-1`}>
                        <Mail size={8} className="shrink-0" />{branding.email}
                    </p>
                )}
                {extrasAfter('email')}

                {branding.siret && (
                    <p className={`${sz.text} text-stone-500 leading-tight flex items-center gap-1`}>
                        <Building size={8} className="shrink-0" />SIRET : {branding.siret}
                    </p>
                )}
                {extrasAfter('siret')}

                {branding.address && (
                    <p className={`${sz.text} text-stone-500 leading-tight flex items-center gap-1`}>
                        <MapPin size={8} className="shrink-0" />{branding.address}
                    </p>
                )}
                {extrasAfter('address')}
            </div>
        </div>
    );
};

export default InfoBlock;
