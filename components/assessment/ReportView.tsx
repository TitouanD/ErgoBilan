
import React, { useState, useRef, useEffect } from 'react';
import { Patient, ReportSection, TestData, ReportAttachment, BrandingConfig } from '../../types';
import { GaussianChart } from '../shared/GaussianChart';
import { SCALES } from '../../utils/scoring';
import { FileText, ClipboardList, Plus, Image as ImageIcon, LayoutTemplate, X, Trash2, Edit2, Check, Upload, MapPin, Mail, Phone, ArrowDown, ArrowUp, ArrowRight, ArrowLeft, Move } from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';

interface Props {
  patient: Patient;
  sections: ReportSection[];
  tests: TestData;
  onUpdateSection?: (sectionId: string, updates: Partial<ReportSection>) => void;
  branding?: BrandingConfig;
}

// Helper pour le gras (**text**)
const parseBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-inherit">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
};

const CaptionEditor: React.FC<{ 
    initialValue: string; 
    onSave: (val: string) => void; 
}> = ({ initialValue, onSave }) => {
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    return (
        <textarea 
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => onSave(value)}
            className="w-full bg-transparent border border-transparent hover:border-stone-200 outline-none text-sm text-stone-700 italic resize-none focus:bg-white focus:ring-2 focus:ring-[#E07A5F]/20 focus:border-[#E07A5F]/20 rounded p-2 transition-all leading-relaxed print:resize-none print:border-none print:p-0"
            rows={4}
            placeholder="Ajoutez une légende..."
        />
    );
};

export const ReportView: React.FC<Props> = ({ patient, sections, tests, onUpdateSection, branding }) => {
  const { catalog } = useCatalog();
  const getSection = (id: string) => sections.find(s => s.id === id);

  // --- STATE DE MISE EN PAGE (PAGINATION DYNAMIQUE) ---
  // On définit quelles sections sont sur quelle page.
  // 'annexes' est un ID virtuel pour le bloc de graphiques.
  const [pages, setPages] = useState<string[][]>([
      ['mandat_ref', 'mandat_eval', 'profil'], // Page 1
      ['diagnostic', 'objectifs', 'recommandations'], // Page 2
      ['annexes'] // Page 3
  ]);

  // Fonction de déplacement (Item 3)
  const moveSection = (sectionId: string, fromPageIdx: number, direction: 'up' | 'down' | 'next' | 'prev') => {
      const newPages = [...pages.map(p => [...p])]; // Deep copy
      const page = newPages[fromPageIdx];
      const sectionIdx = page.indexOf(sectionId);
      
      if (sectionIdx === -1) return;

      if (direction === 'up' && sectionIdx > 0) {
          // Swap avec l'élément du dessus
          [page[sectionIdx], page[sectionIdx - 1]] = [page[sectionIdx - 1], page[sectionIdx]];
      } 
      else if (direction === 'down' && sectionIdx < page.length - 1) {
          // Swap avec l'élément du dessous
          [page[sectionIdx], page[sectionIdx + 1]] = [page[sectionIdx + 1], page[sectionIdx]];
      }
      else if (direction === 'next') {
          // Déplacer vers la page suivante
          page.splice(sectionIdx, 1); // Retirer de la page actuelle
          
          if (fromPageIdx + 1 < newPages.length) {
              // Ajouter au début de la page suivante
              newPages[fromPageIdx + 1].unshift(sectionId);
          } else {
              // Créer une nouvelle page
              newPages.push([sectionId]);
          }
      }
      else if (direction === 'prev' && fromPageIdx > 0) {
          // Déplacer vers la page précédente
          page.splice(sectionIdx, 1);
          newPages[fromPageIdx - 1].push(sectionId);
      }

      // Nettoyage des pages vides (sauf la première)
      const cleanedPages = newPages.filter((p, idx) => idx === 0 || p.length > 0);
      setPages(cleanedPages);
  };

  // STYLE DYNAMIQUE (BRANDING)
  const isCustom = branding?.isEnabled;
  const primaryColor = isCustom ? branding.primaryColor : '#3D405B';
  const secondaryColor = isCustom ? branding.secondaryColor : '#E07A5F';
  const fontFamily = isCustom ? branding.fontFamily : 'Merriweather';
  const corners = isCustom ? branding.cornerStyle : 'rounded';
  const headerLayout = isCustom ? branding.headerLayout : 'row';
  const headerAlign = isCustom ? branding.headerAlignment : 'left';
  const logoSize = isCustom ? branding.logoSize : 'medium';

  const roundedClass = corners === 'sharp' ? 'rounded-none' : corners === 'rounded' ? 'rounded-xl' : 'rounded-2xl';
  const titleStyle = { fontFamily, color: primaryColor };
  const accentStyle = { color: secondaryColor };

  // --- SOUS-COMPOSANTS ---

  const ControlBar = ({ sectionId, pageIdx, isFirst, isLast }: { sectionId: string, pageIdx: number, isFirst: boolean, isLast: boolean }) => {
      // Ne pas afficher les contrôles à l'impression
      if(!onUpdateSection) return null; // Mode lecture seule

      return (
          <div className="absolute -left-12 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity no-print z-50">
              <div className="bg-stone-800 text-white rounded-lg p-1 shadow-lg flex flex-col gap-1">
                  <button 
                    onClick={() => moveSection(sectionId, pageIdx, 'prev')}
                    disabled={pageIdx === 0}
                    className="p-1 hover:bg-stone-600 rounded disabled:opacity-30" 
                    title="Déplacer vers la page précédente"
                  >
                      <ArrowUp size={14} />
                  </button>
                  <button 
                    onClick={() => moveSection(sectionId, pageIdx, 'next')}
                    className="p-1 hover:bg-stone-600 rounded disabled:opacity-30" 
                    title="Déplacer vers la page suivante"
                  >
                      <ArrowDown size={14} />
                  </button>
                  <div className="h-px bg-stone-600 my-0.5"></div>
                  <button 
                    onClick={() => moveSection(sectionId, pageIdx, 'up')}
                    disabled={isFirst}
                    className="p-1 hover:bg-stone-600 rounded disabled:opacity-30"
                    title="Monter"
                  >
                      <ArrowUp size={10} />
                  </button>
                  <button 
                    onClick={() => moveSection(sectionId, pageIdx, 'down')}
                    disabled={isLast}
                    className="p-1 hover:bg-stone-600 rounded disabled:opacity-30"
                    title="Descendre"
                  >
                      <ArrowDown size={10} />
                  </button>
              </div>
          </div>
      );
  };

  const InteractiveSection = ({ sectionId, pageIdx, indexInPage, totalInPage }: { sectionId: string, pageIdx: number, indexInPage: number, totalInPage: number }) => {
      const section = getSection(sectionId);
      if (!section) return null;

      const paragraphs = (section.content || '').split('\n').filter(line => line.trim().length > 0);
      const [editingIndex, setEditingIndex] = useState<number | null>(null);
      const [tempText, setTempText] = useState('');
      const fileInputRef = useRef<HTMLInputElement>(null);
      const [insertIndex, setInsertIndex] = useState<number | null>(null);
      const [insertType, setInsertType] = useState<'image-full' | 'image-text'>('image-full');

      // Handlers (Text Edit, Images...) - Identiques à la version précédente
      const handleTextClick = (index: number, text: string) => { if (!onUpdateSection) return; setEditingIndex(index); setTempText(text); };
      const saveText = (index: number) => { if (!onUpdateSection) return; const newParagraphs = [...paragraphs]; newParagraphs[index] = tempText; onUpdateSection(section.id, { content: newParagraphs.join('\n\n') }); setEditingIndex(null); };
      const triggerFileSelect = (type: 'image-full' | 'image-text') => { setInsertType(type); fileInputRef.current?.click(); };
      const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files[0] && insertIndex !== null && onUpdateSection) { const file = e.target.files[0]; const url = URL.createObjectURL(file); const newAttachment: ReportAttachment = { id: Date.now().toString(), type: insertType, url: url, caption: insertType === 'image-text' ? "Notez ici vos observations..." : undefined, positionIndex: insertIndex }; const currentAttachments = section.attachments || []; onUpdateSection(section.id, { attachments: [...currentAttachments, newAttachment] }); setInsertIndex(null); if (fileInputRef.current) fileInputRef.current.value = ''; } };
      const updateCaption = (aid: string, val: string) => { if (!onUpdateSection) return; onUpdateSection(section.id, { attachments: (section.attachments || []).map(a => a.id === aid ? { ...a, caption: val } : a) }); };
      const removeAttachment = (aid: string) => { if (!onUpdateSection) return; onUpdateSection(section.id, { attachments: (section.attachments || []).filter(a => a.id !== aid) }); };

      return (
          <div className="mb-8 relative group">
              <ControlBar sectionId={sectionId} pageIdx={pageIdx} isFirst={indexInPage === 0} isLast={indexInPage === totalInPage - 1} />
              
              <SectionTitle title={section.title} />
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />

              <div className="space-y-2">
                  {paragraphs.map((para, idx) => {
                      const attachmentsHere = section.attachments?.filter(a => a.positionIndex === idx) || [];
                      const isEditing = editingIndex === idx;
                      let textStyle = "text-stone-700 leading-relaxed text-sm text-justify mb-2";
                      let content = para;
                      if (para.startsWith('## ')) { textStyle = "text-lg font-bold mt-6 mb-2 uppercase border-b pb-1 border-stone-100"; }
                      else if (para.startsWith('### ')) { textStyle = "text-md font-bold text-stone-800 mt-4 mb-1"; content = para.replace('### ', ''); }
                      else if (para.startsWith('- ') || para.startsWith('* ')) { textStyle = "text-stone-700 leading-relaxed text-sm text-justify ml-4 list-item list-disc marker:text-stone-800"; content = para.replace(/^[\*\-]\s+/, ''); }

                      return (
                          <div key={idx} className="relative group/block">
                              {isEditing ? (
                                  <div className="relative mb-4 print:hidden">
                                      <textarea value={tempText} onChange={(e) => setTempText(e.target.value)} className={`w-full p-4 border-2 border-[#E07A5F] ${roundedClass} shadow-lg outline-none text-sm min-h-[150px] bg-white text-stone-900 font-medium leading-relaxed resize-y`} autoFocus />
                                      <div className="flex justify-end gap-2 mt-2 absolute bottom-3 right-3">
                                          <button onClick={() => setEditingIndex(null)} className="p-1.5 bg-stone-100 rounded-md shadow text-stone-500"><X size={14}/></button>
                                          <button onClick={() => saveText(idx)} className="p-1.5 bg-[#E07A5F] rounded-md shadow text-white"><Check size={14}/></button>
                                      </div>
                                  </div>
                              ) : (
                                  <div onClick={() => handleTextClick(idx, para)} className={`${textStyle} ${onUpdateSection ? 'cursor-text hover:bg-[#fff5f2] rounded px-2 -mx-2 py-1 -my-1 transition-colors relative border border-transparent hover:border-[#E07A5F]/20 print:border-none' : ''}`} style={para.startsWith('## ') ? { color: primaryColor, fontFamily } : {}}>
                                      {parseBold(content.replace('## ', ''))}
                                      {onUpdateSection && <Edit2 size={12} className="absolute top-1 right-1 text-[#E07A5F] opacity-0 group-hover/block:opacity-100 print:hidden" />}
                                  </div>
                              )}
                              {attachmentsHere.map(att => (
                                  <div key={att.id} className="relative group my-6 break-inside-avoid">
                                      {att.type === 'image-full' ? (
                                          <img src={att.url} alt="" className={`w-full max-h-[400px] object-contain ${roundedClass} border border-stone-200 bg-stone-50 print:border-none`} />
                                      ) : (
                                          <div className={`flex gap-6 items-start bg-stone-50 p-4 ${roundedClass} border border-stone-100 print:bg-transparent print:border-none print:p-0`}>
                                              <img src={att.url} alt="" className={`w-1/2 h-auto shadow-sm bg-white border border-stone-100 print:border-none ${roundedClass}`} />
                                              <div className="w-1/2 pt-1">{onUpdateSection ? <CaptionEditor initialValue={att.caption || ''} onSave={(val) => updateCaption(att.id, val)} /> : <p className="text-sm text-stone-600 italic text-justify">{att.caption}</p>}</div>
                                          </div>
                                      )}
                                      {onUpdateSection && <button onClick={() => removeAttachment(att.id)} className="absolute top-2 right-2 bg-white/90 text-rose-500 p-2 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity no-print"><Trash2 size={16} /></button>}
                                  </div>
                              ))}
                              {onUpdateSection && (
                                  <div className="h-4 -my-2 relative z-10 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center group/insert no-print print:hidden">
                                      <div className="w-full h-px bg-[#E07A5F]/20 group-hover/insert:bg-[#E07A5F]/50 transition-colors"></div>
                                      {insertIndex === idx ? (
                                          <div className="absolute bg-white shadow-xl border border-stone-100 rounded-xl p-2 flex gap-2 animate-in zoom-in-95 duration-200 z-50">
                                              <button onClick={() => triggerFileSelect('image-full')} className="flex flex-col items-center gap-1 p-2 hover:bg-stone-50 rounded-lg text-xs font-bold text-stone-500 hover:text-[#E07A5F]"><div className="p-2 bg-stone-100 rounded-lg text-stone-400 group-hover:text-[#E07A5F]"><ImageIcon size={18}/></div>Img</button>
                                              <div className="w-px bg-stone-100"></div>
                                              <button onClick={() => triggerFileSelect('image-text')} className="flex flex-col items-center gap-1 p-2 hover:bg-stone-50 rounded-lg text-xs font-bold text-stone-500 hover:text-[#E07A5F]"><div className="p-2 bg-stone-100 rounded-lg text-stone-400 group-hover:text-[#E07A5F]"><LayoutTemplate size={18}/></div>Img+Txt</button>
                                              <button onClick={() => setInsertIndex(null)} className="absolute -top-2 -right-2 bg-white rounded-full p-1 border border-stone-100 shadow-sm text-stone-400"><X size={12}/></button>
                                          </div>
                                      ) : (
                                          <button onClick={() => setInsertIndex(idx)} className="absolute bg-white border border-[#E07A5F] text-[#E07A5F] rounded-full p-1 shadow-sm hover:scale-110 transition-transform"><Plus size={14} strokeWidth={3} /></button>
                                      )}
                                  </div>
                              )}
                          </div>
                      );
                  })}
              </div>
          </div>
      );
  };

  const SectionTitle = ({ title }: { title: string }) => (
      <div className="flex items-center gap-3 mb-6 pb-2 border-b-2" style={{ borderColor: isCustom ? primaryColor + '20' : '#E5E7EB' }}>
          <div className={`p-1.5 ${roundedClass} ${isCustom ? '' : 'bg-stone-100 text-stone-500'}`} style={isCustom ? { backgroundColor: primaryColor + '15', color: primaryColor } : {}}>
              <FileText size={20} />
          </div>
          <h2 className="text-xl font-bold uppercase tracking-wide" style={titleStyle}>{title}</h2>
      </div>
  );

  const AnnexesSection = ({ pageIdx, indexInPage, totalInPage }: { pageIdx: number, indexInPage: number, totalInPage: number }) => (
      <div className="relative group mb-8">
          <ControlBar sectionId="annexes" pageIdx={pageIdx} isFirst={indexInPage === 0} isLast={indexInPage === totalInPage - 1} />
          <section>
            <div className="flex items-center justify-center gap-3 mb-8">
                <div style={accentStyle}><ClipboardList size={24} /></div>
                <h2 className="text-xl font-bold uppercase tracking-wide" style={titleStyle}>Annexes : Résultats Chiffrés</h2>
            </div>
            <div className={`mb-8 p-4 bg-stone-50 border border-stone-200 text-xs ${roundedClass}`}>
                <p className="font-bold mb-2">Guide de lecture :</p>
                <ul className="list-disc ml-4 space-y-1">
                    <li><span className="font-bold text-[#81B29A]">Vert :</span> Dans la moyenne (-1 à +1 ET).</li>
                    <li><span className="font-bold text-[#F2CC8F]">Orange :</span> Zone de fragilité (-1 à -2 ET).</li>
                    <li><span className="font-bold text-[#E07A5F]">Rouge :</span> Zone de difficulté (Inférieur à -2 ET).</li>
                </ul>
            </div>
            <div className="space-y-12">
                {Object.entries(tests).map(([testId, subtests]) => {
                    const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
                    if (!def) return null;
                    const validSubtests = Object.entries(subtests).filter(([, val]) => val.status === 'validated');
                    if (validSubtests.length === 0) return null;
                    return (
                        <div key={testId} className={`break-inside-avoid bg-white border border-stone-200 overflow-hidden shadow-sm ${roundedClass}`}>
                            <div className="bg-stone-100 p-4 border-b border-stone-200 flex justify-between items-center" style={{ backgroundColor: isCustom ? primaryColor + '08' : undefined }}>
                                <h3 className="font-bold text-lg" style={titleStyle}>{def.name}</h3>
                                <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">{validSubtests.length} épreuves</span>
                            </div>
                            <div className="p-6">
                                <table className="w-full border-collapse text-sm mb-8">
                                    <thead><tr className="border-b-2 border-stone-100 text-left text-xs font-bold text-stone-400 uppercase tracking-wider"><th className="pb-3 w-1/3">Épreuves</th><th className="pb-3 w-1/4 text-center">Note Standard / ET</th><th className="pb-3 w-1/3 pl-6">Observations</th></tr></thead>
                                    <tbody className="text-stone-700">
                                        {validSubtests.map(([subId, result]) => {
                                            const subDef = def.subtests.find(s => s.id === subId);
                                            const isPathological = result.zScore <= -2;
                                            const isFragile = result.zScore <= -1 && result.zScore > -2;
                                            const colorClass = isPathological ? "text-[#E07A5F] font-bold" : isFragile ? "text-[#F2CC8F] font-bold" : "text-[#81B29A]";
                                            let scoreDisplay = (subDef?.scoreType === 'standard' || subDef?.scoreType === 'scaled') ? `NS = ${result.standard}` : `ET = ${result.zScore > 0 ? '+' : ''}${result.zScore}`;
                                            return <tr key={subId} className="border-b border-stone-50 last:border-0 align-top"><td className="py-3 pr-4 font-medium">• {subDef?.name}</td><td className={`py-3 text-center ${colorClass}`}>{scoreDisplay}</td><td className="py-3 pl-6 italic text-xs text-stone-500">{result.observation || "-"}</td></tr>;
                                        })}
                                    </tbody>
                                </table>
                                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-stone-100">
                                    {validSubtests.slice(0, 4).map(([subId, result]) => { 
                                        const subDef = def.subtests.find(s => s.id === subId);
                                        const scale = SCALES[subDef?.scoreType || 'standard'];
                                        return <div key={subId} className={`h-24 bg-stone-50 border border-stone-100 p-2 relative ${roundedClass}`}><div className="absolute top-2 left-2 text-[10px] font-bold text-stone-400 uppercase truncate max-w-[150px]">{subDef?.name}</div><GaussianChart mean={scale.mean} sd={scale.sd} userScore={parseFloat(result.standard)} label="" isActive={true} /></div>;
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
          </section>
      </div>
  );

  const HeaderRenderer = () => {
      const logoClass = logoSize === 'small' ? 'h-12' : logoSize === 'medium' ? 'h-20' : 'h-32';
      let containerClass = "flex mb-12 border-b-2 border-stone-100 pb-8 gap-6 ";
      if (headerLayout === 'column') {
          containerClass += "flex-col ";
          if (headerAlign === 'center') containerClass += "items-center text-center"; else if (headerAlign === 'right') containerClass += "items-end text-right"; else containerClass += "items-start text-left";
      } else {
          containerClass += "items-start ";
          if (headerAlign === 'right') containerClass += "flex-row-reverse text-right"; else if (headerAlign === 'center') containerClass += "justify-center text-center"; else containerClass += "justify-between text-left";
      }
      return (
          <header className={containerClass}>
              <div className={`space-y-3 ${headerLayout === 'row' ? 'flex-1' : ''}`}>
                  {isCustom && branding.logoUrl && <img src={branding.logoUrl} alt="Logo" className={`${logoClass} object-contain mb-2 ${headerLayout === 'column' && headerAlign === 'center' ? 'mx-auto' : ''}`} />}
                  <div>
                      <h1 className="font-bold text-3xl tracking-tight leading-tight" style={titleStyle}>{branding?.cabinetName || "Cabinet d'Ergothérapie"}</h1>
                      {isCustom && (
                          <div className={`text-xs text-stone-500 space-y-1 mt-2 ${headerLayout === 'row' ? 'border-l-2 border-stone-200 pl-3' : ''}`}>
                              <p className="font-bold text-sm text-stone-700">{branding.practitionerName}</p>
                              <p>{branding.address}</p>
                              <div className={`flex gap-4 ${headerLayout === 'column' && headerAlign === 'center' ? 'justify-center' : headerLayout === 'column' && headerAlign === 'right' ? 'justify-end' : ''}`}>{branding.phone && <p className="flex items-center gap-1"><Phone size={10}/> {branding.phone}</p>}{branding.email && <p className="flex items-center gap-1"><Mail size={10}/> {branding.email}</p>}</div>
                          </div>
                      )}
                  </div>
              </div>
              <div className={`p-4 bg-stone-50 border border-stone-100 ${roundedClass} min-w-[200px] ${headerLayout === 'column' ? 'w-full' : ''}`}>
                  <div className={headerLayout === 'column' && headerAlign === 'center' ? 'text-center' : 'text-right'}>
                      <h2 className="font-bold text-2xl text-stone-900 mb-1">{patient.firstName} {patient.lastName}</h2>
                      <p className="text-sm text-stone-600 font-medium">Né(e) le {new Date(patient.dob).toLocaleDateString()}</p>
                      <p className="text-sm text-stone-500">{patient.age}</p>
                  </div>
              </div>
          </header>
      );
  };

  return (
    <div id="printable-report" className="w-full flex flex-col items-center gap-8 no-scrollbar">
      
      {/* RENDU DES PAGES A4 INDIVIDUELLES */}
      {pages.map((pageSections, pageIdx) => (
          <div key={pageIdx} className="page-a4">
              
              {/* Header seulement sur la première page */}
              {pageIdx === 0 && (
                  <>
                      <HeaderRenderer />
                      <div className="mb-8 text-sm text-stone-500 italic text-right">Fait le {new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                      <h1 className="text-center font-bold text-3xl mb-12" style={titleStyle}>Rapport d’évaluation</h1>
                      <div className={`text-xs text-stone-600 text-justify mb-10 leading-relaxed border-l-4 pl-4 py-2 bg-stone-50 ${roundedClass}`} style={{ borderColor: secondaryColor }}>
                          <p className="mb-2"><strong>{patient.firstName}</strong> et ses parents consentent à cette évaluation.</p>
                          <p>Ce bilan a pour objectif d'analyser les capacités fonctionnelles et de proposer des axes d'intervention adaptés.</p>
                      </div>
                  </>
              )}

              {/* Rendu des sections de la page */}
              {pageSections.map((sectionId, idx) => {
                  if (sectionId === 'annexes') {
                      return <AnnexesSection key={sectionId} pageIdx={pageIdx} indexInPage={idx} totalInPage={pageSections.length} />;
                  }
                  return (
                      <InteractiveSection 
                          key={sectionId} 
                          sectionId={sectionId} 
                          pageIdx={pageIdx} 
                          indexInPage={idx} 
                          totalInPage={pageSections.length} 
                      />
                  );
              })}

              {/* Footer sur chaque page (sauf si contenu trop long, le footer suit le flux, c'est l'avantage du HTML) */}
              <div className="absolute bottom-10 left-[15mm] right-[15mm] border-t border-stone-200 pt-4 flex justify-between items-end text-xs text-stone-400">
                  <div>
                      <p>{branding?.footerText || "Document confidentiel"}</p>
                      <p className="mt-1">Profession inscrite au code de la santé publique.</p>
                  </div>
                  {branding?.showPageNumbers && <div className="font-mono">Page {pageIdx + 1}/{pages.length}</div>}
              </div>
          </div>
      ))}

      {/* Zone Vide pour permettre l'ajout d'une nouvelle page manuellement si besoin */}
      {onUpdateSection && (
          <div className="no-print pb-20">
              <button onClick={() => setPages([...pages, []])} className="flex items-center gap-2 px-6 py-3 bg-stone-200 text-stone-500 hover:bg-stone-300 hover:text-stone-700 rounded-xl font-bold uppercase text-xs tracking-wider transition-colors">
                  <Plus size={16} /> Ajouter une page vide
              </button>
          </div>
      )}

    </div>
  );
};
