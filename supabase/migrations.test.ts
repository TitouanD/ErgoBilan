import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Les fonctions SQL ne tournent pas ici (pas de Postgres local) : on relit la
// dernière définition dans supabase/migrations/, celle qui est en base une fois
// les migrations appliquées.
const MIGRATIONS = join(__dirname, 'migrations');

function latestDefinition(fn: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const pattern = new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${fn}\([\s\S]*?\$function\$;`, 'g');
  let found: string | null = null;
  for (const file of files) {
    const matches = readFileSync(join(MIGRATIONS, file), 'utf8').match(pattern);
    if (matches) found = matches[matches.length - 1];
  }
  if (!found) throw new Error(`${fn} introuvable dans supabase/migrations/`);
  return found;
}

describe('consume_credit_for_user (#88)', () => {
  it("lit le résultat de l'UPDATE du crédit avant toute autre instruction", () => {
    const body = latestDefinition('consume_credit_for_user');
    // En PL/pgSQL, un PERFORM placé entre l'UPDATE et le test de FOUND écrase FOUND :
    // un UPDATE qui ne touche aucune ligne ouvrirait quand même une session.
    const afterUpdate = body.split(/UPDATE public\.practitioners[\s\S]*?;/)[1];
    expect(afterUpdate).toBeDefined();
    const nextStatement = afterUpdate.trimStart().split(';')[0];
    expect(nextStatement).toMatch(/^GET DIAGNOSTICS \w+ = ROW_COUNT$/);
  });
});
