
import React, { useState } from 'react';
import { Patient, ReportSection, TestData, BrandingConfig } from '../../types';
import { Download, Check, Palette, X, Upload, Palette as PaletteIcon, Type, Home, Crown, Lock, Layout, Maximize2, MousePointerClick, Square, Circle, AlignLeft, AlignCenter, AlignRight, Columns, Rows } from 'lucide-react';
import { ReportView } from './ReportView';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  patient: Patient;
  sections: ReportSection[];
  tests: TestData;
  onValidate: () => void;
  onUpdateSection: (sectionId: string, updates: Partial<ReportSection>) => void;
  branding: BrandingConfig;
  onUpdateBranding: (newBranding: BrandingConfig) => void;
  isPremium: boolean;
  onShowPricing: () => void;
}

const BrandingEditor: React.FC<{
    branding: BrandingConfig;
    onUpdate: (b: BrandingConfig) => void;
    onClose: () => void;
}> = ({ branding, onUpdate, onClose }) => {
    
    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
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
        <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl z-[60] animate-in slide-in-from-right duration-300 flex flex-col no-print border-l border-stone-200">
            <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-stone-50">
                <h3 className="font-serif font-bold text-xl text-[#3D405B] flex items-center gap-2">
                    <Palette size={24} className="text-[#E07A5F]" /> Studio Design
                </h3>
                <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-2 hover:bg-stone-200 rounded-full transition-colors"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                
                {/* 1. ACTIVATION */}
                <div className="flex items-center justify-between p-4 bg-[#fff5f2] rounded-xl border border-[#E07A5F]/20">
                    <span className="text-sm font-bold text-[#E07A5F]">Mode Personnalisé</span>
                    <button 
                        onClick={() => onUpdate({ ...branding, isEnabled: !branding.isEnabled })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${branding.isEnabled ? 'bg-[#E07A5F]' : 'bg-stone-300'}`}
                    >
                        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform shadow-sm ${branding.isEnabled ? 'left-7' : 'left-1'}`}></div>
                    </button>
                </div>

                {branding.isEnabled && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-top-2">
                        
                        {/* --- EN-TÊTE : CONFIGURATION --- */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-2"><Layout size={14}/> Structure En-tête</label>
                            </div>
                            
                            <div className="flex gap-2 p-1 bg-stone-100 rounded-lg mb-4">
                                <button 
                                    onClick={() => onUpdate({...branding, headerLayout: 'row'})}
                                    className={`flex-1 py-2 text-xs font-bold rounded-md flex items-center justify-center gap-2 transition-all ${branding.headerLayout === 'row' ? 'bg-white shadow-sm text-[#3D405B]' : 'text-stone-400'}`}
                                >
                                    <Columns size={12}/> Classique (Ligne)
                                </button>
                                <button 
                                    onClick={() => onUpdate({...branding, headerLayout: 'column'})}
                                    className={`flex-1 py-2 text-xs font-bold rounded-md flex items-center justify-center gap-2 transition-all ${branding.headerLayout === 'column' ? 'bg-white shadow-sm text-[#3D405B]' : 'text-stone-400'}`}
                                >
                                    <Rows size={12}/> Moderne (Empilé)
                                </button>
                            </div>

                            <div className="flex gap-2">
                                <button 
                                    onClick={() => onUpdate({...branding, headerAlignment: 'left'})}
                                    className={`flex-1 py-2 rounded-lg border flex items-center justify-center transition-all ${branding.headerAlignment === 'left' ? 'border-[#E07A5F] bg-[#E07A5F]/10 text-[#E07A5F]' : 'border-stone-200 text-stone-400 hover:bg-stone-50'}`}
                                >
                                    <AlignLeft size={16} />
                                </button>
                                <button 
                                    onClick={() => onUpdate({...branding, headerAlignment: 'center'})}
                                    className={`flex-1 py-2 rounded-lg border flex items-center justify-center transition-all ${branding.headerAlignment === 'center' ? 'border-[#E07A5F] bg-[#E07A5F]/10 text-[#E07A5F]' : 'border-stone-200 text-stone-400 hover:bg-stone-50'}`}
                                >
                                    <AlignCenter size={16} />
                                </button>
                                <button 
                                    onClick={() => onUpdate({...branding, headerAlignment: 'right'})}
                                    className={`flex-1 py-2 rounded-lg border flex items-center justify-center transition-all ${branding.headerAlignment === 'right' ? 'border-[#E07A5F] bg-[#E07A5F]/10 text-[#E07A5F]' : 'border-stone-200 text-stone-400 hover:bg-stone-50'}`}
                                >
                                    <AlignRight size={16} />
                                </button>
                            </div>
                        </div>

                        {/* --- LOGO --- */}
                        <div>
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3 block flex items-center gap-2"><Upload size={14}/> Logo Cabinet</label>
                            
                            <div className="flex items-center gap-4 mb-3">
                                <div className="w-20 h-20 bg-stone-50 border-2 border-dashed border-stone-200 rounded-xl flex items-center justify-center overflow-hidden relative group hover:border-[#E07A5F] transition-colors cursor-pointer">
                                    {branding.logoUrl ? (
                                        <img src={branding.logoUrl} className="w-full h-full object-contain p-1" alt="Logo" />
                                    ) : (
                                        <div className="text-center text-stone-300 group-hover:text-[#E07A5F]">
                                            <Upload size={20} className="mx-auto mb-1" />
                                            <span className="text-[9px] font-bold">Ajouter</span>
                                        </div>
                                    )}
                                    <input type="file" onChange={handleLogoUpload} accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs text-stone-500 mb-2 leading-relaxed">Format PNG (Fond transparent) conseillé.</p>
                                    {branding.logoUrl && (
                                        <button onClick={() => onUpdate({ ...branding, logoUrl: undefined })} className="text-xs text-rose-500 hover:underline font-bold">Supprimer</button>
                                    )}
                                </div>
                            </div>

                            {/* Slider Taille Logo */}
                            {branding.logoUrl && (
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-stone-400 uppercase">Taille du logo</label>
                                    <div className="flex items-center gap-4">
                                        <span className="text-xs text-stone-400">S</span>
                                        <input 
                                            type="range" min="0" max="2" step="1" 
                                            value={branding.logoSize === 'small' ? 0 : branding.logoSize === 'medium' ? 1 : 2}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                onUpdate({...branding, logoSize: val === 0 ? 'small' : val === 1 ? 'medium' : 'large'});
                                            }}
                                            className="w-full h-2 bg-stone-100 rounded-lg appearance-none cursor-pointer accent-[#E07A5F]"
                                        />
                                        <span className="text-xs text-stone-400">L</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="w-full h-px bg-stone-100"></div>

                        {/* --- COULEURS --- */}
                        <div>
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3 block flex items-center gap-2"><PaletteIcon size={14}/> Palette</label>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <div className="h-10 rounded-lg border border-stone-200 relative overflow-hidden mb-1 shadow-sm">
                                        <input 
                                            type="color" 
                                            value={branding.primaryColor} 
                                            onChange={(e) => onUpdate({ ...branding, primaryColor: e.target.value })}
                                            className="absolute -top-2 -left-2 w-20 h-20 cursor-pointer"
                                        />
                                    </div>
                                    <span className="text-[10px] text-stone-500 font-mono font-bold">Titres</span>
                                </div>
                                <div className="flex-1">
                                    <div className="h-10 rounded-lg border border-stone-200 relative overflow-hidden mb-1 shadow-sm">
                                        <input 
                                            type="color" 
                                            value={branding.secondaryColor} 
                                            onChange={(e) => onUpdate({ ...branding, secondaryColor: e.target.value })}
                                            className="absolute -top-2 -left-2 w-20 h-20 cursor-pointer"
                                        />
                                    </div>
                                    <span className="text-[10px] text-stone-500 font-mono font-bold">Accents</span>
                                </div>
                            </div>
                        </div>

                        {/* --- POLICE --- */}
                        <div>
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3 block flex items-center gap-2"><Type size={14}/> Typographie</label>
                            <select 
                                value={branding.fontFamily}
                                onChange={(e) => onUpdate({ ...branding, fontFamily: e.target.value as any })}
                                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold text-[#3D405B] outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                            >
                                <option value="Merriweather">Merriweather (Sérif, Élégant)</option>
                                <option value="Quicksand">Quicksand (Sans-Sérif, Moderne)</option>
                                <option value="Roboto">Roboto (Neutre, Pro)</option>
                                <option value="Playfair Display">Playfair (Luxe, Titres)</option>
                                <option value="Open Sans">Open Sans (Lisible, Web)</option>
                                <option value="Lato">Lato (Arrondi, Doux)</option>
                            </select>
                        </div>

                        <div className="w-full h-px bg-stone-100"></div>

                        {/* --- INFOS PRATICIEN --- */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 block flex items-center gap-2"><Home size={14}/> Coordonnées</label>
                            
                            <input 
                                value={branding.cabinetName}
                                onChange={(e) => onUpdate({ ...branding, cabinetName: e.target.value })}
                                placeholder="Nom du Cabinet"
                                className="w-full p-3 text-sm border border-stone-200 rounded-xl bg-white focus:bg-white outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F] text-[#3D405B]"
                            />
                            <input 
                                value={branding.practitionerName}
                                onChange={(e) => onUpdate({ ...branding, practitionerName: e.target.value })}
                                placeholder="Nom du Praticien"
                                className="w-full p-3 text-sm border border-stone-200 rounded-xl bg-white focus:bg-white outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F] text-[#3D405B]"
                            />
                            <textarea 
                                value={branding.address}
                                onChange={(e) => onUpdate({ ...branding, address: e.target.value })}
                                placeholder="Adresse complète"
                                rows={2}
                                className="w-full p-3 text-sm border border-stone-200 rounded-xl bg-white focus:bg-white outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F] text-[#3D405B] resize-none"
                            />
                            <div className="flex gap-2">
                                <input 
                                    value={branding.email || ''}
                                    onChange={(e) => onUpdate({ ...branding, email: e.target.value })}
                                    placeholder="Email"
                                    className="w-full p-3 text-sm border border-stone-200 rounded-xl bg-white focus:bg-white outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F] text-[#3D405B]"
                                />
                                <input 
                                    value={branding.phone || ''}
                                    onChange={(e) => onUpdate({ ...branding, phone: e.target.value })}
                                    placeholder="Tel"
                                    className="w-full p-3 text-sm border border-stone-200 rounded-xl bg-white focus:bg-white outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F] text-[#3D405B]"
                                />
                            </div>
                            <input 
                                value={branding.siret || ''}
                                onChange={(e) => onUpdate({ ...branding, siret: e.target.value })}
                                placeholder="N° SIRET"
                                className="w-full p-3 text-sm border border-stone-200 rounded-xl bg-white focus:bg-white outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F] font-mono text-xs text-[#3D405B]"
                            />
                        </div>

                        {/* --- PIED DE PAGE --- */}
                        <div className="space-y-3 pt-4 border-t border-stone-100">
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 block flex items-center gap-2"><MousePointerClick size={14}/> Pied de page</label>
                            <input 
                                value={branding.footerText || ''}
                                onChange={(e) => onUpdate({ ...branding, footerText: e.target.value })}
                                placeholder="Texte personnalisé (ex: Confidentiel)"
                                className="w-full p-3 text-sm border border-stone-200 rounded-xl bg-white focus:bg-white outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F] text-[#3D405B]"
                            />
                            <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer">
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

export const Step5Export: React.FC<Props> = ({ patient, sections, tests, onValidate, onUpdateSection, branding, onUpdateBranding, isPremium, onShowPricing }) => {
  const [showEditor, setShowEditor] = useState(false);
  const toast = useToast();

  const handleDownloadPDF = () => {
      const reportContent = document.getElementById('printable-report');
      if (!reportContent) return;

      const printWindow = window.open('', '_blank', 'width=1000,height=1200');
      if (!printWindow) {
          toast.error("Veuillez autoriser les popups pour générer le PDF.");
          return;
      }

      // Styles
      const styles = Array.from(document.styleSheets)
        .map(styleSheet => {
            try {
                return Array.from(styleSheet.cssRules).map(rule => rule.cssText).join('');
            } catch (e) {
                return '';
            }
        }).join('');

        const fontLinks = `
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@300;400;500;600;700&family=Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900&family=Roboto:wght@300;400;500;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Open+Sans:wght@400;600;700&family=Lato:wght@400;700&display=swap" rel="stylesheet">
        `;

      printWindow.document.write(`
        <html>
          <head>
            <title>Bilan - ${patient.firstName} ${patient.lastName}</title>
            ${fontLinks}
            <style>
              ${styles}
              body { background-color: white; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
              @page { margin: 0; size: A4; }
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            </style>
          </head>
          <body>
            ${reportContent.outerHTML}
            <script>
              window.onload = function() {
                  setTimeout(function() {
                      window.print();
                      window.close();
                  }, 800);
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
  };

  const toggleEditor = () => {
      if (isPremium) {
          setShowEditor(!showEditor);
      } else {
          onShowPricing(); 
      }
  };

  return (
    <div className="min-h-screen bg-[#333333] pb-20 pt-10 relative">
      
      {/* Barre d'outils flottante */}
      <div className="fixed top-24 right-8 flex flex-col gap-3 z-50 no-print animate-in slide-in-from-right duration-500">
        
        <button onClick={toggleEditor} className={`w-14 h-14 rounded-full shadow-xl border flex items-center justify-center transition-all hover:scale-110 group tooltip relative ${isPremium ? 'bg-white text-[#3D405B] border-stone-200 hover:text-[#E07A5F] hover:border-[#E07A5F]' : 'bg-stone-100 text-stone-300 border-stone-200 cursor-pointer'}`} title="Personnaliser le thème">
            <Palette size={24} />
            {!isPremium && <div className="absolute -top-1 -right-1 bg-[#E07A5F] text-white rounded-full p-1 shadow-sm"><Lock size={10} /></div>}
            <span className="absolute right-16 bg-[#3D405B] text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-bold">{isPremium ? "Personnaliser le Thème" : "Personnalisation (Premium)"}</span>
        </button>

        <button onClick={handleDownloadPDF} className="w-14 h-14 bg-white text-[#3D405B] rounded-full shadow-xl border border-stone-200 flex items-center justify-center hover:text-[#E07A5F] hover:border-[#E07A5F] transition-all hover:scale-110 group tooltip" title="Télécharger en PDF">
            <Download size={24} />
            <span className="absolute right-16 bg-[#3D405B] text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-bold">Télécharger PDF</span>
        </button>

        <button onClick={onValidate} className="w-14 h-14 bg-[#4a0418] text-white rounded-full shadow-xl shadow-rose-900/30 flex items-center justify-center hover:bg-emerald-600 transition-all hover:scale-110 group tooltip" title="Valider et Archiver">
            <Check size={24} />
            <span className="absolute right-16 bg-emerald-600 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-bold">Valider & Terminer</span>
        </button>
      </div>

      <div className="max-w-[210mm] mx-auto mb-6 text-center space-y-2 no-print">
        <h2 className="text-3xl font-serif font-bold text-white">Aperçu Avant Impression</h2>
        <p className="text-stone-400 text-sm">Vérifiez la mise en page. Utilisez les flèches pour ajuster les sauts de page.</p>
        
        {!isPremium && (
            <div onClick={onShowPricing} className="mt-4 mx-auto max-w-lg bg-white/10 backdrop-blur border border-white/20 rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-white/20 transition-colors group">
                <div className="flex items-center gap-3 text-white">
                    <Crown size={20} className="text-[#F2CC8F]" />
                    <div className="text-left"><p className="font-bold text-sm">Passer en Premium</p><p className="text-[10px] opacity-80">Supprimez le logo AutoBilan et mettez le vôtre.</p></div>
                </div>
                <button className="bg-[#E07A5F] text-white px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider group-hover:scale-105 transition-transform">Voir l'offre</button>
            </div>
        )}
      </div>

      {/* Zone de l'aperçu A4 Centré */}
      <div className="flex justify-center mb-20 overflow-visible transition-all duration-500" style={{ marginRight: showEditor ? '384px' : '0' }}>
          <ReportView 
              patient={patient} 
              sections={sections} 
              tests={tests} 
              onUpdateSection={onUpdateSection}
              branding={branding}
          />
      </div>

      {showEditor && <BrandingEditor branding={branding} onUpdate={onUpdateBranding} onClose={() => setShowEditor(false)} />}
    </div>
  );
};
