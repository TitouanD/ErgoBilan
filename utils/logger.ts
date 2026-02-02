
const isDev = process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost';

export const Logger = {
    info: (...args: any[]) => {
        if (isDev) {
            console.info(`%c[INFO ${new Date().toLocaleTimeString()}]`, 'color: #3b82f6; font-weight: bold;', ...args);
        }
    },
    warn: (...args: any[]) => {
        if (isDev) {
            console.warn(`%c[WARN ${new Date().toLocaleTimeString()}]`, 'color: #f59e0b; font-weight: bold;', ...args);
        }
    },
    error: (...args: any[]) => {
        // En dev, on veut tout voir, y compris la stack trace et l'objet erreur complet
        if (isDev) {
            console.group(`%c[ERROR ${new Date().toLocaleTimeString()}]`, 'color: #ef4444; font-weight: bold;');
            args.forEach(arg => {
                if (typeof arg === 'object' && arg !== null) {
                    console.error(arg); // Affiche l'objet interactif
                    if (arg.message) console.error("Message:", arg.message);
                    if (arg.details) console.error("Details:", arg.details);
                    if (arg.hint) console.error("Hint:", arg.hint);
                    if (arg.code) console.error("PG Code:", arg.code);
                } else {
                    console.error(arg);
                }
            });
            console.groupEnd();
        }
    },
    debug: (...args: any[]) => {
        if (isDev) {
            console.debug(`%c[DEBUG ${new Date().toLocaleTimeString()}]`, 'color: #8b5cf6;', ...args);
        }
    }
};
