/**
 * useVoiceDictation — Web Speech API wrapper for real-time voice dictation.
 * Works on Chrome/Edge (95%+ desktop). Gracefully hides on unsupported browsers.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// Extend Window for vendor-prefixed API
interface SpeechRecognitionAlternative {
    transcript: string;
}

interface SpeechRecognitionResult {
    isFinal: boolean;
    [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
    length: number;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message?: string;
}

interface ISpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    onstart: (() => void) | null;
}

declare global {
    interface Window {
        SpeechRecognition: new () => ISpeechRecognition;
        webkitSpeechRecognition: new () => ISpeechRecognition;
    }
}

const getSpeechRecognitionClass = (): (new () => ISpeechRecognition) | null => {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

export const isVoiceDictationSupported = (): boolean => getSpeechRecognitionClass() !== null;

interface UseVoiceDictationOptions {
    locale?: string;
    continuous?: boolean;
    onTranscript?: (text: string) => void;
}

interface UseVoiceDictationReturn {
    isListening: boolean;
    isSupported: boolean;
    interimText: string;
    error: string | null;
    startListening: () => void;
    stopListening: () => void;
    toggleListening: () => void;
}

export const useVoiceDictation = (options: UseVoiceDictationOptions = {}): UseVoiceDictationReturn => {
    const { locale = 'fr-FR', continuous = true, onTranscript } = options;
    
    const [isListening, setIsListening] = useState(false);
    const [interimText, setInterimText] = useState('');
    const [error, setError] = useState<string | null>(null);
    
    const recognitionRef = useRef<ISpeechRecognition | null>(null);
    const onTranscriptRef = useRef(onTranscript);
    
    // Keep callback ref updated without triggering re-creation
    useEffect(() => {
        onTranscriptRef.current = onTranscript;
    }, [onTranscript]);

    const SpeechRecognitionClass = getSpeechRecognitionClass();
    const isSupported = SpeechRecognitionClass !== null;

    const startListening = useCallback(() => {
        if (!SpeechRecognitionClass) {
            setError('Dictée vocale non supportée par ce navigateur.');
            return;
        }
        
        setError(null);
        
        // Clean up any existing instance
        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch { /* noop */ }
        }
        
        const recognition = new SpeechRecognitionClass();
        recognition.continuous = continuous;
        recognition.interimResults = true;
        recognition.lang = locale;
        
        recognition.onstart = () => {
            setIsListening(true);
            setInterimText('');
        };
        
        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interim = '';
            let final = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += transcript;
                } else {
                    interim += transcript;
                }
            }
            
            setInterimText(interim);
            
            if (final) {
                onTranscriptRef.current?.(final);
                setInterimText('');
            }
        };
        
        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            // "no-speech" and "aborted" are expected, not real errors
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            setError(`Erreur dictée: ${event.error}`);
            setIsListening(false);
        };
        
        recognition.onend = () => {
            setIsListening(false);
            setInterimText('');
        };
        
        recognitionRef.current = recognition;
        
        try {
            recognition.start();
        } catch (e) {
            setError('Impossible de démarrer la dictée.');
            setIsListening(false);
        }
    }, [SpeechRecognitionClass, continuous, locale]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch { /* noop */ }
        }
        setIsListening(false);
        setInterimText('');
    }, []);

    const toggleListening = useCallback(() => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    }, [isListening, startListening, stopListening]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch { /* noop */ }
            }
        };
    }, []);

    return {
        isListening,
        isSupported,
        interimText,
        error,
        startListening,
        stopListening,
        toggleListening,
    };
};
