import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import {
    Bold, Italic, Underline as UnderlineIcon, List, Heading2, Heading3,
    AlignLeft, AlignCenter, AlignRight, AlignJustify, Highlighter, Palette, ListOrdered, Undo, Redo
} from 'lucide-react';

interface TipTapEditorProps {
    content: string;
    onChange: (html: string) => void;
    /** When true, shows the full toolbar (Performance+ tier). When false, basic only. */
    isPerformance?: boolean;
    /** Section title shown above the editor */
    title?: string;
    /** When true, the editor is read-only (no toolbar, no editing). Avoids dangerouslySetInnerHTML. */
    readOnly?: boolean;
}

const ToolbarButton: React.FC<{
    onClick: () => void;
    isActive?: boolean;
    title?: string;
    children: React.ReactNode;
    disabled?: boolean;
}> = ({ onClick, isActive, title, children, disabled }) => (
    <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onClick(); }}
        disabled={disabled}
        title={title}
        className={`p-1.5 rounded text-xs transition-all ${
            isActive
                ? 'bg-[#3D405B] text-white'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
        {children}
    </button>
);

const Divider = () => <div className="w-px h-5 bg-stone-200 mx-1 self-center" />;

export const TipTapEditor: React.FC<TipTapEditorProps> = ({
    content,
    onChange,
    isPerformance = false,
    title,
    readOnly = false,
}) => {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({ heading: { levels: [2, 3] } }),
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            TextStyle,
            Color,
            Highlight.configure({ multicolor: true }),
            Underline,
        ],
        content: content || '',
        editable: !readOnly,
        onUpdate: ({ editor }) => {
            if (!readOnly) onChange(editor.getHTML());
        },
        editorProps: {
            attributes: {
                class: readOnly
                    ? 'prose prose-sm max-w-none text-stone-700 leading-relaxed'
                    : 'prose prose-sm max-w-none focus:outline-none min-h-[80px] text-[var(--text-main)] p-3 leading-relaxed',
            },
        },
    });

    // Sync content when the prop changes externally (e.g. format switch or autosave)
    useEffect(() => {
        if (!editor || editor.isDestroyed) return;
        const currentHTML = editor.getHTML();
        // Normalize TipTap empty state ('<p></p>') vs empty string
        const incomingNormalized = content || '';
        const currentNormalized = currentHTML === '<p></p>' ? '' : currentHTML;
        if (incomingNormalized !== currentNormalized) {
            editor.commands.setContent(incomingNormalized);
        }
    }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!editor) return null;

    return (
        <div className={readOnly ? '' : 'border border-stone-200 rounded-xl overflow-hidden bg-[var(--card-bg)] shadow-sm'}>
            {/* Title */}
            {title && (
                <div className="px-4 py-2 bg-stone-50 border-b border-stone-100 text-xs font-bold text-stone-500 uppercase tracking-wider">
                    {title}
                </div>
            )}

            {/* Toolbar – hidden in read-only mode */}
            {!readOnly && (
                <div className="flex items-center flex-wrap gap-0.5 px-2 py-1.5 border-b border-stone-100 bg-stone-50/50 no-print print:hidden">
                {/* History */}
                <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Annuler" disabled={!editor.can().undo()}>
                    <Undo size={13} />
                </ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Rétablir" disabled={!editor.can().redo()}>
                    <Redo size={13} />
                </ToolbarButton>

                <Divider />

                {/* Headings */}
                <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} isActive={editor.isActive('heading', { level: 2 })} title="Titre H2">
                    <Heading2 size={13} />
                </ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} isActive={editor.isActive('heading', { level: 3 })} title="Titre H3">
                    <Heading3 size={13} />
                </ToolbarButton>

                <Divider />

                {/* Inline formatting */}
                <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} title="Gras">
                    <Bold size={13} />
                </ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} title="Italique">
                    <Italic size={13} />
                </ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title="Souligné">
                    <UnderlineIcon size={13} />
                </ToolbarButton>

                {/* Lists */}
                <Divider />
                <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')} title="Liste à puces">
                    <List size={13} />
                </ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')} title="Liste numérotée">
                    <ListOrdered size={13} />
                </ToolbarButton>

                {/* Performance+ only: Alignment + Color + Highlight */}
                {isPerformance && (
                    <>
                        <Divider />
                        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} isActive={editor.isActive({ textAlign: 'left' })} title="Aligné à gauche">
                            <AlignLeft size={13} />
                        </ToolbarButton>
                        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} isActive={editor.isActive({ textAlign: 'center' })} title="Centré">
                            <AlignCenter size={13} />
                        </ToolbarButton>
                        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} isActive={editor.isActive({ textAlign: 'right' })} title="Aligné à droite">
                            <AlignRight size={13} />
                        </ToolbarButton>
                        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} isActive={editor.isActive({ textAlign: 'justify' })} title="Justifié">
                            <AlignJustify size={13} />
                        </ToolbarButton>

                        <Divider />

                        {/* Text color */}
                        <label title="Couleur du texte" className="relative p-1.5 rounded text-stone-600 hover:bg-stone-100 cursor-pointer transition-all flex items-center">
                            <Palette size={13} />
                            <input
                                type="color"
                                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
                                title="Couleur du texte"
                            />
                        </label>

                        {/* Highlight */}
                        <label title="Surligner" className="relative p-1.5 rounded text-stone-600 hover:bg-stone-100 cursor-pointer transition-all flex items-center">
                            <Highlighter size={13} />
                            <input
                                type="color"
                                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                onChange={(e) => editor.chain().focus().setHighlight({ color: e.target.value }).run()}
                                title="Couleur de surlignage"
                            />
                        </label>
                    </>
                )}
            </div>
            )}

            {/* Editor content */}
            <EditorContent editor={editor} />
        </div>
    );
};

export default TipTapEditor;
