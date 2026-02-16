import React, { useState, useRef } from 'react';
import type { ReportSection, Patient } from '../../types';
import { Check, Edit2, AlertCircle, ChevronLeft, Download, FileCheck, FileText, Home, ArrowLeft, Bold, Italic, List, Heading, Undo, Info, CheckCheck } from 'lucide-react';

interface Props {
  sections: ReportSection[];
  patient: Patient;
  onValidateSection: (id: string, newContent?: string) => void;
  onNext: () => void;
  onBack: () => void;
}

const parseBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-bold text-stone-900">{part.slice(2, -2)}</strong>;
        }
        return part;
    });
};

const renderMarkdown = (text: string) => {
    if (!text) return <p className="text-stone-400 italic">Aucun contenu.</p>;

    return text.split('\n').map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-4"></div>;
        if (trimmed.startsWith('### ')) {
            return <h4 key={idx} className="text-lg font-bold text-stone-800 mt-6 mb-2">{trimmed.replace('### ', '')}</h4>;
        }
        if (trimmed.startsWith('## ')) {
            return <h3 key={idx} className="text-xl font-serif font-bold text-stone-900 mt-8 mb-4 border-b border-stone-100 pb-2">{trimmed.replace('## ', '')}</h3>;
        }
        if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
             return (
                <div key={idx} className="flex gap-3 ml-2 mb-2 items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-2.5 shrink-0"></div>
                    <p className="text-stone-700 leading-relaxed text-base text-justify">
                         {parseBold(trimmed.replace(/^[*-]\s+/, ''))}
                    </p>
                </div>
            );
        }
        return <p key={idx} className="text-stone-700 leading-relaxed text-base mb-2 text-justify">{parseBold(line)}</p>;
    });
};

// --- COMPOSANT TOOLBAR (NOUVEAU) ---
const EditorToolbar = ({ onAction }: { onAction: (action: string) => void }) => {
    const btnClass = "p-2 hover:bg-stone-700 rounded-lg transition-colors text-white/90 hover:text-white";
    
    return (
        <div className="flex items-center gap-1 bg-[#3D405B] p-1.5 rounded-xl shadow-xl shadow-stone-400/20 absolute -top-12 left-0 animate-in slide-in-from-bottom-2 fade-in duration-200 z-10">
            <button onMouseDown={(e) => { e.preventDefault(); onAction('bold'); }} className={btnClass} title="Gras">
                <Bold size={16} strokeWidth={3} />
            </button>
            <button onMouseDown={(e) => { e.preventDefault(); onAction('italic'); }} className={btnClass} title="Italique">
                <Italic size={16} />
            </button>
            <div className="w-px h-4 bg-white/20 mx-1"></div>
            <button onMouseDown={(e) => { e.preventDefault(); onAction('h3'); }} className={btnClass} title="Sous-titre">
                <Heading size={16} />
            </button>
            <button onMouseDown={(e) => { e.preventDefault(); onAction('list'); }} className={btnClass} title="Liste à puces">
                <List size={16} />
            </button>
            <div className="w-px h-4 bg-white/20 mx-1"></div>
            <div className="px-2 text-[10px] font-medium text-white/50 select-none">Markdown</div>
        </div>
    );
};

const SectionCard: React.FC<{
    section: ReportSection;
    onValidate: (id: string, content?: string) => void;
}> = ({ section, onValidate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(section.content);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleSave = () => {
        onValidate(section.id, editContent);
        setIsEditing(false);
    };

    // Logique d'insertion Markdown intelligente
    const handleFormat = (type: string) => {
        if (!textareaRef.current) return;
        const field = textareaRef.current;
        const start = field.selectionStart;
        const end = field.selectionEnd;
        const text = editContent;
        const selection = text.substring(start, end);
        
        let newText = text;
        let newCursor = end;

        if (type === 'bold') {
            newText = text.substring(0, start) + `**${selection}**` + text.substring(end);
            newCursor = end + 4; // ** + **
        } else if (type === 'italic') {
            newText = text.substring(0, start) + `*${selection}*` + text.substring(end);
            newCursor = end + 2; // * + *
        } else if (type === 'h3') {
            // Ajoute ### au début de la ligne courante
            const lineStart = text.lastIndexOf('\n', start - 1) + 1;
            newText = text.substring(0, lineStart) + "### " + text.substring(lineStart);
            newCursor = end + 4;
        } else if (type === 'list') {
            // Ajoute - au début de la ligne courante
            const lineStart = text.lastIndexOf('\n', start - 1) + 1;
            newText = text.substring(0, lineStart) + "- " + text.substring(lineStart);
            newCursor = end + 2;
        }

        setEditContent(newText);
        
        // Restore focus
        setTimeout(() => {
            field.focus();
            field.setSelectionRange(newCursor, newCursor);
        }, 0);
    };

    const isValidated = section.status === 'validated';

    return (
        <div className={`group rounded-2xl border transition-all duration-300 p-8 mb-6 ${isValidated ? 'bg-white border-emerald-200 shadow-sm' : 'bg-white border-stone-200 shadow-lg shadow-rose-100/50'}`}>
            {/* Header Style Harmonisé avec ReportView */}
            <div className="flex justify-between items-center mb-6 border-b-2 border-stone-100 pb-2">
                <div className="flex items-center gap-2">
                    <div className="text-[#E07A5F]">
                        <FileText size={18} />
                    </div>
                    <h3 className="text-lg font-bold text-[#3D405B] uppercase tracking-wide">
                        {section.title}
                    </h3>
                </div>
                
                {isValidated ? (
                    <div className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                        <Check size={14} /> Validé
                    </div>
                ) : (
                    <div className="px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 animate-pulse">
                        <AlertCircle size={14} /> À relire
                    </div>
                )}
            </div>

            {isEditing ? (
                <div className="space-y-6 relative">
                    {/* Toolbar flottante au-dessus */}
                    <div className="relative">
                        <EditorToolbar onAction={handleFormat} />
                        <textarea 
                            ref={textareaRef}
                            className="w-full p-6 bg-stone-50 rounded-xl border border-stone-200 focus:bg-white focus:ring-4 focus:ring-rose-50 focus:border-rose-300 outline-none text-stone-900 leading-relaxed min-h-[400px] text-base font-mono resize-y shadow-inner transition-all"
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            placeholder="Rédigez votre contenu ici..."
                        />
                    </div>
                    
                    <div className="flex justify-between items-center bg-blue-50 p-3 rounded-lg border border-blue-100">
                        <div className="flex items-center gap-2 text-xs text-blue-800">
                            <Info size={14} />
                            <span>Utilisez la barre d'outils pour mettre en forme.</span>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button onClick={() => setIsEditing(false)} className="px-5 py-2 text-stone-400 font-bold text-xs uppercase tracking-wider hover:text-stone-700">Annuler</button>
                        <button onClick={handleSave} className="px-6 py-3 bg-stone-900 text-white rounded-xl font-bold text-sm hover:bg-rose-700 transition-colors shadow-md flex items-center gap-2">
                            <Check size={16} /> Enregistrer
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="prose prose-stone max-w-none">
                        {renderMarkdown(section.content)}
                    </div>

                    <div className="flex justify-end gap-3 pt-6 border-t border-stone-50">
                        <button 
                            onClick={() => setIsEditing(true)}
                            className="flex items-center gap-2 text-stone-400 hover:text-stone-900 px-4 py-2 rounded-lg hover:bg-stone-50 transition-all font-bold text-xs uppercase tracking-wider"
                        >
                            <Edit2 size={14} /> Modifier
                        </button>
                        {!isValidated && (
                            <button 
                                onClick={() => onValidate(section.id, section.content)}
                                className="flex items-center gap-2 bg-stone-900 text-white px-6 py-2.5 rounded-lg hover:bg-emerald-600 transition-all font-bold text-xs uppercase tracking-wider shadow-md"
                            >
                                <Check size={16} /> Valider
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export const Step4Validation: React.FC<Props> = ({ sections, patient, onValidateSection, onNext, onBack }) => {
  const validatedCount = sections.filter(s => s.status === 'validated').length;
  const allValidated = validatedCount === sections.length && sections.length > 0;
  const pendingCount = sections.length - validatedCount;

  const handleValidateAll = () => {
    sections.forEach(s => {
      if (s.status !== 'validated') {
        onValidateSection(s.id, s.content);
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto pb-40 animate-in fade-in duration-500">
      
      <div className="bg-white sticky top-24 z-30 p-6 rounded-2xl shadow-xl shadow-stone-200/50 border border-stone-200 mb-12 flex items-center justify-between ring-1 ring-white transition-all">
        <div className="space-y-1">
            <h2 className="text-2xl font-serif font-bold text-stone-900">Relecture</h2>
            <p className="text-stone-500 font-medium text-sm">Vérifiez et ajustez le contenu généré par l’IA.</p>
        </div>
        <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
              allValidated
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              {validatedCount}/{sections.length} validé(s)
            </div>
            {pendingCount > 0 && sections.length > 0 && (
              <button
                type="button"
                onClick={handleValidateAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <CheckCheck size={14} />
                Tout valider
              </button>
            )}
            <FileCheck size={24} className={allValidated ? 'text-emerald-500' : 'text-stone-300'} />
        </div>
      </div>

      <div className="space-y-4">
        {sections.length === 0 ? (
            <div className="text-center py-20 text-stone-400 italic">
                Génération en attente...
            </div>
        ) : (
            sections.map(section => (
                <SectionCard key={section.id} section={section} onValidate={onValidateSection} />
            ))
        )}
      </div>

      <div className="fixed bottom-10 left-0 right-0 z-40 pointer-events-none flex justify-center">
        <div className="bg-white p-3 rounded-2xl shadow-2xl pointer-events-auto flex items-center gap-3 border border-stone-200">
            
            <button 
                onClick={onBack} 
                className="px-6 py-3 rounded-xl flex items-center gap-2 text-stone-400 hover:text-stone-800 hover:bg-stone-50 transition-colors font-bold text-sm uppercase tracking-wider"
            >
                <ArrowLeft size={18} /> Retour
            </button>
            
            <div className="h-8 w-px bg-stone-100"></div>
            
            <button 
                onClick={onNext}
                disabled={sections.length === 0}
                className="flex items-center gap-3 px-8 py-3 bg-stone-900 text-white rounded-xl font-bold text-sm disabled:opacity-40 disabled:grayscale transition-all hover:bg-rose-700 shadow-lg"
            >
                <Download size={18} />
                <span className="uppercase tracking-wider">Visualiser le document</span>
            </button>
        </div>
      </div>
    </div>
  );
};
