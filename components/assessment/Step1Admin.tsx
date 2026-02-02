
import React, { useState } from 'react';
import { Patient } from '../../types';
import { calculateAge } from '../../utils';
import { User, Lock, AlertTriangle } from 'lucide-react';
import { SharedQuestionnaire } from '../shared/SharedQuestionnaire';

interface Props {
  data: Patient;
  updateData: (data: Partial<Patient>) => void;
  onNext: () => void;
}

export const Step1Admin: React.FC<Props> = ({ data, updateData, onNext }) => {
  const handleDataChange = (partialData: Partial<Patient>) => {
      if (partialData.dob) {
          partialData.age = calculateAge(partialData.dob);
      }
      updateData(partialData);
  };

  const handlePrivateNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateData({ interviewNotes: e.target.value });
  };

  return (
    <div className="max-w-4xl mx-auto pb-20 animate-in fade-in duration-500">
      <div className="mb-10 border-b border-stone-200 pb-6 flex justify-between items-end">
        <div>
            <h2 className="text-3xl font-serif font-bold text-stone-900">Dossier Patient</h2>
            <p className="text-stone-500 font-medium mt-2">Revue des données transmises et complétion.</p>
        </div>
        <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 border border-emerald-100">
            <User size={14} /> Mode Praticien
        </div>
      </div>

      <div className="bg-[#fffdf5] border border-[#F2CC8F]/50 rounded-[24px] p-6 mb-8 shadow-sm">
          <div className="flex items-center gap-2 mb-4 text-[#d97706]">
              <Lock size={18} />
              <h3 className="font-bold text-sm uppercase tracking-wider">Notes d'Entretien (Privé)</h3>
          </div>
          <textarea 
              value={data.interviewNotes || ''}
              onChange={handlePrivateNotesChange}
              placeholder="Notes confidentielles, impressions cliniques, éléments non partagés avec la famille..."
              className="w-full h-32 bg-white border border-[#F2CC8F]/30 rounded-xl p-4 text-stone-700 placeholder:text-stone-400 outline-none focus:ring-2 focus:ring-[#F2CC8F] resize-none leading-relaxed"
          />
          <div className="mt-2 flex items-center gap-2 text-[10px] text-stone-400">
              <AlertTriangle size={10} /> Ces notes sont chiffrées avec votre clé praticien et ne sont jamais visibles dans l'espace famille.
          </div>
      </div>

      <SharedQuestionnaire 
          data={data} 
          onChange={handleDataChange} 
          mode="practitioner" 
      />

      <div className="flex justify-center pt-12">
        <button 
            onClick={onNext}
            disabled={!data.lastName || !data.firstName}
            className="px-10 py-4 bg-[#3D405B] text-white rounded-xl font-bold text-sm shadow-xl hover:bg-[#E07A5F] hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
            Suivant : Tests & Mesures
        </button>
      </div>
    </div>
  );
};
