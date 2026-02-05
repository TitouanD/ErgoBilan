import { supabase } from './db';
import { UserProfile, BrandingConfig } from '../types';
import { Logger } from '../utils/logger';

// Valeurs par défaut pour éviter les crashs si la DB est incomplète
const DEFAULT_BRANDING: BrandingConfig = {
    isEnabled: false,
    primaryColor: '#3D405B',
    secondaryColor: '#E07A5F',
    fontFamily: 'Merriweather',
    headerTemplate: 'classic', // Default
    titleStyle: 'simple',      // Default
    headerLayout: 'row',
    headerAlignment: 'left',
    logoSize: 'medium',
    cornerStyle: 'rounded',
    cabinetName: "Cabinet d'Ergothérapie",
    brandSubtitle: "",
    documentTitle: "Bilan d'Ergothérapie",
    patientBlockStyle: 'modern',
    practitionerName: "",
    address: "",
    siret: "",
    footerText: "Document confidentiel - Bilan Ergothérapique",
    showPageNumbers: true
};

export const SubscriptionService = {
    
    /**
     * Récupère le profil complet (Practitioner + Subscription)
     * Combine les données de 2 tables.
     */
    getUserProfile: async (userId: string): Promise<UserProfile | null> => {
        try {
            // 1. Récupérer les données Praticien (Crédits, Admin)
            const { data: prac, error: pracError } = await supabase
                .from('practitioners')
                .select('email, credits, is_admin, first_name, last_name, phone_pro, siret, address_pro')
                .eq('id', userId)
                .single();

            if (pracError || !prac) throw pracError;

            // 2. Récupérer l'abonnement actif (ou le trial)
            const { data: sub, error: subError } = await supabase
                .from('subscriptions')
                .select('plan_id, status, trial_ends_at')
                .eq('user_id', userId)
                .maybeSingle();

            // Calcul des jours d'essai restants
            let isTrial = false;
            let trialDays = 0;
            
            if (sub?.status === 'trialing' && sub.trial_ends_at) {
                const end = new Date(sub.trial_ends_at).getTime();
                const now = new Date().getTime();
                if (end > now) {
                    isTrial = true;
                    trialDays = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
                }
            }

            // Construction du profil UI
            // Note: Branding est pour l'instant statique ou local, 
            // mais on pré-remplit les infos du cabinet avec les données DB
            const fullName = `${prac.first_name || ''} ${prac.last_name || ''}`.trim();
            const updatedBranding: BrandingConfig = {
                ...DEFAULT_BRANDING,
                cabinetName: DEFAULT_BRANDING.cabinetName, // User can override this later
                practitionerName: fullName,
                email: prac.email,
                phone: prac.phone_pro || '',
                address: prac.address_pro || '',
                siret: prac.siret || ''
            };

            return {
                id: userId,
                email: prac.email,
                credits: prac.credits || 0,
                isAdmin: prac.is_admin || false,
                subscriptionPlan: (sub?.plan_id as any) || 'free',
                status: (sub?.status as any) || 'active',
                isTrial,
                trialDaysRemaining: trialDays,
                totalBilansGenerated: 0, // À implémenter avec une table stats
                hasAcceptedResponsibility: false,
                branding: updatedBranding
            };

        } catch (e) {
            Logger.error('DB', "Erreur chargement profil:", e);
            return null;
        }
    },

    /**
     * Tente de consommer un crédit via la fonction sécurisée RPC (Server-Side)
     */
    consumeCredit: async (): Promise<boolean> => {
        try {
            const { data, error } = await supabase.rpc('consume_credit');
            if (error) throw error;
            return data === true; // Retourne true si succès, false si pas assez de crédits
        } catch (e) {
            Logger.error('DB', "Erreur consommation crédit:", e);
            return false;
        }
    },

    /**
     * Écoute les changements sur la table practitioners (ex: ajout de crédits par admin)
     */
    subscribeToCredits: (userId: string, onUpdate: (newCredits: number) => void) => {
        return supabase
            .channel('public:practitioners')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'practitioners', filter: `id=eq.${userId}` },
                (payload) => {
                    if (payload.new && typeof payload.new.credits === 'number') {
                        onUpdate(payload.new.credits);
                    }
                }
            )
            .subscribe();
    }
};