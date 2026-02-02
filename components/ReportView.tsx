
import React, { useState, useRef, useEffect } from 'react';
import { Patient, ReportSection, TestData, ReportAttachment, BrandingConfig } from '../types';
import { GaussianChart } from './GaussianChart';
import { TEST_CATALOG } from '../data/testCatalog';
import { SCALES } from '../utils/scoring';
import { FileText, ClipboardList, Plus, Image as ImageIcon, LayoutTemplate, X, Trash2, Edit2, Check, Upload, MapPin, Mail, Phone, Hash, Globe } from 'lucide-react';

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

// Composant dédié pour l'édition de légende sans perte de focus
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
            // FIX: bg-transparent et text-stone-700 pour éviter le fond noir
            className="w-full bg-transparent border border-transparent hover:border-stone-200 outline-none text-sm text-stone-700 italic resize-none focus:bg-white focus:ring-2 focus:ring-[#E07A5F]/20 focus:border-[#E07A5F]/20 rounded p-2 transition-all leading-relaxed print:resize-none print:border-none print:p-0"
            rows={4}
            placeholder="Ajoutez une légende..."
        />
    );
};

export const ReportView: React.FC<Props> = ({ patient, sections, tests, onUpdateSection, branding }) => {
  const getSection = (id: string) => sections.find(s => s.id === id);

  // STYLE DYNAMIQUE (BRANDING)
  const isCustom = branding?.isEnabled;
  const primaryColor = isCustom ? branding.primaryColor : '#3D405B';
  const secondaryColor = isCustom ? branding.secondaryColor : '#E07A5F';
  const fontFamily = isCustom ? branding.fontFamily : 'Merriweather';
  const corners = isCustom ? branding.cornerStyle : 'rounded';
  
  // Header Config
  const headerLayout = isCustom ? branding.headerLayout : 'row';
  const headerAlign = isCustom ? branding.headerAlignment : 'left';
  const logoSize = isCustom ? branding.logoSize : 'medium';

  // Dérivation des classes CSS basées sur la config
  const roundedClass = corners === 'sharp' ? 'rounded-none' : corners === 'rounded' ? 'rounded-xl' : 'rounded-2xl'; // soft = 2xl
  
  const titleStyle = { fontFamily, color: primaryColor };
  const accentStyle = { color: secondaryColor };

  // --- SOUS-COMPOSANT : GESTIONNAIRE DE SECTION INTERACTIF ---
  const InteractiveSection = ({ sectionId }: { sectionId: string }) => {
      const section = getSection(sectionId);
      if (!section) return null;

      const paragraphs = section.content.split('\n').filter(line => line.trim().length > 0);
      
      const [editingIndex, setEditingIndex] = useState<number | null>(null);
      const [tempText, setTempText] = useState('');

      const fileInputRef = useRef<HTMLInputElement>(null);
      const [insertIndex, setInsertIndex] = useState<number | null>(null);
      const [insertType, setInsertType] = useState<'image-full' | 'image-text'>('image-full');

      const handleTextClick = (index: number, text: string) => {
          if (!onUpdateSection) return; 
          setEditingIndex(index);
          setTempText(text);
      };

      const saveText = (index: number) => {
          if (!onUpdateSection) return;
          const newParagraphs = [...paragraphs];
          newParagraphs[index] = tempText;
          onUpdateSection(section.id, { content: newParagraphs.join('\n\n') }); 
          setEditingIndex(null);
      };

      const handleAddImageRequest = (index: number) => {
          setInsertIndex(index);
      };

      const triggerFileSelect = (type: 'image-full' | 'image-text') => {
          setInsertType(type);
          fileInputRef.current?.click();
      };

      const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          if (e.target.files && e.target.files[0] && insertIndex !== null && onUpdateSection) {
              const file = e.target.files[0];
              const url = URL.createObjectURL(file); 
              
              const newAttachment: ReportAttachment = {
                  id: Date.now().toString(),
                  type: insertType,
                  url: url,
                  caption: insertType === 'image-text' ? "Notez ici vos observations sur l'image..." : undefined,
                  positionIndex: insertIndex
              };

              const currentAttachments = section.attachments || [];
              onUpdateSection(section.id, { attachments: [...currentAttachments, newAttachment] });
              
              setInsertIndex(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
          }
      };

      const updateCaption = (attachmentId: string, newCaption: string) => {
          if (!onUpdateSection) return;
          const newAttachments = (section.attachments || []).map(a => 
              a.id === attachmentId ? { ...a, caption: newCaption } : a
          );
          onUpdateSection(section.id, { attachments: newAttachments });
      };

      const removeAttachment = (attachmentId: string) => {
          if (!onUpdateSection) return;
          const newAttachments = (section.attachments || []).filter(a => a.id !== attachmentId);
          onUpdateSection(section.id, { attachments: newAttachments });
      };

      const renderAttachment = (attachment: ReportAttachment) => {
          if (attachment.type === 'image-full') {
              return (
                  <div className="relative group my-6 break-inside-avoid">
                      <img src={attachment.url} alt="Bilan" className={`w-full max-h-[400px] object-contain ${roundedClass} border border-stone-200 bg-stone-50 print:border-none print:bg-transparent`} />
                      {onUpdateSection && (
                          <button 
                              onClick={() => removeAttachment(attachment.id)}
                              className="absolute top-2 right-2 bg-white/90 text-rose-500 p-2 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity no-print hover:bg-rose-50 print:hidden"
                          >
                              <Trash2 size={16} />
                          </button>
                      )}
                  </div>
              );
          } else {
              return (
                  <div className={`relative group my-6 flex gap-6 items-start break-inside-avoid bg-stone-50 p-4 ${roundedClass} border border-stone-100 print:bg-transparent print:border-none print:p-0`}>
                      <div className="w-1/2">
                          <img src={attachment.url} alt="Bilan" className={`w-full h-auto shadow-sm bg-white border border-stone-100 print:border-none print:shadow-none ${roundedClass}`} />
                      </div>
                      <div className="w-1/2 pt-1">
                          {onUpdateSection ? (
                              <CaptionEditor 
                                initialValue={attachment.caption || ''} 
                                onSave={(val) => updateCaption(attachment.id, val)}
                              />
                          ) : (
                              <p className="text-sm text-stone-600 italic text-justify leading-relaxed">{attachment.caption}</p>
                          )}
                      </div>
                      {onUpdateSection && (
                          <button 
                              onClick={() => removeAttachment(attachment.id)}
                              className="absolute top-2 right-2 text-stone-300 hover:text-rose-500 transition-colors no-print p-1 hover:bg-rose-50 rounded print:hidden"
                          >
                              <Trash2 size={16} />
                          </button>
                      )}
                  </div>
              );
          }
      };

      return (
          <div className="mb-8 relative">
              <SectionTitle title={section.title} />
              
              <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*"
                  onChange={handleFileChange}
              />

              <div className="space-y-2">
                  {paragraphs.map((para, idx) => {
                      const attachmentsHere = section.attachments?.filter(a => a.positionIndex === idx) || [];
                      const isEditing = editingIndex === idx;

                      let textStyle = "text-stone-700 leading-relaxed text-sm text-justify mb-2";
                      let content = para;

                      if (para.startsWith('## ')) {
                          textStyle = "text-lg font-bold mt-6 mb-2 uppercase border-b pb-1 border-stone-100";
                      }
                      else if (para.startsWith('### ')) {
                          textStyle = "text-md font-bold text-stone-800 mt-4 mb-1";
                          content = para.replace('### ', '');
                      }
                      else if (para.startsWith('- ') || para.startsWith('* ')) {
                          textStyle = "text-stone-700 leading-relaxed text-sm text-justify ml-4 list-item list-disc marker:text-stone-800";
                          content = para.replace(/^[\*\-]\s+/, '');
                      }

                      return (
                          <div key={idx} className="relative group/block">
                              {isEditing ? (
                                  <div className="relative mb-4 print:hidden">
                                      {/* FIX: Ensure bg-white and text color */}
                                      <textarea 
                                          value={tempText}
                                          onChange={(e) => setTempText(e.target.value)}
                                          className={`w-full p-4 border-2 border-[#E07A5F] ${roundedClass} shadow-lg outline-none text-sm min-h-[150px] bg-white text-stone-900 font-medium leading-relaxed resize-y`}
                                          autoFocus
                                      />
                                      <div className="flex justify-end gap-2 mt-2 absolute bottom-3 right-3">
                                          <button onClick={() => setEditingIndex(null)} className="p-1.5 bg-stone-100 rounded-md shadow text-stone-500 hover:text-stone-800 hover:bg-stone-200"><X size={14}/></button>
                                          <button onClick={() => saveText(idx)} className="p-1.5 bg-[#E07A5F] rounded-md shadow text-white hover:bg-[#d0694e]"><Check size={14}/></button>
                                      </div>
                                  </div>
                              ) : (
                                  <div 
                                      onClick={() => handleTextClick(idx, para)}
                                      className={`${textStyle} ${onUpdateSection ? 'cursor-text hover:bg-[#fff5f2] rounded px-2 -mx-2 py-1 -my-1 transition-colors relative border border-transparent hover:border-[#E07A5F]/20 print:hover:bg-transparent print:border-none print:p-0 print:m-0' : ''}`}
                                      style={para.startsWith('## ') ? { color: primaryColor, fontFamily } : {}}
                                  >
                                      {parseBold(content.replace('## ', ''))}
                                      {onUpdateSection && (
                                          <Edit2 size={12} className="absolute top-1 right-1 text-[#E07A5F] opacity-0 group-hover/block:opacity-100 print:hidden" />
                                      )}
                                  </div>
                              )}

                              {attachmentsHere.map(att => (
                                  <div key={att.id}>{renderAttachment(att)}</div>
                              ))}

                              {onUpdateSection && (
                                  <div className="h-4 -my-2 relative z-10 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center group/insert no-print print:hidden">
                                      <div className="w-full h-px bg-[#E07A5F]/20 group-hover/insert:bg-[#E07A5F]/50 transition-colors"></div>
                                      {insertIndex === idx ? (
                                          <div className="absolute bg-white shadow-xl border border-stone-100 rounded-xl p-2 flex gap-2 animate-in zoom-in-95 duration-200 z-50">
                                              <button onClick={() => triggerFileSelect('image-full')} className="flex flex-col items-center gap-1 p-2 hover:bg-stone-50 rounded-lg text-xs font-bold text-stone-500 hover:text-[#E07A5F] transition-colors">
                                                  <div className="p-2 bg-stone-100 rounded-lg text-stone-400 group-hover:text-[#E07A5F]"><ImageIcon size={18}/></div>
                                                  Image Seule
                                              </button>
                                              <div className="w-px bg-stone-100"></div>
                                              <button onClick={() => triggerFileSelect('image-text')} className="flex flex-col items-center gap-1 p-2 hover:bg-stone-50 rounded-lg text-xs font-bold text-stone-500 hover:text-[#E07A5F] transition-colors">
                                                  <div className="p-2 bg-stone-100 rounded-lg text-stone-400 group-hover:text-[#E07A5F]"><LayoutTemplate size={18}/></div>
                                                  Img + Texte
                                              </button>
                                              <button onClick={() => setInsertIndex(null)} className="absolute -top-2 -right-2 bg-white rounded-full p-1 border border-stone-100 shadow-sm text-stone-400 hover:text-stone-600"><X size={12}/></button>
                                          </div>
                                      ) : (
                                          <button onClick={() => handleAddImageRequest(idx)} className="absolute bg-white border border-[#E07A5F] text-[#E07A5F] rounded-full p-1 shadow-sm hover:scale-110 transition-transform" title="Insérer un élément ici">
                                              <Plus size={14} strokeWidth={3} />
                                          </button>
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

  // Section Title Component
  const SectionTitle = ({ title }: { title: string }) => {
      return (
          <div className="flex items-center gap-3 mb-6 pb-2 border-b-2" style={{ borderColor: isCustom ? primaryColor + '20' : '#E5E7EB' }}>
              <div className={`p-1.5 ${roundedClass} ${isCustom ? '' : 'bg-stone-100 text-stone-500'}`} style={isCustom ? { backgroundColor: primaryColor + '15', color: primaryColor } : {}}>
                  <FileText size={20} />
              </div>
              <h2 className="text-xl font-bold uppercase tracking-wide" style={titleStyle}>
                  {title}
              </h2>
          </div>
      );
  };

  // HEADER DYNAMIQUE COMPLET (Style Word)
  const HeaderRenderer = () => {
      const logoClass = logoSize === 'small' ? 'h-12' : logoSize === 'medium' ? 'h-20' : 'h-32';
      
      // Conteneur principal: Flex
      // Si Layout = 'column', flex-col.
      // Si Layout = 'row', flex-row.
      // Alignment = 'left' -> items-start / justify-start
      // Alignment = 'center' -> items-center / justify-center (col) ou justify-between (row)
      
      let containerClass = "flex mb-12 border-b-2 border-stone-100 pb-8 gap-6 ";
      
      if (headerLayout === 'column') {
          containerClass += "flex-col ";
          if (headerAlign === 'center') containerClass += "items-center text-center";
          else if (headerAlign === 'right') containerClass += "items-end text-right";
          else containerClass += "items-start text-left";
      } else {
          // Row
          containerClass += "items-start ";
          if (headerAlign === 'right') containerClass += "flex-row-reverse text-right";
          else if (headerAlign === 'center') containerClass += "justify-center text-center"; // Rare pour un row mais possible
          else containerClass += "justify-between text-left";
      }

      return (
          <header className={containerClass}>
              
              {/* BLOC 1 : IDENTITÉ CABINET + LOGO */}
              <div className={`space-y-3 ${headerLayout === 'row' ? 'flex-1' : ''}`}>
                  {isCustom && branding.logoUrl && (
                      <img 
                        src={branding.logoUrl} 
                        alt="Logo" 
                        className={`${logoClass} object-contain mb-2 ${headerLayout === 'column' && headerAlign === 'center' ? 'mx-auto' : ''}`} 
                      />
                  )}
                  
                  <div>
                      <h1 className="font-bold text-3xl tracking-tight leading-tight" style={titleStyle}>
                          {branding?.cabinetName || "Cabinet d'Ergothérapie"}
                      </h1>
                      
                      {isCustom && (
                          <div className={`text-xs text-stone-500 space-y-1 mt-2 ${headerLayout === 'row' ? 'border-l-2 border-stone-200 pl-3' : ''}`}>
                              <p className="font-bold text-sm text-stone-700">{branding.practitionerName}</p>
                              <p>{branding.address}</p>
                              <div className={`flex gap-4 ${headerLayout === 'column' && headerAlign === 'center' ? 'justify-center' : headerLayout === 'column' && headerAlign === 'right' ? 'justify-end' : ''}`}>
                                  {branding.phone && <p className="flex items-center gap-1"><Phone size={10}/> {branding.phone}</p>}
                                  {branding.email && <p className="flex items-center gap-1"><Mail size={10}/> {branding.email}</p>}
                              </div>
                          </div>
                      )}
                  </div>
              </div>

              {/* BLOC 2 : INFO PATIENT (Encadré) */}
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
    <div id="printable-report" className="w-[210mm] mx-auto text-stone-800 font-sans print:w-full print:mx-0">
      
      {/* PAGE 1 : HEADER + INTRO + PREMIERES SECTIONS */}
      <div className="bg-white p-[15mm] shadow-xl min-h-[297mm] relative mb-8 print:shadow-none print:mb-0 print:break-after-page section-page">
          
          <HeaderRenderer />

          <div className="mb-8 text-sm text-stone-500 italic text-right">
            Fait le {new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>

          <h1 className="text-center font-bold text-3xl mb-12" style={titleStyle}>
            Rapport d’évaluation
          </h1>

          {/* INTRODUCTION LÉGALE */}
          <div className={`text-xs text-stone-600 text-justify mb-10 leading-relaxed border-l-4 pl-4 py-2 bg-stone-50 ${roundedClass}`} style={{ borderColor: secondaryColor }}>
            <p className="mb-2"><strong>{patient.firstName}</strong> et ses parents consentent à cette évaluation.</p>
            <p>Ce bilan a pour objectif d'analyser les capacités fonctionnelles et de proposer des axes d'intervention adaptés.</p>
          </div>

          {/* SECTIONS PAGE 1 */}
          <InteractiveSection sectionId="mandat_ref" />
          <InteractiveSection sectionId="mandat_eval" />
          <InteractiveSection sectionId="profil" />
      </div>
      
      {/* PAGE 2 : DIAGNOSTIC & SUITE */}
      <div className="bg-white p-[15mm] shadow-xl min-h-[297mm] relative mb-8 print:shadow-none print:mb-0 print:break-after-page section-page">
          <InteractiveSection sectionId="diagnostic" />
          <InteractiveSection sectionId="objectifs" />
          <InteractiveSection sectionId="recommandations" />
      </div>

      {/* PAGE 3 : ANNEXES */}
      <div className="bg-white p-[15mm] shadow-xl min-h-[297mm] relative mb-8 print:shadow-none print:mb-0 section-page">
          <section className="mb-10">
            <div className="flex items-center justify-center gap-3 mb-8">
                <div style={accentStyle}><ClipboardList size={24} /></div>
                <h2 className="text-xl font-bold uppercase tracking-wide" style={titleStyle}>
                    Annexes : Résultats Chiffrés
                </h2>
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
                    const def = TEST_CATALOG.flatMap(c => c.tests).find(t => t.id === testId);
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
                                    <thead>
                                        <tr className="border-b-2 border-stone-100 text-left text-xs font-bold text-stone-400 uppercase tracking-wider">
                                            <th className="pb-3 w-1/3">Épreuves</th>
                                            <th className="pb-3 w-1/4 text-center">Note Standard (NS) / ET</th>
                                            <th className="pb-3 w-1/3 pl-6">Observations</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-stone-700">
                                        {validSubtests.map(([subId, result]) => {
                                            const subDef = def.subtests.find(s => s.id === subId);
                                            const isPathological = result.zScore <= -2;
                                            const isFragile = result.zScore <= -1 && result.zScore > -2;
                                            const colorClass = isPathological ? "text-[#E07A5F] font-bold" : isFragile ? "text-[#F2CC8F] font-bold" : "text-[#81B29A]";

                                            let scoreDisplay = "";
                                            if (subDef?.scoreType === 'standard' || subDef?.scoreType === 'scaled') {
                                                scoreDisplay = `NS = ${result.standard}`;
                                            } else {
                                                scoreDisplay = `ET = ${result.zScore > 0 ? '+' : ''}${result.zScore}`;
                                            }

                                            return (
                                                <tr key={subId} className="border-b border-stone-50 last:border-0 align-top">
                                                    <td className="py-3 pr-4 font-medium leading-relaxed">• {subDef?.name}</td>
                                                    <td className={`py-3 text-center ${colorClass}`}>{scoreDisplay}</td>
                                                    <td className="py-3 pl-6 italic text-xs text-stone-500 leading-relaxed text-justify">{result.observation || "-"}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>

                                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-stone-100">
                                    {validSubtests.slice(0, 4).map(([subId, result]) => { 
                                        const subDef = def.subtests.find(s => s.id === subId);
                                        const scale = SCALES[subDef?.scoreType || 'standard'];
                                        return (
                                            <div key={subId} className={`h-24 bg-stone-50 border border-stone-100 p-2 relative ${roundedClass}`}>
                                                <div className="absolute top-2 left-2 text-[10px] font-bold text-stone-400 uppercase truncate max-w-[150px]">{subDef?.name}</div>
                                                <GaussianChart mean={scale.mean} sd={scale.sd} userScore={parseFloat(result.standard)} label="" isActive={true} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
          </section>

          {/* FOOTER */}
          <footer className="mt-20 pt-8 border-t border-stone-200 flex justify-between items-end break-inside-avoid text-xs text-stone-400">
            <div>
                <p>{branding?.footerText || "Document confidentiel"}</p>
                <p className="mt-1">Profession inscrite au code de la santé publique.</p>
            </div>
            {branding?.showPageNumbers && (
                <div className="font-mono">Page 3/3</div> 
            )}
          </footer>
      </div>

    </div>
  );
};
