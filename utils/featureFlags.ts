const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export const parseBooleanEnv = (rawValue: unknown, defaultValue: boolean): boolean => {
  if (typeof rawValue === 'boolean') return rawValue;
  if (typeof rawValue !== 'string') return defaultValue;
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
};

export const featureFlag = (name: string, defaultValue = true): boolean => {
  const envMap = import.meta.env as Record<string, unknown>;
  return parseBooleanEnv(envMap[name], defaultValue);
};
