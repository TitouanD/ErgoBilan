import React, { useState, useRef, useEffect } from 'react';
import type { ReportSection, Patient } from '../../types';
import { Check, Edit2, AlertCircle, Download, FileCheck, FileText, Bold, Italic, List, Heading, Undo, Redo, Info, CheckCheck, ChevronRight, ChevronLeft } from 'lucide-react';
import { sanitizeReportText } from '../../utils/textSanitizer';
import { useTextHistory } from '../../hooks/useTextHistory';

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
            return <strong key={i} className="font-bold text-stone-900 dark:text-[var(--text-heading)]">{part.slice(2, -2)}</strong>;
        }
        return part;
    });
};

const getListLineInfo = (line: string) => {
    const match = line.match(/^(\s*)([*-])\s+(.*)$/);
    if (!match) return null;

    const spaces = match[1].length;
    const level = Math.max(0, Math.floor(spaces / 2));
    return {
        level,
        content: match[3],
    };
};

const indentSelectedLines = (value: string, start: number, end: number, direction: 'indent' | 'outdent') => {
    const blockStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    let blockEnd = value.indexOf('\n', end);
    if (blockEnd === -1) blockEnd = value.length;

    const block = value.slice(blockStart, blockEnd);
    const lines = block.split('\n');

    let removedSpaces = 0;
    const nextLines = lines.map((line) => {
        if (!line.trim()) return line;
        if (direction === 'indent') return `  ${line}`;
        const removed = line.match(/^ {1,2}/)?.[0].length ?? 0;
        removedSpaces += removed;
        return line.replace(/^ {1,2}/, '');
    });

    const nextBlock = nextLines.join('\n');
    const nextValue = value.slice(0, blockStart) + nextBlock + value.slice(blockEnd);
    const addedSpaces = direction === 'indent' ? nextLines.filter((line) => line.trim()).length * 2 : 0;
    const delta = direction === 'indent' ? addedSpaces : -removedSpaces;

    return {
        value: nextValue,
        selectionStart: Math.max(blockStart, start + Math.min(2, delta)),
        selectionEnd: Math.max(blockStart, end + delta),
    };
};

const renderMarkdown = (text: string) => {
    const safeText = sanitizeReportText(text);
    if (!safeText) return <p className="text-stone-400 dark:text-[var(--text-disabled)] italic">Aucun contenu.</p>;

    return safeText.split('\n').map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-4"></div>;
        if (trimmed.startsWith('### ')) {
            return <h4 key={idx} className="text-lg font-bold text-stone-800 dark:text-[var(--text-heading)] mt-6 mb-2">{trimmed.replace('### ', '')}</h4>;
        }
        if (trimmed.startsWith('## ')) {
            return <h3 key={idx} className="text-xl font-serif font-bold text-stone-900 dark:text-[var(--text-heading)] mt-8 mb-4 border-b border-stone-100 dark:border-[var(--border-color)] pb-2">{trimmed.replace('## ', '')}</h3>;
        }
        const listLineInfo = getListLineInfo(line);
        if (listLineInfo) {
            const markerClass =
                listLineInfo.level === 0
                    ? 'w-1.5 h-1.5 rounded-full bg-rose-400'
                    : listLineInfo.level === 1
                        ? 'w-1.5 h-1.5 rounded-full border border-rose-400'
                        : 'w-1 h-1 rounded-sm bg-rose-300';

             return (
                <div key={idx} className="flex gap-3 mb-2 items-start" style={{ marginLeft: `${8 + listLineInfo.level * 18}px` }}>
                    <div className={`${markerClass} mt-[0.62rem] shrink-0`}></div>
                    <p className="text-stone-700 dark:text-[var(--text-main)] leading-relaxed text-base text-justify">
                         {parseBold(listLineInfo.content)}
                    </p>
                </div>
            );
        }
        return <p key={idx} className="text-stone-700 dark:text-[var(--text-main)] leading-relaxed text-base mb-2 text-justify">{parseBold(line)}</p>;
    });
};

// --- COMPOSANT TOOLBAR (NOUVEAU) ---
const EditorToolbar = ({ onAction, canUndo, canRedo }: { onAction: (action: string) => void; canUndo: boolean; canRedo: boolean }) => {
    const btnClass = "p-2 hover:bg-stone-700 rounded-lg transition-colors text-white/90 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed";
    
    return (
        <div className="mb-3 inline-flex items-center gap-1 bg-[#3D405B] p-1.5 rounded-xl shadow-xl shadow-stone-400/20 animate-in fade-in duration-200">
            <button onMouseDown={(e) => { e.preventDefault(); onAction('undo'); }} className={btnClass} title="Annuler (Ctrl+Z)" disabled={!canUndo}>
                <Undo size={16} />
            </button>
            <button onMouseDown={(e) => { e.preventDefault(); onAction('redo'); }} className={btnClass} title="Rétablir (Ctrl+Y)" disabled={!canRedo}>
                <Redo size={16} />
            </button>
            <div className="w-px h-4 bg-white/20 mx-1"></div>
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
            <button onMouseDown={(e) => { e.preventDefault(); onAction('indentList'); }} className={btnClass} title="Sous-puce (Tab)">
                <ChevronRight size={16} />
            </button>
            <button onMouseDown={(e) => { e.preventDefault(); onAction('outdentList'); }} className={btnClass} title="Remonter la puce (Shift+Tab)">
                <ChevronLeft size={16} />
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
    const history = useTextHistory(sanitizeReportText(section.content));
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Sync history when section content changes externally (e.g. after AI regen)
    useEffect(() => {
        if (!isEditing) {
            history.reset(sanitizeReportText(section.content));
        }
    }, [section.content]);

    const handleSave = () => {
        onValidate(section.id, sanitizeReportText(history.value));
        setIsEditing(false);
    };

    const handleCancel = () => {
        history.reset(sanitizeReportText(section.content));
        setIsEditing(false);
    };

    // Logique d'insertion Markdown intelligente + undo/redo
    const handleFormat = (type: string) => {
        if (type === 'undo') { history.undo(); return; }
        if (type === 'redo') { history.redo(); return; }

        if (!textareaRef.current) return;
        const field = textareaRef.current;
        const start = field.selectionStart;
        const end = field.selectionEnd;
        const text = history.value;
        const selection = text.substring(start, end);
        
        let newText = text;
        let newCursor = end;

        if (type === 'bold') {
            newText = text.substring(0, start) + `**${selection}**` + text.substring(end);
            newCursor = end + 4;
        } else if (type === 'italic') {
            newText = text.substring(0, start) + `*${selection}*` + text.substring(end);
            newCursor = end + 2;
        } else if (type === 'h3') {
            const lineStart = text.lastIndexOf('\n', start - 1) + 1;
            newText = text.substring(0, lineStart) + "### " + text.substring(lineStart);
            newCursor = end + 4;
        } else if (type === 'list') {
            const lineStart = text.lastIndexOf('\n', start - 1) + 1;
            newText = text.substring(0, lineStart) + "- " + text.substring(lineStart);
            newCursor = end + 2;
        } else if (type === 'indentList' || type === 'outdentList') {
            const result = indentSelectedLines(text, start, end, type === 'indentList' ? 'indent' : 'outdent');
            history.set(result.value);
            setTimeout(() => {
                field.focus();
                field.setSelectionRange(result.selectionStart, result.selectionEnd);
            }, 0);
            return;
        }

        history.set(newText);
        
        // Restore focus
        setTimeout(() => {
            field.focus();
            field.setSelectionRange(newCursor, newCursor);
        }, 0);
    };

    const isValidated = section.status === 'validated';

    return (
        <div className={`group rounded-2xl border transition-all duration-300 p-8 mb-6 ${isValidated ? 'bg-[var(--card-bg)] border-emerald-200 shadow-sm' : 'bg-[var(--card-bg)] border-[var(--border-color)] shadow-lg shadow-rose-100/50 dark:shadow-black/20'}`}>
            {/* Header Style Harmonisé avec ReportView */}
            <div className="flex justify-between items-center mb-6 border-b-2 border-[var(--border-color)] pb-2">
                <div className="flex items-center gap-2">
                    <div className="text-[#E07A5F]">
                        <FileText size={18} />
                    </div>
                    <h3 className="text-lg font-bold text-[var(--text-heading)] uppercase tracking-wide">
                        {section.title}
                    </h3>
                </div>
                
                {isValidated ? (
                    <div className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                        <Check size={14} /> Validé
                    </div>
                ) : (
                    <div className="px-3 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 animate-pulse">
                        <AlertCircle size={14} /> À relire
                    </div>
                )}
            </div>

            {isEditing ? (
                <div className="space-y-6 relative">
                    {/* Toolbar flottante au-dessus */}
                    <div className="relative">
                        <EditorToolbar onAction={handleFormat} canUndo={history.canUndo} canRedo={history.canRedo} />
                        <textarea 
                            ref={textareaRef}
                            spellCheck={true}
                            autoCorrect="on"
                            autoCapitalize="sentences"
                            lang="fr"
                            className="w-full p-6 bg-[var(--input-bg)] rounded-xl border border-[var(--border-color)] focus:bg-[var(--card-bg)] focus:ring-4 focus:ring-[#E07A5F]/10 focus:border-[#E07A5F]/50 outline-none text-[var(--text-heading)] leading-relaxed min-h-[400px] text-base font-medium resize-y shadow-inner transition-all"
                            value={history.value}
                            onChange={(e) => history.set(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Tab') {
                                    e.preventDefault();
                                    const result = indentSelectedLines(
                                        history.value,
                                        e.currentTarget.selectionStart,
                                        e.currentTarget.selectionEnd,
                                        e.shiftKey ? 'outdent' : 'indent',
                                    );
                                    history.set(result.value);
                                    setTimeout(() => {
                                        textareaRef.current?.focus();
                                        textareaRef.current?.setSelectionRange(result.selectionStart, result.selectionEnd);
                                    }, 0);
                                    return;
                                }
                                if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
                                    e.preventDefault();
                                    history.undo();
                                } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
                                    e.preventDefault();
                                    history.redo();
                                }
                            }}
                            placeholder="Rédigez votre contenu ici..."
                        />
                    </div>
                    
                    <div className="flex justify-between items-center bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800/30">
                        <div className="flex items-center gap-2 text-xs text-blue-800 dark:text-blue-300">
                            <Info size={14} />
                            <span>Utilisez Tab/Shift+Tab pour les sous-puces. Pour l'orthographe: clic droit sur un mot.</span>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button onClick={handleCancel} className="px-5 py-2 text-stone-400 dark:text-[var(--text-secondary)] font-bold text-xs uppercase tracking-wider hover:text-stone-700 dark:hover:text-[var(--text-heading)]">Annuler</button>
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

                    <div className="flex justify-end gap-3 pt-6 border-t border-[var(--border-color)]">
                        <button 
                            onClick={() => setIsEditing(true)}
                            className="flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-heading)] px-4 py-2 rounded-lg hover:bg-[var(--hover-bg)] transition-all font-bold text-xs uppercase tracking-wider"
                        >
                            <Edit2 size={14} /> Modifier
                        </button>
                        {!isValidated && (
                            <button 
                                onClick={() => onValidate(section.id, sanitizeReportText(section.content))}
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
    const displayedSections = sections.filter((section) => section.id !== 'objectifs');
    const validatedCount = displayedSections.filter(s => s.status === 'validated').length;
    const allValidated = validatedCount === displayedSections.length && displayedSections.length > 0;
    const pendingCount = displayedSections.length - validatedCount;

  const handleValidateAll = () => {
        displayedSections.forEach(s => {
      if (s.status !== 'validated') {
        onValidateSection(s.id, s.content);
      }
    });
  };

  return (
        <div className="max-w-4xl mx-auto pb-10 animate-in fade-in duration-500">
      
            <div className="mb-8 border-b border-[var(--border-color)] pb-6 flex justify-between items-end gap-4 relative z-10">
        <div className="space-y-1">
                        <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Relecture</h2>
                        <p className="text-[var(--text-secondary)] font-medium mt-2">Vérifiez et ajustez le contenu généré par l'IA.</p>
        </div>
        <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
              allValidated
                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40'
                : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-700/40'
            }`}>
                            {validatedCount}/{displayedSections.length} validé(s)
            </div>
                        {pendingCount > 0 && displayedSections.length > 0 && (
              <button
                type="button"
                onClick={handleValidateAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
              >
                <CheckCheck size={14} />
                Tout valider
              </button>
            )}
            <FileCheck size={24} className={allValidated ? 'text-emerald-500' : 'text-stone-300'} />
        </div>
      </div>

      <div className="space-y-4">
        {displayedSections.length === 0 ? (
            <div className="text-center py-20 text-stone-400 dark:text-[var(--text-disabled)] italic">
                Génération en attente...
            </div>
        ) : (
            displayedSections.map(section => (
                <SectionCard key={section.id} section={section} onValidate={onValidateSection} />
            ))
        )}
      </div>

      <div className="mt-10 flex items-center justify-between gap-4">
          <button 
              onClick={onBack} 
              className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] font-bold text-sm uppercase tracking-widest px-2 transition-colors"
          >
              Retour
          </button>
          
          <button 
              onClick={onNext}
              disabled={displayedSections.length === 0}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all disabled:opacity-40 disabled:grayscale bg-[#3D405B] hover:bg-[#E07A5F]"
          >
              <Download size={18} />
              <span className="uppercase tracking-wider">Visualiser le document</span>
          </button>
      </div>
    </div>
  );
};
