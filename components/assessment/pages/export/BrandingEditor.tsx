import React from 'react';
import type { BrandingConfig } from '../../../../types';
import { Palette, X, FileType, Layout, Home, Lock, User, Upload, Star, Sparkles, Type, MousePointerClick } from 'lucide-react';
import { DebouncedColorInput } from './DebouncedColorInput';
import { useToast } from '../../../../contexts/ToastContext';
import { MAX_LOGO_BYTES } from '../../../../data/brandingDefaults';

export const BrandingEditor: React.FC<{
  branding: BrandingConfig;
  onUpdate: (b: BrandingConfig) => void;
  onClose: () => void;
  onOpenProfile?: () => void;
}> = ({ branding, onUpdate, onClose, onOpenProfile }) => {
  const toast = useToast();

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      if (e.target.files[0].size > MAX_LOGO_BYTES) {
        toast.error(`Logo trop volumineux (maximum ${Math.round(MAX_LOGO_BYTES / 1024)} Ko).`);
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          onUpdate({ ...branding, logoUrl: ev.target.result as string });
        }
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-[var(--card-bg)] shadow-2xl z-[150] animate-in slide-in-from-right duration-300 flex flex-col no-print border-l border-[var(--border-color)]">
      <div className="p-6 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--card-bg-raised)]">
        <h3 className="font-serif font-bold text-xl text-[var(--text-heading)] flex items-center gap-2">
          <Palette size={24} className="text-[#E07A5F]" /> Studio Design
        </h3>
        <button
          onClick={onClose}
          className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] p-2 hover:bg-[var(--border-color)] rounded-full transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
        {/* 1. ACTIVATION */}
        <div className="flex items-center justify-between p-4 bg-[#E07A5F]/10 rounded-xl border border-[#E07A5F]/20">
          <span className="text-sm font-bold text-[#E07A5F]">Mode Personnalisé</span>
          <button
            onClick={() => onUpdate({ ...branding, isEnabled: !branding.isEnabled })}
            className={`w-12 h-6 rounded-full transition-colors relative ${branding.isEnabled ? 'bg-[#E07A5F]' : 'bg-[var(--border-color)]'}`}
          >
            <div
              className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform shadow-sm ${branding.isEnabled ? 'left-7' : 'left-1'}`}
            ></div>
          </button>
        </div>

        {branding.isEnabled && (
          <div className="space-y-8 animate-in fade-in slide-in-from-top-2">
            {/* --- TITRE DOCUMENT --- */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
                <FileType size={14} /> Titre du Document
              </label>
              <input
                value={branding.documentTitle || "Bilan d'Ergothérapie"}
                onChange={(e) => onUpdate({ ...branding, documentTitle: e.target.value })}
                placeholder="Bilan d'Ergothérapie"
                className="w-full p-3 text-sm border border-[var(--border-color)] rounded-xl bg-[var(--input-bg)] focus:bg-[var(--card-bg)] outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F] text-[var(--text-heading)] font-bold"
              />
            </div>

            <div className="w-full h-px bg-[var(--border-color)]"></div>

            {/* --- EN-TÊTE : LAYOUT SELECTOR --- */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
                  <Layout size={14} /> Structure En-tête
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={() => onUpdate({ ...branding, headerTemplate: 'classic', headerLayout: 'row', headerAlignment: 'left' })}
                  className={`p-3 rounded-xl border-2 transition-all flex flex-col gap-2 ${branding.headerTemplate === 'classic' ? 'border-[#E07A5F] bg-[#fff5f2]' : 'border-[var(--border-color)] bg-[var(--hover-bg)] hover:border-[var(--text-secondary)]'}`}
                >
                  <div className="w-full h-10 bg-[var(--card-bg)] rounded border border-[var(--border-color)] p-1 flex items-center gap-1">
                    <div className="w-4 h-4 bg-[var(--border-color)] rounded-sm"></div>
                    <div className="w-full h-2 bg-[var(--hover-bg)] rounded-sm"></div>
                  </div>
                  <span
                    className={`text-xs font-bold ${branding.headerTemplate === 'classic' ? 'text-[#E07A5F]' : 'text-[var(--text-secondary)]'}`}
                  >
                    Classique
                  </span>
                </button>

                <button
                  onClick={() => onUpdate({ ...branding, headerTemplate: 'corporate', headerLayout: 'row', headerAlignment: 'right' })}
                  className={`p-3 rounded-xl border-2 transition-all flex flex-col gap-2 ${branding.headerTemplate === 'corporate' ? 'border-[#E07A5F] bg-[#fff5f2]' : 'border-[var(--border-color)] bg-[var(--hover-bg)] hover:border-[var(--text-secondary)]'}`}
                >
                  <div className="w-full h-10 bg-[var(--card-bg)] rounded border border-[var(--border-color)] p-1 flex items-center justify-between gap-1">
                    <div className="w-1/2 h-2 bg-[var(--hover-bg)] rounded-sm"></div>
                    <div className="w-4 h-4 bg-[var(--border-color)] rounded-sm"></div>
                  </div>
                  <span
                    className={`text-xs font-bold ${branding.headerTemplate === 'corporate' ? 'text-[#E07A5F]' : 'text-[var(--text-secondary)]'}`}
                  >
                    Corporate
                  </span>
                </button>

                <button
                  onClick={() => onUpdate({ ...branding, headerTemplate: 'centered', headerLayout: 'column', headerAlignment: 'center' })}
                  className={`p-3 rounded-xl border-2 transition-all flex flex-col gap-2 ${branding.headerTemplate === 'centered' ? 'border-[#E07A5F] bg-[#fff5f2]' : 'border-[var(--border-color)] bg-[var(--hover-bg)] hover:border-[var(--text-secondary)]'}`}
                >
                  <div className="w-full h-10 bg-[var(--card-bg)] rounded border border-[var(--border-color)] p-1 flex flex-col items-center justify-center gap-1">
                    <div className="w-4 h-4 bg-[var(--border-color)] rounded-sm"></div>
                    <div className="w-2/3 h-1.5 bg-[var(--hover-bg)] rounded-sm"></div>
                  </div>
                  <span
                    className={`text-xs font-bold ${branding.headerTemplate === 'centered' ? 'text-[#E07A5F]' : 'text-[var(--text-secondary)]'}`}
                  >
                    Centré
                  </span>
                </button>
              </div>
            </div>

            {/* --- COORDONNÉES EN-TÊTE (enrichi, verrouillé) --- */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
                  <Home size={14} /> Coordonnées En-tête
                </label>
                <span className="text-[10px] bg-[var(--hover-bg)] text-[var(--text-secondary)] px-2 py-0.5 rounded font-bold uppercase">
                  <Lock size={8} className="inline mr-1" />
                  Sécurisé
                </span>
              </div>

              {/* Nom Principal (verrouillé) */}
              <div className="w-full p-3 text-sm border border-[var(--border-color)] rounded-xl bg-[var(--hover-bg)] text-[var(--text-heading)] select-none opacity-80">
                {branding.practitionerName || branding.cabinetName || 'Nom du praticien'}
              </div>

              {/* Sous-titre (verrouillé) */}
              <div className="w-full p-3 text-sm border border-[var(--border-color)] rounded-xl bg-[var(--hover-bg)] text-[var(--text-secondary)] select-none opacity-80">
                {branding.brandSubtitle || 'Ergothérapeute'}
              </div>

              {/* Données Vérifiées (Read-Only) */}
              <div className="bg-[var(--hover-bg)] p-3 rounded-xl border border-[var(--border-color)] select-none">
                <div className="flex items-center gap-1 mb-2">
                  <Lock size={10} className="text-[var(--text-secondary)]" />
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Détails Légaux (Auto-généré)</p>
                </div>
                <div className="text-[10px] text-[var(--text-secondary)] space-y-0.5">
                  {branding.practitionerName && <p className="font-bold">{branding.practitionerName}</p>}
                  {branding.phone && <p>{branding.phone}</p>}
                  {branding.email && <p>{branding.email}</p>}
                  {branding.siret && <p className="font-mono text-[var(--text-disabled)]">SIRET : {branding.siret}</p>}
                  {branding.address && <p className="text-[var(--text-disabled)]">{branding.address}</p>}
                </div>
              </div>

              <button
                onClick={() => onOpenProfile?.()}
                className="w-full text-[11px] text-[#E07A5F] hover:text-[#d0694e] text-center font-bold py-1.5 hover:underline transition-colors"
              >
                Modifier ces informations dans Mon Profil →
              </button>
            </div>

            {/* --- STYLE PATIENT --- */}
            <div>
              <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
                <User size={14} /> Bloc Patient
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => onUpdate({ ...branding, patientBlockStyle: 'modern' })}
                  className={`flex-1 p-2 rounded-lg border text-xs font-bold transition-all ${branding.patientBlockStyle === 'modern' ? 'bg-[#3D405B] text-white border-[#3D405B]' : 'bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'}`}
                >
                  Encadré (Défaut)
                </button>
                <button
                  onClick={() => onUpdate({ ...branding, patientBlockStyle: 'minimal' })}
                  className={`flex-1 p-2 rounded-lg border text-xs font-bold transition-all ${branding.patientBlockStyle === 'minimal' ? 'bg-[#3D405B] text-white border-[#3D405B]' : 'bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'}`}
                >
                  Minimaliste (Texte)
                </button>
              </div>
            </div>

            <div className="w-full h-px bg-[var(--border-color)]"></div>

            {/* --- LOGO --- */}
            <div>
              <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
                <Upload size={14} /> Logo Cabinet
              </label>

              <div className="flex items-center gap-4 mb-3">
                <div className="w-20 h-20 bg-[var(--hover-bg)] border-2 border-dashed border-[var(--border-color)] rounded-xl flex items-center justify-center overflow-hidden relative group hover:border-[#E07A5F] transition-colors cursor-pointer">
                  {branding.logoUrl ? (
                    <img src={branding.logoUrl} className="w-full h-full object-contain p-1" alt="Logo" width={80} height={80} />
                  ) : (
                    <div className="text-center text-[var(--text-disabled)] group-hover:text-[#E07A5F]">
                      <Upload size={20} className="mx-auto mb-1" />
                      <span className="text-[9px] font-bold">Ajouter</span>
                    </div>
                  )}
                  <input type="file" onChange={handleLogoUpload} accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-[var(--text-secondary)] mb-2 leading-relaxed">Format PNG (Fond transparent) conseillé.</p>
                  {branding.logoUrl && (
                    <button
                      onClick={() => onUpdate({ ...branding, logoUrl: undefined })}
                      className="text-xs text-rose-500 hover:underline font-bold"
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              </div>

              {/* Slider Taille Logo */}
              {branding.logoUrl && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Taille du logo</label>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-[var(--text-secondary)]">S</span>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="1"
                      value={branding.logoSize === 'small' ? 0 : branding.logoSize === 'medium' ? 1 : 2}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        onUpdate({ ...branding, logoSize: val === 0 ? 'small' : val === 1 ? 'medium' : 'large' });
                      }}
                      className="w-full h-2 bg-[var(--hover-bg)] rounded-lg appearance-none cursor-pointer accent-[#E07A5F]"
                    />
                    <span className="text-xs text-[var(--text-secondary)]">L</span>
                  </div>
                </div>
              )}
            </div>

            <div className="w-full h-px bg-[var(--border-color)]"></div>

            {/* --- STYLE TITRES (déplacé en fin) --- */}
            <div>
              <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
                <Star size={14} /> Style des Titres
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'simple', label: 'Simple' },
                  { id: 'underline', label: 'Souligné' },
                  { id: 'filled-shape', label: 'Formes', icon: Home },
                  { id: 'icon-star', label: 'Étoile', icon: Star },
                  { id: 'icon-sparkle', label: 'Sparkle', icon: Sparkles },
                ].map((style) => (
                  <button
                    key={style.id}
                    onClick={() => onUpdate({ ...branding, titleStyle: style.id as any })}
                    className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all flex items-center gap-2 ${branding.titleStyle === style.id ? 'bg-[#3D405B] text-white border-[#3D405B]' : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)] hover:bg-[var(--hover-bg)]'}`}
                  >
                    {style.icon && <style.icon size={12} />}
                    {style.label}
                  </button>
                ))}
              </div>
            </div>

            {/* --- PALETTE (déplacé en fin) --- */}
            <div>
              <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
                <Palette size={14} /> Palette
              </label>
              <div className="flex gap-4">
                <div className="flex-1">
                  <DebouncedColorInput value={branding.primaryColor} onChange={(val) => onUpdate({ ...branding, primaryColor: val })} />
                  <span className="text-[10px] text-[var(--text-secondary)] font-mono font-bold">Titres</span>
                </div>
                <div className="flex-1">
                  <DebouncedColorInput value={branding.secondaryColor} onChange={(val) => onUpdate({ ...branding, secondaryColor: val })} />
                  <span className="text-[10px] text-[var(--text-secondary)] font-mono font-bold">Accents</span>
                </div>
              </div>
            </div>

            {/* --- TYPOGRAPHIE (déplacé en fin) --- */}
            <div>
              <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
                <Type size={14} /> Typographie
              </label>
              <select
                value={branding.fontFamily}
                onChange={(e) => onUpdate({ ...branding, fontFamily: e.target.value as any })}
                className="w-full p-3 bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-[var(--text-heading)] outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
              >
                <option value="Merriweather">Merriweather</option>
                <option value="Quicksand">Quicksand</option>
                <option value="Roboto">Roboto</option>
                <option value="Playfair Display">Playfair Display</option>
                <option value="Open Sans">Open Sans</option>
                <option value="Lato">Lato</option>
              </select>
            </div>

            {/* --- PIED DE PAGE (déplacé en fin) --- */}
            <div className="space-y-3 pt-4 border-t border-[var(--border-color)]">
              <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1 flex items-center gap-2">
                <MousePointerClick size={14} /> Pied de page
              </label>
              <textarea
                value={branding.footerText || ''}
                onChange={(e) => onUpdate({ ...branding, footerText: e.target.value })}
                placeholder="Texte personnalisé (ex: Confidentiel)"
                rows={3}
                className="w-full p-3 text-sm border border-[var(--border-color)] rounded-xl bg-[var(--card-bg)] focus:bg-[var(--card-bg)] outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F] text-[var(--text-heading)] resize-y"
              />
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={branding.showPageNumbers}
                  onChange={(e) => onUpdate({ ...branding, showPageNumbers: e.target.checked })}
                  className="accent-[#E07A5F] w-4 h-4"
                />
                Afficher la numérotation des pages
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BrandingEditor;
